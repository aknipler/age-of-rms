/**
 * Ordering for the Add Command picker's search results. Pure, so it is
 * testable without rendering the picker.
 *
 * Matching alone is not enough: a query like "player" also hits every command
 * whose description merely mentions another command (create_land's text names
 * create_player_lands). With a plain alphabetical sort that description hit
 * landed above the command the person typed the name of. Results are grouped
 * by how strongly they match, and sorted by name within a group.
 */

/** Lower is a stronger match. */
const EXACT = 0;
const PREFIX = 1;
const IN_NAME = 2;
const IN_DESCRIPTION = 3;

interface Searchable {
  name: string;
  description?: string;
}

/**
 * How well `item` matches the already-lowercased, trimmed query, or null when
 * it does not match at all. An empty query matches everything equally, so the
 * list falls back to plain alphabetical order.
 */
export function matchRank(item: Searchable, q: string): number | null {
  if (!q) return EXACT;
  const name = item.name.toLowerCase();
  if (name === q) return EXACT;
  if (name.startsWith(q)) return PREFIX;
  if (name.includes(q)) return IN_NAME;
  if ((item.description ?? "").toLowerCase().includes(q)) return IN_DESCRIPTION;
  return null;
}

/** Filters to the matches and orders them: strongest match first, then by name. */
export function rankByQuery<T extends Searchable>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  const ranked: { item: T; rank: number }[] = [];
  for (const item of items) {
    const rank = matchRank(item, q);
    if (rank !== null) ranked.push({ item, rank });
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name),
  );
  return ranked.map((r) => r.item);
}
