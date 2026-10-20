// S3, the cliff stage, docs/preview-design.md Sec.6.3 (rev 10). PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// THIS STAGE REPRODUCES THE GAME TILE FOR TILE. It is a port of the rules in
// preview-design Sec.6.3, which black-box tests against saved DE maps
// established, and `deElevationCliffMaps.test.ts` holds it to every cliff object of 51 saved DE
// maps, by type, position and facing. It continues the stream where the
// elevation stage left it.
//
// THE MODEL, in brief.
//   - The map is cut into 3 x 3 cells. A cell is a candidate when its nine
//     tiles share one height and none is water-like. Cells near water, near
//     any land's origin, or with no candidate beside them are cleared.
//   - The candidates are shuffled, and each cliff starts at the next one
//     still standing, then walks from cell to cell at the start's height,
//     turning at random by `cliff_curliness`.
//   - The walk is painted from its end back to its start. A line of
//     terrain 16 runs through the cell centres, a cliff piece goes on every
//     cell, and the cells around the walk are cleared for the next cliff.
//   - Water beside a line is repaired as it is painted, which can beach the
//     coast near a cliff and even leave a lone terrain-70 tile.
//
// Terrain 16 does not last. At the end of the terrain stage every line tile
// gets back the terrain it had when a cliff first touched it, so a finished
// map has none (`finishTerrainStage`, below, which `index.ts` calls after S4).
// `grid.cliff` keeps the line tiles marked for the renderer and for the later
// stages that keep objects off cliffs.
//
// `<CLIFF_GENERATION>` has no `create_cliff` command. The section holds only
// standalone attributes, so they are folded into one settings record, the last
// one written winning, and the section gets one `CommandReport`. The section's
// presence is what makes cliffs. A bare header makes the default ones (cl5).

import type {
  CliffPiece,
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  SimulationNote,
  TileGrid,
} from "./types";
import { resumeDeStream, type DeStream, type DeStreamState } from "./deRandom";
import { NO_LAYER, type TerrainConstantForMasks } from "./grid";
import { cleanTerrainAgainst, type CleanupListener } from "./lands";
import { pushFailure } from "./placement";
import { shuffleList } from "./elevation";
import {
  CLASS_CLIFF_BLOCKING,
  CLASS_FROZEN,
  CLASS_SHALLOWS,
  CLASS_SHORE,
  CLASS_WATER,
  classOf,
  decorationDrawsOf,
  terrainClassTable,
  type TerrainClassTable,
} from "./terrainClass";

// ---------------------------------------------------------------------------
// Settings (5.1)
// ---------------------------------------------------------------------------

/** Defaults as measured on a bare header (cl5, five maps at three sizes). language.json carries the same values. */
const DEFAULT_MIN_CLIFFS = 3;
/** Exclusive, so the default asks for 3 to 8 cliffs. */
const DEFAULT_MAX_CLIFFS = 9;
const DEFAULT_MIN_LENGTH = 5;
/** Exclusive as well, so lengths run 5 to 8. */
const DEFAULT_MAX_LENGTH = 9;
const DEFAULT_CURLINESS = 36;
/** In cells of 3 x 3 tiles, as is the water distance. */
const DEFAULT_MIN_DISTANCE_CLIFFS = 2;
const DEFAULT_MIN_TERRAIN_DISTANCE = 2;

/** A cliff shorter than this spends nothing more and makes nothing (RMSTEST_45). */
const MIN_LENGTH_FOR_CLIFFS_TO_APPEAR = 3;
/** Cells within this many cells of any land's origin are cleared. */
const LAND_CLEARANCE = 7;
/** The game cannot make more cliffs than this. A count above it means min is above max. */
const MAX_CLIFF_COUNT = 65535;

/** Each style is nine consecutive object ids from its base, by `cliff_type` (5.1). */
const STYLE_BASE = [264, 1849, 1858, 2178, 2069, 2651];
/** The cliff line's terrain while the terrain stage runs. */
export const CLIFF_LINE_TERRAIN = 16;
/** The water repair's first marker, a terrain no script names. */
const REPAIR_MARKER = 70;
const BEACH = 2;
const ICY_SHORE = 37;
/** Shore water excludes this one water terrain by id (5.4). */
const NOT_SHORE_WATER = 15;

const ZERO_SPAN = { start: 0, end: 0 };

function lastByName(
  commands: readonly InstantiatedCommand[],
  name: string,
): InstantiatedCommand | undefined {
  let found: InstantiatedCommand | undefined;
  for (const cmd of commands) if (cmd.name === name) found = cmd;
  return found;
}

function numArg(
  cmd: InstantiatedCommand | undefined,
  fallback: number,
): number {
  const v: InstantiatedValue = cmd?.args[0]?.value;
  return typeof v === "number" ? Math.trunc(v) : fallback;
}

export interface CliffSettings {
  minCliffs: number;
  maxCliffs: number;
  minLength: number;
  maxLength: number;
  curliness: number;
  minDistanceCliffs: number;
  minTerrainDistance: number;
  /** `cliff_type`, an index into the six styles, 0 when absent or out of range. */
  cliffType: number;
  /** Commands whose span identifies the min/max-cliffs authoring mistake, if any, kept apart from the plain numbers so the note can point at the right line. */
  minCliffsCmd?: InstantiatedCommand;
  maxCliffsCmd?: InstantiatedCommand;
  minLengthCmd?: InstantiatedCommand;
}

/** `cliff_type` by number or by its CT_ constant. */
function resolveCliffType(
  value: InstantiatedValue,
  constants: readonly TerrainConstantForMasks[],
  symbols: ReadonlyMap<string, number>,
): number {
  let id: number | undefined;
  if (typeof value === "number") id = Math.trunc(value);
  else if (typeof value === "string") {
    const row = constants.find(
      (c) => c.category === "cliffType" && c.rmsConstant === value,
    );
    id = row?.constId ?? symbols.get(value);
  }
  return id !== undefined && id >= 0 && id < STYLE_BASE.length ? id : 0;
}

/** Folds every standalone CLIFF_GENERATION command into one settings record, the last one written winning. */
export function resolveCliffSettings(
  commands: readonly InstantiatedCommand[],
  constants: readonly TerrainConstantForMasks[] = [],
  symbols: ReadonlyMap<string, number> = new Map(),
): CliffSettings {
  const minCliffsCmd = lastByName(commands, "min_number_of_cliffs");
  const maxCliffsCmd = lastByName(commands, "max_number_of_cliffs");
  const minLengthCmd = lastByName(commands, "min_length_of_cliff");
  return {
    minCliffs: numArg(minCliffsCmd, DEFAULT_MIN_CLIFFS),
    maxCliffs: numArg(maxCliffsCmd, DEFAULT_MAX_CLIFFS),
    minLength: numArg(minLengthCmd, DEFAULT_MIN_LENGTH),
    maxLength: numArg(
      lastByName(commands, "max_length_of_cliff"),
      DEFAULT_MAX_LENGTH,
    ),
    curliness: numArg(
      lastByName(commands, "cliff_curliness"),
      DEFAULT_CURLINESS,
    ),
    minDistanceCliffs: numArg(
      lastByName(commands, "min_distance_cliffs"),
      DEFAULT_MIN_DISTANCE_CLIFFS,
    ),
    minTerrainDistance: numArg(
      lastByName(commands, "min_terrain_distance"),
      DEFAULT_MIN_TERRAIN_DISTANCE,
    ),
    cliffType: resolveCliffType(
      lastByName(commands, "cliff_type")?.args[0]?.value,
      constants,
      symbols,
    ),
    minCliffsCmd,
    maxCliffsCmd,
    minLengthCmd,
  };
}

/**
 * `min + draw(max - min)`, the difference wrapping as a 32-bit unsigned value
 * and the sum as a signed one, the game's arithmetic. So max is exclusive,
 * and min above max asks for an enormous count.
 */
function rangeDraw(stream: DeStream, min: number, max: number): number {
  return (min + stream.bounded((max - min) >>> 0)) | 0;
}

// ---------------------------------------------------------------------------
// Cell lists. Unlike the elevation stage's, an entry knows its list and
// taking it out unlinks it completely (the cliff probes cannot tell the
// difference, but this is how the write-up reads the game).
// ---------------------------------------------------------------------------

class CellLists {
  readonly head: Int32Array;
  readonly list: Int32Array;
  readonly prev: Int32Array;
  readonly next: Int32Array;

  constructor(listCount: number, cellCount: number) {
    this.head = new Int32Array(listCount).fill(-1);
    this.list = new Int32Array(cellCount).fill(-1);
    this.prev = new Int32Array(cellCount).fill(-1);
    this.next = new Int32Array(cellCount).fill(-1);
  }

  forgetHead(q: number): void {
    this.head[q] = -1;
  }

  remove(i: number): void {
    const q = this.list[i];
    if (q === -1) return;
    const p = this.prev[i];
    const n = this.next[i];
    if (p !== -1) this.next[p] = n;
    else this.head[q] = n;
    if (n !== -1) this.prev[n] = p;
    this.list[i] = this.prev[i] = this.next[i] = -1;
  }

  pushFront(q: number, i: number): void {
    this.remove(i);
    const n = this.head[q];
    this.list[i] = q;
    this.prev[i] = -1;
    this.next[i] = n;
    if (n !== -1) this.prev[n] = i;
    this.head[q] = i;
  }

  pop(q: number): number {
    const h = this.head[q];
    if (h !== -1) this.remove(h);
    return h;
  }
}

// ---------------------------------------------------------------------------
// Pieces (5.5)
// ---------------------------------------------------------------------------

/**
 * The shape table, as measured (every row occurs in the DE maps, and all
 * 1,126 cliff objects agree). Legs are [+x, +y, -x, -y]. Then the object
 * slot added to the style's base, the offset inside the cell in 1/256 tile,
 * the facing, and the second look's facing for the four shapes that have one.
 */
const SHAPES: ReadonlyArray<
  readonly [readonly number[], number, number, number, number, number?]
> = [
  [[-1, 0, -1, 0], 2, 384, 384, 11, 10],
  [[-1, 0, 0, -1], 7, 512, 256, 13],
  [[-1, 0, 0, 0], 2, 384, 384, 20],
  [[-1, 1, 0, 0], 5, 384, 512, 0],
  [[0, -1, -1, 0], 7, 256, 512, 9],
  [[0, -1, 0, -1], 1, 384, 384, 8, 7],
  [[0, -1, 0, 0], 1, 384, 384, 22],
  [[0, 0, -1, 0], 2, 384, 384, 21],
  [[0, 0, -1, 1], 5, 384, 256, 14],
  [[0, 0, 0, -1], 1, 384, 384, 23],
  [[0, 0, 0, 1], 0, 384, 384, 19],
  [[0, 0, 1, -1], 3, 256, 384, 6],
  [[0, 0, 1, 0], 0, 384, 384, 17],
  [[0, 1, 0, 0], 0, 384, 384, 18],
  [[0, 1, 0, 1], 0, 384, 384, 1, 2],
  [[0, 1, 1, 0], 0, 384, 384, 15],
  [[1, -1, 0, 0], 3, 512, 384, 12],
  [[1, 0, 0, 0], 0, 384, 384, 16],
  [[1, 0, 0, 1], 0, 384, 384, 3],
  [[1, 0, 1, 0], 0, 384, 384, 4, 5],
];

/** Legs to a lookup key. Each leg is -1, 0 or 1, so base 3 packs four into 0..80. */
function legKey(legs: readonly number[]): number {
  return (
    (legs[0] + 1) * 27 + (legs[1] + 1) * 9 + (legs[2] + 1) * 3 + legs[3] + 1
  );
}

const SHAPE_BY_KEY = new Map(SHAPES.map((shape) => [legKey(shape[0]), shape]));

/** +x, +y, -x, -y, the order of the legs. */
const LEG_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

class Pieces {
  /** By cell key `cy * cw + cx`. A Map keeps insertion order, which the result list reads. */
  readonly at = new Map<number, { legs: number[]; piece: CliffPiece }>();

  constructor(
    private readonly stream: DeStream,
    private readonly base: number,
    private readonly cw: number,
  ) {}

  /** No piece when every leg is 0. A shape with two looks takes one raw draw, an odd value picking the second. */
  build(cx: number, cy: number, legs: number[]): void {
    if (legs.every((leg) => leg === 0)) return;
    const shape = SHAPE_BY_KEY.get(legKey(legs));
    if (shape === undefined) return; // no such shape in the game's table, never seen
    const [, slot, ox, oy, facing, second] = shape;
    const look =
      second !== undefined && (this.stream.raw() & 1) === 1 ? second : facing;
    this.at.set(cy * this.cw + cx, {
      legs,
      piece: {
        cellX: cx,
        cellY: cy,
        objectId: this.base + slot,
        x: cx * 3 + ox / 256,
        y: cy * 3 + oy / 256,
        facing: look,
      },
    });
  }

  take(cx: number, cy: number): number[] | undefined {
    const key = cy * this.cw + cx;
    const found = this.at.get(key);
    if (found === undefined) return undefined;
    this.at.delete(key);
    return found.legs;
  }

  /**
   * Joins cell `from` to its 4-neighbour `to`. `incoming` is the leg the walk
   * came in by, undefined on the path's first join. Returns the leg the next
   * join comes in by.
   */
  join(
    fx: number,
    fy: number,
    tx: number,
    ty: number,
    incoming: number | undefined,
  ): number {
    const leg = LEG_DIRS.findIndex(
      ([dx, dy]) => fx + dx === tx && fy + dy === ty,
    );
    const legs = this.take(fx, fy) ?? [0, 0, 0, 0];
    if (incoming !== undefined) {
      for (let side = 0; side < 4; side++) {
        if (side === incoming) continue;
        legs[side] = 0;
        const nx = fx + LEG_DIRS[side][0];
        const ny = fy + LEG_DIRS[side][1];
        if (nx < 0 || ny < 0) continue;
        const theirs = this.take(nx, ny);
        if (theirs === undefined) continue;
        theirs[(side + 2) % 4] = 0;
        this.build(nx, ny, theirs);
      }
    }
    legs[leg] = 1;
    if (!SHAPE_BY_KEY.has(legKey(legs))) legs[leg] = -1;
    const back = (leg + 2) % 4;
    const end = [0, 0, 0, 0];
    end[back] = legs[leg];
    this.build(fx, fy, legs);
    this.build(tx, ty, end);
    return back;
  }
}

// ---------------------------------------------------------------------------
// Water repair (5.4)
// ---------------------------------------------------------------------------

/**
 * The cleanup's bridging patterns on the 8 neighbours (lands.ts
 * `cleanTerrainAgainst`), straight in the first pass and diagonal in the
 * second. Exported for its own test.
 */
export function bridges(nb: readonly boolean[], diagonal: boolean): boolean {
  const [n, ne, e, se, s, sw, w, nw] = nb;
  if (!diagonal) return (n && s) || (w && e);
  return (
    (nw &&
      ((ne && !n) ||
        (e && !ne) ||
        (sw && !w) ||
        (s && !sw) ||
        (se && !s && !e))) ||
    (ne &&
      ((nw && !n) ||
        (w && !nw) ||
        (se && !e) ||
        (s && !se) ||
        (sw && !w && !s))) ||
    (se &&
      ((ne && !e) ||
        (n && !ne) ||
        (sw && !s) ||
        (w && !sw) ||
        (nw && !w && !n))) ||
    (sw &&
      ((nw && !w) ||
        (n && !nw) ||
        (se && !s) ||
        (e && !se) ||
        (ne && !e && !n)))
  );
}

/** N, NE, E, SE, S, SW, W, NW, with north at -y. */
const NEIGH8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
/** The order a bridging tile's water neighbours are rewritten in, NW first. */
const REWRITE_ORDER = [7, 0, 1, 2, 3, 4, 5, 6];

function repairWater(
  grid: TileGrid,
  table: TerrainClassTable,
  box: readonly [number, number, number, number],
  marker: number,
  stream: DeStream,
): void {
  const { dim, terrain, layer } = grid;
  const cls = (i: number): number => classOf(table, terrain[i]);
  let [left, top, right, bottom] = [
    Math.max(box[0], 0),
    Math.max(box[1], 0),
    Math.min(box[2], dim - 1),
    Math.min(box[3], dim - 1),
  ];
  const water = new Array<boolean>(8);
  let previous = 0;
  let repeated = 0;
  for (;;) {
    left = Math.max(left - 1, 0);
    top = Math.max(top - 1, 0);
    right = Math.min(right + 1, dim - 1);
    bottom = Math.min(bottom + 1, dim - 1);
    let changes = 0;
    for (const diagonal of [false, true])
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          if (cls(y * dim + x) & CLASS_WATER) continue;
          for (let o = 0; o < 8; o++) {
            const nx = x + NEIGH8[o][0];
            const ny = y + NEIGH8[o][1];
            water[o] =
              nx >= 0 &&
              nx < dim &&
              ny >= 0 &&
              ny < dim &&
              (cls(ny * dim + nx) & CLASS_WATER) !== 0;
          }
          if (!bridges(water, diagonal)) continue;
          for (const o of REWRITE_ORDER) {
            if (!water[o]) continue;
            const j = (y + NEIGH8[o][1]) * dim + x + NEIGH8[o][0];
            terrain[j] = marker;
            layer[j] = NO_LAYER;
            for (let d = decorationDrawsOf(table, marker); d > 0; d--)
              stream.raw();
          }
          changes++;
        }
    // The sweeps stop on a sweep with no change, or the fifth time a sweep
    // repeats the count of the one before, those five not necessarily in a row.
    if (changes === previous) repeated++;
    previous = changes;
    if (changes === 0 || repeated >= 5) break;
  }

  // The shore pass, once over the final box, in place.
  const shoreWater = (j: number): boolean => {
    const c = cls(j);
    return (
      (c & CLASS_WATER) !== 0 &&
      (c & CLASS_SHALLOWS) === 0 &&
      terrain[j] !== NOT_SHORE_WATER
    );
  };
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const i = y * dim + x;
      const c = cls(i);
      let nearWater = false;
      let nearFrozen = false;
      for (const [dx, dy] of NEIGH8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue;
        const j = ny * dim + nx;
        nearWater ||= shoreWater(j);
        nearFrozen ||= (cls(j) & CLASS_FROZEN) !== 0;
      }
      const paint =
        c & CLASS_SHALLOWS
          ? nearWater
          : c & CLASS_SHORE
            ? nearFrozen
            : (c & CLASS_WATER) === 0 && nearWater;
      if (!paint) continue;
      layer[i] = NO_LAYER;
      terrain[i] =
        c & (CLASS_SHALLOWS | CLASS_FROZEN | CLASS_SHORE) ? ICY_SHORE : BEACH;
    }
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface CliffsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
  /** The game's stream after this stage. Nothing later draws from it yet. */
  stream: DeStreamState;
  /** Every line tile with the terrain it had when a cliff first touched it, for `finishTerrainStage`. */
  lineTiles: Map<number, number>;
  /** Every cliff object, by cell, in the order the game last built them. */
  pieces: CliffPiece[];
}

/** One cell's step, 0 = up (-y), 1 = right, 2 = down, 3 = left. */
function stepCell(i: number, d: number, cw: number, ch: number): number {
  const x = i % cw;
  const y = (i - x) / cw;
  switch (d & 3) {
    case 0:
      return y > 0 ? i - cw : -1;
    case 1:
      return x + 1 < cw ? i + 1 : -1;
    case 2:
      return y + 1 < ch ? i + cw : -1;
    default:
      return x > 0 ? i - 1 : -1;
  }
}

/** The fallback headings, as measured. They are not clean rotations. */
const FALLBACK_1 = [1, 2, 3, 1];
const FALLBACK_2 = [2, 0, 1, 2];
/** Tried on a walk's first step only. */
const FALLBACK_3 = [1, 2, 0, 1];

/**
 * Sec.6.3, rev 10. Mutates `grid.terrain` (cliff lines and the water repair),
 * `grid.layer` and `grid.cliff`, and returns one `CommandReport` for the
 * section, the notes, the stream, the line tiles' earlier terrain and the
 * cliff pieces. With no `<CLIFF_GENERATION>` section nothing happens and no
 * draw is taken.
 */
export function applyCliffs(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  streamState: DeStreamState,
): CliffsResult {
  const lineTiles = new Map<number, number>();
  const commands = instantiated.sections.get("CLIFF_GENERATION");
  if (commands === undefined)
    return {
      reports: [],
      notes: [],
      stream: streamState,
      lineTiles,
      pieces: [],
    };

  const settings = resolveCliffSettings(
    commands,
    constants,
    instantiated.symbols,
  );
  const commandSpan = commands[0]?.span ?? ZERO_SPAN;
  const notes: SimulationNote[] = [];
  const stream = resumeDeStream(streamState);
  stream.raw(); // the burned draw, one per section

  if (settings.minLength < MIN_LENGTH_FOR_CLIFFS_TO_APPEAR) {
    // The longest length the section can roll. Max is exclusive, except
    // that min equal to max rolls exactly min.
    const longest =
      settings.maxLength > settings.minLength
        ? settings.maxLength - 1
        : settings.minLength;
    notes.push({
      key: `cliffsLengthSuppressed:${settings.minLengthCmd!.span.start}`,
      prominence: "drawer",
      stage: "S3",
      span: settings.minLengthCmd!.span,
      text:
        longest < MIN_LENGTH_FOR_CLIFFS_TO_APPEAR
          ? "Every cliff length this section can roll is below 3, and a cliff shorter than 3 draws nothing in the real game. So this section produces no cliffs at all."
          : "min_length_of_cliff is below 3, and any cliff whose length rolls below 3 draws nothing in the real game. So this section produces fewer cliffs than it asks for.",
    });
  }

  const { dim, terrain, elevation } = grid;
  const table = terrainClassTable(constants);
  const cw = Math.floor(dim / 3);
  const ch = Math.floor(dim / 3);
  const MAIN = 0;
  const BUCKET0 = 1;
  const lists = new CellLists(1 + 100, cw * ch);
  // A candidate's value is its height + 1, and 0 means cleared.
  const value = new Int32Array(cw * ch);
  const blocked: number[] = [];
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let water = false;
      let flat = true;
      const first = elevation[cy * 3 * dim + cx * 3];
      for (let oy = 0; oy < 3; oy++)
        for (let ox = 0; ox < 3; ox++) {
          const i = (cy * 3 + oy) * dim + cx * 3 + ox;
          if (classOf(table, terrain[i]) & CLASS_CLIFF_BLOCKING) water = true;
          if (elevation[i] !== first) flat = false;
        }
      const c = cy * cw + cx;
      if (water) blocked.push(c);
      else if (flat) {
        value[c] = Math.min(first + 1, 255);
        lists.pushFront(MAIN, c);
      }
    }

  const clear = (cx: number, cy: number, r: number): void => {
    if (r < 0) return;
    for (let ny = Math.max(cy - r, 0); ny <= Math.min(cy + r, ch - 1); ny++)
      for (let nx = Math.max(cx - r, 0); nx <= Math.min(cx + r, cw - 1); nx++) {
        const j = ny * cw + nx;
        value[j] = 0;
        if (lists.list[j] === MAIN) lists.remove(j);
      }
  };
  for (const c of blocked)
    clear(c % cw, Math.floor(c / cw), settings.minTerrainDistance);
  // Every land's origin, neutral lands and zero-tile lands included (cl6).
  for (const origin of origins)
    clear(Math.floor(origin.x / 3), Math.floor(origin.y / 3), LAND_CLEARANCE);
  // Isolated cells, read from the values as they stood before this step.
  const before = value.slice();
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const j = cy * cw + cx;
      if (before[j] === 0) continue;
      const lonely =
        (cy === 0 || before[j - cw] === 0) &&
        (cx === 0 || before[j - 1] === 0) &&
        (cy === ch - 1 || before[j + cw] === 0) &&
        (cx === cw - 1 || before[j + 1] === 0);
      if (!lonely) continue;
      value[j] = 0;
      if (lists.list[j] === MAIN) lists.remove(j);
    }
  shuffleList(lists, MAIN, BUCKET0, stream);

  const count = rangeDraw(stream, settings.minCliffs, settings.maxCliffs);
  const failures: PlacementFailure[] = [];
  const report = (attempted: number, placed: number): CommandReport => ({
    commandSpan,
    stage: "S3",
    attempted,
    placed,
    failures,
  });
  if (count > MAX_CLIFF_COUNT || settings.minCliffs > settings.maxCliffs) {
    notes.push({
      key: "cliffsMinExceedsMax",
      prominence: "drawer",
      stage: "S3",
      span: settings.maxCliffsCmd?.span ?? settings.minCliffsCmd?.span,
      text: "min_number_of_cliffs is greater than max_number_of_cliffs, which crashes the real game when the map is generated. The preview shows no cliffs instead of crashing.",
    });
    return {
      reports: [report(0, 0)],
      notes,
      stream: stream.state(),
      lineTiles,
      pieces: [],
    };
  }

  const pieces = new Pieces(stream, STYLE_BASE[settings.cliffType], cw);
  let placed = 0;
  for (let attempt = 0; attempt < count; attempt++) {
    const length = rangeDraw(stream, settings.minLength, settings.maxLength);
    if (length < MIN_LENGTH_FOR_CLIFFS_TO_APPEAR) continue;
    let start = -1;
    for (let i = lists.pop(MAIN); i !== -1; i = lists.pop(MAIN))
      if (value[i] !== 0) {
        start = i;
        break;
      }
    if (start === -1) {
      pushFailure(failures, {
        bucket: "noValidTiles",
        commandSpan,
        stage: "S3",
        entity: `cliff ${attempt + 1}`,
        detail:
          "No 3 by 3 patch of flat dry ground was left for this cliff to start on, away from water, from every land's origin and from the cliffs before it.",
      });
      continue;
    }
    value[start] = 0;
    placed++;

    // The walk stays on cells at the start's height.
    const sx = (start % cw) * 3;
    const sy = Math.floor(start / cw) * 3;
    const target = Math.min(elevation[sy * dim + sx] + 1, 255);
    let d = stream.bounded(4);
    const path = [start];
    let cur = start;
    for (let step = 0; step < length; step++) {
      const curl = stream.bounded(100);
      if (curl < settings.curliness >> 1) d = (d + 3) & 3;
      else if (curl < settings.curliness) d = (d + 1) & 3;
      const tries =
        step === 0
          ? [d, FALLBACK_1[d], FALLBACK_2[d], FALLBACK_3[d]]
          : [d, FALLBACK_1[d], FALLBACK_2[d]];
      let next = -1;
      for (const t of tries) {
        const n = stepCell(cur, t, cw, ch);
        if (n !== -1 && value[n] === target) {
          next = n;
          break;
        }
      }
      if (next === -1) break;
      value[next] = 0;
      path.push(next);
      cur = next;
    }
    path.reverse();
    paintPath(path, cw, grid, table, stream, pieces, lineTiles);
    for (const c of path)
      clear(c % cw, Math.floor(c / cw), settings.minDistanceCliffs);
  }

  return {
    reports: [report(count, placed)],
    notes,
    stream: stream.state(),
    lineTiles,
    pieces: [...pieces.at.values()].map((entry) => entry.piece),
  };
}

/** Paints a reversed walk, segment by segment (5.4), and joins its pieces (5.5). */
function paintPath(
  path: readonly number[],
  cw: number,
  grid: TileGrid,
  table: TerrainClassTable,
  stream: DeStream,
  pieces: Pieces,
  lineTiles: Map<number, number>,
): void {
  const { dim, terrain, layer } = grid;
  let incoming: number | undefined;
  for (let k = 0; k < path.length; k++) {
    const from = path[Math.max(k - 1, 0)];
    const to = path[k];
    const fcx = from % cw;
    const fcy = Math.floor(from / cw);
    const tcx = to % cw;
    const tcy = Math.floor(to / cw);
    const fx = fcx * 3 + 1;
    const fy = fcy * 3 + 1;
    const tx = tcx * 3 + 1;
    const ty = tcy * 3 + 1;
    const x0 = Math.min(fx, tx);
    const x1 = Math.max(fx, tx);
    const y0 = Math.min(fy, ty);
    const y1 = Math.max(fy, ty);
    const dx = Math.sign(tx - fx);
    const dy = Math.sign(ty - fy);
    // 1. The line tiles' decorations, and the first touch on record.
    for (let step = 0; step < (k === 0 ? 1 : 4); step++) {
      const i = (fy + dy * step) * dim + fx + dx * step;
      if (!lineTiles.has(i)) lineTiles.set(i, terrain[i]);
      if (terrain[i] !== REPAIR_MARKER)
        for (let n = decorationDrawsOf(table, terrain[i]); n > 0; n--)
          stream.raw();
    }
    const box = [x0 - 3, y0 - 3, x1 + 3, y1 + 3] as const;
    // 2 to 4. Repair with marker 70, paint the line, repair with marker 16.
    repairWater(grid, table, box, REPAIR_MARKER, stream);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x >= dim || y >= dim) continue;
        const i = y * dim + x;
        terrain[i] = CLIFF_LINE_TERRAIN;
        layer[i] = NO_LAYER;
        grid.cliff[i] = 1;
      }
    repairWater(grid, table, box, CLIFF_LINE_TERRAIN, stream);
    // 5. The piece joining this node to the one before.
    if (k !== 0) incoming = pieces.join(fcx, fcy, tcx, tcy, incoming);
  }
}

/**
 * The end of the terrain stage (preview-design Sec.6.4, rev 10), in the game's
 * order. Every cliff line tile gets back the terrain it had when a cliff
 * first touched it, its own earlier terrain rather than the base terrain
 * (co1). Then the cleanup against WATER runs, which turns a tile pinched
 * between water tiles into water and takes its layer. The beach pass that
 * follows is `applyAutomaticBeach`, which `index.ts` calls next.
 *
 * `onCleaned` hears each tile the cleanup turned into water. The tile keeps
 * its land, so the listener reads `grid.landId` for it.
 */
export function finishTerrainStage(
  grid: TileGrid,
  lineTiles: ReadonlyMap<number, number>,
  waterId: number | undefined,
  onCleaned?: CleanupListener,
): void {
  for (const [i, earlier] of lineTiles) grid.terrain[i] = earlier;
  if (waterId !== undefined)
    cleanTerrainAgainst(grid, waterId, (i, formerTerrain) => {
      grid.layer[i] = NO_LAYER;
      onCleaned?.(i, formerTerrain, grid.landId[i]);
    });
}
