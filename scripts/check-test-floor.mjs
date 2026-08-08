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
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Live: 19 files / 446 tests (2026-08-05, after BUG-003's four parser
// assertions and `rms0201.measure.test.ts`). Floor sits below live on purpose:
// there are now TWO self-described scratch harnesses that may be deleted
// (`rms0200.measure.test.ts`, `rms0201.measure.test.ts`), which would take live
// to 17/444, and a guard that goes red when someone removes a scratch harness
// is a guard that gets switched off.
const MIN_FILES = 17;
const MIN_TESTS = 442;
// Nudge to raise the floors once the suite has grown past it by this much.
const NUDGE_SLACK = 25;

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

const problems = [];
if (status !== 0) problems.push(`Vitest exited ${status}`);
if (files < MIN_FILES) problems.push(`only ${files} test files ran, expected at least ${MIN_FILES}`);
if (tests < MIN_TESTS) problems.push(`only ${tests} tests ran, expected at least ${MIN_TESTS}`);

if (problems.length > 0) {
  console.error(`\n✗ test floor FAILED — ${problems.join("; ")}.`);
  console.error(
    "  A partial run can still exit 0 (see this script's header). Re-run before investigating:\n" +
      "  the 2026-08-01 case was load-dependent and a clean re-run passed on identical code.",
  );
  process.exit(1);
}

console.log(`\n✓ test floor: ${files} files / ${tests} tests (floor ${MIN_FILES}/${MIN_TESTS})`);
if (files >= MIN_FILES + 2 || tests >= MIN_TESTS + NUDGE_SLACK) {
  console.log(`  Suite has grown — consider raising the floors in ${"scripts/check-test-floor.mjs"}.`);
}
