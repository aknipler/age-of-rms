// S2, the elevation stage (preview-design Sec.6.2, rev 10).
//
// `deElevationCliffMaps.test.ts` is the real gate. It holds this stage to 51
// saved DE maps tile for tile, which covers the layers, the lists and their
// stale links, the shuffle, the seeds and growth draw by draw. This file
// checks the properties a reader can state without a DE map, on scripts and
// lobbies the fixture never ran, and that the stage runs on the whole corpus.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import {
  createTileGrid,
  type TerrainConstantForMasks,
} from "../generator/grid";
import {
  placeLandOrigins,
  growLands,
  finishLandStage,
  baseElevationNotes,
} from "../generator/lands";
import { applyElevation, smoothElevation } from "../generator/elevation";
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
const GRASS = constants.find((c) => c.rmsConstant === "GRASS")!.constId!;

/** The real pipeline through S2, the same calls `generatePreview` makes in the same order. */
function place(
  source: string,
  seed = 1,
  mapSize: MapSize = "Tiny",
  playerCount = 2,
) {
  const instantiated: InstantiatedScript = instantiateScript(
    parseRms(source, lang),
    refDb,
    { playerCount, mapSize, teams: DEFAULT_TEAMS },
    seed,
  );
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
  const landHeights = grid.elevation.slice();
  const result = applyElevation(
    instantiated,
    grid,
    constants,
    land.origins,
    landStream,
  );
  return {
    grid,
    dim: instantiated.dim,
    origins: land.origins,
    instantiated,
    landStream,
    landHeights,
    ...result,
  };
}

/** The largest height difference between a tile and any of its 8 neighbours. */
function steepestStep(e: ArrayLike<number>, dim: number): number {
  let worst = 0;
  for (let y = 0; y < dim; y++)
    for (let x = 0; x < dim; x++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= dim || ny >= dim) continue;
          worst = Math.max(worst, Math.abs(e[y * dim + x] - e[ny * dim + nx]));
        }
  return worst;
}

const RAISED_LAND =
  "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n" +
  "create_land { terrain_type DESERT land_position 50 50 number_of_tiles 400 base_size 4 base_elevation 6 }\n";

describe("no <ELEVATION_GENERATION> section", () => {
  it("takes no draw and changes nothing", () => {
    const run = place(RAISED_LAND, 7);
    expect(run.stream).toEqual(run.landStream);
    expect(Array.from(run.grid.elevation)).toEqual(Array.from(run.landHeights));
    expect(run.reports).toEqual([]);
  });

  it("leaves a raised land standing in a sheer step, as DE saved lh2, and says so", () => {
    const run = place(RAISED_LAND, 7);
    expect(steepestStep(run.grid.elevation, run.dim)).toBe(6);
    const notes = baseElevationNotes(run.instantiated, run.origins);
    expect(notes.map((n) => n.key)).toEqual([
      `baseElevationNoSection:${run.origins[0].commandSpan.start}`,
    ]);
  });

  it("raises the land wider than its terrain, through the leftover fill's rim", () => {
    const run = place(RAISED_LAND, 7);
    const DESERT = constants.find((c) => c.rmsConstant === "DESERT")!.constId!;
    let raisedGrass = 0;
    for (let i = 0; i < run.grid.elevation.length; i++)
      if (run.grid.elevation[i] === 6 && run.grid.terrain[i] !== DESERT)
        raisedGrass++;
    expect(raisedGrass).toBeGreaterThan(0);
  });
});

describe("a present section", () => {
  it("smooths even with no create_elevation in it, and burns its draw", () => {
    const run = place(RAISED_LAND + "<ELEVATION_GENERATION>\n", 7);
    expect(steepestStep(run.grid.elevation, run.dim)).toBe(1);
    expect(run.stream.count).toBe(run.landStream.count + 1);
    expect(baseElevationNotes(run.instantiated, run.origins).length).toBe(0);
  });

  it("keeps a plateau below 8 at its full height and ramps down to the base around it (lh1)", () => {
    const run = place(
      RAISED_LAND +
        "<ELEVATION_GENERATION>\ncreate_elevation 1 { base_terrain GRASS number_of_tiles 50 }\n",
      7,
    );
    const { x, y } = run.origins[0];
    expect(run.grid.elevation[y * run.dim + x]).toBe(6);
    expect(Math.max(...run.grid.elevation)).toBe(6);
    expect(steepestStep(run.grid.elevation, run.dim)).toBe(1);
  });
});

describe("layers", () => {
  const HILLS =
    "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<ELEVATION_GENERATION>\n";

  it("never add up. Repeating create_elevation 3 only fills more of heights 1 to 3", () => {
    const once = place(
      HILLS + "create_elevation 3 { number_of_tiles 600 number_of_clumps 4 }\n",
      3,
    );
    const thrice = place(
      HILLS +
        "create_elevation 3 { number_of_tiles 600 number_of_clumps 4 }\n".repeat(
          3,
        ),
      3,
    );
    expect(Math.max(...once.grid.elevation)).toBe(3);
    expect(Math.max(...thrice.grid.elevation)).toBe(3);
    const raised = (g: TileGrid) => g.elevation.filter((h) => h > 0).length;
    expect(raised(thrice.grid)).toBeGreaterThan(raised(once.grid));
  });

  it("create_elevation 0 makes no layer and raises nothing", () => {
    const run = place(
      HILLS + "create_elevation 0 { number_of_tiles 600 }\n",
      3,
    );
    expect(run.grid.elevation.every((h) => h === 0)).toBe(true);
    expect(run.reports).toHaveLength(1);
    expect(run.reports[0].attempted).toBe(0);
  });

  it("number_of_tiles defaults to the map width, so a bare command raises about 120 tiles on Tiny", () => {
    const run = place(HILLS + "create_elevation 1 { }\n", 3);
    const raised = run.grid.elevation.filter((h) => h > 0).length;
    expect(raised).toBeGreaterThanOrEqual(120);
    expect(raised).toBeLessThan(160);
  });

  it("a negative count takes back the layers made so far", () => {
    const run = place(
      HILLS +
        "create_elevation 3 { number_of_tiles 600 }\ncreate_elevation -2\n",
      3,
    );
    expect(Math.max(...run.grid.elevation)).toBe(1);
  });

  it("is the same map for the same seed, and a different one for another seed", () => {
    const script =
      HILLS + "create_elevation 2 { number_of_tiles 900 number_of_clumps 5 }\n";
    const a = place(script, 11).grid.elevation;
    const b = place(script, 11).grid.elevation;
    const c = place(script, 12).grid.elevation;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe("player land origins", () => {
  it("never get a hill within 6 tiles, where every growth roll refuses", () => {
    const script =
      "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n" +
      "create_player_lands { terrain_type GRASS base_size 3 number_of_tiles 50 }\n" +
      "<ELEVATION_GENERATION>\ncreate_elevation 1 { number_of_tiles 6000 number_of_clumps 40 }\n";
    for (const seed of [1, 2, 3]) {
      const run = place(script, seed, "Tiny", 4);
      expect(run.grid.elevation.filter((h) => h > 0).length).toBeGreaterThan(
        1000,
      );
      for (const origin of run.origins) {
        if (origin.player === undefined) continue;
        for (let dy = -6; dy <= 6; dy++)
          for (let dx = -6; dx <= 6; dx++) {
            if (dx * dx + dy * dy >= 49) continue;
            const x = origin.x + dx;
            const y = origin.y + dy;
            if (x < 0 || y < 0 || x >= run.dim || y >= run.dim) continue;
            expect(run.grid.elevation[y * run.dim + x]).toBe(0);
          }
      }
    }
  });
});

describe("reports", () => {
  it("one per create_elevation, with terrainAbsent for a terrain nothing knows", () => {
    const run = place(
      "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<ELEVATION_GENERATION>\n" +
        "create_elevation 1 { base_terrain NO_SUCH_TERRAIN }\ncreate_elevation 1 { }\n",
      3,
    );
    expect(run.reports).toHaveLength(2);
    expect(run.reports[0].failures.map((f) => f.bucket)).toContain(
      "terrainAbsent",
    );
    expect(run.reports[1].failures).toEqual([]);
    expect(run.reports[1].placed).toBe(1);
  });

  it("noValidTiles when a layer finds no room for its clumps", () => {
    const run = place(
      "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<ELEVATION_GENERATION>\n" +
        "create_elevation 1 { base_terrain DESERT number_of_clumps 3 }\n",
      3,
    );
    expect(run.reports[0].placed).toBe(0);
    expect(run.reports[0].failures.map((f) => f.bucket)).toEqual([
      "noValidTiles",
    ]);
  });
});

describe("smoothElevation (3.5)", () => {
  it("leaves no step of more than one level between neighbours below 8", () => {
    const dim = 40;
    const e = new Uint8Array(dim * dim);
    let s = 12345;
    for (let i = 0; i < e.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      e[i] = (s >>> 16) % 8;
    }
    smoothElevation(e, dim);
    expect(steepestStep(e, dim)).toBeLessThanOrEqual(1);
  });

  it("raises a tile pinched between two higher ones", () => {
    const dim = 5;
    const e = new Uint8Array(dim * dim);
    e[2 * dim + 1] = 1;
    e[2 * dim + 3] = 1;
    smoothElevation(e, dim);
    expect(e[2 * dim + 2]).toBe(1);
  });

  it("at 8 and above, pulls the higher neighbours of a pinched tile down to it instead", () => {
    const dim = 5;
    const e = new Uint8Array(dim * dim).fill(8);
    e[2 * dim + 1] = 9;
    e[2 * dim + 3] = 9;
    smoothElevation(e, dim);
    expect(e[2 * dim + 1]).toBe(8);
    expect(e[2 * dim + 3]).toBe(8);
  });
});

describe("corpus: applyElevation never throws", () => {
  // One `it()` per map, so each map gets its own timeout (see the lands.ts
  // growth session's corpus-gate fix in docs/build-log.md).
  const corpusDir = join(REPO_ROOT, "test-maps");
  const corpusFiles = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of corpusFiles) {
    // 15s rather than vitest's 5s default, the corpus convention elsewhere,
    // since a per-map gate runs under full-suite parallel load.
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
