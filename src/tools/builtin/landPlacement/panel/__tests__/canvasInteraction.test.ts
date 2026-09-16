// slice-5-brief.md items 3 and 5's own acceptance criteria:
//   item 3: "the snap context builder is a lookup, so it is testable. Pin
//     that it supplies parentAnchor for a chained node and omits it for a
//     root one."
//   item 5: "re-parenting through this path leaves the child's resolved
//     position unchanged, asserted by running emitModel before and after
//     and comparing resolved positions, not by asserting on the offset
//     numbers."

import { describe, expect, it } from "vitest";
import { num, sym } from "../../compiler/expr";
import { NameAllocator } from "../../compiler/naming";
import { expandShapeGroup } from "../../expand";
import { emitAlpModel, type EmissionOk } from "../../emitModel";
import type { AlpModel } from "../../fence";
import type { LandRole, Placement, ShapeGroup } from "../../model";
import {
  buildSnapContext,
  computeArcSweepDrag,
  computeLineEndDrag,
  computeRimDragReparent,
  resolvedOffsetOf,
  resolvedPercentOf,
  type GroupFrameContext,
} from "../canvasInteraction";

const ROLE_P: LandRole = {
  id: "role-P",
  label: "P",
  terrain: { k: "name", name: "GRASS" },
  baseSize: num(10),
  baseElevation: num(0),
  landPercent: num(5),
  zone: { kind: "none" },
  assignToPlayer: false,
};

function threePlacementModel(): AlpModel {
  const placements: Placement[] = [
    {
      id: "P1",
      parent: "center",
      frame: "radial",
      label: "P1",
      offset: { kind: "polar", r: num(20), theta: num(0) },
    },
    {
      id: "P2",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(90) },
    },
    {
      id: "CHILD",
      parent: "P1",
      frame: "radial",
      label: "CHILD",
      offset: { kind: "polar", r: num(10), theta: num(0) },
    },
  ];
  return { v: 1, placements, roles: [], randomParams: [], groups: [] };
}

function emit(model: AlpModel): EmissionOk {
  const namer = new NameAllocator();
  const result = emitAlpModel(model, namer, new Map(), 2);
  expect(result.ok).toBe(true);
  return result as EmissionOk;
}

/**
 * "Unchanged" tolerates dragMath.ts's own documented gap, NOT exact
 * equality: `applyDrag`'s `dragPolar` inverts with REAL trig
 * (Math.cos/sin), while emission's own `frame.ts` -> `compiler/trig.ts`
 * re-derives X/Y with the Bhaskara macro, whose distance from real trig
 * Sec.5.4 prices at up to 0.5 degrees — and a reparent round-trips through
 * BOTH directions (the new anchor's own position was itself macro-emitted,
 * then the child's new r/theta is macro-re-emitted again), so the error
 * compounds rather than cancelling. A percent-of-map tolerance of 1 (two
 * tiles on a 200-tile map) is generous against that known source and still
 * tight enough to fail hard on an actual "the child jumped across the map"
 * regression, which is the property this test exists to catch.
 */
function expectApproxSamePosition(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(1);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(1);
}

describe("buildSnapContext (item 3)", () => {
  it("supplies parentAnchor for a chained node, resolved from the parent's own emitted position", () => {
    const model = threePlacementModel();
    const emission = emit(model);
    const ctx = buildSnapContext(model, "CHILD", emission, 200);
    expect(ctx.mapDim).toBe(200);
    expect(ctx.parentAnchor).toBeDefined();
    expect(ctx.parentAnchor).toEqual(resolvedPercentOf("P1", emission));
  });

  it('omits parentAnchor for a root node parented to "center" — snapToCentre already covers that case', () => {
    const model = threePlacementModel();
    const emission = emit(model);
    const ctx = buildSnapContext(model, "P1", emission, 200);
    expect(ctx.parentAnchor).toBeUndefined();
  });
});

describe("computeRimDragReparent (item 5)", () => {
  it("leaves the child's resolved position unchanged across a reparent, verified by re-running emitAlpModel and comparing resolved positions", () => {
    const model = threePlacementModel();
    const before = emit(model);
    const childBefore = resolvedPercentOf("CHILD", before)!;

    const result = computeRimDragReparent(model, before, "CHILD", "P2", 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Same offset KIND question deliberately not asked here — the brief's
    // own instruction is to compare RESOLVED POSITIONS, not offset numbers,
    // since the property under test is "nothing moves on screen", and the
    // offset that achieves that is an implementation detail of dragMath.ts.
    const after = emit(result.model);
    const childAfter = resolvedPercentOf("CHILD", after)!;
    expectApproxSamePosition(childAfter, childBefore);

    // And the reparent itself actually happened.
    const updated = result.model.placements.find((p) => p.id === "CHILD")!;
    expect(updated.parent).toBe("P2");
  });

  it("re-parenting to the map centre works the same way — droppedAt is the child's own current position under the {50,50} anchor", () => {
    const model = threePlacementModel();
    const before = emit(model);
    const childBefore = resolvedPercentOf("CHILD", before)!;

    const result = computeRimDragReparent(
      model,
      before,
      "CHILD",
      "center",
      200,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = emit(result.model);
    const childAfter = resolvedPercentOf("CHILD", after)!;
    expectApproxSamePosition(childAfter, childBefore);
  });

  it("refuses a drop that would create a cycle, before touching the model", () => {
    const model = threePlacementModel();
    const emission = emit(model);
    // P1 is CHILD's own parent; re-parenting P1 under CHILD would be a cycle.
    const result = computeRimDragReparent(model, emission, "P1", "CHILD", 200);
    expect(result).toEqual({
      ok: false,
      reason: "that would make this placement its own ancestor",
    });
  });

  it("refuses re-parenting a placement onto itself", () => {
    const model = threePlacementModel();
    const emission = emit(model);
    const result = computeRimDragReparent(model, emission, "P1", "P1", 200);
    expect(result.ok).toBe(false);
  });

  // shape-kinds-slice-b-brief.md item 2's own worked example: re-parenting a
  // member of a symbolically rotated ring used to decline outright (a
  // literal-only overwrite of theta would freeze the member at one angle
  // while its siblings kept following the group's own rotation), and now
  // absorbs the delta instead, per the escalation's §6.
  it("re-parenting a member of a symbolically rotated ring now succeeds, keeps the rotation reference, and leaves the resolved position unchanged", () => {
    const group: ShapeGroup = {
      id: "G",
      parent: "center",
      kind: "circle",
      pattern: [{ id: "P", role: "role-P" }],
      repeats: 1,
      radius: num(20),
      rotation: sym("ROTATION_PLAYER"),
      frame: "radial",
      members: [],
      perPlayer: false,
    };
    const { placements: groupPlacements, members } = expandShapeGroup(group);
    const finishedGroup: ShapeGroup = { ...group, members };
    const p2: Placement = {
      id: "P2",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(90) },
    };
    const model: AlpModel = {
      v: 1,
      placements: [...groupPlacements, p2],
      roles: [ROLE_P],
      randomParams: [],
      groups: [finishedGroup],
    };

    const namer = new NameAllocator();
    const scriptSymbols = new Map([["ROTATION_PLAYER", 45]]);
    const before = emitAlpModel(model, namer, scriptSymbols, 2) as EmissionOk;
    expect(before.ok).toBe(true);
    const childId = finishedGroup.members[0];
    const childBefore = resolvedPercentOf(childId, before)!;

    const result = computeRimDragReparent(model, before, childId, "P2", 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = result.model.placements.find((p) => p.id === childId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");
    // The reference survives — a bare literal overwrite would have replaced
    // the sym leaf entirely, which is exactly what this test would catch.
    expect(JSON.stringify(updated.offset.theta)).toContain("ROTATION_PLAYER");

    const after = emitAlpModel(
      result.model,
      new NameAllocator(),
      scriptSymbols,
      2,
    ) as EmissionOk;
    expect(after.ok).toBe(true);
    const childAfter = resolvedPercentOf(childId, after)!;
    expectApproxSamePosition(childAfter, childBefore);
  });

  it("resolvedOffsetOf reads a polar member's own r/theta straight off the emission's resolved table", () => {
    const group: ShapeGroup = {
      id: "G",
      parent: "center",
      kind: "circle",
      pattern: [{ id: "P", role: "role-P" }],
      repeats: 1,
      radius: num(20),
      rotation: sym("ROTATION_PLAYER"),
      frame: "radial",
      members: [],
      perPlayer: false,
    };
    const { placements: groupPlacements, members } = expandShapeGroup(group);
    const model: AlpModel = {
      v: 1,
      placements: groupPlacements,
      roles: [ROLE_P],
      randomParams: [],
      groups: [{ ...group, members }],
    };
    const scriptSymbols = new Map([["ROTATION_PLAYER", 45]]);
    const emission = emitAlpModel(
      model,
      new NameAllocator(),
      scriptSymbols,
      2,
    ) as EmissionOk;
    expect(emission.ok).toBe(true);

    const placement = model.placements[0];
    const resolved = resolvedOffsetOf(placement, emission);
    expect(resolved).toEqual({ kind: "polar", r: 20, theta: 45 }); // rotation 45 + the even offset (0 for a single member)
  });

  it("resolvedOffsetOf returns undefined for a formula offset — that kind has its own absorb path already, unrelated to this one", () => {
    const model = threePlacementModel();
    const emission = emit(model);
    const formulaPlacement: Placement = {
      id: "F",
      parent: "center",
      frame: "radial",
      label: "F",
      offset: { kind: "formula", x: num(10), y: num(20) },
    };
    expect(resolvedOffsetOf(formulaPlacement, emission)).toBeUndefined();
  });
});

// shape-kinds-slice-c-brief.md item 3: what is left of slice 5's own item 6.
describe("computeLineEndDrag", () => {
  const frameCtx: GroupFrameContext = {
    anchor: { x: 50, y: 50 },
    parentDegreesResolved: undefined,
  };

  it("sets radius to the drop distance and rotation to the drop bearing plus 180, folded", () => {
    const group = {
      radius: num(20),
      rotation: num(0),
      frame: "absolute" as const,
    };
    // Drop straight down from the anchor (bearing 90), distance 15.
    const outcome = computeLineEndDrag(group, frameCtx, { x: 50, y: 65 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.radius).toBeCloseTo(15, 10);
    expect(outcome.result.rotation).toBeCloseTo(-90, 10); // 90 + 180, folded into (-180, 180]
  });

  it("dragging it to where it already is changes nothing", () => {
    const group = {
      radius: num(20),
      rotation: num(30),
      frame: "absolute" as const,
    };
    const rad = ((30 + 180) * Math.PI) / 180;
    const nearEndNow = {
      x: 50 + 20 * Math.cos(rad),
      y: 50 + 20 * Math.sin(rad),
    };
    const outcome = computeLineEndDrag(group, frameCtx, nearEndNow);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.radius).toBeCloseTo(20, 6);
    expect(outcome.result.rotation).toBeCloseTo(30, 6);
  });

  it("declines, naming ONLY the radius, when radius alone is symbolic", () => {
    const group = {
      radius: sym("SOME_PARAM"),
      rotation: num(0),
      frame: "absolute" as const,
    };
    const outcome = computeLineEndDrag(group, frameCtx, { x: 60, y: 50 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("This ring's radius");
    expect(outcome.reason).not.toContain("This ring's rotation");
  });

  it("declines, naming ONLY the rotation, when rotation alone is symbolic", () => {
    const group = {
      radius: num(20),
      rotation: sym("ROTATION_PLAYER"),
      frame: "absolute" as const,
    };
    const outcome = computeLineEndDrag(group, frameCtx, { x: 60, y: 50 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("This ring's rotation");
    expect(outcome.reason).not.toContain("This ring's radius");
  });

  it("declines naming BOTH when both fields are symbolic — the same symbolicDeclineReason wording, not a second phrasing", () => {
    const group = {
      radius: sym("R"),
      rotation: sym("ROT"),
      frame: "absolute" as const,
    };
    const outcome = computeLineEndDrag(group, frameCtx, { x: 60, y: 50 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("This ring's radius");
    expect(outcome.reason).toContain("This ring's rotation");
  });
});

describe("computeArcSweepDrag", () => {
  const frameCtx: GroupFrameContext = {
    anchor: { x: 50, y: 50 },
    parentDegreesResolved: undefined,
  };
  const group = { frame: "absolute" as const };

  it("is the drop bearing minus the group's own resolved rotation", () => {
    const rad = (100 * Math.PI) / 180;
    const drop = { x: 50 + 30 * Math.cos(rad), y: 50 + 30 * Math.sin(rad) };
    const sweep = computeArcSweepDrag(group, frameCtx, 10, drop);
    expect(sweep).toBeCloseTo(90, 6);
  });

  it("wraps into (0, 360], never folded into dragPolar's own signed bearing range (hazard 3)", () => {
    // rotation 350, drop at bearing 0: raw delta -350, which a signed fold
    // would leave negative-ish; as a span it wraps to 10.
    const sweep = computeArcSweepDrag(group, frameCtx, 350, { x: 80, y: 50 });
    expect(sweep).toBeCloseTo(10, 6);
    expect(sweep).toBeGreaterThan(0);
  });

  it("a drop just past 180 degrees stays a positive span rather than folding negative — the drop this hazard names by name", () => {
    const rad = (-170 * Math.PI) / 180;
    const drop = { x: 50 + 30 * Math.cos(rad), y: 50 + 30 * Math.sin(rad) };
    const sweep = computeArcSweepDrag(group, frameCtx, 0, drop);
    expect(sweep).toBeCloseTo(190, 3);
  });

  it("an exact full turn wraps to 360, not the degenerate 0", () => {
    const sweep = computeArcSweepDrag(group, frameCtx, 0, { x: 80, y: 50 }); // same bearing as rotation
    expect(sweep).toBe(360);
  });
});
