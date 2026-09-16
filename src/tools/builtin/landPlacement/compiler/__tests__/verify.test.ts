// Sec.5.5's own philosophy pinned directly, plus the `paramCellValues` gap
// found building `paramEmit.ts` (Sec.4.4): `evaluateExpressionTokens`
// (mathEval.ts) makes `rnd(...)` unresolvable as an operand unconditionally,
// including as a whole-value single token, so a `#const NAME rnd(a,b)`
// cell's own value can never come from step 2's walk. Without a seeded
// value, that cell AND everything downstream of it silently resolve to
// `undefined` on both sides of step 4's equality check, which never
// disagrees, a false "verified" on a model that was never actually
// checked.

import { describe, expect, it } from "vitest";
import { bin, num, sym } from "../expr";
import { verifyEmission } from "../verify";

describe("verifyEmission — paramCellValues", () => {
  it("without a seeded value, a rnd() cell resolves to undefined and never trips a disagreement (the gap this pins)", () => {
    const emitted = [
      { name: "PARAM_X", text: "rnd(-2,2)", tokens: ["rnd(-2,2)"] },
      { name: "Y", text: "PARAM_X", tokens: ["PARAM_X"] },
    ];
    const result = verifyEmission(
      emitted,
      [{ name: "Y", source: sym("PARAM_X") }],
      new Map(),
    );
    expect(result.ok).toBe(true); // undefined === undefined, the false-positive this file's header describes
    expect(result.resolved.has("PARAM_X")).toBe(false);
    expect(result.resolved.has("Y")).toBe(false);
  });

  it("a seeded paramCellValues entry makes the cell — and everything downstream — resolve to a real number", () => {
    const emitted = [
      { name: "PARAM_X", text: "rnd(-2,2)", tokens: ["rnd(-2,2)"] },
      { name: "Y", text: "PARAM_X + 10", tokens: ["PARAM_X", "+", "10"] },
    ];
    const result = verifyEmission(
      emitted,
      [
        { name: "PARAM_X", source: sym("PARAM_X") },
        { name: "Y", source: bin("+", sym("PARAM_X"), num(10)) },
      ],
      new Map(),
      undefined,
      undefined,
      new Map([["PARAM_X", 0]]),
    );
    expect(result.ok).toBe(true);
    expect(result.resolved.get("PARAM_X")).toBe(0);
    expect(result.resolved.get("Y")).toBe(10);
  });

  it("seeding still catches a REAL disagreement downstream of the param — this isn't just laundering every failure through", () => {
    const emitted = [
      { name: "PARAM_X", text: "rnd(-2,2)", tokens: ["rnd(-2,2)"] },
      // A deliberately wrong emission: text says "* 2" but the target's own source says "+ 2".
      { name: "Y", text: "PARAM_X * 2", tokens: ["PARAM_X", "*", "2"] },
    ];
    const result = verifyEmission(
      emitted,
      [{ name: "Y", source: bin("+", sym("PARAM_X"), num(2)) }],
      new Map(),
      undefined,
      undefined,
      new Map([["PARAM_X", 1]]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { name: "Y", emittedValue: 2, directValue: 3 },
    ]);
  });

  it("only the named cells are seeded — an ordinary cell still goes through evaluateExpressionTokens", () => {
    const emitted = [
      { name: "PARAM_X", text: "rnd(-2,2)", tokens: ["rnd(-2,2)"] },
      { name: "PLAIN", text: "5", tokens: ["5"] },
    ];
    const result = verifyEmission(
      emitted,
      [],
      new Map(),
      undefined,
      undefined,
      new Map([["PARAM_X", -1]]),
    );
    expect(result.resolved.get("PARAM_X")).toBe(-1);
    expect(result.resolved.get("PLAIN")).toBe(5); // not seeded, resolved normally
  });
});
