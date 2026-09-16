// Sec.7.3's snapping defaults (rev 3): tile lattice, centre, parent axis,
// the three that survived integer-percent's own withdrawal on measurement
// ("a 2.52-tile lattice at Giant").

import { describe, expect, it } from "vitest";
import { percentToTile } from "../viewModel";
import {
  applyDefaultSnapping,
  snapToCentre,
  snapToIntegerPercent,
  snapToParentAxis,
  snapToTileLattice,
} from "../snapping";

describe("snapToTileLattice", () => {
  it("quantises to the nearest real tile at the given map size, matching viewModel's own percentToTile", () => {
    const dim = 200; // Giant
    const snapped = snapToTileLattice({ x: 37.3, y: 62.9 }, dim);
    expect(percentToTile(snapped.x, dim)).toBe(percentToTile(37.3, dim));
    expect(percentToTile(snapped.y, dim)).toBe(percentToTile(62.9, dim));
    // Round-tripping the snapped value through percentToTile again must be a no-op. It's already exactly on a tile.
    expect(percentToTile(snapped.x, dim)).toBe(
      Math.round(percentToTile(snapped.x, dim)),
    );
  });

  it("is idempotent — snapping an already-snapped point changes nothing", () => {
    const dim = 144; // Normal
    const once = snapToTileLattice({ x: 41.1, y: 8.4 }, dim);
    const twice = snapToTileLattice(once, dim);
    expect(twice).toEqual(once);
  });

  it("mapDim <= 0 returns the point untouched — nothing to snap to on an unresolved map size", () => {
    expect(snapToTileLattice({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
  });
});

describe("snapToCentre", () => {
  const centre = { x: 50, y: 50 };
  const dim = 200;

  it("snaps to exactly the centre within tolerance", () => {
    expect(snapToCentre({ x: 50.5, y: 49.5 }, centre, 2, dim)).toEqual(centre);
  });

  it("leaves a point outside tolerance untouched", () => {
    const far = { x: 70, y: 70 };
    expect(snapToCentre(far, centre, 2, dim)).toEqual(far);
  });

  it("the tolerance is a genuine Euclidean radius, not a per-axis box", () => {
    // 2 tiles = 1% at dim 200. hypot(0.9, 0.9) ≈ 1.27 > 1, outside the radius
    // despite each axis individually being inside a 1%-wide box.
    const diagonalCorner = { x: 50.9, y: 50.9 };
    expect(snapToCentre(diagonalCorner, centre, 2, dim)).toEqual(
      diagonalCorner,
    );
    // A point the same total distance but on one axis stays inside.
    const onAxis = { x: 50.7, y: 50 };
    expect(snapToCentre(onAxis, centre, 2, dim)).toEqual(centre);
  });
});

describe("snapToParentAxis", () => {
  const parent = { x: 30, y: 60 };
  const dim = 200;

  it("snaps only the axis that's within tolerance, leaving the other alone", () => {
    const result = snapToParentAxis({ x: 30.4, y: 80 }, parent, 2, dim);
    expect(result.x).toBe(30); // within tolerance of parent's x
    expect(result.y).toBe(80); // far from parent's y, untouched
  });

  it("snaps both axes when both are within tolerance", () => {
    const result = snapToParentAxis({ x: 30.4, y: 60.4 }, parent, 2, dim);
    expect(result).toEqual(parent);
  });

  it("snaps neither axis when both are far", () => {
    const point = { x: 90, y: 10 };
    expect(snapToParentAxis(point, parent, 2, dim)).toEqual(point);
  });
});

describe("snapToIntegerPercent", () => {
  it("rounds both axes to a whole percent — the explicit modifier, never a default", () => {
    expect(snapToIntegerPercent({ x: 12.6, y: 87.4 })).toEqual({
      x: 13,
      y: 87,
    });
  });
});

describe("applyDefaultSnapping — the composition Sec.7.3 actually ships", () => {
  const dim = 200;

  it("a point near the centre snaps to it exactly, not to the tile lattice's own approximation", () => {
    const result = applyDefaultSnapping({ x: 50.2, y: 49.9 }, { mapDim: dim });
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it("a point near the parent's axis snaps to it, then still lands on a real tile", () => {
    const parentAnchor = { x: 30, y: 60 };
    const result = applyDefaultSnapping(
      { x: 30.3, y: 90 },
      { mapDim: dim, parentAnchor, toleranceTiles: 2 },
    );
    expect(result.x).toBe(30); // 30 is already tile-exact at dim 200
    expect(percentToTile(result.y, dim)).toBe(percentToTile(90, dim));
  });

  it("a point far from every magnet still gets the tile-lattice snap", () => {
    const result = applyDefaultSnapping(
      { x: 12.34, y: 87.65 },
      { mapDim: dim },
    );
    expect(percentToTile(result.x, dim)).toBe(percentToTile(12.34, dim));
    expect(percentToTile(result.y, dim)).toBe(percentToTile(87.65, dim));
  });

  it('omitting parentAnchor skips the parent-axis snap entirely (a placement parented to "center")', () => {
    // No parentAnchor: only centre + tile-lattice apply. A point far from centre is untouched by anything but the lattice.
    const result = applyDefaultSnapping(
      { x: 12.34, y: 87.65 },
      { mapDim: dim },
    );
    expect(result).toEqual(snapToTileLattice({ x: 12.34, y: 87.65 }, dim));
  });
});
