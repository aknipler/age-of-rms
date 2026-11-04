// The name liveness measurement (docs/name-liveness-design.md Sec.9, slice A).
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
// Every script is analysed twice and the second run's time is kept, so the
// first run's cold start (JIT warm-up, empty memo tables) does not count.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import gameConstantsRaw from "../../../../reference/data/game-constants.json";
import { parseRms } from "../../parser";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  type GameConstantsForValidate,
} from "../../validate";
import { includePathsInText } from "../../includeIndex";
import {
  emptyIncludeState,
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
import type { ParseResult } from "../../types";
import { loadLanguage, REPO_ROOT } from "../../__tests__/testUtils";
import { analyseLiveness, type LivenessResult } from "../analyse";
import { AtomTable, sizeKeys } from "../atoms";
import { Bdd } from "../bdd";
import { describeCondition } from "../describe";
import { walkLiveness } from "../walk";

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

describe("name liveness measurement (slice A)", () => {
  it("analyses every script", async () => {
    if (GAMEDATA === undefined)
      console.log(
        "[liveness] no DE install found, so DE's maps and the include files are skipped",
      );

    let state: IncludeState = emptyIncludeState((text) =>
      parseRms(text, lang, {
        commentOpenAliases: COMMENT_OPEN_ALIASES,
        commentCloseAliases: COMMENT_CLOSE_ALIASES,
        builtinConstants: BUILTIN_CONSTANTS,
      }),
    );

    interface Row {
      script: Script;
      result: LivenessResult;
      parse: ReturnType<typeof parseRms>;
      /** This script's include parses. `state` is replaced per script, so the Map is kept by reference. */
      includeParse: (key: string) => ParseResult | undefined;
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
      const cache = state.cache;
      const includeParse = (key: string) => cache.get(key)?.parse;
      const input = {
        parse,
        language: lang,
        builtinConstants: BUILTIN_CONSTANTS,
        includeParse,
        includesUnread: options.includesUnread,
      };
      analyseLiveness(input); // cold run, discarded
      const result = analyseLiveness(input);
      rows.push({ script, result, parse, includeParse });
    }

    // One line per script.
    console.log(
      `\n${pad("script", 40)} ${pad("status", 10)} ${num("live", 6)} ${num("dead", 5)} ${num("maybe", 6)} ${num("contra", 6)} ${num("switch", 6)} ${num("nodes", 7)} ${num("ms", 7)}`,
    );
    const total = {
      scripts: 0,
      complete: 0,
      incomplete: 0,
      overflow: 0,
      live: 0,
      dead: 0,
      maybe: 0,
      contradiction: 0,
      switchCase: 0,
    };
    for (const { script, result } of rows) {
      const count = (v: string) =>
        result.uses.filter((u) => u.verdict === v).length;
      const contra = result.deadBranches.filter(
        (b) => b.kind === "contradiction",
      ).length;
      const sw = result.deadBranches.length - contra;
      total.scripts++;
      total[result.status]++;
      total.live += count("live");
      total.dead += count("dead");
      total.maybe += count("maybe");
      total.contradiction += contra;
      total.switchCase += sw;
      console.log(
        `${pad(`${script.origin}/${script.file}`.slice(0, 40), 40)} ${pad(result.status, 10)} ${num(count("live"), 6)} ${num(count("dead"), 5)} ${num(count("maybe"), 6)} ${num(contra, 6)} ${num(sw, 6)} ${num(result.nodeCount, 7)} ${num(result.ms.toFixed(1), 7)}`,
      );
    }
    console.log("\nTOTALS", JSON.stringify(total));

    const complete = rows.filter((r) => r.result.status === "complete");
    const slowest = [...rows]
      .sort((a, b) => b.result.ms - a.result.ms)
      .slice(0, 5);
    console.log(
      "\nSLOWEST FIVE\n" +
        slowest
          .map(
            (r) =>
              `  ${r.script.file}  ${r.result.ms.toFixed(1)} ms (${r.result.status})`,
          )
          .join("\n"),
    );
    const mostMaybe = [...complete]
      .map((r) => ({
        file: r.script.file,
        n: r.result.uses.filter((u) => u.verdict === "maybe").length,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
    console.log(
      "\nMOST MAYBE USES\n" +
        mostMaybe.map((m) => `  ${m.file}  ${m.n}`).join("\n"),
    );

    // Every dead use, with the condition its definitions hold under. The
    // condition is rebuilt from a fresh walk, since the result keeps verdicts
    // and not nodes.
    console.log("\nDEAD USES");
    for (const { script, result, parse, includeParse } of complete) {
      const dead = result.uses.filter((u) => u.verdict === "dead");
      if (dead.length === 0) continue;
      const bdd = new Bdd();
      const labels = lang.predefinedLabels ?? [];
      const atoms = new AtomTable(
        bdd,
        labels,
        lang.labelGroups ?? [],
        sizeKeys(labels),
      );
      const walk = walkLiveness(bdd, atoms, {
        parse,
        language: lang,
        builtinConstants: BUILTIN_CONSTANTS,
        includeParse,
        includesUnread: false,
      });
      const byToken = new Map(
        walk.uses.map((u) => [`${u.token}:${u.name}`, u]),
      );
      for (const u of dead) {
        const line = lineNumberOfOffset(
          parse.lineOffsets,
          parse.tokens[u.token].start,
        );
        const w = byToken.get(`${u.token}:${u.name}`);
        const cond = w
          ? describeCondition(bdd, w.def, (v) => atoms.atomName(v))
          : "?";
        console.log(
          `  ${script.file}:${line}  ${u.name}  defined when ${cond}`,
        );
      }
    }

    console.log("\nCONTRADICTION BRANCHES");
    for (const { script, result, parse } of complete)
      for (const b of result.deadBranches)
        if (b.kind === "contradiction")
          console.log(
            `  ${script.file}:${lineNumberOfOffset(parse.lineOffsets, parse.tokens[b.keywordToken].start)}`,
          );
  }, 172_800_000);
});
