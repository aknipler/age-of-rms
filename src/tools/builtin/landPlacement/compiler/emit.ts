// Sec.5.3: the emit rule. "A DAG node emits as one #const iff, walking its
// left spine, every right-hand operand is a leaf." Sound, decidable in one
// pass, and, Sec.10.1's acceptance run found this, incomplete without two
// normalisations applied first:
//
//   (a) Re-associate a uniform `+` or `*` chain onto the left spine.
//   (b) Fold adjacent integer literals in that chain.
//
// Both are restricted to `+`/`*`: `-`, `/`, `%` are not associative and
// re-associating them changes the answer. Unary minus is handled as sugar
// for `* -1` (folded away in normalizeExpr) rather than as its own emission
// case, which is what lets the general hoist rule below cover it for free.
//
// CONTRACT: by the time an Expr reaches this module, every `node`/`param`
// ref must already be resolved to `sym`, and every `sin`/`cos` must already
// be expanded (compiler/trig.ts). This module only ever sees
// num/inf/sym/bin/neg.

import type { Expr } from "../../../../../tools-api/index";
import { bin, chain, isLeaf, num } from "./expr";
import type { NameAllocator } from "./naming";

function isIntLiteral(e: Expr): e is { k: "num"; v: number } {
  return e.k === "num" && Number.isInteger(e.v);
}

/** Unwraps a uniform-op chain back into its ordered term list. */
function flattenChain(e: Expr, op: "+" | "*"): Expr[] {
  if (e.k === "bin" && e.op === op) return [...flattenChain(e.l, op), e.r];
  return [e];
}

function foldAdjacentIntegers(terms: readonly Expr[], op: "+" | "*"): Expr[] {
  const out: Expr[] = [];
  for (const t of terms) {
    const prev = out[out.length - 1];
    if (prev !== undefined && isIntLiteral(prev) && isIntLiteral(t)) {
      out[out.length - 1] = num(op === "+" ? prev.v + t.v : prev.v * t.v);
    } else {
      out.push(t);
    }
  }
  return out;
}

/**
 * (a) + (b), applied bottom-up: children are normalised first, so a nested
 * same-op chain on either side is already in canonical left-spine form and
 * `flattenChain` unwraps it cleanly. `neg` lowers to `* -1` here, Sec.5.3's
 * "unary minus… otherwise to a temp then * -1" then falls out of the
 * ordinary hoist rule below rather than needing its own case.
 */
export function normalizeExpr(e: Expr): Expr {
  switch (e.k) {
    case "num":
    case "inf":
    case "sym":
    case "param":
    case "node":
      return e;
    case "neg":
      return normalizeExpr(bin("*", e.e, num(-1)));
    case "sin":
    case "cos":
      throw new Error(
        `normalizeExpr: ${e.k} must be expanded (compiler/trig.ts) before normalisation`,
      );
    case "bin": {
      const l = normalizeExpr(e.l);
      const r = normalizeExpr(e.r);
      if (e.op !== "+" && e.op !== "*") return bin(e.op, l, r);
      const terms = foldAdjacentIntegers(
        [...flattenChain(l, e.op), ...flattenChain(r, e.op)],
        e.op,
      );
      return chain(e.op, terms);
    }
  }
}

function formatNumber(v: number): string {
  if (Object.is(v, -0)) return "0";
  return String(v);
}

/**
 * `param` is treated as already-resolved text here, a convenience for
 * Sec.10.2's property tests, which generate raw `param` leaves without a
 * real naming pass. Real model code (frame.ts) never lets a `param` ref
 * reach this module; it resolves each one to `sym(emittedParamName)` first,
 * matching Sec.5.3: a hoisted rnd is referenced by its OWN emitted name.
 */
function leafText(e: Expr): string {
  switch (e.k) {
    case "num":
      return formatNumber(e.v);
    case "inf":
      return e.sign === 1 ? "inf" : "-inf";
    case "sym":
      return e.name;
    case "param":
      return e.id;
    default:
      throw new Error(`leafText: not a leaf (${e.k})`);
  }
}

export interface NamedCell {
  name: string;
  expr: Expr;
}

export interface EmittedConst {
  name: string;
  /** The RHS text, bare for a single leaf, one parenthesised chain otherwise. */
  text: string;
  /**
   * The same RHS as a flat token list (no parens), what
   * `evaluateExpressionTokens` (Sec.5.5's oracle) actually consumes. Kept
   * alongside `text` so the verifier never has to re-lex generated text.
   */
  tokens: readonly string[];
}

/**
 * Emits `targets` IN ORDER. A target's expr may reference any EARLIER
 * target (or macro cell) by name via `sym`; the caller (frame.ts,
 * compiler/trig.ts) is responsible for that order, since a tree walk alone
 * cannot recover cross-cell dependency order once names have been
 * substituted in.
 */
export function emitCells(
  targets: readonly NamedCell[],
  namer: NameAllocator,
): EmittedConst[] {
  const out: EmittedConst[] = [];
  let tempCounter = 0;

  function lower(e: Expr): string[] {
    const n = normalizeExpr(e);
    if (isLeaf(n)) return [leafText(n)];
    if (n.k !== "bin") {
      throw new Error(`emitCells: unexpected node reaching lowering (${n.k})`);
    }
    const leftTokens = lower(n.l);
    const rightTokens = isLeaf(n.r) ? [leafText(n.r)] : hoist(n.r);
    return [...leftTokens, n.op, ...rightTokens];
  }

  function hoist(e: Expr): string[] {
    tempCounter += 1;
    const name = namer.allocate("TMP", String(tempCounter));
    const tokens = lower(e);
    out.push({
      name,
      text: tokens.length === 1 ? tokens[0] : `(${tokens.join(" ")})`,
      tokens,
    });
    return [name];
  }

  for (const t of targets) {
    const tokens = lower(t.expr);
    out.push({
      name: t.name,
      text: tokens.length === 1 ? tokens[0] : `(${tokens.join(" ")})`,
      tokens,
    });
  }

  return out;
}

/** `#const NAME text`, Sec.6.1's line shape, for a fence writer or a test. */
export function formatConstLine(cell: EmittedConst): string {
  return `#const ${cell.name} ${cell.text}`;
}

/**
 * A `#define NAME` cell: an emission kind with no value at all (per-player-
 * escalation.md Sec.7.2 / slice-a-brief item 2). Every other cell this
 * compiler emits is a `#const` with a value that `verifyEmission` can
 * resolve and cross-check; a `#define` has nothing to resolve, so it is kept
 * OUT of `EmittedConst`/`verifyEmission`'s path entirely rather than taught
 * a valueless case there. It still contributes a NAME, so a caller building
 * `emittedNames` (P4, Sec.5.6) has to fold this in alongside `EmittedConst`.
 */
export interface EmittedDefine {
  name: string;
}

/** `#define NAME`, the prologue's `AT_LEAST_k` cumulative labels (Sec.4.1). */
export function formatDefineLine(cell: EmittedDefine): string {
  return `#define ${cell.name}`;
}
