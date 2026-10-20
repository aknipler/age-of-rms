import { describe, expect, it } from "vitest";
import { sectionJumpTop } from "../sectionJump";

// Header tops for sections at 100, 400 and 900; the editor can scroll to 700.
const tops = [100, 400, 900];
const max = 700;

describe("sectionJumpTop", () => {
  it("jumps forward to the next header below the top", () => {
    expect(sectionJumpTop(tops, 0, max, 1)).toBe(100);
    expect(sectionJumpTop(tops, 100, max, 1)).toBe(400);
    expect(sectionJumpTop(tops, 250, max, 1)).toBe(400);
  });

  it("jumps backward to the last header above the top", () => {
    expect(sectionJumpTop(tops, 400, max, -1)).toBe(100);
    expect(sectionJumpTop(tops, 550, max, -1)).toBe(400);
  });

  it("wraps at both ends", () => {
    expect(sectionJumpTop(tops, 100, max, -1)).toBe(900);
    expect(sectionJumpTop(tops, 0, max, -1)).toBe(900);
  });

  it("wraps forward instead of sticking on a header the editor cannot scroll to", () => {
    // After jumping to 900 the editor stops at 700, the header is still below it.
    expect(sectionJumpTop(tops, 400, max, 1)).toBe(900);
    expect(sectionJumpTop(tops, 700, max, 1)).toBe(100);
  });

  it("has nowhere to go without sections", () => {
    expect(sectionJumpTop([], 0, max, 1)).toBeNull();
    expect(sectionJumpTop([], 0, max, -1)).toBeNull();
  });
});
