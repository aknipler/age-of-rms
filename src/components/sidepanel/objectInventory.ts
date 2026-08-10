import type { Item, ParseResult, ScriptNode } from "../../parser/types";
import type { PlacedObject } from "../../preview/generator/types";

/**
 * One row of the Preview Obj. List: an object the script names, and how many
 * of it the current generation actually put on the map.
 */
export interface ObjectInventoryRow {
  /** The RMS constant name exactly as the script wrote it. */
  objectRef: string;
  /** How many of this object the last generation placed. 0 is a real, interesting answer. */
  spawned: number;
}

/**
 * Names collected from the script itself, NOT from the placed objects.
 *
 * The distinction is the entire value of this table. `result.objects` only
 * knows what made it onto the map, so an object the script asks for and the
 * generator never places — the common symptom of a terrain restriction or a
 * distance band nothing satisfies — would simply be absent, which reads as
 * "the table doesn't list it" rather than "it spawned zero times". Walking the
 * AST is what lets a row say 0.
 *
 * Four places name an object, and the fourth is easy to miss:
 *   `create_object X`                      the ordinary case
 *   `add_object X`                         inside a `create_object_group`
 *   `second_object X`                      guide:2211's placeholder idiom, where
 *                                          the SECOND object is the one the
 *                                          author cares about
 *   `create_object G` where G is a group   NOT an object — excluded below
 *
 * That last exclusion is why group names are collected in the same pass: a
 * `create_object_group` declares a name that is then written in `create_object`
 * position, and listing it would put a row in the table that can never spawn
 * anything under its own name (the placements carry the MEMBER's name).
 */
function collectScriptObjectNames(parse: ParseResult): Set<string> {
  const named = new Set<string>();
  const groupNames = new Set<string>();

  const nameOf = (tokenIndex: number): string | undefined => parse.tokens[tokenIndex]?.text;
  const firstArg = (args: { value: unknown }[]): string | undefined =>
    typeof args[0]?.value === "string" ? args[0].value : undefined;

  function walk(items: readonly Item[]): void {
    for (const item of items) {
      switch (item.kind) {
        case "command": {
          const name = nameOf(item.name);
          const arg = firstArg(item.args);
          if (arg !== undefined) {
            if (name === "create_object_group") groupNames.add(arg);
            else if (name === "create_object") named.add(arg);
          }
          if (item.block) walk(item.block.items);
          break;
        }
        case "attribute": {
          const name = nameOf(item.name);
          const arg = firstArg(item.args);
          if (arg !== undefined && (name === "add_object" || name === "second_object")) named.add(arg);
          break;
        }
        // Branch CONTENTS, not branch selection: this table is about what the
        // script mentions, so every branch counts even though a given
        // generation runs only one of them. A name that only appears inside a
        // `percent_chance 5` is exactly the one worth being able to find.
        case "if":
          for (const branch of item.branches) walk(branch.items);
          break;
        case "random":
          walk(item.preamble);
          for (const branch of item.branches) walk(branch.items);
          break;
        case "orphanBlock":
          walk(item.block.items);
          break;
        default:
          break;
      }
    }
  }

  const script: ScriptNode = parse.script;
  walk(script.preamble);
  for (const section of script.sections) walk(section.items);

  for (const group of groupNames) named.delete(group);
  return named;
}

/** How many of each object the generation placed, keyed by the name as written. */
export function tallySpawned(objects: readonly PlacedObject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(object.objectRef, (counts.get(object.objectRef) ?? 0) + 1);
  return counts;
}

/**
 * The table's rows: every object the script names, unioned with everything the
 * generation actually placed.
 *
 * The union matters in one direction only, and it is a safety property rather
 * than a nicety — the visibility checkboxes are keyed on these rows, so
 * anything drawable that never got a row would be permanently unhideable. A
 * placed object with no matching script name is possible whenever the walk
 * above and the generator disagree about how a name was reached; listing it
 * keeps the control complete instead of silently correct-looking.
 *
 * Sorted by NAME, not by count. The counts change on every re-roll, and a
 * table that reorders itself under the pointer is unusable for the thing it
 * exists for (finding one object and unticking it).
 */
export function buildObjectInventory(
  parse: ParseResult | null,
  placed: readonly PlacedObject[],
): ObjectInventoryRow[] {
  const counts = tallySpawned(placed);
  const names = parse === null ? new Set<string>() : collectScriptObjectNames(parse);
  for (const name of counts.keys()) names.add(name);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((objectRef) => ({ objectRef, spawned: counts.get(objectRef) ?? 0 }));
}
