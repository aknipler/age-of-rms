// Phase 3.4 glue layer between the pure patch engine (src/breakdown/patch/,
// which per docs/breakdown-design.md Sec.12 must stay free of React/Monaco)
// and the shared Monaco document model (Sec.6.4). Cards never call
// computeEdit directly. They go through BreakdownContext's `applyEdit`,
// which is this function bound to the current ParseResult/lang/pushEdit.
import { computeEdit, editsOf } from "./patch/computeEdit";
import { PatchError, type EditIntent, type EditResult } from "./patch/intents";
import {
  rebaseEdit,
  shiftPointThroughEdits,
  type OffsetEdit,
} from "./ephemeralAnchors";
import type { ParseResult } from "../parser/types";
import type { LanguageIndex } from "../parser/language";

/**
 * Structurally matches TextEdit[] without importing it, keeping
 * useDocument.ts free of a breakdown/ dependency. Plural since 2026-09-18,
 * when moveNode became the first intent carrying two edits. Every edit in
 * one call lands as ONE Monaco undo entry (useDocument.applyTextEdits), so
 * a move undoes in one keypress instead of leaving a copy behind after the
 * first.
 */
export type ApplyTextEdits = (
  edits: readonly { start: number; end: number; newText: string }[],
) => void;

/**
 * Computes the TextEdit for `intent` and pushes it onto the shared Monaco
 * model via `applyTextEdit` (which uses pushEditOperations, Sec.6.4, so the
 * edit lands on Monaco's own undo/redo stack and triggers
 * useParsedDocument's debounced reparse). Returns the EditResult (so
 * callers get `caret` for focus restoration, Sec.4.11/Sec.6.3) on success.
 *
 * PatchError means "this edit is unavailable" (an unclosed container, an
 * out-of-range branch, etc., see docs/breakdown-design.md Sec.4.5/Sec.4.10's
 * suppression rules). Callers render an inert control, not a crash.
 * Any other thrown error is a real bug and is allowed to propagate.
 *
 * `priorEdits`, edits already pushed onto the model from a PREVIOUS call
 * whose matching reparse hasn't landed yet (BreakdownPane's
 * `pendingAnchorShiftsRef` queue, passed in as a plain array by the
 * caller). `computeEdit` above only knows about `parseResult`, the last
 * CONFIRMED parse, so its offsets are stale the instant a prior pending
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
  applyTextEdits: ApplyTextEdits,
  priorEdits: readonly OffsetEdit[] = [],
): EditResult | null {
  let result: EditResult;
  try {
    result = computeEdit(parseResult, intent, lang);
  } catch (err) {
    if (err instanceof PatchError) return null;
    throw err;
  }
  // Each half is rebased on its own. They share the same original
  // coordinates and never overlap, and rebaseEdit only ever shifts a range
  // that lies wholly past a prior edit, so two disjoint ranges stay
  // disjoint and in order after rebasing.
  const rebasedEdit = rebaseEdit(result.edit, priorEdits);
  if (rebasedEdit === null) return null; // overlaps an edit still in flight, unavailable right now, not a crash
  const rebasedRemoval = result.removal
    ? rebaseEdit(result.removal, priorEdits)
    : undefined;
  if (rebasedRemoval === null) return null;
  const rebasedCompanion = result.companion
    ? rebaseEdit(result.companion, priorEdits)
    : undefined;
  if (rebasedCompanion === null) return null;
  const rebasedCaret = shiftPointThroughEdits(result.caret, priorEdits);
  const rebased: EditResult = {
    edit: rebasedEdit,
    caret: rebasedCaret,
    ...(rebasedRemoval ? { removal: rebasedRemoval } : {}),
    ...(rebasedCompanion ? { companion: rebasedCompanion } : {}),
  };
  applyTextEdits(editsOf(rebased));
  return rebased;
}
