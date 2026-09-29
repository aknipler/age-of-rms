// composite-pattern-escalation.md Sec.9 slice 2: chain templates (Q12). A
// `PatternSlot.chain` is authored once and expanded onto every member the
// slot produces; the children are ordinary Placements hung off their member
// through `parent`, so every emit-side mechanism (guards, owners, the frame
// algebra, the merge rule) is the one that already existed.

import { describe, expect, it } from "vitest";
import { num, param } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import {
  chainMemberKeyAt,
  chainPerRepeat,
  expandShapeGroup,
  memberIdFor,
} from "../expand";
import type { AlpModel } from "../fence";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import type { ChainTemplate, LandRole, ShapeGroup } from "../model";
import { reExpand } from "../reExpand";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import {
  addChainTemplate,
  addStandalonePlacement,
  applyDragToPlacement,
  applyGroupEdit,
  removeChainTemplate,
} from "../panel/modelOps";
import { shapeGroupLandTotal } from "../panel/viewModel";

const lang = loadLanguage();
const parse = parseRms("", lang);
const noNames = () => [] as readonly string[];
const NL = String.fromCharCode(10);

function playerRole(): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: num(12),
    baseElevation: num(9),
    extent: { kind: "percent", value: num(0) },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
  };
}

function auxRole(): LandRole {
  return {
    id: "aux",
    label: "Aux",
    terrain: { k: "name", name: "GRASS" },
    baseSize: num(7),
    baseElevation: num(9),
    extent: { kind: "percent", value: num(0) },
    zone: { kind: "perRepeat", base: 11, step: 11 },
    assign: { kind: "none" },
  };
}

/** Bulls_Eyes' cluster: three aux lands at 0 / -135 / +135 off a shared ROTATION_AUX, each with its own VAR_An, r = 14. */
function bullsEyesChain(): ChainTemplate[] {
  const theta = (base: number, v: string) => ({
    k: "bin" as const,
    op: "+" as const,
    l: { k: "bin" as const, op: "+" as const, l: num(base), r: param("rot") },
    r: param(v),
  });
  return [
    {
      id: "A1",
      role: "aux",
      label: "A1",
      frame: "radial",
      offset: { kind: "polar", r: num(14), theta: theta(0, "v1") },
    },
    {
      id: "A2",
      role: "aux",
      label: "A2",
      frame: "radial",
      offset: { kind: "polar", r: num(14), theta: theta(-135, "v2") },
    },
    {
      id: "A3",
      role: "aux",
      label: "A3",
      frame: "radial",
      offset: { kind: "polar", r: num(14), theta: theta(135, "v3") },
    },
  ];
}

function ring(
  chain: ChainTemplate[] | undefined,
  perPlayer = true,
  repeats = 8,
): ShapeGroup {
  const g: ShapeGroup = {
    id: "ring",
    parent: "center",
    kind: "circle",
    pattern: [{ id: "P", role: "player", ...(chain ? { chain } : {}) }],
    repeats,
    radius: num(26),
    rotation: num(0),
    frame: "radial",
    members: [],
    perPlayer,
  };
  const { members, chainMembers } = expandShapeGroup(g);
  return {
    ...g,
    members,
    ...(chainMembers.length > 0 ? { chainMembers } : {}),
  };
}

function modelFor(group: ShapeGroup): AlpModel {
  const { placements, chainPlacements } = expandShapeGroup(group);
  return {
    v: 1,
    placements: [...placements, ...chainPlacements],
    roles: [playerRole(), auxRole()],
    randomParams: [
      {
        id: "rot",
        label: "ROTATION_AUX",
        min: -180,
        max: 180,
        perPlayer: false,
      },
      { id: "v1", label: "VAR_A1", min: -10, max: 10, perPlayer: false },
      { id: "v2", label: "VAR_A2", min: -10, max: 10, perPlayer: false },
      { id: "v3", label: "VAR_A3", min: -10, max: 10, perPlayer: false },
    ],
    groups: [group],
  };
}

describe("expandShapeGroup — the second pass (Sec.5.2)", () => {
  it("a Bulls_Eyes-shaped per-player ring expands to 8 members and 24 chain children, each child copying its MEMBER's repeat index", () => {
    const g = ring(bullsEyesChain());
    const { placements, chainPlacements, chainMembers } = expandShapeGroup(g);
    expect(placements).toHaveLength(8);
    expect(chainPlacements).toHaveLength(24);
    expect(chainMembers).toEqual(chainPlacements.map((p) => p.id));
    for (let k = 0; k < chainPlacements.length; k++) {
      const key = chainMemberKeyAt(k, g.pattern);
      const child = chainPlacements[k];
      expect(child.parent).toBe(memberIdFor("ring", key.repeatIndex, "P"));
      expect(child.repeatIndex).toBe(key.repeatIndex);
      expect(child.role).toBe("aux");
      expect(child.frame).toBe("radial");
    }
    expect(chainMemberKeyAt(4, g.pattern)).toEqual({
      repeatIndex: 1,
      slotId: "P",
      templateId: "A2",
    });
    expect(chainPerRepeat(g.pattern)).toBe(3);
    expect(shapeGroupLandTotal(g)).toEqual({
      count: 32,
      points: 0,
      exact: false,
    });
  });

  it("a model with no templates is byte-identical: no chain members, no chainMembers key, members untouched", () => {
    const without = ring(undefined);
    expect(expandShapeGroup(without).chainPlacements).toEqual([]);
    expect("chainMembers" in without).toBe(false);
    const result = reExpand(
      without,
      { ...without, repeats: 8 },
      expandShapeGroup(without).placements,
      parse,
      noNames,
    );
    expect(result.chainMembers).toEqual([]);
    const edited = applyGroupEdit(
      modelFor(without),
      "ring",
      { radius: num(27) },
      parse,
      null,
    )!;
    expect("chainMembers" in edited.model.groups[0]).toBe(false);
    expect(JSON.stringify(edited.model.groups[0])).not.toContain("chain");
  });
});

describe("emitAlpModel — a Bulls_Eyes-shaped composite (Sec.9 slice 2's acceptance case)", () => {
  const result = emitAlpModel(
    modelFor(ring(bullsEyesChain())),
    new NameAllocator(),
    new Map(),
    2,
  );

  it("every chain child carries its parent's ALP_AT_LEAST_k guard, through computeGuardLabels' existing walk", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createLandText.size).toBe(32);
    for (let i = 0; i < 8; i++) {
      for (const t of ["A1", "A2", "A3"]) {
        const text = result.createLandText.get(`ring#${i}#P#${t}`)!;
        if (i === 0) expect(text.startsWith("create_land")).toBe(true);
        else expect(text.split(NL)[0]).toBe(`if ALP_AT_LEAST_${i + 1}`);
      }
    }
  });

  it("the aux zones resolve 11 through 88 under perRepeat base 11 step 11, with no code that knows about chains", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 0; i < 8; i++) {
      const text = result.createLandText.get(`ring#${i}#P#A1`)!;
      expect(text.split(NL)).toContain(`zone ${11 * (i + 1)}`);
    }
  });

  it("player 1's first child's DEGREES cell is Sec.4.2's shape: the parent's DEGREES + 180 + theta", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.body
      .split(NL)
      .find((l) => l.startsWith("#const ALP_DEGREES_RING_0_P_A1 "));
    expect(line).toBe(
      "#const ALP_DEGREES_RING_0_P_A1 (ALP_DEGREES_RING_0_P + 180 + ALP_PARAM_ROTATION_AUX + ALP_PARAM_VAR_A1)",
    );
  });

  it("breaking one child's parent link drops its guard (the mutation that proves the walk is what guards it)", () => {
    const model = modelFor(ring(bullsEyesChain()));
    const broken: AlpModel = {
      ...model,
      placements: model.placements.map((p) =>
        p.id === "ring#3#P#A2" ? { ...p, parent: "center" } : p,
      ),
    };
    const r = emitAlpModel(broken, new NameAllocator(), new Map(), 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.createLandText.get("ring#3#P#A2")!.startsWith("create_land")).toBe(
      true,
    );
    expect(r.createLandText.get("ring#3#P#A1")!.split(NL)[0]).toBe(
      "if ALP_AT_LEAST_4",
    );
  });

  it("a fixed-count group with templates emits no prologue and no guards: one mechanism serves both cases", () => {
    const fixed = ring(bullsEyesChain(), false, 3);
    const r = emitAlpModel(modelFor(fixed), new NameAllocator(), new Map(), 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.createLandText.size).toBe(12);
    expect(r.body).not.toContain("ALP_AT_LEAST");
    for (const text of r.createLandText.values())
      expect(text.startsWith("create_land")).toBe(true);
  });
});

describe("reExpand — the chain pass (Sec.5.4, Sec.5.2 rev 1)", () => {
  it("a nudged chain child with a symbolic offset (Bulls_Eyes' own shape) is never rewritten and is reported position-detached", () => {
    const g = ring(bullsEyesChain(), false, 2);
    const model = modelFor(g);
    const childId = "ring#1#P#A2";
    // Symbolic already (ROTATION_AUX + VAR_A2); a drag on a symbolic child
    // marks it nudged with whatever the canvas produced, and the merge
    // rule's exclusion is on the STORED offset's literal-ness.
    const nudged = applyDragToPlacement(model, childId, {
      kind: "polar",
      r: num(14),
      theta: { k: "bin", op: "+", l: num(5), r: param("rot") },
    });
    expect(nudged.placements.find((p) => p.id === childId)!.nudged).toBe(true);
    const moved = applyGroupEdit(
      nudged,
      "ring",
      {
        pattern: [
          {
            ...g.pattern[0],
            chain: bullsEyesChain().map((t) => ({
              ...t,
              offset: { ...t.offset, r: num(20) } as ChainTemplate["offset"],
            })),
          },
        ],
      },
      parse,
      null,
    )!;
    expect(moved.report.positionDetachedIds).toContain(childId);
    expect(moved.report.recomputedIds).toContain("ring#1#P#A1");
    const kept = moved.model.placements.find((p) => p.id === childId)!;
    expect(kept.offset).toEqual({
      kind: "polar",
      r: num(14),
      theta: { k: "bin", op: "+", l: num(5), r: param("rot") },
    });
    // An un-nudged sibling followed the template wholesale.
    const sibling = moved.model.placements.find((p) => p.id === "ring#1#P#A1")!;
    expect((sibling.offset as { r: unknown }).r).toEqual(num(20));
  });

  it("a numeric nudge on a chain child re-applies as a delta against the new template offset", () => {
    const plain: ChainTemplate[] = [
      {
        id: "A",
        role: "aux",
        label: "A",
        frame: "radial",
        offset: { kind: "polar", r: num(14), theta: num(0) },
      },
    ];
    const g = ring(plain, false, 2);
    const model = modelFor(g);
    const nudged = applyDragToPlacement(model, "ring#0#P#A", {
      kind: "polar",
      r: num(17),
      theta: num(4),
    });
    const moved = applyGroupEdit(
      nudged,
      "ring",
      {
        pattern: [
          {
            ...g.pattern[0],
            chain: [
              {
                ...plain[0],
                offset: { kind: "polar", r: num(20), theta: num(10) },
              },
            ],
          },
        ],
      },
      parse,
      null,
    )!;
    expect(moved.report.deltaAppliedIds).toContain("ring#0#P#A");
    expect(
      moved.model.placements.find((p) => p.id === "ring#0#P#A")!.offset,
    ).toEqual({ kind: "polar", r: num(23), theta: num(14) });
    expect(
      moved.model.placements.find((p) => p.id === "ring#1#P#A")!.offset,
    ).toEqual({ kind: "polar", r: num(20), theta: num(10) });
  });

  it("5 -> 3 -> 5 with a template: the re-added members are renamed, and their chain children hang off the RENAMED members, not the released originals", () => {
    const plain: ChainTemplate[] = [
      {
        id: "A",
        role: "aux",
        label: "A",
        frame: "radial",
        offset: { kind: "polar", r: num(14), theta: num(0) },
      },
    ];
    const five = ring(plain, false, 5);
    let model = modelFor(five);
    // Give members 3 and 4 a hand-made child each, so the shrink RELEASES
    // them (condition 1) and they stay in the document holding the
    // deterministic ids `ring#3#P` / `ring#4#P`.
    model = addStandalonePlacement(model, "aux", "ring#3#P").model;
    model = addStandalonePlacement(model, "aux", "ring#4#P").model;
    const three = applyGroupEdit(model, "ring", { repeats: 3 }, parse, null)!;
    expect(three.report.releasedIds).toEqual(
      expect.arrayContaining(["ring#3#P", "ring#4#P"]),
    );
    // Their templated children had no reason to stay and were deleted, children first.
    expect(three.report.deletedIds).toEqual(
      expect.arrayContaining(["ring#3#P#A", "ring#4#P#A"]),
    );
    expect(three.model.groups[0].chainMembers).toHaveLength(3);

    const backToFive = applyGroupEdit(
      three.model,
      "ring",
      { repeats: 5 },
      parse,
      null,
    )!;
    const members = backToFive.model.groups[0].members;
    expect(members).toHaveLength(5);
    // The two re-added members could not take `ring#3#P` / `ring#4#P`, still held by the released pair.
    expect(members[3]).not.toBe("ring#3#P");
    expect(members[4]).not.toBe("ring#4#P");
    const chain = backToFive.model.groups[0].chainMembers!;
    expect(chain).toHaveLength(5);
    const byId = new Map(
      backToFive.model.placements.map((p) => [p.id, p] as const),
    );
    // Every chain child's parent is ITS member's actual id, positionally.
    for (let k = 0; k < chain.length; k++) {
      expect(byId.get(chain[k])!.parent).toBe(members[k]);
    }
    // And in particular not the released placements (which still exist).
    expect(byId.has("ring#3#P")).toBe(true);
    expect(byId.get(chain[3])!.parent).not.toBe("ring#3#P");
  });

  it("removing a template releases rather than deletes a child that has a hand-made child of its own", () => {
    const plain: ChainTemplate[] = [
      {
        id: "A",
        role: "aux",
        label: "A",
        frame: "radial",
        offset: { kind: "polar", r: num(14), theta: num(0) },
      },
    ];
    const g = ring(plain, false, 2);
    let model = modelFor(g);
    model = addStandalonePlacement(model, "aux", "ring#1#P#A").model;
    const removed = removeChainTemplate(model, "ring", "P", "A", parse, null)!;
    expect(removed.report.releasedIds).toEqual(["ring#1#P#A"]);
    expect(removed.report.deletedIds).toEqual(["ring#0#P#A"]);
    expect("chainMembers" in removed.model.groups[0]).toBe(false);
    expect("chain" in removed.model.groups[0].pattern[0]).toBe(false);
  });

  it("addChainTemplate allocates a fresh id and expands one child per member", () => {
    const g = ring(undefined, false, 4);
    const added = addChainTemplate(
      modelFor(g),
      "ring",
      "P",
      "aux",
      parse,
      null,
    )!;
    expect(added.model.groups[0].pattern[0].chain).toHaveLength(1);
    expect(added.model.groups[0].chainMembers).toHaveLength(4);
    expect(added.report.addedIds).toHaveLength(4);
    const child = added.model.placements.find(
      (p) => p.id === added.model.groups[0].chainMembers![2],
    )!;
    expect(child.parent).toBe("ring#2#P");
    expect(child.repeatIndex).toBe(2);
    expect(child.role).toBe("aux");
    // Members untouched by adding a template: recomputed, not re-added.
    expect(added.model.groups[0].members).toEqual(g.members);
  });
});
