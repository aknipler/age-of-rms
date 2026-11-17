// Feature 2 of land-placement-constants-chains-drag-brief.md. A chain
// template may hang off another template of the same slot, to any depth, and
// every level repeats on every copy.

import { describe, expect, it } from "vitest";
import { num } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import { expandShapeGroup } from "../expand";
import type { AlpModel } from "../fence";
import { buildFenceEdits, readFenceModel } from "../fence";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import type { ChainTemplate, LandRole, ShapeGroup } from "../model";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import {
  addChainTemplate,
  addStandalonePlacement,
  applyDragToPlacement,
  applyGroupEdit,
  removeChainTemplate,
} from "../panel/modelOps";
import {
  buildPlacementTree,
  flattenPlacementTree,
  wouldCreateCycle,
} from "../panel/viewModel";

const lang = loadLanguage();
const parse = parseRms("", lang);

function role(id: string, zone: LandRole["zone"] = { kind: "none" }): LandRole {
  return {
    id,
    label: id,
    terrain: { k: "name", name: "GRASS" },
    baseSize: num(7),
    baseElevation: num(0),
    extent: { kind: "percent", value: num(0) },
    zone,
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

function ring(chain: ChainTemplate[], repeats: number, perPlayer = false) {
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
    perPlayer,
  };
  const { members, chainMembers } = expandShapeGroup(g);
  return { ...g, members, chainMembers };
}

function modelFor(group: ShapeGroup): AlpModel {
  const { placements, chainPlacements } = expandShapeGroup(group);
  return {
    v: 1,
    placements: [...placements, ...chainPlacements],
    roles: [role("player"), role("aux")],
    randomParams: [],
    constants: [],
    groups: [group],
  };
}

const gold = tpl("G");
const stone = tpl("S", "G", 10, 90);

describe("expansion of nested templates", () => {
  it("a two level template gets the right parents over 3 repeats", () => {
    const { chainPlacements } = expandShapeGroup(ring([gold, stone], 3));
    expect(chainPlacements.map((p) => p.id)).toEqual([
      "ring#0#P#G",
      "ring#0#P#S",
      "ring#1#P#G",
      "ring#1#P#S",
      "ring#2#P#G",
      "ring#2#P#S",
    ]);
    for (let i = 0; i < 3; i++) {
      const g = chainPlacements.find((p) => p.id === `ring#${i}#P#G`)!;
      const s = chainPlacements.find((p) => p.id === `ring#${i}#P#S`)!;
      expect(g.parent).toBe(`ring#${i}#P`);
      expect(s.parent).toBe(`ring#${i}#P#G`);
      expect(s.repeatIndex).toBe(i);
    }
  });

  it("throws when a parent is not earlier in the slot", () => {
    expect(() => expandShapeGroup(ring([stone, gold], 1))).toThrow(
      /not earlier/,
    );
  });

  it("re-expanding after a repeat count change keeps a nudged grandchild nudged", () => {
    const g = ring([gold, stone], 3);
    const nudged = applyDragToPlacement(modelFor(g), "ring#1#P#S", {
      kind: "polar",
      r: num(11),
      theta: num(95),
    });
    const bigger = applyGroupEdit(nudged, "ring", { repeats: 5 }, parse, null)!;
    const s = bigger.model.placements.find((p) => p.id === "ring#1#P#S")!;
    expect(s.nudged).toBe(true);
    expect(s.offset).toEqual({ kind: "polar", r: num(11), theta: num(95) });
    expect(s.parent).toBe("ring#1#P#G");
    const added = bigger.model.placements.find((p) => p.id === "ring#4#P#S")!;
    expect(added.parent).toBe("ring#4#P#G");
  });
});

describe("emission of a nested chain", () => {
  const model = modelFor(ring([gold, stone], 1));
  const result = emitAlpModel(model, new NameAllocator(), new Map(), 2);

  it("places the grandchild from its chained parent, not from the member", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const at = (id: string) => {
      const q = result.quantities.get(id)!;
      return [result.resolved.get(q.xName)!, result.resolved.get(q.yName)!];
    };
    const [mx, my] = at("ring#0#P");
    const [gx, gy] = at("ring#0#P#G");
    const [sx, sy] = at("ring#0#P#S");
    // r is a distance in percent of the map. The sine and cosine are the
    // engine's approximation, so allow half a percent.
    expect(Math.hypot(gx - mx, gy - my)).toBeCloseTo(14, 0);
    expect(Math.hypot(sx - gx, sy - gy)).toBeCloseTo(10, 0);
    expect(Math.hypot(sx - mx, sy - my)).not.toBeCloseTo(10, 0);
  });

  it("a grandchild of player 3's land gets that land's guard", () => {
    const m = emitAlpModel(
      modelFor(ring([gold, stone], 8, true)),
      new NameAllocator(),
      new Map(),
      4,
    );
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.createLandText.get("ring#2#P#S")!.split("\n")[0]).toBe(
      "if ALP_AT_LEAST_3",
    );
  });

  it("applies twice with zero edits on a depth 3 model", () => {
    const deep = [gold, stone, tpl("T", "S", 6, 45)];
    const m = modelFor(ring(deep, 2));
    const first = emitAlpModel(m, new NameAllocator(), new Map(), 2);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const text = buildFenceEdits(parse, m, first.body)[0].newText;
    const reparsed = parseRms(text, lang);
    const read = readFenceModel(reparsed)!;
    expect(read).toEqual(m);
    const second = emitAlpModel(
      read,
      new NameAllocator({
        reserved: reparsed.symbols
          .map((s) => s.name)
          .filter((n) => !n.startsWith("ALP_")),
      }),
      new Map(),
      2,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(buildFenceEdits(reparsed, read, second.body)).toEqual([]);
  });
});

describe("the tree", () => {
  const m = modelFor(ring([gold, stone], 2));

  it("nests a grandchild under its chained parent", () => {
    const rows = flattenPlacementTree(buildPlacementTree(m));
    const depthOf = (id: string) =>
      rows.find((r) => r.placement.id === id)!.depth;
    expect(depthOf("ring#0#P")).toBe(0);
    expect(depthOf("ring#0#P#G")).toBe(1);
    expect(depthOf("ring#0#P#S")).toBe(2);
  });

  it("refuses a standalone land parented to its own descendant through a chained copy", () => {
    const withLand = addStandalonePlacement(m, "aux", "ring#0#P#S").model;
    const landId = withLand.placements.find(
      (p) => p.parent === "ring#0#P#S",
    )!.id;
    // The land hangs off the grandchild. Making the first chained copy a
    // child of that land would close a loop.
    expect(wouldCreateCycle(withLand, "ring#0#P#G", landId)).toBe(true);
    expect(wouldCreateCycle(withLand, landId, "ring#0#P#S")).toBe(false);
  });
});

describe("panel operations on nested templates", () => {
  it("adds a nested template straight after the last one of its parent's subtree", () => {
    let model = modelFor(ring([gold, stone, tpl("H")], 2));
    model = addChainTemplate(
      model,
      "ring",
      "P",
      "aux",
      parse,
      null,
      "G",
    )!.model;
    const ids = model.groups[0].pattern[0].chain!.map((t) => t.id);
    expect(ids[0]).toBe("G");
    expect(ids[1]).toBe("S");
    // The new template follows S, the last of G's subtree, ahead of H.
    expect(ids[3]).toBe("H");
    const added = model.groups[0].pattern[0].chain![2];
    expect(added.parent).toBe("G");
    expect(model.groups[0].chainMembers).toHaveLength(8);
  });

  it("appends a top level template at the end as before", () => {
    const model = addChainTemplate(
      modelFor(ring([gold, stone], 1)),
      "ring",
      "P",
      "aux",
      parse,
      null,
    )!.model;
    const chain = model.groups[0].pattern[0].chain!;
    expect(chain[2].parent).toBeUndefined();
  });

  it("removing a template removes its whole subtree", () => {
    const deep = [gold, stone, tpl("T", "S", 6, 45), tpl("H")];
    const removed = removeChainTemplate(
      modelFor(ring(deep, 2)),
      "ring",
      "P",
      "G",
      parse,
      null,
    )!;
    expect(removed.model.groups[0].pattern[0].chain!.map((t) => t.id)).toEqual([
      "H",
    ]);
    expect(removed.report.deletedIds).toEqual(
      expect.arrayContaining(["ring#0#P#G", "ring#0#P#S", "ring#0#P#T"]),
    );
  });

  it("keeps a removed grandchild that has a hand made child, as an ordinary land", () => {
    let model = modelFor(ring([gold, stone], 1));
    model = addStandalonePlacement(model, "aux", "ring#0#P#S").model;
    const removed = removeChainTemplate(model, "ring", "P", "G", parse, null)!;
    expect(removed.report.releasedIds).toContain("ring#0#P#S");
    // The grandchild stays, and so does the parent it hangs off, since a
    // kept child still needs it.
    expect(removed.model.placements.some((p) => p.id === "ring#0#P#S")).toBe(
      true,
    );
  });
});
