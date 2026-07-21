import { describe, expect, it } from "vitest";
import type { Diagnostic, Item } from "../../parser/types";
import { ticksForItems } from "../rulerTicks";

// §3.10 — the diagnostics overview ruler's pure "which top-level items
// get a tick, and what severity" logic (DOM measurement/positioning is
// intentionally NOT covered here, see DiagnosticsRuler.tsx's own doc
// comment for why that half can't be pure-tested).
function diag(severity: Diagnostic["severity"], start: number, end: number): Diagnostic {
  return { severity, code: "TEST0000", message: "test", span: { start, end } };
}

function item(start: number, end: number): Item {
  // Minimal shape — ticksForItems only reads .span, so a bare cast is
  // fine here (same convention other pure-module tests in this repo use
  // for minimal item-like fixtures, e.g. comments.test.ts).
  return { kind: "directive", span: { start, end } } as unknown as Item;
}

describe("ticksForItems", () => {
  it("returns no ticks when nothing has a diagnostic", () => {
    const items = [item(0, 5), item(10, 15)];
    expect(ticksForItems(items, [])).toEqual([]);
  });

  it("one tick per item that has at least one diagnostic within its span", () => {
    const items = [item(0, 5), item(10, 15), item(20, 25)];
    const diagnostics = [diag("warning", 12, 14)];
    const ticks = ticksForItems(items, diagnostics);
    expect(ticks).toEqual([{ anchor: 10, severity: "warning" }]);
  });

  it("uses the MAX severity when an item has multiple diagnostics (error > warning > info)", () => {
    const items = [item(0, 10)];
    const diagnostics = [diag("info", 1, 2), diag("error", 3, 4), diag("warning", 5, 6)];
    expect(ticksForItems(items, diagnostics)).toEqual([{ anchor: 0, severity: "error" }]);
  });

  it("does not attribute a diagnostic outside an item's span to that item", () => {
    const items = [item(0, 5)];
    const diagnostics = [diag("error", 10, 12)];
    expect(ticksForItems(items, diagnostics)).toEqual([]);
  });

  it("includes a diagnostic nested deep inside an item's span (collapsed-container case, §3.10)", () => {
    // A diagnostic on something inside a command's block still counts
    // toward the OWNING top-level item's tick — this is what makes
    // "ticks for cards inside collapsed containers still appear" true
    // with zero extra expand-state-aware logic.
    const items = [item(0, 100)];
    const diagnostics = [diag("error", 40, 45)];
    expect(ticksForItems(items, diagnostics)).toEqual([{ anchor: 0, severity: "error" }]);
  });

  it("returns ticks in item order, one per qualifying item", () => {
    const items = [item(0, 5), item(10, 15), item(20, 25)];
    const diagnostics = [diag("error", 21, 22), diag("info", 1, 2)];
    expect(ticksForItems(items, diagnostics)).toEqual([
      { anchor: 0, severity: "info" },
      { anchor: 20, severity: "error" },
    ]);
  });
});
