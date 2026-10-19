// The game's generator and the single-precision helpers, preview-design.md
// Sec.8 (rev 9). The expected values were computed by the land-stage study's
// own reference implementation, which reproduced DE's maps, so a match here means this file draws the same
// numbers the game draws. `landStageDeMaps.test.ts` then checks the numbers
// are used in the game's order.

import { describe, expect, it } from "vitest";
import {
  createDeStream,
  jenkinsHash,
  mulHigh32,
  resumeDeStream,
} from "../generator/deRandom";
import {
  f32Cos,
  f32Sin,
  f32Sqrt,
  percentTile,
  roundHalfAway,
} from "../generator/float32";

describe("the game's stream (deRandom.ts)", () => {
  it("draws the reference outputs for four seeds, a negative one included", () => {
    const expected: [number, number[]][] = [
      [1000, [204557088, 988793673, 3146263836, 2865540197, 2644604738]],
      [0, [1417910392, 899609726, 135511112, 3066950337, 3341729589]],
      [-1411066173, [443129562, 933149725, 721006854, 3791484081, 3122139671]],
      [370167422, [3203095564, 2639333839, 3991872323, 3007277374, 187660171]],
    ];
    for (const [seed, outputs] of expected) {
      const stream = createDeStream(seed);
      expect(outputs.map(() => stream.raw())).toEqual(outputs);
    }
  });

  it("hashes like Robert Jenkins' 32-bit integer hash", () => {
    expect(jenkinsHash(0)).toBe(1800329511);
    expect(jenkinsHash(123456789)).toBe(3651903009);
    expect(jenkinsHash(0xffffffff)).toBe(4268016002);
  });

  it("reduces a draw by multiply and shift, exactly, even past 2^53", () => {
    const stream = createDeStream(1000);
    expect(Array.from({ length: 8 }, () => stream.bounded(100))).toEqual([
      4, 23, 73, 66, 61, 76, 95, 12,
    ]);
    const big = createDeStream(1000);
    expect(Array.from({ length: 3 }, () => big.bounded(2 ** 31 - 1))).toEqual([
      102278543, 494396836, 1573131917,
    ]);
    expect(mulHigh32(0, 0xffffffff)).toBe(0);
    expect(mulHigh32(100, 0xffffffff)).toBe(99);
  });

  it("reduces by modulo with redraws for the shuffle, and by the low 15 bits for the team draws", () => {
    const shuffle = createDeStream(1000);
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => shuffle.index(n))).toEqual([
      0, 0, 0, 2, 2, 0, 6,
    ]);
    const team = createDeStream(1000);
    expect(Array.from({ length: 4 }, () => team.low15(100))).toEqual([
      32, 73, 48, 65,
    ]);
  });

  it("resumes from a saved state, as often as asked, without disturbing it", () => {
    const stream = createDeStream(42);
    stream.raw();
    const saved = stream.state();
    const a = resumeDeStream(saved);
    const b = resumeDeStream(saved);
    const next = [stream.raw(), stream.raw()];
    expect([a.raw(), a.raw()]).toEqual(next);
    expect([b.raw(), b.raw()]).toEqual(next);
    expect(saved.count).toBe(1);
  });
});

describe("single-precision helpers (float32.ts)", () => {
  it("rounds half away from zero, as the game does", () => {
    expect([2.5, -2.5, 2.4999, 0].map(roundHalfAway)).toEqual([3, -3, 2, 0]);
  });

  it("converts percentages to tiles in single precision", () => {
    expect(percentTile(120, 21)).toBe(25);
    expect(percentTile(120, 50)).toBe(60);
    expect(percentTile(200, 2.5)).toBe(5);
  });

  it("matches the correctly rounded float32 cos and sin at reference angles", () => {
    // Correctly rounded values. The study's Python model used numpy's float32
    // cos and sin, which are one unit in the last place off these at 1.2345,
    // 2, 4.5 (cos) and 6.2 (sin), and it still matched every circle_radius map
    // DE saved. Which of the two DE's own cosf returns is unknown (Sec.15
    // item 52). A last-place difference moves a tile only when cos * r + c
    // lands within about 1e-6 of a whole number.
    const cases: [number, number, number][] = [
      [0.5, 0.8775825500488281, 0.4794255495071411],
      [1.2345, 0.3299930989742279, 0.9439833164215088],
      [2, -0.416146844625473, 0.9092974066734314],
      [4.5, -0.2107958048582077, -0.9775301218032837],
      [6.2, 0.9965420961380005, -0.08308959007263184],
    ];
    for (const [angle, cos, sin] of cases) {
      expect(f32Cos(angle)).toBe(cos);
      expect(f32Sin(angle)).toBe(sin);
    }
  });

  it("agrees with the platform's cos and sin, rounded to float32, across the circle", () => {
    // Math.cos is fine HERE, in a test. The generator may not call it
    // (Sec.8's lint rule), which is why float32.ts carries its own.
    let differing = 0;
    for (let k = 0; k < 20000; k++) {
      const angle = Math.fround((2 * Math.PI * k) / 20000);
      if (f32Cos(angle) !== Math.fround(Math.cos(angle))) differing++;
      if (f32Sin(angle) !== Math.fround(Math.sin(angle))) differing++;
    }
    expect(differing).toBe(0);
  });

  it("takes square roots in single precision", () => {
    expect(f32Sqrt(14400)).toBe(120);
    expect(Math.trunc(f32Sqrt(Math.fround(400 / Math.PI)))).toBe(11);
    expect(f32Sqrt(0)).toBe(0);
    expect(f32Sqrt(2)).toBe(Math.fround(Math.SQRT2));
  });
});
