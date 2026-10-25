import { useCallback, useMemo, useRef } from "react";
import { useShiftedAnchor, useShiftedValue } from "./useShiftedAnchor";
import { findItemAtOffsetInScript } from "../breakdown/selectionResolve";
import {
  outermostInOrder,
  type CardSelection,
  type SelectableCard,
} from "../breakdown/multiSelect";
import {
  commentCardPlaces,
  extractComments,
  type CommentCardPlace,
} from "../breakdown/comments";
import type { CommentRef } from "../breakdown/patch/intents";
import {
  shiftSingleAnchor,
  type OffsetEdit,
} from "../breakdown/ephemeralAnchors";
import type { Item, ParseResult, Span } from "../parser/types";

// One shared empty list, so "no extras" is the same reference every time
// and a memo keyed on it does not recompute.
const NO_EXTRAS: readonly number[] = [];
const NO_PLACES: ReadonlyMap<number, CommentCardPlace> = new Map();

function shiftExtras(
  extras: readonly number[],
  edit: OffsetEdit,
): readonly number[] {
  if (extras.length === 0) return extras;
  const out: number[] = [];
  for (const a of extras) {
    const shifted = shiftSingleAnchor(a, edit);
    if (shifted !== null) out.push(shifted);
  }
  return out;
}

/**
 * The single cross-tab selection anchor: one
 * offset into the document that Breakdown's card selection AND the Code
 * tab's cursor/selection both read from and write to. Lifted to app level
 * (unlike Sec.3.9's original `selectedAnchor`, which lived inside
 * `BreakdownPane` and was destroyed every time that pane unmounted on a
 * tab switch) specifically so it survives Breakdown <-> Code tab
 * switches. That's the whole point: "where you are looking at is the
 * same when you switch tabs."
 *
 * Same offset-anchoring scheme as Sec.6.3/Sec.3.9 (a single nullable anchor,
 * shifted-and-dropped by edits), but the shift trigger is now the shared
 * Monaco model's own `onDidChangeContent` rather than Breakdown's
 * `applyEdit` queueing. That's what makes this correct for EVERY edit
 * origin (Breakdown card actions, Code-tab typing, undo/redo), not just
 * Breakdown-instigated ones. The BUG-001 ordering rule still applies: a
 * shift is only ever applied once the matching parse (`source`) has
 * actually landed, never eagerly, so Breakdown's card selection can't
 * flash onto the wrong card for a frame after an edit made from the Code
 * tab.
 *
 * That whole mechanism; the model subscription, the pending queue, the
 * shift; moved to `useShiftedAnchor` (2026-08-10) when the preview's Current
 * cut point gained a pin, which is a second offset with exactly the same
 * problem. One implementation, two instances; the alternative was a second
 * copy of the BUG-001 ordering rule maintained by hand.
 */
export function useSharedSelection(
  source: string,
  parseResult: ParseResult | null,
) {
  // Default shift policy: an anchor caught inside a replaced range is
  // DROPPED (ephemeralAnchors.ts's rev-4 rule), so a selection can't dangle
  // onto whatever text now occupies those offsets.
  const [selectedAnchor, setSelectedAnchor, setAnchorAfterPending] =
    useShiftedAnchor(source);
  // Multi-select (2026-10-21, breakdown-design Sec.3.12): the cards picked
  // with Ctrl or Shift beside the primary one, each its span.start. Shifted
  // by the same queue and the same drop-inside-a-replaced-range rule as the
  // primary, so deleting one of them takes it out of the list. Breakdown
  // only; the Code tab's cursor knows nothing about them.
  const [extraAnchors, setExtraAnchors, setExtrasAfterPending] =
    useShiftedValue<readonly number[]>(source, NO_EXTRAS, shiftExtras);
  // Latest-value ref for setAnchor below.
  const anchorRef = useRef(selectedAnchor);
  anchorRef.current = selectedAnchor;

  // Comment cards are selectable too (2026-10-22, breakdown-design
  // Sec.3.13). A comment has no Item, so nothing in the parse tells a comment
  // card's anchor from any other offset. This map does: every comment
  // Breakdown shows as a card, by its start. An anchor inside one of those is
  // that comment card, whether a click or the Code tab's cursor put it
  // there, and an anchor anywhere else resolves to an Item as before. No
  // extra state rides beside the anchor, so nothing new has to be shifted
  // through the BUG-001 queue.
  const places = useMemo(
    () =>
      parseResult
        ? commentCardPlaces(parseResult, extractComments(parseResult.tokens))
        : NO_PLACES,
    [parseResult],
  );
  const selectedComment: CommentRef | undefined = useMemo(() => {
    if (selectedAnchor === null) return undefined;
    for (const place of places.values())
      if (selectedAnchor >= place.span.start && selectedAnchor < place.span.end)
        return { kind: "comment", span: place.span };
    return undefined;
  }, [selectedAnchor, places]);

  const isSelected = useCallback(
    (span: Span) =>
      // A selected comment card lights only itself. The range test would
      // also light the if card around a comment inside one of its branches.
      (selectedComment
        ? span.start === selectedComment.span.start
        : selectedAnchor !== null &&
          selectedAnchor >= span.start &&
          selectedAnchor < span.end) || extraAnchors.includes(span.start),
    [selectedAnchor, selectedComment, extraAnchors],
  );
  // `setSelectedAnchor` is now listed as a dependency where it used to be
  // omitted: it is still React's own `useState` setter and still stable, but
  // it arrives through a custom hook's return value, where the lint rule can
  // no longer prove that. Listing it costs nothing (a stable value never
  // invalidates the memo) and keeps the rule honest.
  const selectCard = useCallback(
    (span: Span) => {
      setSelectedAnchor(span.start);
      setExtraAnchors(NO_EXTRAS);
    },
    [setSelectedAnchor, setExtraAnchors],
  );
  const clearSelection = useCallback(() => {
    setSelectedAnchor(null);
    setExtraAnchors(NO_EXTRAS);
  }, [setSelectedAnchor, setExtraAnchors]);
  /** Code tab's cursor-tracking calls this directly with an arbitrary offset (not necessarily a card's span.start). */
  const setAnchor = useCallback(
    (offset: number | null) => {
      // Moving the Code-tab cursor somewhere new is a fresh single
      // selection. The same offset arriving again (the editor reporting
      // where it already is when it mounts) leaves a multi-selection alone.
      // Compared through a ref rather than inside setSelectedAnchor's
      // updater function, since an updater must be pure (StrictMode calls
      // it twice) and setting a second state from inside one is not.
      if (anchorRef.current !== offset) setExtraAnchors(NO_EXTRAS);
      setSelectedAnchor(offset);
    },
    [setSelectedAnchor, setExtraAnchors],
  );
  /** A whole multi-selection at once, as multiSelect.ts's nextSelection computes it. */
  const setSelection = useCallback(
    (next: CardSelection) => {
      setSelectedAnchor(next.primary);
      setExtraAnchors(next.primary === null ? NO_EXTRAS : next.extras);
    },
    [setSelectedAnchor, setExtraAnchors],
  );

  /**
   * Select the card at `offset` once the edit just pushed has parsed
   * (2026-09-18). For a move or duplicate, whose result caret is in the
   * NEW text, see useShiftedAnchor's setAfterPending for why this cannot
   * be a plain setAnchor.
   */
  const selectAfterEdit = useCallback(
    (offset: number) => {
      setAnchorAfterPending(offset);
      setExtrasAfterPending(NO_EXTRAS);
    },
    [setAnchorAfterPending, setExtrasAfterPending],
  );
  /** The multi-card form, for a group move: the first offset becomes the primary. */
  const selectManyAfterEdit = useCallback(
    (offsets: readonly number[]) => {
      if (offsets.length === 0) return;
      setAnchorAfterPending(offsets[0]);
      setExtrasAfterPending(offsets.slice(1));
    },
    [setAnchorAfterPending, setExtrasAfterPending],
  );

  const selectedItem: Item | undefined = useMemo(() => {
    if (selectedAnchor === null || !parseResult || selectedComment)
      return undefined;
    return findItemAtOffsetInScript(parseResult.script, selectedAnchor);
  }, [selectedAnchor, parseResult, selectedComment]);

  // Resolved fresh from the current parse, like selectedItem. An extra
  // whose card is gone (an edit from the Code tab replaced it) resolves to
  // nothing and is skipped.
  const extraItems: Item[] = useMemo(() => {
    if (!parseResult) return [];
    const out: Item[] = [];
    for (const a of extraAnchors) {
      const item = findItemAtOffsetInScript(parseResult.script, a);
      if (item && item.span.start === a && item !== selectedItem)
        out.push(item);
    }
    return out;
  }, [extraAnchors, parseResult, selectedItem]);

  /** Every selected card, primary included, outermost only, in source order. What a group delete or drag acts on. */
  const selectedItems: Item[] = useMemo(
    () => outermostInOrder(selectedItem ? [selectedItem, ...extraItems] : []),
    [selectedItem, extraItems],
  );

  // The comment cards among the extras, found the same way.
  const extraComments: CommentRef[] = useMemo(() => {
    const out: CommentRef[] = [];
    for (const a of extraAnchors) {
      const place = places.get(a);
      if (place && a !== selectedComment?.span.start)
        out.push({ kind: "comment", span: place.span });
    }
    return out;
  }, [extraAnchors, places, selectedComment]);

  /** The primary card, an Item or a comment card. */
  const primaryCard: SelectableCard | undefined =
    selectedComment ?? selectedItem;

  /** selectedItems with the selected comment cards among them, in source order. What the comment toggle, a group delete and a group drag act on. */
  const selectedCards: SelectableCard[] = useMemo(
    () =>
      outermostInOrder<SelectableCard>([
        ...(primaryCard ? [primaryCard] : []),
        ...extraItems,
        ...extraComments,
      ]),
    [primaryCard, extraItems, extraComments],
  );

  return {
    selectedAnchor,
    setAnchor,
    isSelected,
    selectCard,
    clearSelection,
    selectAfterEdit,
    selectManyAfterEdit,
    setSelection,
    selectedItem,
    extraItems,
    selectedItems,
    selectedComment,
    extraComments,
    primaryCard,
    selectedCards,
    places,
  };
}

export type SharedSelectionApi = ReturnType<typeof useSharedSelection>;
