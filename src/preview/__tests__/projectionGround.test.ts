// Raised ground in the projection (docs/preview-de-textures-design.md
// Sec.13). A point lifts by the ground under it, and screenToTile finds the
// raised point under the pointer, front-most first.

import { describe, expect, it } from "vitest";
import {
  DE_TILE_ASPECT,
  LIFT_PER_LEVEL,
  groundHeightAt,
  latticeToScreen,
  screenToTile,
  type GroundHeights,
  type Viewport,
} from "../render/projection";

/** A 6 by 6 map with a two level hill on its middle 2 by 2, one level a tile around it. */
function hill(): GroundHeights {
  const dim = 6;
  const corners = new Uint8Array((dim + 1) * (dim + 1));
  for (let y = 0; y <= dim; y++)
    for (let x = 0; x <= dim; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      corners[y * (dim + 1) + x] = Math.max(0, 2 - Math.max(0, d - 1));
    }
  return { dim, corners, maxLevel: 2 };
}

const flat: Viewport = {
  width: 800,
  height: 600,
  halfWidth: 40,
  originX: 100,
  originY: 300,
  aspect: DE_TILE_ASPECT,
};
const raised: Viewport = { ...flat, ground: hill() };

describe("groundHeightAt", () => {
  it("blends a tile's corners", () => {
    const g = hill();
    expect(groundHeightAt(g, 3, 3)).toBe(2);
    expect(groundHeightAt(g, 0, 0)).toBe(0);
    // Halfway up the slope between corner (0, 3) at 0 and (1, 3) at 1.
    expect(groundHeightAt(g, 0.5, 3)).toBeCloseTo(0.5);
  });
});

describe("raised projection", () => {
  it("lifts a point by its ground height, half a half width a level", () => {
    const a = latticeToScreen(flat, 3, 3);
    const b = latticeToScreen(raised, 3, 3);
    expect(b.x).toBe(a.x);
    expect(a.y - b.y).toBeCloseTo(2 * LIFT_PER_LEVEL * flat.halfWidth);
  });

  it("leaves flat ground where it was", () => {
    // Corner (0, 0) is at level 0.
    expect(latticeToScreen(raised, 0, 0)).toEqual(latticeToScreen(flat, 0, 0));
  });

  it("round trips through screenToTile where nothing stands in front", () => {
    for (const [x, y] of [
      [3, 3],
      [2.5, 3.2],
      [3.6, 2.4],
      [0.5, 5.5],
    ]) {
      const screen = latticeToScreen(raised, x, y);
      const back = screenToTile(raised, screen.x, screen.y);
      expect(back.x).toBeCloseTo(x, 2);
      expect(back.y).toBeCloseTo(y, 2);
    }
  });

  it("returns a point that draws where the pointer is, behind a hill too", () => {
    // Whatever is hit, it must sit under the pointer once lifted, so the
    // outline drawn for it and the tile clicked are the same.
    for (const [x, y] of [
      [5.2, 0.7],
      [4.5, 1.5],
      [1.5, 1.5],
    ]) {
      const screen = latticeToScreen(raised, x, y);
      const hit = screenToTile(raised, screen.x, screen.y);
      const drawn = latticeToScreen(raised, hit.x, hit.y);
      expect(drawn.x).toBeCloseTo(screen.x, 0);
      expect(drawn.y).toBeCloseTo(screen.y, 0);
    }
  });

  it("finds the hill, not the flat ground it hides", () => {
    // Behind the hill (smaller y - x is farther back on screen) the flat
    // ground's screen point is covered by the raised top. The pointer there
    // lands on the hill.
    const behind = latticeToScreen(raised, 4.5, 1.5);
    const hit = screenToTile(raised, behind.x, behind.y);
    expect(groundHeightAt(raised.ground!, hit.x, hit.y)).toBeGreaterThan(0);
  });
});
