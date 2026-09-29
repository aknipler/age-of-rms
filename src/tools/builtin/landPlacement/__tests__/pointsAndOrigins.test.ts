// Two additions from 2026-09-28. A shape slot with no role places points,
// emitted as coordinates with no create_land (PatternSlot.role), so a shape
// can be a set of anchors with no land on it. And a shape's origin can move
// off the map centre onto any land it does not own (applyGroupEdit parent).

import { describe, expect, it } from "vitest";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { NameAllocator } from "../compiler/naming";
import { num } from "../compiler/expr";
import { emitAlpModel, type EmissionOk } from "../emitModel";
import type { AlpModel } from "../fence";
import { ASSIGN_TO_PLAYER_PER_REPEAT, type LandRole } from "../model";
import { buildOverlayShapes } from "../overlay";
import {
  addChainTemplate,
  addRing,
  addShapeOriginPoint,
  addStandalonePlacement,
  applyGroupEdit,
  deleteGroup,
  deleteRole,
  deleteStandalonePlacement,
  setSlotRole,
  shapeOriginCandidates,
  updateChainTemplate,
  updatePlacement,
} from "../panel/modelOps";
import { shapeGroupLandTotal } from "../panel/viewModel";

const lang = loadLanguage();
const parse = parseRms("<PLAYER_SETUP>\ndirect_placement\n", lang);

function role(): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: { k: "num", v: 6 },
    baseElevation: { k: "num", v: 0 },
    extent: { kind: "percent", value: { k: "num", v: 4 } },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
  };
}

const EMPTY: AlpModel = {
  v: 1,
  placements: [],
  roles: [role()],
  randomParams: [],
  groups: [],
};

function emit(model: AlpModel): EmissionOk {
  const result = emitAlpModel(model, new NameAllocator(), new Map(), 8);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result;
}

/** A placement's emitted position in map percent, read off the dry run. */
function position(emission: EmissionOk, id: string): { x: number; y: number } {
  const q = emission.quantities.get(id)!;
  return {
    x: emission.resolved.get(q.xName)!,
    y: emission.resolved.get(q.yName)!,
  };
}

describe("a points-only shape", () => {
  it("writes a slot with no role key, and members with no role", () => {
    const { model, groupId } = addRing(EMPTY, undefined);
    const group = model.groups.find((g) => g.id === groupId)!;
    expect("role" in group.pattern[0]!).toBe(false);
    for (const id of group.members)
      expect(model.placements.find((p) => p.id === id)!.role).toBeUndefined();
  });

  it("emits every point's coordinates and no create_land", () => {
    const { model, groupId } = addRing(EMPTY, undefined);
    const emission = emit(model);
    const members = model.groups.find((g) => g.id === groupId)!.members;
    expect(members).toHaveLength(8);
    for (const id of members) {
      const p = position(emission, id);
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(30, 0);
    }
    expect(emission.createLandText.size).toBe(0);
  });

  it("a chain template on it places one land beside each point", () => {
    const { model, groupId } = addRing(EMPTY, undefined);
    const slotId = model.groups[0]!.pattern[0]!.id;
    const chained = addChainTemplate(
      model,
      groupId,
      slotId,
      "player",
      parse,
      null,
    )!.model;
    const group = chained.groups[0]!;
    expect(emit(chained).createLandText.size).toBe(8);
    expect(shapeGroupLandTotal(group)).toEqual({
      count: 8,
      points: 8,
      exact: true,
    });
  });

  it("draws each point on the canvas as a selectable point", () => {
    const { model } = addRing(EMPTY, undefined);
    const emission = emit(model);
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 120,
    });
    const points = shapes.filter((s) => s.kind === "point");
    expect(points.map((s) => s.id).sort()).toEqual(
      [...model.groups[0]!.members].sort(),
    );
  });

  it("setSlotRole moves a slot between a role and points, and its lands follow", () => {
    const { model, groupId } = addRing(EMPTY, "player");
    const slotId = model.groups[0]!.pattern[0]!.id;
    const points = setSlotRole(
      model,
      groupId,
      slotId,
      undefined,
      parse,
      null,
    )!.model;
    expect("role" in points.groups[0]!.pattern[0]!).toBe(false);
    expect(points.placements.every((p) => p.role === undefined)).toBe(true);
    const back = setSlotRole(
      points,
      groupId,
      slotId,
      "player",
      parse,
      null,
    )!.model;
    expect(back.placements.every((p) => p.role === "player")).toBe(true);
  });

  it("deleting its role turns a slot into points and keeps each land's repeat index", () => {
    const { model } = addRing(EMPTY, "player");
    const after = deleteRole(model, "player");
    expect("role" in after.groups[0]!.pattern[0]!).toBe(false);
    expect(after.placements.map((p) => p.repeatIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});

/** What the shape editor's Origin select does. */
function moveOrigin(
  model: AlpModel,
  groupId: string,
  parent: string,
): AlpModel {
  return applyGroupEdit(model, groupId, { parent }, parse, null)!.model;
}

/** Ring A (points), ring B (lands), a land L chained off one of A's points, and a standalone land M. */
function twoShapes() {
  const a = addRing(EMPTY, undefined);
  const b = addRing(a.model, "player");
  const aMember = b.model.groups[0]!.members[0]!;
  const l = addStandalonePlacement(b.model, "player", aMember);
  const m = addStandalonePlacement(l.model, "player");
  return {
    model: m.model,
    a: a.groupId,
    b: b.groupId,
    aMember,
    bMember: m.model.groups[1]!.members[0]!,
    l: l.id,
    m: m.id,
  };
}

describe("a shape's origin", () => {
  it("can be any land the shape does not own or hold up", () => {
    const s = twoShapes();
    const ids = shapeOriginCandidates(s.model, s.a).map((p) => p.id);
    expect(ids).toContain(s.m);
    expect(ids).toContain(s.bMember);
    expect(ids).not.toContain(s.aMember);
    expect(ids).not.toContain(s.l); // hangs off one of A's points
  });

  it("refuses an origin that would make a member its own ancestor", () => {
    const s = twoShapes();
    expect(
      applyGroupEdit(s.model, s.a, { parent: s.aMember }, parse, null),
    ).toBeNull();
    expect(
      applyGroupEdit(s.model, s.a, { parent: s.l }, parse, null),
    ).toBeNull();
  });

  it("moving the origin moves every member onto it and leaves the frame alone", () => {
    // The first version switched to absolute on leaving the centre. That
    // was dropped (2026-09-28), a frame that changes unasked is easy to miss.
    const s = twoShapes();
    const moved = moveOrigin(s.model, s.a, s.m);
    const group = moved.groups.find((g) => g.id === s.a)!;
    expect(group.parent).toBe(s.m);
    expect(group.frame).toBe("radial");
    for (const id of group.members) {
      const p = moved.placements.find((q) => q.id === id)!;
      expect(p.parent).toBe(s.m);
      expect(p.frame).toBe("radial");
    }
  });

  it("the Frame select reaches members that already exist", () => {
    // Both directions, since members start radial. Checking only a switch
    // to radial passed with the frame never propagating at all
    // (mutation-tested).
    const s = twoShapes();
    const frames = (m: AlpModel) =>
      m.groups
        .find((g) => g.id === s.a)!
        .members.map((id) => m.placements.find((p) => p.id === id)!.frame);
    const moved = moveOrigin(s.model, s.a, s.m);
    const absolute = applyGroupEdit(
      moved,
      s.a,
      { frame: "absolute" },
      parse,
      null,
    )!.model;
    expect(new Set(frames(absolute))).toEqual(new Set(["absolute"]));
    const radial = applyGroupEdit(
      absolute,
      s.a,
      { frame: "radial" },
      parse,
      null,
    )!.model;
    expect(new Set(frames(radial))).toEqual(new Set(["radial"]));
  });

  it("+ Origin point keeps a radial shape exactly still, on the centre or on a land", () => {
    // Members are compared one by one, so a 180 degree flip of an even
    // ring, which lands on the same eight spots, still shows up.
    const onCentre = addRing(EMPTY, "player");
    const withLand = addStandalonePlacement(onCentre.model, undefined);
    const landAt = updatePlacement(withLand.model, withLand.id, {
      offset: { kind: "polar", r: num(20), theta: num(45) },
    });
    const onLand = moveOrigin(landAt, onCentre.groupId, withLand.id);
    for (const model of [onCentre.model, onLand]) {
      const before = emit(model);
      const after = emit(
        addShapeOriginPoint(model, onCentre.groupId, parse, null)!.model,
      );
      for (const id of model.groups[0]!.members) {
        expect(position(after, id).x).toBeCloseTo(position(before, id).x, 6);
        expect(position(after, id).y).toBeCloseTo(position(before, id).y, 6);
      }
    }
  });

  it("moving the point translates an absolute shape and turns a radial one", () => {
    const { model, groupId } = addRing(EMPTY, "player");
    const members = model.groups[0]!.members;
    const { model: radial, pointId } = addShapeOriginPoint(
      model,
      groupId,
      parse,
      null,
    )!;
    const absolute = applyGroupEdit(
      radial,
      groupId,
      { frame: "absolute" },
      parse,
      null,
    )!.model;
    /** Every member's move when the origin point goes 20% out along bearing 0. */
    const deltas = (m: AlpModel) => {
      const still = emit(m);
      const shifted = emit(
        updatePlacement(m, pointId, {
          offset: { kind: "polar", r: num(20), theta: num(0) },
        }),
      );
      return members.map((id) => ({
        dx: position(shifted, id).x - position(still, id).x,
        dy: position(shifted, id).y - position(still, id).y,
      }));
    };
    const moves = deltas(absolute);
    expect(Math.hypot(moves[0]!.dx, moves[0]!.dy)).toBeCloseTo(20, 0);
    for (const d of moves) {
      expect(d.dx).toBeCloseTo(moves[0]!.dx, 1);
      expect(d.dy).toBeCloseTo(moves[0]!.dy, 1);
    }
    // Radial measures from the ray back toward the map centre, which turns
    // by 180 degrees between the point's starting angle and bearing 0, so
    // the members move by different amounts.
    const turned = deltas(radial);
    const spread = Math.max(
      ...turned.map((d) =>
        Math.hypot(d.dx - turned[0]!.dx, d.dy - turned[0]!.dy),
      ),
    );
    expect(spread).toBeGreaterThan(10);
  });

  it("deleting the origin land puts the shape back on the map centre", () => {
    const s = twoShapes();
    const moved = moveOrigin(s.model, s.a, s.m);
    const after = deleteStandalonePlacement(moved, s.m);
    const group = after.groups.find((g) => g.id === s.a)!;
    expect(group.parent).toBe("center");
    for (const id of group.members)
      expect(after.placements.find((p) => p.id === id)!.parent).toBe("center");
  });

  it("deleting a shape re-homes anything parented to its lands", () => {
    const s = twoShapes();
    const bOnA = moveOrigin(s.model, s.b, s.aMember);
    const after = deleteGroup(bOnA, s.a);
    expect(after.groups.find((g) => g.id === s.b)!.parent).toBe("center");
    expect(after.placements.find((p) => p.id === s.l)!.parent).toBe("center");
  });
});

describe("a chain template's frame", () => {
  it("reaches the lands it already placed", () => {
    // The same reExpand gap as the shape Frame select. A matched chain
    // child kept its old frame, so the template's Frame select did nothing.
    const { model, groupId } = addRing(EMPTY, "player");
    const slotId = model.groups[0]!.pattern[0]!.id;
    const chained = addChainTemplate(
      model,
      groupId,
      slotId,
      "player",
      parse,
      null,
    )!.model;
    const template = chained.groups[0]!.pattern[0]!.chain![0]!;
    const absolute = updateChainTemplate(
      chained,
      groupId,
      slotId,
      template.id,
      { frame: template.frame === "radial" ? "absolute" : "radial" },
      parse,
      null,
    )!.model;
    const want = template.frame === "radial" ? "absolute" : "radial";
    for (const id of absolute.groups[0]!.chainMembers!)
      expect(absolute.placements.find((p) => p.id === id)!.frame).toBe(want);
  });
});
