import { describe, expect, it } from "vitest";
import { rebaseEdit, shiftPointThroughEdits } from "../ephemeralAnchors";

// Ash's "rapid delete corrupts an unrelated command" report. Root cause:
// computeEdit's offsets are only valid relative to the last CONFIRMED
// parse, but a second rapid card action can land on the model before the
// first action's reparse catches up. rebaseEdit is what makes the SECOND
// edit's stale offsets safe to apply on top of the first (still-pending)
// one instead of corrupting whatever now occupies those byte positions.
describe("rebaseEdit", () => {
  it("returns the edit unchanged when there are no prior edits", () => {
    const edit = { start: 10, end: 20, newText: "" };
    expect(rebaseEdit(edit, [])).toEqual(edit);
  });

  it("shifts an edit entirely after a prior deletion by the prior edit's delta", () => {
    // Prior: delete [0,10) -> delta -10. This edit targets [20,30),
    // entirely after the prior edit's end -> shifts to [10,20).
    const prior = { start: 0, end: 10, newText: "" };
    const edit = { start: 20, end: 30, newText: "" };
    expect(rebaseEdit(edit, [prior])).toEqual({ start: 10, end: 20, newText: "" });
  });

  it("shifts an edit entirely after a prior insertion by the prior edit's delta", () => {
    // Prior: insert 5 chars at offset 0 -> delta +5.
    const prior = { start: 0, end: 0, newText: "AAAAA" };
    const edit = { start: 10, end: 15, newText: "" };
    expect(rebaseEdit(edit, [prior])).toEqual({ start: 15, end: 20, newText: "" });
  });

  it("leaves an edit entirely before a prior edit untouched", () => {
    const prior = { start: 50, end: 60, newText: "" };
    const edit = { start: 0, end: 10, newText: "X" };
    expect(rebaseEdit(edit, [prior])).toEqual(edit);
  });

  it("returns null when the edit's range overlaps a still-pending prior edit", () => {
    // The exact bug scenario: card A's delete already removed [0,20) on
    // the model, but card B's edit was computed against the OLD parse
    // and targets [15,25) — genuinely ambiguous, must not guess.
    const prior = { start: 0, end: 20, newText: "" };
    const edit = { start: 15, end: 25, newText: "" };
    expect(rebaseEdit(edit, [prior])).toBeNull();
  });

  it("chains through multiple prior edits in order", () => {
    const priors = [
      { start: 0, end: 5, newText: "" }, // delta -5
      { start: 5, end: 5, newText: "XX" }, // delta +2, applies at the (already-shifted) position
    ];
    // Original edit at [20,30) -> after prior 1 (delta -5, entirely
    // after): [15,25) -> after prior 2 (insert at original offset 5,
    // which after prior 1 has already happened at the same absolute
    // position since prior 2's own offset (5) is expressed in the
    // POST-prior-1 coordinate space by construction of this test):
    // entirely after -> +2 -> [17,27).
    const edit = { start: 20, end: 30, newText: "" };
    expect(rebaseEdit(edit, priors)).toEqual({ start: 17, end: 27, newText: "" });
  });
});

describe("shiftPointThroughEdits", () => {
  it("returns the point unchanged with no prior edits", () => {
    expect(shiftPointThroughEdits(42, [])).toBe(42);
  });

  it("shifts a point through a chain of prior edits", () => {
    const priors = [
      { start: 0, end: 5, newText: "" }, // delta -5
      { start: 5, end: 5, newText: "XX" }, // delta +2
    ];
    expect(shiftPointThroughEdits(20, priors)).toBe(17);
  });

  it("falls back to the original point if it would be dropped (defensive; rebaseEdit should already have rejected this case)", () => {
    const priors = [{ start: 10, end: 20, newText: "" }];
    expect(shiftPointThroughEdits(15, priors)).toBe(15);
  });
});
