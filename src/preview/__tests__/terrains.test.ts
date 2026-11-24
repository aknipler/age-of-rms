// S4, the terrain stage (preview-design Sec.6.4, rev 11). The exact model is
// held to DE by `deWholeScriptMaps.test.ts`, tile for tile on every terrain
// map of the study. The tests here pin the rules one at a time, each on a
// script small enough to reason about, so a failure names the rule rather
// than a map.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import {
  NO_LAYER,
  createTileGrid,
  type TerrainConstantForMasks,
} from "../generator/grid";
import {
  placeLandOrigins,
  growLands,
  paintLandTerrain,
} from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import { applyCliffs } from "../generator/cliffs";
import {
  NO_BEACH_MARK,
  applyAutomaticBeach,
  applyTerrains,
  clearBeachLayers,
  resolveComposites,
  paintedView,
  COMPOSITE_AS_TERRAIN,
  COMPOSITE_AS_LAYER,
  terrainAmount,
} from "../generator/terrains";
import type { InstantiatedScript, TileGrid } from "../generator/types";
import {
  DEFAULT_TEAMS,
  type MapSize,
  type TeamNumber,
} from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const rawConstants = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "game-constants.json"),
    "utf8",
  ),
) as { constants: TerrainConstantForMasks[] };
const constants: TerrainConstantForMasks[] = rawConstants.constants;
const id = (name: string): number =>
  constants.find((c) => c.rmsConstant === name)!.constId!;
const GRASS = id("GRASS");
const WATER = id("WATER");
const DIRT = id("DIRT");
const DESERT = id("DESERT");
const SNOW = id("SNOW");

function settings(
  overrides: {
    playerCount?: number;
    mapSize?: MapSize;
    teams?: readonly TeamNumber[];
  } = {},
) {
  return {
    playerCount: overrides.playerCount ?? 2,
    mapSize: overrides.mapSize ?? "Tiny",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

/** S0 through S4, the terrain stage included and its end left out. */
function place(
  source: string,
  seed = 1,
  overrides?: Parameters<typeof settings>[0],
) {
  const instantiated: InstantiatedScript = instantiateScript(
    parseRms(source, lang),
    refDb,
    settings(overrides),
    seed,
  );
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const landResult = placeLandOrigins(instantiated, grid, constants);
  const grown = growLands(
    landResult.origins,
    grid,
    landResult.reports,
    landResult.stream,
  );
  paintLandTerrain(landResult.origins, grid);
  const elevated = applyElevation(
    instantiated,
    grid,
    constants,
    landResult.origins,
    grown,
  );
  const cliffed = applyCliffs(
    instantiated,
    grid,
    constants,
    landResult.origins,
    elevated.stream,
  );
  const terrainsResult = applyTerrains(
    instantiated,
    grid,
    constants,
    landResult.origins,
    cliffed.stream,
  );
  return {
    grid,
    dim: instantiated.dim,
    origins: landResult.origins,
    before: cliffed.stream,
    ...terrainsResult,
  };
}

function firstTerrainCommand(source: string) {
  const instantiated = instantiateScript(
    parseRms(source, lang),
    refDb,
    settings(),
    1,
  );
  const cmd = instantiated.sections
    .get("TERRAIN_GENERATION")
    ?.find((c) => c.name === "create_terrain");
  if (!cmd) throw new Error("fixture has no create_terrain command");
  return cmd;
}

const amountOf = (attributes: string, dim = 120) =>
  terrainAmount(
    firstTerrainCommand(
      `<TERRAIN_GENERATION>\ncreate_terrain DIRT { ${attributes} }\n`,
    ),
    dim,
  );

const count = (grid: TileGrid, terrain: number): number =>
  grid.terrain.filter((t) => t === terrain).length;

describe("terrainAmount (de-terrain-stage.md 2)", () => {
  it("defaults to the map's side and one clump, not the guide's 122", () => {
    expect(amountOf("")).toMatchObject({ tiles: 120, clumps: 1 });
  });

  it("reads a negative number_of_tiles as a percentage of the map (t3)", () => {
    expect(amountOf("number_of_tiles -5").tiles).toBe(720);
  });

  it("takes land_percent as a share of the whole map", () => {
    expect(amountOf("land_percent 10").tiles).toBe(1440);
    expect(amountOf("land_percent 0").tiles).toBe(0);
  });

  it("scales a count by either key, and the clumps only by groups (t3)", () => {
    expect(amountOf("number_of_tiles 200 set_scale_by_size")).toMatchObject({
      tiles: 288,
      clumps: 1,
    });
    expect(
      amountOf("number_of_tiles 200 number_of_clumps 3 set_scale_by_groups"),
    ).toMatchObject({ tiles: 288, clumps: 4 });
  });

  it("does not scale a percentage", () => {
    expect(amountOf("land_percent 10 set_scale_by_size").tiles).toBe(1440);
  });

  it("caps the clumps at 999 (gt7)", () => {
    expect(amountOf("number_of_clumps 9999").clumps).toBe(999);
  });
});

describe("applyTerrains on the game's stream (de-terrain-stage.md 1, 3 and 8)", () => {
  it("burns one draw with no <TERRAIN_GENERATION> section at all", () => {
    const result = place("<LAND_GENERATION>\nbase_terrain GRASS\n");
    expect(result.stream.count - result.before.count).toBe(1);
  });

  it("spends the shuffle's 2 * floor(W * H / 8) draws on a pass with no clumps", () => {
    const result = place(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { number_of_clumps 0 }\n",
    );
    expect(result.stream.count - result.before.count).toBe(
      1 + 2 * Math.floor((120 * 120) / 8),
    );
    expect(count(result.grid, DIRT)).toBe(0);
  });

  it("paints a little more than its target, because of the drain (t1)", () => {
    const { grid } = place(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { number_of_tiles 600 number_of_clumps 4 }\n",
      1000,
    );
    const painted = count(grid, DIRT);
    expect(painted).toBeGreaterThanOrEqual(600);
    expect(painted).toBeLessThan(660);
  });

  it("number_of_tiles 0 still paints one seed per clump (gt6)", () => {
    const { grid } = place(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { number_of_tiles 0 number_of_clumps 5 }\n",
    );
    expect(count(grid, DIRT)).toBe(5);
  });

  it("reports a pass that placed nothing, and stays quiet on the convert-everything idiom", () => {
    const absent = place(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { base_terrain SNOW number_of_tiles 50 }\n",
    );
    expect(absent.reports[0].failures.map((f) => f.bucket)).toEqual([
      "terrainAbsent",
    ]);
    const convert = place(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { land_percent 100 number_of_clumps 9320 }\n",
    );
    expect(convert.reports[0].failures).toEqual([]);
  });

  it("is the same map twice at one seed, and another at the next", () => {
    const source =
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT { number_of_tiles 300 number_of_clumps 6 }\n";
    const a = place(source, 1000).grid.terrain;
    const b = place(source, 1000).grid.terrain;
    const c = place(source, 1001).grid.terrain;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe("the base test and terrain_mask (de-terrain-stage.md 2, t8 and gt3)", () => {
  const land =
    "<LAND_GENERATION>\nbase_terrain GRASS\ncreate_land { terrain_type DESERT land_position 50 50 base_size 12 number_of_tiles 0 }\n";

  it("defaults base_terrain to GRASS", () => {
    const { grid } = place(
      `${land}<TERRAIN_GENERATION>\ncreate_terrain DIRT { land_percent 100 number_of_clumps 999 }\n`,
    );
    expect(count(grid, DESERT)).toBeGreaterThan(0);
    expect(count(grid, GRASS)).toBe(0);
  });

  it("terrain_mask 1 leaves the terrain and paints the layer", () => {
    const { grid } = place(
      `${land}<TERRAIN_GENERATION>\ncreate_terrain SNOW { base_terrain DESERT land_percent 100 number_of_clumps 999 terrain_mask 1 }\n`,
    );
    const masked = grid.layer.filter((l) => l === SNOW).length;
    expect(masked).toBeGreaterThan(0);
    expect(count(grid, SNOW)).toBe(0);
  });

  it("terrain_mask 2 takes the tile and moves the old terrain under it", () => {
    const { grid } = place(
      `${land}<TERRAIN_GENERATION>\ncreate_terrain SNOW { base_terrain DESERT land_percent 100 number_of_clumps 999 terrain_mask 2 }\n`,
    );
    const i = grid.terrain.findIndex((t) => t === SNOW);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(grid.layer[i]).toBe(DESERT);
  });

  it("needs both halves when base_terrain and base_layer are both written (gt3)", () => {
    const { grid } = place(
      `${land}<TERRAIN_GENERATION>\ncreate_terrain DIRT { base_terrain DESERT base_layer SNOW land_percent 100 number_of_clumps 999 }\n`,
    );
    // No DESERT tile carries a SNOW layer, so nothing qualifies.
    expect(count(grid, DIRT)).toBe(0);
  });

  it("an unpainted terrain, the plain paint, clears the layer", () => {
    const { grid } = place(
      `${land}<TERRAIN_GENERATION>\ncreate_terrain SNOW { base_terrain DESERT land_percent 100 number_of_clumps 999 terrain_mask 1 }\ncreate_terrain DIRT { base_terrain DESERT base_layer SNOW land_percent 100 number_of_clumps 999 }\n`,
    );
    const i = grid.terrain.findIndex((t) => t === DIRT);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(grid.layer[i]).toBe(NO_LAYER);
  });
});

describe("beaches wait for the end of the stage (de-terrain-stage.md 1 and 7)", () => {
  const coast =
    "<LAND_GENERATION>\nbase_terrain GRASS\ncreate_land { terrain_type WATER land_position 50 50 base_size 15 number_of_tiles 0 }\n";

  it("leaves the coast unbeached while create_terrain runs (gt1)", () => {
    const { grid } = place(
      `${coast}<TERRAIN_GENERATION>\ncreate_terrain DIRT { base_terrain BEACH land_percent 100 number_of_clumps 999 }\n`,
    );
    expect(count(grid, DIRT)).toBe(0);
    expect(count(grid, id("BEACH"))).toBe(0);
  });

  it("marks what a pass paints with its beach_terrain, and a later pass without one clears it (gt5)", () => {
    const { grid, beachMark } = place(
      `${coast}<TERRAIN_GENERATION>\ncreate_terrain DIRT { land_percent 100 number_of_clumps 999 beach_terrain DLC_BEACH2 }\n`,
    );
    const i = grid.terrain.findIndex((t) => t === DIRT);
    expect(beachMark[i]).toBe(id("DLC_BEACH2"));
    const again = place(
      `${coast}<TERRAIN_GENERATION>\ncreate_terrain DIRT { land_percent 100 number_of_clumps 999 beach_terrain DLC_BEACH2 }\ncreate_terrain SNOW { base_terrain DIRT land_percent 100 number_of_clumps 999 }\n`,
    );
    const j = again.grid.terrain.findIndex((t) => t === SNOW);
    expect(again.beachMark[j]).toBe(NO_BEACH_MARK);
  });

  it("the end-of-stage beach reads the mark (t7)", () => {
    const { grid, beachMark } = place(
      `${coast}<TERRAIN_GENERATION>\ncreate_terrain DIRT { land_percent 100 number_of_clumps 999 beach_terrain DLC_BEACH2 }\n`,
    );
    applyAutomaticBeach(grid, constants, { beachMark });
    expect(count(grid, id("DLC_BEACH2"))).toBeGreaterThan(0);
    expect(count(grid, id("BEACH"))).toBe(0);
  });
});

describe("composite terrains and layers at the end (de-findings-cg-cj.md 5)", () => {
  it("shows a composite as its primary over its secondary, and remembers it as painted", () => {
    const grid = createTileGrid(4, 62);
    grid.terrain[1] = GRASS;
    grid.layer[1] = 34;
    const record = resolveComposites(grid);
    expect([grid.terrain[0], grid.layer[0]]).toEqual([77, 60]);
    expect(record.kind[0]).toBe(COMPOSITE_AS_TERRAIN);
    // A composite as the layer resolves too, and is remembered as a layer.
    expect([grid.terrain[1], grid.layer[1]]).toEqual([0, 32]);
    expect(record.kind[1]).toBe(COMPOSITE_AS_LAYER);
    // The painted view gives later stages both back as painted.
    const view = paintedView(grid, record);
    expect([view.terrain[0], view.terrain[1], view.layer[1]]).toEqual([
      62,
      GRASS,
      34,
    ]);
    expect(grid.terrain[0]).toBe(77);
  });

  it("a beach tile loses its layer, a shallows tile keeps its own", () => {
    const grid = createTileGrid(2, id("BEACH"), SNOW);
    grid.terrain[1] = id("SHALLOW");
    clearBeachLayers(grid, constants);
    expect(grid.layer[0]).toBe(NO_LAYER);
    expect(grid.layer[1]).toBe(SNOW);
  });

  it("the beach reads the resolved terrain, so a resolved 77 beside water becomes beach", () => {
    const grid = createTileGrid(6, 62);
    for (let y = 0; y < 6; y++) grid.terrain[y * 6] = WATER;
    resolveComposites(grid);
    applyAutomaticBeach(grid, constants);
    expect(grid.terrain[1]).toBe(id("BEACH"));
  });
});

describe("applyAutomaticBeach (engine behaviour, not a command)", () => {
  const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
  const ICYSHORE = constants.find((c) => c.constId === 37)!.constId!;
  const SNOW = constants.find((c) => c.rmsConstant === "SNOW")!.constId!;

  /** Left half water, right half `landId`, so the coastline is the column at x = dim/2. */
  function splitGrid(landId: number, dim = 20) {
    const grid = createTileGrid(dim, landId);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim / 2; x++) grid.terrain[y * dim + x] = WATER;
    }
    return grid;
  }

  it("lays one tile of beach along the land side of the coastline, and only there", () => {
    const grid = splitGrid(GRASS);
    const written = applyAutomaticBeach(grid, constants);
    const dim = grid.dim;
    expect(written).toBe(dim); // exactly the one column that touches water
    for (let y = 0; y < dim; y++) {
      expect(grid.terrain[y * dim + dim / 2]).toBe(BEACH); // the shore
      expect(grid.terrain[y * dim + dim / 2 + 1]).toBe(GRASS); // one tile inland
      expect(grid.terrain[y * dim + dim / 2 - 1]).toBe(WATER); // the water side is untouched
    }
  });

  it("uses the terrain's own beach: snow gets ICYSHORE, not BEACH", () => {
    // The community table states this on ICYSHORE's own row, "created when
    // snowy terrains border water", the reason the field is per-terrain
    // rather than one global constant.
    const grid = splitGrid(SNOW);
    applyAutomaticBeach(grid, constants);
    expect(grid.terrain[5 * grid.dim + grid.dim / 2]).toBe(ICYSHORE);
  });

  it("does not grow a beach on a beach", () => {
    const grid = splitGrid(BEACH);
    expect(applyAutomaticBeach(grid, constants)).toBe(0);
  });

  it("does nothing on a map with no water at all", () => {
    const grid = createTileGrid(20, GRASS);
    expect(applyAutomaticBeach(grid, constants)).toBe(0);
  });

  // ---- three depths: land / shallows / open water -------------------------
  //
  // Depth decides which side of a boundary is LAND, and only the landward
  // boundary is edged: a shallows band running from a coast out to sea reads
  // sand, shallow, shallow, sea. `bands()` builds that cross-section as
  // vertical columns and the assertions read one row of it.
  //
  // The seaward half was shipped on 2026-08-08 and withdrawn on 2026-08-12
  // after RMSTEST_52 measured 3 and 2 tiles on the shallows/water boundary
  // against 336/312 and 30/90 on the other two (BUG-010).

  const SHALLOW = constants.find((c) => c.rmsConstant === "SHALLOW")!.constId!;
  const DEEP_WATER = constants.find(
    (c) => c.rmsConstant === "DEEP_WATER",
  )!.constId!;
  const MANGROVESHALLOW = constants.find(
    (c) => c.rmsConstant === "DLC_MANGROVESHALLOW",
  )!.constId!;
  const ICE_NAVIGABLE = 26;

  /** One terrain id per column, repeated down every row. Returns the grid and a reader for one row of it. */
  function bands(columns: readonly number[]) {
    const dim = columns.length;
    const grid = createTileGrid(dim, columns[0]);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) grid.terrain[y * dim + x] = columns[x];
    }
    return {
      grid,
      row: () => Array.from(grid.terrain.slice(2 * dim, 3 * dim)),
    };
  }

  it("beaches the LANDWARD boundary of a shallows band and leaves the seaward one bare (BUG-010)", () => {
    const { grid, row } = bands([
      GRASS,
      GRASS,
      SHALLOW,
      SHALLOW,
      DEEP_WATER,
      DEEP_WATER,
    ]);
    applyAutomaticBeach(grid, constants);
    // The land tile touching the shallows takes sand. The shallow touching the
    // deep does NOT. That is the half the engine turned out not to do, and
    // this row is the assertion that was inverted to say so.
    expect(row()).toEqual([
      GRASS,
      BEACH,
      SHALLOW,
      SHALLOW,
      DEEP_WATER,
      DEEP_WATER,
    ]);
  });

  it("leaves a shallow alone where it only ever faces land", () => {
    // A river crossing: shallows cut through land with no open water anywhere.
    // Nothing here is deeper than a shallow, so only the land banks are edged.
    const { grid, row } = bands([GRASS, GRASS, SHALLOW, SHALLOW, GRASS, GRASS]);
    applyAutomaticBeach(grid, constants);
    expect(row()).toEqual([GRASS, BEACH, SHALLOW, SHALLOW, BEACH, GRASS]);
  });

  it("is stable: running the pass again writes nothing", () => {
    // The beach lands on the shallower tile and a beach terrain's own row
    // carries `beachTerrain: null`, so the strip cannot creep another tile
    // inward on the next of the many passes a script triggers.
    const { grid, row } = bands([
      GRASS,
      GRASS,
      SHALLOW,
      SHALLOW,
      DEEP_WATER,
      DEEP_WATER,
    ]);
    applyAutomaticBeach(grid, constants);
    const settled = row();
    expect(applyAutomaticBeach(grid, constants)).toBe(0);
    expect(row()).toEqual(settled);
  });

  it("edges land against a hybrid the water flag calls DRY — which is why the depth mask survives BUG-010", () => {
    // DLC_MANGROVESHALLOW is `isWater: false` (it is buildable, walkable
    // ground) and the community table still calls it a shallow. Under an
    // `isWater`-only test this coast gets no beach at all, which is the gap the
    // depth model was introduced to close and the reason dropping the seaward
    // half is not the same as reverting to two values.
    const { grid, row } = bands([
      GRASS,
      GRASS,
      MANGROVESHALLOW,
      MANGROVESHALLOW,
      DEEP_WATER,
      DEEP_WATER,
    ]);
    applyAutomaticBeach(grid, constants);
    expect(row()).toEqual([
      GRASS,
      BEACH,
      MANGROVESHALLOW,
      MANGROVESHALLOW,
      DEEP_WATER,
      DEEP_WATER,
    ]);
  });

  it("the beach a boundary grows is the LAND side's own: snow against navigable ice gets ICYSHORE", () => {
    // Same per-terrain rule the snow case above proves against open water, now
    // against a hybrid. The beach terrain comes from the tile it lands on.
    const { grid, row } = bands([
      SNOW,
      SNOW,
      ICE_NAVIGABLE,
      ICE_NAVIGABLE,
      DEEP_WATER,
      DEEP_WATER,
    ]);
    applyAutomaticBeach(grid, constants);
    expect(row()).toEqual([
      SNOW,
      ICYSHORE,
      ICE_NAVIGABLE,
      ICE_NAVIGABLE,
      DEEP_WATER,
      DEEP_WATER,
    ]);
  });

  it("does not edge one open water against another, however different their depths look", () => {
    // WATER and DEEP_WATER are both open water and both DEPTH_WATER: the
    // gradient a script paints between them is cosmetic, and the engine has no
    // beach to put there.
    const { grid, row } = bands([WATER, WATER, DEEP_WATER, DEEP_WATER]);
    expect(applyAutomaticBeach(grid, constants)).toBe(0);
    expect(row()).toEqual([WATER, WATER, DEEP_WATER, DEEP_WATER]);
  });

  it("reads water from a mask taken before any write, so a new beach cannot make its neighbour look inland", () => {
    // Two water columns with one land column between them: BOTH sides of that
    // land column touch water, and writing the first must not change what the
    // second sees.
    const dim = 20;
    const grid = createTileGrid(dim, GRASS);
    for (let y = 0; y < dim; y++) {
      grid.terrain[y * dim + 4] = WATER;
      grid.terrain[y * dim + 6] = WATER;
    }
    applyAutomaticBeach(grid, constants);
    for (let y = 0; y < dim; y++) {
      expect(grid.terrain[y * dim + 5]).toBe(BEACH);
      expect(grid.terrain[y * dim + 3]).toBe(BEACH);
      expect(grid.terrain[y * dim + 7]).toBe(BEACH);
      expect(grid.terrain[y * dim + 8]).toBe(GRASS);
    }
  });

  it("lays a 45 degree coast two tiles deep, because a diagonal neighbour counts (RMSTEST_75)", () => {
    // Water fills the triangle x + y < 8, so the coast is a staircase. The
    // tiles on x + y = 8 touch water at a side. The tiles on x + y = 9 touch
    // it only at a corner, which is the case a 4 connected test misses and
    // DE beaches anyway. Nothing on x + y = 10 reaches the water. The two
    // ends of the x + y = 9 line sit on the map edge, where the corner that
    // would touch water is off the map, so they stay grass. DE's RMSTEST_75
    // has the same single beach tile where its cut meets row 0.
    const dim = 12;
    const grid = createTileGrid(dim, GRASS);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        if (x + y < 8) grid.terrain[y * dim + x] = WATER;
      }
    }
    applyAutomaticBeach(grid, constants);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const sum = x + y;
        const onEdge = x === 0 || y === 0;
        const expected =
          sum < 8 ? WATER : sum === 8 || (sum === 9 && !onEdge) ? BEACH : GRASS;
        expect(grid.terrain[y * dim + x], `tile ${x},${y}`).toBe(expected);
      }
    }
  });
});

describe("corpus: applyTerrains never throws", () => {
  // One `it()` per map, matching the established convention (see build log).
  const corpusDir = join(REPO_ROOT, "test-maps");
  const corpusFiles = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of corpusFiles) {
    // 15s rather than vitest's 5s default, the convention connections.test.ts
    // and index.test.ts already use for their own corpus loops. These maps
    // are not slow in isolation -- the whole 32-map corpus generates end to
    // end in about 21s -- but a per-map gate runs under full-suite parallel
    // load, where the same work takes several times as long. Every one of
    // these files learned that the same way: a test that passes alone and
    // fails in the suite is measuring the machine, not the code (CLAUDE.md's
    // own wall-clock lesson).
    it(
      name,
      () => {
        const source = readFileSync(join(corpusDir, name), "utf8");
        expect(() => place(source, 12345)).not.toThrow();
      },
      15000,
    );
  }
});

describe("rice farms count as shallows for the automatic beach", () => {
  // RMSTEST-RiceFarm-create-beach at seed 675322: land beside a rice farm
  // is beached by DE, and the preview matched it on all 14,400 tiles once
  // the five rice farm terrains (63 to 67) carried `isHybrid`.
  it("beaches the land beside a rice farm, and leaves the farm alone", () => {
    const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
    const grid = createTileGrid(6, 62);
    for (let y = 0; y < 6; y++) grid.terrain[y * 6 + 5] = 64;
    applyAutomaticBeach(grid, constants);
    expect(grid.terrain[4]).toBe(BEACH);
    expect(grid.terrain[5]).toBe(64);
    expect(grid.terrain[0]).toBe(62);
  });
});
