// S5: connections — docs/preview-design.md Sec.6.5. PURE (CLAUDE.md hard
// rule / preview-design Sec.2).
//
// Per connection command, resolve a NODE SET (which lands are eligible) and
// a PAIRING rule (which pairs among them get a connection attempt), then A*
// a path between each pair's regions and paint terrain along it. All six
// `create_connect_*` commands reduce to "resolve nodes, connect every pair"
// — even `create_connect_to_nonplayer_land`, whose pairing is bipartite
// (player x neutral) rather than within one set.
//
// `create_connect_same_land_zones` GROUPS by `.zone` and connects only
// WITHIN each group (`sameZonePairs`) — it is NOT a synonym for
// `create_connect_all_lands`. An earlier draft of this file read Sec.6.5's
// compressed "`…all_lands` / `…same_land_zones` -> all land origins, all
// pairs" as describing identical behaviour for both commands; that was
// wrong, caught in review, and cross-checked against two independent
// community RMS references (an AoE2 RMS command-table page and a
// zone-semantics summary), both agreeing on zone-partitioned grouping and
// consistent with this codebase's own already-measured zone defaults
// (Sec.6.1: neutral `create_land` shares zone -10, each player land gets
// its own `playerNumber - 10`). This is guide/community-sourced, not
// confirmed in-game the way this project's RMSTEST_* runs confirm other
// facts — worth an actual RMSTEST if this command's exact behaviour ever
// matters for something load-bearing. `preview-design.md` Sec.6.5 itself
// still has the wrong reading and should be corrected to match.
//
// PATHFINDING: A* with a binary heap (Sec.11), multi-source (every tile of
// the source land) and multi-goal (any tile of the target land), heuristic
// = Manhattan distance from a candidate tile to the target land's bounding
// box (admissible: minimum passable terrain cost is 1, guide's own "cost
// <=0 means impassable", so true path cost can never be cheaper than a
// 4-connected step count, and box-distance never overestimates the true
// distance to the nearest tile actually in the region). `grid.terrain`
// already holds the terrain UNDER any cliff (cliffs.ts never writes to
// `terrain`, only to `cliff`), which is exactly Sec.9 item 7's own
// resolution of "what does the pathfinder see under a cliff" — no special
// cliff handling is needed here, the grid already reads that way for free.
//
// ACCUMULATE_CONNECTIONS is a standalone stream-state toggle sitting
// directly in the section (`kind: "standalone"`, not an attribute of any
// block), same shape as cliffs.ts's own standalone attributes: it is a
// plain `InstantiatedCommand` in `sections.get("CONNECTION_GENERATION")`,
// encountered in script order alongside the six `create_connect_*` block
// commands. Once seen, every LATER command in the section reads terrain
// state (for both `terrain_cost` and `replace_terrain`'s "from" matching)
// from the LIVE grid rather than a snapshot frozen at the start of S5 —
// "costs/replacements see prior connections' output" (Sec.6.5).
//
// TO_NONPLAYER_LAND'S DOCUMENTED BUG is emulated deliberately: once that
// command runs, every `create_connect_*` command AFTER it in the section
// is skipped outright (still gets a CommandReport, per "never silently
// drop content", plus a SimulationNote explaining why).

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  LandOrigin,
  PlacementFailure,
  SimulationNote,
  TileGrid,
} from "./types";
import { createSubstream, nextInt, type Rng } from "./rng";
import { resolveTerrainId, tileIndex, type TerrainConstantForMasks } from "./grid";
import { pushFailure } from "./placement";

// ---------------------------------------------------------------------------
// Attribute reading — duplicated per-file convention (see elevation.ts's
// header for why: small, stage-agnostic, not worth a shared module).
// ---------------------------------------------------------------------------

/**
 * The script's own `#const` table (`InstantiatedScript.symbols`), threaded
 * into every terrain lookup below. Optional on the exported readers purely so
 * their unit tests can keep calling them with two arguments — a script that
 * defines no constants and one whose constants are withheld are the same
 * thing to `resolveTerrainId`.
 */
type Symbols = ReadonlyMap<string, number>;

/**
 * Upper bound for the flat `terrain_cost` table below. Not a claim about
 * which terrains exist — a script can write any id, and ids above this fall
 * back to the Map — only about where a dense array stops paying for itself.
 * DE's own table ends at 130 and `grid.terrain` is a `Uint16Array`.
 */
const MAX_TERRAIN_ID = 255;

// ---------------------------------------------------------------------------
// Node-set resolution (Sec.6.5's own list, one function per command)
// ---------------------------------------------------------------------------

function playerLandIndices(origins: readonly LandOrigin[]): number[] {
  const out: number[] = [];
  origins.forEach((o, i) => {
    if (o.player !== undefined) out.push(i);
  });
  return out;
}

function neutralLandIndices(origins: readonly LandOrigin[]): number[] {
  const out: number[] = [];
  origins.forEach((o, i) => {
    if (o.player === undefined) out.push(i);
  });
  return out;
}

/** Every unique unordered pair within one set. */
function allPairs(indices: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) pairs.push([indices[i], indices[j]]);
  }
  return pairs;
}

/** Bipartite pairs between two disjoint sets — `create_connect_to_nonplayer_land`'s "player x neutral pairs only". */
export function crossPairs(a: readonly number[], b: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const i of a) for (const j of b) pairs.push([i, j]);
  return pairs;
}

/**
 * `create_connect_teams_lands`: all pairs WITHIN each canonical team,
 * independently — never across teams, and canonical team 0 (un-teamed)
 * produces no pairs at all, "not the team of everyone left over" (Sec.6.5).
 */
export function teamPairs(origins: readonly LandOrigin[], teams: InstantiatedScript["teams"]): Array<[number, number]> {
  const byTeam = new Map<number, number[]>();
  origins.forEach((o, i) => {
    if (o.player === undefined) return;
    const team = teams.canonical[o.player - 1] ?? 0;
    if (team === 0) return;
    const list = byTeam.get(team);
    if (list) list.push(i);
    else byTeam.set(team, [i]);
  });
  const pairs: Array<[number, number]> = [];
  for (const indices of byTeam.values()) pairs.push(...allPairs(indices));
  return pairs;
}

export function landZonePairs(origins: readonly LandOrigin[], zoneA: number, zoneB: number): Array<[number, number]> {
  const indices: number[] = [];
  origins.forEach((o, i) => {
    if (o.zone === zoneA || o.zone === zoneB) indices.push(i);
  });
  return allPairs(indices);
}

/**
 * `create_connect_same_land_zones`: all pairs WITHIN each zone,
 * independently — GROUPS by `.zone`, unlike `create_connect_all_lands`,
 * which ignores zone entirely (see this file's header for the correction
 * this represents). By default every `create_land` shares zone -10 while
 * every player land gets its own zone (`playerNumber - 10`, Sec.6.1) — so
 * on an unmodified script this connects the neutral lands to each other
 * and does NOT connect player lands to anything, which is the whole point
 * of the command existing as something other than a synonym for
 * `create_connect_all_lands`. Zone -12 ("belongs to no zone", Sec.6.1) is
 * excluded from grouping, mirroring lands.ts's own exemption for it.
 */
export function sameZonePairs(origins: readonly LandOrigin[]): Array<[number, number]> {
  const byZone = new Map<number, number[]>();
  origins.forEach((o, i) => {
    if (o.zone === -12) return;
    const list = byZone.get(o.zone);
    if (list) list.push(i);
    else byZone.set(o.zone, [i]);
  });
  const pairs: Array<[number, number]> = [];
  for (const indices of byZone.values()) pairs.push(...allPairs(indices));
  return pairs;
}

// ---------------------------------------------------------------------------
// Binary min-heap (Sec.11: "A* uses a binary heap") — exported for direct
// unit testing, matching this codebase's convention for a risky, easy-to-
// get-subtly-wrong mechanism (bucketWeights/reservoirSize, growClump, ...).
// Lazy-deletion: a stale, superseded entry may still sit in the heap when
// popped; the caller checks it against its own closed/gScore state and
// skips it rather than this heap supporting decrease-key.
// ---------------------------------------------------------------------------

export class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  /** Empties the heap so one instance can serve every search in a command — see PathScratch. */
  clear(): void {
    this.values.length = 0;
    this.priorities.length = 0;
  }

  push(value: number, priority: number): void {
    this.values.push(value);
    this.priorities.push(priority);
    let i = this.values.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.values.length === 0) return undefined;
    const top = this.values[0];
    const lastValue = this.values.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.values.length > 0) {
      this.values[0] = lastValue;
      this.priorities[0] = lastPriority;
      let i = 0;
      const n = this.values.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < n && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(i: number, j: number): void {
    const v = this.values[i];
    this.values[i] = this.values[j];
    this.values[j] = v;
    const p = this.priorities[i];
    this.priorities[i] = this.priorities[j];
    this.priorities[j] = p;
  }
}

// ---------------------------------------------------------------------------
// A* pathfinding
// ---------------------------------------------------------------------------

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** One bounding box per land, indexed the same way `grid.landId` is (an index into the `origins` array). Computed once per `applyConnections` call -- land regions are stable throughout S5 (connections paint terrain, never `landId`). */
export function computeLandBoundingBoxes(grid: TileGrid, landCount: number): BoundingBox[] {
  const boxes: BoundingBox[] = Array.from({ length: landCount }, () => ({
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  }));
  const { dim } = grid;
  for (let i = 0; i < grid.landId.length; i++) {
    const land = grid.landId[i];
    if (land < 0) continue;
    const x = i % dim;
    const y = (i - x) / dim;
    const box = boxes[land];
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
  }
  return boxes;
}

function boxDistance(box: BoundingBox, x: number, y: number): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dy = Math.max(box.minY - y, 0, y - box.maxY);
  return dx + dy;
}

/**
 * Reusable working arrays for `findConnectionPath`, allocated ONCE per
 * `applyConnections` call instead of once per search.
 *
 * The searches are per PAIR of lands, so a script with many lands runs
 * hundreds of them (`AD4 - Pag - v1.2.rms`: 27 lands x three
 * `create_connect_all_lands` commands). Each was allocating and then clearing
 * three `dim^2` arrays — about half a megabyte of churn and 120,000 writes
 * per search, before any pathfinding happened. `24hr_Caverns.rms` spent 3.0 s
 * in S5 (measured 2026-08-07).
 *
 * The clear is avoided by GENERATION STAMPING rather than by refilling: each
 * search bumps `generation`, and a cell counts as written only when its stamp
 * matches. An unmatched stamp means "not visited this search", which is what
 * `Infinity` / `0` used to mean. That turns the per-search setup from O(dim^2)
 * into O(source tiles).
 *
 * `generation` starts at 0 and the stamps at 0, so the FIRST search must not
 * read generation 0 as valid — hence `++scratch.generation` before use, never
 * `scratch.generation++`.
 */
export interface PathScratch {
  gScore: Float64Array;
  gStamp: Int32Array;
  cameFrom: Int32Array;
  closedStamp: Int32Array;
  heap: MinHeap;
  generation: number;
}

export function createPathScratch(dim: number): PathScratch {
  const n = dim * dim;
  return {
    gScore: new Float64Array(n),
    gStamp: new Int32Array(n),
    cameFrom: new Int32Array(n),
    closedStamp: new Int32Array(n),
    heap: new MinHeap(),
    generation: 0,
  };
}

/** Tile indices owned by each land, so a search does not rescan the grid to find its own start set. Index matches `origins`. */
function landTiles(grid: TileGrid, landCount: number): number[][] {
  const tiles: number[][] = Array.from({ length: landCount }, () => []);
  for (let i = 0; i < grid.landId.length; i++) {
    const land = grid.landId[i];
    if (land >= 0 && land < landCount) tiles[land].push(i);
  }
  return tiles;
}

/**
 * Multi-source, multi-goal A*: every tile of `sourceLand` starts at cost 0;
 * the search ends the moment ANY tile of `targetLand` is reached. Returns
 * the path as tile indices (source to target, inclusive) or `undefined`
 * when no route exists — "impassable moat of cost-0 terrain, or
 * unreachable land" (Sec.6.5), which this treats identically: both simply
 * exhaust the open set without ever reaching a target-land tile.
 */
export function findConnectionPath(
  grid: TileGrid,
  terrainOf: Uint16Array,
  costOf: (terrainId: number) => number,
  sourceLand: number,
  targetLand: number,
  targetBox: BoundingBox,
  scratch: PathScratch = createPathScratch(grid.dim),
  sourceTiles?: readonly number[],
): number[] | undefined {
  const { dim } = grid;
  const n = dim * dim;
  const { gScore, gStamp, cameFrom, closedStamp, heap } = scratch;
  const gen = ++scratch.generation;
  heap.clear();

  // Seeded from a prebuilt tile list when the caller has one. Without it this
  // is an O(dim^2) scan per search, and `create_connect_all_lands` runs one
  // search per PAIR of lands — 27 lands is 351 pairs, three commands of them
  // in `AD4 - Pag - v1.2.rms`.
  if (sourceTiles !== undefined) {
    for (const i of sourceTiles) {
      gScore[i] = 0;
      gStamp[i] = gen;
      cameFrom[i] = -1; // terminates the path walk; the array is reused, so a stale value here would run off the end of this search's own chain
      const x = i % dim;
      heap.push(i, boxDistance(targetBox, x, (i - x) / dim));
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (grid.landId[i] !== sourceLand) continue;
      gScore[i] = 0;
      gStamp[i] = gen;
      cameFrom[i] = -1; // terminates the path walk; the array is reused, so a stale value here would run off the end of this search's own chain
      const x = i % dim;
      heap.push(i, boxDistance(targetBox, x, (i - x) / dim));
    }
  }

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (closedStamp[current] === gen) continue;
    if (grid.landId[current] === targetLand) {
      const path: number[] = [];
      let t: number = current;
      // `cameFrom` needs no stamp of its own: every tile on this chain was
      // written during THIS search (a tile only enters the heap when its
      // gScore is written, and the source tiles terminate the chain at -1).
      while (t !== -1) {
        path.push(t);
        t = cameFrom[t];
      }
      path.reverse();
      return path;
    }
    closedStamp[current] = gen;

    const x = current % dim;
    const y = (current - x) / dim;
    // The four neighbours are visited inline rather than collected into an
    // array first. That array was allocated once per EXPANSION, and an
    // expansion is per tile per search — `AD4 - Pag - v1.2.rms` runs several
    // hundred searches over a 40,000-tile grid (27 lands, three
    // `create_connect_all_lands` commands), so it was tens of millions of
    // throwaway arrays for a fixed set of four numbers.
    if (x > 0) relax(current, current - 1);
    if (x < dim - 1) relax(current, current + 1);
    if (y > 0) relax(current, current - dim);
    if (y < dim - 1) relax(current, current + dim);
  }
  return undefined;

  function relax(from: number, neighbor: number): void {
    if (closedStamp[neighbor] === gen) return;
    const cost = costOf(terrainOf[neighbor]);
    if (cost <= 0) return; // "<=0 -> impassable" (Sec.6.5)
    const tentativeG = gScore[from] + cost;
    // A stale gScore from an earlier search reads as Infinity, which is what
    // the per-search `.fill(Infinity)` used to write — see PathScratch.
    if (gStamp[neighbor] === gen && tentativeG >= gScore[neighbor]) return;
    gScore[neighbor] = tentativeG;
    gStamp[neighbor] = gen;
    cameFrom[neighbor] = from;
    const nx = neighbor % dim;
    const ny = (neighbor - nx) / dim;
    heap.push(neighbor, tentativeG + boxDistance(targetBox, nx, ny));
  }
}

// ---------------------------------------------------------------------------
// Per-command cost/replacement tables (Sec.6.5) — each `create_connect_*`
// command declares its OWN, matching language.json's per-command attribute
// list (not a section-wide default).
// ---------------------------------------------------------------------------

/** `terrain_cost Terrain Cost` (repeatable): builds a lookup, unlisted terrains default to 1 (Sec.6.5). Last declaration wins for a repeated terrain, matching Sec.3 rule 10's general policy. */
export function readTerrainCosts(cmd: InstantiatedCommand, constants: readonly TerrainConstantForMasks[], symbols?: Symbols): Map<number, number> {
  const costs = new Map<number, number>();
  for (const attr of cmd.attributes.get("terrain_cost") ?? []) {
    const cost = attr.args[1]?.value;
    if (typeof cost !== "number") continue;
    const terrainId = resolveTerrainId(constants, attr.args[0]?.value, symbols);
    if (terrainId !== undefined) costs.set(terrainId, cost);
  }
  return costs;
}

export interface TerrainSize {
  radius: number;
  variance: number;
}

/** `terrain_size Terrain Radius Variance` (repeatable, language.json labels the last two args "width"/"spacing" but Sec.6.5's own prose calls them radius/variance — read positionally, the labels are cosmetic). Absent entry -> radius 1, variance 0 (guide:1958/1960). */
export function readTerrainSizes(cmd: InstantiatedCommand, constants: readonly TerrainConstantForMasks[], symbols?: Symbols): Map<number, TerrainSize> {
  const sizes = new Map<number, TerrainSize>();
  for (const attr of cmd.attributes.get("terrain_size") ?? []) {
    const radius = attr.args[1]?.value;
    const variance = attr.args[2]?.value;
    if (typeof radius !== "number") continue;
    const terrainId = resolveTerrainId(constants, attr.args[0]?.value, symbols);
    if (terrainId !== undefined) sizes.set(terrainId, { radius, variance: typeof variance === "number" ? variance : 0 });
  }
  return sizes;
}

export interface ReplacementRule {
  /** `undefined` = wildcard (`default_terrain_replacement`), matches every terrain. */
  from: number | undefined;
  to: number;
  order: number; // source position, for "expansion order" resolution
}

/**
 * `replace_terrain A->B` (repeatable) and `default_terrain_replacement T`
 * (a wildcard "replace everything") merge into ONE ordered rule list by
 * source position (Sec.6.5: "overriding earlier list entries but not later
 * ones -- emulate by expansion order"). Resolving a terrain then means:
 * scan in order, keep the LAST rule that matches (specific-terrain match OR
 * wildcard) -- a wildcard written after a specific rule overrides it for
 * every terrain; a specific rule written after the wildcard still wins for
 * its own terrain, since it is later and it also matches.
 */
export function readReplacementRules(cmd: InstantiatedCommand, constants: readonly TerrainConstantForMasks[], symbols?: Symbols): ReplacementRule[] {
  const rules: ReplacementRule[] = [];
  for (const attr of cmd.attributes.get("replace_terrain") ?? []) {
    const fromId = resolveTerrainId(constants, attr.args[0]?.value, symbols);
    const toId = resolveTerrainId(constants, attr.args[1]?.value, symbols);
    if (fromId !== undefined && toId !== undefined) rules.push({ from: fromId, to: toId, order: attr.span.start });
  }
  const defaultAttr = cmd.attributes.get("default_terrain_replacement")?.[0];
  if (defaultAttr) {
    const toId = resolveTerrainId(constants, defaultAttr.args[0]?.value, symbols);
    if (toId !== undefined) rules.push({ from: undefined, to: toId, order: defaultAttr.span.start });
  }
  rules.sort((a, b) => a.order - b.order);
  return rules;
}

export function resolveReplacement(rules: readonly ReplacementRule[], terrainId: number): number | undefined {
  let result: number | undefined;
  for (const rule of rules) {
    if (rule.from === undefined || rule.from === terrainId) result = rule.to;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Terrain application along a found path (Sec.6.5)
// ---------------------------------------------------------------------------

/**
 * Per path tile: roll an effective radius (base +/- uniform variance,
 * looked up by the tile's OWN current terrain -- default radius 1,
 * variance 0 when that terrain has no `terrain_size` entry), skip entirely
 * on a negative roll ("negative effective radius -> replace nothing" --
 * guide:1965), else replace every terrain within that many tiles (a
 * Euclidean disc, squared-distance compared -- Sec.8 bans `Math.sqrt`) per
 * `rules`. Reads "from" terrain and radius terrain from `terrainOf`
 * (snapshot or live grid, per the caller's accumulate_connections
 * decision) but WRITES to `grid.terrain` directly and immediately, so a
 * later path tile's disc can overwrite an earlier one's where they overlap
 * -- the same order the path itself was walked in.
 */
export function applyTerrainAlongPath(
  grid: TileGrid,
  path: readonly number[],
  terrainOf: Uint16Array,
  sizes: ReadonlyMap<number, TerrainSize>,
  rules: readonly ReplacementRule[],
  rng: Rng,
): void {
  const { dim } = grid;
  for (const tile of path) {
    const terrainHere = terrainOf[tile];
    const size = sizes.get(terrainHere) ?? { radius: 1, variance: 0 };
    const roll = size.variance > 0 ? nextInt(rng, -size.variance, size.variance) : 0;
    const radius = size.radius + roll;
    if (radius < 0) continue;

    const cx = tile % dim;
    const cy = (tile - cx) / dim;
    const r2 = radius * radius;
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(dim - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(dim - 1, cy + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = tileIndex(grid, x, y);
        const replacement = resolveReplacement(rules, terrainOf[i]);
        if (replacement !== undefined) grid.terrain[i] = replacement;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ConnectionsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
}

const CONNECT_COMMAND_NAMES = new Set([
  "create_connect_all_players_land",
  "create_connect_teams_lands",
  "create_connect_all_lands",
  "create_connect_same_land_zones",
  "create_connect_land_zones",
  "create_connect_to_nonplayer_land",
]);

function landLabel(origins: readonly LandOrigin[], index: number): string {
  const origin = origins[index];
  return origin.player !== undefined ? `P${origin.player}` : `N${index}`;
}

function resolvePairs(cmd: InstantiatedCommand, origins: readonly LandOrigin[], teams: InstantiatedScript["teams"]): Array<[number, number]> {
  switch (cmd.name) {
    case "create_connect_all_players_land":
      return allPairs(playerLandIndices(origins));
    case "create_connect_teams_lands":
      return teamPairs(origins, teams);
    case "create_connect_all_lands":
      return allPairs(origins.map((_, i) => i));
    case "create_connect_same_land_zones":
      return sameZonePairs(origins);
    case "create_connect_land_zones": {
      const zoneA = typeof cmd.args[0]?.value === "number" ? cmd.args[0].value : 0;
      const zoneB = typeof cmd.args[1]?.value === "number" ? cmd.args[1].value : 0;
      return landZonePairs(origins, zoneA, zoneB);
    }
    case "create_connect_to_nonplayer_land":
      return crossPairs(playerLandIndices(origins), neutralLandIndices(origins));
    default:
      return [];
  }
}

/**
 * Sec.6.5: `<CONNECTION_GENERATION>` -> paths, painted as terrain onto
 * `grid.terrain`. Returns one CommandReport per `create_connect_*` command
 * (Sec.7) plus SimulationNotes for the two documented behaviours this file
 * emulates rather than silently improving on: `create_connect_teams_lands`
 * against a no-teams lobby (Sec.3.1's own `"teams"` key), and
 * `create_connect_to_nonplayer_land`'s command-blocking bug.
 */
export function applyConnections(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  masterSeed: number,
): ConnectionsResult {
  const commands = instantiated.sections.get("CONNECTION_GENERATION") ?? [];
  const reports: CommandReport[] = [];
  const notes: SimulationNote[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S5", ordinal++);

  const startOfS5Terrain = grid.terrain.slice(); // frozen snapshot for the non-accumulating default
  let accumulating = false;
  let blocked = false;
  let sawTeamsCommand = false;
  const landBoxes = computeLandBoundingBoxes(grid, origins.length);
  // One set of working arrays for every A* search this stage runs — see PathScratch.
  const pathScratch = createPathScratch(grid.dim);

  for (const cmd of commands) {
    if (cmd.name === "accumulate_connections") {
      accumulating = true;
      continue;
    }
    if (!CONNECT_COMMAND_NAMES.has(cmd.name)) continue;

    if (cmd.name === "create_connect_teams_lands") sawTeamsCommand = true;

    if (blocked) {
      notes.push({
        key: `connectionBlockedByBug:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S5",
        span: cmd.span,
        text: "create_connect_to_nonplayer_land has no effect on connections declared after it — a documented engine bug the preview reproduces rather than silently fixing, so this command produced nothing.",
      });
      reports.push({ commandSpan: cmd.span, stage: "S5", attempted: 0, placed: 0, failures: [] });
      continue;
    }

    const terrainOf = accumulating ? grid.terrain : startOfS5Terrain;
    const costs = readTerrainCosts(cmd, constants, instantiated.symbols);
    const sizes = readTerrainSizes(cmd, constants, instantiated.symbols);
    const rules = readReplacementRules(cmd, constants, instantiated.symbols);
    // Resolved into a flat table once per command rather than a Map lookup
    // per neighbour expansion. Terrain ids are small and dense (0-130 today),
    // so the table stays tiny; `?? 1` is Sec.6.5's "unlisted terrains cost 1".
    const costTable = new Float64Array(MAX_TERRAIN_ID + 1).fill(1);
    for (const [terrainId, cost] of costs) {
      if (terrainId >= 0 && terrainId <= MAX_TERRAIN_ID) costTable[terrainId] = cost;
    }
    const costOf = (terrainId: number): number => (terrainId <= MAX_TERRAIN_ID ? costTable[terrainId] : (costs.get(terrainId) ?? 1));

    const pairs = resolvePairs(cmd, origins, instantiated.teams);
    const failures: PlacementFailure[] = [];
    let placed = 0;

    // Both rebuilt per command, not per pair, and not hoisted above the
    // command loop either: an earlier connection paints terrain, and under
    // `accumulate_connections` a later command is supposed to see it. Land
    // OWNERSHIP does not change during S5, but keeping the two together
    // makes that a local fact rather than something to re-derive later.
    const tilesByLand = landTiles(grid, origins.length);

    for (const [a, b] of pairs) {
      const path = findConnectionPath(grid, terrainOf, costOf, a, b, landBoxes[b], pathScratch, tilesByLand[a]);
      if (path === undefined) {
        pushFailure(failures, {
          bucket: "connectionBlocked",
          commandSpan: cmd.span,
          stage: "S5",
          entity: `connection ${landLabel(origins, a)}-${landLabel(origins, b)}`,
          detail: "No passable route exists between these two lands' regions, so this connection was not produced.",
        });
        continue;
      }
      const pairRng = nextSubstream();
      applyTerrainAlongPath(grid, path, terrainOf, sizes, rules, pairRng);
      placed++;
    }

    reports.push({ commandSpan: cmd.span, stage: "S5", attempted: pairs.length, placed, failures });

    if (cmd.name === "create_connect_to_nonplayer_land") blocked = true;
  }

  if (sawTeamsCommand && instantiated.teams.teamCount === 0) {
    notes.push({
      key: "teams",
      prominence: "drawer",
      stage: "S5",
      text: "This script connects team lands, but the current lobby has no teams — the preview is accurate for this lobby, but check whether it's the lobby you meant.",
    });
  }

  return { reports, notes };
}
