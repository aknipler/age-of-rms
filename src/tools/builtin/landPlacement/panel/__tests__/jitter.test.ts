// slice-c-brief.md item 3's own acceptance: "the jitter calculation returns
// the right bound at every count from 1 to 8, and refuses an impossible
// request rather than clamping it to zero." Also item 3's own verification
// clause: "mutation-test the jitter calculation... every wrong answer it can
// give is a plausible-looking number, which is the case where a green test
// proves least." See this file's own mutation log at the bottom.

import { describe, expect, it } from "vitest";
import { computeJitterAmount, computeSafeJitterDegrees } from "../jitter";

describe("computeSafeJitterDegrees — the brief's own worked example", () => {
  it("8 players, minimum 40, leaves exactly 2.5 degrees of jitter", () => {
    const r = computeSafeJitterDegrees(8, 1, 40);
    expect(r.ok).toBe(true);
    expect(r.ok && r.jitterDegrees).toBeCloseTo(2.5, 10);
  });

  it("8 players, minimum 50, is impossible (the even gap itself is only 45)", () => {
    const r = computeSafeJitterDegrees(8, 1, 50);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason.length).toBeGreaterThan(0);
  });
});

describe("computeSafeJitterDegrees — every count 1 through 8, patternLength 1", () => {
  // Requesting exactly half the even gap as the minimum should leave exactly
  // a quarter of the even gap as jitter, at every count — a single relation
  // that has to hold regardless of how many players are in the branch, which
  // is a much harder target for a mutant to satisfy by accident than any one
  // pinned number.
  for (let count = 1; count <= 8; count++) {
    it(`count ${count}: requesting half the even gap leaves a quarter of it as jitter`, () => {
      const evenGap = 360 / count;
      const r = computeSafeJitterDegrees(count, 1, evenGap / 2);
      expect(r.ok).toBe(true);
      expect(r.ok && r.jitterDegrees).toBeCloseTo(evenGap / 4, 10);
    });

    it(`count ${count}: requesting the exact even gap leaves zero jitter, and is NOT impossible`, () => {
      const evenGap = 360 / count;
      const r = computeSafeJitterDegrees(count, 1, evenGap);
      expect(r.ok).toBe(true);
      expect(r.ok && r.jitterDegrees).toBeCloseTo(0, 10);
    });

    it(`count ${count}: requesting one degree more than the even gap is refused, not clamped`, () => {
      const evenGap = 360 / count;
      const r = computeSafeJitterDegrees(count, 1, evenGap + 1);
      expect(r.ok).toBe(false);
    });

    it(`count ${count}: requesting zero separation is always safe and returns HALF the even gap as jitter`, () => {
      const evenGap = 360 / count;
      const r = computeSafeJitterDegrees(count, 1, 0);
      expect(r.ok).toBe(true);
      expect(r.ok && r.jitterDegrees).toBeCloseTo(evenGap / 2, 10);
    });
  }
});

describe("computeSafeJitterDegrees — an infinitesimally impossible request is still refused", () => {
  // A found gap, not a hypothetical: an early version of the refusal
  // threshold read `jitterDegrees < -0.0001` (a plausible-looking epsilon
  // guard against floating-point noise) and every test above still passed,
  // because none of them targeted a request whose shortfall is smaller than
  // that epsilon. This is exactly the plausible-looking-wrong-answer failure
  // mode item 3's own verification clause warns about.
  it("a request exceeding the even gap by a tiny fraction of a degree is still refused, not silently accepted", () => {
    const evenGap = 360 / 8;
    const r = computeSafeJitterDegrees(8, 1, evenGap + 0.00002);
    expect(r.ok).toBe(false);
  });
});

describe("computeSafeJitterDegrees — patternLength scales the population, not just the count", () => {
  it("a 3-slot pattern at 4 players spaces 12 lands, not 4 — the even gap is 30 degrees, not 90", () => {
    const r = computeSafeJitterDegrees(4, 3, 0);
    expect(r.ok).toBe(true);
    expect(r.ok && r.jitterDegrees).toBeCloseTo(15, 10); // half of 30
  });

  it("patternLength 3 at 4 players refuses a minimum above 30 degrees, same as patternLength 1 at 12 players would", () => {
    const wide = computeSafeJitterDegrees(4, 3, 35);
    const equivalent = computeSafeJitterDegrees(12, 1, 35);
    expect(wide.ok).toBe(false);
    expect(equivalent.ok).toBe(false);
  });
});

// A hand-written mutation log (this repo's own convention, e.g. rms0304's
// flag-deletion mutant): each row is a change to computeSafeJitterDegrees'
// own arithmetic that a fixture-blind reviewer could plausibly ship, applied
// by hand to a byte copy and confirmed red, then restored, per CLAUDE.md's
// "a check that has only ever passed proves nothing" rule.
//
//   mutation                                                    | caught by
//   ------------------------------------------------------------ | ------------------------------------------------
//   `count * patternLength` -> `count + patternLength`           | "patternLength scales the population" (12 vs 4+3=7)
//   `360 / totalLands` -> `totalLands / 360`                     | "half the even gap" (would invert the whole scale)
//   `(evenGap - requested) / 2` -> `evenGap - requested`         | "half the even gap" (off by factor of 2)
//   `(evenGap - requested) / 2` -> `(evenGap - requested) * 2`   | "half the even gap" (off by factor of 4)
//   `< 0` -> `<= 0`                                              | "exact even gap leaves zero jitter, NOT impossible"
//   returning `Math.max(0, jitterDegrees)` instead of refusing   | "one degree more... is refused" (would silently clamp)
//
// ONE SURVIVED THE FIRST PASS: `< 0` -> `< -0.0001`, a plausible-looking
// float-noise epsilon guard, passed all 36 tests above it unchanged. None of
// them requested a separation whose shortfall was smaller than that epsilon,
// so the mutant and the original were indistinguishable to every fixture in
// this file. The "infinitesimally impossible" test below was added because
// of that gap, not in anticipation of it, and it is the only test in this
// file whose reason for existing is a mutant that got past everything else.

// per-player-escalation.md Sec.11: the amount the "Add jitter" button
// writes. One draw serves every count, so the bound is taken where the even
// gap is smallest, 8 players, never at the count being previewed.
describe("computeJitterAmount — the whole-number bound the button writes", () => {
  it("degrees: 8 players, one slot, minimum 40 is floor(2.5) = 2", () => {
    expect(computeJitterAmount("deg", 8, 1, 40)).toEqual({
      ok: true,
      amount: 2,
    });
  });

  it("percent: the same request is floor(50 * (1 - 40 / 45)) = floor(5.56) = 5", () => {
    expect(computeJitterAmount("percent", 8, 1, 40)).toEqual({
      ok: true,
      amount: 5,
    });
  });

  it("no minimum allows half the gap either way, 22 degrees or 50 percent", () => {
    expect(computeJitterAmount("deg", 8, 1, 0)).toEqual({
      ok: true,
      amount: 22,
    });
    expect(computeJitterAmount("percent", 8, 1, 0)).toEqual({
      ok: true,
      amount: 50,
    });
  });

  it("is computed at the count it is given, and 8 is tighter than 4", () => {
    // The panel always passes MAX_PLAYER_COUNT. At 4 players the same
    // minimum would allow 25 degrees, which at 8 players would let two
    // neighbours meet, so asking at the previewed count would be unsafe.
    expect(computeJitterAmount("deg", 4, 1, 40)).toEqual({
      ok: true,
      amount: 25,
    });
    expect(computeJitterAmount("deg", 8, 1, 40)).toEqual({
      ok: true,
      amount: 2,
    });
  });

  it("refuses a bound under one whole step instead of writing rnd(0,0)", () => {
    const r = computeJitterAmount("deg", 8, 1, 44); // exact bound 0.5
    expect(r.ok).toBe(false);
    // The same request in percent still has room, 50 * (1 / 45) = 1.1.
    expect(computeJitterAmount("percent", 8, 1, 44)).toEqual({
      ok: true,
      amount: 1,
    });
  });

  it("passes the separation refusal through unchanged", () => {
    expect(computeJitterAmount("percent", 8, 1, 50).ok).toBe(false);
  });
});
