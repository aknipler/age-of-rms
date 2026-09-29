import { describe, expect, it } from "vitest";
import { rememberCollapse, restoreTarget } from "../scrollMemory";

describe("scrollMemory (collapse strip, beta feedback 2026-09-17)", () => {
  it("remembers where the viewport sat inside the card", () => {
    // Card top at 1000, viewport 300 px into it.
    const m = rememberCollapse(1300, 1000);
    expect(m.delta).toBe(300);
    expect(m.settledScrollTop).toBeNull();
  });

  it("does not restore until the collapse scroll has settled", () => {
    const m = rememberCollapse(1300, 1000);
    expect(restoreTarget(m, 1000, 1000)).toBeNull();
  });

  it("restores to the same place inside the card when the user has not scrolled", () => {
    const m = { ...rememberCollapse(1300, 1000), settledScrollTop: 1000 };
    // Same card top after reopen, viewport still where the collapse left it.
    expect(restoreTarget(m, 1000, 1000)).toBe(1300);
    // Sub-pixel drift in scrollTop still counts as "not moved".
    expect(restoreTarget(m, 1000.6, 1000)).toBe(1300);
  });

  it("follows the card if something above it changed height", () => {
    const m = { ...rememberCollapse(1300, 1000), settledScrollTop: 1000 };
    expect(restoreTarget(m, 1000, 1200)).toBe(1500);
  });

  it("leaves the viewport alone once the user has scrolled away", () => {
    const m = { ...rememberCollapse(1300, 1000), settledScrollTop: 1000 };
    expect(restoreTarget(m, 400, 1000)).toBeNull();
  });

  it("never asks for a negative scrollTop", () => {
    const m = { ...rememberCollapse(0, 50), settledScrollTop: 0 };
    expect(restoreTarget(m, 0, 20)).toBe(0);
  });
});
