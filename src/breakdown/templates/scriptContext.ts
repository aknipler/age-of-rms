// What a template needs to know about the script it is going into, read off
// the parse. Pure, type-only parser imports, so it tests in plain Node like
// templates.ts. Kept apart from templates.ts because that module turns
// options into text and never looks at a script.

import type { Item, ParseResult } from "../../parser/types";

/**
 * Every item in document order, descending into command blocks and both
 * kinds of conditional. A generator (`function*`) rather than a function
 * returning an array, so a caller that only wants the first match stops
 * walking the moment it has one instead of flattening the whole tree first.
 */
function* walk(items: readonly Item[]): Generator<Item> {
  for (const item of items) {
    yield item;
    if (item.kind === "command" && item.block) yield* walk(item.block.items);
    else if (item.kind === "if")
      for (const branch of item.branches) yield* walk(branch.items);
    else if (item.kind === "random") {
      yield* walk(item.preamble);
      for (const branch of item.branches) yield* walk(branch.items);
    }
  }
}

/**
 * The terrain the script's create_player_lands paints, as the author wrote
 * it (a name or a bare id), or undefined when there is none to read. With
 * several (one per `if` branch, say) the first in the file wins, and the
 * dialog lets the user override it either way.
 *
 * Names are compared through `def` first so a `#const`-aliased command
 * still counts (BUG-005 piece 2), falling back to the token text for an
 * unresolved one.
 */
export function playerLandTerrain(result: ParseResult): string | undefined {
  const nameOf = (item: { name: number; def?: { name: string } }) =>
    item.def?.name ?? result.tokens[item.name]?.text;
  for (const section of result.script.sections) {
    if (section.name !== "LAND_GENERATION") continue;
    for (const item of walk(section.items)) {
      if (item.kind !== "command" || nameOf(item) !== "create_player_lands")
        continue;
      if (!item.block) continue;
      for (const inner of walk(item.block.items)) {
        if (inner.kind !== "attribute" || nameOf(inner) !== "terrain_type")
          continue;
        const arg = inner.args[0];
        if (!arg) continue;
        return result.source.slice(arg.span.start, arg.span.end);
      }
    }
  }
  return undefined;
}

/** Whether a `#const` or `#define` of this name appears anywhere in the script. */
export function definesSymbol(result: ParseResult, name: string): boolean {
  return result.symbols.some((s) => s.name === name);
}
