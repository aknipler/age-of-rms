// Expr constructors, structural hashing, and the reference evaluator that
// verifies the compiler's own output (docs/land-placement-design.md Sec.5.5).
//
// evalExpr and the emitted-#const-chain evaluation
// (src/preview/generator/mathEval.ts's evaluateExpressionTokens) MUST share
// the same arithmetic primitive. That is the point of importing
// `applyOperator` rather than reimplementing +-*/%  here. What differs
// between the two checks is the TRAVERSAL (a DAG walk here, a tokenized
// left-to-right scan there), not the arithmetic (Sec.5.5: "Both sides use
// identical operator rules, so any difference is a compiler bug").

import type { Expr } from "../../../../../tools-api/index";
import { applyOperator } from "../../../../preview/generator/mathEval";

export type BinOp = "+" | "-" | "*" | "/" | "%";
export type NodeField = "x" | "y" | "theta" | "inbound";

export const num = (v: number): Expr => ({ k: "num", v });
export const infE = (sign: 1 | -1): Expr => ({ k: "inf", sign });
export const sym = (name: string): Expr => ({ k: "sym", name });
export const param = (id: string): Expr => ({ k: "param", id });
export const nodeRef = (id: string, field: NodeField): Expr => ({
  k: "node",
  id,
  field,
});
export const bin = (op: BinOp, l: Expr, r: Expr): Expr => ({
  k: "bin",
  op,
  l,
  r,
});
export const add = (l: Expr, r: Expr): Expr => bin("+", l, r);
export const sub = (l: Expr, r: Expr): Expr => bin("-", l, r);
export const mul = (l: Expr, r: Expr): Expr => bin("*", l, r);
export const divE = (l: Expr, r: Expr): Expr => bin("/", l, r);
export const modE = (l: Expr, r: Expr): Expr => bin("%", l, r);
export const negE = (e: Expr): Expr => ({ k: "neg", e });
export const sinE = (e: Expr): Expr => ({ k: "sin", e });
export const cosE = (e: Expr): Expr => ({ k: "cos", e });

/** Left-fold a list of terms into one left-associative `+` (or `*`) chain. */
export function chain(op: "+" | "*", terms: readonly Expr[]): Expr {
  if (terms.length === 0) throw new Error("chain() needs at least one term");
  return terms
    .slice(1)
    .reduce<Expr>((acc, term) => bin(op, acc, term), terms[0]);
}

/** Fold a sequence of (op, operand) steps onto an initial left operand, the
 *  general non-uniform-operator case `chain()` cannot express (Sec.5.4's
 *  macro mixes `%`, `+`, `*`). */
export function foldLeft(
  initial: Expr,
  steps: ReadonlyArray<readonly [BinOp, Expr]>,
): Expr {
  return steps.reduce<Expr>((acc, [op, rhs]) => bin(op, acc, rhs), initial);
}

/**
 * Canonical string key for structural equality, hash-consing (Sec.5.2): two
 * subtrees with the same key are the same node, which is what lets SIN(θ) and
 * COS(θ) share θ's own cell.
 */
export function exprKey(e: Expr): string {
  switch (e.k) {
    case "num":
      return `n:${e.v}`;
    case "inf":
      return `i:${e.sign}`;
    case "sym":
      return `s:${e.name}`;
    case "param":
      return `p:${e.id}`;
    case "node":
      return `d:${e.id}:${e.field}`;
    case "bin":
      return `b:${e.op}:${exprKey(e.l)}:${exprKey(e.r)}`;
    case "neg":
      return `g:${exprKey(e.e)}`;
    case "sin":
      return `sn:${exprKey(e.e)}`;
    case "cos":
      return `cs:${exprKey(e.e)}`;
  }
}

export function exprEquals(a: Expr, b: Expr): boolean {
  return exprKey(a) === exprKey(b);
}

/**
 * A leaf in the RMS emission sense: a token that never needs its own #const.
 * `param` counts as a leaf structurally, but by the time a tree reaches the
 * emit backend every `param` ref must already have been resolved to `sym`
 * (Sec.5.3: a hoisted rnd is referenced by its OWN emitted name), see
 * emit.ts's `leafText`.
 */
export function isLeaf(e: Expr): boolean {
  return e.k === "num" || e.k === "inf" || e.k === "sym" || e.k === "param";
}

export interface EvalResolvers {
  resolveSym: (name: string) => number | undefined;
  resolveParam: (id: string) => number | undefined;
  /** Only needed if the tree still carries unresolved node refs. */
  resolveNode?: (id: string, field: NodeField) => number | undefined;
}

/**
 * Sec.5.5 step 3: evaluate the ORIGINAL Expr tree directly, under the exact
 * same operator rules the emitted #const chain is read back with. SIN/COS
 * nodes are evaluated via the identical Bhaskara macro (Sec.5.4) the emitter
 * expands them into, not real trigonometry, because the property under
 * test is "does the compiler's emission match the DAG it was given", not
 * "is the DAG close to a sine wave". Sec.5.4's own measurement is what
 * separately prices the macro's distance from real sin/cos.
 */
export function evalExpr(e: Expr, r: EvalResolvers): number | undefined {
  switch (e.k) {
    case "num":
      return e.v;
    case "inf":
      return e.sign === 1 ? Infinity : -Infinity;
    case "sym":
      return r.resolveSym(e.name);
    case "param":
      return r.resolveParam(e.id);
    case "node":
      return r.resolveNode?.(e.id, e.field);
    case "neg": {
      const v = evalExpr(e.e, r);
      return v === undefined ? undefined : applyOperator("*", v, -1);
    }
    case "bin": {
      const l = evalExpr(e.l, r);
      const rr = evalExpr(e.r, r);
      if (l === undefined || rr === undefined) return undefined;
      return applyOperator(e.op, l, rr);
    }
    case "sin": {
      const theta = evalExpr(e.e, r);
      return theta === undefined ? undefined : sinFromTheta(theta);
    }
    case "cos": {
      const theta = evalExpr(e.e, r);
      return theta === undefined ? undefined : cosFromTheta(theta);
    }
  }
}

/**
 * Evaluate with NO symbol table at all, so `undefined` means exactly "this
 * tree depends on something outside itself" (a `sym`, a `param`, a `node`)
 * rather than "this tree is malformed". That is the predicate two separate
 * callers need and it is deliberately NOT `isFullyNumericLiteral`: a group
 * member's own theta is `bin("+", num, num)` (`expand.ts` never folds), so a
 * literal-shape test would report every ordinary ring member as symbolic.
 *
 * Lives here beside `evalExpr` rather than in either caller, because both
 * consumers, `reExpand.ts`'s delta branch and `dragMath.ts`'s drag guard,
 * have to agree on it exactly. Sec.4.5 leaves a symbolic member offset
 * alone; Sec.7.3 declines to drag one. Those are the same question asked
 * twice and they must not drift apart.
 */
export function evalClosed(e: Expr): number | undefined {
  return evalExpr(e, {
    resolveSym: () => undefined,
    resolveParam: () => undefined,
    resolveNode: () => undefined,
  });
}

// -----------------------------------------------------------------------
// The Bhaskara-approximation macro (Sec.5.4), reused by evalExpr AND by the
// macro expander (compiler/trig.ts) so the two literally cannot disagree on
// its shape. They are the same arithmetic, one evaluated directly and one
// lowered to #const text.
// -----------------------------------------------------------------------

/** θ folded to (-180, 180], via `θ % 360 + 360 % 360 * -1 + 180` (Sec.5.4). */
export function foldToR(theta: number): number {
  const a = applyOperator("%", theta, 360);
  const b = applyOperator("+", a, 360);
  const c = applyOperator("%", b, 360);
  const d = applyOperator("*", c, -1);
  return applyOperator("+", d, 180);
}

function trigFromR(x: number): number {
  const s1 = applyOperator("*", x, 2);
  const s2 = applyOperator("+", s1, 1);
  const s = applyOperator("%", s2, 2);
  const p1 = applyOperator("*", 180, s);
  const p2 = applyOperator("-", p1, x);
  const p = applyOperator("*", p2, x);
  const d = applyOperator("-", 40500, p);
  const v1 = applyOperator("*", s, 4);
  const v2 = applyOperator("*", v1, p);
  return applyOperator("/", v2, d);
}

export function sinFromTheta(theta: number): number {
  return trigFromR(foldToR(theta));
}

function foldToCR(theta: number): number {
  const r = foldToR(theta);
  const a = applyOperator("-", 270, r);
  const b = applyOperator("%", a, 360);
  const c = applyOperator("*", b, -1);
  return applyOperator("+", c, 180);
}

export function cosFromTheta(theta: number): number {
  return trigFromR(foldToCR(theta));
}
