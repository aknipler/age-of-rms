import { describe, expect, it } from "vitest";
import { shiftAnchors, isAnchoredWithin, type OffsetEdit } from "../ephemeralAnchors";

// docs/known-issues.md BUG-001, Part A. Mirrors the queue-resolution
// logic added to BreakdownPane.tsx (pendingAnchorShiftsRef /
// expectedSourceRef / the resolving effect keyed on `source`), extracted
// here as plain functions so the actual sequencing math is covered
// without needing to render React or mock a worker round-trip.
interface Pending {
  edit: OffsetEdit;
  expectedSource: string;
}

function queueEdit(
  pending: Pending[],
  expectedSourceRef: { current: string | null },
  baseSource: string,
  edit: OffsetEdit,
): void {
  const base = expectedSourceRef.current ?? baseSource;
  const expectedSource = base.slice(0, edit.start) + edit.newText + base.slice(edit.end);
  expectedSourceRef.current = expectedSource;
  pending.push({ edit, expectedSource });
}

function resolve(
  pending: Pending[],
  expectedSourceRef: { current: string | null },
  renderedSource: string,
  anchors: ReadonlySet<number>,
): { anchors: Set<number>; remaining: Pending[] } {
  const matchedUpTo = pending.findIndex((p) => p.expectedSource === renderedSource);
  if (matchedUpTo === -1) {
    expectedSourceRef.current = null;
    return { anchors: new Set(anchors), remaining: [] };
  }
  const toApply = pending.slice(0, matchedUpTo + 1);
  const remaining = pending.slice(matchedUpTo + 1);
  if (remaining.length === 0) expectedSourceRef.current = null;
  let next = new Set(anchors);
  for (const { edit } of toApply) next = shiftAnchors(next, edit);
  return { anchors: next, remaining };
}

describe("BUG-001 Part A — anchor shift queue sequencing", () => {
  it("does not shift anchors until the matching parse (matching source) actually resolves", () => {
    const source = "AAAA BBBB CCCC"; // three "cards" at offsets 0, 5, 10
    const anchors = new Set([10]); // card CCCC expanded
    const pending: Pending[] = [];
    const expectedSourceRef = { current: null as string | null };

    // Delete "AAAA " (offsets 0-5) -> Δ = -5
    const edit: OffsetEdit = { start: 0, end: 5, newText: "" };
    queueEdit(pending, expectedSourceRef, source, edit);

    // Anchors must NOT have moved yet, synchronously — this is exactly
    // what eager shifting got wrong (rendering new anchors against the
    // still-old AST for the ~150ms+worker-round-trip window, which
    // visibly jumped expansion to a neighbouring card for one frame).
    expect(anchors.has(10)).toBe(true);
    expect(isAnchoredWithin(anchors, { start: 5, end: 9 })).toBe(false); // old BBBB span, unaffected
    expect(pending.length).toBe(1);

    // The matching post-edit source renders.
    const postEditSource = source.slice(0, edit.start) + edit.newText + source.slice(edit.end); // "BBBB CCCC"
    const resolved = resolve(pending, expectedSourceRef, postEditSource, anchors);
    expect(resolved.remaining.length).toBe(0);
    // Anchor shifted by Δ=-5 now that the AST it applies to has caught up.
    expect(resolved.anchors.has(5)).toBe(true);
    expect(resolved.anchors.has(10)).toBe(false);
  });

  it("chains a rapid second edit correctly even though the first edit's intermediate source never itself renders (coalesced)", () => {
    const source = "AAAA BBBB CCCC"; // C starts at offset 10
    const anchors = new Set([10]);
    const pending: Pending[] = [];
    const expectedSourceRef = { current: null as string | null };

    // Edit 1: delete "AAAA " (offsets 0-5, Δ=-5) -> expected "BBBB CCCC".
    queueEdit(pending, expectedSourceRef, source, { start: 0, end: 5, newText: "" });
    // Edit 2 fires before edit 1's reparse lands, so its offsets are
    // expressed in edit 1's *expected* (not-yet-rendered) coordinate
    // space: "BBBB CCCC" -> replace "BBBB" (offsets 0-4) with "ZZ". This
    // is the point of chaining off expectedSourceRef instead of the
    // (still stale) `source` prop.
    queueEdit(pending, expectedSourceRef, source, { start: 0, end: 4, newText: "ZZ" });

    // Only the FINAL combined source ever actually renders — the
    // requestId dedup in useParsedDocument means edit 1's own
    // intermediate source is dropped as a superseded/out-of-order
    // response and never becomes `source`.
    const finalSource = "ZZ CCCC";
    const result = resolve(pending, expectedSourceRef, finalSource, anchors);
    expect(result.remaining.length).toBe(0); // both shifts applied together, one commit
    expect(result.anchors.has(10)).toBe(false);
    // "ZZ CCCC": Z0 Z1 ' '2 C3 C4 C5 C6 — C now starts at 3.
    expect(result.anchors.has(3)).toBe(true);
  });

  it("drops a stuck queue instead of hanging forever if an out-of-band source shows up", () => {
    const source = "AAAA BBBB";
    const anchors = new Set([5]);
    const pending: Pending[] = [];
    const expectedSourceRef = { current: null as string | null };
    queueEdit(pending, expectedSourceRef, source, { start: 0, end: 4, newText: "X" });

    // Something totally unrelated changed the document (e.g. manual
    // Code-tab typing racing a Breakdown edit) — the queue must not hang
    // forever waiting for a source that will never render.
    const result = resolve(pending, expectedSourceRef, "totally different text", anchors);
    expect(result.remaining.length).toBe(0);
    expect(expectedSourceRef.current).toBeNull();
  });
});
