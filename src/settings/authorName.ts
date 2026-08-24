// The "Author name" setting — the one piece of the stamped script header
// (src/hooks/scriptHeader.ts) the app cannot work out for itself.
//
// Its own module rather than another constant in nameDisplay.ts: that file is
// about how a #const name is DISPLAYED, and the two share nothing but the
// store file. Same split-by-subject reasoning AppSettingsContext.tsx gives for
// being a third context instead of a field on the help one.

// Re-exported from nameDisplay.ts, which owns the constant, so a caller that
// only cares about the author name does not have to import a module about
// name shortening to find out where it is stored.
export { APP_SETTINGS_STORE_FILE } from "./nameDisplay";

export const AUTHOR_NAME_KEY = "authorName";

/**
 * Empty, not a guess at the user's name.
 *
 * The header prints `Unknown` for a blank author (scriptHeader.ts's
 * UNKNOWN_AUTHOR), which is honest. Seeding it from the Windows account name
 * would be a better first impression and a worse default: the account name is
 * frequently a real full name, the header is written into a file people
 * publish, and nobody would have been asked.
 */
export const DEFAULT_AUTHOR_NAME = "";

/** Longer than any name worth putting in a one-line header field; stops a paste from turning the box inside out. */
export const AUTHOR_NAME_MAX_LENGTH = 60;
