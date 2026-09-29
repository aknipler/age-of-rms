// Pure model-editing operations for the panel (Sec.8). Kept apart from the
// React component so every edit is a plain `(model, …) -> model` function.
// Glue over these is all `LandPlacementPanel.tsx` should contain, per this
// brief's own §5 rule that a run-sheet step should never be checking a
// calculation.

import type { Expr } from "../../../../../tools-api/index";
import type { ParseResult } from "../../../../parser/types";
import { expandShapeGroup } from "../expand";
import { reExpand } from "../reExpand";
import { jitterUnitsForKind } from "../prologue";
import type { EmissionOk } from "../emitModel";
import type { AlpModel } from "../fence";
import {
  ROLE_OPTIONAL_ATTRIBUTES,
  type Anchor,
  type ChainTemplate,
  type GroupJitter,
  type LandRole,
  type PatternSlot,
  type Placement,
  type RandomParam,
  type RoleOverrides,
  type ShapeGroup,
} from "../model";
import { rndPlaceholder } from "./formulaField";

let counter = 0;
/**
 * Every id the model already carries, across all five id-bearing kinds.
 * Needed because a fence loaded from disk brings ids from EARLIER sessions,
 * and the session counter below restarts at 0 every launch, so "monotonic
 * within one session" alone would hand a reopened document a `role_1` it
 * already has. Computed on demand rather than cached, since every op here
 * is a pure `(model) -> model` and there is no one place to keep a cache
 * in step (BUG-030).
 */
export function takenIds(model: AlpModel): Set<string> {
  const ids = new Set<string>();
  for (const r of model.roles) ids.add(r.id);
  for (const p of model.randomParams) ids.add(p.id);
  for (const p of model.placements) ids.add(p.id);
  for (const g of model.groups) {
    ids.add(g.id);
    for (const s of g.pattern) ids.add(s.id);
  }
  return ids;
}

/**
 * Monotonic within one session AND checked against what the model already
 * holds, so the result is unique inside this document whichever session
 * wrote the rest of it. Slot ids are the case that bit (BUG-030): the panel
 * once derived them from `pattern.length`, so removing the middle of three
 * and adding one produced a duplicate, and the merge rule keys members by
 * `(repeatIndex, slotId)`, so the duplicate silently handed one slot's
 * members to the other.
 */
export function freshId(prefix: string, taken: ReadonlySet<string>): string {
  let id: string;
  do {
    counter += 1;
    id = `${prefix}_${counter}`;
  } while (taken.has(id));
  return id;
}

export function addRole(model: AlpModel): { model: AlpModel; roleId: string } {
  const id = freshId("role", takenIds(model));
  const role: LandRole = {
    id,
    label: `Role ${model.roles.length + 1}`,
    terrain: { k: "name", name: "GRASS" },
    baseSize: { k: "num", v: 5 },
    baseElevation: { k: "num", v: 0 },
    extent: { kind: "percent", value: { k: "num", v: 5 } },
    zone: { kind: "none" },
    assign: { kind: "none" },
  };
  return { model: { ...model, roles: [...model.roles, role] }, roleId: id };
}

export function updateRole(
  model: AlpModel,
  roleId: string,
  patch: Partial<LandRole>,
): AlpModel {
  return {
    ...model,
    roles: model.roles.map((r) => (r.id === roleId ? { ...r, ...patch } : r)),
  };
}

export function deleteRole(model: AlpModel, roleId: string): AlpModel {
  // A shape's lands keep their repeat index, which is a fact about where
  // they sit in the shape, not about the role. Only a standalone land's
  // index came with the role.
  const inShape = new Set(
    model.groups.flatMap((g) => [...g.members, ...(g.chainMembers ?? [])]),
  );
  return {
    ...model,
    roles: model.roles.filter((r) => r.id !== roleId),
    // A placement wearing a deleted role becomes a chain anchor rather than
    // a dangling reference. emitAlpModel throws on an unresolvable role id.
    placements: model.placements.map((p) =>
      p.role !== roleId
        ? p
        : inShape.has(p.id)
          ? { ...p, role: undefined }
          : { ...p, role: undefined, repeatIndex: undefined },
    ),
    // A slot wearing it becomes points only, which is what just happened to
    // its lands above. This used to move the slot onto whichever role was
    // left, back when a slot had to have one, so a shape silently changed
    // role and its lands disagreed with their slot until the next edit.
    groups: model.groups.map((g) => ({
      ...g,
      pattern: g.pattern.map((slot) => {
        if (slot.role !== roleId) return slot;
        const points: PatternSlot = { ...slot };
        delete points.role; // omitted, as newSlot writes a points-only slot
        return points;
      }),
    })),
  };
}

/**
 * A slot with `role` OMITTED rather than set to `undefined` when there is
 * none, the same rule `chainMembers` follows, so a points-only slot writes
 * `{"id":"slot_3"}` to the fence and a slot with a role is unchanged.
 */
function newSlot(id: string, roleId: string | undefined): PatternSlot {
  return roleId === undefined ? { id } : { id, role: roleId };
}

/**
 * A new ring of `repeats` lands wearing `roleId`, at the map centre. Sec.8's
 * "create a ring, set its numbers, see it, Apply".
 *
 * ROTATION IS RANDOM BY DEFAULT (2026-09-22): a fresh `RandomParam`
 * `ROTATION_<ring>` drawing `rnd(0,359)`, and the ring's rotation is
 * `param + 0`. A literal rotation made every generated map identical under
 * reseed, which is not what a random map script is for. The `+ 0` is not
 * decoration: it is the constant term the rotation gizmo and a member drag
 * absorb a delta into (`tryInvertFormulaCoordinate`), so the ring stays
 * draggable while it keeps its draw.
 *
 * `roleId` undefined makes a points-only ring (PatternSlot.role).
 */
export function addRing(
  model: AlpModel,
  roleId: string | undefined,
  parent: Anchor = "center",
): { model: AlpModel; groupId: string } {
  const taken = takenIds(model);
  const groupId = freshId("ring", taken);
  taken.add(groupId);
  const rotation = newRandomParam(
    model,
    taken,
    `ROTATION_${groupId.toUpperCase()}`,
    0,
    359,
  );
  const group: ShapeGroup = {
    id: groupId,
    parent,
    kind: "circle",
    pattern: [newSlot(freshId("slot", taken), roleId)],
    repeats: 8,
    radius: { k: "num", v: 30 },
    rotation: {
      k: "bin",
      op: "+",
      l: { k: "param", id: rotation.id },
      r: { k: "num", v: 0 },
    },
    frame: "radial",
    members: [],
    perPlayer: false,
  };
  const { placements, members } = expandShapeGroup(group);
  const finished: ShapeGroup = { ...group, members };
  return {
    model: {
      ...model,
      randomParams: [...model.randomParams, rotation],
      groups: [...model.groups, finished],
      placements: [...model.placements, ...placements],
    },
    groupId,
  };
}

// --- Random parameters (Sec.4.4) -------------------------------------------

/** A label no existing param carries; the label becomes an emitted `#const` name, so two params sharing one would be told apart only by an allocator suffix. */
function uniqueParamLabel(model: AlpModel, stem: string): string {
  const used = new Set(model.randomParams.map((p) => p.label));
  const base = stem.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase() || "PARAM";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Builds (does not add) a shared param; `taken` is mutated so a caller allocating several in one go never collides with itself. */
function newRandomParam(
  model: AlpModel,
  taken: Set<string>,
  labelStem: string,
  min: number,
  max: number,
): RandomParam {
  const id = freshId("param", taken);
  taken.add(id);
  return {
    id,
    label: uniqueParamLabel(model, labelStem),
    min,
    max,
    perPlayer: false,
  };
}

export function addRandomParam(
  model: AlpModel,
  labelStem = "PARAM",
  min = 0,
  max = 100,
): { model: AlpModel; id: string } {
  const p = newRandomParam(model, takenIds(model), labelStem, min, max);
  return {
    model: { ...model, randomParams: [...model.randomParams, p] },
    id: p.id,
  };
}

export function updateRandomParam(
  model: AlpModel,
  id: string,
  patch: Partial<Omit<RandomParam, "id">>,
): AlpModel {
  return {
    ...model,
    randomParams: model.randomParams.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    ),
  };
}

/** Visits every `Expr` the model holds, so a question like "is this param referenced" has one answer that cannot miss a field. */
export function forEachModelExpr(
  model: AlpModel,
  visit: (e: Expr) => void,
): void {
  const offset = (o: Placement["offset"]): void => {
    if (o.kind === "polar") {
      visit(o.r);
      visit(o.theta);
    } else if (o.kind === "cartesian") {
      visit(o.dx);
      visit(o.dy);
    } else {
      visit(o.x);
      visit(o.y);
    }
  };
  const roleFields = (r: Partial<LandRole>): void => {
    if (r.baseSize) visit(r.baseSize);
    if (r.baseElevation) visit(r.baseElevation);
    if (r.extent) visit(r.extent.value);
    if (
      r.assign &&
      r.assign.kind !== "none" &&
      r.assign.number.kind === "fixed"
    )
      visit(r.assign.number.value);
    for (const { field } of ROLE_OPTIONAL_ATTRIBUTES) {
      const e = r[field];
      if (e) visit(e);
    }
  };
  for (const r of model.roles) roleFields(r);
  for (const p of model.placements) {
    offset(p.offset);
    for (const e of Object.values(p.thetaPerCount ?? {})) visit(e);
    if (p.roleOverrides) roleFields(p.roleOverrides);
  }
  for (const g of model.groups) {
    visit(g.radius);
    visit(g.rotation);
    // Not an Expr in the model, but it references a param exactly as one
    // would, and this walk is the one answer to "is this param in use".
    if (g.jitter) visit({ k: "param", id: g.jitter.param });
    for (const s of g.pattern) {
      if (s.theta) visit(s.theta);
      if (s.radius) visit(s.radius);
      for (const t of s.chain ?? []) offset(t.offset);
    }
  }
}

function exprReferencesParam(e: Expr, id: string): boolean {
  switch (e.k) {
    case "param":
      return e.id === id;
    case "neg":
    case "sin":
    case "cos":
      return exprReferencesParam(e.e, id);
    case "bin":
      return exprReferencesParam(e.l, id) || exprReferencesParam(e.r, id);
    default:
      return false;
  }
}

export function isParamReferenced(model: AlpModel, id: string): boolean {
  let found = false;
  forEachModelExpr(model, (e) => {
    if (!found && exprReferencesParam(e, id)) found = true;
  });
  return found;
}

/** Refuses (returns the model unchanged) while anything still references the param: an emission with a dangling reference fails outright, and a refusal the panel can explain beats that. */
export function deleteRandomParam(model: AlpModel, id: string): AlpModel {
  if (isParamReferenced(model, id)) return model;
  return {
    ...model,
    randomParams: model.randomParams.filter((p) => p.id !== id),
  };
}

/**
 * Turns every `rnd(a,b)` placeholder the formula front end left in `expr`
 * into a real `RandomParam` on the model, labelled after `labelStem` (the
 * field it was typed into), and returns the expression with `param(id)`
 * leaves in their place. The one place a formula becomes a hoisted draw.
 */
export function materialiseRndParams(
  model: AlpModel,
  expr: Expr,
  labelStem: string,
): { model: AlpModel; expr: Expr } {
  const taken = takenIds(model);
  let next = model;
  const walk = (e: Expr): Expr => {
    switch (e.k) {
      case "param": {
        const p = rndPlaceholder(e.id);
        if (p === null) return e;
        const created = newRandomParam(next, taken, labelStem, p.min, p.max);
        next = { ...next, randomParams: [...next.randomParams, created] };
        return { k: "param", id: created.id };
      }
      case "neg":
        return { k: "neg", e: walk(e.e) };
      case "sin":
        return { k: "sin", e: walk(e.e) };
      case "cos":
        return { k: "cos", e: walk(e.e) };
      case "bin":
        return { k: "bin", op: e.op, l: walk(e.l), r: walk(e.r) };
      default:
        return e;
    }
  };
  const out = walk(expr);
  return { model: next, expr: out };
}

export function deleteGroup(model: AlpModel, groupId: string): AlpModel {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return model;
  const memberIds = new Set([...group.members, ...(group.chainMembers ?? [])]);
  // Anything parented to one of the deleted lands, a standalone land or
  // another shape using one as its origin, moves to the map centre, the
  // same rule `deleteStandalonePlacement` follows. Left alone, its parent
  // would name a placement that no longer exists and the emitter would
  // have no position to measure it from.
  const orphaned = (parent: Anchor): boolean =>
    parent !== "center" && memberIds.has(parent);
  return {
    ...model,
    groups: model.groups
      .filter((g) => g.id !== groupId)
      .map((g) => (orphaned(g.parent) ? { ...g, parent: "center" } : g)),
    placements: model.placements
      .filter((p) => !memberIds.has(p.id))
      .map((p) => (orphaned(p.parent) ? { ...p, parent: "center" } : p)),
  };
}

/**
 * The placements a shape can take as its origin (its `parent`). A shape's
 * members are parented to its origin, so the origin cannot be one of the
 * shape's own members or chain children, and it cannot be any land hanging
 * below one of them, since each of those would make a member its own
 * ancestor. `wouldCreateCycle` asks the same question of one placement.
 * This asks it of every member at once. "center" is always allowed and is
 * not listed.
 */
export function shapeOriginCandidates(
  model: AlpModel,
  groupId: string,
): Placement[] {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const own = new Set([...group.members, ...(group.chainMembers ?? [])]);
  const byId = new Map(model.placements.map((p) => [p.id, p] as const));
  const hangsOffShape = (id: string): boolean => {
    let current: Anchor = id;
    const seen = new Set<string>();
    while (current !== "center") {
      if (own.has(current)) return true;
      if (seen.has(current)) return true; // an existing cycle elsewhere, refuse rather than loop
      seen.add(current);
      const next = byId.get(current);
      if (!next) return false;
      current = next.parent;
    }
    return false;
  };
  return model.placements.filter((p) => !hangsOffShape(p.id));
}

/**
 * Every pattern/repeats edit goes through `reExpand()` (Sec.4.5's own
 * requirement) rather than a fresh `expandShapeGroup`, so a user's nudged
 * members survive an edit to a sibling slot. `emission` is the CURRENT
 * (pre-edit) dry-run emission, its `quantities` map is what
 * `emittedConstantNames` reads to decide whether a shrinking pattern can
 * safely delete a departing member (Sec.4.5 condition 3).
 *
 * Three rules live here rather than at a call site, so no caller can skip
 * them. A `parent` the shape cannot take (`shapeOriginCandidates`) returns
 * null, as an unknown group does. An edit that would newly leave jitter in
 * a unit the kind has no reading for (`jitterUnitsForKind`, degrees on a
 * line or a perimeter) also returns null. The Shape select goes through
 * `setGroupKind`, which translates the unit first, so it never meets that
 * refusal. And a ring that stops being per-player loses its jitter, which
 * the emitter would otherwise refuse. A per player shape of any kind is
 * allowed, since land-placement-per-player-any-kind-escalation.md slice C
 * deleted the interim guard of its section 2.
 */
export function applyGroupEdit(
  model: AlpModel,
  groupId: string,
  newGroupPatch: Partial<
    Pick<
      ShapeGroup,
      | "pattern"
      | "repeats"
      | "radius"
      | "rotation"
      | "perPlayer"
      | "kind"
      | "sweep"
      | "sides"
      | "parent"
      | "frame"
    >
  >,
  parse: ParseResult,
  emission: EmissionOk | null,
): { model: AlpModel; report: ReturnType<typeof reExpand>["report"] } | null {
  const oldGroup = model.groups.find((g) => g.id === groupId);
  if (!oldGroup) return null;
  if (
    newGroupPatch.parent !== undefined &&
    newGroupPatch.parent !== "center" &&
    !shapeOriginCandidates(model, groupId).some(
      (p) => p.id === newGroupPatch.parent,
    )
  )
    return null;
  const newGroup: ShapeGroup = { ...oldGroup, ...newGroupPatch };
  // Only a per player group keeps its jitter past this edit (see the end of
  // this function), so only a per player group can be left holding one the
  // emitter would refuse. Refused when the edit CREATES the combination,
  // and never because the group already held it. Only a hand edited fence
  // reaches the second case, and refusing every edit to such a group would
  // lock the panel's way out of it.
  const refusedJitterUnit = (g: ShapeGroup) =>
    g.perPlayer &&
    g.jitter !== undefined &&
    !jitterUnitsForKind(g.kind).includes(g.jitter.unit);
  if (refusedJitterUnit(newGroup) && !refusedJitterUnit(oldGroup)) return null;
  const emittedConstantNames = (placementId: string): readonly string[] => {
    const q = emission?.quantities.get(placementId);
    return q ? [q.xName, q.yName] : [];
  };
  const result = reExpand(
    oldGroup,
    newGroup,
    model.placements,
    parse,
    emittedConstantNames,
  );
  // `chainMembers` is OMITTED (not set to undefined, which `in` still sees)
  // when there are none, so a model with no templates is structurally
  // identical to one written before Q12 (its Sec.9's byte-identical
  // regression gate).
  const finishedGroup: ShapeGroup = { ...newGroup, members: result.members };
  delete finishedGroup.chainMembers;
  if (result.chainMembers.length > 0)
    finishedGroup.chainMembers = result.chainMembers;
  const next: AlpModel = {
    ...model,
    groups: model.groups.map((g) => (g.id === groupId ? finishedGroup : g)),
    placements: result.placements,
  };
  return {
    model:
      !finishedGroup.perPlayer && finishedGroup.jitter
        ? removeGroupJitter(next, groupId)
        : next,
    report: result.report,
  };
}

/**
 * The Shape select's edit. A kind change on a shape whose degree jitter the
 * new kind has no reading for (a circle or an arc switched to Line) first
 * translates the jitter into percent of the even gap, then changes the
 * kind through `applyGroupEdit`. The owner's call, 2026-09-28, answering a
 * case land-placement-per-player-any-kind-escalation.md does not cover.
 * Dropping the jitter would lose it without a word, and leaving the degrees
 * would blank the canvas behind the emitter's `jitterUnit` refusal, the
 * trap the interim guard of that document's section 2 was built to close.
 *
 * `previewCount` is the player count being previewed, which the owner chose
 * as the count to translate at. Percent is a share of each count's own gap,
 * so the land moves as far along the line at that count as it moved round
 * the old shape, and further or less at the others. Null, with the model
 * untouched, whenever `applyGroupEdit` refuses the kind change itself.
 */
export function setGroupKind(
  model: AlpModel,
  groupId: string,
  kind: ShapeGroup["kind"],
  previewCount: number,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  let next = model;
  const jitter = group.jitter;
  const param = jitter && model.randomParams.find((p) => p.id === jitter.param);
  if (jitter && param && !jitterUnitsForKind(kind).includes(jitter.unit))
    next = setGroupJitter(
      next,
      groupId,
      "percent",
      degreesAsPercentOfGap(group, param.max, previewCount),
    );
  return applyGroupEdit(next, groupId, { kind }, parse, emission);
}

/**
 * `degrees` as a whole percent of `group`'s even gap at `count` players, at
 * least 1. A circle's gap is `360 / N` and an arc's `sweep / (N - 1)`, with
 * `N` its member count there. Multiplied out before the one division, so a
 * whole result stays whole. Dividing by the gap first does not. 1 degree
 * of an arc's `100 / 7` degree gap is 7 percent, and `1 / (100 / 7) * 100`
 * comes out 6.999... and rounds down to 6. Rounded down,
 * the same way the Circle helper rounds, since rounding down can only make
 * the jitter safer, and never below 1, since `rnd` needs `max` above `min`.
 */
export function degreesAsPercentOfGap(
  group: ShapeGroup,
  degrees: number,
  count: number,
): number {
  const members = group.pattern.length * count;
  const exact =
    group.kind === "arc"
      ? (degrees * 100 * Math.max(1, members - 1)) / (group.sweep ?? 180)
      : (degrees * 100 * members) / 360;
  return Math.max(1, Math.floor(exact));
}

/**
 * A new points-only land at the shape's current origin, made the shape's
 * origin in the same step, so the shape does not move until the new point
 * does. Dragging or editing that point then moves the shape.
 *
 * The shape keeps its frame. Switching it to `absolute` here was tried and
 * dropped on the owner's call (2026-09-28), since a frame that changes
 * without being asked is easy to miss. The point's angle is 180 so that a
 * `radial` shape does not flip. A radial shape measures its angles from a
 * base of `DEGREES_parent + 180` (frame.ts), or from 0 when its parent is
 * the map centre or has no DEGREES. The new point's DEGREES is 180 on the
 * map centre, and on a land it is that land's DEGREES + 360, so the shape's
 * new base is 360 or the land's DEGREES + 540. Both equal the old base
 * modulo 360, and the trig macro folds by 360. At distance 0 the angle does
 * not move the point itself.
 */
export function addShapeOriginPoint(
  model: AlpModel,
  groupId: string,
  parse: ParseResult,
  emission: EmissionOk | null,
): { model: AlpModel; pointId: string } | null {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const { model: withPoint, id } = addStandalonePlacement(
    model,
    undefined,
    group.parent,
  );
  const placed = updatePlacement(withPoint, id, {
    offset: {
      kind: "polar",
      r: { k: "num", v: 0 },
      theta: { k: "num", v: 180 },
    },
    label: `${group.id}_origin`,
  });
  const result = applyGroupEdit(
    placed,
    groupId,
    { parent: id },
    parse,
    emission,
  );
  return result ? { model: result.model, pointId: id } : null;
}

/** One slot's role, or none (a points-only slot, the key omitted per `newSlot`). */
export function setSlotRole(
  model: AlpModel,
  groupId: string,
  slotId: string,
  roleId: string | undefined,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  return applyGroupEdit(
    model,
    groupId,
    {
      pattern: group.pattern.map((s) => {
        if (s.id !== slotId) return s;
        const next: PatternSlot = { ...s, role: roleId };
        if (roleId === undefined) delete next.role;
        return next;
      }),
    },
    parse,
    emission,
  );
}

// --- Jitter (per-player-escalation.md Sec.11) -------------------------------

/**
 * Sets a per-player ring's jitter to `rnd(-amount, amount)` in `unit`. The
 * first call creates the ring's `JITTER_<ring>` param, and later calls
 * update that param's bounds rather than making another. Returns the model
 * unchanged for a ring that is not per-player (the emitter would refuse it)
 * or an amount below 1 (`rnd` needs `max` above `min`, and
 * `computeJitterAmount` never offers less).
 *
 * No re-expansion, since jitter changes no member's own offset. It only
 * changes what the prologue computes from the even default.
 */
export function setGroupJitter(
  model: AlpModel,
  groupId: string,
  unit: GroupJitter["unit"],
  amount: number,
): AlpModel {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group || !group.perPlayer || amount < 1) return model;
  const existing =
    group.jitter &&
    model.randomParams.find((p) => p.id === group.jitter!.param);
  let next = model;
  let paramId: string;
  if (existing) {
    paramId = existing.id;
    next = updateRandomParam(next, paramId, {
      min: -amount,
      max: amount,
      perPlayer: true,
    });
  } else {
    const created = newRandomParam(
      model,
      takenIds(model),
      `JITTER_${groupId.toUpperCase()}`,
      -amount,
      amount,
    );
    paramId = created.id;
    next = {
      ...next,
      randomParams: [...next.randomParams, { ...created, perPlayer: true }],
    };
  }
  return {
    ...next,
    groups: next.groups.map((g) =>
      g.id === groupId ? { ...g, jitter: { param: paramId, unit } } : g,
    ),
  };
}

/** Removes a ring's jitter, and its param once nothing else references it. The key is deleted, not set to undefined, so the fence reads as it did before jitter was added. */
export function removeGroupJitter(model: AlpModel, groupId: string): AlpModel {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group?.jitter) return model;
  const paramId = group.jitter.param;
  const without: AlpModel = {
    ...model,
    groups: model.groups.map((g) => {
      if (g.id !== groupId) return g;
      const next: ShapeGroup = { ...g };
      delete next.jitter;
      return next;
    }),
  };
  return deleteRandomParam(without, paramId);
}

/** The ring whose jitter draws from `paramId`, if any. The Random parameters list locks such a param to per player. */
export function jitterGroupForParam(
  model: AlpModel,
  paramId: string,
): ShapeGroup | undefined {
  return model.groups.find((g) => g.jitter?.param === paramId);
}

/**
 * Appends one `PatternSlot` wearing `roleId` and re-expands through the merge
 * rule, so existing members (nudged ones included) survive. The id comes
 * from `freshId` against the WHOLE model, never from `pattern.length`, which
 * is what BUG-030 was: after removing the middle of three slots the length
 * is 2 and the survivor is already `_slot_2`. Reads the group off `model`
 * rather than taking a pattern from the caller, so a React updater calling
 * this never closes over a stale `group`. `roleId` undefined adds a
 * points-only slot.
 */
export function addPatternSlot(
  model: AlpModel,
  groupId: string,
  roleId: string | undefined,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const slot = newSlot(freshId("slot", takenIds(model)), roleId);
  return applyGroupEdit(
    model,
    groupId,
    { pattern: [...group.pattern, slot] },
    parse,
    emission,
  );
}

/**
 * Removes one slot by id. Refuses to empty the pattern (a group with no
 * slots has no members and `memberKeyAt` throws on it), returning the model
 * untouched with a null report, the same "no-op, not a crash" shape
 * `applyGroupEdit` uses for an unknown group. Departing members go through
 * the release rule exactly as a `repeats` shrink does (Sec.4.5 condition 1).
 */
export function removePatternSlot(
  model: AlpModel,
  groupId: string,
  slotId: string,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group || group.pattern.length <= 1) return null;
  return applyGroupEdit(
    model,
    groupId,
    { pattern: group.pattern.filter((s) => s.id !== slotId) },
    parse,
    emission,
  );
}

export function updatePlacement(
  model: AlpModel,
  placementId: string,
  patch: Partial<Placement>,
): AlpModel {
  return {
    ...model,
    placements: model.placements.map((p) =>
      p.id === placementId ? { ...p, ...patch } : p,
    ),
  };
}

/**
 * A drag's own model edit (Sec.7.3, slice-5-brief.md item 2). Sets `offset`
 * unconditionally and stamps `nudged: true` ONLY when `placementId` is a
 * group member — `Placement.nudged`'s own doc comment says it exists for
 * `reExpand()`'s merge rule to branch on, and that branch only ever reads
 * the flag on a group member; setting it on a standalone placement would be
 * a flag with no reader, which model.ts's own header treats as a real gap
 * ("nothing reads this field today") rather than a harmless default. The
 * brief's own acceptance pins the negative directly: "dragging a standalone
 * placement leaves nudged unset."
 */
export function applyDragToPlacement(
  model: AlpModel,
  placementId: string,
  offset: Placement["offset"],
): AlpModel {
  const inGroup = isGroupMember(model, placementId);
  return {
    ...model,
    placements: model.placements.map((p) =>
      p.id === placementId
        ? { ...p, offset, ...(inGroup ? { nudged: true } : {}) }
        : p,
    ),
  };
}

/**
 * Sets or clears one player-count's angle override on a placement
 * (per-player-escalation.md Sec.8.3, slice-c-brief.md item 1). `expr:
 * undefined` removes that count's entry; the whole `thetaPerCount` map is
 * dropped back to `undefined` (never left as `{}`) once its last entry is
 * removed, matching `Placement.thetaPerCount`'s own "absent means no
 * overrides" contract rather than leaving an empty-but-present object for a
 * reader to have to treat the same way as absence anyway.
 */
export function setThetaPerCountOverride(
  model: AlpModel,
  placementId: string,
  count: number,
  expr: Expr | undefined,
): AlpModel {
  return {
    ...model,
    placements: model.placements.map((p) => {
      if (p.id !== placementId) return p;
      const next = { ...(p.thetaPerCount ?? {}) };
      if (expr === undefined) delete next[count];
      else next[count] = expr;
      return {
        ...p,
        thetaPerCount: Object.keys(next).length > 0 ? next : undefined,
      };
    }),
  };
}

/**
 * Per-land role override (role-attributes-escalation.md Sec.5), the same
 * add/replace/remove shape as `setThetaPerCountOverride`. `value` undefined
 * DELETES the key, which is what the panel's reset does: it must never
 * write the role's current value into the override, because that would
 * freeze the value and the land would stop following the role while
 * looking as though it still did (Sec.7).
 */
export function setRoleOverride<K extends keyof RoleOverrides>(
  model: AlpModel,
  placementId: string,
  key: K,
  value: RoleOverrides[K] | undefined,
): AlpModel {
  return {
    ...model,
    placements: model.placements.map((p) => {
      if (p.id !== placementId) return p;
      const next: RoleOverrides = { ...(p.roleOverrides ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return {
        ...p,
        roleOverrides: Object.keys(next).length > 0 ? next : undefined,
      };
    }),
  };
}

export function clearRoleOverride(
  model: AlpModel,
  placementId: string,
  key: keyof RoleOverrides,
): AlpModel {
  return setRoleOverride(model, placementId, key, undefined);
}

/** Standalone placements only (never a group member, leaving/removing a member is a pattern/repeats edit through `applyGroupEdit`). */
export function addStandalonePlacement(
  model: AlpModel,
  roleId: string | undefined,
  parent: Anchor = "center",
): { model: AlpModel; id: string } {
  const id = freshId("land", takenIds(model));
  const placement: Placement = {
    id,
    parent,
    frame: "radial",
    offset: {
      kind: "polar",
      r: { k: "num", v: 20 },
      theta: { k: "num", v: 0 },
    },
    label: id,
    role: roleId,
  };
  return {
    model: { ...model, placements: [...model.placements, placement] },
    id,
  };
}

export function deleteStandalonePlacement(
  model: AlpModel,
  placementId: string,
): AlpModel {
  return {
    ...model,
    placements: model.placements
      .filter((p) => p.id !== placementId)
      // Any child chained to the deleted node re-parents to the map centre rather than dangling.
      .map((p) => (p.parent === placementId ? { ...p, parent: "center" } : p)),
    // So does a shape using it as its origin. The line above already moved
    // the shape's members, and this keeps the shape itself in step, or its
    // next re-expansion would hand the members the deleted id again.
    groups: model.groups.map((g) =>
      g.parent === placementId ? { ...g, parent: "center" } : g,
    ),
  };
}

/** True when `placementId` is a member of any ShapeGroup, such a placement is edited through the group's own controls, not deleted individually. */
/** A member OR an expanded chain child (Q12): both are re-expanded by the merge rule, so both take `nudged`. */
function belongsTo(g: ShapeGroup, placementId: string): boolean {
  return (
    g.members.includes(placementId) ||
    (g.chainMembers?.includes(placementId) ?? false)
  );
}

export function isGroupMember(model: AlpModel, placementId: string): boolean {
  return model.groups.some((g) => belongsTo(g, placementId));
}

export function groupForMember(
  model: AlpModel,
  placementId: string,
): ShapeGroup | undefined {
  return model.groups.find((g) => belongsTo(g, placementId));
}

/** True for an expanded chain child specifically, which the editor treats as a member for editing but shows under its own member in the tree. */
export function isChainMember(model: AlpModel, placementId: string): boolean {
  return model.groups.some((g) => g.chainMembers?.includes(placementId));
}

// --- Chain templates (composite-pattern-escalation.md Sec.5, Q12) --------
// Every template edit is a pattern edit through `applyGroupEdit`, so the
// merge rule keeps every existing member and nudged chain child. The
// template id comes from `freshId` against the whole model, for the same
// reason a slot's does (BUG-030).

function mapSlot(
  group: ShapeGroup,
  slotId: string,
  f: (slot: PatternSlot) => PatternSlot,
): PatternSlot[] {
  return group.pattern.map((s) => (s.id === slotId ? f(s) : s));
}

export function addChainTemplate(
  model: AlpModel,
  groupId: string,
  slotId: string,
  roleId: string,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group || !group.pattern.some((s) => s.id === slotId)) return null;
  const id = freshId("chain", takenIds(model));
  const template: ChainTemplate = {
    id,
    role: roleId,
    label: id,
    frame: "radial",
    offset: {
      kind: "polar",
      r: { k: "num", v: 14 }, // Bulls_Eyes' own RADIUS_AUX_LANDS, a sensible first value
      theta: { k: "num", v: 0 },
    },
  };
  return applyGroupEdit(
    model,
    groupId,
    {
      pattern: mapSlot(group, slotId, (s) => ({
        ...s,
        chain: [...(s.chain ?? []), template],
      })),
    },
    parse,
    emission,
  );
}

export function updateChainTemplate(
  model: AlpModel,
  groupId: string,
  slotId: string,
  templateId: string,
  patch: Partial<Omit<ChainTemplate, "id">>,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  return applyGroupEdit(
    model,
    groupId,
    {
      pattern: mapSlot(group, slotId, (s) => ({
        ...s,
        chain: (s.chain ?? []).map((t) =>
          t.id === templateId ? { ...t, ...patch } : t,
        ),
      })),
    },
    parse,
    emission,
  );
}

/** Removes a template; its expanded children depart through the release rule (Sec.5.4), never silently. */
export function removeChainTemplate(
  model: AlpModel,
  groupId: string,
  slotId: string,
  templateId: string,
  parse: ParseResult,
  emission: EmissionOk | null,
): ReturnType<typeof applyGroupEdit> {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return null;
  return applyGroupEdit(
    model,
    groupId,
    {
      pattern: mapSlot(group, slotId, (s) => {
        const chain = (s.chain ?? []).filter((t) => t.id !== templateId);
        // Drop the key entirely when empty, for the byte-identical gate.
        const rest: PatternSlot = { ...s };
        delete rest.chain;
        return chain.length > 0 ? { ...rest, chain } : rest;
      }),
    },
    parse,
    emission,
  );
}
