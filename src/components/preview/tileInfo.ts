import { NO_LAYER } from "../../preview/generator/grid";
import type { FailureMark, PlacedObject, StageSnapshot } from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";

/**
 * Everything the readout says about one tile.
 *
 * This used to be built inside PreviewCanvas and handed out through
 * `onHoverTile`, which was fine while hover was the only reader. Selection
 * added a second one, and the two must not disagree — so the canvas now
 * reports COORDINATES and the pane derives the description. The distinction
 * matters beyond tidiness: a selection outlives the re-roll that regenerates
 * the map, and a stored description would keep showing the OLD map's terrain
 * for a tile the user is looking at right now. Storing (x, y) and deriving
 * makes that impossible by construction.
 */
export interface TileInfo {
  x: number;
  y: number;
  terrain: number;
  terrainName: string | null;
  elevation: number;
  cliff: boolean;
  /** The visual mask on this tile (`base_layer` / `terrain_mask`), or null when nothing is layered. */
  layerName: string | null;
  layer: number | null;
  /** Everything S6 placed on this exact tile, in placement order. Usually empty; more than one only where `force_placement` let objects stack. */
  objects: readonly PlacedObject[];
  /** Generation problems marked on this tile (Sec.15 item 5). Empty on all but a handful of tiles. */
  marks: readonly FailureMark[];
}

/** Shared empty array for tiles with nothing on them — a fresh `[]` per lookup would make every readout a new object and re-render for no change. */
const EMPTY_OBJECTS: readonly PlacedObject[] = [];
const EMPTY_MARKS: readonly FailureMark[] = [];

/** Objects bucketed by `y * dim + x`. */
export type ObjectsByTile = ReadonlyMap<number, PlacedObject[]>;

/** Failure marks bucketed by `y * dim + x`, so hovering one explains it. */
export type MarksByTile = ReadonlyMap<number, FailureMark[]>;

/**
 * Same shape as `indexObjectsByTile` and deliberately a second function rather
 * than a generic over `{x, y}`: the two are indexed together and read
 * together, and one generic helper would save four lines while making the
 * call sites read as though the two arrays were interchangeable. They are not
 * — one is unbounded and the other is bounded by land count.
 */
export function indexMarksByTile(marks: readonly FailureMark[], dim: number): MarksByTile {
  const index = new Map<number, FailureMark[]>();
  for (const mark of marks) {
    const key = mark.y * dim + mark.x;
    const bucket = index.get(key);
    if (bucket) bucket.push(mark);
    else index.set(key, [mark]);
  }
  return index;
}

/**
 * Builds the per-tile object index once per result.
 *
 * Not a filter over `result.objects` at lookup time: a map can carry tens of
 * thousands of objects and the pointer fires continuously, so the scan would
 * be O(objects) per mouse event.
 */
export function indexObjectsByTile(objects: readonly PlacedObject[], dim: number): ObjectsByTile {
  const index = new Map<number, PlacedObject[]>();
  for (const object of objects) {
    const key = object.y * dim + object.x;
    const bucket = index.get(key);
    if (bucket) bucket.push(object);
    else index.set(key, [object]);
  }
  return index;
}

/**
 * Reads one tile out of the grid. `x`/`y` must already be on the map —
 * `isOnMap` (projection.ts) is the caller's gate, since only the caller knows
 * whether an off-map pointer means "no readout" or "ignore this click".
 */
export function describeTile(
  snapshot: StageSnapshot,
  palette: TerrainPalette,
  objectsByTile: ObjectsByTile,
  marksByTile: MarksByTile,
  x: number,
  y: number,
): TileInfo {
  const index = y * snapshot.dim + x;
  const layer = snapshot.layer[index];
  return {
    x,
    y,
    terrain: snapshot.terrain[index],
    terrainName: palette.nameFor(snapshot.terrain[index]),
    layer: layer === NO_LAYER ? null : layer,
    layerName: layer === NO_LAYER ? null : palette.nameFor(layer),
    elevation: snapshot.elevation[index],
    cliff: snapshot.cliff[index] !== 0,
    objects: objectsByTile.get(index) ?? EMPTY_OBJECTS,
    marks: marksByTile.get(index) ?? EMPTY_MARKS,
  };
}

/** One entry per distinct (object, owner) pair on a tile, with how many of them there are. */
export interface ObjectTally {
  objectRef: string;
  /** Owning player, absent for gaia/neutral placements. */
  player?: number;
  count: number;
}

/**
 * Groups a tile's objects for display.
 *
 * Grouped by (objectRef, player) rather than listed one per entry, because the
 * common case for a stacked tile is several of the same thing — a tight group
 * of four gold, say — and "GOLD, GOLD, GOLD, GOLD" is noise. Returns structured
 * tallies rather than a formatted string so the renderer can shorten each name
 * on its own (nameDisplay.ts) instead of the caller pre-joining them.
 */
export function tallyObjects(objects: readonly PlacedObject[]): ObjectTally[] {
  const tallies = new Map<string, ObjectTally>();
  for (const object of objects) {
    // Player FIRST, then a colon, then the name. A number or the literal
    // "gaia" always ends at that colon, so no pair of (name, player) values
    // can collide - with the name first, "BOAR" with no player and "BOAR"
    // owned by player 1 differ only by a trailing character, and any missing
    // separator silently merges the two.
    const key = `${object.player ?? "gaia"}:${object.objectRef}`;
    const existing = tallies.get(key);
    if (existing) existing.count += 1;
    else tallies.set(key, { objectRef: object.objectRef, player: object.player, count: 1 });
  }
  return [...tallies.values()];
}
