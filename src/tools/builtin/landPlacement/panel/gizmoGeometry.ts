// Sec.7.3's gizmo handles: "a radius ring handle, a rotation handle, and a
// count stepper." The stepper is the panel's existing `repeats` field
// (LandPlacementPanel.tsx); this module answers the other half — WHERE the
// two handles sit on the canvas, given the group's own resolved anchor,
// radius and rotation.
//
// This is the forward twin of `dragMath.ts`'s `dragPolar`, which goes
// point -> (r, theta); this goes (r, theta) -> point. Kept in its own file
// rather than added to dragMath.ts because slice-5-brief.md says plainly
// "you are calling these, not changing them" about that module — this is a
// new, small piece of geometry, not an edit to an existing one. Same real
// trig convention as dragMath.ts (Math.cos/Math.sin, not the compiler's own
// Bhaskara macro), for the identical reason: a handle's DRAWN position is a
// UI placement, not itself an emitted quantity, so it accepts the same
// already-documented approximation error real trig carries against the
// macro (Sec.5.4) rather than inventing a second one.

import type { FrameKind } from "../model";

export interface PercentPoint {
  x: number;
  y: number;
}

const DEG_PER_RAD = Math.PI / 180;

/**
 * A ring's zero-phase bearing composes with its parent's own DEGREES exactly
 * the way a `radial`+`polar` placement's does (frame.ts's own rule,
 * mirrored by dragMath.ts's `dragPolar`): `absolute` or a parent with no
 * DEGREES cell (root, or a cartesian/formula parent) uses a plain world
 * bearing; otherwise `parentDegrees + 180 + rotation`.
 */
function polarToPercent(
  anchor: PercentPoint,
  r: number,
  theta: number,
  frame: FrameKind,
  parentDegreesResolved: number | undefined,
): PercentPoint {
  const worldBearing =
    frame === "absolute" || parentDegreesResolved === undefined
      ? theta
      : parentDegreesResolved + 180 + theta;
  const rad = worldBearing * DEG_PER_RAD;
  return { x: anchor.x + r * Math.cos(rad), y: anchor.y + r * Math.sin(rad) };
}

/**
 * The rotation handle is drawn further out than the radius handle (same
 * bearing, `ROTATION_HANDLE_RADIUS_FACTOR` times the distance) rather than
 * at a different bearing, DECIDED HERE: it keeps both handles' drag
 * interpretation a one-line read of `dragPolar`'s own output — "the radius
 * handle keeps the bearing and takes the distance" is `{ r: dragged.r,
 * theta: rotation }`, "the rotation handle keeps the distance and takes the
 * bearing" is `{ r: radius, theta: dragged.theta }` — while still keeping
 * the two handles visually distinct at every radius, including a
 * newly-created ring's small default one.
 */
const ROTATION_HANDLE_RADIUS_FACTOR = 1.15;

export interface GizmoHandlePositions {
  radiusHandle: PercentPoint;
  rotationHandle: PercentPoint;
}

export function gizmoHandlePositions(
  anchor: PercentPoint,
  radius: number,
  rotation: number,
  frame: FrameKind,
  parentDegreesResolved: number | undefined,
): GizmoHandlePositions {
  return {
    radiusHandle: polarToPercent(
      anchor,
      radius,
      rotation,
      frame,
      parentDegreesResolved,
    ),
    rotationHandle: polarToPercent(
      anchor,
      radius * ROTATION_HANDLE_RADIUS_FACTOR,
      rotation,
      frame,
      parentDegreesResolved,
    ),
  };
}

// ---------------------------------------------------------------------------
// shape-kinds-slice-c-brief.md item 3: what is left of slice 5's own item 6,
// one handle per POLAR kind slice A introduced. Neither is folded into
// `GizmoHandlePositions` above — this file's own header reasoning for why a
// per-kind handle is a new small function rather than a shared struct field
// applies here exactly as it did to the two handles every group already has.
// ---------------------------------------------------------------------------

/**
 * A line's own SECOND end. Slice A put `radius` on the half length
 * specifically so the existing radius handle lands on the FAR end
 * (`expand.ts`'s `lineOffset` doc comment); the near end is that same point
 * mirrored through the anchor, `(radius, rotation + 180)`. It sits exactly
 * on the line's own member 0 by construction (`lineOffset` at `m = 0` is
 * `-radius`), which is why `LandPlacementCanvas.tsx`'s handle-before-circle
 * hit-test order is the correct one here rather than an accident.
 */
export function lineEndHandlePosition(
  anchor: PercentPoint,
  radius: number,
  rotation: number,
  frame: FrameKind,
  parentDegreesResolved: number | undefined,
): PercentPoint {
  return polarToPercent(
    anchor,
    radius,
    rotation + 180,
    frame,
    parentDegreesResolved,
  );
}

/**
 * An arc's own sweep handle, at its last member's position
 * `(radius, rotation + sweep)` — `expand.ts`'s `arcStepDegrees` formula at
 * `m = span`.
 */
export function arcSweepHandlePosition(
  anchor: PercentPoint,
  radius: number,
  rotation: number,
  sweep: number,
  frame: FrameKind,
  parentDegreesResolved: number | undefined,
): PercentPoint {
  return polarToPercent(
    anchor,
    radius,
    rotation + sweep,
    frame,
    parentDegreesResolved,
  );
}
