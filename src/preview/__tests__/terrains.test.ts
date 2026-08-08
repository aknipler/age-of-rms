import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createTileGrid, scaleToMapArea, tileIndex, type TerrainConstantForMasks } from "../generator/grid";
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import { applyCliffs } from "../generator/cliffs";
import {
  applyAutomaticBeach,
  applyTerrains,
  eligibleTerrainCandidates,
  growTerrainClump,
  resolveClumpCount,
  resolveTerrainTileBudget,
  terrainBucketWeights,
  type EligibilityContext,
} from "../generator/terrains";
import { mulberry32 } from "../generator/rng";
import type { InstantiatedScript, LandOrigin, TileGrid } from "../generator/types";
import { DEFAULT_TEAMS, type MapSize, type TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const rawConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as { constants: TerrainConstantForMasks[] };
const constants: TerrainConstantForMasks[] = rawConstants.constants;
const GRASS = constants.find((c) => c.rmsConstant === "GRASS")!.constId!;
const WATER = constants.find((c) => c.rmsConstant === "WATER")!.constId!;
const DIRT = constants.find((c) => c.rmsConstant === "DIRT")!.constId!;

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

/** Full pipeline through S4. */
function place(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated: InstantiatedScript = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const landResult = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(landResult.origins, grid, landResult.reports, seed);
  paintLandTerrain(landResult.origins, grid);
  applyBaseElevation(instantiated, landResult.origins, grid, constants);
  applyElevation(instantiated, grid, constants, landResult.origins, seed);
  applyCliffs(instantiated, grid, constants, landResult.origins, seed);
  const terrainsResult = applyTerrains(instantiated, grid, constants, landResult.origins, seed);
  return { grid, dim: instantiated.dim, origins: landResult.origins, ...terrainsResult };
}

/** Instantiate a bare script and hand back a fresh flat grid, without running S1-S3 — for tests that call applyTerrains directly. */
function bareGrid(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  return { instantiated, grid };
}

function terrainCommands(source: string, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), 1);
  const cmd = instantiated.sections.get("TERRAIN_GENERATION")?.find((c) => c.name === "create_terrain");
  if (!cmd) throw new Error("fixture has no create_terrain command");
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

function baseContext(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return { baseTerrainId: GRASS, otherTerrainSpacing: 0, specificSpacings: [], flatOnly: false, ...overrides };
}

describe("resolveTerrainTileBudget (Sec.6.4)", () => {
  it("defaults to 122*dim/120, side-length scaled, when neither attribute is given", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\n}\n", { mapSize: "Tiny" });
    expect(resolveTerrainTileBudget(cmd, dim)).toBeCloseTo((122 * dim) / 120, 6);
  });

  it("the default is NOT re-scaled even when a scale attribute is present (RMSTEST_14's policy, same as elevation.ts)", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nset_scale_by_size\n}\n", { mapSize: "Tiny" });
    expect(resolveTerrainTileBudget(cmd, dim)).toBeCloseTo((122 * dim) / 120, 6);
  });

  it("an explicit number_of_tiles with no scale attribute is used exactly as written", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 77\n}\n");
    expect(resolveTerrainTileBudget(cmd, dim)).toBe(77);
  });

  it("set_scale_by_size scales an explicit number_of_tiles", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 100\nset_scale_by_size\n}\n", {
      mapSize: "Tiny",
    });
    expect(resolveTerrainTileBudget(cmd, dim)).toBe(scaleToMapArea(100, dim));
  });

  it("terrain-specific rule: set_scale_by_groups ALSO scales tiles, unlike elevation.ts", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 100\nset_scale_by_groups\n}\n", {
      mapSize: "Tiny",
    });
    expect(resolveTerrainTileBudget(cmd, dim)).toBe(scaleToMapArea(100, dim));
  });

  it("land_percent is a share of the WHOLE map, not divided by anything", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nland_percent 10\n}\n", { mapSize: "Small" });
    expect(resolveTerrainTileBudget(cmd, dim)).toBeCloseTo(0.1 * dim * dim, 6);
  });
});

describe("resolveClumpCount (Sec.6.4)", () => {
  it("defaults to 1", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\n}\n");
    expect(resolveClumpCount(cmd, dim)).toBe(1);
  });

  it("set_scale_by_groups scales clumps", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_clumps 3\nset_scale_by_groups\n}\n", {
      mapSize: "Tiny",
    });
    expect(resolveClumpCount(cmd, dim)).toBe(Math.max(1, scaleToMapArea(3, dim)));
  });

  it("set_scale_by_size does NOT scale clumps", () => {
    const { cmd, dim } = terrainCommands("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_clumps 3\nset_scale_by_size\n}\n", {
      mapSize: "Tiny",
    });
    expect(resolveClumpCount(cmd, dim)).toBe(3);
  });

  it("only the LAST scale attribute applies when both are written", () => {
    const { cmd, dim } = terrainCommands(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_clumps 3\nset_scale_by_groups\nset_scale_by_size\n}\n",
      { mapSize: "Tiny" },
    );
    expect(resolveClumpCount(cmd, dim)).toBe(3); // unscaled -- set_scale_by_size won
  });
});

describe("terrainBucketWeights (Sec.6.4, RMSTEST_20 — kept separate from lands.ts's own table)", () => {
  it("is uniform (all 1) at cf 0", () => {
    expect(terrainBucketWeights(0)).toEqual([1, 1, 1, 1]);
  });

  it("rises with cf up to the saturation point", () => {
    const at5 = terrainBucketWeights(5);
    const at10 = terrainBucketWeights(10);
    expect(at10[3]).toBeGreaterThan(at5[3]);
  });

  it("saturates at cf 15 -- cf 15, 20 and 40 all produce identical weights", () => {
    expect(terrainBucketWeights(15)).toEqual(terrainBucketWeights(20));
    expect(terrainBucketWeights(20)).toEqual(terrainBucketWeights(40));
  });

  it("negative cf is a dramatically separate regime", () => {
    const weights = terrainBucketWeights(-5);
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights).not.toEqual(terrainBucketWeights(0));
  });
});

describe("eligibleTerrainCandidates (Sec.7 attribution, predicate order matching Sec.6.4's own list)", () => {
  const dim = 20;

  it("succeeds with the full grid when nothing else constrains it", () => {
    const grid = createTileGrid(dim, GRASS);
    const result = eligibleTerrainCandidates(grid, baseContext(), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(dim * dim);
  });

  it("reports terrainAbsent when base_terrain never appears on the grid", () => {
    const grid = createTileGrid(dim, WATER); // no GRASS anywhere
    const result = eligibleTerrainCandidates(grid, baseContext({ baseTerrainId: GRASS }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("terrainAbsent");
  });

  // guide:1471: "If used together with base_terrain, the new terrain will be
  // placed only where BOTH the base and the layer apply." This test used to
  // assert a disjunction, which made base_layer a widening clause: a command
  // asking for "the DESERT layered over GRASS" also matched every bare GRASS
  // tile on the map.
  it("base_layer NARROWS base_terrain rather than offering an alternative match", () => {
    const grid = createTileGrid(dim, GRASS); // terrain matches everywhere
    grid.layer[tileIndex(grid, 5, 5)] = 7; // ...but only this tile carries the layer
    const result = eligibleTerrainCandidates(grid, baseContext({ baseTerrainId: GRASS, baseLayerId: 7 }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]).toBe(tileIndex(grid, 5, 5));
    }
  });

  it("a matching layer does not rescue a tile whose base_terrain is wrong", () => {
    const grid = createTileGrid(dim, WATER); // terrain matches nowhere
    grid.layer[tileIndex(grid, 5, 5)] = 7;
    const result = eligibleTerrainCandidates(grid, baseContext({ baseTerrainId: GRASS, baseLayerId: 7 }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("terrainAbsent");
  });

  it("height_limits filters by current elevation", () => {
    const grid = createTileGrid(dim, GRASS);
    grid.elevation[tileIndex(grid, 3, 3)] = 5;
    const result = eligibleTerrainCandidates(grid, baseContext({ heightLimits: { min: 4, max: 6 } }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]).toBe(tileIndex(grid, 3, 3));
    }
  });

  it("reports spacingConflict when height_limits excludes everything", () => {
    const grid = createTileGrid(dim, GRASS); // all elevation 0
    const result = eligibleTerrainCandidates(grid, baseContext({ heightLimits: { min: 5, max: 10 } }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("spacingConflict");
  });

  it("otherTerrainSpacing rejects candidates too close to foreign terrain", () => {
    const grid = createTileGrid(dim, GRASS);
    grid.terrain[tileIndex(grid, 10, 10)] = WATER; // one foreign tile at the center
    const result = eligibleTerrainCandidates(grid, baseContext({ otherTerrainSpacing: 3 }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        // 4-connected step distance from (10,10) must be >= 3.
        expect(Math.abs(x - 10) + Math.abs(y - 10)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("otherTerrainSpacing treats cliff tiles as foreign too (Sec.6.4's pinned approximation)", () => {
    const grid = createTileGrid(dim, GRASS);
    grid.cliff[tileIndex(grid, 10, 10)] = 1;
    const result = eligibleTerrainCandidates(grid, baseContext({ otherTerrainSpacing: 3 }), new Uint8Array(dim * dim), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        expect(Math.abs(x - 10) + Math.abs(y - 10)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("specificSpacings accumulates -- multiple entries all apply", () => {
    const grid = createTileGrid(dim, GRASS);
    grid.terrain[tileIndex(grid, 2, 2)] = WATER;
    grid.terrain[tileIndex(grid, 17, 17)] = DIRT;
    const result = eligibleTerrainCandidates(
      grid,
      baseContext({
        specificSpacings: [
          { terrainId: WATER, distance: 2 },
          { terrainId: DIRT, distance: 2 },
        ],
      }),
      new Uint8Array(dim * dim),
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        expect(Math.abs(x - 2) + Math.abs(y - 2)).toBeGreaterThanOrEqual(2);
        expect(Math.abs(x - 17) + Math.abs(y - 17)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("flatOnly rejects every sloped candidate", () => {
    const grid = createTileGrid(dim, GRASS);
    const slope = new Uint8Array(dim * dim);
    slope[tileIndex(grid, 5, 5)] = 1;
    const result = eligibleTerrainCandidates(grid, baseContext({ flatOnly: true }), slope, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toContain(tileIndex(grid, 5, 5));
  });

  it("reports spacingConflict when flatOnly rejects everything", () => {
    const grid = createTileGrid(dim, GRASS);
    const result = eligibleTerrainCandidates(grid, baseContext({ flatOnly: true }), new Uint8Array(dim * dim).fill(1), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("spacingConflict");
  });

  it("flatOnly + otherTerrainSpacing together keep a BUFFER from slopes, not just off the slope tile itself (Sec.6.4: 'also >= spacing from sloped tiles, only when spacing >= 1')", () => {
    const grid = createTileGrid(dim, GRASS);
    const slope = new Uint8Array(dim * dim);
    slope[tileIndex(grid, 10, 10)] = 1;
    const result = eligibleTerrainCandidates(grid, baseContext({ flatOnly: true, otherTerrainSpacing: 3 }), slope, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        // 4-connected step distance from the slope must clear the declared
        // spacing -- a tile merely 1 or 2 away from the slope (which the
        // OLD, unconditional-only implementation would have allowed) must
        // now be excluded too.
        expect(Math.abs(x - 10) + Math.abs(y - 10)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("flatOnly WITHOUT otherTerrainSpacing still forbids painting ON a slope, but keeps no buffer around it", () => {
    const grid = createTileGrid(dim, GRASS);
    const slope = new Uint8Array(dim * dim);
    slope[tileIndex(grid, 10, 10)] = 1;
    const result = eligibleTerrainCandidates(grid, baseContext({ flatOnly: true }), slope, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain(tileIndex(grid, 10, 10)); // the slope itself: excluded
      expect(result.value).toContain(tileIndex(grid, 9, 10)); // its immediate neighbour: NOT excluded, no spacing attribute given
    }
  });

  it("avoidPlayerDistance rejects candidates too close to a player origin", () => {
    const grid = createTileGrid(dim, GRASS);
    const origin = fabricateOrigin(10, 10, 1);
    const result = eligibleTerrainCandidates(grid, baseContext({ avoidPlayerDistance: 5 }), new Uint8Array(dim * dim), [origin]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        expect(Math.hypot(x - 10, y - 10)).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("trusts the caller's origin list as-is -- filtering to player-only origins is the CALLER's job (applyTerrains does it), not this function's", () => {
    const grid = createTileGrid(dim, GRASS);
    const neutralOrigin = fabricateOrigin(10, 10, undefined);
    // Passed here unfiltered on purpose: an origin with no `player` field
    // still counts as a distance source, exactly like `elevation.ts`'s own
    // eligibleSeedCandidates -- callers are expected to pre-filter to
    // player-only origins (Sec.6.4: "avoid player START areas") before
    // calling in, matching applyTerrains's `origins.filter(o => o.player
    // !== undefined)`.
    const result = eligibleTerrainCandidates(grid, baseContext({ avoidPlayerDistance: 5 }), new Uint8Array(dim * dim), [neutralOrigin]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        expect(Math.hypot(x - 10, y - 10)).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe("growTerrainClump (restricted frontier growth)", () => {
  it("grows to exactly the target when the eligible region is large enough", () => {
    const dim = 30;
    const eligible = new Uint8Array(dim * dim).fill(1);
    const seed = 15 * dim + 15;
    const clump = growTerrainClump(dim, seed, 40, eligible, new Uint8Array(dim * dim), terrainBucketWeights(20), mulberry32(3));
    expect(clump.size).toBe(40);
  });

  it("never places a tile outside the eligible mask", () => {
    const dim = 20;
    const eligible = new Uint8Array(dim * dim);
    // Only a 5x5 eligible box around the seed.
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) eligible[y * dim + x] = 1;
    const seed = 10 * dim + 10;
    const clump = growTerrainClump(dim, seed, 100, eligible, new Uint8Array(dim * dim), terrainBucketWeights(20), mulberry32(4));
    for (const tile of clump) expect(eligible[tile]).toBe(1);
  });

  it("stops short (growthShortfall territory) once the eligible region is exhausted", () => {
    const dim = 20;
    const eligible = new Uint8Array(dim * dim);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) eligible[y * dim + x] = 1; // 25 tiles total
    const seed = 10 * dim + 10;
    const clump = growTerrainClump(dim, seed, 100, eligible, new Uint8Array(dim * dim), terrainBucketWeights(20), mulberry32(5));
    expect(clump.size).toBeLessThan(100);
    expect(clump.size).toBeLessThanOrEqual(25);
  });

  it("never places a tile the claimed mask already marks, even though eligible allows it", () => {
    const dim = 20;
    const eligible = new Uint8Array(dim * dim).fill(1); // whole grid eligible
    const claimed = new Uint8Array(dim * dim);
    // Claim everything except a small box around the seed, forcing an early stop.
    claimed.fill(1);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) claimed[y * dim + x] = 0; // 25 free tiles
    const seed = 10 * dim + 10;
    const clump = growTerrainClump(dim, seed, 100, eligible, claimed, terrainBucketWeights(20), mulberry32(6));
    expect(clump.size).toBeLessThanOrEqual(25);
    for (const tile of clump) expect(claimed[tile]).toBe(0);
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
    // snowy terrains border water" — the reason the field is per-terrain
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
  // The engine edges every boundary between two DIFFERENT depths, not only the
  // outer one, so a shallows band running from a coast out to sea reads sand,
  // shallow, sand, sea. `bands()` builds exactly that cross-section as vertical
  // columns and the assertions read one row of it.

  const SHALLOW = constants.find((c) => c.rmsConstant === "SHALLOW")!.constId!;
  const DEEP_WATER = constants.find((c) => c.rmsConstant === "DEEP_WATER")!.constId!;
  const MANGROVESHALLOW = constants.find((c) => c.rmsConstant === "DLC_MANGROVESHALLOW")!.constId!;
  const ICE_NAVIGABLE = 26;

  /** One terrain id per column, repeated down every row. Returns the grid and a reader for one row of it. */
  function bands(columns: readonly number[]) {
    const dim = columns.length;
    const grid = createTileGrid(dim, columns[0]);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) grid.terrain[y * dim + x] = columns[x];
    }
    return { grid, row: () => Array.from(grid.terrain.slice(2 * dim, 3 * dim)) };
  }

  it("beaches BOTH boundaries of a shallows band: land/shallows and shallows/water", () => {
    const { grid, row } = bands([GRASS, GRASS, SHALLOW, SHALLOW, DEEP_WATER, DEEP_WATER]);
    applyAutomaticBeach(grid, constants);
    // The land tile touching the shallows, and the shallow tile touching the
    // deep — the middle shallow survives because it faces land on one side and
    // its own depth on the other.
    expect(row()).toEqual([GRASS, BEACH, SHALLOW, BEACH, DEEP_WATER, DEEP_WATER]);
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
    const { grid, row } = bands([GRASS, GRASS, SHALLOW, SHALLOW, DEEP_WATER, DEEP_WATER]);
    applyAutomaticBeach(grid, constants);
    const settled = row();
    expect(applyAutomaticBeach(grid, constants)).toBe(0);
    expect(row()).toEqual(settled);
  });

  it("edges a hybrid the water flag calls dry land — the two flags are orthogonal", () => {
    // DLC_MANGROVESHALLOW is `isWater: false` (it is buildable, walkable
    // ground) and the community table still calls it a shallow. Before
    // `isHybrid` existed it read as ordinary land, so neither of its two
    // boundaries was edged.
    const { grid, row } = bands([GRASS, GRASS, MANGROVESHALLOW, MANGROVESHALLOW, DEEP_WATER, DEEP_WATER]);
    applyAutomaticBeach(grid, constants);
    expect(row()).toEqual([GRASS, BEACH, MANGROVESHALLOW, BEACH, DEEP_WATER, DEEP_WATER]);
  });

  it("a hybrid grows its OWN beach: navigable ice gets ICYSHORE", () => {
    // Same per-terrain rule the snow case above proves for land, now on the
    // shallows/water boundary.
    const { grid, row } = bands([SNOW, SNOW, ICE_NAVIGABLE, ICE_NAVIGABLE, DEEP_WATER, DEEP_WATER]);
    applyAutomaticBeach(grid, constants);
    expect(row()).toEqual([SNOW, ICYSHORE, ICE_NAVIGABLE, ICYSHORE, DEEP_WATER, DEEP_WATER]);
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
});

describe("applyTerrains (Sec.6.4 end to end)", () => {
  it("no TERRAIN_GENERATION section -> no reports, no notes", () => {
    const { instantiated, grid } = bareGrid("<LAND_GENERATION>\n", 1, { mapSize: "Tiny" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("paints tiles with the declared terrain", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 60\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    let painted = 0;
    for (const t of grid.terrain) if (t === DIRT) painted++;
    expect(painted).toBeGreaterThan(0);
  });

  it("an unresolvable terrain name fails the command without throwing", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain NOT_A_REAL_TERRAIN_XYZ {\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Tiny" });
    expect(() => applyTerrains(instantiated, grid, constants, [], 1)).not.toThrow();
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0]).toMatchObject({ placed: 0 });
    expect(result.reports[0].failures[0].bucket).toBe("terrainAbsent");
  });

  // guide:1502-1509. The two layers differ in which terrain ends up OWNING
  // the tile, which decides what every later base_terrain, habitat check and
  // automatic-object rule sees — so these are two behaviours, not one.
  it("terrain_mask 2 masks UNDER: the new terrain takes the tile and the base becomes the layer", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 40\nterrain_mask 2\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    let ownedByDirt = 0;
    let layeredWithGrass = 0;
    for (let i = 0; i < grid.terrain.length; i++) {
      if (grid.terrain[i] !== DIRT) continue;
      ownedByDirt++;
      if (grid.layer[i] === GRASS) layeredWithGrass++;
    }
    expect(ownedByDirt).toBeGreaterThan(0);
    expect(layeredWithGrass).toBe(ownedByDirt);
  });

  it("a mask-2 tile stops matching its old base_terrain, and a mask-1 tile keeps matching", () => {
    // The distinguishing consequence, and the reason collapsing the two
    // layers was a correctness bug rather than a rendering simplification:
    // a later command's base_terrain sees whichever terrain owns the tile.
    const SNOW = constants.find((c) => c.rmsConstant === "SNOW")!.constId!;
    const under =
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nland_percent 100\nnumber_of_clumps 400\nterrain_mask 2\n}\ncreate_terrain SNOW {\nbase_terrain GRASS\nland_percent 100\nnumber_of_clumps 400\n}\n";
    const over = under.replace("terrain_mask 2", "terrain_mask 1");
    const countSnow = (source: string) => {
      const { instantiated, grid } = bareGrid(source, 3, { mapSize: "Tiny" });
      applyTerrains(instantiated, grid, constants, [], 3);
      let snow = 0;
      for (const t of grid.terrain) if (t === SNOW) snow++;
      return snow;
    };
    // Under: DIRT owns those tiles, so little GRASS is left for SNOW to take.
    // Over: they are still GRASS underneath, so SNOW covers them freely.
    expect(countSnow(over)).toBeGreaterThan(countSnow(under) * 5);
  });

  it("terrain_mask 1 masks OVER: the base keeps the tile, the new terrain is only a layer", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 40\nterrain_mask 1\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    let paintedLayer = 0;
    let paintedTerrain = 0;
    for (const l of grid.layer) if (l === DIRT) paintedLayer++;
    for (const t of grid.terrain) if (t === DIRT) paintedTerrain++;
    expect(paintedLayer).toBeGreaterThan(0);
    expect(paintedTerrain).toBe(0);
    expect(result.notes.some((n) => n.key.startsWith("terrainMaskApproximated"))).toBe(true);
  });

  /**
   * Confines the eligible base (GRASS, create_terrain's default) to a SINGLE
   * column directly beside a water column, and makes every other tile a
   * non-eligible terrain — the clump has nowhere else to grow, so every one of
   * its tiles is guaranteed adjacent to water wherever the seed lands.
   */
  function coastlineFixture(source: string, seed = 2) {
    const { instantiated, grid } = bareGrid(source, seed, { mapSize: "Tiny" });
    const midX = Math.floor(grid.dim / 2);
    grid.terrain.fill(DIRT);
    for (let y = 0; y < grid.dim; y++) {
      grid.terrain[tileIndex(grid, midX, y)] = WATER;
      grid.terrain[tileIndex(grid, midX + 1, y)] = GRASS;
    }
    return { instantiated, grid, midX };
  }

  /** The coastline column, as terrain ids. */
  function coast(grid: TileGrid, midX: number): number[] {
    const out: number[] = [];
    for (let y = 0; y < grid.dim; y++) out.push(grid.terrain[tileIndex(grid, midX + 1, y)]);
    return out;
  }

  it("beaches each create_terrain command's own tiles as that command finishes, using its beach_terrain", () => {
    const DLC_BEACH2 = constants.find((c) => c.rmsConstant === "DLC_BEACH2")!.constId!;
    const { instantiated, grid, midX } = coastlineFixture("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 30\nbeach_terrain DLC_BEACH2\n}\n");
    const result = applyTerrains(instantiated, grid, constants, [], 2);
    expect(result.reports[0].placed).toBe(1);
    // No separate pass, no second call: applyTerrains has already beached.
    expect(result.beached).toBeGreaterThan(0);
    expect(coast(grid, midX).filter((t) => t === DLC_BEACH2).length).toBeGreaterThan(0);
  });

  it("scopes its beach_terrain to its own tiles, leaving the rest of the coast to its own default", () => {
    // The clump is 30 tiles and the column is 120, so the command speaks for
    // only a quarter of the coastline. The rest is still GRASS, and the step
    // is grid-wide, so those tiles take GRASS's own default of BEACH rather
    // than this command's DLC_BEACH2.
    const DLC_BEACH2 = constants.find((c) => c.rmsConstant === "DLC_BEACH2")!.constId!;
    const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
    const { instantiated, grid, midX } = coastlineFixture("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 30\nbeach_terrain DLC_BEACH2\n}\n");
    applyTerrains(instantiated, grid, constants, [], 2);
    const column = coast(grid, midX);
    expect(column.filter((t) => t === DLC_BEACH2).length).toBeGreaterThan(0); // this command's own
    expect(column.filter((t) => t === BEACH).length).toBeGreaterThan(0); // everyone else's default
  });

  it("base_terrain BEACH converts a beach land's interior and the waterline reverts", () => {
    // The whole point of running the beach step per command, and the case an
    // earlier version broke while trying to protect it. `base_terrain BEACH`
    // has 67 corpus uses (five consecutive in `AK_Namatjira.rms`), so it must
    // find beach to convert; and the step then re-beaches only the strip that
    // touches water, so the interior keeps the conversion.
    const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
    const JUNGLEGRASS = constants.find((c) => c.rmsConstant === "DLC_JUNGLEGRASS")!.constId!;
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DLC_JUNGLEGRASS {\nbase_terrain BEACH\nland_percent 100\nnumber_of_clumps 9320\n}\n";
    const { instantiated, grid } = bareGrid(source, 2, { mapSize: "Tiny" });
    // A land made ENTIRELY of beach: water on the left, then a four-column
    // band of BEACH, then ordinary land. Only the first beach column touches
    // water, so three of the four are interior.
    const midX = Math.floor(grid.dim / 2);
    grid.terrain.fill(DIRT);
    for (let y = 0; y < grid.dim; y++) {
      grid.terrain[tileIndex(grid, midX, y)] = WATER;
      for (let c = 1; c <= 4; c++) grid.terrain[tileIndex(grid, midX + c, y)] = BEACH;
    }

    const result = applyTerrains(instantiated, grid, constants, [], 2);
    expect(result.reports[0].placed).toBeGreaterThan(0);

    for (let y = 0; y < grid.dim; y++) {
      expect(grid.terrain[tileIndex(grid, midX + 1, y)]).toBe(BEACH); // touches water, reverted
      for (let c = 2; c <= 4; c++) expect(grid.terrain[tileIndex(grid, midX + c, y)]).toBe(JUNGLEGRASS); // interior, converted
    }
  });

  it("base_terrain BEACH is a no-op where the only beach is the waterline itself", () => {
    // The other half of the same rule, and the observation that settles it:
    // with nothing but a one-tile shore to work on, the command converts it
    // and the step converts it straight back. Not a broken idiom — there was
    // no interior for it to act on.
    const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
    const JUNGLEGRASS = constants.find((c) => c.rmsConstant === "DLC_JUNGLEGRASS")!.constId!;
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DLC_JUNGLEGRASS {\nbase_terrain BEACH\nland_percent 100\nnumber_of_clumps 9320\n}\n";
    const { instantiated, grid, midX } = coastlineFixture(source);
    applyAutomaticBeach(grid, constants); // end of land generation: the column becomes BEACH
    expect(coast(grid, midX).every((t) => t === BEACH)).toBe(true);

    applyTerrains(instantiated, grid, constants, [], 2);
    expect(coast(grid, midX).every((t) => t === BEACH)).toBe(true);
    expect(coast(grid, midX).some((t) => t === JUNGLEGRASS)).toBe(false);
  });

  it("honours a beach_terrain naming a NON-beach terrain instead of overwriting it with the default", () => {
    // guide:1488: a non-beach terrain here is legal and load-bearing — it is
    // how an author makes a coastline players cannot build docks on. The
    // terrain's own row says it grows a BEACH, so a data-default-only pass
    // would undo the author's instruction.
    const JUNGLEGRASS = constants.find((c) => c.rmsConstant === "DLC_JUNGLEGRASS")!.constId!;
    const { instantiated, grid, midX } = coastlineFixture(
      "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 30\nbeach_terrain DLC_JUNGLEGRASS\n}\n",
    );
    applyTerrains(instantiated, grid, constants, [], 2);
    expect(coast(grid, midX).filter((t) => t === JUNGLEGRASS).length).toBeGreaterThan(0);
  });

  it("a beach_terrain naming a water terrain replaces the whole clump, as the guide warns", () => {
    // guide:1485: "it will fully replace the terrain specified in
    // create_terrain, so this is NOT recommended". Reproduced rather than
    // quietly fixed, same policy as the CONNECTION_GENERATION bug below.
    const { instantiated, grid } = coastlineFixture("<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 30\nbeach_terrain WATER\n}\n");
    const before = [...grid.terrain].filter((t) => t === WATER).length;
    const result = applyTerrains(instantiated, grid, constants, [], 2);
    const after = [...grid.terrain].filter((t) => t === WATER).length;
    expect(after).toBeGreaterThan(before);
    expect(result.notes.some((n) => n.key.startsWith("beachTerrainIsWater"))).toBe(true);
  });

  it("beach_terrain is skipped, with a note, when a <CONNECTION_GENERATION> section exists (documented engine bug)", () => {
    const DLC_BEACH2 = constants.find((c) => c.rmsConstant === "DLC_BEACH2")!.constId!;
    const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
    const source = [
      "<TERRAIN_GENERATION>",
      "create_terrain DIRT {\nnumber_of_tiles 30\nbeach_terrain DLC_BEACH2\n}",
      "<CONNECTION_GENERATION>",
    ].join("\n");
    const { instantiated, grid, midX } = coastlineFixture(source);
    applyAutomaticBeach(grid, constants); // end of land generation
    const result = applyTerrains(instantiated, grid, constants, [], 2);
    expect(result.notes.some((n) => n.key.startsWith("beachTerrainSkipped"))).toBe(true);

    // The coastline still has its beach — the engine default from land
    // generation, which is what the ignored attribute would have overridden.
    // "Skipped" is not "no beach".
    const column = coast(grid, midX);
    expect(column.some((t) => t === BEACH)).toBe(true);
    expect(column.some((t) => t === DLC_BEACH2)).toBe(false);
  });

  it("height_limits restricts placement to the declared elevation band", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 30\nheight_limits 5 10\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    for (let i = 0; i < grid.elevation.length; i++) grid.elevation[i] = i % 2 === 0 ? 7 : 0; // checkerboard elevation
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    for (let i = 0; i < grid.terrain.length; i++) {
      if (grid.terrain[i] === DIRT) expect(grid.elevation[i]).toBeGreaterThanOrEqual(5);
    }
  });

  it("reports growthShortfall when the eligible region is too small for the tile budget", () => {
    // The whole grid (dim*dim, ~14400 on Tiny) is the ceiling on how many
    // tiles ANY single clump could ever reach -- ask for far more than that
    // so the shortfall is inevitable regardless of map size or eligibility.
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 999999\nnumber_of_clumps 1\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Tiny" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].placed).toBe(1);
    expect(result.reports[0].failures.some((f) => f.bucket === "growthShortfall")).toBe(true);
  });

  it("a pathological number_of_clumps (guide's own 9320 example, and the corpus goes far higher) is capped rather than hung, with an iterationCapped failure and a note", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nnumber_of_tiles 500000\nnumber_of_clumps 999999999\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Tiny" });
    const start = Date.now();
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    // Not a strict wall-clock assertion (CLAUDE.md: a shared machine measures
    // the machine) -- a generous ceiling just to prove this completes at
    // all, which an uncapped loop attempting 999999999 clumps would not.
    expect(Date.now() - start).toBeLessThan(10000);
    const capFailure = result.reports[0].failures.find((f) => f.bucket === "iterationCapped");
    expect(capFailure).toBeDefined();
    expect(capFailure!.data).toMatchObject({ requested: 999999999 });
    expect(result.reports[0].attempted).toBeLessThan(999999999);
    expect(result.notes.some((n) => n.key.startsWith("terrainIterationCapped"))).toBe(true);
  });

  it("runs the guide's own 9320-clump example in FULL, because 9320 clumps fit in the eligible pool", () => {
    // The regression that matters more than the cap above. A `[tune]` cap of
    // `4 * dim` attempts stopped every command at 800 clumps on a 200 map,
    // so `create_terrain X { base_terrain Y land_percent 100 number_of_clumps
    // 9320 }` — the standard way to convert ALL of one terrain into another,
    // and the guide's own worked example — converted a twelfth of it. It
    // showed up as a wrong-looking map, never as an error.
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nland_percent 100\nnumber_of_clumps 9320\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].attempted).toBe(9320);
    expect(result.reports[0].failures.some((f) => f.bucket === "iterationCapped")).toBe(false);
    // And it does what the script asked. Not literally every tile: the
    // budget gives each clump 4 tiles and some exhaust their frontier against
    // neighbours that are already claimed. The number to compare against is
    // what the old cap produced — 800 clumps x 4 tiles is at most 3,200 of
    // 40,000, under a tenth.
    let dirt = 0;
    for (const t of grid.terrain) if (t === DIRT) dirt++;
    expect(dirt).toBeGreaterThan(grid.terrain.length * 0.8);
  });

  it("stops at the eligible pool rather than a constant when the pool is the smaller of the two", () => {
    // 400 eligible tiles, 9320 clumps asked for: a clump needs at least one
    // tile, so the bound is a fact about the work rather than a budget.
    const source = "<TERRAIN_GENERATION>\ncreate_terrain DIRT {\nbase_terrain SNOW\nland_percent 100\nnumber_of_clumps 9320\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const SNOW = constants.find((c) => c.rmsConstant === "SNOW")!.constId!;
    for (let i = 0; i < 400; i++) grid.terrain[i] = SNOW;
    const result = applyTerrains(instantiated, grid, constants, [], 1);
    expect(result.reports[0].attempted).toBe(400);
    expect(result.reports[0].failures.find((f) => f.bucket === "iterationCapped")).toBeDefined();
  });

  it("sequential commands see each other's painted tiles: a second command's base_terrain no longer matches what the first one painted", () => {
    const source = [
      "<TERRAIN_GENERATION>",
      "create_terrain DIRT {\nnumber_of_tiles 500\nnumber_of_clumps 1\n}",
      "create_terrain WATER {\nbase_terrain DIRT\nnumber_of_tiles 5000\nnumber_of_clumps 1\n}",
    ].join("\n");
    const { instantiated, grid } = bareGrid(source, 5, { mapSize: "Normal" });
    const result = applyTerrains(instantiated, grid, constants, [], 5);
    expect(result.reports.length).toBe(2);
    // The second command's eligible set is bounded by exactly what the first
    // one painted -- so it cannot come close to its 5000-tile ask.
    expect(result.reports[1].failures.some((f) => f.bucket === "growthShortfall")).toBe(true);
  });

  it("full pipeline (S1-S4) never throws on a plain script", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_player_lands { land_percent 8 }",
      "<ELEVATION_GENERATION>",
      "create_elevation 5 { number_of_tiles 100 }",
      "<CLIFF_GENERATION>",
      "<TERRAIN_GENERATION>",
      "create_terrain DIRT { number_of_tiles 200 }",
    ].join("\n");
    expect(() => place(source, 42, { mapSize: "Normal" })).not.toThrow();
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
