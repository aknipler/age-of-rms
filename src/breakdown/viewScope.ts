// Which section tabs Breakdown shows at once (2026-10-21, breakdown-design
// Sec.3.1.1). Each tab carries a checkbox. The checked sections render as
// one stacked list, so one checked tab is the old one-section view, every
// tab checked is the full script, and anything between is a chosen set
// (Land and Objects, say). Pure helpers first, then the session memory.

/**
 * The shown ids that exist in this file, in tab order. A remembered set can
 * name tabs this file lacks (an unknown section from another script), so it
 * is filtered rather than trusted, and an empty result falls back to the
 * first tab, which is what Breakdown showed before this feature existed.
 */
export function resolveShownIds(
  tabIds: readonly string[],
  remembered: readonly string[] | null,
): string[] {
  const kept = tabIds.filter((id) => remembered?.includes(id));
  if (kept.length > 0) return kept;
  return tabIds.length > 0 ? [tabIds[0]] : [];
}

/**
 * Clicking a tab's name. A tab already shown stays part of the set (the
 * pane scrolls to it). A tab not shown becomes the only one shown, so a
 * click on a faded tab does what a tab click always did.
 */
export function shownAfterTabClick(
  shown: readonly string[],
  id: string,
): string[] {
  return shown.includes(id) ? [...shown] : [id];
}

/**
 * Ticking or unticking a tab's checkbox. The last shown tab cannot be
 * unticked, an empty pane has nowhere to put an Add.
 */
export function shownAfterToggle(
  shown: readonly string[],
  id: string,
  tabIds: readonly string[],
): string[] {
  if (shown.includes(id)) {
    return shown.length > 1 ? shown.filter((s) => s !== id) : [...shown];
  }
  return tabIds.filter((t) => t === id || shown.includes(t));
}

// The session memory. A module-level variable, not React state in App and
// not the Tauri store. React state in BreakdownPane alone would be lost on
// every Breakdown to Code switch, since the pane unmounts. Lifting it to App
// would work, but nothing outside the pane reads it, and the request was to
// remember the choice for the session, which a store entry in settings.json
// would outlive. A module variable lives exactly as long as the page does,
// which in Tauri is one run of the app. React never re-renders from it; the
// pane copies it into its own state on mount and writes it back on change.
let rememberedShown: readonly string[] | null = null;
let rememberedFocus: string | null = null;

export function rememberedShownIds(): readonly string[] | null {
  return rememberedShown;
}

export function rememberShownIds(ids: readonly string[]): void {
  rememberedShown = ids;
}

export function rememberedFocusId(): string | null {
  return rememberedFocus;
}

export function rememberFocusId(id: string | null): void {
  rememberedFocus = id;
}
