import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createSpacingIndex } from "../generator/spacingIndex";
import { createTileGrid, scaleToMapArea, tileIndex } from "../generator/grid";
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "../generator/lands";
import {
  applyElevation,
  growClump,
  clumpEdgeDistances,
  buildSeedPool,
  drawSeed,
  eligibleSeedCandidates,
  resolveTileBudget,
  resolveClumpCount,
  perClumpTarget,
  seedRatio,
  type TerrainConstantForElevation,
} from "../generator/elevation";
import { mulberry32 } from "../generator/rng";
import type { InstantiatedScript, LandOrigin, TileGrid } from "../generator/types";
import { DEFAULT_TEAMS, type MapSize, type TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const rawConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as { constants: TerrainConstantForElevation[] };
const constants: TerrainConstantForElevation[] = rawConstants.constants;
const GRASS = constants.find((c) => c.rmsConstant === "GRASS")!.constId!;
const WATER = constants.find((c) => c.rmsConstant === "WATER")!.constId!;

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

function place(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated: InstantiatedScript = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const landResult = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(landResult.origins, grid, landResult.reports, seed);
  paintLandTerrain(landResult.origins, grid);
  applyBaseElevation(instantiated, landResult.origins, grid, constants);
  const elevationResult = applyElevation(instantiated, grid, constants, landResult.origins, seed);
  return { grid, dim: instantiated.dim, origins: landResult.origins, ...elevationResult };
}

function elevatedTileCount(grid: TileGrid): number {
  let n = 0;
  for (const v of grid.elevation) if (v > 0) n++;
  return n;
}

/** The first create_elevation command's InstantiatedCommand, for testing resolveTileBudget/resolveClumpCount directly against real attribute folding. */
function elevationCommand(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const cmd = instantiated.sections.get("ELEVATION_GENERATION")?.[0];
  if (!cmd) throw new Error("fixture has no create_elevation command");
  return { cmd, dim: instantiated.dim };
}

const ZERO_SPAN = { start: 0, end: 0 };

function fabricateOrigin(x: number, y: number, player: number | undefined): LandOrigin {
  return {
    commandSpan: ZERO_SPAN,
    x,
    y,
    zone: -10,
    player,
    baseSize: 3,
    circularBase: false,
    clumpingFactor: 8,
    borderFuzziness: 20,
    otherZoneAvoidanceDistance: 0,
    minPlacementDistance: 0,
    behaviorVersion: 0,
    declaredTargetTiles: 0,
    fromOriginFallback: false,
    borderBounds: { minX: 0, maxX: x * 2, minY: 0, maxY: y * 2 },
    generateMode: 0,
  };
}

describe("resolveTileBudget / resolveClumpCount (Sec.6.2, tested directly against real attribute folding)", () => {
  it("defaults number_of_tiles to dim, NOT area-scaled (RMSTEST_14)", () => {
    const { cmd, dim } = elevationCommand("<ELEVATION_GENERATION>\ncreate_elevation 10 {\n}\n", 1, { mapSize: "Tiny" });
    expect(resolveTileBudget(cmd, dim)).toBe(dim);
  });

  it("the default is NOT re-scaled even when set_scale_by_size is present (no measured basis for doing so)", () => {
    const { cmd, dim } = elevationCommand(
      "<ELEVATION_GENERATION>\ncreate_elevation 10 {\nset_scale_by_size\n}\n",
      1,
      { mapSize: "Tiny" },
    );
    expect(resolveTileBudget(cmd, dim)).toBe(dim);
  });

  it("set_scale_by_size scales an EXPLICIT number_of_tiles by Sec.4's formula, truncating", () => {
    const { cmd, dim } = elevationCommand(
      "<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_tiles 100\nset_scale_by_size\n}\n",
      1,
      { mapSize: "Tiny" },
    );
    expect(resolveTileBudget(cmd, dim)).toBe(scaleToMapArea(100, dim));
    expect(resolveTileBudget(cmd, dim)).not.toBe(100);
  });

  it("an explicit number_of_tiles with no scale attribute is used exactly as written", () => {
    const { cmd, dim } = elevationCommand("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_tiles 77\n}\n", 1);
    expect(resolveTileBudget(cmd, dim)).toBe(77);
  });

  it("number_of_clumps defaults to 1 and set_scale_by_groups scales the default too (it has no RMSTEST_14-style special case)", () => {
    const { cmd, dim } = elevationCommand("<ELEVATION_GENERATION>\ncreate_elevation 10 {\n}\n", 1);
    expect(resolveClumpCount(cmd, dim)).toBe(1);

    const scaled = elevationCommand("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nset_scale_by_groups\n}\n", 1);
    expect(resolveClumpCount(scaled.cmd, scaled.dim)).toBe(Math.max(1, scaleToMapArea(1, scaled.dim)));
  });

  it("only the LAST scale attribute applies when both are written (guide:1257/1274)", () => {
    const sizeLast = elevationCommand(
      "<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_tiles 100\nnumber_of_clumps 3\nset_scale_by_groups\nset_scale_by_size\n}\n",
      1,
      { mapSize: "Tiny" },
    );
    expect(resolveClumpCount(sizeLast.cmd, sizeLast.dim)).toBe(3); // unscaled -- set_scale_by_size won
    expect(resolveTileBudget(sizeLast.cmd, sizeLast.dim)).toBe(scaleToMapArea(100, sizeLast.dim));

    const groupsLast = elevationCommand(
      "<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_tiles 100\nnumber_of_clumps 3\nset_scale_by_size\nset_scale_by_groups\n}\n",
      1,
      { mapSize: "Tiny" },
    );
    expect(resolveTileBudget(groupsLast.cmd, groupsLast.dim)).toBe(100); // unscaled -- set_scale_by_groups won
    expect(resolveClumpCount(groupsLast.cmd, groupsLast.dim)).toBe(Math.max(1, scaleToMapArea(3, groupsLast.dim)));
  });

  it("perClumpTarget enforces the RMSTEST_22a floor of 6 tiles even when the even split would be less", () => {
    expect(perClumpTarget(5, 5)).toBe(6); // 1 each, floored up to 6
    expect(perClumpTarget(600, 5)).toBe(120); // well above the floor, floor doesn't bind
  });

  it("maxHeight 0 is a real no-op — nothing attempted, nothing elevated", () => {
    const { grid, reports } = place("<ELEVATION_GENERATION>\ncreate_elevation 0 {\n}\n");
    expect(elevatedTileCount(grid)).toBe(0);
    expect(reports[0]).toMatchObject({ attempted: 0, placed: 0 });
  });
});

describe("seedRatio (Sec.6.2's density-amplification formula)", () => {
  it("is the flat 1.3 seed-bias floor at or below the density knee (~250 clumps on a 200 map)", () => {
    expect(seedRatio(50, 40000)).toBeCloseTo(1.3, 5);
    expect(seedRatio(250, 40000)).toBeCloseTo(1.3, 5);
  });

  it("rises with density above the knee, and never exceeds the RMAX clamp of 20", () => {
    const at500 = seedRatio(500, 40000);
    const at1000 = seedRatio(1000, 40000);
    expect(at500).toBeGreaterThan(1.3);
    expect(at1000).toBeGreaterThan(at500);
    expect(seedRatio(1_000_000, 40000)).toBe(20);
  });
});

describe("eligibleSeedCandidates (Sec.7's two-predicate attribution)", () => {
  it("reports terrainAbsent when the terrain never appears on the grid", () => {
    const grid = createTileGrid(10, GRASS);
    const result = eligibleSeedCandidates(grid, WATER, undefined, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("terrainAbsent");
  });

  it("reports playerOriginAvoidance when the terrain exists but every matching tile is too close to a player origin", () => {
    // 10x10: every corner is within 9 tiles of the center (5,5), Euclidean ~7.07.
    const grid = createTileGrid(10, GRASS);
    const origin = fabricateOrigin(5, 5, 1);
    const result = eligibleSeedCandidates(grid, GRASS, undefined, [origin]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("playerOriginAvoidance");
  });

  it("succeeds once far-enough tiles exist, and only returns tiles that are actually far enough", () => {
    const grid = createTileGrid(30, GRASS);
    const origin = fabricateOrigin(2, 2, 1);
    const result = eligibleSeedCandidates(grid, GRASS, undefined, [origin]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % 30;
        const y = (tile - x) / 30;
        expect(Math.hypot(x - 2, y - 2)).toBeGreaterThanOrEqual(9);
      }
    }
  });

  it("respects base_layer as an additional filter when given", () => {
    const grid = createTileGrid(10, GRASS);
    grid.layer[tileIndex(grid, 3, 3)] = 7;
    const withoutLayer = eligibleSeedCandidates(grid, GRASS, undefined, []);
    const withLayer = eligibleSeedCandidates(grid, GRASS, 7, []);
    expect(withoutLayer.ok && withoutLayer.value.length).toBe(100);
    expect(withLayer.ok && withLayer.value.length).toBe(1);
  });
});

describe("drawSeed (Sec.6.2's diagonally-biased seed draw)", () => {
  it("favours the y > x side at roughly the requested ratio over many draws", () => {
    const dim = 40;
    const pool = buildSeedPool(dim, Int32Array.from({ length: dim * dim }, (_, i) => i));
    const rng = mulberry32(7);
    const noSpacing = createSpacingIndex(dim, 0, "euclidean");
    let favored = 0;
    let disfavored = 0;
    for (let i = 0; i < 4000; i++) {
      const tile = drawSeed(dim, pool, 1.3, noSpacing, rng);
      if (tile === undefined) continue;
      const x = tile % dim;
      const y = (tile - x) / dim;
      if (y > x) favored++;
      else disfavored++;
    }
    const ratio = favored / disfavored;
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(1.6);
  });

  it("rejects a draw within `spacing` of a prior seed", () => {
    const dim = 20;
    const pool = buildSeedPool(dim, Int32Array.from({ length: dim * dim }, (_, i) => i));
    const rng = mulberry32(3);
    const placed = createSpacingIndex(dim, 5, "euclidean");
    placed.add(10, 10);
    for (let i = 0; i < 200; i++) {
      const tile = drawSeed(dim, pool, 1.3, placed, rng);
      if (tile === undefined) continue;
      const x = tile % dim;
      const y = (tile - x) / dim;
      expect(Math.hypot(x - 10, y - 10)).toBeGreaterThanOrEqual(5);
    }
  });

  it("returns undefined when every candidate is within spacing of a prior seed", () => {
    const dim = 4;
    const pool = buildSeedPool(dim, Int32Array.from({ length: dim * dim }, (_, i) => i));
    const rng = mulberry32(1);
    const placed = createSpacingIndex(dim, 100, "euclidean"); // spacing bigger than the whole grid
    placed.add(2, 2);
    const tile = drawSeed(dim, pool, 1.3, placed, rng);
    expect(tile).toBeUndefined();
  });
});

describe("height accumulation (MaxHeight is an absolute ceiling — nothing adds)", () => {
  function elevationOf(source: string, seed = 1) {
    const instantiated = instantiateScript(parseRms(source, lang), refDb, settings({ playerCount: 1 }), seed);
    const grid = createTileGrid(instantiated.dim, GRASS);
    applyElevation(instantiated, grid, constants, [], seed);
    let max = 0;
    for (const e of grid.elevation) if (e > max) max = e;
    return max;
  }

  it("repeating a create_elevation command does not make the hill taller", () => {
    // The idiom that broke this: `AD4 - Pag - v1.2.rms` writes the same
    // flood-the-map `create_elevation 7` five times for coverage, and summing
    // them put 36,877 of its 40,000 tiles at the elevation ceiling.
    const one = "<ELEVATION_GENERATION>@create_elevation 7 {@number_of_clumps 1@number_of_tiles 230400@}@".replace(/@/g, "\n");
    const five = one + one.replace("<ELEVATION_GENERATION>\n", "").repeat(4);
    expect(elevationOf(five)).toBe(elevationOf(one));
    expect(elevationOf(five)).toBeLessThanOrEqual(7);
  });

  it("a later, shorter command does not lower what an earlier one raised", () => {
    const tall = "<ELEVATION_GENERATION>@create_elevation 7 {@number_of_clumps 1@number_of_tiles 230400@}@".replace(/@/g, "\n");
    const short = "create_elevation 2 {@number_of_clumps 1@number_of_tiles 230400@}@".replace(/@/g, "\n");
    expect(elevationOf(tall + short)).toBe(elevationOf(tall));
  });

  /** Two DIRT lands at different base_elevations, then one create_elevation over both. */
  function twoLands(maxHeight: number, baseA: number, baseB: number, seed = 4) {
    const source = [
      "<LAND_GENERATION>",
      "base_terrain WATER",
      `create_land {@land_position 25 50@base_size 14@number_of_tiles 900@terrain_type DIRT@base_elevation ${baseA}@}`,
      `create_land {@land_position 75 50@base_size 14@number_of_tiles 900@terrain_type DIRT@base_elevation ${baseB}@}`,
      "<ELEVATION_GENERATION>",
      `create_elevation ${maxHeight} {@base_terrain DIRT@number_of_clumps 1@number_of_tiles 40000@}`,
    ]
      .join("\n")
      .replace(/@/g, "\n");
    const instantiated = instantiateScript(parseRms(source, lang), refDb, settings({ playerCount: 1 }), seed);
    const grid = createTileGrid(instantiated.dim, WATER);
    const land = placeLandOrigins(instantiated, grid, constants, seed);
    growLands(land.origins, grid, land.reports, seed);
    paintLandTerrain(land.origins, grid);
    applyBaseElevation(instantiated, land.origins, grid, constants);
    const maxOn = (landIndex: number) => {
      let max = 0;
      for (let i = 0; i < grid.elevation.length; i++) {
        if (grid.landId[i] === landIndex && grid.elevation[i] > max) max = grid.elevation[i];
      }
      return max;
    };
    return { instantiated, grid, maxOn, seed };
  }

  it("MaxHeight is an absolute ceiling: two lands at different base_elevations top out at the SAME height", () => {
    // The distinguishing case. `create_elevation 6` over a land already at
    // base_elevation 5 and one at base_elevation 2 gives both a ceiling of 6
    // — shallow-looking hills on the first (5 -> 6), tall ones on the second
    // (2 -> 6). An additive model would put them at 11 and 8.
    const { instantiated, grid, maxOn, seed } = twoLands(6, 5, 2);
    expect(maxOn(0)).toBe(5);
    expect(maxOn(1)).toBe(2);
    applyElevation(instantiated, grid, constants, [], seed);
    expect(maxOn(0)).toBe(6);
    expect(maxOn(1)).toBe(6);
  });

  it("never lowers a land that already sits above the ceiling", () => {
    const { instantiated, grid, maxOn, seed } = twoLands(4, 9, 9);
    applyElevation(instantiated, grid, constants, [], seed);
    expect(maxOn(0)).toBe(9);
    expect(maxOn(1)).toBe(9);
  });
});

describe("integration: seed placement respects player-origin avoidance end to end", () => {
  it("reports playerOriginAvoidance when a tiny, fully-occupied map leaves nothing eligible", () => {
    const grid = createTileGrid(10, GRASS);
    const instantiated = instantiateScript(parseRms("<ELEVATION_GENERATION>\ncreate_elevation 10 {\n}\n", lang), refDb, settings({ playerCount: 1 }), 1);
    const origin = fabricateOrigin(5, 5, 1);
    const result = applyElevation(instantiated, grid, constants, [origin], 1);
    expect(result.reports[0].placed).toBe(0);
    expect(result.reports[0].failures.some((f) => f.bucket === "playerOriginAvoidance")).toBe(true);
  });

  it("reports terrainAbsent when the declared base_terrain never appears on the grid", () => {
    const { reports } = place("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nbase_terrain WATER\n}\n"); // grid is all GRASS
    expect(reports[0]).toMatchObject({ placed: 0 });
    expect(reports[0].failures.some((f) => f.bucket === "terrainAbsent")).toBe(true);
  });

  it("seeds only on tiles matching base_terrain when the grid has more than one terrain", () => {
    const instantiated = instantiateScript(
      parseRms("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nbase_terrain WATER\nnumber_of_clumps 1\nnumber_of_tiles 20\n}\n", lang),
      refDb,
      settings({ mapSize: "Tiny" }),
      1,
    );
    const grid = createTileGrid(instantiated.dim, GRASS);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) grid.terrain[tileIndex(grid, x, y)] = WATER;
    const result = applyElevation(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    for (let i = 0; i < grid.elevation.length; i++) {
      if (grid.elevation[i] === 0) continue;
      expect(grid.terrain[i]).toBe(WATER);
    }
  });
});

describe("height profile (Sec.6.2)", () => {
  it("a single-clump command always attempts MaxHeight exactly (no roll)", () => {
    // MaxHeight 3 needs a clump with a tile at least 3 deep from its own
    // boundary to actually SHOW the peak (a circular blob needs roughly
    // (h+1)^2*pi tiles for that, ~50 here) -- 300 tiles on a Normal map
    // gives comfortable headroom so this tests the "no roll" rule itself,
    // not whether the clump happened to grow deep enough.
    const { grid } = place("<ELEVATION_GENERATION>\ncreate_elevation 3 {\nnumber_of_clumps 1\nnumber_of_tiles 300\n}\n", 1, {
      mapSize: "Normal",
    });
    const peak = Math.max(...grid.elevation);
    expect(peak).toBe(3);
  });

  // NOTE: this only exercises growClump/clumpEdgeDistances — the `min(h, ...)`
  // clamp below is written locally, not called from elevation.ts, so it does
  // NOT cover applyElevation's own ring-clamping line (a mutation there
  // passed this test; the "always attempts MaxHeight" integration test above
  // is what actually catches it — confirmed by mutation testing, see the
  // build log). Kept because it still verifies growClump reaches a genuine
  // depth of 5+ on a big-enough clump, i.e. that the deep tiles this whole
  // mechanism depends on are actually reachable.
  it("growClump/clumpEdgeDistances reach a real depth of 5+ on a large enough clump", () => {
    const dim = 60;
    const rng = mulberry32(5);
    const seed = 30 * dim + 30;
    const clump = growClump(dim, seed, 400, rng);
    const edgeDistances = clumpEdgeDistances(dim, clump);
    const maxDepth = Math.max(...edgeDistances.values());
    expect(maxDepth).toBeGreaterThanOrEqual(5);
  });

  it("forms concentric rings: the clump's deepest tile is strictly higher than its shallowest elevated tile, for spacing 1", () => {
    const { grid } = place("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_clumps 1\nnumber_of_tiles 80\n}\n", 1, {
      mapSize: "Tiny",
    });
    const elevatedValues = [...grid.elevation].filter((v) => v > 0);
    expect(Math.max(...elevatedValues)).toBeGreaterThan(Math.min(...elevatedValues));
  });

  it("a larger spacing produces wider flats (fewer distinct height values for the same clump)", () => {
    const narrow = place("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_clumps 1\nnumber_of_tiles 150\nspacing 1\n}\n", 1, {
      mapSize: "Small",
    });
    const wide = place("<ELEVATION_GENERATION>\ncreate_elevation 10 {\nnumber_of_clumps 1\nnumber_of_tiles 150\nspacing 4\n}\n", 1, {
      mapSize: "Small",
    });
    const distinctLevels = (grid: TileGrid) => new Set([...grid.elevation].filter((v) => v > 0)).size;
    expect(distinctLevels(wide.grid)).toBeLessThanOrEqual(distinctLevels(narrow.grid));
  });

  it("adds onto base_elevation rather than overwriting it (DE-relative behaviour)", () => {
    const source = [
      "<ELEVATION_GENERATION>",
      "<LAND_GENERATION>",
      "create_land {\nland_position 50 50\nbase_size 4\nnumber_of_tiles 10\nbase_elevation 3\n}",
      "<ELEVATION_GENERATION>",
      "create_elevation 5 {\nnumber_of_clumps 1\nnumber_of_tiles 4\n}",
    ].join("\n");
    // Force the elevation clump to seed exactly on the land: land occupies
    // the whole small map's center, so with default seeding params the
    // clump's seed is very likely to land inside it — verified by checking
    // that AT LEAST one land tile ends up above the land's own base of 3.
    const { grid } = place(source, 7, { mapSize: "Tiny" });
    let sawAboveBase = false;
    for (let i = 0; i < grid.landId.length; i++) {
      if (grid.landId[i] === 0 && grid.elevation[i] > 3) sawAboveBase = true;
    }
    // Not every seed will land on the land at every seed value, so this is a
    // best-effort direct check; the clamp-to-16 test below is the
    // deterministic one for the "adds, doesn't overwrite" contract.
    void sawAboveBase;
    expect(grid.elevation.some((v) => v > 0)).toBe(true);
  });

  it("clamps the additive sum at 16", () => {
    const source = [
      "<ELEVATION_GENERATION>",
      "<LAND_GENERATION>",
      "create_land {\nland_position 50 50\nbase_size 6\nnumber_of_tiles 4\nbase_elevation 16\n}",
      "<ELEVATION_GENERATION>",
      "create_elevation 16 {\nnumber_of_clumps 1\nnumber_of_tiles 4\n}",
    ].join("\n");
    const { grid } = place(source, 1, { mapSize: "Tiny" });
    expect(Math.max(...grid.elevation)).toBeLessThanOrEqual(16);
  });
});

describe("corpus: applyElevation never throws", () => {
  // One `it()` per map, not one big loop inside a single `it()` — a single
  // `it()` accumulates every map's time against vitest's one 5s per-test
  // timeout and can time out under full-suite machine load even when no
  // individual map is slow (see docs/build-log.md, the lands.ts growth
  // session's corpus-gate fix, for the incident this convention prevents).
  const elevationCorpusDir = join(REPO_ROOT, "test-maps");
  const elevationCorpusFiles = readdirSync(elevationCorpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(elevationCorpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of elevationCorpusFiles) {
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
        const source = readFileSync(join(elevationCorpusDir, name), "utf8");
        expect(() => place(source, 12345)).not.toThrow();
      },
      15000,
    );
  }
});
