// The name liveness measurement (docs/name-liveness-design.md Sec.9, slices A and B).
// Run with `npm run measure:liveness`, its own vitest config, kept out of
// `npm test` because it analyses 243 scripts and reads DE's include files.
//
// It runs every script the way the parser worker does. The options come from
// src/editor/includeCache.ts, never built by hand, so the measurement covers
// the code the app runs. The corpus half (test-maps/*.rms and
// test-maps/local/*.rms) always runs. DE's own maps and the include files come
// from a local install, found as includeResolution.measure.test.ts finds it,
// and that half is skipped with a printed note when none is found.
//
// Slice B runs the whole report (livenessDiagnostics, with the default node
// cap), the code the parser worker runs. Every script is reported on twice and
// the second run's time is kept, so the first run's cold start (JIT warm-up,
// empty memo tables) does not count.
//
// It also holds the VERDICT LISTS. Every RMS0320 the corpus produces was read
// and judged, and a warning that appears which the list lacks, or one in the
// list that disappears, fails the run. The RMS0322 list is a sample read by
// hand (the brief asked for at least 20 across at least 10 files), so only a
// disappearance fails there.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import gameConstantsRaw from "../../../../reference/data/game-constants.json";
import { parseRms } from "../../parser";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../../validate";
import { includePathsInText } from "../../includeIndex";
import {
  emptyIncludeState,
  indexFor,
  parseOptionsFor,
  receiveIncludes,
  type IncludeState,
} from "../../../editor/includeCache";
import { loadIncludeFiles } from "../../../preview/generator/includes";
import {
  DIRECT_INSTALL_CANDIDATES,
  STEAM_ROOT_CANDIDATES,
  gamedataFolderIn,
  installFolderIn,
} from "../../../settings/scriptFolder";
import { lineNumberOfOffset } from "../../lineIndex";
import type { Diagnostic } from "../../types";
import { loadLanguage, REPO_ROOT } from "../../__tests__/testUtils";
import { livenessDiagnostics, type LivenessReport } from "../report";

const lang = loadLanguage();
const constants = (gameConstantsRaw as unknown as GameConstantsForValidate)
  .constants;
const COMMENT_OPEN_ALIASES = commentOpenAliases(constants);
const COMMENT_CLOSE_ALIASES = commentCloseAliases(constants);
const BUILTIN_CONSTANTS = builtinConstantNames(constants);

const GAMEDATA = [
  ...(process.env.AOE2DE_DIR ? [process.env.AOE2DE_DIR] : []),
  ...STEAM_ROOT_CANDIDATES.map(installFolderIn),
  ...DIRECT_INSTALL_CANDIDATES,
]
  .map(gamedataFolderIn)
  .find((dir) => existsSync(dir));

interface Script {
  origin: "test-maps" | "local" | "de";
  file: string;
  text: string;
}

function rmsIn(dir: string, origin: Script["origin"]): Script[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".rms"))
    .sort()
    .map((file) => ({
      origin,
      file,
      text: readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n"),
    }));
}

const scripts: Script[] = [
  ...rmsIn(join(REPO_ROOT, "test-maps"), "test-maps"),
  ...rmsIn(join(REPO_ROOT, "test-maps", "local"), "local"),
  ...(GAMEDATA === undefined ? [] : rmsIn(GAMEDATA, "de")),
];

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const num = (s: string | number, n: number): string => String(s).padStart(n);

/** One pinned finding and what reading it showed. */
interface Verdict {
  file: string;
  line: number;
  /** RMS0320: the text marked (the token). RMS0322: the branch keyword text. */
  what: string;
  verdict: "true positive" | "false positive";
  why: string;
}

/** Every RMS0320 on the 243 scripts. See the build log for how each was read. */
const PINNED_RMS0320: Verdict[] = [];

const TP = "true positive" as const;

/**
 * A sample of the RMS0322 marks, read by hand on 2026-11-04 against the source
 * of each script and, where a name comes from an include file, that file. All
 * 23 are true positives. The shapes they fall into:
 *
 * - A start_random whose first arms already reach 99 (Blind Valley 100/0/0,
 *   Scandanavia 100/0, Arabia 70/30/30, TL Cape of Storms 45/54/1), so a later
 *   arm's #define never happens and a test of that name never runs.
 * - A chain that already covers every case (Venn tests all 14 sizes then has
 *   an else, Eruption always defines THEME_MEDI or THEME_COLD, Rage Forest's
 *   FRONT_POND and SIDE_POND are 60 and 40).
 * - DE's GeneratingObjects.inc defines DEATH_MATCH whenever INFINITE_RESOURCES
 *   is, so an `elseif INFINITE_RESOURCES` after `elseif DEATH_MATCH` is dead.
 * - A test nested inside a branch whose own condition rules it out.
 */
const PINNED_RMS0322: Verdict[] = [
  {
    file: "24hr_Blind Valley.rms",
    line: 39,
    what: "if WINTER_MAP",
    verdict: TP,
    why: "The roll block is 100, 0, 0, so WINTER_MAP is never defined.",
  },
  {
    file: "Scandanavia.rms",
    line: 105,
    what: "elseif VERTICAL_MAP",
    verdict: TP,
    why: "HORIZONTAL_MAP takes 100 and VERTICAL_MAP 0.",
  },
  {
    file: "Arabia.rms",
    line: 180,
    what: "elseif RND_SPAWN_FOREST_EXCESSIVE",
    verdict: TP,
    why: "Arms of 70, 30 and 30. The third starts after the total reached 100, so it is never taken. A real slip in a DE script.",
  },
  {
    file: "Sandrift.rms",
    line: 3055,
    what: "if INVALID_FOREST",
    verdict: TP,
    why: "INDEPENDENT_FOREST is defined above in that scope, so the else that defines INVALID_FOREST never runs.",
  },
  {
    file: "TL Cape of Storms.rms",
    line: 812,
    what: "elseif TSUNAMI",
    verdict: TP,
    why: "Arms of 45, 54 and 1. The first two reach 99, which covers every roll, so TSUNAMI is never defined.",
  },
  {
    file: "Wolf_Hill.rms",
    line: 357,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "GeneratingObjects.inc defines DEATH_MATCH under INFINITE_RESOURCES, and the chain tests DEATH_MATCH first.",
  },
  {
    file: "Serengeti.rms",
    line: 674,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Crater.rms",
    line: 401,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Ravines.rms",
    line: 215,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Sardis.rms",
    line: 262,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Socotra.rms",
    line: 816,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Sandbank.rms",
    line: 266,
    what: "elseif INFINITE_RESOURCES",
    verdict: TP,
    why: "The same DEATH_MATCH chain as Wolf_Hill.",
  },
  {
    file: "Eruption.rms",
    line: 521,
    what: "elseif THEME_AUTUMN_COLD",
    verdict: TP,
    why: "The top of the script defines THEME_MEDI or THEME_COLD in an if and else, and both are tested earlier in the chain.",
  },
  {
    file: "Venn.rms",
    line: 48,
    what: "else",
    verdict: TP,
    why: "The chain tests every map size the lobby offers.",
  },
  {
    file: "Rage Forest 2026.rms",
    line: 846,
    what: "elseif BACK_POND",
    verdict: TP,
    why: "FRONT_POND is 60 and SIDE_POND is 40, so one is always defined.",
  },
  {
    file: "BR_FallofRome.rms",
    line: 1364,
    what: "elseif BR_CENTRAL_48",
    verdict: TP,
    why: "The size chain defines one of BR_CENTRAL_20, 22, 24, 28 and 33 for every size, and all are tested earlier.",
  },
  {
    file: "special_map_snakepit.rms",
    line: 289,
    what: "elseif PH_ASIAN",
    verdict: TP,
    why: "Arms of 30, 20 and 50 define PH_TROPHICALSOUTH, PH_TROPHICALEAST or PH_AFRICAN, all tested earlier.",
  },
  {
    file: "TL Grand Bara.rms",
    line: 218,
    what: "elseif SIX_C",
    verdict: TP,
    why: "TWO_A and TWO_B are the only two arms of an exhaustive roll, so a later SIX_ branch is left over from another version.",
  },
  {
    file: "Dorothea Quarry.rms",
    line: 128,
    what: "if MAPSIZE_BELOW_SMALL",
    verdict: TP,
    why: "helpers.inc defines MAPSIZE_ABOVE_TINY from Small up and MAPSIZE_BELOW_SMALL only for Mini and Tiny, and this test sits inside the first.",
  },
  {
    file: "Wade.rms",
    line: 8715,
    what: "elseif LUDIKRIS_MAP",
    verdict: TP,
    why: "It sits in the else of an earlier test for LUDIKRIS_MAP.",
  },
  {
    file: "real_world_bohemia.rms",
    line: 268,
    what: "if REGICIDE",
    verdict: TP,
    why: "Inside `if EMPIRE_WARS`, and a lobby has one game mode.",
  },
  {
    file: "Serengeti.rms",
    line: 728,
    what: "if EMPIRE_WARS",
    verdict: TP,
    why: "Inside the else of an earlier chain that already tested EMPIRE_WARS.",
  },
  {
    file: "The_Passage.rms",
    line: 6356,
    what: "if NOMAD_START",
    verdict: TP,
    why: "NOMAD_START is only defined under NOMAD_MAP, and this test sits inside a branch that needs not NOMAD_MAP.",
  },
];

/** The brief's stop triggers (slice B brief Sec.4), with margin over B2's figures. */
const THRESHOLDS = { finishMs: 1000, overflowMs: 1500, maxRms0321: 500 };

describe("name liveness measurement (slice B)", () => {
  it("reports on every script", async () => {
    if (GAMEDATA === undefined)
      console.log(
        "[liveness] no DE install found, so DE's maps and the include files are skipped",
      );

    const refDb: ValidateReferenceDb = {
      language: lang,
      gameConstants: gameConstantsRaw as unknown as GameConstantsForValidate,
    };
    let state: IncludeState = emptyIncludeState((text) =>
      parseRms(text, lang, {
        commentOpenAliases: COMMENT_OPEN_ALIASES,
        commentCloseAliases: COMMENT_CLOSE_ALIASES,
        builtinConstants: BUILTIN_CONSTANTS,
      }),
    );

    interface Row {
      script: Script;
      report: LivenessReport;
      parse: ReturnType<typeof parseRms>;
      ms: number;
    }
    const rows: Row[] = [];

    for (const script of scripts) {
      const roots = includePathsInText(script.text);
      if (roots.length > 0) {
        if (GAMEDATA === undefined) {
          state = receiveIncludes(state, null, [], state.parse);
        } else {
          const requested = new Set<string>();
          const files = await loadIncludeFiles(
            roots,
            async (key) => {
              const full = join(GAMEDATA, key);
              return existsSync(full)
                ? readFileSync(full, "utf8").replace(/\r\n/g, "\n")
                : undefined;
            },
            requested,
          );
          state = receiveIncludes(state, files, [...requested], state.parse);
        }
      } else if (GAMEDATA !== undefined) {
        state = receiveIncludes(state, new Map(), [], state.parse);
      }
      const options = parseOptionsFor(state, script.text);
      const parse = parseRms(script.text, lang, {
        commentOpenAliases: COMMENT_OPEN_ALIASES,
        commentCloseAliases: COMMENT_CLOSE_ALIASES,
        builtinConstants: BUILTIN_CONSTANTS,
        ...options,
      });
      // The diagnostics the worker passes in as `existing`, built the way it builds them.
      const semantic = validate(parse, refDb, {
        resolvedIncludes: indexFor(state, parse),
      });
      const cache = state.cache;
      const input = {
        parse,
        language: lang,
        builtinConstants: BUILTIN_CONSTANTS,
        includeParse: (key: string) => cache.get(key)?.parse,
        includesUnread: options.includesUnread,
        existing: [...parse.diagnostics, ...semantic] as Diagnostic[],
      };
      livenessDiagnostics(input); // cold run, discarded
      const started = performance.now();
      const report = livenessDiagnostics(input);
      rows.push({ script, report, parse, ms: performance.now() - started });
    }

    const count = (r: Row, code: string) =>
      r.report.diagnostics.filter((d) => d.code === code).length;
    const lineOf = (r: Row, d: Diagnostic) =>
      lineNumberOfOffset(r.parse.lineOffsets, d.span.start);
    const textOf = (r: Row, d: Diagnostic) =>
      r.parse.source.slice(d.span.start, d.span.end).replace(/\s+/g, " ");

    console.log(
      `\n${pad("script", 40)} ${pad("status", 10)} ${num("0320", 5)} ${num("0321", 5)} ${num("0322", 5)} ${num("0323", 5)} ${num("ms", 7)}`,
    );
    const total = {
      scripts: 0,
      complete: 0,
      incomplete: 0,
      overflow: 0,
      RMS0320: 0,
      RMS0321: 0,
      RMS0322: 0,
      RMS0323: 0,
    };
    for (const r of rows) {
      total.scripts++;
      total[r.report.status]++;
      for (const code of ["RMS0320", "RMS0321", "RMS0322", "RMS0323"] as const)
        total[code] += count(r, code);
      console.log(
        `${pad(`${r.script.origin}/${r.script.file}`.slice(0, 40), 40)} ${pad(r.report.status, 10)} ${num(count(r, "RMS0320"), 5)} ${num(count(r, "RMS0321"), 5)} ${num(count(r, "RMS0322"), 5)} ${num(count(r, "RMS0323"), 5)} ${num(r.ms.toFixed(1), 7)}`,
      );
    }
    console.log("\nTOTALS", JSON.stringify(total));

    const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5);
    console.log(
      "\nSLOWEST FIVE\n" +
        slowest
          .map(
            (r) =>
              `  ${r.script.file}  ${r.ms.toFixed(1)} ms (${r.report.status})`,
          )
          .join("\n"),
    );
    const mostMaybe = [...rows]
      .map((r) => ({ file: r.script.file, n: count(r, "RMS0321") }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
    console.log(
      "\nMOST RMS0321\n" +
        mostMaybe.map((m) => `  ${m.file}  ${m.n}`).join("\n"),
    );
    console.log("\nOVERFLOW");
    for (const r of rows)
      if (r.report.status === "overflow")
        console.log(`  ${r.script.file}  gave up after ${r.ms.toFixed(0)} ms`);

    // Every RMS0320 and RMS0322, with the text marked and the message.
    console.log("\nRMS0320");
    for (const r of rows)
      for (const d of r.report.diagnostics)
        if (d.code === "RMS0320")
          console.log(
            `  ${r.script.file}:${lineOf(r, d)}  [${textOf(r, d)}]  ${d.message}`,
          );
    console.log("\nRMS0322");
    for (const r of rows)
      for (const d of r.report.diagnostics)
        if (d.code === "RMS0322")
          console.log(
            `  ${r.script.file}:${lineOf(r, d)}  [${textOf(r, d)}]  ${d.message}`,
          );

    // The stop triggers of the slice B brief, Sec.4.
    const triggers: string[] = [];
    for (const r of rows) {
      if (r.report.status === "complete" && r.ms > THRESHOLDS.finishMs)
        triggers.push(`${r.script.file} finished in ${r.ms.toFixed(0)} ms`);
      if (r.report.status === "overflow" && r.ms > THRESHOLDS.overflowMs)
        triggers.push(`${r.script.file} took ${r.ms.toFixed(0)} ms to give up`);
      if (count(r, "RMS0321") > THRESHOLDS.maxRms0321)
        triggers.push(`${r.script.file} has ${count(r, "RMS0321")} RMS0321`);
    }
    console.log(
      "\nSTOP TRIGGERS\n" +
        (triggers.length === 0
          ? "  none"
          : triggers.map((t) => `  ${t}`).join("\n")),
    );

    // The pinned verdicts. The key is file, line and the text marked.
    const found = (code: string) =>
      new Set(
        rows.flatMap((r) =>
          r.report.diagnostics
            .filter((d) => d.code === code)
            .map((d) => `${r.script.file}:${lineOf(r, d)}:${textOf(r, d)}`),
        ),
      );
    const key = (v: Verdict) => `${v.file}:${v.line}:${v.what}`;
    const have320 = found("RMS0320");
    const have322 = found("RMS0322");
    const pinned320 = new Set(PINNED_RMS0320.map(key));
    const problems: string[] = [];
    // A finding the list lacks is always a failure. A pinned finding that is
    // gone is one only when DE's maps were read, since without an install the
    // DE half of the list cannot be seen.
    for (const k of have320)
      if (!pinned320.has(k)) problems.push(`unpinned RMS0320 ${k}`);
    if (GAMEDATA !== undefined) {
      for (const k of pinned320)
        if (!have320.has(k)) problems.push(`pinned RMS0320 gone ${k}`);
      for (const v of PINNED_RMS0322)
        if (!have322.has(key(v)))
          problems.push(`pinned RMS0322 gone ${key(v)}`);
    }
    if (problems.length > 0)
      throw new Error("verdict lists no longer match:\n" + problems.join("\n"));
  }, 172_800_000);
});
