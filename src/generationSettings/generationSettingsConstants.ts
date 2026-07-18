// Shared constants for the Phase 2.5 generation-settings pane (map size,
// player count). Same persistence file as HelpSettingsContext's
// helpConstants.ts (settings.json, per 1.7's precedent) — different keys,
// one store, so the app doesn't juggle multiple Tauri store files for
// what's conceptually all "app settings".

export const GENERATION_SETTINGS_STORE_FILE = "settings.json";
export const PLAYER_COUNT_KEY = "generationPlayerCount";
export const MAP_SIZE_KEY = "generationMapSize";

// AoE2:DE's standard map-size names, smallest to largest. Not consumed by
// resourceTotals.ts in v1 (only playerCount is, per Ash's locked 2.5
// decision) — persisted now so the preview/consistency-checker work
// (PLAN.md) has it ready to read later without another settings-plumbing
// pass.
export const MAP_SIZES = [
  "Tiny",
  "Small",
  "Medium",
  "Normal",
  "Large",
  "Giant",
  "Huge",
] as const;
export type MapSize = (typeof MAP_SIZES)[number];

export const DEFAULT_PLAYER_COUNT = 8;
export const DEFAULT_MAP_SIZE: MapSize = "Normal";

export const MIN_PLAYER_COUNT = 2;
export const MAX_PLAYER_COUNT = 8;

export function isMapSize(value: unknown): value is MapSize {
  return typeof value === "string" && (MAP_SIZES as readonly string[]).includes(value);
}

export function isPlayerCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PLAYER_COUNT &&
    value <= MAX_PLAYER_COUNT
  );
}
