// The RMS0324 corpus gate (docs/undefined-name-warning-brief.md Sec.5 item 5).
// Run with `npm run measure:undefined-names`, its own vitest config, kept out
// of `npm test` for the reason includeResolution.measure.test.ts gives: it
// parses and validates 243 scripts and reads the include files from a local
// install.
//
// Every script runs the way the parser worker runs it. The include options
// come from src/editor/includeCache.ts, never built by hand, and the
// installed definitions come from the install's own random_map.def through
// `definitionNamesIn`, which is what the app's hook does.
//
// Needs the install. Without one the whole file prints a note and skips,
// because rule N would then say info on every site and the pinned warnings
// could not hold.

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
import { includePathsInText, type IncludeIndex } from "../includeIndex";
import { definitionNamesIn } from "../installedDefinitions";
import { boundNamesIn } from "../nameLookup";
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

/** DE's include folder on this machine, or undefined. */
const GAMEDATA = [
  ...(process.env.AOE2DE_DIR ? [process.env.AOE2DE_DIR] : []),
  ...STEAM_ROOT_CANDIDATES.map(installFolderIn),
  ...DIRECT_INSTALL_CANDIDATES,
]
  .map(gamedataFolderIn)
  .find((dir) => existsSync(dir));

/** The names the install's random_map.def defines, rule D's input. */
const INSTALLED: ReadonlySet<string> | undefined =
  GAMEDATA !== undefined && existsSync(join(GAMEDATA, "random_map.def"))
    ? definitionNamesIn(
        readFileSync(join(GAMEDATA, "random_map.def"), "utf8").replace(
          /\r\n/g,
          "\n",
        ),
        lang,
      )
    : undefined;

/**
 * The top-level maps git tracks (`git ls-files test-maps`), by file name. The
 * other top-level maps on a maintainer's disk are not in CI, so their sites
 * are printed and never asserted (brief Sec.5 item 5, part 4).
 */
const TRACKED = new Set([
  "13_Rings_v1.2.rms",
  "AD4 - Ra.rms",
  "AK_ForeDaut_v1.3.rms",
  "AK_Hourglass_v2.0.rms",
  "AK_Namatjira.rms",
  "AK_Six_Points_v1.4.rms",
  "AK_Vanguard_v1.2.rms",
  "Bulls_Eyes.rms",
  "Chaotic_Straitv0.99.rms",
  "Comeer v1.5.rms",
  "Menindee_AUS_v2.3.rms",
  "Venn.rms",
  "sample.rms",
]);

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

const corpus: Script[] = [
  ...rmsIn(join(REPO_ROOT, "test-maps"), "test-maps"),
  ...rmsIn(join(REPO_ROOT, "test-maps", "local"), "local"),
];
const deMaps: Script[] = GAMEDATA === undefined ? [] : rmsIn(GAMEDATA, "de");

interface Finding {
  script: Script;
  parse: ParseResult;
  index: IncludeIndex | undefined;
  /** Only the RMS0324 diagnostics. */
  hits: Diagnostic[];
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
  // The loader's walk, then the worker's message, as the include gate does.
  const requested = new Set<string>();
  const files = await loadIncludeFiles(
    roots,
    async (key) => {
      const full = join(GAMEDATA!, key);
      return existsSync(full)
        ? readFileSync(full, "utf8").replace(/\r\n/g, "\n")
        : undefined;
    },
    requested,
  );
  state = receiveIncludes(state, files, [...requested], state.parse);
  const parse = parseRms(script.text, lang, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    commentCloseAliases: COMMENT_CLOSE_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
    ...parseOptionsFor(state, script.text),
  });
  const index = indexFor(state, parse);
  const hits = validate(parse, refDb, {
    resolvedIncludes: index,
    installedDefinitions: INSTALLED ?? null,
  }).filter((d) => d.code === "RMS0324");
  return { script, parse, index, hits };
}

function siteOf(f: Finding, d: Diagnostic): string {
  const line = lineNumberOfOffset(f.parse.lineOffsets, d.span.start);
  const name = f.script.text.slice(d.span.start, d.span.end);
  return `${f.script.file}:${line}:${name}`;
}

const nameOf = (f: Finding, d: Diagnostic): string =>
  f.script.text.slice(d.span.start, d.span.end);

/**
 * Part 1's pinned list, 28 sites on the tracked corpus. Each was checked by
 * hand against the installed random_map.def, includes/constants.inc and every
 * include its map names (brief Sec.3.1). W is a warning, C is rule C.
 */
const PINNED_TRACKED: readonly string[] = [
  "13_Rings_v1.2.rms:105:ONGRID_PLACEHOLDER2",
  "13_Rings_v1.2.rms:1505:BIRD_A",
  "13_Rings_v1.2.rms:1509:BIRD_B",
  "AD4 - Ra.rms:897:BIRD_A",
  "AD4 - Ra.rms:901:BIRD_B",
  "AD4 - Ra.rms:912:BIRD_A",
  "AD4 - Ra.rms:913:BIRD_B",
  "AK_ForeDaut_v1.3.rms:2129:BIRD_A",
  "AK_ForeDaut_v1.3.rms:2134:BIRD_B",
  "AK_Hourglass_v2.0.rms:1836:BIRD_A",
  "AK_Hourglass_v2.0.rms:1840:BIRD_B",
  "AK_Six_Points_v1.4.rms:1885:BIRD_A",
  "AK_Six_Points_v1.4.rms:1889:BIRD_B",
  "AK_Vanguard_v1.2.rms:106:ONGRID_PLACEHOLDER2",
  "AK_Vanguard_v1.2.rms:1726:BIRD_A",
  "AK_Vanguard_v1.2.rms:1730:BIRD_B",
  "Chaotic_Straitv0.99.rms:117:FENCE_RUBBLE",
  "Chaotic_Straitv0.99.rms:122:CUSTOM",
  "Chaotic_Straitv0.99.rms:927:BIRDS_A",
  ...[344, 345, 346, 347, 348].map(
    (n) => `Comeer v1.5.rms:${n}:PH_GENERIC_OFF`,
  ),
  "Comeer v1.5.rms:1019:BIRD_A",
  "Comeer v1.5.rms:1023:BIRD_B",
  "Menindee_AUS_v2.3.rms:1070:PALM_FOREST",
  "Menindee_AUS_v2.3.rms:1390:SEAGULLS",
];

/** Part 2's expected DE warning names, with the count of each. */
const DE_WARNING_NAMES: Record<string, number> = {
  RICE_FARM_EMPTY: 64,
  TERRAIN_SHALLOWS: 6,
  PLACEHOLDER_TERRAIN: 5,
  ICY_SHORE: 4,
  STRAGGLER_FOREST: 4,
  STRAGGLER_FOREST_BLEND: 4,
  BASE_TERRAIN: 1,
  COLOR_MOOD: 1,
  MIDDLE_TERRAIN_BLEND_C: 1,
  WATER_A: 1,
};

describe("RMS0324 corpus gate", () => {
  const findings: Finding[] = [];
  const skip = GAMEDATA === undefined || INSTALLED === undefined;

  it("runs every script", async () => {
    if (skip) {
      console.log(
        "[undefined-names] no DE install found, so the whole gate is skipped",
      );
      return;
    }
    for (const script of [...corpus, ...deMaps]) {
      findings.push(await run(script));
    }
    console.log(
      `[undefined-names] ${findings.length} scripts (${corpus.length} corpus, ${deMaps.length} DE), ${INSTALLED!.size} installed definitions`,
    );
    expect(findings.length).toBe(corpus.length + deMaps.length);
  }, 1_800_000);

  it("1. the tracked corpus carries exactly the 28 pinned RMS0324 sites", () => {
    if (skip) return;
    const sites = findings
      .filter((f) => f.script.origin === "test-maps")
      .filter((f) => TRACKED.has(f.script.file))
      .flatMap((f) => f.hits.map((d) => siteOf(f, d)))
      .sort();
    expect(sites).toEqual([...PINNED_TRACKED].sort());
    // SEAGULLS is the one rule C site, the rest are warnings (rule W).
    const seagulls = findings
      .filter((f) => f.script.file === "Menindee_AUS_v2.3.rms")
      .flatMap((f) => f.hits.filter((d) => nameOf(f, d) === "SEAGULLS"));
    expect(seagulls).toHaveLength(1);
    expect(seagulls[0].message).toContain("Only includes/constants.inc");
  });

  it("2. DE's 180 maps carry 91 warnings and 99 infos, and the warning names are the known ones", () => {
    if (skip) return;
    const de = findings.filter((f) => f.script.origin === "de");
    const all = de.flatMap((f) => f.hits.map((d) => ({ f, d })));
    const warnings = all.filter(({ d }) => d.severity === "warning");
    const infos = all.filter(({ d }) => d.severity === "info");
    const counts: Record<string, number> = {};
    for (const { f, d } of warnings)
      counts[nameOf(f, d)] = (counts[nameOf(f, d)] ?? 0) + 1;
    const infoCounts: Record<string, number> = {};
    for (const { f, d } of infos)
      infoCounts[nameOf(f, d)] = (infoCounts[nameOf(f, d)] ?? 0) + 1;
    console.log(
      `[undefined-names] DE infos by name: ${JSON.stringify(
        Object.entries(infoCounts).sort((a, b) => b[1] - a[1]),
      )}`,
    );
    expect(counts).toEqual(DE_WARNING_NAMES);
    expect(warnings).toHaveLength(91);
    expect(infos).toHaveLength(99);
  });

  it("3. no group name and no installed name ever fires", () => {
    if (skip) return;
    const bad = findings.flatMap((f) => {
      const groups = new Set([
        ...boundNamesIn(f.parse),
        ...(f.index?.boundNames ?? []),
      ]);
      return f.hits
        .filter((d) => {
          const name = nameOf(f, d);
          return groups.has(name) || INSTALLED!.has(name);
        })
        .map((d) => siteOf(f, d));
    });
    expect(bad).toEqual([]);
  });

  it("4. reports the untracked corpus without asserting it", () => {
    if (skip) return;
    const rows = findings
      .filter(
        (f) =>
          f.script.origin === "local" ||
          (f.script.origin === "test-maps" && !TRACKED.has(f.script.file)),
      )
      .flatMap((f) => f.hits.map((d) => `${d.severity[0]} ${siteOf(f, d)}`));
    console.log(
      `[undefined-names] untracked corpus, ${rows.length} sites\n${rows.join("\n")}`,
    );
  });
});
