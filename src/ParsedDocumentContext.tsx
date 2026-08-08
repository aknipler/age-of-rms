import { createContext, useContext, type ReactNode } from "react";
import type { ParseResult } from "./parser/types";

/**
 * The live document's ParseResult, exposed via context rather than a prop.
 *
 * `src/components/sidepanel/MapSidePanel.tsx`'s own header states its
 * contract deliberately: "Neither child takes props. Both read what they
 * need from module-level reference data or context... which is what lets
 * the same element be dropped into two different panes without either pane
 * knowing anything about them." `PreviewPane` (a MapSidePanel child) needs
 * the live `ParseResult` to drive `usePreviewResult` (docs/preview-design.md
 * Sec.10) — this context is what supplies it without breaking that
 * contract, the same way `PreviewViewContext`/`GenerationSettingsContext`
 * already supply everything else PreviewPane reads.
 *
 * `AppContent` (App.tsx) is already the one place `useParsedDocument`'s
 * result exists — this just makes its `parseResult` field visible further
 * down the tree than the `BreakdownPane`/`CodePane` props it's also passed
 * as, without threading a third prop through `MapSidePanel`.
 */
const ParsedDocumentCtx = createContext<ParseResult | null>(null);

export function ParsedDocumentProvider({
  parseResult,
  children,
}: {
  parseResult: ParseResult | null;
  children: ReactNode;
}) {
  // No useMemo here: ParseResult is already a stable reference between
  // parses (useParsedDocument only calls setState, and therefore only
  // produces a new parseResult object, when a worker response actually
  // arrives) — wrapping it would add a dependency array to keep in sync for
  // no benefit, the same reasoning PreviewViewportProvider gives for
  // skipping its own memoisation.
  return <ParsedDocumentCtx.Provider value={parseResult}>{children}</ParsedDocumentCtx.Provider>;
}

/** null both before the first parse response arrives and outside a ParsedDocumentProvider's initial render gap — callers must handle it, same as ParsedDocumentState.parseResult already requires. */
export function useParsedDocumentContext(): ParseResult | null {
  return useContext(ParsedDocumentCtx);
}
