"""The route search behind require_path, restated in our own words from AoE2RMSIDE's description of the game's search
(read 2026-11-09 at commit 7525df0, crates/rms-engine/src/exact_path*). Used by object_model.path_ok when
VAR["path_search"] == "hier".

The map is a quadtree of four levels (blocks of 1, 2, 4 and 8 tiles; sizes padded up to a multiple of 8). A tile knows
which of its four neighbours it can step to. A block is "split" when its walkable children do not form one piece
reachable through their shared edges; the tree's leaves ("frontier" cells) are the largest unsplit blocks. The search
is a best-first search over frontier cells (cost = sum of whole-tile distances between cell points, a node may hang
from its grandparent when it turns a corner), ordered by a bucketed queue whose ties follow a particular sort. The
route is rebuilt by projecting each crossing onto the shared edge of two cells, aiming along the line to the crossing
two steps back; its length is the sum of the straight pieces between those points.

Flags and direction bits keep the values of the description, because the search stores visit marks in the same
byte as the step bits."""
import numpy as np

UP, LEFT, RIGHT, DOWN = 1, 2, 4, 8
FRONTIER, SPLIT, ISOLATED, GOAL = 0x20, 0x40, 0x80, 0x10
QUEUED, VISITED = 0x10, 0x20
f32 = np.float32


class Hierarchy:
    def __init__(self, width, height, walkable):
        self.width, self.height = width, height
        pw, ph = (width + 7) & ~7, (height + 7) & ~7
        self.widths = [pw >> lv for lv in range(4)]
        self.heights = [ph >> lv for lv in range(4)]
        self.offsets, n = [], 0
        for lv in range(4):
            self.offsets.append(n)
            n += self.widths[lv] * self.heights[lv]
        self.conn = bytearray(n)
        self.flags = bytearray(n)
        for x in range(self.widths[3]):
            for y in range(self.heights[3]):
                self._init(3, x, y)
        self.refresh(walkable, (0, 0, width, height))

    def idx(self, lv, x, y):
        return self.offsets[lv] + y * self.widths[lv] + x

    def _init(self, lv, x, y):
        i = self.idx(lv, x, y)
        if lv == 0:
            fl = 15 if (x >= self.width or y >= self.height) else 0
        else:
            fl = 0
            for c, (dx, dy) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
                if self._init(lv - 1, x * 2 + dx, y * 2 + dy):
                    fl |= 1 << c
        self.conn[i], self.flags[i] = 0, fl
        return fl == 15

    def refresh(self, walkable, rect):
        l, t, r, b = rect
        left = max(min(l, r) - 1, 0)
        top = max(min(t, b) - 1, 0)
        right = min(max(l, r) + 1, self.width - 1)
        bottom = min(max(t, b) + 1, self.height - 1)
        ch = (left, top, right, bottom)
        for x in range(left >> 3, (right >> 3) + 1):
            for y in range(top >> 3, (bottom >> 3) + 1):
                self._refresh(3, x, y, ch, walkable)

    def _refresh(self, lv, x, y, ch, walkable):
        i = self.idx(lv, x, y)
        prev_flags = self.flags[i]
        if lv == 0:
            self.flags[i] &= 15 | ISOLATED
            if ch[0] <= x <= ch[2] and ch[1] <= y <= ch[3]:
                self.conn[i] = 0
                t = y * self.width + x
                if walkable[t]:
                    c = 0
                    if x > 0 and walkable[t - 1]:
                        c |= LEFT
                    if x + 1 < self.width and walkable[t + 1]:
                        c |= RIGHT
                    if y > 0 and walkable[t - self.width]:
                        c |= UP
                    if y + 1 < self.height and walkable[t + self.width]:
                        c |= DOWN
                    self.conn[i] = c
                    if c == 0:
                        self.flags[i] |= ISOLATED | FRONTIER
                    else:
                        self.flags[i] &= ~ISOLATED & 0xFF
            return (self.conn[i], self.flags[i])
        pos = ((x * 2, y * 2), (x * 2 + 1, y * 2), (x * 2, y * 2 + 1), (x * 2 + 1, y * 2 + 1))
        kids = []
        for c, (cx, cy) in enumerate(pos):
            kids.append((0, 0) if prev_flags & (1 << c) else self._refresh(lv - 1, cx, cy, ch, walkable))
        pc, pf = merge(kids, prev_flags & 15, lv == 3)
        if pf & SPLIT:
            for c, (cx, cy) in enumerate(pos):
                if kids[c][1] & (SPLIT | FRONTIER) == 0:
                    j = self.idx(lv - 1, cx, cy)
                    self.flags[j] = (self.flags[j] + FRONTIER) & 0xFF
        self.conn[i], self.flags[i] = pc, pf
        return (pc, pf)


def merge(kids, excluded, top):
    (tlc, tlf), (trc, trf), (blc, blf), (brc, brf) = kids
    conn = (((trc | brc) & RIGHT) | ((trc | tlc) & UP) | ((blc | brc) & DOWN) | ((blc | tlc) & LEFT))
    if any(f & (SPLIT | ISOLATED) for f in (tlf, trf, blf, brf)):
        split = True
    else:
        edges = [tlc & RIGHT != 0, trc & DOWN != 0, brc & LEFT != 0, blc & UP != 0]
        lab = [1 if tlc else 0, 2 if trc else 0, 3 if blc else 0, 4 if brc else 0]
        # labels spread round the square twice: tl->tr, tr->br, br->bl, bl->tl, then tl->tr, tr->br again
        for e, (a, b) in ((0, (0, 1)), (1, (1, 3)), (2, (3, 2)), (3, (2, 0)), (0, (0, 1)), (1, (1, 3))):
            if edges[e]:
                lab[b] = lab[a]
        first = next((v for v in lab if v), None)
        split = (sum(edges) == 3 or (conn == 0 and first is not None)
                 or any(v and v != first for v in lab))
    return conn, excluded | (SPLIT if split else (FRONTIER if top else 0))


# ---- goal marking (the goal tile's frontier cell, widened by the walker's clearance)
def _axis(tile, goal, clearance, radius):
    d = abs(f32(tile) - (goal + f32(-0.5)))
    rem = f32(0.0) if d <= clearance else f32(d - clearance)
    if rem == clearance:
        rem = max(f32(rem - radius), f32(0.0))
    return rem


def mark_goal(h, goal, clearance, mark):
    extent = f32(clearance + f32(0.0))
    extent = f32(extent + f32(1.0))
    lo = (f32(goal[0] - extent), f32(goal[1] - extent))
    hi = (f32(f32(extent + goal[0]) + f32(0.1)), f32(f32(extent + goal[1]) + f32(0.1)))
    b = (max(int(lo[0]), 0), max(int(lo[1]), 0), min(int(hi[0]), h.width - 1), min(int(hi[1]), h.height - 1))
    radius = f32(0.5)

    def includes(lv, x, y):
        return (b[0] >> lv) <= x <= (b[2] >> lv) and (b[1] >> lv) <= y <= (b[3] >> lv)

    def intersects(lv, x, y):
        if not includes(lv, x, y):
            return False
        for tx in range(x << lv, (x + 1) << lv):
            for ty in range(y << lv, (y + 1) << lv):
                j = h.idx(0, tx, ty)
                if h.conn[j] == 0 and h.flags[j] & ISOLATED == 0:
                    continue
                dx = _axis(tx, goal[0], clearance, radius)
                if dx > radius:
                    continue
                dy = _axis(ty, goal[1], clearance, radius)
                if dy <= radius and radius * radius >= f32(dy * dy) + f32(dx * dx):
                    return True
        return False

    def cell(lv, x, y):
        if not includes(lv, x, y):
            return 0
        i = h.idx(lv, x, y)
        if h.flags[i] & FRONTIER:
            if intersects(lv, x, y):
                had = h.flags[i] & GOAL
                if mark and not had:
                    h.flags[i] += GOAL
                    return 1
                if not mark and had:
                    h.flags[i] -= GOAL
                    return 1
            return 0
        if lv == 0:
            return 0
        return sum(cell(lv - 1, x * 2 + dx, y * 2 + dy) for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)))

    changed = 0
    for x in range(b[0] >> 3, (b[2] >> 3) + 1):
        for y in range(b[1] >> 3, (b[3] >> 3) + 1):
            changed += cell(3, x, y)
    if changed:
        return True
    gx, gy = int(goal[0]), int(goal[1])
    for lv in (3, 2, 1, 0):
        i = h.idx(lv, gx >> lv, gy >> lv)
        if h.flags[i] & FRONTIER:
            had = h.flags[i] & GOAL
            if mark and not had:
                h.flags[i] += GOAL
                return True
            if not mark and had:
                h.flags[i] -= GOAL
            return False
    return False


# ---- the bucketed queue (ties follow its descending sort; pops take the bucket's last entry)
class Queue:
    def __init__(self):
        self.b, self.minimum = [], None

    def push(self, node, pr):
        k = int(pr)
        while len(self.b) <= k:
            self.b.append([])
        bk = self.b[k]
        if self.minimum == k:
            ins = len(bk)
            while ins > 0 and bk[ins - 1][1] <= pr:
                ins -= 1
            bk.insert(ins, (node, pr))
        else:
            bk.append((node, pr))
            if self.minimum is None or k < self.minimum:
                self.minimum = k

    def pop(self):
        if self.minimum is None:
            return None
        m = self.minimum
        e = self.b[m].pop()
        if not self.b[m]:
            self.minimum = next((i for i in range(m + 1, len(self.b)) if self.b[i]), None)
            if self.minimum is not None:
                bk = self.b[self.minimum]
                sort_desc(bk, 0, len(bk), len(bk))
        return e


def sort_desc(a, lo, hi, budget):
    while hi - lo > 32:
        if budget == 0:
            heap_sort(a, lo, hi)
            return
        es, ee = partition(a, lo, hi)
        budget = (budget >> 2) + (budget >> 1)
        if es - lo < hi - ee:
            sort_desc(a, lo, es, budget)
            lo = ee
        else:
            sort_desc(a, ee, hi, budget)
            hi = es
    for nxt in range(lo + 1, hi):
        v = a[nxt]
        hole = nxt
        while hole > lo and v[1] > a[hole - 1][1]:
            a[hole] = a[hole - 1]
            hole -= 1
        a[hole] = v


def _med3(a, i, j, k):
    if a[j][1] > a[i][1]:
        a[i], a[j] = a[j], a[i]
    if a[k][1] > a[j][1]:
        a[j], a[k] = a[k], a[j]
        if a[j][1] > a[i][1]:
            a[i], a[j] = a[j], a[i]


def partition(a, lo, hi):
    n = hi - lo
    last, mid = lo + n - 1, lo + n // 2
    if n <= 41:
        _med3(a, lo, mid, last)
    else:
        s = n // 8
        _med3(a, lo, lo + s, lo + 2 * s)
        _med3(a, mid - s, mid, mid + s)
        _med3(a, last - 2 * s, last - s, last)
        _med3(a, lo + s, mid, last - s)
    es = lo + n // 2
    ee = es + 1
    p = a[es][1]
    while es > lo and a[es - 1][1] == p:
        es -= 1
    while ee < hi and a[ee][1] == p:
        ee += 1
    left, right = es, ee
    while True:
        while right < hi and a[right][1] <= p:
            if a[right][1] == p:
                a[ee], a[right] = a[right], a[ee]
                ee += 1
            right += 1
        while left > lo and a[left - 1][1] >= p:
            if a[left - 1][1] == p:
                es -= 1
                a[es], a[left - 1] = a[left - 1], a[es]
            left -= 1
        if left == lo and right == hi:
            return es, ee
        if left == lo:
            if ee != right:
                a[es], a[ee] = a[ee], a[es]
            ee += 1
            a[es], a[right] = a[right], a[es]
            es += 1
            right += 1
        elif right == hi:
            left -= 1
            es -= 1
            a[left], a[es] = a[es], a[left]
            ee -= 1
            a[es], a[ee] = a[ee], a[es]
        else:
            left -= 1
            a[left], a[right] = a[right], a[left]
            right += 1


def heap_sort(a, lo, hi):
    n = hi - lo
    for root in range(n // 2 - 1, -1, -1):
        _heap_replace(a, lo, n, root, a[lo + root])
    for end in range(n - 1, 0, -1):
        v = a[lo + end]
        a[lo + end] = a[lo]
        _heap_replace(a, lo, end, 0, v)


def _heap_replace(a, lo, count, root, v):
    last_parent = (count - 1) // 2
    hole = root
    while hole < last_parent:
        left = 2 * hole + 1
        right = left + 1
        child = right if a[lo + right][1] <= a[lo + left][1] else left
        a[lo + hole] = a[lo + child]
        hole = child
    if hole == last_parent and count % 2 == 0:
        a[lo + hole] = a[lo + count - 1]
        hole = count - 1
    while hole > root:
        parent = (hole - 1) // 2
        if a[lo + parent][1] <= v[1]:
            break
        a[lo + hole] = a[lo + parent]
        hole = parent
    a[lo + hole] = v


def idist(a, b):
    dx, dy = int(a[0]) - int(b[0]), int(a[1]) - int(b[1])
    return f32(np.sqrt(f32(dy * dy + dx * dx)))


def orthogonal(a, b):
    return (a in (LEFT, RIGHT) and b in (UP, DOWN)) or (a in (UP, DOWN) and b in (LEFT, RIGHT))


class Search:
    """One search from start (a float point) to goal (a float point); returns (status, length)."""

    def __init__(self, h, start, goal, clearance, no_route=3):
        self.h = h
        self.nodes = []          # [level, cell, point, cost, priority, parent, direction, shortcut]
        self.q = Queue()
        self.goal = (int(goal[0]), int(goal[1]))
        self.closest, self.closest_d, self.popped = None, f32(999999.0), 0
        marker = mark_goal(h, goal, clearance, True)
        touched = []
        try:
            terminal, exit_ = self.run((int(start[0]), int(start[1])), touched)
            status = no_route if terminal is None else (1 if exit_ == "goal" and marker else 2)
            pts = self.reconstruct(terminal, status, start, goal, clearance)
        finally:
            mark_goal(h, goal, clearance, False)
            for lv, cx, cy in touched:
                h.conn[h.idx(lv, cx, cy)] &= 15
        length = f32(0.0)
        for p, q in zip(pts, pts[1:]):
            dx, dy = f32(q[0] - p[0]), f32(q[1] - p[1])
            length = f32(length + f32(np.sqrt(f32(f32(dy * dy + dx * dx) + f32(0.0)))))
        self.status, self.length, self.pts = status, length, pts

    def alloc(self, node, enqueue):
        self.nodes.append(node)
        if enqueue:
            self.q.push(len(self.nodes) - 1, node[4])
        return len(self.nodes) - 1

    def run(self, start, touched):
        h = self.h
        lv = 3
        while lv > 0 and h.flags[h.idx(lv, start[0] >> lv, start[1] >> lv)] & FRONTIER == 0:
            lv -= 1
        cell = (start[0] >> lv, start[1] >> lv)
        i = h.idx(lv, *cell)
        if h.conn[i] == 0 and h.flags[i] & ISOLATED == 0:
            return None, "blocked"
        dx, dy = f32(self.goal[0] - start[0]), f32(self.goal[1] - start[1])
        d0 = f32(np.sqrt(f32(dy * dy + dx * dx)))
        root = self.alloc([lv, cell, start, f32(0.0), d0, None, 0, False], h.flags[i] & GOAL == 0)
        touched.append((lv, cell[0], cell[1]))
        if h.flags[i] & GOAL:
            return root, "goal"
        h.conn[i] = (h.conn[i] + QUEUED) & 0xFF
        while True:
            e = self.q.pop()
            if e is None:
                break
            self.popped += 1
            cur = e[0]
            nd = self.nodes[cur]
            j = h.idx(nd[0], *nd[1])
            c = h.conn[j]
            if c & VISITED:
                continue
            h.conn[j] = (c + VISITED) & 0xFF
            residual = f32(nd[4] - nd[3])
            if self.closest_d > residual:
                self.closest_d, self.closest = residual, cur
            if residual <= 5.0 and d0 <= 10.0 and self.popped >= 10 * int(d0):
                return cur, "near"
            for direction, ddx, ddy, rec in ((LEFT, -1, 0, RIGHT), (RIGHT, 1, 0, LEFT), (UP, 0, -1, DOWN),
                                             (DOWN, 0, 1, UP)):
                if c & direction == 0:
                    continue
                g = self.neighbor(nd[0], (nd[1][0] + ddx, nd[1][1] + ddy), cur, rec, touched)
                if g is not None:
                    return g, "goal"
        return self.closest, "exhausted"

    def neighbor(self, lv, cell, parent, rec, touched):
        h = self.h
        if lv >= 4 or cell[0] < 0 or cell[1] < 0 or cell[0] >= h.widths[lv] or cell[1] >= h.heights[lv]:
            raise ValueError("path connection outside the hierarchy")
        i = h.idx(lv, *cell)
        if h.conn[i] & rec == 0:
            return None
        if h.flags[i] & FRONTIER:
            if h.conn[i] & VISITED:
                return None
            if lv == 0:
                point = cell
            else:
                half = 1 << (lv - 1)
                point = ((cell[0] << lv) + half, (cell[1] << lv) + half)
            prev = self.nodes[parent]
            shortcut = prev[5] is not None and not prev[7] and orthogonal(rec, prev[6])
            pred = self.nodes[prev[5]] if shortcut else prev
            cost = f32(idist(pred[2], point) + pred[3])
            pr = f32(cost + idist(self.goal, point))
            node = self.alloc([lv, cell, point, cost, pr, parent, rec, shortcut], True)
            if h.conn[i] & QUEUED == 0:
                h.conn[i] = (h.conn[i] + QUEUED) & 0xFF
                touched.append((lv, cell[0], cell[1]))
            return node if h.flags[i] & GOAL else None
        if h.flags[i] & SPLIT == 0:
            return self.neighbor(lv + 1, (cell[0] >> 1, cell[1] >> 1), parent, rec, touched)
        if lv == 0:
            raise ValueError("base path cell cannot split")
        for dx, dy, mask in ((0, 0, LEFT | UP), (1, 0, RIGHT | UP), (0, 1, LEFT | DOWN), (1, 1, RIGHT | DOWN)):
            if rec & mask == 0:
                continue
            g = self.neighbor(lv - 1, (cell[0] * 2 + dx, cell[1] * 2 + dy), parent, rec, touched)
            if g is not None:
                return g
        return None

    # -- portals: the shared edge between a node's cell and its parent's
    def _portal(self, idx):
        nd = self.nodes[idx]
        par = self.nodes[nd[5]]
        finer = nd if nd[0] <= par[0] else par
        axis = 0 if nd[6] in (UP, DOWN) else 1
        low = finer[1][axis] << finer[0]
        high = low + (1 << finer[0]) - 1
        fixed = nd[1][1 - axis] << nd[0]
        if nd[6] in (DOWN, RIGHT):
            fixed += (1 << nd[0]) - 1
        return [axis, low, high, fixed, finer[0], nd[6]]

    def _pt(self, p, moving):
        return (moving, p[3]) if p[0] == 0 else (p[3], moving)

    def _connects(self, p, moving):
        x, y = self._pt(p, moving)
        if x < 0 or y < 0 or x >= self.h.widths[0] or y >= self.h.heights[0]:
            raise ValueError("portal scan outside the base grid")
        return self.h.conn[self.h.idx(0, x, y)] & p[5] != 0

    def _nearest(self, p, target, missing):
        result, distance = missing, 9999
        for c in range(target, p[2] + 1):
            if self._connects(p, c):
                result, distance = c, c - target
                break
        for c in range(target, p[1] - 1, -1):
            if distance <= 0:
                break
            if self._connects(p, c):
                result = c
                break
            distance -= 1
        return result

    def resolve_portal(self, idx):
        if self.nodes[idx][5] is None:
            return None
        p = self._portal(idx)
        if p[4] == 0:
            moving = p[1]
        else:
            mid = p[1] + (1 << (p[4] - 1))
            moving = self._nearest(p, mid, mid)
        x, y = self._pt(p, moving)
        return (min(x, self.h.width - 1), min(y, self.h.height - 1))

    def project_portal(self, idx, towards, last):
        nd = self.nodes[idx]
        if nd[5] is None:
            return None
        p = self._portal(idx)
        if p[0] == 0:
            p[2] = min(p[2], self.h.width - 1)
            if nd[6] == DOWN:
                p[3] = min(p[3], self.h.height - 1)
        along, perp = p[0], 1 - p[0]
        d_al = towards[along] - last[along]
        d_pe = towards[perp] - last[perp]
        reaches = (p[3] <= last[perp]) if nd[6] in (UP, LEFT) else (p[3] >= last[perp])
        crossing = p[3] - last[perp] if reaches else 0
        if crossing != 0 and d_pe != 0:
            q = d_al * crossing
            target = (last[along] & 0xFFFF) + int(q / d_pe)      # Rust integer division truncates toward zero
            target = ((target + 0x8000) & 0xFFFF) - 0x8000
        else:
            target = last[along]
        if target <= p[1]:
            moving = next((c for c in range(p[1], p[2] + 1) if self._connects(p, c)), -1)
        elif target >= p[2]:
            moving = next((c for c in range(p[2], p[1] - 1, -1) if self._connects(p, c)), -1)
        else:
            moving = self._nearest(p, target, -1)
        return self._pt(p, moving)

    def reconstruct(self, terminal, status, start, goal, clearance):
        if terminal is None:
            return []
        h = self.h
        gt = (int(goal[0]), int(goal[1]))
        st = (int(start[0]), int(start[1]))
        if status == 1 and h.conn[h.idx(0, *gt)] != 0:
            first = (f32(goal[0]), f32(goal[1]))
        else:
            nd = self.nodes[terminal]
            rep = self.representative(nd[0], nd[1], gt)
            if status == 1 and f32(clearance + f32(0.01)) >= f32(np.sqrt(f32((gt[0] - rep[0]) ** 2 + (gt[1] - rep[1]) ** 2))):
                first = (f32(goal[0]), f32(goal[1]))
            else:
                first = (f32(rep[0] + 0.5), f32(rep[1] + 0.5))
        pts = [first]
        last = gt
        cur = terminal
        while cur is not None:
            par = self.nodes[cur][5]
            gp = self.nodes[par][5] if par is not None else None
            towards = (self.resolve_portal(gp) or st) if gp is not None else st
            p = self.project_portal(cur, towards, last)
            if p is not None:
                pts.append((f32(p[0] + 0.5), f32(p[1] + 0.5)))
                last = p
            cur = par
        pts.append((f32(start[0]), f32(start[1])))
        pts.reverse()
        out = []
        for p in pts:
            if not out or out[-1] != p:
                out.append(p)
        return out

    def representative(self, lv, cell, goal):
        h = self.h
        x, y = cell
        while lv > 0:
            lv -= 1
            x, y = x * 2, y * 2
            g = (goal[0] >> lv, goal[1] >> lv)
            best, off = 9999, (0, 0)
            for dx, dy in ((0, 0), (0, 1), (1, 0), (1, 1)):
                cx, cy = x + dx, y + dy
                j = h.idx(lv, cx, cy)
                if h.flags[j] & 15 == 15 or h.conn[j] == 0:
                    continue
                dist = max(g[0] - cx, 0) + max(g[1] - cy, 0)
                if 0 <= dist < best:
                    best, off = dist, (dx, dy)
            x, y = x + off[0], y + off[1]
        return (x, y)


def allows(h, clearance, requirement, candidate, origin):
    """require_path stored as N + 1 (0: not required). True when the candidate tile may hold the object."""
    if requirement == 0:
        return True
    s = Search(h, (candidate[0] + 0.5, candidate[1] + 0.5), (origin[0] + 0.5, origin[1] + 0.5), f32(clearance))
    if s.status >= 2:
        return False
    if requirement <= 1:
        return True
    dx, dy = origin[0] - candidate[0], origin[1] - candidate[1]
    straight = int(f32(np.sqrt(f32(dx * dx + dy * dy))))
    return int(s.length) <= straight + requirement - 1
