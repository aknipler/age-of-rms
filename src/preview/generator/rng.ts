// Seeded RNG — docs/preview-design.md Sec.8.
//
// PURE (CLAUDE.md hard rule / preview-design Sec.2): no React/Monaco/Tauri.
//
// Two things make this file exist rather than a plain `Math.random()`
// wrapper, and both are goal 5 (byte-for-byte determinism across JS engines
// and engine versions), because that is what makes the re-roll button mean
// anything and what makes 5.2's Monte Carlo reproducible:
//
//   1. Math.random() is not seedable at all.
//   2. ECMAScript leaves Math.sin/cos/pow/sqrt/hypot/log and `**`
//      implementation-defined in their last bits — a V8 point release could
//      change a result. This file (and everything under
//      src/preview/generator/) is lint-scoped (eslint.config.js) to forbid
//      them; only Math.imul (exact 32-bit integer multiply) and exact ops
//      (floor/round/abs/min/max/sign/trunc, +-*%) are used here.
//
// mulberry32 is the generator: tiny, fast, and its arithmetic is entirely
// 32-bit integer ops (Math.imul + shifts + xor), which is exactly what
// "quality is ample for a visual heuristic" buys in exchange for exactness.

import { COS_TABLE, SIN_TABLE, SINE_TABLE_SIZE } from "./sineTable";
import type { StageId } from "./types";

/** Draws successive uint32s in [0, 2^32). Call it to advance the stream. */
export type Rng = () => number;

/**
 * mulberry32. Seed is coerced to uint32 (`>>> 0`), so any 32-bit integer
 * seed — including the output of substreamSeed below — reproduces the same
 * stream forever.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// One splitmix32 avalanche step — used to fold arbitrary integers (a master
// seed, a stage tag, a command ordinal) into a well-mixed 32-bit state. Not
// exported: substreamSeed()/hash32() below are the public surface, so a
// caller never has to know the mixing works this way.
function mix32(x: number): number {
  let t = (x + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * Folds a sequence of 32-bit integers into one well-mixed 32-bit value.
 * Order-sensitive by design — hash32(a, b) !== hash32(b, a) — which is what
 * lets substreamSeed below tell "stage S1, command 3" apart from
 * "stage S3, command 1" even though the same two numbers are involved.
 */
export function hash32(...values: readonly number[]): number {
  let state = 0;
  for (const v of values) {
    state = mix32(state ^ (v >>> 0));
  }
  return state >>> 0;
}

// FNV-1a over a string, folded down to the same 32-bit integer space
// hash32 works in. StageId is a closed 7-value set ("S0".."S6"), so this
// runs once per substream, never per tile — nowhere near Sec.11's budget.
function fnv1aString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Sec.8: "stream seed = hash(masterSeed, stageId, commandOrdinal)". Two
 * instantiated commands never draw from the same substream, so editing one
 * create_object does not reshuffle unrelated commands or land origins —
 * Sec.8 calls this "best-effort stability" since shared mutable state (tile
 * occupancy) can still cascade regardless of substream isolation.
 *
 * Also used for S0's own randomisation (start_random rolls, rnd()), keyed by
 * node ordinal instead of command ordinal, with stageId "S0".
 */
export function substreamSeed(masterSeed: number, stageId: StageId, ordinal: number): number {
  return hash32(masterSeed, fnv1aString(stageId), ordinal);
}

/** Convenience: substreamSeed() followed by mulberry32(). */
export function createSubstream(masterSeed: number, stageId: StageId, ordinal: number): Rng {
  return mulberry32(substreamSeed(masterSeed, stageId, ordinal));
}

/**
 * Uniform integer in [min, max], inclusive both ends — "rnd(a,b): evaluated
 * ... uniform integer inclusive" (Sec.3.6) and "roll r = uniform integer
 * 1-100" (Sec.3.3) both want this shape. Plain modulo, not rejection-sampled:
 * every range this generator draws from (tile coordinates, percentages, tiny
 * counts) is minuscule next to 2^32, so the bias is unmeasurable, and Sec.8
 * is explicit that PRNG quality only has to be "ample for a visual
 * heuristic".
 */
export function nextInt(rng: Rng, min: number, max: number): number {
  const range = max - min + 1;
  return min + (rng() % range);
}

/**
 * Uniform float in [0, 1). For the rare continuous draw an integer range
 * doesn't fit (Sec.6.1's scattered-origin model for negative `circle_radius`
 * is the first caller) — plain division, not a banned Math function.
 */
export function nextFloat01(rng: Rng): number {
  return rng() / 4294967296; // 2^32
}

/**
 * sin/cos of the angle 2*pi*k/n, as fixed-point integers scaled by
 * SINE_SCALE (sineTable.ts) — "Angles come from a precomputed fixed-point
 * sine table indexed by floor(3600*k/N), never Math.sin/Math.cos" (Sec.8).
 * Used for the player ring (k = player index, n = player count) and for
 * angular jitter (k = a drawn offset in the same units as n).
 *
 * Divide the result by SINE_SCALE only where a float is genuinely needed
 * (e.g. handing a coordinate to the renderer) — never inside a comparison
 * that could stay in scaled-integer space, per sineTable.ts's own note.
 */
export function sinAt(k: number, n: number): number {
  return SIN_TABLE[sineIndex(k, n)];
}

export function cosAt(k: number, n: number): number {
  return COS_TABLE[sineIndex(k, n)];
}

function sineIndex(k: number, n: number): number {
  const raw = Math.floor((SINE_TABLE_SIZE * k) / n) % SINE_TABLE_SIZE;
  return raw < 0 ? raw + SINE_TABLE_SIZE : raw;
}
