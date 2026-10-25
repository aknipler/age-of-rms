// docs/name-lookup-design.md Sec.6.1, when the resolve flash fires: the
// caret leaves a word that was typed one character at a time. These drive
// the two halves of the rule the way attachResolveFlash does, one Monaco
// event at a time.
//
// The tint itself, the 700 ms timer and the setting switch live in
// resolveFlash.ts, which needs Monaco and so is covered by run sheet
// section 38 instead.

import { describe, expect, it } from "vitest";
import { pendingAfterChange, wordLeft } from "../flashRule";

/**
 * Types `typed` into `before` at `at` one character at a time, then moves
 * the caret to `caretAfter` (default: just past the last typed character).
 * Returns the word the flash would check, or null if none.
 */
function typeThenMove(
  before: string,
  at: number,
  typed: string,
  caretAfter?: number,
): string | null {
  let text = before;
  let pending: number | null = null;
  let caret = at;
  let left: string | null = null;
  for (const ch of typed) {
    text = text.slice(0, caret) + ch + text.slice(caret);
    pending = pendingAfterChange(
      pending,
      { rangeOffset: caret, text: ch },
      text,
    );
    caret++;
    if (pending !== null) {
      left = wordLeft(text, pending, caret);
      if (left !== null) pending = null;
    }
    if (left !== null) return left;
  }
  if (caretAfter === undefined || pending === null) return null;
  return wordLeft(text, pending, caretAfter);
}

describe("the flash rule", () => {
  it("fires on the space after a typed word", () => {
    expect(typeThenMove("terrain_type ", 13, "GRASS ")).toBe("GRASS");
  });

  it("does not fire while the caret is still in the word", () => {
    expect(typeThenMove("terrain_type ", 13, "GRAS")).toBeNull();
    expect(typeThenMove("terrain_type ", 13, "GRASS", 15)).toBeNull();
  });

  it("fires when an arrow key or a click moves the caret off the word", () => {
    expect(typeThenMove("terrain_type \nnext", 13, "GRASS", 20)).toBe("GRASS");
    expect(typeThenMove("terrain_type ", 13, "GRASS", 0)).toBe("GRASS");
  });

  it("counts letters typed into the middle of an existing word", () => {
    // "GRSS" -> "GRASS", then leave with the caret at the line start.
    expect(typeThenMove("terrain_type GRSS", 15, "A", 0)).toBe("GRASS");
  });

  it("forgets the word after a paste or an accepted suggestion", () => {
    expect(
      pendingAfterChange(13, { rangeOffset: 18, text: "GRASS" }, "x"),
    ).toBeNull();
  });

  it("forgets the word after an edit before it", () => {
    expect(
      pendingAfterChange(13, { rangeOffset: 2, text: "x" }, "x"),
    ).toBeNull();
    expect(
      pendingAfterChange(13, { rangeOffset: 2, text: "" }, "x"),
    ).toBeNull();
  });

  it("keeps the word through a deletion inside it", () => {
    expect(pendingAfterChange(13, { rangeOffset: 16, text: "" }, "x")).toBe(13);
    expect(wordLeft("terrain_type GRAS", 13, 17)).toBeNull();
  });

  it("reports an empty word when it was deleted entirely", () => {
    expect(wordLeft("terrain_type  next", 13, 0)).toBe("");
  });
});
