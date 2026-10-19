// preview-design.md Sec.13's rev 9 gate: the land stage against DE itself.
//
// `fixtures/de-land-stage-maps.json` holds 111 maps DE generated from 35
// probe scripts, at their own seeds and lobbies, read back tile by tile from
// the saved scenarios with AoE2ScenarioParser, keeping only maps whose
// alliances a lobby can produce. It is frozen measured data, and nothing in
// the repo regenerates it. Each one runs here
// through the real `generatePreview`, and every tile of the five probe
// terrains has to come out where DE put it. One draw out of place anywhere
// from the first rnd() to the last growth step moves tiles, so this gate
// covers the stream, the draw order and every rule at once.
//
// The comparison reads the land stage's own terrain, rebuilt from the final
// `grid.landId` and each land's terrain as the sandwich gate does, followed
// by the WATER cleanup the terrain stage ends with. DE's saved maps hold no
// beach on these scripts' lands, and the preview's automatic beach would only
// turn base tiles into beach, so it plays no part.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import { createTileGrid } from "../generator/grid";
import { cleanWaterTerrain } from "../generator/lands";
import type { TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const constants: readonly ObjectConstant[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants,
};

interface DeMap {
  name: string;
  script: number;
  seed: number;
  players: number;
  teams: TeamNumber[];
  teamPositions: boolean;
  terrain: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "src",
      "preview",
      "__tests__",
      "fixtures",
      "de-land-stage-maps.json",
    ),
    "utf8",
  ),
) as { scripts: string[]; maps: DeMap[] };

function terrainId(name: string): number {
  const row = constants.find(
    (c) => c.category === "terrain" && c.rmsConstant === name,
  );
  if (row?.constId == null) throw new Error(`no terrain ${name}`);
  return row.constId;
}

const LETTER_OF = new Map<number, string>([
  [terrainId("DESERT"), "D"],
  [terrainId("SNOW"), "S"],
  [terrainId("FOREST"), "F"],
  [terrainId("DIRT"), "R"],
  [terrainId("WATER"), "W"],
]);
const GRASS = terrainId("GRASS");
const WATER = terrainId("WATER");

function decode(rle: string): string {
  let out = "";
  for (const m of rle.matchAll(/(\d+)(.)/g)) out += m[2].repeat(Number(m[1]));
  return out;
}

/** The land stage's terrain for one fixture map, as letters, row by row. */
function previewLetters(map: DeMap): string {
  const result = generatePreview(
    parseRms(fixture.scripts[map.script], lang),
    refDb,
    {
      playerCount: map.players,
      mapSize: "Tiny",
      teams: map.teams,
      teamPositions: map.teamPositions,
    },
    { seed: map.seed, collectSnapshots: false },
  );
  const { dim, landId } = result.grid;
  const grid = createTileGrid(dim, GRASS);
  for (let i = 0; i < landId.length; i++) {
    const land = landId[i] >= 0 ? result.landOrigins[landId[i]] : undefined;
    if (land?.terrainId !== undefined) grid.terrain[i] = land.terrainId;
  }
  cleanWaterTerrain(grid, WATER);
  let out = "";
  for (const id of grid.terrain) out += LETTER_OF.get(id) ?? ".";
  return out;
}

describe("the land stage matches DE tile for tile (Sec.13, rev 9)", () => {
  it("covers every saved map in the fixture", () => {
    expect(fixture.maps.length).toBe(111);
  });

  it.each(fixture.maps.map((m) => [m.name, m] as const))("%s", (_name, map) => {
    const expected = decode(map.terrain);
    const actual = previewLetters(map);
    let differing = 0;
    for (let i = 0; i < expected.length; i++)
      if (expected[i] !== actual[i]) differing++;
    expect(differing, `${differing} tiles differ from DE`).toBe(0);
  });
});
