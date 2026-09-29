// slice-5-brief.md item 2's own acceptance: "dragging a member and then
// changing the ring's repeats re-applies the drag as a delta against the
// new base rather than discarding it, asserted through reExpand() on the
// model with no canvas involved. Assert the negative too: dragging a
// standalone placement leaves nudged unset."

import { describe, expect, it } from "vitest";
import { evalClosed, num } from "../../compiler/expr";
import type { Expr } from "../../../../../../tools-api/index";
import { expandShapeGroup } from "../../expand";
import { parseRms } from "../../../../../parser/parser";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { reExpand } from "../../reExpand";
import type { Placement, ShapeGroup } from "../../model";
import { tryInvertFormulaCoordinate } from "../dragMath";
import {
  addPatternSlot,
  addRing,
  addStandalonePlacement,
  applyDragToPlacement,
  applyGroupEdit,
  freshId,
  removePatternSlot,
  clearRoleOverride,
  deleteRandomParam,
  isParamReferenced,
  materialiseRndParams,
  setGroupJitter,
  setRoleOverride,
  setThetaPerCountOverride,
  takenIds,
  updatePlacement,
} from "../modelOps";
import type { AlpModel } from "../../fence";

const lang = loadLanguage();
const noNames = () => [] as readonly string[];

function group(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
  return {
    id: "G",
    parent: "center",
    kind: "circle",
    pattern: [
      { id: "P", role: "role-P" },
      { id: "A", role: "role-A" },
      { id: "B", role: "role-B" },
    ],
    repeats: 3,
    radius: num(26),
    rotation: num(0),
    frame: "radial",
    members: [],
    perPlayer: false,
    ...overrides,
  };
}

function seed(g: ShapeGroup): { group: ShapeGroup; placements: Placement[] } {
  const { placements, members } = expandShapeGroup(g);
  return { group: { ...g, members }, placements };
}

describe("applyDragToPlacement — the drag's own model edit (item 2)", () => {
  it("dragging a group member sets nudged, and the nudge survives a later repeats edit as a delta rather than being discarded", () => {
    const { group: oldGroup, placements } = seed(group());
    const memberId = oldGroup.members[0]; // repeat 0, slot P
    const original = placements.find((p) => p.id === memberId)!;
    expect(original.offset.kind).toBe("polar");
    const originalR = (
      original.offset as {
        kind: "polar";
        r: import("../../../../../../tools-api/index").Expr;
      }
    ).r;
    expect(originalR).toEqual(num(26)); // the group's own radius, un-nudged

    // Simulate a drag: the member moves to r=40 at its own theta (item 3's
    // snapping and dragMath.ts's own dragPolar are what would have produced
    // this in the real canvas path; this test starts from their output,
    // per the brief's own "no canvas involved").
    const draggedOffset: Placement["offset"] = {
      kind: "polar",
      r: num(40),
      theta: num(0),
    };
    const model: AlpModel = {
      v: 1,
      placements,
      roles: [],
      randomParams: [],
      groups: [oldGroup],
    };
    const afterDrag = applyDragToPlacement(model, memberId, draggedOffset);

    const draggedPlacement = afterDrag.placements.find(
      (p) => p.id === memberId,
    )!;
    expect(draggedPlacement.nudged).toBe(true);
    expect(draggedPlacement.offset).toEqual(draggedOffset);

    // Now change repeats 3 -> 4. Per Sec.4.5's merge rule, a nudged member's
    // offset re-applies as a DELTA against the new base, not a reset back to
    // the fresh expansion's own r=26.
    const newGroup: ShapeGroup = { ...oldGroup, repeats: 4 };
    const result = reExpand(
      oldGroup,
      newGroup,
      afterDrag.placements,
      parseRms("", lang),
      noNames,
    );

    const survivor = result.placements.find((p) => p.id === memberId)!;
    expect(survivor.nudged).toBe(true);
    expect(result.report.deltaAppliedIds).toContain(memberId);
    // Delta = new base's own r (still 26, radius unchanged by a repeats
    // edit) + (draggedR 40 - oldBase's own r 26) = 40, the nudge preserved
    // exactly rather than snapping back to the un-nudged expansion.
    const survivorOffset = survivor.offset as {
      kind: "polar";
      r: import("../../../../../../tools-api/index").Expr;
    };
    expect(survivorOffset.kind).toBe("polar");
    expect(survivorOffset.r).toEqual(num(40));
  });

  it("dragging a standalone placement leaves nudged unset (the negative the brief pins directly)", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    expect(
      withPlacement.placements.find((p) => p.id === id)!.nudged,
    ).toBeUndefined();

    const dragged = applyDragToPlacement(withPlacement, id, {
      kind: "polar",
      r: num(55),
      theta: num(10),
    });
    const placement = dragged.placements.find((p) => p.id === id)!;
    expect(placement.offset).toEqual({
      kind: "polar",
      r: num(55),
      theta: num(10),
    });
    expect(placement.nudged).toBeUndefined();
  });
});

// slice-c-brief.md item 1's own panel surface: setThetaPerCountOverride is
// the only mutation the per-count editor makes.
describe("setThetaPerCountOverride", () => {
  it("adds a first override, creating the map", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const next = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    expect(next.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({
      2: num(30),
    });
  });

  it("adds a second override alongside an existing one without disturbing it", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const twice = setThetaPerCountOverride(once, id, 5, num(99));
    expect(twice.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({
      2: num(30),
      5: num(99),
    });
  });

  it("overwrites an existing count's own override rather than adding a duplicate", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const replaced = setThetaPerCountOverride(once, id, 2, num(77));
    expect(replaced.placements.find((p) => p.id === id)!.thetaPerCount).toEqual(
      { 2: num(77) },
    );
  });

  it("removing the only override drops the map back to undefined, not an empty object", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const removed = setThetaPerCountOverride(once, id, 2, undefined);
    expect(
      removed.placements.find((p) => p.id === id)!.thetaPerCount,
    ).toBeUndefined();
  });

  it("removing one of several overrides leaves the rest untouched", () => {
    const empty: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const twice = setThetaPerCountOverride(
      setThetaPerCountOverride(withPlacement, id, 2, num(30)),
      id,
      5,
      num(99),
    );
    const removed = setThetaPerCountOverride(twice, id, 2, undefined);
    expect(removed.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({
      5: num(99),
    });
  });
});

// BUG-030: the panel's `+ slot` derived a slot id from `pattern.length`, so
// remove-the-middle-then-add produced a duplicate id, and because the merge
// rule keys members by (repeatIndex, slotId) the duplicate silently handed
// one slot's members to the other. `addPatternSlot`/`removePatternSlot` are
// the ops the buttons now call; `freshId` allocates against the whole model.
describe("addPatternSlot / removePatternSlot (BUG-030)", () => {
  const parse = parseRms("", lang);

  function seededModel(g: ShapeGroup = group()): AlpModel {
    const { group: expanded, placements } = seed(g);
    return {
      v: 1,
      placements,
      roles: [
        {
          id: "role-P",
          label: "P",
          terrain: { k: "name", name: "GRASS" },
          baseSize: num(5),
          baseElevation: num(0),
          extent: { kind: "percent", value: num(5) },
          zone: { kind: "none" },
          assign: { kind: "none" },
        },
      ],
      randomParams: [],
      groups: [expanded],
    };
  }

  it("a slot added after removing the middle one gets an id no surviving slot holds", () => {
    // Slot ids in the exact shape the old panel wrote them, so the fixture
    // CAN produce the wrong answer: with the length-derived id, removing
    // the middle of three leaves length 2 and the next id is `G_slot_2`,
    // which the survivor already holds. Neutral ids would pass either way.
    const start = seededModel(
      group({
        pattern: [
          { id: "G_slot_0", role: "role-P" },
          { id: "G_slot_1", role: "role-P" },
          { id: "G_slot_2", role: "role-P" },
        ],
      }),
    );
    const removed = removePatternSlot(
      start,
      "G",
      "G_slot_1",
      parse,
      null,
    )!.model;
    expect(removed.groups[0].pattern.map((s) => s.id)).toEqual([
      "G_slot_0",
      "G_slot_2",
    ]);
    const added = addPatternSlot(removed, "G", "role-P", parse, null)!.model;
    const ids = added.groups[0].pattern.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And the members are keyed apart: 2 repeats x 3 slots, every member a
    // distinct placement, none shared between the old B and the new slot.
    expect(new Set(added.groups[0].members).size).toBe(
      added.groups[0].pattern.length * added.groups[0].repeats,
    );
  });

  it("freshId skips an id the loaded model already carries, whichever session wrote it", () => {
    // A fence from an earlier session can hold `slot_1`; the counter in this
    // session has no memory of that. Seed the taken set with every id a
    // fresh counter could produce for a while and assert none is reused.
    const taken = new Set(["slot_1", "slot_2", "slot_3", "slot_4", "slot_5"]);
    const id = freshId("slot", taken);
    expect(taken.has(id)).toBe(false);
    // takenIds walks all five kinds, including nested slot ids.
    expect(takenIds(seededModel())).toEqual(
      new Set([
        "role-P",
        "G",
        "P",
        "A",
        "B",
        ...seededModel().placements.map((p) => p.id),
      ]),
    );
  });

  it("adding a slot keeps a nudged member's nudge and moves it by the merge rule's delta, asserted on the resolved offset", () => {
    const start = seededModel();
    const memberId = start.groups[0].members[4]; // repeat 1, slot A: its even angle moves when a fourth slot arrives
    const thetaOf = (p: Placement): number =>
      evalClosed((p.offset as { kind: "polar"; theta: Expr }).theta)!;
    const oldTheta = thetaOf(start.placements.find((p) => p.id === memberId)!);
    const dragged = applyDragToPlacement(start, memberId, {
      kind: "polar",
      r: num(26),
      theta: num(oldTheta + 7),
    });

    const result = addPatternSlot(dragged, "G", "role-P", parse, null)!;
    const survivor = result.model.placements.find((p) => p.id === memberId)!;
    expect(survivor.nudged).toBe(true);
    expect(result.report.deltaAppliedIds).toContain(memberId);

    // The new base for the same (repeatIndex 1, slot A) key, read off a fresh
    // expansion of the new group rather than hand-computed.
    const fresh = expandShapeGroup(result.model.groups[0]);
    const newBaseTheta = thetaOf(
      fresh.placements.find((p) => p.repeatIndex === 1 && p.id.endsWith("#A"))!,
    );
    expect(newBaseTheta).not.toBe(oldTheta); // the fixture can distinguish delta from reset
    expect(thetaOf(survivor)).toBeCloseTo(newBaseTheta + 7);
  });

  it("removing a slot releases rather than deletes a member that has a chained child (release condition 1)", () => {
    const start = seededModel();
    const memberId = start.groups[0].members[1]; // repeat 0, slot A
    const withChild = addStandalonePlacement(start, "role-P", memberId).model;
    const result = removePatternSlot(withChild, "G", "A", parse, null)!;
    expect(result.report.releasedIds).toContain(memberId);
    expect(result.report.deletedIds).not.toContain(memberId);
    expect(result.model.placements.some((p) => p.id === memberId)).toBe(true);
    expect(result.model.groups[0].members).not.toContain(memberId);
  });

  it("changing a slot's role re-dresses every member of that slot, a nudged one keeps its nudge and gets the new role too (composite slice 1)", () => {
    const start = seededModel();
    const memberIds = start.groups[0].members.filter((_, i) => i % 3 === 1); // slot A at every repeat
    const nudged = applyDragToPlacement(start, memberIds[1], {
      kind: "polar",
      r: num(40),
      theta: num(200),
    });
    // A symbolic nudge on another member, so the position-detached branch
    // is exercised too: it must still carry the new role.
    const symbolic = updatePlacement(nudged, memberIds[2], {
      nudged: true,
      offset: { kind: "polar", r: { k: "sym", name: "R_AUX" }, theta: num(0) },
    });
    const result = applyGroupEdit(
      symbolic,
      "G",
      {
        pattern: symbolic.groups[0].pattern.map((sl) =>
          sl.id === "A" ? { ...sl, role: "role-P" } : sl,
        ),
      },
      parse,
      null,
    )!;
    for (const id of memberIds) {
      expect(result.model.placements.find((p) => p.id === id)!.role).toBe(
        "role-P",
      );
    }
    // Slot P and B untouched.
    expect(
      result.model.placements.find((p) => p.id === start.groups[0].members[0])!
        .role,
    ).toBe("role-P");
    expect(
      result.model.placements.find((p) => p.id === start.groups[0].members[2])!
        .role,
    ).toBe("role-B");
    const kept = result.model.placements.find((p) => p.id === memberIds[1])!;
    expect(kept.nudged).toBe(true);
    expect(kept.offset).toEqual({ kind: "polar", r: num(40), theta: num(200) });
    expect(result.report.positionDetachedIds).toContain(memberIds[2]);
  });

  it("refuses to empty a pattern, returning null rather than a group with no slots", () => {
    const start = seededModel(
      group({ pattern: [{ id: "P", role: "role-P" }] }),
    );
    expect(removePatternSlot(start, "G", "P", parse, null)).toBeNull();
    expect(
      removePatternSlot(start, "no-such-group", "P", parse, null),
    ).toBeNull();
    expect(
      addPatternSlot(start, "no-such-group", "role-P", parse, null),
    ).toBeNull();
  });
});

describe("setRoleOverride / clearRoleOverride (role-attributes-escalation.md Sec.10 slice 3)", () => {
  const empty: AlpModel = {
    v: 1,
    placements: [],
    roles: [],
    randomParams: [],
    groups: [],
  };

  it("adds, replaces, and removes keys, dropping the map to undefined when the last one goes", () => {
    const { model: withPlacement, id } = addStandalonePlacement(
      empty,
      undefined,
    );
    const one = setRoleOverride(withPlacement, id, "baseSize", num(9));
    expect(one.placements[0].roleOverrides).toEqual({ baseSize: num(9) });
    const two = setRoleOverride(one, id, "circularBase", true);
    expect(two.placements[0].roleOverrides).toEqual({
      baseSize: num(9),
      circularBase: true,
    });
    const replaced = setRoleOverride(two, id, "baseSize", num(10));
    expect(replaced.placements[0].roleOverrides!.baseSize).toEqual(num(10));
    const cleared = clearRoleOverride(
      clearRoleOverride(replaced, id, "baseSize"),
      id,
      "circularBase",
    );
    expect(cleared.placements[0].roleOverrides).toBeUndefined();
  });
});

describe("random parameters (2026-09-22): a ring is random by default, rnd() materialises, delete refuses while referenced", () => {
  const empty: AlpModel = {
    v: 1,
    placements: [],
    roles: [],
    randomParams: [],
    groups: [],
  };

  it("addRing creates a ROTATION_<ring> param drawing rnd(0,359) and sets rotation to `param + 0`", () => {
    const { model, groupId } = addRing(empty, "role-P");
    expect(model.randomParams).toHaveLength(1);
    const p = model.randomParams[0];
    expect(p.label).toBe(`ROTATION_${groupId.toUpperCase()}`);
    expect([p.min, p.max, p.perPlayer]).toEqual([0, 359, false]);
    const g = model.groups[0];
    expect(g.rotation).toEqual({
      k: "bin",
      op: "+",
      l: { k: "param", id: p.id },
      r: num(0),
    });
    // The `+ 0` is what makes the rotation draggable: the inverter absorbs
    // a delta into it and leaves the draw alone.
    const inv = tryInvertFormulaCoordinate(g.rotation, 30);
    expect(inv.ok).toBe(true);
    if (inv.ok)
      expect(inv.expr).toEqual({
        k: "bin",
        op: "+",
        l: { k: "param", id: p.id },
        r: num(30),
      });
    // Every member's theta steers off the param.
    for (const m of g.members) {
      const theta = (
        model.placements.find((pl) => pl.id === m)!.offset as { theta: Expr }
      ).theta;
      expect(
        isParamReferenced(
          {
            ...empty,
            placements: [
              {
                id: "x",
                parent: "center",
                frame: "radial",
                label: "x",
                offset: { kind: "polar", r: num(0), theta },
              },
            ],
          },
          p.id,
        ),
      ).toBe(true);
    }
    // A second ring gets its own, distinct label and id.
    const two = addRing(model, "role-P").model;
    expect(new Set(two.randomParams.map((q) => q.id)).size).toBe(2);
    expect(new Set(two.randomParams.map((q) => q.label)).size).toBe(2);
  });

  it("materialiseRndParams turns each rnd(a,b) placeholder into a param labelled after the field, and returns the expr with its id", () => {
    const expr: Expr = {
      k: "bin",
      op: "+",
      l: { k: "param", id: "rnd(-5,5)@3" },
      r: { k: "bin", op: "*", l: num(2), r: { k: "param", id: "rnd(0,10)@9" } },
    };
    const { model, expr: out } = materialiseRndParams(
      empty,
      expr,
      "RING_1_ROTATION",
    );
    expect(model.randomParams.map((p) => [p.label, p.min, p.max])).toEqual([
      ["RING_1_ROTATION", -5, 5],
      ["RING_1_ROTATION_2", 0, 10],
    ]);
    const [a, b] = model.randomParams;
    expect(out).toEqual({
      k: "bin",
      op: "+",
      l: { k: "param", id: a.id },
      r: { k: "bin", op: "*", l: num(2), r: { k: "param", id: b.id } },
    });
    // No placeholder: nothing added, expr returned as is.
    const same = materialiseRndParams(model, num(4), "X");
    expect(same.model).toBe(model);
    expect(same.expr).toEqual(num(4));
  });

  it("deleteRandomParam refuses while a field references the param, anywhere in the model, and deletes once nothing does", () => {
    const { model, groupId } = addRing(empty, "role-P");
    const p = model.randomParams[0];
    expect(isParamReferenced(model, p.id)).toBe(true);
    expect(deleteRandomParam(model, p.id)).toBe(model);
    const unreferenced = applyGroupEdit(
      model,
      groupId,
      { rotation: num(15) },
      parseRms("", lang),
      null,
    )!.model;
    expect(isParamReferenced(unreferenced, p.id)).toBe(false);
    expect(deleteRandomParam(unreferenced, p.id).randomParams).toEqual([]);
    // A reference inside a role override or a chain template counts too.
    const inOverride = addStandalonePlacement(unreferenced, undefined).model;
    const withOv = setRoleOverride(
      inOverride,
      inOverride.placements.at(-1)!.id,
      "baseSize",
      { k: "param", id: p.id },
    );
    expect(isParamReferenced(withOv, p.id)).toBe(true);
  });
});

// The interim guard in land-placement-per-player-any-kind-escalation.md
// Sec.2 kept a per player shape on the kinds the prologue could place. Its
// slices widened it kind by kind, and slice C deleted it once every kind
// could be placed. These pin that applyGroupEdit now takes per player on
// every kind, from either direction.
describe("applyGroupEdit takes a per player shape of every kind", () => {
  const parse = parseRms("", lang);

  function modelWith(g: ShapeGroup): AlpModel {
    const { group: expanded, placements } = seed(g);
    return {
      v: 1,
      placements,
      roles: [],
      randomParams: [],
      groups: [expanded],
    };
  }
  const perPlayerCircle = () =>
    modelWith(group({ perPlayer: true, repeats: 8 }));
  const KINDS = ["arc", "line", "square", "triangle", "polygon"] as const;

  it.each(KINDS)("turns a per player circle into a %s", (kind) => {
    const result = applyGroupEdit(
      perPlayerCircle(),
      "G",
      { kind },
      parse,
      null,
    );
    expect(result?.model.groups[0].kind).toBe(kind);
    expect(result?.model.groups[0].perPlayer).toBe(true);
  });

  it.each(KINDS)("ticks per player on a %s", (kind) => {
    const shape = modelWith(group({ kind }));
    const ticked = applyGroupEdit(
      shape,
      "G",
      { perPlayer: true, repeats: 8 },
      parse,
      null,
    );
    expect(ticked?.model.groups[0].perPlayer).toBe(true);
    // Three slots at eight players.
    expect(ticked?.model.groups[0].members).toHaveLength(24);
  });

  // The one refusal about a kind that stays. Degrees have no reading on a
  // perimeter (doc 5.1), and the Shape select translates them first.
  it("still refuses a kind change that would leave degree jitter on a square", () => {
    const jittered = setGroupJitter(perPlayerCircle(), "G", "deg", 5);
    expect(
      applyGroupEdit(jittered, "G", { kind: "square" }, parse, null),
    ).toBeNull();
  });
});
