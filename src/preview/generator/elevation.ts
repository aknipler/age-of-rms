// S2, the elevation stage, docs/preview-design.md Sec.6.2 (rev 10). PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// THIS STAGE REPRODUCES THE GAME TILE FOR TILE. It is a port of the rules in
// preview-design Sec.6.2, which 51 saved DE maps confirm, and `deElevationCliffMaps.test.ts` holds this file to all of
// them. It continues the land stage's stream, so the order of every draw
// matters as much as the rule it serves. One draw out of place moves every
// hill on the map, and every cliff after it.
//
// THE MODEL, in brief.
//   - `create_elevation H` is H LAYERS, run in script order. Layer k raises
//     tiles from exactly k - 1 to k, so heights never add up and repeating a
//     command only fills more of the same heights.
//   - Each layer gathers its candidate tiles into one list, shuffles it with
//     random buckets, seeds its clumps from the shuffled list and grows them
//     round robin from per-clump priority lists.
//   - Tiles near a player land's origin carry a weight. They are never seeds,
//     and growth refuses them at random.
//   - After every layer the whole map is smoothed, so neighbouring tiles end
//     at most one level apart.
//
// TWO ENGINE QUIRKS ARE KEPT ON PURPOSE, because DE has them and the maps
// fail without them. Lists are emptied by forgetting their first entry only,
// so old entries keep their links into the next layer (el7, all four maps fail
// by over 5,000 tiles with clean lists). And the square a new seed takes out
// of the lists has its bottom edge at x + r rather than y + r, which is the
// whole of the "diagonal bias" the earlier statistical model fitted by hand.

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  TileGrid,
} from "./types";
import { resumeDeStream, type DeStream, type DeStreamState } from "./deRandom";
import { f32Div, f32Sqrt } from "./float32";
import {
  NO_LAYER,
  resolveTerrainId,
  type TerrainConstantForMasks,
} from "./grid";
import { pushFailure } from "./placement";

/** Clump lists per layer. `number_of_clumps` above this is read as this. */
const MAX_CLUMPS = 999;
/** Buckets the shuffle deals entries into. */
const BUCKETS = 100;
/** Layer heights stop at 16, however many layers a command has. */
const MAX_LAYER_HEIGHT = 16;
/** Smoothing raises tiles below this height and lowers tiles above it. */
const SMOOTH_LIMIT = 8;
/** A player land's origin weighs on every tile closer than this. */
const AVOID_RADIUS = 13;
/** Weight per tile of closeness. */
const AVOID_WEIGHT = 20;
/** The weight cap, which is also what a refused tile is set to. */
const WEIGHT_CAP = 101;

// ---------------------------------------------------------------------------
// Lists (preview-design Sec.6.2 rule 7)
// ---------------------------------------------------------------------------

/**
 * Doubly linked lists over tile indices, every list sharing one set of link
 * arrays, since an entry is in at most one list at a time. Typed arrays
 * rather than objects with `prev`/`next` fields, so a Ludicrous map's 230,400
 * tiles cost three allocations rather than 230,400.
 *
 * `prev` holds the entry before, `-1` for none, or `-2 - q` when the entry
 * is first in list `q`. That last encoding is what lets a stale entry find
 * the list it once headed, which is the quirk this stage depends on.
 */
class TileLists {
  readonly head: Int32Array;
  readonly prev: Int32Array;
  readonly next: Int32Array;
  readonly cost: Int32Array;

  constructor(listCount: number, tileCount: number) {
    this.head = new Int32Array(listCount).fill(-1);
    this.prev = new Int32Array(tileCount).fill(-1);
    this.next = new Int32Array(tileCount).fill(-1);
    this.cost = new Int32Array(tileCount);
  }

  /** Forget the first entry and touch nothing else, the main list's emptying. */
  forgetHead(q: number): void {
    this.head[q] = -1;
  }

  /** Forget the first entry and clear its link back to the list, the clump lists' emptying. */
  dropHead(q: number): void {
    const h = this.head[q];
    if (h !== -1) {
      this.prev[h] = -1;
      this.head[q] = -1;
    }
  }

  remove(i: number): void {
    const p = this.prev[i];
    const n = this.next[i];
    if (p <= -2) this.head[-2 - p] = n;
    else if (p >= 0) this.next[p] = n;
    if (n !== -1) this.prev[n] = p;
    this.prev[i] = -1;
    this.next[i] = -1;
  }

  pushFront(q: number, i: number): void {
    this.remove(i);
    const n = this.head[q];
    this.prev[i] = -2 - q;
    this.next[i] = n;
    if (n !== -1) this.prev[n] = i;
    this.head[q] = i;
  }

  /** Before the first entry whose cost is at least `c`, so a new entry lands before its equals. */
  insert(q: number, i: number, c: number): void {
    this.remove(i);
    let p = -2 - q;
    let cur = this.head[q];
    while (cur !== -1 && this.cost[cur] < c) {
      p = cur;
      cur = this.next[cur];
    }
    this.prev[i] = p;
    this.next[i] = cur;
    this.cost[i] = c;
    if (p <= -2) this.head[q] = i;
    else this.next[p] = i;
    if (cur !== -1) this.prev[cur] = i;
  }

  pop(q: number): number {
    const h = this.head[q];
    if (h !== -1) this.remove(h);
    return h;
  }
}

/**
 * The shuffle both the elevation and the cliff stage use, two draws per entry.
 * Each pass deals the list into 100 buckets at random, then gathers them back
 * pairwise, alternating between the two buckets of a pair. Exported for
 * `cliffs.ts`, which runs it on its own lists of cells.
 */
export function shuffleList(
  lists: {
    forgetHead(q: number): void;
    pop(q: number): number;
    pushFront(q: number, i: number): void;
  },
  main: number,
  bucket0: number,
  stream: DeStream,
): void {
  for (let b = 0; b < BUCKETS; b++) lists.forgetHead(bucket0 + b);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = lists.pop(main); i !== -1; i = lists.pop(main))
      lists.pushFront(bucket0 + stream.bounded(BUCKETS), i);
    for (let g = 0; g < BUCKETS; g += 4) {
      for (const a of [g, g + 2]) {
        for (;;) {
          let moved = false;
          for (const s of [bucket0 + a, bucket0 + a + 1]) {
            const i = lists.pop(s);
            if (i !== -1) {
              lists.pushFront(main, i);
              moved = true;
            }
          }
          if (!moved) break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Commands become layers (3.1)
// ---------------------------------------------------------------------------

interface Layer {
  /** The command the layer came from, for its report. */
  cmd: InstantiatedCommand;
  height: number;
  /** Tiles grow only from this height. */
  from: number;
  tiles: number;
  clumps: number;
  spacing: number;
  /** -1 when `base_terrain` resolves to nothing, which no tile matches. */
  baseTerrain: number;
  baseLayer: number;
  balanced: boolean;
}

function attr(cmd: InstantiatedCommand, name: string): InstantiatedValue {
  return cmd.attributes.get(name)?.[0]?.args[0]?.value;
}

/** A number attribute, `fallback` when absent. A known symbol with no value reads as 0, as in every other stage (BUG-021). */
function numAttr(
  cmd: InstantiatedCommand,
  name: string,
  fallback: number,
): number {
  const arg = cmd.attributes.get(name)?.[0]?.args[0];
  if (arg === undefined) return fallback;
  if (typeof arg.value === "number") return Math.trunc(arg.value);
  return arg.value === undefined ? 0 : fallback;
}

/** The later of the two scale attributes by source position, since the later one wins. */
function scaleOf(cmd: InstantiatedCommand): "size" | "groups" | undefined {
  const size = cmd.attributes.get("set_scale_by_size")?.[0];
  const groups = cmd.attributes.get("set_scale_by_groups")?.[0];
  if (size && groups)
    return size.span.start > groups.span.start ? "size" : "groups";
  if (size) return "size";
  if (groups) return "groups";
  return undefined;
}

function buildLayers(
  commands: readonly InstantiatedCommand[],
  instantiated: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
  dim: number,
): Layer[] {
  const area = dim * dim;
  const layers: Layer[] = [];
  for (const cmd of commands) {
    if (cmd.name !== "create_elevation") continue;
    const h = cmd.args[0]?.value;
    const count = typeof h === "number" ? Math.trunc(h) : 0;
    // A negative count takes back the last layers made so far (untested).
    if (count < 0) {
      layers.splice(Math.max(0, layers.length + count));
      continue;
    }
    const terrainRef = attr(cmd, "base_terrain") ?? "GRASS";
    const layerRef = attr(cmd, "base_layer");
    const baseTerrain =
      resolveTerrainId(
        constants,
        terrainRef,
        instantiated.symbols,
        instantiated.aliases,
      ) ?? -1;
    const baseLayer =
      layerRef === undefined
        ? NO_LAYER
        : (resolveTerrainId(
            constants,
            layerRef,
            instantiated.symbols,
            instantiated.aliases,
          ) ?? -1);
    let tiles = numAttr(cmd, "number_of_tiles", dim);
    let clumps = Math.min(numAttr(cmd, "number_of_clumps", 1), MAX_CLUMPS);
    // The scaling applies to the final values and truncates. The scaled
    // clump count is not capped at 999 again, only its use is (growLayer).
    const scale = scaleOf(cmd);
    if (scale === "size")
      tiles = Math.min(Math.floor((tiles * area) / 10000), area);
    else if (scale === "groups") clumps = Math.floor((clumps * area) / 10000);
    // `spacing` applies to layers 2 and up, and only when positive. Layer 1
    // always keeps a spacing of 2.
    const spacing = numAttr(cmd, "spacing", 0);
    for (let k = 1; k <= count; k++) {
      layers.push({
        cmd,
        height: Math.min(k, MAX_LAYER_HEIGHT),
        from: k - 1,
        tiles,
        clumps,
        spacing: k === 1 ? 2 : spacing > 0 ? spacing : 1,
        baseTerrain,
        baseLayer,
        balanced: cmd.attributes.has("enable_balanced_elevation"),
      });
    }
  }
  return layers;
}

// ---------------------------------------------------------------------------
// The avoidance weight (3.2)
// ---------------------------------------------------------------------------

/**
 * Every tile's weight from the player lands' origins. Only tiles within 13 of
 * an origin can carry any, so each origin touches its own 27 x 27 box rather
 * than the whole map, and the distances in that box come from one table.
 */
function buildWeights(origins: readonly LandOrigin[], dim: number): Uint8Array {
  const weight = new Uint8Array(dim * dim);
  const seen = new Set<number>();
  const span = AVOID_RADIUS * 2 + 1;
  const table = new Int32Array(span * span);
  for (let dy = -AVOID_RADIUS; dy <= AVOID_RADIUS; dy++)
    for (let dx = -AVOID_RADIUS; dx <= AVOID_RADIUS; dx++) {
      const d = Math.floor(f32Sqrt(dx * dx + dy * dy));
      table[(dy + AVOID_RADIUS) * span + dx + AVOID_RADIUS] = Math.max(
        0,
        AVOID_WEIGHT * (AVOID_RADIUS - d),
      );
    }
  // Summed in a wider array and capped once at the end, as the game sums
  // every origin's share before it caps.
  const sum = new Int32Array(dim * dim);
  for (const origin of origins) {
    if (origin.player === undefined) continue;
    const key = origin.y * dim + origin.x;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let dy = -AVOID_RADIUS; dy <= AVOID_RADIUS; dy++) {
      const y = origin.y + dy;
      if (y < 0 || y >= dim) continue;
      for (let dx = -AVOID_RADIUS; dx <= AVOID_RADIUS; dx++) {
        const x = origin.x + dx;
        if (x < 0 || x >= dim) continue;
        sum[y * dim + x] +=
          table[(dy + AVOID_RADIUS) * span + dx + AVOID_RADIUS];
      }
    }
  }
  for (let i = 0; i < sum.length; i++) weight[i] = Math.min(sum[i], WEIGHT_CAP);
  return weight;
}

// ---------------------------------------------------------------------------
// One layer (3.3, 3.4)
// ---------------------------------------------------------------------------

const MAIN = 0;
const CLUMP0 = 1;
const BUCKET0 = CLUMP0 + MAX_CLUMPS;
const LIST_COUNT = BUCKET0 + BUCKETS;

/** What one layer did, for its command's report. */
interface LayerOutcome {
  seeded: number;
  clumps: number;
}

function growLayer(
  layer: Layer,
  grid: TileGrid,
  weight: Uint8Array,
  lists: TileLists,
  stream: DeStream,
): LayerOutcome {
  const { dim, terrain, elevation } = grid;
  const layerGrid = grid.layer;
  const clumps = Math.min(layer.clumps, MAX_CLUMPS);
  lists.forgetHead(MAIN);
  for (let q = CLUMP0; q < CLUMP0 + clumps; q++) lists.forgetHead(q);

  // 1. Candidates, row by row, each to the front of the main list.
  for (let i = 0; i < dim * dim; i++)
    if (
      terrain[i] === layer.baseTerrain &&
      elevation[i] === layer.from &&
      layerGrid[i] === layer.baseLayer &&
      weight[i] === 0
    )
      lists.pushFront(MAIN, i);
  // 2. The shuffle.
  shuffleList(lists, MAIN, BUCKET0, stream);

  /** True when no tile in the square of radius `r` is off the base terrain, off the base layer or below the layer's start. */
  const spacingOk = (x: number, y: number, r: number): boolean => {
    for (let ny = Math.max(y - r, 0); ny <= Math.min(y + r, dim - 1); ny++)
      for (let nx = Math.max(x - r, 0); nx <= Math.min(x + r, dim - 1); nx++) {
        const j = ny * dim + nx;
        if (
          terrain[j] !== layer.baseTerrain ||
          layerGrid[j] !== layer.baseLayer ||
          elevation[j] < layer.from
        )
          return false;
      }
    return true;
  };

  // 3. Seeds. The root is taken in single precision, as the game does.
  const unlink = Math.max(
    Math.floor(
      Math.floor(f32Sqrt(f32Div(layer.tiles, Math.max(layer.clumps, 1)))) / 2,
    ),
    2,
  );
  let placed = 0;
  let seeded = 0;
  while (seeded < clumps) {
    const i = lists.pop(MAIN);
    if (i === -1) break;
    const x = i % dim;
    const y = (i - x) / dim;
    if (weight[i] !== 0 || !spacingOk(x, y, layer.spacing & 0xff)) continue;
    if (!layer.balanced) {
      // The quirk. The bottom edge is the clipped right edge, x + r, not
      // y + r, so a seed far below the diagonal takes nothing out.
      const x0 = Math.max(x - unlink, 0);
      const x1 = Math.min(x + unlink, dim - 1);
      const y0 = Math.max(y - unlink, 0);
      const y1 = Math.min(x1, dim - 1);
      for (let ny = y0; ny <= y1; ny++)
        for (let nx = x0; nx <= x1; nx++) lists.remove(ny * dim + nx);
    }
    elevation[i] = layer.height;
    placed++;
    const q = CLUMP0 + seeded;
    // Left, up, right, down, each before the last, so the list starts with
    // the lower neighbour.
    if (x > 0) lists.insert(q, i - 1, 0);
    if (y > 0) lists.insert(q, i - dim, 0);
    if (x + 1 < dim) lists.insert(q, i + 1, 0);
    if (y + 1 < dim) lists.insert(q, i + dim, 0);
    seeded++;
  }

  // 4. Growth, round robin over the clumps until the budget is met or a whole
  // round pops nothing.
  while (placed < layer.tiles) {
    let popped = false;
    for (let c = 0; c < clumps && placed < layer.tiles; c++) {
      const q = CLUMP0 + c;
      const i = lists.pop(q);
      if (i === -1) continue;
      popped = true;
      const x = i % dim;
      const y = (i - x) / dim;
      if (weight[i] > stream.bounded(100)) {
        weight[i] = WEIGHT_CAP;
        continue;
      }
      if (!spacingOk(x, y, layer.spacing)) continue;
      let n = 0;
      for (let ny = Math.max(y - 2, 0); ny <= Math.min(y + 2, dim - 1); ny++)
        for (let nx = Math.max(x - 2, 0); nx <= Math.min(x + 2, dim - 1); nx++)
          if (elevation[ny * dim + nx] === layer.height) n++;
      if (n === 0 || elevation[i] !== layer.from) continue;
      elevation[i] = layer.height;
      placed++;
      const base = 250 - 15 * n;
      if (x > 0 && elevation[i - 1] === layer.from)
        lists.insert(q, i - 1, stream.bounded(100) + base);
      if (x + 1 < dim && elevation[i + 1] === layer.from)
        lists.insert(q, i + 1, stream.bounded(100) + base);
      if (y > 0 && elevation[i - dim] === layer.from)
        lists.insert(q, i - dim, stream.bounded(100) + base);
      if (y + 1 < dim && elevation[i + dim] === layer.from)
        lists.insert(q, i + dim, stream.bounded(100) + base);
    }
    if (!popped) break;
  }
  for (let q = CLUMP0; q < CLUMP0 + clumps; q++) lists.dropHead(q);
  return { seeded, clumps };
}

// ---------------------------------------------------------------------------
// Smoothing (3.5), no draws
// ---------------------------------------------------------------------------

/** Lowers every higher tile among the 8 neighbours to `h`. True when one changed. */
function lowerHigher(
  e: Uint8Array,
  dim: number,
  x: number,
  y: number,
  h: number,
): boolean {
  let changed = false;
  for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, dim - 1); ny++)
    for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, dim - 1); nx++) {
      const j = ny * dim + nx;
      if (e[j] > h) {
        e[j] = h;
        changed = true;
      }
    }
  return changed;
}

/** A pinched tile goes up a level below 8, and pulls its higher neighbours down to it from 8 up. */
function settle(e: Uint8Array, dim: number, x: number, y: number): boolean {
  const i = y * dim + x;
  if (e[i] < SMOOTH_LIMIT) {
    e[i]++;
    return true;
  }
  return lowerHigher(e, dim, x, y, e[i]);
}

function pinchPass(e: Uint8Array, dim: number): boolean {
  let changed = false;
  for (let y = 0; y < dim; y++)
    for (let x = 0; x < dim; x++) {
      const i = y * dim + x;
      const h = e[i];
      const up = y > 0 && e[i - dim] > h;
      const down = y + 1 < dim && e[i + dim] > h;
      const left = x > 0 && e[i - 1] > h;
      const right = x + 1 < dim && e[i + 1] > h;
      if ((up && down) || (left && right))
        changed = settle(e, dim, x, y) || changed;
    }
  return changed;
}

/**
 * The land cleanup's diagonal patterns (lands.ts `cleanTerrainAgainst`, pass
 * 1) with "is higher" in place of "is the reference terrain".
 */
function topologyPass(e: Uint8Array, dim: number): boolean {
  let changed = false;
  const last = dim - 1;
  for (let y = 0; y < dim; y++)
    for (let x = 0; x < dim; x++) {
      const i = y * dim + x;
      const h = e[i];
      const up = y > 0 && e[i - dim] > h;
      const down = y < last && e[i + dim] > h;
      const left = x > 0 && e[i - 1] > h;
      const right = x < last && e[i + 1] > h;
      const upLeft = y > 0 && x > 0 && e[i - dim - 1] > h;
      const upRight = y > 0 && x < last && e[i - dim + 1] > h;
      const downLeft = y < last && x > 0 && e[i + dim - 1] > h;
      const downRight = y < last && x < last && e[i + dim + 1] > h;
      const fill =
        (upLeft &&
          ((upRight && !up) ||
            (right && !upRight) ||
            (downLeft && !left) ||
            (down && !downLeft) ||
            (downRight && !down && !right))) ||
        (upRight &&
          ((downRight && !right) ||
            (down && !downRight) ||
            (upLeft && !up) ||
            (left && !upLeft) ||
            (downLeft && !left && !down))) ||
        (downRight &&
          ((downLeft && !down) ||
            (left && !downLeft) ||
            (upRight && !right) ||
            (up && !upRight) ||
            (upLeft && !left && !up))) ||
        (downLeft &&
          ((upLeft && !left) ||
            (up && !upLeft) ||
            (downRight && !down) ||
            (right && !downRight) ||
            (upRight && !right && !up)));
      if (fill) changed = settle(e, dim, x, y) || changed;
    }
  return changed;
}

function slopePass(e: Uint8Array, dim: number): boolean {
  let changed = false;
  for (let y = 0; y < dim; y++)
    for (let x = 0; x < dim; x++) {
      const i = y * dim + x;
      const h = e[i];
      if (h === SMOOTH_LIMIT) continue;
      const rising = h < SMOOTH_LIMIT;
      const target = rising ? h + 1 : h - 1;
      let steep = false;
      for (
        let ny = Math.max(y - 1, 0);
        ny <= Math.min(y + 1, dim - 1) && !steep;
        ny++
      )
        for (
          let nx = Math.max(x - 1, 0);
          nx <= Math.min(x + 1, dim - 1);
          nx++
        ) {
          const v = e[ny * dim + nx];
          if (rising ? v > target : v < target) {
            steep = true;
            break;
          }
        }
      if (steep) {
        e[i] = target;
        changed = true;
      }
    }
  return changed;
}

/**
 * The whole-map smoothing after every layer. Every pass changes tiles in
 * place, so a tile sees the changes of the tiles before it. Exported for its
 * own tests.
 */
export function smoothElevation(e: Uint8Array, dim: number): void {
  for (;;) {
    while (pinchPass(e, dim));
    const topology = topologyPass(e, dim);
    const slope = slopePass(e, dim);
    if (!topology && !slope) return;
  }
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface ElevationResult {
  reports: CommandReport[];
  /** The game's stream after this stage, where the cliff stage starts. */
  stream: DeStreamState;
}

/**
 * Sec.6.2, rev 10. Mutates `grid.elevation` and returns one `CommandReport`
 * per `create_elevation` command, plus the stream.
 *
 * With no `<ELEVATION_GENERATION>` section nothing happens and no draw is
 * taken. In particular the land heights stay as painted, sheer steps
 * included (lh2). A present section burns one draw first, then runs every
 * layer in script order, or smooths once when it has none.
 */
export function applyElevation(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  streamState: DeStreamState,
): ElevationResult {
  const commands = instantiated.sections.get("ELEVATION_GENERATION");
  if (commands === undefined) return { reports: [], stream: streamState };
  const { dim } = grid;
  const stream = resumeDeStream(streamState);
  stream.raw(); // the burned draw, one per section, purpose unknown

  const layers = buildLayers(commands, instantiated, constants, dim);
  const weight = buildWeights(origins, dim);
  // One set of lists for the whole section, so stale links survive from one
  // layer to the next, as the game's do.
  const lists = new TileLists(LIST_COUNT, dim * dim);
  if (layers.length === 0) smoothElevation(grid.elevation, dim);

  const outcomes = new Map<InstantiatedCommand, LayerOutcome[]>();
  for (const layer of layers) {
    const outcome = growLayer(layer, grid, weight, lists, stream);
    smoothElevation(grid.elevation, dim);
    const list = outcomes.get(layer.cmd) ?? [];
    list.push(outcome);
    outcomes.set(layer.cmd, list);
  }

  const reports: CommandReport[] = [];
  for (const cmd of commands) {
    if (cmd.name !== "create_elevation") continue;
    const done = outcomes.get(cmd) ?? [];
    const failures: PlacementFailure[] = [];
    const terrainRef = attr(cmd, "base_terrain") ?? "GRASS";
    if (
      done.length > 0 &&
      resolveTerrainId(
        constants,
        terrainRef,
        instantiated.symbols,
        instantiated.aliases,
      ) === undefined
    )
      pushFailure(failures, {
        bucket: "terrainAbsent",
        commandSpan: cmd.span,
        stage: "S2",
        entity: "elevation layer",
        detail: `This map's reference data doesn't know the terrain "${String(terrainRef)}", so no tile could be matched to it.`,
      });
    done.forEach((outcome, k) => {
      if (outcome.seeded < outcome.clumps)
        pushFailure(failures, {
          bucket: "noValidTiles",
          commandSpan: cmd.span,
          stage: "S2",
          entity: `elevation layer ${k + 1}`,
          detail: `Height ${k + 1} found room for ${outcome.seeded} of its ${outcome.clumps} clumps. A clump needs a tile at height ${k} on its base terrain, clear of player lands, with its spacing all on that terrain.`,
          data: { seeded: outcome.seeded, clumps: outcome.clumps },
        });
    });
    reports.push({
      commandSpan: cmd.span,
      stage: "S2",
      attempted: done.reduce((sum, o) => sum + o.clumps, 0),
      placed: done.reduce((sum, o) => sum + o.seeded, 0),
      failures,
    });
  }
  return { reports, stream: stream.state() };
}
