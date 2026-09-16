// slice-4 brief item 2 acceptance: "a Bulls_Eyes-shaped model emits a body
// whose verifyEmission is ok; a model rigged to disagree emits nothing and
// names the node. The Sec.10.1 acceptance gate still passes unmodified. It
// is the regression test for this item and must not be edited to accommodate
// you."

import { describe, expect, it, vi } from "vitest";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { add, num, param, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import type { AlpModel } from "../fence";
import type { LandRole, Placement, ShapeGroup } from "../model";
import { checkP4, reservedNames } from "../preconditions";

type PolarOffset = {
  kind: "polar";
  r: import("../../../../../tools-api/index").Expr;
  theta: import("../../../../../tools-api/index").Expr;
};

const ROTATION_PLAYER = 4123;
const ROTATION_AUX = -47;
const VAR_A1 = 1;
const VAR_A2 = -2;
const VAR_A3 = 0;
const DIST_BW_PLAYERS = 150;
const RADIUS_PLAYER_LANDS = 26;
const RADIUS_AUX_LANDS = 14;

const SCRIPT_SYMBOLS = new Map<string, number>([
  ["ROTATION_PLAYER", ROTATION_PLAYER],
  ["ROTATION_AUX", ROTATION_AUX],
  ["VAR_A1", VAR_A1],
  ["VAR_A2", VAR_A2],
  ["VAR_A3", VAR_A3],
  ["DIST_BW_PLAYERS", DIST_BW_PLAYERS],
  ["RADIUS_PLAYER_LANDS", RADIUS_PLAYER_LANDS],
  ["RADIUS_AUX_LANDS", RADIUS_AUX_LANDS],
]);

/** Bulls_Eyes' 8 lands (acceptance.test.ts's own fixture, reused here, no roles, matching that the hand-written map's acceptance gate is unaffected by this orchestrator). */
function bullsEyesPlacements(): Placement[] {
  const player = (id: string, offset: PolarOffset): Placement => ({
    id,
    parent: "center",
    frame: "radial",
    label: id,
    offset,
  });
  const aux = (
    id: string,
    parent: string,
    baselineDelta: number,
    varName: string,
  ): Placement => ({
    id,
    parent,
    frame: "radial",
    label: id,
    offset: {
      kind: "polar",
      r: sym("RADIUS_AUX_LANDS"),
      theta:
        baselineDelta === 0
          ? add(sym("ROTATION_AUX"), sym(varName))
          : add(add(num(baselineDelta), sym("ROTATION_AUX")), sym(varName)),
    },
  });
  return [
    player("P1", {
      kind: "polar",
      r: sym("RADIUS_PLAYER_LANDS"),
      theta: sym("ROTATION_PLAYER"),
    }),
    aux("P1_A1", "P1", 0, "VAR_A1"),
    aux("P1_A2", "P1", -135, "VAR_A2"),
    aux("P1_A3", "P1", 135, "VAR_A3"),
    player("P2", {
      kind: "polar",
      r: sym("RADIUS_PLAYER_LANDS"),
      theta: add(sym("DIST_BW_PLAYERS"), sym("ROTATION_PLAYER")),
    }),
    aux("P2_A1", "P2", 0, "VAR_A1"),
    aux("P2_A2", "P2", -135, "VAR_A2"),
    aux("P2_A3", "P2", 135, "VAR_A3"),
  ];
}

function bullsEyesModel(): AlpModel {
  return {
    v: 1,
    placements: bullsEyesPlacements(),
    roles: [],
    randomParams: [],
    groups: [],
  };
}

describe("emitAlpModel — Bulls_Eyes-shaped model (acceptance)", () => {
  it("emits a body whose verifyEmission is ok, byte-identical to the hand-authored emission when the naming matches", () => {
    // Prefix "" to reproduce Sec.10.1's own naming-scoping override, not the
    // product default, purely so this test can compare against the same
    // 104-line shape acceptance.test.ts already pins byte-for-byte.
    const namer = new NameAllocator({ prefix: "" });
    const result = emitAlpModel(bullsEyesModel(), namer, SCRIPT_SYMBOLS, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.split("\n")).toHaveLength(104);
    for (const id of [
      "P1",
      "P1_A1",
      "P1_A2",
      "P1_A3",
      "P2",
      "P2_A1",
      "P2_A2",
      "P2_A3",
    ]) {
      expect(result.resolved.has(`X_${id}`)).toBe(true);
      expect(result.resolved.has(`Y_${id}`)).toBe(true);
    }
  });

  it("no create_land text for any placement — none of them carries a role", () => {
    const namer = new NameAllocator({ prefix: "" });
    const result = emitAlpModel(bullsEyesModel(), namer, SCRIPT_SYMBOLS, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createLandText.size).toBe(0);
  });
});

describe("emitAlpModel — roles (Sec.6.2)", () => {
  function role(over: Partial<LandRole> = {}): LandRole {
    return {
      id: "player",
      label: "Player",
      terrain: { k: "name", name: "DIRT" },
      baseSize: num(12),
      baseElevation: num(9),
      landPercent: num(8),
      zone: { kind: "perRepeat", base: 1, step: 1 },
      assignToPlayer: true,
      ...over,
    };
  }

  it("builds a create_land skeleton for a placement wearing a role, resolving the per-repeat zone and AT_PLAYER index", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "P1",
          parent: "center",
          frame: "radial",
          label: "P1",
          role: "player",
          repeatIndex: 0,
          offset: { kind: "polar", r: num(26), theta: num(0) },
        },
        {
          id: "P2",
          parent: "center",
          frame: "radial",
          label: "P2",
          role: "player",
          repeatIndex: 1,
          offset: { kind: "polar", r: num(26), theta: num(90) },
        },
      ],
      roles: [role()],
      randomParams: [],
      groups: [],
    };
    const namer = new NameAllocator();
    const result = emitAlpModel(model, namer, new Map(), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.createLandText.size).toBe(2);
    const p1Text = result.createLandText.get("P1")!;
    expect(p1Text).toContain("create_land");
    expect(p1Text).toContain("zone 1"); // base 1 + step 1 * repeatIndex 0
    expect(p1Text).toContain("assign_to AT_PLAYER 1"); // repeatIndex 0 -> player 1
    const p2Text = result.createLandText.get("P2")!;
    expect(p2Text).toContain("zone 2"); // base 1 + step 1 * repeatIndex 1
    expect(p2Text).toContain("assign_to AT_PLAYER 2");
  });

  it("a chain anchor with no role gets no create_land text", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "anchor",
          parent: "center",
          frame: "radial",
          label: "anchor",
          offset: { kind: "polar", r: num(0), theta: num(0) },
        },
      ],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createLandText.size).toBe(0);
  });

  it("throws when a placement references a role id absent from model.roles — a real invariant violation, not a user-facing case", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "P1",
          parent: "center",
          frame: "radial",
          label: "P1",
          role: "ghost",
          offset: { kind: "polar", r: num(1), theta: num(0) },
        },
      ],
      roles: [],
      randomParams: [],
      groups: [],
    };
    expect(() =>
      emitAlpModel(model, new NameAllocator(), new Map(), 2),
    ).toThrow(/ghost/);
  });
});

describe("emitAlpModel — defensive ShapeGroup fill (Sec.5 item 1)", () => {
  it("expands a group's members that model.placements is missing, without disturbing ones already present", () => {
    const group: ShapeGroup = {
      id: "G",
      parent: "center",
      kind: "circle",
      pattern: [
        { id: "P", role: "r1" },
        { id: "A", role: "r1" },
      ],
      repeats: 1,
      radius: num(20),
      rotation: num(0),
      frame: "radial",
      members: ["G#0#P", "G#0#A"],
      perPlayer: false,
    };
    const role: LandRole = {
      id: "r1",
      label: "R1",
      terrain: { k: "name", name: "GRASS" },
      baseSize: num(10),
      baseElevation: num(0),
      landPercent: num(0),
      zone: { kind: "none" },
      assignToPlayer: false,
    };
    // model.placements is EMPTY, neither member is present, exercising the
    // defensive fill path end to end.
    const model: AlpModel = {
      v: 1,
      placements: [],
      roles: [role],
      randomParams: [],
      groups: [group],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createLandText.size).toBe(2);
  });
});

describe("emitAlpModel — on disagreement, emits nothing and reports the offending node (Sec.5.5)", () => {
  it("propagates verifyEmission's failure verbatim: ok:false, no body, no createLandText", async () => {
    vi.resetModules();
    vi.doMock("../compiler/verify", () => ({
      verifyEmission: () => ({
        ok: false,
        resolved: new Map(),
        problems: [{ name: "ALP_X_P1", emittedValue: 10, directValue: 11 }],
      }),
    }));
    const { emitAlpModel: emitAlpModelMocked } = await import("../emitModel");
    const result = emitAlpModelMocked(
      bullsEyesModel(),
      new NameAllocator({ prefix: "" }),
      SCRIPT_SYMBOLS,
      2,
    );
    expect(result).toEqual({
      ok: false,
      problems: [{ name: "ALP_X_P1", emittedValue: 10, directValue: 11 }],
    });
    vi.doUnmock("../compiler/verify");
    vi.resetModules();
  });
});

describe("emitAlpModel — RandomParam hoisting (Sec.4.4), the gap named open since slice 4a/4b", () => {
  function role(over: Partial<LandRole> = {}): LandRole {
    return {
      id: "player",
      label: "Player",
      terrain: { k: "name", name: "GRASS" },
      baseSize: num(10),
      baseElevation: num(0),
      landPercent: num(5),
      zone: { kind: "none" },
      assignToPlayer: true,
      ...over,
    };
  }

  it("Sec.4.4's own worked example — ROTATION_AUX shared, VAR_A1 shared — hoists to two #const rnd(...) cells both A-lands reference", () => {
    const placements: Placement[] = [
      {
        id: "P1",
        parent: "center",
        frame: "radial",
        label: "P1",
        role: "player",
        repeatIndex: 0,
        offset: { kind: "polar", r: num(26), theta: num(0) },
      },
      {
        id: "P1_A1",
        parent: "P1",
        frame: "radial",
        label: "P1_A1",
        offset: {
          kind: "polar",
          r: num(14),
          theta: add(sym("ROTATION_AUX_SYM"), param("rot")),
        },
      },
      {
        id: "P2",
        parent: "center",
        frame: "radial",
        label: "P2",
        role: "player",
        repeatIndex: 1,
        offset: { kind: "polar", r: num(26), theta: num(180) },
      },
      {
        id: "P2_A1",
        parent: "P2",
        frame: "radial",
        label: "P2_A1",
        offset: {
          kind: "polar",
          r: num(14),
          theta: add(sym("ROTATION_AUX_SYM"), param("rot")),
        },
      },
    ];
    const model: AlpModel = {
      v: 1,
      placements,
      roles: [role()],
      randomParams: [
        {
          id: "rot",
          label: "ROTATION_AUX",
          min: -180,
          max: 180,
          perPlayer: false,
        },
      ],
      groups: [],
    };
    const namer = new NameAllocator({ prefix: "" });
    const result = emitAlpModel(
      model,
      namer,
      new Map([["ROTATION_AUX_SYM", 0]]),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one rnd() cell, referenced from both players' aux land.
    expect(result.body.match(/rnd\(-180,180\)/g)).toHaveLength(1);
    expect(result.body).toContain("#const PARAM_ROTATION_AUX rnd(-180,180)");
    expect(result.body).toContain("PARAM_ROTATION_AUX");
  });

  it("a perPlayer param resolves to a distinct name per owning player, and both players' emitted DEGREES cells reference their own", () => {
    const placements: Placement[] = [
      {
        id: "P1",
        parent: "center",
        frame: "radial",
        label: "P1",
        role: "player",
        repeatIndex: 0,
        offset: { kind: "polar", r: num(26), theta: param("jitter") },
      },
      {
        id: "P2",
        parent: "center",
        frame: "radial",
        label: "P2",
        role: "player",
        repeatIndex: 1,
        offset: { kind: "polar", r: num(26), theta: param("jitter") },
      },
    ];
    const model: AlpModel = {
      v: 1,
      placements,
      roles: [role()],
      randomParams: [
        { id: "jitter", label: "JITTER", min: -5, max: 5, perPlayer: true },
      ],
      groups: [],
    };
    const result = emitAlpModel(
      model,
      new NameAllocator({ prefix: "" }),
      new Map(),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("#const PARAM_JITTER_P1 rnd(-5,5)");
    expect(result.body).toContain("#const PARAM_JITTER_P2 rnd(-5,5)");
    expect(result.body).toContain("#const DEGREES_P1 PARAM_JITTER_P1");
    expect(result.body).toContain("#const DEGREES_P2 PARAM_JITTER_P2");
  });

  it("a perPlayer param referenced by a node with no player-owning ancestor fails emission — a model error, not a silent P1 fallback (Sec.4.4)", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "neutral",
          parent: "center",
          frame: "radial",
          label: "neutral",
          offset: { kind: "polar", r: num(10), theta: param("jitter") },
        },
      ],
      roles: [],
      randomParams: [
        { id: "jitter", label: "JITTER", min: -5, max: 5, perPlayer: true },
      ],
      groups: [],
    };
    const result = emitAlpModel(
      model,
      new NameAllocator({ prefix: "" }),
      new Map(),
      2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      {
        name: "placement:neutral:theta",
        emittedValue: undefined,
        directValue: undefined,
      },
    ]);
  });

  it("a perPlayer param referenced from a role field also fails emission — a role has no single owner (decided here, Sec.6.2)", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "P1",
          parent: "center",
          frame: "radial",
          label: "P1",
          role: "player",
          repeatIndex: 0,
          offset: { kind: "polar", r: num(10), theta: num(0) },
        },
      ],
      roles: [role({ baseSize: param("jitter") })],
      randomParams: [
        { id: "jitter", label: "JITTER", min: 5, max: 15, perPlayer: true },
      ],
      groups: [],
    };
    const result = emitAlpModel(
      model,
      new NameAllocator({ prefix: "" }),
      new Map(),
      2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      {
        name: "role:Player:baseSize",
        emittedValue: undefined,
        directValue: undefined,
      },
    ]);
  });

  it("a shared param referenced from a role field DOES resolve — no owner ambiguity for perPlayer:false", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "P1",
          parent: "center",
          frame: "radial",
          label: "P1",
          role: "player",
          repeatIndex: 0,
          offset: { kind: "polar", r: num(10), theta: num(0) },
        },
      ],
      roles: [role({ baseSize: param("sz") })],
      randomParams: [
        { id: "sz", label: "SIZE", min: 8, max: 12, perPlayer: false },
      ],
      groups: [],
    };
    const result = emitAlpModel(
      model,
      new NameAllocator({ prefix: "" }),
      new Map(),
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toContain("#const PARAM_SIZE rnd(8,12)");
    expect(result.body).toContain("#const ROLE_SIZE_PLAYER PARAM_SIZE");
  });

  it("an unknown param id also fails emission rather than crashing", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "solo",
          parent: "center",
          frame: "radial",
          label: "solo",
          offset: { kind: "polar", r: num(10), theta: param("ghost") },
        },
      ],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const result = emitAlpModel(
      model,
      new NameAllocator({ prefix: "" }),
      new Map(),
      2,
    );
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// per-player-escalation.md's own Sec.2 acceptance, end to end through
// emitAlpModel (buildPrologue's own unit tests live in prologue.test.ts):
// "A per-player ring of one slot emits 8 lands, a prologue of 8 branches,
// and 7 guards. The rendered fence has balanced if/endif at every player
// count, asserted by a test. emittedNames contains every ALP_AT_LEAST_* and
// ALP_DEG_* name. P4 reports no collision on a clean script, and still
// reports one when a name is genuinely taken."
// ---------------------------------------------------------------------------

describe("emitAlpModel — a per-player ring (Sec.2's own acceptance)", () => {
  const lang = loadLanguage();

  function perPlayerRole(): LandRole {
    return {
      id: "player",
      label: "Player",
      terrain: { k: "name", name: "GRASS" },
      baseSize: num(10),
      baseElevation: num(0),
      landPercent: num(5),
      zone: { kind: "none" },
      assignToPlayer: true,
    };
  }

  function perPlayerRing(): ShapeGroup {
    return {
      id: "ring",
      parent: "center",
      kind: "circle",
      pattern: [{ id: "P", role: "player" }],
      repeats: 8,
      radius: num(30),
      rotation: num(0),
      frame: "radial",
      members: Array.from({ length: 8 }, (_, i) => `ring#${i}#P`),
      perPlayer: true,
    };
  }

  function perPlayerModel(): AlpModel {
    return {
      v: 1,
      placements: [],
      roles: [perPlayerRole()],
      randomParams: [],
      groups: [perPlayerRing()],
    };
  }

  /** Balanced iff every opening `if` has exactly one closing `endif`. */
  function ifEndifCounts(text: string): {
    ifCount: number;
    endifCount: number;
  } {
    return {
      ifCount: (text.match(/^if /gm) ?? []).length,
      endifCount: (text.match(/^endif$/gm) ?? []).length,
    };
  }

  it("emits all 8 lands unconditionally in the body, one prologue of 8 branches, and exactly 7 guarded create_land skeletons", () => {
    const result = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.createLandText.size).toBe(8); // every player's land, regardless of the previewed count

    const bodyBalance = ifEndifCounts(result.body);
    expect(bodyBalance.ifCount).toBe(1);
    expect(bodyBalance.endifCount).toBe(1);
    expect(result.body.match(/^elseif /gm)).toHaveLength(7);

    let guardedCount = 0;
    for (const text of result.createLandText.values()) {
      const balance = ifEndifCounts(text);
      expect(balance.ifCount).toBe(balance.endifCount); // 0/0 (unguarded) or 1/1 (guarded), never unbalanced
      if (balance.ifCount === 1) guardedCount++;
    }
    expect(guardedCount).toBe(7);
  });

  it("emittedNames contains every ALP_AT_LEAST_* and ALP_DEG_* name", () => {
    const result = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let k = 2; k <= 8; k++)
      expect(result.emittedNames).toContain(`ALP_AT_LEAST_${k}`);
    for (let p = 1; p <= 8; p++)
      expect(result.emittedNames).toContain(`ALP_DEG_P${p}`);
  });

  it("resolved carries only the previewed count's own DEG values, never a later branch's", () => {
    const result = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.get("ALP_DEG_P1")).toBe(0);
    expect(result.resolved.get("ALP_DEG_P2")).toBe(120);
    expect(result.resolved.get("ALP_DEG_P3")).toBe(240);
    expect(result.resolved.has("ALP_DEG_P4")).toBe(false);
  });

  it("changing the previewed player count rearranges the resolved positions, never a fixed layout", () => {
    const at3 = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    const at5 = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      5,
    );
    expect(at3.ok && at5.ok).toBe(true);
    if (!at3.ok || !at5.ok) return;
    expect(at3.resolved.get("ALP_DEG_P2")).toBe(120);
    expect(at5.resolved.get("ALP_DEG_P2")).toBe(72);
  });

  it("P4 reports no collision on a clean script, and still reports one when a name is genuinely taken", () => {
    const cleanParse = parseRms("<LAND_GENERATION>\n", lang);
    const namer1 = new NameAllocator({
      reserved: reservedNames(cleanParse, lang),
    });
    const emission1 = emitAlpModel(perPlayerModel(), namer1, new Map(), 3);
    expect(emission1.ok).toBe(true);
    if (!emission1.ok) return;
    expect(checkP4(emission1.emittedNames, cleanParse, lang).ok).toBe(true);

    // A script that already defines one of the prologue's own names, checked
    // against an UNSEEDED allocator, the same "manufacture a real collision"
    // shape emitModel.test.ts's own P4 case above uses.
    const taken = emission1.emittedNames.find((n) =>
      n.startsWith("ALP_DEG_P"),
    )!;
    const dirtyParse = parseRms(`#const ${taken} 5\n<LAND_GENERATION>\n`, lang);
    const emission2 = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    expect(emission2.ok).toBe(true);
    if (!emission2.ok) return;
    expect(
      checkP4(emission2.emittedNames, dirtyParse, lang).collisions,
    ).toContain(taken);
  });

  it("a chained aux land is guarded by its parent's own ALP_AT_LEAST_k, not left unguarded (Sec.4.5 composition paragraph)", () => {
    // A role with no `assignToPlayer` (Bulls_Eyes' own aux lands are exactly
    // this shape): `buildLandAttachmentExpectations` requires `repeatIndex`
    // only when `assignToPlayer` is true, and this chained land has none.
    const auxRole: LandRole = {
      ...perPlayerRole(),
      id: "aux",
      label: "Aux",
      assignToPlayer: false,
    };
    const model: AlpModel = {
      ...perPlayerModel(),
      roles: [perPlayerRole(), auxRole],
      placements: [
        {
          id: "aux",
          parent: "ring#4#P", // repeat index 4 -> player 5
          frame: "radial",
          label: "aux",
          role: "aux",
          offset: { kind: "polar", r: num(8), theta: num(0) },
        },
      ],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const auxText = result.createLandText.get("aux")!;
    expect(auxText).toContain("if ALP_AT_LEAST_5");
    expect(auxText.trim().endsWith("endif")).toBe(true);
  });

  // per-player-escalation.md Sec.5, slice-b-brief.md item 2 (the whole
  // slice) and item 3 (perPlayer params emit at the max). Bulls_Eyes' own
  // `DEGREES_P2 = DIST_BW_PLAYERS + ROTATION_PLAYER` shape, rebuilt as a
  // per-player ring per the brief's own worked example.
  it("a member's authored theta, referencing a hoisted RandomParam, survives unchanged into every prologue branch it appears in — members with no rule keep the even default", () => {
    const authoredP2: Placement = {
      id: "ring#1#P", // player 2, exactly what expandShapeGroup itself would have produced except for theta
      parent: "center",
      frame: "radial",
      label: "ring_1_P",
      role: "player",
      repeatIndex: 1,
      offset: { kind: "polar", r: num(30), theta: param("dist") },
      nudged: true,
    };
    const model: AlpModel = {
      ...perPlayerModel(),
      randomParams: [
        {
          id: "dist",
          label: "DIST_BW_PLAYERS",
          min: 80,
          max: 280,
          perPlayer: false,
        },
      ],
      placements: [authoredP2],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.body
      .split("\n")
      .filter((l) => l.startsWith("#const ALP_DEG_P2 "));
    // Player 2 exists at every count 2 through 8 — 7 branches — and the SAME
    // rule (a reference to the hoisted param, never a count-dependent number)
    // in every one of them.
    expect(lines).toHaveLength(7);
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).toBe("#const ALP_DEG_P2 ALP_PARAM_DIST_BW_PLAYERS");

    // Untouched siblings still rearrange per count — item 2 must not turn the
    // whole ring rigid because one member has a rule.
    expect(result.body).toContain("#const ALP_DEG_P1 0"); // player 1, every branch
    const branch5 = result.body
      .split("elseif 5_PLAYER_GAME")[1]
      .split(/elseif|endif/)[0];
    expect(branch5).toContain("#const ALP_DEG_P3 144"); // even spacing at 5 players, player 3 (repeat index 2)

    // The hoisted rnd cell precedes the prologue that references it
    // (hazard 2), never the other way around.
    expect(
      result.body.indexOf("ALP_PARAM_DIST_BW_PLAYERS rnd(80,280)"),
    ).toBeLessThan(result.body.indexOf("#const ALP_DEG_P2 "));
  });

  it("a perPlayer RandomParam emits 8 draws regardless of the current player-count setting (Sec.5.4/item 3)", () => {
    const model: AlpModel = {
      ...perPlayerModel(),
      randomParams: [
        { id: "jitter", label: "JITTER", min: -2, max: 2, perPlayer: true },
      ],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 3); // previewed at 3, well under 8
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let p = 1; p <= 8; p++)
      expect(result.body).toContain(`#const ALP_PARAM_JITTER_P${p} rnd(-2,2)`);
  });

  // shape-kinds-slice-a-brief.md item 5: a perPlayer group's own member is
  // `polar` for line/arc exactly like circle, so without this refusal the
  // frame-algebra pass would silently draw the RING formula over a line or
  // arc's members — a plausible-looking wrong map, not an error.
  //
  // perimeter-symbolic-rotation-slice-a-brief.md item 3/Sec.8.7 finding 2:
  // now the ONLY guard for a perimeter kind too. `prologue.ts`'s own
  // `offset.kind !== "polar"` skip used to catch every perimeter member as
  // a second line of defence; since square/triangle/polygon are polar now
  // like everything else, it catches none of them, so this refusal alone
  // stands between a perPlayer square and silently-stamped ring angles.
  it.each(["line", "arc", "square"] as const)(
    "a perPlayer %s group fails emission with a problem, rather than drawing ring angles over it (now the only guard against it for a perimeter kind)",
    (kind) => {
      const model: AlpModel = {
        ...perPlayerModel(),
        groups: [{ ...perPlayerRing(), kind }],
      };
      const result = emitAlpModel(model, new NameAllocator(), new Map(), 3);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].name).toBe("group:ring:perPlayer");
      expect(result.problems[0].emittedValue).toBeUndefined();
      expect(result.problems[0].directValue).toBeUndefined();
    },
  );

  it("a perPlayer circle (this describe block's own fixture) still emits its prologue unchanged — the refusal is kind-specific, not a blanket regression", () => {
    const result = emitAlpModel(
      perPlayerModel(),
      new NameAllocator(),
      new Map(),
      3,
    );
    expect(result.ok).toBe(true);
  });
});

// Was "the perimeter kinds' symbolic-rotation refusal" (shape-kinds-slice-b
// and -c briefs). perimeter-symbolic-rotation-slice-a-brief.md item 3
// deletes that refusal outright: a perimeter member is an ordinary `polar`
// offset now (item 2, escalation Sec.8.3), so a symbolic rotation is just
// an additive Expr term the geometry never inspects, and there is nothing
// left to refuse. This block is inverted to prove the opposite: the
// emission SUCCEEDS and the rotation reference survives into the emitted
// DEGREES cells.
describe("emitAlpModel — a perimeter kind's rotation can be symbolic (perimeter-symbolic-rotation-slice-a-brief.md item 3)", () => {
  function perimeterRole(): LandRole {
    return {
      id: "player",
      label: "Player",
      terrain: { k: "name", name: "GRASS" },
      baseSize: num(10),
      baseElevation: num(0),
      landPercent: num(5),
      zone: { kind: "none" },
      assignToPlayer: false,
    };
  }

  function perimeterGroup(
    kind: "square" | "triangle" | "polygon",
    rotation: import("../../../../../tools-api/index").Expr,
  ): ShapeGroup {
    return {
      id: "sq",
      parent: "center",
      kind,
      pattern: [{ id: "P", role: "player" }],
      repeats: 4,
      radius: num(30),
      rotation,
      frame: "radial",
      members: Array.from({ length: 4 }, (_, i) => `sq#${i}#P`),
      perPlayer: false,
    };
  }

  function perimeterModel(
    kind: "square" | "triangle" | "polygon",
    rotation: import("../../../../../tools-api/index").Expr,
  ): AlpModel {
    return {
      v: 1,
      placements: [],
      roles: [perimeterRole()],
      randomParams: [],
      groups: [perimeterGroup(kind, rotation)],
    };
  }

  it.each(["square", "triangle", "polygon"] as const)(
    "a %s with a symbolic rotation emits ok, and its members' DEGREES cells reference it",
    (kind) => {
      const result = emitAlpModel(
        perimeterModel(kind, sym("ROTATION_PLAYER")),
        new NameAllocator(),
        SCRIPT_SYMBOLS,
        4,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The DEGREES cell's own line, not the trig macro's R cell (whose
      // formula also mentions the DEGREES name as its first operand).
      const degreesLines = result.body
        .split("\n")
        .filter((l) => l.startsWith("#const ALP_DEGREES_"));
      expect(degreesLines).toHaveLength(4); // one per member
      for (const line of degreesLines)
        expect(line).toContain("ROTATION_PLAYER");
    },
  );

  it("a square with a literal rotation still emits normally — the polar representation is unconditional, not a fallback for the symbolic case", () => {
    const result = emitAlpModel(
      perimeterModel("square", num(0)),
      new NameAllocator(),
      new Map(),
      4,
    );
    expect(result.ok).toBe(true);
  });

  it("a closed arithmetic rotation (not a bare literal, but resolvable with no symbol table) also emits normally", () => {
    const closedArithmetic = {
      k: "bin" as const,
      op: "+" as const,
      l: num(30),
      r: num(60),
    }; // 90, fully closed
    const result = emitAlpModel(
      perimeterModel("square", closedArithmetic),
      new NameAllocator(),
      new Map(),
      4,
    );
    expect(result.ok).toBe(true);
  });

  // Sec.8.4 point 1, a real output change this slice hands over for free: a
  // `radial` child of a `cartesian` parent used to fall back to a plain
  // world bearing (frame.ts's own header point 2, "no DEGREES of its own");
  // a perimeter member is `polar` now, so it has a real DEGREES cell and a
  // child chained to it composes off it exactly like a circle member's
  // child already does.
  it("a radial child chained to a perimeter member composes off its parent's DEGREES cell, not a plain world bearing", () => {
    const group = perimeterGroup("square", num(0));
    const child: Placement = {
      id: "child",
      parent: "sq#0#P", // member 0 of the square above
      frame: "radial",
      label: "child",
      offset: { kind: "polar", r: num(10), theta: num(45) },
    };
    const model: AlpModel = {
      v: 1,
      placements: [child],
      roles: [perimeterRole()],
      randomParams: [],
      groups: [group],
    };
    const result = emitAlpModel(model, new NameAllocator(), new Map(), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A composed radial child's DEGREES line is `parentDegrees + 180 +
    // theta` (frame.ts): it must reference the parent's own DEGREES name,
    // which a plain-world-bearing fallback (the pre-slice-A behaviour for a
    // cartesian parent) would never do.
    const parentDegreesName = result.quantities.get("sq#0#P")?.degreesName;
    expect(parentDegreesName).toBeDefined();
    const childDegreesLine = result.body
      .split("\n")
      .find((l) => l.startsWith("#const ALP_DEGREES_CHILD "));
    expect(childDegreesLine).toBeDefined();
    expect(childDegreesLine).toContain(parentDegreesName!);
  });
});
