// slice-5-brief.md item 4's own acceptance: "where the handles sit for a
// given group is a pure function and gets a test." The drag interaction
// itself is run sheet step 5, out of automated reach.

import { describe, expect, it } from "vitest";
import {
  arcSweepHandlePosition,
  gizmoHandlePositions,
  lineEndHandlePosition,
} from "../gizmoGeometry";

describe("gizmoHandlePositions", () => {
  it("absolute frame: both handles sit on the plain world bearing, radius handle at r, rotation handle further out on the same ray", () => {
    const { radiusHandle, rotationHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      20,
      0,
      "absolute",
      undefined,
    );
    // bearing 0 degrees: +x, +0y (real trig, cos(0)=1, sin(0)=0).
    expect(radiusHandle.x).toBeCloseTo(70, 10);
    expect(radiusHandle.y).toBeCloseTo(50, 10);
    expect(rotationHandle.x).toBeCloseTo(50 + 20 * 1.15, 10);
    expect(rotationHandle.y).toBeCloseTo(50, 10);
  });

  it("radial frame composes with the parent's own resolved DEGREES exactly like frame.ts's polar branch (+180)", () => {
    const { radiusHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      20,
      0,
      "radial",
      0,
    );
    // worldBearing = 0 + 180 + 0 = 180 degrees: -x, ~0y.
    expect(radiusHandle.x).toBeCloseTo(30, 10);
    expect(radiusHandle.y).toBeCloseTo(50, 10);
  });

  it("radial frame with no parent DEGREES (root, or a cartesian/formula parent) falls back to a plain bearing, same as dragPolar's own degenerate case", () => {
    const { radiusHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      20,
      90,
      "radial",
      undefined,
    );
    // No composition: bearing 90 degrees is +y.
    expect(radiusHandle.x).toBeCloseTo(50, 10);
    expect(radiusHandle.y).toBeCloseTo(70, 10);
  });

  it("the two handles are always distinct, at every radius including a freshly-created ring's small default", () => {
    const { radiusHandle, rotationHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      0.001,
      45,
      "absolute",
      undefined,
    );
    expect(radiusHandle).not.toEqual(rotationHandle);
  });

  it("rotation changes both handles' position together, since they share one bearing", () => {
    const a = gizmoHandlePositions(
      { x: 50, y: 50 },
      10,
      0,
      "absolute",
      undefined,
    );
    const b = gizmoHandlePositions(
      { x: 50, y: 50 },
      10,
      90,
      "absolute",
      undefined,
    );
    expect(a.radiusHandle).not.toEqual(b.radiusHandle);
    expect(a.rotationHandle).not.toEqual(b.rotationHandle);
  });
});

// shape-kinds-slice-c-brief.md item 3: what is left of slice 5's own item 6.
describe("lineEndHandlePosition", () => {
  it("sits at the same distance as the radius handle, on the opposite bearing — the anchor's own mirror of the far end", () => {
    const { radiusHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      20,
      0,
      "absolute",
      undefined,
    );
    const nearEnd = lineEndHandlePosition(
      { x: 50, y: 50 },
      20,
      0,
      "absolute",
      undefined,
    );
    // bearing 0 puts the far end at (70, 50); bearing 180 puts the near end at (30, 50).
    expect(radiusHandle).toEqual({ x: 70, y: 50 });
    expect(nearEnd.x).toBeCloseTo(30, 10);
    expect(nearEnd.y).toBeCloseTo(50, 10);
  });

  it("composes with the parent's own resolved DEGREES exactly like the radius handle (+180)", () => {
    const nearEnd = lineEndHandlePosition({ x: 50, y: 50 }, 20, 0, "radial", 0);
    // worldBearing = 0 + 180 + (0 + 180) = 360 == 0 degrees: +x.
    expect(nearEnd.x).toBeCloseTo(70, 10);
    expect(nearEnd.y).toBeCloseTo(50, 10);
  });
});

describe("arcSweepHandlePosition", () => {
  it("sits at the last member's own bearing, rotation + sweep, not at rotation alone", () => {
    const sweepHandle = arcSweepHandlePosition(
      { x: 50, y: 50 },
      20,
      0,
      90,
      "absolute",
      undefined,
    );
    // bearing 0 + 90 = 90 degrees: +y.
    expect(sweepHandle.x).toBeCloseTo(50, 10);
    expect(sweepHandle.y).toBeCloseTo(70, 10);
  });

  it("a sweep of 0 sits on the same ray as the radius handle", () => {
    const { radiusHandle } = gizmoHandlePositions(
      { x: 50, y: 50 },
      20,
      30,
      "absolute",
      undefined,
    );
    const sweepHandle = arcSweepHandlePosition(
      { x: 50, y: 50 },
      20,
      30,
      0,
      "absolute",
      undefined,
    );
    expect(sweepHandle.x).toBeCloseTo(radiusHandle.x, 10);
    expect(sweepHandle.y).toBeCloseTo(radiusHandle.y, 10);
  });
});
