// Phase 3.3 — EditIntent/TextEdit/EditResult types, docs/breakdown-design.md §4.1 (rev 4).
// No React/Monaco/Tauri imports anywhere under src/breakdown/patch/ (spec §12).

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
} from "../../parser/types";

/** A byte-level change: replace source[start, end) with newText. start === end is an insertion. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface EditResult {
  edit: TextEdit;
  /** Post-edit caret offset in the NEW source (focus restoration, spec §6.3/§4.11). */
  caret: number;
}

/**
 * Branches are NOT independently addressable (no span/parent/index on
 * IfBranch/RandomBranch) — every branch intent carries parent + index.
 */
export interface BranchRef {
  parent: IfNode | RandomNode;
  index: number;
}

/** BlockNode when the command has a block; CommandNode when it has none (§4.6 brace synthesis). */
export type AttributeTarget = BlockNode | CommandNode;

/** never expr — expressions are Code-tab-only (spec §3.4). */
export type ArgValueInput = number | { rnd: [number, number] } | string;

// `{ after: Item }` (rev 3 dropped this as consumer-less; §3.9's card
// selection reinstates it — "add" now resolves to inserting after the
// selected card when something is selected, per docs/breakdown-design.md
// §3.9/§4.5). Anchor offset is the item's own `span.end` (not "start of
// the next sibling's line"), so a same-line trailing comment on the
// anchor stays attached to it — the insert mirrors §4.6's delete-time
// comment-adjacency rule. Style comes from the anchor item's own line,
// so a nested (in-branch/in-block) anchor inserts at that same depth
// with no special-casing — the anchor carries its context implicitly.
export type InsertTarget =
  | { in: "section"; section: SectionNode }
  | { in: "block"; block: BlockNode }
  | { in: "branch"; branch: BranchRef }
  | { after: Item };

export type EditIntent =
  | { kind: "setArgValue"; arg: ArgNode; value: ArgValueInput }
  | { kind: "addAttribute"; target: AttributeTarget; name: string; value?: ArgValueInput[] }
  | { kind: "removeNode"; node: AttributeNode | CommandNode | DirectiveNode | IfNode | RandomNode }
  | { kind: "toggleFlag"; target: AttributeTarget; name: string; on: boolean }
  | { kind: "addCommand"; at: InsertTarget; name: string }
  | { kind: "setCondition"; branch: BranchRef; value: string }
  | { kind: "setChance"; branch: BranchRef; value: ArgValueInput }
  | { kind: "addBranch"; parent: IfNode | RandomNode; branch: "elseif" | "else" | "percent_chance" }
  | { kind: "removeBranch"; branch: BranchRef }
  // 3.4 follow-up: widened from `node: RawNode` to also accept a def-less
  // CommandNode. §3.3's unknown-name boundary has TWO cases that both carry
  // a did-you-mean Diagnostic.suggestion — a bare unknown name (RawNode,
  // e.g. `elavation 5`) and a block-attached one (def-less CommandNode via
  // the word+`{` upgrade, e.g. `elavation { }`) — and the fix mechanics are
  // identical either way: replace the name token at tokenIndex. computeEdit
  // only ever reads node.firstToken/lastToken as bounds here, so no
  // computeEdit change was needed, just this type + the UI wiring
  // (previously only RawCard had a Fix button; CommandCard's unknown-name
  // badge had no fix path at all).
  | { kind: "applySuggestion"; node: RawNode | CommandNode; tokenIndex: number; replacement: string };

/**
 * Thrown for intents the UI is specified to suppress (unclosed containers,
 * §4.5/§4.10 guards) or that are structurally invalid. Not a crash: callers
 * (and the property-test generator) treat it as "this edit is unavailable".
 */
export class PatchError extends Error {}
