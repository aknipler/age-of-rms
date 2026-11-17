// preview-design.md Sec.13, the rev 12 gate for objects against DE.
//
// `fixtures/de-object-maps.json.gz` holds every object of the DE study's
// saved maps for its object rounds: the 30 corpus maps (15 real scripts at
// seeds 1004 and 1005) and the probe maps of rounds CO, CF and CH to DZ.
// `tools/scenario-probe/export_de_objects.py` writes it from the archived
// scenarios. Gzipped, because the corpus maps alone hold about 237,000
// objects.
//
// Each map runs through the real `generatePreview` with the object data, and
// every object DE saved has to come out the same: its type, owner, position
// to 1/256 tile, status, and its facing as the study compared it, the
// rotation field for an object that draws a random angle and the frame field
// for any other. Terrain objects and cliff pieces are objects here too.
//
// A map marked in `KNOWN` is one the preview does not match yet. It runs with
// `it.fails`, so the day it starts to match the gate says so.
//
// `DE_OBJECT_MAPS=name,name` runs only the maps whose names contain one of
// the words, for working on one map at a time.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import { ObjectCatalog, type ObjectDataFile } from "../generator/deObjectData";
import { terrainClassTable } from "../generator/terrainClass";
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
const objectData = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "object-data.json"),
    "utf8",
  ),
) as ObjectDataFile;
const refDb: PreviewReferenceData = { language, constants, objectData };
const PROBES = join(REPO_ROOT, "tools", "scenario-probe", "de-study", "probes");

/** The object's own data, without a script's effects: whether the study compared its rotation or its frame. */
const plain = new ObjectCatalog(objectData, terrainClassTable(constants));
const comparesRotation = (id: number): boolean =>
  plain.def(id)?.creation.randomAngle ?? false;

interface DeObjectMap {
  name: string;
  script: string;
  seed: number;
  size: number;
  lobbySize?: number;
  players: number;
  civs: (number | string)[];
  teams?: TeamNumber[];
  /** "type owner x y rotation frame status" */
  objects: string[];
}

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      join(
        REPO_ROOT,
        "src",
        "preview",
        "__tests__",
        "fixtures",
        "de-object-maps.json.gz",
      ),
    ),
  ).toString("utf8"),
) as { maps: DeObjectMap[] };

/** Maps the preview does not match yet, with the reason. */
const KNOWN: Record<string, string> = {};

const GAMEDATA = [
  ...(process.env.AOE2DE_DIR ? [process.env.AOE2DE_DIR] : []),
  ...STEAM_ROOT_CANDIDATES.map(installFolderIn),
  ...DIRECT_INSTALL_CANDIDATES,
]
  .map(gamedataFolderIn)
  .find((dir) => existsSync(dir));

const scripts = new Map<string, string>();
function scriptOf(file: string): string {
  let text = scripts.get(file);
  if (text === undefined) {
    text = readFileSync(join(PROBES, file), "utf8").replace(/\r\n/g, "\n");
    scripts.set(file, text);
  }
  return text;
}

async function includesOf(file: string): Promise<IncludeFiles | undefined> {
  const paths = includePathsIn(parseRms(scriptOf(file), lang));
  if (!paths.length) return undefined;
  return loadIncludeFiles(paths, async (key) => {
    const full = join(GAMEDATA!, key);
    return existsSync(full)
      ? readFileSync(full, "utf8").replace(/\r\n/g, "\n")
      : undefined;
  });
}

function mapSizeOf(dim: number): MapSize {
  const size = MAP_SIZES.find(
    (s) => resolveMapDim(s, language.data.predefinedLabels) === dim,
  );
  if (size === undefined) throw new Error(`no lobby size is ${dim} tiles`);
  return size;
}

/** Python's `round`, half to even, which wrote the fixture's numbers. */
function roundEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** The comparison key: type, owner, position in 1/256 tile, facing as the study compared it, status. */
function keyOf(
  id: number,
  owner: number,
  x256: number,
  y256: number,
  rot10k: number,
  frame: number,
  status: number,
): string {
  const facing = comparesRotation(id) ? `r${rot10k}` : `f${frame}`;
  return `${id} ${owner} ${x256} ${y256} ${facing} ${status}`;
}

function tally(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Objects DE has that the preview lacks, and the other way round. */
function diff(
  de: string[],
  preview: string[],
): { missing: string[]; extra: string[] } {
  const a = tally(de);
  const b = tally(preview);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [k, n] of a)
    for (let i = b.get(k) ?? 0; i < n; i++) missing.push(k);
  for (const [k, n] of b) for (let i = a.get(k) ?? 0; i < n; i++) extra.push(k);
  return { missing, extra };
}

async function check(map: DeObjectMap): Promise<void> {
  const includeFiles = await includesOf(map.script);
  const civilizations = map.civs.map((c) => (typeof c === "number" ? c : 1));
  const result = generatePreview(
    parseRms(scriptOf(map.script), lang),
    refDb,
    {
      playerCount: map.players,
      mapSize: mapSizeOf(map.lobbySize ?? map.size),
      teams: map.teams ?? DEFAULT_TEAMS,
      teamPositions: true,
      lobby: "scenarioEditor",
      civilizations,
    },
    { seed: map.seed, collectSnapshots: false, includeFiles },
  );
  const de = map.objects.map((line) => {
    const [id, owner, x, y, rot, frame, status] = line.split(" ").map(Number);
    return keyOf(id, owner, x, y, rot, frame, status);
  });
  const preview = (result.deObjects ?? []).map((o) =>
    keyOf(
      o.id,
      o.owner,
      roundEven(o.x * 256),
      roundEven(o.y * 256),
      roundEven(o.rotation * 10000),
      o.frame,
      o.status,
    ),
  );
  const { missing, extra } = diff(de, preview);
  expect(
    { missing: missing.length, extra: extra.length },
    `${map.name}: DE ${de.length} objects, preview ${preview.length}. Missing ${missing.slice(0, 6).join("; ")}. Extra ${extra.slice(0, 6).join("; ")}`,
  ).toEqual({ missing: 0, extra: 0 });
}

const only = process.env.DE_OBJECT_MAPS?.split(",").filter(Boolean);
const maps = fixture.maps.filter(
  (m) => !only || only.some((w) => m.name.includes(w)),
);

describe("the object stage against DE's saved maps (Sec.13, rev 12)", () => {
  it("holds the maps it was built for", () => {
    expect(fixture.maps.length).toBeGreaterThan(300);
  });
  for (const map of maps) {
    const needsInstall =
      includePathsIn(parseRms(scriptOf(map.script), lang)).length > 0;
    const reason = KNOWN[map.name];
    if (needsInstall && GAMEDATA === undefined)
      it.skip(`${map.name} (needs DE's include files)`, () => {});
    else if (reason)
      it.fails(`${map.name} (known: ${reason})`, () => check(map), 900_000);
    else it(map.name, () => check(map), 900_000);
  }
});
