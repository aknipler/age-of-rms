// The route search behind `require_path`, docs/preview-design.md Sec.6.6
// (rev 12). PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// The search's ties decide which tiles are refused, so the structure below
// keeps the search's own order of steps rather than this repo's usual style.
//
// The map is a quadtree of four levels, blocks of 1, 2, 4 and 8 tiles. A tile
// knows which of its four neighbours it can step to. A block is "split" when
// its walkable children do not form one piece, and the tree's leaves
// ("frontier" cells) are the largest blocks that are not. The search runs
// best-first over frontier cells, and the route is then laid through the
// crossing points between cells. Its length is the sum of the straight
// pieces, which on open ground is a little longer than the straight line, by
// an amount that depends on where the two tiles sit in the blocks.
//
// Every value the game holds as a 32-bit float goes through `F`.

import { f32Sqrt } from "./float32";

const F = Math.fround;
/** A square, without `**`, which the determinism lint forbids (Sec.8). */
const square = (v: number): number => v * v;
const UP = 1;
const LEFT = 2;
const RIGHT = 4;
const DOWN = 8;
const FRONTIER = 0x20;
const SPLIT = 0x40;
const ISOLATED = 0x80;
const GOAL = 0x10;
const QUEUED = 0x10;
const VISITED = 0x20;

function sqrtF(v: number): number {
  return F(f32Sqrt(v));
}

export class Hierarchy {
  readonly widths: number[] = [];
  readonly heights: number[] = [];
  readonly offsets: number[] = [];
  readonly conn: Uint8Array;
  readonly flags: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    walkable: ArrayLike<boolean | number>,
  ) {
    const pw = (width + 7) & ~7;
    const ph = (height + 7) & ~7;
    let n = 0;
    for (let lv = 0; lv < 4; lv++) {
      this.widths.push(pw >> lv);
      this.heights.push(ph >> lv);
      this.offsets.push(n);
      n += this.widths[lv] * this.heights[lv];
    }
    this.conn = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    for (let x = 0; x < this.widths[3]; x++)
      for (let y = 0; y < this.heights[3]; y++) this.init(3, x, y);
    this.refresh(walkable, [0, 0, width, height]);
  }

  idx(lv: number, x: number, y: number): number {
    return this.offsets[lv] + y * this.widths[lv] + x;
  }

  private init(lv: number, x: number, y: number): boolean {
    const i = this.idx(lv, x, y);
    let fl = 0;
    if (lv === 0) fl = x >= this.width || y >= this.height ? 15 : 0;
    else {
      const kids: [number, number][] = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ];
      kids.forEach(([dx, dy], c) => {
        if (this.init(lv - 1, x * 2 + dx, y * 2 + dy)) fl |= 1 << c;
      });
    }
    this.conn[i] = 0;
    this.flags[i] = fl;
    return fl === 15;
  }

  refresh(
    walkable: ArrayLike<boolean | number>,
    rect: readonly [number, number, number, number],
  ): void {
    const [l, t, r, b] = rect;
    const left = Math.max(Math.min(l, r) - 1, 0);
    const top = Math.max(Math.min(t, b) - 1, 0);
    const right = Math.min(Math.max(l, r) + 1, this.width - 1);
    const bottom = Math.min(Math.max(t, b) + 1, this.height - 1);
    const ch = [left, top, right, bottom] as const;
    for (let x = left >> 3; x <= right >> 3; x++)
      for (let y = top >> 3; y <= bottom >> 3; y++)
        this.refreshCell(3, x, y, ch, walkable);
  }

  private refreshCell(
    lv: number,
    x: number,
    y: number,
    ch: readonly number[],
    walkable: ArrayLike<boolean | number>,
  ): [number, number] {
    const i = this.idx(lv, x, y);
    const prevFlags = this.flags[i];
    if (lv === 0) {
      this.flags[i] &= 15 | ISOLATED;
      if (ch[0] <= x && x <= ch[2] && ch[1] <= y && y <= ch[3]) {
        this.conn[i] = 0;
        const t = y * this.width + x;
        if (walkable[t]) {
          let c = 0;
          if (x > 0 && walkable[t - 1]) c |= LEFT;
          if (x + 1 < this.width && walkable[t + 1]) c |= RIGHT;
          if (y > 0 && walkable[t - this.width]) c |= UP;
          if (y + 1 < this.height && walkable[t + this.width]) c |= DOWN;
          this.conn[i] = c;
          if (c === 0) this.flags[i] |= ISOLATED | FRONTIER;
          else this.flags[i] &= ~ISOLATED & 0xff;
        }
      }
      return [this.conn[i], this.flags[i]];
    }
    const pos: [number, number][] = [
      [x * 2, y * 2],
      [x * 2 + 1, y * 2],
      [x * 2, y * 2 + 1],
      [x * 2 + 1, y * 2 + 1],
    ];
    const kids: [number, number][] = pos.map(([cx, cy], c) =>
      prevFlags & (1 << c)
        ? [0, 0]
        : this.refreshCell(lv - 1, cx, cy, ch, walkable),
    );
    const [pc, pf] = merge(kids, prevFlags & 15, lv === 3);
    if (pf & SPLIT)
      pos.forEach(([cx, cy], c) => {
        if ((kids[c][1] & (SPLIT | FRONTIER)) === 0) {
          const j = this.idx(lv - 1, cx, cy);
          this.flags[j] = (this.flags[j] + FRONTIER) & 0xff;
        }
      });
    this.conn[i] = pc;
    this.flags[i] = pf;
    return [pc, pf];
  }
}

function merge(
  kids: [number, number][],
  excluded: number,
  top: boolean,
): [number, number] {
  const [[tlc, tlf], [trc, trf], [blc, blf], [brc, brf]] = kids;
  const conn =
    ((trc | brc) & RIGHT) |
    ((trc | tlc) & UP) |
    ((blc | brc) & DOWN) |
    ((blc | tlc) & LEFT);
  let split: boolean;
  if ([tlf, trf, blf, brf].some((f) => f & (SPLIT | ISOLATED))) split = true;
  else {
    const edges = [
      (tlc & RIGHT) !== 0,
      (trc & DOWN) !== 0,
      (brc & LEFT) !== 0,
      (blc & UP) !== 0,
    ];
    const lab = [tlc ? 1 : 0, trc ? 2 : 0, blc ? 3 : 0, brc ? 4 : 0];
    // Labels spread round the square twice: tl to tr, tr to br, br to bl, bl
    // to tl, then tl to tr and tr to br again.
    const order: [number, number, number][] = [
      [0, 0, 1],
      [1, 1, 3],
      [2, 3, 2],
      [3, 2, 0],
      [0, 0, 1],
      [1, 1, 3],
    ];
    for (const [e, a, b] of order) if (edges[e]) lab[b] = lab[a];
    const first = lab.find((v) => v !== 0);
    const edgeCount = edges.filter(Boolean).length;
    split =
      edgeCount === 3 ||
      (conn === 0 && first !== undefined) ||
      lab.some((v) => v !== 0 && v !== first);
  }
  return [conn, excluded | (split ? SPLIT : top ? FRONTIER : 0)];
}

// ---- goal marking (the goal tile's frontier cell, widened by the walker's clearance)

function axisRem(
  tile: number,
  goal: number,
  clearance: number,
  radius: number,
): number {
  const d = Math.abs(F(F(tile) - F(goal + F(-0.5))));
  let rem = d <= clearance ? F(0) : F(d - clearance);
  if (rem === clearance) rem = Math.max(F(rem - radius), F(0));
  return rem;
}

function markGoal(
  h: Hierarchy,
  goal: readonly [number, number],
  clearance: number,
  mark: boolean,
): boolean {
  let extent = F(clearance + F(0));
  extent = F(extent + F(1));
  const lo = [F(goal[0] - extent), F(goal[1] - extent)];
  const hi = [F(F(extent + goal[0]) + F(0.1)), F(F(extent + goal[1]) + F(0.1))];
  const b = [
    Math.max(Math.trunc(lo[0]), 0),
    Math.max(Math.trunc(lo[1]), 0),
    Math.min(Math.trunc(hi[0]), h.width - 1),
    Math.min(Math.trunc(hi[1]), h.height - 1),
  ];
  const radius = F(0.5);
  const includes = (lv: number, x: number, y: number): boolean =>
    b[0] >> lv <= x && x <= b[2] >> lv && b[1] >> lv <= y && y <= b[3] >> lv;
  const intersects = (lv: number, x: number, y: number): boolean => {
    if (!includes(lv, x, y)) return false;
    for (let tx = x << lv; tx < (x + 1) << lv; tx++)
      for (let ty = y << lv; ty < (y + 1) << lv; ty++) {
        const j = h.idx(0, tx, ty);
        if (h.conn[j] === 0 && (h.flags[j] & ISOLATED) === 0) continue;
        const dx = axisRem(tx, goal[0], clearance, radius);
        if (dx > radius) continue;
        const dy = axisRem(ty, goal[1], clearance, radius);
        if (dy <= radius && F(radius * radius) >= F(F(dy * dy) + F(dx * dx)))
          return true;
      }
    return false;
  };
  const cell = (lv: number, x: number, y: number): number => {
    if (!includes(lv, x, y)) return 0;
    const i = h.idx(lv, x, y);
    if (h.flags[i] & FRONTIER) {
      if (intersects(lv, x, y)) {
        const had = h.flags[i] & GOAL;
        if (mark && !had) {
          h.flags[i] += GOAL;
          return 1;
        }
        if (!mark && had) {
          h.flags[i] -= GOAL;
          return 1;
        }
      }
      return 0;
    }
    if (lv === 0) return 0;
    let sum = 0;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      sum += cell(lv - 1, x * 2 + dx, y * 2 + dy);
    return sum;
  };
  let changed = 0;
  for (let x = b[0] >> 3; x <= b[2] >> 3; x++)
    for (let y = b[1] >> 3; y <= b[3] >> 3; y++) changed += cell(3, x, y);
  if (changed) return true;
  const gx = Math.trunc(goal[0]);
  const gy = Math.trunc(goal[1]);
  for (const lv of [3, 2, 1, 0]) {
    const i = h.idx(lv, gx >> lv, gy >> lv);
    if (h.flags[i] & FRONTIER) {
      const had = h.flags[i] & GOAL;
      if (mark && !had) {
        h.flags[i] += GOAL;
        return true;
      }
      if (!mark && had) h.flags[i] -= GOAL;
      return false;
    }
  }
  return false;
}

// ---- the bucketed queue (ties follow its descending sort; pops take the bucket's last entry)

type Entry = [number, number];

class BucketQueue {
  private readonly b: Entry[][] = [];
  private minimum: number | undefined;

  push(node: number, pr: number): void {
    const k = Math.trunc(pr);
    while (this.b.length <= k) this.b.push([]);
    const bk = this.b[k];
    if (this.minimum === k) {
      let ins = bk.length;
      while (ins > 0 && bk[ins - 1][1] <= pr) ins--;
      bk.splice(ins, 0, [node, pr]);
    } else {
      bk.push([node, pr]);
      if (this.minimum === undefined || k < this.minimum) this.minimum = k;
    }
  }

  pop(): Entry | undefined {
    if (this.minimum === undefined) return undefined;
    const m = this.minimum;
    const e = this.b[m].pop()!;
    if (this.b[m].length === 0) {
      this.minimum = undefined;
      for (let i = m + 1; i < this.b.length; i++)
        if (this.b[i].length) {
          this.minimum = i;
          break;
        }
      if (this.minimum !== undefined) {
        const bk = this.b[this.minimum];
        sortDesc(bk, 0, bk.length, bk.length);
      }
    }
    return e;
  }
}

function sortDesc(a: Entry[], lo: number, hi: number, budget: number): void {
  while (hi - lo > 32) {
    if (budget === 0) {
      heapSort(a, lo, hi);
      return;
    }
    const [es, ee] = partition(a, lo, hi);
    budget = (budget >> 2) + (budget >> 1);
    if (es - lo < hi - ee) {
      sortDesc(a, lo, es, budget);
      lo = ee;
    } else {
      sortDesc(a, ee, hi, budget);
      hi = es;
    }
  }
  for (let nxt = lo + 1; nxt < hi; nxt++) {
    const v = a[nxt];
    let hole = nxt;
    while (hole > lo && v[1] > a[hole - 1][1]) {
      a[hole] = a[hole - 1];
      hole--;
    }
    a[hole] = v;
  }
}

function swap(a: Entry[], i: number, j: number): void {
  const t = a[i];
  a[i] = a[j];
  a[j] = t;
}

function med3(a: Entry[], i: number, j: number, k: number): void {
  if (a[j][1] > a[i][1]) swap(a, i, j);
  if (a[k][1] > a[j][1]) {
    swap(a, j, k);
    if (a[j][1] > a[i][1]) swap(a, i, j);
  }
}

function partition(a: Entry[], lo: number, hi: number): [number, number] {
  const n = hi - lo;
  const last = lo + n - 1;
  const mid = lo + Math.floor(n / 2);
  if (n <= 41) med3(a, lo, mid, last);
  else {
    const s = Math.floor(n / 8);
    med3(a, lo, lo + s, lo + 2 * s);
    med3(a, mid - s, mid, mid + s);
    med3(a, last - 2 * s, last - s, last);
    med3(a, lo + s, mid, last - s);
  }
  let es = lo + Math.floor(n / 2);
  let ee = es + 1;
  const p = a[es][1];
  while (es > lo && a[es - 1][1] === p) es--;
  while (ee < hi && a[ee][1] === p) ee++;
  let left = es;
  let right = ee;
  for (;;) {
    while (right < hi && a[right][1] <= p) {
      if (a[right][1] === p) {
        swap(a, ee, right);
        ee++;
      }
      right++;
    }
    while (left > lo && a[left - 1][1] >= p) {
      if (a[left - 1][1] === p) {
        es--;
        swap(a, es, left - 1);
      }
      left--;
    }
    if (left === lo && right === hi) return [es, ee];
    if (left === lo) {
      if (ee !== right) swap(a, es, ee);
      ee++;
      swap(a, es, right);
      es++;
      right++;
    } else if (right === hi) {
      left--;
      es--;
      swap(a, left, es);
      ee--;
      swap(a, es, ee);
    } else {
      left--;
      swap(a, left, right);
      right++;
    }
  }
}

function heapSort(a: Entry[], lo: number, hi: number): void {
  const n = hi - lo;
  for (let root = Math.floor(n / 2) - 1; root >= 0; root--)
    heapReplace(a, lo, n, root, a[lo + root]);
  for (let end = n - 1; end > 0; end--) {
    const v = a[lo + end];
    a[lo + end] = a[lo];
    heapReplace(a, lo, end, 0, v);
  }
}

function heapReplace(
  a: Entry[],
  lo: number,
  count: number,
  root: number,
  v: Entry,
): void {
  const lastParent = Math.floor((count - 1) / 2);
  let hole = root;
  while (hole < lastParent) {
    const left = 2 * hole + 1;
    const right = left + 1;
    const child = a[lo + right][1] <= a[lo + left][1] ? right : left;
    a[lo + hole] = a[lo + child];
    hole = child;
  }
  if (hole === lastParent && count % 2 === 0) {
    a[lo + hole] = a[lo + count - 1];
    hole = count - 1;
  }
  while (hole > root) {
    const parent = Math.floor((hole - 1) / 2);
    if (a[lo + parent][1] <= v[1]) break;
    a[lo + hole] = a[lo + parent];
    hole = parent;
  }
  a[lo + hole] = v;
}

function idist(a: readonly number[], b: readonly number[]): number {
  const dx = Math.trunc(a[0]) - Math.trunc(b[0]);
  const dy = Math.trunc(a[1]) - Math.trunc(b[1]);
  return sqrtF(dy * dy + dx * dx);
}

function orthogonal(a: number, b: number): boolean {
  return (
    ((a === LEFT || a === RIGHT) && (b === UP || b === DOWN)) ||
    ((a === UP || a === DOWN) && (b === LEFT || b === RIGHT))
  );
}

/** [level, cell, point, cost, priority, parent, direction, shortcut] */
interface PathNode {
  lv: number;
  cell: [number, number];
  point: [number, number];
  cost: number;
  pr: number;
  parent: number | undefined;
  dir: number;
  shortcut: boolean;
}

type Portal = [number, number, number, number, number, number];

class Search {
  private readonly nodes: PathNode[] = [];
  private readonly q = new BucketQueue();
  private readonly goal: [number, number];
  private closest: number | undefined;
  private closestD = F(999999);
  private popped = 0;
  status = 0;
  length = F(0);

  constructor(
    private readonly h: Hierarchy,
    start: readonly [number, number],
    goal: readonly [number, number],
    clearance: number,
    noRoute = 3,
  ) {
    this.goal = [Math.trunc(goal[0]), Math.trunc(goal[1])];
    const marker = markGoal(h, goal, clearance, true);
    const touched: [number, number, number][] = [];
    let pts: [number, number][];
    try {
      const [terminal, exit] = this.run(
        [Math.trunc(start[0]), Math.trunc(start[1])],
        touched,
      );
      this.status =
        terminal === undefined ? noRoute : exit === "goal" && marker ? 1 : 2;
      pts = this.reconstruct(terminal, this.status, start, goal, clearance);
    } finally {
      markGoal(h, goal, clearance, false);
      for (const [lv, cx, cy] of touched) h.conn[h.idx(lv, cx, cy)] &= 15;
    }
    let length = F(0);
    for (let k = 0; k + 1 < pts.length; k++) {
      const dx = F(pts[k + 1][0] - pts[k][0]);
      const dy = F(pts[k + 1][1] - pts[k][1]);
      length = F(length + sqrtF(F(F(F(dy * dy) + F(dx * dx)) + F(0))));
    }
    this.length = length;
  }

  private alloc(node: PathNode, enqueue: boolean): number {
    this.nodes.push(node);
    if (enqueue) this.q.push(this.nodes.length - 1, node.pr);
    return this.nodes.length - 1;
  }

  private run(
    start: [number, number],
    touched: [number, number, number][],
  ): [number | undefined, string] {
    const h = this.h;
    let lv = 3;
    while (
      lv > 0 &&
      (h.flags[h.idx(lv, start[0] >> lv, start[1] >> lv)] & FRONTIER) === 0
    )
      lv--;
    const cell: [number, number] = [start[0] >> lv, start[1] >> lv];
    const i = h.idx(lv, cell[0], cell[1]);
    if (h.conn[i] === 0 && (h.flags[i] & ISOLATED) === 0)
      return [undefined, "blocked"];
    const dx = F(this.goal[0] - start[0]);
    const dy = F(this.goal[1] - start[1]);
    const d0 = sqrtF(F(dy * dy) + F(dx * dx));
    const root = this.alloc(
      {
        lv,
        cell,
        point: start,
        cost: F(0),
        pr: d0,
        parent: undefined,
        dir: 0,
        shortcut: false,
      },
      (h.flags[i] & GOAL) === 0,
    );
    touched.push([lv, cell[0], cell[1]]);
    if (h.flags[i] & GOAL) return [root, "goal"];
    h.conn[i] = (h.conn[i] + QUEUED) & 0xff;
    for (;;) {
      const e = this.q.pop();
      if (e === undefined) break;
      this.popped++;
      const cur = e[0];
      const nd = this.nodes[cur];
      const j = h.idx(nd.lv, nd.cell[0], nd.cell[1]);
      const c = h.conn[j];
      if (c & VISITED) continue;
      h.conn[j] = (c + VISITED) & 0xff;
      const residual = F(nd.pr - nd.cost);
      if (this.closestD > residual) {
        this.closestD = residual;
        this.closest = cur;
      }
      if (residual <= 5 && d0 <= 10 && this.popped >= 10 * Math.trunc(d0))
        return [cur, "near"];
      const steps: [number, number, number, number][] = [
        [LEFT, -1, 0, RIGHT],
        [RIGHT, 1, 0, LEFT],
        [UP, 0, -1, DOWN],
        [DOWN, 0, 1, UP],
      ];
      for (const [direction, ddx, ddy, rec] of steps) {
        if ((c & direction) === 0) continue;
        const g = this.neighbor(
          nd.lv,
          [nd.cell[0] + ddx, nd.cell[1] + ddy],
          cur,
          rec,
          touched,
        );
        if (g !== undefined) return [g, "goal"];
      }
    }
    return [this.closest, "exhausted"];
  }

  private neighbor(
    lv: number,
    cell: [number, number],
    parent: number,
    rec: number,
    touched: [number, number, number][],
  ): number | undefined {
    const h = this.h;
    if (
      lv >= 4 ||
      cell[0] < 0 ||
      cell[1] < 0 ||
      cell[0] >= h.widths[lv] ||
      cell[1] >= h.heights[lv]
    )
      throw new Error("path connection outside the hierarchy");
    const i = h.idx(lv, cell[0], cell[1]);
    if ((h.conn[i] & rec) === 0) return undefined;
    if (h.flags[i] & FRONTIER) {
      if (h.conn[i] & VISITED) return undefined;
      let point: [number, number];
      if (lv === 0) point = [cell[0], cell[1]];
      else {
        const half = 1 << (lv - 1);
        point = [(cell[0] << lv) + half, (cell[1] << lv) + half];
      }
      const prev = this.nodes[parent];
      const shortcut =
        prev.parent !== undefined &&
        !prev.shortcut &&
        orthogonal(rec, prev.dir);
      const pred = shortcut ? this.nodes[prev.parent!] : prev;
      const cost = F(idist(pred.point, point) + pred.cost);
      const pr = F(cost + idist(this.goal, point));
      const node = this.alloc(
        { lv, cell, point, cost, pr, parent, dir: rec, shortcut },
        true,
      );
      if ((h.conn[i] & QUEUED) === 0) {
        h.conn[i] = (h.conn[i] + QUEUED) & 0xff;
        touched.push([lv, cell[0], cell[1]]);
      }
      return h.flags[i] & GOAL ? node : undefined;
    }
    if ((h.flags[i] & SPLIT) === 0)
      return this.neighbor(
        lv + 1,
        [cell[0] >> 1, cell[1] >> 1],
        parent,
        rec,
        touched,
      );
    if (lv === 0) throw new Error("base path cell cannot split");
    const kids: [number, number, number][] = [
      [0, 0, LEFT | UP],
      [1, 0, RIGHT | UP],
      [0, 1, LEFT | DOWN],
      [1, 1, RIGHT | DOWN],
    ];
    for (const [dx, dy, mask] of kids) {
      if ((rec & mask) === 0) continue;
      const g = this.neighbor(
        lv - 1,
        [cell[0] * 2 + dx, cell[1] * 2 + dy],
        parent,
        rec,
        touched,
      );
      if (g !== undefined) return g;
    }
    return undefined;
  }

  // -- portals: the shared edge between a node's cell and its parent's
  private portal(idx: number): Portal {
    const nd = this.nodes[idx];
    const par = this.nodes[nd.parent!];
    const finer = nd.lv <= par.lv ? nd : par;
    const axis = nd.dir === UP || nd.dir === DOWN ? 0 : 1;
    const low = finer.cell[axis] << finer.lv;
    const high = low + (1 << finer.lv) - 1;
    let fixed = nd.cell[1 - axis] << nd.lv;
    if (nd.dir === DOWN || nd.dir === RIGHT) fixed += (1 << nd.lv) - 1;
    return [axis, low, high, fixed, finer.lv, nd.dir];
  }

  private pt(p: Portal, moving: number): [number, number] {
    return p[0] === 0 ? [moving, p[3]] : [p[3], moving];
  }

  private connects(p: Portal, moving: number): boolean {
    const [x, y] = this.pt(p, moving);
    if (x < 0 || y < 0 || x >= this.h.widths[0] || y >= this.h.heights[0])
      throw new Error("portal scan outside the base grid");
    return (this.h.conn[this.h.idx(0, x, y)] & p[5]) !== 0;
  }

  private nearest(p: Portal, target: number, missing: number): number {
    let result = missing;
    let distance = 9999;
    for (let c = target; c <= p[2]; c++)
      if (this.connects(p, c)) {
        result = c;
        distance = c - target;
        break;
      }
    for (let c = target; c >= p[1]; c--) {
      if (distance <= 0) break;
      if (this.connects(p, c)) {
        result = c;
        break;
      }
      distance--;
    }
    return result;
  }

  private resolvePortal(idx: number): [number, number] | undefined {
    if (this.nodes[idx].parent === undefined) return undefined;
    const p = this.portal(idx);
    let moving: number;
    if (p[4] === 0) moving = p[1];
    else {
      const mid = p[1] + (1 << (p[4] - 1));
      moving = this.nearest(p, mid, mid);
    }
    const [x, y] = this.pt(p, moving);
    return [Math.min(x, this.h.width - 1), Math.min(y, this.h.height - 1)];
  }

  private projectPortal(
    idx: number,
    towards: readonly number[],
    last: readonly number[],
  ): [number, number] | undefined {
    const nd = this.nodes[idx];
    if (nd.parent === undefined) return undefined;
    const p = this.portal(idx);
    if (p[0] === 0) {
      p[2] = Math.min(p[2], this.h.width - 1);
      if (nd.dir === DOWN) p[3] = Math.min(p[3], this.h.height - 1);
    }
    const along = p[0];
    const perp = 1 - p[0];
    const dAl = towards[along] - last[along];
    const dPe = towards[perp] - last[perp];
    const reaches =
      nd.dir === UP || nd.dir === LEFT
        ? p[3] <= last[perp]
        : p[3] >= last[perp];
    const crossing = reaches ? p[3] - last[perp] : 0;
    let target: number;
    if (crossing !== 0 && dPe !== 0) {
      const q = dAl * crossing;
      // Integer division truncating toward zero, then wrapped to 16 bits.
      target = (last[along] & 0xffff) + Math.trunc(q / dPe);
      target = ((target + 0x8000) & 0xffff) - 0x8000;
    } else target = last[along];
    let moving = -1;
    if (target <= p[1]) {
      for (let c = p[1]; c <= p[2]; c++)
        if (this.connects(p, c)) {
          moving = c;
          break;
        }
    } else if (target >= p[2]) {
      for (let c = p[2]; c >= p[1]; c--)
        if (this.connects(p, c)) {
          moving = c;
          break;
        }
    } else moving = this.nearest(p, target, -1);
    return this.pt(p, moving);
  }

  private reconstruct(
    terminal: number | undefined,
    status: number,
    start: readonly [number, number],
    goal: readonly [number, number],
    clearance: number,
  ): [number, number][] {
    if (terminal === undefined) return [];
    const h = this.h;
    const gt: [number, number] = [Math.trunc(goal[0]), Math.trunc(goal[1])];
    const st: [number, number] = [Math.trunc(start[0]), Math.trunc(start[1])];
    let first: [number, number];
    if (status === 1 && h.conn[h.idx(0, gt[0], gt[1])] !== 0)
      first = [F(goal[0]), F(goal[1])];
    else {
      const nd = this.nodes[terminal];
      const rep = this.representative(nd.lv, nd.cell, gt);
      const dd = sqrtF(square(gt[0] - rep[0]) + square(gt[1] - rep[1]));
      if (status === 1 && F(clearance + F(0.01)) >= dd)
        first = [F(goal[0]), F(goal[1])];
      else first = [F(rep[0] + 0.5), F(rep[1] + 0.5)];
    }
    const pts: [number, number][] = [first];
    let last: readonly number[] = gt;
    let cur: number | undefined = terminal;
    while (cur !== undefined) {
      const par: number | undefined = this.nodes[cur].parent;
      const gp = par !== undefined ? this.nodes[par].parent : undefined;
      const towards = gp !== undefined ? (this.resolvePortal(gp) ?? st) : st;
      const p = this.projectPortal(cur, towards, last);
      if (p !== undefined) {
        pts.push([F(p[0] + 0.5), F(p[1] + 0.5)]);
        last = p;
      }
      cur = par;
    }
    pts.push([F(start[0]), F(start[1])]);
    pts.reverse();
    const out: [number, number][] = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
    }
    return out;
  }

  private representative(
    lv: number,
    cell: readonly [number, number],
    goal: readonly [number, number],
  ): [number, number] {
    const h = this.h;
    let [x, y] = cell;
    while (lv > 0) {
      lv--;
      x *= 2;
      y *= 2;
      const g = [goal[0] >> lv, goal[1] >> lv];
      let best = 9999;
      let off: [number, number] = [0, 0];
      for (const [dx, dy] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const cx = x + dx;
        const cy = y + dy;
        const j = h.idx(lv, cx, cy);
        if ((h.flags[j] & 15) === 15 || h.conn[j] === 0) continue;
        const dist = Math.max(g[0] - cx, 0) + Math.max(g[1] - cy, 0);
        if (dist >= 0 && dist < best) {
          best = dist;
          off = [dx, dy];
        }
      }
      x += off[0];
      y += off[1];
    }
    return [x, y];
  }
}

/**
 * `require_path N` for a candidate tile against its frame's origin tile
 * (write-up Section 7). `requirement` is N + 1, so 0 means no requirement.
 * N = 0 asks only for a route; N >= 1 also asks that the route be no longer
 * than the whole straight distance plus N.
 */
export function routeAllows(
  h: Hierarchy,
  clearance: number,
  requirement: number,
  candidate: readonly [number, number],
  origin: readonly [number, number],
): boolean {
  if (requirement === 0) return true;
  const s = new Search(
    h,
    [candidate[0] + 0.5, candidate[1] + 0.5],
    [origin[0] + 0.5, origin[1] + 0.5],
    F(clearance),
  );
  if (s.status >= 2) return false;
  if (requirement <= 1) return true;
  const dx = origin[0] - candidate[0];
  const dy = origin[1] - candidate[1];
  const straight = Math.trunc(sqrtF(dx * dx + dy * dy));
  return Math.trunc(s.length) <= straight + requirement - 1;
}
