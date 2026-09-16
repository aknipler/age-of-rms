// The arithmetic behind the horizontal bar between the map preview and the
// reference table (beta feedback: "make it so the horizontal bar ... can be
// adjusted by the user, and fully closed in either direction"). Same split
// as sidePanelLayout.ts and for the same reason: this is a pure function of
// numbers, testable in plain Vitest, kept out of the React component that
// cannot be rendered outside the Tauri host (see CLAUDE.md's sandbox
// caveats).
//
// A FRACTION of the shared column's height, not a pixel height like the side
// panel's own width. The side panel's width is genuinely a fixed number of
// pixels the user picked, with a `max-width: 70%` in CSS covering the one
// thing that depends on the window. Preview and Reference share a column
// whose total height is "however tall the window's content area is today",
// which changes on every window resize, and a fraction of that answers "how
// should the two split the room" without needing to recompute anything when
// the room's size changes.

/** The preview's share of the split when both panes are shown. */
export const DEFAULT_PREVIEW_FRACTION = 0.55;

/**
 * Below this, a pane is too short to be worth looking at: for the preview,
 * shorter than its own canvas's `min-height: 9rem` (PreviewCanvas.module.css)
 * plus a control row; for the reference table, shorter than its find box and
 * one visible row. Dragging past this does not produce a shorter pane; it
 * collapses (see `resolvePreviewReferenceDrag`).
 */
export const MIN_PANE_FRACTION = 0.15;

/**
 * How far past the minimum a drag has to go before it means "collapse that
 * pane" rather than "as short as it goes". Same reasoning as
 * `sidePanelLayout.ts`'s `COLLAPSE_DRAG_MARGIN`: without a margin, every drag
 * that bottoms out at the minimum would collapse the pane, making the
 * minimum unreachable.
 */
export const COLLAPSE_DRAG_MARGIN = 0.05;

/** Clamps to the split's own bounds. Non-finite input falls back to the default. */
export function clampPreviewFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return DEFAULT_PREVIEW_FRACTION;
  return Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction));
}

/**
 * Which pane a drag has fully closed, or `null` while both are still shown.
 *
 * A discriminated union rather than a plain fraction plus a flag, same
 * reasoning as `SidePanelDragOutcome`: a caller cannot read a `fraction` out
 * of a collapsed outcome, there is no fraction in that case, and the type
 * says so.
 */
export type PreviewReferenceDragOutcome =
  | { collapsedSide: "preview" | "reference" }
  | { collapsedSide: null; fraction: number };

/**
 * What a pointer at `rawFraction` (0 = the split's top edge, 1 = its bottom
 * edge) means.
 *
 * Dragging the bar toward the TOP shrinks the preview toward nothing, so a
 * `rawFraction` below the margin collapses the preview and hands the
 * reference table the whole column; dragging toward the BOTTOM does the
 * opposite. Both collapse thresholds are checked against the same
 * `MIN_PANE_FRACTION`, so either pane is exactly as easy to close as the
 * other.
 */
export function resolvePreviewReferenceDrag(rawFraction: number): PreviewReferenceDragOutcome {
  if (!Number.isFinite(rawFraction)) return { collapsedSide: null, fraction: DEFAULT_PREVIEW_FRACTION };
  if (rawFraction < MIN_PANE_FRACTION - COLLAPSE_DRAG_MARGIN) return { collapsedSide: "preview" };
  if (rawFraction > 1 - MIN_PANE_FRACTION + COLLAPSE_DRAG_MARGIN) return { collapsedSide: "reference" };
  return { collapsedSide: null, fraction: clampPreviewFraction(rawFraction) };
}

/** Guards the persisted fraction on the way out of the Tauri store, the same way `isSidePanelWidth` guards its own. */
export function isPreviewFraction(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_PANE_FRACTION &&
    value <= 1 - MIN_PANE_FRACTION
  );
}

export type PreviewReferenceCollapsedSide = "preview" | "reference" | null;

/** Guards the persisted collapsed side. `null` is a real, storable state here (both panes shown), unlike the side panel's plain boolean. */
export function isPreviewReferenceCollapsedSide(value: unknown): value is PreviewReferenceCollapsedSide {
  return value === "preview" || value === "reference" || value === null;
}
