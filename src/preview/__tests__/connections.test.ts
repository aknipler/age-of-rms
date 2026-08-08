import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createTileGrid, tileIndex, type TerrainConstantForMasks } from "../generator/grid";
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import { applyCliffs } from "../generator/cliffs";
import { applyTerrains } from "../generator/terrains";
import {
  applyConnections,
  applyTerrainAlongPath,
  computeLandBoundingBoxes,
  crossPairs,
  findConnectionPath,
  landZonePairs,
  MinHeap,
  readReplacementRules,
  readTerrainCosts,
  readTerrainSizes,
  resolveReplacement,
  sameZonePairs,
  teamPairs,
  type ReplacementRule,
} from "../generator/connections";
import { mulberry32 } from "../generator/rng";
import type { CanonicalTeams } from "../../generationSettings/teamModel";
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

/** Full pipeline through S5. */
function place(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated: InstantiatedScript = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid: TileGrid = createTileGrid(instantiated.dim, GRASS);
  const landResult = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(landResult.origins, grid, landResult.reports, seed);
  paintLandTerrain(landResult.origins, grid);
  applyBaseElevation(instantiated, landResult.origins, grid, constants);
  applyElevation(instantiated, grid, constants, landResult.origins, seed);
  applyCliffs(instantiated, grid, constants, landResult.origins, seed);
  applyTerrains(instantiated, grid, constants, landResult.origins, seed);
  const connectionsResult = applyConnections(instantiated, grid, constants, landResult.origins, seed);
  return { grid, dim: instantiated.dim, origins: landResult.origins, ...connectionsResult };
}

/** Instantiate a bare script and hand back a fresh flat grid, without running S1-S4 — for tests that call applyConnections directly against a hand-built grid/origins. */
function bareGrid(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  return { instantiated, grid };
}

function connectionCommand(source: string, name: string, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), 1);
  const cmd = instantiated.sections.get("CONNECTION_GENERATION")?.find((c) => c.name === name);
  if (!cmd) throw new Error(`fixture has no ${name} command`);
  return cmd;
}

const ZERO_SPAN = { start: 0, end: 0 };

function fabricateOrigin(x: number, y: number, player: number | undefined, zone = -10): LandOrigin {
  return {
    commandSpan: ZERO_SPAN,
    x,
    y,
    zone,
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

function fabricateTeams(canonical: readonly TeamNumber[]): CanonicalTeams {
  const sizes = [0, 0, 0, 0, 0];
  for (const t of canonical) sizes[t]++;
  const teamCount = new Set(canonical.filter((t) => t !== 0)).size;
  return { canonical, teamCount, sizes };
}

/** Stamps a rectangular land region directly onto grid.landId, for pathfinding/bbox tests that don't need real growth. */
function stampLand(grid: TileGrid, landIndex: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) grid.landId[tileIndex(grid, x, y)] = landIndex;
  }
}

describe("MinHeap (Sec.11: 'A* uses a binary heap')", () => {
  it("pops in ascending priority order", () => {
    const heap = new MinHeap();
    heap.push(10, 5);
    heap.push(20, 1);
    heap.push(30, 3);
    heap.push(40, 2);
    const order: number[] = [];
    while (heap.size > 0) order.push(heap.pop()!);
    expect(order).toEqual([20, 40, 30, 10]);
  });

  it("returns undefined when empty", () => {
    const heap = new MinHeap();
    expect(heap.pop()).toBeUndefined();
    expect(heap.size).toBe(0);
  });

  it("handles ties and a large random sequence correctly (matches a plain sort)", () => {
    const heap = new MinHeap();
    const rng = mulberry32(9);
    const entries: Array<{ value: number; priority: number }> = [];
    for (let i = 0; i < 200; i++) {
      const priority = rng() % 50; // deliberately narrow range -- forces ties
      entries.push({ value: i, priority });
      heap.push(i, priority);
    }
    const expected = [...entries].sort((a, b) => a.priority - b.priority).map((e) => e.priority);
    const actual: number[] = [];
    while (heap.size > 0) {
      const value = heap.pop()!;
      actual.push(entries[value].priority);
    }
    expect(actual).toEqual(expected);
  });
});

describe("computeLandBoundingBoxes", () => {
  it("computes a tight box per land, from grid.landId alone", () => {
    const grid = createTileGrid(20, GRASS);
    stampLand(grid, 0, 2, 3, 5, 6);
    stampLand(grid, 1, 15, 15, 15, 15);
    const boxes = computeLandBoundingBoxes(grid, 2);
    expect(boxes[0]).toEqual({ minX: 2, maxX: 5, minY: 3, maxY: 6 });
    expect(boxes[1]).toEqual({ minX: 15, maxX: 15, minY: 15, maxY: 15 });
  });

  it("gives an empty (inverted) box for a land with no tiles at all", () => {
    const grid = createTileGrid(10, GRASS);
    const boxes = computeLandBoundingBoxes(grid, 1);
    expect(boxes[0].minX).toBeGreaterThan(boxes[0].maxX);
  });
});

describe("findConnectionPath (multi-source, multi-goal A*)", () => {
  it("finds a straight path across uniform-cost terrain", () => {
    const grid = createTileGrid(20, GRASS);
    stampLand(grid, 0, 2, 10, 2, 10);
    stampLand(grid, 1, 17, 10, 17, 10);
    const path = findConnectionPath(grid, grid.terrain, () => 1, 0, 1, computeLandBoundingBoxes(grid, 2)[1]);
    expect(path).toBeDefined();
    expect(path![0]).toBe(tileIndex(grid, 2, 10));
    expect(path![path!.length - 1]).toBe(tileIndex(grid, 17, 10));
  });

  it("returns undefined when a cost-0 (impassable) moat fully separates the two lands", () => {
    const grid = createTileGrid(20, GRASS);
    stampLand(grid, 0, 0, 0, 4, 19);
    stampLand(grid, 1, 15, 0, 19, 19);
    for (let y = 0; y < 20; y++) grid.terrain[tileIndex(grid, 10, y)] = WATER; // a full-height wall
    const costOf = (terrainId: number): number => (terrainId === WATER ? 0 : 1);
    const path = findConnectionPath(grid, grid.terrain, costOf, 0, 1, computeLandBoundingBoxes(grid, 2)[1]);
    expect(path).toBeUndefined();
  });

  it("prefers the cheaper route over the shorter one when costs differ", () => {
    const dim = 20;
    const grid = createTileGrid(dim, GRASS);
    stampLand(grid, 0, 0, 9, 0, 9);
    stampLand(grid, 1, 19, 9, 19, 9);
    // A short but expensive strip directly between them; everywhere else stays cheap.
    for (let x = 1; x < 19; x++) grid.terrain[tileIndex(grid, x, 9)] = WATER;
    const costOf = (terrainId: number): number => (terrainId === WATER ? 50 : 1);
    const path = findConnectionPath(grid, grid.terrain, costOf, 0, 1, computeLandBoundingBoxes(grid, 2)[1]);
    expect(path).toBeDefined();
    // The cheap detour is longer in TILE COUNT than the direct route across
    // the expensive strip (18 tiles) would have been, which is exactly what
    // proves cost, not raw distance, drove the search.
    expect(path!.length).toBeGreaterThan(19);
    for (const tile of path!) expect(grid.terrain[tile]).not.toBe(WATER);
  });

  it("is genuinely multi-source/multi-goal: starts from whichever land-A tile is closest, ends at whichever land-B tile is closest", () => {
    const dim = 20;
    const grid = createTileGrid(dim, GRASS);
    stampLand(grid, 0, 0, 0, 0, 19); // a whole west column
    stampLand(grid, 1, 19, 0, 19, 19); // a whole east column
    const path = findConnectionPath(grid, grid.terrain, () => 1, 0, 1, computeLandBoundingBoxes(grid, 2)[1]);
    expect(path).toBeDefined();
    // x=0 through x=19 inclusive is 20 tiles -- not routed via some
    // arbitrary single "origin" tile of either land.
    expect(path!.length).toBe(20);
  });
});

describe("teamPairs (Sec.6.5: within-team only, team 0 produces nothing)", () => {
  it("connects only players on the SAME canonical team, never across teams", () => {
    const origins = [fabricateOrigin(0, 0, 1), fabricateOrigin(1, 0, 2), fabricateOrigin(2, 0, 3), fabricateOrigin(3, 0, 4)];
    const teams = fabricateTeams([1, 1, 2, 2]); // players 1,2 on team 1; players 3,4 on team 2
    const pairs = teamPairs(origins, teams);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual([0, 1]);
    expect(pairs).toContainEqual([2, 3]);
  });

  it("un-teamed players (canonical team 0) produce no pairs at all, not even with each other", () => {
    const origins = [fabricateOrigin(0, 0, 1), fabricateOrigin(1, 0, 2)];
    const teams = fabricateTeams([0, 0]); // both un-teamed
    expect(teamPairs(origins, teams)).toEqual([]);
  });

  it("ignores neutral lands entirely (no `.player`)", () => {
    const origins = [fabricateOrigin(0, 0, 1), fabricateOrigin(1, 0, undefined)];
    const teams = fabricateTeams([1]);
    expect(teamPairs(origins, teams)).toEqual([]);
  });
});

describe("landZonePairs", () => {
  it("connects lands from EITHER named zone, cross and intra pairs alike", () => {
    const origins = [
      fabricateOrigin(0, 0, 1, -8), // zone A
      fabricateOrigin(1, 0, 2, -8), // zone A
      fabricateOrigin(2, 0, 3, -7), // zone B
      fabricateOrigin(3, 0, 4, -6), // neither zone
    ];
    const pairs = landZonePairs(origins, -8, -7);
    expect(pairs).toHaveLength(3); // C(3,2): 0-1 (intra A), 0-2, 1-2 (cross)
    expect(pairs).toContainEqual([0, 1]);
    expect(pairs).toContainEqual([0, 2]);
    expect(pairs).toContainEqual([1, 2]);
  });
});

describe("sameZonePairs (create_connect_same_land_zones: groups by zone, NOT a synonym for all_lands)", () => {
  it("connects lands WITHIN a shared zone, never across zones", () => {
    const origins = [
      fabricateOrigin(0, 0, 1, -9), // zone -9
      fabricateOrigin(1, 0, undefined, -10), // zone -10
      fabricateOrigin(2, 0, undefined, -10), // zone -10 (same as the previous one)
    ];
    const pairs = sameZonePairs(origins);
    expect(pairs).toEqual([[1, 2]]); // only the two zone -10 lands pair up
  });

  it("excludes zone -12 from grouping ('belongs to no zone', Sec.6.1)", () => {
    const origins = [fabricateOrigin(0, 0, undefined, -12), fabricateOrigin(1, 0, undefined, -12)];
    expect(sameZonePairs(origins)).toEqual([]);
  });

  it("produces nothing when every land is in its own distinct zone", () => {
    const origins = [fabricateOrigin(0, 0, 1, -9), fabricateOrigin(1, 0, 2, -8), fabricateOrigin(2, 0, 3, -7)];
    expect(sameZonePairs(origins)).toEqual([]);
  });
});

describe("crossPairs (create_connect_to_nonplayer_land's bipartite pairing)", () => {
  it("pairs every element of A with every element of B, never within a set", () => {
    expect(crossPairs([0, 1], [2, 3])).toEqual([
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
    ]);
  });

  it("is empty when either side is empty", () => {
    expect(crossPairs([], [1, 2])).toEqual([]);
    expect(crossPairs([1, 2], [])).toEqual([]);
  });
});

describe("readTerrainCosts / readTerrainSizes / readReplacementRules (Sec.6.5)", () => {
  it("terrain_cost accumulates a lookup, last-wins for a repeated terrain", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_all_lands {",
      "terrain_cost WATER 5",
      "terrain_cost DIRT 2",
      "terrain_cost WATER 9",
      "}",
    ].join("\n");
    const cmd = connectionCommand(source, "create_connect_all_lands");
    const costs = readTerrainCosts(cmd, constants);
    expect(costs.get(WATER)).toBe(9);
    expect(costs.get(DIRT)).toBe(2);
  });

  it("terrain_size defaults variance to 0 when omitted", () => {
    const source = ["<CONNECTION_GENERATION>", "create_connect_all_lands {", "terrain_size DIRT 3\n", "}"].join("\n");
    const cmd = connectionCommand(source, "create_connect_all_lands");
    const sizes = readTerrainSizes(cmd, constants);
    expect(sizes.get(DIRT)).toEqual({ radius: 3, variance: 0 });
  });

  it("readReplacementRules + resolveReplacement: a later default_terrain_replacement overrides an earlier specific rule", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_all_lands {",
      "replace_terrain GRASS DIRT",
      "default_terrain_replacement WATER",
      "}",
    ].join("\n");
    const cmd = connectionCommand(source, "create_connect_all_lands");
    const rules = readReplacementRules(cmd, constants);
    expect(resolveReplacement(rules, GRASS)).toBe(WATER); // the later wildcard wins
  });

  it("resolveReplacement: a LATER specific rule still wins over an earlier default_terrain_replacement", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_all_lands {",
      "default_terrain_replacement WATER",
      "replace_terrain GRASS DIRT",
      "}",
    ].join("\n");
    const cmd = connectionCommand(source, "create_connect_all_lands");
    const rules = readReplacementRules(cmd, constants);
    expect(resolveReplacement(rules, GRASS)).toBe(DIRT); // GRASS's own later rule wins
    expect(resolveReplacement(rules, WATER)).toBe(WATER); // untouched terrain still gets the (earlier) wildcard
  });

  it("resolveReplacement returns undefined (no replacement) when nothing matches and there is no wildcard", () => {
    const source = ["<CONNECTION_GENERATION>", "create_connect_all_lands {", "replace_terrain GRASS DIRT", "}"].join("\n");
    const cmd = connectionCommand(source, "create_connect_all_lands");
    const rules = readReplacementRules(cmd, constants);
    expect(resolveReplacement(rules, WATER)).toBeUndefined();
  });
});

describe("applyTerrainAlongPath", () => {
  it("replaces a disc of tiles around each path tile, sized by terrain_size's radius", () => {
    const dim = 20;
    const grid = createTileGrid(dim, GRASS);
    const center = tileIndex(grid, 10, 10);
    const rules: ReplacementRule[] = [{ from: GRASS, to: DIRT, order: 0 }];
    const sizes = new Map([[GRASS, { radius: 2, variance: 0 }]]);
    applyTerrainAlongPath(grid, [center], grid.terrain.slice(), sizes, rules, mulberry32(1));
    expect(grid.terrain[tileIndex(grid, 10, 10)]).toBe(DIRT); // center
    expect(grid.terrain[tileIndex(grid, 12, 10)]).toBe(DIRT); // exactly radius 2 away, still in the disc
    expect(grid.terrain[tileIndex(grid, 13, 10)]).toBe(GRASS); // 3 away, outside the disc
  });

  it("a negative rolled radius replaces nothing at that path tile", () => {
    const dim = 10;
    const grid = createTileGrid(dim, GRASS);
    const center = tileIndex(grid, 5, 5);
    const rules: ReplacementRule[] = [{ from: GRASS, to: DIRT, order: 0 }];
    const sizes = new Map([[GRASS, { radius: -1, variance: 0 }]]); // always negative, no variance
    applyTerrainAlongPath(grid, [center], grid.terrain.slice(), sizes, rules, mulberry32(1));
    expect(grid.terrain[center]).toBe(GRASS); // untouched
  });

  it("radius 0 still replaces the single path tile itself (not a no-op)", () => {
    const dim = 10;
    const grid = createTileGrid(dim, GRASS);
    const center = tileIndex(grid, 5, 5);
    const rules: ReplacementRule[] = [{ from: GRASS, to: DIRT, order: 0 }];
    const sizes = new Map([[GRASS, { radius: 0, variance: 0 }]]);
    applyTerrainAlongPath(grid, [center], grid.terrain.slice(), sizes, rules, mulberry32(1));
    expect(grid.terrain[center]).toBe(DIRT);
    expect(grid.terrain[tileIndex(grid, 6, 5)]).toBe(GRASS); // immediate neighbour untouched
  });

  it("an absent terrain_size entry defaults to radius 1, variance 0", () => {
    const dim = 10;
    const grid = createTileGrid(dim, GRASS);
    const center = tileIndex(grid, 5, 5);
    const rules: ReplacementRule[] = [{ from: GRASS, to: DIRT, order: 0 }];
    applyTerrainAlongPath(grid, [center], grid.terrain.slice(), new Map(), rules, mulberry32(1));
    expect(grid.terrain[tileIndex(grid, 5, 5)]).toBe(DIRT);
    expect(grid.terrain[tileIndex(grid, 6, 5)]).toBe(DIRT); // radius 1 default reaches the neighbour
    expect(grid.terrain[tileIndex(grid, 7, 5)]).toBe(GRASS); // 2 away: outside
  });
});

describe("applyConnections (Sec.6.5 end to end)", () => {
  it("no CONNECTION_GENERATION section -> no reports, no notes", () => {
    const { instantiated, grid } = bareGrid("<LAND_GENERATION>\n", 1, { mapSize: "Tiny" });
    const result = applyConnections(instantiated, grid, constants, [], 1);
    expect(result.reports).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("create_connect_all_players_land connects every player pair and paints terrain along the path", () => {
    const { instantiated, grid } = bareGrid("<CONNECTION_GENERATION>\ncreate_connect_all_players_land {\n}\n", 1, { mapSize: "Tiny" });
    const origins = [fabricateOrigin(2, 2, 1), fabricateOrigin(27, 27, 2), fabricateOrigin(5, 27, undefined)];
    stampLand(grid, 0, 1, 1, 3, 3);
    stampLand(grid, 1, 26, 26, 28, 28);
    stampLand(grid, 2, 4, 26, 6, 28);
    const result = applyConnections(instantiated, grid, constants, origins, 1);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({ attempted: 1, placed: 1 }); // only the two PLAYER lands pair up
  });

  it("create_connect_teams_lands with no teams in the lobby: zero pairs plus the 'teams' note", () => {
    const source = "<CONNECTION_GENERATION>\ncreate_connect_teams_lands {\n}\n";
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Tiny", teams: DEFAULT_TEAMS });
    const origins = [fabricateOrigin(2, 2, 1), fabricateOrigin(27, 27, 2)];
    stampLand(grid, 0, 1, 1, 3, 3);
    stampLand(grid, 1, 26, 26, 28, 28);
    const result = applyConnections(instantiated, grid, constants, origins, 1);
    expect(result.reports[0]).toMatchObject({ attempted: 0, placed: 0 });
    expect(result.notes.some((n) => n.key === "teams")).toBe(true);
  });

  it("create_connect_all_lands connects regardless of zone; create_connect_same_land_zones does NOT, when the two lands are in different zones", () => {
    // Different zones (a player land at its own default zone, a neutral
    // land at the shared default zone) -- all_lands connects them anyway,
    // same_land_zones does not, since they share no zone.
    const origins = [fabricateOrigin(2, 2, 1, -9), fabricateOrigin(27, 27, undefined, -10)];

    const allLands = bareGrid("<CONNECTION_GENERATION>\ncreate_connect_all_lands {\n}\n", 1, { mapSize: "Tiny" });
    stampLand(allLands.grid, 0, 1, 1, 3, 3);
    stampLand(allLands.grid, 1, 26, 26, 28, 28);
    const allLandsResult = applyConnections(allLands.instantiated, allLands.grid, constants, origins, 1);
    expect(allLandsResult.reports[0]).toMatchObject({ attempted: 1, placed: 1 });

    const sameZones = bareGrid("<CONNECTION_GENERATION>\ncreate_connect_same_land_zones {\n}\n", 1, { mapSize: "Tiny" });
    stampLand(sameZones.grid, 0, 1, 1, 3, 3);
    stampLand(sameZones.grid, 1, 26, 26, 28, 28);
    const sameZonesResult = applyConnections(sameZones.instantiated, sameZones.grid, constants, origins, 1);
    expect(sameZonesResult.reports[0]).toMatchObject({ attempted: 0, placed: 0 });
  });

  it("create_connect_same_land_zones connects lands that DO share a zone", () => {
    // Two neutral create_land origins share the default zone (-10, Sec.6.1) --
    // same_land_zones connects them even though all_lands would too, so
    // this is the positive case the negative test above needs alongside it.
    const origins = [fabricateOrigin(2, 2, undefined, -10), fabricateOrigin(27, 27, undefined, -10)];
    const { instantiated, grid } = bareGrid("<CONNECTION_GENERATION>\ncreate_connect_same_land_zones {\n}\n", 1, { mapSize: "Tiny" });
    stampLand(grid, 0, 1, 1, 3, 3);
    stampLand(grid, 1, 26, 26, 28, 28);
    const result = applyConnections(instantiated, grid, constants, origins, 1);
    expect(result.reports[0]).toMatchObject({ attempted: 1, placed: 1 });
  });

  it("create_connect_to_nonplayer_land: bipartite only, and blocks every LATER connection command with a note", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_to_nonplayer_land {\n}",
      "create_connect_all_players_land {\n}",
    ].join("\n");
    const { instantiated, grid } = bareGrid(source, 1, { mapSize: "Tiny" });
    const origins = [fabricateOrigin(2, 2, 1), fabricateOrigin(27, 27, 2), fabricateOrigin(5, 27, undefined)];
    stampLand(grid, 0, 1, 1, 3, 3);
    stampLand(grid, 1, 26, 26, 28, 28);
    stampLand(grid, 2, 4, 26, 6, 28);
    const result = applyConnections(instantiated, grid, constants, origins, 1);
    expect(result.reports).toHaveLength(2);
    // to_nonplayer_land: player x neutral -> exactly 2 pairs (P1-N, P2-N).
    expect(result.reports[0]).toMatchObject({ attempted: 2 });
    // the LATER all_players_land command is blocked entirely.
    expect(result.reports[1]).toMatchObject({ attempted: 0, placed: 0 });
    expect(result.notes.some((n) => n.key.startsWith("connectionBlockedByBug"))).toBe(true);
  });

  it("reports connectionBlocked when no path exists between a pair", () => {
    const { instantiated, grid } = bareGrid("<CONNECTION_GENERATION>\ncreate_connect_all_players_land {\nterrain_cost WATER 0\n}\n", 1, {
      mapSize: "Tiny",
    });
    const dim = grid.dim; // read the REAL dim -- Tiny is 120, not a guessed value
    const origins = [fabricateOrigin(2, 10, 1), fabricateOrigin(dim - 3, 10, 2)];
    stampLand(grid, 0, 1, 9, 3, 11);
    stampLand(grid, 1, dim - 4, 9, dim - 2, 11);
    for (let y = 0; y < dim; y++) grid.terrain[tileIndex(grid, Math.floor(dim / 2), y)] = WATER;
    const result = applyConnections(instantiated, grid, constants, origins, 1);
    expect(result.reports[0]).toMatchObject({ attempted: 1, placed: 0 });
    expect(result.reports[0].failures[0].bucket).toBe("connectionBlocked");
  });

  /**
   * Both accumulate_connections tests share one geometry: two player lands
   * either side of a FULL-HEIGHT wall with a single one-tile gap, so that
   * gap is the ONLY possible route (same "moat" shape as the earlier,
   * already-passing impassable-moat test — a partial wall isn't enough,
   * since a path can simply detour around it through open space elsewhere
   * on the map). Command 1 always paints that gap tile from GRASS to WATER
   * (`replace_terrain`, its own `terrain_cost WATER 0` forces its path
   * through the gap in the first place). Command 2 always declares
   * `terrain_cost WATER 0` and reconnects the SAME pair, so whether it
   * succeeds depends entirely on whether it reads the pre-S5 snapshot
   * (gap still GRASS, cost 1) or the live grid (gap now WATER too,
   * impassable) -- exactly the accumulate_connections switch.
   */
  function bottleneckSetup(source: string, seed: number) {
    const { instantiated, grid } = bareGrid(source, seed, { mapSize: "Tiny" });
    const dim = grid.dim;
    const midY = Math.floor(dim / 2);
    const wallX = Math.floor(dim / 2);
    const origins = [fabricateOrigin(4, midY, 1), fabricateOrigin(dim - 5, midY, 2)];
    stampLand(grid, 0, 3, midY - 1, 5, midY + 1);
    stampLand(grid, 1, dim - 6, midY - 1, dim - 4, midY + 1);
    for (let y = 0; y < dim; y++) {
      if (y === midY) continue; // the single gap
      grid.terrain[tileIndex(grid, wallX, y)] = WATER;
    }
    const result = applyConnections(instantiated, grid, constants, origins, seed);
    return { result, grid };
  }

  it("accumulate_connections: without it, a second command's terrain_cost ignores what the first command just painted", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_all_players_land {\nterrain_cost WATER 0\nreplace_terrain GRASS WATER\n}",
      "create_connect_all_players_land {\nterrain_cost WATER 0\n}",
    ].join("\n");
    const { result } = bottleneckSetup(source, 5);
    expect(result.reports[0]).toMatchObject({ placed: 1 }); // paints the (only open) corridor to WATER
    // Command 2's `terrain_cost WATER 0` reads the FROZEN pre-S5 snapshot,
    // where the corridor was still GRASS -- so it is unaffected by what
    // command 1 just painted and finds the same route again.
    expect(result.reports[1]).toMatchObject({ placed: 1 });
  });

  it("accumulate_connections: WITH it, a later command's terrain_cost DOES see an earlier command's painted output", () => {
    const source = [
      "<CONNECTION_GENERATION>",
      "create_connect_all_players_land {\nterrain_cost WATER 0\nreplace_terrain GRASS WATER\n}",
      "accumulate_connections",
      "create_connect_all_players_land {\nterrain_cost WATER 0\n}",
    ].join("\n");
    const { result } = bottleneckSetup(source, 5);
    expect(result.reports[0]).toMatchObject({ placed: 1 }); // paints the (only open) corridor to WATER
    // Command 2 now reads the LIVE grid: the corridor itself is now WATER
    // too, cost 0, and it was the only route -- blocked.
    expect(result.reports[1]).toMatchObject({ placed: 0 });
    expect(result.reports[1].failures[0].bucket).toBe("connectionBlocked");
  });

  it("full pipeline (S1-S5) never throws on a plain script", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_player_lands { land_percent 8 }",
      "<ELEVATION_GENERATION>",
      "create_elevation 5 { number_of_tiles 100 }",
      "<CLIFF_GENERATION>",
      "<TERRAIN_GENERATION>",
      "create_terrain DIRT { number_of_tiles 200 }",
      "<CONNECTION_GENERATION>",
      "create_connect_all_players_land { }",
    ].join("\n");
    expect(() => place(source, 42, { mapSize: "Normal" })).not.toThrow();
  });
});

describe("corpus: applyConnections never throws", () => {
  // One `it()` per map, matching the established convention (see build log).
  const corpusDir = join(REPO_ROOT, "test-maps");
  const corpusFiles = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of corpusFiles) {
    // 15s, not the 5s default: unlike the other stages' corpus gates, S5's
    // real cost scales with land-pair count (a map with ~27 lands and
    // multiple create_connect_all_lands commands, e.g. `AD4 - Pag -
    // v1.2.rms`, runs several hundred A* searches) -- under 1s in
    // isolation, but that genuinely-higher cost is exactly what tips it
    // over vitest's 5s default under full-suite parallel load, observed
    // failing 2 of 3 full-suite runs while passing standalone every time.
    // Not a bug to architect around (no iteration cap is warranted here --
    // Sec.11 names pathological CLUMP counts, not land-pair counts, and
    // this corpus has nothing resembling a 9320-land script), just an
    // honestly slower gate than its neighbours.
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
