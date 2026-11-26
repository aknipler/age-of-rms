import { latticeToScreen, type Viewport } from "./projection";

// The Terrain Stats box (PreviewNotes.tsx) and the glow it turns on over the
// map (OverlayCanvas.tsx). The counting and the run finding are pure, so they
// are tested in plain Node. Only `traceGlowRuns` touches a canvas path.

/** One row of the Terrain Stats box. */
export interface TerrainShare {
  id: number;
  /** Tiles whose terrain is `id`. */
  tiles: number;
  /** `tiles` over every tile on the map, 0 to 1. */
  fraction: number;
}

/**
 * How many tiles of each terrain the grid holds, largest first, ties by id so
 * the order is stable between two maps with equal counts.
 *
 * Counted over the terrain that owns each tile, the same array the legend
 * read. A `terrain_mask` layer drawn over a tile does not change its owner,
 * so the box answers "what is this map made of" in the terms every later
 * placement rule reads.
 */
export function terrainShares(terrain: ArrayLike<number>): TerrainShare[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < terrain.length; i++) {
    const id = terrain[i];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const total = terrain.length;
  return [...counts]
    .map(([id, tiles]) => ({
      id,
      tiles,
      fraction: total === 0 ? 0 : tiles / total,
    }))
    .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
}

/**
 * A share as the box prints it. One decimal, except that a terrain with any
 * tiles at all never prints as 0.0%, since a row that says zero reads as a
 * terrain that is not there.
 */
export function formatShare(fraction: number): string {
  const percent = fraction * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/** A run of tiles along x in one row, `x0` to `x1` inclusive. */
export interface TileRun {
  y: number;
  x0: number;
  x1: number;
}

/**
 * The tiles of terrain `id`, merged into runs along each row.
 *
 * Merged because the glow is traced every time the view moves, and a forest
 * of 8,000 tiles is a few hundred runs. One diamond per tile would also leave
 * a hairline seam between neighbours where two antialiased edges meet.
 */
export function glowRuns(
  terrain: ArrayLike<number>,
  dim: number,
  id: number,
): TileRun[] {
  const runs: TileRun[] = [];
  for (let y = 0; y < dim; y++) {
    let start = -1;
    for (let x = 0; x <= dim; x++) {
      const hit = x < dim && terrain[y * dim + x] === id;
      if (hit && start < 0) start = x;
      else if (!hit && start >= 0) {
        runs.push({ y, x0: start, x1: x - 1 });
        start = -1;
      }
    }
  }
  return runs;
}

/**
 * The same runs, from a sorted list of tile indices (`y * dim + x`) instead of
 * a terrain id. The command highlight's sets arrive this way. Sorted order
 * means one pass finds every run, with a break wherever a row ends or an index
 * skips.
 */
export function maskRuns(tiles: Uint32Array, dim: number): TileRun[] {
  const runs: TileRun[] = [];
  let i = 0;
  while (i < tiles.length) {
    const y = Math.floor(tiles[i] / dim);
    const x0 = tiles[i] - y * dim;
    let x1 = x0;
    i++;
    // Extend while the next index is the next tile of the same row.
    while (i < tiles.length && tiles[i] === y * dim + x1 + 1 && x1 + 1 < dim) {
      x1++;
      i++;
    }
    runs.push({ y, x0, x1 });
  }
  return runs;
}

/**
 * Adds every run to `path` as one closed polygon.
 *
 * The polygon walks every lattice point along both long edges rather than
 * only the four corners. On the flat views the extra points sit on a straight
 * line and cost nothing. On raised ground (the textured view) each lattice
 * point is lifted by its own height, so four corners alone would draw a
 * hill's forest as a flat strip cutting across the slope.
 *
 * Takes the path's two methods rather than a `Path2D`, which Node has no
 * copy of, so a test can hand in a recorder.
 */
export function traceGlowRuns(
  path: Pick<Path2D, "moveTo" | "lineTo" | "closePath">,
  viewport: Viewport,
  runs: readonly TileRun[],
): void {
  for (const { y, x0, x1 } of runs) {
    const start = latticeToScreen(viewport, x0, y);
    path.moveTo(start.x, start.y);
    for (let x = x0 + 1; x <= x1 + 1; x++) {
      const p = latticeToScreen(viewport, x, y);
      path.lineTo(p.x, p.y);
    }
    for (let x = x1 + 1; x >= x0; x--) {
      const p = latticeToScreen(viewport, x, y + 1);
      path.lineTo(p.x, p.y);
    }
    path.closePath();
  }
}

/** One bright and dim cycle of the glow, in milliseconds. */
export const GLOW_PERIOD_MS = 2400;
const GLOW_MIN_ALPHA = 0.12;
const GLOW_MAX_ALPHA = 0.6;

/**
 * The glow's opacity at time `ms`. A cosine, so it eases at both ends instead
 * of snapping at the bright and dim points the way a triangle wave would.
 * Starts bright at 0, so the tiles light the moment a row is clicked.
 */
export function glowAlpha(ms: number): number {
  const phase = (ms % GLOW_PERIOD_MS) / GLOW_PERIOD_MS;
  const wave = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI);
  return GLOW_MIN_ALPHA + (GLOW_MAX_ALPHA - GLOW_MIN_ALPHA) * wave;
}

/**
 * The command highlight's two sets taking turns. One full cycle is two glow
 * periods, the first half on set 0 and the second on set 1. Each half rises
 * from 0 to the peak and back to 0, so the switch between sets happens at
 * alpha 0 and never shows a jump.
 */
export function alternatingGlow(ms: number): { set: 0 | 1; alpha: number } {
  const cycle = 2 * GLOW_PERIOD_MS;
  const t = ((ms % cycle) + cycle) % cycle;
  const set = t < GLOW_PERIOD_MS ? 0 : 1;
  const phase = (t % GLOW_PERIOD_MS) / GLOW_PERIOD_MS;
  return {
    set,
    alpha: GLOW_MAX_ALPHA * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)),
  };
}
