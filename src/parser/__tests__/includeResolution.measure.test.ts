// The include resolution corpus gate (docs/include-resolution-design.md Sec.5,
// slice B). Run with `npm run measure:includes`, its own vitest config, kept
// out of `npm test` because it parses and validates 243 scripts and reads
// 600 K characters of DE's include files.
//
// It runs every script the way the parser worker does. The options come from
// src/editor/includeCache.ts (`receiveIncludes`, `parseOptionsFor`,
// `indexFor`), never built by hand, so the gate tests the code the app runs.
//
// The corpus half (test-maps/*.rms and test-maps/local/*.rms) always runs.
// DE's own 180 maps and the include files come from a local install, found
// the way deWholeScriptMaps.test.ts finds it (`AOE2DE_DIR` names one the usual
// places miss), and that half is skipped with a printed note when none is
// found.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import { parseRms } from "../parser";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../validate";
import { includePathsInText } from "../includeIndex";
import {
  emptyIncludeState,
  indexFor,
  parseOptionsFor,
  receiveIncludes,
  type IncludeState,
} from "../../editor/includeCache";
import { loadIncludeFiles } from "../../preview/generator/includes";
import {
  DIRECT_INSTALL_CANDIDATES,
  STEAM_ROOT_CANDIDATES,
  gamedataFolderIn,
  installFolderIn,
} from "../../settings/scriptFolder";
import type { Diagnostic, ParseResult } from "../types";
import { lineNumberOfOffset } from "../lineIndex";
import { loadLanguage, REPO_ROOT } from "./testUtils";

const lang = loadLanguage();
const constants = (gameConstantsRaw as unknown as GameConstantsForValidate)
  .constants;
const refDb: ValidateReferenceDb = {
  language: lang,
  gameConstants: gameConstantsRaw as unknown as GameConstantsForValidate,
};
const COMMENT_OPEN_ALIASES = commentOpenAliases(constants);
const COMMENT_CLOSE_ALIASES = commentCloseAliases(constants);
const BUILTIN_CONSTANTS = builtinConstantNames(constants);

const INCLUDE_SENTENCE = "It may come from an include file";

/** DE's include folder on this machine, or undefined. */
const GAMEDATA = [
  ...(process.env.AOE2DE_DIR ? [process.env.AOE2DE_DIR] : []),
  ...STEAM_ROOT_CANDIDATES.map(installFolderIn),
  ...DIRECT_INSTALL_CANDIDATES,
]
  .map(gamedataFolderIn)
  .find((dir) => existsSync(dir));

interface Script {
  /** Where it came from, for the report: `test-maps`, `local` or `de`. */
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

const corpus: Script[] = [
  ...rmsIn(join(REPO_ROOT, "test-maps"), "test-maps"),
  ...rmsIn(join(REPO_ROOT, "test-maps", "local"), "local"),
];
const deMaps: Script[] = GAMEDATA === undefined ? [] : rmsIn(GAMEDATA, "de");

/** One script's findings, built exactly as the parser worker builds them. */
interface Finding {
  script: Script;
  usesIncludes: boolean;
  parse: ParseResult;
  diagnostics: Diagnostic[];
}

let state: IncludeState = emptyIncludeState((text) =>
  parseRms(text, lang, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    commentCloseAliases: COMMENT_CLOSE_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
  }),
);

async function run(script: Script): Promise<Finding> {
  const roots = includePathsInText(script.text);
  if (roots.length > 0) {
    // The loader's walk, then the worker's message. With no install the
    // worker is told `null`, which keeps the softening.
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
  const parse = parseRms(script.text, lang, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    commentCloseAliases: COMMENT_CLOSE_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
    ...parseOptionsFor(state, script.text),
  });
  const semantic = validate(parse, refDb, {
    resolvedIncludes: indexFor(state, parse),
  });
  return {
    script,
    usesIncludes: roots.length > 0,
    parse,
    diagnostics: [...parse.diagnostics, ...semantic],
  };
}

/** `file:line:NAME` for one diagnostic. The name is the text its span covers. */
function siteOf(f: Finding, d: Diagnostic): string {
  const line = lineNumberOfOffset(f.parse.lineOffsets, d.span.start);
  const name = f.script.text.slice(d.span.start, d.span.end);
  return `${f.script.file}:${line}:${name}`;
}

interface Pinned {
  /** `file:line:NAME` */
  site: string;
  /** One sentence, from reading the site in its script. */
  verdict: string;
}

/**
 * One row per site for a lettered family used on five consecutive lines
 * (`PREFIX_A` to `PREFIX_E`), the shape every group below has. The helper
 * only saves typing, each site is still its own row in the list.
 */
function family(
  file: string,
  firstLine: number,
  prefix: string,
  verdict: string,
): Pinned[] {
  return [..."ABCDE"].map((letter, i) => ({
    site: `${file}:${firstLine + i}:${prefix}_${letter}`,
    verdict,
  }));
}

const NOT_DEFINED_AREA =
  "True positive. No file the script includes defines these actor area names and nothing guards the lines, so each avoid_actor_area gets no area id.";

/**
 * Assertion 3's pinned list. Every RMS0202 warning on a script that names an
 * `#include_drs`, other than Stranded.rms, is one row: the site and a verdict
 * from reading the script. All 57 are true positives. Rule 1 (the use under
 * its own name's `if`) already removed the false ones, and no false positive
 * is left that neither rule covers.
 */
const PINNED: readonly Pinned[] = [
  // Dorothea Quarry sets the lumber camp areas in no file it includes (maps
  // like Hengehold set them), in three unguarded avoid_actor_area runs.
  ...[1063, 1164, 1270].flatMap((line) =>
    family("Dorothea Quarry.rms", line, "LUMBER_CAMP_CAA", NOT_DEFINED_AREA),
  ),
  // Pa_Site copied these blocks from starting_resources.inc without the
  // `if NAME` line that guards each use there (design Sec.3).
  ...[
    [1789, "GOLD_SECONDARY_CAA"],
    [1895, "GOLD_TERTIARY_CAA"],
    [2010, "GOLD_ADDITIONAL_CAA"],
    [2108, "STONE_SECONDARY_CAA"],
    [2220, "STONE_ADDITIONAL_CAA"],
    [2539, "RELIC_CAA"],
  ].flatMap(([line, prefix]) =>
    family(
      "Pa_Site_v1.1.rms",
      line as number,
      prefix as string,
      "True positive. Copied from an include without its `if NAME` guard and defined nowhere, so each avoid_actor_area gets no area id.",
    ),
  ),
  ...[1896, 1937].flatMap((line) =>
    family("fortified_clearing.rms", line, "RELIC_CAA", NOT_DEFINED_AREA),
  ),
  {
    site: "real_world_australia.rms:6:STRING_DINGO",
    verdict:
      "True positive. STRING_DINGO is defined only in includes/themes.inc, which this script never includes, so the rename gets no string id.",
  },
  {
    site: "real_world_australia.rms:7:STRING_EMU",
    verdict:
      "True positive. STRING_EMU is defined only in includes/themes.inc, which this script never includes, so the rename gets no string id.",
  },
];

/**
 * Assertion 4's pinned list. Rule 2 removes every numbered and lettered
 * family sibling. These three are not that: DE's other maps define
 * `PH_TROPHICALSOUTH` and `PH_TROPHICALEAST` (an extra H), and these three
 * special maps test the correct spelling, which nothing defines, so the branch
 * never runs. A one-letter slip in the middle of a word is what RMS0300 is for.
 * Pinned instead of asserted at 0 on the owner's default (2026-11-03), after
 * the design's expectation of 0 (measured 2026-11-02) did not hold.
 */
const PINNED_RMS0300: readonly Pinned[] = [
  {
    site: "special_map_borderstones.rms:235:PH_TROPICALSOUTH",
    verdict:
      "True positive. The map tests PH_TROPICALSOUTH, DE's other maps define PH_TROPHICALSOUTH.",
  },
  {
    site: "special_map_holyline.rms:274:PH_TROPICALEAST",
    verdict:
      "True positive. The map tests PH_TROPICALEAST, DE's other maps define PH_TROPHICALEAST.",
  },
  {
    site: "special_map_yinyang.rms:931:PH_TROPICALEAST",
    verdict:
      "True positive. The map tests PH_TROPICALEAST, DE's other maps define PH_TROPHICALEAST.",
  },
];

describe("include resolution corpus gate (slice B)", () => {
  const findings: Finding[] = [];

  it("runs every script", async () => {
    if (GAMEDATA === undefined) {
      console.log(
        "[includes] no DE install found, so DE's 180 maps and the include files are skipped; the corpus half runs without them",
      );
    }
    for (const script of [...corpus, ...deMaps]) {
      findings.push(await run(script));
    }
    console.log(
      `[includes] ${findings.length} scripts (${corpus.length} corpus, ${deMaps.length} DE)`,
    );
    expect(findings.length).toBe(corpus.length + deMaps.length);
  }, 1_800_000);

  it("1. no diagnostic carries the include sentence", () => {
    if (GAMEDATA === undefined) return;
    const softened = findings.flatMap((f) =>
      f.diagnostics
        .filter((d) => d.message.includes(INCLUDE_SENTENCE))
        .map((d) => `${d.code} ${siteOf(f, d)}`),
    );
    expect(softened).toEqual([]);
  });

  it("2. Stranded.rms has 1,887 RMS0202 warnings, all on FOREST_IDENTIFICATION", () => {
    if (GAMEDATA === undefined) return;
    const stranded = findings.find((f) => f.script.file === "Stranded.rms");
    expect(stranded).toBeDefined();
    const hits = stranded!.diagnostics.filter((d) => d.code === "RMS0202");
    expect(hits).toHaveLength(1887);
    const names = new Set(
      hits.map((d) => stranded!.script.text.slice(d.span.start, d.span.end)),
    );
    expect([...names]).toEqual(["FOREST_IDENTIFICATION"]);
  });

  it("3. the other RMS0202 warnings on scripts with an include equal the pinned list", () => {
    if (GAMEDATA === undefined) return;
    const sites = findings
      .filter((f) => f.usesIncludes && f.script.file !== "Stranded.rms")
      .flatMap((f) =>
        f.diagnostics
          .filter((d) => d.code === "RMS0202" && d.severity === "warning")
          .map((d) => siteOf(f, d)),
      )
      .sort();
    console.log(`[includes] ${sites.length} RMS0202 sites on include scripts`);
    expect(sites).toEqual(PINNED.map((row) => row.site).sort());
  });

  it("4. RMS0300 warnings across every script equal the pinned list", () => {
    // The 3 DE sites exist only when DE's maps were read.
    const expected = GAMEDATA === undefined ? [] : PINNED_RMS0300;
    const hits = findings.flatMap((f) =>
      f.diagnostics
        .filter((d) => d.code === "RMS0300")
        .map((d) => siteOf(f, d)),
    );
    expect(hits.sort()).toEqual(expected.map((row) => row.site).sort());
  });

  it("reports the picture for scripts with no include", () => {
    const plain = findings.filter((f) => !f.usesIncludes);
    const count = (code: string): number =>
      plain.reduce(
        (n, f) => n + f.diagnostics.filter((d) => d.code === code).length,
        0,
      );
    console.log(
      `[includes] ${plain.length} scripts with no include: RMS0202 ${count("RMS0202")}, RMS0300 ${count("RMS0300")}, RMS0303 ${count("RMS0303")}`,
    );
    expect(plain.length).toBeGreaterThan(0);
  });
});
