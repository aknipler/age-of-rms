/**
 * One AST walk over a whole `ParseResult`, shared by every Sec.3 check that
 * needs to descend the tree (consistency-checker-design.md Sec.7.0 item 5).
 *
 * **UNCONDITIONALLY GENEROUS. Every caller filters.** This walker visits
 * every item everywhere: both `if`/`elseif`/`else` branches whether or not S0
 * would select them, every `start_random` branch whether or not a draw would
 * pick it, and everything nested inside an `OrphanBlockNode` (a shared block,
 * Sec.3.0b), which `instantiate.ts` deliberately does not descend into. Three
 * named callers want three different branch policies over the same tree
 * (Sec.3.2's declaration side wants every branch; Sec.3.3's terrain surface
 * wants `start_random` fully but `if` only as selected; Sec.3.2's reference
 * side wants shared blocks only in taken branches), and teaching the walker
 * any one of those policies would mean knowing which branch S0 selected,
 * which couples a pure AST walk to the instantiation. So this file hands back
 * everything and every filtering decision lives in the caller that needs it.
 *
 * Checker-local rather than a `src/parser/` export: none of the five existing
 * item-recursions in this tree (`scriptStats.ts`'s `countItems`,
 * `validate.ts`, `resourceTotals.ts`, `objectInventory.ts`, `truncateAst.ts`)
 * carries either bit a Sec.3 check needs from its visitor, whether the item
 * sits inside a shared block, and what construct immediately encloses it,
 * which is the parameter-set argument for a sixth copy rather than a shared
 * export. Shape copied from `scriptStats.ts`'s `countItems` rather than
 * re-derived.
 */

import type {
  IfBranch,
  Item,
  ParseResult,
  RandomBranch,
} from "../parser/types";

/**
 * The construct an item sits directly inside. `"top"` covers both the
 * script's preamble and a section's own top level, callers that care about
 * the difference already have the section from `parse.script.sections`.
 */
export type EnclosingKind =
  | "top"
  | "commandBlock"
  | "ifBranch"
  | "randomPreamble"
  | "randomBranch"
  | "orphanBlock";

export interface WalkContext {
  /**
   * True once the walk has passed through at least one `OrphanBlockNode` to
   * reach this item, Sec.3.0b's shared blocks, invisible to
   * `instantiate.ts`. Stays true for everything nested further in, since a
   * command's own block inside a shared block is still only reachable
   * through it.
   */
  sharedBlock: boolean;
  /**
   * True once the walk has passed through at least one `RandomNode`'s
   * preamble or a branch to reach this item. Ancestry-tracked the same way
   * `sharedBlock` is, and for the same reason: `enclosing` alone only names
   * the IMMEDIATE parent, so a caller generous about `start_random` content
   * (Sec.3.3's terrain surface takes every branch, taken or not) needs this
   * to reach an attribute nested inside a COMMAND that itself sits inside a
   * random branch, `enclosing` there reads `"commandBlock"`, not
   * `"randomBranch"`, and a single-level check would silently exclude it.
   */
  insideRandom: boolean;
  enclosing: EnclosingKind;
  /**
   * The `if`/`start_random` branch this item sits directly in, present iff
   * `enclosing` is `"ifBranch"` or `"randomBranch"`. A caller that needs to
   * know whether S0 selected this branch correlates it against the
   * instantiation itself. The walker does not know and must not guess.
   */
  branch?: IfBranch | RandomBranch;
}

export type ItemVisitor = (item: Item, ctx: WalkContext) => void;

function walkList(
  items: readonly Item[],
  ctx: WalkContext,
  visit: ItemVisitor,
): void {
  for (const item of items) {
    visit(item, ctx);
    switch (item.kind) {
      case "command":
        if (item.block) {
          walkList(
            item.block.items,
            {
              sharedBlock: ctx.sharedBlock,
              insideRandom: ctx.insideRandom,
              enclosing: "commandBlock",
            },
            visit,
          );
        }
        break;
      case "if":
        for (const branch of item.branches) {
          walkList(
            branch.items,
            {
              sharedBlock: ctx.sharedBlock,
              insideRandom: ctx.insideRandom,
              enclosing: "ifBranch",
              branch,
            },
            visit,
          );
        }
        break;
      case "random":
        walkList(
          item.preamble,
          {
            sharedBlock: ctx.sharedBlock,
            insideRandom: true,
            enclosing: "randomPreamble",
          },
          visit,
        );
        for (const branch of item.branches) {
          walkList(
            branch.items,
            {
              sharedBlock: ctx.sharedBlock,
              insideRandom: true,
              enclosing: "randomBranch",
              branch,
            },
            visit,
          );
        }
        break;
      case "orphanBlock":
        walkList(
          item.block.items,
          {
            sharedBlock: true,
            insideRandom: ctx.insideRandom,
            enclosing: "orphanBlock",
          },
          visit,
        );
        break;
      case "attribute":
      case "directive":
      case "raw":
        break;
    }
  }
}

/** Visits every item in `parse.script.preamble` and every section, recursively, generous over both branch kinds and shared blocks, see the file header for why. */
export function walkItems(parse: ParseResult, visit: ItemVisitor): void {
  walkList(
    parse.script.preamble,
    { sharedBlock: false, insideRandom: false, enclosing: "top" },
    visit,
  );
  for (const section of parse.script.sections) {
    walkList(
      section.items,
      { sharedBlock: false, insideRandom: false, enclosing: "top" },
      visit,
    );
  }
}
