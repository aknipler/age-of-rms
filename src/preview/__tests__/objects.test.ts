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

describe("isTightGrouping (Sec.15 item 17c, MEASURED: tight is opt-in, the default is loose)", () => {
  it("FALSE when neither mode stated — RMSTEST_46c measured 0% spill unstated, against 22-35% for tight", () => {
    expect(isTightGrouping(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_groups 2 }"))).toBe(false);
  });

  it("false when both are stated: an explicit loose still wins", () => {
    expect(isTightGrouping(objectCommand("<OBJECTS_GENERATION>\ncreate_object GOLD { set_tight_grouping set_loose_grouping }"))).toBe(false);
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

  it("resolves a script #const to its row BY ID, the way resolveTerrainId does for terrain", () => {
    // 216 of the 397 distinct object names the corpus writes are the author's
    // own `#const`s, not DE names, so a name-only lookup misses most of the
    // roster no matter how complete the data file gets. `AD4 - Pag - v1.2.rms`
    // writes `#const ONGRID_PLACEHOLDER_NAVAL 1546` and unit 1546 has no
    // `#const` in random_map.def at all — the id is the only handle there is.
    const symbols = new Map([
      ["MY_OWN_FISH", 457], // TUNA
      ["MY_OWN_GOLD", 66], // GOLD
    ]);
    expect(objectHabitat("MY_OWN_FISH", constants)).toBe("land"); // no symbols: the unknown-object fallback
    expect(objectHabitat("MY_OWN_FISH", constants, symbols)).toBe("water");
    // Every lookup in the stage takes the same path, not just habitat.
    expect(objectCategory("MY_OWN_GOLD", constants, symbols)).toBe("resource-gold");
    expect(requiresGaiaOnly("MY_OWN_GOLD", constants, symbols)).toBe(true);
  });

  it("a built-in name still wins over a script #const of the same name", () => {
    // `resolveTerrainId`'s order and its reason: the engine loads
    // random_map.def before the script and `#const` is first-definition-wins,
    // so a script redefining a built-in name does not take effect in game.
    const symbols = new Map([["SHORE_FISH", 457]]);
    expect(objectHabitat("SHORE_FISH", constants, symbols)).toBe("shore");
  });

  it("puts the DE ocean-fish family in the water, where the 'land' fallback used to put it ashore", () => {
    // Six rows added because the fallback's failure is not rare: a script
    // placing a fish on OPEN water has no reason to write
    // `terrain_to_place_on`, so `QS_Three_Bays_v1.1.rms`'s nine bare TUNA
    // commands took the land default and put 77 of 119 tuna on the beach.
    for (const name of ["TUNA", "SNAPPER", "SALMON", "DORADO"]) {
      expect(objectHabitat(name, constants)).toBe("water");
    }
    // The great fish and the oysters are a different restriction row and a
    // different class — see the amphibious test below.
    for (const name of ["MARLIN1", "OYSTERS"]) {
      expect(objectHabitat(name, constants)).toBe("amphibious");
    }
  });

  it("covers the rest of the family, including the names random_map.def defines twice", () => {
    // MARLIN2/FISH_PERCH were added once the dat confirmed them; the FISH_*
    // and GREAT_FISH_* spellings are aliases random_map.def binds to the same
    // ids, and a script writing one of those used to miss the row and take
    // the land default. DOLPHIN and PERCH are not DE constants at all — the
    // rows exist so the written name still resolves to a habitat.
    // Restriction 19 — open water only.
    for (const name of ["FISH_PERCH", "FISH_TUNA", "FISH_SNAPPER", "FISH_SALMON", "FISH_DORADO", "PERCH"]) {
      expect(objectHabitat(name, constants)).toBe("water");
    }
    // Restriction 13 — the great fish, which the file's own comments call the
    // dolphins (`#const MARLIN1 450 /* DOLPHIN1 */`).
    for (const name of ["MARLIN2", "GREAT_FISH_MARLIN", "GREAT_FISH_MARLIN2", "DOLPHIN"]) {
      expect(objectHabitat(name, constants)).toBe("amphibious");
    }
  });

  it("carries the dat-confirmed ids, and only those", () => {
    // The six rows shipped earlier the same day with `constId: null` because
    // the id had not been read. It has now: random_map.def joined against
    // empires2_x2_p1.dat's unit table. DOLPHIN and PERCH stay null because no
    // DE constant of that name exists to take an id from — absence of a
    // number here is a fact about the game, not a gap in the transcription.
    const byName = new Map(constants.filter((c) => c.category === "object").map((c) => [c.rmsConstant, c.constId]));
    expect(byName.get("TUNA")).toBe(457);
    expect(byName.get("FISH_TUNA")).toBe(457); // same unit, second spelling
    expect(byName.get("MARLIN2")).toBe(451);
    expect(byName.get("FISH_PERCH")).toBe(53); // the same unit as FISH
    expect(byName.get("FISH")).toBe(53);
    expect(byName.get("DLC_BOXTURTLE")).toBe(1141);
    expect(byName.get("DOLPHIN")).toBeNull();
    expect(byName.get("PERCH")).toBeNull();
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

  // ---- the shore habitat: OPEN WATER TOUCHING A BEACH ---------------------
  //
  // A cross-section built as vertical columns, so "which column did it land
  // on" is the whole assertion. `columns` is read left to right and repeated
  // down every row; S6 runs alone, since S1-S5 would repaint the fixture.

  const BEACH = constants.find((c) => c.rmsConstant === "BEACH")!.constId!;
  const SHALLOW = constants.find((c) => c.rmsConstant === "SHALLOW")!.constId!;
  const DEEP_WATER = constants.find((c) => c.rmsConstant === "DEEP_WATER")!.constId!;

  function placeOnColumns(source: string, columns: readonly number[], seed = 1) {
    const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(), seed);
    const grid = createTileGrid(instantiated.dim, GRASS);
    for (let y = 0; y < grid.dim; y++) {
      for (let x = 0; x < grid.dim; x++) {
        // The last entry fills the rest of the map, so a short cross-section
        // still describes the whole grid.
        grid.terrain[y * grid.dim + x] = columns[Math.min(x, columns.length - 1)];
      }
    }
    const result = applyObjects(instantiated, grid, constants, [], seed);
    return { grid, ...result };
  }

  it("puts a shore object in the water beside the beach, never on the beach itself", () => {
    // The bug this replaces: the band was symmetric about the waterline, so it
    // admitted the sand as readily as the sea. Measured on
    // `QS_Three_Bays_v1.1.rms`, 130 of 226 shore fish came out beached.
    const columns = [DEEP_WATER, DEEP_WATER, BEACH, GRASS];
    const { objects } = placeOnColumns(script("SHORE_FISH {\nnumber_of_objects 200\n}\n"), columns);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1); // the water column touching the beach, and only it
  });

  it("treats DLC_BOXTURTLE exactly as SHORE_FISH — one family, one rule", () => {
    const columns = [DEEP_WATER, DEEP_WATER, BEACH, GRASS];
    const { objects } = placeOnColumns(script("DLC_BOXTURTLE {\nnumber_of_objects 200\n}\n"), columns);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1);
  });

  it("does not count a shallow as shore, even when it is the tile touching the beach", () => {
    // "water terrain, not hybrid" is the point: a shallow is walkable ground
    // as far as the game is concerned, so the fish goes past it to the water.
    const columns = [DEEP_WATER, DEEP_WATER, SHALLOW, BEACH, GRASS];
    const { objects } = placeOnColumns(script("SHORE_FISH {\nnumber_of_objects 200\n}\n"), columns);
    // The shallow (x=2) sits between the water and the beach, so NOTHING is
    // open water touching a beach and there is no shore at all.
    expect(objects).toHaveLength(0);
  });

  it("finds no shore on a coast whose beach has been painted over", () => {
    // Stated rather than hidden: the anchor is a beach terrain, not "any land
    // neighbour". `AD4 - Pag - v1.2.rms` replaces BEACH with DIRT along its
    // connection paths, and a shore object will not place against that
    // stretch. What the engine anchors on is one row of its terrain table,
    // which is Sec.15 item 23's data and not ours yet.
    const { objects } = placeOnColumns(script("SHORE_FISH {\nnumber_of_objects 200\n}\n"), [DEEP_WATER, DEEP_WATER, GRASS]);
    expect(objects).toHaveLength(0);
  });

  it("keeps an ocean fish off the shallows — a fish cannot stand on one", () => {
    // The dat is explicit: restriction 19, which every ordinary fish carries,
    // permits 15 terrains and NO shallow among them. Our `water` class used
    // to include shallows because the water MASK does, which is a different
    // question.
    const { objects } = placeOnColumns(script("TUNA {\nnumber_of_objects 200\n}\n"), [DEEP_WATER, SHALLOW, BEACH, GRASS]);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(0); // the open water column, never the shallow
  });

  it("lets the amphibious family onto the shallows, which is the whole point of the split", () => {
    // Restrictions 13/3/15 permit 38 terrains including every shallow and
    // every beach. OYSTERS is guide:4717's own "water and amphibious
    // terrains" object, so it is the one that names the class.
    const { objects } = placeOnColumns(script("OYSTERS {\nnumber_of_objects 200\n}\n"), [DEEP_WATER, SHALLOW, BEACH, GRASS]);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.some((o) => o.x === 1)).toBe(true); // reaches the shallow
    expect(objects.every((o) => o.x <= 2)).toBe(true); // never the dry grass
  });

  it("a second_object rides the main object's tile, bypassing its OWN habitat", () => {
    // guide:2211's placeholder idiom, and the reason the rule above does not
    // break `Menindee_AUS_v2.3.rms`: it writes
    // `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW ...
    // second_object FISH }`. The placeholder is unit 647, restriction 0, all
    // 131 terrains; the fish rides in on its tile. If the second object were
    // re-checked against its own habitat this would place nothing, and every
    // pond fish on that map would vanish — which is exactly what a `land`
    // fallback plus a habitat check would do silently.
    const source = script("PLACEHOLDER_X {\nterrain_to_place_on SHALLOW\nnumber_of_objects 40\nsecond_object TUNA\n}\n");
    const { objects } = placeOnColumns(source, [DEEP_WATER, SHALLOW, BEACH, GRASS]);
    const fish = objects.filter((o) => o.objectRef === "TUNA");
    expect(fish.length).toBeGreaterThan(0);
    // On the shallow column, where TUNA's own habitat forbids it outright.
    for (const o of fish) expect(o.x).toBe(1);
  });

  it("terrain_to_place_on NARROWS a declared habitat, it does not switch it off", () => {
    // `AK_Hourglass_v2.0.rms` writes `create_object SHORE_FISH
    // { terrain_to_place_on WATER number_of_objects 200000 }`. The carve-out
    // that let `terrain_to_place_on` suppress the habitat check left that with
    // no shore constraint at all: 788 shore fish over the open sea, down to
    // 245 hugging the beach once both apply.
    //
    // What refutes the carve-out is the placeholder idiom read backwards: if
    // naming the terrain lifted the terrain table, nobody would need an
    // unrestricted carrier object to get a fish onto a shallow.
    const columns = [DEEP_WATER, DEEP_WATER, BEACH, GRASS];
    const { objects } = placeOnColumns(script("SHORE_FISH {\nterrain_to_place_on DEEP_WATER\nnumber_of_objects 200\n}\n"), columns);
    expect(objects.length).toBeGreaterThan(0);
    // DEEP_WATER alone would allow x = 0 and 1; shore alone would allow only
    // x = 1. Both together is x = 1, and that is the whole assertion.
    for (const o of objects) expect(o.x).toBe(1);
  });

  it("a contradiction between the two places nothing rather than picking one", () => {
    // SHORE_FISH cannot be on GRASS, and an author saying so does not make it
    // possible — `ignore_terrain_restrictions` is the documented override
    // (guide:2510) and this command does not use it.
    const { objects } = placeOnColumns(script("SHORE_FISH {\nterrain_to_place_on GRASS\nnumber_of_objects 200\n}\n"), [DEEP_WATER, DEEP_WATER, BEACH, GRASS]);
    expect(objects).toHaveLength(0);
  });

  it("but an UNDECLARED habitat still defers to terrain_to_place_on", () => {
    // The carve-out survives for exactly the case it was written for. The
    // reference data covers a few dozen objects of several hundred, so an
    // unknown one falls back to `land`; narrowing by that guess would place
    // nothing and read as the object failing. This is what keeps
    // `Menindee_AUS_v2.3.rms`'s FISH_PLACEHOLDER on its shallows — measured:
    // that map's object count is byte-identical across this change.
    expect(objectHabitat("PLACEHOLDER_X", constants)).toBe("land"); // the guess
    const { objects } = placeOnColumns(script("PLACEHOLDER_X {\nterrain_to_place_on SHALLOW\nnumber_of_objects 40\n}\n"), [DEEP_WATER, SHALLOW, BEACH, GRASS]);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1); // on the shallow, against a `land` habitat
  });

  // ---- ignore_terrain_restrictions: what it lifts, and what it does not ---
  //
  // Measured in game 2026-08-10. Two rules, and the second is the one nobody
  // would guess from the attribute's name. Every fixture here carries
  // `place_on_specific_land_id -11` because of the FIRST rule (guide:2509's
  // Requires line) — without a partner attribute the command places nothing at
  // all, so a test of the second rule written without one would pass for the
  // wrong reason. -11 is "a random position on the map" (guide:2288), which
  // needs no land to exist.

  it("lets the shore class onto the shallows, which is all it lets them onto", () => {
    // The same fixture as the shallow test above, where the strict rule finds
    // no shore at all: the shallow at x = 1 separates the open water from the
    // beach. Under the flag the shallow itself becomes placeable, and nothing
    // else does — not the open water at x = 0 (it touches no beach), not the
    // beach at x = 2, not the grass at x = 3.
    const columns = [DEEP_WATER, SHALLOW, BEACH, GRASS];
    const body = "SHORE_FISH {\nnumber_of_objects 200\nplace_on_specific_land_id -11\n";
    expect(placeOnColumns(script(body + "}\n"), columns).objects).toHaveLength(0);
    const { objects } = placeOnColumns(script(body + "ignore_terrain_restrictions\n}\n"), columns);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1);
  });

  it("does NOT put a shore object on dry land, however the flag is written", () => {
    // The half that separates this class from every other object. guide:2513's
    // own example puts SALMON on grass under this flag; a shore fish or a box
    // turtle still needs a beach beside it and still cannot leave the water.
    const columns = [DEEP_WATER, DEEP_WATER, BEACH, GRASS];
    const { objects } = placeOnColumns(
      script("DLC_BOXTURTLE {\nnumber_of_objects 200\nplace_on_specific_land_id -11\nignore_terrain_restrictions\n}\n"),
      columns,
    );
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1); // never the beach at 2, never the grass at 3
  });

  it("but every other habitat really is lifted — guide:2513's salmon on grass", () => {
    // The control that keeps the shore exception from quietly becoming a
    // general one: TUNA is `water`, the map is all grass, and the flag is the
    // whole reason it places.
    const body = "TUNA {\nnumber_of_objects 50\nplace_on_specific_land_id -11\n";
    expect(placeOnColumns(script(body + "}\n"), [GRASS]).objects).toHaveLength(0);
    expect(placeOnColumns(script(body + "ignore_terrain_restrictions\n}\n"), [GRASS]).objects.length).toBeGreaterThan(0);
  });

  it("and a FRAMELESS flag lifts nothing at all — the case that separates inert from fatal (RMSTEST_42)", () => {
    // Same all-grass fixture, partner attribute removed. The command still
    // runs (that half is asserted in the attributePrerequisite group), and
    // TUNA's own water habitat still excludes every tile — so an inert flag
    // places zero here while a fatal one also places zero, and it is the
    // command-level count next to this that tells them apart.
    const body = "TUNA {\nnumber_of_objects 50\nignore_terrain_restrictions\n";
    expect(placeOnColumns(script(body + "}\n"), [GRASS]).objects).toHaveLength(0);
    // Adding only the partner attribute turns the same command into placements.
    expect(placeOnColumns(script(body + "place_on_specific_land_id -11\n}\n"), [GRASS]).objects.length).toBeGreaterThan(0);
  });

  // ---- max_distance_to_other_zones: a MINIMUM, despite the name ----------
  //
  // guide:2527 in its own capitals: "Minimum (NOT maximum) distance, in tiles,
  // that objects will stay away from terrains that they are restricted from
  // being placed on", and guide:2528's example is "deep fish away from
  // beaches". It shipped as a maximum — the reading the name invites, and the
  // reason the guide shouts — with NO test of any kind, which is how an
  // inverted comparison survives review.

  it("pushes an object AWAY from restricted terrain, not towards it", () => {
    // Grass at x = 0 and 1, open water everywhere else, so a water tile's
    // 4-connected distance to land is x - 1. d = 3 therefore means x >= 4.
    // Under the old maximum reading the very same command allowed x = 2..4,
    // which is the opposite band and shares only one column with this one —
    // so an assertion on the minimum x cannot pass under both.
    const { objects } = placeOnColumns(
      script("TUNA {\nnumber_of_objects 300\nmax_distance_to_other_zones 3\n}\n"),
      [GRASS, GRASS, DEEP_WATER],
    );
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBeGreaterThanOrEqual(4);
  });

  it("is vacuously satisfied when the map holds no restricted terrain at all", () => {
    // The second half of the same inversion, and the half that fails loudest:
    // the old code required `dist !== UNREACHABLE`, so on an all-water map —
    // where nothing is restricted and the constraint cannot bind — it placed
    // ZERO fish rather than all of them.
    const { objects } = placeOnColumns(
      script("TUNA {\nnumber_of_objects 300\nmax_distance_to_other_zones 5\n}\n"),
      [DEEP_WATER],
    );
    expect(objects.length).toBeGreaterThan(0);
  });

  it("a distance of 0 is a no-op rather than a filter", () => {
    const withZero = placeOnColumns(
      script("TUNA {\nnumber_of_objects 300\nmax_distance_to_other_zones 0\n}\n"),
      [GRASS, GRASS, DEEP_WATER],
    );
    const without = placeOnColumns(script("TUNA {\nnumber_of_objects 300\n}\n"), [GRASS, GRASS, DEEP_WATER]);
    expect(withZero.objects.length).toBe(without.objects.length);
  });

  it("an ocean fish takes the whole sea, not just its edge", () => {
    // The distinction between the two water habitats, in one assertion: TUNA
    // is `water` and reaches the open sea; SHORE_FISH is `shore` and does not
    // leave the beach's own column.
    const columns = [DEEP_WATER, DEEP_WATER, DEEP_WATER, BEACH, GRASS];
    const { objects } = placeOnColumns(script("TUNA {\nnumber_of_objects 200\n}\n"), columns);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.every((o) => o.x <= 2)).toBe(true); // never the beach or the grass
    expect(objects.some((o) => o.x < 2)).toBe(true); // and not confined to the shore column
  });

  it("lets ignore_terrain_restrictions through, which is the documented opt-out", () => {
    // `place_on_specific_land_id -11` is not decoration: guide:2509's Requires
    // line means the flag does nothing on its own, and this fixture used to
    // omit it — asserting a behaviour the engine never had. See the
    // attributePrerequisite tests.
    const { grid, objects } = placeOnSplitMap(script("OLIVE_TREE {\nnumber_of_objects 200\nplace_on_specific_land_id -11\nignore_terrain_restrictions\n}\n"));
    expect(objects.some((o) => onWater(grid, o))).toBe(true);
  });

  it("ignore_terrain_restrictions lifts the terrain TABLE, not the script's own terrain_to_place_on", () => {
    // guide:2511 says the two "can be used in combination". Gating the whole
    // block on the flag cancelled the author's own instruction, which is how
    // `AK_Six_Points_v1.4.rms` got 11 DLC_ANIMALSKELETONs into open water
    // from a command that says `terrain_to_place_on DIRT`.
    const { grid, objects } = placeOnSplitMap(
      script("OLIVE_TREE {\nnumber_of_objects 200\nterrain_to_place_on WATER\nplace_on_specific_land_id -11\nignore_terrain_restrictions\n}\n"),
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

  // ---- the default grouping mode is LOOSE (BUG-011, RMSTEST_46a/46b/46c) ---
  //
  // The same shape as the measurement: a group confined to a narrow
  // `terrain_to_place_on` patch, with and without a stated mode. Off-patch
  // fraction measured 22-35% for tight and 0% for both explicit loose and
  // unstated, which is what makes the unstated command per-member checked.

  const DIRT_ID = constants.find((c) => c.rmsConstant === "DIRT")!.constId!;
  const groupOnPatch = (mode: string) =>
    script(`GOLD {\nnumber_of_objects 7\nnumber_of_groups 12\ngroup_placement_radius 3\nterrain_to_place_on DIRT\n${mode}}\n`);

  it("an UNSTATED grouping mode checks every member, so nothing spills off the patch", () => {
    const { objects } = placeOnColumns(groupOnPatch(""), [GRASS, DIRT_ID, GRASS]);
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.x).toBe(1);
  });

  it("set_tight_grouping is the contrast: its fill is anchor-checked, so members do spill", () => {
    const { objects } = placeOnColumns(groupOnPatch("set_tight_grouping\n"), [GRASS, DIRT_ID, GRASS]);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.some((o) => o.x !== 1)).toBe(true);
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
    //
    // The first four now answer from DATA (the roster gave them wood 100) and
    // PLANT_RAINFOREST from the PATTERN, since it has no row. Keep one of each:
    // drop the last and this test stops covering the fallback it is named after.
    for (const name of ["OLIVE_TREE", "CYPRESS_TREE", "ITALIAN_PINETREE", "DLC_DRAGONTREE", "PLANT_RAINFOREST"]) {
      expect(objectCategory(name, constants)).toBe("resource-wood");
    }
  });

  it("lets a real yield outrank the tree name pattern", () => {
    // FORAGE_BUSH matches /BUSH/ and is unit 59, the same forage bush FORAGE
    // resolves to, carrying 125 food. Until CREATION_PLAN 4.10 wrote the roster
    // only FORAGE had a row, so the two spellings of ONE unit answered
    // differently and the pattern was never contradicted by data. It is now,
    // and the data wins by TREE_NAME_PATTERN's own rule ("resourceAmounts.wood
    // would be the real signal and takes precedence wherever the reference data
    // has it") — a forage bush is a food source that happens to be shrub-shaped.
    expect(objectCategory("FORAGE_BUSH", constants)).toBe("resource-food");
    expect(objectCategory("FORAGE", constants)).toBe("resource-food");
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

  it("a frameless ignore_terrain_restrictions is INERT, not fatal: the command places in full (RMSTEST_42)", () => {
    // guide:2509's Requires line. Unmet, the ATTRIBUTE does nothing; the
    // command is untouched. This replaced a whole-command gate inferred from
    // `AK_Namatjira.rms`, which cannot separate the two models — its command
    // also names a shallow its shore fish cannot occupy, so both predict zero.
    const { reports, objects, notes } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 10 ignore_terrain_restrictions }");
    expect(reports[0].failures.some((f) => f.bucket === "attributePrerequisite")).toBe(false);
    expect(reports[0].placed).toBe(10);
    expect(objects).toHaveLength(10);
    expect(notes.some((n) => n.key.startsWith("ignoreTerrainRestrictionsInert"))).toBe(true);
  });

  it("no attributePrerequisite failure once set_place_for_every_player is added", () => {
    const source =
      "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { base_size 3 }\n<OBJECTS_GENERATION>\ncreate_object HOUSE { set_place_for_every_player number_of_objects 1 ignore_terrain_restrictions }";
    const { reports } = place(source, 1, { playerCount: 2 });
    const report = reports.find((r) => r.stage === "S6");
    expect(report?.failures.some((f) => f.bucket === "attributePrerequisite")).toBe(false);
    expect(report?.placed).toBeGreaterThan(0);
  });

  it("place_on_specific_land_id -11 satisfies the requirement even though it references no land", () => {
    // The reason the gate reads attribute NAMES rather than the resolved frame
    // kind: -11 is "a random position on the map" and resolves to the frameless
    // kind, but the author did write the attribute the requirement names.
    const { reports } = bare("<OBJECTS_GENERATION>\ncreate_object HOUSE { number_of_objects 10 place_on_specific_land_id -11 ignore_terrain_restrictions }");
    expect(reports[0].failures.some((f) => f.bucket === "attributePrerequisite")).toBe(false);
    expect(reports[0].placed).toBeGreaterThan(0);
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
