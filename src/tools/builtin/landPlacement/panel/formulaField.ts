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
// RANDOM PARAMETERS (2026-09-22, lifting the scope cut this header used to
// record): a formula may name an existing `RandomParam` by its LABEL, and
// may contain `rnd(a,b)`, which the front end parses to a placeholder
// `param("rnd(a,b)@pos")`. This module binds labels to ids and previews a
// placeholder at its midpoint; MATERIALISING a placeholder into a real
// `RandomParam` on the model is `modelOps.ts`'s `materialiseRndParams`, a
// model edit with its own naming, which the panel's `FormulaField` runs at
// commit time. So a user can type `rnd(0,359)` into Rotation and get a
// hoisted draw, which is how every new ring's rotation starts out.

import type { Expr } from "../../../../../tools-api/index";
import { evalExpr, isLeaf, sym } from "../compiler/expr";
import { emitCells, formatConstLine, type NamedCell } from "../compiler/emit";
import { NameAllocator } from "../compiler/naming";
import { parseFormula, type ParseError } from "../compiler/frontend";
import { expandTrig } from "../compiler/trig";
import type { SymbolInfo } from "../../../../parser/types";

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

/** The bounds of a `rnd(a,b)` placeholder the front end produced, or null for a real param id. */
export function rndPlaceholder(
  id: string,
): { min: number; max: number } | null {
  const m = /^rnd\((-?[\d.]+),(-?[\d.]+)\)@/.exec(id);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
}

/** Every `sym` whose name is a RandomParam's label becomes `param(id)`, so a formula can reference a hoisted draw by the name the user sees. */
export function bindParamLabels(
  e: Expr,
  idByLabel: ReadonlyMap<string, string>,
): Expr {
  switch (e.k) {
    case "sym": {
      const id = idByLabel.get(e.name);
      return id === undefined ? e : { k: "param", id };
    }
    case "neg":
      return { k: "neg", e: bindParamLabels(e.e, idByLabel) };
    case "sin":
      return { k: "sin", e: bindParamLabels(e.e, idByLabel) };
    case "cos":
      return { k: "cos", e: bindParamLabels(e.e, idByLabel) };
    case "bin":
      return {
        k: "bin",
        op: e.op,
        l: bindParamLabels(e.l, idByLabel),
        r: bindParamLabels(e.r, idByLabel),
      };
    default:
      return e;
  }
}

/** The inverse, for the emitted-lines preview only: a `param` reads as its label (or its `rnd(a,b)` text), never its id. */
function paramsToSyms(e: Expr, labelOf: (id: string) => string): Expr {
  switch (e.k) {
    case "param":
      return sym(labelOf(e.id));
    case "neg":
      return { k: "neg", e: paramsToSyms(e.e, labelOf) };
    case "sin":
      return { k: "sin", e: paramsToSyms(e.e, labelOf) };
    case "cos":
      return { k: "cos", e: paramsToSyms(e.e, labelOf) };
    case "bin":
      return {
        k: "bin",
        op: e.op,
        l: paramsToSyms(e.l, labelOf),
        r: paramsToSyms(e.r, labelOf),
      };
    default:
      return e;
  }
}

/** What the formula field knows about the model's RandomParams: how to name one, find one by name, and preview one. */
export interface FormulaParamEnv {
  labelOf: (id: string) => string | undefined;
  idByLabel: ReadonlyMap<string, string>;
  previewOf: (id: string) => number | undefined;
}

export const NO_PARAMS: FormulaParamEnv = {
  labelOf: () => undefined,
  idByLabel: new Map(),
  previewOf: () => undefined,
};

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
 * A `param` prints as its label, which `bindParamLabels` turns back into the
 * same `param` when the field commits. That round trip is load-bearing. A
 * new shape's rotation is `param + 0` (modelOps.ts's `addRing`), so the
 * shipped UI shows a nested param in every new shape's Rotation field. A
 * param with no label prints as its raw id, which cannot bind back and
 * commits as an unknown name.
 *
 * The recursion lives in the inner `print` so that `labelOf` is captured
 * once and cannot be dropped. It used to be an optional parameter with a
 * no-op default, and none of the recursive calls passed it on, so only a
 * top-level param printed by label. The compiler cannot catch a forgotten
 * optional argument, and a closure leaves nothing to forget.
 */
export function exprToFormulaText(
  e: Expr,
  parentPrec = 0,
  labelOf: (id: string) => string | undefined = () => undefined,
): string {
  const print = (e: Expr, parentPrec: number): string => {
    switch (e.k) {
      case "num":
        return formatNumber(e.v);
      case "inf":
        return e.sign === 1 ? "inf" : "-inf";
      case "sym":
        return e.name;
      case "param": {
        // A real param reads as its label; a not-yet-materialised placeholder
        // reads back as the `rnd(a,b)` the user typed.
        const placeholder = rndPlaceholder(e.id);
        return (
          labelOf(e.id) ??
          (placeholder ? `rnd(${placeholder.min},${placeholder.max})` : e.id)
        );
      }
      case "node":
        return `${e.id}.${e.field}`;
      case "neg":
        return `-${print(e.e, 3)}`;
      case "sin":
        return `SIN(${print(e.e, 0)})`;
      case "cos":
        return `COS(${print(e.e, 0)})`;
      case "bin": {
        const prec = PRINT_PRECEDENCE[e.op];
        const text = `${print(e.l, prec)} ${e.op} ${print(e.r, prec + 1)}`;
        return prec < parentPrec ? `(${text})` : text;
      }
    }
  };
  return print(e, parentPrec);
}

export function computeFormulaFeedback(
  source: string,
  fieldSuffix: string,
  resolveSym: (name: string) => number | undefined,
  params: FormulaParamEnv = NO_PARAMS,
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
  const expr = bindParamLabels(parsed.expr, params.idByLabel);

  // Sec.5.5's own reference evaluator, unexpanded, evalExpr's sin/cos cases
  // already use the same Bhaskara macro directly, so there is nothing to
  // gain (and dependency-order bookkeeping to lose) by evaluating the
  // expanded cell form instead. A param previews at its midpoint, a
  // placeholder `rnd(a,b)` at the midpoint of the bounds typed.
  const value = evalExpr(expr, {
    resolveSym,
    resolveParam: (id) => {
      const known = params.previewOf(id);
      if (known !== undefined) return known;
      const p = rndPlaceholder(id);
      return p ? (p.min + p.max) / 2 : undefined;
    },
  });

  const labelOf = (id: string): string =>
    params.labelOf(id) ?? exprToFormulaText({ k: "param", id });
  const namer = new NameAllocator({ prefix: "" });
  const expanded = expandTrigDeep(
    paramsToSyms(expr, labelOf),
    fieldSuffix,
    namer,
  );
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

// ---------------------------------------------------------------------------
// Names with no value (2026-09-28). A formula that names something the
// preview cannot resolve still saves, and then the whole layout's dry run
// fails and the canvas draws nothing (BUG-035 was one way to get there).
// This says why beside the box, before and after saving.
//
// It warns and never refuses. "No #const by that name" is a fact about the
// script, which is complete, but it does not prove the game has no such
// name. RMS maths also reads the game's own constants, terrain and object
// names among them, and the app's list of those is partial (CLAUDE.md,
// reference data is a positive resolver). A warning that stays visible is
// enough to explain a blank canvas.
// ---------------------------------------------------------------------------

/**
 * Why a name has no value at the settings being previewed, read off the
 * parser's own symbol table, which lists every `#const` and `#define` in the
 * script whichever branch it sits in.
 *
 * - `notInScript`, nothing in the script defines it.
 * - `defineOnly`, only a `#define`, which is a label with no number.
 * - `conditional`, every `#const` for it sits inside an `if` or
 *   `start_random` branch, and none of them was taken this time.
 * - `noNumber`, an unconditional `#const` whose value is not a number here,
 *   such as a terrain name alias.
 */
export type UnknownNameReason =
  "notInScript" | "defineOnly" | "conditional" | "noNumber";

export interface UnknownName {
  name: string;
  reason: UnknownNameReason;
}

/** Every name in `source` that `resolveSym` has no value for, once each in order of first use, with why. Empty when the text does not parse, since the parse error is already shown. A random parameter's label is bound first and never reported. */
export function findUnknownNames(
  source: string,
  resolveSym: (name: string) => number | undefined,
  params: FormulaParamEnv,
  scriptSymbols: readonly SymbolInfo[],
): UnknownName[] {
  const parsed = parseFormula(source);
  if (!parsed.ok) return [];
  const names: string[] = [];
  const collect = (e: Expr): void => {
    switch (e.k) {
      case "sym":
        if (!names.includes(e.name)) names.push(e.name);
        return;
      case "neg":
      case "sin":
      case "cos":
        collect(e.e);
        return;
      case "bin":
        collect(e.l);
        collect(e.r);
        return;
      default:
        return;
    }
  };
  collect(bindParamLabels(parsed.expr, params.idByLabel));
  return names
    .filter((name) => resolveSym(name) === undefined)
    .map((name) => ({ name, reason: unknownNameReason(name, scriptSymbols) }));
}

function unknownNameReason(
  name: string,
  scriptSymbols: readonly SymbolInfo[],
): UnknownNameReason {
  const defs = scriptSymbols.filter((s) => s.name === name);
  const consts = defs.filter((s) => s.directiveKind === "const");
  if (consts.length === 0)
    return defs.length > 0 ? "defineOnly" : "notInScript";
  return consts.every((c) => c.conditionalDepth > 0)
    ? "conditional"
    : "noNumber";
}

/**
 * The sentence shown under the box. "Cannot draw this layout" is measured,
 * not guessed. An unknown name as the whole value, first in a sum or last
 * in one fails the whole dry run each time, so the canvas draws nothing
 * (formulaField.test.ts pins all three).
 */
export function describeUnknownName({ name, reason }: UnknownName): string {
  const effect = "the preview cannot draw this layout";
  switch (reason) {
    case "notInScript":
      return `No #const in this script is named ${name}, so ${effect}. Check the spelling, or define it with #const.`;
    case "defineOnly":
      return `${name} is a #define label, which has no number, so ${effect}. Give it a value with #const to use it here.`;
    case "conditional":
      return `${name} is only defined inside an if or start_random branch that is not taken at the settings being previewed, so ${effect}. In game it is undefined wherever that branch is not taken.`;
    case "noNumber":
      return `${name} is defined in this script but has no number at the settings being previewed, so ${effect}.`;
  }
}
