import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createTileGrid, type TerrainConstantForMasks } from "../generator/grid";
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "../generator/lands";
import { applyElevation } from "../generator/elevation";
import { applyCliffs } from "../generator/cliffs";
import { applyTerrains } from "../generator/terrains";
import { applyConnections } from "../generator/connections";
import {
  applyObjects,
  isGrouped,
  isTightGrouping,
  objectCategory,
  objectGroupMembers,
  objectHabitat,
  requiresGaiaOnly,
  resolveObjectCounts,
  resolveObjectFrames,
  type ObjectConstant,
} from "../generator/objects";
import type { InstantiatedScript, LandOrigin, TileGrid } from "../generator/types";
import { DEFAULT_TEAMS, type MapSize, type TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const rawConstants = JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as {
  constants: TerrainConstantForMasks[];
};
const constants: ObjectConstant[] = rawConstants.constants as ObjectConstant[];
const GRASS = constants.find((c) => c.rmsConstant === "GRASS")!.constId!;

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 4,
    mapSize: overrides.mapSize ?? "Tiny",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

/** Full pipeline through S6. */
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
  applyConnections(instantiated, grid, constants, landResult.origins, seed);
  const objectsResult = applyObjects(instantiated, grid, constants, landResult.origins, seed);
  return { grid, dim: instantiated.dim, origins: landResult.origins, ...objectsResult };
}

/** create_object command against a bare grid (no lands) — for gaia-scatter tests that don't need real player origins. */
function bare(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  return applyObjects(instantiated, grid, constants, [], seed);
}

function objectCommand(source: string, overrides?: Parameters<typeof settings>[0]) {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), 1);
  const cmd = instantiated.sections.get("OBJECTS_GENERATION")?.find((c) => c.name === "create_object");
  if (!cmd) throw new Error("fixture has no create_object command");
  return cmd;
}

const ZERO_SPAN = { start: 0, end: 0 };

function fabricateOrigin(x: number, y: number, player: number | undefined, declaredLandId?: number): LandOrigin {
  return {
    commandSpan: ZERO_SPAN,
    x,
    y,
    zone: player !== undefined ? player - 10 : -10,
    declaredLandId,
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
    borderBounds: { minX: 0, maxX: 200, minY: 0, maxY: 200 },
    generateMode: 0,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isGrouped (Sec.6.6: four independent triggers)", () => {
  it("false with none of the four attributes", () => {
    expect(isGrouped(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 }"))).toBe(false);
  });
  it("true via number_of_groups", () => {
    expect(isGrouped(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_groups 3 }"))).toBe(true);
  });
  it("true via group_placement_radius alone (Sec.6.6's own worked example: 5 objects, one group)", () => {
    expect(isGrouped(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 group_placement_radius 3 }"))).toBe(true);
  });
  it("true via set_tight_grouping", () => {
    expect(isGrouped(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_tight_grouping }"))).toBe(true);
  });
  it("true via set_loose_grouping", () => {
    expect(isGrouped(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_loose_grouping }"))).toBe(true);
  });
});

describe("isTightGrouping (Sec.15 item 17c: tight is the current default when undeclared)", () => {
  it("true when neither mode stated", () => {
    expect(isTightGrouping(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_groups 2 }"))).toBe(true);
  });
  it("true when set_tight_grouping stated", () => {
    expect(isTightGrouping(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_tight_grouping }"))).toBe(true);
  });
  it("false when set_loose_grouping stated", () => {
    expect(isTightGrouping(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_loose_grouping }"))).toBe(false);
  });
});

describe("requiresGaiaOnly (Sec.12 item 3 fallback: any resourceAmounts -> must be gaia)", () => {
  it("GOLD requires it", () => expect(requiresGaiaOnly("GOLD", constants)).toBe(true));
  it("STONE requires it", () => expect(requiresGaiaOnly("STONE", constants)).toBe(true));
  it("HOUSE does not (no resourceAmounts)", () => expect(requiresGaiaOnly("HOUSE", constants)).toBe(false));
  it("an unresolvable name does not", () => expect(requiresGaiaOnly("NOT_A_REAL_OBJECT", constants)).toBe(false));
  it("SHEEP requires it under this fallback — the documented herdable miscalibration (file header note 2)", () => {
    // Guide: sheep is gaia-CAPABLE but not required. Our fallback can't tell
    // the difference from GOLD without real playerOwnable data, and this
    // test pins that known gap rather than silently hiding it.
    expect(requiresGaiaOnly("SHEEP", constants)).toBe(true);
  });
});

describe("objectHabitat (the terrain table's coarse stand-in)", () => {
  it("reads the declared habitat when the reference data has one", () => {
    expect(objectHabitat("FISH", constants)).toBe("water");
    expect(objectHabitat("SHORE_FISH", constants)).toBe("shore");
  });

  it("puts the DE ocean-fish family in the water, where the 'land' fallback used to put it ashore", () => {
    // Six rows added because the fallback's failure is not rare: a script
    // placing a fish on OPEN water has no reason to write
    // `terrain_to_place_on`, so `QS_Three_Bays_v1.1.rms`'s nine bare TUNA
    // commands took the land default and put 77 of 119 tuna on the beach.
    for (const name of ["TUNA", "SNAPPER", "SALMON", "DORADO", "MARLIN1", "OYSTERS"]) {
      expect(objectHabitat(name, constants)).toBe("water");
    }
  });

  it("groups DLC_BOXTURTLE with SHORE_FISH, which is what the guide's own gloss does", () => {
    // guide:4991 defines MELKARYBA as "small fish, ie. shore fish or box
    // turtles" — one family, one habitat, both standing in the water.
    expect(objectHabitat("DLC_BOXTURTLE", constants)).toBe("shore");
  });

  it("falls back to 'land' for an object with no declared habitat", () => {
    expect(objectHabitat("GOLD", constants)).toBe("land");
  });

  it("falls back to 'land' for an object the reference data has never heard of, NOT 'any'", () => {
    // The fallback used to be "any" (unrestricted). Since the data knows 16
    // objects of several hundred, that made every tree in every real script
    // unrestricted: 21 of 40 OLIVE_TREEs stood in open water on
    // `AD4 - Pag - v1.2.rms`. See objectHabitat's own doc for why the two
    // possible defaults are not symmetric.
    expect(objectHabitat("NOT_A_REAL_OBJECT", constants)).toBe("land");
    expect(objectHabitat("OLIVE_TREE", constants)).toBe("land");
  });
});

describe("terrain restrictions (the engine's terrain table, applied end to end)", () => {
  const WATER = constants.find((c) => c.rmsConstant === "WATER")!.constId!;

  /** Half the map water, half land, then run S6 ONLY — S1-S5 would repaint it. */
  function placeOnSplitMap(source: string, seed = 1, layerId = 0) {
    const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(), seed);
    const grid = createTileGrid(instantiated.dim, GRASS, layerId);
    for (let y = 0; y < grid.dim; y++) {
      for (let x = 0; x < grid.dim / 2; x++) grid.terrain[y * grid.dim + x] = WATER;
    }
    const result = applyObjects(instantiated, grid, constants, [], seed);
    return { grid, ...result };
  }

  const onWater = (grid: TileGrid, o: { x: number; y: number }) => grid.terrain[o.y * grid.dim + o.x] === WATER;
  const script = (body: string) => "<OBJECTS_GENERATION>\ncreate_object " + body;

  it("keeps an unknown land object out of the water", () => {
    // OLIVE_TREE is not in the reference data, so it takes the `land`
    // fallback. Under the old `any` fallback roughly half of these landed in
    // open sea — measured on AD4 - Pag, 21 of 40.
    const { grid, objects } = placeOnSplitMap(script("OLIVE_TREE {\nnumber_of_objects 200\n}\n"));
    expect(objects.length).toBeGreaterThan(50);
    expect(objects.filter((o) => onWater(grid, o))).toHaveLength(0);
  });

  it("keeps a known water object out of the land", () => {
    const { grid, objects } = placeOnSplitMap(script("FISH {\nnumber_of_objects 200\n}\n"));
    expect(objects.length).toBeGreaterThan(50);
    expect(objects.every((o) => onWater(grid, o))).toBe(true);
  });

  it("holds a shore object to the waterline", () => {
    const { grid, objects } = placeOnSplitMap(script("SHORE_FISH {\nnumber_of_objects 200\n}\n"));
    expect(objects.length).toBeGreaterThan(0);
    // The split runs down x = dim/2, so every placement must sit on one of
    // the two columns either side of it.
    const half = grid.dim / 2;
    for (const o of objects) expect(Math.abs(o.x - (half - 0.5))).toBeLessThanOrEqual(1.5);
  });

  it("lets ignore_terrain_restrictions through, which is the documented opt-out", () => {
    const { grid, objects } = placeOnSplitMap(script("OLIVE_TREE {\nnumber_of_objects 200\nignore_terrain_restrictions\n}\n"));
    expect(objects.some((o) => onWater(grid, o))).toBe(true);
  });

  it("ignore_terrain_restrictions lifts the terrain TABLE, not the script's own terrain_to_place_on", () => {
    // guide:2511 says the two "can be used in combination". Gating the whole
    // block on the flag cancelled the author's own instruction, which is how
    // `AK_Six_Points_v1.4.rms` got 11 DLC_ANIMALSKELETONs into open water
    // from a command that says `terrain_to_place_on DIRT`.
    const { grid, objects } = placeOnSplitMap(
      script("OLIVE_TREE {\nnumber_of_objects 200\nterrain_to_place_on WATER\nignore_terrain_restrictions\n}\n"),
    );
    expect(objects.length).toBeGreaterThan(50);
    // The flag let it onto water, and terrain_to_place_on kept it there.
    expect(objects.every((o) => onWater(grid, o))).toBe(true);
  });

  it("lets terrain_to_place_on override the guessed habitat, since it names the ground itself", () => {
    // The escape hatch every script uses for an unknown water object
    // (Menindee does exactly this for all of its fish). Without it the `land`
    // fallback would silently place nothing.
    const { grid, objects } = placeOnSplitMap(script("FISH_PLACEHOLDER {\nnumber_of_objects 100\nterrain_to_place_on WATER\n}\n"));
    expect(objects.length).toBeGreaterThan(50);
    expect(objects.every((o) => onWater(grid, o))).toBe(true);
  });

  it("does NOT let layer_to_place_on override it, because a layer says nothing about the ground", () => {
    // AD4 - Pag's stragglers, exactly: `layer_to_place_on GRASS` on a tree,
    // with the GRASS layer surviving underneath water terrain.
    const { grid, objects } = placeOnSplitMap(script("OLIVE_TREE {\nnumber_of_objects 200\nlayer_to_place_on GRASS\n}\n"), 1, GRASS);
    expect(objects.length).toBeGreaterThan(20);
    expect(objects.filter((o) => onWater(grid, o))).toHaveLength(0);
  });

  it("stops a tight group's fill at the waterline — the terrain table is not one of the attributes a fill skips", () => {
    const { grid, objects } = placeOnSplitMap(script("GOLD {\nnumber_of_objects 7\nnumber_of_groups 20\nset_tight_grouping\n}\n"));
    expect(objects.length).toBeGreaterThan(20);
    expect(objects.filter((o) => onWater(grid, o))).toHaveLength(0);
  });
});

describe("objectCategory (Sec.12 item 8 fallback)", () => {
  it("GOLD -> resource-gold", () => expect(objectCategory("GOLD", constants)).toBe("resource-gold"));
  it("STONE -> resource-stone", () => expect(objectCategory("STONE", constants)).toBe("resource-stone"));
  it("FORAGE -> resource-food", () => expect(objectCategory("FORAGE", constants)).toBe("resource-food"));
  it("HOUSE (no resourceAmounts) -> generic object bucket", () => expect(objectCategory("HOUSE", constants)).toBe("object"));

  it("names a tree as wood so it draws green, not as an unknown object", () => {
    // Cosmetic only, and the reason it is a name pattern is in
    // TREE_NAME_PATTERN's own doc: the alternative is the near-white unknown
    // colour, which buries forest terrain under white dots.
    for (const name of ["OLIVE_TREE", "CYPRESS_TREE", "ITALIAN_PINETREE", "DLC_DRAGONTREE", "FORAGE_BUSH", "PLANT_RAINFOREST"]) {
      expect(objectCategory(name, constants)).toBe("resource-wood");
    }
  });

  it("does not call a non-tree a tree", () => {
    for (const name of ["DLC_BOXTURTLE", "TOWN_CENTER", "DLC_IBEX", "SCOUT"]) {
      expect(objectCategory(name, constants)).not.toBe("resource-wood");
    }
  });
});

describe("objectGroupMembers (create_object_group, guide:2025: % weights read but never consulted)", () => {
  it("reads every add_object member in order", () => {
    const instantiated = instantiateScript(
      parseRms("<OBJECTS_GENERATION>\ncreate_object_group HUNTABLE {\nadd_object DEER 50\nadd_object BOAR 50\n}\ncreate_object HUNTABLE", lang),
      refDb,
      settings(),
      1,
    );
    const groupCmd = instantiated.objectGroups.get("HUNTABLE");
    expect(groupCmd).toBeDefined();
    expect(objectGroupMembers(groupCmd!)).toEqual(["DEER", "BOAR"]);
  });
});

describe("resolveObjectCounts (Sec.6.6 Counts)", () => {
  it("defaults to 1 object, ungrouped", () => {
    const counts = resolveObjectCounts(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD"), 120, 4, false);
    expect(counts).toEqual({ groupCount: 1, perGroupBase: 1, variance: 0 });
  });
  it("ungrouped set_scaling_to_player_number scales the object count, not a group count", () => {
    const cmd = objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 3 set_scaling_to_player_number }");
    expect(resolveObjectCounts(cmd, 120, 4, false).perGroupBase).toBe(12);
  });
  it("grouped: scaling applies to groups, not to per-group object count (Sec.6.6: 'applies to groups when grouping is present')", () => {
    const cmd = objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 2 number_of_groups 3 set_scaling_to_player_number }");
    const counts = resolveObjectCounts(cmd, 120, 4, true);
    expect(counts.groupCount).toBe(12); // 3 * 4 players
    expect(counts.perGroupBase).toBe(2); // untouched
  });
  it("mutually exclusive scale attributes: last one (by source position) wins (guide:167/1257/1274)", () => {
    const cmd = objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 500 set_scaling_to_map_size set_scaling_to_player_number }");
    // player_number written second -> wins -> *4, not the map-size scaling.
    expect(resolveObjectCounts(cmd, 120, 4, false).perGroupBase).toBe(2000);
  });
});

describe("resolveObjectFrames (Sec.6.6 Reference frame)", () => {
  it("no attribute -> frameless single pass", () => {
    const res = resolveObjectFrames(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD"), []);
    expect(res.kind).toBe("none");
    expect(res.frames).toEqual([{}]);
  });
  it("set_place_for_every_player iterates every player land, skipping land_id-carrying ones (guide:2263)", () => {
    const origins = [fabricateOrigin(10, 10, 1), fabricateOrigin(20, 20, 2, 7), fabricateOrigin(30, 30, undefined)];
    const res = resolveObjectFrames(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_place_for_every_player }"), origins);
    expect(res.kind).toBe("everyPlayer");
    expect(res.frames.map((f) => f.player)).toEqual([1]); // player 2's land carries land_id -> skipped; neutral land has no player
  });
  it("generate_for_first_land_only restricts to a single land", () => {
    const origins = [fabricateOrigin(10, 10, 1), fabricateOrigin(20, 20, 2)];
    const res = resolveObjectFrames(
      objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_place_for_every_player generate_for_first_land_only }"),
      origins,
    );
    expect(res.frames).toHaveLength(1);
    expect(res.frames[0].player).toBe(1);
  });
  it("place_on_specific_land_id -11 degrades to the frameless case (Sec.6.6: 'random map position')", () => {
    const res = resolveObjectFrames(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { place_on_specific_land_id -11 }"), []);
    expect(res.kind).toBe("none");
  });
  it("place_on_specific_land_id matching no land reports missingLandId", () => {
    const res = resolveObjectFrames(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { place_on_specific_land_id 9 }"), [fabricateOrigin(5, 5, 1, 3)]);
    expect(res.frames).toHaveLength(0);
    expect(res.missingLandId).toBe(9);
  });
  it("place_on_specific_land_id matching a land resolves it", () => {
    const res = resolveObjectFrames(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { place_on_specific_land_id 3 }"), [fabricateOrigin(5, 5, 1, 3)]);
    expect(res.kind).toBe("specificLand");
    expect(res.frames).toHaveLength(1);
    expect(res.frames[0].x).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Instrumentation — one per FailureBucket this stage owns/emits (Sec.13)
// ---------------------------------------------------------------------------

describe("applyObjects: FailureBucket instrumentation", () => {
  it("gaiaOnlyRequired: a frame-referenced resource without set_gaia_object_only places nothing", () => {
    const source = "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 3 }\n<OBJECTS_GENERATION>\ncreate_object STONE { set_place_for_every_player number_of_objects 1 }";
    const { reports, objects } = place(source, 1, { playerCount: 2 });
    const report = reports.find((r) => r.stage === "S6");
    expect(report?.placed).toBe(0);
    expect(report?.failures[0]?.bucket).toBe("gaiaOnlyRequired");
    expect(objects).toHaveLength(0);
  });

  it("no gaiaOnlyRequired failure once set_gaia_object_only is added", () => {
    const source =
      "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 3 }\n<OBJECTS_GENERATION>\ncreate_object STONE { set_place_for_every_player set_gaia_object_only number_of_objects 1 }";
    const { reports } = place(source, 1, { playerCount: 2 });
    const report = reports.find((r) => r.stage === "S6");
    expect(report?.failures.some((f) => f.bucket === "gaiaOnlyRequired")).toBe(false);
    expect(report?.placed).toBeGreaterThan(0);
  });

  it("minExceedsMax: a deterministic zero, checked before any candidate work", () => {
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { min_distance_to_players 20 max_distance_to_players 10 }");
    expect(reports[0].failures[0].bucket).toBe("minExceedsMax");
    expect(reports[0].placed).toBe(0);
  });

  it("landMissing: place_on_specific_land_id naming an id nothing declares", () => {
    const source = "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 3 }\n<OBJECTS_GENERATION>\ncreate_object HOUSE { place_on_specific_land_id 77 }";
    const { reports } = place(source, 1, { playerCount: 2 });
    const report = reports.find((r) => r.stage === "S6");
    expect(report?.failures[0]?.bucket).toBe("landMissing");
  });

  it("terrainAbsent: terrain_to_place_on names a terrain absent from the map", () => {
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { terrain_to_place_on SNOW }"); // grid is all GRASS
    expect(reports[0].failures[0].bucket).toBe("terrainAbsent");
    expect(reports[0].placed).toBe(0);
  });

  it("borderBlocked: min_distance_to_map_edge larger than the whole map empties the set", () => {
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { min_distance_to_map_edge 100 }", 1, { mapSize: "Tiny" });
    expect(reports[0].failures[0].bucket).toBe("borderBlocked");
  });

  it("actorAreaMissing: actor_area_to_place_in references an id nothing ever created", () => {
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { actor_area_to_place_in 9999 }");
    expect(reports[0].failures[0].bucket).toBe("actorAreaMissing");
  });

  it("zoneAvoidanceBlocked: avoid_other_land_zones with an unreachable buffer inside a small land", () => {
    const source =
      "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 3 land_percent 1 }\n<OBJECTS_GENERATION>\ncreate_object HOUSE { place_on_specific_land_id 1 avoid_other_land_zones 50 }";
    // No land carries land_id 1 in this fixture -> exercise via a fabricated grid instead for a guaranteed land match.
    void source;
    const instantiated = instantiateScript(
      parseRms("<OBJECTS_GENERATION>\ncreate_object HOUSE { place_on_specific_land_id 3 avoid_other_land_zones 50 }", lang),
      refDb,
      settings({ playerCount: 2 }),
      1,
    );
    const grid = createTileGrid(instantiated.dim, GRASS);
    const origin = fabricateOrigin(5, 5, undefined, 3);
    // Stamp a tiny 1-tile land so no interior tile can be 50 from its own edge.
    grid.landId[5 * grid.dim + 5] = 0;
    const { reports } = applyObjects(instantiated, grid, constants, [origin], 1);
    expect(reports[0].failures[0].bucket).toBe("zoneAvoidanceBlocked");
  });

  it("groupPartial: a loose group with more members than fit in its radius", () => {
    const { reports, objects } = bare(
      "<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 40 number_of_groups 1 set_loose_grouping group_placement_radius 1 }",
      1,
      { mapSize: "Tiny" },
    );
    // A radius-1 Chebyshev neighbourhood has at most 8 tiles around a centre -> 40 members cannot all fit.
    expect(reports[0].failures.some((f) => f.bucket === "groupPartial")).toBe(true);
    expect(objects.length).toBeLessThan(40);
  });

  it("noValidTiles: an object group with zero valid add_object members", () => {
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object_group EMPTY {\n}\ncreate_object EMPTY");
    expect(reports[0].failures[0].bucket).toBe("noValidTiles");
  });
});

// ---------------------------------------------------------------------------
// End-to-end behaviour
// ---------------------------------------------------------------------------

describe("applyObjects: basic placement", () => {
  it("a bare create_object places exactly one object (default count)", () => {
    const { objects, reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE");
    expect(objects).toHaveLength(1);
    expect(objects[0].objectRef).toBe("HOUSE");
    expect(reports[0].attempted).toBe(1);
    expect(reports[0].placed).toBe(1);
  });

  it("number_of_objects scatters that many independent placements", () => {
    const { objects } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 7 }", 1, { mapSize: "Small" });
    expect(objects).toHaveLength(7);
  });

  it("placements never land on the same tile twice (default occupancy rule)", () => {
    const { objects } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 30 }", 3, { mapSize: "Small" });
    const seen = new Set(objects.map((o) => `${o.x},${o.y}`));
    expect(seen.size).toBe(objects.length);
  });

  it("force_placement allows stacking on an already-occupied tile", () => {
    const { objects } = bare(
      "<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 1 }\ncreate_object HOUSE { number_of_objects 1 force_placement min_distance_to_players 0 }",
      1,
      { mapSize: "Tiny" },
    );
    expect(objects).toHaveLength(2);
  });

  it("a resolved object group draws members uniformly, never the un-added group name itself", () => {
    const { objects } = bare(
      "<OBJECTS_GENERATION>\ncreate_object_group HUNTABLE {\nadd_object DEER 50\nadd_object BOAR 50\n}\ncreate_object HUNTABLE { number_of_objects 40 }",
      1,
      { mapSize: "Small" },
    );
    expect(objects).toHaveLength(40);
    const refs = new Set(objects.map((o) => o.objectRef));
    expect(refs).toEqual(new Set(["DEER", "BOAR"]));
  });

  it("set_place_for_every_player places once per matching player land", () => {
    const source =
      "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 4 }\n<OBJECTS_GENERATION>\ncreate_object HOUSE { set_place_for_every_player set_gaia_object_only number_of_objects 1 }";
    const { objects, players } = place(source, 2, { playerCount: 3 });
    expect(players).toHaveLength(3);
    expect(objects).toHaveLength(3);
  });

  it("tight grouping fills a contiguous blob from one anchor (Sec.6.6's measured rule)", () => {
    const { objects } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 9 number_of_groups 1 set_tight_grouping }", 1, { mapSize: "Small" });
    expect(objects).toHaveLength(9);
    const g0 = objects.filter((o) => o.groupId === 0);
    expect(g0).toHaveLength(9);
    // Every member is 4-adjacent-reachable from some other member of the same group (a connected blob).
    const tiles = new Set(g0.map((o) => `${o.x},${o.y}`));
    const reachable = new Set([`${g0[0].x},${g0[0].y}`]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of g0) {
        const key = `${o.x},${o.y}`;
        if (reachable.has(key)) continue;
        const touchesReachable = [
          `${o.x + 1},${o.y}`,
          `${o.x - 1},${o.y}`,
          `${o.x},${o.y + 1}`,
          `${o.x},${o.y - 1}`,
        ].some((k) => reachable.has(k));
        if (touchesReachable) {
          reachable.add(key);
          grew = true;
        }
      }
    }
    expect(reachable.size).toBe(tiles.size);
  });
});

describe("applyObjects: honesty notes (Sec.9)", () => {
  it("a wall-type object places normally plus a not-simulated note", () => {
    const { objects, notes } = bare("<OBJECTS_GENERATION>\ncreate_object STONE_WALL { number_of_objects 3 }", 1, { mapSize: "Tiny" });
    expect(objects).toHaveLength(3);
    expect(notes.some((n) => n.key.startsWith("wallNotSimulated"))).toBe(true);
  });

  it("second_object IS drawn, on the same tile as the object it rides on", () => {
    // Dropping it used to be the documented behaviour, and it hid most of the
    // fish on the corpus's water maps: guide:2211 recommends `second_object`
    // as the way to place something on a terrain it is restricted from, using
    // an invisible placeholder as the carrier — so the second object is the
    // one the author cared about.
    const { objects, notes } = bare("<OBJECTS_GENERATION>@create_object HOUSE { number_of_objects 5 second_object VILLAGER }".replace(/@/g, "\n"));
    const houses = objects.filter((o) => o.objectRef === "HOUSE");
    const villagers = objects.filter((o) => o.objectRef === "VILLAGER");
    expect(houses.length).toBeGreaterThan(0);
    expect(villagers).toHaveLength(houses.length);
    for (const house of houses) {
      expect(villagers.some((v) => v.x === house.x && v.y === house.y)).toBe(true);
    }
    expect(notes.some((n) => n.key.startsWith("secondObjectApproximated"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corpus: never throws, one CommandReport per create_object, valid spans
// ---------------------------------------------------------------------------

describe("corpus: applyObjects never throws", () => {
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
        let result: ReturnType<typeof place> | undefined;
        expect(() => {
          result = place(source, 12345);
        }).not.toThrow();
        if (!result) return;
        for (const report of result.reports) {
          expect(report.stage).toBe("S6");
          expect(report.commandSpan.start).toBeGreaterThanOrEqual(0);
          expect(report.commandSpan.end).toBeGreaterThanOrEqual(report.commandSpan.start);
          expect(report.placed).toBeLessThanOrEqual(report.attempted);
        }
      },
      15000,
    );
  }
});
