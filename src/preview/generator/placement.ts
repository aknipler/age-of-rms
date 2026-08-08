// PlacementOutcome machinery and failure attribution — docs/preview-design.md
// Sec.7. PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// Sec.7's non-negotiable rule is "no placement primitive returns a bare
// boolean" — every stage (lands, elevation, terrains, objects, ...) reports
// through PlacementOutcome, and this file is where the shared pieces of that
// live, so S1 and S6 don't each grow a slightly different version of the
// same algorithm the way rev 3 let borderBlocked/zoneAvoidanceBlocked drift.

import type { FailureBucket, PlacementFailure, PlacementOutcome } from "./types";

export function ok<T>(value: T): PlacementOutcome<T> {
  return { ok: true, value };
}

export function fail<T>(failure: PlacementFailure): PlacementOutcome<T> {
  return { ok: false, failure };
}

/**
 * Records a failure against one command, COALESCING by bucket: the first
 * failure of a given bucket is kept in full and every later one of the same
 * bucket just increments its `occurrences`.
 *
 * Sec.7's own design says why this is the right shape and not a loss of
 * information: "5.2's report UI aggregates by bucket, and stable bucket
 * identity matters more than forensic precision." Nothing downstream reads
 * the second, third or two-hundred-thousandth record of a bucket; they exist
 * only to be counted.
 *
 * WHAT THE UNCOALESCED VERSION COST, measured over the 32 tracked maps on
 * 2026-08-07: `Menindee_AUS_v2.3.rms` produced **280,427** failure records in
 * one generation, `TC2 - Comeer v1.4.rms` 185,432, `24hr_Caverns.rms`
 * 172,650. Every one is an object carrying a freshly built sentence. They are
 * allocated during generation, structured-cloned wholesale across the worker
 * boundary on every keystroke burst, and then — the part that actually breaks
 * — rendered as one `<li>` each the moment the user opens the notes drawer.
 * None of that buys anything a count does not.
 *
 * The scan is linear in the number of DISTINCT buckets already recorded for
 * this command, which is at most the size of `FailureBucket` (single digits),
 * so this stays O(1) per call without needing a Map per command.
 */
export function pushFailure(failures: PlacementFailure[], failure: PlacementFailure): void {
  for (const existing of failures) {
    if (existing.bucket !== failure.bucket) continue;
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    return;
  }
  failures.push(failure);
}

/**
 * One named constraint in a stage's candidate filter (e.g. S6's border,
 * zone-avoidance, habitat, ... list, Sec.6.6). `bucket` is what gets
 * reported if this predicate is the one that empties the candidate set.
 */
export interface AttributedPredicate {
  bucket: FailureBucket;
  test(tileIndex: number): boolean;
}

export interface IntersectionResult {
  /** View into the same buffer passed in — see intersectCandidates' note. */
  survivors: Int32Array;
  count: number;
  /** Set exactly when count === 0: which predicate (or none) emptied the set. */
  failedBucket?: FailureBucket;
}

/**
 * Sec.7's attribution algorithm, pinned: "successive set intersections in a
 * fixed, documented order — and attribute the failure to the predicate whose
 * intersection first produced the empty set; if the set was empty before any
 * predicate ran, noValidTiles." The predicate order is each stage's own
 * constraint list in the order written in its spec subsection (Sec.7) — this
 * function does not choose an order, it only runs the one it is given.
 *
 * Sec.11 pins the implementation this has to be, not just the algorithm:
 * `scratch` is a per-command Int32Array copied ONCE from a cached per-stage
 * base set (the caller's job), and each predicate pass write-compacts it IN
 * PLACE rather than allocating a filtered copy — "copy, do not compact the
 * cache itself", because compacting the shared base would corrupt it for
 * every later command that reuses the same (reference frame, habitat class)
 * cache entry. One `.set()` per command (the caller's copy into `scratch`)
 * buys both the performance property and this function's attribution for
 * free — the same compaction pass IS the attribution.
 */
export function intersectCandidates(
  scratch: Int32Array,
  initialCount: number,
  predicates: readonly AttributedPredicate[],
): IntersectionResult {
  if (initialCount === 0) {
    return { survivors: scratch.subarray(0, 0), count: 0, failedBucket: "noValidTiles" };
  }
  let count = initialCount;
  for (const predicate of predicates) {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < count; readIndex++) {
      const tileIndex = scratch[readIndex];
      if (predicate.test(tileIndex)) {
        scratch[writeIndex] = tileIndex;
        writeIndex++;
      }
    }
    count = writeIndex;
    if (count === 0) {
      return { survivors: scratch.subarray(0, 0), count: 0, failedBucket: predicate.bucket };
    }
  }
  return { survivors: scratch.subarray(0, count), count };
}
