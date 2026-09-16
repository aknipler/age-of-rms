// Sec.10.2: property tests on the compiler, checked against Sec.5.5's own
// oracle (evaluateExpressionTokens). Plus the worked examples Sec.5.3 states
// by name, pinned directly.

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../../tools-api/index";
import { evaluateExpressionTokens } from "../../../../../preview/generator/mathEval";
import { bin, evalExpr, mul, negE, num, sub, sym } from "../expr";
import { emitCells, formatConstLine } from "../emit";
import { NameAllocator } from "../naming";

function compileOne(
  name: string,
  expr: Expr,
  symbols: Record<string, number> = {},
) {
  const namer = new NameAllocator({ prefix: "" });
  const emitted = emitCells([{ name, expr }], namer);
  const resolved = new Map<string, number>(Object.entries(symbols));
  for (const cell of emitted) {
    const v = evaluateExpressionTokens(cell.tokens, (n) => resolved.get(n));
    if (v !== undefined) resolved.set(cell.name, v);
  }
  return { emitted, resolved };
}

describe("emitCells — Sec.5.3 worked examples", () => {
  it("emits input already in RMS left-spine form as ONE line", () => {
    // 180 * S - R * R, entered pre-associated: ((180*S) - R) * R
    const e = mul(sub(mul(num(180), sym("S")), sym("R")), sym("R"));
    const { emitted } = compileOne("P", e);
    expect(emitted.map(formatConstLine)).toEqual([
      "#const P (180 * S - R * R)",
    ]);
  });

  it("hoists a non-leaf right operand: 180*S - R*R meaning (180*S)-(R*R)", () => {
    const e = sub(mul(num(180), sym("S")), mul(sym("R"), sym("R")));
    const { emitted } = compileOne("P", e);
    expect(emitted).toHaveLength(2);
    expect(emitted[0].name).toBe("TMP_1");
    expect(formatConstLine(emitted[0])).toBe("#const TMP_1 (R * R)");
    expect(formatConstLine(emitted[1])).toBe("#const P (180 * S - TMP_1)");
  });

  it("re-associates a + (b + c) onto the left spine", () => {
    const e = bin("+", sym("A"), bin("+", sym("B"), sym("C")));
    const { emitted } = compileOne("SUM", e);
    expect(emitted.map(formatConstLine)).toEqual(["#const SUM (A + B + C)"]);
  });

  it("folds adjacent integer literals: A + 180 + -135 is A + 45", () => {
    const e = bin("+", bin("+", sym("A"), num(180)), num(-135));
    const { emitted } = compileOne("SUM", e);
    expect(emitted.map(formatConstLine)).toEqual(["#const SUM (A + 45)"]);
  });

  it("does not fold across a non-uniform operator boundary", () => {
    // A % 360 + 360 % 360 * -1 + 180, Sec.5.4's own R formula shape.
    const e = bin(
      "+",
      bin(
        "*",
        bin("%", bin("+", bin("%", sym("A"), num(360)), num(360)), num(360)),
        num(-1),
      ),
      num(180),
    );
    const { emitted } = compileOne("R", e);
    expect(emitted.map(formatConstLine)).toEqual([
      "#const R (A % 360 + 360 % 360 * -1 + 180)",
    ]);
  });

  it("lowers unary minus to * -1 for a leaf operand", () => {
    const e = negE(sym("R"));
    const { emitted } = compileOne("N", e);
    expect(emitted.map(formatConstLine)).toEqual(["#const N (R * -1)"]);
  });

  it("negating a non-leaf chain needs no hoist when it's the whole cell — it's the LEFT operand of * -1, and only right operands must be leaves", () => {
    const e = negE(bin("+", sym("A"), sym("B")));
    const { emitted } = compileOne("N", e);
    // (A + B) * -1, read left-to-right, IS "A + B * -1", one line.
    expect(emitted.map(formatConstLine)).toEqual(["#const N (A + B * -1)"]);
  });

  it("hoists unary minus of a non-leaf operand when it appears as a RIGHT operand", () => {
    const e = bin("+", sym("X"), negE(bin("+", sym("A"), sym("B"))));
    const { emitted } = compileOne("N", e);
    expect(emitted).toHaveLength(2);
    expect(formatConstLine(emitted[0])).toBe("#const TMP_1 (A + B * -1)");
    expect(formatConstLine(emitted[1])).toBe("#const N (X + TMP_1)");
  });

  it("emits a bare leaf with no parens", () => {
    const { emitted } = compileOne("D", sym("ROTATION_PLAYER"));
    expect(emitted.map(formatConstLine)).toEqual(["#const D ROTATION_PLAYER"]);
  });
});

describe("emitCells — Sec.10.2 property tests", () => {
  it("round-trip exactness: emitted chain evaluates identically to the original tree", () => {
    const cases: { expr: Expr; symbols: Record<string, number> }[] = [
      {
        expr: bin("+", sym("A"), bin("*", sym("B"), sym("C"))),
        symbols: { A: 3, B: 4, C: 5 },
      },
      {
        expr: bin("%", bin("+", sym("A"), num(7)), num(3)),
        symbols: { A: -11 },
      },
      {
        expr: bin("/", num(9), bin("-", sym("A"), sym("A"))),
        symbols: { A: 2 },
      }, // /0 -> 0
      { expr: negE(bin("*", sym("A"), sym("B"))), symbols: { A: 3, B: -2 } },
      {
        expr: bin("+", bin("+", num(1), num(2)), bin("+", sym("A"), num(3))),
        symbols: { A: 10 },
      },
    ];
    for (const { expr, symbols } of cases) {
      const { resolved } = compileOne("TARGET", expr, symbols);
      const direct = evalExpr(expr, {
        resolveSym: (n) => symbols[n],
        resolveParam: () => undefined,
      });
      expect(resolved.get("TARGET")).toBe(direct);
    }
  });

  it("re-association is safe for float literals too", () => {
    const expr = bin("+", num(0.1), bin("+", num(0.2), sym("A")));
    const { resolved } = compileOne("TARGET", expr, { A: 1 });
    const direct = evalExpr(expr, {
      resolveSym: (n) => (n === "A" ? 1 : undefined),
      resolveParam: () => undefined,
    });
    expect(resolved.get("TARGET")).toBe(direct);
  });

  it("emit-count monotonicity: RMS-left-spine input emits exactly one line", () => {
    const e = bin(
      "%",
      bin("+", bin("%", sym("A"), num(360)), num(360)),
      num(360),
    );
    const { emitted } = compileOne("R", e);
    expect(emitted).toHaveLength(1);
  });

  it("name collision: a candidate already in scope is renamed, not shadowed", () => {
    // Sec.5.6/P4: first-definition-wins makes a shadowing emit a silent
    // no-op, so the allocator must rename rather than reuse a taken name.
    const namer = new NameAllocator({ reserved: ["ALP_X_P1"] });
    const allocated = namer.allocate("X", "P1");
    expect(allocated).not.toBe("ALP_X_P1");
    expect(allocated).toBe("ALP_X_P1_2");
  });
});
