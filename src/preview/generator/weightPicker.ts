// The tile pick inside the object stage's actor-area walk (deObjectStage.ts
// `walk`, de-connections-objects.md 5.4). PURE.
//
// The walk draws r in 0..remaining-1 and takes the tile whose slice of the
// running weights holds r, the largest k with prefix(k) <= r. Only a draw on
// an available tile lowers a weight, by one. On a map like Namatjira that is
// 1 draw in 200, so between those draws the weights do not move at all, and
// the walk makes tens of millions of draws per map.
//
// So the picker keeps two answers to the same question.
//
//   - A Fenwick tree over the live weights, exact at every moment, O(log n).
//   - A snapshot of the prefix sums with a guide table (bucket b of the range
//     names the tile its lowest value falls in), O(1) for most draws.
//
// The snapshot goes stale as weights drop, but in a way that can be bounded.
// Every live prefix sum sits between its snapshot value minus the number of
// decrements since the snapshot (`since`) and its snapshot value. So when the
// snapshot says r falls in tile k, and tile k's upper end is still above r
// after subtracting `since`, the live answer must be k too. Only a draw that
// lands within `since` of a slice's end falls back to the tree. The answer is
// the same tile either way, which is what keeps the walk's draws and picks
// identical to DE's.
//
// The snapshot only pays when draws far outnumber decrements, so the caller
// chooses whether to use it. When fallbacks pile up the snapshot is retaken.

export class WeightPicker {
  private readonly n: number;
  private readonly weights: Float64Array;
  private readonly tree: Float64Array;
  private readonly top: number;
  private readonly snap: Float64Array | undefined;
  private readonly guide: Int32Array | undefined;
  private scale = 0;
  /** Decrements since the snapshot was taken. */
  private since = 0;
  /** Draws since the snapshot that it could not answer. */
  private fallbacks = 0;

  constructor(weights: ArrayLike<number>, useSnapshot: boolean) {
    const n = weights.length;
    this.n = n;
    this.weights = Float64Array.from(weights);
    const tree = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) {
      tree[i] += this.weights[i - 1];
      const j = i + (i & -i);
      if (j <= n) tree[j] += tree[i];
    }
    this.tree = tree;
    let top = 1;
    while (top <= n) top <<= 1;
    this.top = top;
    if (useSnapshot && n > 0) {
      this.snap = new Float64Array(n + 1);
      this.guide = new Int32Array(n);
      this.retake();
    }
  }

  /** The current weight of entry `k`. */
  weight(k: number): number {
    return this.weights[k];
  }

  /** The largest k with prefix(k) <= r, for 0 <= r < the live total. */
  pick(r: number): number {
    const snap = this.snap;
    if (snap !== undefined) {
      const guide = this.guide!;
      const n = this.n;
      let b = Math.floor(r * this.scale);
      if (b >= n) b = n - 1;
      let k = guide[b];
      // The guide is built from the same floating point bucket edges, so these
      // scans are usually zero or one step. They also make the answer exact
      // whatever the rounding did.
      while (k > 0 && snap[k] > r) k--;
      while (k < n - 1 && snap[k + 1] <= r) k++;
      if (snap[k + 1] - this.since > r) return k;
      // A rebuild costs about 3n, about as much as n/8 tree searches.
      if (++this.fallbacks * 8 >= n) this.retake();
    }
    const tree = this.tree;
    const n = this.n;
    let pos = 0;
    let rest = r;
    for (let step = this.top; step; step >>= 1) {
      const next = pos + step;
      if (next <= n && tree[next] <= rest) {
        pos = next;
        rest -= tree[next];
      }
    }
    return pos;
  }

  /** Lowers entry k's weight by one. */
  take(k: number): void {
    this.weights[k]--;
    const tree = this.tree;
    for (let i = k + 1; i <= this.n; i += i & -i) tree[i]--;
    this.since++;
  }

  private retake(): void {
    const snap = this.snap!;
    const guide = this.guide!;
    const n = this.n;
    const w = this.weights;
    snap[0] = 0;
    for (let k = 0; k < n; k++) snap[k + 1] = snap[k] + w[k];
    const total = snap[n];
    this.scale = total > 0 ? n / total : 0;
    let k = 0;
    for (let b = 0; b < n; b++) {
      const lo = total > 0 ? b / this.scale : 0;
      while (k < n - 1 && snap[k + 1] <= lo) k++;
      guide[b] = k;
    }
    this.since = 0;
    this.fallbacks = 0;
  }
}
