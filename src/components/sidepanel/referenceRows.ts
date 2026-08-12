// Row ordering and Find matching for the side panel's reference table.
//
// Pure and React-free for the same reason sidePanelLayout.ts is: the component
// itself cannot be rendered outside the Tauri host (see CLAUDE.md's sandbox
// caveats), so anything left inside ReferenceTable.tsx has no automated
// coverage at all. Both of these are ordinary functions over plain data, which
// makes them the part that CAN be gated.

import type { GameConstantEntry } from "../../breakdown/gameConstants";

/**
 * Descriptive name, then RMS constant, then constant id.
 *
 * All three tiers earn their place, which is why this is not just a name sort.
 * Both tables carry genuine ALIASES — 450 is both MARLIN1 and
 * GREAT_FISH_MARLIN, 457 both TUNA and FISH_TUNA — so "Marlin" and "Tuna" each
 * appear twice under identical descriptive names, and the second tier is what
 * decides those pairs. The third separates rows sharing a name AND a constant,
 * which nothing does today; it is there so the order is TOTAL, since a
 * comparator returning 0 for two distinct rows hands their order to the sort's
 * stability rather than to this rule.
 *
 * Terrain gives the third tier work that objects do not: 53 of its 131 rows
 * have no constant at all, so ties on the first two tiers are routine there.
 */
export function compareConstantRows(a: GameConstantEntry, b: GameConstantEntry): number {
  const byName = a.descriptiveName.localeCompare(b.descriptiveName);
  if (byName !== 0) return byName;

  const byConstant = (a.rmsConstant ?? "").localeCompare(b.rmsConstant ?? "");
  if (byConstant !== 0) return byConstant;

  // A missing id sorts last rather than first. Written out instead of
  // `(a.constId ?? Infinity) - (b.constId ?? Infinity)` because that
  // subtraction is NaN when BOTH are null, and a comparator returning NaN does
  // not throw — it silently leaves the array in whatever order the sort
  // happened to reach.
  const aId = a.constId ?? Number.POSITIVE_INFINITY;
  const bId = b.constId ?? Number.POSITIVE_INFINITY;
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

/**
 * Case-insensitive substring match across every field a row displays.
 *
 * Deliberately not fuzzy and not prefix-anchored: this panel answers "what was
 * that terrain called again", and the useful query is a fragment from the
 * middle of a name ("snow", "fish", "connect"). An empty query matches
 * everything, so the caller needs no special case for the unfiltered table.
 */
export function matchesQuery(query: string, fields: (string | number | null | undefined)[]): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return fields.some((f) => f !== null && f !== undefined && String(f).toLowerCase().includes(needle));
}
