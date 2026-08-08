import { describe, expect, it } from "vitest";
import {
  MAX_HALF_WIDTH,
  MIN_HALF_WIDTH,
  clampToCanvas,
  fitViewport,
  isOnMap,
  latticeToScreen,
  mapBounds,
  panBy,
  screenToTile,
  tileToScreen,
  zoomAt,
  type Viewport,
} from "../render/projection";

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  width: 400,
  height: 300,
  halfWidth: 2,
  originX: 40,
  originY: 150,
  ...overrides,
});

describe("tileToScreen / screenToTile", () => {
  // The property that matters: projecting a tile and un-projecting the
  // result has to land back on the same tile. Every hover read-out and
  // click-through depends on it, and it is the kind of thing that is quietly
  // off by half a tile forever if nobody asserts it.
  it("round-trips every tile of a small map at several zooms", () => {
    for (const halfWidth of [0.4, 1, 2.5, 7, 19]) {
      const vp = viewport({ halfWidth });
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          const screen = tileToScreen(vp, x, y);
          const back = screenToTile(vp, screen.x, screen.y);
          expect(Math.floor(back.x)).toBe(x);
          expect(Math.floor(back.y)).toBe(y);
        }
      }
    }
  });

  it("makes latticeToScreen the exact inverse of screenToTile", () => {
    // The invariant the half-tile offset has to respect: tileToScreen adds
    // it, latticeToScreen does not, and screenToTile inverts the latter.
    // zoomAt applied it twice until this pair was separated, which drifted
    // the map half a tile on every zoom step.
    const vp = viewport({ halfWidth: 3.7 });
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [17.25, 3.75],
      [119, 119],
    ]) {
      const screen = latticeToScreen(vp, x, y);
      const back = screenToTile(vp, screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it("round-trips under pan and zoom", () => {
    let vp = viewport();
    vp = panBy(vp, -37, 22);
    vp = zoomAt(vp, 1.6, 120, 90);
    const screen = tileToScreen(vp, 13, 41);
    const back = screenToTile(vp, screen.x, screen.y);
    expect(Math.floor(back.x)).toBe(13);
    expect(Math.floor(back.y)).toBe(41);
  });
});

describe("orientation", () => {
  // This is the guide's compass, and it is not the one a screenshot
  // suggests: DE renders the grid rotated 45 degrees, so (0,0) is the WEST
  // corner rather than the top-left. docs/elevation-bias-study.md exists
  // because the whole elevation model was fitted against the wrong axis, so
  // the compass gets a test rather than a comment.
  const dim = 100;
  const vp = fitViewport(dim, 400, 400);
  const west = tileToScreen(vp, 0, 0);
  const north = tileToScreen(vp, dim - 1, 0);
  const south = tileToScreen(vp, 0, dim - 1);
  const east = tileToScreen(vp, dim - 1, dim - 1);

  it("puts tile (0,0) at the west corner", () => {
    expect(west.x).toBeLessThan(north.x);
    expect(west.x).toBeLessThan(south.x);
    expect(west.x).toBeLessThan(east.x);
  });

  it("puts (max,0) north and (0,max) south", () => {
    expect(north.y).toBeLessThan(west.y);
    expect(south.y).toBeGreaterThan(west.y);
    expect(Math.abs(north.x - south.x)).toBeLessThan(1e-9);
  });

  it("puts (max,max) at the east corner", () => {
    expect(east.x).toBeGreaterThan(north.x);
    expect(east.x).toBeGreaterThan(south.x);
    expect(Math.abs(east.y - west.y)).toBeLessThan(1e-9);
  });
});

describe("fitViewport", () => {
  it("keeps the whole map inside the canvas", () => {
    for (const [dim, width, height] of [
      [120, 288, 288],
      [200, 400, 220],
      [252, 180, 600],
      [480, 1000, 1000],
    ]) {
      const vp = fitViewport(dim, width, height);
      const bounds = mapBounds(vp, dim);
      expect(bounds.left).toBeGreaterThanOrEqual(-0.001);
      expect(bounds.top).toBeGreaterThanOrEqual(-0.001);
      expect(bounds.right).toBeLessThanOrEqual(width + 0.001);
      expect(bounds.bottom).toBeLessThanOrEqual(height + 0.001);
    }
  });

  it("centres the map", () => {
    const vp = fitViewport(120, 300, 260);
    const bounds = mapBounds(vp, 120);
    expect(bounds.left + bounds.right).toBeCloseTo(300, 6);
    expect(bounds.top + bounds.bottom).toBeCloseTo(260, 6);
  });
});

describe("zoomAt", () => {
  it("keeps the tile under the anchor pinned to the anchor", () => {
    const vp = viewport();
    const anchorX = 217;
    const anchorY = 91;
    const before = screenToTile(vp, anchorX, anchorY);
    const zoomed = zoomAt(vp, 2.3, anchorX, anchorY);
    const after = screenToTile(zoomed, anchorX, anchorY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps rather than running away in either direction", () => {
    let vp = viewport({ halfWidth: MAX_HALF_WIDTH });
    vp = zoomAt(vp, 10, 100, 100);
    expect(vp.halfWidth).toBe(MAX_HALF_WIDTH);
    vp = zoomAt(viewport({ halfWidth: MIN_HALF_WIDTH }), 0.01, 100, 100);
    expect(vp.halfWidth).toBe(MIN_HALF_WIDTH);
  });
});

describe("isOnMap", () => {
  it("rejects points outside the grid", () => {
    expect(isOnMap({ x: 0, y: 0 }, 120)).toBe(true);
    expect(isOnMap({ x: 119.9, y: 119.9 }, 120)).toBe(true);
    expect(isOnMap({ x: -0.1, y: 5 }, 120)).toBe(false);
    expect(isOnMap({ x: 5, y: 120 }, 120)).toBe(false);
  });
});

describe("clampToCanvas", () => {
  it("pulls a map dragged off-screen back into reach", () => {
    const vp = viewport({ halfWidth: 1 });
    const lost = panBy(vp, -5000, 0);
    const rescued = clampToCanvas(lost, 120);
    const bounds = mapBounds(rescued, 120);
    expect(bounds.right).toBeGreaterThan(0);
  });

  it("leaves a map that is already visible alone", () => {
    const vp = fitViewport(120, 400, 300);
    expect(clampToCanvas(vp, 120)).toBe(vp);
  });
});
