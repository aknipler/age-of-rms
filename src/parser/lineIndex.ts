// Offset -> line, the one place that conversion lives.
//
// The parser speaks in character offsets everywhere and that is right for a
// parser: spans compose, survive edits under `shiftPointThroughEdits`, and
// never need a re-index when a line wraps. It is wrong for a DIAGNOSTIC
// MESSAGE, which a person reads and then has to act on — "already set at
// offset 86970" names a position no editor displays and no author can find.
// Every message that points at a SECOND place in the file (the earlier
// definition, the open brace, the branch that already ran) resolves the line
// here first, while the span it highlights stays an offset.
//
// PURE, same rule as the rest of src/parser/**: no React, no Monaco, no Tauri.

/**
 * The 0-based line an offset falls on, given `ParseResult.lineOffsets`.
 *
 * Binary search rather than a linear scan: the preview's pin-line readout
 * calls it per render.
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
 * The 1-based line number an offset falls on — what a gutter shows, and the
 * only form that belongs in a message the user reads.
 *
 * Deliberately a separate export from `lineOfOffset` rather than a boolean
 * flag on it: the two callers want different bases and each is right, so the
 * `+ 1` happens once, here, instead of at every message site.
 */
export function lineNumberOfOffset(lineOffsets: readonly number[], offset: number): number {
  return lineOfOffset(lineOffsets, offset) + 1;
}
