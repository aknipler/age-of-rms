// Sec.4.5, the 2026-08-30 subsection: the re-expansion merge rule. Read that
// subsection before touching this file, every clause here is load-bearing
// and traceable back to one sentence in it.
//
// The transition is `(G_old, G_new, placements, parse) → placements'` plus a
// report of what happened. ONE deviation from that literal signature:
// `emittedConstantNames` is a 5th argument, a callback the caller supplies
// mapping a placement id to the `#const` names it would own. Naming is an
// EMIT-TIME decision (compiler/naming.ts's `NameAllocator`, seeded by
// whatever collisions exist in a real document) that this model-level
// module has no way to reconstruct on its own. Condition 3 below needs the
// real names to ask `auditConstants` a real question, so the caller (which
// has already run the compiler once) hands them over rather than this
// module guessing at a naming scheme.

import type { ParseResult } from "../../../parser/types";
import { auditConstants } from "../constantsAuditor";
import { add, evalClosed, num, sub } from "./compiler/expr";
import type { Expr } from "../../../../tools-api/index";
import { expandShapeGroup, memberKeyAt } from "./expand";
import { locateFence } from "./fence";
import type { Placement, ShapeGroup } from "./model";

interface MemberKey {
  repeatIndex: number;
  slotId: string;
}

function keyText(k: MemberKey): string {
  return `${k.repeatIndex}:${k.slotId}`;
}

/** `oldGroup.members[k]`'s key, per Sec.4.5's stated invariant, derived from position, never stored. */
function keyedIds(group: ShapeGroup): Map<string, string> {
  const out = new Map<string, string>();
  for (let k = 0; k < group.members.length; k++) {
    out.set(keyText(memberKeyAt(k, group.pattern)), group.members[k]);
  }
  return out;
}

/** True only for a tree built entirely from literals, no `sym`/`param`/`node` anywhere. A nudge made by dragging (Sec.7.3) is always this shape; a hand-typed formula usually is not. */
function isFullyNumericLiteral(e: Expr): boolean {
  switch (e.k) {
    case "num":
    case "inf":
      return true;
    case "neg":
    case "sin":
    case "cos":
      return isFullyNumericLiteral(e.e);
    case "bin":
      return isFullyNumericLiteral(e.l) && isFullyNumericLiteral(e.r);
    case "sym":
    case "param":
    case "node":
      return false;
  }
}

/**
 * `expand.ts` derives a fresh member's id deterministically from
 * `(group.id, repeatIndex, slotId)`, which collides the moment a RELEASED
 * placement is still sitting in the document at that exact key, Sec.4.5
 * consequence 1's `5 → 3 → 5` leaves the released pair PLUS two fresh ones
 * "at the same keys", meaning the same logical key, not literally the same
 * id: a released placement is ordinary data the tool must not silently
 * overwrite just because a new member happens to reuse its slot.
 */
function freshId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * `offset' = slotBase(G_new) + (offset - slotBase(G_old))`. Tried first as
 * plain JS-number arithmetic (clean output, a folded literal rather than a
 * nested expression) and falls back to building the same formula as an Expr
 * when any of the three quantities involves something this model layer
 * cannot resolve without a script's actual symbol table (a symbolic group
 * rotation, say), the fallback is exactly as correct, just less tidy,
 * because it is the identical formula, only left for the compiler's own
 * normalisation pass to fold later.
 */
function deltaComponent(offsetOld: Expr, baseOld: Expr, baseNew: Expr): Expr {
  const oldV = evalClosed(offsetOld);
  const baseOldV = evalClosed(baseOld);
  const baseNewV = evalClosed(baseNew);
  if (oldV !== undefined && baseOldV !== undefined && baseNewV !== undefined) {
    return num(baseNewV + (oldV - baseOldV));
  }
  return add(baseNew, sub(offsetOld, baseOld));
}

export interface ReExpandReport {
  /** Brand-new keys in G_new with nothing to match, fresh Placements. */
  addedIds: string[];
  /** Matched, `nudged` unset, offset recomputed wholesale from G_new. */
  recomputedIds: string[];
  /** Matched, `nudged` set, fully numeric, offset re-applied as a delta. */
  deltaAppliedIds: string[];
  /** Matched, `nudged` set, but not fully numeric-literal, left untouched. */
  positionDetachedIds: string[];
  /** Left the group, kept on the map as an ordinary Placement. */
  releasedIds: string[];
  /** Left the group AND provably unreferenced, removed entirely. */
  deletedIds: string[];
}

export interface ReExpandResult {
  /** The full, updated document placement list. */
  placements: Placement[];
  /** What `ShapeGroup.members` should be set to. */
  members: string[];
  report: ReExpandReport;
}

/**
 * Condition 3 (Sec.4.5): "no create_land in the document references its
 * emitted constants", filtered to uses OUTSIDE the fence, since a chained
 * child's own position const references its parent's INSIDE the fence
 * (Sec.4.2), and counting those asks the tool whether its own
 * about-to-be-regenerated output needs its own output. Answers yes forever
 * if left unfiltered, this filter is not optional (Sec.4.5, condition 3's
 * own paragraph).
 */
function isReferencedOutsideFence(parse: ParseResult, names: readonly string[]): boolean {
  if (names.length === 0) return false;
  const fenceSpan = locateFence(parse)?.span ?? null;
  const usage = auditConstants(parse);
  const byName = new Map(usage.map((u) => [u.name, u] as const));
  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) continue;
    for (const span of entry.useSpans) {
      const insideFence = fenceSpan !== null && span.start >= fenceSpan.start && span.end <= fenceSpan.end;
      if (!insideFence) return true;
    }
  }
  return false;
}

export function reExpand(
  oldGroup: ShapeGroup,
  newGroup: ShapeGroup,
  placements: readonly Placement[],
  parse: ParseResult,
  emittedConstantNames: (placementId: string) => readonly string[],
): ReExpandResult {
  const byId = new Map(placements.map((p) => [p.id, p] as const));
  const oldKeyed = keyedIds(oldGroup);
  const fresh = expandShapeGroup(newGroup);
  const freshById = new Map(fresh.placements.map((p) => [p.id, p] as const));

  const report: ReExpandReport = {
    addedIds: [],
    recomputedIds: [],
    deltaAppliedIds: [],
    positionDetachedIds: [],
    releasedIds: [],
    deletedIds: [],
  };

  // G_old's own fresh expansion, keyed the same way. This is what
  // `slotBase(G_old, i, s)` (Sec.4.5's delta formula) means: the base a
  // nudge was originally measured against, re-derived rather than stored.
  const oldFresh = expandShapeGroup(oldGroup);
  const oldBaseByKey = new Map<string, Placement>();
  for (let idx = 0; idx < oldFresh.placements.length; idx++) {
    oldBaseByKey.set(keyText(memberKeyAt(idx, oldGroup.pattern)), oldFresh.placements[idx]);
  }

  const nextPlacements = new Map(byId);
  const nextMembers: string[] = [];
  const newKeysSeen = new Set<string>();

  for (let k = 0; k < fresh.members.length; k++) {
    const key = memberKeyAt(k, newGroup.pattern);
    const kt = keyText(key);
    newKeysSeen.add(kt);
    const freshPlacement = freshById.get(fresh.members[k])!;
    const oldId = oldKeyed.get(kt);
    const oldPlacement = oldId !== undefined ? byId.get(oldId) : undefined;

    if (oldPlacement === undefined) {
      // Brand new. Nothing in G_old occupied this key. Disambiguate against
      // a same-keyed RELEASED placement that may still be sitting in the
      // document (see freshId's own doc comment).
      const id = freshId(freshPlacement.id, new Set(nextPlacements.keys()));
      const placement: Placement = { ...freshPlacement, id };
      nextPlacements.set(id, placement);
      nextMembers.push(id);
      report.addedIds.push(id);
      continue;
    }

    // A matched key ALWAYS keeps the OLD placement's id. Sec.4.5 never
    // mentions renaming a surviving member, and the fence's constant names
    // (Sec.6.2: "the constant name is the link") are keyed off it.
    nextMembers.push(oldPlacement.id);

    if (!oldPlacement.nudged) {
      // Recompute wholesale, the branch that has to survive a SYMBOLIC
      // group (Sec.4.5), since freshPlacement.offset already carries
      // whatever rotation/radius Expr G_new specifies, symbolic or not.
      nextPlacements.set(oldPlacement.id, { ...oldPlacement, offset: freshPlacement.offset });
      report.recomputedIds.push(oldPlacement.id);
      continue;
    }

    if (oldPlacement.offset.kind === "polar" && freshPlacement.offset.kind === "polar") {
      if (!isFullyNumericLiteral(oldPlacement.offset.r) || !isFullyNumericLiteral(oldPlacement.offset.theta)) {
        report.positionDetachedIds.push(oldPlacement.id);
        continue;
      }
      const oldBase = oldBaseByKey.get(kt);
      if (oldBase === undefined || oldBase.offset.kind !== "polar") {
        // Should be unreachable, G_old's own expansion always produces a
        // polar member for every key in its own pattern, but fail safe
        // rather than crash on a model invariant this module does not own.
        report.positionDetachedIds.push(oldPlacement.id);
        continue;
      }
      const r = deltaComponent(oldPlacement.offset.r, oldBase.offset.r, freshPlacement.offset.r);
      const theta = deltaComponent(oldPlacement.offset.theta, oldBase.offset.theta, freshPlacement.offset.theta);
      nextPlacements.set(oldPlacement.id, { ...oldPlacement, offset: { kind: "polar", r, theta } });
      report.deltaAppliedIds.push(oldPlacement.id);
      continue;
    }

    if (oldPlacement.offset.kind === "cartesian" && freshPlacement.offset.kind === "cartesian") {
      // shape-kinds-slice-b-brief.md item 1: the identical treatment,
      // componentwise, dx against dx and dy against dy, through the SAME
      // deltaComponent helper and behind the SAME isFullyNumericLiteral
      // guard as the polar branch above. NOT reachable from group expansion
      // any more (perimeter-symbolic-rotation-slice-a-brief.md item 2/
      // escalation Sec.8.3: every kind is polar now, square/triangle/
      // polygon included) — this branch serves a standalone user-authored
      // `cartesian` placement, still a real, reachable case outside any
      // `ShapeGroup`, and a model saved before this slice whose nudged
      // perimeter member still carries the old cartesian shape (hazard 3:
      // that pair hits the MIXED branch below instead, deliberately).
      if (!isFullyNumericLiteral(oldPlacement.offset.dx) || !isFullyNumericLiteral(oldPlacement.offset.dy)) {
        report.positionDetachedIds.push(oldPlacement.id);
        continue;
      }
      const oldBase = oldBaseByKey.get(kt);
      if (oldBase === undefined || oldBase.offset.kind !== "cartesian") {
        report.positionDetachedIds.push(oldPlacement.id);
        continue;
      }
      const dx = deltaComponent(oldPlacement.offset.dx, oldBase.offset.dx, freshPlacement.offset.dx);
      const dy = deltaComponent(oldPlacement.offset.dy, oldBase.offset.dy, freshPlacement.offset.dy);
      nextPlacements.set(oldPlacement.id, { ...oldPlacement, offset: { kind: "cartesian", dx, dy } });
      report.deltaAppliedIds.push(oldPlacement.id);
      continue;
    }

    // A MIXED pair (a kind change from a polar shape to a perimeter one, or
    // either side carrying a `formula` position) has no meaningful delta: a
    // nudge measured in (r, theta) has no reading in (dx, dy) and vice
    // versa. Left untouched and reported, exactly what positionDetachedIds
    // is for (Sec.4.5), and not a leftover of the two-outcome version above
    // — it is the honest answer to a real user action, so it gets its own
    // test rather than falling out of the polar/cartesian checks by
    // accident.
    report.positionDetachedIds.push(oldPlacement.id);
  }

  // Departing keys: present in G_old, absent from G_new.
  for (const [kt, oldId] of oldKeyed) {
    if (newKeysSeen.has(kt)) continue;
    const oldPlacement = byId.get(oldId);
    if (oldPlacement === undefined) continue; // already gone from the document

    const hasChild = placements.some((p) => p.parent === oldId);
    const names = emittedConstantNames(oldId);
    const referenced = isReferencedOutsideFence(parse, names);
    const deletable = !hasChild && !oldPlacement.nudged && !referenced;

    if (deletable) {
      nextPlacements.delete(oldId);
      report.deletedIds.push(oldId);
    } else {
      // Released: the placement is left completely untouched, simply no
      // longer listed as a member of this group (Sec.4.5: "keeping its
      // parent, label, children and its last per-repeat literals").
      report.releasedIds.push(oldId);
    }
  }

  return { placements: [...nextPlacements.values()], members: nextMembers, report };
}
