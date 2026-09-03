// consistency-checker-design.md Sec.4.2 (aggregation, three-state cells) and
// Sec.5.4 (notes passthrough: group-by-key-then-text, span dedup, range
// collapsing).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { buildLanguageIndex } from "../../../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../../../parser/__tests__/testUtils";
import { DEFAULT_TEAMS } from "../../../../generationSettings/generationSettingsConstants";
import { generatePreview, type PreviewReferenceData } from "../../../../preview/generator/index";
import type { PublishedGameConstants } from "../../../../../tools-api/index";
import { objectConstantsFromPublished } from "../../../previewBridge";
import type { CommandReport, SimulationNote } from "../../../../preview/generator/types";
import { cellStateOf, MonteCarloAggregate } from "../aggregate";

const lang = loadLanguage();
const gameConstants = (
  JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as { constants: PublishedGameConstants }
).constants;

function report(overrides: Partial<CommandReport> = {}): CommandReport {
  return { commandSpan: { start: 10, end: 20 }, stage: "S6", attempted: 3, placed: 3, failures: [], ...overrides };
}

describe("MonteCarloAggregate — CommandReport folding", () => {
  it("sums attempted/placed across runs at one player count", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report({ attempted: 2, placed: 1 })], []);
    agg.addGeneration(4, [report({ attempted: 4, placed: 4 })], []);
    const row = agg.allRows()[0];
    const cell = row.cells.get(4)!;
    expect(cell.attempted).toBe(6);
    expect(cell.placed).toBe(5);
    expect(cell.runsContaining).toBe(2);
  });

  it("coalesces failures by bucket, summing occurrences", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report({ failures: [{ bucket: "occupancyFull", commandSpan: { start: 10, end: 20 }, stage: "S6", entity: "GOLD", detail: "d", occurrences: 3 }] })], []);
    agg.addGeneration(4, [report({ failures: [{ bucket: "occupancyFull", commandSpan: { start: 10, end: 20 }, stage: "S6", entity: "GOLD", detail: "d" }] })], []);
    const cell = agg.allRows()[0].cells.get(4)!;
    expect(cell.failures.get("occupancyFull")?.occurrences).toBe(4); // 3 + (absent -> 1)
  });

  it("keeps player counts as SEPARATE cells on the same row, never merged", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(2, [report({ attempted: 1, placed: 1 })], []);
    agg.addGeneration(8, [report({ attempted: 1, placed: 0 })], []);
    const row = agg.allRows()[0];
    expect(row.cells.get(2)?.placed).toBe(1);
    expect(row.cells.get(8)?.placed).toBe(0);
  });

  it("ABSENT: a count where this row never appears has no cell at all, not a zero-attempt one", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report()], []);
    agg.addGeneration(8, [], []); // ran, but this commandSpan never showed up
    const row = agg.allRows()[0];
    expect(cellStateOf(row.cells.get(4))).toBe("rated");
    expect(cellStateOf(row.cells.get(8))).toBe("absent");
    expect(row.cells.has(8)).toBe(false);
  });

  it("ZERO-ATTEMPT: runsContaining > 0 but attempted stays 0 — distinct from absent", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report({ attempted: 0, placed: 0 })], []);
    const row = agg.allRows()[0];
    expect(cellStateOf(row.cells.get(4))).toBe("zeroAttempt");
  });

  it("runsAt() tracks generations attempted at a count, independent of whether any row appeared", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [], []);
    agg.addGeneration(4, [], []);
    expect(agg.runsAt(4)).toBe(2);
    expect(agg.runsAt(8)).toBe(0);
  });

  it("a commandSpan present in only SOME runs of a batch does not invent a zero row for the runs that never contained it (Sec.8 item 3)", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report({ attempted: 5, placed: 5 })], []); // run 1: contains it
    agg.addGeneration(4, [], []); // run 2: does not
    const cell = agg.allRows()[0].cells.get(4)!;
    expect(cell.runsContaining).toBe(1); // not 2
    expect(cell.attempted).toBe(5); // not diluted by a phantom 0
  });
});

describe("Sec.8 item 3 — the partially-present case, on the CORPUS rather than hand-built", () => {
  // The item's own sentence is "a CORPUS case on one of those maps, not a
  // hand-built one", and the first implementation answered it with two
  // `addGeneration` calls and a literal report (kept above, it pins the sum
  // arithmetic, which is the other half of the item). `sample.rms` is
  // TRACKED, so this runs on a clone; at the defaults it carries 2 rows that
  // appear in some runs of a batch and not others, and the whole point of
  // `runsContaining` is that a rate summed over those runs must not be read
  // as though it covered the batch.
  it("sample.rms carries a row whose runsContaining is below its batch size, and the sum is over exactly those runs", () => {
    const source = readFileSync(join(REPO_ROOT, "test-maps", "sample.rms"), "utf8");
    const parse = parseRms(source, lang);
    const refDb: PreviewReferenceData = { language: buildLanguageIndex(lang), constants: objectConstantsFromPublished(gameConstants) };
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(source.length);
    const RUNS = 15;
    for (const pc of [2, 4, 6, 8]) {
      for (let r = 0; r < RUNS; r++) {
        const result = generatePreview(parse, refDb, { playerCount: pc, mapSize: "Normal", teams: [...DEFAULT_TEAMS] } as never, { seed: 1 + r, collectSnapshots: false });
        agg.addGeneration(pc, result.reports, result.notes);
      }
    }

    // The batch size is a property of the batch, not of any cell (Sec.4.2).
    for (const pc of [2, 4, 6, 8]) expect(agg.runsAt(pc)).toBe(RUNS);

    const partiallyPresent = agg
      .allRows()
      .flatMap((row) => [...row.cells.entries()].map(([pc, cell]) => ({ pc, cell })))
      .filter(({ pc, cell }) => cell.runsContaining > 0 && cell.runsContaining < agg.runsAt(pc));

    // A control that cannot come back zero: if the corpus stops carrying this
    // shape the assertions below are vacuous, and the rule loses its case.
    expect(partiallyPresent.length).toBeGreaterThan(0);

    for (const { cell } of partiallyPresent) {
      // No phantom zero rows: the sum covers the runs that HELD the span, so
      // `attempted` cannot exceed what those runs could have contributed, and
      // a merge that skipped absent runs and then reported the sum as though
      // it covered every run is what this distinguishes.
      expect(cell.attempted).toBeGreaterThan(0);
      expect(cell.runsContaining).toBeLessThan(RUNS);
    }
  }, 300_000);
});

describe("MonteCarloAggregate — notes passthrough (Sec.5.4)", () => {
  function note(overrides: Partial<SimulationNote> = {}): SimulationNote {
    return { key: "k", prominence: "drawer", stage: "S0", text: "t", ...overrides };
  }

  it("groups by TEXT, merging many distinct per-span keys sharing one sentence into one group", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(4, [], [
      note({ key: "unsimulated:0-10", span: { start: 0, end: 10 }, text: "not simulated" }),
      note({ key: "unsimulated:20-30", span: { start: 20, end: 30 }, text: "not simulated" }),
    ]);
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].spans).toHaveLength(2);
  });

  it("dedupes the SAME span reported by two different runs — one row, not two", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(4, [], [note({ key: "unsimulated:0-10", span: { start: 0, end: 10 }, text: "not simulated" })]);
    agg.addGeneration(4, [], [note({ key: "unsimulated:0-10", span: { start: 0, end: 10 }, text: "not simulated" })]);
    const groups = agg.noteGroups();
    expect(groups[0].count).toBe(1);
  });

  it("merges OVERLAPPING spans within a run for the covered fraction, rather than summing them", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(100);
    agg.addGeneration(4, [], [
      note({ key: "a", span: { start: 0, end: 50 }, text: "t" }),
      note({ key: "b", span: { start: 40, end: 60 }, text: "t" }), // overlaps a by 10
    ]);
    const groups = agg.noteGroups();
    // union is [0,60) = 60 chars, not 50+20=70
    expect(groups[0].coveredFraction).toBeCloseTo(0.6, 5);
  });

  it("a spanless group (run-level note) has no table and no covered fraction", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(4, [], [note({ key: "teams", text: "no teams in this lobby" })]);
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].spans).toEqual([]);
    expect(groups[0].coveredFraction).toBeUndefined();
  });

  it("collapses a key whose interpolated text differs only by a number into a RANGE, one group instead of two — and the range does NOT multiply the span", () => {
    // The two rules meet on the SAME note and only one of them used to be
    // implemented: the range collapse concatenates each text's spans, so a
    // key whose text interpolates a per-run number re-contributed its span
    // once per run. At the defaults (60 generations) that read `count = 58`
    // for ONE place on `AK_Namatjira.rms`, with a 58-row table beside it.
    // The fixture carries the SAME span deliberately. Without it the
    // concatenation is invisible, which is why the two older tests passed.
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    const span = { start: 0, end: 10 };
    for (const n of [62, 70, 64, 62, 70]) {
      agg.addGeneration(4, [], [note({ key: "k", span, text: `${n} tiles overwritten` })]);
    }
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe("62-70 tiles overwritten");
    expect(groups[0].spans).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it("dedupes one span across the KEYS that step 2 merges, not only within one (key, text) bucket", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    const span = { start: 5, end: 15 };
    agg.addGeneration(4, [], [note({ key: "a", span, text: "same sentence" }), note({ key: "b", span, text: "same sentence" })]);
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].spans).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it("a spanless note whose text interpolates a per-run number is ONE occurrence, not one per run", () => {
    // The shape: one key, no span, a per-run count in the text. Over the 60
    // default generations `sample.rms`'s beach note produced 14 distinct
    // texts this way, and counting the (key, text) buckets reported 14
    // occurrences of a thing that happened once per run. The range collapse
    // has already merged them into one entry, and one entry is one occurrence.
    //
    // Uses `landOverwrittenBeforeGrowth` rather than the beach note, which
    // the checker no longer passes through at all (see
    // NOTE_KEYS_NOT_PASSED_THROUGH). A suppressed key would make this
    // fixture green for the wrong reason.
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    for (const n of [2, 5, 3, 2, 4]) agg.addGeneration(4, [], [note({ key: "landOverwrittenBeforeGrowth", text: `${n} lands are missing from this preview` })]);
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe("2-5 lands are missing from this preview");
    expect(groups[0].count).toBe(1);
  });

  it("a suppressed key contributes nothing at all — not an empty group, not a zero count", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(4, [], [note({ key: "automaticBeach", text: "beach happened" })]);
    expect(agg.noteGroups()).toEqual([]);
  });

  it("a spanless group's count is its distinct occurrences, and never 0 for a note that occurred", () => {
    // The aggregate's only counter used to be the span map, so a run-level
    // note rendered as "no teams in this lobby (0 places)", a true note
    // with a false number welded to it, on most of the corpus.
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    for (let i = 0; i < 20; i++) agg.addGeneration(4, [], [note({ key: "teams", text: "no teams in this lobby" })]);
    const groups = agg.noteGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].spans).toEqual([]);
    // 20 runs, ONE occurrence, the count must not track the run count either.
    expect(groups[0].count).toBe(1);
  });

  it("does NOT collapse two genuinely different texts under the same key into a fabricated range", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(4, [], [note({ key: "k", text: "alpha" })]);
    agg.addGeneration(4, [], [note({ key: "k", text: "beta" })]);
    const groups = agg.noteGroups();
    expect(groups.map((g) => g.text).sort()).toEqual(["alpha", "beta"]);
  });
});
