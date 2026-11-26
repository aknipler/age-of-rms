// The object stage walk's tile pick (weightPicker.ts). The snapshot path has
// to give the same tile as the plain search for every draw, or the walk's
// picks drift from DE's. `deObjectMaps.test.ts` checks that on real maps, and
// this checks it on weights built to reach the snapshot's edge cases.

import { describe, expect, it } from "vitest";
import { WeightPicker } from "../generator/weightPicker";

/** The definition the picker implements, the largest k with prefix(k) <= r. */
function linearPick(weights: number[], r: number): number {
  let sum = 0;
  let k = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (sum <= r) k = i + 1;
    else break;
  }
  return k;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** A walk like deObjectStage's, `takes` deciding which picks lower a weight. */
function runWalk(
  weights: number[],
  useSnapshot: boolean,
  draws: number,
  seed: number,
  takes: (k: number) => boolean,
): void {
  const live = [...weights];
  const picker = new WeightPicker(weights, useSnapshot);
  const next = lcg(seed);
  let total = live.reduce((s, w) => s + w, 0);
  for (let i = 0; i < draws && total > 0; i++) {
    const r = next() % total;
    const k = picker.pick(r);
    expect(k).toBe(linearPick(live, r));
    if (takes(k)) {
      picker.take(k);
      live[k]--;
      total--;
    }
  }
  for (let k = 0; k < live.length; k++) expect(picker.weight(k)).toBe(live[k]);
}

describe("WeightPicker (weightPicker.ts)", () => {
  it("matches the plain search with heavy unavailable tiles and light available ones", () => {
    // Namatjira's shape. Most weight sits on tiles that are never taken.
    const next = lcg(5);
    const weights = Array.from({ length: 300 }, (_, k) =>
      k % 7 === 0 ? 1 + (next() % 3) : 1000 + (next() % 50_000),
    );
    runWalk(weights, true, 60_000, 11, (k) => k % 7 === 0);
  });

  it("matches with zero weights, runs of zeros at both ends and in the middle", () => {
    const weights = [0, 0, 5, 0, 0, 0, 9, 1, 0, 3, 0, 0];
    runWalk(weights, true, 2_000, 3, (k) => k % 2 === 0);
  });

  it("matches while every pick lowers a weight, so the snapshot keeps going stale", () => {
    const next = lcg(9);
    const weights = Array.from({ length: 200 }, () => 1 + (next() % 20));
    runWalk(weights, true, 3_000, 4, () => true);
  });

  it("matches with one entry, and with the snapshot off", () => {
    runWalk([7], true, 50, 1, () => true);
    const next = lcg(2);
    const weights = Array.from({ length: 64 }, () => next() % 100);
    runWalk(weights, false, 5_000, 6, (k) => k % 3 === 0);
  });
});
