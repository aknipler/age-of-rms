// Feature 1 of land-placement-constants-chains-drag-brief.md: panel constants
// live inside the fence, are read back, and are emitted ahead of every role.

import { describe, expect, it } from "vitest";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { num, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { describeConstantProblem, emitAlpModel } from "../emitModel";
import { buildFenceEdits, readFenceModel, type AlpModel } from "../fence";
import type { LandRole, PanelConstant, Placement } from "../model";

const lang = loadLanguage();

function role(baseSize = num(10)): LandRole {
  return {
    id: "r1",
    label: "Island",
    terrain: { k: "name", name: "GRASS" },
    baseSize,
    baseElevation: num(0),
    extent: { kind: "percent", value: num(0) },
    zone: { kind: "none" },
    assign: { kind: "none" },
  };
}

function place(): Placement {
  return {
    id: "p1",
    parent: "center",
    frame: "radial",
    label: "P1",
    role: "r1",
    offset: { kind: "polar", r: num(20), theta: num(30) },
  };
}

function model(
  constants: PanelConstant[],
  baseSize = num(10),
  placements: Placement[] = [place()],
): AlpModel {
  return {
    v: 1,
    placements,
    roles: [role(baseSize)],
    randomParams: [],
    constants,
    groups: [],
  };
}

const c = (id: string, name: string, value = num(1)): PanelConstant => ({
  id,
  name,
  value,
});

describe("panel constants, fence read upgrade", () => {
  it("a fence with no constants key reads back as constants []", () => {
    const m = model([]);
    const edit = buildFenceEdits(parseRms("", lang), m, "")[0].newText;
    const legacy = edit.replace(/"constants":\[\],?/, "");
    expect(legacy).not.toContain('"constants"');
    expect(readFenceModel(parseRms(legacy, lang))?.constants).toEqual([]);
  });

  it("constants round trip and the second Apply makes zero edits", () => {
    const m = model([c("c1", "ISLAND_SIZE", num(300))], sym("ISLAND_SIZE"));
    const result = emitAlpModel(m, new NameAllocator(), new Map(), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = buildFenceEdits(parseRms("", lang), m, result.body)[0].newText;
    const parsed = parseRms(text, lang);
    expect(readFenceModel(parsed)).toEqual(m);
    // Emit again from the model read back, against the parse that now holds
    // the fence's own constant, as the panel does.
    const again = emitAlpModel(
      readFenceModel(parsed)!,
      new NameAllocator({
        reserved: parsed.symbols
          .map((s) => s.name)
          .filter((n) => n !== "ISLAND_SIZE" && !n.startsWith("ALP_")),
      }),
      new Map(),
      2,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(buildFenceEdits(parsed, m, again.body)).toEqual([]);
  });
});

describe("panel constants, emission", () => {
  it("emits the constant before the role's lines and verifies", () => {
    const m = model([c("c1", "ISLAND_SIZE", num(300))], sym("ISLAND_SIZE"));
    const r = emitAlpModel(m, new NameAllocator(), new Map(), 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.body.split("\n");
    expect(lines[0]).toBe("#const ISLAND_SIZE 300");
    const roleLine = lines.findIndex((l) => l.endsWith(" ISLAND_SIZE"));
    expect(roleLine).toBeGreaterThan(0);
    expect(r.resolved.get("ISLAND_SIZE")).toBe(300);
  });

  it("an empty list emits the same body as before", () => {
    const withNone = emitAlpModel(model([]), new NameAllocator(), new Map(), 2);
    expect(withNone.ok).toBe(true);
    if (!withNone.ok) return;
    expect(withNone.body).not.toContain("ISLAND_SIZE");
    expect(withNone.body.split("\n")[0]).toMatch(/^#const ALP_/);
  });

  it("an earlier constant may feed a later one", () => {
    const m = model([
      c("c1", "A_SIZE", num(5)),
      c("c2", "B_SIZE", sym("A_SIZE")),
    ]);
    const r = emitAlpModel(m, new NameAllocator(), new Map(), 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved.get("B_SIZE")).toBe(5);
  });

  function refusal(m: AlpModel, reserved: string[] = []) {
    const r = emitAlpModel(m, new NameAllocator({ reserved }), new Map(), 2);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected a refusal");
    return r.problems.map((p) => describeConstantProblem(p.name));
  }

  it("refuses a name the script defines outside the fence", () => {
    const out = refusal(model([c("c1", "TAKEN")]), ["TAKEN"]);
    expect(out[0]?.id).toBe("c1");
    expect(out[0]?.text).toMatch(/script/);
  });

  it("refuses two constants with one name", () => {
    const out = refusal(model([c("c1", "X1"), c("c2", "X1")]));
    expect(out.map((o) => o?.id)).toEqual(["c2"]);
    expect(out[0]?.text).toMatch(/Another/);
  });

  it("refuses a value that uses itself or a later constant", () => {
    const out = refusal(
      model([c("c1", "FIRST", sym("SECOND")), c("c2", "SECOND")]),
    );
    expect(out.map((o) => o?.id)).toEqual(["c1"]);
    expect(out[0]?.text).toMatch(/above/);
  });

  it("refuses a value that uses a generated name", () => {
    // The role's own size constant is allocated as ALP_ROLE_BASE_SIZE_ISLAND.
    const ok = emitAlpModel(model([]), new NameAllocator(), new Map(), 2);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const generated = ok.emittedNames[0];
    const out = refusal(model([c("c1", "USES_GEN", sym(generated))]));
    expect(out[0]?.text).toMatch(/generates/);
  });
});

describe("CONST_NUM_PLAYERS", () => {
  it("is written as an if ladder with one constant per player count when a formula uses it", () => {
    const m = model([], sym("CONST_NUM_PLAYERS"));
    const r = emitAlpModel(m, new NameAllocator(), new Map(), 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.body.split("\n");
    expect(lines[0]).toBe("if 1_PLAYER_GAME");
    expect(lines[1]).toBe("#const CONST_NUM_PLAYERS 1");
    expect(lines[2]).toBe("elseif 2_PLAYER_GAME");
    expect(lines[16]).toBe("endif");
    expect(lines).toContain("#const CONST_NUM_PLAYERS 8");
    expect(r.resolved.get("CONST_NUM_PLAYERS")).toBe(4);
  });

  it("is left out when no formula names it", () => {
    const r = emitAlpModel(model([]), new NameAllocator(), new Map(), 4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).not.toContain("CONST_NUM_PLAYERS");
  });

  it("is left to the script when the script defines the name itself", () => {
    const m = model([], sym("CONST_NUM_PLAYERS"));
    const r = emitAlpModel(
      m,
      new NameAllocator({ reserved: ["CONST_NUM_PLAYERS"] }),
      new Map([["CONST_NUM_PLAYERS", 3]]),
      4,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).not.toContain("#const CONST_NUM_PLAYERS");
  });

  it("a panel constant may use it", () => {
    const m = model([c("c1", "DOUBLE", sym("CONST_NUM_PLAYERS"))]);
    const r = emitAlpModel(m, new NameAllocator(), new Map(), 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved.get("DOUBLE")).toBe(5);
  });
});
