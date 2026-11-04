// preview-design.md Sec.13, the rev 11 gate for whole scripts against DE.
//
// `fixtures/de-whole-script-maps.json` holds every map of the DE study's
// rounds EC to CJ that the land and elevation gates do not, 342 when rev 11
// landed. Among them are the terrain stage's probes (rounds ET and GP), the
// connection probes (CO and CF), the parser probes (CG), and 15 real corpus
// scripts at two seeds each, whole and cut after each stage (CG, CI, CJ).
// Each map names its probe script in `tools/scenario-probe/de-study/probes`
// rather than carrying it, since several scripts run to thousands of lines
// and the archive already holds them.
//
// Each map runs through the real `generatePreview` at its own seed and lobby,
// with the scenario editor's labels, since the maps were made there, and the
// finished map has to match DE on every tile's elevation, terrain and layer
// and on every cliff object. The objects themselves are not compared yet,
// and on these maps they do not change the terrain.
//
// A map marked `known` is one the preview does not match yet. It runs with
// `it.fails`, so it stays visible, and the day it starts to match the gate
// says so and the mark has to go.
//
// A script with `#include_drs` (the Bazi maps) needs DE's own include files,
// which are the game's content and never enter the repo. The gate reads them
// from a local install, as the app does, and skips those maps where none is
// found, a CI machine among them.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import { NO_LAYER } from "../generator/grid";
import { resolveMapDim } from "../generator/mapDimensions";
import {
  includePathsIn,
  loadIncludeFiles,
  type IncludeFiles,
} from "../generator/includes";
import {
  DIRECT_INSTALL_CANDIDATES,
  STEAM_ROOT_CANDIDATES,
  gamedataFolderIn,
  installFolderIn,
} from "../../settings/scriptFolder";
import {
  DEFAULT_TEAMS,
  MAP_SIZES,
  type MapSize,
  type TeamNumber,
} from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);
const constants: readonly ObjectConstant[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;
const refDb: PreviewReferenceData = { language, constants };
const PROBES = join(REPO_ROOT, "tools", "scenario-probe", "de-study", "probes");

interface DeMap {
  name: string;
  /** The probe script's file name in `de-study/probes`. */
  script: string;
  seed: number;
  /** The saved map's side. */
  size: number;
  /** The editor lobby's side, when `override_map_size` made the map another size. */
  lobbySize?: number;
  players: number;
  /** The lobby's teams, 8 entries, 0 for none. Absent means no teams. */
  teams?: TeamNumber[];
  /** The editor's Team Positions box. Absent means ticked. */
  teamPositions?: boolean;
  elevation: string;
  terrain: string;
  layer: string;
  /** [object id, x, y, facing] */
  cliffs: [number, number, number, number][];
  /** Why the preview does not match this map yet. */
  known?: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "src",
      "preview",
      "__tests__",
      "fixtures",
      "de-whole-script-maps.json",
    ),
    "utf8",
  ),
) as { maps: DeMap[] };

/** DE's include folder on this machine, or undefined. `AOE2DE_DIR` names an install the usual places miss. */
const GAMEDATA = [
  ...(process.env.AOE2DE_DIR ? [process.env.AOE2DE_DIR] : []),
  ...STEAM_ROOT_CANDIDATES.map(installFolderIn),
  ...DIRECT_INSTALL_CANDIDATES,
]
  .map(gamedataFolderIn)
  .find((dir) => existsSync(dir));

const includesByScript = new Map<string, IncludeFiles>();
async function includesOf(file: string): Promise<IncludeFiles> {
  let files = includesByScript.get(file);
  if (files === undefined) {
    files = await loadIncludeFiles(
      includePathsIn(parseRms(scriptOf(file), lang)),
      async (key) => {
        const full = join(GAMEDATA!, key);
        return existsSync(full)
          ? readFileSync(full, "utf8").replace(/\r\n/g, "\n")
          : undefined;
      },
    );
    includesByScript.set(file, files);
  }
  return files;
}

const needsIncludes = (map: DeMap): boolean =>
  includePathsIn(parseRms(scriptOf(map.script), lang)).length > 0;

const scripts = new Map<string, string>();
function scriptOf(file: string): string {
  let text = scripts.get(file);
  if (text === undefined) {
    text = readFileSync(join(PROBES, file), "utf8").replace(/\r\n/g, "\n");
    scripts.set(file, text);
  }
  return text;
}

/** "value*count" runs back to one number per tile. */
function decode(runs: string): number[] {
  const out: number[] = [];
  for (const run of runs.split(" ")) {
    const [value, count] = run.split("*").map(Number);
    for (let k = 0; k < count; k++) out.push(value);
  }
  return out;
}

function mapSizeOf(dim: number): MapSize {
  const size = MAP_SIZES.find(
    (s) => resolveMapDim(s, language.data.predefinedLabels) === dim,
  );
  if (size === undefined) throw new Error(`no lobby size is ${dim} tiles`);
  return size;
}

/** How many tiles differ, and the first few, for a readable failure. */
function differences(
  expected: number[],
  actual: ArrayLike<number>,
  dim: number,
) {
  const where: string[] = [];
  let count = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === actual[i]) continue;
    count++;
    if (where.length < 5)
      where.push(
        `(${i % dim}, ${Math.floor(i / dim)}) DE ${expected[i]} preview ${actual[i]}`,
      );
  }
  return { count, where: where.join("; ") };
}

const pieceKey = (id: number, x: number, y: number, facing: number): string =>
  `${id}@${x.toFixed(4)},${y.toFixed(4)}/${facing}`;

async function check(map: DeMap): Promise<void> {
  const includeFiles = needsIncludes(map)
    ? await includesOf(map.script)
    : undefined;
  const result = generatePreview(
    parseRms(scriptOf(map.script), lang),
    refDb,
    {
      playerCount: map.players,
      mapSize: mapSizeOf(map.lobbySize ?? map.size),
      teams: map.teams ?? DEFAULT_TEAMS,
      teamPositions: map.teamPositions ?? true,
      lobby: "scenarioEditor",
    },
    { seed: map.seed, collectSnapshots: false, includeFiles },
  );
  const { grid } = result;
  expect(grid.dim).toBe(map.size);

  const elevation = differences(
    decode(map.elevation),
    grid.elevation,
    grid.dim,
  );
  expect(elevation.count, `elevation: ${elevation.where}`).toBe(0);
  const terrain = differences(decode(map.terrain), grid.terrain, grid.dim);
  expect(terrain.count, `terrain: ${terrain.where}`).toBe(0);
  const layer = differences(
    decode(map.layer).map((v) => (v < 0 ? NO_LAYER : v)),
    grid.layer,
    grid.dim,
  );
  expect(layer.count, `layer: ${layer.where}`).toBe(0);

  const expected = map.cliffs
    .map(([id, x, y, f]) => pieceKey(id, x, y, f))
    .sort();
  const actual = result.cliffPieces
    .map((p) => pieceKey(p.objectId, p.x, p.y, p.facing))
    .sort();
  expect(actual).toEqual(expected);
}

describe("whole scripts match DE tile for tile (Sec.13, rev 11)", () => {
  // At least the 342 maps rev 11 was built against, so a fixture cut short
  // goes red. New maps from export_de_fixture.py only add to it.
  it("covers every saved map in the fixture", () => {
    expect(fixture.maps.length).toBeGreaterThanOrEqual(342);
    expect(new Set(fixture.maps.map((m) => m.name)).size).toBe(
      fixture.maps.length,
    );
  });

  const runnable = fixture.maps.filter(
    (m) => GAMEDATA !== undefined || !needsIncludes(m),
  );
  const matched = runnable.filter((m) => m.known === undefined);
  const known = runnable.filter((m) => m.known !== undefined);
  const skipped = fixture.maps.filter((m) => !runnable.includes(m));

  it.skip.each(skipped.map((m) => [m.name] as const))(
    "%s (needs DE's include files, and no install was found)",
    () => {},
  );

  it.each(matched.map((m) => [m.name, m] as const))(
    "%s",
    { timeout: 30_000 },
    (_name, map) => check(map),
  );

  it.fails.each(known.map((m) => [`${m.name} (${m.known})`, m] as const))(
    "%s",
    { timeout: 30_000 },
    (_name, map) => check(map),
  );
});
