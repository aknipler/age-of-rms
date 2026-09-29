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
  /**
   * The delete half of a `moveNode` (2026-09-18, breakdown-design Sec.4.12).
   * A move is one insert plus one removal, and both are expressed in the
   * SAME original coordinates as `edit`, never overlapping it. They are
   * pushed onto the Monaco model together as one undo entry, so Ctrl+Z
   * puts the card back in one step rather than leaving a duplicate
   * behind on the first press. Every other intent leaves this unset.
   *
   * A second field rather than `edits: TextEdit[]` because only one intent
   * needs two edits, every existing consumer reads `edit`, and a move's
   * caret belongs to its insert half. Naming the removal keeps that
   * asymmetry visible instead of hiding it in array order.
   */
  removal?: TextEdit;
  /**
   * A second insert somewhere else in the file, made in the same undo entry
   * (2026-09-28, the object player forests template). That template's
   * `create_object` goes where the user asked, and the `#const` and
   * `effect_amount` lines it depends on go to PLAYER_SETUP. Same contract
   * as `removal`, original coordinates, never overlapping `edit`, and the
   * caret still belongs to `edit`. Its own field rather than reusing
   * `removal`, since a consumer that reads `removal` as "the card left
   * from here" would be wrong about this one.
   */
  companion?: TextEdit;
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

/** Never the `{ expr: {...} }` shape itself, a whole-expression edit commits as its raw string (spec Sec.3.4, 2026-09-18). */
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
//
// `{ before: Item }` (2026-09-18, the reorder work): the mirror of `after`.
// A drop onto the top half of a card lands the moved card above it, and
// an item that is FIRST in its container has no previous sibling to be
// `after`, while the container-level targets above all APPEND. Offset is
// the anchor's own line start (ownLineInsert), so the anchor keeps its own
// line and indent and the new text takes the anchor's indent.
//
// `after`/`before` anchor on `InsertAnchor`, not `Item`, so a comment can be
// the thing a drop lands beside (a comment is trivia, Sec.2, and has no
// Item of its own). Both insert helpers in computeEdit.ts only ever read
// `.span` off the anchor, so the wider type costs nothing at the one place
// that consumes it.
export type InsertAnchor = Item | CommentRef;

export type InsertTarget =
  | { in: "section"; section: SectionNode }
  | { in: "block"; block: BlockNode }
  | { in: "branch"; branch: BranchRef }
  | { in: "preamble" }
  | { in: "newSection"; name: string }
  | { after: InsertAnchor }
  | { before: InsertAnchor };

export type EditIntent =
  | { kind: "setArgValue"; arg: ArgNode; value: ArgValueInput }
  | {
      kind: "addAttribute";
      target: AttributeTarget;
      name: string;
      value?: ArgValueInput[];
      /**
       * Insert the bare name with no argument placeholders at all. The
       * 2026-09-17 amendment to Sec.4.3, for constant-typed slots only:
       * a beginner read the `GRASS` placeholder as the app's choice, so
       * the row now starts empty (RMS0201 nudges until it is filled) and
       * `appendArg` supplies the value. Numeric slots keep their
       * placeholders, a `0` reads as a value and not as a decision.
       */
      bare?: boolean;
    }
  /**
   * Supplies a trailing argument an attribute is missing (the `bare` path
   * above, or a hand-written `terrain_type` with nothing after it).
   * Appends ` value` after the node's last token. Only trailing arguments
   * can be missing, the parser assigns positions left to right.
   */
  | {
      kind: "appendArg";
      node: AttributeNode;
      value: ArgValueInput;
      /**
       * Which argument position this value is for. Omitted means the next
       * one. Skipped positions between the last present argument and this
       * one are padded with their Sec.4.3 placeholders, so the value lands
       * in the slot the user filled and not the first empty one.
       */
      index?: number;
    }
  | {
      kind: "removeNode";
      node: AttributeNode | CommandNode | DirectiveNode | IfNode | RandomNode;
    }
  | { kind: "toggleFlag"; target: AttributeTarget; name: string; on: boolean }
  | { kind: "addCommand"; at: InsertTarget; name: string }
  // Object Templates (docs/object-templates-brief.md): inserts a whole
  // prepared multi-command RMS block at once, unlike addCommand's single
  // placeholder command. `text` is pre-rendered by
  // src/breakdown/templates/templates.ts using formatStyle's
  // reindentBlock convention (a leading tab per line marks one indent
  // level; computeEdit substitutes the file's own detected indent unit).
  // `caretOffset` is the offset within `text`, BEFORE reindenting, of the
  // first inserted command, always the start of a top-level (no leading
  // tab) line so reindenting cannot move it relative to its own line.
  // `setupText`, when present, is a second block in the same convention
  // that lands at the end of the last PLAYER_SETUP section (the preamble
  // if the file has none) as EditResult.companion.
  | {
      kind: "insertText";
      at: InsertTarget;
      text: string;
      caretOffset: number;
      setupText?: string;
    }
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
    }
  // ---- 2026-09-18, rearranging cards and creating control flow ----
  //
  // `moveNode` removes the card's own source text (its span, plus a same-line
  // trailing comment, which travels with the card the way a person
  // reading the file would expect) from where it is and inserts it at `to`, reindented from its old line's depth to the
  // destination's. The text is a SLICE of the source, never a re-render,
  // so the author's spacing, comments and attribute order survive the
  // trip (CLAUDE.md, never re-print code). The result carries both halves
  // (EditResult.removal). Refused (PatchError) when `to` lies inside the
  // node itself, since a conditional cannot be moved into its own branch,
  // and when the node is an unclosed if/start_random, whose span is only a
  // guess at where it ends.
  //
  // `node` widened to `DraggableCard` so a comment can drag too (comment
  // cards previously had no way to reorder at all). A CommentRef carries
  // only its own span, so it skips the closed-construct guard and the
  // trailing-comment glom entirely, computeEdit.ts's carriedRange returns
  // its span as is.
  | { kind: "moveNode"; node: DraggableCard; to: InsertTarget }
  // `duplicateNode` inserts the same slice right after the original
  // (`{ after: node }`), so the copy sits at the same depth and indent as
  // the original with no reindenting at all.
  | { kind: "duplicateNode"; node: RearrangeableNode }
  // `addControlFlow` inserts an empty `if TODO … endif` or `start_random …
  // percent_chance … end_random` skeleton at an InsertTarget, the way the
  // command picker hands out a bare command. `TODO` and the bare
  // percent_chance (no operand, 2026-09-18) are the same placeholders
  // addBranch uses, so a fresh conditional reads exactly like a fresh
  // elseif, and the caret lands on the placeholder (or, for percent_chance,
  // right after the keyword, see RandomCard.tsx's blank-with-hint field).
  | { kind: "addControlFlow"; at: InsertTarget; construct: "if" | "random" };

/**
 * The card kinds a person can move or duplicate: exactly the kinds that
 * carry their own Delete button (cardKind.ts's canDeleteItem). A stray
 * attribute, a shared block and a raw node are excluded for the same
 * reason they cannot be deleted from a card: their span is an
 * approximation of a construct the parser could not shape, so moving the
 * text is not guaranteed to move the meaning.
 */
export type RearrangeableNode =
  CommandNode | DirectiveNode | IfNode | RandomNode;

/**
 * A comment, addressed by its own span, standing in for an Item where a
 * comment can be dragged (moveNode) or dropped beside (InsertAnchor). Comments
 * are trivia (parser-design Sec.2) with no AST node of their own, so they
 * cannot join `RearrangeableNode` itself, every one of whose members is an
 * Item. `kind: "comment"` keeps it a plain discriminant alongside
 * CommandNode/DirectiveNode/IfNode/RandomNode's own `kind`, so a switch over
 * `DraggableCard["kind"]` narrows the same way a switch over Item already
 * does.
 */
export interface CommentRef {
  kind: "comment";
  span: Span;
}

/** Every card kind a drag can pick up: the four RearrangeableNode kinds plus a comment. */
export type DraggableCard = RearrangeableNode | CommentRef;

/**
 * Thrown for intents the UI is specified to suppress (unclosed containers,
 * Sec.4.5/Sec.4.10 guards) or that are structurally invalid. Not a crash: callers
 * (and the property-test generator) treat it as "this edit is unavailable".
 */
export class PatchError extends Error {}
