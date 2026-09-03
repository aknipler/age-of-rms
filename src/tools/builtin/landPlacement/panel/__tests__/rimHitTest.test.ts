// slice-5-brief.md item 1/5: hitTestRim, the "drag from a land's rim"
// gesture's own hit test. Its own file rather than an edit to
// canvasGeometry.test.ts, per item 1's acceptance criterion that the
// existing test file stays green and unmodified.

import { describe, expect, it } from "vitest";
import { hitTestRim, type TileCircle } from "../canvasGeometry";

const LAND: TileCircle = { id: "P1", x: 50, y: 50, rTiles: 10 };

describe("hitTestRim", () => {
  it("hits near the circle's edge", () => {
    expect(hitTestRim({ x: 60, y: 50 }, [LAND], 1)).toBe("P1"); // exactly on the rim
    expect(hitTestRim({ x: 60.5, y: 50 }, [LAND], 1)).toBe("P1"); // just outside, within thickness
    expect(hitTestRim({ x: 59.5, y: 50 }, [LAND], 1)).toBe("P1"); // just inside, within thickness
  });

  it("misses the interior — that is the body-drag gesture, not the rim one", () => {
    expect(hitTestRim({ x: 50, y: 50 }, [LAND], 1)).toBeNull(); // dead centre
    expect(hitTestRim({ x: 52, y: 50 }, [LAND], 1)).toBeNull(); // well inside
  });

  it("misses far outside the circle", () => {
    expect(hitTestRim({ x: 90, y: 90 }, [LAND], 1)).toBeNull();
  });

  it("picks the closest rim when two circles' rims are both within tolerance", () => {
    const inner: TileCircle = { id: "inner", x: 50, y: 50, rTiles: 10 };
    const outer: TileCircle = { id: "outer", x: 50, y: 50, rTiles: 10.4 };
    // At x=60.2, distance from centre is 10.2: 0.2 from inner's rim, 0.2 from
    // outer's — a tie broken by iteration order is fine; what matters is a
    // point clearly closer to one rim picks that one.
    expect(hitTestRim({ x: 60, y: 50 }, [inner, outer], 1)).toBe("inner");
    expect(hitTestRim({ x: 60.4, y: 50 }, [inner, outer], 1)).toBe("outer");
  });

  it("returns null against an empty circle list", () => {
    expect(hitTestRim({ x: 50, y: 50 }, [], 1)).toBeNull();
  });

  // The two tests below are written against the ONE point each mutant moves.
  // A fixture that reads naturally (centre, edge) turns out to answer the
  // same either way, so it cannot say whether the cap is there. Both cases
  // are therefore chosen at a radius where the capped and uncapped bands
  // disagree, and both were confirmed red against their own mutant.
  it("a small land keeps a body: the band is capped per circle, so it never swallows the whole disc", () => {
    // A 4-tile land against the panel's own ~1.8-tile band. Uncapped, rim
    // reaches 1.8 tiles inward and covers ~75% of the disc by area, so the
    // move gesture is unreachable over most of a small land and the chain
    // gesture fires in its place. Capped (1.4 here), rim stops at 2.6 tiles
    // out and the body keeps 42%.
    const small: TileCircle = { id: "aux", x: 50, y: 50, rTiles: 4 };
    // 2.4 tiles from the centre, so 1.6 from the rim: inside the uncapped
    // 1.8 band, outside the capped 1.4 one. THIS is the discriminating point.
    expect(hitTestRim({ x: 52.4, y: 50 }, [small], 1.8)).toBeNull();
    expect(hitTestRim({ x: 54, y: 50 }, [small], 1.8)).toBe("aux"); // still rim on the edge itself
  });

  it("the cap is a ceiling, not a replacement: a large land gets the band it asked for, not 35% of its radius", () => {
    // rTiles 40, so the cap (14) sits far above the requested 1.8 and must
    // do nothing. A point 10 tiles inside the edge is BODY; it would be rim
    // if the cap replaced the request rather than bounding it.
    const big: TileCircle = { id: "big", x: 50, y: 50, rTiles: 40 };
    expect(hitTestRim({ x: 80, y: 50 }, [big], 1.8)).toBeNull();
    expect(hitTestRim({ x: 88.5, y: 50 }, [big], 1.8)).toBe("big");
  });
});
