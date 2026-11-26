import { describe, expect, it } from "vitest";
import {
  GRID_LINE_ALPHA,
  gridLineAlpha,
  isGridLineStrength,
  visibleLatticeRange,
} from "../gridLines";
import { fitViewport, screenToTile } from "../projection";

describe("gridLineAlpha", () => {
  it("is 0 for none at every zoom", () => {
    for (const hw of [1, 2, 4, 6, 50])
      expect(gridLineAlpha("none", hw)).toBe(0);
  });

  it("fades from 0 at half width 2 to full at 6", () => {
    for (const s of ["light", "medium", "dark"] as const) {
      expect(gridLineAlpha(s, 1)).toBe(0);
      expect(gridLineAlpha(s, 2)).toBe(0);
      expect(gridLineAlpha(s, 4)).toBeCloseTo(GRID_LINE_ALPHA[s] / 2);
      expect(gridLineAlpha(s, 6)).toBe(GRID_LINE_ALPHA[s]);
      expect(gridLineAlpha(s, 40)).toBe(GRID_LINE_ALPHA[s]);
    }
  });
});

describe("isGridLineStrength", () => {
  it("accepts the four names and nothing else", () => {
    for (const ok of ["none", "light", "medium", "dark"])
      expect(isGridLineStrength(ok)).toBe(true);
    for (const bad of ["Dark", "", 3, null, undefined, true])
      expect(isGridLineStrength(bad)).toBe(false);
  });
});

describe("visibleLatticeRange", () => {
  it("covers the whole map when fitted", () => {
    const dim = 40;
    const vp = fitViewport(dim, 800, 500);
    expect(visibleLatticeRange(vp, dim)).toEqual({
      x0: 0,
      x1: dim,
      y0: 0,
      y1: dim,
    });
  });

  it("is a strict sub range when zoomed in, holding the centre tile", () => {
    const dim = 100;
    const fit = fitViewport(dim, 800, 500);
    // Zoom in 8x about the canvas centre by scaling and re-centring the origin.
    const centre = screenToTile(fit, 400, 250);
    const zoomed = { ...fit, halfWidth: fit.halfWidth * 8 };
    zoomed.originX = 400 - (centre.x + centre.y) * zoomed.halfWidth;
    zoomed.originY =
      250 - (centre.y - centre.x) * zoomed.halfWidth * (fit.aspect ?? 0.5);
    const r = visibleLatticeRange(zoomed, dim);
    expect(r.x1 - r.x0).toBeLessThan(dim);
    expect(r.y1 - r.y0).toBeLessThan(dim);
    expect(r.x0).toBeLessThanOrEqual(Math.floor(centre.x));
    expect(r.x1).toBeGreaterThanOrEqual(Math.ceil(centre.x));
    expect(r.y0).toBeLessThanOrEqual(Math.floor(centre.y));
    expect(r.y1).toBeGreaterThanOrEqual(Math.ceil(centre.y));
  });

  it("pads the lower side more over raised ground", () => {
    const dim = 100;
    const flat = fitViewport(dim, 800, 500);
    const ground = {
      dim,
      corners: new Float32Array((dim + 1) * (dim + 1)),
      maxLevel: 0,
    };
    const base = { ...flat, halfWidth: flat.halfWidth * 8 };
    const high = { ...base, ground: { ...ground, maxLevel: 6 } };
    // maxLevel 0 skips the lifted search, so the corners agree and only the
    // padding differs.
    const a = visibleLatticeRange({ ...base, ground }, dim);
    const b = visibleLatticeRange(high, dim);
    expect(b.y1).toBeGreaterThanOrEqual(a.y1);
    expect(b.x0).toBeLessThanOrEqual(a.x0);
  });
});
