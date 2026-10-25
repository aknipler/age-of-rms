// The pure half of the #const and #define table (cards/ConstTable.tsx), kept apart from
// the component so it can be tested without loading the card tree.

import type { DirectiveNode, Item, Token } from "../parser/types";

/** The directives that group into a table. */
const TABLE_DIRECTIVES = new Set(["#const", "#define"]);

/** One entry of a list as BlockList draws it, a lone card or a table of directive rows. */
export type ListSegment =
  | { kind: "item"; index: number }
  | { kind: "table"; first: number; last: number; directive: string };

function directiveName(item: Item, tokens: readonly Token[]): string | null {
  if (item.kind !== "directive") return null;
  const name = tokens[(item as DirectiveNode).hash].text;
  return TABLE_DIRECTIVES.has(name) ? name : null;
}

/**
 * Splits a list into lone cards and tables. A table is a run of the same
 * directive with no comment between its lines, since a comment card in the
 * middle of a table would have nowhere to draw. One line is a table
 * already, so it gets the add button.
 *
 * `hasGapAfter(i)` says whether comments sit between item i and item i + 1.
 */
export function segmentList(
  items: readonly Item[],
  tokens: readonly Token[],
  hasGapAfter: (index: number) => boolean,
): ListSegment[] {
  const out: ListSegment[] = [];
  let i = 0;
  while (i < items.length) {
    const name = directiveName(items[i], tokens);
    if (name === null) {
      out.push({ kind: "item", index: i });
      i++;
      continue;
    }
    let last = i;
    while (
      last + 1 < items.length &&
      !hasGapAfter(last) &&
      directiveName(items[last + 1], tokens) === name
    )
      last++;
    out.push({ kind: "table", first: i, last, directive: name });
    i = last + 1;
  }
  return out;
}

/** `base` (NEW_CONST, NEW_DEFINE), or `base`_2 and so on when that name is taken. */
export function freshTableName(
  base: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Where the name of the `#const NAME VALUE` line addConst wrote starts, given the caret it returns on VALUE. */
export function addedConstNameStart(caret: number, name: string): number {
  return caret - 1 - name.length;
}
