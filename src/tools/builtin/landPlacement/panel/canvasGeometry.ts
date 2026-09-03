// Pure geometry for the panel's own canvas (land-placement-design.md
// Sec.7.2, Sec.7.3): hit-testing a click against the vector-tier circles, and
// the adaptive full-tier debounce. No canvas, no DOM. See this brief's own
// rule that a run-sheet step should never be checking a calculation, only
// wiring, which means every calculation belongs here instead of in the
// component that draws it.

import type { OverlayShape } from "../../../../../tools-api/index";

/**
 * Sec.7.2: "debounce to the last measured land-cut duration for this script,
 * floored at 100 ms... a fixed constant is wrong at both ends of a 26x
 * spread." `lastDurationMs` is null before the panel's first generation has
 * ever completed, when there is nothing yet to adapt to. 250 ms is the old
 * fixed constant's own value, kept as the one-time starting guess since it
 * sits inside the measured range (49 ms median at Normal, 1279 ms at Giant)
 * without favouring either end.
 */
const INITIAL_DEBOUNCE_MS = 250;
const MIN_DEBOUNCE_MS = 100;

export function adaptiveDebounceMs(lastDurationMs: number | null): number {
  if (lastDurationMs === null) return INITIAL_DEBOUNCE_MS;
  return Math.max(MIN_DEBOUNCE_MS, lastDurationMs);
}

export interface TileCircle {
  id: string;
  x: number;
  y: number;
  rTiles: number;
}

/** Only `circle` shapes carrying an `id` are hit-testable. A chain-edge `line` or a `label` is not something a click can select. */
export function circlesFromOverlay(shapes: readonly OverlayShape[]): TileCircle[] {
  const out: TileCircle[] = [];
  for (const shape of shapes) {
    if (shape.kind === "circle" && shape.id !== undefined) {
      out.push({ id: shape.id, x: shape.x, y: shape.y, rTiles: shape.rTiles });
    }
  }
  return out;
}

/**
 * The SMALLEST circle containing the click, so a small land nested visually
 * inside a larger one's radius is still selectable rather than perpetually
 * shadowed by its parent ring. Plain Euclidean distance in TILE space,
 * correct because `OverlayShape` circles are genuinely circular in tile
 * space (drawOverlay.ts only converts to an on-screen radius for drawing).
 */
export function hitTestCircles(tile: { x: number; y: number }, circles: readonly TileCircle[]): string | null {
  let best: TileCircle | null = null;
  for (const circle of circles) {
    const dx = tile.x - circle.x;
    const dy = tile.y - circle.y;
    if (dx * dx + dy * dy > circle.rTiles * circle.rTiles) continue;
    if (best === null || circle.rTiles < best.rTiles) best = circle;
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// slice-5-brief.md item 1 (a third pointer mode) and item 5 (chain creation
// by dragging from a rim handle): the two ADDITIONAL hit tests a drag start
// needs, beside the body hit test above.
// ---------------------------------------------------------------------------

/**
 * A handle's own grab envelope, in TILES. `drawOverlay.ts` draws a `handle`
 * shape at a fixed 5px SCREEN size, independent of zoom, so a tile-space hit
 * test (this module's own established convention, matching `hitTestCircles`)
 * is necessarily an approximation that gets looser as the user zooms in and
 * tighter as they zoom out — a feel defect the brief's own run sheet (not a
 * pinned test) is the tool for, not a correctness property.
 */
export function handleGrabRadiusTiles(mapDim: number): number {
  return Math.max(1.5, mapDim * 0.015);
}

/**
 * However thick the caller asks for, a rim band never eats more than the
 * outer third of a circle's radius, so the inner ~65% of EVERY land stays a
 * body drag. Chosen as the largest fraction that still leaves the body the
 * clear majority of the disc by area (0.65² is 42% of it) rather than
 * measured, since the quantity being traded is feel, which §4's run sheet is
 * the instrument for and a pinned test is not.
 */
const RIM_MAX_RADIUS_FRACTION = 0.35;

/**
 * Sec.7.3: "drag from a land's rim to another land or to the centre marker
 * to create the chain" — a distinct gesture from dragging the land's BODY
 * (`hitTestCircles`), so it needs its own, narrower test: within
 * `thicknessTiles` of a circle's own EDGE, not its interior. The smallest
 * such distance wins, matching `hitTestCircles`'s own "smallest circle"
 * tie-break for the same reason (a small land nested inside a larger one's
 * radius should still offer its own rim first).
 */
export function hitTestRim(tile: { x: number; y: number }, circles: readonly TileCircle[], thicknessTiles: number): string | null {
  let best: TileCircle | null = null;
  let bestRimDistance = Infinity;
  for (const circle of circles) {
    // The band is capped per circle, never a flat `thicknessTiles` for every
    // land. A fixed ~1.8-tile band is a sliver on a 16-tile land and swallows
    // most of a 3-tile one, so without this cap a small land is rim almost
    // everywhere and its BODY drag (move the land) becomes unreachable, with
    // the rim gesture (start a chain) firing in its place. The exception
    // belongs inside the function that computes the rule rather than at the
    // call site that knows about small lands.
    const band = Math.min(thicknessTiles, circle.rTiles * RIM_MAX_RADIUS_FRACTION);
    const distance = Math.hypot(tile.x - circle.x, tile.y - circle.y);
    const rimDistance = Math.abs(distance - circle.rTiles);
    if (rimDistance > band) continue;
    if (rimDistance < bestRimDistance) {
      best = circle;
      bestRimDistance = rimDistance;
    }
  }
  return best?.id ?? null;
}
