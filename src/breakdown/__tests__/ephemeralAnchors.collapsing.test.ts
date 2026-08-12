import { describe, expect, it } from "vitest";
import { shiftCollapsingAnchor } from "../ephemeralAnchors";

// The preview pin's shift rule (PreviewCutContext, docs/preview-design.md
// Sec.5) — shiftSingleAnchor's sibling, differing only in what happens to an
// anchor caught inside a replaced range. The first case below is the one this
// file exists for: it is the whole bug this rule shipped with, and it is
// invisible in the app until the view is switched to Current.
describe("shiftCollapsingAnchor", () => {
  it("leaves an absent anchor absent, rather than collapsing it onto the edit", () => {
    // The shipped defect, exactly. Loading a document fires a content change
    // at offset 0, and the old `shiftSingleAnchor(...) ?? edit.start` read
    // that null as "dropped" and pinned line 1 on a pane nobody had touched.
    expect(shiftCollapsingAnchor(null, { start: 0, end: 0, newText: "create_land" })).toBeNull();
    expect(shiftCollapsingAnchor(null, { start: 40, end: 60, newText: "" })).toBeNull();
  });

  it("collapses an anchor inside the replaced range to that range's start", () => {
    // Where it differs from shiftSingleAnchor, which drops this one.
    const anchor = 7; // inside [5, 10)
    expect(shiftCollapsingAnchor(anchor, { start: 5, end: 10, newText: "" })).toBe(5);
  });

  it("shifts, and leaves alone, exactly like shiftSingleAnchor otherwise", () => {
    expect(shiftCollapsingAnchor(5, { start: 5, end: 5, newText: "XX" })).toBe(7);
    expect(shiftCollapsingAnchor(10, { start: 5, end: 10, newText: "" })).toBe(5);
    expect(shiftCollapsingAnchor(2, { start: 5, end: 10, newText: "" })).toBe(2);
  });

  it("treats offset 0 as a real anchor, not as absence", () => {
    // A pin at the top of the script is a legitimate pin. Any `!anchor` test
    // here would read it as unpinned — the same falsy-zero trap
    // resolveCutOffset documents for its own `??`.
    expect(shiftCollapsingAnchor(0, { start: 4, end: 4, newText: "XX" })).toBe(0);
  });
});
