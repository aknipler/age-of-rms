import { LIFT_PER_LEVEL, screenToTile, type Viewport } from "./projection";

/**
 * How strong the grid lines are. A union of string literals rather than an
 * enum, so the stored value in settings.json is the same plain string the
 * type names and `isGridLineStrength` can check it with no lookup table.
 */
export type GridLineStrength = "none" | "light" | "medium" | "dark";

/** A stored value is `unknown` until a guard like this has looked at it. */
export function isGridLineStrength(value: unknown): value is GridLineStrength {
  return (
    value === "none" ||
    value === "light" ||
    value === "medium" ||
    value === "dark"
  );
}

/**
 * One dark ink at three strengths. A single dark ink reads on every terrain,
 * where a white line would vanish on snow.
 */
export const GRID_LINE_ALPHA: Record<
  Exclude<GridLineStrength, "none">,
  number
> = {
  light: 0.14,
  medium: 0.28,
  dark: 0.5,
};

/**
 * The stroke alpha at this zoom, 0 when nothing should draw. Below a tile half
 * width of 2 CSS pixels the grid is a grey wash that hides the map, so the
 * alpha ramps from 0 at 2 up to its full strength at 6.
 */
export function gridLineAlpha(
  strength: GridLineStrength,
  halfWidth: number,
): number {
  if (strength === "none") return 0;
  const fade = Math.min(Math.max((halfWidth - 2) / 4, 0), 1);
  return GRID_LINE_ALPHA[strength] * fade;
}

/**
 * The lattice lines that can be on screen, as inclusive index ranges, so a
 * zoomed in view of a Giant map does not trace 481 lines it cannot see.
 *
 * Lattice line `i` runs along tile corner `i`, so the valid range is `0..dim`.
 */
export function visibleLatticeRange(
  viewport: Viewport,
  dim: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const corners = [
    screenToTile(viewport, 0, 0),
    screenToTile(viewport, viewport.width, 0),
    screenToTile(viewport, 0, viewport.height),
    screenToTile(viewport, viewport.width, viewport.height),
  ];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of corners) {
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    y0 = Math.min(y0, c.y);
    y1 = Math.max(y1, c.y);
  }
  // Raised ground draws a tile higher on screen than its flat position, so a
  // tile just below the bottom edge can lift into view. Down the screen is
  // larger y and smaller x, so those two sides take the extra padding. The
  // lift constant is imported, never copied, so a change to it follows here.
  const ground = viewport.ground;
  const lift =
    ground === undefined ? 0 : Math.ceil(ground.maxLevel * LIFT_PER_LEVEL) + 1;
  return {
    x0: Math.max(0, Math.floor(x0) - 1 - lift),
    x1: Math.min(dim, Math.ceil(x1) + 1),
    y0: Math.max(0, Math.floor(y0) - 1),
    y1: Math.min(dim, Math.ceil(y1) + 1 + lift),
  };
}
