// Object Templates, docs/object-templates-brief.md Sec.1: every template,
// under every option combination, must parse cleanly through src/parser
// (zero diagnostics of any severity once validate() has run too, a
// "standard" block that ships a warning is a defect) and contain the
// command names the options promise. Pure text -> parser round trip, no
// computeEdit/React involved, matching templates.ts's own "no React" scope.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import {
  builtinConstantNames,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../../../parser/validate";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import {
  BERRY_OPTIONS,
  HERDABLE_OPTIONS,
  HUNTABLE_OPTIONS,
  LURABLE_OPTIONS,
  FOREST_MAKER_CONST,
  T1_DEFAULTS,
  T2_DEFAULTS,
  T3_DEFAULTS,
  T4_DEFAULTS,
  T5_DEFAULTS,
  T5_ROUNDS,
  forestTerrainOptions,
  isValidIdentifier,
  playerForestsObjectsProblems,
  playerForestsTerrainProblems,
  renderPlayerForestsObjects,
  renderPlayerForestsTerrain,
  templatesFor,
  treeOptions,
  renderStandardPlayerObjects,
  renderStandardPlayerResources,
  renderStandardWaterResources,
  type T1Options,
  type T2Options,
  type T3Options,
  type T4Options,
  type T5Options,
  type TemplateConstant,
} from "../templates";
import { definesSymbol, playerLandTerrain } from "../scriptContext";

const langData = loadLanguage();
const gameConstants = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "game-constants.json"),
    "utf8",
  ),
) as GameConstantsForValidate;
const refDb: ValidateReferenceDb = { language: langData, gameConstants };
// The same option the parser worker passes, so these tests read the text
// the way the app does. Without it `ATTR_FOUNDATION_TERRAIN FOREST` draws
// a false RMS0202, since FOREST is defined by random_map.def, not the file.
const builtinConstants = builtinConstantNames(gameConstants.constants);

/**
 * Parses a whole script and asserts a clean parse AND a clean semantic
 * pass. The first cut checked parser errors only and let a mutex pair
 * (both set_scaling_* flags on one block, RMS0307) through.
 */
function scriptClean(src: string) {
  return scriptCleanAllowing(src, []);
}

/**
 * scriptClean, minus the listed codes. For a value the scripter typed
 * themselves through a Custom… box, where a bare id rightly draws the
 * RMS0204 "a name reads better" hint and the template is not at fault.
 */
function scriptCleanAllowing(src: string, allowed: readonly string[]) {
  const result = parseRms(src, langData, { builtinConstants });
  const all = [...result.diagnostics, ...validate(result, refDb)].filter(
    (d) => !allowed.includes(d.code),
  );
  expect(all.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  return result;
}

const bareId = (s: string) => /^\d+$/.test(s);

/** Wraps a rendered block in its real host section, see scriptClean. */
function parseClean(text: string) {
  // <PLAYER_SETUP> only so the script-level RMS0305 (no player setup) stays
  // out of a check that is about the template's own text.
  return scriptClean(`<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`);
}

function commandNames(text: string): string[] {
  return [...text.matchAll(/create_object\s+(\S+)/g)].map((m) => m[1]);
}

describe("isValidIdentifier", () => {
  it("accepts a bare identifier", () => {
    expect(isValidIdentifier("GRASS")).toBe(true);
    expect(isValidIdentifier("_foo")).toBe(true);
    expect(isValidIdentifier("Foo2")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidIdentifier("")).toBe(false);
    expect(isValidIdentifier("2FOO")).toBe(false);
    expect(isValidIdentifier("FOO BAR")).toBe(false);
    expect(isValidIdentifier("FOO-BAR")).toBe(false);
    expect(isValidIdentifier('"FOO"')).toBe(false);
  });
});

describe("T1 standard player objects", () => {
  const combos: T1Options[] = [
    T1_DEFAULTS,
    { quickStart: true, advanced: false, terrainToPlaceOn: "" },
    { quickStart: false, advanced: false, terrainToPlaceOn: "GRASS" },
    { quickStart: true, advanced: false, terrainToPlaceOn: "GRASS" },
    { quickStart: true, advanced: true, terrainToPlaceOn: "" },
    { quickStart: true, advanced: true, terrainToPlaceOn: "GRASS" },
  ];

  for (const options of combos) {
    it(`parses cleanly (quickStart=${options.quickStart}, advanced=${options.advanced}, terrain="${options.terrainToPlaceOn}")`, () => {
      const { text } = renderStandardPlayerObjects(options);
      parseClean(text);
      const names = commandNames(text);
      expect(names).toContain("TOWN_CENTER");
      expect(names).toContain("SCOUT");
      if (options.quickStart && options.advanced) {
        expect(names).toContain("PH_NEUTRAL_OFF");
        expect(names.filter((n) => n === "PH_PLAYER_OFF")).toHaveLength(6);
        expect(names).toContain("THEMED_TREE1");
        expect(names).toContain("HOUSE");
        expect(text).toContain("number_of_objects 3");
        expect(text).toContain("place_on_forest_zone");
        expect(text).toContain("start_random");
        expect(text).toContain("LAZY_MALE");
        expect(text).toContain("LAZY_FEMALE");
      } else if (options.quickStart) {
        expect(names.filter((n) => n === "VILLAGER")).toHaveLength(2);
        expect(names).toContain("SHEEP");
        expect(names).toContain("HOUSE");
        expect(text).toContain("number_of_objects 6");
        expect(text).toContain("number_of_objects 3");
        expect(text).toContain("place_on_forest_zone");
      } else {
        expect(names).toContain("VILLAGER");
      }
      if (options.terrainToPlaceOn) {
        expect(text).toContain(
          `terrain_to_place_on ${options.terrainToPlaceOn}`,
        );
      }
    });
  }

  it("the caret offset lands on the first create_object's own line", () => {
    const { text, caretOffset } = renderStandardPlayerObjects(T1_DEFAULTS);
    expect(text.slice(caretOffset)).toMatch(/^create_object TOWN_CENTER/);
    // Not indented: caretOffset must sit at a top-level (no leading tab) line.
    expect(text[caretOffset - 1]).toBe("\n");
  });

  it("advanced is ignored while quick-start is off", () => {
    const withAdvancedOnly = renderStandardPlayerObjects({
      quickStart: false,
      advanced: true,
      terrainToPlaceOn: "",
    });
    const plain = renderStandardPlayerObjects(T1_DEFAULTS);
    expect(withAdvancedOnly.text).toBe(plain.text);
  });
});

describe("T2 standard player resources", () => {
  const combos: T2Options[] = [
    T2_DEFAULTS,
    { ...T2_DEFAULTS, seasonal: true },
    { ...T2_DEFAULTS, terrainToPlaceOn: "GRASS" },
    { ...T2_DEFAULTS, seasonal: true, terrainToPlaceOn: "GRASS" },
    ...BERRY_OPTIONS.map((b) => ({ ...T2_DEFAULTS, berryType: b.value })),
    ...HERDABLE_OPTIONS.map((h) => ({ ...T2_DEFAULTS, herdable: h.value })),
    ...HUNTABLE_OPTIONS.map((h) => ({ ...T2_DEFAULTS, huntable: h.value })),
    ...LURABLE_OPTIONS.map((l) => ({ ...T2_DEFAULTS, lurable: l.value })),
  ];

  for (const options of combos) {
    it(`parses cleanly (${JSON.stringify(options)})`, () => {
      const { text } = renderStandardPlayerResources(options);
      parseClean(text);
      const names = commandNames(text);
      expect(names).toContain("GOLD");
      expect(names).toContain("STONE");
      if (options.seasonal) {
        expect(text).toContain("#include_drs F_seasons.inc");
        expect(names).toContain("BERRIES");
        expect(names).toContain("HERDABLE_A");
        expect(names).toContain("HERDABLE");
        expect(names).toContain("HUNTABLE");
        expect(names).toContain("LURABLE");
      } else {
        expect(names).toContain(options.berryType);
        expect(names).toContain(options.herdable);
        expect(names).toContain(options.huntable);
        expect(names).toContain(options.lurable);
      }
      if (options.terrainToPlaceOn) {
        expect(text).toContain(
          `terrain_to_place_on ${options.terrainToPlaceOn}`,
        );
      }
    });
  }

  it("the caret offset lands on the berries create_object line", () => {
    const { text, caretOffset } = renderStandardPlayerResources(T2_DEFAULTS);
    expect(text.slice(caretOffset)).toMatch(/^create_object FORAGE_BUSH/);
  });

  it("seasonal disables berryType/wildlife by emitting the seasons consts regardless", () => {
    const withForage = renderStandardPlayerResources({
      ...T2_DEFAULTS,
      seasonal: true,
      berryType: "DLC_ORANGEBUSH",
      herdable: "DLC_COW",
    }).text;
    expect(withForage).not.toContain("DLC_ORANGEBUSH");
    expect(withForage).not.toContain("DLC_COW");
  });
});

describe("T3 standard water resources", () => {
  const combos: T3Options[] = [
    T3_DEFAULTS,
    { oysters: true, whales: false },
    { oysters: false, whales: true },
    { oysters: true, whales: true },
  ];

  for (const options of combos) {
    it(`parses cleanly (oysters=${options.oysters}, whales=${options.whales})`, () => {
      const { text } = renderStandardWaterResources(options);
      parseClean(text);
      const names = commandNames(text);
      expect(names).toContain("SHORE_FISH");
      expect(names).toContain("TUNA");
      if (options.oysters) expect(names).toContain("OYSTERS");
      else expect(names).not.toContain("OYSTERS");
      if (options.whales) {
        expect(names).toContain("WHALE");
      } else {
        expect(names).not.toContain("WHALE");
      }
      // Water objects only spawn on water, so no block names a terrain.
      expect(text).not.toContain("terrain_to_place_on");
    });
  }

  it("the caret offset lands on the shore fish create_object line", () => {
    const { text, caretOffset } = renderStandardWaterResources(T3_DEFAULTS);
    expect(text.slice(caretOffset)).toMatch(/^create_object SHORE_FISH/);
  });
});

// ---- Player forests (2026-09-28) ------------------------------------------

// The rows as the dialog gets them. Structural cast, the validate view
// declares fewer fields than the JSON carries.
const constantRows = gameConstants.constants as unknown as TemplateConstant[];
const forestTerrains = forestTerrainOptions(constantRows);
const trees = treeOptions(constantRows);

describe("template lists per tab", () => {
  it("Objects offers four, Terrain offers the terrain player forests", () => {
    expect(templatesFor("OBJECTS_GENERATION").map((t) => t.id)).toEqual([
      "standardPlayerObjects",
      "standardPlayerResources",
      "standardWaterResources",
      "playerForestsObjects",
    ]);
    expect(templatesFor("TERRAIN_GENERATION").map((t) => t.id)).toEqual([
      "playerForestsTerrain",
    ]);
    expect(templatesFor("LAND_GENERATION")).toEqual([]);
  });
});

describe("forest option lists come from game-constants.json", () => {
  it("lists forest terrains, FOREST among them", () => {
    const names = forestTerrains.map((o) => o.value);
    expect(names).toContain("FOREST");
    expect(names).toContain("PALM_DESERT");
    // Not a forest, must not leak in.
    expect(names).not.toContain("GRASS");
  });

  it("lists trees, OAKTREE among them, and nothing that isn't one", () => {
    const names = trees.map((o) => o.value);
    expect(names).toContain("OAKTREE");
    expect(names).toContain("DLC_RAINTREE");
    expect(names).not.toContain("GOLD");
    expect(new Set(names).size).toBe(names.length);
  });

  it("the defaults are real choices in those lists", () => {
    const terrainNames = forestTerrains.map((o) => o.value);
    expect(terrainNames).toContain(T4_DEFAULTS.forestTerrain);
    expect(terrainNames).toContain(T5_DEFAULTS.forestTerrain);
    expect(trees.map((o) => o.value)).toContain(T4_DEFAULTS.tree);
  });
});

describe("T4 player forests (objects)", () => {
  const combos: T4Options[] = [
    T4_DEFAULTS,
    { ...T4_DEFAULTS, terrainToPlaceOn: "GRASS" },
    { ...T4_DEFAULTS, standInId: "1640", minDistance: "5", maxDistance: "5" },
    ...forestTerrains.map((f) => ({ ...T4_DEFAULTS, forestTerrain: f.value })),
    ...trees.slice(0, 8).map((t) => ({ ...T4_DEFAULTS, tree: t.value })),
  ];

  for (const options of combos) {
    it(`parses cleanly with its setup in PLAYER_SETUP (${options.forestTerrain}, ${options.tree}, ${options.standInId}, terrain="${options.terrainToPlaceOn}")`, () => {
      const { text, setupText } = renderPlayerForestsObjects(options, {
        setupPresent: false,
      });
      expect(setupText).toBeDefined();
      scriptClean(
        `<PLAYER_SETUP>\n${setupText}\n<OBJECTS_GENERATION>\n${text}`,
      );
      expect(commandNames(text)).toEqual([FOREST_MAKER_CONST]);
      expect(text).toContain(`second_object ${options.tree}`);
      expect(text).toContain("set_place_for_every_player");
      expect(text).toContain("temp_min_distance_group_placement 9");
      expect(setupText).toContain(
        `#const ${FOREST_MAKER_CONST} ${options.standInId}`,
      );
      expect(setupText).toContain(
        `ATTR_FOUNDATION_TERRAIN ${options.forestTerrain}`,
      );
      expect(setupText).toContain("ATTR_HITPOINTS 0");
      expect(setupText).toContain("ATTR_RADIUS_1 0.5");
      expect(setupText).toContain("ATTR_RADIUS_2 0.5");
      if (options.terrainToPlaceOn)
        expect(text).toContain(
          `terrain_to_place_on ${options.terrainToPlaceOn}`,
        );
      else expect(text).not.toContain("terrain_to_place_on");
    });
  }

  it("the caret lands on the create_object line", () => {
    const { text, caretOffset } = renderPlayerForestsObjects(T4_DEFAULTS, {
      setupPresent: false,
    });
    expect(text.slice(caretOffset)).toMatch(
      /^create_object MAKE_FOREST_TERRAIN/,
    );
    expect(text[caretOffset - 1]).toBe("\n");
  });

  it("with the setup already in the script, inserts only the create_object and still parses", () => {
    const first = renderPlayerForestsObjects(T4_DEFAULTS, {
      setupPresent: false,
    });
    const second = renderPlayerForestsObjects(
      { ...T4_DEFAULTS, tree: "PALMTREE" },
      { setupPresent: true },
    );
    expect(second.setupText).toBeUndefined();
    scriptClean(
      `<PLAYER_SETUP>\n${first.setupText}\n<OBJECTS_GENERATION>\n${first.text}\n${second.text}`,
    );
  });

  it("reports nothing wrong with the defaults", () => {
    expect(
      playerForestsObjectsProblems(T4_DEFAULTS, { setupPresent: false }),
    ).toEqual([]);
  });

  it("reports each bad field", () => {
    const bad = (patch: Partial<T4Options>) =>
      playerForestsObjectsProblems(
        { ...T4_DEFAULTS, ...patch },
        { setupPresent: false },
      );
    expect(bad({ standInId: "" })).toHaveLength(1);
    expect(bad({ standInId: "MAKE" })).toHaveLength(1);
    expect(bad({ forestsPerPlayer: "0" })).toHaveLength(1);
    expect(bad({ treesPerForest: "2x" })).toHaveLength(1);
    expect(bad({ minDistance: "18" })).toHaveLength(1);
    expect(bad({ maxDistance: "" })).toHaveLength(1);
    expect(bad({ terrainToPlaceOn: "NOT A NAME" })).toHaveLength(1);
    // Custom… entries. A name or an id is fine, anything else is not.
    expect(bad({ forestTerrain: "MY_FOREST", tree: "349" })).toEqual([]);
    expect(bad({ forestTerrain: "" })).toHaveLength(1);
    expect(bad({ forestTerrain: "TWO WORDS" })).toHaveLength(1);
    expect(bad({ tree: "" })).toHaveLength(1);
  });

  it("ignores the stand-in id and forest terrain when the setup is already there", () => {
    expect(
      playerForestsObjectsProblems(
        { ...T4_DEFAULTS, standInId: "", forestTerrain: "" },
        { setupPresent: true },
      ),
    ).toEqual([]);
  });

  // A custom forest terrain or tree, as the script's own #const or a bare
  // id. The script's constants sit above PLAYER_SETUP, where an author
  // would have them, so the setup lines can use them.
  for (const [forestTerrain, tree] of [
    ["MY_FOREST", "MY_TREE"],
    ["21", "349"],
  ]) {
    it(`parses cleanly with a custom forest terrain and tree (${forestTerrain}, ${tree})`, () => {
      const { text, setupText } = renderPlayerForestsObjects(
        { ...T4_DEFAULTS, forestTerrain, tree },
        { setupPresent: false },
      );
      scriptCleanAllowing(
        `#const MY_FOREST 21\n#const MY_TREE 349\n<PLAYER_SETUP>\n${setupText}\n<OBJECTS_GENERATION>\n${text}`,
        bareId(forestTerrain) ? ["RMS0204"] : [],
      );
      expect(setupText).toContain(`ATTR_FOUNDATION_TERRAIN ${forestTerrain}`);
      expect(text).toContain(`second_object ${tree}`);
    });
  }
});

describe("T5 player forests (terrain)", () => {
  const host = (text: string, land = "GRASS") =>
    `<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands { terrain_type ${land} }\n<TERRAIN_GENERATION>\n${text}`;

  const combos: T5Options[] = [
    { ...T5_DEFAULTS, playerLand: "GRASS" },
    { ...T5_DEFAULTS, playerLand: "0" },
    ...forestTerrains.map((f) => ({
      ...T5_DEFAULTS,
      playerLand: "DIRT3",
      forestTerrain: f.value,
    })),
  ];

  // The last two are Custom… values, the script's own #const (defined at
  // the top of every host script) and a bare id.
  combos.push(
    { ...T5_DEFAULTS, playerLand: "GRASS", forestTerrain: "MY_FOREST" },
    { ...T5_DEFAULTS, playerLand: "GRASS", forestTerrain: "21" },
  );

  for (const options of combos) {
    it(`parses cleanly (${options.playerLand}, ${options.forestTerrain})`, () => {
      const { text } = renderPlayerForestsTerrain(options);
      scriptCleanAllowing(
        `#const MY_FOREST 21\n${host(text)}`,
        bareId(options.forestTerrain) ? ["RMS0204"] : [],
      );
      expect(text).toContain(`#const PLAYER_FOREST_LAND ${options.playerLand}`);
    });
  }

  it("runs one claim, one forest and six set-aside fills per round, in that order", () => {
    const { text } = renderPlayerForestsTerrain({
      ...T5_DEFAULTS,
      playerLand: "GRASS",
    });
    const claim =
      "create_terrain PLAYER_FOREST_SCRATCH { base_terrain PLAYER_FOREST_LAND land_percent 100 number_of_clumps 1 }";
    const forest = "create_terrain FOREST { base_terrain PLAYER_FOREST_SCRATCH";
    const setAside =
      "create_terrain PLAYER_FOREST_SET_ASIDE { base_terrain PLAYER_FOREST_SCRATCH";
    const lines = text.split("\n");
    const claims = lines.flatMap((l, i) => (l === claim ? [i] : []));
    expect(claims).toHaveLength(T5_ROUNDS);
    for (const at of claims) {
      expect(lines[at + 1].startsWith(forest)).toBe(true);
      for (let k = 2; k <= 7; k++)
        expect(lines[at + k].startsWith(setAside)).toBe(true);
    }
    // The set-aside pass has to come before the first claim, or a round
    // could claim land past the maximum distance.
    const firstSetAside = lines.findIndex((l) =>
      l.includes("set_avoid_player_start_areas PLAYER_FOREST_MAX_DISTANCE"),
    );
    expect(firstSetAside).toBeGreaterThan(-1);
    expect(firstSetAside).toBeLessThan(claims[0]);
    // And the restore after the last round.
    const restore = lines.lastIndexOf(
      "create_terrain PLAYER_FOREST_LAND { base_terrain PLAYER_FOREST_SET_ASIDE land_percent 100 number_of_clumps 9999 }",
    );
    expect(restore).toBeGreaterThan(claims[claims.length - 1]);
  });

  it("the caret lands on the first #const", () => {
    const { text, caretOffset } = renderPlayerForestsTerrain({
      ...T5_DEFAULTS,
      playerLand: "GRASS",
    });
    expect(text.slice(caretOffset)).toMatch(/^#const PLAYER_FOREST_LAND GRASS/);
  });

  it("reports each bad field, and nothing for good ones", () => {
    const bad = (patch: Partial<T5Options>) =>
      playerForestsTerrainProblems({
        ...T5_DEFAULTS,
        playerLand: "GRASS",
        ...patch,
      });
    expect(bad({})).toEqual([]);
    expect(bad({ playerLand: "12" })).toEqual([]);
    expect(bad({ playerLand: "" })).toHaveLength(1);
    expect(bad({ forestTerrain: "MY_FOREST" })).toEqual([]);
    expect(bad({ forestTerrain: "" })).toHaveLength(1);
    expect(bad({ forestTerrain: "NOT ONE" })).toHaveLength(1);
    expect(bad({ playerLand: "TWO WORDS" })).toHaveLength(1);
    expect(bad({ forestTiles: "0" })).toHaveLength(1);
    expect(bad({ forestClumps: "" })).toHaveLength(1);
    // Equal distances leave no ring for the forest to grow in.
    expect(bad({ minDistance: "17" })).toHaveLength(1);
  });
});

describe("scriptContext", () => {
  const parse = (src: string) => parseRms(src, langData, { builtinConstants });

  it("reads create_player_lands' terrain_type", () => {
    expect(
      playerLandTerrain(
        parse(
          "<LAND_GENERATION>\ncreate_player_lands { terrain_type DIRT3 land_percent 50 }",
        ),
      ),
    ).toBe("DIRT3");
  });

  it("finds it inside a conditional and takes the first", () => {
    expect(
      playerLandTerrain(
        parse(
          "<LAND_GENERATION>\nif TINY_MAP\ncreate_player_lands { terrain_type 8 }\nelse\ncreate_player_lands { terrain_type GRASS }\nendif",
        ),
      ),
    ).toBe("8");
  });

  it("returns undefined with no create_player_lands", () => {
    expect(
      playerLandTerrain(
        parse("<LAND_GENERATION>\ncreate_land { terrain_type GRASS }"),
      ),
    ).toBeUndefined();
  });

  it("knows whether the forest setup is already defined", () => {
    expect(
      definesSymbol(
        parse(`#const ${FOREST_MAKER_CONST} 1639`),
        FOREST_MAKER_CONST,
      ),
    ).toBe(true);
    expect(definesSymbol(parse("#const OTHER 1"), FOREST_MAKER_CONST)).toBe(
      false,
    );
  });
});
