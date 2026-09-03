import { describe, expect, it } from "vitest";
import { evaluateExpressionTokens, roundForIntegerSlot } from "../generator/mathEval";

// Mirrors src/parser/__tests__/parser.test.ts's "math expressions (Sec.2.2)"
// block; that suite asserts the same scripts ASSEMBLE correctly; this one
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
    // (6, then the invalid "(5" operand is dropped, then +2 -> 8); that
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

  // MEASURED 2026-08-30 (RMSTEST_64, BUG-022), reversing the 2026-08-29 owner
  // decision that had followed the guide's main math text ("Dividing by 0
  // gives 0. Modulo 0 also gives 0.") instead of the Summer 2025 Update note
  // Sec.2.2 originally cited. The note was right: this is the pin for that
  // decision, so a future re-reversal has exactly one place to go.
  it("x % 0 -> the left operand, truncated toward zero (RMSTEST_64)", () => {
    expect(evaluateExpressionTokens(["(7", "%", "0)"], constants({}))).toBe(7);
    expect(evaluateExpressionTokens(["(-7.5", "%", "0)"], constants({}))).toBe(-7);
  });

  // The cast is the half RMSTEST_47 never exercised: every arm of that run used
  // integer operands, so it pinned the SIGN and left these free to be wrong.
  it("% casts BOTH operands to int before taking the remainder", () => {
    // JS's native % gives 2.7 / 2.1 here, the fractional part survives.
    expect(evaluateExpressionTokens(["(5.7", "%", "3)"], constants({}))).toBe(2);
    expect(evaluateExpressionTokens(["(5", "%", "2.9)"], constants({}))).toBe(1);
  });

  // The case the SIN macro rests on: `θ % 360` truncates θ, so R is an integer
  // for ANY input and `(R * 2 + 1) % 2` is always ±1. See
  // docs/land-placement-design.md Sec.5.4.
  it("a divisor larger than the dividend truncates: X % Y == (int)X when |Y| > |X|", () => {
    expect(evaluateExpressionTokens(["(51.43", "%", "360)"], constants({}))).toBe(51);
    expect(evaluateExpressionTokens(["(-51.43", "%", "360)"], constants({}))).toBe(-51);
  });

  // Reachable only because the cast happens FIRST: neither operand is zero.
  // RMSTEST_64 arm 7 (BAMBOO_TREE) cross-checked exactly this shape and is the
  // one arm whose four candidate readings landed on four different values,
  // which is why the observed 600 was decisive on its own.
  it("a divisor that truncates to zero is a modulo by zero", () => {
    expect(evaluateExpressionTokens(["(5.7", "%", "0.5)"], constants({}))).toBe(5);
  });

  // RMSTEST_47's three measured arms, kept as a regression pin: the cast must
  // not disturb the sign rule it was measured alongside.
  it("keeps RMSTEST_47's measured sign rule (sign of the dividend)", () => {
    expect(evaluateExpressionTokens(["(-7", "%", "2)"], constants({}))).toBe(-1);
    expect(evaluateExpressionTokens(["(7", "%", "-2)"], constants({}))).toBe(1);
    expect(evaluateExpressionTokens(["(-7", "%", "-2)"], constants({}))).toBe(-1);
  });

  // The old mod() reached `Infinity % 5`, which is NaN, a value
  // PROHIBITED_VALUE_KINDS forbids from crossing the tools boundary.
  it("never produces NaN from a non-finite dividend", () => {
    const result = evaluateExpressionTokens(["(inf", "%", "5)"], constants({}));
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(Infinity);
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
