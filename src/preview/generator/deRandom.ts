// The game's own random number generator, docs/preview-design.md Sec.8 (rev 9).
// PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// The land stage draws from ONE stream, from the script's first rnd() to the
// last growth step, and matching the game tile for tile means drawing the
// same numbers in the same order. So this file is the game's generator
// rather than a generator of our choosing. Everything here was established
// by black-box tests against saved DE maps (preview-design Sec.8 holds the
// rules), and every step uses public algorithms only.
//
//   - WELL512, as Chris Lomont published it in "Random Number Generation"
//     (2008). Sixteen 32-bit words of state and an index.
//   - Seeding fills the sixteen words from two sequences run side by side, a
//     32-bit xorshift started from the byte-reversed seed, and Robert
//     Jenkins' 32-bit integer hash started from the seed itself.
//   - A chain of two generators. The first is seeded with the game seed, the
//     second with the first one's first output, and the script's first draw
//     is the second generator's SECOND output.
//
// All arithmetic is 32-bit integer work, so Sec.8's lint rule has nothing to
// object to. One JS detail matters throughout. `<<` and `^` return SIGNED
// 32-bit integers, so every value that leaves a step goes through `>>> 0` to
// come back as the unsigned word the algorithm means. The bits are the same
// either way, and only comparisons and arithmetic care which reading is used.

/** Plain data, so an instantiated script can carry a stream position to S1 and a clone can resume it. */
export interface DeStreamState {
  /** WELL512's sixteen state words, unsigned. */
  words: number[];
  index: number;
  /** How many draws this stream has made. Diagnostics only, the algorithm never reads it. */
  count: number;
}

/** One live stream. Every method advances it by exactly the draws its doc comment names. */
export interface DeStream {
  /** One raw 32-bit draw. */
  raw(): number;
  /** One draw reduced to 0..n-1 by multiplying and shifting, `(n * raw) >> 32`. The default reduction. */
  bounded(n: number): number;
  /** One or more draws reduced to 0..n-1 by `raw % n`, redrawing the few values that would bias it. Only the slot shuffle uses it. */
  index(n: number): number;
  /** One draw reduced to 0..m-1 from its low 15 bits. Only the team-order draws use it. */
  low15(m: number): number;
  /** A copy of the current position, for `resumeDeStream`. */
  state(): DeStreamState;
}

/** Robert Jenkins' 32-bit integer hash, the six-step version. */
export function jenkinsHash(input: number): number {
  let a = input >>> 0;
  a = (a + 0x7ed55d16 + (a << 12)) >>> 0;
  a = (a ^ 0xc761c23c ^ (a >>> 19)) >>> 0;
  a = (a + 0x165667b1 + (a << 5)) >>> 0;
  a = ((a + 0xd3a2646c) ^ (a << 9)) >>> 0;
  a = (a + 0xfd7046c5 + (a << 3)) >>> 0;
  return (a ^ 0xb55a4f09 ^ (a >>> 16)) >>> 0;
}

function byteSwap(v: number): number {
  return (
    (((v & 0xff) << 24) |
      ((v & 0xff00) << 8) |
      ((v >>> 8) & 0xff00) |
      (v >>> 24)) >>>
    0
  );
}

function seedWords(seed: number): number[] {
  const s = seed >>> 0;
  let x = (byteSwap(s) ^ 0xaac29377) >>> 0;
  let h = s;
  const words: number[] = [];
  for (let k = 0; k < 16; k++) {
    x = (x ^ (x << 17)) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    h = jenkinsHash(h);
    words.push((x ^ h) >>> 0);
  }
  return words;
}

/** WELL512's step. Mutates `st` and returns the word it wrote last, which is the output. */
function wellNext(st: DeStreamState): number {
  const w = st.words;
  const i = st.index;
  let a = w[i];
  let c = w[(i + 13) & 15];
  const b = (a ^ c ^ (a << 16) ^ (c << 15)) >>> 0;
  c = w[(i + 9) & 15];
  c = (c ^ (c >>> 11)) >>> 0;
  a = w[i] = (b ^ c) >>> 0;
  const d = (a ^ ((a << 5) & 0xda442d24)) >>> 0;
  const j = (i + 15) & 15;
  a = w[j];
  w[j] = (a ^ b ^ d ^ (a << 2) ^ (b << 18) ^ (c << 28)) >>> 0;
  st.index = j;
  return w[j];
}

/**
 * `floor(n * raw / 2^32)` for any integer `n`, exactly.
 *
 * The product can reach 2^63, past the 2^53 a double holds exactly, so the
 * multiply is split on raw's two 16-bit halves. Floor division by 2^32 is
 * two floor divisions by 2^16, and each partial product stays under 2^49.
 */
export function mulHigh32(n: number, raw: number): number {
  const hi = raw >>> 16;
  const lo = raw & 0xffff;
  return Math.floor((n * hi + Math.floor((n * lo) / 65536)) / 65536);
}

const MAX_U32 = 0xffffffff;

function wrap(st: DeStreamState): DeStream {
  const raw = (): number => {
    st.count++;
    return wellNext(st);
  };
  return {
    raw,
    bounded: (n) => mulHigh32(n, raw()),
    index(n) {
      // A power of two divides 2^32, so no value is biased and none is redrawn.
      const powerOfTwo = n > 0 && (n & (n - 1)) === 0;
      const limit = n * Math.floor(MAX_U32 / n);
      for (;;) {
        const r = raw();
        if (powerOfTwo || r < limit) return r % n;
      }
    },
    low15: (m) => (raw() & 0x7fff) % m,
    state: () => ({ words: [...st.words], index: st.index, count: st.count }),
  };
}

/**
 * The stream a map script draws from, for the game seed `seed`. A negative
 * seed is taken as its 32-bit two's complement, which `>>> 0` does.
 */
export function createDeStream(seed: number): DeStream {
  const first: DeStreamState = { words: seedWords(seed), index: 0, count: 0 };
  const second: DeStreamState = {
    words: seedWords(wellNext(first)),
    index: 0,
    count: 0,
  };
  // The second generator's first output went into the chain, where it would
  // seed a third generator. The script never sees it.
  wellNext(second);
  return wrap(second);
}

/** A new live stream that continues from `state`. The state itself is copied, so resuming it twice gives two identical streams. */
export function resumeDeStream(state: DeStreamState): DeStream {
  return wrap({
    words: [...state.words],
    index: state.index,
    count: state.count,
  });
}
