// Row ordering and Find matching for the side panel's reference table.
//
// Pure and React-free for the same reason sidePanelLayout.ts is: the component
// itself cannot be rendered outside the Tauri host (see CLAUDE.md's sandbox
// caveats), so anything left inside ReferenceTable.tsx has no automated
// coverage at all. Both of these are ordinary functions over plain data, which
// makes them the part that CAN be gated.

import type { GameConstantEntry } from "../../breakdown/gameConstants";
import type { AttributeDef, CommandDef } from "../../parser/language";

/** Descriptive name tier, shared by every sort key as a tie-break or as the primary key. */
function byName(a: GameConstantEntry, b: GameConstantEntry): number {
  return a.descriptiveName.localeCompare(b.descriptiveName);
}

/** RMS-constant tier. Both tables carry genuine ALIASES, 450 is both MARLIN1
 * and GREAT_FISH_MARLIN, 457 both TUNA and FISH_TUNA, so this is what tells
 * those pairs apart when descriptive name ties. */
function byConstant(a: GameConstantEntry, b: GameConstantEntry): number {
  return (a.rmsConstant ?? "").localeCompare(b.rmsConstant ?? "");
}

/** Constant-id tier. A missing id sorts last rather than first. Written out
 * instead of `(a.constId ?? Infinity) - (b.constId ?? Infinity)` because that
 * subtraction is NaN when BOTH are null, and a comparator returning NaN does
 * not throw, it silently leaves the array in whatever order the sort
 * happened to reach. */
function byId(a: GameConstantEntry, b: GameConstantEntry): number {
  const aId = a.constId ?? Number.POSITIVE_INFINITY;
  const bId = b.constId ?? Number.POSITIVE_INFINITY;
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

/**
 * Descriptive name, then RMS constant, then constant id, the table's
 * long-standing default order.
 *
 * All three tiers earn their place, which is why this is not just a name
 * sort: the second tier is what separates the alias pairs above, and the
 * third catches rows sharing a name AND a constant (nothing does today, but
 * it is there so the order is TOTAL, since a comparator returning 0 for two
 * distinct rows hands their order to the sort's stability rather than to
 * this rule). Terrain gives the third tier work that objects do not: 53 of
 * its 131 rows have no constant at all, so ties on the first two tiers are
 * routine there.
 */
export function compareConstantRows(
  a: GameConstantEntry,
  b: GameConstantEntry,
): number {
  return byName(a, b) || byConstant(a, b) || byId(a, b);
}

/** The reference table's user-facing sort choices (beta feedback: "allow for different sorting filters"). */
export type ConstantSortKey = "name" | "constant" | "id";

export const CONSTANT_SORT_LABELS: Record<ConstantSortKey, string> = {
  name: "Descriptive Name",
  constant: "RMS Constant",
  id: "Const. ID#",
};

/**
 * `compareConstantRows` with the requested column moved to the front tier.
 *
 * Every key still falls through all three tiers, in some order, so the
 * result stays a TOTAL order under every choice: sorting by RMS Constant
 * only decides ties (53 of 131 terrain rows have none) by id then name
 * rather than leaving them in whatever order `.sort()` happened to produce.
 */
export function compareConstantRowsBy(
  sortKey: ConstantSortKey,
  a: GameConstantEntry,
  b: GameConstantEntry,
): number {
  switch (sortKey) {
    case "constant":
      return byConstant(a, b) || byId(a, b) || byName(a, b);
    case "id":
      return byId(a, b) || byName(a, b) || byConstant(a, b);
    case "name":
      return compareConstantRows(a, b);
  }
}

/**
 * Case-insensitive substring match across every field a row displays.
 *
 * Deliberately not fuzzy and not prefix-anchored: this panel answers "what was
 * that terrain called again", and the useful query is a fragment from the
 * middle of a name ("snow", "fish", "connect"). An empty query matches
 * everything, so the caller needs no special case for the unfiltered table.
 */
export function matchesQuery(
  query: string,
  fields: (string | number | null | undefined)[],
): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return fields.some(
    (f) =>
      f !== null && f !== undefined && String(f).toLowerCase().includes(needle),
  );
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
 * one of its own attributes does, otherwise searching for an attribute name
 * (`terrain_to_place_on`) would have nothing to nest the hit under.
 *
 * Which attributes it carries depends on WHY it's in the list. A command
 * that matches directly (its own name/section/description) earns every one
 * of its attributes: the query already singled the command out, so also
 * narrowing its attribute list would hide the block the search was about,
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
    // Every command in language.json is something the engine runs, the
    // nonFunctional flag exists only on AttributeDef/DirectiveDef, for names
    // the engine carries as dead strings. No command is ever one of those,
    // but an attribute nested under a real command still can be, so that
    // half is worth filtering even though nothing does today.
    const allAttributes = (command.attributes ?? [])
      .map((name) => attributesByName.get(name))
      .filter((a): a is AttributeDef => a !== undefined && !a.nonFunctional);
    const commandMatches = matchesQuery(query, [
      command.name,
      command.section,
      command.description,
    ]);
    const attributes = commandMatches
      ? allAttributes
      : allAttributes.filter((a) =>
          matchesQuery(query, [a.name, a.description]),
        );
    if (commandMatches || attributes.length > 0)
      rows.push({ command, attributes });
  }
  return rows;
}

/**
 * Attributes no command's `attributes[]` names, minus the non-functional
 * ones. language.json's four legacy engine-ghost attributes are kept
 * resolvable there so RMS0310 can point at their working replacement, but
 * that is a diagnostics concern, not a reference-sheet one, a user reading
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
    (a) =>
      !referenced.has(a.name) &&
      !a.nonFunctional &&
      matchesQuery(query, [a.name, a.description]),
  );
}

/** Which way a sorted table runs. Shared by every sort control in the side panel and the preview's Obj. List. */
export type SortDirection = "asc" | "desc";

/** The Commands / Attributes tab's sort choices. */
export type CommandSortKey = "section" | "name";

export const COMMAND_SORT_LABELS: Record<CommandSortKey, string> = {
  section: "Section",
  name: "Command",
};

/**
 * The Commands / Attributes rows in the chosen order.
 *
 * "section" groups commands by the order sections run in a script
 * (`sectionOrder`, language.json's own `sections`), and inside a section
 * keeps the order language.json lists them in, which follows the guide. A
 * section missing from `sectionOrder` sorts last rather than first.
 *
 * "name" sorts commands alphabetically and also sorts the attributes nested
 * under each one, since a reader who asked for alphabetical order is
 * scanning names, and a block's attributes in guide order would break that.
 * Under "section" the attributes keep their guide order.
 *
 * Descending reverses the whole list, the way the direction arrow does for
 * every other table here. Ties fall back to the input position, written out
 * rather than left to the sort's stability, so the comparator is a total
 * order on its own.
 */
export function sortCommandRows(
  rows: readonly CommandAttributeRow[],
  sortKey: CommandSortKey,
  direction: SortDirection,
  sectionOrder: readonly string[],
): CommandAttributeRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const rank = (section: string) => {
    const index = sectionOrder.indexOf(section);
    return index === -1 ? sectionOrder.length : index;
  };
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const primary =
      sortKey === "section"
        ? rank(a.row.command.section) - rank(b.row.command.section)
        : a.row.command.name.localeCompare(b.row.command.name);
    return sign * (primary || a.index - b.index);
  });
  return indexed.map(({ row }) =>
    sortKey === "name"
      ? { ...row, attributes: sortAttributesByName(row.attributes, direction) }
      : row,
  );
}

/**
 * Attributes sorted by name in the given direction. Used for the attributes
 * nested under a command and for the "Other attributes" rows when the
 * Commands tab is sorted by name. Copies first, since `.sort()` mutates and
 * these arrays can be language.json's own.
 */
export function sortAttributesByName(
  attributes: readonly AttributeDef[],
  direction: SortDirection,
): AttributeDef[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...attributes].sort((a, b) => sign * a.name.localeCompare(b.name));
}
