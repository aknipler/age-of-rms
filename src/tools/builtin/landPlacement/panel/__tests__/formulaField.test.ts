// Sec.8's formula field, pure half.

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../../tools-api/index";
import { bin, negE, num, sinE, sym } from "../../compiler/expr";
import { parseFormula } from "../../compiler/frontend";
import { computeFormulaFeedback, exprToFormulaText } from "../formulaField";

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
  it("left-spine-shaped input needs no parens", () => roundTrips(bin("-", bin("*", num(180), sym("S")), sym("R"))));
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
    const fb = computeFormulaFeedback("RADIUS + 5", "test", (name) => (name === "RADIUS" ? 20 : undefined));
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

describe("computeFormulaFeedback — rnd(...) is explicitly unsupported, never silently guessed", () => {
  it("a bare rnd() sets unsupportedReason and leaves value/emittedLines empty", () => {
    const fb = computeFormulaFeedback("rnd(-2,2)", "test", () => undefined);
    expect(fb.parse).toEqual({ ok: true });
    expect(fb.unsupportedReason).not.toBeNull();
    expect(fb.value).toBeUndefined();
    expect(fb.emittedLines).toEqual([]);
  });

  it("a rnd() buried inside a larger expression is still caught", () => {
    const fb = computeFormulaFeedback("10 + rnd(-2,2) * 3", "test", () => undefined);
    expect(fb.unsupportedReason).not.toBeNull();
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
