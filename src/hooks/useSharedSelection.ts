import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocumentModel } from "./useDocument";
import { shiftSingleAnchor, type OffsetEdit } from "../breakdown/ephemeralAnchors";
import { findItemAtOffsetInScript } from "../breakdown/selectionResolve";
import type { Item, ParseResult, Span } from "../parser/types";

/**
 * The single cross-tab selection anchor (Ash's follow-up to §3.9): one
 * offset into the document that Breakdown's card selection AND the Code
 * tab's cursor/selection both read from and write to. Lifted to app level
 * (unlike §3.9's original `selectedAnchor`, which lived inside
 * `BreakdownPane` and was destroyed every time that pane unmounted on a
 * tab switch) specifically so it survives Breakdown <-> Code tab
 * switches — that's the whole point: "where you are looking at is the
 * same when you switch tabs."
 *
 * Same offset-anchoring scheme as §6.3/§3.9 (a single nullable anchor,
 * shifted-and-dropped by edits), but the shift trigger is now the shared
 * Monaco model's own `onDidChangeContent` rather than Breakdown's
 * `applyEdit` queueing — that's what makes this correct for EVERY edit
 * origin (Breakdown card actions, Code-tab typing, undo/redo), not just
 * Breakdown-instigated ones. The BUG-001 ordering rule still applies: a
 * shift is only ever applied once the matching parse (`source`) has
 * actually landed, never eagerly, so Breakdown's card selection can't
 * flash onto the wrong card for a frame after an edit made from the Code
 * tab.
 */
export function useSharedSelection(source: string, parseResult: ParseResult | null) {
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null);

  const pendingRef = useRef<{ edits: OffsetEdit[]; expectedSource: string }[]>([]);

  useEffect(() => {
    const model = getDocumentModel();
    const subscription = model.onDidChangeContent((e) => {
      // Multiple simultaneous changes (e.g. multi-cursor typing) are each
      // expressed relative to the ORIGINAL pre-event text — applying them
      // highest-offset-first keeps every later (lower-offset) shift's
      // comparison valid, since a higher-offset edit's delta never changes
      // whether the anchor was originally before a lower-offset edit's
      // range. The overwhelmingly common case is exactly one change
      // (a keystroke, or a single pushEditOperations call), where this
      // ordering is moot.
      const edits: OffsetEdit[] = e.changes
        .map((c) => ({ start: c.rangeOffset, end: c.rangeOffset + c.rangeLength, newText: c.text }))
        .sort((a, b) => b.start - a.start);
      // model.getValue() here is the text AFTER this exact change (the
      // event fires post-apply) — no manual string surgery needed to
      // compute what we're waiting for, unlike §3.9's original
      // applyEdit-side queueing.
      pendingRef.current.push({ edits, expectedSource: model.getValue() });
    });
    return () => subscription.dispose();
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    const matchedUpTo = pending.findIndex((p) => p.expectedSource === source);
    if (matchedUpTo === -1) {
      // Nothing in the queue matches the parse that just landed — some
      // other change superseded it. Drop rather than wait forever (same
      // trade-off §3.9's original queue made).
      pendingRef.current = [];
      return;
    }
    const toApply = pending.slice(0, matchedUpTo + 1);
    pendingRef.current = pending.slice(matchedUpTo + 1);
    setSelectedAnchor((prev) => {
      let next = prev;
      for (const { edits } of toApply) {
        for (const edit of edits) next = shiftSingleAnchor(next, edit);
      }
      return next;
    });
  }, [source]);

  const isSelected = useCallback(
    (span: Span) => selectedAnchor !== null && selectedAnchor >= span.start && selectedAnchor < span.end,
    [selectedAnchor],
  );
  const selectCard = useCallback((span: Span) => setSelectedAnchor(span.start), []);
  const clearSelection = useCallback(() => setSelectedAnchor(null), []);
  /** Code tab's cursor-tracking calls this directly with an arbitrary offset (not necessarily a card's span.start). */
  const setAnchor = useCallback((offset: number | null) => setSelectedAnchor(offset), []);

  const selectedItem: Item | undefined = useMemo(() => {
    if (selectedAnchor === null || !parseResult) return undefined;
    return findItemAtOffsetInScript(parseResult.script, selectedAnchor);
  }, [selectedAnchor, parseResult]);

  return { selectedAnchor, setAnchor, isSelected, selectCard, clearSelection, selectedItem };
}

export type SharedSelectionApi = ReturnType<typeof useSharedSelection>;
