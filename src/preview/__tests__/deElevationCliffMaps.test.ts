// preview-design.md Sec.13, the rev 10 gate for elevation and cliffs against DE.
//
// `fixtures/de-elevation-cliff-maps.json` holds 51 maps DE generated from the
// 22 probe scripts it carries, at their own seeds and three map sizes, read
// back from the saved scenarios with AoE2ScenarioParser. It is frozen measured
// data, and nothing in the repo regenerates it. Each one runs here through the real `generatePreview`, and the
// finished map has to match DE on every tile's elevation, terrain and layer
// and on every cliff object's type, position and facing.
//
// The stream runs unbroken from the script's first draw to the last cliff, so
// one draw out of place in the land stage, the cleanup's restore draws, any
// layer or any cliff moves everything after it. These scripts have no
// <TERRAIN_GENERATION>, connections or objects, so the terrain compared is the
// land stage's, plus the cliff stage's water repair and the end of the terrain
// stage (cliff lines restored, the WATER cleanup, the beach).

import { readFileSync } from "node:fs";
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
  DEFAULT_TEAMS,
  MAP_SIZES,
  type MapSize,
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

interface DeMap {
  name: string;
  script: number;
  seed: number;
  size: number;
  players: number;
  elevation: string;
  terrain: string;
  layer: string;
  /** [object id, x, y, facing] */
  cliffs: [number, number, number, number][];
}

const fixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "src",
      "preview",
      "__tests__",
      "fixtures",
      "de-elevation-cliff-maps.json",
    ),
    "utf8",
  ),
) as { scripts: string[]; maps: DeMap[] };

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

describe("elevation and cliffs match DE tile for tile (Sec.13, rev 10)", () => {
  it("covers every saved map in the fixture", () => {
    expect(fixture.maps.length).toBe(51);
  });

  it.each(fixture.maps.map((m) => [m.name, m] as const))("%s", (_name, map) => {
    const result = generatePreview(
      parseRms(fixture.scripts[map.script], lang),
      refDb,
      {
        playerCount: map.players,
        mapSize: mapSizeOf(map.size),
        teams: DEFAULT_TEAMS,
        teamPositions: true,
      },
      { seed: map.seed, collectSnapshots: false },
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
  });
});
