// S3, the cliff stage (preview-design Sec.6.3, rev 10).
//
// `deElevationCliffMaps.test.ts` is the real gate. It holds every cliff object
// of 51 saved DE maps to the game's type, position and facing, which covers
// the cells, the shuffle, the walk, the pieces and the water repair draw by
// draw. This file checks the properties a reader can state without a DE map,
// the settings and the notes, and that the stage runs on the whole corpus.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import {
  createTileGrid,
  computeSlopeMask,
  tileIndex,
  type TerrainConstantForMasks,
} from "../generator/grid";
import {
  placeLandOrigins,
  growLands,
  finishLandStage,
} from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import {
  applyCliffs,
  bridges,
  CLIFF_LINE_TERRAIN,
  finishTerrainStage,
  resolveCliffSettings,
} from "../generator/cliffs";
import type { InstantiatedScript, TileGrid } from "../generator/types";
import {
  DEFAULT_TEAMS,
  type MapSize,
} from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const constants: TerrainConstantForMasks[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: TerrainConstantForMasks[] }
).constants;
const id = (name: string): number =>
  constants.find((c) => c.category === "terrain" && c.rmsConstant === name)!
    .constId!;
const GRASS = id("GRASS");
const WATER = id("WATER");

function instantiate(
  source: string,
  seed: number,
  mapSize: MapSize,
  playerCount: number,
): InstantiatedScript {
  return instantiateScript(
    parseRms(source, lang),
    refDb,
    { playerCount, mapSize, teams: DEFAULT_TEAMS },
    seed,
  );
}

/** The real pipeline through S3, the same calls `generatePreview` makes in the same order. */
function place(
  source: string,
  seed = 1,
  mapSize: MapSize = "Tiny",
  playerCount = 2,
) {
  const instantiated = instantiate(source, seed, mapSize, playerCount);
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const land = placeLandOrigins(instantiated, grid, constants);
  const grown = growLands(land.origins, grid, land.reports, land.stream);
  const landStream = finishLandStage(
    land.origins,
    grid,
    GRASS,
    constants,
    grown,
  );
  const elevated = applyElevation(
    instantiated,
    grid,
    constants,
    land.origins,
    landStream,
  );
  const result = applyCliffs(
    instantiated,
    grid,
    constants,
    land.origins,
    elevated.stream,
  );
  return {
    grid,
    dim: instantiated.dim,
    origins: land.origins,
    before: elevated.stream,
    ...result,
  };
}

const HEAD =
  "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n";

function cliffCommands(source: string) {
  return (
    instantiate(source, 1, "Tiny", 2).sections.get("CLIFF_GENERATION") ?? []
  );
}

describe("resolveCliffSettings (5.1)", () => {
  it("uses the measured defaults on a bare header", () => {
    expect(
      resolveCliffSettings(cliffCommands("<CLIFF_GENERATION>\n")),
    ).toMatchObject({
      minCliffs: 3,
      maxCliffs: 9,
      minLength: 5,
      maxLength: 9,
      curliness: 36,
      minDistanceCliffs: 2,
      minTerrainDistance: 2,
      cliffType: 0,
    });
  });

  it("reads every declared attribute, the last one written winning", () => {
    const source = [
      "<CLIFF_GENERATION>",
      "min_number_of_cliffs 2",
      "min_number_of_cliffs 1",
      "max_number_of_cliffs 2",
      "min_length_of_cliff 4",
      "max_length_of_cliff 6",
      "cliff_curliness 90",
      "min_distance_cliffs 5",
      "min_terrain_distance 7",
      "cliff_type CT_TERRACE",
    ].join("\n");
    expect(
      resolveCliffSettings(cliffCommands(source), constants),
    ).toMatchObject({
      minCliffs: 1,
      maxCliffs: 2,
      minLength: 4,
      maxLength: 6,
      curliness: 90,
      minDistanceCliffs: 5,
      minTerrainDistance: 7,
      cliffType: 5,
    });
  });

  it("reads cliff_type by number too, and an out-of-range style as the default", () => {
    expect(
      resolveCliffSettings(cliffCommands("<CLIFF_GENERATION>\ncliff_type 1\n")),
    ).toMatchObject({ cliffType: 1 });
    expect(
      resolveCliffSettings(cliffCommands("<CLIFF_GENERATION>\ncliff_type 9\n")),
    ).toMatchObject({ cliffType: 0 });
  });
});

describe("computeSlopeMask", () => {
  it("marks a tile sloped when a 4-neighbour has a different height", () => {
    const grid = createTileGrid(20, GRASS);
    const center = tileIndex(grid, 5, 5);
    grid.elevation[center] = 3;
    const mask = computeSlopeMask(grid);
    expect(mask[center]).toBe(1);
    expect(mask[tileIndex(grid, 5, 4)]).toBe(1);
    expect(mask[tileIndex(grid, 0, 0)]).toBe(0);
  });
});

describe("bridges (the cleanup's patterns on 8 neighbours)", () => {
  // N, NE, E, SE, S, SW, W, NW
  const nb = (...set: number[]) =>
    Array.from({ length: 8 }, (_, k) => set.includes(k));

  it("straight: water on both sides, across or down", () => {
    expect(bridges(nb(0, 4), false)).toBe(true);
    expect(bridges(nb(2, 6), false)).toBe(true);
    expect(bridges(nb(0, 2), false)).toBe(false);
  });

  it("diagonal: water at two opposite corners with dry tiles between", () => {
    expect(bridges(nb(7, 3), true)).toBe(true);
    expect(bridges(nb(7, 0, 1), true)).toBe(false);
  });
});

describe("applyCliffs (5.2 to 5.7)", () => {
  it("does nothing and takes no draw without a <CLIFF_GENERATION> section", () => {
    const run = place(HEAD);
    expect(run.reports).toEqual([]);
    expect(run.pieces).toEqual([]);
    expect(run.stream).toEqual(run.before);
  });

  it("makes default cliffs from a bare header (cl5)", () => {
    const run = place(HEAD + "<CLIFF_GENERATION>\n", 4);
    expect(run.reports).toHaveLength(1);
    const { attempted, placed } = run.reports[0];
    expect(attempted).toBeGreaterThanOrEqual(3);
    expect(attempted).toBeLessThanOrEqual(8);
    expect(placed).toBe(attempted);
    expect(run.pieces.length).toBeGreaterThan(attempted * 4);
  });

  it("min_number_of_cliffs above max: no cliffs and a note, never a throw", () => {
    const run = place(
      HEAD +
        "<CLIFF_GENERATION>\nmin_number_of_cliffs 9\nmax_number_of_cliffs 3\n",
    );
    expect(run.pieces).toEqual([]);
    expect(run.notes.map((n) => n.key)).toEqual(["cliffsMinExceedsMax"]);
  });

  it("lengths below 3 make nothing, reached through the rolls (RMSTEST_45)", () => {
    const section = (min: number, max: number) =>
      HEAD +
      `<CLIFF_GENERATION>\nmin_number_of_cliffs 20\nmax_number_of_cliffs 21\nmin_length_of_cliff ${min}\nmax_length_of_cliff ${max}\n`;
    const none = place(section(2, 2), 5);
    expect(none.pieces).toEqual([]);
    expect(none.notes[0].text).toMatch(/no cliffs at all/);
    const control = place(section(3, 3), 5);
    expect(control.pieces.length).toBeGreaterThan(0);
    expect(control.notes).toEqual([]);
    const some = place(section(2, 4), 5);
    expect(some.pieces.length).toBeGreaterThan(0);
    expect(some.notes[0].text).toMatch(/fewer cliffs/);
  });

  it("cliff_type changes only the objects, not where they stand or face", () => {
    const script = HEAD + "<CLIFF_GENERATION>\nmin_number_of_cliffs 6\n";
    const granite = place(script, 8);
    const terrace = place(script + "cliff_type CT_TERRACE\n", 8);
    expect(terrace.pieces.map((p) => [p.x, p.y, p.facing])).toEqual(
      granite.pieces.map((p) => [p.x, p.y, p.facing]),
    );
    expect(terrace.pieces.map((p) => p.objectId - 2651)).toEqual(
      granite.pieces.map((p) => p.objectId - 264),
    );
    for (const p of granite.pieces) {
      expect(p.objectId).toBeGreaterThanOrEqual(264);
      expect(p.objectId).toBeLessThan(264 + 9);
    }
  });

  it("keeps every cliff cell more than 7 cells from every land's origin, neutral lands included (cl6)", () => {
    const script =
      HEAD +
      "create_player_lands { terrain_type GRASS base_size 3 number_of_tiles 40 }\n" +
      "create_land { terrain_type GRASS land_position 50 50 base_size 2 number_of_tiles 0 }\n" +
      "<CLIFF_GENERATION>\nmin_number_of_cliffs 25\nmax_number_of_cliffs 30\nmin_distance_cliffs 1\n";
    for (const seed of [1, 2, 3]) {
      const run = place(script, seed, "Tiny", 2);
      expect(run.pieces.length).toBeGreaterThan(0);
      for (const p of run.pieces)
        for (const o of run.origins) {
          const far =
            Math.abs(p.cellX - Math.floor(o.x / 3)) > 7 ||
            Math.abs(p.cellY - Math.floor(o.y / 3)) > 7;
          expect(far).toBe(true);
        }
    }
  });

  it("stands every piece on a flat dry 3 by 3 cell", () => {
    const run = place(
      HEAD +
        "create_land { terrain_type WATER land_position 50 50 number_of_tiles 1500 base_size 4 }\n" +
        "<ELEVATION_GENERATION>\ncreate_elevation 3 { number_of_tiles 1500 number_of_clumps 4 }\n" +
        "<CLIFF_GENERATION>\nmin_number_of_cliffs 20\nmax_number_of_cliffs 26\n",
      6,
    );
    expect(run.pieces.length).toBeGreaterThan(0);
    for (const p of run.pieces) {
      const heights = new Set<number>();
      for (let oy = 0; oy < 3; oy++)
        for (let ox = 0; ox < 3; ox++) {
          const i = (p.cellY * 3 + oy) * run.dim + p.cellX * 3 + ox;
          heights.add(run.grid.elevation[i]);
          expect(run.grid.terrain[i]).not.toBe(WATER);
        }
      expect(heights.size).toBe(1);
    }
  });

  it("paints terrain 16 on the line until the end of the terrain stage, which restores each tile's earlier terrain (co1)", () => {
    const run = place(
      HEAD +
        "create_land { terrain_type DIRT land_position 50 50 number_of_tiles 6000 base_size 3 }\n" +
        "<CLIFF_GENERATION>\nmin_number_of_cliffs 20\nmax_number_of_cliffs 26\nmin_distance_cliffs 1\n",
      2,
    );
    expect(run.lineTiles.size).toBeGreaterThan(0);
    for (const [i] of run.lineTiles) {
      expect(run.grid.terrain[i]).toBe(CLIFF_LINE_TERRAIN);
      expect(run.grid.cliff[i]).toBe(1);
    }
    expect(run.grid.cliff.filter((c) => c !== 0).length).toBe(
      run.lineTiles.size,
    );
    finishTerrainStage(run.grid, run.lineTiles, WATER);
    expect(run.grid.terrain.includes(CLIFF_LINE_TERRAIN)).toBe(false);
    const DIRT = id("DIRT");
    expect([...run.lineTiles.values()].some((t) => t === DIRT)).toBe(true);
    for (const [i, earlier] of run.lineTiles)
      expect(run.grid.terrain[i]).toBe(earlier);
  });
});

describe("corpus: applyCliffs never throws", () => {
  const corpusDir = join(REPO_ROOT, "test-maps");
  const corpusFiles = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of corpusFiles) {
    it(
      name,
      () => {
        const source = readFileSync(join(corpusDir, name), "utf8");
        expect(() => place(source, 12345, "Normal", 8)).not.toThrow();
      },
      15000,
    );
  }
});
