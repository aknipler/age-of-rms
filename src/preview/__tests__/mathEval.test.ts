import { describe, expect, it } from "vitest";
import { evaluateExpressionTokens, roundForIntegerSlot } from "../generator/mathEval";

// Mirrors src/parser/__tests__/parser.test.ts's "math expressions (Sec.2.2)"
// block — that suite asserts the same scripts ASSEMBLE correctly; this one
// asserts what they EVALUATE to. Token arrays here are exactly how the
// parser splits each source string on whitespace (parser-design Sec.2.2),
// not something this test derives independently.

function constants(values: Record<string, number>): (name: string) => number | undefined {
  return (name) => values[name];
}

describe("evaluateExpressionTokens", () => {
  it("Vanguard fixture: (PL_FOREST_MAX_DIST + 1)", () => {
    const result = evaluateExpressionTokens(
      ["(PL_FOREST_MAX_DIST", "+", "1)"],
      constants({ PL_FOREST_MAX_DIST: 10 }),
    );
    expect(result).toBe(11);
  });

  it("AD4 fixture: (MAPSIZE * MAPSIZE), the #const value-position assembly path", () => {
    const result = evaluateExpressionTokens(["(MAPSIZE", "*", "MAPSIZE)"], constants({ MAPSIZE: 100 }));
    expect(result).toBe(10000);
  });

  it("numeric-first operand (Pa_Site lines 721-722 shape): (24 * SCALE)", () => {
    const result = evaluateExpressionTokens(["(24", "*", "SCALE)"], constants({ SCALE: 2 }));
    expect(result).toBe(48);
  });

  it("reproduces the guide's own worked example: (GOLD_COUNT + (5 + 2)) -> 8, dropping (5", () => {
    // The guide states the result (8) without stating GOLD_COUNT's value.
    // GOLD_COUNT=6 is chosen HERE because it reproduces 8 under this model
    // (6, then the invalid "(5" operand is dropped, then +2 -> 8) — that
    // match is a self-consistency check on the model, not a claim about
    // what the guide's own source script actually defined GOLD_COUNT as.
    const result = evaluateExpressionTokens(
      ["(GOLD_COUNT", "+", "(5", "+", "2))"],
      constants({ GOLD_COUNT: 6 }),
    );
    expect(result).toBe(8);
  });

  it("rnd(...) inside an expression is dropped like a nested paren: (A + rnd(1,5) + 2)", () => {
    const result = evaluateExpressionTokens(
      ["(A", "+", "rnd(1,5)", "+", "2)"],
      constants({ A: 10 }),
    );
    expect(result).toBe(12);
  });

  it("an unresolved constant mid-expression is dropped the same way: (5 + UNKNOWN)", () => {
    const result = evaluateExpressionTokens(["(5", "+", "UNKNOWN)"], constants({}));
    expect(result).toBe(5);
  });

  it("an unresolved FIRST operand makes the whole expression unresolvable: (UNKNOWN + 1)", () => {
    const result = evaluateExpressionTokens(["(UNKNOWN", "+", "1)"], constants({}));
    expect(result).toBeUndefined();
  });

  it("fully-glued operator, single token: (A+1) — not a number, not a known constant named 'A+1'", () => {
    const result = evaluateExpressionTokens(["(A+1)"], constants({ A: 1 }));
    expect(result).toBeUndefined();
  });

  it("unglued leading paren has no engine-verified reading, so it bails rather than guessing: ( A + 1 )", () => {
    // parser-design Sec.2.2 marks this shape unverified (verify #15) rather
    // than describing engine behaviour for it.
    const result = evaluateExpressionTokens(["(", "A", "+", "1)"], constants({ A: 1 }));
    expect(result).toBeUndefined();
  });

  it("divide by zero -> 0 (Sec.2.2)", () => {
    const result = evaluateExpressionTokens(["(5", "/", "0)"], constants({}));
    expect(result).toBe(0);
  });

  it("x % 0 -> left operand truncated toward zero (Sec.2.2, guide line 4550)", () => {
    expect(evaluateExpressionTokens(["(7", "%", "0)"], constants({}))).toBe(7);
    expect(evaluateExpressionTokens(["(-7.5", "%", "0)"], constants({}))).toBe(-7);
  });

  it("idiomatic flooring via -inf: (5.9 % -inf) -> 5", () => {
    const result = evaluateExpressionTokens(["(5.9", "%", "-inf)"], constants({}));
    expect(result).toBe(5);
  });

  it("the guide's negative idiom: (-5.9 % -inf + 10) -> 5, which only works under truncation", () => {
    const result = evaluateExpressionTokens(
      ["(-5.9", "%", "-inf", "+", "10)"],
      constants({}),
    );
    expect(result).toBe(5);
  });

  it("general % is truncation-toward-zero, not floor, for finite divisors", () => {
    // Truncation (-7/5 truncates to -1, remainder -7 - (-1*5) = -2) gives -2.
    // Floor-mod (floor(-7/5) = -2, remainder -7 - (-2*5) = 3) would give 3.
    expect(evaluateExpressionTokens(["(-7", "%", "5)"], constants({}))).toBe(-2);
  });

  it("floats flow through unrounded", () => {
    const result = evaluateExpressionTokens(["(1.5", "+", "1.5)"], constants({}));
    expect(result).toBe(3);
    const fractional = evaluateExpressionTokens(["(1.1", "+", "1)"], constants({}));
    expect(fractional).toBeCloseTo(2.1);
  });

  it("inf is a native value usable directly", () => {
    expect(evaluateExpressionTokens(["(inf", "-", "1)"], constants({}))).toBe(Infinity);
    expect(evaluateExpressionTokens(["(-inf", "+", "1)"], constants({}))).toBe(-Infinity);
  });

  it("strict left-to-right, no precedence: (2 + 3 * 4) is (2+3)*4, not 2+(3*4)", () => {
    const result = evaluateExpressionTokens(["(2", "+", "3", "*", "4)"], constants({}));
    expect(result).toBe(20); // NOT 14
  });

  it("a single-operand expression: (5)", () => {
    expect(evaluateExpressionTokens(["(5)"], constants({}))).toBe(5);
  });

  it("empty token list is unresolvable rather than defaulting to any number", () => {
    expect(evaluateExpressionTokens([], constants({}))).toBeUndefined();
  });
});

describe("roundForIntegerSlot", () => {
  it("rounds a half up", () => {
    expect(roundForIntegerSlot(2.5)).toBe(3);
  });

  it("rounds ordinary fractions to the nearer integer", () => {
    expect(roundForIntegerSlot(2.4)).toBe(2);
    expect(roundForIntegerSlot(2.6)).toBe(3);
  });

  it("passes integers through unchanged", () => {
    expect(roundForIntegerSlot(5)).toBe(5);
  });
});
