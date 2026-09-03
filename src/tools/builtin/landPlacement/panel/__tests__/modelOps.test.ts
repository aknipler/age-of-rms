// slice-5-brief.md item 2's own acceptance: "dragging a member and then
// changing the ring's repeats re-applies the drag as a delta against the
// new base rather than discarding it, asserted through reExpand() on the
// model with no canvas involved. Assert the negative too: dragging a
// standalone placement leaves nudged unset."

import { describe, expect, it } from "vitest";
import { num } from "../../compiler/expr";
import { expandShapeGroup } from "../../expand";
import { parseRms } from "../../../../../parser/parser";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { reExpand } from "../../reExpand";
import type { Placement, ShapeGroup } from "../../model";
import { addStandalonePlacement, applyDragToPlacement, setThetaPerCountOverride } from "../modelOps";
import type { AlpModel } from "../../fence";

const lang = loadLanguage();
const noNames = () => [] as readonly string[];

function group(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
  return {
    id: "G",
    parent: "center",
    kind: "circle",
    pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }, { id: "B", role: "role-B" }],
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
    const originalR = (original.offset as { kind: "polar"; r: import("../../../../../../tools-api/index").Expr }).r;
    expect(originalR).toEqual(num(26)); // the group's own radius, un-nudged

    // Simulate a drag: the member moves to r=40 at its own theta (item 3's
    // snapping and dragMath.ts's own dragPolar are what would have produced
    // this in the real canvas path; this test starts from their output,
    // per the brief's own "no canvas involved").
    const draggedOffset: Placement["offset"] = { kind: "polar", r: num(40), theta: num(0) };
    const model: AlpModel = { v: 1, placements, roles: [], randomParams: [], groups: [oldGroup] };
    const afterDrag = applyDragToPlacement(model, memberId, draggedOffset);

    const draggedPlacement = afterDrag.placements.find((p) => p.id === memberId)!;
    expect(draggedPlacement.nudged).toBe(true);
    expect(draggedPlacement.offset).toEqual(draggedOffset);

    // Now change repeats 3 -> 4. Per Sec.4.5's merge rule, a nudged member's
    // offset re-applies as a DELTA against the new base, not a reset back to
    // the fresh expansion's own r=26.
    const newGroup: ShapeGroup = { ...oldGroup, repeats: 4 };
    const result = reExpand(oldGroup, newGroup, afterDrag.placements, parseRms("", lang), noNames);

    const survivor = result.placements.find((p) => p.id === memberId)!;
    expect(survivor.nudged).toBe(true);
    expect(result.report.deltaAppliedIds).toContain(memberId);
    // Delta = new base's own r (still 26, radius unchanged by a repeats
    // edit) + (draggedR 40 - oldBase's own r 26) = 40, the nudge preserved
    // exactly rather than snapping back to the un-nudged expansion.
    const survivorOffset = survivor.offset as { kind: "polar"; r: import("../../../../../../tools-api/index").Expr };
    expect(survivorOffset.kind).toBe("polar");
    expect(survivorOffset.r).toEqual(num(40));
  });

  it("dragging a standalone placement leaves nudged unset (the negative the brief pins directly)", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    expect(withPlacement.placements.find((p) => p.id === id)!.nudged).toBeUndefined();

    const dragged = applyDragToPlacement(withPlacement, id, { kind: "polar", r: num(55), theta: num(10) });
    const placement = dragged.placements.find((p) => p.id === id)!;
    expect(placement.offset).toEqual({ kind: "polar", r: num(55), theta: num(10) });
    expect(placement.nudged).toBeUndefined();
  });
});

// slice-c-brief.md item 1's own panel surface: setThetaPerCountOverride is
// the only mutation the per-count editor makes.
describe("setThetaPerCountOverride", () => {
  it("adds a first override, creating the map", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    const next = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    expect(next.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({ 2: num(30) });
  });

  it("adds a second override alongside an existing one without disturbing it", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const twice = setThetaPerCountOverride(once, id, 5, num(99));
    expect(twice.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({ 2: num(30), 5: num(99) });
  });

  it("overwrites an existing count's own override rather than adding a duplicate", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const replaced = setThetaPerCountOverride(once, id, 2, num(77));
    expect(replaced.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({ 2: num(77) });
  });

  it("removing the only override drops the map back to undefined, not an empty object", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    const once = setThetaPerCountOverride(withPlacement, id, 2, num(30));
    const removed = setThetaPerCountOverride(once, id, 2, undefined);
    expect(removed.placements.find((p) => p.id === id)!.thetaPerCount).toBeUndefined();
  });

  it("removing one of several overrides leaves the rest untouched", () => {
    const empty: AlpModel = { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
    const { model: withPlacement, id } = addStandalonePlacement(empty, undefined);
    const twice = setThetaPerCountOverride(setThetaPerCountOverride(withPlacement, id, 2, num(30)), id, 5, num(99));
    const removed = setThetaPerCountOverride(twice, id, 2, undefined);
    expect(removed.placements.find((p) => p.id === id)!.thetaPerCount).toEqual({ 5: num(99) });
  });
});
