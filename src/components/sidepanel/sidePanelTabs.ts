// The guard behind the map side panel's tab strip. Same split as
// sidePanelLayout.ts and for the same reason: a pure function of a plain
// value, testable in Vitest, kept out of React components that cannot render
// outside the Tauri host (see CLAUDE.md's sandbox caveats).
//
// This file replaces previewReferenceSplit.ts. The preview and the reference
// table used to share the panel's height through a draggable bar, a fraction
// and two collapse buttons. They are tabs now, and each fills the whole panel,
// so all of that went with the bar. The map canvas no longer has a height of
// its own either: it takes whatever the preview tab has left.

/** The two things the panel can show. The other one is hidden, not unmounted (see MapSidePanel). */
export type SidePanelTab = "preview" | "reference";

export const DEFAULT_SIDE_PANEL_TAB: SidePanelTab = "preview";

/** Guards the persisted tab on the way out of the Tauri store. A store file is user-editable, same reasoning as `isSidePanelWidth`. */
export function isSidePanelTab(value: unknown): value is SidePanelTab {
  return value === "preview" || value === "reference";
}
