// A "keep these points at least d apart" index — docs/preview-design.md
// Sec.11's performance contract, applied to the one shape three stages had
// each solved with a linear scan. PURE (CLAUDE.md hard rule / preview-design
// Sec.2).
//
// THE PATTERN, because it is not obvious that these are the same problem:
// several stages accumulate a point set during one command's run and ask,
// before each new placement, "is anything already placed closer than d?".
// S6 does it for `min_distance_group_placement`, S2 for `create_elevation`'s
// `spacing`. The point set only ever grows and d is fixed for the whole
// command, so the natural implementation is a scan over the points — which
// is O(points) per query and therefore O(n^2) over a command.
//
// That is not a theoretical cost. Measured on the corpus before this module
// existed (2026-08-07): `TL Team Acropolis.rms` ran **545 million** distance
// comparisons inside S6's own scan, `24hr_Blind Valley.rms` 238 million,
// `AK_Namatjira.rms` 188 million — between them roughly two thirds of the
// entire preview's runtime, on maps that place tens of thousands of objects
// because that is what their authors asked for.
//
// A uniform grid removes it. Cells are `ceil(d)` on a side, so any point
// within distance d of a query sits in the query's own cell or one of the
// eight around it: at most nine cells to scan, whatever the map size or the
// point count. That bound holds for BOTH metrics because Euclidean distance
// is never larger than Chebyshev distance — a point inside the Euclidean
// radius is inside the Chebyshev square too, so the same nine cells cover it.
//
// Occupancy per cell is bounded in practice as well: every point in the index
// was itself accepted, so no two are closer than d, and a d x d cell can hold
// at most four such points under Chebyshev. Correctness does not depend on
// that — the scan is exhaustive over the nine cells regardless — but it is
// why the query is genuinely O(1) rather than O(1) on average.

/**
 * `chebyshev` is `max(|dx|, |dy|)`, the "king move" distance the guide's own
 * `min_distance_group_placement` uses. `euclidean` compares squared
 * distances, matching the integer-arithmetic rule in Sec.8 (no `Math.sqrt`
 * anywhere in `src/preview/generator/**`, enforced by the lint gate).
 */
export type SpacingMetric = "chebyshev" | "euclidean";

export interface SpacingIndex {
  /** Records a point. Callers add only points they have already accepted, which is what keeps cell occupancy bounded. */
  add(x: number, y: number): void;
  /** True when some recorded point is strictly closer than the index's separation distance — the same `<` the linear scans it replaces used, so a point exactly d away is still allowed. */
  tooClose(x: number, y: number): boolean;
  /** How many points have been recorded. Lets a caller skip the query entirely while the index is empty. */
  readonly size: number;
}

/**
 * A no-op index for `distance <= 0`, where the constraint cannot reject
 * anything. Returned rather than special-cased at every call site: a stage
 * asking "is this tile too close to another" should not also have to ask
 * "does this command have a spacing rule at all".
 */
const NEVER_TOO_CLOSE: SpacingIndex = {
  add: () => {},
  tooClose: () => false,
  size: 0,
};

export function createSpacingIndex(
  dim: number,
  distance: number,
  metric: SpacingMetric,
): SpacingIndex {
  if (!(distance > 0)) return NEVER_TOO_CLOSE;

  const cell = Math.max(1, Math.ceil(distance));
  const cols = Math.max(1, Math.ceil(dim / cell));
  // Sparse on purpose. A Map costs a hash per query, but allocating
  // `cols * cols` arrays up front costs that many allocations for a command
  // that may place three objects — and `cell` is 1 for the common
  // `min_distance_group_placement 1`, which would make that 57,600 empty
  // arrays on a Huge map, per command.
  const buckets = new Map<number, number[]>();
  const minDistanceSquared = distance * distance;
  let size = 0;

  return {
    add(x: number, y: number): void {
      const key = Math.floor(y / cell) * cols + Math.floor(x / cell);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(x, y);
      else buckets.set(key, [x, y]);
      size++;
    },
    tooClose(x: number, y: number): boolean {
      if (size === 0) return false;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0) continue;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          // Out-of-range columns are skipped rather than looked up. The key
          // is `gy * cols + gx`, so gx = -1 on row k aliases onto the LAST
          // column of row k-1 — a real cell holding real points.
          //
          // Worth being precise about what that costs, because it is NOT a
          // correctness bug and this guard should not be mistaken for one:
          // the distance test below runs on true coordinates, so an aliased
          // bucket can only ever be extra work, never a wrong answer (a point
          // 39 tiles away fails the test whichever cell it was found in). Nor
          // can it cause a MISS, since the cell being aliased away from is
          // off-grid and necessarily empty. The guard is here so the
          // neighbourhood scan means what it says and so an edge query does
          // not pay for a bucket on the far side of the map.
          if (gx < 0 || gx >= cols) continue;
          const bucket = buckets.get(gy * cols + gx);
          if (bucket === undefined) continue;
          // Points are stored flat (x, y, x, y, ...) rather than as objects:
          // Sec.11's "typed arrays only, no per-tile objects" rule applied to
          // a list whose length is a placement count, not a tile count.
          for (let i = 0; i < bucket.length; i += 2) {
            const dx = x - bucket[i];
            const dy = y - bucket[i + 1];
            if (metric === "chebyshev") {
              if (Math.max(Math.abs(dx), Math.abs(dy)) < distance) return true;
            } else if (dx * dx + dy * dy < minDistanceSquared) {
              return true;
            }
          }
        }
      }
      return false;
    },
    get size(): number {
      return size;
    },
  };
}
