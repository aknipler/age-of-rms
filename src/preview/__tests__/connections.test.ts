// S5, the connection stage (preview-design Sec.6.5, rev 11). The exact model
// is held to DE by `deWholeScriptMaps.test.ts`, on every connection map of
// the study (rounds CO and CF). The tests here pin its rules one at a time
// on small hand-built maps, so a failure names the rule.

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
  tileIndex,
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
  COMPOSITE_AS_TERRAIN,
  applyTerrains,
  type CompositeRecord,
} from "../generator/terrains";
import { applyConnections } from "../generator/connections";
import { createDeStream } from "../generator/deRandom";
import type {
  InstantiatedScript,
  LandOrigin,
  TileGrid,
} from "../generator/types";
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
const DIRT = id("DIRT");
const ROAD = id("ROAD");
const SNOW = id("SNOW");

function settings(
  overrides: {
    playerCount?: number;
    mapSize?: MapSize;
    teams?: readonly TeamNumber[];
  } = {},
) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

/** Full pipeline through S5. */
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
  const terrained = applyTerrains(
    instantiated,
    grid,
    constants,
    landResult.origins,
    cliffed.stream,
  );
  const connectionsResult = applyConnections(
    instantiated,
    grid,
    constants,
    landResult.origins,
    terrained.stream,
  );
  return {
    grid,
    dim: instantiated.dim,
    origins: landResult.origins,
    before: terrained.stream,
    ...connectionsResult,
  };
}

const ZERO_SPAN = { start: 0, end: 0 };

function origin(
  x: number,
  y: number,
  player: number | undefined,
  zone = -10,
): LandOrigin {
  return {
    commandSpan: ZERO_SPAN,
    x,
    y,
    zone,
    player,
    baseSize: 0,
    circularBase: false,
    clumpingFactor: 8,
    borderFuzziness: 20,
    otherZoneAvoidanceDistance: 0,
    minPlacementDistance: 0,
    behaviorVersion: 0,
    declaredTargetTiles: 0,
    landConformity: 0,
    target: 0,
    fromOriginFallback: false,
    borderTiles: { left: 0, right: x * 2, top: 0, bottom: y * 2 },
    generateMode: 0,
    height: 0,
  };
}

/**
 * The connection stage alone, on a GRASS map of side `dim` with the given
 * origins and `<CONNECTION_GENERATION>` body. Returns the map and the draws
 * the stage spent.
 */
function connect(
  body: string,
  origins: LandOrigin[],
  dim = 40,
  paint?: (grid: TileGrid) => void,
  composites?: CompositeRecord,
) {
  const instantiated = instantiateScript(
    parseRms(`<CONNECTION_GENERATION>\n${body}\n`, lang),
    refDb,
    settings({ playerCount: 2, mapSize: "Tiny" }),
    1,
  );
  const grid = createTileGrid(dim, GRASS);
  paint?.(grid);
  const start = createDeStream(1000).state();
  const result = applyConnections(
    { ...instantiated, dim },
    grid,
    constants,
    origins,
    start,
    composites,
  );
  return { grid, ...result, draws: result.stream.count - start.count };
}

const count = (grid: TileGrid, terrain: number): number =>
  grid.terrain.filter((t) => t === terrain).length;

describe("the section (de-connections-objects.md 2.1)", () => {
  it("does nothing and spends no draw without a section", () => {
    const result = place("<LAND_GENERATION>\nbase_terrain GRASS\n");
    expect(result.reports).toEqual([]);
    expect(result.stream).toEqual(result.before);
  });

  it("burns one draw for an empty section (cn9)", () => {
    expect(connect("", []).draws).toBe(1);
  });
});

describe("one path (3.1 and 3.2)", () => {
  const two = [origin(5, 20, 1), origin(30, 20, 2)];

  it("paints the start and every tile up to, but not including, the target (cn1)", () => {
    const { grid } = connect(
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 }",
      two,
    );
    expect(grid.terrain[tileIndex(grid, 5, 20)]).toBe(ROAD);
    expect(grid.terrain[tileIndex(grid, 29, 20)]).toBe(ROAD);
    expect(grid.terrain[tileIndex(grid, 30, 20)]).toBe(GRASS);
    expect(count(grid, ROAD)).toBe(25);
  });

  it("spends four draws per painted tile, even at variance 0 (cn3a)", () => {
    const { draws } = connect(
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 }",
      two,
    );
    expect(draws).toBe(1 + 4 * 25);
  });

  it("paints a square of side 2s + 1 around each tile at variance 0 (cn2)", () => {
    const { grid } = connect(
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 2 0 }",
      two,
    );
    for (let y = 18; y <= 22; y++)
      expect(grid.terrain[tileIndex(grid, 15, y)]).toBe(ROAD);
    expect(grid.terrain[tileIndex(grid, 15, 23)]).toBe(GRASS);
  });

  it("goes around a cost-0 wall rather than through it, and never cuts its corner (cn4)", () => {
    const { grid, reports } = connect(
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 terrain_cost SNOW 0 }",
      two,
      40,
      (g) => {
        for (let y = 5; y <= 35; y++) g.terrain[tileIndex(g, 18, y)] = SNOW;
      },
    );
    expect(reports[0]).toMatchObject({ attempted: 1, placed: 1 });
    expect(count(grid, SNOW)).toBe(31);
    expect(
      [4, 36].some((y) => grid.terrain[tileIndex(grid, 18, y)] === ROAD),
    ).toBe(true);
  });

  it("a cost-0 origin blocks the paths arriving at it, not the ones leaving it (cn5a, cn5b)", () => {
    const body =
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 terrain_cost DIRT 0 }";
    const atStart = connect(body, two, 40, (g) => {
      g.terrain[tileIndex(g, 5, 20)] = DIRT;
    });
    expect(atStart.reports[0].placed).toBe(1);
    const atTarget = connect(body, two, 40, (g) => {
      g.terrain[tileIndex(g, 30, 20)] = DIRT;
    });
    expect(atTarget.reports[0].placed).toBe(0);
    expect(atTarget.reports[0].failures[0].bucket).toBe("connectionBlocked");
  });

  it("takes a painted tile's layer away", () => {
    const { grid } = connect(
      "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 }",
      two,
      40,
      (g) => g.layer.fill(SNOW),
    );
    expect(grid.layer[tileIndex(grid, 10, 20)]).toBe(NO_LAYER);
    expect(grid.layer[tileIndex(grid, 10, 25)]).toBe(SNOW);
  });

  it("reads a composite tile as painted, and the tile it repaints stops being one (5.3)", () => {
    const composites: CompositeRecord = {
      kind: new Uint8Array(40 * 40),
      terrain: new Uint16Array(40 * 40).fill(GRASS),
      layer: new Uint16Array(40 * 40).fill(NO_LAYER),
    };
    for (let x = 0; x < 40; x++) {
      composites.kind[20 * 40 + x] = COMPOSITE_AS_TERRAIN;
      composites.terrain[20 * 40 + x] = 62;
    }
    const { grid } = connect(
      "create_connect_all_players_land { replace_terrain 62 ROAD terrain_size GRASS 0 0 terrain_size 62 0 0 }",
      two,
      40,
      undefined,
      composites,
    );
    expect(grid.terrain[tileIndex(grid, 10, 20)]).toBe(ROAD);
    expect(composites.kind[20 * 40 + 10]).toBe(0);
    expect(composites.kind[20 * 40 + 35]).toBe(COMPOSITE_AS_TERRAIN);
  });
});

describe("the command list (2.3)", () => {
  const lands = [origin(5, 5, 1), origin(30, 30, 2), origin(5, 30, undefined)];
  const road =
    "{ replace_terrain GRASS ROAD replace_terrain DIRT DESERT terrain_size GRASS 0 0 }";

  it("connects every land for same_land_zones, exactly as all_lands (k10)", () => {
    const zoned = [
      origin(5, 5, 1, -9),
      origin(30, 30, 2, -8),
      origin(5, 30, undefined),
    ];
    const a = connect(`create_connect_all_lands ${road}`, zoned).grid.terrain;
    const b = connect(`create_connect_same_land_zones ${road}`, zoned).grid
      .terrain;
    expect(b).toEqual(a);
  });

  it("connects nothing for teams_lands in a lobby without teams (cn7a)", () => {
    const { grid, notes } = connect(
      `create_connect_teams_lands ${road}`,
      lands,
    );
    expect(count(grid, ROAD)).toBe(0);
    expect(notes.some((n) => n.key === "teams")).toBe(true);
  });

  it("to_nonplayer_land writes over the next k commands, k the player lands, and a later one survives (cn7d)", () => {
    const { grid, notes } = connect(
      [
        `create_connect_to_nonplayer_land ${road}`,
        "create_connect_all_players_land { replace_terrain GRASS SNOW terrain_size GRASS 0 0 }",
        "create_connect_all_lands { replace_terrain GRASS SNOW terrain_size GRASS 0 0 }",
        "create_connect_all_players_land { replace_terrain GRASS DIRT terrain_size GRASS 0 0 }",
      ].join("\n"),
      lands,
    );
    expect(count(grid, SNOW)).toBe(0);
    expect(count(grid, ROAD)).toBeGreaterThan(0);
    expect(count(grid, DIRT)).toBeGreaterThan(0);
    expect(
      notes.filter((n) => n.key.startsWith("connectionBlockedByBug")),
    ).toHaveLength(2);
  });
});

describe("between commands: the undo (3.3)", () => {
  const two = [origin(5, 20, 1), origin(30, 20, 2)];

  it("a later command does not see an earlier command's road, and both show at the end", () => {
    // The second command turns ROAD into SNOW. It cannot see the first
    // command's road, so the end shows the road, not snow.
    const { grid } = connect(
      [
        "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 }",
        "create_connect_all_players_land { replace_terrain ROAD SNOW terrain_size GRASS 0 0 terrain_size ROAD 0 0 }",
      ].join("\n"),
      two,
    );
    expect(count(grid, ROAD)).toBe(25);
    expect(count(grid, SNOW)).toBe(0);
  });

  it("with accumulate_connections, a later command does see it (cn6b)", () => {
    const { grid } = connect(
      [
        "accumulate_connections",
        "create_connect_all_players_land { replace_terrain GRASS ROAD terrain_size GRASS 0 0 }",
        "create_connect_all_players_land { replace_terrain ROAD SNOW terrain_size GRASS 0 0 terrain_size ROAD 0 0 }",
      ].join("\n"),
      two,
    );
    expect(count(grid, SNOW)).toBe(25);
  });
});

describe("applyConnections end to end", () => {
  it("goldenHill.rms (the tutorial's final script): each connection reaches the land ORIGINS at both ends, where the TC sits", () => {
    // A beta tester finished the tutorial and the roads in the preview
    // stopped well short of every TC. Connections run "between the origins
    // of lands" (guide:1730, 1759, 1792), and the TC is placed at the
    // player origin (`max_distance_to_players 0`), so a road that does not
    // reach the origin is a road that does not reach the TC. The script
    // declares no `terrain_size`, so the disc around the final path tile
    // has radius 1 (guide:1958): a ROAD tile must sit within 1 tile of
    // every player origin AND of the neutral land's origin.
    const source = readFileSync(
      join(
        REPO_ROOT,
        "src",
        "tutorial",
        "__tests__",
        "fixtures",
        "goldenHill.rms",
      ),
      "utf8",
    );
    const { grid, dim, origins, reports } = place(source, 7, {
      playerCount: 4,
      mapSize: "Normal",
    });
    expect(reports[0]).toMatchObject({ attempted: 4, placed: 4 });
    const nearestRoad = (ox: number, oy: number): number => {
      let best = Infinity;
      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          if (grid.terrain[tileIndex(grid, x, y)] !== ROAD) continue;
          const d = Math.max(Math.abs(x - ox), Math.abs(y - oy));
          if (d < best) best = d;
        }
      }
      return best;
    };
    const gaps = origins.map((origin) => {
      const label =
        origin.player !== undefined ? `P${origin.player}` : "neutral";
      return `${label} (${origin.x}, ${origin.y}): ${nearestRoad(origin.x, origin.y)}`;
    });
    const tooFar = origins.filter((o) => nearestRoad(o.x, o.y) > 1);
    expect(
      tooFar,
      `tiles from each origin to the nearest ROAD tile: ${gaps.join("; ")}`,
    ).toEqual([]);
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
    // 60s, not the 5s default: unlike the other stages' corpus gates, S5's
    // real cost scales with land-pair count (a map with ~27 lands and
    // multiple create_connect_all_lands commands, e.g. `AD4 - Pag -
    // v1.2.rms`, runs several hundred A* searches) -- fast in isolation, but
    // that genuinely-higher cost is exactly what tips it over vitest's 5s
    // default under full-suite parallel load, observed failing 2 of 3
    // full-suite runs while passing standalone every time.
    // Not a bug to architect around (no iteration cap is warranted here --
    // Sec.11 names pathological CLUMP counts, not land-pair counts, and
    // this corpus has nothing resembling a 9320-land script), just an
    // honestly slower gate than its neighbours.
    //
    // **Raised from 15s on 2026-08-08, after it went red twice on a stage
    // that session never touched.** The number to size this against is the
    // LOAD FACTOR, not the cost: `24hr_Caverns.rms` is the worst map at 8.4s
    // standalone and took 16.8s under full-suite load, reproducing to the
    // millisecond across two runs. This machine has been recorded at up to
    // 3.7x between an isolated and a loaded run of the same code, so a
    // ceiling under ~2x the standalone worst case is a coin flip. 60s is
    // ~7x, chosen the same way `corpus.test.ts`'s Vanguard benchmark was
    // rewritten to a relative bound: a wall clock on a shared machine
    // measures the machine, so leave enough room that only a complexity
    // change can trip it.
    it(
      name,
      () => {
        const source = readFileSync(join(corpusDir, name), "utf8");
        expect(() => place(source, 12345)).not.toThrow();
      },
      60000,
    );
  }
});
