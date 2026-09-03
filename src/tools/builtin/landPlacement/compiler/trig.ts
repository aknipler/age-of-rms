// Sec.5.4: SIN(θ)/COS(θ) expand to Bulls_Eyes' own macro, Bhaskara I's sine
// approximation carried out in left-associative integer-friendly arithmetic.
// COS reuses SIN's own R (cos(θ) = sin(θ+90) folded into one extra ray), so
// the two together cost ten lines, not twenty.
//
// The five/ten formulas below are written as explicit left-nested `bin()`
// calls (via `foldLeft`) rather than built from user-facing helpers, because
// they are a FIXED template (Sec.5.4), not a re-derivation, this is the one
// place in the compiler that is intentionally not "clever": it is a literal
// transcription of the macro's five lines, so it can be read against them.

import type { Expr } from "../../../../../tools-api/index";
import { bin, foldLeft, isLeaf, num, sym } from "./expr";
import type { NamedCell } from "./emit";
import type { NameAllocator } from "./naming";

export interface TrigMacroResult {
  /** IN ORDER: R, S, P, D, SIN, CR, CS, CP, CD, COS, Bulls_Eyes' own file order. */
  cells: NamedCell[];
  sinName: string;
  cosName: string;
}

/**
 * `theta` must already be a LEAF: frame.ts always calls this with a `sym`
 * reference to an already-emitted DEGREES cell, never a raw expression, so
 * R's own formula starts from a single token exactly as Bulls_Eyes' hand-
 * written macro does. A non-leaf theta would still be sound to expand (R's
 * formula tolerates any first operand per the left-spine rule) but nothing
 * in this tool's own pipeline should ever construct one, so it's asserted.
 */
export function expandTrig(theta: Expr, suffix: string, namer: NameAllocator): TrigMacroResult {
  if (!isLeaf(theta)) {
    throw new Error("expandTrig: theta must be a leaf — hoist the angle to its own #const first");
  }

  const cells: NamedCell[] = [];
  const name = (base: string): string => {
    const n = namer.allocate(base, suffix);
    return n;
  };
  const define = (base: string, expr: Expr): string => {
    const n = name(base);
    cells.push({ name: n, expr });
    return n;
  };

  // R_k = θ % 360 + 360 % 360 * -1 + 180  (fold to (-180,180])
  const rName = define(
    "R",
    foldLeft(theta, [
      ["%", num(360)],
      ["+", num(360)],
      ["%", num(360)],
      ["*", num(-1)],
      ["+", num(180)],
    ]),
  );

  const trigFrom = (xName: string, sBase: string, pBase: string, dBase: string, outBase: string): string => {
    // S = (X * 2 + 1) % 2, sign(X), as ±1
    const sName = define(
      sBase,
      foldLeft(sym(xName), [
        ["*", num(2)],
        ["+", num(1)],
        ["%", num(2)],
      ]),
    );
    // P = (180 * S - X) * X
    const pName = define(
      pBase,
      foldLeft(num(180), [
        ["*", sym(sName)],
        ["-", sym(xName)],
        ["*", sym(xName)],
      ]),
    );
    // D = 40500 - P
    const dName = define(dBase, bin("-", num(40500), sym(pName)));
    // OUT = S * 4 * P / D
    const outName = define(
      outBase,
      foldLeft(sym(sName), [
        ["*", num(4)],
        ["*", sym(pName)],
        ["/", sym(dName)],
      ]),
    );
    return outName;
  };

  const sinName = trigFrom(rName, "S", "P", "D", "SIN");

  // CR = 270 - R % 360 * -1 + 180
  const crName = define(
    "CR",
    foldLeft(num(270), [
      ["-", sym(rName)],
      ["%", num(360)],
      ["*", num(-1)],
      ["+", num(180)],
    ]),
  );
  const cosName = trigFrom(crName, "CS", "CP", "CD", "COS");

  return { cells, sinName, cosName };
}
