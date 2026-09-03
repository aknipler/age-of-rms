// The Advanced Land Placement model, docs/land-placement-design.md Sec.4.1
// (the graph), Sec.4.4 (random parameters), Sec.4.5 (roles and repeating
// patterns). SLICE 1 (Sec.13): consumed by the frame algebra (frame.ts) and
// the math compiler (compiler/); no panel, no host wiring, that is slice 2.

import type { Expr, Ref } from "../../../../tools-api/index";

export type FrameKind = "radial" | "absolute";
/** "center" is the map centre; anything else is a Placement id. */
export type Anchor = "center" | string;

export interface Placement {
  id: string; // stable; survives reorder
  parent: Anchor; // parent placement id, this is the chain
  frame: FrameKind;
  offset:
    // `theta` in a radial frame IS the angle ABC of Sec.4.2, signed, degrees,
    // measured at the parent from the ray pointing back at the parent's own
    // anchor. In an absolute frame it is a plain world bearing.
    | { kind: "polar"; r: Expr; theta: Expr }
    | { kind: "cartesian"; dx: Expr; dy: Expr }
    | { kind: "formula"; x: Expr; y: Expr }; // the custom-formula escape hatch
  label: string; // user-facing, and the seed of the emitted const names
  /**
   * Set when the user has edited this member away from its group's expansion
   * (Sec.4.1). Load-bearing, not decorative: Sec.4.5's merge rule branches on
   * it, unset recomputes the offset wholesale from the new group, set
   * re-applies the user's edit as a delta against the new base.
   */
  nudged?: boolean;
  /**
   * UNDOCUMENTED IN THE DESIGN DOC, DECIDED HERE (per CLAUDE.md: "if a spec
   * seems wrong or ambiguous, stop and escalate", this is the narrower case
   * of a spec that is simply silent on a combination it never considered, not
   * one that contradicts itself, the same class frame.ts's own header
   * documents two of). Sec.4.5 puts a `LandRole` id on `PatternSlot.role`,
   * one per SLOT in a group's pattern, but a `Placement` is what the
   * emission orchestrator (item 2) and the panel's own tree (Sec.8, "every
   * land shows which role it wears") both need to know a role for, and
   * Bulls_Eyes' own P1/P2/aux lands are ordinary standalone Placements with
   * NO `ShapeGroup` at all (Sec.4.5: "NOT a patterned ring"). So a group's
   * `expandShapeGroup` copies `PatternSlot.role` onto each member it
   * generates here rather than making every consumer re-derive it by walking
   * back through `(group, memberKeyAt)`, and a standalone Placement (never
   * built by `expandShapeGroup`) sets it directly. Absent means "this
   * placement is a chain anchor with no land of its own", a real case
   * (Sec.4.2's grandchild composition), so it stays optional rather than
   * required.
   */
  role?: string;
  /**
   * The same undocumented-but-decided gap, for the OTHER thing a role's
   * per-instance attributes need (Sec.4.5: `ZonePolicy.perRepeat`,
   * `assignToPlayer`), `expandShapeGroup` sets this to the member's own `i`;
   * a standalone Placement using a `perRepeat`/`assignToPlayer` role (again,
   * Bulls_Eyes' P1/P2) sets it directly. 0-based, matching
   * `LandSkeletonInput.repeatIndex` (landCommand.ts) exactly, since this is
   * where that field's value comes from for a group member.
   */
  repeatIndex?: number;
  /**
   * Angle at a specific player count, overriding `offset.theta` there
   * (per-player-escalation.md Sec.8.3, slice-c-brief.md item 1). Only
   * consulted inside a `perPlayer` group's member; keyed by the exact count
   * ("P2 is 30 degrees from P1 at 2 players"), not a threshold. Lives on the
   * `Placement`, not the `PatternSlot`, for the same reason `nudged` does:
   * this is about ONE member, and a slot repeats across all of them.
   *
   * Theta only, deliberately. Per-count radius is a plausible later want and
   * was not asked for (slice-c-brief.md hazard 4).
   */
  thetaPerCount?: Record<number, Expr>;
}

export interface RandomParam {
  id: string;
  label: string; // becomes the emitted const name (Sec.5.6)
  min: number;
  max: number;
  /** Sec.4.4. false (default) = one draw shared everywhere; true = one draw per player. */
  perPlayer: boolean;
  /**
   * Sec.4.4 used to say a perPlayer param is only correct at the count it
   * was emitted for. per-player-escalation.md Sec.5.4 / slice-b-brief.md
   * item 3 lifted that: a perPlayer param now always emits at
   * MAX_PLAYER_COUNT, so `applyEdits.ts` no longer stamps this. Left
   * optional rather than removed — `preconditions.ts`'s `checkP2` still
   * reads it and is still a live check (the panel renders its mismatches),
   * it simply has nothing left to fire on for anything this tool itself
   * emits, since nothing sets it to a value that could ever mismatch the
   * live count.
   */
  emittedForPlayerCount?: number;
}

export interface LandRole {
  id: string;
  label: string; // "Player", "Neutral A", …, the const-name stem
  // Every attribute below emits as a `#const` the create_land references, so
  // editing the role edits one line and every land wearing it follows (Sec.6.2).
  // `Ref`, not `Expr`: a terrain is a NAME, not a number, and this repo already
  // paid for mixing the two (BUG-015 split `aliases` out of `symbols`). Sec.5.0.
  terrain: Ref;
  baseSize: Expr;
  baseElevation: Expr;
  landPercent: Expr;
  zone: ZonePolicy;
  assignToPlayer: boolean; // true → assign_to AT_PLAYER <repeat index>
}

export type ZonePolicy =
  | { kind: "none" }
  | { kind: "fixed"; zone: number }
  | { kind: "perRepeat"; base: number; step: number }; // zone = base + step * repeatIndex

export interface PatternSlot {
  /** Stable; with the repeat index this is Sec.4.5's merge key for re-expansion. */
  id: string;
  role: string; // LandRole id
  /**
   * Angular position within the ring; default even. Ignored for a
   * perimeter kind (`square`, `triangle`, `polygon`) — NOT because those
   * kinds have no angle of their own any more (perimeter-symbolic-rotation-
   * slice-a-brief.md item 2: every kind is `polar` now, and a perimeter
   * member's bearing is a real, emitted DEGREES cell). The reason is that a
   * perimeter member's bearing is DERIVED from its position on the
   * perimeter rather than authored directly, so there is nothing here for
   * this field to override; use `perimeterShift` to nudge that position
   * instead. `expandShapeGroup` does not consult this field for those
   * kinds.
   */
  theta?: Expr;
  radius?: Expr; // overrides the group radius, the "wavy ring" case
  /**
   * Percent of one lap around the perimeter, ADDED to this slot's even
   * position along it. `square`/`triangle`/`polygon` only; ignored by every
   * other kind, the same way `ShapeGroup.sweep` is ignored outside `arc`.
   *
   * A plain `number`, not an `Expr`, for `sweep`'s own reason: the value is
   * consumed at expansion time to bake a radius scale and a bearing, and
   * both are discontinuous in the fraction (the side index is a `floor` of
   * it), so a value the tool cannot see until the engine runs would have no
   * radius scale and no bearing at all. The type makes that unrepresentable
   * rather than needing a refusal (perimeter-symbolic-rotation-escalation.md
   * Sec.8.7, finding 1).
   *
   * A DELTA, not a replacement, deliberately unlike `theta` one field above.
   * `theta` replaces the even angular term, which stacks every repeat of a
   * slot at one bearing and is only usable at `repeats: 1`. This nudges the
   * slot's members along the shape and works at every repeat count.
   *
   * Signed; wraps past a full lap; absent means 0.
   */
  perimeterShift?: number;
}

export interface ShapeGroup {
  id: string;
  parent: Anchor;
  kind: "circle" | "square" | "triangle" | "polygon" | "line" | "arc";
  pattern: PatternSlot[]; // ONE repeat of the cycle: [P, A, B, A, C]
  repeats: number; // how many times it goes round
  radius: Expr; // default circumradius, PERCENT (Sec.4.3)
  rotation: Expr; // phase, degrees
  frame: FrameKind;
  // Ordered repeat-major then pattern order, length exactly
  // pattern.length * repeats, Sec.4.5's merge rule derives each member's
  // (repeatIndex, slotId) key from that position, so the ordering is an
  // invariant of the model rather than a rendering convenience.
  members: string[]; // pattern.length × repeats Placements
  /**
   * One repeat per player, resolved at runtime (per-player-escalation.md
   * Sec.8.1). `repeats` is held at MAX_PLAYER_COUNT while this is set, so
   * `expandShapeGroup`, `memberKeyAt` and `reExpand`'s merge rule keep
   * operating on a fixed member list and need no change at all; a member's
   * repeat index is a player index (Sec.4.5), and the emitter (emitModel.ts,
   * via prologue.ts) is what turns that into a runtime-conditional angle and
   * guard instead of the fixed literal `expandShapeGroup` bakes.
   */
  perPlayer: boolean;
  /**
   * Angular span for `kind: "arc"` ONLY, degrees, default 180. Ignored by
   * every other kind. A plain number rather than an `Expr` because it is
   * consumed at EXPANSION time to bake one integer degree literal per
   * member (Sec.5.4), the same way `repeats` is consumed to decide how
   * many members exist. A symbolic sweep could not be rounded to whole
   * degrees before the trig macro sees it, which is the property Sec.5.4
   * requires.
   *
   * Defaults to 180, not 360: a full 360 sweep divides by `N - 1` (an
   * arc's two ends are both occupied), which stacks the last member on
   * top of the first rather than closing into a ring the way `circle`
   * does. 360 is legal input, not a special case, and produces that
   * stack deliberately (shape-kinds-escalation.md §3(a), corrected).
   */
  sweep?: number;
  /**
   * Side count for `kind: "polygon"` ONLY, at least 3. `square` and
   * `triangle` hardcode 4 and 3 and carry no field of their own, since
   * their side count is exactly what makes them their own kinds — a
   * `square` with `sides: 5` would be a model disagreeing with its own
   * name. Absent or ignored for every other kind. Clamped rather than
   * refused at expansion (`clampSides` in expand.ts): a hand-edited
   * `sides: 2` has no polygon to draw, and this is the one place in the
   * feature where a floor beats a refusal — every OTHER refusal here
   * protects an EMITTED map from silently being wrong, and this value
   * can never reach one (the panel's own Sides input, min 3, keeps the
   * case from arising in the first place).
   */
  sides?: number;
}
