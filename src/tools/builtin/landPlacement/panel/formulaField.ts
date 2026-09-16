// Sec.8's formula field: "live feedback in three parts: the parse, the
// resulting position, and the RMS the compiler would emit for it, with its
// line count. Showing the emitted lines while typing is what teaches the
// left-associativity rule without a tutorial, and it makes Sec.5.3's
// temp-count trade visible at the moment the user can act on it."
//
// `compiler/frontend.ts`'s `parseFormula` has existed since slice 1 and had
// no UI consumer. This is that consumer's pure half. Per this repo's own
// rule (viewModel.ts's header comment): "a React component should be glue
// over tested functions... if a run-sheet step could fail because a number
// is wrong, that number belonged [here]."
//
// SCOPE CUT, DECIDED HERE (documented rather than silently unsupported): a
// formula containing `rnd(a,b)` parses structurally (frontend.ts's own
// comment: "the caller is responsible for turning this into a real
// RandomParam with a label") but this module does not perform that
// materialisation. Attaching a fresh RandomParam to the model is a model
// edit with its own naming/collision concerns, not a preview computation.
// `computeFormulaFeedback` reports it as unsupported rather than guessing a
// value or silently dropping the draw.

import type { Expr } from "../../../../../tools-api/index";
import { evalExpr, isLeaf, sym } from "../compiler/expr";
import { emitCells, formatConstLine, type NamedCell } from "../compiler/emit";
import { NameAllocator } from "../compiler/naming";
import { parseFormula, type ParseError } from "../compiler/frontend";
import { expandTrig } from "../compiler/trig";

export interface FormulaFeedback {
  /** `false`, a parse error, with the position to underline. */
  parse: { ok: true } | { ok: false; error: ParseError };
  /** The formula's numeric value under Sec.5.5's own reference evaluator, `undefined` if unresolvable (an unknown identifier, or `unsupportedReason` is set). */
  value: number | undefined;
  /** Set instead of computing a value/emission, see this file's own header for the one case (`rnd(...)`) this covers today. */
  unsupportedReason: string | null;
  /** The `#const` lines emitCells would actually produce for this formula, in order, Sec.8: "makes Sec.5.3's temp-count trade visible". Empty when parse failed or unsupportedReason is set. */
  emittedLines: readonly string[];
}

function containsParam(e: Expr): boolean {
  switch (e.k) {
    case "param":
      return true;
    case "neg":
    case "sin":
    case "cos":
      return containsParam(e.e);
    case "bin":
      return containsParam(e.l) || containsParam(e.r);
    default:
      return false;
  }
}

interface ExpandResult {
  expr: Expr;
  cells: NamedCell[];
}

/**
 * Expands EVERY sin/cos node in `e`, however deeply nested, `emitCells`
 * throws on a raw sin/cos (its own documented contract: trig must already be
 * expanded), and `expandTrig` itself requires its `theta` argument to
 * already be a leaf, so a non-leaf argument (`SIN(x + 1)`) is hoisted to its
 * own cell first, exactly as a real generation's dependency order requires.
 *
 * NOT hash-consed against a sibling `SIN`/`COS` of the SAME angle the way
 * frame.ts's own per-node call is (Sec.5.2: "which is what lets SIN(θ) and
 * COS(θ) share θ's own cell"), a user typing both in ONE formula field gets
 * two separate macro expansions rather than a shared one. Correct, just not
 * minimal; sharing across an ad hoc single-field preview isn't worth the
 * extra bookkeeping this function would need to detect it.
 */
function expandTrigDeep(
  e: Expr,
  suffix: string,
  namer: NameAllocator,
): ExpandResult {
  switch (e.k) {
    case "num":
    case "inf":
    case "sym":
    case "param":
    case "node":
      return { expr: e, cells: [] };
    case "neg": {
      const inner = expandTrigDeep(e.e, suffix, namer);
      return { expr: { k: "neg", e: inner.expr }, cells: inner.cells };
    }
    case "bin": {
      const l = expandTrigDeep(e.l, suffix, namer);
      const r = expandTrigDeep(e.r, suffix, namer);
      return {
        expr: { k: "bin", op: e.op, l: l.expr, r: r.expr },
        cells: [...l.cells, ...r.cells],
      };
    }
    case "sin":
    case "cos": {
      const inner = expandTrigDeep(e.e, suffix, namer);
      const cells = [...inner.cells];
      let theta = inner.expr;
      if (!isLeaf(theta)) {
        const argName = namer.allocate("ARG", suffix);
        cells.push({ name: argName, expr: theta });
        theta = sym(argName);
      }
      const trig = expandTrig(theta, suffix, namer);
      cells.push(...trig.cells);
      return { expr: sym(e.k === "sin" ? trig.sinName : trig.cosName), cells };
    }
  }
}

/**
 * `fieldSuffix` seeds the preview's own temp/cell names (never actually
 * emitted into a document, this NameAllocator is thrown away) so two
 * different fields' previews don't read as the same land in an error
 * message. `resolveSym` is the caller's own symbol table, the document's
 * resolved `#const`s, the model's own dry-run `resolved` map, or both
 * layered. This module has no opinion on which; it only evaluates.
 */
const PRINT_PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
};

function formatNumber(v: number): string {
  return Object.is(v, -0) ? "0" : String(v);
}

/**
 * The inverse of `parseFormula`, close enough to round-trip: what a field
 * shows for an Expr it did not just receive from the user (loading an
 * existing `formula`-kind node, or a plain number rendered through the same
 * field this slice unifies `NumberField` into). Minimal parenthesisation.
 * A `bin` node only wraps when its own precedence is lower than its
 * parent's, matching `PRECEDENCE` in frontend.ts exactly so a round trip
 * through parse -> print -> parse is a no-op on anything this function
 * itself produced.
 *
 * `param` is the one leaf this can't faithfully invert (same gap emit.ts's
 * own `leafText` already documents and accepts for the identical reason): a
 * stored `Placement`/`LandRole` field is never SUPPOSED to carry a raw
 * `param` today (paramEmit.ts's `resolveParamRefs` replaces every one with
 * `sym(emittedName)` before a model is ever re-read), so this is a display
 * fallback for an edge case outside this slice's own scope (attaching a
 * fresh RandomParam from inside the formula field), not a case the shipped
 * UI is expected to hit.
 */
export function exprToFormulaText(e: Expr, parentPrec = 0): string {
  switch (e.k) {
    case "num":
      return formatNumber(e.v);
    case "inf":
      return e.sign === 1 ? "inf" : "-inf";
    case "sym":
      return e.name;
    case "param":
      return e.id;
    case "node":
      return `${e.id}.${e.field}`;
    case "neg":
      return `-${exprToFormulaText(e.e, 3)}`;
    case "sin":
      return `SIN(${exprToFormulaText(e.e, 0)})`;
    case "cos":
      return `COS(${exprToFormulaText(e.e, 0)})`;
    case "bin": {
      const prec = PRINT_PRECEDENCE[e.op];
      const text = `${exprToFormulaText(e.l, prec)} ${e.op} ${exprToFormulaText(e.r, prec + 1)}`;
      return prec < parentPrec ? `(${text})` : text;
    }
  }
}

export function computeFormulaFeedback(
  source: string,
  fieldSuffix: string,
  resolveSym: (name: string) => number | undefined,
): FormulaFeedback {
  const parsed = parseFormula(source);
  if (!parsed.ok) {
    return {
      parse: { ok: false, error: parsed.error },
      value: undefined,
      unsupportedReason: null,
      emittedLines: [],
    };
  }

  if (containsParam(parsed.expr)) {
    return {
      parse: { ok: true },
      value: undefined,
      unsupportedReason:
        "rnd(...) in a formula isn't supported yet — create a Random Parameter and reference it by name instead.",
      emittedLines: [],
    };
  }

  // Sec.5.5's own reference evaluator, unexpanded, evalExpr's sin/cos cases
  // already use the same Bhaskara macro directly, so there is nothing to
  // gain (and dependency-order bookkeeping to lose) by evaluating the
  // expanded cell form instead.
  const value = evalExpr(parsed.expr, {
    resolveSym,
    resolveParam: () => undefined,
  });

  const namer = new NameAllocator({ prefix: "" });
  const expanded = expandTrigDeep(parsed.expr, fieldSuffix, namer);
  const previewName = namer.allocate("PREVIEW", fieldSuffix);
  const emitted = emitCells(
    [...expanded.cells, { name: previewName, expr: expanded.expr }],
    namer,
  );

  return {
    parse: { ok: true },
    value,
    unsupportedReason: null,
    emittedLines: emitted.map(formatConstLine),
  };
}
