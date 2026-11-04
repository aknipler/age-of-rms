// A reduced ordered binary decision diagram, the engine behind name liveness
// (docs/name-liveness-design.md Sec.4.6). PURE: no React, Monaco or Tauri.
//
// A boolean formula can be stored as a graph. Every node tests one variable
// and has a low child (the formula when the variable is false) and a high
// child (when it is true). Two rules make the graph canonical.
//
//   - Ordered: along any path the variables appear in increasing index, so a
//     formula has one shape no matter how it was built.
//   - Reduced: a node whose two children are equal is never made (it tests a
//     variable that does not matter), and two nodes with the same variable and
//     children are never made twice (hash-consing, below).
//
// Canonical means two equal formulas end up as the SAME node number. So
// "is this formula impossible" is `node === FALSE`, and "does A imply B" is
// "is A and not B impossible", one comparison each. That is why liveness uses
// this and not a SAT solver: every question it asks is an equality test.
//
// The usual alternative is to keep formulas as trees of and/or/not and test
// satisfiability by search. That costs time on every question, while here the
// cost is paid once, when a formula is built.

/** A node is an index into the parallel arrays below. 0 is false and 1 is true. */
export type BddNode = number;

/** Thrown when the diagram would pass its node cap. The caller reports nothing for that file, never a partial answer. */
export class BddOverflow extends Error {
  constructor() {
    super("BDD node cap reached");
    this.name = "BddOverflow";
  }
}

/** The "variable" of a terminal. Larger than any real index, so a terminal always sorts below every test. */
const TERMINAL_VAR = 0x7fffffff;

/**
 * The size of the ite cache, a power of two. It is a lossy cache: a new answer
 * overwrites whatever shared its slot, and every entry stores its full key so
 * a hit is exact. Losing an entry only costs a recomputation, never a wrong
 * answer, and the table never grows, so memory is bounded on any file.
 */
const CACHE_SIZE = 1 << 18;

/** A 32-bit hash of three integers, for the unique table and the ite cache. */
function hash3(a: number, b: number, c: number): number {
  let h =
    Math.imul(a, 0x9e3779b1) ^
    Math.imul(b, 0x85ebca6b) ^
    Math.imul(c, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

export class Bdd {
  readonly FALSE: BddNode = 0;
  readonly TRUE: BddNode = 1;

  // Structure of arrays: three typed arrays instead of an array of objects.
  // A typed array is one flat block of memory with no per-node object header,
  // which matters when a file makes a hundred thousand nodes. They grow by
  // doubling, the same amortised trick a C++ vector uses.
  private vars: Int32Array;
  private lows: Int32Array;
  private highs: Int32Array;
  private count = 2;

  // Hash-consing: (variable, low, high) to the node that already has them.
  // A hand-written table, not a Map keyed by a joined string. Building and
  // hashing a string per lookup was the dominant cost on include-heavy
  // scripts. Here each bucket holds the id of its first node, and
  // `chain[id]` links to the next node in the same bucket (0 ends a chain,
  // since ids 0 and 1 are terminals and never in the table).
  private buckets = new Int32Array(4096);
  private chain: Int32Array;

  // The ite cache: parallel arrays indexed by hash(f, g, h).
  private readonly cacheF = new Int32Array(CACHE_SIZE).fill(-1);
  private readonly cacheG = new Int32Array(CACHE_SIZE);
  private readonly cacheH = new Int32Array(CACHE_SIZE);
  private readonly cacheR = new Int32Array(CACHE_SIZE);

  constructor(private readonly maxNodes = 200_000) {
    this.vars = new Int32Array(64);
    this.lows = new Int32Array(64);
    this.highs = new Int32Array(64);
    this.chain = new Int32Array(64);
    this.vars[0] = TERMINAL_VAR;
    this.vars[1] = TERMINAL_VAR;
    this.highs[1] = 1;
    this.lows[1] = 1;
  }

  get nodeCount(): number {
    return this.count;
  }

  /** The formula that is true exactly when variable `index` is true. A lower index sits nearer the root. */
  variable(index: number): BddNode {
    return this.make(index, this.FALSE, this.TRUE);
  }

  not(a: BddNode): BddNode {
    return this.ite(a, this.FALSE, this.TRUE);
  }

  and(a: BddNode, b: BddNode): BddNode {
    return this.ite(a, b, this.FALSE);
  }

  or(a: BddNode, b: BddNode): BddNode {
    return this.ite(a, this.TRUE, b);
  }

  /** a implies b, true when `a and not b` is impossible. */
  implies(a: BddNode, b: BddNode): boolean {
    return this.isFalse(this.and(a, this.not(b)));
  }

  isFalse(a: BddNode): boolean {
    return a === this.FALSE;
  }

  /** The variable a node tests, or undefined for a terminal. For the describer. */
  variableOf(a: BddNode): number | undefined {
    return a < 2 ? undefined : this.vars[a];
  }

  /** The child taken when the node's variable is false. */
  lowOf(a: BddNode): BddNode {
    return this.lows[a];
  }

  /** The child taken when the node's variable is true. */
  highOf(a: BddNode): BddNode {
    return this.highs[a];
  }

  /**
   * If-then-else, `f ? g : h`. Every other operator is a call to this one
   * (`and(a,b)` is `ite(a,b,0)`), so only one recursion has to be right.
   *
   * It splits on the lowest variable any of the three tests, builds the answer
   * for that variable false and true, and joins them with `make`. The memo
   * table is what stops the recursion repeating itself: the same triple of
   * nodes always has the same answer.
   */
  ite(f: BddNode, g: BddNode, h: BddNode): BddNode {
    if (f === 1) return g;
    if (f === 0) return h;
    if (g === h) return g;
    if (g === 1 && h === 0) return f;

    const slot = hash3(f, g, h) & (CACHE_SIZE - 1);
    if (
      this.cacheF[slot] === f &&
      this.cacheG[slot] === g &&
      this.cacheH[slot] === h
    )
      return this.cacheR[slot];

    const v = Math.min(this.vars[f], this.vars[g], this.vars[h]);
    const lo = this.ite(
      this.cofactor(f, v, false),
      this.cofactor(g, v, false),
      this.cofactor(h, v, false),
    );
    const hi = this.ite(
      this.cofactor(f, v, true),
      this.cofactor(g, v, true),
      this.cofactor(h, v, true),
    );
    const result = this.make(v, lo, hi);

    // The recursion above may have reused this slot, which is why it is
    // written only now.
    this.cacheF[slot] = f;
    this.cacheG[slot] = g;
    this.cacheH[slot] = h;
    this.cacheR[slot] = result;
    return result;
  }

  /** The node's value once variable `v` is fixed. A node that does not test `v` is unchanged. */
  private cofactor(n: BddNode, v: number, value: boolean): BddNode {
    if (this.vars[n] !== v) return n;
    return value ? this.highs[n] : this.lows[n];
  }

  /** The one place a node is made, which is what keeps the diagram reduced. */
  private make(v: number, low: BddNode, high: BddNode): BddNode {
    if (low === high) return low;
    let bucket = hash3(v, low, high) & (this.buckets.length - 1);
    for (let n = this.buckets[bucket]; n !== 0; n = this.chain[n])
      if (this.vars[n] === v && this.lows[n] === low && this.highs[n] === high)
        return n;
    if (this.count >= this.maxNodes) throw new BddOverflow();
    if (this.count === this.vars.length) this.grow();
    // Keep chains short: double the buckets once nodes outnumber them two to one.
    if (this.count > this.buckets.length * 2) {
      this.rehash();
      bucket = hash3(v, low, high) & (this.buckets.length - 1);
    }
    const id = this.count++;
    this.vars[id] = v;
    this.lows[id] = low;
    this.highs[id] = high;
    this.chain[id] = this.buckets[bucket];
    this.buckets[bucket] = id;
    return id;
  }

  private grow(): void {
    const size = this.vars.length * 2;
    const copy = (old: Int32Array): Int32Array => {
      const next = new Int32Array(size);
      next.set(old);
      return next;
    };
    this.vars = copy(this.vars);
    this.lows = copy(this.lows);
    this.highs = copy(this.highs);
    this.chain = copy(this.chain);
  }

  private rehash(): void {
    this.buckets = new Int32Array(this.buckets.length * 2);
    for (let id = 2; id < this.count; id++) {
      const b =
        hash3(this.vars[id], this.lows[id], this.highs[id]) &
        (this.buckets.length - 1);
      this.chain[id] = this.buckets[b];
      this.buckets[b] = id;
    }
  }
}
