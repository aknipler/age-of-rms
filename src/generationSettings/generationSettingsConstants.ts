// Shared constants for the Phase 2.5 generation-settings pane (map size,
// player count). Same persistence file as HelpSettingsContext's
// helpConstants.ts (settings.json, per 1.7's precedent) — different keys,
// one store, so the app doesn't juggle multiple Tauri store files for
// what's conceptually all "app settings".

export const GENERATION_SETTINGS_STORE_FILE = "settings.json";
export const PLAYER_COUNT_KEY = "generationPlayerCount";
export const MAP_SIZE_KEY = "generationMapSize";
export const TEAMS_KEY = "generationTeams";
export const TEAM_PRESET_KEY = "generationTeamPreset";
export const TEAM_STASH_KEY = "generationTeamStash";

// AoE2:DE's standard map-size names, smallest to largest. Not consumed by
// resourceTotals.ts in v1 (only playerCount is) — persisted now so the preview/consistency-checker work
// (PLAN.md) has it ready to read later without another settings-plumbing
// pass.
// Ordered smallest to largest BY DIMENSION, which is not the order the names
// suggest: in-game Huge is 240x240 and Giant is 252x252, so Giant sorts last.
// This list had Giant before Huge until 2026-08-01 (preview-design Sec.15
// item 6). Only display order changes — the strings are the persisted values
// (MAP_SIZE_KEY) and nothing indexes into this array, so existing settings
// still load.
//
// Dimensions are NOT duplicated here on purpose. They live in
// `language.json`'s `predefinedLabels`, where every mapSize entry carries
// `dimensions` plus the matching value from this list, and the preview
// resolves size -> dim through that array (preview-design Sec.4). A second
// hand-typed copy is exactly how the legacy/modern label offset gets
// mis-transcribed.
//
// The offset is why "Huge is 240" cannot live here as a field: it is only true
// in one naming era. `HUGE_MAP` is 220 and `MAPSIZE_HUGE` is 240, both names
// for a size the app calls something else again. A `tiles: 240` here would read
// as true while contradicting data that is equally true, and nothing would
// distinguish them.
//
// What the split costs, and it is a real cost: the join is resolved at runtime
// and `dimensions` is optional on `PredefinedLabel`, so nothing in the type
// system guarantees a size has a dimension at all. `npm run validate:reference`
// pays for that at build time instead — it reads this array out of the source
// and asserts every size resolves, that the legacy and modern labels for one
// size agree on the number, that no label claims a size the picker does not
// offer, and that this array is still ascending by dimension. That last check
// is what makes the ordering comment above enforceable rather than aspirational.
export const MAP_SIZES = [
  "Tiny",
  "Small",
  "Medium",
  "Normal",
  "Large",
  "Huge",
  "Giant",
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

// ---------------------------------------------------------------------------
// Teams (preview-design.md Sec.3.1, Sec.15 item 4)
// ---------------------------------------------------------------------------

// A player's SELECTED team, matching the lobby. 0 means un-teamed and is the
// engine's own value for it, not a UI placeholder: assign_to's AT_TEAM
// argument documents "0 is for un-teamed players" (guide:1001; guide:1002 is
// the next bullet down, about negative values). The picker renders it as "-".
//
// Capped at 4 because the engine's label vocabulary is: predefinedLabels
// carries 0_TEAM_GAME..4_TEAM_GAME and PLAYERx_TEAM0..PLAYERx_TEAM4 and
// stops there. This is a union rather than `number` so a stray 5 can't reach
// teamModel.ts and silently produce a label that doesn't exist.
export type TeamNumber = 0 | 1 | 2 | 3 | 4;

export const NO_TEAM: TeamNumber = 0;
export const MAX_TEAM = 4;

// Always 8 entries, indexed player - 1, INDEPENDENT of playerCount. Lowering
// the player count hides rows but keeps their assignments, so raising it
// again restores what you had. The cost of that convenience is that every
// consumer must slice to playerCount first — players above the count are not
// in the game and must not appear in team sizes (teamModel.ts does this).
export const TEAM_SLOTS = MAX_PLAYER_COUNT;
export const DEFAULT_TEAMS: readonly TeamNumber[] = Object.freeze(
  new Array<TeamNumber>(TEAM_SLOTS).fill(NO_TEAM),
);

export function isTeamNumber(value: unknown): value is TeamNumber {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TEAM;
}

export function isTeams(value: unknown): value is TeamNumber[] {
  return Array.isArray(value) && value.length === TEAM_SLOTS && value.every(isTeamNumber);
}

export interface TeamPreset {
  id: string;
  label: string;
  /**
   * Player count the preset implies, or null to leave it alone. Only FFA is
   * null: "2v2" names a four-player lobby, but "FFA" is a statement about
   * teams at ANY count, so it must not pin one — and it is the reason the
   * player-count control stays enabled under FFA and locks under the others.
   */
  playerCount: number | null;
  teams: readonly TeamNumber[];
}

// Note 1v1 assigns teams 1 and 2 rather than leaving both players un-teamed.
// That mirrors the lobby, and it canonicalises to ZERO teams anyway, because
// a team of one is not a team (guide:1004). Both spellings therefore produce
// identical engine behaviour; this one matches what a player would set.
export const TEAM_PRESETS: readonly TeamPreset[] = Object.freeze([
  { id: "1v1", label: "1v1", playerCount: 2, teams: [1, 2, 0, 0, 0, 0, 0, 0] },
  { id: "2v2", label: "2v2", playerCount: 4, teams: [1, 2, 1, 2, 0, 0, 0, 0] },
  { id: "3v3", label: "3v3", playerCount: 6, teams: [1, 2, 1, 2, 1, 2, 0, 0] },
  { id: "4v4", label: "4v4", playerCount: 8, teams: [1, 2, 1, 2, 1, 2, 1, 2] },
  { id: "ffa", label: "FFA", playerCount: null, teams: DEFAULT_TEAMS },
] satisfies readonly TeamPreset[]);

export function findTeamPreset(id: string | null | undefined): TeamPreset | undefined {
  return id ? TEAM_PRESETS.find((preset) => preset.id === id) : undefined;
}

/** Left click advances, right click reverses; both wrap through - 1 2 3 4. */
export function cycleTeam(current: TeamNumber, step: 1 | -1): TeamNumber {
  const size = MAX_TEAM + 1;
  return (((current + step) % size) + size) % size as TeamNumber;
}
