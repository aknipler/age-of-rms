// TileGrid allocation, coordinate/border arithmetic, and derived masks —
// docs/preview-design.md Sec.4 and Sec.14's "grid.ts: TileGrid, distance
// transforms, masks". PURE (CLAUDE.md hard rule / preview-design Sec.2):
// every stage from lands.ts onward builds its grid and reads its masks
// through this module rather than re-deriving the arithmetic per stage —
// Sec.4's rounding rules are easy to get subtly wrong (see the two
// deliberately DIFFERENT rounding helpers below) and a second hand-rolled
// copy is exactly how that happens.

import type { BorderBounds, InstantiatedValue, TileGrid } from "./types";
import { roundForIntegerSlot } from "./mathEval";

// ---------------------------------------------------------------------------
// Allocation (Sec.4's TileGrid layout)
// ---------------------------------------------------------------------------

/**
 * `layer` value meaning "nothing is layered on this tile".
 *
 * NOT 0, which is what it used to be — 0 is GRASS's terrain id. Every read of
 * the layer array therefore could not tell a tile with no layer from a tile
 * layered with GRASS, and both directions of that confusion happen in real
 * scripts: `AD4 - Pag - v1.2.rms` runs `create_terrain DLC_DESERTGRAVEL {
 * base_terrain GRASS ... terrain_mask 2 }`, which moves GRASS into the layer
 * and so rendered with no mask tint at all, while a plain `base_layer GRASS`
 * would equally have matched every unlayered tile on the map.
 *
 * 0xffff is safe as a sentinel for the same reason `UNREACHABLE` is: the
 * array is a `Uint16Array` of terrain ids, and DE's own table ends at 130.
 */
export const NO_LAYER = 0xffff;

/**
 * One per generation, per Sec.4: "typed arrays, allocated once per
 * generation". `base_terrain`/`base_layer` fill the whole grid before any
 * land is placed (Sec.6.1's "Base fill"); `landId` starts at -1 ("no land
 * claims this tile" — Sec.4's own comment on the field) and `zone` starts at
 * 0, a neutral placeholder that means nothing until a land actually claims
 * the tile and stamps its own zone onto it (Sec.6.1's zone rules apply to
 * CLAIMED tiles only; an unclaimed base tile has no zone to speak of).
 */
export function createTileGrid(dim: number, baseTerrainId: number, baseLayerId = NO_LAYER): TileGrid {
  const n = dim * dim;
  return {
    dim,
    terrain: new Uint16Array(n).fill(baseTerrainId),
    layer: new Uint16Array(n).fill(baseLayerId),
    elevation: new Uint8Array(n),
    cliff: new Uint8Array(n),
    landId: new Int16Array(n).fill(-1),
    zone: new Int16Array(n),
    occupied: new Uint8Array(n),
  };
}

export function tileIndex(grid: TileGrid, x: number, y: number): number {
  return y * grid.dim + x;
}

// ---------------------------------------------------------------------------
// Coordinate / border arithmetic (Sec.4) — two DIFFERENT rounding rules,
// deliberately not unified: "Scaling truncates... borders round half up...
// a single shared helper would silently break one of them."
// ---------------------------------------------------------------------------

/**
 * Round-half-up, Sec.4's rule for every percent -> tile conversion
 * (`land_position`, borders). A thin alias over mathEval.ts's
 * `roundForIntegerSlot` rather than a second copy of "floor(x + 0.5)" — same
 * rule (Sec.3.6's "0.5 up"), same reason it exists, so one function owns it.
 */
export const percentRound = roundForIntegerSlot;

/**
 * `land_position %X %Y` -> a tile coordinate. Round-half-up, THEN clamp to
 * `[0, dim-1]` — Sec.4: "Clamp the converted tile to `[0, dim-1]` after
 * rounding, not the percentage before it" (measured against `Michi.rms`,
 * which writes `land_position 100 100` and would otherwise round to exactly
 * `dim`, one tile off-grid). Border bounds do NOT go through this — `maxX`/
 * `maxY` legitimately equal `dim` as a half-open loop bound, not a coordinate.
 */
export function positionPercentToTile(pct: number, dim: number): number {
  const raw = percentRound((pct / 100) * dim);
  return Math.max(0, Math.min(dim - 1, raw));
}

/**
 * Sec.4's `set_scale_by_size`/`set_scale_by_groups`/etc formula: "declared x
 * (dim^2/10000), computed exactly from the live dim" — never the guide's
 * rounded per-size ratio column, which Sec.4 spends a paragraph banning on
 * determinism grounds. TRUNCATES, not rounds (measured: `500 x 20736/10000`
 * = 1036.8 -> 1036 in three separate in-game runs, never 1037).
 */
export function scaleToMapArea(declared: number, dim: number): number {
  return Math.floor((declared * (dim * dim)) / 10000);
}

export interface BorderPercents {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type { BorderBounds } from "./types";

/**
 * Sec.4's border formula, measured to the tile (RMSTEST_16/17): every edge
 * rounds half-up, and the asymmetry the guide's own prose describes
 * ("a value of 3 is needed for the bottom and right borders" to match a top/
 * left value of 2) falls out of `dim - round(...)` on the high edges rather
 * than from a different rounding rule per edge — do not floor/ceil by side.
 *
 *   min_x = round(left%/100 * dim)      max_x = dim - round(right%/100 * dim)
 *   min_y = round(top%/100 * dim)       max_y = dim - round(bottom%/100 * dim)
 *
 * Negative border values are legal (guide:887) and deliberately not clamped
 * here — clamping belongs to whichever stage decides a resulting empty or
 * inverted range is unplaceable, not to this arithmetic.
 */
export function borderBounds(borders: BorderPercents, dim: number): BorderBounds {
  return {
    minX: percentRound((borders.left / 100) * dim),
    maxX: dim - percentRound((borders.right / 100) * dim),
    minY: percentRound((borders.top / 100) * dim),
    maxY: dim - percentRound((borders.bottom / 100) * dim),
  };
}

// ---------------------------------------------------------------------------
// Distance transform (Sec.4's "Derived masks")
// ---------------------------------------------------------------------------

/** Sentinel meaning "this terrain id does not appear anywhere on the grid". */
export const UNREACHABLE = 0xffff;

/**
 * Multi-source BFS, 4-connected — matching this codebase's standing
 * connectivity convention for terrain-shaped structure (CLAUDE.md: "terrain
 * clumps grow by 4-adjacent sampling... connectivity here is a claim about
 * how the thing was built, not a preference"). Distance in tiles from the
 * nearest tile whose `terrain` equals `terrainId`; 0 for a tile that IS that
 * terrain. Every entry is `UNREACHABLE` when the terrain is absent from the
 * grid entirely — a spacing check against it should then treat every
 * candidate as satisfying the constraint (no distance to violate), not as
 * failing it; that policy belongs to the caller.
 *
 * Sec.11: "distance transforms are computed lazily per (stage, terrainId)
 * and invalidated on stage boundaries" — this function is the thing that
 * gets called lazily and cached; it does no caching of its own, since the
 * cache's key (stage identity) is a caller concept this module doesn't have.
 */
export function distanceTransform(grid: TileGrid, terrainId: number): Uint16Array {
  const { dim, terrain } = grid;
  const n = dim * dim;
  const dist = new Uint16Array(n).fill(UNREACHABLE);
  // Index-based ring buffer, not an array of coordinates — Sec.11's "typed
  // arrays only, no per-tile objects" applies here exactly as it does to the
  // land-growth frontier.
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < n; i++) {
    if (terrain[i] === terrainId) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    const x = i % dim;
    const y = (i - x) / dim;
    if (x > 0) relax(i - 1, d);
    if (x < dim - 1) relax(i + 1, d);
    if (y > 0) relax(i - dim, d);
    if (y < dim - 1) relax(i + dim, d);
  }

  function relax(neighbor: number, fromDist: number): void {
    if (dist[neighbor] === UNREACHABLE) {
      dist[neighbor] = fromDist + 1;
      queue[tail++] = neighbor;
    }
  }

  return dist;
}

/**
 * `distanceTransform`'s sibling: multi-source BFS, 4-connected, over an
 * arbitrary boolean tile mask rather than a single terrain id — for a mask
 * built from more than one terrain (a name-heuristic water mask, several
 * enabled terrains) or from generation state that isn't a terrain at all
 * (S3's own `cliff` mask, which S4's `spacing_to_other_terrain_types` needs
 * treated as foreign terrain per Sec.6.4's pinned approximation, "cliff
 * tiles also count as foreign terrain for this spacing"). Same body as
 * `distanceTransform`, parameterized on the source mask instead of
 * `terrain[i] === terrainId` — kept as a separate function rather than
 * having `distanceTransform` call it, so an edit to one cannot silently
 * change the other's tested behaviour (Sec.4's own stated reason for
 * keeping `percentRound`/`scaleToMapArea` un-unified applies here too).
 * Same UNREACHABLE policy: a mask with no true tile anywhere returns
 * UNREACHABLE for every tile, and the caller treats that as "constraint
 * satisfied" (nothing to be too close to), not "constraint violated".
 */
export function distanceTransformFromMask(dim: number, mask: Uint8Array): Uint16Array {
  const n = dim * dim;
  const dist = new Uint16Array(n).fill(UNREACHABLE);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < n; i++) {
    if (mask[i] !== 0) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    const x = i % dim;
    const y = (i - x) / dim;
    if (x > 0) relax(i - 1, d);
    if (x < dim - 1) relax(i + 1, d);
    if (y > 0) relax(i - dim, d);
    if (y < dim - 1) relax(i + dim, d);
  }

  function relax(neighbor: number, fromDist: number): void {
    if (dist[neighbor] === UNREACHABLE) {
      dist[neighbor] = fromDist + 1;
      queue[tail++] = neighbor;
    }
  }

  return dist;
}

// ---------------------------------------------------------------------------
// Water / forest-zone masks (Sec.4's "Derived masks", Sec.12 item 6)
// ---------------------------------------------------------------------------

/**
 * The slice of reference/data/game-constants.json this module needs.
 * Declared locally rather than imported from breakdown/, matching
 * resourceTotals.ts/validate.ts/palette.ts's own precedent: each consumer
 * states the narrow shape it depends on.
 */
export interface TerrainConstantForMasks {
  constId: number | null;
  /** Null for the 53 DE terrains that have no callable constant — see the schema. A null never matches a name lookup, which is the correct outcome, not a gap. */
  rmsConstant: string | null;
  category: string;
  /** Community-sourced water flag; absent means fall back to the name heuristic below. */
  isWater?: boolean;
  /** Community-sourced forest flag; absent means fall back to the name heuristic below. */
  isForest?: boolean;
  /** Community-sourced shallows flag — terrain both land units and ships cross. Orthogonal to `isWater`, read only by the beach depth rule; absent means not hybrid, deliberately with no name heuristic (see `terrainDepth`). */
  isHybrid?: boolean;
  /** Community-sourced beach flag — the sand itself, not the ground on either side of it. Read by the `shore` habitat; absent means not beach. */
  isBeach?: boolean;
  /** The terrain automatically written where THIS terrain borders anything deeper than itself, or null for a terrain that never grows a beach. Absent means fall back to `DEFAULT_BEACH_TERRAIN` for anything that is not open water — see `beachTerrainFor`. */
  beachTerrain?: number | null;
}

// ---------------------------------------------------------------------------
// Terrain reference resolution — ONE implementation, called by every stage
// ---------------------------------------------------------------------------

/**
 * A terrain slot's written value -> a terrain id. The single resolver every
 * stage uses; each of S1 through S6 previously kept its own private
 * `terrainIdByName`, and all five of them handled exactly one of the three
 * forms a script can actually write.
 *
 * The three forms, in resolution order:
 *
 * 1. **A bare id** (`terrain_type 26`). Used because only 78 of DE's 131
 *    terrains have a constant at all; the rest have no other way to be
 *    named. A number IS the id — there is nothing to look up, and in
 *    particular an id our reference data has never heard of still resolves,
 *    per CLAUDE.md's positive-resolver rule (absence from our data is not
 *    evidence the terrain does not exist).
 * 2. **A built-in constant** (`terrain_type DEEP_WATER`), matched against
 *    game-constants.json.
 * 3. **A script's own `#const`** (`#const WOODIES 48` … `create_terrain
 *    WOODIES`). Deliberately LAST: the engine loads random_map.def before
 *    the script and `#const` is first-definition-wins, so a script that
 *    redefines a built-in name does not actually take effect in game and
 *    must not take effect here either.
 *
 * Returns undefined only when the value is a string that matches nothing —
 * which is a real "this map's reference data doesn't know that terrain",
 * unlike the false one every stage used to report for forms 1 and 3.
 */
export function resolveTerrainId(
  constants: readonly TerrainConstantForMasks[],
  value: InstantiatedValue,
  symbols?: ReadonlyMap<string, number>,
): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  for (const entry of constants) {
    if (entry.category === "terrain" && entry.constId !== null && entry.rmsConstant === value) return entry.constId;
  }
  return symbols?.get(value);
}

// Sec.12 item 6 recorded isWater/isForest as "sourced but NOT a boolean" (the
// dat's is_water is an undecoded bitfield) and named a name heuristic as the
// interim fallback: "(*WATER*, *FOREST*/*JUNGLE*/BAMBOO...)".
//
// THE DATA NOW EXISTS and the heuristic has been demoted to what its own spec
// text always called it — a fallback. `isWater`/`isForest` are transcribed
// from the community DE terrain table (Zetnus, reference-docs/), which lists
// per-terrain building and pathing rules for all 131 terrains. That matters
// because the heuristic is not merely incomplete, it is wrong in both
// directions: it cannot see the 53 unnamed terrains AT ALL (id 15 "Water 2D,
// Shoreless" and id 90 "Forest, Reeds" have no constant to match), it reads
// DLC_MANGROVESHALLOW as dry land when it is a shallow, and it reads
// BLACK_WALKABLE — no water anywhere in the concept — as nothing while
// missing "Forest, Oak Bush" entirely.
//
// The patterns stay, and stay narrow, for terrains whose entry carries no
// flag: absence of a flag is not evidence of anything (CLAUDE.md's
// positive-resolver rule), so a terrain the table never covered still gets
// the old answer rather than a silent `false`.
//
// WATER_NAME_PATTERN is exported because lands.ts's base_elevation step needs
// the same water question against a land's DECLARED terrain_type when the
// name resolves to nothing at all (guide:959).
export const WATER_NAME_PATTERN = /WATER/;
const FOREST_NAME_PATTERN = /FOREST|JUNGLE|BAMBOO/;

interface TerrainFacts {
  name: string | null;
  isWater?: boolean;
  isForest?: boolean;
  isHybrid?: boolean;
}

function terrainFactIndex(constants: readonly TerrainConstantForMasks[]): ReadonlyMap<number, TerrainFacts> {
  const byId = new Map<number, TerrainFacts>();
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId === null) continue;
    // first-wins, matching palette.ts
    if (!byId.has(entry.constId)) {
      byId.set(entry.constId, { name: entry.rmsConstant, isWater: entry.isWater, isForest: entry.isForest, isHybrid: entry.isHybrid });
    }
  }
  return byId;
}

/** The flag when the data has one, else the name heuristic, else false. Returns the answer AND whether it had to guess, since the mask's own `usedHeuristic` is a claim about the whole grid. */
function classify(facts: TerrainFacts | undefined, pattern: RegExp, flag: boolean | undefined): { value: boolean; guessed: boolean } {
  if (flag !== undefined) return { value: flag, guessed: false };
  if (facts?.name != null && pattern.test(facts.name)) return { value: true, guessed: true };
  return { value: false, guessed: facts !== undefined };
}

/**
 * Is this terrain id water? The single-terrain question `waterMask` answers
 * for a whole grid — used where there is no grid to scan, such as
 * `base_elevation`'s "doesn't work on water lands" rule (guide:959), which
 * has only the land's declared `terrain_type` to go on.
 */
export function isWaterTerrain(constants: readonly TerrainConstantForMasks[], terrainId: number | undefined): boolean {
  if (terrainId === undefined) return false;
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId !== terrainId) continue;
    return classify({ name: entry.rmsConstant, isWater: entry.isWater }, WATER_NAME_PATTERN, entry.isWater).value;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Terrain depth (land / hybrid / water) — read only by the automatic beach rule
// ---------------------------------------------------------------------------

/**
 * How deep a terrain is, on the only scale the automatic beach rule cares
 * about. A beach is written where a tile borders anything STRICTLY DEEPER than
 * itself, which is one rule covering all three of the boundaries the engine
 * edges: land against shallows, land against open water, and shallows against
 * open water.
 *
 * WHY THIS IS NOT `isWater`, and why `isWater` is untouched by it. The two
 * flags answer different questions and disagree in both directions. `isWater`
 * is the placement question every other stage asks — can a house go here, does
 * a cliff avoid it, is an object out of its habitat — and by that reading a
 * shallow IS water (`SHALLOW.isWater` is true, and cliffs and objects must keep
 * treating it that way). Depth is the question only this rule asks, and by that
 * reading a shallow is neither: `DLC_MANGROVESHALLOW` is buildable, walkable
 * ground the table calls a shallow and `isWater` correctly calls dry. Folding
 * hybrid into `isWater` would have moved every consumer of the water mask,
 * which is a much larger claim than the one being made here.
 *
 * `DEPTH_HYBRID` therefore takes precedence over `isWater` rather than being
 * derived from it: all ten hybrid rows land here whichever way their `isWater`
 * flag reads.
 *
 * **No name heuristic, deliberately** — unlike `isWater` and `isForest`, whose
 * fallback patterns exist because the community table left gaps this generator
 * had to guess across. It has no gaps here: every one of the 131 rows carries
 * an explicit `isHybrid`, and no pattern could work anyway, since
 * `YELLOW_SHALLOW` is a shallow and `YELLOW_SHALLOW_WATER` is open water. An
 * id the table has never covered falls to `isWater`'s own answer, which is
 * exactly how it behaved before this field existed.
 */
export const DEPTH_LAND = 0;
export const DEPTH_HYBRID = 1;
export const DEPTH_WATER = 2;

/** The depth of one terrain id — the single-terrain question `waterDepthMask` answers for a whole grid. */
export function terrainDepth(constants: readonly TerrainConstantForMasks[], terrainId: number | undefined): number {
  if (terrainId === undefined) return DEPTH_LAND;
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId !== terrainId) continue;
    if (entry.isHybrid) return DEPTH_HYBRID;
    break;
  }
  return isWaterTerrain(constants, terrainId) ? DEPTH_WATER : DEPTH_LAND;
}

/**
 * Is this terrain one of the nine beach terrains — the sand itself, rather
 * than the ground on either side of it?
 *
 * Distinct from "grows no beach", which is what `beachTerrainFor` returning
 * undefined means, and which the same nine rows also satisfy. That coincidence
 * is a consequence (a beach does not grow a beach), not a definition: open
 * water grows no beach either and is emphatically not sand. Asking the
 * question directly is what keeps the `shore` habitat from meaning "anything
 * that grows no beach", which would put shore fish in the middle of the ocean.
 */
export function isBeachTerrain(constants: readonly TerrainConstantForMasks[], terrainId: number | undefined): boolean {
  if (terrainId === undefined) return false;
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId !== terrainId) continue;
    return entry.isBeach === true;
  }
  return false;
}

export interface DepthMaskResult {
  /** One of DEPTH_LAND / DEPTH_HYBRID / DEPTH_WATER per tile. */
  depth: Uint8Array;
  /** True when at least one tile fell back to the Sec.12 item 6 name heuristic for its water answer. Hybrid never guesses (see `terrainDepth`), so this reports only the water half. */
  usedHeuristic: boolean;
}

/** `waterMask`'s three-level sibling: the depth of every tile on the grid. */
export function waterDepthMask(grid: TileGrid, constants: readonly TerrainConstantForMasks[]): DepthMaskResult {
  const facts = terrainFactIndex(constants);
  const depth = new Uint8Array(grid.dim * grid.dim);
  // Resolved per DISTINCT terrain id, as `waterMask` does: a 200x200 grid is
  // 40,000 lookups against a handful of terrains.
  const cache = new Map<number, number>();
  let usedHeuristic = false;
  for (let i = 0; i < depth.length; i++) {
    const id = grid.terrain[i];
    let hit = cache.get(id);
    if (hit === undefined) {
      const entry = facts.get(id);
      if (entry?.isHybrid) {
        hit = DEPTH_HYBRID;
      } else {
        const result = classify(entry, WATER_NAME_PATTERN, entry?.isWater);
        if (result.guessed) usedHeuristic = true;
        hit = result.value ? DEPTH_WATER : DEPTH_LAND;
      }
      cache.set(id, hit);
    }
    depth[i] = hit;
  }
  return { depth, usedHeuristic };
}

/**
 * The beach the engine writes over a tile of `terrainId` when that tile
 * borders something deeper than itself, or `undefined` for a terrain that
 * never grows one.
 *
 * This is ENGINE BEHAVIOUR, not a command: nothing in the script asks for it,
 * and the community DE terrain table states it on the beach terrains' own rows
 * — id 2 "automatically placed when land terrains border water", id 37
 * "created when snowy terrains border water". `create_terrain`'s
 * `beach_terrain` attribute (guide:1483) overrides it per command, and that
 * attribute's documented default of BEACH is exactly this rule showing
 * through, which is why the two share one code path in terrains.ts rather than
 * being two features that happen to write beaches.
 *
 * The fallback for a terrain our data has never heard of is
 * `DEFAULT_BEACH_TERRAIN` unless it is OPEN water — deliberately NOT "no
 * beach". CLAUDE.md's positive-resolver rule cuts this way: a script can write
 * any bare id it likes and 88 of the 131 known rows say BEACH, so "no beach"
 * would be the rarer answer dressed up as caution, and it fails visibly (a
 * coastline with no sand on it) rather than harmlessly.
 *
 * "Open water" and not "water" is the whole of the hybrid change here. A
 * shallow reads `isWater` true and grows a beach anyway, on the side facing
 * deeper water, so the fallback asks `terrainDepth` rather than
 * `isWaterTerrain` — otherwise the seven shallows that carry an explicit
 * `beachTerrain` would be answered from data while an unrecognised shallow was
 * answered "never" by a rule that predates the distinction.
 */
export const DEFAULT_BEACH_TERRAIN = 2; // BEACH

export function beachTerrainFor(constants: readonly TerrainConstantForMasks[], terrainId: number | undefined): number | undefined {
  if (terrainId === undefined) return undefined;
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId !== terrainId) continue;
    // `null` is a real answer ("this terrain grows no beach") and must not be
    // confused with the field being absent, which is why the check is
    // `!== undefined` rather than a truthiness test — 0 is a terrain id too.
    if (entry.beachTerrain !== undefined) return entry.beachTerrain ?? undefined;
    return terrainDepth(constants, terrainId) === DEPTH_WATER ? undefined : DEFAULT_BEACH_TERRAIN;
  }
  return DEFAULT_BEACH_TERRAIN;
}

export interface MaskResult {
  mask: Uint8Array;
  /** True when at least one tile on this grid had to fall back to the Sec.12 item 6 name heuristic because its terrain entry carries no flag. */
  usedHeuristic: boolean;
}

/** `isWater` per Sec.4's "water mask" — 1 where the tile's terrain is water. */
export function waterMask(grid: TileGrid, constants: readonly TerrainConstantForMasks[]): MaskResult {
  const facts = terrainFactIndex(constants);
  const mask = new Uint8Array(grid.dim * grid.dim);
  // Resolved per DISTINCT terrain id, not per tile: a 200x200 grid is 40,000
  // lookups against a handful of terrains.
  const cache = new Map<number, boolean>();
  let usedHeuristic = false;
  for (let i = 0; i < mask.length; i++) {
    const id = grid.terrain[i];
    let hit = cache.get(id);
    if (hit === undefined) {
      const entry = facts.get(id);
      const result = classify(entry, WATER_NAME_PATTERN, entry?.isWater);
      if (result.guessed) usedHeuristic = true;
      hit = result.value;
      cache.set(id, hit);
    }
    if (hit) mask[i] = 1;
  }
  return { mask, usedHeuristic };
}

/**
 * Sec.4's forest-zone mask, guide `place_on_forest_zone` semantics: a tile
 * whose OWN terrain is forest-flagged, OR that holds a placed tree object, OR
 * that is adjacent to either. "Adjacency" here is the full 8-neighbourhood
 * (Moore), not the 4-connected rule this module uses for growth/BFS — a zone
 * is a region you can stand at the edge of diagonally and still be "in the
 * treeline", which is a different claim from "grown by 4-adjacent steps".
 * Unmeasured against the engine (no RMSTEST exists for this yet); flagged
 * rather than silently assumed identical to the growth connectivity.
 *
 * `treeObjectTiles` is the objects stage's own output (Sec.6.6, not built
 * yet) — this function takes it as a plain tile-index list rather than
 * reaching into a PlacedObject array, so it has no dependency on that stage
 * existing yet and no dependency on object categories beyond "is a tree".
 */
export function forestZoneMask(
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  treeObjectTiles: readonly number[] = [],
): MaskResult {
  const facts = terrainFactIndex(constants);
  const { dim } = grid;
  const n = dim * dim;
  const core = new Uint8Array(n);
  const cache = new Map<number, boolean>();
  let usedHeuristic = false;
  for (let i = 0; i < n; i++) {
    const id = grid.terrain[i];
    let hit = cache.get(id);
    if (hit === undefined) {
      const entry = facts.get(id);
      const result = classify(entry, FOREST_NAME_PATTERN, entry?.isForest);
      if (result.guessed) usedHeuristic = true;
      hit = result.value;
      cache.set(id, hit);
    }
    if (hit) core[i] = 1;
  }
  for (const i of treeObjectTiles) {
    if (i >= 0 && i < n) core[i] = 1;
  }

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (core[i] === 1) {
      mask[i] = 1;
      continue;
    }
    const x = i % dim;
    const y = (i - x) / dim;
    outer: for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= dim) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= dim) continue;
        if (core[ny * dim + nx] === 1) {
          mask[i] = 1;
          break outer;
        }
      }
    }
  }
  return { mask, usedHeuristic };
}

// ---------------------------------------------------------------------------
// Slope mask (Sec.6.3's cliff start-tile rule, Sec.6.4's `set_flat_terrain_only`)
// ---------------------------------------------------------------------------

/**
 * A tile is "sloped" when any of its in-bounds 4-neighbours carries a
 * different `elevation` value. Built for S3's cliff-placement rule ("cliffs
 * avoid any slopes") and reused as-is by S4's `set_flat_terrain_only`
 * ("only paints this terrain onto flat ground") — both stages run after S2,
 * so `grid.elevation` is already final by the time either calls this.
 */
export function computeSlopeMask(grid: TileGrid): Uint8Array {
  const { dim, elevation } = grid;
  const n = dim * dim;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % dim;
    const y = (i - x) / dim;
    const e = elevation[i];
    const sloped =
      (x > 0 && elevation[i - 1] !== e) ||
      (x < dim - 1 && elevation[i + 1] !== e) ||
      (y > 0 && elevation[i - dim] !== e) ||
      (y < dim - 1 && elevation[i + dim] !== e);
    if (sloped) mask[i] = 1;
  }
  return mask;
}
