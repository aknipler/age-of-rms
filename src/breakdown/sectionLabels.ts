// docs/breakdown-design.md §7 action item 3 / §3.1: a seven-entry
// constant→display-label map for the section sub-tabs. Zero occurrences of
// this in reference/data/language.json today, and the spec says a
// src/breakdown/ constant is fine ("unless a contributor-editable version
// is wanted, in which case reference/data") — a fixed set of 7 English UI
// labels doesn't need to be contributor-data, so it lives here.
//
// Canonical order matches reference/data/language.json's `sections[]`
// array exactly (verified: PLAYER_SETUP, LAND_GENERATION,
// ELEVATION_GENERATION, CLIFF_GENERATION, TERRAIN_GENERATION,
// CONNECTION_GENERATION, OBJECTS_GENERATION). Breakdown-design.md §3.1
// pins the tab bar to *this* order and these labels — the mockup drew six
// tabs and conflated Terrain/Connection; the data (and this map) has seven.
export const SECTION_LABELS: Readonly<Record<string, string>> = {
  PLAYER_SETUP: "Player Setup",
  LAND_GENERATION: "Land",
  ELEVATION_GENERATION: "Elevation",
  CLIFF_GENERATION: "Cliff",
  TERRAIN_GENERATION: "Terrain",
  CONNECTION_GENERATION: "Terrain Connection",
  OBJECTS_GENERATION: "Objects",
};

/** Canonical section order, mirrors language.json's sections[] (do not reorder). */
export const CANONICAL_SECTION_ORDER: readonly string[] = [
  "PLAYER_SETUP",
  "LAND_GENERATION",
  "ELEVATION_GENERATION",
  "CLIFF_GENERATION",
  "TERRAIN_GENERATION",
  "CONNECTION_GENERATION",
  "OBJECTS_GENERATION",
];

export function sectionLabel(name: string): string {
  return SECTION_LABELS[name] ?? name;
}

/**
 * Fixed display number for the Header tab and each canonical section —
 * Ash's ask: tab numbering must be absolute (tied to the section's fixed
 * canonical position), not derived from which tabs happen to render. A
 * missing section (e.g. no <ELEVATION_GENERATION> in the file) still
 * shows an empty tab in its canonical slot (buildSectionTabs always
 * pushes all seven), so in practice numbering never actually shifts
 * today — but deriving it from array position was fragile (correct only
 * because nothing currently omits a canonical tab) and wrong the moment
 * anything did. This map is the actual fix: numbers come from identity,
 * not position, so the invariant holds even if that ever changes.
 */
export const SECTION_NUMBERS: Readonly<Record<string, number>> = {
  header: 0,
  PLAYER_SETUP: 1,
  LAND_GENERATION: 2,
  ELEVATION_GENERATION: 3,
  CLIFF_GENERATION: 4,
  TERRAIN_GENERATION: 5,
  CONNECTION_GENERATION: 6,
  OBJECTS_GENERATION: 7,
};
