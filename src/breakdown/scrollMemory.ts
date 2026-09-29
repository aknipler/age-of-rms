// Scroll memory for the collapse strip (beta feedback 2026-09-17). Closing
// an open card from its left strip scrolls the list so the collapsed card
// sits at the top. Reopening it without having scrolled in between puts
// the viewport back where it was inside the card. Pure arithmetic over
// scrollTop and the card's offsetTop, kept out of React so the two rules
// can be tested without a DOM.

export interface CollapseMemory {
  /** Where the viewport sat relative to the card's top when it was collapsed (scrollTop minus the card's offsetTop). */
  delta: number;
  /** The container's scrollTop right after the collapse scroll settled. Reopening compares against this to tell "the user has not moved" from "the user scrolled away". */
  settledScrollTop: number | null;
}

/** Record the viewport's position inside the card at the moment it collapses. */
export function rememberCollapse(
  scrollTop: number,
  cardTop: number,
): CollapseMemory {
  return { delta: scrollTop - cardTop, settledScrollTop: null };
}

/**
 * The scrollTop that puts the viewport back where it was inside the card,
 * or null when the user has scrolled since collapsing (or the collapse
 * scroll never settled), in which case the reopen leaves the viewport
 * alone. A one-pixel tolerance absorbs sub-pixel rounding in scrollTop.
 */
export function restoreTarget(
  memory: CollapseMemory,
  currentScrollTop: number,
  cardTop: number,
): number | null {
  if (memory.settledScrollTop === null) return null;
  if (Math.abs(currentScrollTop - memory.settledScrollTop) > 1) return null;
  return Math.max(0, cardTop + memory.delta);
}
