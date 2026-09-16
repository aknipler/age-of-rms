// Sec.4.5: ShapeGroup expansion. `ShapeGroup` has been typed in model.ts
// since slice 1 and had zero consumers. Nothing has ever expanded one
// before this module.
//
// theta = rotation + i × (360 / repeats) + j × (360 / N), N = pattern.length
// × repeats, "evaluated AT EMIT TIME to an integer literal per land", that
// integrality is what satisfies Sec.5.4's macro guard at every repeat count
// including 7 (360/7 is not an integer, and the trig macro's sign trick
// `(R*2+1) % 2` only holds when its OWN input is; Sec.5.4's "self-guarding
// by construction" argument is about the `%`-cast on the FULL angle, not
// this fractional intermediate, so the intermediate has to be made integral
// here rather than relied upon to survive). Rounding once in JS, at
// expansion time, is also strictly more accurate than emitting the division
// and letting the engine's own `%` cast truncate it later (Sec.5.4 point 2:
// max error 0.5° rounded vs 1.0° truncated), so this is correct AND the
// higher-quality choice, not a shortcut.

import { add, divE, mul, num } from "./compiler/expr";
import type { Expr } from "../../../../tools-api/index";
import type { Placement, ShapeGroup, PatternSlot } from "./model";
import { perimeterPolar } from "./perimeterOffset";

/** Sec.4.5's stated invariant, as a function rather than a comment: `members[k]`'s key is derived from its POSITION, never stored. */
export function memberKeyAt(
  index: number,
  pattern: readonly PatternSlot[],
): { repeatIndex: number; slotId: string } {
  const patternLength = pattern.length;
  if (patternLength === 0)
    throw new Error(
      "memberKeyAt: an empty pattern has no slots to key against",
    );
  return {
    repeatIndex: Math.floor(index / patternLength),
    slotId: pattern[index % patternLength].id,
  };
}

function angleOffsetDegrees(
  repeatIndex: number,
  slotIndex: number,
  patternLength: number,
  repeats: number,
): number {
  const n = patternLength * repeats;
  const repeatTerm = repeats > 0 ? (360 / repeats) * repeatIndex : 0;
  const slotTerm = n > 0 ? (360 / n) * slotIndex : 0;
  // Math.round, not Math.trunc: Sec.5.4 point 2 is explicit that rounding to
  // nearest is the more accurate of the two available integer choices.
  return Math.round(repeatTerm + slotTerm);
}

export interface ShapeGroupExpansion {
  /**
   * Freshly-built Placements, ordered repeat-major then pattern order, the
   * SAME order `members` below uses, since that ordering is what lets a
   * later key lookup use `memberKeyAt` instead of storing the key twice.
   */
  placements: Placement[];
  /** What `ShapeGroup.members` should be set to: the placements above, by id, in the same order. */
  members: string[];
}

/**
 * Slice-A shape-kinds work (shape-kinds-slice-a-brief.md item 3): the dual of
 * `circle` in the same polar representation. Circle holds `r` fixed and
 * varies `theta` per member; a line holds `theta` fixed at `rotation` and
 * varies `r`, SIGNED, so members run from one end through the anchor to the
 * other. `radius` is the half length (the escalation's own "reuse radius,
 * avoid a new field" option, and it puts the radius gizmo handle — which
 * sits at `(radius, rotation)` — exactly on the far end member, so the
 * existing handle drags a line's length with no change to gizmoGeometry.ts).
 *
 * Emitted as an integer RATIO (`2m - span` over `span`), never a baked
 * decimal: both are legal (Sec.5.1, floats flow through), but the ratio
 * reads like the corpus and stays exact under a symbolic radius, which a
 * 17-digit decimal only approximates.
 *
 * `span === 0` (a one-member line) sits at the anchor, not at either end —
 * worth stating because the obvious first guess is that it degenerates to
 * the radius.
 */
function lineOffset(base: Expr, m: number, span: number): Expr {
  return span === 0 ? num(0) : divE(mul(base, num(2 * m - span)), num(span));
}

/**
 * Item 4: `circle`'s own formula with the full turn replaced by `sweep` and
 * the divisor `N` replaced by `N - 1`, because an arc occupies BOTH of its
 * ends while a ring's last member deliberately stops short of its first
 * (`sweep`'s own doc comment in model.ts has the full reasoning, including
 * why 360 does not degenerate to a circle here).
 *
 * `Math.round`, once, at expansion time, for the same reason
 * `angleOffsetDegrees` already rounds rather than lets the engine's `%` cast
 * truncate later (Sec.5.4 point 2).
 */
function arcStepDegrees(sweep: number, m: number, span: number): number {
  return span === 0 ? 0 : Math.round((sweep * m) / span);
}

/**
 * Items 4 (`square`) and 1 (`triangle`/`polygon`, shape-kinds-slice-c-brief.md),
 * now an ordinary `polar` offset (perimeter-symbolic-rotation-slice-a-brief.md
 * item 2, escalation Sec.8.3): every perimeter kind calls the shared
 * `perimeterPolar` at its own fixed or configured side count to get a scale
 * and a bearing OFFSET, neither of which depends on the group's rotation at
 * all. Rotation is an ordinary additive term on the member's bearing — the
 * geometry never sees it, exactly the shape `circle` already has, so a
 * symbolic rotation (a `param`, a `sym`, `rnd()`) works here for free. A
 * symbolic radius keeps working too, unchanged: it multiplies a baked
 * scalar, so it can be any `Expr`.
 *
 * `shiftPercent` (perimeter-symbolic-rotation-slice-b-brief.md item 2):
 * `slot.perimeterShift ?? 0`, threaded straight through to `perimeterPolar`.
 * The whole change this slice makes to this function.
 */
function perimeterKindOffset(
  sides: number,
  base: Expr,
  group: ShapeGroup,
  m: number,
  n: number,
  shiftPercent: number,
): { r: Expr; theta: Expr } {
  const { radiusScale, bearingDegrees } = perimeterPolar(
    sides,
    n,
    m,
    shiftPercent,
  );
  // Rotation is the OUTER addend, exactly as `circle` writes it below and
  // for exactly the reason `circle`'s own comment gives: a symbolic
  // rotation has to keep steering every member.
  return {
    r: mul(base, num(radiusScale)),
    theta: add(group.rotation, num(bearingDegrees)),
  };
}

/**
 * Item 1: clamp, don't refuse. A hand-edited model with `sides: 2` has no
 * polygon to draw, and unlike every other refusal this feature makes, a
 * clamp here can never let a wrong value reach an emitted map — the panel's
 * own Sides input (min 3) keeps the case from arising in the first place,
 * so a floor is the honest answer, not a shortcut around a real check.
 * Defaults an absent `sides` to a hexagon, a plain number rather than any
 * particular geometric significance.
 */
function clampSides(sides: number | undefined): number {
  return Math.max(3, Math.trunc(sides ?? 6));
}

/**
 * Builds a group "from scratch", what it would look like with no prior
 * state at all. `reExpand.ts` (Sec.4.5's merge rule) is what decides, member
 * by member, whether to keep an EXISTING Placement or adopt one of these
 * fresh ones; this function does not know about prior state and does not
 * try to. A kind decides two things only, `theta` and `r`'s own defaults
 * (`slot.theta`/`slot.radius` still override either one), which is what
 * keeps `frame.ts`, `reExpand.ts` and every panel module out of this slice
 * entirely: every kind here still produces a plain `polar` offset.
 */
export function expandShapeGroup(group: ShapeGroup): ShapeGroupExpansion {
  const { pattern, repeats } = group;
  if (pattern.length === 0 || repeats <= 0)
    return { placements: [], members: [] };

  const n = pattern.length * repeats;
  const span = n - 1;

  const placements: Placement[] = [];
  for (let i = 0; i < repeats; i++) {
    for (let j = 0; j < pattern.length; j++) {
      const slot = pattern[j];
      const m = i * pattern.length + j;

      let offset: Placement["offset"];
      switch (group.kind) {
        case "line": {
          // The linear index `m`/`span` here is item 2's own instruction:
          // compute a fresh linear index for the new kinds rather than
          // reusing circle's two-term (repeat, slot) formula, which rounds
          // differently under float association and would move Sec.10.1's
          // byte-identical acceptance gate.
          const base: Expr = slot.radius ?? group.radius;
          offset = {
            kind: "polar",
            r: lineOffset(base, m, span),
            theta: add(group.rotation, slot.theta ?? num(0)),
          };
          break;
        }
        case "arc": {
          const step = arcStepDegrees(group.sweep ?? 180, m, span);
          offset = {
            kind: "polar",
            r: slot.radius ?? group.radius,
            theta: add(group.rotation, slot.theta ?? num(step)),
          };
          break;
        }
        // Perimeter kinds (shape-kinds-slice-c-brief.md item 1, now polar —
        // perimeter-symbolic-rotation-slice-a-brief.md item 2): PatternSlot.theta
        // has no meaning for any of them (model.ts's own doc comment on that
        // field says so), so it is deliberately not consulted here the way
        // `line`/`arc`/`circle` all consult it — a perimeter member's bearing
        // is derived from its position on the perimeter, not authored per
        // slot. `square`/`triangle` fix their own side count; `polygon` is
        // the one kind whose side count is a model value, clamped rather
        // than refused (`clampSides`).
        case "square": {
          const base: Expr = slot.radius ?? group.radius;
          offset = {
            kind: "polar",
            ...perimeterKindOffset(
              4,
              base,
              group,
              m,
              n,
              slot.perimeterShift ?? 0,
            ),
          };
          break;
        }
        case "triangle": {
          const base: Expr = slot.radius ?? group.radius;
          offset = {
            kind: "polar",
            ...perimeterKindOffset(
              3,
              base,
              group,
              m,
              n,
              slot.perimeterShift ?? 0,
            ),
          };
          break;
        }
        case "polygon": {
          const base: Expr = slot.radius ?? group.radius;
          offset = {
            kind: "polar",
            ...perimeterKindOffset(
              clampSides(group.sides),
              base,
              group,
              m,
              n,
              slot.perimeterShift ?? 0,
            ),
          };
          break;
        }
        case "circle":
        default: {
          // Do NOT rewrite this in terms of `m`/`n` above: circle's own
          // `angleOffsetDegrees` is algebraically `360 * m / n`, but the two
          // forms round differently under float association at an exact
          // half degree, and Sec.10.1's acceptance gate is a byte
          // comparison.
          const offsetTerm: Expr =
            slot.theta ??
            num(angleOffsetDegrees(i, j, pattern.length, repeats));
          // rotation is always the outermost addend, so a SYMBOLIC rotation
          // (Bulls_Eyes' own ROTATION_PLAYER, if this were a patterned ring
          // rather than a chain) keeps steering every member (Sec.4.5: "must
          // survive a symbolic group").
          offset = {
            kind: "polar",
            r: slot.radius ?? group.radius,
            theta: add(group.rotation, offsetTerm),
          };
        }
      }

      placements.push({
        id: `${group.id}#${i}#${slot.id}`,
        parent: group.parent,
        frame: group.frame,
        offset,
        label: `${group.id}_${i}_${slot.id}`,
        // model.ts's Placement.role/repeatIndex doc comment: a group member's
        // role comes from its own pattern slot, and its repeat index is `i`,
        // both are what the emission orchestrator needs to know which
        // create_land skeleton (if any) this member owns.
        role: slot.role,
        repeatIndex: i,
      });
    }
  }
  return { placements, members: placements.map((p) => p.id) };
}
