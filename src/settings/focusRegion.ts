// Which part of the app a keyboard shortcut was pressed "in", for the tab
// cycling hotkeys that mean different things in different places (Ctrl+Tab
// swaps Preview/Reference in the side panel but steps Breakdown's sections
// everywhere else). The side panel marks itself `data-focus-region`; this
// answers whether a keydown belongs to it.
//
// The pressed key's target alone is not enough: the preview canvas takes
// clicks but not focus, so after clicking it the focused element is <body>,
// which says nothing. The last pointerdown/focusin is remembered for that
// case.

export const FOCUS_REGION_ATTR = "data-focus-region";
export const SIDE_PANEL_REGION = "side-panel";

let lastInSidePanel = false;

function inSidePanel(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${FOCUS_REGION_ATTR}="${SIDE_PANEL_REGION}"]`) !== null
  );
}

/** Starts remembering where the user last pointed or focused; returns the cleanup. */
export function trackFocusRegion(): () => void {
  const remember = (event: Event) => {
    lastInSidePanel = inSidePanel(event.target);
  };
  window.addEventListener("pointerdown", remember, true);
  window.addEventListener("focusin", remember, true);
  return () => {
    window.removeEventListener("pointerdown", remember, true);
    window.removeEventListener("focusin", remember, true);
  };
}

/** Whether a keydown was pressed with focus in the side panel (Preview / Reference). */
export function isSidePanelKeyEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  const unfocused =
    target === document.body || target === document.documentElement;
  return unfocused ? lastInSidePanel : inSidePanel(target);
}
