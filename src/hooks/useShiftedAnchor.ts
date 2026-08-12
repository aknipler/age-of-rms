import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getDocumentModel } from "./useDocument";
import { shiftSingleAnchor, type OffsetEdit } from "../breakdown/ephemeralAnchors";

/**
 * One source offset that survives edits to the document.
 *
 * EXTRACTED FROM useSharedSelection (2026-08-10), which had been the only
 * thing that needed it until the preview's Current cut point gained a pin —
 * a second offset with the same problem and, without this, a second copy of
 * the same subtle queue. There is no parallel model here: both anchors are
 * offsets into the one Monaco document, shifted by the same rule, in step
 * with the same parse.
 *
 * WHAT IT SOLVES. An offset into the source is only meaningful against the
 * text it was taken from. Type a character above it and it points one to the
 * left of what it named. So every content change is turned into an
 * `OffsetEdit` and applied to the anchor as a Δ (`shiftSingleAnchor`).
 *
 * WHY THE QUEUE (the BUG-001 ordering rule, and the part that looks like
 * overkill until it bites). The shift must NOT be applied when the edit
 * happens — it must wait until the PARSE for that exact text has landed.
 * Everything downstream (cards, spans, the cut) is rendered from the last
 * parse, so shifting early points the anchor into text nothing has parsed
 * yet, and the selection flashes onto the wrong card for a frame. So changes
 * pile up in `pendingRef` tagged with the source they produced, and are
 * applied only when `source` catches up.
 *
 * `shift` is a parameter because the two callers want different things from
 * an anchor caught INSIDE a replaced range: the selection drops (rev 4's
 * rule — don't let it dangle onto whatever now occupies those offsets),
 * while the preview's pin collapses to the edit's start rather than silently
 * unpinning itself. It is read through a ref so passing an inline function
 * doesn't re-subscribe anything.
 */
export function useShiftedAnchor(
  source: string,
  shift: (anchor: number | null, edit: OffsetEdit) => number | null = shiftSingleAnchor,
): [number | null, Dispatch<SetStateAction<number | null>>] {
  const [anchor, setAnchor] = useState<number | null>(null);

  // Latest-callback ref, the same pattern CodePane uses for
  // onCursorOffsetChange: the effect below must call the CURRENT `shift`
  // without listing it as a dependency, or an inline arrow at the call site
  // would re-run the effect on every render.
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

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
      // compute what we're waiting for.
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
      // trade-off Sec.3.9's original queue made).
      pendingRef.current = [];
      return;
    }
    const toApply = pending.slice(0, matchedUpTo + 1);
    pendingRef.current = pending.slice(matchedUpTo + 1);
    setAnchor((prev) => {
      let next = prev;
      for (const { edits } of toApply) {
        for (const edit of edits) next = shiftRef.current(next, edit);
      }
      return next;
    });
  }, [source]);

  return [anchor, setAnchor];
}
