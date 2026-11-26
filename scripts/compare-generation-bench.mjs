// Compares records of the preview generation benchmark
// (perf/generation-bench.jsonl, written by `npm run bench:preview`).
//
//   npm run bench:compare                 the last record against the one before
//   npm run bench:compare -- 0.11.0       the last record against the record labelled 0.11.0
//   npm run bench:compare -- 0.11.0 0.12.0   two records by label (or commit)
//   npm run bench:compare -- --history    every record, one column per record
//
// Times are shown raw and calibrated. The calibrated figure scales a record's
// times by how fast the machine ran its fixed workload, against the older
// record's, so a run on a busy or throttled laptop does not read as a
// regression. It is a correction, not a cure: compare runs made in similar
// conditions where possible, and re-run before trusting a change under 15%.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "perf", "generation-bench.jsonl");
if (!existsSync(file)) {
  console.error(
    `No benchmark history at ${file}. Run npm run bench:preview first.`,
  );
  process.exit(1);
}
const records = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

const name = (r) =>
  `${r.label ?? r.commit}${r.dirty && !r.label ? "+" : ""} (${r.date.slice(0, 10)})`;
const find = (key) => {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.label === key || r.commit === key) return r;
  }
  console.error(`No record labelled or committed as "${key}".`);
  process.exit(1);
};
/** A change shown as a signed percentage, marked when it is large. */
const change = (before, after) => {
  const pct = ((after - before) / before) * 100;
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return pct >= 15 ? `${text} SLOWER` : pct <= -15 ? `${text} faster` : text;
};
const ms = (n) => (n === undefined ? "-" : `${Math.round(n)}`);

const args = process.argv.slice(2);

if (args[0] === "--history") {
  const maps = [...new Set(records.flatMap((r) => Object.keys(r.maps)))];
  const base = records[0].calibrationMs;
  console.log(
    "Calibrated ms (each record scaled to the first record's machine speed)\n",
  );
  console.log(
    ["map".padEnd(26), ...records.map((r) => name(r).padStart(28))].join(""),
  );
  for (const map of maps)
    console.log(
      [
        map.replace(/\.rms$/, "").padEnd(26),
        ...records.map((r) =>
          ms(
            r.maps[map]?.ms === undefined
              ? undefined
              : (r.maps[map].ms * base) / r.calibrationMs,
          ).padStart(28),
        ),
      ].join(""),
    );
  process.exit(0);
}

if (records.length < 2 && args.length === 0) {
  console.error("Only one record so far. Run the benchmark again to compare.");
  process.exit(1);
}
const before = args.length >= 1 ? find(args[0]) : records[records.length - 2];
const after = args.length >= 2 ? find(args[1]) : records[records.length - 1];
if (before.settings !== after.settings)
  console.warn(
    `Warning: the two records ran different settings ("${before.settings}" and "${after.settings}").`,
  );
const scale = before.calibrationMs / after.calibrationMs;
console.log(`Before: ${name(before)}, calibration ${before.calibrationMs} ms`);
console.log(`After:  ${name(after)}, calibration ${after.calibrationMs} ms`);
console.log(
  `After's times are scaled by ${scale.toFixed(2)} for the calibrated column.\n`,
);
console.log(
  [
    "map".padEnd(26),
    "before".padStart(8),
    "after".padStart(8),
    "raw".padStart(14),
    "calibrated".padStart(18),
  ].join(""),
);
for (const map of Object.keys(after.maps)) {
  const b = before.maps[map];
  const a = after.maps[map];
  if (b === undefined) continue;
  console.log(
    [
      map.replace(/\.rms$/, "").padEnd(26),
      ms(b.ms).padStart(8),
      ms(a.ms).padStart(8),
      change(b.ms, a.ms).padStart(14),
      change(b.ms, a.ms * scale).padStart(18),
    ].join(""),
  );
  // Section by section, when both records have them, for the maps that moved.
  if (b.sections && a.sections && Math.abs(a.ms * scale - b.ms) / b.ms >= 0.15)
    for (const stage of Object.keys(a.sections)) {
      const bs = b.sections[stage];
      const as = a.sections[stage];
      if (bs === undefined || Math.max(bs, as) < 20) continue;
      console.log(
        [
          `  ${stage}`.padEnd(26),
          ms(bs).padStart(8),
          ms(as).padStart(8),
          "".padStart(14),
          change(bs, as * scale).padStart(18),
        ].join(""),
      );
    }
}
