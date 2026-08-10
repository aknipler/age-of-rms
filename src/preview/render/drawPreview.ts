import type { PreviewResult, StageSnapshot } from "../generator/types";
import { categoryColor, cssColor, playerColor, type Rgb } from "./palette";
import { halfHeightOf, tileToScreen, type Viewport } from "./projection";
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
 * Wraps the pure bitmap in an offscreen canvas, which is what `drawImage`
 * accepts. Rebuilt only when the result changes — never per frame.
 */
export function createBitmapCanvas(bitmap: TerrainBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.dim;
  canvas.height = bitmap.dim;
  const ctx = canvas.getContext("2d");
  // A 2D context is only null if the canvas already has a context of another
  // kind, which cannot happen for one we just made — but the type says it
  // can, so say what happens rather than assert it away.
  if (ctx !== null) {
    ctx.putImageData(new ImageData(bitmap.pixels, bitmap.dim, bitmap.dim), 0, 0);
  }
  return canvas;
}

export interface PreviewScene {
  result: PreviewResult;
  /** The grid being drawn — S6 for both toggle positions (Sec.5). */
  snapshot: StageSnapshot;
  /** Output of createBitmapCanvas for that snapshot. */
  terrain: HTMLCanvasElement;
  /** Tile under the pointer, drawn with an outline. */
  highlight?: { x: number; y: number } | null;
  /** Tile the user clicked, drawn with its own heavier outline and kept until they click it again. */
  selection?: { x: number; y: number } | null;
  /**
   * Object names to leave undrawn (the reference table's Preview Obj. List).
   *
   * A VIEW filter and nothing more: the objects are still in `result.objects`,
   * still counted in the table, still in the tile readout. Hiding them here
   * rather than filtering the array upstream is what keeps that true — a
   * filtered array would make the hidden objects disappear from the readout
   * and the counts as well, which turns a display control into something that
   * looks like it changed the generation.
   */
  hiddenObjects?: ReadonlySet<string>;
}

/**
 * Draws one frame.
 *
 * The caller owns the device-pixel-ratio base transform (see PreviewCanvas):
 * everything below is in CSS pixels and composes onto whatever is already
 * there, which is why this uses `transform` rather than `setTransform`.
 */
export function drawPreview(ctx: CanvasRenderingContext2D, viewport: Viewport, scene: PreviewScene): void {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawTerrain(ctx, viewport, scene);
  drawMapEdge(ctx, viewport, scene.snapshot.dim);
  drawObjects(ctx, viewport, scene.result, scene.hiddenObjects);
  drawPlayers(ctx, viewport, scene.result);
  // Last of the content layers, so a mark is never hidden by the very objects
  // or player flag sitting on the land it is complaining about.
  drawFailureMarks(ctx, viewport, scene.result);
  if (scene.highlight) {
    drawTileOutline(ctx, viewport, scene.highlight.x, scene.highlight.y, HIGHLIGHT, 1.5);
  }
  // After the hover outline, so the selection stays visible when the pointer
  // happens to be resting on the tile that is already selected.
  if (scene.selection) {
    drawTileOutline(ctx, viewport, scene.selection.x, scene.selection.y, SELECTION, 2.5);
  }
}

/**
 * The whole terrain layer in one drawImage.
 *
 * A canvas transform maps (x, y) to (a*x + c*y + e, b*x + d*y + f). Our
 * projection is screenX = (x + y) * halfWidth and screenY = (y - x) *
 * halfHeight (projection.ts), so a = c = halfWidth, b = -halfHeight,
 * d = halfHeight. Under that matrix the bitmap's unit-square pixel at (x, y)
 * lands exactly on tile (x, y)'s diamond — the image is not "rotated by 45
 * degrees and hoped for", the transform IS the projection.
 */
function drawTerrain(ctx: CanvasRenderingContext2D, viewport: Viewport, scene: PreviewScene): void {
  const halfHeight = halfHeightOf(viewport);
  ctx.save();
  // Zoomed in, nearest-neighbour keeps tile edges crisp and honest about
  // where a tile boundary is. Zoomed out, tiles are sub-pixel and
  // nearest-neighbour would silently DROP whole rows of them — a lake could
  // disappear — so smoothing goes back on below roughly two pixels a tile.
  ctx.imageSmoothingEnabled = viewport.halfWidth < 2;
  ctx.transform(
    viewport.halfWidth,
    -halfHeight,
    viewport.halfWidth,
    halfHeight,
    viewport.originX,
    viewport.originY,
  );
  ctx.drawImage(scene.terrain, 0, 0);
  ctx.restore();
}

function drawMapEdge(ctx: CanvasRenderingContext2D, viewport: Viewport, dim: number): void {
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

function drawObjects(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  result: PreviewResult,
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
        object.player === undefined ? "rgba(0, 0, 0, 0.55)" : cssColor(playerColor(object.player));
      ctx.lineWidth = object.player === undefined ? 1 : 1.5;
      ctx.stroke();
    }
  }
}

function drawPlayers(ctx: CanvasRenderingContext2D, viewport: Viewport, result: PreviewResult): void {
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
function drawFailureMarks(ctx: CanvasRenderingContext2D, viewport: Viewport, result: PreviewResult): void {
  const size = Math.max(9, Math.min(20, viewport.halfWidth * 2.4));
  const half = size / 2;
  for (const mark of result.failureMarks) {
    const point = tileToScreen(viewport, mark.x, mark.y);
    if (offCanvas(point.x, point.y, viewport, size)) continue;
    // Drawn sitting ON the tile rather than centred over it — the apex points
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

function offCanvas(x: number, y: number, viewport: Viewport, margin: number): boolean {
  return x < -margin || y < -margin || x > viewport.width + margin || y > viewport.height + margin;
}

/** Black or white, whichever the player colour can actually be read against. */
function readableInk(color: Rgb): string {
  // Rec. 601 luma — the cheap perceptual brightness, good enough to pick ink.
  const luma = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
  return luma > 150 ? "#101010" : "#ffffff";
}
