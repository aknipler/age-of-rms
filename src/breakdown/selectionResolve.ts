// §3.9's selection resolution, kept pure/framework-free (same convention
// as attributeModel.ts / sectionTabsModel.ts / ephemeralAnchors.ts):
// resolves a source offset (the selection anchor, §6.3-style) to the
// actual Item it currently points at, given the CURRENT ParseResult.
// This has to be re-resolved fresh on every use rather than cached on the
// intent, because Item objects don't survive a reparse — only offsets do.
import type { Item, RandomNode, ScriptNode } from "../parser/types";

/**
 * Resolves `offset` to the Item that owns it, descending into `IfNode`/
 * `RandomNode` branches (since those items are rendered as separately
 * selectable nested cards, §3.5's fully-editable branches) but NOT into
 * a command's block/attributes or a raw/orphan region's contents — those
 * aren't independently selectable card-list items, so a click inside one
 * resolves to the enclosing card itself. Returns the DEEPEST such item —
 * "top-level-in-container", per §3.9's own phrasing: a deep click (e.g.
 * on an attribute row inside a block) still resolves to the whole
 * command, never something inside its block, because descent stops at
 * the command node — it doesn't recurse into `command.block.items`.
 */
export function findItemAtOffset(items: readonly Item[], offset: number): Item | undefined {
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

/** Same resolution, starting from the whole script (preamble + every section) — used when the caller doesn't already know which tab's items to search. */
export function findItemAtOffsetInScript(script: ScriptNode, offset: number): Item | undefined {
  const inPreamble = findItemAtOffset(script.preamble, offset);
  if (inPreamble) return inPreamble;
  for (const section of script.sections) {
    const found = findItemAtOffset(section.items, offset);
    if (found) return found;
  }
  return undefined;
}
