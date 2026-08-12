import { useCallback, useMemo } from "react";
import { useShiftedAnchor } from "./useShiftedAnchor";
import { findItemAtOffsetInScript } from "../breakdown/selectionResolve";
import type { Item, ParseResult, Span } from "../parser/types";

/**
 * The single cross-tab selection anchor: one
 * offset into the document that Breakdown's card selection AND the Code
 * tab's cursor/selection both read from and write to. Lifted to app level
 * (unlike Sec.3.9's original `selectedAnchor`, which lived inside
 * `BreakdownPane` and was destroyed every time that pane unmounted on a
 * tab switch) specifically so it survives Breakdown <-> Code tab
 * switches — that's the whole point: "where you are looking at is the
 * same when you switch tabs."
 *
 * Same offset-anchoring scheme as Sec.6.3/Sec.3.9 (a single nullable anchor,
 * shifted-and-dropped by edits), but the shift trigger is now the shared
 * Monaco model's own `onDidChangeContent` rather than Breakdown's
 * `applyEdit` queueing — that's what makes this correct for EVERY edit
 * origin (Breakdown card actions, Code-tab typing, undo/redo), not just
 * Breakdown-instigated ones. The BUG-001 ordering rule still applies: a
 * shift is only ever applied once the matching parse (`source`) has
 * actually landed, never eagerly, so Breakdown's card selection can't
 * flash onto the wrong card for a frame after an edit made from the Code
 * tab.
 *
 * That whole mechanism — the model subscription, the pending queue, the
 * shift — moved to `useShiftedAnchor` (2026-08-10) when the preview's Current
 * cut point gained a pin, which is a second offset with exactly the same
 * problem. One implementation, two instances; the alternative was a second
 * copy of the BUG-001 ordering rule maintained by hand.
 */
export function useSharedSelection(source: string, parseResult: ParseResult | null) {
  // Default shift policy: an anchor caught inside a replaced range is
  // DROPPED (ephemeralAnchors.ts's rev-4 rule), so a selection can't dangle
  // onto whatever text now occupies those offsets.
  const [selectedAnchor, setSelectedAnchor] = useShiftedAnchor(source);

  const isSelected = useCallback(
    (span: Span) => selectedAnchor !== null && selectedAnchor >= span.start && selectedAnchor < span.end,
    [selectedAnchor],
  );
  // `setSelectedAnchor` is now listed as a dependency where it used to be
  // omitted: it is still React's own `useState` setter and still stable, but
  // it arrives through a custom hook's return value, where the lint rule can
  // no longer prove that. Listing it costs nothing (a stable value never
  // invalidates the memo) and keeps the rule honest.
  const selectCard = useCallback((span: Span) => setSelectedAnchor(span.start), [setSelectedAnchor]);
  const clearSelection = useCallback(() => setSelectedAnchor(null), [setSelectedAnchor]);
  /** Code tab's cursor-tracking calls this directly with an arbitrary offset (not necessarily a card's span.start). */
  const setAnchor = useCallback((offset: number | null) => setSelectedAnchor(offset), [setSelectedAnchor]);

  const selectedItem: Item | undefined = useMemo(() => {
    if (selectedAnchor === null || !parseResult) return undefined;
    return findItemAtOffsetInScript(parseResult.script, selectedAnchor);
  }, [selectedAnchor, parseResult]);

  return { selectedAnchor, setAnchor, isSelected, selectCard, clearSelection, selectedItem };
}

export type SharedSelectionApi = ReturnType<typeof useSharedSelection>;
