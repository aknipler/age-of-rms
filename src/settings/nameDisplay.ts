// The "Shorten long #const / #define names" setting, split into a pure module
// so the rule can be unit-tested without a React tree or the Tauri store —
// same split as help/helpConstants.ts and sidepanel/sidePanelLayout.ts.

// Same store file as the help (1.7), generation (2.5) and side-panel (4.4)
// settings, different key. One settings.json for everything that is "how you
// want the app to behave".
export const APP_SETTINGS_STORE_FILE = "settings.json";
export const SHORTEN_LONG_NAMES_KEY = "shortenLongNames";

/** On by default: the tile readout is a narrow column and a full RMS constant fills it on its own. */
export const DEFAULT_SHORTEN_LONG_NAMES = true;

/** Names up to this length are shown in full. */
export const NAME_LENGTH_LIMIT = 6;

/** How much of a too-long name survives, before the ellipsis. */
export const SHORTENED_PREFIX_LENGTH = 3;

/**
 * `SHORE_FISH` -> `SHO…`, `GOLD` -> `GOLD`.
 *
 * A single character (U+2026) rather than three dots, so the shortened form is
 * four columns wide instead of six — shortening to something nearly as long as
 * the limit would defeat the point.
 *
 * Returns the name unchanged when it is short enough OR when the setting is
 * off, so callers never branch: `shortenName(name, enabled)` is always the
 * thing to display.
 */
export function shortenName(name: string, enabled: boolean): string {
  if (!enabled || name.length <= NAME_LENGTH_LIMIT) return name;
  return `${name.slice(0, SHORTENED_PREFIX_LENGTH)}…`;
}

/** Whether `shortenName` would actually change this name — i.e. whether the full name still needs to be reachable somehow. */
export function isShortened(name: string, enabled: boolean): boolean {
  return enabled && name.length > NAME_LENGTH_LIMIT;
}
