import { describe, expect, it } from "vitest";
import { fail, intersectCandidates, ok, pushFailure, type AttributedPredicate } from "../generator/placement";
import type { PlacementFailure } from "../generator/types";

describe("ok / fail", () => {
  it("ok wraps a value in the { ok: true } branch", () => {
    const outcome = ok(42);
    expect(outcome).toEqual({ ok: true, value: 42 });
  });

  it("fail wraps a failure in the { ok: false } branch", () => {
    const failure = {
      bucket: "noValidTiles" as const,
      commandSpan: { start: 0, end: 1 },
      stage: "S1" as const,
      entity: "land #1",
      detail: "no tile satisfied every constraint",
    };
    expect(fail(failure)).toEqual({ ok: false, failure });
  });
});

describe("intersectCandidates", () => {
  const keepEven: AttributedPredicate = {
    bucket: "terrainAbsent",
    test: (i) => i % 2 === 0,
  };
  const keepUnder100: AttributedPredicate = {
    bucket: "spacingConflict",
    test: (i) => i < 100,
  };

  it("with no predicates, returns the input set unchanged", () => {
    const scratch = Int32Array.from([5, 3, 9]);
    const result = intersectCandidates(scratch, 3, []);
    expect(Array.from(result.survivors)).toEqual([5, 3, 9]);
    expect(result.count).toBe(3);
    expect(result.failedBucket).toBeUndefined();
  });

  it("an empty initial set is noValidTiles before any predicate runs", () => {
    const scratch = new Int32Array(0);
    const result = intersectCandidates(scratch, 0, [keepEven]);
    expect(result.count).toBe(0);
    expect(result.failedBucket).toBe("noValidTiles");
  });

  it("filters in place, successive predicates narrowing the set", () => {
    const scratch = Int32Array.from([1, 2, 3, 4, 5, 6, 200, 202]);
    const result = intersectCandidates(scratch, scratch.length, [keepEven, keepUnder100]);
    expect(Array.from(result.survivors)).toEqual([2, 4, 6]);
    expect(result.count).toBe(3);
    expect(result.failedBucket).toBeUndefined();
  });

  it("attributes the failure to the predicate that actually emptied the set, not an earlier one that merely narrowed it", () => {
    // keepEven narrows [1,3,201] to [] directly (none are even) — the
    // failure belongs to keepEven, and keepUnder100 never even gets a
    // chance to run, so its bucket must NOT be reported.
    const scratch = Int32Array.from([1, 3, 201]);
    const result = intersectCandidates(scratch, scratch.length, [keepEven, keepUnder100]);
    expect(result.count).toBe(0);
    expect(result.failedBucket).toBe("terrainAbsent");
  });

  it("attributes to the SECOND predicate when the first narrows but doesn't empty", () => {
    // keepEven narrows [3,200,202,204] to [200,202,204] (non-empty), THEN
    // keepUnder100 empties it — the failure belongs to keepUnder100.
    const scratch = Int32Array.from([3, 200, 202, 204]);
    const result = intersectCandidates(scratch, scratch.length, [keepEven, keepUnder100]);
    expect(result.count).toBe(0);
    expect(result.failedBucket).toBe("spacingConflict");
  });

  it("does not scan past the caller-supplied initialCount (a cache's scratch buffer may be larger)", () => {
    const scratch = Int32Array.from([2, 4, 6, /* not part of this command's candidates */ 999]);
    const result = intersectCandidates(scratch, 3, [keepUnder100]);
    expect(Array.from(result.survivors)).toEqual([2, 4, 6]);
  });
});

describe("pushFailure (Sec.7's bucket coalescing)", () => {
  function failure(bucket: PlacementFailure["bucket"], detail: string): PlacementFailure {
    return { bucket, commandSpan: { start: 0, end: 1 }, stage: "S6", entity: "GOLD", detail };
  }

  it("keeps the first failure of a bucket verbatim", () => {
    const failures: PlacementFailure[] = [];
    pushFailure(failures, failure("occupancyFull", "first"));
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toBe("first");
    expect(failures[0].occurrences).toBeUndefined(); // absent means one
  });

  it("counts repeats of a bucket instead of storing them", () => {
    const failures: PlacementFailure[] = [];
    for (let i = 0; i < 50_000; i++) pushFailure(failures, failure("occupancyFull", `attempt ${i}`));
    expect(failures).toHaveLength(1);
    expect(failures[0].occurrences).toBe(50_000);
    // The example stays the FIRST one, not the last — a later attempt is not
    // more representative, and re-pointing it every time would mean the
    // detail string could never be reasoned about.
    expect(failures[0].detail).toBe("attempt 0");
  });

  it("keeps different buckets apart", () => {
    const failures: PlacementFailure[] = [];
    pushFailure(failures, failure("occupancyFull", "a"));
    pushFailure(failures, failure("terrainAbsent", "b"));
    pushFailure(failures, failure("occupancyFull", "c"));
    expect(failures.map((f) => f.bucket)).toEqual(["occupancyFull", "terrainAbsent"]);
    expect(failures[0].occurrences).toBe(2);
    expect(failures[1].occurrences).toBeUndefined();
  });
});
