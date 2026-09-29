// The glue slice-5-brief.md items 3 and 5 need, kept as plain, tested
// functions rather than folded into LandPlacementCanvas.tsx — this brief's
// own §4/§5 rule: "push every calculation into a tested pure function, so
// the run sheet checks wiring and legibility and never the correctness of a
// number." `dragMath.ts`/`snapping.ts` are called here, never edited (the
// brief's own instruction).

import { evalClosed, evalExpr } from "../compiler/expr";
import {
  applyDrag,
  dragPolar,
  foldBearing,
  symbolicDeclineReason,
  type DragOutcome,
  type PercentPoint,
  type PolarLabel,
  type ResolvedOffsetComponents,
} from "./dragMath";
import type { SnapContext } from "./snapping";
import { wouldCreateCycle } from "./viewModel";
import { groupForMember, updatePlacement } from "./modelOps";
import { radiusFollowsCount } from "../prologue";
import type { EmissionOk } from "../emitModel";
import type { AlpModel } from "../fence";
import type { Anchor, Placement, ShapeGroup } from "../model";

const MAP_CENTRE: PercentPoint = { x: 50, y: 50 };

/**
 * The fields of `placementId`'s offset the emitter replaces with prologue
 * cells, which a drag therefore cannot write (`applyDrag`'s
 * `perPlayerForced`). None outside a per player shape. Angle on every per
 * player kind, and Radius too on a kind whose radius moves with the count
 * (any-kind escalation Sec.6).
 */
export function perPlayerForcedLabels(
  model: AlpModel,
  placementId: string,
): PolarLabel[] {
  const group = groupForMember(model, placementId);
  if (group?.perPlayer !== true) return [];
  return radiusFollowsCount(group.kind) ? ["Radius", "Angle"] : ["Angle"];
}

/**
 * `anchor`'s own resolved position, in percent, per the SAME `resolved`
 * table `overlay.ts` reads (Sec.5.5 step 2: the emitted block read back
 * exactly as the engine will). `undefined` when the anchor's own position
 * has not resolved (an unverified/failed emission, or a dangling parent id
 * — never guessed at).
 */
export function resolvedPercentOf(
  anchor: Anchor,
  emission: EmissionOk,
): PercentPoint | undefined {
  if (anchor === "center") return MAP_CENTRE;
  const quantity = emission.quantities.get(anchor);
  if (!quantity) return undefined;
  const x = emission.resolved.get(quantity.xName);
  const y = emission.resolved.get(quantity.yName);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/**
 * `anchor`'s own resolved DEGREES, `undefined` for the map centre, a
 * `cartesian`/`formula` node, or an unresolved id — exactly frame.ts's own
 * "no DEGREES cell to compose against" case (`PlacementQuantity.degreesName`
 * doc comment), which `dragPolar`/`gizmoHandlePositions` both already treat
 * as "fall back to a plain world bearing".
 */
export function resolvedDegreesOf(
  anchor: Anchor,
  emission: EmissionOk,
): number | undefined {
  if (anchor === "center") return undefined;
  const quantity = emission.quantities.get(anchor);
  if (!quantity || quantity.degreesName === undefined) return undefined;
  return emission.resolved.get(quantity.degreesName);
}

// ---------------------------------------------------------------------------
// Item 3: the snap context builder (Sec.7.3).
// ---------------------------------------------------------------------------

/**
 * "The snap context builder is a lookup, so it is testable. Pin that it
 * supplies parentAnchor for a chained node and omits it for a root one."
 * `parentAnchor` is deliberately omitted for a placement parented to
 * "center" — `snapToCentre` already covers that case (`snapping.ts`'s own
 * `SnapContext.parentAnchor` doc comment), so supplying map-centre again
 * here would just make the two magnetic snaps redundant, never wrong, but
 * worth pinning as an explicit omission rather than an accident.
 */
export function buildSnapContext(
  model: AlpModel,
  placementId: string,
  emission: EmissionOk,
  mapDim: number,
): SnapContext {
  const placement = model.placements.find((p) => p.id === placementId);
  const parentAnchor =
    placement && placement.parent !== "center"
      ? resolvedPercentOf(placement.parent, emission)
      : undefined;
  return { mapDim, parentAnchor };
}

/**
 * shape-kinds-slice-b-brief.md item 2: `placement`'s own CURRENTLY RESOLVED
 * numeric offset, `dragMath.ts`'s `applyDrag` new optional input for the
 * absorb path, its own `r`/`theta` (or `dx`/`dy`) evaluated against this
 * emission's `resolved` table, the same lookup `evalGroupExpr` already does
 * for a group's radius/rotation, applied here to a PLACEMENT's own offset
 * instead. `undefined` for a `formula` offset (which has its own absorb
 * path already, unrelated to this) or when either component hasn't
 * resolved, never guessed at.
 */
export function resolvedOffsetOf(
  placement: Placement,
  emission: EmissionOk,
): ResolvedOffsetComponents | undefined {
  if (placement.offset.kind === "polar") {
    const r = evalGroupExpr(placement.offset.r, emission);
    const theta = evalGroupExpr(placement.offset.theta, emission);
    return r === undefined || theta === undefined
      ? undefined
      : { kind: "polar", r, theta };
  }
  if (placement.offset.kind === "cartesian") {
    const dx = evalGroupExpr(placement.offset.dx, emission);
    const dy = evalGroupExpr(placement.offset.dy, emission);
    return dx === undefined || dy === undefined
      ? undefined
      : { kind: "cartesian", dx, dy };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Item 5: chain creation by dragging from a rim handle (Sec.7.3).
// ---------------------------------------------------------------------------

export type RimDragResult =
  { ok: true; model: AlpModel } | { ok: false; reason: string };

/**
 * "Drag from a land's rim to another land or to the centre marker to create
 * the chain, computing the offset that leaves the child exactly where it
 * is." The drop point `applyDrag` receives is therefore the CHILD's own
 * current resolved position under the NEW anchor/parent — never wherever
 * the pointer actually was — so re-parenting never moves anything on
 * screen. Refuses a cycle (`wouldCreateCycle`, already built for the
 * panel's own parent picker) up front rather than emitting a broken model.
 */
export function computeRimDragReparent(
  model: AlpModel,
  emission: EmissionOk,
  childId: string,
  newParent: Anchor,
  mapDim: number,
): RimDragResult {
  if (mapDim <= 0) return { ok: false, reason: "map size unresolved" };
  if (wouldCreateCycle(model, childId, newParent)) {
    return {
      ok: false,
      reason: "that would make this placement its own ancestor",
    };
  }
  const child = model.placements.find((p) => p.id === childId);
  if (!child) return { ok: false, reason: `placement "${childId}" not found` };

  const childPosition = resolvedPercentOf(childId, emission);
  if (!childPosition)
    return {
      ok: false,
      reason: "the dragged land has no resolved position yet",
    };
  const newAnchor = resolvedPercentOf(newParent, emission);
  if (!newAnchor)
    return {
      ok: false,
      reason: "the drop target has no resolved position yet",
    };
  const parentDegreesResolved = resolvedDegreesOf(newParent, emission);

  // previousPosition === droppedAt === childPosition: for polar/cartesian
  // this asks applyDrag "what offset from the NEW anchor lands exactly on
  // where the child already is", the item's own stated acceptance. For
  // `formula` it makes the delta zero, which is correct for a different
  // reason — a formula offset's x/y are the absolute position directly
  // (frame.ts's own rule) and never combine with a parent anchor at all, so
  // re-parenting such a node changes nothing about where it resolves.
  // shape-kinds-slice-b-brief.md item 2: pass the child's own currently
  // resolved offset, so re-parenting a member of a symbolically rotated
  // ring (Bulls_Eyes' own `ROTATION_PLAYER` shape) can now absorb the delta
  // and keep the reference instead of declining outright, the escalation's
  // own worked example for this call site (§6).
  const outcome: DragOutcome = applyDrag(
    child,
    newAnchor,
    childPosition,
    childPosition,
    parentDegreesResolved,
    [],
    resolvedOffsetOf(child, emission),
  );
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const updated = updatePlacement(model, childId, {
    parent: newParent,
    offset: outcome.placement.offset,
  });
  return { ok: true, model: updated };
}

// ---------------------------------------------------------------------------
// Item 4: interpreting a gizmo handle drag (Sec.7.3). Where the handles SIT
// is gizmoGeometry.ts's own job; this is the inverse — given a drop point on
// one of them, what should the group's radius or rotation become.
// ---------------------------------------------------------------------------

export interface GroupFrameContext {
  anchor: PercentPoint;
  parentDegreesResolved: number | undefined;
}

/** `group.parent`'s own resolved anchor and DEGREES, what both the handle-position and handle-drag math need. `undefined` when the parent hasn't resolved. */
export function resolveGroupFrameContext(
  parent: Anchor,
  emission: EmissionOk,
): GroupFrameContext | undefined {
  const anchor = resolvedPercentOf(parent, emission);
  if (!anchor) return undefined;
  return { anchor, parentDegreesResolved: resolvedDegreesOf(parent, emission) };
}

/** `group.radius`/`group.rotation` evaluated against this model's own dry-run `resolved` table (Sec.5.5 step 3's same convention `formulaField.ts` already uses), `undefined` on anything this reference evaluator can't resolve — a `param` this model hasn't hoisted through a real emission being the practical case. */
export function evalGroupExpr(
  expr: import("../../../../../tools-api/index").Expr,
  emission: EmissionOk,
): number | undefined {
  return evalExpr(expr, {
    resolveSym: (name) => emission.resolved.get(name),
    // A param previews at its midpoint (paramEmit.ts), the same value the
    // emission's own `resolved` table carries under the emitted name.
    resolveParam: (id) => emission.paramPreview.get(id),
  });
}

// ---------------------------------------------------------------------------
// Item 3 (shape-kinds-slice-c-brief.md): what is left of slice 5's own item
// 6, interpreting a drag of the two per-kind handles gizmoGeometry.ts now
// positions. Pure functions with their own tests, per the brief's own
// instruction, the same reason computeRimDragReparent and buildSnapContext
// above are here rather than inline in LandPlacementCanvas.tsx.
// ---------------------------------------------------------------------------

export interface LineEndDragResult {
  radius: number;
  rotation: number;
}

export type LineEndDragOutcome =
  { ok: true; result: LineEndDragResult } | { ok: false; reason: string };

/**
 * A line's near-end handle edits `radius` (the drop distance) AND
 * `rotation` (the drop bearing plus 180, folded) TOGETHER — the near end is
 * the far end's own mirror through the anchor, so moving it means "resize
 * and re-aim the whole line", never one field alone. Declines exactly like
 * the existing radius/rotation gizmo handles when either field is symbolic
 * (`symbolicDeclineReason`, the same wording, not a second phrasing), and
 * checks BOTH before computing either, so a drag that would succeed on one
 * field and silently no-op on the other never gets the chance (hazard 2:
 * two edits where one belongs would measure the second delta against a
 * group only half updated, this keeps it to the one `applyGroupEdit` call
 * the caller makes from this single result).
 */
export function computeLineEndDrag(
  group: Pick<ShapeGroup, "radius" | "rotation" | "frame">,
  frameCtx: GroupFrameContext,
  droppedAt: PercentPoint,
): LineEndDragOutcome {
  const symbolicLabels: string[] = [];
  if (evalClosed(group.radius) === undefined)
    symbolicLabels.push("This ring's radius");
  if (evalClosed(group.rotation) === undefined)
    symbolicLabels.push("This ring's rotation");
  if (symbolicLabels.length > 0)
    return { ok: false, reason: symbolicDeclineReason(symbolicLabels) };

  const { r, theta } = dragPolar(
    frameCtx.anchor,
    droppedAt,
    group.frame,
    frameCtx.parentDegreesResolved,
  );
  return {
    ok: true,
    result: { radius: r, rotation: foldBearing(theta + 180) },
  };
}

/** Wraps into `(0, 360]`, never folded into `dragPolar`'s own signed bearing range (hazard 3): a sweep is a span, never negative, which is a different quantity from a bearing even though both are "an angle". An exact multiple of 360 wraps to 360, not 0, so a full-turn drop still reads as a real span rather than the degenerate "no sweep at all". */
function wrapSweepDegrees(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 0 ? 360 : wrapped;
}

/**
 * An arc's sweep handle edits `sweep` ONLY — a plain `number` on the model,
 * never an `Expr`, so it can never hit the symbolic decline the line-end
 * handle needs (`ShapeGroup.sweep`'s own doc comment: consumed at expansion
 * time to bake an integer degree literal per member). `resolvedRotationDegrees`
 * is the caller's job to look up (`evalGroupExpr(group.rotation, emission)`,
 * the same lookup the handle's own drawn position already uses) — this
 * function only turns a drop point into a span, given where the group's
 * rotation ray currently sits.
 */
export function computeArcSweepDrag(
  group: Pick<ShapeGroup, "frame">,
  frameCtx: GroupFrameContext,
  resolvedRotationDegrees: number,
  droppedAt: PercentPoint,
): number {
  const { theta } = dragPolar(
    frameCtx.anchor,
    droppedAt,
    group.frame,
    frameCtx.parentDegreesResolved,
  );
  return wrapSweepDegrees(theta - resolvedRotationDegrees);
}
