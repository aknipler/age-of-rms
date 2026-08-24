// The app's rebindable keyboard shortcuts. Pure and React/Tauri-free for the
// same reason nameDisplay.ts is: the matching and formatting rules are
// ordinary functions over plain data, so they can be unit-tested directly
// instead of only through a mounted component. Save was the first one built
// (SAVE_HOTKEY_KEY predates the others and keeps its original store key so an
// already-customized binding survives); the rest followed the same shape.

export const SAVE_HOTKEY_KEY = "saveHotkey";

/**
 * A single key combination. `key` is always `KeyboardEvent.key.toLowerCase()`
 * — lowercased so `s` and Shift+`s` (which the browser reports as `"S"`)
 * compare equal on the base key, with Shift tracked separately as its own
 * modifier instead.
 */
export interface Hotkey {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const DEFAULT_SAVE_HOTKEY: Hotkey = { key: "s", ctrl: true, shift: false, alt: false };

/**
 * Every rebindable action in the app. One-handed by design (CLAUDE.md's
 * hotkey principle, established the day this list grew past Save): every
 * default below is a left-hand-reachable key (digits and QWERTY's left
 * three rows) paired with Ctrl and/or Alt, chosen so a mouse hand never has
 * to leave the mouse. `o` — under the right hand — is otherwise off limits,
 * with exactly one deliberate exception: Open stays `Ctrl+O`, because that
 * binding is so close to a universal OS convention that fighting it would
 * cost more muscle memory than the one-handed rule is worth.
 *
 * File actions use bare Ctrl (matching Save, the original binding); the
 * Preview and Breakdown actions use Ctrl+Alt so their namespace can't
 * collide with a future File action reusing the same base letter.
 */
export type HotkeyId =
  | "save"
  | "newFile"
  | "openFile"
  | "previewToggleView"
  | "previewReseed"
  | "breakdownDeleteCard"
  | "breakdownAddCommand";

export const DEFAULT_HOTKEYS: Record<HotkeyId, Hotkey> = {
  save: DEFAULT_SAVE_HOTKEY,
  newFile: { key: "n", ctrl: true, shift: false, alt: false },
  openFile: { key: "o", ctrl: true, shift: false, alt: false },
  previewToggleView: { key: "v", ctrl: true, shift: false, alt: true },
  previewReseed: { key: "r", ctrl: true, shift: false, alt: false },
  breakdownDeleteCard: { key: "d", ctrl: true, shift: false, alt: true },
  breakdownAddCommand: { key: "a", ctrl: true, shift: false, alt: true },
};

/** Where each binding is persisted in the app-settings store — see HotkeySettingsContext.tsx. */
export const HOTKEY_STORE_KEYS: Record<HotkeyId, string> = {
  save: SAVE_HOTKEY_KEY,
  newFile: "newFileHotkey",
  openFile: "openFileHotkey",
  previewToggleView: "previewToggleViewHotkey",
  previewReseed: "previewReseedHotkey",
  breakdownDeleteCard: "breakdownDeleteCardHotkey",
  breakdownAddCommand: "breakdownAddCommandHotkey",
};

/** Type guard for whatever the store handed back — a corrupted or pre-feature settings.json must not crash startup. */
export function isHotkey(value: unknown): value is Hotkey {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    v.key.length > 0 &&
    typeof v.ctrl === "boolean" &&
    typeof v.shift === "boolean" &&
    typeof v.alt === "boolean"
  );
}

const NAMED_KEY_LABELS: Record<string, string> = {
  " ": "Space",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  delete: "Delete",
  backspace: "Backspace",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pagedown: "Page Down",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** How a binding's base key reads in the UI — `"s"` -> `"S"`, `"arrowleft"` -> `"←"`, `"f5"` -> `"F5"`. */
function keyLabel(key: string): string {
  const named = NAMED_KEY_LABELS[key];
  if (named) return named;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** `"Ctrl+S"`, `"Ctrl+Shift+S"` — how a binding is shown in the Settings dialog and the File menu. */
export function formatHotkey(hotkey: Hotkey): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push("Ctrl");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.shift) parts.push("Shift");
  parts.push(keyLabel(hotkey.key));
  return parts.join("+");
}

/** Whether two bindings are the same combination — used to decide whether "Reset to default" has anything to do. */
export function hotkeysEqual(a: Hotkey, b: Hotkey): boolean {
  return a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

/** Whether a live keydown is this binding being pressed. */
export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean {
  return (
    event.key.toLowerCase() === hotkey.key &&
    event.ctrlKey === hotkey.ctrl &&
    event.shiftKey === hotkey.shift &&
    event.altKey === hotkey.alt
  );
}

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "os"]);

/**
 * Turns a captured keydown into a new binding while the user is recording
 * one, or `null` when the press cannot become a binding:
 *
 * - a bare modifier (still being held down, nothing pressed with it yet)
 * - no Ctrl and no Alt held — Shift+letter and bare letters both type
 *   ordinary text everywhere else in the app (the Code tab, any search box),
 *   so allowing either as a whole binding would make typing "s" while
 *   Shift happened to be down, or typing in general, silently trigger Save.
 */
export function hotkeyFromEvent(event: KeyboardEvent): Hotkey | null {
  const key = event.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  if (!event.ctrlKey && !event.altKey) return null;
  return { key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
}
