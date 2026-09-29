// per-player-escalation.md Sec.4.1/4.3, slice-a-brief items 3, 4, 5, 6: the
// per-player prologue. Turns a `perPlayer` ShapeGroup into three things,
// emitted once per fence, before everything else in the body:
//
//   - eight `if`/`elseif`/`endif` branches (1_PLAYER_GAME..8_PLAYER_GAME,
//     Sec.8.4: all eight, not 2 through 8), each defining the cumulative
//     `ALP_AT_LEAST_k` labels for its own count and one `ALP_DEG_Pk` angle
//     constant per player land, the position `memberOffset` (expand.ts)
//     gives that member at THAT count, and an `ALP_RAD_Pk` beside it on a
//     kind whose radius moves with the count (a line);
//   - a theta OVERRIDE per group member, and an r override where there is a
//     RAD cell (Sec.8.2: the emitter substitutes a
//     reference to the prologue constant it allocated, `expandShapeGroup`
//     itself is untouched and keeps baking the even literal at the pinned
//     maximum count);
//   - a guard label per placement (Sec.4.3: a land belonging to player k, or
//     CHAINED to one, is guarded by `ALP_AT_LEAST_k`; player 1 needs none).
//
// The conditional text is built from `renderConditionalBlock`, a structure
// that cannot unbalance (exactly one `if`, N-1 `elseif`s, one `endif`,
// always), never by string concatenation at the call site — the brief's own
// hazard 3, and the one the owner's hand-written example demonstrates.

import type { Expr } from "../../../../tools-api/index";
import { MAX_PLAYER_COUNT } from "../../../generationSettings/generationSettingsConstants";
import {
  add,
  appendAddends,
  divE,
  exprEquals,
  mul,
  num,
  param,
  sym,
} from "./compiler/expr";
import {
  emitCells,
  formatConstLine,
  formatDefineLine,
  type EmittedConst,
  type NamedCell,
} from "./compiler/emit";
import type { NameAllocator } from "./compiler/naming";
import { memberOffset, perimeterSides } from "./expand";
import type { PerimeterWalk } from "./frame";
import type { Placement, ShapeGroup } from "./model";

export interface ConditionalBranch {
  /** The label this branch's condition tests, e.g. "3_PLAYER_GAME". */
  condition: string;
  /** Fully-formed lines inside this branch, in order. May be empty. */
  lines: readonly string[];
}

/**
 * Renders exactly one `if`, `branches.length - 1` `elseif`s and one closing
 * `endif`, always, by construction — there is no code path that omits the
 * `endif` or emits a stray `elseif`. Used for both the 8-branch prologue and
 * item 6's single-branch `create_land` guard, so the two hazards (an
 * unbalanced ladder, an unbalanced single guard) are the same guarantee.
 */
export function renderConditionalBlock(
  branches: readonly ConditionalBranch[],
): string {
  if (branches.length === 0)
    throw new Error("renderConditionalBlock: at least one branch is required");
  const lines: string[] = [];
  branches.forEach((branch, i) => {
    lines.push(`${i === 0 ? "if" : "elseif"} ${branch.condition}`);
    lines.push(...branch.lines);
  });
  lines.push("endif");
  return lines.join("\n");
}

/**
 * Whether a kind's member radius moves with the player count, so the
 * prologue gives each member an `ALP_RAD` cell beside its `ALP_DEG` one
 * (any-kind escalation Sec.4.1's table). A circle and an arc hold `r`
 * fixed and move `theta`. A line moves `r` along a fixed bearing, and a
 * perimeter kind moves both. A jittered perimeter member that walks its
 * perimeter needs no RAD cell (`perimeterWalkCell`).
 */
export function radiusFollowsCount(kind: ShapeGroup["kind"]): boolean {
  return (
    kind === "line" ||
    kind === "square" ||
    kind === "triangle" ||
    kind === "polygon"
  );
}

/**
 * The jitter units a kind has a reading for (Sec.5.1). `deg` needs an
 * angle along the path, which a circle and an arc have and a line or a
 * perimeter does not. The emitter refuses `deg` outside this list
 * (`group:<id>:jitterUnit`), and the panel hides the unit toggle where the
 * list has one entry, the same two place pattern Sec.4.5 uses.
 */
export function jitterUnitsForKind(
  kind: ShapeGroup["kind"],
): readonly ("deg" | "percent")[] {
  return kind === "circle" || kind === "arc" ? ["deg", "percent"] : ["percent"];
}

/** `expandShapeGroup`'s own id scheme (`${group.id}#${i}#${slot.id}`), matched here so a member's id can be looked up without re-deriving it. */
function memberId(
  group: ShapeGroup,
  playerIndex: number,
  slotId: string,
): string {
  return `${group.id}#${playerIndex}#${slotId}`;
}

/**
 * per-player-escalation.md Sec.8.3/5.2, slice-c-brief.md item 1: the branch
 * for a given count uses, in order, a per-count override, the member's own
 * authored rule (slice B), then the even default — "first match wins", named
 * here rather than a chain of `??` at the emit site so the order has one
 * place to read and one place to test. `perCountOverrides` is already
 * resolved for params by the caller, same as `ownRule`; this function does
 * nothing but pick between three already-finished expressions.
 */
export function resolveMemberAngle(
  count: number,
  perCountOverrides: ReadonlyMap<number, Expr> | undefined,
  ownRule: Expr | undefined,
  evenDefault: Expr,
): Expr {
  const override = perCountOverrides?.get(count);
  if (override !== undefined) return override;
  if (ownRule !== undefined) return ownRule;
  return evenDefault;
}

/**
 * The even default with a group's jitter applied (per-player-escalation.md
 * Sec.11). `draw` is the member's own player's resolved draw, `undefined`
 * when the group has no jitter.
 *
 * - `deg` adds the draw as degrees, `even + J`.
 * - `percent` adds the draw as a share of THIS count's even gap,
 *   `J * 360 / N / 100` with `N = patternLength * count`. Written as
 *   integer literals rather than a precomputed `gap / 100`, so the emitted
 *   line reads `J * 360 / 21 / 100` instead of a sixteen-digit float, and
 *   placed FIRST so the whole angle stays one left spine (`appendAddends`).
 */
export function jitteredEvenDefault(
  evenDefault: Expr,
  draw: Expr | undefined,
  unit: "deg" | "percent" | undefined,
  patternLength: number,
  count: number,
): Expr {
  if (draw === undefined || unit === undefined) return evenDefault;
  if (unit === "deg") return add(evenDefault, draw);
  const n = patternLength * count;
  return appendAddends(percentShare(draw, 360, n), evenDefault);
}

/** `J * whole / parts / 100`, the draw as a percent of one even gap, written as integer literals so the line reads like the corpus. */
function percentShare(draw: Expr, whole: number, parts: number): Expr {
  return divE(divE(mul(draw, num(whole)), num(parts)), num(100));
}

/**
 * Arc's form of `jitteredEvenDefault` (land-placement-per-player-any-kind-
 * escalation.md Sec.5.2). An arc's even gap is `sweep / span`, with
 * `span = N - 1` because both ends are occupied, so the percent form is
 * the ring's with 360 replaced by `sweep` and `N` by `span`. `deg` is the
 * ring's form unchanged.
 *
 * A branch whose span is 0 (one member, no neighbour) gets no jitter in
 * either unit, since there is no gap to take a share of (Sec.5.1). Circle
 * keeps its draw at one member, because a ring's divisor is `N` and its
 * one member still has a full turn of gap.
 */
export function jitteredArcDefault(
  evenDefault: Expr,
  draw: Expr | undefined,
  unit: "deg" | "percent" | undefined,
  sweep: number,
  span: number,
): Expr {
  if (draw === undefined || unit === undefined || span === 0)
    return evenDefault;
  if (unit === "deg") return add(evenDefault, draw);
  return appendAddends(percentShare(draw, sweep, span), evenDefault);
}

/**
 * Picks the ANGLE jitter form for the group's kind. A line's jitter moves
 * its radius (`jitteredLineRadius`), so its angle gets none, and a draw
 * added here too would swing each land off the line as well as along it.
 */
function jitteredDefaultFor(
  group: ShapeGroup,
  evenDefault: Expr,
  draw: Expr | undefined,
  count: number,
): Expr {
  const unit = group.jitter?.unit;
  const patternLength = group.pattern.length;
  switch (group.kind) {
    case "circle":
      return jitteredEvenDefault(evenDefault, draw, unit, patternLength, count);
    case "arc":
      return jitteredArcDefault(
        evenDefault,
        draw,
        unit,
        group.sweep ?? 180,
        patternLength * count - 1,
      );
    default:
      return evenDefault;
  }
}

/**
 * A line member's radius with the group's jitter applied (any-kind
 * escalation Sec.5.3). The gap between neighbours is `2B / span`, with `B`
 * the member's own base (`slot.radius ?? group.radius`) and `m` its index
 * along the line. The percent form is
 *
 *   J * 2 / 100 + K * B / span        K = 2m - span
 *
 * which RMS reads left to right as `(J × 2 / 100 + K) × B / span`, the
 * even `B × K / span` plus `J` percent of the gap. Built as that left spine
 * directly, so with a leaf `B` it emits as one line, and a `B` that is not
 * a leaf is hoisted into a temporary by the emit rule (Sec.5.3). A negative
 * `K` rides inline as an operand.
 *
 * `evenRadius` is `memberOffset`'s own radius, returned unchanged with no
 * draw, at span 0, or for `deg`, which has no reading on a line and which
 * the emitter refuses before this runs.
 */
export function jitteredLineRadius(
  evenRadius: Expr,
  draw: Expr | undefined,
  unit: "deg" | "percent" | undefined,
  base: Expr,
  m: number,
  span: number,
): Expr {
  if (draw === undefined || unit !== "percent" || span === 0) return evenRadius;
  const share = divE(mul(draw, num(2)), num(100));
  return divE(mul(add(share, num(2 * m - span)), base), num(span));
}

/** Six decimal places, `perimeterOffset.ts`'s own `round6` precedent (Sec.5.4). */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * A jittered perimeter member's walk at one player count, in laps
 * (any-kind escalation Sec.5.4), one cell per member per branch.
 *
 *   WALK = J / N / 100 + w0 + L        w0 = m / N + 1 / (2M) + shift / 100
 *
 * `J / N / 100` is `J` percent of the even gap as a share of one lap, and
 * `w0` is the member's even walk from `perimeterPolar`, rounded to six
 * places. `L` is the whole number of laps that keeps the walk positive at
 * the draw's lower bound `drawMin`, and a negative `shift` can pull `w0`
 * itself below zero. The frame's `%` truncates toward zero, so a negative
 * walk would round the wrong way and put the land on the wrong side. A
 * whole lap moves nothing. The lower bound is computed in the same order
 * the engine reads the cell, so the two agree to the last bit.
 *
 * At one member (`N = 1`) there is no neighbour and no gap to take a share
 * of, so the draw is left out (Sec.5.1). `L` is left out when it is 0.
 */
export function perimeterWalkCell(
  sides: number,
  memberCount: number,
  memberIndex: number,
  shiftPercent: number,
  draw: Expr | undefined,
  drawMin: number,
): Expr {
  const n = memberCount;
  const w0 = round6(memberIndex / n + 1 / (2 * sides) + shiftPercent / 100);
  const jittered = draw !== undefined && n > 1;
  const lower = jittered ? drawMin / n / 100 + w0 : w0;
  const laps = lower > 0 ? 0 : Math.floor(-lower) + 1;
  let walk: Expr = jittered
    ? add(divE(divE(draw, num(n)), num(100)), num(w0))
    : num(w0);
  if (laps > 0) walk = add(walk, num(laps));
  return walk;
}

/**
 * Which of a group member's two quantities carry an authored rule (Sec.4.2).
 * A quantity does when the member is `nudged`, since a drag writes both, or
 * when its stored value differs structurally from what `memberOffset` gives
 * that member at the group's own `repeats`.
 */
function memberRules(
  group: ShapeGroup,
  repeatIndex: number,
  slotIndex: number,
  offset: { r: Expr; theta: Expr },
  nudged: boolean,
): { theta: boolean; r: boolean } {
  const expanded = memberOffset(group, repeatIndex, slotIndex, group.repeats);
  return {
    theta: nudged || !exprEquals(offset.theta, expanded.theta),
    r: nudged || !exprEquals(offset.r, expanded.r),
  };
}

export interface PrologueResult {
  /** The rendered if/elseif/.../endif block, all eight branches. Empty string when no group is `perPlayer` — nothing to prepend. */
  text: string;
  /** Every `ALP_AT_LEAST_*`, `ALP_DEG_*`, `ALP_RAD_*` and `ALP_WALK_*` name this prologue owns, across ALL eight branches (P4/Sec.5.6's "what am I about to add"). */
  emittedNames: string[];
  /** Placement.id -> the prologue constant reference replacing that member's baked-literal theta (Sec.8.2), for every perPlayer group member at every player index. */
  thetaOverrides: ReadonlyMap<string, Expr>;
  /** The same for `r`, only for members of a kind whose radius moves with the count (`radiusFollowsCount`), and never for a walked member. */
  radiusOverrides: ReadonlyMap<string, Expr>;
  /**
   * Placement.id -> the runtime walk of a jittered per player perimeter
   * member (any-kind escalation Sec.5.4), for `buildFrame` to turn into the
   * member's X and Y. A member walks when its group is jittered and neither
   * of its quantities carries a rule. A per count angle also keeps it off
   * the walk at every count, since the walk is written once outside the
   * branches and cannot give way to a fixed angle at one count (the owner's
   * call, 2026-09-29, that document's section 3 decision 9).
   */
  walks: ReadonlyMap<string, PerimeterWalk>;
  /** Every placement's own guard label, `undefined` for player 1 or for a placement outside any perPlayer group's chain. */
  guardLabels: ReadonlyMap<string, string | undefined>;
  /**
   * The CURRENTLY PREVIEWED player count's own DEG, RAD and WALK cells only (never the
   * other seven branches', which would collide on name and last-write-win
   * the wrong value into `resolved`), for the caller to fold into
   * `verifyEmission`'s resolve walk that produces the RETURNED `resolved`
   * map (Sec.7.4: the preview draws one count). NOT rendered again in the
   * flat body — they already exist inside `text`'s own conditional branch.
   */
  liveDegCells: EmittedConst[];
  /**
   * EVERY member's DEG, RAD and WALK cells, fully resolved regardless of the previewed
   * count — the branch at `count === group.repeats` (MAX_PLAYER_COUNT for a
   * correctly-pinned group), which is the same "bake at the maximum count"
   * value `expandShapeGroup` already uses for a fixed-count ring. Feeds
   * `verifyEmission`'s CROSS-CHECK pass only, never `resolved` and never the
   * body: `evalExpr`'s strict AST propagation and `evaluateExpressionTokens`'
   * RMS-faithful "drop an unresolved operand after the first" (Sec.5.1) only
   * ever agree once every operand actually resolves, and a genuinely
   * unresolved not-yet-previewed player (by design, `liveDegCells`
   * deliberately excludes them) is exactly the case that would otherwise
   * make the two evaluators disagree for a reason that has nothing to do
   * with a real compiler bug.
   */
  crossCheckDegCells: EmittedConst[];
}

/**
 * A placement's own guard label, propagated down its `parent` chain (Sec.4.3:
 * "or chained to a land belonging to player k"). A placement that IS a
 * perPlayer group member answers directly from its own player index; a chain
 * descendant inherits its nearest such ancestor's answer; anything else (not
 * part of any perPlayer group) is unguarded.
 */
function computeGuardLabels(
  placements: readonly Placement[],
  groupMemberPlayerIndex: ReadonlyMap<string, number>,
  atLeastNames: ReadonlyMap<number, string>,
): Map<string, string | undefined> {
  const byId = new Map(placements.map((p) => [p.id, p] as const));
  const cache = new Map<string, string | undefined>();

  function guardOf(id: string, seen: Set<string>): string | undefined {
    if (cache.has(id)) return cache.get(id);
    if (seen.has(id)) return undefined; // a cycle elsewhere in the model, stop rather than loop forever
    seen.add(id);
    const playerIndex = groupMemberPlayerIndex.get(id);
    if (playerIndex !== undefined) {
      const guard =
        playerIndex + 1 > 1 ? atLeastNames.get(playerIndex + 1) : undefined;
      cache.set(id, guard);
      return guard;
    }
    const p = byId.get(id);
    const guard =
      !p || p.parent === "center" ? undefined : guardOf(p.parent, seen);
    cache.set(id, guard);
    return guard;
  }

  // The union of every id `placements` names and every group member's own
  // id: a group member is a valid guard answer even when it is not itself
  // present in `placements` (the caller's list may be a chain-only sample,
  // as in this module's own unit tests), since `groupMemberPlayerIndex`
  // already knows its player index independent of that list.
  const ids = new Set<string>([
    ...placements.map((p) => p.id),
    ...groupMemberPlayerIndex.keys(),
  ]);
  const out = new Map<string, string | undefined>();
  for (const id of ids) out.set(id, guardOf(id, new Set()));
  return out;
}

/**
 * Builds the whole prologue for every `perPlayer` group in `groups`, or
 * returns an empty result when there is none — a script with no per-player
 * ring gets no prologue text and no new names, byte-identical to before this
 * feature existed (Sec.10.1's own requirement).
 *
 * `placements` is the RAW, pre-param-resolution placement list (`emitModel`
 * step 1's `resolveFullPlacements` output): guard propagation only needs
 * `parent`/`id`, unaffected by parameter resolution, and using the raw list
 * keeps this module decoupled from `paramEmit.ts`'s own resolution order.
 *
 * `resolvedRotationByGroup` is each perPlayer group's OWN `rotation` Expr,
 * already run through the caller's param resolver (a rotation may itself be
 * a shared `RandomParam` reference, Bulls_Eyes' own `ROTATION_PLAYER`
 * shape) — this module only ever adds a literal per-count offset to it.
 *
 * `resolveExprParams`, per-player-escalation.md Sec.5/slice-b-brief.md item
 * 2: a member's OWN authored theta (Bulls_Eyes' `DEGREES_P2` shape) can
 * itself reference a hoisted `RandomParam`, owned by that specific member's
 * player index — `emitModel.ts`'s own closure, threaded through rather than
 * reimplemented here, so a hoisted `rnd` constant is guaranteed already
 * emitted before this prologue references it (Sec.4.4's ordering: params
 * come first).
 *
 * `jitterMinByGroup` is each jittered group's draw lower bound, its
 * param's `min`, which a walked perimeter member's lap count is computed
 * from (`perimeterWalkCell`). Only a jittered perimeter group reads it.
 */
export function buildPrologue(
  groups: readonly ShapeGroup[],
  placements: readonly Placement[],
  resolvedRotationByGroup: ReadonlyMap<string, Expr>,
  namer: NameAllocator,
  playerCount: number,
  resolveExprParams: (
    e: Expr,
    ownerPlayer: number | undefined,
    where: string,
  ) => Expr,
  jitterMinByGroup: ReadonlyMap<string, number> = new Map(),
): PrologueResult {
  const perPlayerGroups = groups.filter((g) => g.perPlayer);
  if (perPlayerGroups.length === 0) {
    return {
      text: "",
      emittedNames: [],
      thetaOverrides: new Map(),
      radiusOverrides: new Map(),
      walks: new Map(),
      guardLabels: new Map(),
      liveDegCells: [],
      crossCheckDegCells: [],
    };
  }

  // AT_LEAST_2..MAX_PLAYER_COUNT, ONE set shared by every group: "at least k
  // players" is a single fact about the game, not a per-ring one.
  const atLeastNames = new Map<number, string>();
  for (let k = 2; k <= MAX_PLAYER_COUNT; k++) {
    atLeastNames.set(k, namer.allocate("AT_LEAST", String(k)));
  }

  // Which members walk the perimeter at runtime (any-kind escalation
  // Sec.5.4). Decided before any name is allocated, since a walked member
  // takes a WALK name where it would take a RAD one. Jitter applies to the
  // default position only (Sec.5), and the walk moves both quantities, so a
  // rule on either keeps a member off it (the reading decision 8 gives for
  // a line, where jitter moves `r` alone and only a rule on `r` takes it
  // away). A per count angle keeps it off too (decision 9).
  const placementById = new Map(placements.map((p) => [p.id, p] as const));
  const walkedIds = new Set<string>();
  for (const group of perPlayerGroups) {
    if (!group.jitter || perimeterSides(group) === undefined) continue;
    for (let i = 0; i < group.repeats; i++) {
      for (let j = 0; j < group.pattern.length; j++) {
        const id = memberId(group, i, group.pattern[j].id);
        const placement = placementById.get(id);
        if (!placement || placement.offset.kind !== "polar") continue;
        if (Object.keys(placement.thetaPerCount ?? {}).length > 0) continue;
        const rules = memberRules(
          group,
          i,
          j,
          placement.offset,
          placement.nudged === true,
        );
        if (!rules.theta && !rules.r) walkedIds.add(id);
      }
    }
  }

  // One DEG name per (group, player index, slot), across EVERY player index
  // the group can ever hold — `group.repeats`, which is pinned to
  // MAX_PLAYER_COUNT for a perPlayer group (Sec.8.1) but read here rather
  // than assumed, so a model that somehow violates the invariant still gets
  // a consistent (if smaller) prologue instead of an out-of-range lookup.
  const degNameByMemberId = new Map<string, string>();
  const radNameByMemberId = new Map<string, string>();
  const walkNameByMemberId = new Map<string, string>();
  const groupMemberPlayerIndex = new Map<string, number>();
  const thetaOverrides = new Map<string, Expr>();
  const radiusOverrides = new Map<string, Expr>();
  const walks = new Map<string, PerimeterWalk>();
  for (const group of perPlayerGroups) {
    const patternLength = group.pattern.length;
    for (let i = 0; i < group.repeats; i++) {
      for (let j = 0; j < patternLength; j++) {
        const slot = group.pattern[j];
        const id = memberId(group, i, slot.id);
        const suffix = patternLength > 1 ? `P${i + 1}_${slot.id}` : `P${i + 1}`;
        const name = namer.allocate("DEG", suffix);
        degNameByMemberId.set(id, name);
        groupMemberPlayerIndex.set(id, i);
        thetaOverrides.set(id, sym(name));
        // A walked member takes a WALK name in place of a RAD one. Its X
        // and Y come from the walk, so it has no `r` to replace.
        if (walkedIds.has(id)) {
          const walkName = namer.allocate("WALK", suffix);
          walkNameByMemberId.set(id, walkName);
          const drawMin = jitterMinByGroup.get(group.id);
          if (drawMin === undefined)
            throw new Error(
              `buildPrologue: jittered perimeter group "${group.id}" needs its draw's lower bound`,
            );
          walks.set(id, {
            walk: sym(walkName),
            sides: perimeterSides(group)!,
            radius: resolveExprParams(
              slot.radius ?? group.radius,
              i + 1,
              `group:${group.id}:member:${id}:r`,
            ),
            rotation: resolvedRotationByGroup.get(group.id) ?? num(0),
          });
          continue;
        }
        // RAD, not R, because the trig macro already emits an `R_k`
        // (Sec.5.4). Allocated only for a kind that needs it, so a circle
        // or an arc allocates exactly the names it always did.
        if (radiusFollowsCount(group.kind)) {
          const radName = namer.allocate("RAD", suffix);
          radNameByMemberId.set(id, radName);
          radiusOverrides.set(id, sym(radName));
        }
      }
    }
  }

  const guardLabels = computeGuardLabels(
    placements,
    groupMemberPlayerIndex,
    atLeastNames,
  );

  // slice-b-brief.md item 2, the whole slice: a member's OWN theta wins over
  // the even default wherever it carries a rule (Sec.5 — "the prologue
  // constant's VALUE is the member's own rule where it has one, and the even
  // default otherwise"). Computed ONCE, outside the per-count loop below,
  // because an authored rule (a fixed formula, e.g. Bulls_Eyes' `DEGREES_P2 =
  // DIST_BW_PLAYERS + ROTATION_PLAYER`) does not itself vary with the branch
  // — only the EVEN DEFAULT does. `Placement.thetaPerCount` (slice C) is the
  // feature that would make a rule branch-dependent; nothing here reads it.
  //
  // "Has a rule" (Sec.5's own wording, hazard 1's whole risk): `nudged`, OR a
  // theta that is not structurally the SAME bin `memberOffset` gives this
  // member at the group's own (maximum, for a perPlayer group) `repeats`
  // (any-kind escalation Sec.4.2) — never `evalClosed`, which cannot tell an
  // authored literal rewrite apart from the even default's own equally-
  // literal-shaped bin (dragMath.ts's own "a polar offset built from
  // literals... STILL drags" test is exactly this confusion one module
  // over). Asking the expander means a slot's own angle counts as the shape
  // rather than as a rule, on a circle too (Sec.4.2's one changed output).
  //
  // Decided per quantity (Sec.4.2). A line member with an authored radius
  // keeps it at every count while its bearing follows the shape, and the
  // other way round. `nudged` sets both, since a drag writes both.
  const ruleExprByMemberId = new Map<string, Expr>();
  const radiusRuleByMemberId = new Map<string, Expr>();
  for (const group of perPlayerGroups) {
    const patternLength = group.pattern.length;
    for (let i = 0; i < group.repeats; i++) {
      for (let j = 0; j < patternLength; j++) {
        const slot = group.pattern[j];
        const id = memberId(group, i, slot.id);
        const placement = placementById.get(id);
        if (!placement || placement.offset.kind !== "polar") continue; // defensive, matches this module's own degNameByMemberId loop above
        const rules = memberRules(
          group,
          i,
          j,
          placement.offset,
          placement.nudged === true,
        );
        if (radiusFollowsCount(group.kind)) {
          if (rules.r)
            radiusRuleByMemberId.set(
              id,
              resolveExprParams(
                placement.offset.r,
                i + 1,
                `group:${group.id}:member:${id}:r`,
              ),
            );
        }
        if (!rules.theta) continue;
        ruleExprByMemberId.set(
          id,
          resolveExprParams(
            placement.offset.theta,
            i + 1,
            `group:${group.id}:member:${id}:theta`,
          ),
        );
      }
    }
  }

  // slice-c-brief.md item 1: a per-count override, resolved for params once
  // per (member, count) — same reasoning as `ruleExprByMemberId` above, and
  // for the same reason: an override can itself reference a hoisted
  // RandomParam owned by this member's own player index. Kept as its own map
  // rather than folded into `ruleExprByMemberId`, since the two answer
  // different questions per branch (`resolveMemberAngle` picks between them
  // per count, not once for the whole member).
  const thetaPerCountByMemberId = new Map<string, ReadonlyMap<number, Expr>>();
  for (const group of perPlayerGroups) {
    const patternLength = group.pattern.length;
    for (let i = 0; i < group.repeats; i++) {
      for (let j = 0; j < patternLength; j++) {
        const slot = group.pattern[j];
        const id = memberId(group, i, slot.id);
        const placement = placementById.get(id);
        if (!placement?.thetaPerCount) continue;
        const resolved = new Map<number, Expr>();
        for (const [countText, expr] of Object.entries(
          placement.thetaPerCount,
        )) {
          const count = Number(countText);
          resolved.set(
            count,
            resolveExprParams(
              expr,
              i + 1,
              `group:${group.id}:member:${id}:thetaPerCount:${count}`,
            ),
          );
        }
        thetaPerCountByMemberId.set(id, resolved);
      }
    }
  }

  // Sec.11: a jittered group's draw, resolved once per player index, the
  // same way an authored rule is resolved above. The param is `perPlayer`
  // (the emitter refuses anything else before this runs), so player `i + 1`
  // gets its own `_P<i+1>` cell, and every slot of that player shares it.
  const jitterDrawByGroup = new Map<string, Expr[]>();
  for (const group of perPlayerGroups) {
    if (!group.jitter) continue;
    const draws: Expr[] = [];
    for (let i = 0; i < group.repeats; i++) {
      draws.push(
        resolveExprParams(
          param(group.jitter.param),
          i + 1,
          `group:${group.id}:jitter`,
        ),
      );
    }
    jitterDrawByGroup.set(group.id, draws);
  }

  // Render all eight branches (Sec.8.4: 1 through 8, not 2 through 8 — a
  // 1-player game matches nothing under 2-through-8 and the whole ring
  // silently emits no lands). Stash the branch matching the CURRENTLY
  // PREVIEWED count separately: its cells are what `resolved` needs, and
  // feeding all eight into one walk would have later branches' same-named
  // cells silently overwrite earlier ones with the wrong count's values.
  const branches: ConditionalBranch[] = [];
  let liveDegCells: EmittedConst[] = [];
  let crossCheckDegCells: EmittedConst[] = [];
  for (let count = 1; count <= MAX_PLAYER_COUNT; count++) {
    const lines: string[] = [];
    for (let k = 2; k <= count; k++)
      lines.push(formatDefineLine({ name: atLeastNames.get(k)! }));

    // Angles are per land per branch (item 3), never one shared step: a
    // shared `ALP_STEP` accumulates rounding drift across a repeat and
    // cannot express slice B/C's per-land rules at all (Sec.4.1).
    const targets: NamedCell[] = [];
    for (const group of perPlayerGroups) {
      const patternLength = group.pattern.length;
      // The group with its rotation resolved for params, the one field the
      // caller resolves ahead of time, so `memberOffset` can be asked about
      // it directly.
      const resolvedGroup: ShapeGroup = {
        ...group,
        rotation: resolvedRotationByGroup.get(group.id) ?? num(0),
      };
      const memberCount = Math.min(count, group.repeats);
      for (let i = 0; i < memberCount; i++) {
        for (let j = 0; j < patternLength; j++) {
          const slot = group.pattern[j];
          const id = memberId(group, i, slot.id);
          const name = degNameByMemberId.get(id);
          if (name === undefined) continue; // group.repeats shrank out from under this index, defensively skipped
          // The member where the shape puts it at THIS count. A slot's own
          // angle can carry a param, so the result is resolved for the
          // member's own player. Rotation is already resolved, and a
          // resolved tree passes through unchanged.
          const shaped = resolveExprParams(
            memberOffset(resolvedGroup, i, j, count).theta,
            i + 1,
            `group:${group.id}:member:${id}:theta`,
          );
          const evenDefault = jitteredDefaultFor(
            group,
            shaped,
            jitterDrawByGroup.get(group.id)?.[i],
            count,
          );
          const expr = resolveMemberAngle(
            count,
            thetaPerCountByMemberId.get(id),
            ruleExprByMemberId.get(id),
            evenDefault,
          );
          targets.push({ name, expr });

          // A walked member's WALK cell, in the same branch and the same
          // `cells` as its DEG one, so it reaches `liveDegCells` and
          // `crossCheckDegCells` the way a RAD cell does.
          const walkName = walkNameByMemberId.get(id);
          if (walkName !== undefined) {
            targets.push({
              name: walkName,
              expr: perimeterWalkCell(
                perimeterSides(group)!,
                patternLength * count,
                i * patternLength + j,
                slot.perimeterShift ?? 0,
                jitterDrawByGroup.get(group.id)?.[i],
                jitterMinByGroup.get(group.id)!,
              ),
            });
            continue;
          }

          // The RAD cell, in the same branch and the same `cells` as the
          // DEG one. That is what puts it in `liveDegCells` and
          // `crossCheckDegCells` with no second path, so the canvas draws
          // the previewed count and the cross check covers every cell.
          const radName = radNameByMemberId.get(id);
          if (radName === undefined) continue;
          const radiusRule = radiusRuleByMemberId.get(id);
          if (radiusRule !== undefined) {
            targets.push({ name: radName, expr: radiusRule });
            continue;
          }
          const where = `group:${group.id}:member:${id}:r`;
          const shapedRadius = resolveExprParams(
            memberOffset(resolvedGroup, i, j, count).r,
            i + 1,
            where,
          );
          targets.push({
            name: radName,
            expr:
              group.kind === "line"
                ? jitteredLineRadius(
                    shapedRadius,
                    jitterDrawByGroup.get(group.id)?.[i],
                    group.jitter?.unit,
                    resolveExprParams(
                      slot.radius ?? group.radius,
                      i + 1,
                      where,
                    ),
                    i * patternLength + j,
                    patternLength * count - 1,
                  )
                : shapedRadius,
          });
        }
      }
    }
    const cells = emitCells(targets, namer);
    for (const cell of cells) lines.push(formatConstLine(cell));

    branches.push({ condition: `${count}_PLAYER_GAME`, lines });
    if (count === playerCount) liveDegCells = cells;
    if (count === MAX_PLAYER_COUNT) crossCheckDegCells = cells;
  }

  return {
    text: renderConditionalBlock(branches),
    emittedNames: [
      ...atLeastNames.values(),
      ...degNameByMemberId.values(),
      ...radNameByMemberId.values(),
      ...walkNameByMemberId.values(),
    ],
    thetaOverrides,
    radiusOverrides,
    walks,
    guardLabels,
    liveDegCells,
    crossCheckDegCells,
  };
}
