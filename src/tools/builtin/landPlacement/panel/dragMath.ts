// Sec.7.3: "Drag a land -> moves it. Which numbers change depends on
// [the offset kind]: [polar] edits (r, θ), [cartesian] edits (dx, dy)...
// A node whose position is `formula` is draggable only if the formula is
// invertible in the dragged coordinate; otherwise the handle is a read-only
// marker and the panel says why. Silently discarding a user's formula
// because they brushed the canvas is unacceptable."
//
// Pure geometry, no DOM, no canvas. Percent-space throughout (0-100),
// matching every other panel module's convention. `frame.ts` is the
// EMISSION-side algebra this inverts: given where the user dropped a node,
// work out the offset that would emit to put it there.
//
// A REAL trig inversion (Math.atan2/cos/sin), not the compiler's own
// Bhaskara macro (compiler/trig.ts), DECIDED HERE, documented rather than
// silently assumed. Inverting the macro exactly (finding θ from a target
// cos/sin under its own polynomial approximation, not real trigonometry) is
// solvable but is solving the WRONG problem: a drag is "put it about here",
// not a precision instrument, and Sec.5.4 already prices the macro's own
// distance from real trig at up to 0.5°. Using real trig for the inverse
// accepts that same, already-documented error rather than compounding a
// second approximation on top of it.

import type { Expr } from "../../../../../tools-api/index";
import { bin, evalClosed, num } from "../compiler/expr";
import type { FrameKind, Placement } from "../model";

export interface PercentPoint {
  x: number;
  y: number;
}

const DEG_PER_RAD = 180 / Math.PI;

/** World bearing (degrees) from `anchor` to `point`, matching frame.ts's own `x = r*cos + anchorX, y = r*sin + anchorY` convention exactly, so a bearing computed here and fed back through evalExpr's own sin/cos lands on the same point (up to the macro's own documented approximation error). */
function worldBearingDegrees(
  anchor: PercentPoint,
  point: PercentPoint,
): number {
  return Math.atan2(point.y - anchor.y, point.x - anchor.x) * DEG_PER_RAD;
}

function distance(anchor: PercentPoint, point: PercentPoint): number {
  return Math.hypot(point.x - anchor.x, point.y - anchor.y);
}

/**
 * Folds a bearing to the same (-180, 180] range `compiler/expr.ts`'s
 * `foldToR` produces, so a dragged theta reads the same way a hand-typed
 * one would. Exported for shape-kinds-slice-c-brief.md item 3's line-end
 * handle (`canvasInteraction.ts`'s `computeLineEndDrag`), which needs this
 * SAME fold after adding 180 degrees to a dropped bearing — reusing it
 * rather than a second copy is the point, since a wrong fold here is one of
 * this feature's own named hazards (a "plausible-looking wrong picture").
 */
export function foldBearing(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export interface PolarDragResult {
  kind: "polar";
  r: number;
  theta: number;
}

export interface CartesianDragResult {
  kind: "cartesian";
  dx: number;
  dy: number;
}

/**
 * Computes the new (r, θ) for a `polar` offset, given where the node was
 * dropped. `anchor` is the parent's own resolved position (map centre for a
 * root). `parentDegreesResolved` is the parent's own emitted DEGREES value
 * (Sec.4.2), `undefined` for a root node OR a parent whose own offset is
 * `cartesian`/`formula` (frame.ts's documented degenerate case: no DEGREES
 * cell to compose against, so theta is a plain bearing regardless of
 * `frame`). `frame === "absolute"` also always uses a plain bearing.
 * Sec.4.2's own `+ 180` composition is specifically the `radial` frame's
 * meaning.
 */
export function dragPolar(
  anchor: PercentPoint,
  droppedAt: PercentPoint,
  frame: FrameKind,
  parentDegreesResolved: number | undefined,
): PolarDragResult {
  const r = distance(anchor, droppedAt);
  const worldBearing = worldBearingDegrees(anchor, droppedAt);
  if (frame === "absolute" || parentDegreesResolved === undefined) {
    return { kind: "polar", r, theta: foldBearing(worldBearing) };
  }
  // Sec.4.2: DEGREES_c = DEGREES_p + 180 + theta_c, so theta_c = DEGREES_c - DEGREES_p - 180.
  const theta = worldBearing - parentDegreesResolved - 180;
  return { kind: "polar", r, theta: foldBearing(theta) };
}

/** `cartesian` never consults `frame` (frame.ts's own rule). dx/dy are always plain world-axis deltas from the anchor. */
export function dragCartesian(
  anchor: PercentPoint,
  droppedAt: PercentPoint,
): CartesianDragResult {
  return {
    kind: "cartesian",
    dx: droppedAt.x - anchor.x,
    dy: droppedAt.y - anchor.y,
  };
}

// ---------------------------------------------------------------------------
// The `formula` offset kind's own, narrower invertibility (Sec.7.3).
// ---------------------------------------------------------------------------

export type InvertResult =
  { ok: true; expr: Expr } | { ok: false; reason: string };

/**
 * Whether, and how, a SINGLE coordinate's formula can absorb a drag delta.
 * Only two shapes qualify, both documented rather than silently assumed:
 *
 *  - a bare numeric literal (`num`), trivially invertible, the delta just
 *    replaces it;
 *  - `sym(name) [+|-] num(k)` (either operand order for `+`), an anchor
 *    reference plus/minus a constant offset, where the drag adjusts ONLY the
 *    constant, preserving the symbolic reference exactly (so the node keeps
 *    tracking whatever `name` is, e.g. another placement's own position).
 *
 * Everything else, SIN/COS, a bare `sym` with no adjustable constant
 * (nothing to absorb a delta into without discarding the reference), a
 * `param`, a product/quotient, a deeper tree, is declined. This is a real
 * scope line, not an oversight: general symbolic inversion of an arbitrary
 * formula is a computer-algebra problem, and Sec.7.3 explicitly authorises
 * declining rather than guessing ("the handle is a read-only marker and the
 * panel says why").
 */
export function tryInvertFormulaCoordinate(
  expr: Expr,
  delta: number,
): InvertResult {
  if (expr.k === "num") {
    return { ok: true, expr: num(expr.v + delta) };
  }
  if (expr.k === "sym") {
    return {
      ok: false,
      reason: `"${expr.name}" alone has no constant term for the drag to adjust — give it a "+ N" to make it draggable.`,
    };
  }
  if (expr.k === "bin" && (expr.op === "+" || expr.op === "-")) {
    const adjustLiteral = (literal: Expr, sign: 1 | -1): Expr | null =>
      literal.k === "num" ? num(literal.v + sign * delta) : null;

    if (expr.op === "+") {
      if (expr.l.k === "num" && expr.r.k === "sym") {
        const adjusted = adjustLiteral(expr.l, 1);
        return adjusted
          ? { ok: true, expr: bin("+", adjusted, expr.r) }
          : declineNonLiteral();
      }
      if (expr.r.k === "num" && expr.l.k === "sym") {
        const adjusted = adjustLiteral(expr.r, 1);
        return adjusted
          ? { ok: true, expr: bin("+", expr.l, adjusted) }
          : declineNonLiteral();
      }
    } else if (expr.l.k === "sym" && expr.r.k === "num") {
      // sym - num: the drag SUBTRACTS from the position, so it ADDS to what's being subtracted... i.e. increasing the position means DECREASING this literal.
      const adjusted = adjustLiteral(expr.r, -1);
      return adjusted
        ? { ok: true, expr: bin("-", expr.l, adjusted) }
        : declineNonLiteral();
    }
  }
  return declineNonLiteral();
}

function declineNonLiteral(): InvertResult {
  return {
    ok: false,
    reason:
      "this formula isn't a simple reference plus a constant — edit it in the formula field instead of dragging.",
  };
}

export interface FormulaDragResult {
  ok: true;
  x: Expr;
  y: Expr;
}

export interface FormulaDragFailure {
  ok: false;
  /** Which coordinate(s) declined, and why. A node can be draggable on one axis and not the other; the caller decides whether that's still "draggable" for its own UI (Sec.7.3 doesn't distinguish per-axis, so the reference implementation below declines the whole drag if EITHER axis can't invert, matching "read-only marker" as an all-or-nothing state). */
  reasons: readonly string[];
}

export function tryInvertFormulaOffset(
  x: Expr,
  y: Expr,
  dx: number,
  dy: number,
): FormulaDragResult | FormulaDragFailure {
  const rx = tryInvertFormulaCoordinate(x, dx);
  const ry = tryInvertFormulaCoordinate(y, dy);
  if (rx.ok && ry.ok) return { ok: true, x: rx.expr, y: ry.expr };
  const reasons: string[] = [];
  if (!rx.ok) reasons.push(`x: ${rx.reason}`);
  if (!ry.ok) reasons.push(`y: ${ry.reason}`);
  return { ok: false, reasons };
}

// ---------------------------------------------------------------------------
// The SAME rule Sec.7.3 states for a `formula` offset, applied to the other
// two kinds, which the first cut of this module left unguarded.
//
// `polar` and `cartesian` offsets were treated as always-numeric and simply
// overwritten with literals. They are not always numeric. Two shapes reach
// here carrying a live symbolic reference:
//
//   1. A group member's own theta is `add(group.rotation, offsetTerm)`
//      (`expand.ts`), so a group whose ROTATION is symbolic (a `RandomParam`,
//      Sec.4.5's own worked `ROTATION_PLAYER` example) gives every member a
//      theta that steers off that parameter. Overwriting it with a literal
//      freezes that one member at a single angle while its siblings keep
//      rotating per seed, silently. Since perimeter-symbolic-rotation-slice-
//      a-brief.md item 2, this now includes square/triangle/polygon too — a
//      perimeter member is `polar` unconditionally, so it reaches this same
//      `polar` branch and the same absorb path below, with no new code.
//   2. Any placement whose radius/angle/dx/dy was typed as a formula, which
//      the panel's own `FormulaField` has allowed since the formula field
//      landed. Before that field existed these fields were plain numbers and
//      the assumption held, which is why it was safe when it was written and
//      is not safe now.
//
// Sec.7.3's rule is not about the `formula` KIND, it is about not discarding
// a user's expression: "silently discarding a user's formula because they
// brushed the canvas is unacceptable". So the same decline applies here.
// Declining (rather than absorbing the delta into the numeric term, which is
// what `tryInvertFormulaCoordinate` does for `sym ± num`) is the conservative
// half of that rule and matches what Sec.4.5 already does one layer over,
// where `reExpand` leaves a non-numeric member offset untouched rather than
// rewriting it. Absorbing the delta instead is a real option and a real
// design decision, recorded in `docs/land-placement-shape-kinds-escalation.md`
// rather than taken here.
// ---------------------------------------------------------------------------

/** The subset of `[label, expr]` pairs whose expression depends on something outside itself. Order is the caller's, so the message reads in field order. */
function symbolicComponents(
  components: ReadonlyArray<readonly [string, Expr]>,
): string[] {
  return components
    .filter(([, e]) => evalClosed(e) === undefined)
    .map(([label]) => label);
}

/**
 * One wording, exported so the panel's own gizmo handles (which edit a
 * `ShapeGroup`'s radius/rotation directly, never through `applyDrag`) decline
 * in the same words rather than inventing a second phrasing for the same
 * refusal.
 */
export function symbolicDeclineReason(labels: readonly string[]): string {
  if (labels.length === 1) {
    return `${labels[0]} is a formula, so dragging would replace it with a fixed number. Edit it in the panel instead.`;
  }
  const names = `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} are formulas, so dragging would replace them with fixed numbers. Edit them in the panel instead.`;
}

// ---------------------------------------------------------------------------
// The dispatcher a canvas handler actually calls.
// ---------------------------------------------------------------------------

export type DragOutcome =
  { ok: true; placement: Placement } | { ok: false; reason: string };

/**
 * shape-kinds-slice-b-brief.md item 2 / escalation §6: the placement's own
 * CURRENTLY RESOLVED numeric offset (`evalExpr(offset.r/theta or dx/dy, …)`
 * against the live emission), the one new input the absorb path needs
 * alongside the anchor and the drop point. `kind` must match the
 * placement's own `offset.kind`; a mismatch (or omission) is read as "no
 * resolved values available" and `applyDrag` falls back to today's decline,
 * never a crash or a guess.
 */
export type ResolvedOffsetComponents =
  | { kind: "polar"; r: number; theta: number }
  | { kind: "cartesian"; dx: number; dy: number };

/**
 * `anchor` is the PARENT's own resolved position (map centre for a root),
 * used only by `polar`/`cartesian`, which are defined relative to it.
 * `previousPosition` is the DRAGGED NODE's own resolved position before this
 * drag, used only by `formula`, whose `x`/`y` are the absolute position
 * directly (frame.ts's own rule: never combined with an anchor), so what a
 * `formula` node needs to absorb is the drag's own delta from where IT
 * itself was, not from its parent. Both are the caller's job to look up
 * (`EmissionOk.quantities`/`resolved`, per-node). This module has no notion
 * of a whole model or emission, only the geometry of one drag.
 * `parentDegreesResolved` is `polar`'s own extra input, see `dragPolar`.
 * `isPerPlayerMember`, per-player-escalation.md Sec.7.7/8.2: a member of a
 * `perPlayer` `ShapeGroup` has its theta unconditionally replaced by a `sym`
 * reference to a prologue constant at emission time (emitModel.ts), for
 * EVERY member, whether or not it carries an authored rule (slice A already
 * builds the even default's own substitution). `placement.offset.theta`
 * therefore reads as an ordinary literal-shaped bin here — `evalClosed`
 * would happily resolve it — while the engine will never see that value:
 * freezing it into a real number would silently pin one player's angle at a
 * single count-independent degree, discarding the very rearrangement the
 * ring exists for. Declining is not optional the way it is for an ordinary
 * symbolic offset; it is true for EVERY perPlayer member by construction,
 * which is why the caller passes this rather than this module trying to
 * infer it from the Expr shape alone (it cannot: the shape is identical to a
 * perfectly draggable literal ring member's).
 */
export function applyDrag(
  placement: Placement,
  anchor: PercentPoint,
  previousPosition: PercentPoint,
  droppedAt: PercentPoint,
  parentDegreesResolved: number | undefined,
  isPerPlayerMember = false,
  resolvedOffset?: ResolvedOffsetComponents,
): DragOutcome {
  if (placement.offset.kind === "polar") {
    const symbolic = symbolicComponents([
      ["Radius", placement.offset.r],
      ["Angle", placement.offset.theta],
    ]);
    if (isPerPlayerMember && !symbolic.includes("Angle"))
      symbolic.push("Angle");

    const target = dragPolar(
      anchor,
      droppedAt,
      placement.frame,
      parentDegreesResolved,
    );
    if (symbolic.length === 0) {
      return {
        ok: true,
        placement: {
          ...placement,
          offset: { kind: "polar", r: num(target.r), theta: num(target.theta) },
        },
      };
    }
    if (resolvedOffset?.kind !== "polar")
      return { ok: false, reason: symbolicDeclineReason(symbolic) };

    // Item 2's absorb path (escalation §6). Both components run through the
    // SAME inverter a numeric-literal drag already degenerates to (a bare
    // `num` absorbs the delta exactly the way an ordinary drag would
    // overwrite it), so nothing here special-cases "was this one actually
    // symbolic" beyond Angle's own forced exception below. Angle is checked
    // and force-declined BEFORE any invert is attempted, never after
    // (hazard 5): a perPlayer member's theta is discarded wholesale by the
    // emitter regardless of its own shape (Sec.8.2), so absorbing a delta
    // into it would report success and change nothing on the map.
    const rResult = tryInvertFormulaCoordinate(
      placement.offset.r,
      target.r - resolvedOffset.r,
    );
    const thetaResult: InvertResult = isPerPlayerMember
      ? { ok: false, reason: symbolicDeclineReason(["Angle"]) }
      : tryInvertFormulaCoordinate(
          placement.offset.theta,
          target.theta - resolvedOffset.theta,
        );

    const reasons: string[] = [];
    if (!rResult.ok) reasons.push(`Radius: ${rResult.reason}`);
    if (!thetaResult.ok)
      reasons.push(
        isPerPlayerMember ? thetaResult.reason : `Angle: ${thetaResult.reason}`,
      );
    if (reasons.length > 0) return { ok: false, reason: reasons.join("; ") };

    return {
      ok: true,
      placement: {
        ...placement,
        offset: {
          kind: "polar",
          r: (rResult as { ok: true; expr: Expr }).expr,
          theta: (thetaResult as { ok: true; expr: Expr }).expr,
        },
      },
    };
  }
  if (placement.offset.kind === "cartesian") {
    const symbolic = symbolicComponents([
      ["Across", placement.offset.dx],
      ["Down", placement.offset.dy],
    ]);

    const target = dragCartesian(anchor, droppedAt);
    if (symbolic.length === 0) {
      return {
        ok: true,
        placement: {
          ...placement,
          offset: { kind: "cartesian", dx: num(target.dx), dy: num(target.dy) },
        },
      };
    }
    if (resolvedOffset?.kind !== "cartesian")
      return { ok: false, reason: symbolicDeclineReason(symbolic) };

    // The identical treatment, componentwise (item 1's own delta rule one
    // module over): dx against dx, dy against dy, same inverter.
    const dxResult = tryInvertFormulaCoordinate(
      placement.offset.dx,
      target.dx - resolvedOffset.dx,
    );
    const dyResult = tryInvertFormulaCoordinate(
      placement.offset.dy,
      target.dy - resolvedOffset.dy,
    );

    const reasons: string[] = [];
    if (!dxResult.ok) reasons.push(`Across: ${dxResult.reason}`);
    if (!dyResult.ok) reasons.push(`Down: ${dyResult.reason}`);
    if (reasons.length > 0) return { ok: false, reason: reasons.join("; ") };

    return {
      ok: true,
      placement: {
        ...placement,
        offset: {
          kind: "cartesian",
          dx: (dxResult as { ok: true; expr: Expr }).expr,
          dy: (dyResult as { ok: true; expr: Expr }).expr,
        },
      },
    };
  }
  // formula: x/y are the absolute position itself, so the delta this drag
  // contributes is relative to the node's OWN prior position, never `anchor`.
  const dx = droppedAt.x - previousPosition.x;
  const dy = droppedAt.y - previousPosition.y;
  const inverted = tryInvertFormulaOffset(
    placement.offset.x,
    placement.offset.y,
    dx,
    dy,
  );
  if (!inverted.ok) {
    return { ok: false, reason: inverted.reasons.join("; ") };
  }
  return {
    ok: true,
    placement: {
      ...placement,
      offset: { kind: "formula", x: inverted.x, y: inverted.y },
    },
  };
}
