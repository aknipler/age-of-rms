// Sec.3.9's selection resolution, kept pure/framework-free (same convention
// as attributeModel.ts / sectionTabsModel.ts / ephemeralAnchors.ts):
// resolves a source offset (the selection anchor, Sec.6.3-style) to the
// actual Item it currently points at, given the CURRENT ParseResult.
// This has to be re-resolved fresh on every use rather than cached on the
// intent, because Item objects don't survive a reparse, only offsets do.
import type { Item, RandomNode, ScriptNode } from "../parser/types";

/**
 * Resolves `offset` to the Item that owns it, descending into `IfNode`/
 * `RandomNode` branches (since those items are rendered as separately
 * selectable nested cards, Sec.3.5's fully-editable branches) but NOT into
 * a command's block/attributes or a raw/orphan region's contents, those
 * aren't independently selectable card-list items, so a click inside one
 * resolves to the enclosing card itself. Returns the DEEPEST such item,
 * "top-level-in-container", per Sec.3.9's own phrasing: a deep click (e.g.
 * on an attribute row inside a block) still resolves to the whole
 * command, never something inside its block, because descent stops at
 * the command node, it doesn't recurse into `command.block.items`.
 */
export function findItemAtOffset(
  items: readonly Item[],
  offset: number,
): Item | undefined {
  for (const item of items) {
    if (offset < item.span.start || offset >= item.span.end) continue;
    if (item.kind === "if") {
      for (const branch of item.branches) {
        const found = findItemAtOffset(branch.items, offset);
        if (found) return found;
      }
      return item; // offset inside the IfNode but not inside any branch's item list (e.g. on a condition token)
    }
    if (item.kind === "random") {
      const random = item as RandomNode;
      const foundPreamble = findItemAtOffset(random.preamble, offset);
      if (foundPreamble) return foundPreamble;
      for (const branch of random.branches) {
        const found = findItemAtOffset(branch.items, offset);
        if (found) return found;
      }
      return item;
    }
    return item;
  }
  return undefined;
}

/** Same resolution, starting from the whole script (preamble + every section), used when the caller doesn't already know which tab's items to search. */
export function findItemAtOffsetInScript(
  script: ScriptNode,
  offset: number,
): Item | undefined {
  const inPreamble = findItemAtOffset(script.preamble, offset);
  if (inPreamble) return inPreamble;
  for (const section of script.sections) {
    const found = findItemAtOffset(section.items, offset);
    if (found) return found;
  }
  return undefined;
}

/**
 * The list of items `item` sits in (a section body, the preamble, or one
 * branch of an if/start_random), or undefined when it is not a card-list
 * item at all. Same descent as findItemAtOffset, and for the same reason
 * (2026-09-18, the move-up/move-down hotkeys): a card's neighbours are the
 * cards rendered beside it, which is its own container's list, never a
 * parent's or a block's. Matched by identity, so this only answers for an
 * Item that came out of THIS script's parse.
 */
export function siblingsOf(
  script: ScriptNode,
  item: Item,
): readonly Item[] | undefined {
  const search = (items: readonly Item[]): readonly Item[] | undefined => {
    for (const candidate of items) {
      if (candidate === item) return items;
      if (candidate.span.start > item.span.start) break;
      if (candidate.span.end <= item.span.start) continue;
      if (candidate.kind === "if") {
        for (const branch of candidate.branches) {
          const found = search(branch.items);
          if (found) return found;
        }
      }
      if (candidate.kind === "random") {
        const found = search(candidate.preamble);
        if (found) return found;
        for (const branch of candidate.branches) {
          const inBranch = search(branch.items);
          if (inBranch) return inBranch;
        }
      }
    }
    return undefined;
  };
  const inPreamble = search(script.preamble);
  if (inPreamble) return inPreamble;
  for (const section of script.sections) {
    const found = search(section.items);
    if (found) return found;
  }
  return undefined;
}

/**
 * Where "move up" or "move down" puts a card, as an InsertTarget the
 * patch engine accepts, or undefined at the edge of its container. A move
 * never leaves the container it started in, since jumping out of a
 * branch on the tenth press of a key is the kind of surprise Sec.3.9's
 * selection rules exist to prevent. Dragging is the way across a boundary.
 */
export function siblingMoveTarget(
  script: ScriptNode,
  item: Item,
  direction: "up" | "down",
): { before: Item } | { after: Item } | undefined {
  const siblings = siblingsOf(script, item);
  if (!siblings) return undefined;
  const index = siblings.indexOf(item);
  if (direction === "up")
    return index > 0 ? { before: siblings[index - 1] } : undefined;
  return index < siblings.length - 1
    ? { after: siblings[index + 1] }
    : undefined;
}
