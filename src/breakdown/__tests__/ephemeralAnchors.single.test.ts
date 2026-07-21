import { describe, expect, it } from "vitest";
import { shiftSingleAnchor } from "../ephemeralAnchors";

// §3.9's selectedAnchor generalization of BUG-001's shift-and-drop rule to
// a single nullable anchor. Thin wrapper over shiftAnchors, but the
// null-passthrough and unwrap-from-Set behavior are worth pinning down
// directly rather than trusting by inspection.
describe("shiftSingleAnchor", () => {
  it("passes null through unchanged", () => {
    expect(shiftSingleAnchor(null, { start: 0, end: 0, newText: "x" })).toBeNull();
  });

  it("shifts an anchor after the edit by the edit's delta (insertion)", () => {
    // "AAAA BBBB" -> insert "XX" at offset 5 -> "AAAA XXBBBB"
    const anchor = 5; // start of "BBBB"
    const result = shiftSingleAnchor(anchor, { start: 5, end: 5, newText: "XX" });
    expect(result).toBe(7);
  });

  it("shifts an anchor after the edit by the edit's delta (deletion)", () => {
    // "AAAA BBBB CCCC" -> delete "BBBB " (offsets 5-10) -> "AAAA CCCC"
    const anchor = 10; // start of "CCCC"
    const result = shiftSingleAnchor(anchor, { start: 5, end: 10, newText: "" });
    expect(result).toBe(5);
  });

  it("leaves an anchor before the edit untouched", () => {
    const anchor = 2;
    const result = shiftSingleAnchor(anchor, { start: 5, end: 10, newText: "" });
    expect(result).toBe(2);
  });

  it("drops an anchor that falls inside the edited/deleted range", () => {
    // Same drop rule as expansion — a selected card that gets deleted
    // simply has no valid anchor afterward (clearSelection's job, but the
    // shift itself is what makes that automatic rather than a special case).
    const anchor = 7; // inside [5, 10)
    const result = shiftSingleAnchor(anchor, { start: 5, end: 10, newText: "" });
    expect(result).toBeNull();
  });
});
