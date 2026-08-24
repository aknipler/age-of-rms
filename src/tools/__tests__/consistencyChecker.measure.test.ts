// Corpus census REPORTER for CREATION_PLAN 5.2 / docs/consistency-checker-design.md
// (rev 14). NOT A GATE — it prints numbers and diffs them against a PINNED
// snapshot, but it never throws or fails the build on drift (see the header
// rule the design doc itself states: "a reporter's own expected values are as
// assumable as the numbers it prints", 2026-08-16).
//
// WHY THIS EXISTS. Fourteen review rounds of the design doc each re-derived
// roughly thirty corpus figures by hand-writing a throwaway Vitest probe,
// which is the bulk of what a review round costs. This file is that probe,
// built once, kept, and diffed against history instead of re-typed from
// scratch every round.
//
// SECTIONS 1-6 (sweepA/sweepB) COST AND ISOLATION. Generation dominates: 32
// maps x 4 player counts is ~85s, plus 32 maps x 5 seeds at 4 players is
// ~100s. Both sweeps run EXACTLY ONCE — Sections 1, 2, 3, 5 and 6 all come
// from the single 2/4/6/8 @ seed 1 sweep (sweepA below); Section 4 comes from
// the single 4p @ seeds 1-5 sweep (sweepB below). Nothing here regenerates
// per section.
//
// SECTIONS 7-11 are rev 13/14's four OWED censuses (consistency-checker-
// design.md Sec.8's "four censuses are owed to it" paragraph), each taken at
// a point no earlier sweep crosses. Section 7 (tie-break census) is free —
// it reuses sweepA's rows. Sections 8/9 (the static block count against
// `LIMITS.maxBlocksPerOutput`, and Sec.3.3 clause 2's unresolvable-producer
// ratio) run one AST pass per player count per map — cheap, no generation.
// Section 10 (presence and drift SWEPT TOGETHER, 2/4/6/8 x seeds 1-5 — sweep
// C) is 640 generations. Section 11 (the note census at the tool's own
// DEFAULT run count, 2/4/6/8 x 15 seeds per map — sweep D) is 1920
// generations, the most expensive thing in this file by a wide margin,
// because it is the re-take Sec.4.5's cap margin actually depends on: every
// figure Sec.5.4 pinned before this file existed was taken at ONE generation
// against a default of sixty. Real compute cost is maybe 30-45 minutes
// unloaded. MEASURED WALL CLOCK has been far higher twice — ~5.2 hours, then
// ~24 hours on the very next run — and neither is CPU load: mid-run, the
// node process backing the second run had accumulated only ~13 minutes of
// actual CPU time despite having "run" for most of a day. The laptop this
// session runs on sleeps/powers off while the session (and this test) keeps
// ticking, so wall clock keeps advancing with near-zero compute happening.
// Do not use one inflated duration to recalibrate the expected cost of this
// file, and do not read a timeout failure here as a defect — check
// `consistency-census.json`'s own `generatedAt`/`driftCount` first, since the
// synchronous sweep writes it and finishes its real work well before Vitest's
// timeout can even fire (a fully synchronous function blocks the event loop,
// so the timeout timer cannot preempt it — it only gets evaluated, and only
// then reports stale, once control finally returns). `testTimeout` (here and
// in vitest.measure.config.ts) is set generously for exactly this reason, not
// because the sweep itself is that expensive.
//
// This is deliberately NOT part of `npm test` (vitest.config.ts excludes
// this file by name) — run it with `npm run measure:checker`, which points
// `vitest run` at vitest.measure.config.ts instead.
//
// TWO TRAPS THIS DOCUMENT HAS SHIPPED BEFORE, AND THE REASON EVERY SECTION
// BELOW PRINTS TWO COLUMNS.
//
//   1. Tracked vs on-disk. `test-maps/*.rms` (top-level, non-recursive) is 32
//      files on a maintainer's disk; `git ls-files test-maps` returns 11 of
//      those PLUS `test-maps/broken/BCC2-Rekawa.rms` — a 12th tracked file
//      that sits OUTSIDE the 32 (nested under broken/, so it is not one of
//      "the 32 maps" this document's own figures are measured over; it is a
//      distinct fixture map). `test-maps/local/`'s 19 maps are excluded
//      entirely by the same non-recursive `readdirSync` this file uses.
//      Every PINNED figure below was measured over the 32-on-disk column;
//      the tracked-only column (11 of those 32) is derived by FILTERING the
//      same collected rows/reports/notes, never by generating twice.
//   2. Controls that cannot come back zero. Section 1's "bucketless" row and
//      Section 3/5's "should be zero" rows exist so that a genuinely broken
//      probe (one that silently measures nothing) reads as a red flag rather
//      than a clean report. Every count below is printed beside the
//      denominator it was drawn from (maps scanned, reports scanned, rows
//      keyed) for the same reason.
//
// COUNTING CONVENTIONS, STATED ONCE — THREE of them, over the same data, and
// mixing them up is exactly the kind of drift this reporter exists to catch.
// `PlacementFailure.occurrences` records how many coalesced failures one
// record stands for (absent means 1).
//   (a) Section 5's bucket SET/COUNTS comparison sums `occurrences ?? 1` per
//       bucket (`bucketSums`) — the unit the Failure buckets COLUMN itself
//       renders ("occupancyFull x140").
//   (b) Section 5's headline "summed failures" and "union exceeds attempted"
//       figures count FAILURE RECORDS instead — one `PlacementFailure` entry
//       per bucket per report (`pushFailure` coalesces to at most one record
//       per bucket per report, so `failures.length` already IS that count).
//       The design doc's own worked example pins this: `13_Rings_v1.2.rms`
//       LOWER_HILLTOPS at `:128660`, attempted 3, is "2 failure records at
//       that count and 8 across the matrix" — 8 cannot be an occurrence sum
//       against an attempted count of 3. A bucket recurring across several
//       player counts contributes one record PER COUNT, undeduplicated.
//   (c) Section 1's per-bucket tallies are neither: they count REPORTS whose
//       bucket set contains a given bucket (matching the design doc's own
//       "every S6 row carries exactly one bucket" measurement).
// Each `compute*` function below states in its own comment which of the
// three it uses.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageData, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import type { ParseResult } from "../../parser/types";
import { generatePreview, type PreviewReferenceData } from "../../preview/generator/index";
import { instantiateScript } from "../../preview/generator/instantiate";
import type { ObjectConstant } from "../../preview/generator/objects";
import type { CommandReport, InstantiatedScript, PlacementFailure, PreviewResult, SimulationNote } from "../../preview/generator/types";
import type { TerrainConstantForMasks } from "../../preview/generator/grid";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";
import { MonteCarloAggregate } from "../builtin/checker/aggregate";
import {
  buildStaticContext,
  computeTerrainSurface,
  runStaticChecks,
  UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO,
  type StaticFinding,
} from "../builtin/checker/staticChecks";
import { buildStaticFindingBlocks } from "../builtin/checker/report";
import { LIMITS, type PublishedGameConstant } from "../../../tools-api/index";

const MAPS_DIR = join(REPO_ROOT, "test-maps");
const OUTPUT_PATH = join(REPO_ROOT, "consistency-census.json");

const PLAYER_COUNTS = [2, 4, 6, 8] as const;
type PlayerCount = (typeof PLAYER_COUNTS)[number];
const DRIFT_SEEDS = [1, 2, 3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Corpus population
// ---------------------------------------------------------------------------

/** Top-level `test-maps/*.rms` only — `readdirSync` without `recursive` already excludes `broken/` and `local/`, which is the point (see header trap 1). */
function listTopLevelMaps(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".rms"))
    .map((entry) => entry.name)
    .sort();
}

/** `git ls-files test-maps`, restricted to top-level entries (nested paths like `broken/BCC2-Rekawa.rms` are a different fixture, not one of "the 32" — see header trap 1). Returns null if git is unavailable, so the caller can degrade gracefully rather than crash a reporter over a missing tool. */
function getTrackedTopLevelMaps(): Set<string> | null {
  try {
    const out = execSync("git ls-files test-maps", { cwd: REPO_ROOT, encoding: "utf8" });
    const tracked = new Set<string>();
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/\\/g, "/");
      if (!line.startsWith("test-maps/")) continue;
      const rest = line.slice("test-maps/".length);
      if (rest.length === 0 || rest.includes("/")) continue; // nested path (broken/, local/) — outside this population
      tracked.add(rest);
    }
    return tracked;
  } catch (err) {
    console.warn(`[measure] git ls-files unavailable — tracked-only column will be empty. ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row model: one entry per (map, stage, commandSpan), cells keyed by player count
// ---------------------------------------------------------------------------

type CellState = "ABSENT" | "ZERO" | "RATED";

interface RowCell {
  attempted: number;
  placed: number;
  failures: readonly PlacementFailure[];
}

interface Row {
  map: string;
  stage: string;
  spanKey: string;
  cells: Map<PlayerCount, RowCell>;
}

interface MapReport {
  map: string;
  report: CommandReport;
}

function rowKey(map: string, stage: string, spanKey: string): string {
  return `${map}\u0000${stage}\u0000${spanKey}`;
}

function spanKeyOf(report: CommandReport): string {
  return `${report.commandSpan.start}-${report.commandSpan.end}`;
}

function cellState(cell: RowCell | undefined): CellState {
  if (!cell) return "ABSENT";
  return cell.attempted === 0 ? "ZERO" : "RATED";
}

/** Sums `occurrences ?? 1` per bucket — see the file header's counting-convention note. */
function bucketSums(failures: readonly PlacementFailure[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const failure of failures) {
    sums.set(failure.bucket, (sums.get(failure.bucket) ?? 0) + (failure.occurrences ?? 1));
  }
  return sums;
}

function bucketSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function bucketCountsEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sweep A: 2/4/6/8 players @ seed 1, ONCE — feeds Sections 1, 2, 3, 5, 6
// ---------------------------------------------------------------------------

interface SweepA {
  rows: Map<string, Row>;
  reportsByCount: Map<PlayerCount, MapReport[]>;
  notesByMapAt4p: Map<string, SimulationNote[]>;
  generationErrors: string[];
}

function runSweepA(mapNames: readonly string[], lang: LanguageData, refDb: PreviewReferenceData): SweepA {
  const rows = new Map<string, Row>();
  const reportsByCount = new Map<PlayerCount, MapReport[]>();
  for (const pc of PLAYER_COUNTS) reportsByCount.set(pc, []);
  const notesByMapAt4p = new Map<string, SimulationNote[]>();
  const generationErrors: string[] = [];

  for (const mapName of mapNames) {
    const source = readFileSync(join(MAPS_DIR, mapName), "utf8");
    let parse: ParseResult;
    try {
      parse = parseRms(source, lang);
    } catch (err) {
      generationErrors.push(`${mapName}: parse failed — ${String(err)}`);
      continue;
    }
    for (const pc of PLAYER_COUNTS) {
      let result: PreviewResult;
      try {
        result = generatePreview(
          parse,
          refDb,
          { playerCount: pc, mapSize: "Normal", teams: DEFAULT_TEAMS },
          { seed: 1, collectSnapshots: false },
        );
      } catch (err) {
        generationErrors.push(`${mapName} @ ${pc}p seed 1: generatePreview failed — ${String(err)}`);
        continue;
      }
      const bucket = reportsByCount.get(pc);
      if (bucket) for (const report of result.reports) bucket.push({ map: mapName, report });
      for (const report of result.reports) {
        const key = rowKey(mapName, report.stage, spanKeyOf(report));
        let row = rows.get(key);
        if (!row) {
          row = { map: mapName, stage: report.stage, spanKey: spanKeyOf(report), cells: new Map() };
          rows.set(key, row);
        }
        row.cells.set(pc, { attempted: report.attempted, placed: report.placed, failures: report.failures });
      }
      if (pc === 4) notesByMapAt4p.set(mapName, result.notes);
    }
  }
  return { rows, reportsByCount, notesByMapAt4p, generationErrors };
}

// ---------------------------------------------------------------------------
// Sweep B: 4 players @ seeds 1-5, ONCE — feeds Section 4
// ---------------------------------------------------------------------------

interface SweepB {
  seedSetByKey: Map<string, Set<number>>;
  mapByKey: Map<string, string>;
  generationErrors: string[];
}

function runSweepB(mapNames: readonly string[], lang: LanguageData, refDb: PreviewReferenceData): SweepB {
  const seedSetByKey = new Map<string, Set<number>>();
  const mapByKey = new Map<string, string>();
  const generationErrors: string[] = [];

  for (const mapName of mapNames) {
    const source = readFileSync(join(MAPS_DIR, mapName), "utf8");
    let parse: ParseResult;
    try {
      parse = parseRms(source, lang);
    } catch (err) {
      generationErrors.push(`${mapName}: parse failed — ${String(err)}`);
      continue;
    }
    for (const seed of DRIFT_SEEDS) {
      let result: PreviewResult;
      try {
        result = generatePreview(
          parse,
          refDb,
          { playerCount: 4, mapSize: "Normal", teams: DEFAULT_TEAMS },
          { seed, collectSnapshots: false },
        );
      } catch (err) {
        generationErrors.push(`${mapName} @ 4p seed ${seed}: generatePreview failed — ${String(err)}`);
        continue;
      }
      for (const report of result.reports) {
        const key = rowKey(mapName, report.stage, spanKeyOf(report));
        let seedSet = seedSetByKey.get(key);
        if (!seedSet) {
          seedSet = new Set();
          seedSetByKey.set(key, seedSet);
          mapByKey.set(key, mapName);
        }
        seedSet.add(seed);
      }
    }
  }
  return { seedSetByKey, mapByKey, generationErrors };
}

// ---------------------------------------------------------------------------
// Filters — derive the tracked-only column from already-collected data
// ---------------------------------------------------------------------------

function filterRows(rows: ReadonlyMap<string, Row>, pred: (map: string) => boolean): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const [key, row] of rows) if (pred(row.map)) out.set(key, row);
  return out;
}

function filterReports(reports: readonly MapReport[], pred: (map: string) => boolean): MapReport[] {
  return reports.filter((r) => pred(r.map));
}

function filterNotes(
  notesByMap: ReadonlyMap<string, readonly SimulationNote[]>,
  pred: (map: string) => boolean,
): Map<string, readonly SimulationNote[]> {
  const out = new Map<string, readonly SimulationNote[]>();
  for (const [map, notes] of notesByMap) if (pred(map)) out.set(map, notes);
  return out;
}

function filterSeedData(
  seedSetByKey: ReadonlyMap<string, ReadonlySet<number>>,
  mapByKey: ReadonlyMap<string, string>,
  pred: (map: string) => boolean,
): { seedSetByKey: Map<string, ReadonlySet<number>>; mapByKey: Map<string, string> } {
  const outSeeds = new Map<string, ReadonlySet<number>>();
  const outMap = new Map<string, string>();
  for (const [key, seedSet] of seedSetByKey) {
    const map = mapByKey.get(key);
    if (map !== undefined && pred(map)) {
      outSeeds.set(key, seedSet);
      outMap.set(key, map);
    }
  }
  return { seedSetByKey: outSeeds, mapByKey: outMap };
}

// ---------------------------------------------------------------------------
// Section 1 — zero-attempt census, per player count
// ---------------------------------------------------------------------------

interface Section1Result {
  totalReports: number;
  zeroAttempt: number;
  mapsWithZero: number;
  byStage: Record<string, number>;
  byBucket: Record<string, number>;
  bucketless: number;
}

function computeSection1(reports: readonly MapReport[]): Section1Result {
  const zero = reports.filter((r) => r.report.attempted === 0);
  const mapsWithZero = new Set(zero.map((r) => r.map));
  const byStage = new Map<string, number>();
  const byBucket = new Map<string, number>();
  let bucketless = 0;
  for (const { report } of zero) {
    byStage.set(report.stage, (byStage.get(report.stage) ?? 0) + 1);
    if (report.failures.length === 0) {
      bucketless++;
    } else {
      const bucketsHere = new Set(report.failures.map((f) => f.bucket));
      for (const bucket of bucketsHere) byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
    }
  }
  return {
    totalReports: reports.length,
    zeroAttempt: zero.length,
    mapsWithZero: mapsWithZero.size,
    byStage: Object.fromEntries(byStage),
    byBucket: Object.fromEntries(byBucket),
    bucketless,
  };
}

// ---------------------------------------------------------------------------
// Section 2 — the matrix row census (correct three-state split, plus the naive `?? 0` contrast)
// ---------------------------------------------------------------------------

interface Section2Result {
  totalRows: number;
  zeroEverywhere: number;
  zeroAtSome: number;
  neverZero: number;
  /** Rows absent at some count(s) yet carrying a zero cell at a present one — measured at 0 in every pinned run; printed so a nonzero value here is visible rather than silently folded into `neverZero`. */
  absentZeroAnomaly: number;
  naive: { zeroEverywhere: number; zeroAtSome: number; neverZero: number };
}

function computeSection2(rows: ReadonlyMap<string, Row>): Section2Result {
  let zeroEverywhere = 0;
  let zeroAtSome = 0;
  let neverZero = 0;
  let absentZeroAnomaly = 0;
  let naiveZeroEverywhere = 0;
  let naiveZeroAtSome = 0;
  let naiveNeverZero = 0;

  for (const row of rows.values()) {
    const states = PLAYER_COUNTS.map((pc) => cellState(row.cells.get(pc)));
    const absentCount = states.filter((s) => s === "ABSENT").length;
    const zeroCount = states.filter((s) => s === "ZERO").length;
    const ratedCount = states.filter((s) => s === "RATED").length;

    if (absentCount === 0) {
      if (zeroCount === PLAYER_COUNTS.length) zeroEverywhere++;
      else if (zeroCount > 0 && ratedCount > 0) zeroAtSome++;
      else neverZero++;
    } else if (zeroCount > 0) {
      absentZeroAnomaly++;
      neverZero++;
    } else {
      neverZero++;
    }

    // The naive fold Sec.4.2 forbids: `row.get(pc)?.attempted ?? 0`, treating
    // an absent count as though it had attempted (and failed at) nothing.
    const naiveAttempted = PLAYER_COUNTS.map((pc) => row.cells.get(pc)?.attempted ?? 0);
    if (naiveAttempted.every((a) => a === 0)) naiveZeroEverywhere++;
    else if (naiveAttempted.every((a) => a > 0)) naiveNeverZero++;
    else naiveZeroAtSome++;
  }

  return {
    totalRows: rows.size,
    zeroEverywhere,
    zeroAtSome,
    neverZero,
    absentZeroAnomaly,
    naive: { zeroEverywhere: naiveZeroEverywhere, zeroAtSome: naiveZeroAtSome, neverZero: naiveNeverZero },
  };
}

// ---------------------------------------------------------------------------
// Section 3 — presence census (Sec.4.2's `runsContaining === 0` state)
// ---------------------------------------------------------------------------

interface Section3Result {
  presentAllFour: number;
  partial: number;
  partialRatedEverywhere: number;
  partialWithZeroCell: number;
  patternHistogram: Record<string, number>;
  partialByMap: [string, number][];
}

function computeSection3(rows: ReadonlyMap<string, Row>): Section3Result {
  let presentAllFour = 0;
  let partial = 0;
  let partialRatedEverywhere = 0;
  let partialWithZeroCell = 0;
  const patternHistogram = new Map<string, number>();
  const partialByMap = new Map<string, number>();

  for (const row of rows.values()) {
    const states = PLAYER_COUNTS.map((pc) => cellState(row.cells.get(pc)));
    const absentCount = states.filter((s) => s === "ABSENT").length;
    if (absentCount === 0) {
      presentAllFour++;
      continue;
    }
    partial++;
    const pattern = states.map((s) => (s === "ABSENT" ? "-" : "P")).join("");
    patternHistogram.set(pattern, (patternHistogram.get(pattern) ?? 0) + 1);
    partialByMap.set(row.map, (partialByMap.get(row.map) ?? 0) + 1);
    const present = states.filter((s) => s !== "ABSENT");
    if (present.every((s) => s === "RATED")) partialRatedEverywhere++;
    if (present.some((s) => s === "ZERO")) partialWithZeroCell++;
  }

  return {
    presentAllFour,
    partial,
    partialRatedEverywhere,
    partialWithZeroCell,
    patternHistogram: Object.fromEntries(patternHistogram),
    partialByMap: [...partialByMap.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ---------------------------------------------------------------------------
// Section 4 — within-batch presence drift (4 players, seeds 1-5)
// ---------------------------------------------------------------------------

interface Section4Result {
  totalRows: number;
  inAllFive: number;
  partial: number;
  histogram: Record<number, number>;
  partialByMap: [string, number][];
  mapsAffected: number;
}

function computeSection4(
  seedSetByKey: ReadonlyMap<string, ReadonlySet<number>>,
  mapByKey: ReadonlyMap<string, string>,
): Section4Result {
  const histogram = new Map<number, number>();
  const partialByMap = new Map<string, number>();
  let inAllFive = 0;
  let partial = 0;

  for (const [key, seedSet] of seedSetByKey) {
    const n = seedSet.size;
    histogram.set(n, (histogram.get(n) ?? 0) + 1);
    if (n === DRIFT_SEEDS.length) {
      inAllFive++;
    } else {
      partial++;
      const map = mapByKey.get(key);
      if (map !== undefined) partialByMap.set(map, (partialByMap.get(map) ?? 0) + 1);
    }
  }

  return {
    totalRows: seedSetByKey.size,
    inAllFive,
    partial,
    histogram: Object.fromEntries(histogram),
    partialByMap: [...partialByMap.entries()].sort((a, b) => b[1] - a[1]),
    mapsAffected: partialByMap.size,
  };
}

// ---------------------------------------------------------------------------
// Section 5 — bucket domain (Sec.5.1), corrected three-state worst-count rule
// ---------------------------------------------------------------------------

interface Section5Result {
  numericRateRows: number;
  markerRows: number;
  numericWithFailure: number;
  setDiffers: number;
  countsDiffer: number;
  sumWorstCountFailures: number;
  sumUnionFailures: number;
  unionExceedsAttempted: number;
  exampleKeys: string[];
  /** Occurrence-weighted twin of `sumWorstCountFailures` - the unit the Failure buckets cell renders. */
  sumWorstCountOccurrences: number;
  sumUnionOccurrences: number;
  /** The load-bearing one: does the PRINTED bucket total exceed the `attempted` the printed rate divides by. */
  unionExceedsAttemptedOccurrences: number;
  exampleKeysOccurrences: string[];
}

function computeSection5(rows: ReadonlyMap<string, Row>): Section5Result {
  let numericRateRows = 0;
  let markerRows = 0;
  let numericWithFailure = 0;
  let setDiffers = 0;
  let countsDiffer = 0;
  let sumWorstCountFailures = 0;
  let sumUnionFailures = 0;
  let unionExceedsAttempted = 0;
  const exampleKeys: string[] = [];
  let sumWorstCountOccurrences = 0;
  let sumUnionOccurrences = 0;
  let unionExceedsAttemptedOccurrences = 0;
  const exampleKeysOccurrences: string[] = [];

  for (const row of rows.values()) {
    const present = PLAYER_COUNTS.filter((pc) => row.cells.has(pc));
    const states = present.map((pc) => cellState(row.cells.get(pc)));
    // Absent counts are not ranked at all (excluded via `present`); a
    // zero-attempt count ranks below every rated count, so a row prints a
    // numeric rate only when every PRESENT count is rated.
    const allRated = states.length > 0 && states.every((s) => s === "RATED");
    if (!allRated) {
      markerRows++;
      continue;
    }
    numericRateRows++;

    let worstPc: PlayerCount = present[0];
    let worstRate = Infinity;
    for (const pc of present) {
      const cell = row.cells.get(pc);
      if (!cell) continue;
      const rate = cell.attempted === 0 ? Infinity : cell.placed / cell.attempted;
      if (rate < worstRate) {
        worstRate = rate;
        worstPc = pc; // strict `<` only, so the first (lowest) count wins ties
      }
    }
    const worstCell = row.cells.get(worstPc);
    if (!worstCell) continue;

    // Two DIFFERENT counting conventions live in this one row, and the design
    // doc's own worked example (`13_Rings_v1.2.rms` LOWER_HILLTOPS at
    // `:128660`: "2 failure records at that count and 8 across the matrix")
    // is what pins which is which.
    //
    // `worstBuckets`/`unionBuckets` are OCCURRENCE-WEIGHTED per-bucket sums
    // (`bucketSums`, `occurrences ?? 1`) — the unit the Failure buckets
    // COLUMN itself renders ("occupancyFull x140"), so the set/counts
    // comparison below (does the bucket SET or the per-bucket COUNT differ
    // between the two readings) has to compare in that unit.
    //
    // The headline "summed failures" and "union exceeds attempted" figures
    // are a different unit: a plain count of FAILURE RECORDS (one
    // `PlacementFailure` entry = one bucket that fired on one command at one
    // player count — `pushFailure` coalesces to at most one record per
    // bucket per report, so `failures.length` already IS that count). The
    // worked example's "8 across the matrix" cannot be an occurrence sum —
    // `attempted` is 3 there — so union-record-count sums `failures.length`
    // per present count WITHOUT deduplicating a bucket that recurs across
    // multiple counts, each occurrence at a different count being a genuinely
    // separate record.
    const worstBuckets = bucketSums(worstCell.failures);
    const unionBuckets = new Map<string, number>();
    let unionRecordCount = 0;
    for (const pc of present) {
      const cell = row.cells.get(pc);
      if (!cell) continue;
      unionRecordCount += cell.failures.length;
      for (const [bucket, count] of bucketSums(cell.failures)) {
        unionBuckets.set(bucket, (unionBuckets.get(bucket) ?? 0) + count);
      }
    }
    if (unionBuckets.size === 0) continue; // no failure anywhere in the matrix for this row
    numericWithFailure++;

    if (!bucketSetsEqual(new Set(worstBuckets.keys()), new Set(unionBuckets.keys()))) setDiffers++;
    if (!bucketCountsEqual(worstBuckets, unionBuckets)) countsDiffer++;

    const worstRecordCount = worstCell.failures.length;
    sumWorstCountFailures += worstRecordCount;
    sumUnionFailures += unionRecordCount;

    // The SAME comparison in the unit the Failure buckets cell actually
    // renders. `pushFailure` coalesces by bucket and counts into
    // `occurrences`, so the cell prints "occupancyFull x140" - an occurrence
    // total, never a record total. Sec.5.1's question is whether the printed
    // total can exceed the `attempted` the rate beside it divides by, so the
    // occurrence reading is the load-bearing one and the record reading is
    // kept only because an earlier probe published it.
    let worstOccurrences = 0;
    for (const n of worstBuckets.values()) worstOccurrences += n;
    let unionOccurrences = 0;
    for (const n of unionBuckets.values()) unionOccurrences += n;
    sumWorstCountOccurrences += worstOccurrences;
    sumUnionOccurrences += unionOccurrences;

    if (unionRecordCount > worstCell.attempted) {
      unionExceedsAttempted++;
      if (exampleKeys.length < 5) exampleKeys.push(`${row.map} :: ${row.stage} @ ${row.spanKey}`);
    }
    if (unionOccurrences > worstCell.attempted) {
      unionExceedsAttemptedOccurrences++;
      if (exampleKeysOccurrences.length < 5) {
        exampleKeysOccurrences.push(`${row.map} :: ${row.stage} @ ${row.spanKey} (attempted ${worstCell.attempted}, union ${unionOccurrences})`);
      }
    }
  }

  return {
    numericRateRows,
    markerRows,
    numericWithFailure,
    setDiffers,
    countsDiffer,
    sumWorstCountFailures,
    sumUnionFailures,
    unionExceedsAttempted,
    exampleKeys,
    sumWorstCountOccurrences,
    sumUnionOccurrences,
    unionExceedsAttemptedOccurrences,
    exampleKeysOccurrences,
  };
}

// ---------------------------------------------------------------------------
// Section 6 — note census (Sec.5.4), at 4 players
// ---------------------------------------------------------------------------

interface Section6Result {
  totalGroups: number;
  everyHasSpan: number;
  noneHasSpan: number;
  mixed: number;
  spanlessMapsCount: number;
  spanlessFamilies: Record<string, number>;
  perMapRanking: { map: string; distinctTexts: number; totalNotes: number }[];
}

/** Per-occurrence keys carry their span baked in (e.g. `unsimulated:1234-1240`); run-level keys are a bare topic (`teams`, `includes`). Stripping anything from the first `:` onward recovers the topic either way. */
function familyOf(key: string): string {
  const idx = key.indexOf(":");
  return idx === -1 ? key : key.slice(0, idx);
}

function computeSection6(notesByMap: ReadonlyMap<string, readonly SimulationNote[]>): Section6Result {
  let everyHasSpan = 0;
  let noneHasSpan = 0;
  let mixed = 0;
  const spanlessMaps = new Set<string>();
  const spanlessFamilies = new Map<string, number>();
  let totalGroups = 0;
  const perMapRanking: { map: string; distinctTexts: number; totalNotes: number }[] = [];

  for (const [map, notes] of notesByMap) {
    const byText = new Map<string, SimulationNote[]>();
    for (const note of notes) {
      const group = byText.get(note.text);
      if (group) group.push(note);
      else byText.set(note.text, [note]);
    }
    totalGroups += byText.size;
    for (const groupNotes of byText.values()) {
      const withSpan = groupNotes.filter((n) => n.span !== undefined).length;
      if (withSpan === groupNotes.length) {
        everyHasSpan++;
      } else if (withSpan === 0) {
        noneHasSpan++;
        spanlessMaps.add(map);
        const family = familyOf(groupNotes[0].key);
        spanlessFamilies.set(family, (spanlessFamilies.get(family) ?? 0) + 1);
      } else {
        mixed++;
      }
    }
    perMapRanking.push({ map, distinctTexts: byText.size, totalNotes: notes.length });
  }

  perMapRanking.sort((a, b) => b.distinctTexts - a.distinctTexts);

  return {
    totalGroups,
    everyHasSpan,
    noneHasSpan,
    mixed,
    spanlessMapsCount: spanlessMaps.size,
    spanlessFamilies: Object.fromEntries(spanlessFamilies),
    perMapRanking,
  };
}

// ---------------------------------------------------------------------------
// Section 7 — tie-break census (Sec.5.1): how often "worst" is a minimum
// over more than one player count, and what the Failure buckets cell
// disagrees about across the tied counts. Reuses sweepA's rows — no new
// generation.
// ---------------------------------------------------------------------------

interface Section7Result {
  qualifyingRows: number;
  tiedRows: number;
  tiedWithFailure: number;
  setDiffers: number;
  countsDiffer: number;
}

function computeSection7(rows: ReadonlyMap<string, Row>): Section7Result {
  let qualifyingRows = 0;
  let tiedRows = 0;
  let tiedWithFailure = 0;
  let setDiffers = 0;
  let countsDiffer = 0;

  for (const row of rows.values()) {
    const ratedPcs: PlayerCount[] = [];
    let hasZero = false;
    for (const pc of PLAYER_COUNTS) {
      const state = cellState(row.cells.get(pc));
      if (state === "ZERO") hasZero = true;
      else if (state === "RATED") ratedPcs.push(pc);
    }
    // "Restricted to rows with at least two rated counts and no zero-attempt
    // cell" — the design doc's own domain for this census.
    if (hasZero || ratedPcs.length < 2) continue;
    qualifyingRows++;

    // The minimum rate, found by cross-multiplication rather than float
    // division, so two counts computed from different (placed, attempted)
    // pairs that are mathematically equal never disagree by an epsilon.
    let minPc = ratedPcs[0];
    for (const pc of ratedPcs) {
      const cell = row.cells.get(pc)!;
      const min = row.cells.get(minPc)!;
      if (cell.placed * min.attempted < min.placed * cell.attempted) minPc = pc;
    }
    const min = row.cells.get(minPc)!;
    const tiedPcs = ratedPcs.filter((pc) => {
      const cell = row.cells.get(pc)!;
      return cell.placed * min.attempted === min.placed * cell.attempted;
    });
    if (tiedPcs.length < 2) continue;
    tiedRows++;

    if (tiedPcs.some((pc) => row.cells.get(pc)!.failures.length > 0)) tiedWithFailure++;

    const bucketMapsAtTied = tiedPcs.map((pc) => bucketSums(row.cells.get(pc)!.failures));
    const firstSet = new Set(bucketMapsAtTied[0].keys());
    let setDiffer = false;
    let countDiffer = false;
    for (const m of bucketMapsAtTied.slice(1)) {
      if (!bucketSetsEqual(firstSet, new Set(m.keys()))) setDiffer = true;
      if (!bucketCountsEqual(bucketMapsAtTied[0], m)) countDiffer = true;
    }
    if (setDiffer) setDiffers++;
    if (countDiffer) countsDiffer++;
  }

  return { qualifyingRows, tiedRows, tiedWithFailure, setDiffers, countsDiffer };
}

// ---------------------------------------------------------------------------
// Sections 8/9 — static layer census: the per-map block count against
// `LIMITS.maxBlocksPerOutput` (Sec.4.5), and the per-map unresolvable-
// producer ratio that replaces Sec.3.3 clause 2's interim 1/3 with a
// measurement. Neither runs the Monte Carlo layer — one AST pass per
// selected player count per map, `staticOnly`'s own cost.
// ---------------------------------------------------------------------------

/** `PublishedGameConstant` -> `TerrainConstantForMasks`: the same conversion `staticChecks.ts`'s own (unexported) `asTerrainConstants` performs — duplicated here because this reporter calls `computeTerrainSurface` directly rather than through `runStaticChecks`. */
function asTerrainConstants(constants: readonly PublishedGameConstant[]): readonly TerrainConstantForMasks[] {
  return constants.map((c) => ({ ...c, constId: c.constId ?? null }));
}

interface StaticMapResult {
  map: string;
  blocks: number;
  producersTotal: number;
  producersUnresolvable: number;
  surfaceAbstained: boolean;
}

function runStaticCensus(
  mapNames: readonly string[],
  lang: LanguageData,
  language: LanguageIndex,
  publishedConstants: readonly PublishedGameConstant[],
  terrainConstants: readonly TerrainConstantForMasks[],
): { results: StaticMapResult[]; generationErrors: string[] } {
  const results: StaticMapResult[] = [];
  const generationErrors: string[] = [];

  for (const mapName of mapNames) {
    const source = readFileSync(join(MAPS_DIR, mapName), "utf8");
    let parse: ParseResult;
    try {
      parse = parseRms(source, lang);
    } catch (err) {
      generationErrors.push(`${mapName}: parse failed — ${String(err)}`);
      continue;
    }

    const staticCtx = buildStaticContext(parse);
    const findings: StaticFinding[] = [];
    let ratioInst: InstantiatedScript | undefined;
    try {
      for (const pc of PLAYER_COUNTS) {
        const inst = instantiateScript(parse, language, { playerCount: pc, mapSize: "Normal", teams: DEFAULT_TEAMS }, 1);
        if (pc === 4) ratioInst = inst;
        findings.push(...runStaticChecks(inst, parse, publishedConstants, staticCtx, pc));
      }
    } catch (err) {
      generationErrors.push(`${mapName}: static checks failed — ${String(err)}`);
      continue;
    }
    if (!ratioInst) continue;

    // The same census `runStaticChecks` computes internally for Sec.3.3
    // clause 2, called directly here because the check itself does not
    // expose its producer counts. Pinned at 4 players, matching every other
    // single-count figure in this file (Section 1's own reason: "that is
    // where this document's other figures are taken").
    const census = staticCtx.terrainSurfaceRawAbstain
      ? undefined
      : computeTerrainSurface(parse, ratioInst, terrainConstants, staticCtx.astConsts);
    const producersTotal = census?.producersTotal ?? 0;
    const producersUnresolvable = census?.producersUnresolvable ?? 0;
    const unresolvableRatio = census && census.producersTotal > 0 ? census.producersUnresolvable / census.producersTotal : 0;
    const surfaceAbstained = census === undefined || unresolvableRatio >= UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO;

    // +1 for the `keyValue` summary header every real run of the tool emits
    // first (`buildOutput` in consistencyChecker.ts) — `buildStaticFindingBlocks`
    // covers only the static-finding blocks themselves.
    const blocks = 1 + buildStaticFindingBlocks(findings, [...PLAYER_COUNTS], parse.lineOffsets).length;

    results.push({ map: mapName, blocks, producersTotal, producersUnresolvable, surfaceAbstained });
  }

  return { results, generationErrors };
}

// ---------------------------------------------------------------------------
// Sweep C + Section 10: the presence and drift censuses SWEPT TOGETHER
// (2/4/6/8 players @ seeds 1-5, 20 generations/map) — rev 13's owed item:
// neither sweepA (one seed) nor sweepB (one player count) crosses both axes.
// ---------------------------------------------------------------------------

interface SweepCRow {
  map: string;
  /** Seeds 1-5 that produced this (map, stage, span) at each player count. */
  seedsByCount: Map<PlayerCount, Set<number>>;
}

interface SweepC {
  rows: Map<string, SweepCRow>;
  generationErrors: string[];
}

function runSweepC(mapNames: readonly string[], lang: LanguageData, refDb: PreviewReferenceData): SweepC {
  const rows = new Map<string, SweepCRow>();
  const generationErrors: string[] = [];

  for (const mapName of mapNames) {
    const source = readFileSync(join(MAPS_DIR, mapName), "utf8");
    let parse: ParseResult;
    try {
      parse = parseRms(source, lang);
    } catch (err) {
      generationErrors.push(`${mapName}: parse failed — ${String(err)}`);
      continue;
    }
    for (const pc of PLAYER_COUNTS) {
      for (const seed of DRIFT_SEEDS) {
        let result: PreviewResult;
        try {
          result = generatePreview(parse, refDb, { playerCount: pc, mapSize: "Normal", teams: DEFAULT_TEAMS }, { seed, collectSnapshots: false });
        } catch (err) {
          generationErrors.push(`${mapName} @ ${pc}p seed ${seed}: generatePreview failed — ${String(err)}`);
          continue;
        }
        for (const report of result.reports) {
          const key = rowKey(mapName, report.stage, spanKeyOf(report));
          let row = rows.get(key);
          if (!row) {
            row = { map: mapName, seedsByCount: new Map() };
            rows.set(key, row);
          }
          let seeds = row.seedsByCount.get(pc);
          if (!seeds) {
            seeds = new Set();
            row.seedsByCount.set(pc, seeds);
          }
          seeds.add(seed);
        }
      }
    }
  }
  return { rows, generationErrors };
}

function filterSweepCRows(rows: ReadonlyMap<string, SweepCRow>, pred: (map: string) => boolean): Map<string, SweepCRow> {
  const out = new Map<string, SweepCRow>();
  for (const [key, row] of rows) if (pred(row.map)) out.set(key, row);
  return out;
}

interface Section10Result {
  totalRows: number;
  /** Rows absent (0 of 5 seeds) at at least one player count while present at another — the union-of-seeds analogue of Section 3's `partial`. */
  crossCountAbsent: number;
  /** (row, playerCount) pairs seen in SOME but not all 5 seeds — the union-of-counts analogue of Section 4's `partial`. */
  withinBatchPartial: number;
  /** The control: rows sweepA (seed 1 only) found ABSENT at some count that this 5-seed union finds present there. Pinned at 0 — rev 12's own hypothesis, confirmed negative. */
  flippedFromAbsent: number;
}

function computeSection10(sweepCRows: ReadonlyMap<string, SweepCRow>, sweepARows: ReadonlyMap<string, Row>): Section10Result {
  let crossCountAbsent = 0;
  let withinBatchPartial = 0;
  let flippedFromAbsent = 0;

  for (const [key, row] of sweepCRows) {
    let anyAbsent = false;
    let anyPresent = false;
    for (const pc of PLAYER_COUNTS) {
      const seeds = row.seedsByCount.get(pc);
      const n = seeds?.size ?? 0;
      if (n === 0) anyAbsent = true;
      else {
        anyPresent = true;
        if (n < DRIFT_SEEDS.length) withinBatchPartial++;
      }
    }
    if (anyAbsent && anyPresent) crossCountAbsent++;

    // The control's population is Section 3's own "partial" rows — ones
    // sweepA (seed 1) already saw at SOME player count and marked absent at
    // another — never a row sweepC discovers that sweepA never saw at ANY
    // count. A brand-new row (a `start_random` arm seed 1 never took) is not
    // a count "flipping" from absent to present; it is the reason
    // `totalRows` itself grows 8358 -> 8511, already pinned separately. The
    // first cut of this control conflated the two populations, over-counting
    // by roughly the number of (new row x count) combinations.
    const sweepARow = sweepARows.get(key);
    if (!sweepARow) continue;
    for (const pc of PLAYER_COUNTS) {
      if (cellState(sweepARow.cells.get(pc)) !== "ABSENT") continue;
      const presentInUnion = (row.seedsByCount.get(pc)?.size ?? 0) > 0;
      if (presentInUnion) flippedFromAbsent++;
    }
  }

  return { totalRows: sweepCRows.size, crossCountAbsent, withinBatchPartial, flippedFromAbsent };
}

// ---------------------------------------------------------------------------
// Sweep D + Section 11: the note census at the tool's own DEFAULT run count
// (rev 13's other owed item). One fresh `MonteCarloAggregate` per map, fed
// 2/4/6/8 x 15 seeded generations — the default matrix — under Sec.5.4's
// corrected ordering pipeline (aggregate.ts), which sweepA/sweepB's
// one-generation-per-count model cannot exercise.
// ---------------------------------------------------------------------------

const DEFAULT_RUNS_PER_COUNT = 15;

interface NoteMapResult {
  map: string;
  blocks: number;
  largestTableRows: number;
}

function runNoteCensusAtDefaults(
  mapNames: readonly string[],
  lang: LanguageData,
  refDb: PreviewReferenceData,
): { results: NoteMapResult[]; generationErrors: string[] } {
  const results: NoteMapResult[] = [];
  const generationErrors: string[] = [];

  for (const mapName of mapNames) {
    const source = readFileSync(join(MAPS_DIR, mapName), "utf8");
    let parse: ParseResult;
    try {
      parse = parseRms(source, lang);
    } catch (err) {
      generationErrors.push(`${mapName}: parse failed — ${String(err)}`);
      continue;
    }
    const aggregate = new MonteCarloAggregate();
    aggregate.setSourceLength(source.length);
    for (const pc of PLAYER_COUNTS) {
      for (let runIndex = 0; runIndex < DEFAULT_RUNS_PER_COUNT; runIndex++) {
        const seed = 1 + runIndex;
        let result: PreviewResult;
        try {
          result = generatePreview(parse, refDb, { playerCount: pc, mapSize: "Normal", teams: DEFAULT_TEAMS }, { seed, collectSnapshots: false });
        } catch (err) {
          generationErrors.push(`${mapName} @ ${pc}p seed ${seed}: generatePreview failed — ${String(err)}`);
          continue;
        }
        aggregate.addGeneration(pc, result.reports, result.notes);
      }
    }

    const groups = aggregate.noteGroups();
    // Mirrors `buildNotesBlocks`: one `severity` block per group, plus one
    // `table` when the group carries at least one span.
    const blocks = groups.reduce((sum, g) => sum + 1 + (g.spans.length > 0 ? 1 : 0), 0);
    const largestTableRows = groups.reduce((max, g) => Math.max(max, g.spans.length), 0);
    results.push({ map: mapName, blocks, largestTableRows });
  }

  return { results, generationErrors };
}

// ---------------------------------------------------------------------------
// Pin diffing — reporter, never a gate: record drift, never throw on it
// ---------------------------------------------------------------------------

interface PinEntry {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
  /** True for a `pinMin` entry — printed as "expected >= N" rather than "expected N" on drift. */
  minOnly?: boolean;
}

/**
 * `pinMin` exists for Section 10's population figures specifically. The
 * design doc states its own convention for them: "Sec.8's invariant figures
 * are pinned off this, with `≥`" — these counts are a MEASURED FLOOR over a
 * 5-seed sample, not an exact invariant, so a later run finding MORE
 * qualifying rows/pairs is expected as the corpus's own stochastic surface
 * gets sampled more thoroughly, never a defect. Every other pin in this file
 * is exact by design (Sections 1-9, 11) — `pinMin` is the one place that
 * would be wrong to hold to `===`.
 */
function makePinner(): {
  pin: (label: string, expected: number, actual: number) => void;
  pinMin: (label: string, minExpected: number, actual: number) => void;
  entries: PinEntry[];
} {
  const entries: PinEntry[] = [];
  return {
    pin(label, expected, actual) {
      entries.push({ label, expected, actual, ok: expected === actual });
    },
    pinMin(label, minExpected, actual) {
      entries.push({ label, expected: minExpected, actual, ok: actual >= minExpected, minOnly: true });
    },
    entries,
  };
}

function pinLine(p: PinEntry): string {
  if (p.ok) return `  ok      ${p.label} = ${p.actual}`;
  return p.minOnly
    ? `  DRIFT   ${p.label}: expected >= ${p.expected}, measured ${p.actual}`
    : `  DRIFT   ${p.label}: expected ${p.expected}, measured ${p.actual}`;
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe("Consistency checker corpus census (CREATION_PLAN 5.2, docs/consistency-checker-design.md rev 14)", () => {
  it(
    "sweeps sections 1-6 (2/4/6/8 @ seed 1, 4p @ seeds 1-5), 7 (tie-break, reused), 8/9 (static, no generation), 10 (2/4/6/8 @ seeds 1-5) and 11 (2/4/6/8 @ the default 15 seeds/count), diffs the pinned figures, and writes consistency-census.json",
    () => {
      const lang = loadLanguage();
      const language: LanguageIndex = buildLanguageIndex(lang);
      const rawConstants = JSON.parse(
        readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
      ) as { constants: ObjectConstant[] };
      const refDb: PreviewReferenceData = { language, constants: rawConstants.constants };
      // Sections 8/9 need the richer `PublishedGameConstant` shape (`verified`,
      // `allowedTerrains`, ...) that `runStaticChecks`/`computeTerrainSurface`
      // read — the same JSON, read through the wider generated type rather
      // than the narrower `ObjectConstant` projection `generatePreview` uses.
      const publishedConstants = rawConstants.constants as unknown as PublishedGameConstant[];
      const terrainConstants = asTerrainConstants(publishedConstants);

      const allMaps = listTopLevelMaps(MAPS_DIR);
      const trackedSet = getTrackedTopLevelMaps();
      const trackedPred = (m: string): boolean => trackedSet?.has(m) ?? false;
      const trackedMaps = trackedSet ? allMaps.filter((m) => trackedSet.has(m)) : [];

      const sweepA = runSweepA(allMaps, lang, refDb);
      const sweepB = runSweepB(allMaps, lang, refDb);

      const { pin, pinMin, entries: pins } = makePinner();
      const lines: string[] = [];
      lines.push("===== Consistency checker corpus census =====");
      lines.push(`maps on disk (test-maps/*.rms, top-level): ${allMaps.length}`);
      lines.push(
        trackedSet
          ? `tracked-only maps (git ls-files, top-level): ${trackedMaps.length}`
          : "tracked-only maps: UNAVAILABLE (git ls-files failed) — tracked column will read 0 throughout",
      );
      lines.push(`player counts swept (seed 1): ${PLAYER_COUNTS.join(", ")}`);
      lines.push(`seeds swept at 4 players: ${DRIFT_SEEDS.join(", ")}`);
      if (sweepA.generationErrors.length > 0) {
        lines.push(`sweep A errors (${sweepA.generationErrors.length}):`);
        for (const e of sweepA.generationErrors) lines.push(`  ${e}`);
      }
      if (sweepB.generationErrors.length > 0) {
        lines.push(`sweep B errors (${sweepB.generationErrors.length}):`);
        for (const e of sweepB.generationErrors) lines.push(`  ${e}`);
      }

      // ---- Section 1 ----
      lines.push("\n----- Section 1: zero-attempt census per player count -----");
      const section1All = new Map<PlayerCount, Section1Result>();
      const section1Tracked = new Map<PlayerCount, Section1Result>();
      for (const pc of PLAYER_COUNTS) {
        const allReports = sweepA.reportsByCount.get(pc) ?? [];
        const s1All = computeSection1(allReports);
        const s1Tracked = computeSection1(filterReports(allReports, trackedPred));
        section1All.set(pc, s1All);
        section1Tracked.set(pc, s1Tracked);
        lines.push(
          `@${pc}p ALL: ${s1All.totalReports} reports scanned, ${s1All.zeroAttempt} zero-attempt on ${s1All.mapsWithZero}/${allMaps.length} maps, ${s1All.bucketless} bucketless`,
        );
        lines.push(`  stage split: ${JSON.stringify(s1All.byStage)}`);
        lines.push(`  bucket split: ${JSON.stringify(s1All.byBucket)}`);
        lines.push(
          `@${pc}p TRACKED: ${s1Tracked.totalReports} reports scanned, ${s1Tracked.zeroAttempt} zero-attempt on ${s1Tracked.mapsWithZero}/${trackedMaps.length} maps, ${s1Tracked.bucketless} bucketless`,
        );
      }
      const s1_2p = section1All.get(2);
      const s1_4p = section1All.get(4);
      const s1_6p = section1All.get(6);
      const s1_8p = section1All.get(8);
      if (s1_4p) {
        pin("Sec1 @4p total reports", 8095, s1_4p.totalReports);
        pin("Sec1 @4p zero-attempt", 467, s1_4p.zeroAttempt);
        pin("Sec1 @4p maps with zero-attempt", 30, s1_4p.mapsWithZero);
        pin("Sec1 @4p stage S6", 462, s1_4p.byStage.S6 ?? 0);
        pin("Sec1 @4p stage S5", 4, s1_4p.byStage.S5 ?? 0);
        pin("Sec1 @4p stage S2", 1, s1_4p.byStage.S2 ?? 0);
        pin("Sec1 @4p bucket actorAreaMissing", 242, s1_4p.byBucket.actorAreaMissing ?? 0);
        pin("Sec1 @4p bucket landMissing", 203, s1_4p.byBucket.landMissing ?? 0);
        pin("Sec1 @4p bucket gaiaOnlyRequired", 17, s1_4p.byBucket.gaiaOnlyRequired ?? 0);
        pin("Sec1 @4p bucketless", 5, s1_4p.bucketless);
      }
      if (s1_2p) {
        pin("Sec1 @2p total reports", 8125, s1_2p.totalReports);
        pin("Sec1 @2p zero-attempt", 402, s1_2p.zeroAttempt);
        pin("Sec1 @2p maps with zero-attempt", 29, s1_2p.mapsWithZero);
        pin("Sec1 @2p bucket actorAreaMissing", 251, s1_2p.byBucket.actorAreaMissing ?? 0);
        pin("Sec1 @2p bucket landMissing", 128, s1_2p.byBucket.landMissing ?? 0);
        pin("Sec1 @2p bucket gaiaOnlyRequired", 20, s1_2p.byBucket.gaiaOnlyRequired ?? 0);
        pin("Sec1 @2p bucketless", 3, s1_2p.bucketless);
      }
      if (s1_6p) {
        pin("Sec1 @6p total reports", 8142, s1_6p.totalReports);
        pin("Sec1 @6p zero-attempt", 467, s1_6p.zeroAttempt);
      }
      if (s1_8p) {
        pin("Sec1 @8p total reports", 8161, s1_8p.totalReports);
        pin("Sec1 @8p zero-attempt", 467, s1_8p.zeroAttempt);
      }

      // ---- Section 2 ----
      lines.push("\n----- Section 2: matrix row census (correct rule vs naive `?? 0` contrast) -----");
      const section2All = computeSection2(sweepA.rows);
      const section2Tracked = computeSection2(filterRows(sweepA.rows, trackedPred));
      lines.push(
        `ALL: ${section2All.totalRows} rows keyed; zero-everywhere ${section2All.zeroEverywhere}, zero-at-some ${section2All.zeroAtSome}, never-zero ${section2All.neverZero} (absent+zero anomaly: ${section2All.absentZeroAnomaly})`,
      );
      lines.push(
        `ALL naive fold CONTRAST (absent treated as attempted 0): zero-everywhere ${section2All.naive.zeroEverywhere}, zero-at-some ${section2All.naive.zeroAtSome}, never-zero ${section2All.naive.neverZero}`,
      );
      lines.push(
        `TRACKED: ${section2Tracked.totalRows} rows keyed; zero-everywhere ${section2Tracked.zeroEverywhere}, zero-at-some ${section2Tracked.zeroAtSome}, never-zero ${section2Tracked.neverZero}`,
      );
      pin("Sec2 total rows", 8358, section2All.totalRows);
      pin("Sec2 zero-everywhere", 402, section2All.zeroEverywhere);
      pin("Sec2 zero-at-some", 65, section2All.zeroAtSome);
      pin("Sec2 never-zero", 7891, section2All.neverZero);
      pin("Sec2 naive zero-at-some", 417, section2All.naive.zeroAtSome);
      pin("Sec2 naive never-zero", 7539, section2All.naive.neverZero);

      // ---- Section 3 ----
      lines.push("\n----- Section 3: presence census -----");
      const section3All = computeSection3(sweepA.rows);
      const section3Tracked = computeSection3(filterRows(sweepA.rows, trackedPred));
      lines.push(
        `ALL: present-at-all-four ${section3All.presentAllFour}, partial ${section3All.partial} (rated-everywhere-present ${section3All.partialRatedEverywhere}, carrying a zero cell ${section3All.partialWithZeroCell})`,
      );
      lines.push(`ALL pattern histogram: ${JSON.stringify(section3All.patternHistogram)}`);
      lines.push(`ALL partial rows per map: ${JSON.stringify(section3All.partialByMap)}`);
      lines.push(
        `TRACKED: present-at-all-four ${section3Tracked.presentAllFour}, partial ${section3Tracked.partial} (rated-everywhere-present ${section3Tracked.partialRatedEverywhere}, carrying a zero cell ${section3Tracked.partialWithZeroCell})`,
      );
      pin("Sec3 present at all four", 8006, section3All.presentAllFour);
      pin("Sec3 partial", 352, section3All.partial);
      pin("Sec3 partial rated everywhere present", 352, section3All.partialRatedEverywhere);
      pin("Sec3 partial carrying a zero cell", 0, section3All.partialWithZeroCell);
      const patternPins: [string, number][] = [
        ["--P-", 86],
        ["P---", 85],
        ["---P", 71],
        ["PP-P", 34],
        ["-PPP", 29],
        ["-P--", 26],
        ["--PP", 21],
      ];
      for (const [pattern, expected] of patternPins) {
        pin(`Sec3 pattern ${pattern}`, expected, section3All.patternHistogram[pattern] ?? 0);
      }
      const partialByMapAll = Object.fromEntries(section3All.partialByMap);
      const partialByMapPins: [string, number][] = [
        ["Menindee_AUS_v2.3.rms", 86],
        ["TL Cape of Storms.rms", 78],
        ["OWWC1Tewaipounamu-edited-v1.2.rms", 68],
        ["AK_Namatjira.rms", 54],
        ["TL Black Forest.rms", 20],
        ["TL Frontline.rms", 20],
        ["24hr_Blind Valley.rms", 12],
        ["W4 - Immersion.rms", 7],
        ["AK_Hourglass_v2.0.rms", 4],
        ["AK_Six_Points_v1.4.rms", 2],
        ["24hr_Battle Lines 1.0.rms", 1],
      ];
      for (const [map, expected] of partialByMapPins) {
        pin(`Sec3 partial rows on ${map}`, expected, partialByMapAll[map] ?? 0);
      }

      // ---- Section 4 (sweep B) ----
      lines.push("\n----- Section 4: within-batch presence drift (4p, seeds 1-5) -----");
      const section4All = computeSection4(sweepB.seedSetByKey, sweepB.mapByKey);
      const filteredB = filterSeedData(sweepB.seedSetByKey, sweepB.mapByKey, trackedPred);
      const section4Tracked = computeSection4(filteredB.seedSetByKey, filteredB.mapByKey);
      lines.push(
        `ALL: ${section4All.totalRows} rows keyed; in all 5 runs ${section4All.inAllFive}, partial ${section4All.partial}, maps affected ${section4All.mapsAffected}/${allMaps.length}`,
      );
      lines.push(`ALL histogram (runsContaining -> row count): ${JSON.stringify(section4All.histogram)}`);
      lines.push(`ALL partial rows per map: ${JSON.stringify(section4All.partialByMap)}`);
      lines.push(
        `TRACKED: ${section4Tracked.totalRows} rows keyed; in all 5 runs ${section4Tracked.inAllFive}, partial ${section4Tracked.partial}, maps affected ${section4Tracked.mapsAffected}/${trackedMaps.length}`,
      );
      pin("Sec4 total rows", 8231, section4All.totalRows);
      pin("Sec4 in all five runs", 8024, section4All.inAllFive);
      pin("Sec4 partial", 207, section4All.partial);
      pin("Sec4 histogram[1]", 142, section4All.histogram[1] ?? 0);
      pin("Sec4 histogram[2]", 23, section4All.histogram[2] ?? 0);
      pin("Sec4 histogram[3]", 6, section4All.histogram[3] ?? 0);
      pin("Sec4 histogram[4]", 36, section4All.histogram[4] ?? 0);
      pin("Sec4 histogram[5]", 8024, section4All.histogram[5] ?? 0);
      pin("Sec4 maps affected", 11, section4All.mapsAffected);

      // ---- Section 5 ----
      lines.push("\n----- Section 5: bucket domain under the corrected three-state worst-count rule -----");
      const section5All = computeSection5(sweepA.rows);
      const section5Tracked = computeSection5(filterRows(sweepA.rows, trackedPred));
      lines.push(
        `ALL: numeric-rate rows ${section5All.numericRateRows}, marker rows ${section5All.markerRows} (of ${section2All.totalRows} total)`,
      );
      lines.push(
        `ALL: of the numeric-rate rows, ${section5All.numericWithFailure} carry a failure anywhere; set differs ${section5All.setDiffers}, counts differ ${section5All.countsDiffer}`,
      );
      lines.push(
        `ALL [RECORDS]: summed failure records — worst-count-only ${section5All.sumWorstCountFailures} vs matrix-union ${section5All.sumUnionFailures}; union exceeds worst-count attempted on ${section5All.unionExceedsAttempted} rows`,
        `ALL [OCCURRENCES — the unit the cell prints, and the load-bearing one]: summed occurrences — worst-count-only ${section5All.sumWorstCountOccurrences} vs matrix-union ${section5All.sumUnionOccurrences}; union exceeds worst-count attempted on ${section5All.unionExceedsAttemptedOccurrences} rows`,
        `ALL occurrence examples: ${section5All.exampleKeysOccurrences.join(" | ")}`,
      );
      lines.push(`ALL example union-exceeds-attempted keys: ${section5All.exampleKeys.join(" | ")}`);
      lines.push(
        `TRACKED: numeric-rate rows ${section5Tracked.numericRateRows}, marker rows ${section5Tracked.markerRows}; numeric-with-failure ${section5Tracked.numericWithFailure}, union exceeds attempted on ${section5Tracked.unionExceedsAttempted} rows`,
      );
      pin("Sec5 numeric-rate rows", 7891, section5All.numericRateRows);
      pin("Sec5 marker rows", 467, section5All.markerRows);
      pin("Sec5 numeric rows with a failure", 2498, section5All.numericWithFailure);
      pin("Sec5 bucket set differs", 191, section5All.setDiffers);
      pin("Sec5 bucket counts differ", 2306, section5All.countsDiffer);
      pin("Sec5 union exceeds worst-count attempted [records]", 462, section5All.unionExceedsAttempted);
      pin("Sec5 union exceeds worst-count attempted [OCCURRENCES]", 803, section5All.unionExceedsAttemptedOccurrences);
      pin("Sec5 summed worst-count occurrences", 2026194, section5All.sumWorstCountOccurrences);
      pin("Sec5 summed matrix-union occurrences", 8105519, section5All.sumUnionOccurrences);
      pin("Sec5 summed worst-count failures", 2833, section5All.sumWorstCountFailures);
      pin("Sec5 summed matrix-union failures", 10647, section5All.sumUnionFailures);
      if (section2All.neverZero !== section5All.numericRateRows) {
        lines.push(
          `INTERNAL CHECK FAILED: Sec2 never-zero (${section2All.neverZero}) should equal Sec5 numeric-rate rows (${section5All.numericRateRows}) — same predicate, computed twice.`,
        );
      }

      // ---- Section 6 ----
      lines.push("\n----- Section 6: note census (4 players) -----");
      const section6All = computeSection6(sweepA.notesByMapAt4p);
      const section6Tracked = computeSection6(filterNotes(sweepA.notesByMapAt4p, trackedPred));
      lines.push(
        `ALL: ${section6All.totalGroups} same-text groups; every-note-has-span ${section6All.everyHasSpan}, spanless ${section6All.noneHasSpan} on ${section6All.spanlessMapsCount} maps, mixed ${section6All.mixed}`,
      );
      lines.push(`ALL spanless families: ${JSON.stringify(section6All.spanlessFamilies)}`);
      lines.push(
        `ALL distinct-text ranking (top 10): ${section6All.perMapRanking
          .slice(0, 10)
          .map((r) => `${r.map} ${r.distinctTexts} texts / ${r.totalNotes} notes`)
          .join("; ")}`,
      );
      lines.push(
        `TRACKED: ${section6Tracked.totalGroups} same-text groups; spanless ${section6Tracked.noneHasSpan} on ${section6Tracked.spanlessMapsCount} maps, mixed ${section6Tracked.mixed}`,
      );
      pin("Sec6 same-text groups", 338, section6All.totalGroups);
      pin("Sec6 spanless groups", 29, section6All.noneHasSpan);
      pin("Sec6 spanless maps", 24, section6All.spanlessMapsCount);
      pin("Sec6 mixed groups", 0, section6All.mixed);
      pin("Sec6 family automaticBeach", 18, section6All.spanlessFamilies.automaticBeach ?? 0);
      pin("Sec6 family includes", 6, section6All.spanlessFamilies.includes ?? 0);
      pin("Sec6 family landOverwrittenBeforeGrowth", 4, section6All.spanlessFamilies.landOverwrittenBeforeGrowth ?? 0);
      pin("Sec6 family teams", 1, section6All.spanlessFamilies.teams ?? 0);
      const distinctTextPins: [string, number, number][] = [
        ["24hr_Petra.rms", 30, 99],
        ["AK_Namatjira.rms", 24, 138],
        ["24hr_Caverns.rms", 23, 105],
        ["AD4 - Pag - v1.2.rms", 23, 48],
        ["Chaotic_Straitv0.99.rms", 21, 83],
        ["QS_Three_Bays_v1.1.rms", 17, 132],
      ];
      for (const [map, expectedTexts, expectedNotes] of distinctTextPins) {
        const entry = section6All.perMapRanking.find((r) => r.map === map);
        pin(`Sec6 ${map} distinct texts`, expectedTexts, entry?.distinctTexts ?? -1);
        pin(`Sec6 ${map} total notes`, expectedNotes, entry?.totalNotes ?? -1);
      }

      // ---- Section 7 ----
      lines.push("\n----- Section 7: tie-break census (Sec.5.1's 'worst' as a minimum over usually more than one count) -----");
      const section7All = computeSection7(sweepA.rows);
      const section7Tracked = computeSection7(filterRows(sweepA.rows, trackedPred));
      lines.push(
        `ALL: ${section7All.qualifyingRows} rows with >=2 rated counts and no zero-attempt cell; ${section7All.tiedRows} tied at the minimum (${section7All.tiedWithFailure} carry a failure at a tied count); bucket set differs on ${section7All.setDiffers}, counts differ on ${section7All.countsDiffer}`,
      );
      lines.push(
        `TRACKED: ${section7Tracked.qualifyingRows} qualifying; ${section7Tracked.tiedRows} tied; set differs ${section7Tracked.setDiffers}, counts differ ${section7Tracked.countsDiffer}`,
      );
      pin("Sec7 qualifying rows", 7623, section7All.qualifyingRows);
      pin("Sec7 tied at minimum", 7313, section7All.tiedRows);
      pin("Sec7 tied at minimum (tracked)", 2041, section7Tracked.tiedRows);
      pin("Sec7 tied rows carrying a failure", 2022, section7All.tiedWithFailure);
      pin("Sec7 bucket set differs among tied counts", 146, section7All.setDiffers);
      pin("Sec7 bucket set differs (tracked)", 10, section7Tracked.setDiffers);
      pin("Sec7 bucket counts differ among tied counts", 250, section7All.countsDiffer);
      pin("Sec7 bucket counts differ (tracked)", 29, section7Tracked.countsDiffer);

      // ---- Sections 8/9 (static census — no generation) ----
      lines.push("\n----- Section 8: static block count per map vs LIMITS.maxBlocksPerOutput -----");
      const staticCensus = runStaticCensus(allMaps, lang, language, publishedConstants, terrainConstants);
      const staticResultsTracked = staticCensus.results.filter((r) => trackedPred(r.map));
      const overCapAll = staticCensus.results.filter((r) => r.blocks > LIMITS.maxBlocksPerOutput).length;
      const staticRanking = [...staticCensus.results].sort((a, b) => b.blocks - a.blocks);
      if (staticCensus.generationErrors.length > 0) {
        lines.push(`static census errors (${staticCensus.generationErrors.length}):`);
        for (const e of staticCensus.generationErrors) lines.push(`  ${e}`);
      }
      lines.push(
        `ALL: ${staticCensus.results.length} maps checked; block-count ranking (top 5): ${staticRanking
          .slice(0, 5)
          .map((r) => `${r.map} ${r.blocks}`)
          .join("; ")}; ${overCapAll} of ${staticCensus.results.length} exceed maxBlocksPerOutput (${LIMITS.maxBlocksPerOutput})`,
      );
      lines.push(`TRACKED: ${staticResultsTracked.length} maps checked`);
      const paSiteStatic = staticCensus.results.find((r) => r.map === "Pa_Site_v1.1.rms");
      if (paSiteStatic) pin("Sec8 Pa_Site static blocks", 6, paSiteStatic.blocks);
      pin("Sec8 maps exceeding maxBlocksPerOutput", 0, overCapAll);

      lines.push("\n----- Section 9: per-map unresolvable-producer ratio (Sec.3.3 clause 2, replacing the interim 1/3) -----");
      const abstainingAll = staticCensus.results.filter((r) => r.surfaceAbstained);
      const battleLines = staticCensus.results.find((r) => r.map === "24hr_Battle Lines 1.0.rms");
      const blackForest = staticCensus.results.find((r) => r.map === "TL Black Forest.rms");
      const grandBara = staticCensus.results.find((r) => r.map === "TL Grand Bara.rms");
      lines.push(
        `ALL: ${abstainingAll.length}/${staticCensus.results.length} maps abstain (ratio >= ${UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO.toFixed(3)})`,
      );
      lines.push(
        `  anchors — ${battleLines ? `${battleLines.map} ${battleLines.producersUnresolvable}/${battleLines.producersTotal}` : "not found"}; ${blackForest ? `${blackForest.map} ${blackForest.producersUnresolvable}/${blackForest.producersTotal}` : "not found"}; ${grandBara ? `${grandBara.map} ${grandBara.producersUnresolvable}/${grandBara.producersTotal}` : "not found"}`,
      );
      pin("Sec9 abstaining maps", 3, abstainingAll.length);
      if (battleLines) pin("Sec9 24hr_Battle Lines unresolvable producers", 29, battleLines.producersUnresolvable);
      if (battleLines) pin("Sec9 24hr_Battle Lines total producers", 40, battleLines.producersTotal);
      if (blackForest) pin("Sec9 TL Black Forest unresolvable producers", 48, blackForest.producersUnresolvable);
      if (blackForest) pin("Sec9 TL Black Forest total producers", 89, blackForest.producersTotal);
      if (grandBara) pin("Sec9 TL Grand Bara unresolvable producers", 1, grandBara.producersUnresolvable);
      if (grandBara) pin("Sec9 TL Grand Bara total producers", 12, grandBara.producersTotal);

      // ---- Section 10 (sweep C) ----
      lines.push("\n----- Section 10: presence and drift, swept together (2/4/6/8 x seeds 1-5) -----");
      const sweepC = runSweepC(allMaps, lang, refDb);
      const section10All = computeSection10(sweepC.rows, sweepA.rows);
      const filteredCRows = filterSweepCRows(sweepC.rows, trackedPred);
      const filteredASweepRows = filterRows(sweepA.rows, trackedPred);
      const section10Tracked = computeSection10(filteredCRows, filteredASweepRows);
      if (sweepC.generationErrors.length > 0) {
        lines.push(`sweep C errors (${sweepC.generationErrors.length}):`);
        for (const e of sweepC.generationErrors) lines.push(`  ${e}`);
      }
      lines.push(
        `ALL: ${section10All.totalRows} rows keyed (union of 5 seeds); absent at some count ${section10All.crossCountAbsent}; within-batch partial (row,count) pairs ${section10All.withinBatchPartial}; flipped from seed-1-absent to union-present ${section10All.flippedFromAbsent}`,
      );
      lines.push(
        `TRACKED: ${section10Tracked.totalRows} rows keyed; absent at some count ${section10Tracked.crossCountAbsent}; within-batch partial pairs ${section10Tracked.withinBatchPartial}`,
      );
      pin("Sec10 total rows (union of 5 seeds)", 8511, section10All.totalRows);
      pin("Sec10 absent at some count", 373, section10All.crossCountAbsent);
      pin("Sec10 absent at some count (tracked)", 149, section10Tracked.crossCountAbsent);
      // `pinMin` per the design doc's own convention for these figures — a
      // measured floor over the 5-seed sample, not an exact invariant (see
      // `makePinner`'s doc comment).
      pinMin("Sec10 within-batch partial pairs", 240, section10All.withinBatchPartial);
      pinMin("Sec10 within-batch partial pairs (tracked)", 145, section10Tracked.withinBatchPartial);
      pin("Sec10 flipped from seed-1-absent to union-present (control)", 0, section10All.flippedFromAbsent);

      // ---- Section 11 (sweep D) ----
      lines.push("\n----- Section 11: note census at the DEFAULT run count (2/4/6/8 x 15 seeds/map) -----");
      const noteCensus = runNoteCensusAtDefaults(allMaps, lang, refDb);
      const noteResultsTracked = noteCensus.results.filter((r) => trackedPred(r.map));
      const noteRanking = [...noteCensus.results].sort((a, b) => b.blocks - a.blocks);
      if (noteCensus.generationErrors.length > 0) {
        lines.push(`note census errors (${noteCensus.generationErrors.length}):`);
        for (const e of noteCensus.generationErrors) lines.push(`  ${e}`);
      }
      lines.push(
        `ALL note-block ranking (top 5): ${noteRanking
          .slice(0, 5)
          .map((r) => `${r.map} ${r.blocks}`)
          .join("; ")}`,
      );
      lines.push(`TRACKED maps checked: ${noteResultsTracked.length}`);
      const petra = noteCensus.results.find((r) => r.map === "24hr_Petra.rms");
      const namatjira = noteCensus.results.find((r) => r.map === "AK_Namatjira.rms");
      const paSiteNotes = noteCensus.results.find((r) => r.map === "Pa_Site_v1.1.rms");
      if (petra) pin("Sec11 24hr_Petra note blocks", 65, petra.blocks);
      if (namatjira) pin("Sec11 AK_Namatjira note blocks", 58, namatjira.blocks);
      if (namatjira) pin("Sec11 AK_Namatjira largest table rows", 77, namatjira.largestTableRows);
      if (paSiteNotes) pin("Sec11 Pa_Site largest table rows", 134, paSiteNotes.largestTableRows);

      // ---- Pin summary ----
      const driftCount = pins.filter((p) => !p.ok).length;
      lines.push(`\n----- Pinned-figure diff (${pins.length} checks) -----`);
      for (const p of pins) lines.push(pinLine(p));
      lines.push(`\n${driftCount === 0 ? "ALL PINNED FIGURES REPRODUCE" : `DRIFT COUNT: ${driftCount} of ${pins.length}`}`);

      console.log(lines.join("\n"));

      const fullReport = {
        generatedAt: new Date().toISOString(),
        mapsOnDisk: allMaps.length,
        mapsTracked: trackedSet ? trackedMaps.length : null,
        gitAvailable: trackedSet !== null,
        playerCounts: PLAYER_COUNTS,
        driftSeeds: DRIFT_SEEDS,
        generationErrors: {
          sweepA: sweepA.generationErrors,
          sweepB: sweepB.generationErrors,
          staticCensus: staticCensus.generationErrors,
          sweepC: sweepC.generationErrors,
          noteCensus: noteCensus.generationErrors,
        },
        section1: {
          all: Object.fromEntries(section1All),
          tracked: Object.fromEntries(section1Tracked),
        },
        section2: { all: section2All, tracked: section2Tracked },
        section3: { all: section3All, tracked: section3Tracked },
        section4: { all: section4All, tracked: section4Tracked },
        section5: { all: section5All, tracked: section5Tracked },
        section6: { all: section6All, tracked: section6Tracked },
        section7: { all: section7All, tracked: section7Tracked },
        section8: { all: staticCensus.results, tracked: staticResultsTracked, overCapAll },
        section9: { all: abstainingAll.map((r) => r.map), totalMapsAll: staticCensus.results.length },
        section10: { all: section10All, tracked: section10Tracked },
        section11: { all: noteCensus.results, tracked: noteResultsTracked },
        pins,
        driftCount,
      };
      writeFileSync(OUTPUT_PATH, JSON.stringify(fullReport, null, 2), "utf8");

      // Reporter, not a gate: this suite must never fail on drift. The
      // assertions below are a sanity floor only — proof the harness actually
      // ran and produced the checks it claims to, never a verdict on whether
      // the corpus matches history (that verdict is the printed drift count,
      // read by a person).
      expect(allMaps.length).toBeGreaterThan(0);
      expect(pins.length).toBe(116);
    },
    172_800_000,
  );
});
