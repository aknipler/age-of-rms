// land-placement-design.md Sec.7.3 brief, item 1: the fractional-tile ->
// percent conversion that keeps a drag's drop point from being floored
// (and therefore double-rounded) before `applyDefaultSnapping` gets to see
// it. Its own file, deliberately: projection.test.ts stays green and
// unmodified per the brief's own item-1 acceptance criterion.

import { describe, expect, it } from "vitest";
import { tileToPercent } from "../render/projection";

describe("tileToPercent", () => {
  it("converts a fractional tile point to percent-of-map", () => {
    expect(tileToPercent({ x: 50, y: 100 }, 200)).toEqual({ x: 25, y: 50 });
  });

  it("keeps the fractional part rather than flooring first — the whole point of this function existing", () => {
    // At dim 200, tile 99.6 is 49.8%, which rounds to a DIFFERENT tile
    // (100, not 99) than flooring first would produce. That difference is
    // exactly the half-tile bias the brief names.
    const fractional = tileToPercent({ x: 99.6, y: 0.4 }, 200);
    expect(fractional.x).toBeCloseTo(49.8, 10);
    expect(fractional.y).toBeCloseTo(0.2, 10);
  });

  it("round-trips with viewModel.ts's own percentToTile at whole-tile points", () => {
    // Not imported (that module lives under landPlacement/panel, this one is
    // shared/tool-agnostic), but the two must agree on the SAME convention:
    // percent = tile / dim * 100 both ways.
    const dim = 252; // Giant
    for (const tile of [0, 1, 125, 251]) {
      const pct = tileToPercent({ x: tile, y: tile }, dim);
      const roundTripped = Math.round((pct.x / 100) * dim);
      expect(roundTripped).toBe(tile);
    }
  });

  it("is the identity at (0, 0) regardless of dim", () => {
    expect(tileToPercent({ x: 0, y: 0 }, 200)).toEqual({ x: 0, y: 0 });
  });

  it("returns (0, 0) at dim <= 0 rather than dividing by zero", () => {
    expect(tileToPercent({ x: 5, y: 5 }, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToPercent({ x: 5, y: 5 }, -1)).toEqual({ x: 0, y: 0 });
  });
});
