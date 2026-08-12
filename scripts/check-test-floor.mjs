#!/usr/bin/env node
// Runs the Vitest suite and fails if it silently ran less of it than expected.
//
// WHY THIS EXISTS (CLAUDE.md tracked debt, observed 2026-08-01). A run under
// machine load reported:
//
//     Test Files  9 passed (9)
//     Tests      61 passed (61)
//     Errors      7 errors
//
// and **exited 0**. Seven test files failed to load, 367 of 428 tests never
// executed, and the exit code — the thing CI branches on — said green. A clean
// re-run on identical code gave the full suite. So a zero exit from Vitest is
// not by itself evidence that the suite ran, and every "npm test passes" claim
// in this project rests on a number nobody was checking.
//
// The floors below are a FLOOR, not an equality check: adding tests never fails
// this, removing or silently skipping them does. Raise them when the suite
// grows (the script prints a nudge when you are well above the floor).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// THE FLOOR MUST PASS ON A FRESH CLONE, and how much of the suite a clone even
// has to run is DECIDED BY THE CORPUS ON DISK. So the test floor is computed
// from the corpus rather than written down (2026-08-11).
//
// It used to be two constants — one for a clone, one for a maintainer with
// `test-maps/local/` mounted — and both were wrong, because the measurement
// behind them assumed all 32 top-level maps were tracked. Eleven are. The
// other 21 are gitignored exactly like `local/` is, so CI ran ~1061 tests
// against a floor of 1250 and could never have gone green; the failure read as
// a skipped suite, which is the one thing this guard exists to distinguish.
//
// The coefficients below are exact minima, not averages, measured out of a
// full JSON report on 2026-08-11 (43 files / 1387 tests, everything mounted):
// every test that walks the corpus names its map in its own title, so each
// map's contribution is countable. Top-level maps contributed 11-19 tests
// each, `local/` maps 4-8. Taking the minimum of each range makes this a floor
// in the same sense the totals are: adding maps or tests never fails it.
const TESTS_PER_CORPUS_MAP = 11;
const TESTS_PER_LOCAL_MAP = 4;
// Everything not attributable to a corpus map, including `broken/`, which is
// tracked and therefore always present. 1387 - 399 (32 top-level maps) - 84
// (19 local maps) = 904.
// Raised 904 -> 911 on 2026-08-13: bugReport.test.ts added 7 tests that touch
// no corpus map, so they belong in the base rather than in either coefficient.
const BASE_TESTS = 911;

// File count does NOT depend on the corpus — a gitignored map removes tests,
// never a test file — so this one stays a written-down number. 44 files live
// (2026-08-11), minus the four `*.measure.test.ts` scratch harnesses, which
// exist to print a corpus census and are legitimate to delete: a guard that
// goes red when someone removes a scratch harness is a guard that gets
// switched off. Raise it deliberately as suites land.
// 46 files live (2026-08-13), minus the same four scratch harnesses, so 42.
const MIN_FILES = 42;

const MAPS_DIR = join(process.cwd(), "test-maps");
const LOCAL_CORPUS_DIR = join(MAPS_DIR, "local");

function countRms(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"),
  ).length;
}
// Nudge to raise the floors once the suite has grown past them by this much.
// Sized so it is SILENT at the moment the floors are set and speaks only after
// real growth: a nudge that fires on the day you set the number is a nudge
// people learn to scroll past, which is how the floor got 900 tests stale.
const NUDGE_SLACK = 120;
const NUDGE_FILE_SLACK = 6;

const passthrough = process.argv.slice(2);
const isFiltered = passthrough.length > 0;

// A filtered run (`npm test src/parser`) legitimately executes a fraction of
// the suite, so the floor cannot apply — check it only on a full run.
if (isFiltered) {
  const { status } = spawnSync("npx", ["vitest", "run", ...passthrough], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(status ?? 1);
}

const reportPath = join(tmpdir(), `aoe2rms-test-report-${process.pid}.json`);

const { status } = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${reportPath}`,
  ],
  { stdio: "inherit", shell: true },
);

if (!existsSync(reportPath)) {
  console.error(
    "\n✗ test floor: Vitest produced no JSON report — the run did not complete. Treat as a failed run.",
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
rmSync(reportPath, { force: true });

// `numTotalTestSuites` counts DESCRIBE BLOCKS, not files — a single file with
// three describes reports 3. The file count is testResults.length. Getting this
// wrong makes the guard pass on a partial run, which is the one thing it exists
// to catch.
const files = report.testResults.length;
const tests = report.numTotalTests;

const corpusMaps = countRms(MAPS_DIR);
const localMaps = countRms(LOCAL_CORPUS_DIR);
const minTests =
  BASE_TESTS + corpusMaps * TESTS_PER_CORPUS_MAP + localMaps * TESTS_PER_LOCAL_MAP;

const problems = [];
if (status !== 0) problems.push(`Vitest exited ${status}`);
if (files < MIN_FILES) problems.push(`only ${files} test files ran, expected at least ${MIN_FILES}`);
if (tests < minTests) problems.push(`only ${tests} tests ran, expected at least ${minTests}`);

if (problems.length > 0) {
  console.error(`\n✗ test floor FAILED — ${problems.join("; ")}.`);
  console.error(
    "  A partial run can still exit 0 (see this script's header). Re-run before investigating:\n" +
      "  the 2026-08-01 case was load-dependent and a clean re-run passed on identical code.",
  );
  console.error(
    `  The test floor is computed from the corpus on disk: ${corpusMaps} maps in test-maps/ and\n` +
      `  ${localMaps} in test-maps/local/. If a map was ADDED without its tests running, that is the\n` +
      "  shortfall and not a skipped suite.",
  );
  process.exit(1);
}

const corpusNote = `${corpusMaps} maps + ${localMaps} local`;
console.log(`\n✓ test floor: ${files} files / ${tests} tests (floor ${MIN_FILES}/${minTests}, ${corpusNote})`);
if (files >= MIN_FILES + NUDGE_FILE_SLACK || tests >= minTests + NUDGE_SLACK) {
  console.log(`  Suite has grown — consider raising the floors in ${"scripts/check-test-floor.mjs"}.`);
}
