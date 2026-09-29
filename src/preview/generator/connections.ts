// S5: connections, docs/preview-design.md Sec.6.5. PURE (CLAUDE.md hard
// rule / preview-design Sec.2).
//
// Per connection command, resolve a NODE SET (which lands are eligible) and
// a PAIRING rule (which pairs among them get a connection attempt), then A*
// a path between each pair's regions and paint terrain along it. All six
// `create_connect_*` commands reduce to "resolve nodes, connect every pair",
// even `create_connect_to_nonplayer_land`, whose pairing is bipartite
// (player x neutral) rather than within one set.
//
// `create_connect_same_land_zones` GROUPS by `.zone` and connects only
// WITHIN each group (`sameZonePairs`), it is NOT a synonym for
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
// facts, worth an actual RMSTEST if this command's exact behaviour ever
// matters for something load-bearing. `preview-design.md` Sec.6.5 carries
// the corrected reading since 2026-08-06.
//
// PATHFINDING: ONE multi-goal Dijkstra per SOURCE land, with a binary
// heap (Sec.11), yielding the cheapest path to every one of that source's
// targets from a single search (`findConnectionPaths`). A connection runs
// between land ORIGINS, "along a path between the origins of lands"
// (guide:1730, restated per command at guide:1759/1774/1792), so the
// search is seeded from the source land's origin tile alone and a target
// counts as reached only when its origin tile closes. An earlier version
// seeded EVERY tile of the source land at cost 0 and accepted the first
// tile of a target land the search closed, which joins the two lands'
// nearest edges: on the tutorial's Golden Hill every road stopped 24 to 36
// tiles short of the TC, one land radius, while in game the road runs up
// to it. The origin is where the TC sits (`max_distance_to_players 0` in
// objects.ts is a band around the same `LandOrigin.x/y`), so the path has
// to cross the player's own land to get there, and its paint goes over
// that land's terrain like any other tile's. A pair-at-a-time A* ran
// C(L,2) searches where this runs L, which
// on ~25 lands is 12x fewer (Sec.15 item 22). There is no heuristic: A*'s
// admissibility guarantee covers only the FIRST goal popped out of a goal
// set, so a heuristic aimed at the nearest remaining target would return
// non-optimal paths to the rest. `grid.terrain` already holds the terrain
// UNDER any cliff (cliffs.ts never writes to `terrain`, only to `cliff`),
// which is exactly Sec.9 item 7's own resolution of "what does the
// pathfinder see under a cliff", no special cliff handling is needed
// here, the grid already reads that way for free.
//
// ACCUMULATE_CONNECTIONS is a standalone stream-state toggle sitting
// directly in the section (`kind: "standalone"`, not an attribute of any
// block), same shape as cliffs.ts's own standalone attributes: it is a
// plain `InstantiatedCommand` in `sections.get("CONNECTION_GENERATION")`,
// encountered in script order alongside the six `create_connect_*` block
// commands. Once seen, every LATER command in the section reads terrain
// state (for both `terrain_cost` and `replace_terrain`'s "from" matching)
// from the output of the commands before it rather than from the state
// frozen at the start of S5, "costs/replacements see prior connections'
// output" (Sec.6.5).
//
// It accumulates BETWEEN commands and NOT WITHIN one, which is why the
// read state is a per-command snapshot rather than the live grid.
// `RMSTEST_43a`/`43b` measured the same map with the flag on and off, four
// generations each: 456 road tiles in all eight, exactly, while a control
// quantity that is random but irrelevant (automatic decoration objects)
// varied normally across the same exports, so every export was a distinct
// generation and the measured quantity had zero spread. Sec.15 item 22.
// The earlier live-grid reading let pair N+1 of one command route over
// pair N's paint; nothing observable depends on it, and freezing per
// command is what makes batching a pure speedup rather than a deviation.
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
import {
  resolveTerrainId,
  tileIndex,
  type TerrainConstantForMasks,
} from "./grid";
import { pushFailure } from "./placement";

// ---------------------------------------------------------------------------
// Attribute reading, duplicated per-file convention (see elevation.ts's
// header for why: small, stage-agnostic, not worth a shared module).
// ---------------------------------------------------------------------------

/**
 * The script's own `#const` table (`InstantiatedScript.symbols`), threaded
 * into every terrain lookup below. Optional on the exported readers purely so
 * their unit tests can keep calling them with two arguments, a script that
 * defines no constants and one whose constants are withheld are the same
 * thing to `resolveTerrainId`.
 */
type Symbols = ReadonlyMap<string, number>;
/** BUG-015's name-to-name `#const`s, travelling with `Symbols` everywhere it goes. */
type Aliases = ReadonlyMap<string, string>;

/**
 * Upper bound for the flat `terrain_cost` table below. Not a claim about
 * which terrains exist, a script can write any id, and ids above this fall
 * back to the Map, only about where a dense array stops paying for itself.
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
    for (let j = i + 1; j < indices.length; j++)
      pairs.push([indices[i], indices[j]]);
  }
  return pairs;
}

/** Bipartite pairs between two disjoint sets, `create_connect_to_nonplayer_land`'s "player x neutral pairs only". */
export function crossPairs(
  a: readonly number[],
  b: readonly number[],
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const i of a) for (const j of b) pairs.push([i, j]);
  return pairs;
}

/**
 * `create_connect_teams_lands`: all pairs WITHIN each canonical team,
 * independently, never across teams, and canonical team 0 (un-teamed)
 * produces no pairs at all, "not the team of everyone left over" (Sec.6.5).
 */
export function teamPairs(
  origins: readonly LandOrigin[],
  teams: InstantiatedScript["teams"],
): Array<[number, number]> {
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

export function landZonePairs(
  origins: readonly LandOrigin[],
  zoneA: number,
  zoneB: number,
): Array<[number, number]> {
  const indices: number[] = [];
  origins.forEach((o, i) => {
    if (o.zone === zoneA || o.zone === zoneB) indices.push(i);
  });
  return allPairs(indices);
}

/**
 * `create_connect_same_land_zones`: all pairs WITHIN each zone,
 * independently, GROUPS by `.zone`, unlike `create_connect_all_lands`,
 * which ignores zone entirely (see this file's header for the correction
 * this represents). By default every `create_land` shares zone -10 while
 * every player land gets its own zone (`playerNumber - 10`, Sec.6.1), so
 * on an unmodified script this connects the neutral lands to each other
 * and does NOT connect player lands to anything, which is the whole point
 * of the command existing as something other than a synonym for
 * `create_connect_all_lands`. Zone -12 ("belongs to no zone", Sec.6.1) is
 * excluded from grouping, mirroring lands.ts's own exemption for it.
 */
export function sameZonePairs(
  origins: readonly LandOrigin[],
): Array<[number, number]> {
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
// Binary min-heap (Sec.11: "A* uses a binary heap"), exported for direct
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

  /** Empties the heap so one instance can serve every search in a command, see PathScratch. */
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
        if (left < n && this.priorities[left] < this.priorities[smallest])
          smallest = left;
        if (right < n && this.priorities[right] < this.priorities[smallest])
          smallest = right;
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
// Pathfinding
// ---------------------------------------------------------------------------

/**
 * The tile index of each land's origin, the endpoint every connection to or
 * from that land uses. Index matches `origins`. `-1` for an origin off the
 * grid, which lands.ts clamps against, so today it cannot happen; kept as a
 * guard because the guide records the engine CRASHING on exactly that case
 * (guide:818, a `land_position` outside the map "will crash the game if
 * your map uses <CONNECTION_GENERATION>"), and the preview's answer to a
 * crash is a `connectionBlocked` failure, never a throw.
 */
export function landOriginTiles(
  grid: TileGrid,
  origins: readonly LandOrigin[],
): number[] {
  const { dim } = grid;
  return origins.map((o) =>
    o.x >= 0 && o.x < dim && o.y >= 0 && o.y < dim
      ? tileIndex(grid, o.x, o.y)
      : -1,
  );
}

/**
 * Which lands can possibly reach which, under ONE command's cost table.
 *
 * Batching the searches per source land is only a saving when a search can
 * stop early, and one unreachable target denies that: the Dijkstra has to
 * exhaust its whole component before it can conclude the target is not in
 * it. `24hr_Caverns.rms` has 46 unreachable pairs out of 468, spread widely
 * enough that nearly every source had one, so batching alone bought it 15%
 * against Pag's 3.7x (measured 2026-08-11).
 *
 * So the unreachable pairs are answered before any search runs, by flooding
 * the passable tiles once per command into connected components and asking
 * whether the two lands' ORIGIN tiles share one. That is the same question
 * the exhausted search was answering, at O(dim^2) for the whole command
 * rather than per pair. One component per land, `-1` when its origin tile
 * is impassable (or off the grid): the guide reads a cost-0 terrain under
 * a land origin as "the connections to that land will not be generated at
 * all" (guide:1937), which makes departing and arriving the same test.
 * The earlier per-tile model needed two sets per land because a land
 * seeded from all its tiles could DEPART over impassable terrain while
 * only being ARRIVED AT through passable tiles; with a single origin tile
 * at both ends that asymmetry has nothing left to describe.
 */
export interface ConnectivityIndex {
  component: Int32Array;
}

export function buildConnectivityIndex(
  grid: TileGrid,
  terrainOf: Uint16Array,
  costOf: (terrainId: number) => number,
  originTiles: readonly number[],
): ConnectivityIndex {
  const { dim } = grid;
  const n = dim * dim;
  const component = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let next = 0;

  for (let start = 0; start < n; start++) {
    if (component[start] !== -1 || costOf(terrainOf[start]) <= 0) continue;
    const id = next++;
    let top = 0;
    stack[top++] = start;
    component[start] = id;
    while (top > 0) {
      const tile = stack[--top];
      const x = tile % dim;
      const y = (tile - x) / dim;
      if (x > 0) top = visit(tile - 1, id, top);
      if (x < dim - 1) top = visit(tile + 1, id, top);
      if (y > 0) top = visit(tile - dim, id, top);
      if (y < dim - 1) top = visit(tile + dim, id, top);
    }
  }

  const index: ConnectivityIndex = {
    component: new Int32Array(originTiles.length).fill(-1),
  };
  originTiles.forEach((tile, land) => {
    if (tile >= 0 && tile < n) index.component[land] = component[tile];
  });
  return index;

  function visit(tile: number, id: number, top: number): number {
    if (component[tile] !== -1 || costOf(terrainOf[tile]) <= 0) return top;
    component[tile] = id;
    stack[top++] = tile;
    return top;
  }
}

/** Whether any route at all could exist from `source` to `target`, the cheap half of the question `findConnectionPaths` answers exactly. */
export function landsCanConnect(
  index: ConnectivityIndex,
  source: number,
  target: number,
): boolean {
  const from = index.component[source];
  const to = index.component[target];
  if (from === undefined || to === undefined) return false;
  return from !== -1 && from === to;
}

/**
 * Reusable working arrays for `findConnectionPaths`, allocated ONCE per
 * `applyConnections` call instead of once per search.
 *
 * The searches are per SOURCE LAND, so a script with many lands still runs
 * dozens of them (`AD4 - Pag - v1.2.rms`: 27 lands x three
 * `create_connect_all_lands` commands). Each was allocating and then clearing
 * three `dim^2` arrays, about half a megabyte of churn and 120,000 writes
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
 * read generation 0 as valid, hence `++scratch.generation` before use, never
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

/**
 * Single-source, multi-goal Dijkstra from `sourceLand`'s ORIGIN tile to the
 * ORIGIN tile of each land in `targetLands` (`originTiles` is indexed by
 * land, see `landOriginTiles`). Returns one path per target that was
 * reached, keyed by land index, as tile indices from origin to origin
 * inclusive. A target simply ABSENT from the returned map has no route,
 * "impassable moat of cost-0 terrain, or unreachable land" (Sec.6.5),
 * which this treats identically: both exhaust the open set without ever
 * closing that origin tile. A source whose own origin is impassable
 * reaches nothing (guide:1937), the same answer the connectivity index
 * gives before this is ever called.
 *
 * One search answers every pair sharing a source, which is the whole point
 * (Sec.15 item 22). The search still expands THROUGH a target's origin
 * after recording it, since a further target may lie beyond it, the
 * per-pair version did the same, having never looked at any land but its
 * own target. It stops early once every target is accounted for, so a
 * source whose targets are all nearby does not pay for the far side of the
 * map; only an unreachable target forces the full component.
 *
 * The goal test is on the TILE, not on `grid.landId`: two lands may share
 * an origin tile (two `land_position 50 50`), and a land's origin can lie
 * under another land's tiles after growth, so "which land is this tile"
 * is not the question. A `Map<tile, land[]>` answers it in O(1) per pop.
 */
export function findConnectionPaths(
  grid: TileGrid,
  terrainOf: Uint16Array,
  costOf: (terrainId: number) => number,
  originTiles: readonly number[],
  sourceLand: number,
  targetLands: readonly number[],
  scratch: PathScratch = createPathScratch(grid.dim),
): Map<number, number[]> {
  const paths = new Map<number, number[]>();
  const { dim } = grid;
  const n = dim * dim;
  const start = originTiles[sourceLand] ?? -1;
  if (start < 0 || start >= n || costOf(terrainOf[start]) <= 0) return paths;

  const goalsByTile = new Map<number, number[]>();
  let wanted = 0;
  for (const land of targetLands) {
    if (land === sourceLand) continue;
    const tile = originTiles[land] ?? -1;
    if (tile < 0 || tile >= n) continue;
    const list = goalsByTile.get(tile);
    if (list) {
      if (list.includes(land)) continue;
      list.push(land);
    } else goalsByTile.set(tile, [land]);
    wanted++;
  }
  if (wanted === 0) return paths;

  const { gScore, gStamp, cameFrom, closedStamp, heap } = scratch;
  const gen = ++scratch.generation;
  heap.clear();
  seed(start);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (closedStamp[current] === gen) continue;
    closedStamp[current] = gen;

    const goals = goalsByTile.get(current);
    if (goals !== undefined) {
      const path: number[] = [];
      let t: number = current;
      // `cameFrom` needs no stamp of its own: every tile on this chain was
      // written during THIS search (a tile only enters the heap when its
      // gScore is written, and the source tile terminates the chain at -1).
      while (t !== -1) {
        path.push(t);
        t = cameFrom[t];
      }
      path.reverse();
      for (const land of goals) paths.set(land, path);
      wanted -= goals.length;
      goalsByTile.delete(current);
      if (wanted === 0) break;
    }

    const x = current % dim;
    const y = (current - x) / dim;
    // The four neighbours are visited inline rather than collected into an
    // array first. That array was allocated once per EXPANSION, and an
    // expansion is per tile per search, so it was tens of millions of
    // throwaway arrays for a fixed set of four numbers.
    if (x > 0) relax(current, current - 1);
    if (x < dim - 1) relax(current, current + 1);
    if (y > 0) relax(current, current - dim);
    if (y < dim - 1) relax(current, current + dim);
  }
  return paths;

  function seed(i: number): void {
    gScore[i] = 0;
    gStamp[i] = gen;
    cameFrom[i] = -1; // terminates the path walk; the array is reused, so a stale value here would run off the end of this search's own chain
    heap.push(i, 0);
  }

  function relax(from: number, neighbor: number): void {
    if (closedStamp[neighbor] === gen) return;
    const cost = costOf(terrainOf[neighbor]);
    if (cost <= 0) return; // "<=0 -> impassable" (Sec.6.5)
    const tentativeG = gScore[from] + cost;
    // A stale gScore from an earlier search reads as Infinity, which is what
    // the per-search `.fill(Infinity)` used to write, see PathScratch.
    if (gStamp[neighbor] === gen && tentativeG >= gScore[neighbor]) return;
    gScore[neighbor] = tentativeG;
    gStamp[neighbor] = gen;
    cameFrom[neighbor] = from;
    heap.push(neighbor, tentativeG);
  }
}

// ---------------------------------------------------------------------------
// Per-command cost/replacement tables (Sec.6.5), each `create_connect_*`
// command declares its OWN, matching language.json's per-command attribute
// list (not a section-wide default).
// ---------------------------------------------------------------------------

/** `terrain_cost Terrain Cost` (repeatable): builds a lookup, unlisted terrains default to 1 (Sec.6.5). Last declaration wins for a repeated terrain, matching Sec.3 rule 10's general policy. */
export function readTerrainCosts(
  cmd: InstantiatedCommand,
  constants: readonly TerrainConstantForMasks[],
  symbols?: Symbols,
  aliases?: Aliases,
): Map<number, number> {
  const costs = new Map<number, number>();
  for (const attr of cmd.attributes.get("terrain_cost") ?? []) {
    const cost = attr.args[1]?.value;
    if (typeof cost !== "number") continue;
    const terrainId = resolveTerrainId(
      constants,
      attr.args[0]?.value,
      symbols,
      aliases,
    );
    if (terrainId !== undefined) costs.set(terrainId, cost);
  }
  return costs;
}

export interface TerrainSize {
  radius: number;
  variance: number;
}

/** `terrain_size Terrain Radius Variance` (repeatable, language.json labels the last two args "width"/"spacing" but Sec.6.5's own prose calls them radius/variance, read positionally, the labels are cosmetic). Absent entry -> radius 1, variance 0 (guide:1958/1960). */
export function readTerrainSizes(
  cmd: InstantiatedCommand,
  constants: readonly TerrainConstantForMasks[],
  symbols?: Symbols,
  aliases?: Aliases,
): Map<number, TerrainSize> {
  const sizes = new Map<number, TerrainSize>();
  for (const attr of cmd.attributes.get("terrain_size") ?? []) {
    const radius = attr.args[1]?.value;
    const variance = attr.args[2]?.value;
    if (typeof radius !== "number") continue;
    const terrainId = resolveTerrainId(
      constants,
      attr.args[0]?.value,
      symbols,
      aliases,
    );
    if (terrainId !== undefined)
      sizes.set(terrainId, {
        radius,
        variance: typeof variance === "number" ? variance : 0,
      });
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
export function readReplacementRules(
  cmd: InstantiatedCommand,
  constants: readonly TerrainConstantForMasks[],
  symbols?: Symbols,
  aliases?: Aliases,
): ReplacementRule[] {
  const rules: ReplacementRule[] = [];
  for (const attr of cmd.attributes.get("replace_terrain") ?? []) {
    const fromId = resolveTerrainId(
      constants,
      attr.args[0]?.value,
      symbols,
      aliases,
    );
    const toId = resolveTerrainId(
      constants,
      attr.args[1]?.value,
      symbols,
      aliases,
    );
    if (fromId !== undefined && toId !== undefined)
      rules.push({ from: fromId, to: toId, order: attr.span.start });
  }
  const defaultAttr = cmd.attributes.get("default_terrain_replacement")?.[0];
  if (defaultAttr) {
    const toId = resolveTerrainId(
      constants,
      defaultAttr.args[0]?.value,
      symbols,
      aliases,
    );
    if (toId !== undefined)
      rules.push({ from: undefined, to: toId, order: defaultAttr.span.start });
  }
  rules.sort((a, b) => a.order - b.order);
  return rules;
}

export function resolveReplacement(
  rules: readonly ReplacementRule[],
  terrainId: number,
): number | undefined {
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
 * Tiles this command has already painted, and how many of the grid's are
 * left. Optional, and purely a saving: a tile's painted value is
 * `resolveReplacement(rules, terrainOf[i])`, and within ONE command both
 * `rules` and `terrainOf` are fixed, so a second disc covering a tile
 * writes the value already there, and covering it a third time is the same
 * no-op again.
 *
 * **This is only true because `terrainOf` is frozen for the command.** If
 * anything ever restores the live-grid read that `accumulate_connections`
 * used to imply, this dedup silently starts dropping real repaints; the
 * two belong together.
 *
 * `24hr_Caverns.rms` is why it exists: `terrain_size DLC_RAINFOREST 420 0`
 * on a 240-wide map is a disc larger than the map, and its
 * `create_connect_all_lands` walks thousands of path tiles over rainforest,
 * each one re-scanning all 57,600 tiles to write what the first already
 * wrote, measured at 3010 ms of painting against 378 ms of searching.
 */
export interface PaintCoverage {
  painted: Uint8Array;
  remaining: number;
}

export function createPaintCoverage(dim: number): PaintCoverage {
  return { painted: new Uint8Array(dim * dim), remaining: dim * dim };
}

/**
 * Per path tile: roll an effective radius (base +/- uniform variance,
 * looked up by the tile's OWN current terrain -- default radius 1,
 * variance 0 when that terrain has no `terrain_size` entry), skip entirely
 * on a negative roll ("negative effective radius -> replace nothing" --
 * guide:1965), else replace every terrain within that many tiles (a
 * Euclidean disc, squared-distance compared -- Sec.8 bans `Math.sqrt`) per
 * `rules`. Reads "from" terrain and radius terrain from `terrainOf` (the
 * caller's per-command snapshot) but WRITES to `grid.terrain` directly and
 * immediately, so a later path tile's disc can overwrite an earlier one's
 * where they overlap -- the same order the path itself was walked in.
 */
export function applyTerrainAlongPath(
  grid: TileGrid,
  path: readonly number[],
  terrainOf: Uint16Array,
  sizes: ReadonlyMap<number, TerrainSize>,
  rules: readonly ReplacementRule[],
  rng: Rng,
  coverage?: PaintCoverage,
): void {
  const { dim } = grid;
  for (const tile of path) {
    // Every tile in the command is already at its final value, so the
    // remaining discs, and the radius rolls that size them, which nothing
    // outside this pair's own substream can observe, are all no-ops.
    if (coverage !== undefined && coverage.remaining === 0) return;
    const terrainHere = terrainOf[tile];
    const size = sizes.get(terrainHere) ?? { radius: 1, variance: 0 };
    const roll =
      size.variance > 0 ? nextInt(rng, -size.variance, size.variance) : 0;
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
        if (coverage !== undefined) {
          if (coverage.painted[i] === 1) continue;
          coverage.painted[i] = 1;
          coverage.remaining--;
        }
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

function resolvePairs(
  cmd: InstantiatedCommand,
  origins: readonly LandOrigin[],
  teams: InstantiatedScript["teams"],
): Array<[number, number]> {
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
      const zoneA =
        typeof cmd.args[0]?.value === "number" ? cmd.args[0].value : 0;
      const zoneB =
        typeof cmd.args[1]?.value === "number" ? cmd.args[1].value : 0;
      return landZonePairs(origins, zoneA, zoneB);
    }
    case "create_connect_to_nonplayer_land":
      return crossPairs(
        playerLandIndices(origins),
        neutralLandIndices(origins),
      );
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
  // One set of working arrays for every search this stage runs, see PathScratch.
  const pathScratch = createPathScratch(grid.dim);
  // Every connection this stage draws starts and ends on an origin tile, and
  // origins are fixed before S5 begins, so this is computed once for the
  // stage rather than per command.
  const originTiles = landOriginTiles(grid, origins);

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
      reports.push({
        commandSpan: cmd.span,
        stage: "S5",
        attempted: 0,
        placed: 0,
        failures: [],
      });
      continue;
    }

    // Frozen for the whole command either way: at the start of S5 by
    // default, at the start of THIS command once `accumulate_connections`
    // has been seen. Accumulation is between commands only (see this file's
    // header), so a snapshot is what the flag means, the copy costs one
    // dim^2 read per accumulating command, and two corpus maps have one.
    const terrainOf = accumulating ? grid.terrain.slice() : startOfS5Terrain;
    const costs = readTerrainCosts(
      cmd,
      constants,
      instantiated.symbols,
      instantiated.aliases,
    );
    const sizes = readTerrainSizes(
      cmd,
      constants,
      instantiated.symbols,
      instantiated.aliases,
    );
    const rules = readReplacementRules(
      cmd,
      constants,
      instantiated.symbols,
      instantiated.aliases,
    );
    // Resolved into a flat table once per command rather than a Map lookup
    // per neighbour expansion. Terrain ids are small and dense (0-130 today),
    // so the table stays tiny; `?? 1` is Sec.6.5's "unlisted terrains cost 1".
    const costTable = new Float64Array(MAX_TERRAIN_ID + 1).fill(1);
    for (const [terrainId, cost] of costs) {
      if (terrainId >= 0 && terrainId <= MAX_TERRAIN_ID)
        costTable[terrainId] = cost;
    }
    const costOf = (terrainId: number): number =>
      terrainId <= MAX_TERRAIN_ID
        ? costTable[terrainId]
        : (costs.get(terrainId) ?? 1);

    const pairs = resolvePairs(cmd, origins, instantiated.teams);
    const failures: PlacementFailure[] = [];
    const coverage = createPaintCoverage(grid.dim); // per command, like `terrainOf` and for the same reason, see PaintCoverage
    let placed = 0;

    // One search per distinct SOURCE land rather than one per pair. The
    // searches all run first, against the one frozen `terrainOf` above, and
    // the painting then walks `pairs` in its original order, so the RNG
    // substream a pair draws, and the order overlapping discs overwrite each
    // other in, are exactly what the pair-at-a-time version produced.
    const targetsBySource = new Map<number, number[]>();
    for (const [a, b] of pairs) {
      const targets = targetsBySource.get(a);
      if (targets) targets.push(b);
      else targetsBySource.set(a, [b]);
    }
    // Pairs with no route at all are answered from the component flood
    // rather than by a search that exhausts its component to find out, see
    // ConnectivityIndex. The flood is rebuilt per command, not hoisted: under
    // `accumulate_connections` a later command's `terrainOf` includes what
    // earlier commands painted, and the cost table is per command anyway.
    // They still report `connectionBlocked` below, from the same "absent
    // from the map" branch a failed search produces.
    const connectivity = buildConnectivityIndex(
      grid,
      terrainOf,
      costOf,
      originTiles,
    );
    const pathsBySource = new Map<number, Map<number, number[]>>();
    for (const [source, targets] of targetsBySource) {
      const reachable = targets.filter((target) =>
        landsCanConnect(connectivity, source, target),
      );
      if (reachable.length === 0) continue;
      pathsBySource.set(
        source,
        findConnectionPaths(
          grid,
          terrainOf,
          costOf,
          originTiles,
          source,
          reachable,
          pathScratch,
        ),
      );
    }

    for (const [a, b] of pairs) {
      const path = pathsBySource.get(a)?.get(b);
      if (path === undefined) {
        pushFailure(failures, {
          bucket: "connectionBlocked",
          commandSpan: cmd.span,
          stage: "S5",
          entity: `connection ${landLabel(origins, a)}-${landLabel(origins, b)}`,
          detail:
            "No passable route exists between these two lands' origins, so this connection was not produced.",
        });
        continue;
      }
      const pairRng = nextSubstream();
      applyTerrainAlongPath(
        grid,
        path,
        terrainOf,
        sizes,
        rules,
        pairRng,
        coverage,
      );
      placed++;
    }

    reports.push({
      commandSpan: cmd.span,
      stage: "S5",
      attempted: pairs.length,
      placed,
      failures,
    });

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
