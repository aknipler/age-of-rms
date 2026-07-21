// Phase 3.4 glue layer between the pure patch engine (src/breakdown/patch/,
// which per docs/breakdown-design.md §12 must stay free of React/Monaco)
// and the shared Monaco document model (§6.4). Cards never call
// computeEdit directly — they go through BreakdownContext's `applyEdit`,
// which is this function bound to the current ParseResult/lang/pushEdit.
import { computeEdit } from "./patch/computeEdit";
import { PatchError, type EditIntent, type EditResult } from "./patch/intents";
import { rebaseEdit, shiftPointThroughEdits, type OffsetEdit } from "./ephemeralAnchors";
import type { ParseResult } from "../parser/types";
import type { LanguageIndex } from "../parser/language";

/** Structurally matches TextEdit without importing it, keeping useDocument.ts free of a breakdown/ dependency. */
export type ApplyTextEdit = (edit: { start: number; end: number; newText: string }) => void;

/**
 * Computes the TextEdit for `intent` and pushes it onto the shared Monaco
 * model via `applyTextEdit` (which uses pushEditOperations — §6.4 — so the
 * edit lands on Monaco's own undo/redo stack and triggers
 * useParsedDocument's debounced reparse). Returns the EditResult (so
 * callers get `caret` for focus restoration, §4.11/§6.3) on success.
 *
 * PatchError means "this edit is unavailable" (an unclosed container, an
 * out-of-range branch, etc. — see docs/breakdown-design.md §4.5/§4.10's
 * suppression rules) — callers render an inert control, not a crash.
 * Any other thrown error is a real bug and is allowed to propagate.
 *
 * `priorEdits` — edits already pushed onto the model from a PREVIOUS call
 * whose matching reparse hasn't landed yet (BreakdownPane's
 * `pendingAnchorShiftsRef` queue, passed in as a plain array by the
 * caller). `computeEdit` above only knows about `parseResult` — the last
 * CONFIRMED parse — so its offsets are stale the instant a prior pending
 * edit has already shifted the model's actual text. Rebasing through
 * `priorEdits` before applying is what makes rapid consecutive card
 * actions (e.g. deleting several cards back-to-back, faster than a parse
 * round-trip) land in the right place instead of corrupting whatever
 * region the stale offsets now happen to fall on. See rebaseEdit's own
 * doc comment for the full story.
 */
export function applyEditIntent(
  parseResult: ParseResult,
  intent: EditIntent,
  lang: LanguageIndex,
  applyTextEdit: ApplyTextEdit,
  priorEdits: readonly OffsetEdit[] = [],
): EditResult | null {
  let result: EditResult;
  try {
    result = computeEdit(parseResult, intent, lang);
  } catch (err) {
    if (err instanceof PatchError) return null;
    throw err;
  }
  const rebasedEdit = rebaseEdit(result.edit, priorEdits);
  if (rebasedEdit === null) return null; // overlaps an edit still in flight — unavailable right now, not a crash
  const rebasedCaret = shiftPointThroughEdits(result.caret, priorEdits);
  applyTextEdit(rebasedEdit);
  return { edit: rebasedEdit, caret: rebasedCaret };
}
