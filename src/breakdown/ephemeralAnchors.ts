// docs/breakdown-design.md §6.3 — ephemeral UI state (expansion, focus)
// anchored to source offsets rather than node identity, since every edit
// re-derives the AST from scratch (new node objects every time). Kept
// free of React so it's plain-logic testable, same convention as
// attributeModel.ts / sectionTabsModel.ts.
import type { Span } from "../parser/types";

/** A byte-level edit's shape, structurally — avoids importing patch/intents.ts's TextEdit here. */
export interface OffsetEdit {
  start: number;
  end: number;
  newText: string;
}

/**
 * After an edit, shift every anchor by the edit's Δ (newText.length - (end
 * - start)): anchors before the edit are untouched, anchors at/after the
 * edit's end move by Δ, and an anchor that fell INSIDE the deleted/replaced
 * range is dropped (rev 4's rule — don't let it dangle and spuriously
 * "expand" whatever now occupies those offsets).
 */
export function shiftAnchors(anchors: ReadonlySet<number>, edit: OffsetEdit): Set<number> {
  const delta = edit.newText.length - (edit.end - edit.start);
  const next = new Set<number>();
  for (const anchor of anchors) {
    if (anchor >= edit.start && anchor < edit.end) continue; // dropped: was inside the edited range
    next.add(anchor >= edit.end ? anchor + delta : anchor);
  }
  return next;
}

/** True iff some anchor offset falls within `span` — the post-reparse "is this card expanded" test. */
export function isAnchoredWithin(anchors: ReadonlySet<number>, span: Span): boolean {
  for (const anchor of anchors) {
    if (anchor >= span.start && anchor < span.end) return true;
  }
  return false;
}

/**
 * Same shift as shiftAnchors, for a single nullable anchor — §3.9's
 * `selectedAnchor` is exactly one offset (or none), not a Set, but must
 * obey the identical shift-and-drop rule (and the identical BUG-001
 * ordering fix in BreakdownPane: only ever called once the matching
 * parse has actually rendered, never eagerly).
 */
export function shiftSingleAnchor(anchor: number | null, edit: OffsetEdit): number | null {
  if (anchor === null) return null;
  const shifted = shiftAnchors(new Set([anchor]), edit);
  return shifted.size > 0 ? [...shifted][0] : null;
}

/**
 * Rebases a freshly-computed edit's [start, end) range through a chain of
 * PRIOR edits that have already been pushed onto the shared model but
 * whose matching reparse hasn't landed yet (BreakdownPane's
 * `pendingAnchorShiftsRef` queue). This exists to close a data-corruption
 * bug: rapid card actions (e.g. deleting several cards back-to-back)
 * each call `computeEdit` against the last CONFIRMED `parseResult` — but
 * `computeEdit`'s offsets are only valid relative to THAT parse's source.
 * If a prior action's edit already landed on the model (pushEditOperations
 * is synchronous) while its reparse is still in flight, blindly splicing
 * the new edit's stale offsets into the model's current (already-shifted)
 * text corrupts whatever now occupies those byte positions — this is
 * exactly the "rapid delete truncates an unrelated command" bug it fixes.
 *
 * Returns the rebased edit when it's safe (every prior edit was either
 * entirely before or entirely after this edit's range — the ranges never
 * touched), or `null` when this edit's range overlaps a still-pending
 * prior edit, meaning it can't be resolved without re-parsing first.
 * `null` is deliberately treated exactly like `PatchError` by callers —
 * "this edit is unavailable right now," not a crash — the same
 * conservative "drop rather than guess" trade this codebase already makes
 * for the anchor queue itself (see BreakdownPane's resolving effect).
 */
export function rebaseEdit(edit: OffsetEdit, priorEdits: readonly OffsetEdit[]): OffsetEdit | null {
  let start = edit.start;
  let end = edit.end;
  for (const prior of priorEdits) {
    const delta = prior.newText.length - (prior.end - prior.start);
    if (end <= prior.start) {
      continue; // entirely before this prior edit — still valid as-is
    }
    if (start >= prior.end) {
      start += delta;
      end += delta;
      continue;
    }
    return null; // overlaps a not-yet-confirmed prior edit — unsafe to resolve blindly
  }
  return { start, end, newText: edit.newText };
}

/** Shifts a single point (e.g. a post-edit caret offset) through the same prior-edits chain `rebaseEdit` uses, via repeated `shiftSingleAnchor`. */
export function shiftPointThroughEdits(point: number, priorEdits: readonly OffsetEdit[]): number {
  let shifted: number | null = point;
  for (const prior of priorEdits) {
    shifted = shiftSingleAnchor(shifted, prior);
    if (shifted === null) return point; // shouldn't happen given rebaseEdit already validated no overlap; fall back rather than propagate null
  }
  return shifted;
}
