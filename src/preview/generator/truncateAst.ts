// truncateAst() — docs/preview-design.md Sec.5's Current/Final cut point.
// PURE, same rule as the rest of src/preview/generator/**: no React, no
// Monaco, no Tauri, so it runs in the worker and in plain-Node Vitest.
//
// WHAT "CURRENT" MEANS, because two revisions of the spec got this wrong
// before it was pinned (Sec.5, DECIDED 2026-08-01). Current is NOT a stage
// snapshot. It is "generate as if everything after this point were commented
// out", which is a PREFIX OF THE SCRIPT, not a point in the pipeline — so it
// needs its own generation run over a truncated script, and both toggle
// positions run all of S0-S6.
//
// THE CUT IS A CHARACTER OFFSET, NOT A LINE (decided 2026-08-10, and it
// REPLACES Sec.5's line-granular rule — see this file's `truncateAst` doc for
// what changed and why the old rule was too coarse to be useful).
//
// WHY THE TREE IS CUT AND NOT THE TEXT (Sec.5 consequence 2, unchanged and
// now doing more work). Slicing `source` at the caret leaves an unterminated
// `create_land {` on most cursor positions in a real script, so the parser
// would report a syntax error on every second keystroke and the preview would
// flicker between valid and broken. Cutting the parsed tree instead means
// what comes out is always a well-formed script: a block the caret sits
// inside keeps its braces and loses only the attributes below the caret.
//
// WHERE THIS LIVES, since Sec.14's file layout predates it: `generator/`
// rather than beside `worker.ts`, because the eslint purity + determinism
// gate globs `src/preview/generator/**` and this transforms the same AST the
// stages consume. It is deliberately NOT called from `index.ts` — that
// file's own header pins the split ("`truncateAst()` belongs to whoever
// calls this twice, not here"), so `generatePreview` still takes one parse
// and knows nothing about Current.

import type { IfBranch, Item, ParseResult, RandomBranch, SectionNode, Token } from "../../parser/types";

/**
 * The 0-based line an offset falls on, given `ParseResult.lineOffsets`.
 *
 * Only the UI reads this now — the cut itself is an offset. It is what turns
 * a pinned offset into the "Pinned line 34" the button prints, so it still
 * has to agree with the gutter exactly.
 *
 * Binary search rather than the linear scan the four `*.measure.test.ts`
 * reporters each hand-roll: this one runs per render, not once per diagnostic
 * in a batch job.
 *
 * `lineOffsets` is ascending and always starts at 0 (the lexer emits `[0]`
 * even for empty input), so the answer is the last index whose value is
 * `<= offset` and there is always at least one.
 */
export function lineOfOffset(lineOffsets: readonly number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    // +1 before halving, so `low = mid` always makes progress and the loop
    // cannot spin forever on high === low + 1. The classic off-by-one in
    // this variant of the search.
    const mid = (low + high + 1) >> 1;
    if (lineOffsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Which offset Current actually cuts at, given the pin, the caret and the
 * document's length. `null` means "no cut", and Current then draws the whole
 * script.
 *
 * Sec.5: "The cut point is set explicitly rather than following the caret —
 * click a line, click the pin button... Unpinned, Current follows the
 * cursor." The pin wins whenever there is one, and that is the whole
 * precedence rule.
 *
 * Pure and exported for its own tests rather than living inline in
 * `PreviewCutContext`, the same split `sidePanelLayout.ts` already makes
 * against `SidePanelLayoutContext` — both cases here are the kind that only
 * ever go wrong once, in the app, with nothing to point at:
 *
 * - `??` and not `||`, because **offset 0 is a real position and a falsy
 *   one**. A pin at the very top of a script under `||` would silently fall
 *   through to the caret and look like a pin button that does not work.
 * - The clamp, because a document can shrink under a pin faster than the pin
 *   can be shifted (the pin follows edits, but a whole-file replacement — an
 *   Open — has nothing to shift through). Clamping to the end keeps a stale
 *   pin meaning "everything" instead of pointing past the text.
 */
export function resolveCutOffset(
  pinnedOffset: number | null,
  cursorOffset: number | null,
  sourceLength: number | null,
): number | null {
  if (pinnedOffset === null) return cursorOffset;
  if (sourceLength === null) return pinnedOffset;
  return Math.min(pinnedOffset, sourceLength);
}

/** Everything the recursion needs that isn't the node itself. */
interface CutContext {
  cut: number;
  tokens: readonly Token[];
}

/**
 * One list of items, cut at the caret.
 *
 * Three cases per item, and the middle one is the whole feature:
 *   - it ends before the caret → untouched;
 *   - it STRADDLES the caret → recurse, so a block keeps the attributes
 *     above the caret and drops the ones below;
 *   - it starts at or after the caret → dropped, along with everything after.
 *
 * "Starts AT the caret is dropped" makes the caret behave like the insertion
 * point it is: text before it exists, text after it does not. Park the caret
 * at the start of a line and that line is not in the preview yet; move one
 * character into it and it is.
 *
 * Returns the SAME array when nothing changed, at every level. That is what
 * lets `truncateAst` hand back the original `ParseResult` untouched, which is
 * what stops a cut below the end of the script costing a second generation.
 */
function truncateItems(items: Item[], ctx: CutContext): Item[] {
  let changed = false;
  const out: Item[] = [];
  for (const item of items) {
    if (item.span.start >= ctx.cut) {
      changed = true;
      continue;
    }
    if (item.span.end <= ctx.cut) {
      out.push(item);
      continue;
    }
    const truncated = truncateItem(item, ctx);
    if (truncated !== item) changed = true;
    out.push(truncated);
  }
  return changed ? out : items;
}

/**
 * The branches of an `if` or a `start_random`, cut at the caret.
 *
 * Generic over both because they are the same shape — a keyword token plus a
 * list of items — and differ only in which field names the keyword. A branch
 * whose keyword is below the caret has not been written yet and goes; the one
 * the caret is inside keeps the items above it.
 *
 * The first branch of a straddling `if` can never be dropped here: its
 * keyword IS the node's own span start, which the caller already established
 * is above the caret. So an `if` never comes out branchless by accident.
 */
function truncateBranches<B extends { items: Item[] }>(
  branches: B[],
  keywordToken: (branch: B) => number,
  ctx: CutContext,
): B[] {
  let changed = false;
  const out: B[] = [];
  for (const branch of branches) {
    if (ctx.tokens[keywordToken(branch)].start >= ctx.cut) {
      changed = true;
      continue;
    }
    const items = truncateItems(branch.items, ctx);
    if (items === branch.items) {
      out.push(branch);
    } else {
      changed = true;
      out.push({ ...branch, items });
    }
  }
  return changed ? out : branches;
}

/**
 * One item that the caret falls inside.
 *
 * Anything with a child item list recurses; everything else is a LEAF and
 * comes through whole. A leaf is all-or-nothing on purpose: the caret sitting
 * in the middle of `land_percent 20` cannot produce half an attribute, and
 * the attribute began before the caret, so it counts. (This is the case Sec.5
 * used to avoid by rounding the cut up to a whole top-level construct.)
 *
 * `block.close`, `endif` and `start_random`'s `end` are left pointing at
 * their real tokens even when the items between them are gone. They are
 * facts about the source, which is unchanged — see the span note in
 * `truncateAst`.
 */
function truncateItem(item: Item, ctx: CutContext): Item {
  switch (item.kind) {
    case "command": {
      if (item.block === undefined) return item;
      const items = truncateItems(item.block.items, ctx);
      return items === item.block.items ? item : { ...item, block: { ...item.block, items } };
    }
    case "orphanBlock": {
      const items = truncateItems(item.block.items, ctx);
      return items === item.block.items ? item : { ...item, block: { ...item.block, items } };
    }
    case "if": {
      const branches = truncateBranches<IfBranch>(item.branches, (branch) => branch.keyword, ctx);
      return branches === item.branches ? item : { ...item, branches };
    }
    case "random": {
      // The preamble runs unconditionally (instantiate.ts, Sec.3 rule 10), so
      // it is cut like any other item list rather than kept or dropped whole.
      const preamble = truncateItems(item.preamble, ctx);
      const branches = truncateBranches<RandomBranch>(
        item.branches,
        (branch) => branch.chanceKeyword,
        ctx,
      );
      if (preamble === item.preamble && branches === item.branches) return item;
      return { ...item, preamble, branches };
    }
    case "attribute":
    case "directive":
    case "raw":
      return item;
  }
}

/**
 * The script as it stands at `cutOffset`: everything strictly before the
 * caret, with the construct the caret is inside cut down rather than kept or
 * dropped whole.
 *
 * WHAT CHANGED FROM SEC.5, AND WHY (2026-08-10). Sec.5 specified a cut LINE,
 * with "a cursor inside a block includes that whole block" — so a caret three
 * attributes into a `create_land` drew the finished land, including the two
 * attributes below the caret that had not been written yet. On a real script
 * that is most of the time: the interesting constructs are blocks, and the
 * whole point of Current is watching one take shape. The cut is now the caret
 * OFFSET and the recursion goes all the way down, so the preview follows the
 * attribute being typed. What survives from the old rule is the part that
 * mattered — the tree is cut, never the text, so what reaches the generator
 * is always a well-formed script.
 *
 * Returns the SAME `parse` object when the cut drops nothing. That identity
 * is load-bearing, not a micro-optimisation: `usePreviewResult`'s effect keys
 * on the parse's reference, so a cut below the end of the script produces no
 * second generation at all rather than an identical one.
 */
export function truncateAst(parse: ParseResult, cutOffset: number): ParseResult {
  const ctx: CutContext = { cut: cutOffset, tokens: parse.tokens };

  const preamble = truncateItems(parse.script.preamble, ctx);

  let sectionsChanged = false;
  const sections: SectionNode[] = [];
  for (const section of parse.script.sections) {
    // A section header below the caret takes its whole section with it — the
    // author has not written that far yet.
    if (section.span.start >= ctx.cut) {
      sectionsChanged = true;
      continue;
    }
    const items = truncateItems(section.items, ctx);
    if (items === section.items) {
      sections.push(section);
    } else {
      sectionsChanged = true;
      sections.push({ ...section, items });
    }
  }

  if (preamble === parse.script.preamble && !sectionsChanged) return parse;

  // `tokens`, `lineOffsets`, `source`, `symbols`, `includes` and
  // `diagnostics` come through UNTOUCHED, and every retained node keeps its
  // original spans.
  //
  // Spans first: every span in the truncated tree still points at real text
  // in the real document, which is what `PreviewResult`'s `commandSpan`s are
  // for — a failure mark the user clicks has to select the line that caused
  // it. Rewriting a block's `close` to its last surviving item would
  // fabricate a document nobody wrote.
  //
  // `symbols` is the interesting one. Filtering it by position looks tidier
  // and would be wrong in exactly the case this function is built around: a
  // `#const` inside a block that opens above the caret and closes below it is
  // still in the retained tree, so a positionally-filtered symbol list would
  // disagree with the AST it travels with. Leaving it whole cannot cause that
  // disagreement, and nothing in the preview reads it — `instantiate.ts`
  // re-derives every `#define`/`#const` from its own walk of `script`
  // (Sec.3, rules 4-6), and `parse.tokens` is the only other field
  // `generatePreview` touches.
  return { ...parse, script: { preamble, sections } };
}
