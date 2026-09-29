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
   * `PlayerSlot.perRepeat`), `expandShapeGroup` sets this to the member's own `i`;
   * a standalone Placement using a `perRepeat` role (again,
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
  /**
   * Per-attribute deviation from this placement's role (role-attributes-
   * escalation.md Sec.5, Q11). Absent, or an absent key, means the role's
   * own value is used. Every key holds a value in the SAME domain as the
   * role field it shadows, so an override can never change an attribute's
   * kind, and it REPLACES the role's value rather than composing with it
   * (Sec.5.3: there is no delta between two arms of a union, and a field
   * that means two things depending on context is the failure mode this
   * feature keeps naming).
   *
   * `thetaPerCount`'s shape rather than `nudged`'s, for a mechanical
   * reason: a `Placement` has no `terrain` or `baseSize` field for the
   * deviation to live in, so the override has to carry the value itself.
   * Structural (`Partial<Omit<LandRole, …>>`) rather than a hand-written
   * second interface, so the override set cannot drift from the role's own
   * fields when a later session adds one.
   */
  roleOverrides?: RoleOverrides;
}

export type RoleOverrides = Partial<Omit<LandRole, "id" | "label">>;

/**
 * The role a placement ACTUALLY wears: the role's fields with this
 * placement's overrides laid over them, key by key. The one place the
 * replacement rule is spelled out; emission, the attachment predicate and
 * the panel all read this rather than merging by hand.
 */
export function effectiveRole(
  role: LandRole,
  overrides: RoleOverrides | undefined,
): LandRole {
  if (overrides === undefined) return role;
  // `Object.entries` loses the key/value pairing TypeScript would need to
  // type this loop, so it is spelled out as a filtered spread instead: only
  // defined keys are laid over the role.
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as RoleOverrides;
  return { ...role, ...defined };
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
  /**
   * `land_percent` OR `number_of_tiles`, never both (role-attributes-
   * escalation.md Sec.4.1). A discriminated union rather than two optional
   * fields, because `language.json` marks the pair `mutexWith` and
   * `validate.ts` raises RMS0307 on a block carrying both; two fields could
   * emit a create_land the app's own parser then flags. The union makes the
   * illegal pair unrepresentable, the same move `ZonePolicy` already makes
   * for the zone mutex.
   */
  extent: LandExtent;
  zone: ZonePolicy;
  /** `assign_to_player` OR `assign_to`, the other `mutexWith` pair, same reasoning (Sec.4.2). */
  assign: AssignPolicy;

  // --- The optional attributes (role-attributes-escalation.md Sec.2). ------
  // Every one an `Expr` under Sec.4.3's rule: the tool never consumes the
  // value, it writes a `#const` the engine reads. ABSENT MEANS THE ATTRIBUTE
  // IS NOT WRITTEN, which is not the same map as writing the documented
  // default (`border_fuzziness` defaults to 20, `clumping_factor` to 8, so a
  // role that wrote 0 for "leave it alone" would reshape every land). Same
  // trap `grid.layer` fell into when 0 doubled as GRASS (Sec.4.5).
  // Four border fields rather than one record, so a per-land override
  // (Sec.5) stays per attribute; `Partial<>` does not recurse.
  leftBorder?: Expr;
  rightBorder?: Expr;
  topBorder?: Expr;
  bottomBorder?: Expr;
  borderFuzziness?: Expr;
  clumpingFactor?: Expr;
  otherZoneAvoidanceDistance?: Expr;
  landConformity?: Expr;
  /**
   * Emitted LAST in the skeleton, after the assign attribute, because
   * guide:1145 says `land_id` "must be used after assign_to_player /
   * assign_to since they will reset the ID" (Sec.4.6). landCommand.ts owns
   * that ordering; this comment is here so a reader of the model knows the
   * field is order-sensitive.
   */
  landId?: Expr;
  /** `set_circular_base`, a flag: shared by presence in the skeleton, no constant to emit (Sec.4.4). */
  circularBase?: boolean;
}

/**
 * The optional VALUED attributes, one table read by `roleEmit.ts` (which
 * constant to allocate), `landCommand.ts` (which attribute to write it
 * under) and `emitModel.ts` (which `Expr` to resolve), so the three cannot
 * drift apart the way three hand-written lists would (the repo's own
 * "two independently-hand-written lists staying in sync" lesson,
 * landCommand.ts). In emission order. `land_id` is in the table for the
 * constant and the resolution, and `landCommand.ts` places it after the
 * assign attribute rather than in table order (Sec.4.6).
 */
export const ROLE_OPTIONAL_ATTRIBUTES = [
  { field: "leftBorder", attribute: "left_border", stem: "ROLE_LEFT_BORDER" },
  {
    field: "rightBorder",
    attribute: "right_border",
    stem: "ROLE_RIGHT_BORDER",
  },
  { field: "topBorder", attribute: "top_border", stem: "ROLE_TOP_BORDER" },
  {
    field: "bottomBorder",
    attribute: "bottom_border",
    stem: "ROLE_BOTTOM_BORDER",
  },
  {
    field: "borderFuzziness",
    attribute: "border_fuzziness",
    stem: "ROLE_FUZZINESS",
  },
  {
    field: "clumpingFactor",
    attribute: "clumping_factor",
    stem: "ROLE_CLUMPING",
  },
  {
    field: "otherZoneAvoidanceDistance",
    attribute: "other_zone_avoidance_distance",
    stem: "ROLE_ZONE_AVOIDANCE",
  },
  {
    field: "landConformity",
    attribute: "land_conformity",
    stem: "ROLE_CONFORMITY",
  },
  { field: "landId", attribute: "land_id", stem: "ROLE_LAND_ID" },
] as const satisfies readonly {
  field: keyof LandRole;
  attribute: string;
  stem: string;
}[];

export type RoleOptionalField =
  (typeof ROLE_OPTIONAL_ATTRIBUTES)[number]["field"];

export type LandExtent =
  { kind: "percent"; value: Expr } | { kind: "tiles"; value: Expr };

/**
 * A per-instance player number. `perRepeat` resolves at emit time from the
 * placement's repeat index and is written as a literal (Sec.6.2's per-repeat
 * exception); `fixed` is an `Expr` emitted as a role constant, like a fixed
 * zone, because the tool never consumes it and a fixed value is not
 * per-repeat, so the ownership split says it is a reference. The corpus
 * writes a `#const` there (`CoastalForest.rms`, `assign_to AT_COLOR
 * L1_COLOUR 0 0`), which a plain number could not round-trip.
 */
export type PlayerSlot =
  | { kind: "fixed"; value: Expr }
  | { kind: "perRepeat"; base: number; step: number }; // number = base + step * repeatIndex

export type AssignTarget = "AT_PLAYER" | "AT_COLOR" | "AT_TEAM";

export type AssignPolicy =
  | { kind: "none" }
  | { kind: "player"; number: PlayerSlot } // assign_to_player N
  | {
      kind: "assignTo"; // assign_to TARGET N MODE FLAGS, four arguments, never two (Sec.9)
      target: AssignTarget;
      number: PlayerSlot;
      /** `language.json` declares -1..0; a literal domain rather than `number` because it is a choice, not a quantity (Sec.4.3). */
      mode: -1 | 0;
      /** 0..3, same reasoning. */
      flags: 0 | 1 | 2 | 3;
    };

export type ZonePolicy =
  | { kind: "none" }
  | { kind: "fixed"; zone: number }
  | { kind: "perRepeat"; base: number; step: number } // zone = base + step * repeatIndex
  | { kind: "random" }; // set_zone_randomly, a flag with no argument

/** Today's `assignToPlayer: true`, spelled in the new shape: `assign_to AT_PLAYER <repeatIndex + 1> 0 0`. */
export const ASSIGN_TO_PLAYER_PER_REPEAT: AssignPolicy = {
  kind: "assignTo",
  target: "AT_PLAYER",
  number: { kind: "perRepeat", base: 1, step: 1 },
  mode: 0,
  flags: 0,
};

/**
 * True when a role's lands belong to a player in the engine's sense (Sec.6.3,
 * P3): any assignment at all, since the guide's "lands belonging to players
 * will be in a circle and land_position will be ignored, unless
 * direct_placement" is about ownership, not about which spelling assigned it.
 */
export function isPlayerAssigned(assign: AssignPolicy): boolean {
  return assign.kind !== "none";
}

/**
 * One chained child, authored once on a `PatternSlot` and expanded onto
 * every member that slot produces (composite-pattern-escalation.md Sec.5,
 * Q12). The offset is in the MEMBER's own frame, so `radial` means Sec.4.2's
 * angle ABC measured at that member. Depth 1 by measurement rather than
 * taste (Sec.5.3: the corpus's deepest chain is 1, in one map); a template
 * cannot carry templates, and a deeper chain stays reachable by parenting a
 * standalone `Placement` to an expanded chain child.
 */
export interface ChainTemplate {
  /** Stable; with (repeatIndex, slotId) this is the merge key. */
  id: string;
  role: string; // LandRole id
  /** The stem of the expanded children's labels. */
  label: string;
  frame: FrameKind;
  offset: Placement["offset"];
}

export interface PatternSlot {
  /** Stable; with the repeat index this is Sec.4.5's merge key for re-expansion. */
  id: string;
  /**
   * LandRole id. Absent means the slot's members are points only, emitted as
   * coordinates with no `create_land`, the same as a standalone Placement
   * with no role (decided 2026-09-28). A points-only ring is a set of
   * anchors that other lands can be parented to or chained off, with no
   * land sitting on the shape itself. `expandShapeGroup` copies this onto
   * each member unchanged, so an absent slot role is an absent member role,
   * which the emitter already reads as a chain anchor.
   */
  role?: string;
  /** Absent or empty means this slot's members have no templated children (Q12). */
  chain?: ChainTemplate[];
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

export interface GroupJitter {
  /** A `perPlayer` RandomParam id, drawn `rnd(-amount, amount)`. */
  param: string;
  unit: "deg" | "percent";
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
   * Expanded chain children (Q12), ordered repeat-major, then pattern
   * order, then template order; length exactly
   * `repeats × Σ(slot.chain?.length ?? 0)`. Kept SEPARATE from `members` so
   * `memberKeyAt`'s positional key derivation is untouched (composite-
   * pattern-escalation.md Sec.5.1), and OPTIONAL so a fence written before
   * this field existed reads back unchanged: absent and empty mean the same
   * thing everywhere, and a model with no templates is byte-identical to
   * one written before the feature (its Sec.9's regression gate).
   */
  chainMembers?: string[];
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
   * Random jitter added to each player's EVEN DEFAULT angle, per-player
   * rings only (per-player-escalation.md Sec.11, built 2026-09-28).
   * `buildPrologue` adds it inside every count's branch. A member with an
   * authored angle or a per-count override is left alone, since those
   * already say exactly where the member goes.
   *
   * A group field rather than a `rnd(...)` typed into a member's angle,
   * because an authored angle REPLACES the even default
   * (`resolveMemberAngle`, first match wins). Typed into a member, the draw
   * would pin that member to its 8-player position at every count.
   *
   * `param` names a `perPlayer` RandomParam, so each player gets their own
   * draw and a player's slots move together. `deg` adds the draw in
   * degrees. `percent` scales it by the even gap at each count,
   * `draw * gap / 100`, so one percentage is equally safe at every count.
   * On an arc the gap is `sweep / (N - 1)`, and a branch with one member
   * gets no draw (land-placement-per-player-any-kind-escalation.md Sec.5.2).
   * The emitter refuses the field on a ring that is not per-player, or
   * when the param is not per-player, because every member would then
   * share one draw and the result would be a rotation, not jitter.
   */
  jitter?: GroupJitter;
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
