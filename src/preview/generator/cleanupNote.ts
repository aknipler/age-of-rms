// The preview note for the cleanup passes (preview-design Sec.6.1 rule 11 and
// Sec.6.4). A pass turns a tile pinched between tiles of its reference
// terrain into that terrain, and no line of the script asks for it, so an
// author whose land went missing has nothing in the code to point them at
// it. The note names it, because it is an engine quirk worth knowing rather
// than a gap in the preview.
//
// Two passes feed it. The land stage's cleanup runs against `base_terrain`,
// whatever that is, and the terrain stage ends with the same pass against
// WATER on every map.
//
// Only a change of terrain CLASS is worth a line. The classes are land,
// water, amphibious, unbuildable and beach. DESERT turned into GRASS is
// still ground a player builds on, so it goes unmentioned, while DESERT
// turned into WATER or BEACH turned into GRASS changes how the map plays.
//
// Pure, like the rest of the generator. `index.ts` feeds the tally from the
// two cleanups' listeners and asks for the note at the end.

import { lineOfOffset } from "../../parser/lineIndex";
import type { TerrainConstantForMasks } from "./grid";
import type { LandOrigin, SimulationNote, StageId } from "./types";

/**
 * The terrain flags the classes are read from, all from the community DE
 * terrain table through game-constants.json. `ObjectConstant` does not
 * declare the last three, and the JSON rows carry them, so this is the
 * narrow view of a row that this file reads. Structural typing lets the
 * caller's wider rows pass as it.
 */
export interface CleanupTerrainConstant extends TerrainConstantForMasks {
  isHybrid?: boolean;
  isBeach?: boolean;
  isUnbuildable?: boolean;
}

/** A terrain's class for this note. */
export type TerrainKind =
  "land" | "water" | "amphibious" | "unbuildable" | "beach";

/**
 * The class of one terrain row, or undefined for a terrain nothing
 * classifies. Beach and amphibious are tested before water because SHALLOW
 * is flagged both water and hybrid, and a shallow is amphibious ground.
 */
export function terrainKindOf(
  row: CleanupTerrainConstant | undefined,
): TerrainKind | undefined {
  if (row === undefined) return undefined;
  if (row.isBeach) return "beach";
  if (row.isHybrid) return "amphibious";
  if (row.isWater) return "water";
  if (row.isUnbuildable) return "unbuildable";
  // A row with none of the flags written is one nobody has classified, and
  // calling it land would be a claim made from the data's silence.
  if (row.isWater === undefined && row.isUnbuildable === undefined)
    return undefined;
  return "land";
}

/** What the cleanups changed over one generation. */
export interface CleanupTally {
  /** Terrain id to class, built once per tally. */
  readonly kinds: ReadonlyMap<number, TerrainKind | undefined>;
  /**
   * Reference terrain id to former terrain id to tiles, for changes of
   * class only. A `Map` keeps insertion order, so the land stage's pass is
   * named before the terrain stage's.
   */
  readonly byReference: Map<number, Map<number, number>>;
  /** Land index to tiles of it that a cleanup changed, any change. */
  readonly byLand: Map<number, number>;
  /** Lands that lost at least one tile to a change of class. */
  readonly crossClassLands: Set<number>;
  /** The first stage that changed a tile's class, for the note's stage label. */
  firstStage?: StageId;
}

export function createCleanupTally(
  constants: readonly CleanupTerrainConstant[],
): CleanupTally {
  const kinds = new Map<number, TerrainKind | undefined>();
  for (const row of constants)
    if (row.category === "terrain" && row.constId !== null)
      kinds.set(row.constId, terrainKindOf(row));
  return {
    kinds,
    byReference: new Map(),
    byLand: new Map(),
    crossClassLands: new Set(),
  };
}

/**
 * Records one tile a cleanup changed. `formerLand` is -1 for a tile no land
 * held. A terrain whose class is unknown counts as a change of class, since
 * a miss in the data cannot show the two are the same.
 */
export function recordCleanup(
  tally: CleanupTally,
  stage: StageId,
  reference: number,
  formerTerrain: number,
  formerLand: number,
): void {
  // Every change counts toward erasing a land, so a land that lost half its
  // tiles to GRASS and half to WATER still reads as gone.
  if (formerLand >= 0)
    tally.byLand.set(formerLand, (tally.byLand.get(formerLand) ?? 0) + 1);

  const from = tally.kinds.get(formerTerrain);
  const to = tally.kinds.get(reference);
  if (from !== undefined && from === to) return;

  tally.firstStage ??= stage;
  if (formerLand >= 0) tally.crossClassLands.add(formerLand);
  let former = tally.byReference.get(reference);
  if (!former) {
    former = new Map();
    tally.byReference.set(reference, former);
  }
  former.set(formerTerrain, (former.get(formerTerrain) ?? 0) + 1);
}

/** How many former terrains the note names per reference before it folds the rest into a count. */
const NAMED_TERRAINS = 3;
/** How many erased lands the note names by line before it only counts them. */
const NAMED_LANDS = 3;

/**
 * One short line naming what the cleanups turned into what, and why, and any
 * land they erased outright. Undefined when they changed no tile's class.
 *
 * A land counts as erased when every tile it held after growth was changed
 * and at least one of those changes crossed a class. A DESERT land the
 * GRASS cleanup wipes out is the same playable ground before and after.
 * `ownedAfterGrowth` is `countOwnedTiles` read before the land stage's
 * cleanup, the same reading `collectLandOutcomes` takes, so a land a later
 * land buried is that note's business and not this one's.
 */
export function cleanupNote(
  tally: CleanupTally,
  origins: readonly LandOrigin[],
  ownedAfterGrowth: Int32Array,
  constants: readonly TerrainConstantForMasks[],
  lineOffsets: readonly number[],
): SimulationNote | undefined {
  if (tally.firstStage === undefined) return undefined;

  let total = 0;
  const parts: string[] = [];
  for (const [reference, former] of tally.byReference) {
    let count = 0;
    for (const n of former.values()) count += n;
    total += count;
    const terrains = [...former]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([id, n]) => `${terrainName(constants, id)} ${n}`);
    const shown = terrains.slice(0, NAMED_TERRAINS);
    if (terrains.length > NAMED_TERRAINS)
      shown.push(`${terrains.length - NAMED_TERRAINS} more terrains`);
    // "4 tiles" on the first part only, "and 5" on the second.
    const amount =
      parts.length === 0 ? `${count} ${count === 1 ? "tile" : "tiles"}` : count;
    parts.push(
      `${amount} into ${terrainName(constants, reference)} (${shown.join(", ")})`,
    );
  }

  const pronoun = total === 1 ? "it" : "each";
  const why =
    tally.byReference.size === 1
      ? `${pronoun} sat between ${terrainName(constants, [...tally.byReference.keys()][0])} tiles`
      : `${pronoun} sat between tiles of the terrain it became`;

  // A `create_player_lands` makes one land per player from one command, so
  // erased lands are reported by the line of their command, each line once.
  const erasedLines = new Set<number>();
  for (const [land, count] of tally.byLand) {
    const owned = ownedAfterGrowth[land] ?? 0;
    if (owned > 0 && count >= owned && tally.crossClassLands.has(land))
      erasedLines.add(
        lineOfOffset(lineOffsets, origins[land].commandSpan.start) + 1,
      );
  }

  return {
    key: "cleanup",
    prominence: "drawer",
    stage: tally.firstStage,
    text: `Cleanup turned ${parts.join(" and ")} because ${why}${erasedPhrase([...erasedLines].sort((a, b) => a - b))}. ${ALWAYS_RUNS}`,
  };
}

/**
 * Said every time, so an author does not read the note's absence as the
 * cleanup not running.
 */
const ALWAYS_RUNS =
  "This shows because the terrain class changed, but the cleanup runs on every map.";

function erasedPhrase(lines: readonly number[]): string {
  if (lines.length === 0) return "";
  if (lines.length > NAMED_LANDS)
    return `, erasing lands from ${lines.length} commands`;
  if (lines.length === 1) return `, erasing the land on line ${lines[0]}`;
  const head = lines.slice(0, -1).join(", ");
  return `, erasing the lands on lines ${head} and ${lines[lines.length - 1]}`;
}

/** The terrain's constant name, or its id for one of the terrains DE gives no constant. */
function terrainName(
  constants: readonly TerrainConstantForMasks[],
  id: number,
): string {
  const row = constants.find(
    (c) => c.category === "terrain" && c.constId === id,
  );
  return row?.rmsConstant ?? `terrain ${id}`;
}
