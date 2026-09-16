// Phase 3.3, EditIntent/TextEdit/EditResult types, docs/breakdown-design.md Sec.4.1 (rev 4).
// No React/Monaco/Tauri imports anywhere under src/breakdown/patch/ (spec Sec.12).

import type {
  ArgNode,
  AttributeNode,
  BlockNode,
  CommandNode,
  DirectiveNode,
  IfNode,
  Item,
  RandomNode,
  RawNode,
  SectionNode,
  Span,
} from "../../parser/types";

/** A byte-level change: replace source[start, end) with newText. start === end is an insertion. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface EditResult {
  edit: TextEdit;
  /** Post-edit caret offset in the NEW source (focus restoration, spec Sec.6.3/Sec.4.11). */
  caret: number;
}

/**
 * Branches are NOT independently addressable (no span/parent/index on
 * IfBranch/RandomBranch), every branch intent carries parent + index.
 */
export interface BranchRef {
  parent: IfNode | RandomNode;
  index: number;
}

/** BlockNode when the command has a block; CommandNode when it has none (Sec.4.6 brace synthesis). */
export type AttributeTarget = BlockNode | CommandNode;

/** never expr, expressions are Code-tab-only (spec Sec.3.4). */
export type ArgValueInput = number | { rnd: [number, number] } | string;

// `{ after: Item }` (rev 3 dropped this as consumer-less; Sec.3.9's card
// selection reinstates it, "add" now resolves to inserting after the
// selected card when something is selected, per docs/breakdown-design.md
// Sec.3.9/Sec.4.5). Anchor offset is the item's own `span.end` (not "start of
// the next sibling's line"), so a same-line trailing comment on the
// anchor stays attached to it, the insert mirrors Sec.4.6's delete-time
// comment-adjacency rule. Style comes from the anchor item's own line,
// so a nested (in-branch/in-block) anchor inserts at that same depth
// with no special-casing, the anchor carries its context implicitly.
// `{ in: "preamble" }`, the Header tab has no SectionNode at all
// (ScriptNode.preamble is a bare Item[]), so it can't carry a `section`
// the way the canonical tabs do. No payload needed: there is exactly one
// preamble per script, so computeEdit reads it straight off `result.script`.
//
// `{ in: "newSection"; name }`, a canonical tab (e.g. ELEVATION_GENERATION)
// that has no SectionNode in the file at all yet: there's no existing
// section or preamble item to anchor to, so the intent carries the tag name
// itself and computeEdit synthesizes `<name>` plus the rendered command as
// one insert (docs/build-log.md: sections run in the engine's canonical
// order regardless of file position, so there's no correctness requirement
// on WHERE the new tag lands, computeEdit appends it after everything else
// already in the file).
export type InsertTarget =
  | { in: "section"; section: SectionNode }
  | { in: "block"; block: BlockNode }
  | { in: "branch"; branch: BranchRef }
  | { in: "preamble" }
  | { in: "newSection"; name: string }
  | { after: Item };

export type EditIntent =
  | { kind: "setArgValue"; arg: ArgNode; value: ArgValueInput }
  | {
      kind: "addAttribute";
      target: AttributeTarget;
      name: string;
      value?: ArgValueInput[];
    }
  | {
      kind: "removeNode";
      node: AttributeNode | CommandNode | DirectiveNode | IfNode | RandomNode;
    }
  | { kind: "toggleFlag"; target: AttributeTarget; name: string; on: boolean }
  | { kind: "addCommand"; at: InsertTarget; name: string }
  // Comments are trivia (parser-design Sec.2), not AST nodes, so unlike
  // every other intent here this doesn't target or produce an Item. It
  // inserts a bare `/**/` at the same InsertTarget addCommand uses, and
  // BlockList picks the new span back up on reparse via comments.ts.
  | { kind: "addComment"; at: InsertTarget }
  // `innerSpan` is the content strictly between the `/*`/`*/` delimiters
  // (CommentCard computes it from its own outer comment span), so this
  // never has to know the delimiter width or reason about nesting depth,
  // it just replaces a span like setArgValue does. CommentCard rejects a
  // `text` containing `/*` or `*/` before this ever runs, since those
  // would change how many comments the source contains, which no other
  // intent here does either.
  | { kind: "editComment"; innerSpan: Span; text: string }
  | { kind: "setCondition"; branch: BranchRef; value: string }
  | { kind: "setChance"; branch: BranchRef; value: ArgValueInput }
  | {
      kind: "addBranch";
      parent: IfNode | RandomNode;
      branch: "elseif" | "else" | "percent_chance";
    }
  | { kind: "removeBranch"; branch: BranchRef }
  // 3.4 follow-up: widened from `node: RawNode` to also accept a def-less
  // CommandNode. Sec.3.3's unknown-name boundary has TWO cases that both carry
  // a did-you-mean Diagnostic.suggestion, a bare unknown name (RawNode,
  // e.g. `elavation 5`) and a block-attached one (def-less CommandNode via
  // the word+`{` upgrade, e.g. `elavation { }`), and the fix mechanics are
  // identical either way: replace the name token at tokenIndex. computeEdit
  // only ever reads node.firstToken/lastToken as bounds here, so no
  // computeEdit change was needed, just this type + the UI wiring
  // (previously only RawCard had a Fix button; CommandCard's unknown-name
  // badge had no fix path at all).
  | {
      kind: "applySuggestion";
      node: RawNode | CommandNode;
      tokenIndex: number;
      replacement: string;
    };

/**
 * Thrown for intents the UI is specified to suppress (unclosed containers,
 * Sec.4.5/Sec.4.10 guards) or that are structurally invalid. Not a crash: callers
 * (and the property-test generator) treat it as "this edit is unavailable".
 */
export class PatchError extends Error {}
