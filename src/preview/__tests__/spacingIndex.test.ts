// Tests for spacingIndex.ts — the uniform-grid replacement for the linear
// "is anything already placed within d" scans S2 and S6 each had.
//
// The correctness bar is EXACT AGREEMENT with the scan it replaced, not
// "close enough": these queries gate real placements, and a false positive
// silently drops an object while a false negative puts two on top of each
// other. Most of the file is therefore a differential test against a
// deliberately naive reference implementation, which is the only way to
// cover the cell-boundary cases that hand-written examples always miss.

import { describe, expect, it } from "vitest";
import { createSpacingIndex, type SpacingMetric } from "../generator/spacingIndex";

/** The implementation this module replaced, kept as the oracle. */
function referenceTooClose(
  points: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
  distance: number,
  metric: SpacingMetric,
): boolean {
  if (!(distance > 0)) return false;
  for (const [px, py] of points) {
    const dx = x - px;
    const dy = y - py;
    const d = metric === "chebyshev" ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.sqrt(dx * dx + dy * dy);
    if (d < distance) return true;
  }
  return false;
}

/** Deterministic pseudo-random, so a failure is reproducible without a seed library. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("createSpacingIndex", () => {
  it("reports nothing too close while empty", () => {
    const index = createSpacingIndex(40, 5, "chebyshev");
    expect(index.tooClose(10, 10)).toBe(false);
    expect(index.size).toBe(0);
  });

  it("treats a non-positive distance as no constraint at all", () => {
    for (const distance of [0, -1]) {
      const index = createSpacingIndex(40, distance, "chebyshev");
      index.add(10, 10);
      expect(index.tooClose(10, 10)).toBe(false);
    }
  });

  it("rejects strictly inside the radius and admits exactly at it", () => {
    // The `<` matters: `min_distance_group_placement 5` permits a placement
    // exactly 5 tiles away, and the scan this replaced used `d < distance`.
    const index = createSpacingIndex(40, 5, "chebyshev");
    index.add(20, 20);
    expect(index.tooClose(24, 20)).toBe(true);
    expect(index.tooClose(25, 20)).toBe(false);
    expect(index.tooClose(24, 24)).toBe(true); // Chebyshev: the diagonal is inside the square
  });

  it("measures euclidean distance differently from chebyshev on the diagonal", () => {
    // The one case that proves the metric parameter is real: (4,4) is
    // Chebyshev 4 from the origin but Euclidean 5.66.
    const chebyshev = createSpacingIndex(40, 5, "chebyshev");
    const euclidean = createSpacingIndex(40, 5, "euclidean");
    chebyshev.add(20, 20);
    euclidean.add(20, 20);
    expect(chebyshev.tooClose(24, 24)).toBe(true);
    expect(euclidean.tooClose(24, 24)).toBe(false);
  });

  it("never sees a point on the opposite edge of the map", () => {
    // The bucket key is `row * cols + col`, so an out-of-range col -1 on row
    // k computes the same key as the last column of row k-1 — a real cell
    // with real points in it. Writing this test is what established that the
    // aliasing is a WASTED LOOKUP rather than a wrong answer (the distance
    // test runs on true coordinates, so a point 39 tiles away fails it
    // whichever bucket it was found in), which is why the guard's own comment
    // claims performance and not correctness. The invariant is still worth
    // pinning: it is the thing a future keying scheme could break.
    const dim = 40;
    const index = createSpacingIndex(dim, 4, "chebyshev");
    index.add(dim - 1, 0);
    index.add(dim - 1, 4);
    expect(index.tooClose(0, 4)).toBe(false);
    expect(index.tooClose(0, 0)).toBe(false);
  });

  it("counts what it holds", () => {
    const index = createSpacingIndex(40, 3, "chebyshev");
    index.add(1, 1);
    index.add(30, 30);
    expect(index.size).toBe(2);
  });

  for (const metric of ["chebyshev", "euclidean"] as const) {
    it(`agrees with the linear scan on random points and queries (${metric})`, () => {
      const dim = 60;
      const random = lcg(metric === "chebyshev" ? 12345 : 6789);
      // Several distances, including 1 (cell size 1, so every point gets its
      // own cell) and one larger than the map (a single cell for everything).
      for (const distance of [1, 2, 3, 7, 13, 80]) {
        const index = createSpacingIndex(dim, distance, metric);
        const points: Array<readonly [number, number]> = [];
        for (let step = 0; step < 400; step++) {
          // Edges are over-sampled deliberately: the cell arithmetic is only
          // interesting where the 3x3 neighbourhood runs off the grid, and a
          // uniform draw over a 60-wide map almost never lands there.
          const edge = step % 4 === 0;
          const x = edge ? (step % 8 === 0 ? 0 : dim - 1) : Math.floor(random() * dim);
          const y = edge ? Math.floor(random() * 6) : Math.floor(random() * dim);
          expect(index.tooClose(x, y)).toBe(referenceTooClose(points, x, y, distance, metric));
          // Add unconditionally — including points that ARE too close. Real
          // callers only add accepted points, but the index must not depend
          // on that for correctness, only for its occupancy bound.
          index.add(x, y);
          points.push([x, y]);
        }
      }
    });
  }

  it("stays exact when every point shares one cell", () => {
    // Occupancy is only bounded because callers add accepted points; this
    // pins that violating the assumption costs speed, never correctness.
    const index = createSpacingIndex(40, 10, "chebyshev");
    for (let i = 0; i < 50; i++) index.add(20, 20);
    expect(index.tooClose(29, 20)).toBe(true);
    expect(index.tooClose(30, 20)).toBe(false);
  });
});
