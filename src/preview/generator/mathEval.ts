// Math-expression evaluation, docs/parser-design.md Sec.2.2, docs/preview-design.md
// Sec.3.6 ("implement parser-design Sec.2.2 EXACTLY"). PURE (CLAUDE.md hard
// rule / preview-design Sec.2).
//
// The parser only ASSEMBLES an expression into an ArgNode, collects its
// tokens, lints the guide-verified malformed shapes (RMS0210), and
// deliberately never evaluates it (parser-design Sec.2.2: "the preview
// generator must implement these exactly; the parser only assembles and
// lints"). This file is that other half. It shares its fixture set with
// src/parser/__tests__/parser.test.ts's "math expressions (Sec.2.2)" block.
// That suite asserts the ASSEMBLY of the same scripts this one evaluates.
//
// No Math.pow/sqrt/etc, nothing here needs them; every operation is +-*/%
// and Math.trunc/floor, which Sec.8 (preview-design) already carves out as
// exact.

/**
 * Sec.2.2: "Evaluation is strictly left-to-right, no precedence, no nested
 * parentheses. A nested `(` operand is silently not-a-number: the guide's own
 * example `(GOLD_COUNT + (5 + 2))` yields 8, dropping `(5`."
 *
 * Extended here, not just for the documented nested-paren case: ANY operand
 * that fails to resolve to a number (an undefined constant, an `rnd(...)`
 * token, a malformed word) is treated the same "not-a-number, drop this
 * operator+operand step and keep going" way. The guide only worked through
 * the nested-paren case explicitly; treating every other resolution failure
 * identically is this file's own extension of that rule, not a separately
 * guide-sourced fact, flagged here because the codebase convention is to
 * say which is which. The one place this does NOT apply is the very first
 * operand: there is no accumulator yet to fall back to, so an unresolved
 * first operand makes the whole expression unresolvable (returns
 * `undefined`) rather than silently starting from 0, which would be exactly
 * the "show something confidently wrong" goal 1 forbids.
 *
 * Malformed shapes with no engine-verified reading, `( A + 1 )`'s unglued
 * leading paren, `(A+1)`'s fully-glued operator, are `RMS0210` lints at the
 * parser level (parser-design Sec.2.2 ⚠ verify #15: "the engine's own
 * close-detection rule is unknown and is the real arbiter"). Rather than
 * invent a confident reading for a case the spec itself marks unverified,
 * this returns `undefined` for the whole expression: an odd token count, or
 * an operator-position token that isn't one of the five operators, bails out
 * instead of guessing.
 *
 * @param tokenTexts the expression's tokens, in source order, EXACTLY as the
 *   parser assembled them (parser-design Sec.2.2's assembly rules, this
 *   function does no boundary-detection of its own, only reads the result).
 * @param resolveConstant looks up a `#const`/`#define`d name's numeric value
 *   (the S0 symbol table, parser-design Sec.7 / preview-design Sec.3.4).
 *   `undefined` for an unresolved or non-numeric name.
 * @returns the evaluated value, or `undefined` if the expression could not
 *   be evaluated at all (unresolved first operand, or a malformed shape).
 */
export function evaluateExpressionTokens(
  tokenTexts: readonly string[],
  resolveConstant: (name: string) => number | undefined,
): number | undefined {
  const n = tokenTexts.length;
  if (n === 0 || n % 2 === 0) return undefined;

  const readOperand = (index: number): number | undefined => {
    const raw = tokenTexts[index];
    const isFirst = index === 0;
    const isLast = index === n - 1;

    // Checked on the RAW text, before this position's own boundary parens
    // are stripped below. Otherwise the required leading "(" at position 0
    // would need special-casing here too instead of in the strip step.
    if (!isFirst && raw.startsWith("(")) return undefined; // nested paren: dropped
    if (RND_PATTERN.test(raw)) return undefined; // "invalid inside an expression" (Sec.2.2)

    let text = raw;
    if (isFirst) text = text.replace(LEADING_PARENS, "");
    if (isLast) text = text.replace(TRAILING_PARENS, "");

    if (text === "inf") return Infinity;
    if (text === "-inf") return -Infinity;
    if (NUMBER_PATTERN.test(text)) return Number(text);
    return resolveConstant(text);
  };

  let acc = readOperand(0);
  if (acc === undefined) return undefined; // nothing to fall back to for the first term

  for (let i = 1; i < n; i += 2) {
    const operatorText = tokenTexts[i];
    if (!isOperator(operatorText)) return undefined; // malformed shape, bail, don't guess
    const operand = readOperand(i + 1);
    if (operand === undefined) continue; // "the engine drops it", skip this step, keep acc
    acc = applyOperator(operatorText, acc, operand);
  }

  return acc;
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const RND_PATTERN = /^rnd\(-?\d+,-?\d+\)$/;
const LEADING_PARENS = /^\(+/;
const TRAILING_PARENS = /\)+$/;

const OPERATORS = new Set(["+", "-", "*", "/", "%"]);
type Operator = "+" | "-" | "*" | "/" | "%";

function isOperator(text: string): text is Operator {
  return OPERATORS.has(text);
}

/**
 * Exported so any OTHER evaluator over the same operator set (Sec.5.5 of
 * docs/land-placement-design.md: the math compiler's self-check walks an
 * `Expr` tree directly rather than a token list) shares this exact
 * arithmetic rather than reimplementing it. The two are meant to diverge
 * only in TRAVERSAL, never in what `+ - * / %` compute.
 */
export function applyOperator(op: Operator, left: number, right: number): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      // Sec.2.2: "Divide by 0 -> 0".
      return right === 0 ? 0 : left / right;
    case "%":
      return mod(left, right);
  }
}

/**
 * `%` IS A CAST, and that is the whole of this function (amended 2026-08-29).
 *
 * The rule, from a Discord report of undocumented patch behaviour and from
 * github.com/twestura/RMS-Trigonometry-Example:
 *
 *   X % Y: cast BOTH operands to int; take the remainder of |(int)X| / |(int)Y|;
 *   return it with the sign of X.
 *
 * The cast is what this function was missing. `left % right` in JS does not
 * round: `5.7 % 3` is `2.7` where the engine gives `2`, and `51.43 % 360` is
 * `51.43` where the engine gives `51`. Sec.2.2's truncation-toward-zero pin was
 * measured (⚠ verify #18 -> RMSTEST_47, `-7 % 2` / `7 % -2` / `-7 % -2`) but
 * every arm of that run used INTEGER operands, so it pinned the SIGN and never
 * exercised the cast. The two facts are orthogonal; only the sign was in
 * evidence. JS's native `%` already yields the sign of the dividend for finite
 * integers, so once both operands are truncated the sign rule is free.
 *
 * A consequence worth knowing: if |Y| > |X| then `X % Y` is just `(int)X`, which
 * makes `%` the language's ONLY rounding operator (`+ - * /` do not round) and
 * makes `X % -inf` the truncation idiom rather than a special case. The explicit
 * non-finite branch below is therefore redundant with the general rule and kept
 * only because `Math.trunc(Infinity)` is `Infinity`, not an int.
 *
 * DIVISOR-TRUNCATES-TO-ZERO IS REACHABLE, and it is new. Any |Y| < 1 casts to
 * `0`, so `5.7 % 0.5` is a modulo-by-zero even though neither operand is zero.
 * Order matters here: cast first, then test for zero.
 *
 * `x % 0` -> the left operand, truncated toward zero. **MEASURED 2026-08-30**
 * (`tools/scenario-probe/rmstest/RMSTEST_64_modzero_and_cast.rms`, BUG-022),
 * reversing the 2026-08-29 owner decision that had gone the other way on the
 * guide's main math text ("Dividing by 0 gives 0. Modulo 0 also gives 0.").
 * That text is the stale one: arm 1 (`7 % 0`) read back 7, not 0, and arm 2
 * (`0 - 7.5 % 0`) read back -7, not 0, both cross-checked against a control
 * that pinned the arithmetic scale so the two readings could not land
 * adjacent. The Summer 2025 Update note Sec.2.2 originally took this from was
 * right. The cast adopted the same day as the reversed decision is UNAFFECTED
 * and independently confirmed by the same run (arms 5-7): both readings agree
 * on the cast, so it was never in dispute here. Note the two are separable:
 * the `-inf` idiom (`(-5.9 % -inf + 10)` -> 5) rests on the |Y| > |X| rule
 * above and holds regardless of the zero-divisor reading.
 */
function mod(left: number, right: number): number {
  // ±inf has no int cast. Subsumed by |Y| > |X| except that `Math.trunc` of an
  // infinity is that infinity, so it is spelled out.
  if (!Number.isFinite(right)) return Math.trunc(left);
  // Guards NaN, which PROHIBITED_VALUE_KINDS forbids from crossing the tools
  // boundary: `Infinity % 5` is NaN in JS, and the old code reached it.
  if (!Number.isFinite(left)) return left;

  const l = Math.trunc(left);
  const r = Math.trunc(right);
  if (r === 0) return l;
  return l % r;
}

/**
 * Sec.2.2: "Floats flow through expressions... rounding to integer happens
 * only where a float reaches an integer-only attribute, 0.5 rounds up."
 * Round-half-up, inheriting the convention preview-design Sec.4 already
 * established for border-percent conversion rather than re-deriving a
 * tie-break direction Sec.2.2 doesn't independently pin for negative values.
 */
export function roundForIntegerSlot(value: number): number {
  return Math.floor(value + 0.5);
}
