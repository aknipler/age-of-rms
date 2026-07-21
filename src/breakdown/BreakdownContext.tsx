import { createContext, useContext, type ReactNode } from "react";
import type { Diagnostic, Item, ParseResult, Span, Token } from "../parser/types";
import type { LanguageIndex } from "../parser/language";
import type { GameConstantsData } from "./gameConstants";
import type { EditIntent, EditResult } from "./patch/intents";

export interface BreakdownContextValue {
  tokens: readonly Token[];
  lang: LanguageIndex;
  diagnostics: Diagnostic[];
  source: string;
  gameConstants: GameConstantsData;
  /** The full parse the pane is currently rendering — cards read it when constructing intents (e.g. addCommand's InsertTarget). */
  parseResult: ParseResult;
  /**
   * Phase 3.4 — computes the intent's TextEdit and pushes it onto the
   * shared Monaco model (docs/breakdown-design.md §4/§6.4). Returns null
   * (not a throw) when the patch engine rejects the intent as
   * unavailable (PatchError — e.g. an unclosed container) — callers
   * should treat that as "nothing happened", not as an error to surface.
   */
  applyEdit: (intent: EditIntent) => EditResult | null;
  /** §6.3 — is any expansion anchor offset within this span (i.e. should this card render expanded)? */
  isExpanded: (span: Span) => boolean;
  /** §6.3 — toggle a card's expansion, anchored at its span.start at the moment of the call. */
  toggleExpanded: (span: Span) => void;
  /**
   * §6.3/§4.11 — after an explicit action or an Enter-commit, request
   * focus land on the editor whose current span contains `offset` once
   * the pane re-renders from the next parse. Editors register themselves
   * via `registerFocusable` keyed by their own current span start.
   */
  requestFocus: (offset: number) => void;
  /** An editor calls this on mount/update with its own current anchor offset (typically its ArgNode's span.start) so requestFocus can find it. Call with `null` on unmount. */
  registerFocusable: (offset: number, el: HTMLElement | null) => void;
  /**
   * §3.9 — is the selection anchor within this span (i.e. should this
   * card render with the selected accent)? Same offset-anchoring scheme
   * as isExpanded, same BUG-001 ordering fix applied (BreakdownPane
   * queues the shift alongside expansion's).
   */
  isSelected: (span: Span) => boolean;
  /** §3.9 — select a card, anchored at its span.start. Clicking a card's chrome (or any control inside it) calls this; ItemCard.tsx stops propagation so a nested click selects only the innermost card. */
  selectCard: (span: Span) => void;
  /** §3.9 — clears selection: pane-background click, tab switch, or the selected card getting deleted (handled automatically by the same anchor-drop rule as expansion). */
  clearSelection: () => void;
  /** §3.9/§4.5 — the currently-selected Item, re-resolved fresh from the current parseResult (Item identity doesn't survive a reparse — only the offset anchor does). undefined when nothing is selected. Add Command uses this to build `{ after: selectedItem }` instead of appending at the section's end. */
  selectedItem: Item | undefined;
  /**
   * Ash's follow-up ask: "show comments in Breakdown too." Every
   * top-level (outermost) RMS block-comment span in the document,
   * re-derived from `tokens` via src/breakdown/comments.ts — comments
   * are pure trivia, so this is the only place their spans exist outside
   * the raw token stream. `BlockList` interleaves the ones that fall
   * between two consecutive items in whatever list it's rendering.
   */
  comments: Span[];
  /**
   * §3.10 — the raw set of expansion anchors (not just the `isExpanded`
   * predicate). `DiagnosticsRuler` needs this as a recompute trigger: a
   * card's rendered `offsetTop` changes on expand/collapse even though
   * neither `parseResult` nor `diagnostics` do, and `toggleExpanded`
   * always produces a NEW Set reference, so this works as a dependency
   * exactly like `parseResult` does for AST-driven recomputes.
   */
  expandedAnchors: ReadonlySet<number>;
}

const BreakdownCtx = createContext<BreakdownContextValue | null>(null);

export function BreakdownProvider({
  value,
  children,
}: {
  value: BreakdownContextValue;
  children: ReactNode;
}) {
  return <BreakdownCtx.Provider value={value}>{children}</BreakdownCtx.Provider>;
}

/** Every card component reads shared read-only context this way rather than threading tokens/lang through every prop list. */
export function useBreakdownContext(): BreakdownContextValue {
  const ctx = useContext(BreakdownCtx);
  if (!ctx) throw new Error("useBreakdownContext must be used within BreakdownProvider");
  return ctx;
}
