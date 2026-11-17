// Feature 3 of land-placement-constants-chains-drag-brief.md. A plain drag of
// an expanded chain copy edits its template, Ctrl moves just that copy.

import { describe, expect, it } from "vitest";
import { num } from "../compiler/expr";
import { expandShapeGroup } from "../expand";
import type { AlpModel } from "../fence";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import type { ChainTemplate, LandRole, ShapeGroup } from "../model";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { applyPlacementDrag, chainTemplateOf } from "../panel/modelOps";

const parse = parseRms("", loadLanguage());

function role(id: string): LandRole {
  return {
    id,
    label: id,
    terrain: { k: "name", name: "GRASS" },
    baseSize: num(7),
    baseElevation: num(0),
    extent: { kind: "percent", value: num(0) },
    zone: { kind: "none" },
    assign: id === "player" ? ASSIGN_TO_PLAYER_PER_REPEAT : { kind: "none" },
  };
}

function tpl(id: string, parent?: string, r = 14, theta = 0): ChainTemplate {
  return {
    id,
    role: "aux",
    label: id,
    frame: "radial",
    offset: { kind: "polar", r: num(r), theta: num(theta) },
    ...(parent !== undefined ? { parent } : {}),
  };
}

function build(chain: ChainTemplate[], repeats = 4): AlpModel {
  const g: ShapeGroup = {
    id: "ring",
    parent: "center",
    kind: "circle",
    pattern: [{ id: "P", role: "player", chain }],
    repeats,
    radius: num(26),
    rotation: num(0),
    frame: "radial",
    members: [],
    perPlayer: false,
  };
  const { placements, members, chainPlacements, chainMembers } =
    expandShapeGroup(g);
  return {
    v: 1,
    placements: [...placements, ...chainPlacements],
    roles: [role("player"), role("aux")],
    randomParams: [],
    constants: [],
    groups: [{ ...g, members, chainMembers }],
  };
}

const moved = { kind: "polar" as const, r: num(20), theta: num(40) };
const offsetOf = (m: AlpModel, id: string) =>
  m.placements.find((p) => p.id === id)!.offset;

describe("chainTemplateOf", () => {
  it("finds the template of a copy by position and nothing for other lands", () => {
    const m = build([tpl("G"), tpl("S", "G")]);
    expect(chainTemplateOf(m, "ring#2#P#S")).toEqual({
      groupId: "ring",
      slotId: "P",
      templateId: "S",
    });
    expect(chainTemplateOf(m, "ring#2#P")).toBeUndefined();
    expect(chainTemplateOf(m, "missing")).toBeUndefined();
  });
});

describe("applyPlacementDrag", () => {
  it("a plain drag of repeat 2's copy moves the template and every repeat", () => {
    const m = build([tpl("G")]);
    const next = applyPlacementDrag(m, "ring#2#P#G", moved, false, parse, null);
    for (let i = 0; i < 4; i++) {
      expect(offsetOf(next, `ring#${i}#P#G`)).toEqual(moved);
    }
    expect(next.groups[0].pattern[0].chain![0].offset).toEqual(moved);
    expect(
      next.placements.some((p) => p.id.includes("#G") && p.nudged === true),
    ).toBe(false);
  });

  it("Ctrl moves only that copy and sets nudged", () => {
    const m = build([tpl("G")]);
    const next = applyPlacementDrag(m, "ring#2#P#G", moved, true, parse, null);
    expect(offsetOf(next, "ring#2#P#G")).toEqual(moved);
    expect(offsetOf(next, "ring#1#P#G")).toEqual(tpl("G").offset);
    expect(next.placements.find((p) => p.id === "ring#2#P#G")!.nudged).toBe(
      true,
    );
    expect(next.groups[0].pattern[0].chain![0].offset).toEqual(tpl("G").offset);
  });

  it("a plain drag of a nudged copy clears its nudge, and other nudged copies keep theirs", () => {
    const m = build([tpl("G")]);
    const alone = { kind: "polar" as const, r: num(9), theta: num(9) };
    let next = applyPlacementDrag(m, "ring#2#P#G", alone, true, parse, null);
    next = applyPlacementDrag(next, "ring#3#P#G", alone, true, parse, null);
    next = applyPlacementDrag(next, "ring#2#P#G", moved, false, parse, null);
    const two = next.placements.find((p) => p.id === "ring#2#P#G")!;
    expect(two.nudged).toBeUndefined();
    expect(two.offset).toEqual(moved);
    const three = next.placements.find((p) => p.id === "ring#3#P#G")!;
    expect(three.nudged).toBe(true);
  });

  it("a grandchild drags its own template, not its parent's", () => {
    const m = build([tpl("G"), tpl("S", "G", 10, 90)], 2);
    const next = applyPlacementDrag(m, "ring#1#P#S", moved, false, parse, null);
    const chain = next.groups[0].pattern[0].chain!;
    expect(chain.find((t) => t.id === "S")!.offset).toEqual(moved);
    expect(chain.find((t) => t.id === "G")!.offset).toEqual(tpl("G").offset);
    expect(offsetOf(next, "ring#0#P#S")).toEqual(moved);
  });

  it("a ring member that is not a chain copy still gets nudged", () => {
    const m = build([tpl("G")]);
    const next = applyPlacementDrag(m, "ring#1#P", moved, false, parse, null);
    expect(next.placements.find((p) => p.id === "ring#1#P")!.nudged).toBe(true);
  });
});
