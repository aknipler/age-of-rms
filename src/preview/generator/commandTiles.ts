import type { TileGrid } from "./types";

// Which tiles each script command produced, for the preview's "Highlight
// selected command" option. Pure and worker-safe like the rest of the
// generator.
//
// An ambient recorder, the same pattern and the same reasoning as
// generationTiming.ts. A recorder argument on six stage functions would touch
// every caller and test for a diagnostic, and the usual danger of a module
// level recorder (two runs sharing it) cannot happen, since generatePreview is
// synchronous and runs to the end before anything else on its thread. With no
// recorder installed (every test, every tool) each function here does the least
// it can, so the option costs nothing when it is off.

export type CommandTileKind =
  "terrain" | "land" | "object" | "elevation" | "connection" | "cliff";

export interface CommandTiles {
  /** The command's source offset, `span.start`. For "cliff" it is -1 and the whole section matches. */
  offset: number;
  kind: CommandTileKind;
  /** Tile indices (y * dim + x), sorted ascending, no repeats. */
  first: Uint32Array;
  /** Absent for single set kinds. */
  second?: Uint32Array;
  /** Land kinds only, the zone number and how many lands share it. */
  zone?: { zone: number; lands: number };
}

/** One run of a terrain or connection command, in the order the runs happened. */
interface PaintRun {
  offset: number;
  kind: "terrain" | "connection";
  tiles: number[];
  /** What the command left on each tile, parallel to `tiles`. */
  values: number[];
}

interface SetEntry {
  kind: CommandTileKind;
  first: Set<number>;
  second?: Set<number>;
  zone?: CommandTiles["zone"];
}

interface Recording {
  dim: number;
  runs: PaintRun[];
  entries: Map<number, SetEntry>;
}

let current: Recording | null = null;

/** Starts recording. generatePreview calls it when the option is on. */
export function startCommandTiles(dim: number): void {
  current = { dim, runs: [], entries: new Map() };
}

/** True while a recording is running, so a caller can skip building tile lists nobody will read. */
export function recordingCommandTiles(): boolean {
  return current !== null;
}

/**
 * Wraps one command's work, recording the tiles whose terrain, layer or
 * elevation it changed. The tiles are found by comparing the grid before and
 * after, so a tile the command painted with the terrain it already had does not
 * count. The generator cannot tell that from a tile the command skipped.
 *
 * Connections do not use this. They work on a private copy of the terrain and
 * write the grid once at the end of the stage, so a before and after diff of the
 * grid would see nothing. They call `recordPaint` with the tiles they painted.
 */
export function traceCommandTiles<T>(
  cmd: { span: { start: number } },
  kind: "terrain" | "connection" | "elevation",
  grid: TileGrid,
  fn: () => T,
): T {
  const rec = current;
  if (rec === null) return fn();
  const terrainBefore = kind === "elevation" ? null : grid.terrain.slice();
  const layerBefore = kind === "elevation" ? null : grid.layer.slice();
  const elevationBefore = kind === "elevation" ? grid.elevation.slice() : null;
  const result = fn();
  const tiles: number[] = [];
  const values: number[] = [];
  const n = grid.terrain.length;
  for (let i = 0; i < n; i++) {
    const changed =
      elevationBefore !== null
        ? grid.elevation[i] !== elevationBefore[i]
        : grid.terrain[i] !== terrainBefore![i] ||
          grid.layer[i] !== layerBefore![i];
    if (!changed) continue;
    tiles.push(i);
    values.push(grid.terrain[i]);
  }
  if (kind === "elevation") {
    addToEntry(rec, cmd.span.start, "elevation", tiles);
  } else {
    rec.runs.push({
      offset: cmd.span.start,
      kind: kind === "connection" ? "connection" : "terrain",
      tiles,
      values,
    });
  }
  return result;
}

/**
 * Records tiles a command painted, with the terrain it left on each. Used by
 * the connection stage, whose work never touches the grid until the end.
 */
export function recordPaint(
  offset: number,
  kind: "terrain" | "connection",
  painted: ReadonlyMap<number, number>,
): void {
  const rec = current;
  if (rec === null) return;
  rec.runs.push({
    offset,
    kind,
    tiles: [...painted.keys()],
    values: [...painted.values()],
  });
}

function addToEntry(
  rec: Recording,
  offset: number,
  kind: CommandTileKind,
  first: Iterable<number>,
  second?: Iterable<number>,
  zone?: CommandTiles["zone"],
): void {
  let entry = rec.entries.get(offset);
  if (entry === undefined) {
    entry = { kind, first: new Set() };
    rec.entries.set(offset, entry);
  }
  for (const t of first) entry.first.add(t);
  if (second !== undefined) {
    entry.second ??= new Set();
    for (const t of second) entry.second.add(t);
  }
  // A create_player_lands command's lands share one offset, so their sets
  // union. Their zones can differ, and the first land's names the entry.
  if (zone !== undefined) entry.zone ??= zone;
}

/**
 * Adds a command's tiles. Repeated calls for one offset union, since one script
 * line can run more than once (a per player object command).
 */
export function recordTiles(
  offset: number,
  kind: CommandTileKind,
  first: Iterable<number>,
  second?: Iterable<number>,
  zone?: CommandTiles["zone"],
): void {
  if (current === null) return;
  addToEntry(current, offset, kind, first, second, zone);
}

/**
 * The tiles an object's placement square covers, clamped to the map. `half` is
 * the placement half size in tiles on each axis. A half size under 1 is one
 * tile, the one the object stands on, since a half tile square straddling an
 * edge would otherwise light two tiles for one small object.
 */
export function objectFootprintTiles(
  x: number,
  y: number,
  half: readonly [number, number],
  dim: number,
): number[] {
  const span = (centre: number, h: number): [number, number] =>
    h < 1
      ? [Math.floor(centre), Math.floor(centre)]
      : // The far edge is exclusive, so an object centred on a tile corner
        // with half size 2 covers 4 tiles a side and not 5.
        [Math.floor(centre - h), Math.ceil(centre + h) - 1];
  const [x0, x1] = span(x, half[0]);
  const [y0, y1] = span(y, half[1]);
  const out: number[] = [];
  for (let ty = Math.max(0, y0); ty <= Math.min(dim - 1, y1); ty++)
    for (let tx = Math.max(0, x0); tx <= Math.min(dim - 1, x1); tx++)
      out.push(ty * dim + tx);
  return out;
}

const sortedArray = (set: Iterable<number>): Uint32Array =>
  Uint32Array.from(set).sort();

/**
 * Stops recording and returns every command's sets, or null when nothing was
 * recording. `finalTerrain` is the finished map, which decides the second set of
 * a terrain or connection command, the tiles that still hold its terrain and
 * that no later command placed.
 */
export function endCommandTiles(
  finalTerrain: Uint16Array,
): CommandTiles[] | null {
  const rec = current;
  current = null;
  if (rec === null) return null;

  // Walk the runs in the order they ran. The last run to place a tile owns it,
  // and `lastValue` is what that run left there. A later command overwriting a
  // tile therefore takes it away from every earlier command's surviving set.
  const n = rec.dim * rec.dim;
  const lastOffset = new Int32Array(n).fill(-2);
  const lastValue = new Uint16Array(n);
  const placed = new Map<
    number,
    { kind: PaintRun["kind"]; tiles: Set<number> }
  >();
  for (const run of rec.runs) {
    let p = placed.get(run.offset);
    if (p === undefined) {
      p = { kind: run.kind, tiles: new Set() };
      placed.set(run.offset, p);
    }
    for (let k = 0; k < run.tiles.length; k++) {
      const i = run.tiles[k];
      p.tiles.add(i);
      lastOffset[i] = run.offset;
      lastValue[i] = run.values[k];
    }
  }

  const out: CommandTiles[] = [];
  for (const [offset, p] of placed) {
    const surviving: number[] = [];
    for (const i of p.tiles)
      if (lastOffset[i] === offset && finalTerrain[i] === lastValue[i])
        surviving.push(i);
    out.push({
      offset,
      kind: p.kind,
      first: sortedArray(p.tiles),
      second: sortedArray(surviving),
    });
  }
  for (const [offset, e] of rec.entries) {
    out.push({
      offset,
      kind: e.kind,
      first: sortedArray(e.first),
      second: e.second === undefined ? undefined : sortedArray(e.second),
      zone: e.zone,
    });
  }
  return out;
}
