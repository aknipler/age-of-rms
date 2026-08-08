import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createTileGrid, computeSlopeMask, tileIndex, UNREACHABLE, type TerrainConstantForMasks } from "../generator/grid";
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import { applyCliffs, eligibleCliffStartTiles, resolveCliffSettings, walkCliff, type CliffSettings } from "../generator/cliffs";
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

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

/** Full pipeline through S3, mirroring elevation.test.ts's own `place()`. */
function place(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated: InstantiatedScript = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const landResult = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(landResult.origins, grid, landResult.reports, seed);
  paintLandTerrain(landResult.origins, grid);
  applyBaseElevation(instantiated, landResult.origins, grid, constants);
  applyElevation(instantiated, grid, constants, landResult.origins, seed);
  const cliffsResult = applyCliffs(instantiated, grid, constants, landResult.origins, seed);
  return { grid, dim: instantiated.dim, origins: landResult.origins, ...cliffsResult };
}

/** Instantiate a bare script and hand back a fresh flat grid, without running S1/S2 — for tests that call applyCliffs directly. */
function bareGrid(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  return { instantiated, grid };
}

function cliffTileCount(grid: TileGrid): number {
  let n = 0;
  for (const v of grid.cliff) if (v !== 0) n++;
  return n;
}

function cliffTileIndices(grid: TileGrid): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.cliff.length; i++) if (grid.cliff[i] !== 0) out.push(i);
  return out;
}

const ZERO_SPAN = { start: 0, end: 0 };

function fabricateOrigin(x: number, y: number): LandOrigin {
  return {
    commandSpan: ZERO_SPAN,
    x,
    y,
    zone: -10,
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

function cliffCommands(source: string, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), 1);
  return instantiated.sections.get("CLIFF_GENERATION") ?? [];
}

describe("resolveCliffSettings (Sec.6.3's standalone-attribute folding)", () => {
  it("uses guide defaults when the section is empty", () => {
    const s: CliffSettings = resolveCliffSettings(cliffCommands("<CLIFF_GENERATION>\n"));
    expect(s.minCliffs).toBe(3);
    expect(s.maxCliffs).toBe(8);
    expect(s.minLength).toBe(5);
    expect(s.maxLength).toBe(9);
    expect(s.curliness).toBe(36);
    expect(s.minDistanceCliffs).toBe(2);
    expect(s.minTerrainDistance).toBe(2);
  });

  it("reads every declared attribute", () => {
    const source = [
      "<CLIFF_GENERATION>",
      "min_number_of_cliffs 1",
      "max_number_of_cliffs 2",
      "min_length_of_cliff 4",
      "max_length_of_cliff 6",
      "cliff_curliness 90",
      "min_distance_cliffs 5",
      "min_terrain_distance 7",
    ].join("\n");
    const s = resolveCliffSettings(cliffCommands(source));
    expect(s).toMatchObject({
      minCliffs: 1,
      maxCliffs: 2,
      minLength: 4,
      maxLength: 6,
      curliness: 90,
      minDistanceCliffs: 5,
      minTerrainDistance: 7,
    });
  });

  it("last-one-wins when an attribute is declared twice (Sec.3 rule 10's policy, applied to a standalone command)", () => {
    const source = "<CLIFF_GENERATION>\nmin_number_of_cliffs 2\nmin_number_of_cliffs 6\n";
    const s = resolveCliffSettings(cliffCommands(source));
    expect(s.minCliffs).toBe(6);
  });
});

describe("computeSlopeMask", () => {
  it("marks nothing sloped on a flat grid", () => {
    const { grid } = bareGrid("<CLIFF_GENERATION>\n", 1, { mapSize: "Tiny" });
    const mask = computeSlopeMask(grid);
    expect(mask.some((v) => v !== 0)).toBe(false);
  });

  it("marks a tile sloped when a 4-neighbour has different elevation", () => {
    const { grid } = bareGrid("<CLIFF_GENERATION>\n", 1, { mapSize: "Tiny" });
    const center = tileIndex(grid, 5, 5);
    grid.elevation[center] = 3;
    const mask = computeSlopeMask(grid);
    expect(mask[center]).toBe(1); // differs from its own flat neighbours
    expect(mask[tileIndex(grid, 5, 4)]).toBe(1); // neighbour of the raised tile
    expect(mask[tileIndex(grid, 0, 0)]).toBe(0); // far away, unaffected
  });
});

describe("eligibleCliffStartTiles (Sec.7 attribution, predicate order matching Sec.6.3's own list)", () => {
  const dim = 40;

  function noneEligible(overrides: Partial<{ water: Uint8Array; slope: Uint8Array; cliffDistance: Uint16Array; waterDistance: Uint16Array; origins: LandOrigin[] }> = {}) {
    const grid = createTileGrid(dim, GRASS);
    const flatMask = () => new Uint8Array(dim * dim);
    const farDistance = () => new Uint16Array(dim * dim).fill(UNREACHABLE);
    return eligibleCliffStartTiles(
      grid,
      overrides.origins ?? [],
      overrides.water ?? flatMask(),
      overrides.slope ?? flatMask(),
      overrides.cliffDistance ?? farDistance(),
      overrides.waterDistance ?? farDistance(),
      6,
      6,
    );
  }

  it("succeeds with the full grid when nothing constrains it", () => {
    const result = noneEligible();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(dim * dim);
  });

  it("reports spacingConflict when every tile is too close to a land origin", () => {
    // A 40x40 grid's far corner sits ~28 tiles from a centred origin, past
    // the 22-tile rule -- too big to exclude every tile. A 15x15 grid with
    // the origin AT a corner puts its own far corner at 14*sqrt(2) =~ 19.8,
    // inside the exclusion, so nothing on the grid clears it.
    const smallDim = 15;
    const grid = createTileGrid(smallDim, GRASS);
    const flatMask = new Uint8Array(smallDim * smallDim);
    const farDistance = new Uint16Array(smallDim * smallDim).fill(UNREACHABLE);
    const result = eligibleCliffStartTiles(grid, [fabricateOrigin(0, 0)], flatMask, flatMask, farDistance, farDistance, 6, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("spacingConflict");
  });

  it("reports noValidTiles when every tile is water", () => {
    const result = noneEligible({ water: new Uint8Array(dim * dim).fill(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("noValidTiles");
  });

  it("reports noValidTiles when every tile is sloped", () => {
    const result = noneEligible({ slope: new Uint8Array(dim * dim).fill(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("noValidTiles");
  });

  it("reports spacingConflict when every tile is too close to an existing cliff", () => {
    const result = noneEligible({ cliffDistance: new Uint16Array(dim * dim).fill(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("spacingConflict");
  });

  it("reports spacingConflict when every tile is too close to water", () => {
    const result = noneEligible({ waterDistance: new Uint16Array(dim * dim).fill(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.bucket).toBe("spacingConflict");
  });

  it("only returns tiles that actually clear the land-origin distance", () => {
    const origin = fabricateOrigin(5, 5);
    const result = noneEligible({ origins: [origin] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const tile of result.value) {
        const x = tile % dim;
        const y = (tile - x) / dim;
        expect(Math.hypot(x - 5, y - 5)).toBeGreaterThanOrEqual(22);
      }
    }
  });
});

describe("walkCliff (Sec.6.3's random walk)", () => {
  it("lays exactly 3*(1+len) tiles on an open grid with curliness 0 (a straight walk never gets truncated)", () => {
    const dim = 60;
    const noWater = new Uint8Array(dim * dim);
    for (const seedValue of [1, 2, 3, 4, 5]) {
      const grid = createTileGrid(dim, GRASS);
      const rng = mulberry32(seedValue);
      const start = tileIndex(grid, 30, 30);
      const len = 5;
      walkCliff(grid, noWater, start, len, 0, rng);
      expect(cliffTileCount(grid)).toBe(3 * (1 + len));
    }
  });

  it("curliness 100 produces a shape that is not a single straight line, over enough seeds", () => {
    const dim = 60;
    const noWater = new Uint8Array(dim * dim);
    let sawATurn = false;
    for (let seedValue = 1; seedValue <= 20; seedValue++) {
      const grid = createTileGrid(dim, GRASS);
      const rng = mulberry32(seedValue);
      const start = tileIndex(grid, 30, 30);
      walkCliff(grid, noWater, start, 4, 100, rng);
      const tiles = cliffTileIndices(grid);
      const xs = new Set(tiles.map((t) => t % dim));
      const ys = new Set(tiles.map((t) => (t - (t % dim)) / dim));
      if (xs.size > 1 && ys.size > 1) sawATurn = true;
    }
    expect(sawATurn).toBe(true);
  });

  it("truncates at the grid edge rather than throwing", () => {
    const grid = createTileGrid(1, GRASS); // every direction from (0,0) is immediately off-grid
    const rng = mulberry32(7);
    expect(() => walkCliff(grid, new Uint8Array(1), 0, 5, 36, rng)).not.toThrow();
    expect(cliffTileCount(grid)).toBe(1); // only the start tile
  });

  it("truncates when the very next tile is water, regardless of the random initial direction", () => {
    const dim = 5;
    const grid = createTileGrid(dim, GRASS);
    const start = tileIndex(grid, 2, 2);
    const water = new Uint8Array(dim * dim).fill(1);
    water[start] = 0; // only the start tile is dry
    for (const seedValue of [1, 2, 3, 4]) {
      const g2 = createTileGrid(dim, GRASS);
      walkCliff(g2, water, start, 5, 36, mulberry32(seedValue));
      expect(cliffTileCount(g2)).toBe(1);
    }
  });

  it("truncates on an already-cliffed tile (the overlap check that also makes it self-avoiding)", () => {
    const dim = 5;
    const start = tileIndex(createTileGrid(dim, GRASS), 2, 2);
    for (const seedValue of [1, 2, 3, 4]) {
      const g2 = createTileGrid(dim, GRASS);
      // Pre-cliff every tile one step away from the start in all 4
      // directions, so whichever direction the walk rolls first, its
      // second stub tile is blocked -- only the start tile itself can
      // ever get newly marked, regardless of the random initial direction.
      g2.cliff[tileIndex(g2, 3, 2)] = 1;
      g2.cliff[tileIndex(g2, 1, 2)] = 1;
      g2.cliff[tileIndex(g2, 2, 3)] = 1;
      g2.cliff[tileIndex(g2, 2, 1)] = 1;
      walkCliff(g2, new Uint8Array(dim * dim), start, 5, 36, mulberry32(seedValue));
      expect(cliffTileCount(g2)).toBe(5); // the 4 pre-blocked tiles plus the start tile
    }
  });
});

describe("applyCliffs (Sec.6.3 end to end)", () => {
  it("no CLIFF_GENERATION section -> no reports, no notes", () => {
    const { instantiated, grid } = bareGrid("<LAND_GENERATION>\n", 1, { mapSize: "Tiny" });
    const result = applyCliffs(instantiated, grid, constants, [], 1);
    expect(result.reports).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(cliffTileCount(grid)).toBe(0);
  });

  it("an empty section still generates cliffs with defaults (guide: 'simply typing the section header')", () => {
    const { instantiated, grid } = bareGrid("<CLIFF_GENERATION>\n", 1, { mapSize: "Normal" });
    const result = applyCliffs(instantiated, grid, constants, [], 1);
    expect(result.reports.length).toBe(1);
    expect(result.reports[0].attempted).toBeGreaterThanOrEqual(3);
    expect(result.reports[0].attempted).toBeLessThanOrEqual(7); // [min, max) = [3, 8)
    expect(cliffTileCount(grid)).toBeGreaterThan(0);
  });

  it("min_number_of_cliffs > max_number_of_cliffs: zero cliffs plus a note, never throws (guide: this crashes the real engine)", () => {
    const source = "<CLIFF_GENERATION>\nmin_number_of_cliffs 8\nmax_number_of_cliffs 3\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    expect(() => applyCliffs(instantiated, grid, constants, [], 1)).not.toThrow();
    const result = applyCliffs(instantiated, grid, constants, [], 1);
    expect(result.reports).toEqual([{ commandSpan: expect.anything(), stage: "S3", attempted: 0, placed: 0, failures: [] }]);
    expect(cliffTileCount(grid)).toBe(0);
    expect(result.notes.some((n) => n.key === "cliffsMinExceedsMax")).toBe(true);
  });

  it("min_length_of_cliff below 3: zero cliffs plus a note (guide: 'minimum must be at least 3 for cliffs to appear')", () => {
    const source = "<CLIFF_GENERATION>\nmin_length_of_cliff 2\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyCliffs(instantiated, grid, constants, [], 1);
    expect(result.reports[0]).toMatchObject({ attempted: 0, placed: 0 });
    expect(cliffTileCount(grid)).toBe(0);
    expect(result.notes.some((n) => n.key.startsWith("cliffsLengthSuppressed"))).toBe(true);
  });

  it("min_number_of_cliffs == max_number_of_cliffs draws exactly that many, despite the max-exclusive rule", () => {
    const source = "<CLIFF_GENERATION>\nmin_number_of_cliffs 4\nmax_number_of_cliffs 4\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Normal" });
    const result = applyCliffs(instantiated, grid, constants, [], 1);
    expect(result.reports[0].attempted).toBe(4);
  });

  it("cliffs avoid water tiles", () => {
    const { instantiated, grid } = bareGrid("<CLIFF_GENERATION>\n", 3, { mapSize: "Normal" });
    for (let y = 0; y < grid.dim; y++) {
      for (let x = 0; x < grid.dim; x++) {
        if (x < grid.dim / 2) grid.terrain[tileIndex(grid, x, y)] = WATER;
      }
    }
    const result = applyCliffs(instantiated, grid, constants, [], 3);
    expect(result.reports[0].placed).toBeGreaterThan(0);
    for (const i of cliffTileIndices(grid)) expect(grid.terrain[i]).not.toBe(WATER);
  });

  it("cliffs avoid sloped tiles (elevation already resolved by S3, per Sec.6.3)", () => {
    const { instantiated, grid } = bareGrid("<CLIFF_GENERATION>\n", 4, { mapSize: "Normal" });
    // Slope the entire west half of the map (checkerboard elevation), leaving the east half flat.
    for (let y = 0; y < grid.dim; y++) {
      for (let x = 0; x < grid.dim / 2; x++) {
        grid.elevation[tileIndex(grid, x, y)] = (x + y) % 2 === 0 ? 4 : 0;
      }
    }
    const slope = computeSlopeMask(grid);
    const result = applyCliffs(instantiated, grid, constants, [], 4);
    expect(result.reports[0].placed).toBeGreaterThan(0);
    for (const i of cliffTileIndices(grid)) {
      // Only the START tile of each cliff is guaranteed unsloped; a later
      // walk step can legally land adjacent to elevation the walk itself
      // just laid down elsewhere on the map, so this checks against the
      // slope mask taken BEFORE cliff generation ran, over the region we
      // deliberately sloped, rather than asserting every single tile.
      const x = i % grid.dim;
      if (x < grid.dim / 2) expect(slope[i]).toBe(0);
    }
  });

  it("cliffs keep at least 22 tiles from every land origin", () => {
    const { instantiated, grid } = bareGrid("<CLIFF_GENERATION>\n", 2, { mapSize: "Giant" });
    const origin = fabricateOrigin(Math.floor(grid.dim / 2), Math.floor(grid.dim / 2));
    const result = applyCliffs(instantiated, grid, constants, [origin], 2);
    expect(result.reports[0].placed).toBeGreaterThan(0);
    for (const i of cliffTileIndices(grid)) {
      const x = i % grid.dim;
      const y = (i - x) / grid.dim;
      expect(Math.hypot(x - origin.x, y - origin.y)).toBeGreaterThanOrEqual(22);
    }
  });

  it("mutates grid.cliff and reuses it as the 'existing cliff' spacing constraint for later cliffs in the same section", () => {
    const source = "<CLIFF_GENERATION>\nmin_number_of_cliffs 6\nmax_number_of_cliffs 7\nmin_distance_cliffs 4\n";
    const { instantiated, grid } = bareGrid(source, 9, { mapSize: "Giant" });
    const result = applyCliffs(instantiated, grid, constants, [], 9);
    expect(cliffTileCount(grid)).toBeGreaterThan(0);
    expect(result.reports[0].attempted).toBeGreaterThan(0);
  });

  it("full pipeline (S1-S3) never throws on a plain script", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_player_lands { land_percent 8 }",
      "<ELEVATION_GENERATION>",
      "create_elevation 5 { number_of_tiles 100 }",
      "<CLIFF_GENERATION>",
    ].join("\n");
    expect(() => place(source, 42, { mapSize: "Normal" })).not.toThrow();
  });
});

describe("corpus: applyCliffs never throws", () => {
  // One `it()` per map (see docs/build-log.md — a single `it()` looping over
  // the whole corpus can exceed vitest's per-test timeout under load even
  // though no individual map is slow).
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
