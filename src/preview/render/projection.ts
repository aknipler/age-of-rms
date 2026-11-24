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
 *
 * Since 2026-11-23 this is the flat view's value, and the squash lives on
 * the viewport (`Viewport.aspect`), so the textured view can draw at the
 * game's own squash through the same functions
 * (docs/preview-de-textures-design.md Sec.3).
 */
export const TILE_ASPECT = 1;

/**
 * The game's squash. The dat's terrain block gives a tile 96 wide and 48
 * tall, exactly 2 to 1, which the textured view draws at.
 */
export const DE_TILE_ASPECT = 0.5;

/** Zoom limits, in screen pixels per tile half-width. */
export const MIN_HALF_WIDTH = 0.15;
export const MAX_HALF_WIDTH = 156;

export interface Viewport {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Half-width of one tile's diamond in CSS pixels. This is the zoom knob. */
  halfWidth: number;
  /** Where tile-lattice point (0,0) — the map's west corner — sits on screen. */
  originX: number;
  originY: number;
  /**
   * A tile's half height over its half width. `TILE_ASPECT` for the flat
   * view, `DE_TILE_ASPECT` for the textured one. On the viewport rather than
   * a module constant so every function here, and so every hit test and draw
   * call built on them, follows whichever view is showing with no change of
   * its own. Optional so a viewport built before this field existed, or by a
   * caller that only wants the flat view, reads as `TILE_ASPECT`.
   */
  aspect?: number;
  /**
   * The ground's height field, set only in the textured view, which draws
   * high ground raised as the game does (docs/preview-de-textures-design.md
   * Sec.13). Every point placed through this module is lifted by the ground
   * under it, and `screenToTile` finds the raised point under the pointer,
   * so objects, outlines, overlays and hit tests all follow the hills with
   * no change of their own, as they follow `aspect`.
   */
  ground?: GroundHeights;
}

/** The ground's height at each tile corner, as texturedTiles.ts's buildCornerHeights gives it. */
export interface GroundHeights {
  dim: number;
  /** `(dim + 1)` a side, row major, in elevation levels, fractional where the corner rule averages. */
  corners: ArrayLike<number>;
  /** The highest corner, which bounds the search in screenToTile. */
  maxLevel: number;
}

/**
 * How far one elevation level lifts the ground, in tile half widths. The
 * dat's `elev_height` is 24 pixels on its 96 by 48 tile, whose half width is
 * 48, so a level is half a half width, one half height at the 2:1 squash.
 */
export const LIFT_PER_LEVEL = 0.5;

/**
 * The ground's height at a continuous tile point, blended from its tile's
 * corners as the hill light is. A surface folded along a tile diagonal was
 * tried and matched the game slightly worse (docs/preview-de-textures-design.md
 * Sec.13).
 */
export function groundHeightAt(
  ground: GroundHeights,
  x: number,
  y: number,
): number {
  const dim = ground.dim;
  const cx = Math.min(Math.max(x, 0), dim);
  const cy = Math.min(Math.max(y, 0), dim);
  const x0 = Math.min(Math.floor(cx), dim - 1);
  const y0 = Math.min(Math.floor(cy), dim - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const side = dim + 1;
  const c = ground.corners;
  const h00 = c[y0 * side + x0];
  const h10 = c[y0 * side + x0 + 1];
  const h01 = c[(y0 + 1) * side + x0];
  const h11 = c[(y0 + 1) * side + x0 + 1];
  return (
    (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy
  );
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
  return viewport.halfWidth * aspectOf(viewport);
}

export function aspectOf(viewport: Viewport): number {
  return viewport.aspect ?? TILE_ASPECT;
}

/**
 * The same viewport at another squash, with the tile at the canvas centre
 * kept at the centre and the zoom kept. Switching views then keeps whatever
 * the user was looking at in front of them.
 */
export function withAspect(viewport: Viewport, aspect: number): Viewport {
  if (aspectOf(viewport) === aspect) return viewport;
  const centreX = viewport.width / 2;
  const centreY = viewport.height / 2;
  const centre = screenToTile(viewport, centreX, centreY);
  const next: Viewport = { ...viewport, aspect };
  const after = latticeToScreen(next, centre.x, centre.y);
  return {
    ...next,
    originX: next.originX + (centreX - after.x),
    originY: next.originY + (centreY - after.y),
  };
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
export function latticeToScreen(
  viewport: Viewport,
  x: number,
  y: number,
): ScreenPoint {
  const lift =
    viewport.ground === undefined
      ? 0
      : groundHeightAt(viewport.ground, x, y) *
        LIFT_PER_LEVEL *
        viewport.halfWidth;
  return {
    x: viewport.originX + (x + y) * viewport.halfWidth,
    y: viewport.originY + (y - x) * halfHeightOf(viewport) - lift,
  };
}

/**
 * Centre of tile (x, y) in screen pixels.
 *
 * Lattice point (x, y) is the tile's WEST corner and the tile spans to
 * (x+1, y+1), so its centre is half a tile along both axes.
 */
export function tileToScreen(
  viewport: Viewport,
  x: number,
  y: number,
): ScreenPoint {
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
export function screenToTile(
  viewport: Viewport,
  screenX: number,
  screenY: number,
): TilePoint {
  const u = (screenX - viewport.originX) / viewport.halfWidth;
  const flatAt = (level: number): TilePoint => {
    const v =
      (screenY +
        level * LIFT_PER_LEVEL * viewport.halfWidth -
        viewport.originY) /
      halfHeightOf(viewport);
    return { x: (u - v) / 2, y: (u + v) / 2 };
  };
  const ground = viewport.ground;
  if (ground === undefined || ground.maxLevel === 0) return flatAt(0);
  return liftedPoint(ground, flatAt);
}

/** The steps the raised search takes per level before it narrows down. */
const SEARCH_STEPS_PER_LEVEL = 4;

/**
 * The ground point a raised screen point shows. The point at level L under
 * the pointer is where the flat inverse lands with the screen point moved
 * down by L levels, and the ground shows there when its height reaches L.
 * Stepping L down from the highest level, the first that reaches is the
 * front-most, nearest the viewer, so a hill hides what is behind it. A few
 * halvings then settle the crossing. The textured view's shader runs the
 * same search per pixel, so a hit test lands on the tile drawn there.
 */
function liftedPoint(
  ground: GroundHeights,
  flatAt: (level: number) => TilePoint,
): TilePoint {
  const step = 1 / SEARCH_STEPS_PER_LEVEL;
  const reaches = (level: number): boolean => {
    const p = flatAt(level);
    return groundHeightAt(ground, p.x, p.y) >= level;
  };
  for (let level = ground.maxLevel; level > 0; level -= step) {
    if (!reaches(level)) continue;
    // `level` reaches and `level + step` did not, so the crossing is between.
    let low = level;
    let high = Math.min(level + step, ground.maxLevel + step);
    for (let i = 0; i < 6; i++) {
      const mid = (low + high) / 2;
      if (reaches(mid)) low = mid;
      else high = mid;
    }
    return flatAt(low);
  }
  return flatAt(0);
}

/** True when a fractional tile point lands inside a dim x dim map. */
export function isOnMap(point: TilePoint, dim: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < dim && point.y < dim;
}

/**
 * Fractional tile point -> percent-of-map (0-100), the coordinate space
 * `land-placement-design.md`'s panel modules share (viewModel.ts's own
 * `percentToTile`, snapping.ts, dragMath.ts). Deliberately takes the
 * CONTINUOUS `screenToTile` result rather than an already-floored tile
 * index: flooring to a tile and then converting to percent rounds twice and
 * biases a drag toward the map origin by up to half a tile
 * (land-placement-design.md Sec.7.3 brief, "one piece of arithmetic that
 * must not end up in the component"). `0` at `dim <= 0`, matching
 * `snapping.ts`'s own no-op convention for a map with no known size yet.
 */
export function tileToPercent(
  point: TilePoint,
  dim: number,
): { x: number; y: number } {
  if (dim <= 0) return { x: 0, y: 0 };
  return { x: (point.x / dim) * 100, y: (point.y / dim) * 100 };
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
  aspect = TILE_ASPECT,
): Viewport {
  const usableWidth = Math.max(1, width - 2 * padding);
  const usableHeight = Math.max(1, height - 2 * padding);
  // The diamond is 2*dim half-widths across and 2*dim half-heights tall, so
  // each dimension caps the zoom independently and the tighter one wins.
  const byWidth = usableWidth / (2 * dim);
  const byHeight = usableHeight / (2 * dim * aspect);
  const halfWidth = clampHalfWidth(Math.min(byWidth, byHeight));
  return {
    width,
    height,
    halfWidth,
    aspect,
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
  return {
    ...viewport,
    originX: viewport.originX + dx,
    originY: viewport.originY + dy,
  };
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
  if (bounds.left > viewport.width - margin)
    originX -= bounds.left - (viewport.width - margin);
  if (bounds.bottom < margin) originY += margin - bounds.bottom;
  if (bounds.top > viewport.height - margin)
    originY -= bounds.top - (viewport.height - margin);
  return originX === viewport.originX && originY === viewport.originY
    ? viewport
    : { ...viewport, originX, originY };
}
