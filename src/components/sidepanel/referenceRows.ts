// Row ordering and Find matching for the side panel's reference table.
//
// Pure and React-free for the same reason sidePanelLayout.ts is: the component
// itself cannot be rendered outside the Tauri host (see CLAUDE.md's sandbox
// caveats), so anything left inside ReferenceTable.tsx has no automated
// coverage at all. Both of these are ordinary functions over plain data, which
// makes them the part that CAN be gated.

import type { GameConstantEntry } from "../../breakdown/gameConstants";
import type { AttributeDef, CommandDef } from "../../parser/language";

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

/** A command row plus the attributes it should show nested underneath it. */
export interface CommandAttributeRow {
  command: CommandDef;
  /**
   * Every attribute the command accepts, when the query is empty OR the
   * command itself matched directly; narrowed to just the matching ones when
   * the command is only here BECAUSE one of its attributes matched.
   */
  attributes: AttributeDef[];
}

/**
 * Commands visible under the current Find query, each carrying the
 * attributes it should show nested underneath.
 *
 * Attribute rows only ever exist nested under a command in the reference
 * table, so a command stays in the list when EITHER it matches directly OR
 * one of its own attributes does — otherwise searching for an attribute name
 * (`terrain_to_place_on`) would have nothing to nest the hit under.
 *
 * Which attributes it carries depends on WHY it's in the list. A command
 * that matches directly (its own name/section/description) earns every one
 * of its attributes: the query already singled the command out, so also
 * narrowing its attribute list would hide the block the search was about —
 * searching "create_object" should open the whole thing, not just whichever
 * attribute happens to contain the letters "object". A command that only
 * matches THROUGH an attribute gets just the attributes that matched, since
 * that's the entire reason it's in the list at all.
 */
export function matchingCommandRows(
  commands: readonly CommandDef[],
  attributesByName: ReadonlyMap<string, AttributeDef>,
  query: string,
): CommandAttributeRow[] {
  const rows: CommandAttributeRow[] = [];
  for (const command of commands) {
    // Every command in language.json is something the engine runs — the
    // nonFunctional flag exists only on AttributeDef/DirectiveDef, for names
    // the engine carries as dead strings. No command is ever one of those,
    // but an attribute nested under a real command still can be, so that
    // half is worth filtering even though nothing does today.
    const allAttributes = (command.attributes ?? [])
      .map((name) => attributesByName.get(name))
      .filter((a): a is AttributeDef => a !== undefined && !a.nonFunctional);
    const commandMatches = matchesQuery(query, [command.name, command.section, command.description]);
    const attributes = commandMatches
      ? allAttributes
      : allAttributes.filter((a) => matchesQuery(query, [a.name, a.description]));
    if (commandMatches || attributes.length > 0) rows.push({ command, attributes });
  }
  return rows;
}

/**
 * Attributes no command's `attributes[]` names, minus the non-functional
 * ones. language.json's four legacy engine-ghost attributes are kept
 * resolvable there so RMS0310 can point at their working replacement, but
 * that is a diagnostics concern, not a reference-sheet one — a user reading
 * this table wants to know what RMS does, and a string the engine ignores
 * is not a usable answer to "what attributes exist". Everything else with
 * no command to nest under is listed on its own rather than left
 * unreachable from Find.
 */
export function orphanAttributeRows(
  commands: readonly CommandDef[],
  attributes: readonly AttributeDef[],
  query: string,
): AttributeDef[] {
  const referenced = new Set(commands.flatMap((c) => c.attributes ?? []));
  return attributes.filter(
    (a) => !referenced.has(a.name) && !a.nonFunctional && matchesQuery(query, [a.name, a.description]),
  );
}
