// Pure model-editing operations for the panel (Sec.8). Kept apart from the
// React component so every edit is a plain `(model, …) -> model` function.
// Glue over these is all `LandPlacementPanel.tsx` should contain, per this
// brief's own §5 rule that a run-sheet step should never be checking a
// calculation.

import type { Expr } from "../../../../../tools-api/index";
import type { ParseResult } from "../../../../parser/types";
import { expandShapeGroup } from "../expand";
import { reExpand } from "../reExpand";
import type { EmissionOk } from "../emitModel";
import type { AlpModel } from "../fence";
import type { Anchor, LandRole, Placement, ShapeGroup } from "../model";

let counter = 0;
/** Monotonic within one session, model ids only need to be unique inside one document, never across sessions. */
function freshId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function addRole(model: AlpModel): { model: AlpModel; roleId: string } {
  const id = freshId("role");
  const role: LandRole = {
    id,
    label: `Role ${model.roles.length + 1}`,
    terrain: { k: "name", name: "GRASS" },
    baseSize: { k: "num", v: 5 },
    baseElevation: { k: "num", v: 0 },
    landPercent: { k: "num", v: 5 },
    zone: { kind: "none" },
    assignToPlayer: false,
  };
  return { model: { ...model, roles: [...model.roles, role] }, roleId: id };
}

export function updateRole(model: AlpModel, roleId: string, patch: Partial<LandRole>): AlpModel {
  return { ...model, roles: model.roles.map((r) => (r.id === roleId ? { ...r, ...patch } : r)) };
}

export function deleteRole(model: AlpModel, roleId: string): AlpModel {
  return {
    ...model,
    roles: model.roles.filter((r) => r.id !== roleId),
    // A placement wearing a deleted role becomes a chain anchor rather than
    // a dangling reference. emitAlpModel throws on an unresolvable role id.
    placements: model.placements.map((p) => (p.role === roleId ? { ...p, role: undefined, repeatIndex: undefined } : p)),
    groups: model.groups.map((g) => ({
      ...g,
      pattern: g.pattern.map((slot) => (slot.role === roleId ? { ...slot, role: model.roles.find((r) => r.id !== roleId)?.id ?? slot.role } : slot)),
    })),
  };
}

/** A new ring of `repeats` lands wearing `roleId`, at the map centre. Sec.8's "create a ring, set its numbers, see it, Apply". */
export function addRing(model: AlpModel, roleId: string, parent: Anchor = "center"): { model: AlpModel; groupId: string } {
  const groupId = freshId("ring");
  const group: ShapeGroup = {
    id: groupId,
    parent,
    kind: "circle",
    pattern: [{ id: freshId("slot"), role: roleId }],
    repeats: 8,
    radius: { k: "num", v: 30 },
    rotation: { k: "num", v: 0 },
    frame: "radial",
    members: [],
    perPlayer: false,
  };
  const { placements, members } = expandShapeGroup(group);
  const finished: ShapeGroup = { ...group, members };
  return {
    model: { ...model, groups: [...model.groups, finished], placements: [...model.placements, ...placements] },
    groupId,
  };
}

export function deleteGroup(model: AlpModel, groupId: string): AlpModel {
  const group = model.groups.find((g) => g.id === groupId);
  if (!group) return model;
  const memberIds = new Set(group.members);
  return {
    ...model,
    groups: model.groups.filter((g) => g.id !== groupId),
    placements: model.placements.filter((p) => !memberIds.has(p.id)),
  };
}

/**
 * Every pattern/repeats edit goes through `reExpand()` (Sec.4.5's own
 * requirement) rather than a fresh `expandShapeGroup`, so a user's nudged
 * members survive an edit to a sibling slot. `emission` is the CURRENT
 * (pre-edit) dry-run emission, its `quantities` map is what
 * `emittedConstantNames` reads to decide whether a shrinking pattern can
 * safely delete a departing member (Sec.4.5 condition 3).
 */
export function applyGroupEdit(
  model: AlpModel,
  groupId: string,
  newGroupPatch: Partial<Pick<ShapeGroup, "pattern" | "repeats" | "radius" | "rotation" | "perPlayer" | "kind" | "sweep" | "sides">>,
  parse: ParseResult,
  emission: EmissionOk | null,
): { model: AlpModel; report: ReturnType<typeof reExpand>["report"] } | null {
  const oldGroup = model.groups.find((g) => g.id === groupId);
  if (!oldGroup) return null;
  const newGroup: ShapeGroup = { ...oldGroup, ...newGroupPatch };
  const emittedConstantNames = (placementId: string): readonly string[] => {
    const q = emission?.quantities.get(placementId);
    return q ? [q.xName, q.yName] : [];
  };
  const result = reExpand(oldGroup, newGroup, model.placements, parse, emittedConstantNames);
  const finishedGroup: ShapeGroup = { ...newGroup, members: result.members };
  return {
    model: { ...model, groups: model.groups.map((g) => (g.id === groupId ? finishedGroup : g)), placements: result.placements },
    report: result.report,
  };
}

export function updatePlacement(model: AlpModel, placementId: string, patch: Partial<Placement>): AlpModel {
  return { ...model, placements: model.placements.map((p) => (p.id === placementId ? { ...p, ...patch } : p)) };
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
export function applyDragToPlacement(model: AlpModel, placementId: string, offset: Placement["offset"]): AlpModel {
  const inGroup = isGroupMember(model, placementId);
  return {
    ...model,
    placements: model.placements.map((p) =>
      p.id === placementId ? { ...p, offset, ...(inGroup ? { nudged: true } : {}) } : p,
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
export function setThetaPerCountOverride(model: AlpModel, placementId: string, count: number, expr: Expr | undefined): AlpModel {
  return {
    ...model,
    placements: model.placements.map((p) => {
      if (p.id !== placementId) return p;
      const next = { ...(p.thetaPerCount ?? {}) };
      if (expr === undefined) delete next[count];
      else next[count] = expr;
      return { ...p, thetaPerCount: Object.keys(next).length > 0 ? next : undefined };
    }),
  };
}

/** Standalone placements only (never a group member, leaving/removing a member is a pattern/repeats edit through `applyGroupEdit`). */
export function addStandalonePlacement(model: AlpModel, roleId: string | undefined, parent: Anchor = "center"): { model: AlpModel; id: string } {
  const id = freshId("land");
  const placement: Placement = {
    id,
    parent,
    frame: "radial",
    offset: { kind: "polar", r: { k: "num", v: 20 }, theta: { k: "num", v: 0 } },
    label: id,
    role: roleId,
  };
  return { model: { ...model, placements: [...model.placements, placement] }, id };
}

export function deleteStandalonePlacement(model: AlpModel, placementId: string): AlpModel {
  return {
    ...model,
    placements: model.placements
      .filter((p) => p.id !== placementId)
      // Any child chained to the deleted node re-parents to the map centre rather than dangling.
      .map((p) => (p.parent === placementId ? { ...p, parent: "center" } : p)),
  };
}

/** True when `placementId` is a member of any ShapeGroup, such a placement is edited through the group's own controls, not deleted individually. */
export function isGroupMember(model: AlpModel, placementId: string): boolean {
  return model.groups.some((g) => g.members.includes(placementId));
}

export function groupForMember(model: AlpModel, placementId: string): ShapeGroup | undefined {
  return model.groups.find((g) => g.members.includes(placementId));
}
