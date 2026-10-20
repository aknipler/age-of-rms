// Pure scroll math for the Code tab's Cycle Tabs hotkey (Ctrl+Tab /
// Ctrl+Shift+Tab): jump so the next or previous <SECTION> header sits at the
// top of the editor. In pixels rather than line numbers because Monaco will
// not scroll past the end of the document here (scrollBeyondLastLine is off),
// so the last sections can never reach the top. A line-based version would
// pick the same header on every press and get stuck there.

/** Slack for the fractional scroll positions Monaco reports. */
const EPSILON = 1;

/**
 * The scrollTop to jump to, or `null` when the document has no sections.
 * `headerTops` are the sections' header line tops, ascending. Forward picks
 * the first header below the current top, backward the last one above it.
 * Past the end (or when already scrolled as far down as the editor allows)
 * it wraps to the other end, the same wrapping Breakdown's section tabs do.
 */
export function sectionJumpTop(
  headerTops: readonly number[],
  scrollTop: number,
  maxScrollTop: number,
  step: 1 | -1,
): number | null {
  if (headerTops.length === 0) return null;
  if (step === 1) {
    const atBottom = scrollTop >= maxScrollTop - EPSILON;
    const next = atBottom
      ? undefined
      : headerTops.find((top) => top > scrollTop + EPSILON);
    return next ?? headerTops[0];
  }
  for (let i = headerTops.length - 1; i >= 0; i--) {
    if (headerTops[i] < scrollTop - EPSILON) return headerTops[i];
  }
  return headerTops[headerTops.length - 1];
}
