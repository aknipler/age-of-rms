// Shared between the React-side HelpSettingsContext and the imperative
// Monaco hover provider (src/editor/aoe2RmsHover.ts) — both need to agree
// on the same persisted store file/key so they read/write the same
// setting instead of silently drifting apart.

export const HELP_STORE_FILE = "settings.json";
export const HELP_MODE_KEY = "helpMode";

export type HelpMode = "hover" | "alt-hover" | "off";

export const DEFAULT_HELP_MODE: HelpMode = "hover";

export function isHelpMode(value: unknown): value is HelpMode {
  return value === "hover" || value === "alt-hover" || value === "off";
}
