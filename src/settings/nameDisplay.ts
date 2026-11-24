// The "Shorten long #const / #define names" setting, split into a pure module
// so the rule can be unit-tested without a React tree or the Tauri store,
// same split as help/helpConstants.ts and sidepanel/sidePanelLayout.ts.

// Same store file as the help (1.7), generation (2.5) and side-panel (4.4)
// settings, different key. One settings.json for everything that is "how you
// want the app to behave".
export const APP_SETTINGS_STORE_FILE = "settings.json";
export const SHORTEN_LONG_NAMES_KEY = "shortenLongNames";

/** Off by default: names show in full until someone asks for them to be cut. */
export const DEFAULT_SHORTEN_LONG_NAMES = false;

export const SHORTEN_NAME_LENGTH_KEY = "shortenNameLength";

/** How much of a too-long name survives, before the ellipsis. */
export const SHORTENED_PREFIX_LENGTH = 3;
export const MIN_SHORTENED_PREFIX_LENGTH = 2;
export const MAX_SHORTENED_PREFIX_LENGTH = 12;

/** Characters the ellipsis form adds beyond the kept prefix. */
const ELLIPSIS_ALLOWANCE = 3;

/**
 * Names up to this length are shown in full: the kept prefix plus the three
 * characters the ellipsis form would save at the very least, so shortening
 * never produces something close to the original's length.
 */
export function nameLengthLimit(
  keep: number = SHORTENED_PREFIX_LENGTH,
): number {
  return keep + ELLIPSIS_ALLOWANCE;
}

/** Clamps a stored or typed value into the allowed range, whole numbers only. */
export function clampPrefixLength(value: number): number {
  if (!Number.isFinite(value)) return SHORTENED_PREFIX_LENGTH;
  return Math.min(
    MAX_SHORTENED_PREFIX_LENGTH,
    Math.max(MIN_SHORTENED_PREFIX_LENGTH, Math.round(value)),
  );
}

/**
 * `SHORE_FISH` -> `SHO…`, `GOLD` -> `GOLD`.
 *
 * A single character (U+2026) rather than three dots, so the shortened form is
 * four columns wide instead of six, shortening to something nearly as long as
 * the limit would defeat the point.
 *
 * Returns the name unchanged when it is short enough OR when the setting is
 * off, so callers never branch: `shortenName(name, enabled)` is always the
 * thing to display.
 */
export function shortenName(
  name: string,
  enabled: boolean,
  keep: number = SHORTENED_PREFIX_LENGTH,
): string {
  if (!enabled || name.length <= nameLengthLimit(keep)) return name;
  return `${name.slice(0, keep)}…`;
}

/** Whether `shortenName` would actually change this name, i.e. whether the full name still needs to be reachable somehow. */
export function isShortened(
  name: string,
  enabled: boolean,
  keep: number = SHORTENED_PREFIX_LENGTH,
): boolean {
  return enabled && name.length > nameLengthLimit(keep);
}
