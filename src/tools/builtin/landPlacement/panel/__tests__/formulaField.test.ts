// Sec.8's formula field, pure half.

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../../tools-api/index";
import { bin, cosE, negE, num, param, sinE, sym } from "../../compiler/expr";
import { parseFormula } from "../../compiler/frontend";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../../parser/language";
import { parseRms } from "../../../../../parser/parser";
import { instantiateScript } from "../../../../../preview/generator/instantiate";
import { NameAllocator } from "../../compiler/naming";
import { emitAlpModel } from "../../emitModel";
import { addRing, addRole, applyGroupEdit } from "../modelOps";
import { EMPTY_MODEL } from "../landPlacementModel";
import {
  bindParamLabels,
  rndPlaceholder,
  type FormulaParamEnv,
  computeFormulaFeedback,
  describeUnknownName,
  exprToFormulaText,
  findUnknownNames,
} from "../formulaField";

describe("exprToFormulaText — round-trips through parseFormula", () => {
  function roundTrips(e: Expr) {
    const text = exprToFormulaText(e);
    const reparsed = parseFormula(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.expr).toEqual(e);
  }

  it("a bare number", () => roundTrips(num(5)));
  it("a bare symbol", () => roundTrips(sym("X_P1")));
  it("left-spine-shaped input needs no parens", () =>
    roundTrips(bin("-", bin("*", num(180), sym("S")), sym("R"))));
  it("a right-leaning input DOES need parens to round-trip, and gets them", () => {
    const e = bin("+", sym("X"), bin("*", sym("Y"), sym("Z")));
    expect(exprToFormulaText(e)).toBe("X + Y * Z"); // no parens needed here, * already binds tighter
    roundTrips(e);
  });
  it("a right operand of equal precedence under a non-associative-in-print op needs parens", () => {
    const e = bin("-", sym("A"), bin("-", sym("B"), sym("C"))); // A - (B - C), NOT (A - B) - C
    const text = exprToFormulaText(e);
    expect(text).toBe("A - (B - C)");
    roundTrips(e);
  });
  it("unary minus and SIN/COS both round-trip", () => {
    roundTrips(negE(sym("X")));
    roundTrips(sinE(bin("+", sym("X"), num(1))));
  });
});

describe("computeFormulaFeedback — parsing", () => {
  it("a plain number parses, evaluates, and emits as one line", () => {
    const fb = computeFormulaFeedback("42", "test", () => undefined);
    expect(fb.parse).toEqual({ ok: true });
    expect(fb.value).toBe(42);
    expect(fb.unsupportedReason).toBeNull();
    expect(fb.emittedLines).toEqual(["#const PREVIEW_TEST 42"]);
  });

  it("a parse error carries the position, and everything else is empty", () => {
    const fb = computeFormulaFeedback("1 + + 2", "test", () => undefined);
    expect(fb.parse.ok).toBe(false);
    if (fb.parse.ok) return;
    expect(fb.parse.error.position).toBeGreaterThanOrEqual(0);
    expect(fb.value).toBeUndefined();
    expect(fb.emittedLines).toEqual([]);
  });
});

describe("computeFormulaFeedback — evaluation, against the caller's own resolver", () => {
  it("resolves a bare identifier through resolveSym", () => {
    const fb = computeFormulaFeedback("RADIUS + 5", "test", (name) =>
      name === "RADIUS" ? 20 : undefined,
    );
    expect(fb.value).toBe(25);
  });

  it("an unresolvable identifier makes the whole value undefined, per evalExpr's own propagation", () => {
    const fb = computeFormulaFeedback("UNKNOWN + 5", "test", () => undefined);
    expect(fb.parse).toEqual({ ok: true });
    expect(fb.value).toBeUndefined();
  });

  it("conventional precedence: 2 + 3 * 4 is 14, not 20", () => {
    const fb = computeFormulaFeedback("2 + 3 * 4", "test", () => undefined);
    expect(fb.value).toBe(14);
  });

  it("SIN/COS evaluate via the Bhaskara reference macro, same as evalExpr elsewhere", () => {
    const fb = computeFormulaFeedback("SIN(90)", "test", () => undefined);
    expect(fb.value).toBeCloseTo(1, 1); // Bhaskara approximation, not exact trig, closeTo is the right bar
  });
});

describe("computeFormulaFeedback — rnd(...) and named RandomParams (2026-09-22, the scope cut lifted)", () => {
  const env: FormulaParamEnv = {
    labelOf: (id) => (id === "p1" ? "ROTATION_RING_1" : undefined),
    idByLabel: new Map([["ROTATION_RING_1", "p1"]]),
    previewOf: (id) => (id === "p1" ? 179.5 : undefined),
  };

  it("a bare rnd() previews at the midpoint of its bounds and emits as the text typed", () => {
    const fb = computeFormulaFeedback("rnd(-2,2)", "test", () => undefined);
    expect(fb.parse).toEqual({ ok: true });
    expect(fb.unsupportedReason).toBeNull();
    expect(fb.value).toBe(0);
    expect(fb.emittedLines).toEqual(["#const PREVIEW_TEST rnd(-2,2)"]);
  });

  it("a rnd() inside a larger expression previews through its midpoint", () => {
    const fb = computeFormulaFeedback(
      "10 + rnd(0,4) * 3",
      "test",
      () => undefined,
    );
    expect(fb.value).toBe(16);
  });

  it("a param LABEL binds to the param and previews at the param's own value; the emitted preview names it by label", () => {
    const fb = computeFormulaFeedback(
      "ROTATION_RING_1 + 45",
      "test",
      () => undefined,
      env,
    );
    expect(fb.value).toBe(224.5);
    expect(fb.emittedLines).toEqual([
      "#const PREVIEW_TEST (ROTATION_RING_1 + 45)",
    ]);
    expect(
      bindParamLabels(
        (parseFormula("ROTATION_RING_1 + 45") as { expr: Expr }).expr,
        env.idByLabel,
      ),
    ).toEqual({
      k: "bin",
      op: "+",
      l: { k: "param", id: "p1" },
      r: { k: "num", v: 45 },
    });
  });

  it("exprToFormulaText shows a param by label, and a placeholder as the rnd() it came from", () => {
    expect(exprToFormulaText({ k: "param", id: "p1" }, 0, env.labelOf)).toBe(
      "ROTATION_RING_1",
    );
    expect(
      exprToFormulaText({ k: "param", id: "rnd(0,359)@0" }, 0, env.labelOf),
    ).toBe("rnd(0,359)");
    expect(rndPlaceholder("rnd(-2.5,7)@12")).toEqual({ min: -2.5, max: 7 });
    expect(rndPlaceholder("p1")).toBeNull();
  });

  // The test above only prints a BARE param, which the printer got right
  // even while every nested one printed as its raw id. A new shape's
  // rotation is `param + 0`, so its Rotation field showed `param_3 + 0`.
  // Committing that text, even by clicking in and out, parsed `param_3` as
  // an unknown name and failed the whole model's emission, which blanked
  // the canvas. So every case here nests the param, and the check is the
  // field's own commit path of print, parse, bind.
  it.each<[string, Expr]>([
    ["a new ring's rotation, param + 0", bin("+", param("p1"), num(0))],
    ["the param on the right", bin("-", num(90), param("p1"))],
    ["under a unary minus", negE(param("p1"))],
    ["inside SIN", sinE(bin("+", param("p1"), num(1)))],
    ["inside COS", cosE(param("p1"))],
  ])("a nested param prints by label and binds back, %s", (_, e) => {
    const text = exprToFormulaText(e, 0, env.labelOf);
    expect(text).not.toContain("p1");
    const reparsed = parseFormula(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(bindParamLabels(reparsed.expr, env.idByLabel)).toEqual(e);
  });
});

describe("computeFormulaFeedback — emitted RMS text (Sec.8: 'makes the temp-count trade visible')", () => {
  it("input already left-spine shaped emits as ONE line", () => {
    const fb = computeFormulaFeedback("X * 2 - Y", "test", () => undefined);
    expect(fb.emittedLines).toEqual(["#const PREVIEW_TEST (X * 2 - Y)"]);
  });

  it("a right-leaning chain needing a hoist emits more than one line", () => {
    // Conventional precedence parses "X + Y * Z" as X + (Y*Z), a non-leaf
    // right operand under '+', which emit.ts's own rule hoists to a temp.
    const fb = computeFormulaFeedback("X + Y * Z", "test", () => undefined);
    expect(fb.emittedLines.length).toBeGreaterThan(1);
    expect(fb.emittedLines.at(-1)).toMatch(/^#const PREVIEW_TEST /);
  });

  it("SIN alone still pays the full macro's ten lines, plus the wrapping cell — trig.ts's own header: 'the two together cost ten lines', unconditionally, not five for whichever half is asked for", () => {
    const fb = computeFormulaFeedback("SIN(45)", "test", () => undefined);
    // R, S, P, D, SIN, CR, CS, CP, CD, COS, ten macro lines, every one of
    // them, even though only SIN's own result is referenced, plus the
    // wrapping PREVIEW cell.
    expect(fb.emittedLines.length).toBe(11);
    expect(fb.emittedLines.at(-1)).toMatch(/^#const PREVIEW_TEST /);
  });

  it("a non-leaf SIN argument hoists its own argument before the macro — no crash, no silent truncation", () => {
    const fb = computeFormulaFeedback("SIN(X + 10)", "test", () => undefined);
    expect(fb.parse).toEqual({ ok: true });
    expect(fb.unsupportedReason).toBeNull();
    // 1 (the hoisted argument) + 10 (the full macro) + 1 (the wrapper) = 12.
    expect(fb.emittedLines.length).toBe(12);
  });

  it("fieldSuffix threads into every emitted name, so two fields never collide when both are previewed", () => {
    const a = computeFormulaFeedback("SIN(45)", "radius_P1", () => undefined);
    const b = computeFormulaFeedback("SIN(45)", "radius_P2", () => undefined);
    expect(a.emittedLines.every((l) => l.includes("_RADIUS_P1"))).toBe(true);
    expect(b.emittedLines.every((l) => l.includes("_RADIUS_P2"))).toBe(true);
  });
});

// 2026-09-28: the warning under a formula box for a name with no value.
// Built from a real parse and the preview's real instantiation, the same
// two tables the panel hands in, so the fixture cannot disagree with what
// the parser actually records about branches.
describe("findUnknownNames — why a name has no value here", () => {
  const lang = loadLanguage();
  const source = [
    "#define LABEL",
    "#const TERR GRASS",
    "if NOT_A_REAL_LABEL",
    "#const ONLY_IN_BRANCH 40",
    "endif",
    "#const K 5",
    "<PLAYER_SETUP>",
    "direct_placement",
    "",
  ].join("\n");
  const parse = parseRms(source, lang);
  const symbols = instantiateScript(
    parse,
    buildLanguageIndex(lang),
    { playerCount: 8, mapSize: "Normal", teams: [] },
    1,
  ).symbols;
  const resolveSym = (name: string) => symbols.get(name);
  const env: FormulaParamEnv = {
    labelOf: (id) => (id === "p1" ? "ROTATION_RING_1" : undefined),
    idByLabel: new Map([["ROTATION_RING_1", "p1"]]),
    previewOf: () => 0,
  };

  it("sorts each unresolved name by what the script says about it", () => {
    expect(
      findUnknownNames(
        "K + ONLY_IN_BRANCH + TERR + LABEL + NOPE + ONLY_IN_BRANCH",
        resolveSym,
        env,
        parse.symbols,
      ),
    ).toEqual([
      { name: "ONLY_IN_BRANCH", reason: "conditional" },
      { name: "TERR", reason: "noNumber" },
      { name: "LABEL", reason: "defineOnly" },
      { name: "NOPE", reason: "notInScript" },
    ]);
  });

  it("never reports a resolved name or a random parameter's label", () => {
    expect(
      findUnknownNames(
        "K * 2 + ROTATION_RING_1",
        resolveSym,
        env,
        parse.symbols,
      ),
    ).toEqual([]);
  });

  it("stays quiet on text that does not parse, which already shows its error", () => {
    expect(
      findUnknownNames("1 + + NOPE", resolveSym, env, parse.symbols),
    ).toEqual([]);
  });

  it("each reason reads differently, and names the name", () => {
    const texts = (
      ["notInScript", "defineOnly", "conditional", "noNumber"] as const
    ).map((reason) => describeUnknownName({ name: "ABC", reason }));
    expect(new Set(texts).size).toBe(4);
    for (const t of texts) expect(t).toContain("ABC");
  });

  it("the warning's claim holds, a layout using an unknown name does not draw", () => {
    // The message says the preview cannot draw this layout. Checked against
    // the emitter, through applyGroupEdit, the path the Rotation box takes.
    // A first draft of this test wrote `rotation` straight onto the group,
    // which never re-expands the members, so their angles still read the
    // old draw and every case "emitted fine". That fixture could not fail,
    // and it briefly talked the message into a wrong, weaker wording.
    const lang = loadLanguage();
    const parse = parseRms("<PLAYER_SETUP>\ndirect_placement\n", lang);
    const { model: withRole, roleId } = addRole(EMPTY_MODEL);
    const { model, groupId } = addRing(withRole, roleId);
    const emits = (rotation: Expr) =>
      emitAlpModel(
        applyGroupEdit(model, groupId, { rotation }, parse, null)!.model,
        new NameAllocator(),
        new Map(),
        8,
      ).ok;
    expect(emits(num(0))).toBe(true); // the control
    expect(emits(sym("NOPE"))).toBe(false);
    expect(emits(bin("+", sym("NOPE"), num(45)))).toBe(false);
    expect(emits(bin("+", num(45), sym("NOPE")))).toBe(false);
  });
});
