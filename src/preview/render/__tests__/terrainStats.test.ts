// The Terrain Stats box's counts and the glow's outline. The outline is
// checked against `latticeToScreen`, the projection every other draw call
// goes through, on flat and raised ground.

import { describe, expect, it } from "vitest";
import { latticeToScreen, type Viewport } from "../projection";
import {
  alternatingGlow,
  formatShare,
  glowAlpha,
  glowRuns,
  maskRuns,
  GLOW_PERIOD_MS,
  terrainShares,
  traceGlowRuns,
} from "../terrainStats";

const VIEW: Viewport = {
  width: 400,
  height: 400,
  halfWidth: 10,
  originX: 20,
  originY: 200,
};

describe("terrainShares", () => {
  it("counts each terrain, largest first, ties by id", () => {
    // 3x3: five of 0, two of 7, two of 4.
    const shares = terrainShares([0, 0, 7, 4, 0, 7, 4, 0, 0]);
    expect(shares.map((s) => [s.id, s.tiles])).toEqual([
      [0, 5],
      [4, 2],
      [7, 2],
    ]);
    expect(shares[0].fraction).toBeCloseTo(5 / 9);
    expect(shares.reduce((n, s) => n + s.fraction, 0)).toBeCloseTo(1);
  });

  it("returns nothing for an empty grid", () => {
    expect(terrainShares([])).toEqual([]);
  });
});

describe("formatShare", () => {
  it("prints one decimal and never shows a present terrain as zero", () => {
    expect(formatShare(0.4567)).toBe("45.7%");
    expect(formatShare(1)).toBe("100.0%");
    expect(formatShare(1 / 40000)).toBe("<0.1%");
    expect(formatShare(0)).toBe("0.0%");
  });
});

describe("glowRuns", () => {
  it("merges neighbours along x and splits at gaps and row ends", () => {
    // Row 0: 1 1 0 1, row 1: 1 1 1 1, row 2: 0 0 0 0, row 3: 0 0 0 1.
    const grid = [1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(glowRuns(grid, 4, 1)).toEqual([
      { y: 0, x0: 0, x1: 1 },
      { y: 0, x0: 3, x1: 3 },
      { y: 1, x0: 0, x1: 3 },
      { y: 3, x0: 3, x1: 3 },
    ]);
  });

  it("does not join the end of one row to the start of the next", () => {
    // Row 0 ends with the terrain and row 1 starts with it.
    expect(glowRuns([0, 1, 1, 0], 2, 1)).toEqual([
      { y: 0, x0: 1, x1: 1 },
      { y: 1, x0: 0, x1: 0 },
    ]);
  });

  it("finds nothing for a terrain that is not on the map", () => {
    expect(glowRuns([0, 0, 0, 0], 2, 5)).toEqual([]);
  });
});

/** A path that records its points, one array per closed polygon. */
function recorder() {
  const polygons: { x: number; y: number }[][] = [];
  return {
    polygons,
    moveTo(x: number, y: number) {
      polygons.push([{ x, y }]);
    },
    lineTo(x: number, y: number) {
      polygons[polygons.length - 1].push({ x, y });
    },
    closePath() {},
  };
}

describe("traceGlowRuns", () => {
  it("outlines a run through every lattice point on both long edges", () => {
    const path = recorder();
    traceGlowRuns(path, VIEW, [{ y: 2, x0: 1, x1: 3 }]);
    const expected = [
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [4, 3],
      [3, 3],
      [2, 3],
      [1, 3],
    ].map(([x, y]) => latticeToScreen(VIEW, x, y));
    expect(path.polygons).toEqual([expected]);
  });

  it("follows raised ground", () => {
    // A 2x2 map whose middle corner is two levels up. The run's bottom edge
    // passes through that corner, so its middle point must sit higher on
    // screen than the flat projection puts it.
    const corners = [0, 0, 0, 0, 2, 0, 0, 0, 0];
    const raised: Viewport = {
      ...VIEW,
      ground: { dim: 2, corners, maxLevel: 2 },
    };
    const path = recorder();
    traceGlowRuns(path, raised, [{ y: 0, x0: 0, x1: 1 }]);
    const middleBottom = path.polygons[0][4];
    expect(middleBottom).toEqual(latticeToScreen(raised, 1, 1));
    expect(middleBottom.y).toBeLessThan(latticeToScreen(VIEW, 1, 1).y);
  });
});

describe("glowAlpha", () => {
  it("starts bright, dims at half a period and comes back", () => {
    const bright = glowAlpha(0);
    const dim = glowAlpha(GLOW_PERIOD_MS / 2);
    expect(bright).toBeGreaterThan(dim);
    expect(glowAlpha(GLOW_PERIOD_MS)).toBeCloseTo(bright);
    expect(dim).toBeGreaterThan(0);
  });
});

describe("maskRuns", () => {
  it("merges adjacent tiles in a row and splits at gaps and at row ends", () => {
    // dim 4. Tiles 1,2 (row 0), 3 (row 0 end) then 4 (row 1 start) must NOT
    // join across the row break, 6 stands alone, 9,10 merge.
    const tiles = Uint32Array.from([1, 2, 3, 4, 6, 9, 10]);
    expect(maskRuns(tiles, 4)).toEqual([
      { y: 0, x0: 1, x1: 3 },
      { y: 1, x0: 0, x1: 0 },
      { y: 1, x0: 2, x1: 2 },
      { y: 2, x0: 1, x1: 2 },
    ]);
  });

  it("gives nothing for an empty set", () => {
    expect(maskRuns(new Uint32Array(0), 4)).toEqual([]);
  });
});

describe("alternatingGlow", () => {
  const CYCLE = 2 * GLOW_PERIOD_MS;
  it("is dark at the start, bright on set 0, dark at the switch, bright on set 1", () => {
    expect(alternatingGlow(0)).toEqual({ set: 0, alpha: 0 });
    const quarter = alternatingGlow(CYCLE / 4);
    expect(quarter.set).toBe(0);
    expect(quarter.alpha).toBeGreaterThan(0.5);
    const half = alternatingGlow(CYCLE / 2);
    expect(half.set).toBe(1);
    expect(half.alpha).toBeCloseTo(0);
    const threeQuarters = alternatingGlow((CYCLE * 3) / 4);
    expect(threeQuarters.set).toBe(1);
    expect(threeQuarters.alpha).toBeCloseTo(quarter.alpha);
  });

  it("is also dark just before the switch back to set 0", () => {
    expect(alternatingGlow(CYCLE - 1).alpha).toBeLessThan(0.001);
    expect(alternatingGlow(CYCLE)).toEqual({ set: 0, alpha: 0 });
  });
});
