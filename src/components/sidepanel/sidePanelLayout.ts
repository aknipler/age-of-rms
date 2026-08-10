// CREATION_PLAN 4.4 — the arithmetic behind the side panel's drag handle,
// kept out of the React component on purpose.
//
// Everything here is a pure function of numbers, so it runs unchanged in
// plain-Node Vitest. The component around it is the part that cannot be
// tested that way (no jsdom in this project), which is exactly why the rules
// worth asserting live on this side of the line — same split as
// generationSettings/teamModel.ts, whose model is pure so both the UI and the
// preview worker can read it.

/** 18rem at the browser's default 16px root size — the width 4.2 shipped. */
export const DEFAULT_SIDE_PANEL_WIDTH = 288;

/**
 * Below this the preview canvas stops being worth looking at and the
 * reference table's columns start wrapping mid-word. Dragging narrower than
 * this does not produce a narrower panel; it collapses (see
 * `resolveSidePanelDrag`).
 */
export const MIN_SIDE_PANEL_WIDTH = 200;

/**
 * A ceiling on the panel, not on the window. The "leave room for the editor"
 * rule is deliberately NOT here: it depends on the window's current width,
 * which this module cannot see and which changes without any drag happening.
 * It lives as `max-width: 70%` in MapSidePanel.module.css instead — one rule,
 * in the one place that always knows the answer. Two rules for one constraint
 * is how they drift apart.
 */
export const MAX_SIDE_PANEL_WIDTH = 720;

/**
 * How far past the minimum a drag has to go before it means "collapse"
 * rather than "as narrow as it goes".
 *
 * Without a margin, every drag that bottoms out at the minimum would collapse
 * the panel, which makes the minimum unreachable. With one, the panel sticks
 * at its minimum for a while and then goes away — the behaviour VS Code, the
 * JetBrains IDEs and Explorer's own splitters have all trained people to
 * expect.
 */
export const COLLAPSE_DRAG_MARGIN = 48;

/** One arrow-key press on the focused separator. */
export const SIDE_PANEL_KEYBOARD_STEP = 16;

/** Clamps to the panel's own bounds. Non-finite input falls back to the default. */
export function clampSidePanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDE_PANEL_WIDTH;
  return Math.round(Math.min(MAX_SIDE_PANEL_WIDTH, Math.max(MIN_SIDE_PANEL_WIDTH, width)));
}

/**
 * What a pointer at `rawWidth` pixels from the panel's left edge means.
 *
 * A discriminated union rather than a plain number plus a boolean, so a caller
 * cannot read a width out of a collapse — there is no width in that case, and
 * the type says so. (`width` does not exist on the collapsed member, so
 * `outcome.width` is a compile error until `outcome.collapsed` has been
 * narrowed.)
 */
export type SidePanelDragOutcome = { collapsed: true } | { collapsed: false; width: number };

export function resolveSidePanelDrag(rawWidth: number): SidePanelDragOutcome {
  if (Number.isFinite(rawWidth) && rawWidth < MIN_SIDE_PANEL_WIDTH - COLLAPSE_DRAG_MARGIN) {
    return { collapsed: true };
  }
  return { collapsed: false, width: clampSidePanelWidth(rawWidth) };
}

/**
 * Guards the persisted value on the way out of the Tauri store, the same way
 * `isMapSize`/`isPlayerCount` guard theirs. A store file is user-editable
 * text that survives across app versions, so what comes back is `unknown`
 * whatever the call site claims.
 */
export function isSidePanelWidth(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_SIDE_PANEL_WIDTH &&
    value <= MAX_SIDE_PANEL_WIDTH
  );
}
