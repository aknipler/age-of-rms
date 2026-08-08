// The diamond projection, and nothing else. Pure maths — no canvas, no DOM,
// no React — so it unit-tests in plain Node and so the round-trip property
// below can be asserted rather than eyeballed.
//
// docs/preview-design.md Sec.4 hands the renderer this job in one sentence:
// "The renderer owns the diamond projection of this grid; the generator never
// thinks in screen space." Everything here is the renderer's side of that
// line.

/**
 * Tile-space (x, y) is the guide's coordinate system, and it is rotated 45
 * degrees from the picture on screen: (0,0) is the WEST corner, (dim,0)
 * north, (0,dim) south, (dim,dim) east (Sec.4).
 *
 * So the two tile axes point up-right and down-right on screen:
 *
 *          north (dim, 0)
 *              /\
 *      +x   /      \   -y
 *          /          \
 *   west  <            >  east (dim, dim)
 *   (0,0)  \          /
 *      +y     \    /   -x
 *              \/
 *          south (0, dim)
 *
 * That rotation is not a rendering flourish, it is the engine's. Getting it
 * wrong is what docs/elevation-bias-study.md found had happened to the whole
 * elevation model, where the guide's "south" turned out to mean the y-x
 * diagonal rather than +y.
 */

/**
 * Vertical squash of one tile, as a fraction of its half-width.
 *
 * 1 draws the map as a square rotated 45 degrees, which is what the Breakdown
 * mockup shows and what keeps tile distances isotropic — a ring of resources
 * reads as a ring rather than an ellipse, which is most of what this preview
 * is for. 0.5 would be classic 2:1 isometric and would match a screenshot of
 * DE's own minimap more closely, at the cost of halving the vertical space in
 * an already narrow side panel.
 *
 * Nothing in the spec pins this, so it is a renderer decision recorded here
 * rather than an implementation of one. 4.3's visual-calibration pass
 * (Sec.13) compares against real DE screenshots and is the right place to
 * revisit it; this is the one line that has to change.
 */
export const TILE_ASPECT = 1;

/** Zoom limits, in screen pixels per tile half-width. */
export const MIN_HALF_WIDTH = 0.15;
export const MAX_HALF_WIDTH = 24;

export interface Viewport {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Half-width of one tile's diamond in CSS pixels. This is the zoom knob. */
  halfWidth: number;
  /** Where tile-lattice point (0,0) — the map's west corner — sits on screen. */
  originX: number;
  originY: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Fractional tile coordinates; floor them to get a tile index. */
export interface TilePoint {
  x: number;
  y: number;
}

export function halfHeightOf(viewport: Viewport): number {
  return viewport.halfWidth * TILE_ASPECT;
}

/**
 * Screen position of a CONTINUOUS tile coordinate. The exact inverse of
 * screenToTile, and the primitive the other two are written in terms of.
 *
 * Keeping this separate from tileToScreen is not tidiness. The half-tile
 * offset between "tile index" and "continuous coordinate" has to be applied
 * exactly once, and having one function that applies it and one that does not
 * is what stops a caller from applying it twice — which is precisely what
 * zoomAt did until the round-trip tests were pointed at it, drifting the map
 * half a tile per zoom step.
 */
export function latticeToScreen(viewport: Viewport, x: number, y: number): ScreenPoint {
  return {
    x: viewport.originX + (x + y) * viewport.halfWidth,
    y: viewport.originY + (y - x) * halfHeightOf(viewport),
  };
}

/**
 * Centre of tile (x, y) in screen pixels.
 *
 * Lattice point (x, y) is the tile's WEST corner and the tile spans to
 * (x+1, y+1), so its centre is half a tile along both axes.
 */
export function tileToScreen(viewport: Viewport, x: number, y: number): ScreenPoint {
  return latticeToScreen(viewport, x + 0.5, y + 0.5);
}

/**
 * The inverse: screen pixels back to fractional tile coordinates, for hover
 * read-outs and click-through. Floor the result to get a tile index.
 *
 * Derivation, because "why does this work" is the only interesting part. In
 * continuous tile coordinates the forward map is `u = x + y` and `v = y - x`,
 * measured in half-widths and half-heights. Two equations, two unknowns — add
 * them for y, subtract for x.
 *
 * The half-tile offset lives in tileToScreen and NOT here, which is the one
 * thing to get right: this returns a continuous coordinate whose integer part
 * is the tile, so the centre of tile (0,0) comes back as (0.5, 0.5).
 * Subtracting the offset here instead returns (0, 0) for that centre, which
 * floors correctly right up until floating-point error makes it -0.0000001
 * and the hover read-out reports tile -1. The round-trip test caught exactly
 * that.
 */
export function screenToTile(viewport: Viewport, screenX: number, screenY: number): TilePoint {
  const u = (screenX - viewport.originX) / viewport.halfWidth;
  const v = (screenY - viewport.originY) / halfHeightOf(viewport);
  return { x: (u - v) / 2, y: (u + v) / 2 };
}

/** True when a fractional tile point lands inside a dim x dim map. */
export function isOnMap(point: TilePoint, dim: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < dim && point.y < dim;
}

/** The whole map's screen bounding box under a viewport. */
export function mapBounds(viewport: Viewport, dim: number) {
  const halfHeight = halfHeightOf(viewport);
  return {
    left: viewport.originX,
    right: viewport.originX + 2 * dim * viewport.halfWidth,
    top: viewport.originY - dim * halfHeight,
    bottom: viewport.originY + dim * halfHeight,
  };
}

/**
 * The viewport that centres the whole diamond in a canvas with `padding` CSS
 * pixels of breathing room. This is what the pane starts at and what the
 * reset control returns to.
 */
export function fitViewport(
  dim: number,
  width: number,
  height: number,
  padding = 6,
): Viewport {
  const usableWidth = Math.max(1, width - 2 * padding);
  const usableHeight = Math.max(1, height - 2 * padding);
  // The diamond is 2*dim half-widths across and 2*dim half-heights tall, so
  // each dimension caps the zoom independently and the tighter one wins.
  const byWidth = usableWidth / (2 * dim);
  const byHeight = usableHeight / (2 * dim * TILE_ASPECT);
  const halfWidth = clampHalfWidth(Math.min(byWidth, byHeight));
  return {
    width,
    height,
    halfWidth,
    // Horizontally: centre the 2*dim*halfWidth-wide box.
    originX: (width - 2 * dim * halfWidth) / 2,
    // Vertically: screen y runs from -dim*halfHeight to +dim*halfHeight about
    // the origin, so the origin IS the vertical centre.
    originY: height / 2,
  };
}

export function clampHalfWidth(halfWidth: number): number {
  return Math.min(MAX_HALF_WIDTH, Math.max(MIN_HALF_WIDTH, halfWidth));
}

/**
 * Zoom by `factor`, keeping whatever tile currently sits under
 * (anchorX, anchorY) pinned to that same pixel.
 *
 * This is the bit that makes wheel-zoom feel right rather than lurching: read
 * the tile under the cursor first, change the scale, then move the origin so
 * that tile lands back where it was. Zooming about the canvas centre instead
 * is a one-line change and feels wrong immediately.
 */
export function zoomAt(
  viewport: Viewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): Viewport {
  const halfWidth = clampHalfWidth(viewport.halfWidth * factor);
  if (halfWidth === viewport.halfWidth) return viewport; // already at a limit
  const anchorTile = screenToTile(viewport, anchorX, anchorY);
  const zoomed: Viewport = { ...viewport, halfWidth };
  // latticeToScreen, not tileToScreen: screenToTile already returned a
  // continuous coordinate, so adding the half-tile offset here would apply it
  // twice.
  const after = latticeToScreen(zoomed, anchorTile.x, anchorTile.y);
  return {
    ...zoomed,
    originX: zoomed.originX + (anchorX - after.x),
    originY: zoomed.originY + (anchorY - after.y),
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, originX: viewport.originX + dx, originY: viewport.originY + dy };
}

/**
 * Keep at least a corner of the map reachable after a pan, so a stray drag
 * cannot lose the map off-screen with no way back but the reset button.
 */
export function clampToCanvas(viewport: Viewport, dim: number): Viewport {
  const bounds = mapBounds(viewport, dim);
  const margin = Math.min(viewport.width, viewport.height) * 0.25;
  let { originX, originY } = viewport;
  if (bounds.right < margin) originX += margin - bounds.right;
  if (bounds.left > viewport.width - margin) originX -= bounds.left - (viewport.width - margin);
  if (bounds.bottom < margin) originY += margin - bounds.bottom;
  if (bounds.top > viewport.height - margin) originY -= bounds.top - (viewport.height - margin);
  return originX === viewport.originX && originY === viewport.originY
    ? viewport
    : { ...viewport, originX, originY };
}
