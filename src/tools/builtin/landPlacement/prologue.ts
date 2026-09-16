// per-player-escalation.md Sec.4.1/4.3, slice-a-brief items 3, 4, 5, 6: the
// per-player prologue. Turns a `perPlayer` ShapeGroup into three things,
// emitted once per fence, before everything else in the body:
//
//   - eight `if`/`elseif`/`endif` branches (1_PLAYER_GAME..8_PLAYER_GAME,
//     Sec.8.4: all eight, not 2 through 8), each defining the cumulative
//     `ALP_AT_LEAST_k` labels for its own count and one `ALP_DEG_Pk` angle
//     constant per player land, evaluated at THAT count's even spacing;
//   - a theta OVERRIDE per group member (Sec.8.2: the emitter substitutes a
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
import { add, exprEquals, num, sym } from "./compiler/expr";
import {
  emitCells,
  formatConstLine,
  formatDefineLine,
  type EmittedConst,
  type NamedCell,
} from "./compiler/emit";
import type { NameAllocator } from "./compiler/naming";
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
 * Sec.4.5's own even-spacing formula (`expand.ts`'s `angleOffsetDegrees`),
 * evaluated at a COUNT other than the group's own pinned `repeats`.
 * Deliberately duplicated rather than imported: `expand.ts` only ever
 * computes this once, at the group's fixed member count, and the brief's own
 * hazard 6 is "editing `expandShapeGroup`" — this module needs the same
 * shape evaluated at eight DIFFERENT counts, which is a different question
 * asked of the same arithmetic, not a reason to touch the function that
 * bakes the model's own literal.
 */
function evenAngleOffsetDegrees(
  playerIndex: number,
  slotIndex: number,
  patternLength: number,
  count: number,
): number {
  const n = patternLength * count;
  const repeatTerm = count > 0 ? (360 / count) * playerIndex : 0;
  const slotTerm = n > 0 ? (360 / n) * slotIndex : 0;
  return Math.round(repeatTerm + slotTerm);
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

export interface PrologueResult {
  /** The rendered if/elseif/.../endif block, all eight branches. Empty string when no group is `perPlayer` — nothing to prepend. */
  text: string;
  /** Every `ALP_AT_LEAST_*` and `ALP_DEG_*` name this prologue owns, across ALL eight branches (P4/Sec.5.6's "what am I about to add"). */
  emittedNames: string[];
  /** Placement.id -> the prologue constant reference replacing that member's baked-literal theta (Sec.8.2), for every perPlayer group member at every player index. */
  thetaOverrides: ReadonlyMap<string, Expr>;
  /** Every placement's own guard label, `undefined` for player 1 or for a placement outside any perPlayer group's chain. */
  guardLabels: ReadonlyMap<string, string | undefined>;
  /**
   * The CURRENTLY PREVIEWED player count's own DEG cells only (never the
   * other seven branches', which would collide on name and last-write-win
   * the wrong value into `resolved`), for the caller to fold into
   * `verifyEmission`'s resolve walk that produces the RETURNED `resolved`
   * map (Sec.7.4: the preview draws one count). NOT rendered again in the
   * flat body — they already exist inside `text`'s own conditional branch.
   */
  liveDegCells: EmittedConst[];
  /**
   * EVERY member's DEG cell, fully resolved regardless of the previewed
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
): PrologueResult {
  const perPlayerGroups = groups.filter((g) => g.perPlayer);
  if (perPlayerGroups.length === 0) {
    return {
      text: "",
      emittedNames: [],
      thetaOverrides: new Map(),
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

  // One DEG name per (group, player index, slot), across EVERY player index
  // the group can ever hold — `group.repeats`, which is pinned to
  // MAX_PLAYER_COUNT for a perPlayer group (Sec.8.1) but read here rather
  // than assumed, so a model that somehow violates the invariant still gets
  // a consistent (if smaller) prologue instead of an out-of-range lookup.
  const degNameByMemberId = new Map<string, string>();
  const groupMemberPlayerIndex = new Map<string, number>();
  const thetaOverrides = new Map<string, Expr>();
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
  // theta that is not structurally the SAME bin `expand.ts` itself would have
  // baked for this member at the group's own (maximum, for a perPlayer group)
  // `repeats` — never `evalClosed`, which cannot tell an authored literal
  // rewrite apart from the even default's own equally-literal-shaped bin
  // (dragMath.ts's own "a polar offset built from literals... STILL drags"
  // test is exactly this confusion one module over).
  const placementById = new Map(placements.map((p) => [p.id, p] as const));
  const ruleExprByMemberId = new Map<string, Expr>();
  for (const group of perPlayerGroups) {
    const patternLength = group.pattern.length;
    for (let i = 0; i < group.repeats; i++) {
      for (let j = 0; j < patternLength; j++) {
        const slot = group.pattern[j];
        const id = memberId(group, i, slot.id);
        const placement = placementById.get(id);
        if (!placement || placement.offset.kind !== "polar") continue; // defensive, matches this module's own degNameByMemberId loop above
        const evenDefault = add(
          group.rotation,
          num(evenAngleOffsetDegrees(i, j, patternLength, group.repeats)),
        );
        const hasRule =
          placement.nudged === true ||
          !exprEquals(placement.offset.theta, evenDefault);
        if (!hasRule) continue;
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
      const rotation = resolvedRotationByGroup.get(group.id) ?? num(0);
      const memberCount = Math.min(count, group.repeats);
      for (let i = 0; i < memberCount; i++) {
        for (let j = 0; j < patternLength; j++) {
          const slot = group.pattern[j];
          const id = memberId(group, i, slot.id);
          const name = degNameByMemberId.get(id);
          if (name === undefined) continue; // group.repeats shrank out from under this index, defensively skipped
          const evenDefault = add(
            rotation,
            num(evenAngleOffsetDegrees(i, j, patternLength, count)),
          );
          const expr = resolveMemberAngle(
            count,
            thetaPerCountByMemberId.get(id),
            ruleExprByMemberId.get(id),
            evenDefault,
          );
          targets.push({ name, expr });
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
    emittedNames: [...atLeastNames.values(), ...degNameByMemberId.values()],
    thetaOverrides,
    guardLabels,
    liveDegCells,
    crossCheckDegCells,
  };
}
