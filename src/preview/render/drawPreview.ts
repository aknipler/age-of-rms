import type { OverlayRole, OverlayShape } from "../../../tools-api/index";
import type { PreviewWireResult, StageSnapshot } from "../generator/types";
import { categoryColor, cssColor, playerColor, type Rgb } from "./palette";
import {
  halfHeightOf,
  latticeToScreen,
  tileToScreen,
  type ScreenPoint,
  type TilePoint,
  type Viewport,
} from "./projection";
import type { TerrainBitmap } from "./terrainBitmap";

// The canvas half of the renderer. Everything that touches a 2D context lives
// here; the maths, the colours and the bitmap are pure modules next door.

const BACKGROUND = "#14161a";
const MAP_EDGE = "rgba(255, 255, 255, 0.35)";
const HIGHLIGHT = "rgba(255, 255, 255, 0.85)";
// Amber rather than a second white, and drawn thicker: the selected tile has
// to stay findable once the pointer has moved away, including while the
// hover outline sits on a neighbouring tile.
const SELECTION = "rgba(255, 196, 61, 0.95)";
// Red rather than the selection's amber, and a TRIANGLE rather than a circle
// or a diamond: objects are circles and both outlines are diamonds, so a
// failure mark has to be findable by shape alone at the zoom levels where
// colour is two pixels wide.
const FAILURE_FILL = "rgba(226, 62, 50, 0.95)";
const FAILURE_EDGE = "rgba(0, 0, 0, 0.8)";

/**
 * `OverlayShape.role` colours (Sec.3.4 layer 2: "themed by role, never by
 * hex, so an overlay reads in both app themes"). Fixed values rather than a
 * read of the app's light/dark CSS custom properties, matching every other
 * colour in this file (BACKGROUND, HIGHLIGHT, SELECTION, FAILURE_FILL above)
 * the canvas's own background is always dark regardless of app theme, so
 * "themes with the app" here means "reads against a dark canvas", not
 * "follows light/dark mode". `secondary` and `error` intentionally reuse
 * SELECTION's and FAILURE_FILL's own colours, so a handle or an error shape
 * reads as the same kind of thing those existing marks already mean.
 */
const OVERLAY_COLORS: Record<OverlayRole, string> = {
  primary: "rgba(94, 174, 255, 0.9)",
  secondary: SELECTION,
  warning: "rgba(240, 173, 60, 0.9)",
  error: FAILURE_FILL,
  muted: MAP_EDGE,
};

/**
 * Wraps the pure bitmap in an offscreen canvas, which is what `drawImage`
 * accepts. Rebuilt only when the result changes. Never per frame.
 */
export function createBitmapCanvas(bitmap: TerrainBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.dim;
  canvas.height = bitmap.dim;
  const ctx = canvas.getContext("2d");
  // A 2D context is only null if the canvas already has a context of another
  // kind, which cannot happen for one we just made, but the type says it
  // can, so say what happens rather than assert it away.
  if (ctx !== null) {
    ctx.putImageData(
      new ImageData(bitmap.pixels, bitmap.dim, bitmap.dim),
      0,
      0,
    );
  }
  return canvas;
}

/**
 * The full-fidelity content layer, a real generation's terrain, objects,
 * players and failure marks. OPTIONAL on `PreviewScene` (slice-4b item 2,
 * land-placement-design.md Sec.3.4/Sec.3.5): a canvas drawing only
 * `mapOverlay` shapes (a report tool with no base map of its own, or the
 * Land Placement panel before its first generation lands) omits this
 * entirely and gets the background plus whatever shapes it supplied, no
 * terrain bitmap to build, no result to have.
 */
export interface PreviewBaseLayer {
  result: PreviewWireResult;
  /** The grid being drawn, S6 for both toggle positions (Sec.5). */
  snapshot: StageSnapshot;
  /** Output of createBitmapCanvas for that snapshot. */
  terrain: HTMLCanvasElement;
  /**
   * Object names to leave undrawn (the reference table's Preview Obj. List).
   *
   * A VIEW filter and nothing more: the objects are still in `result.objects`,
   * still counted in the table, still in the tile readout. Hiding them here
   * rather than filtering the array upstream is what keeps that true, a
   * filtered array would make the hidden objects disappear from the readout
   * and the counts as well, which turns a display control into something that
   * looks like it changed the generation.
   */
  hiddenObjects?: ReadonlySet<string>;
}

export interface PreviewScene {
  /** Absent draws just the background plus `overlayShapes`. See `PreviewBaseLayer`'s own doc. */
  base?: PreviewBaseLayer;
  /**
   * Sec.3.4 layer 2: declarative shapes any tool (built-in or, over the wire,
   * external) can draw on this same canvas, Land Placement's own land
   * circles and chain edges are the reference implementation of this path,
   * not a special case of it. Drawn between the failure marks and the hover
   * highlight, so a shape sits above the base map but below either outline.
   */
  overlayShapes?: readonly OverlayShape[];
  /**
   * Draws the map's orientation aids over everything else: the x and y axes
   * at the origin and, with `sideNames`, a name on each side. `dim` is the
   * map's side length, which the aids need and the scene does not otherwise
   * carry when there is no `base`. Off by default so a canvas that does not
   * ask stays as it was. The app's own preview asks for both, the Land
   * Placement panel for the axes only, since its own overlay shapes already
   * mark the map and the side names would sit under its circles.
   */
  orientation?: { dim: number; sideNames: boolean };
  /** Tile under the pointer, drawn with an outline. */
  highlight?: { x: number; y: number } | null;
  /** Tile the user clicked, drawn with its own heavier outline and kept until they click it again. */
  selection?: { x: number; y: number } | null;
}

/**
 * Draws one frame.
 *
 * The caller owns the device-pixel-ratio base transform (see PreviewCanvas):
 * everything below is in CSS pixels and composes onto whatever is already
 * there, which is why this uses `transform` rather than `setTransform`.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  scene: PreviewScene,
): void {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  if (scene.base) {
    drawTerrain(ctx, viewport, scene.base);
    drawMapEdge(ctx, viewport, scene.base.snapshot.dim);
    drawObjects(ctx, viewport, scene.base.result, scene.base.hiddenObjects);
    drawPlayers(ctx, viewport, scene.base.result);
    // Last of the base-layer content, so a mark is never hidden by the very
    // objects or player flag sitting on the land it is complaining about.
    drawFailureMarks(ctx, viewport, scene.base.result);
  }
  if (scene.overlayShapes && scene.overlayShapes.length > 0) {
    drawOverlay(ctx, viewport, scene.overlayShapes);
  }
  if (scene.orientation) {
    drawOrientation(
      ctx,
      viewport,
      scene.orientation.dim,
      scene.orientation.sideNames,
    );
  }
  if (scene.highlight) {
    drawTileOutline(
      ctx,
      viewport,
      scene.highlight.x,
      scene.highlight.y,
      HIGHLIGHT,
      1.5,
    );
  }
  // After the hover outline, so the selection stays visible when the pointer
  // happens to be resting on the tile that is already selected.
  if (scene.selection) {
    drawTileOutline(
      ctx,
      viewport,
      scene.selection.x,
      scene.selection.y,
      SELECTION,
      2.5,
    );
  }
}

/**
 * The whole terrain layer in one drawImage.
 *
 * A canvas transform maps (x, y) to (a*x + c*y + e, b*x + d*y + f). Our
 * projection is screenX = (x + y) * halfWidth and screenY = (y - x) *
 * halfHeight (projection.ts), so a = c = halfWidth, b = -halfHeight,
 * d = halfHeight. Under that matrix the bitmap's unit-square pixel at (x, y)
 * lands exactly on tile (x, y)'s diamond, the image is not "rotated by 45
 * degrees and hoped for", the transform IS the projection.
 */
function drawTerrain(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  base: PreviewBaseLayer,
): void {
  const halfHeight = halfHeightOf(viewport);
  ctx.save();
  // Zoomed in, nearest-neighbour keeps tile edges crisp and honest about
  // where a tile boundary is. Zoomed out, tiles are sub-pixel and
  // nearest-neighbour would silently DROP whole rows of them, a lake could
  // disappear, so smoothing goes back on below roughly two pixels a tile.
  ctx.imageSmoothingEnabled = viewport.halfWidth < 2;
  ctx.transform(
    viewport.halfWidth,
    -halfHeight,
    viewport.halfWidth,
    halfHeight,
    viewport.originX,
    viewport.originY,
  );
  ctx.drawImage(base.terrain, 0, 0);
  ctx.restore();
}

function drawMapEdge(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  dim: number,
): void {
  const west = tileToScreen(viewport, -0.5, -0.5);
  const north = tileToScreen(viewport, dim - 0.5, -0.5);
  const east = tileToScreen(viewport, dim - 0.5, dim - 0.5);
  const south = tileToScreen(viewport, -0.5, dim - 0.5);
  ctx.beginPath();
  ctx.moveTo(west.x, west.y);
  ctx.lineTo(north.x, north.y);
  ctx.lineTo(east.x, east.y);
  ctx.lineTo(south.x, south.y);
  ctx.closePath();
  ctx.strokeStyle = MAP_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Below this on-screen map width the axis arrows would crowd the map and the canvas, so they are left out. */
const MIN_AXES_MAP_WIDTH = 180;
/**
 * Below this the side names are left out but the axes stay. A side is only
 * about 0.7 of the map's width long, and the axis letters sit 66 px along it
 * from the origin, so on a smaller map the letters run into the names of the
 * left and top sides.
 */
const MIN_SIDE_NAMES_MAP_WIDTH = 240;
/** Text size of the side names and the axis letters, in CSS pixels. */
const ORIENTATION_FONT_PX = 14;
/** How far outside the map's edge the centre of a label or an arrow sits. Clears the outline and half the text height. */
const ORIENTATION_OFFSET = 15;
const AXIS_ARROW_LENGTH = 30;
const AXIS_ARROW_HEAD = 8;
/** How far along its side from the origin corner an axis arrow starts. Far enough that the arrow and its offset stay on the canvas at the corner, where the map nearly touches the canvas edge. */
const AXIS_ARROW_START = 26;
/** Gap between an arrow's head and its letter. */
const AXIS_LETTER_GAP = 10;
/** Neutral on purpose. The aids sit on the canvas background, outside the map, and a colour would read as a map layer. */
const ORIENTATION_INK = "rgba(255, 255, 255, 0.95)";

/** Unit vector on screen. */
function normalized(x: number, y: number): ScreenPoint {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * Text with a dark halo under the fill, centred on (x, y) and turned by
 * `angle` radians so it runs along a direction. The halo keeps it readable if
 * the map is panned until a label lies over terrain.
 */
function drawRotatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = ORIENTATION_INK;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * The angle that turns text to run along `direction`, kept readable: a
 * direction pointing left would draw the text upside down, so it flips to
 * the opposite one.
 */
function readableAngle(direction: ScreenPoint): number {
  const angle = Math.atan2(direction.y, direction.x);
  if (angle > Math.PI / 2) return angle - Math.PI;
  if (angle <= -Math.PI / 2) return angle + Math.PI;
  return angle;
}

/**
 * An arrow from `from` to `to`, haloed like the text. The head is a filled
 * triangle; the shaft stops at its base so the round line cap does not poke
 * through the point.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: ScreenPoint,
  to: ScreenPoint,
): void {
  const direction = normalized(to.x - from.x, to.y - from.y);
  const baseX = to.x - direction.x * AXIS_ARROW_HEAD;
  const baseY = to.y - direction.y * AXIS_ARROW_HEAD;
  // Perpendicular to the shaft, half a head wide on each side.
  const wingX = -direction.y * AXIS_ARROW_HEAD * 0.55;
  const wingY = direction.x * AXIS_ARROW_HEAD * 0.55;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(baseX, baseY);
  };
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(baseX + wingX, baseY + wingY);
    ctx.lineTo(baseX - wingX, baseY - wingY);
    ctx.closePath();
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Halo pass, then ink pass.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.lineWidth = 4.5;
  trace();
  ctx.stroke();
  head();
  ctx.stroke();
  ctx.strokeStyle = ORIENTATION_INK;
  ctx.fillStyle = ORIENTATION_INK;
  ctx.lineWidth = 2;
  trace();
  ctx.stroke();
  head();
  ctx.fill();
}

/**
 * Orientation aids, all drawn OUTSIDE the map's outline: the x and y axis
 * arrows beside the two sides that meet at the origin, and, when `sideNames`
 * is set, a name beside each of the four sides. Every piece is turned to run
 * parallel to the side it belongs to. None is drawn on the map itself, which
 * stays unmarked.
 *
 * Every position and direction here comes from `latticeToScreen`, the same
 * function the terrain and objects go through, and none is typed in as "up
 * and to the right". If the projection's squash or rotation is ever revised
 * (projection.ts keeps TILE_ASPECT as the one knob), these follow it.
 *
 * The sides are named the way RMS names its borders: left_border is the
 * x = 0 side (south west on screen), bottom_border the y = max side (south
 * east), right_border the x = max side (north east) and top_border the y = 0
 * side (north west). The origin, land_position 0 0, is the corner where the
 * left and top sides meet. +x grows along the top side and +y along the left
 * side, so the x arrow runs beside the top side and the y arrow beside the
 * left one.
 */
function drawOrientation(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  dim: number,
  sideNames: boolean,
): void {
  const mapWidth = 2 * dim * viewport.halfWidth;
  if (dim <= 0 || mapWidth < MIN_AXES_MAP_WIDTH) return;
  const showNames = sideNames && mapWidth >= MIN_SIDE_NAMES_MAP_WIDTH;
  const origin = latticeToScreen(viewport, 0, 0);
  const centre = latticeToScreen(viewport, dim / 2, dim / 2);

  ctx.save();
  ctx.font = `bold ${ORIENTATION_FONT_PX}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // A side is the segment between two lattice corners. Its name sits at the
  // middle, pushed away from the map centre, and runs along the segment.
  const side = (from: TilePoint, to: TilePoint) => {
    const a = latticeToScreen(viewport, from.x, from.y);
    const b = latticeToScreen(viewport, to.x, to.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return {
      mid,
      along: normalized(b.x - a.x, b.y - a.y),
      outward: normalized(mid.x - centre.x, mid.y - centre.y),
    };
  };
  const top = side({ x: 0, y: 0 }, { x: dim, y: 0 });
  const left = side({ x: 0, y: 0 }, { x: 0, y: dim });
  const bottom = side({ x: 0, y: dim }, { x: dim, y: dim });
  const right = side({ x: dim, y: 0 }, { x: dim, y: dim });

  if (showNames) {
    const names: [string, typeof top][] = [
      ["Left", left],
      ["Bottom", bottom],
      ["Right", right],
      ["Top", top],
    ];
    for (const [name, edge] of names) {
      drawRotatedText(
        ctx,
        name,
        edge.mid.x + edge.outward.x * ORIENTATION_OFFSET,
        edge.mid.y + edge.outward.y * ORIENTATION_OFFSET,
        readableAngle(edge.along),
      );
    }
  }

  // +x runs along the top side from the origin, +y along the left side, so
  // each arrow lies beside its own side, shifted out of the map.
  const axes = [
    { name: "x", edge: top },
    { name: "y", edge: left },
  ];
  for (const { name, edge } of axes) {
    const start = {
      x:
        origin.x +
        edge.along.x * AXIS_ARROW_START +
        edge.outward.x * ORIENTATION_OFFSET,
      y:
        origin.y +
        edge.along.y * AXIS_ARROW_START +
        edge.outward.y * ORIENTATION_OFFSET,
    };
    const tip = {
      x: start.x + edge.along.x * AXIS_ARROW_LENGTH,
      y: start.y + edge.along.y * AXIS_ARROW_LENGTH,
    };
    drawArrow(ctx, start, tip);
    drawRotatedText(
      ctx,
      name,
      tip.x + edge.along.x * AXIS_LETTER_GAP,
      tip.y + edge.along.y * AXIS_LETTER_GAP,
      readableAngle(edge.along),
    );
  }
  ctx.restore();
}

function drawObjects(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  result: PreviewWireResult,
  hidden?: ReadonlySet<string>,
): void {
  const radius = Math.max(1.1, Math.min(5, viewport.halfWidth * 0.75));
  const outlined = radius >= 2.4;
  for (const object of result.objects) {
    if (hidden !== undefined && hidden.has(object.objectRef)) continue;
    const point = tileToScreen(viewport, object.x, object.y);
    if (offCanvas(point.x, point.y, viewport, radius)) continue;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(categoryColor(object.category));
    ctx.fill();
    if (outlined) {
      // An owned object gets its owner's colour as a ring rather than as its
      // fill: the fill has to keep saying WHAT the thing is, since that is
      // the question the map is being read for.
      ctx.strokeStyle =
        object.player === undefined
          ? "rgba(0, 0, 0, 0.55)"
          : cssColor(playerColor(object.player));
      ctx.lineWidth = object.player === undefined ? 1 : 1.5;
      ctx.stroke();
    }
  }
}

function drawPlayers(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  result: PreviewWireResult,
): void {
  const size = Math.max(7, Math.min(18, viewport.halfWidth * 2.6));
  for (const marker of result.players) {
    const point = tileToScreen(viewport, marker.x, marker.y);
    if (offCanvas(point.x, point.y, viewport, size)) continue;
    const color = playerColor(marker.player);
    ctx.beginPath();
    ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(color);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (size >= 12) {
      ctx.fillStyle = readableInk(color);
      ctx.font = `bold ${Math.round(size * 0.68)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(marker.player), point.x, point.y + 0.5);
    }
  }
}

/**
 * Sec.15 item 5's marks: a warning triangle on each land the picture is lying
 * about (`FailureMark` in generator/types.ts carries the measurement that
 * decided which those are).
 *
 * A FLOOR of 9px and no ceiling-driven fade, unlike objects, which shrink to
 * 1.1px and vanish into the terrain when zoomed out. The two want opposite
 * things: an object dot is one of thousands and reading the map means reading
 * their density, so it may become texture; a mark is one of a handful and its
 * whole job is to be noticed from the zoom level the map opens at.
 */
function drawFailureMarks(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  result: PreviewWireResult,
): void {
  const size = Math.max(9, Math.min(20, viewport.halfWidth * 2.4));
  const half = size / 2;
  for (const mark of result.failureMarks) {
    const point = tileToScreen(viewport, mark.x, mark.y);
    if (offCanvas(point.x, point.y, viewport, size)) continue;
    // Drawn sitting ON the tile rather than centred over it, the apex points
    // at the tile the mark is about, which matters once two marks are close
    // enough that only their tips separate them.
    const apexY = point.y - size * 0.86;
    ctx.beginPath();
    ctx.moveTo(point.x, apexY);
    ctx.lineTo(point.x + half, point.y);
    ctx.lineTo(point.x - half, point.y);
    ctx.closePath();
    ctx.fillStyle = FAILURE_FILL;
    ctx.fill();
    ctx.strokeStyle = FAILURE_EDGE;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    if (size >= 12) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(size * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", point.x, apexY + size * 0.62);
    }
  }
}

/**
 * Screen radius of a tile-space circle of radius `rTiles` centred at
 * (cx, cy). Measured rather than derived from `viewport.halfWidth` alone:
 * the diamond projection is a linear map of tile space, so a tile-space
 * circle becomes a screen circle only because `TILE_ASPECT` (projection.ts)
 * currently makes that map a scaled rotation, true today, and this stays
 * correct without re-deriving the algebra if that ever changes, since it
 * just measures how far the transform sends one tile-length in practice.
 */
function circleScreenRadius(
  viewport: Viewport,
  cx: number,
  cy: number,
  rTiles: number,
): number {
  const centre = tileToScreen(viewport, cx, cy);
  const edge = tileToScreen(viewport, cx + rTiles, cy);
  return Math.hypot(edge.x - centre.x, edge.y - centre.y);
}

/**
 * Sec.3.4 layer 2: one block's worth of declarative shapes, in tile
 * coordinates. Drawn after the base layer and before the hover/selection
 * outlines (`drawPreview`'s own ordering), additive, and it changes no
 * existing layer.
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  shapes: readonly OverlayShape[],
): void {
  for (const shape of shapes) {
    const color = OVERLAY_COLORS[shape.role];
    switch (shape.kind) {
      case "point": {
        const p = tileToScreen(viewport, shape.x, shape.y);
        const r = shape.radiusPx ?? 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        break;
      }
      case "circle": {
        const p = tileToScreen(viewport, shape.x, shape.y);
        const r = circleScreenRadius(viewport, shape.x, shape.y, shape.rTiles);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (shape.fill) {
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case "line": {
        const from = tileToScreen(viewport, shape.from.x, shape.from.y);
        const to = tileToScreen(viewport, shape.to.x, shape.to.y);
        ctx.save();
        if (shape.dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "polyline": {
        if (shape.points.length === 0) break;
        ctx.beginPath();
        shape.points.forEach((point, i) => {
          const p = tileToScreen(viewport, point.x, point.y);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (shape.closed) ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case "label": {
        const p = tileToScreen(viewport, shape.x, shape.y);
        ctx.fillStyle = color;
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(shape.text, p.x, p.y - 4);
        break;
      }
      case "handle": {
        const p = tileToScreen(viewport, shape.x, shape.y);
        const size = 5;
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
  }
}

/** One tile's diamond, stroked. Shared by the hover highlight and the selection, which differ only in colour and weight. */
function drawTileOutline(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  x: number,
  y: number,
  stroke: string,
  lineWidth: number,
): void {
  const halfHeight = halfHeightOf(viewport);
  const centre = tileToScreen(viewport, x, y);
  ctx.beginPath();
  ctx.moveTo(centre.x - viewport.halfWidth, centre.y);
  ctx.lineTo(centre.x, centre.y - halfHeight);
  ctx.lineTo(centre.x + viewport.halfWidth, centre.y);
  ctx.lineTo(centre.x, centre.y + halfHeight);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function offCanvas(
  x: number,
  y: number,
  viewport: Viewport,
  margin: number,
): boolean {
  return (
    x < -margin ||
    y < -margin ||
    x > viewport.width + margin ||
    y > viewport.height + margin
  );
}

/** Black or white, whichever the player colour can actually be read against. */
function readableInk(color: Rgb): string {
  // Rec. 601 luma, the cheap perceptual brightness, good enough to pick ink.
  const luma = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
  return luma > 150 ? "#101010" : "#ffffff";
}
