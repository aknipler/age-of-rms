// docs/name-lookup-design.md slice D, Sec.4.3 and Sec.4.3.1: the names a
// formula field suggests, and the notice that lists every name the model uses
// that has no value, with the lines to set them.

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../../tools-api/index";
import { bin, num, param, sym } from "../../compiler/expr";
import { FORMULA_FUNCTIONS, parseFormula } from "../../compiler/frontend";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../../parser/parser";
import type { AlpModel } from "../../fence";
import {
  collectUnsetNames,
  describeUnsetNames,
  exprsIn,
  formulaNames,
  formulaRows,
  NO_PARAMS,
  unsetNameSnippet,
  type FormulaParamEnv,
} from "../formulaField";
import { addRole, addStandalonePlacement } from "../modelOps";
import { EMPTY_MODEL } from "../landPlacementModel";

const lang = loadLanguage();

// One name of each reason, plus one that resolves.
//   NOT_IN_SCRIPT  defined nowhere
//   DEF_ONLY       a #define, which has no number
//   COND_NAME      a #const only inside an if branch
//   NO_NUM         an unconditional #const whose value is not a number
//   RESOLVED       defined and valued
const SCRIPT = [
  "#define DEF_ONLY",
  "if TINY_MAP",
  "#const COND_NAME 5",
  "endif",
  "#const NO_NUM GRASS",
  "#const RESOLVED 7",
  "",
].join("\n");
const parse = parseRms(SCRIPT, lang);
const resolveSym = (name: string): number | undefined =>
  name === "RESOLVED" ? 7 : undefined;

/** A model whose formulas, spread over a role and a land, use every name above. */
function modelUsing(exprs: {
  baseSize: Expr;
  baseElevation: Expr;
  r: Expr;
  theta: Expr;
}): AlpModel {
  const { model: withRole, roleId } = addRole(EMPTY_MODEL);
  const { model: withLand, id } = addStandalonePlacement(withRole, roleId);
  return {
    ...withLand,
    roles: withLand.roles.map((r) => ({
      ...r,
      baseSize: exprs.baseSize,
      baseElevation: exprs.baseElevation,
    })),
    placements: withLand.placements.map((p) =>
      p.id === id
        ? { ...p, offset: { kind: "polar", r: exprs.r, theta: exprs.theta } }
        : p,
    ),
  };
}

const USING_ALL = modelUsing({
  baseSize: sym("NOT_IN_SCRIPT"),
  baseElevation: bin("+", sym("DEF_ONLY"), sym("RESOLVED")),
  r: bin("*", sym("COND_NAME"), num(2)),
  theta: bin("+", sym("NO_NUM"), sym("NOT_IN_SCRIPT")), // a repeat of the first
});

describe("collectUnsetNames", () => {
  it("lists one name of each reason, each once, in order of first use, and not the one that resolves", () => {
    const got = collectUnsetNames(
      USING_ALL,
      resolveSym,
      NO_PARAMS,
      parse.symbols,
    );
    // Placements come before roles in the model, so the land's names lead.
    expect(got).toEqual([
      { name: "COND_NAME", reason: "conditional" },
      { name: "NO_NUM", reason: "noNumber" },
      { name: "NOT_IN_SCRIPT", reason: "notInScript" },
      { name: "DEF_ONLY", reason: "defineOnly" },
    ]);
    expect(got.map((n) => n.name)).not.toContain("RESOLVED");
  });

  it("reports nothing once every name has a value", () => {
    expect(
      collectUnsetNames(USING_ALL, () => 1, NO_PARAMS, parse.symbols),
    ).toEqual([]);
  });

  it("never reports a random parameter's label", () => {
    const model = modelUsing({
      baseSize: sym("ROTATION_AUX"),
      baseElevation: num(0),
      r: num(1),
      theta: num(2),
    });
    const params: FormulaParamEnv = {
      ...NO_PARAMS,
      idByLabel: new Map([["ROTATION_AUX", "p1"]]),
    };
    expect(collectUnsetNames(model, resolveSym, params, parse.symbols)).toEqual(
      [],
    );
  });

  it("finds a name in a field nobody listed (a walk over the model, not a list of its fields)", () => {
    // `thetaPerCount` is a field the list of obvious ones would forget.
    const base = modelUsing({
      baseSize: num(1),
      baseElevation: num(0),
      r: num(1),
      theta: num(2),
    });
    const model: AlpModel = {
      ...base,
      placements: base.placements.map((p) => ({
        ...p,
        thetaPerCount: { 4: sym("ONLY_AT_FOUR") },
      })),
    };
    expect(
      collectUnsetNames(model, resolveSym, NO_PARAMS, parse.symbols).map(
        (n) => n.name,
      ),
    ).toEqual(["ONLY_AT_FOUR"]);
  });
});

describe("exprsIn", () => {
  it("stops at an Expr instead of entering it, and ignores a name Ref", () => {
    const found = exprsIn({
      terrain: { k: "name", name: "GRASS" },
      a: bin("+", num(1), sym("X")),
      list: [param("p1"), { deeper: { e: sym("Y") } }],
    });
    expect(found).toEqual([bin("+", num(1), sym("X")), param("p1"), sym("Y")]);
  });
});

describe("describeUnsetNames and unsetNameSnippet (Sec.4.3.1's table)", () => {
  const notes = describeUnsetNames(
    collectUnsetNames(USING_ALL, resolveSym, NO_PARAMS, parse.symbols),
    parse,
  );
  const byName = new Map(notes.map((n) => [n.name, n]));

  it("writes a line for a name defined nowhere and for a #define, and none for the other two", () => {
    expect(byName.get("NOT_IN_SCRIPT")?.line).toBe("#const NOT_IN_SCRIPT 0");
    expect(byName.get("DEF_ONLY")?.line).toBe("#const DEF_ONLY 0");
    // A header line for either of these would win as the first definition and
    // silently override the branch's own values.
    expect(byName.get("COND_NAME")?.line).toBeNull();
    expect(byName.get("NO_NUM")?.line).toBeNull();
  });

  it("says where each existing definition is", () => {
    expect(byName.get("DEF_ONLY")?.text).toBe(
      "DEF_ONLY is a #define on line 1, which has no number. Replace that line with this one.",
    );
    expect(byName.get("COND_NAME")?.text).toBe(
      "COND_NAME is only defined inside the branch on line 3. Define it on every path, or move this layout into that branch.",
    );
    expect(byName.get("NO_NUM")?.text).toBe(
      "NO_NUM is defined on line 5 but has no number at these settings.",
    );
  });

  it("joins only the lines that exist, in the order the names were used", () => {
    expect(unsetNameSnippet(notes)).toBe(
      "#const NOT_IN_SCRIPT 0\n#const DEF_ONLY 0",
    );
  });

  it("has no snippet when no name has a line", () => {
    expect(unsetNameSnippet(notes.filter((n) => n.line === null))).toBe("");
  });
});

describe("formulaNames", () => {
  it("lists the script names a formula uses and skips a bound label", () => {
    const params: FormulaParamEnv = {
      ...NO_PARAMS,
      idByLabel: new Map([["SPIN", "p1"]]),
    };
    expect(formulaNames("A + SPIN * B + A", params)).toEqual(["A", "B"]);
    expect(formulaNames("A +", params)).toEqual([]);
  });
});

describe("formulaRows (Sec.4.3)", () => {
  const sources = {
    emittedNames: ["ALP_RADIUS", "RADIUS_2"],
    paramLabels: ["ROTATION_A"],
    scriptRows: [{ name: "RADIUS", detail: "your #const, line 1" }],
  };

  it("ranks an exact match over a prefix over a name that merely contains the text", () => {
    expect(formulaRows("radius", sources).map((r) => r.name)).toEqual([
      "RADIUS",
      "RADIUS_2",
      "ALP_RADIUS",
    ]);
  });

  it("offers a random parameter's label and the formula functions", () => {
    expect(formulaRows("rot", sources).map((r) => r.name)).toEqual([
      "ROTATION_A",
    ]);
    expect(formulaRows("s", sources).map((r) => r.name)).toContain("SIN");
  });

  it("lists a name once, from the earliest source", () => {
    const rows = formulaRows("radius", {
      ...sources,
      emittedNames: ["RADIUS"],
    });
    expect(rows.filter((r) => r.name === "RADIUS")).toEqual([
      { name: "RADIUS", detail: "from this layout" },
    ]);
  });

  it("offers nothing for text that matches nothing", () => {
    expect(formulaRows("zzzz", sources)).toEqual([]);
  });
});

describe("FORMULA_FUNCTIONS", () => {
  it("is exactly what the parser accepts", () => {
    for (const name of FORMULA_FUNCTIONS) {
      const call = name === "rnd" ? "rnd(1,2)" : `${name}(1)`;
      expect(parseFormula(call).ok, call).toBe(true);
    }
    // The parser's own message names the supported set, so a function added
    // there and missed here shows up as a name this list lacks.
    const failed = parseFormula("NOPE(1)");
    expect(failed.ok).toBe(false);
    if (!failed.ok)
      for (const name of FORMULA_FUNCTIONS)
        expect(failed.error.message).toContain(name);
  });
});
