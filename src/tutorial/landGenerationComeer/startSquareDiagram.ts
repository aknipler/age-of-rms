// The geometry of the "start-square-overlap" diagram (diagrams.tsx), kept out
// of the component so a plain Node test can check the picture's claim
// against the overlap rule and the preview's own projection.
//
// The claim is the one "Fixing the island-joining problem" makes. Two
// players the same distance apart can have starting squares that overlap or
// that leave water between them, depending on how the pair is lined up. A
// land's starting square follows the tile grid, so two squares overlap when
// the Chebyshev distance between their centres (the larger of the x and y
// offsets) is at most 2 * base_size (docs/tutorial-islands-design.md Sec.3,
// "The overlap rule"). At a fixed distance that offset is smallest when the
// pair lies along a tile diagonal, x = y or x + y = dim. projection.ts turns
// those into the screen's horizontal and vertical, so on screen the squares
// meet corner to corner when the players are one above the other or side by
// side, and face each other flat side to flat side when they are lined up
// along an edge of the map.

import {
  latticeToScreen,
  type ScreenPoint,
} from "../../preview/render/projection";
import { OVERSIZED_BASE_SIZE } from "./comeerValues";

/** Tiny, the map size the Comeer tutorial pins. */
export const DIAGRAM_MAP_DIM = 120;

/** The starting squares' radius, the oversized base_size the learner has at "Spot the problem". */
export const DIAGRAM_BASE_SIZE = OVERSIZED_BASE_SIZE;

/**
 * Half the tile offset of the overlapping pair along each axis. The pair sits
 * 2 * 11 = 22 tiles apart in x and in y, which leaves a 5 tile overlap at
 * base_size 13. The same straight-line distance lined up along an edge is
 * 22 * sqrt(2) = 31.1 tiles in x alone, which leaves 4 tiles of water. That
 * is about the most of both a picture can show at once. A closer pair
 * overlaps more and leaves less water, a farther one the reverse.
 */
const DIAGONAL_HALF_OFFSET = 11;

/** A tile-space point, continuous, as projection.ts's `latticeToScreen` takes. */
export interface TileCentre {
  x: number;
  y: number;
}

export interface DiagramPanel {
  /** The two player centres, in tile space. */
  players: [TileCentre, TileCentre];
  /** Each player's starting square on screen, a diamond of four corners. */
  squares: [ScreenPoint[], ScreenPoint[]];
  /** Where the two squares overlap on screen, or null when they do not. */
  overlap: ScreenPoint[] | null;
  /** The ring both players sit on. */
  ring: { centre: ScreenPoint; radius: number };
}

export interface DiagramGeometry {
  /** The map's four corners on screen, west, north, east, south. */
  map: ScreenPoint[];
  /** Lined up one above the other. The squares overlap. */
  lined: DiagramPanel;
  /** The same distance, lined up along an edge. The squares are clear. */
  edge: DiagramPanel;
  /** Screen width and height of one panel, the map's bounding box. */
  width: number;
  height: number;
}

/**
 * Screen space with the map's west corner at the left edge and its north
 * corner at the top, one unit per tile half-width.
 */
const VIEWPORT = {
  width: 0,
  height: 0,
  halfWidth: 1,
  originX: 0,
  originY: DIAGRAM_MAP_DIM,
};

function toScreen(x: number, y: number): ScreenPoint {
  return latticeToScreen(VIEWPORT, x, y);
}

/**
 * A tile-space box from (x0, y0) to (x1, y1) on screen, as its west, north,
 * east and south corners.
 */
function boxCorners(x0: number, y0: number, x1: number, y1: number) {
  return [
    toScreen(x0, y0),
    toScreen(x1, y0),
    toScreen(x1, y1),
    toScreen(x0, y1),
  ];
}

/**
 * A square of radius `base_size` round a centre, as the tiles it covers.
 * `2 * base_size + 1` tiles across, so its edges are half a tile beyond the
 * outermost tile centres.
 */
function squareBox(c: TileCentre) {
  const r = DIAGRAM_BASE_SIZE + 0.5;
  return { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r };
}

function panel(players: [TileCentre, TileCentre]): DiagramPanel {
  const [a, b] = players.map(squareBox);
  const overlap = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  const mid = DIAGRAM_MAP_DIM / 2;
  const tileRadius = Math.hypot(players[0].x - mid, players[0].y - mid);
  return {
    players,
    squares: [
      boxCorners(a.x0, a.y0, a.x1, a.y1),
      boxCorners(b.x0, b.y0, b.x1, b.y1),
    ],
    overlap:
      overlap.x0 < overlap.x1 && overlap.y0 < overlap.y1
        ? boxCorners(overlap.x0, overlap.y0, overlap.x1, overlap.y1)
        : null,
    // A tile-space circle is a screen circle sqrt(2) times as big, since
    // projection.ts turns a tile 45 degrees with no squash (TILE_ASPECT 1).
    ring: { centre: toScreen(mid, mid), radius: tileRadius * Math.SQRT2 },
  };
}

export function startSquareDiagram(): DiagramGeometry {
  const mid = DIAGRAM_MAP_DIM / 2;
  const t = DIAGONAL_HALF_OFFSET;
  // Along x + y = dim, the line through the north and south corners, so one
  // player sits straight above the other. This is how the pinned seed lines
  // them up (startSquareDiagram.test.ts generates it and checks).
  const lined: [TileCentre, TileCentre] = [
    { x: mid + t, y: mid - t },
    { x: mid - t, y: mid + t },
  ];
  // The same distance along the x axis alone, parallel to two of the map's
  // edges on screen.
  const s = t * Math.SQRT2;
  const edge: [TileCentre, TileCentre] = [
    { x: mid + s, y: mid },
    { x: mid - s, y: mid },
  ];
  return {
    map: boxCorners(0, 0, DIAGRAM_MAP_DIM, DIAGRAM_MAP_DIM),
    lined: panel(lined),
    edge: panel(edge),
    width: 2 * DIAGRAM_MAP_DIM,
    height: 2 * DIAGRAM_MAP_DIM,
  };
}
