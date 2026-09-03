// Sec.5.2: the front end. "The user writes maths the way maths is written",
// conventional precedence, not RMS's left-to-right. Checked by evaluating
// the parsed tree with real numbers and comparing to JS's own (conventional-
// precedence) evaluation of the same source, which is the property this
// parser exists to have.

import { describe, expect, it } from "vitest";
import { evalExpr } from "../expr";
import { parseFormula } from "../frontend";

// test-only oracle for conventional operator precedence
function evalConventional(source: string, vars: Record<string, number>): number {
  return new Function(...Object.keys(vars), `return (${source});`)(...Object.values(vars));
}

describe("parseFormula — Sec.5.2", () => {
  it("respects conventional precedence: a + b * c", () => {
    const r = parseFormula("a + b * c");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vars = { a: 2, b: 3, c: 4 };
    expect(evalExpr(r.expr, { resolveSym: (n) => vars[n as keyof typeof vars], resolveParam: () => undefined })).toBe(
      evalConventional("a + b * c", vars),
    );
  });

  it("respects explicit grouping: (a + b) * c", () => {
    const r = parseFormula("(a + b) * c");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vars = { a: 2, b: 3, c: 4 };
    expect(evalExpr(r.expr, { resolveSym: (n) => vars[n as keyof typeof vars], resolveParam: () => undefined })).toBe(
      evalConventional("(a + b) * c", vars),
    );
  });

  it("parses unary minus", () => {
    const r = parseFormula("-x + 5");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evalExpr(r.expr, { resolveSym: (n) => (n === "x" ? 3 : undefined), resolveParam: () => undefined })).toBe(2);
  });

  it("parses SIN/COS calls", () => {
    const r = parseFormula("SIN(theta) + COS(theta)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expr).toEqual({ k: "bin", op: "+", l: { k: "sin", e: { k: "sym", name: "theta" } }, r: { k: "cos", e: { k: "sym", name: "theta" } } });
  });

  it("parses rnd(a,b) as a param leaf, never inline as a bin operand type error", () => {
    const r = parseFormula("rnd(1,10)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expr.k).toBe("param");
  });

  it("parses rnd with a negative bound — Sec.4.4's own worked example, rnd(-180,180), found unparseable while building slice 5's formula field", () => {
    const r = parseFormula("rnd(-180,180)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expr.k).toBe("param");
    expect((r.expr as { id: string }).id).toContain("rnd(-180,180)");
  });

  it("parses rnd with BOTH bounds negative", () => {
    const r = parseFormula("rnd(-2,-1)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.expr as { id: string }).id).toContain("rnd(-2,-1)");
  });

  it("reports a parse error with a position, rather than throwing", () => {
    const r = parseFormula("a + ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(typeof r.error.position).toBe("number");
  });

  it("rejects an unknown function", () => {
    const r = parseFormula("TAN(x)");
    expect(r.ok).toBe(false);
  });
});
