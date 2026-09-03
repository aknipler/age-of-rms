// Sec.7.3's snapping defaults, withdrawn-and-replaced in rev 3: "Snapping to
// integer percent is on by default, withdrawn... on measurement. Integer
// percent is a 2.52-tile lattice at Giant... The defaults that survive are
// snap to the tile lattice for the current map size (a real position the
// user can see), plus snap to the centre and to a parent's axis. Integer
// percent stays available as an explicit modifier."
//
// All pure, all percent-space (0-100, matching viewModel.ts's own
// `percentToTile`/`formatPercentWithTiles` convention). A drag handler
// calls these against a candidate position; nothing here touches the DOM or
// the canvas.

import { percentToTile } from "./viewModel";

export interface PercentPoint {
  x: number;
  y: number;
}

/**
 * Sec.7.3's default tile-lattice snap: quantise to the nearest real tile at
 * the current map size, then convert back to percent. Unconditional, unlike
 * the magnetic snaps below, this isn't "close enough to a tile, jump to it";
 * it's what "a real position the user can see" means, applied every time.
 * Matches `percentToTile` exactly (viewModel.ts) so the panel's own readout
 * never disagrees with where a snapped drag actually lands.
 */
export function snapToTileLattice(pt: PercentPoint, mapDim: number): PercentPoint {
  if (mapDim <= 0) return pt;
  const snapAxis = (v: number): number => (percentToTile(v, mapDim) / mapDim) * 100;
  return { x: snapAxis(pt.x), y: snapAxis(pt.y) };
}

/** Percent-space distance a `toleranceTiles`-tile radius covers at `mapDim`. Zero at `mapDim <= 0`, nothing to snap to on a map with no known size yet. */
function toleranceInPercent(toleranceTiles: number, mapDim: number): number {
  return mapDim > 0 ? (toleranceTiles / mapDim) * 100 : 0;
}

/**
 * Snaps to `centre` (default the map centre, `{50,50}`) when within
 * `toleranceTiles` tiles of it, Euclidean, in percent space. Unlike the
 * tile lattice, this is a MAGNETIC snap: outside the tolerance the candidate
 * is returned untouched, since snapping every drag toward the centre would
 * make anything near it impossible to place precisely elsewhere.
 */
export function snapToCentre(
  pt: PercentPoint,
  centre: PercentPoint,
  toleranceTiles: number,
  mapDim: number,
): PercentPoint {
  const tolPct = toleranceInPercent(toleranceTiles, mapDim);
  const dx = pt.x - centre.x;
  const dy = pt.y - centre.y;
  return Math.hypot(dx, dy) <= tolPct ? { ...centre } : pt;
}

/**
 * Snaps to a parent's own X or Y axis independently, a placement often
 * wants to line up horizontally or vertically with its parent without
 * matching both coordinates at once (which `snapToCentre`'s single-point
 * magnet already covers for the "exactly on top of" case). Each axis snaps
 * on its own tolerance check, so a drag that's aligned on X but not Y snaps
 * only X.
 */
export function snapToParentAxis(
  pt: PercentPoint,
  parentAnchor: PercentPoint,
  toleranceTiles: number,
  mapDim: number,
): PercentPoint {
  const tolPct = toleranceInPercent(toleranceTiles, mapDim);
  const x = Math.abs(pt.x - parentAnchor.x) <= tolPct ? parentAnchor.x : pt.x;
  const y = Math.abs(pt.y - parentAnchor.y) <= tolPct ? parentAnchor.y : pt.y;
  return { x, y };
}

/** Sec.7.3's explicit modifier, never on by default: rounds to a whole percent. */
export function snapToIntegerPercent(pt: PercentPoint): PercentPoint {
  return { x: Math.round(pt.x), y: Math.round(pt.y) };
}

/** A tight-ish default: close enough to feel magnetic, loose enough not to fight a deliberate nearby placement. */
export const DEFAULT_SNAP_TOLERANCE_TILES = 2;

export interface SnapContext {
  mapDim: number;
  /** Default the map centre, `{50,50}`. */
  centre?: PercentPoint;
  /** Omit for a placement parented to "center", there is no separate axis to snap to (`snapToCentre` already covers that case). */
  parentAnchor?: PercentPoint;
  toleranceTiles?: number;
}

/**
 * Every default snap Sec.7.3 names, composed in the order that keeps each
 * one meaningful: the magnetic snaps (centre, then parent axis) run against
 * the RAW candidate first, so a point close to the centre snaps to EXACTLY
 * (50, 50) rather than to the nearest tile's own approximation of it; the
 * tile lattice runs last, over whatever the magnetic snaps produced, so
 * every returned point still lands on a real tile either way.
 */
export function applyDefaultSnapping(pt: PercentPoint, ctx: SnapContext): PercentPoint {
  const centre = ctx.centre ?? { x: 50, y: 50 };
  const tolerance = ctx.toleranceTiles ?? DEFAULT_SNAP_TOLERANCE_TILES;
  let snapped = snapToCentre(pt, centre, tolerance, ctx.mapDim);
  if (ctx.parentAnchor) snapped = snapToParentAxis(snapped, ctx.parentAnchor, tolerance, ctx.mapDim);
  return snapToTileLattice(snapped, ctx.mapDim);
}
