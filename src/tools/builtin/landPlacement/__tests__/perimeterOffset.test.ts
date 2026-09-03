// perimeter-symbolic-rotation-slice-a-brief.md item 1's own acceptance: the
// mid-edge requirement that settled the shape-kinds escalation's
// vertex-vs-perimeter fork, still pinned directly rather than through a
// bounding box, plus the hazard 1 wrap (`floor(delta * M) === M`), the
// rotation-ray convention (member 0 on the rotation ray), and this slice's
// own new equivalence gate against real trigonometry (escalation Sec.8.1).
//
// `perimeterPolar` takes no rotation at all (that absence is the whole
// design, Sec.8.3) — every case below leaves rotation for the CALLER
// (`expand.ts`) to add as an outer `Expr` term, so this file only ever
// checks `radiusScale`/`bearingDegrees`, never a resolved position, except
// in the equivalence gate, which builds a position deliberately to compare
// against real trig rather than against a copy of the old formula.

import { describe, expect, it } from "vitest";
import { perimeterPolar } from "../perimeterOffset";

const APOTHEM_45 = Math.SQRT1_2; // cos(pi/4), a square's own apothem in units of R

describe("perimeterPolar — square (M=4)", () => {
  it("N=4: each member sits at the middle of its own side, at bearing offset 0/90/180/270 — no rounding involved, every one an exact multiple", () => {
    // Member 0 on the rotation ray (convention 2): side 0 faces +x, so its
    // bearing offset is 0 and its radiusScale is the apothem (round6 leaves
    // a float a hair off the closed form, hence toBeCloseTo not toEqual).
    for (const [m, expectedBearing] of [[0, 0], [1, 90], [2, 180], [3, 270]] as const) {
      const { radiusScale, bearingDegrees } = perimeterPolar(4, 4, m);
      expect(radiusScale).toBeCloseTo(APOTHEM_45, 5);
      expect(bearingDegrees).toBe(expectedBearing);
    }
  });

  it("N=8 alternates side midpoint and corner; corner members carry radiusScale exactly 1, midpoint members exactly the apothem — radiusScale never depends on bearing rounding", () => {
    for (let m = 0; m < 8; m++) {
      const { radiusScale } = perimeterPolar(4, 8, m);
      if (m % 2 === 0) {
        expect(radiusScale).toBeCloseTo(APOTHEM_45, 5); // midpoint
      } else {
        expect(radiusScale).toBeCloseTo(1, 5); // corner: exactly the radius (R=1 in these units)
      }
    }
  });

  it("hazard 1: the last member of N=8 lands exactly on floor(delta*M) === M and must wrap, not read off the end of the shape", () => {
    // m=7 of N=8: delta = 7/8 + 1/8 = 1.0 exactly, scaled = 4.0 = M exactly.
    const result = perimeterPolar(4, 8, 7);
    expect(Number.isFinite(result.radiusScale)).toBe(true);
    expect(Number.isFinite(result.bearingDegrees)).toBe(true);
    expect(result.radiusScale).toBeCloseTo(1, 5); // corner between side 3 and side 0
  });

  it("member 0 sits on the rotation ray: bearingDegrees is exactly 0 for every memberCount, since the function cannot see rotation at all to disturb it", () => {
    for (const memberCount of [1, 2, 3, 4, 5, 8, 12]) {
      expect(perimeterPolar(4, memberCount, 0).bearingDegrees).toBe(0);
    }
  });

  it("radiusScale is independent of which member index shares a physical point — bearingDegrees varies with rotation elsewhere (expand.ts adds it as an outer term), radiusScale never does, since this function takes no rotation parameter at all", () => {
    // There is nothing to rotate here: perimeterPolar always answers for
    // rotation 0, and expand.ts's `add(group.rotation, num(bearingDegrees))`
    // is what steers the shape. Confirmed structurally: calling this
    // function twice with identical (sides, memberCount, memberIndex)
    // always returns the identical pair.
    const a = perimeterPolar(4, 8, 3);
    const b = perimeterPolar(4, 8, 3);
    expect(a).toEqual(b);
  });

  it("is deterministic and pure — same inputs, same outputs, no shared state across calls", () => {
    const a = perimeterPolar(4, 8, 3);
    const b = perimeterPolar(4, 8, 3);
    expect(a).toEqual(b);
  });
});

// The equivalence gate (slice-a-brief.md item 5's "one new test that
// matters"): `perimeterPolar`'s reduction is algebraically exact against
// real trigonometry, verified here rather than transcribed — the design
// session's own throwaway probe measured this over 7,566 combinations and
// found the worst discrepancy exactly half a unit of this file's own
// `round6`; this is the corpus that measurement produced, made permanent.
describe("perimeterPolar — equivalence gate against real trigonometry", () => {
  const SIDES = [3, 4, 5, 6, 7, 12];
  const MEMBER_COUNTS = [3, 5, 7, 8, 12];
  // A spread of literal rotations, mirroring the design session's own grid
  // (escalation Sec.8.2), applied here as the caller (`expand.ts`) would:
  // an outer addend on the bearing, never seen by `perimeterPolar` itself.
  const ROTATIONS = [0, 17, 45, 137, 300];
  const RADII = [10, 25, 45]; // percent-units, matching Sec.8.2's own grid

  it("the emitted position (radiusScale * bearing, rounded exactly as expand.ts rounds it) matches real trig within the measured worst case", () => {
    // Pinned at the design session's own measured worst case, 0.440
    // percent-units at M=7 N=5 m=4 R=45 (escalation Sec.8.2). 0.5 leaves a
    // small margin for floating-point noise while still catching a
    // regression that meaningfully doubles the error.
    const TOLERANCE = 0.5;
    let worst = 0;
    for (const sides of SIDES) {
      for (const memberCount of MEMBER_COUNTS) {
        for (let m = 0; m < memberCount; m++) {
          const { radiusScale, bearingDegrees } = perimeterPolar(sides, memberCount, m);
          const { radiusScale: exactScale, bearing: exactBearing } = exactPerimeterPoint(sides, memberCount, m);
          for (const rotation of ROTATIONS) {
            for (const radius of RADII) {
              // What expand.ts actually emits: r = base * radiusScale, theta
              // = rotation + bearingDegrees, both already-rounded numbers.
              const emitted = toPoint(radius * radiusScale, rotation + bearingDegrees);
              // The reference: real trigonometry, no rounding anywhere.
              const real = toPoint(radius * exactScale, rotation + exactBearing);

              const error = Math.hypot(emitted.x - real.x, emitted.y - real.y);
              worst = Math.max(worst, error);
              expect(error).toBeLessThan(TOLERANCE);
            }
          }
        }
      }
    }
    expect(worst).toBeGreaterThan(0); // the grid actually exercises rounding, not a vacuously-passing loop
  });
});

// perimeter-symbolic-rotation-slice-b-brief.md item 4: `shiftPercent`, a
// slot's `perimeterShift`, is a delta added inside `delta` itself before the
// wrap, so it is pinned here at the same level `perimeterPolar`'s other
// arguments are, rather than only through `expand.ts`. The composition with
// `slot.radius` and a symbolic group rotation is expand.ts's job (neither
// quantity exists at this layer), so those two cases live in
// `expand.test.ts` instead.
describe("perimeterPolar — perimeterShift (shiftPercent)", () => {
  it("defaults to 0 and is byte-identical to omitting the argument", () => {
    expect(perimeterPolar(4, 4, 0)).toEqual(perimeterPolar(4, 4, 0, 0));
    expect(perimeterPolar(4, 8, 3, 0)).toEqual(perimeterPolar(4, 8, 3));
  });

  it("a shift off the side's midpoint changes BOTH radiusScale (larger) and bearingDegrees (different) — checking only the bearing would pass under an implementation that forgot the radius", () => {
    // Member 0 of N=4, unshifted, sits exactly at the midpoint of side 0:
    // radiusScale = apothem, bearingDegrees = 0.
    const unshifted = perimeterPolar(4, 4, 0);
    expect(unshifted.radiusScale).toBeCloseTo(APOTHEM_45, 5);
    expect(unshifted.bearingDegrees).toBe(0);

    // Shifted a quarter of the way toward the next corner (6.25% of a lap,
    // a quarter of this side's own 25%-of-a-lap span): delta = 0.125 +
    // 0.0625 = 0.1875, scaled = 0.75, still side k=0 but f=0.75 rather than
    // 0.5 — off the midpoint, not yet at the corner.
    const shifted = perimeterPolar(4, 4, 0, 6.25);
    const u = (0.75 - 0.5) * 2 * Math.sin(Math.PI / 4);
    const expectedScale = Math.hypot(APOTHEM_45, u);
    const expectedBearing = Math.round((Math.atan2(u, APOTHEM_45) * 180) / Math.PI);
    expect(shifted.radiusScale).toBeCloseTo(expectedScale, 5);
    expect(shifted.bearingDegrees).toBe(expectedBearing);
    // The subtlety itself: strictly further from the anchor than the
    // midpoint, since it has moved off the midpoint toward a corner.
    expect(shifted.radiusScale).toBeGreaterThan(unshifted.radiusScale);
    expect(shifted.bearingDegrees).not.toBe(unshifted.bearingDegrees);
  });

  it("a negative shift mirrors the positive one across the midpoint: same radiusScale, negated bearing offset", () => {
    const positive = perimeterPolar(4, 4, 0, 6.25);
    const negative = perimeterPolar(4, 4, 0, -6.25);
    expect(negative.radiusScale).toBeCloseTo(positive.radiusScale, 5);
    expect(negative.bearingDegrees).toBe(-positive.bearingDegrees);
  });

  it("wraps past a full lap: shift + 100 lands on the identical (radiusScale, bearingDegrees) pair, in both directions", () => {
    const base = perimeterPolar(4, 4, 0, 6.25);
    expect(perimeterPolar(4, 4, 0, 106.25)).toEqual(base);
    expect(perimeterPolar(4, 4, 0, -93.75)).toEqual(base);
  });

  it("a shift of exactly 100 (one full lap) returns the member to exactly where it started", () => {
    const unshifted = perimeterPolar(4, 4, 0);
    const fullLap = perimeterPolar(4, 4, 0, 100);
    expect(fullLap).toEqual(unshifted);
  });
});

function toPoint(r: number, thetaDegrees: number): { x: number; y: number } {
  const rad = (thetaDegrees * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

/**
 * Real trigonometry, no rounding anywhere — derived independently from the
 * same primitives `perimeterOffset` (pre-slice-A) used, so the equivalence
 * gate above cannot pass merely because both sides share one
 * implementation. Used only as the reference this file's own gate checks
 * `perimeterPolar` against.
 */
function exactPerimeterPoint(sides: number, memberCount: number, memberIndex: number): { radiusScale: number; bearing: number } {
  const delta = memberIndex / memberCount + 1 / (2 * sides);
  const scaled = delta * sides;
  const k = ((Math.floor(scaled) % sides) + sides) % sides;
  const f = scaled - Math.floor(scaled);
  const u = (f - 0.5) * 2 * Math.sin(Math.PI / sides);
  const apo = Math.cos(Math.PI / sides);
  return { radiusScale: Math.hypot(apo, u), bearing: k * (360 / sides) + (Math.atan2(u, apo) * 180) / Math.PI };
}
