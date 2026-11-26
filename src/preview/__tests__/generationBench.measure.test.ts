// The preview generation benchmark (`npm run bench:preview`), kept out of
// `npm test` by vitest.config.ts's `exclude`. It times `generatePreview` on a
// fixed set of maps at fixed settings and appends one record to
// `perf/generation-bench.jsonl`, so a slowdown can be traced to the commit
// that brought it (`npm run bench:compare` prints the difference).
//
// Two things make the numbers comparable across weeks on one laptop.
//
// 1. A calibration workload timed in the same run. This machine has shown the
//    same suite run anywhere from 1x to 3.7x slower under load or on battery,
//    so a raw millisecond figure measures the machine as much as the code.
//    The workload is plain arithmetic and sorting that no app code touches,
//    and `bench:compare` divides each map's time by it.
// 2. The median of several seeds, which keeps one unlucky seed (a map that
//    retries a land placement, say) from reading as a regression.
//
// It imports only what every version since 0.11.0 exports with the same
// shape, so the same file can be copied into an old commit's worktree and run
// there. That is how the first records of the history were made. Settings an
// old generator does not know are ignored by it at runtime.
//
// Environment, all optional:
//   BENCH_MAPS   folder of the maps (default this repo's test-maps), so an old
//                worktree can read today's maps
//   BENCH_OUT    the history file to append to
//   BENCH_LABEL  a name for the record, such as "0.11.0"
//   BENCH_ONLY   comma separated map names, to time a subset

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview } from "../generator/index";

/**
 * The maps timed. All are tracked in git, so a clone can run the benchmark,
 * none needs DE's include files, and between them they cover a land heavy
 * map (Bulls_Eyes), the heaviest object stage (Namatjira, Vanguard), water
 * and connections (Chaotic Strait, Menindee) and many small lands (13 Rings).
 */
const MAPS = [
  "AK_Namatjira.rms",
  "AK_Vanguard_v1.2.rms",
  "AK_Hourglass_v2.0.rms",
  "Chaotic_Straitv0.99.rms",
  "Menindee_AUS_v2.3.rms",
  "13_Rings_v1.2.rms",
  "Bulls_Eyes.rms",
  "Comeer v1.5.rms",
];

/** Fixed settings. Changing any of these starts a new series: see `SETTINGS_ID`. */
const SEEDS = [1, 2, 3];
const PLAYERS = 8;
const MAP_SIZE = "Normal";
/** Written into every record, so the compare script never sets two series side by side. */
const SETTINGS_ID = `seeds ${SEEDS.join("/")}, ${PLAYERS} players, ${MAP_SIZE}`;

/**
 * A fixed CPU workload: integer mixing and a sort, around 150 to 300 ms on
 * this laptop. Its time is the run's yardstick for how fast the machine was
 * going, and nothing in the app can change it.
 */
function calibrate(): number {
  const once = () => {
    const start = performance.now();
    const values = new Float64Array(1_500_000);
    let x = 12345;
    for (let i = 0; i < values.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) | 0;
      values[i] = x;
    }
    values.sort();
    return performance.now() - start;
  };
  once(); // warm up the JIT
  return median([once(), once(), once()]);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readJson<T>(path: string): T | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as T)
    : undefined;
}

function gitState(): { commit: string; dirty: boolean } {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT })
      .toString()
      .trim();
    const dirty =
      execSync("git status --porcelain -- src reference", { cwd: REPO_ROOT })
        .toString()
        .trim() !== "";
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

interface MapRecord {
  /** Median whole generation over the seeds, parse excluded. */
  ms: number;
  /** Each seed's time, in seed order. */
  runs: number[];
  /** Median per section, when the generator records sections (0.12.0 on). */
  sections?: Record<string, number>;
}

describe("preview generation benchmark", () => {
  it("times every map and appends a record", () => {
    const lang = loadLanguage();
    const language = buildLanguageIndex(lang);
    const data = join(REPO_ROOT, "reference", "data");
    const constants = readJson<{ constants: unknown[] }>(
      join(data, "game-constants.json"),
    )!.constants;
    // Absent before the object stage was made DE-exact (0.12.0), and the
    // older generator then uses its own object stage.
    const objectData = readJson<unknown>(join(data, "object-data.json"));
    const refDb = { language, constants, objectData } as Parameters<
      typeof generatePreview
    >[1];
    const settings = {
      playerCount: PLAYERS,
      mapSize: MAP_SIZE,
      teams: [1, 2, 1, 2, 1, 2, 1, 2],
      teamPositions: true,
    } as unknown as Parameters<typeof generatePreview>[2];

    const mapsDir = process.env.BENCH_MAPS ?? join(REPO_ROOT, "test-maps");
    const only = process.env.BENCH_ONLY?.split(",").map((s) => s.trim());
    const maps = MAPS.filter((m) => !only || only.some((o) => m.includes(o)));

    const calibrationBefore = calibrate();
    const record: Record<string, MapRecord> = {};
    for (const name of maps) {
      const path = join(mapsDir, name);
      if (!existsSync(path)) continue;
      const parse = parseRms(
        readFileSync(path, "utf8").replace(/\r\n/g, "\n"),
        lang,
      );
      // One untimed run first, so the JIT has compiled the generator before
      // the first timed seed, which would otherwise carry the warm up.
      generatePreview(parse, refDb, settings, {
        seed: 99,
        collectSnapshots: false,
      });
      const runs: number[] = [];
      const sectionRuns = new Map<string, number[]>();
      for (const seed of SEEDS) {
        const start = performance.now();
        const result = generatePreview(parse, refDb, settings, {
          seed,
          collectSnapshots: false,
          timing: true,
        } as Parameters<typeof generatePreview>[3]);
        runs.push(performance.now() - start);
        const timing = (
          result as {
            timing?: { sections: { stage: string; ms: number }[] };
          }
        ).timing;
        for (const s of timing?.sections ?? [])
          sectionRuns.set(s.stage, [...(sectionRuns.get(s.stage) ?? []), s.ms]);
      }
      const round = (n: number) => Math.round(n * 10) / 10;
      record[name] = {
        ms: round(median(runs)),
        runs: runs.map(round),
        ...(sectionRuns.size > 0 && {
          sections: Object.fromEntries(
            [...sectionRuns].map(([k, v]) => [k, round(median(v))]),
          ),
        }),
      };
      console.log(
        `${name.padEnd(28)} ${record[name].ms.toFixed(0).padStart(6)} ms`,
      );
    }
    // Calibrated before and after, since load can change during a run that
    // takes a minute or two. The compare script reads the mean.
    const calibrationAfter = calibrate();

    const out =
      process.env.BENCH_OUT ??
      join(REPO_ROOT, "perf", "generation-bench.jsonl");
    mkdirSync(dirname(out), { recursive: true });
    const line = {
      date: new Date().toISOString(),
      label: process.env.BENCH_LABEL ?? null,
      ...gitState(),
      settings: SETTINGS_ID,
      node: process.version,
      cpu: cpus()[0]?.model ?? "unknown",
      calibrationMs:
        Math.round(((calibrationBefore + calibrationAfter) / 2) * 10) / 10,
      calibrationSpread: [calibrationBefore, calibrationAfter].map(
        (n) => Math.round(n * 10) / 10,
      ),
      maps: record,
    };
    appendFileSync(out, JSON.stringify(line) + "\n");
    console.log(`appended to ${out}`);
  });
});
