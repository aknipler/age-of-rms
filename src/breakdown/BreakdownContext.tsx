import { createContext, useContext, type ReactNode } from "react";
import type {
  Diagnostic,
  Item,
  ParseResult,
  Span,
  Token,
} from "../parser/types";
import type { LanguageIndex } from "../parser/language";
import type { GameConstantsData } from "./gameConstants";
import type {
  CommentRef,
  DraggableCard,
  EditIntent,
  EditResult,
  InsertTarget,
  RearrangeableNode,
} from "./patch/intents";
import type { ClickMode, SelectableCard } from "./multiSelect";

/**
 * A name the person just committed in a value field (docs/name-lookup-design.md
 * Sec.6.1 and Sec.7.2). It is what lets the field flash, or show the create
 * strip, once the parse of the edited source has rendered.
 *
 * Pane state rather than the field's own, for the same reason focus restore
 * is (editorFocus.ts). A field that was empty has no argument yet, so the
 * editor that took the commit is replaced by a different component when the
 * argument appears, and local state would go with it. An offset in the
 * post-edit source survives that, and `source` is how a reader knows the
 * offset is in the coordinates of the parse it is looking at.
 */
export interface CommitNote {
  name: string;
  /** Start offset of the committed argument in `source`. */
  anchor: number;
  /** The source this note's offset belongs to. A note is read only while the rendered parse has exactly this source. */
  source: string;
}

export interface BreakdownContextValue {
  tokens: readonly Token[];
  lang: LanguageIndex;
  diagnostics: Diagnostic[];
  source: string;
  gameConstants: GameConstantsData;
  /** The full parse the pane is currently rendering. Cards read it when constructing intents (e.g. addCommand's InsertTarget). */
  parseResult: ParseResult;
  /**
   * Phase 3.4, computes the intent's TextEdit and pushes it onto the
   * shared Monaco model (docs/breakdown-design.md Sec.4/Sec.6.4). Returns null
   * (not a throw) when the patch engine rejects the intent as
   * unavailable (PatchError, e.g. an unclosed container). Callers
   * should treat that as "nothing happened", not as an error to surface.
   */
  applyEdit: (intent: EditIntent) => EditResult | null;
  /** Sec.6.3, is any expansion anchor offset within this span (i.e. should this card render expanded)? */
  isExpanded: (span: Span) => boolean;
  /** Sec.6.3, toggle a card's expansion, anchored at its span.start at the moment of the call. */
  toggleExpanded: (span: Span) => void;
  /** Expand a card without toggling (a summary-line click on an already open card must not close it). No-op when already expanded. */
  expandCard: (span: Span) => void;
  /**
   * The collapse strip (beta feedback 2026-09-17). Collapses the card,
   * scrolls the list so the collapsed card sits at the top, and remembers
   * where the viewport was inside the card so `toggleExpanded` on the
   * same card, with no scrolling in between, puts it back there. See
   * scrollMemory.ts for the arithmetic.
   */
  collapseFromStrip: (span: Span) => void;
  /**
   * After an edit that inserted something (Add Command, Add Comment, Add
   * Template), open the card the new source offset lands in and scroll it
   * into view. Queued behind the same pending-shift entry as the edit so
   * the offset is only ever read against the source it belongs to (the
   * BUG-001 rule, one level up). `scroll` false opens without scrolling,
   * the settings.breakdown.scrollToAddedCard switch. `expand` false only
   * scrolls, for a new comment (CommentCard's anchor sense is inverted,
   * an anchor there means closed, and a new comment is open already).
   */
  revealAfterEdit: (offset: number, scroll: boolean, expand?: boolean) => void;
  /**
   * Sec.6.3/Sec.4.11, after an explicit action or an Enter-commit, request
   * focus land on the editor whose current span contains `offset` once
   * the pane re-renders from the next parse. Editors register themselves
   * via `registerFocusable` keyed by their own current span start.
   *
   * A function instead of an offset finds the element itself once that
   * render lands, for a target an offset cannot name (Enter moving to the
   * next field of a group, enterNav.ts).
   */
  requestFocus: (target: number | (() => HTMLElement | null)) => void;
  /** An editor calls this on mount/update with its own current anchor offset (typically its ArgNode's span.start) so requestFocus can find it. Call with `null` on unmount. */
  registerFocusable: (offset: number, el: HTMLElement | null) => void;
  /**
   * Sec.3.9, is the selection anchor within this span (i.e. should this
   * card render with the selected accent)? Same offset-anchoring scheme
   * as isExpanded, same BUG-001 ordering fix applied (BreakdownPane
   * queues the shift alongside expansion's).
   */
  isSelected: (span: Span) => boolean;
  /** Sec.3.9, select a card, anchored at its span.start. Clicking a card's chrome (or any control inside it) calls this; ItemCard.tsx stops propagation so a nested click selects only the innermost card. */
  selectCard: (span: Span) => void;
  /** Switches to the Code tab with the caret and selection on the card at `span`, for a card Breakdown cannot edit (a raw region, a shared block). */
  editInCode: (span: Span) => void;
  /** Sec.3.9, clears selection: pane-background click, tab switch, or the selected card getting deleted (handled automatically by the same anchor-drop rule as expansion). */
  clearSelection: () => void;
  /** Sec.3.9/Sec.4.5, the currently-selected Item, re-resolved fresh from the current parseResult (Item identity doesn't survive a reparse, only the offset anchor does). undefined when nothing is selected. Add Command uses this to build `{ after: selectedItem }` instead of appending at the section's end. */
  selectedItem: Item | undefined;
  /**
   * Every top-level (outermost) RMS block-comment span in the document,
   * re-derived from `tokens` via src/breakdown/comments.ts. Comments
   * are pure trivia, so this is the only place their spans exist outside
   * the raw token stream. `BlockList` interleaves the ones that fall
   * between two consecutive items in whatever list it's rendering.
   */
  comments: Span[];
  /**
   * Sec.3.10, the raw set of expansion anchors (not just the `isExpanded`
   * predicate). `DiagnosticsRuler` needs this as a recompute trigger: a
   * card's rendered `offsetTop` changes on expand/collapse even though
   * neither `parseResult` nor `diagnostics` do, and `toggleExpanded`
   * always produces a NEW Set reference, so this works as a dependency
   * exactly like `parseResult` does for AST-driven recomputes.
   */
  expandedAnchors: ReadonlySet<number>;
  /**
   * Move a card to an InsertTarget (2026-09-18, breakdown-design Sec.4.12),
   * keeping it selected and as open or closed as it was. The drag layer
   * (cardDrag.tsx) and the card menu (CardMenu.tsx) both end here rather
   * than calling applyEdit themselves, so the post-move reveal and
   * re-selection live in one place. Widened to DraggableCard, not just
   * RearrangeableNode, so a dragged comment (CommentCard.tsx) ends up here
   * too — the card menu never constructs a CommentRef, only the drag layer
   * does.
   */
  moveItem: (item: DraggableCard, to: InsertTarget) => void;
  /** Copy a card directly below itself. The copy takes the selection. */
  duplicateItem: (item: RearrangeableNode) => void;
  // ---- Name lookup (2026-10-23, name-lookup-design.md slice C) ----
  //
  // Optional for the reason the multi-select members are: a card rendered
  // alone in a test harness has no pane behind it, and a missing one means
  // "no flash, no create strip", which is how a field behaved before these.
  /** The last committed name awaiting its parse, or null. */
  constNote?: CommitNote | null;
  /**
   * Remember `name` as just committed at `anchor`, an offset in the source
   * the edit that was JUST applied produced. Call right after `applyEdit`, so
   * the pane can pair the offset with the source it queued.
   */
  noteCommit?: (name: string, anchor: number) => void;
  /** Drop the note: a flash was taken, the strip was dismissed or acted on. */
  clearConstNote?: () => void;
  /** Say something to a screen reader through the pane's polite live region (Sec.6.3). */
  announce?: (message: string) => void;
  // ---- Multi-select (2026-10-21, Sec.3.12) ----
  //
  // Optional, so a card rendered alone in a test harness without a pane
  // behind it still type-checks, the same reasoning cardDrag.tsx gives for
  // its inert api. A missing one means "single select only", which is
  // exactly how a card behaved before these existed.
  /** A click on a card's chrome, with the modifier keys read off the event (multiSelect.ts's clickModeOf). A comment card passes its CommentRef (2026-10-22). */
  clickCard?: (card: SelectableCard, mode: ClickMode) => void;
  /** Every selected Item, outermost only, in source order (one entry for an ordinary selection). */
  selectedItems?: readonly Item[];
  /** Every selected card, comment cards included (2026-10-22), outermost only, in source order. */
  selectedCards?: readonly SelectableCard[];
  /** The selected comment card when the primary selection is one, so Add inserts after it. */
  selectedComment?: CommentRef;
  /** Move several cards to one InsertTarget together, keeping their order. The drag layer's group drop. */
  moveItems?: (items: readonly DraggableCard[], to: InsertTarget) => void;
  /** Delete every selected card that has a Delete button of its own, as one undo entry. */
  deleteSelected?: () => void;
  /**
   * Comment out the given cards, or uncomment them when every one is a
   * comment (2026-10-22, Sec.3.13), as one undo entry. The cards' toggle
   * buttons and the hotkey end here. `reselect` selects the resulting cards
   * once the parse lands, which the hotkey wants and a button only wants
   * when its card was the whole selection.
   */
  toggleCommentOut?: (
    cards: readonly DraggableCard[],
    reselect: boolean,
  ) => void;
}

const BreakdownCtx = createContext<BreakdownContextValue | null>(null);

export function BreakdownProvider({
  value,
  children,
}: {
  value: BreakdownContextValue;
  children: ReactNode;
}) {
  return (
    <BreakdownCtx.Provider value={value}>{children}</BreakdownCtx.Provider>
  );
}

/** Every card component reads shared read-only context this way rather than threading tokens/lang through every prop list. */
export function useBreakdownContext(): BreakdownContextValue {
  const ctx = useContext(BreakdownCtx);
  if (!ctx)
    throw new Error(
      "useBreakdownContext must be used within BreakdownProvider",
    );
  return ctx;
}
