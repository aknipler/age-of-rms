import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ParseResult } from "./parser/types";
import { shiftCollapsingAnchor } from "./breakdown/ephemeralAnchors";
import { useShiftedAnchor } from "./hooks/useShiftedAnchor";
import { lineOfOffset, resolveCutOffset } from "./preview/generator/truncateAst";

/**
 * Where Current cuts the script (docs/preview-design.md Sec.5, CREATION_PLAN 4.6).
 *
 * WHY A THIRD ROOT-LEVEL CONTEXT. `PreviewPane` takes no props —
 * `MapSidePanel`'s contract — so anything it needs has to arrive through
 * context, which is the same reason `ParsedDocumentContext` and
 * `PreviewResultContext` exist beside this file. What this one bridges is the
 * shared selection anchor (`useSharedSelection`, owned by `AppContent`): the
 * pin button has to know where the caret is, and `PreviewResultProvider` has
 * to know where to cut.
 *
 * WHY NOT PreviewViewContext, which already holds the Current/Final toggle
 * this belongs to. That provider sits ABOVE `AppContent` in App.tsx, so the
 * selection anchor does not exist yet where it renders. Splitting on that
 * boundary keeps each provider at the shallowest level its own inputs allow,
 * which is the rule the other two already follow.
 *
 * THE CUT IS AN OFFSET; LINES ARE FOR PRINTING. Everything that decides what
 * generates is a character offset into the source, because that is the
 * granularity the caret actually has and a line is too coarse to watch an
 * attribute take shape. The two `*Line` fields exist only so the button can
 * say "line 34" the way the gutter does. 0-based, like
 * `ParseResult.lineOffsets`; the `+ 1` happens once, in the button.
 */
export interface PreviewCutValue {
  /** Where the caret/selected card is, or null when nothing is selected. */
  cursorOffset: number | null;
  /** The pinned offset, or null when Current is following the caret. */
  pinnedOffset: number | null;
  /**
   * Where Current actually truncates: the pin when there is one, the caret
   * otherwise, and null when there is neither — in which case Current has
   * nothing to cut and draws the whole script, same as Final.
   */
  cutOffset: number | null;
  /** The caret's line, for display. */
  cursorLine: number | null;
  /** The pin's line, for display. */
  pinnedLine: number | null;
  /** Pins the caret. A no-op with no caret, which is why the button is disabled then. */
  pinCursor: () => void;
  /** Back to following the caret. */
  unpin: () => void;
}

const PreviewCutCtx = createContext<PreviewCutValue | null>(null);

export function PreviewCutProvider({
  cursorOffset,
  source,
  parseResult,
  children,
}: {
  cursorOffset: number | null;
  /** The source the current parse was computed for — what the pin's shifts are sequenced against. */
  source: string;
  parseResult: ParseResult | null;
  children: ReactNode;
}) {
  // THE PIN FOLLOWS THE CODE. It is an offset shifted through every edit by
  // the same machinery that keeps the shared selection anchor pointing at the
  // card it named (`useShiftedAnchor`), so inserting ten lines above a pin
  // moves the pin ten lines down and it still cuts after the same attribute.
  // A line number could not do that, which is what the first cut of this
  // feature shipped and what made a pin drift the moment you typed above it.
  //
  // `shiftCollapsingAnchor` rather than the default `shiftSingleAnchor`: a pin
  // caught inside a replaced range collapses to that range's start instead of
  // dropping, because a dropped pin silently reverts Current to following the
  // caret. See its own doc for why it is a function and not a `??` here.
  const [pinnedOffset, setPinnedOffset] = useShiftedAnchor(source, shiftCollapsingAnchor);

  const lineOffsets = parseResult?.lineOffsets;
  // A pin can outlive the text under it in one way the shift cannot cover:
  // opening a different file replaces the whole document without any edit for
  // the queue to sequence. Clamping to the end keeps a stale pin meaning
  // "everything" rather than pointing past the source.
  const sourceLength = parseResult?.source.length ?? null;

  const cutOffset = resolveCutOffset(pinnedOffset, cursorOffset, sourceLength);
  // The label and the cut come out of the same function, one with the caret
  // withheld: "where would the cut be if there were no caret" IS the pin, so
  // the number printed on the button cannot disagree with the map drawn
  // beside it.
  const pinOffsetForDisplay = resolveCutOffset(pinnedOffset, null, sourceLength);

  const toLine = useCallback(
    (offset: number | null): number | null =>
      offset === null || lineOffsets === undefined ? null : lineOfOffset(lineOffsets, offset),
    [lineOffsets],
  );

  const cursorLine = toLine(cursorOffset);
  const pinnedLine = toLine(pinOffsetForDisplay);

  // Depends on `cursorOffset` on purpose. An empty dependency list here would
  // capture the value from the first render forever — a stale closure, the
  // same trap PreviewViewContext's `toggleSelectedTile` avoids with the
  // updater form. There is no updater form available for "read another
  // value", so the dependency is the fix.
  const pinCursor = useCallback(() => {
    if (cursorOffset !== null) setPinnedOffset(cursorOffset);
  }, [cursorOffset, setPinnedOffset]);

  const unpin = useCallback(() => setPinnedOffset(null), [setPinnedOffset]);

  const value = useMemo(
    () => ({
      cursorOffset,
      pinnedOffset: pinOffsetForDisplay,
      cutOffset,
      cursorLine,
      pinnedLine,
      pinCursor,
      unpin,
    }),
    [cursorOffset, pinOffsetForDisplay, cutOffset, cursorLine, pinnedLine, pinCursor, unpin],
  );

  return <PreviewCutCtx.Provider value={value}>{children}</PreviewCutCtx.Provider>;
}

export function usePreviewCut(): PreviewCutValue {
  const ctx = useContext(PreviewCutCtx);
  if (!ctx) throw new Error("usePreviewCut must be used within PreviewCutProvider");
  return ctx;
}
