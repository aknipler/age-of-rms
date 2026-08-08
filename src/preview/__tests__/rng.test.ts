import { describe, expect, it } from "vitest";
import { COS_TABLE, SINE_SCALE, SINE_TABLE_SIZE, SIN_TABLE } from "../generator/sineTable";
import {
  cosAt,
  createSubstream,
  hash32,
  mulberry32,
  nextFloat01,
  nextInt,
  sinAt,
  substreamSeed,
} from "../generator/rng";

// This file is a test, not code under src/preview/generator/ — Sec.8's lint
// scope does not (and should not) reach it, so using Math.sin/cos below as
// the reference to check the precomputed table against is fine.

describe("mulberry32", () => {
  it("is deterministic: same seed -> same sequence", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("draws land in [0, 2^32)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4294967296);
    }
  });
});

describe("hash32 / substreamSeed", () => {
  it("is deterministic", () => {
    expect(hash32(7, 8, 9)).toBe(hash32(7, 8, 9));
  });

  it("is order-sensitive, so a stage tag and an ordinal can't swap unnoticed", () => {
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });

  it("gives every (stage, ordinal) pair its own seed", () => {
    const master = 999;
    const a = substreamSeed(master, "S1", 0);
    const b = substreamSeed(master, "S1", 1);
    const c = substreamSeed(master, "S6", 0);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("a command's substream is unaffected by other commands drawing first (Sec.8 best-effort stability)", () => {
    const master = 42;
    const isolated = createSubstream(master, "S1", 5);
    const isolatedDraws = [isolated(), isolated(), isolated()];

    // Simulate earlier commands (ordinals 0..4) in the same stage having
    // already drawn from their own substreams before this one runs.
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const earlier = createSubstream(master, "S1", ordinal);
      earlier();
      earlier();
    }
    const afterEarlierCommands = createSubstream(master, "S1", 5);
    const drawsAfter = [afterEarlierCommands(), afterEarlierCommands(), afterEarlierCommands()];

    expect(drawsAfter).toEqual(isolatedDraws);
  });
});

describe("nextInt", () => {
  it("stays within [min, max] inclusive over many draws", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const v = nextInt(rng, 1, 100);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("reaches every value of a small range", () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(nextInt(rng, 1, 4));
    expect(seen).toEqual(new Set([1, 2, 3, 4]));
  });

  it("is deterministic for a given seed", () => {
    const a = mulberry32(55);
    const b = mulberry32(55);
    const drawsA = Array.from({ length: 10 }, () => nextInt(a, -8, 8));
    const drawsB = Array.from({ length: 10 }, () => nextInt(b, -8, 8));
    expect(drawsA).toEqual(drawsB);
  });
});

describe("nextFloat01", () => {
  it("stays within [0, 1) over many draws", () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const v = nextFloat01(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = mulberry32(21);
    const b = mulberry32(21);
    const drawsA = Array.from({ length: 10 }, () => nextFloat01(a));
    const drawsB = Array.from({ length: 10 }, () => nextFloat01(b));
    expect(drawsA).toEqual(drawsB);
  });

  it("spreads across the range rather than clustering (mean near 0.5 over many draws)", () => {
    const rng = mulberry32(3);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) sum += nextFloat01(rng);
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});

describe("sinAt / cosAt", () => {
  it("matches the cardinal points exactly (3600 divides evenly by 4)", () => {
    expect(sinAt(0, 4)).toBe(0);
    expect(cosAt(0, 4)).toBe(SINE_SCALE);
    expect(sinAt(1, 4)).toBe(SINE_SCALE);
    expect(cosAt(1, 4)).toBe(0);
    expect(sinAt(2, 4)).toBe(0);
    expect(cosAt(2, 4)).toBe(-SINE_SCALE);
    expect(sinAt(3, 4)).toBe(-SINE_SCALE);
    expect(cosAt(3, 4)).toBe(0);
  });

  it("tracks the true angle within the table's quantisation error (measured max 16.7, tools/gen-sine-table.mjs)", () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [1, 8],
      [3, 8],
      [5, 12],
      [7, 16],
      [1, 3],
      [2, 7],
    ];
    for (const [k, n] of cases) {
      const theta = (2 * Math.PI * k) / n;
      const expectedSin = Math.sin(theta) * SINE_SCALE;
      const expectedCos = Math.cos(theta) * SINE_SCALE;
      expect(Math.abs(sinAt(k, n) - expectedSin)).toBeLessThan(20);
      expect(Math.abs(cosAt(k, n) - expectedCos)).toBeLessThan(20);
    }
  });

  it("handles negative k (wrap-around)", () => {
    // -1/4 turn is the same point as 3/4 turn.
    expect(sinAt(-1, 4)).toBe(sinAt(3, 4));
    expect(cosAt(-1, 4)).toBe(cosAt(3, 4));
  });

  it("satisfies sin^2 + cos^2 ~= scale^2 across the whole table (measured max deviation 12119)", () => {
    for (let i = 0; i < SINE_TABLE_SIZE; i += 37) {
      const s = SIN_TABLE[i];
      const c = COS_TABLE[i];
      const sumSquares = s * s + c * c;
      expect(Math.abs(sumSquares - SINE_SCALE * SINE_SCALE)).toBeLessThan(15000);
    }
  });
});
