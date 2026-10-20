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
  QUICK_START_KIT_NAMES,
  HUNTABLE_OPTIONS,
  LURABLE_OPTIONS,
  FOREST_MAKER_CONST,
  SCOUT_OPTIONS,
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
  playerResourcesProblems,
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
import {
  definesSymbol,
  playerLandTerrain,
  startResourceCuts,
} from "../scriptContext";

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
    { ...T1_DEFAULTS, quickStart: true },
    { ...T1_DEFAULTS, terrainToPlaceOn: "GRASS" },
    { ...T1_DEFAULTS, quickStart: true, terrainToPlaceOn: "GRASS" },
    { ...T1_DEFAULTS, quickStart: true, advanced: true },
    {
      ...T1_DEFAULTS,
      quickStart: true,
      advanced: true,
      terrainToPlaceOn: "GRASS",
    },
    ...SCOUT_OPTIONS.flatMap((s) => [
      { ...T1_DEFAULTS, scout: s.value },
      { ...T1_DEFAULTS, scout: s.value, quickStart: true },
      { ...T1_DEFAULTS, scout: s.value, quickStart: true, advanced: true },
    ]),
  ];

  for (const options of combos) {
    it(`parses cleanly (scout=${options.scout}, quickStart=${options.quickStart}, advanced=${options.advanced}, terrain="${options.terrainToPlaceOn}")`, () => {
      const { text, headerText } = renderStandardPlayerObjects(options);
      // The quick start's #define lives in the header, ahead of the sections.
      scriptClean(
        `${headerText ?? ""}\n<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`,
      );
      expect(headerText !== undefined).toBe(options.quickStart);
      const names = commandNames(text);
      expect(names).toContain("TOWN_CENTER");
      // Exactly one scout block, the chosen unit, and never the other one.
      expect(names.filter((n) => n === options.scout)).toHaveLength(1);
      expect(names).not.toContain(
        options.scout === "SCOUT" ? "HORSE" : "SCOUT",
      );
      // Player-owned objects are never gaia-only. The placeholders of the
      // advanced quick-start are the only blocks that carry the line.
      // Every block takes the closest valid tile exactly once, except the
      // VILLAGER blocks, which never do, and the town center, which sits at
      // distance 0 and has nothing to choose between. The advanced quick
      // start's PH_PLAYER_OFF villagers keep the line they have in Venn and
      // Bulls_Eyes, since that technique needs it.
      const allBlocks = [...text.matchAll(/create_object [^{]*\{[^}]*\}/g)].map(
        (m) => m[0],
      );
      expect(allBlocks.length).toBeGreaterThan(0);
      for (const b of allBlocks) {
        const exempt = /^create_object (VILLAGER|TOWN_CENTER)\b/.test(b);
        expect(b.match(/find_closest/g) ?? []).toHaveLength(exempt ? 0 : 1);
      }
      for (const owned of ["TOWN_CENTER", "VILLAGER", options.scout, "HOUSE"]) {
        expect(blockOf(text, owned)).not.toContain("set_gaia_object_only");
      }
      if (options.quickStart && options.advanced) {
        expect(names).toContain("PH_NEUTRAL_OFF");
        expect(names.filter((n) => n === "PH_PLAYER_OFF")).toHaveLength(6);
        expect(names).toContain("THEMED_TREE1");
        expect(names).toContain("HOUSE");
        expect(text).toContain("number_of_objects 3");
        expect(text).toContain("place_on_forest_zone");
        expect(text).toContain("start_random");
        expect(text).toContain("QUICK_START_MALE");
        expect(text).toContain("QUICK_START_FEMALE");
      } else if (options.quickStart) {
        // Two quick-start groups, plus the plain three in the else branch.
        expect(names.filter((n) => n === "VILLAGER")).toHaveLength(3);
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

  for (const advanced of [false, true]) {
    it(`quick-start sits behind if QUICK_START with the plain villagers as else (advanced=${advanced})`, () => {
      const { text, headerText } = renderStandardPlayerObjects({
        ...T1_DEFAULTS,
        quickStart: true,
        advanced,
      });
      expect(headerText).toContain("#define QUICK_START");
      const script = `${headerText}\n<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`;
      const parsed = scriptClean(script);
      const section = parsed.script.sections.find(
        (s) => s.name === "OBJECTS_GENERATION",
      )!;
      const ifs = section.items.filter((i) => i.kind === "if");
      expect(ifs).toHaveLength(1);
      const node = ifs[0];
      if (node.kind !== "if") throw new Error("unreachable");
      expect(node.branches).toHaveLength(2);
      expect(parsed.tokens[node.branches[0].condition!].text).toBe(
        "QUICK_START",
      );
      const inBranch = (i: number) =>
        node.branches[i].items.flatMap((item) =>
          item.kind === "command" ? [parsed.tokens[item.name].text] : [],
        );
      // The plain three villagers are the whole else branch.
      expect(inBranch(1).filter((n) => n === "create_object")).toHaveLength(1);
      // Town center and scout stay outside it, in both worlds.
      expect(text.slice(0, text.indexOf("if QUICK_START"))).toContain(
        "create_object TOWN_CENTER",
      );
      expect(text.slice(text.indexOf("endif"))).toContain(
        "create_object SCOUT",
      );
    });
  }

  it("leaves the #define out when the script already has one", () => {
    const { headerText, text } = renderStandardPlayerObjects(
      { ...T1_DEFAULTS, quickStart: true },
      { quickStartDefined: true },
    );
    expect(headerText).not.toContain("#define");
    expect(text).toContain("if QUICK_START");
  });

  describe("quick-start resource cuts", () => {
    const cutLines = [
      "effect_amount MOD_RESOURCE AMOUNT_STARTING_WOOD ATTR_ADD -30",
      "effect_amount MOD_RESOURCE AMOUNT_STARTING_FOOD ATTR_ADD -90",
    ];

    for (const advanced of [false, true]) {
      it(`sit inside if QUICK_START, after the #define (advanced=${advanced})`, () => {
        const { headerText, text } = renderStandardPlayerObjects({
          ...T1_DEFAULTS,
          quickStart: true,
          advanced,
        });
        const header = headerText!;
        for (const line of cutLines) expect(header).toContain(line);
        // The #define comes first, then an if that holds both cuts and
        // nothing else, so removing the #define restores the standard start.
        const defineAt = header.indexOf("#define QUICK_START");
        const ifAt = header.indexOf("if QUICK_START");
        const endifAt = header.indexOf("endif");
        expect(defineAt).toBeGreaterThanOrEqual(0);
        expect(ifAt).toBeGreaterThan(defineAt);
        expect(endifAt).toBeGreaterThan(ifAt);
        for (const line of cutLines) {
          expect(header.indexOf(line)).toBeGreaterThan(ifAt);
          expect(header.indexOf(line)).toBeLessThan(endifAt);
        }
        // Parses clean as part of the whole script, and the cuts stay in the
        // preamble (header), behind the condition.
        const parsed = scriptClean(
          `${header}\n<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`,
        );
        expect(parsed.script.preamble.some((i) => i.kind === "if")).toBe(true);
      });
    }

    it("are not written without the quick start", () => {
      const { headerText } = renderStandardPlayerObjects(T1_DEFAULTS);
      expect(headerText).toBeUndefined();
    });

    it("skip a resource the script already cuts, and keep the other", () => {
      const { headerText } = renderStandardPlayerObjects(
        { ...T1_DEFAULTS, quickStart: true },
        {
          quickStartDefined: true,
          startResourceCutsDefined: ["AMOUNT_STARTING_WOOD"],
        },
      );
      expect(headerText).not.toContain("AMOUNT_STARTING_WOOD");
      expect(headerText).toContain("AMOUNT_STARTING_FOOD ATTR_ADD -90");
    });

    it("leave no header when the script has the define and both cuts", () => {
      const { headerText } = renderStandardPlayerObjects(
        { ...T1_DEFAULTS, quickStart: true },
        {
          quickStartDefined: true,
          startResourceCutsDefined: [
            "AMOUNT_STARTING_WOOD",
            "AMOUNT_STARTING_FOOD",
          ],
        },
      );
      expect(headerText).toBeUndefined();
    });
  });

  // The game defines none of PH_NEUTRAL_OFF, PH_PLAYER_OFF, THEMED_TREE1 and
  // HERDABLE_A, and gives LAZY_MALE and LAZY_FEMALE other objects, so a
  // script that places them without its own #const crashes DE on load. The
  // validator cannot catch this (reference data is a positive resolver only),
  // hence the explicit list. 2026-10-20, test_template.rms.
  describe("advanced quick-start kit", () => {
    const advancedOptions: T1Options = {
      ...T1_DEFAULTS,
      quickStart: true,
      advanced: true,
    };

    it("defines every name the advanced text places that the game does not", () => {
      const { text, headerText } = renderStandardPlayerObjects(advancedOptions);
      expect(headerText).toBeDefined();
      for (const name of [
        "PH_NEUTRAL_OFF",
        "PH_PLAYER_OFF",
        "THEMED_TREE1",
        "HERDABLE_A",
        "QUICK_START_MALE",
        "QUICK_START_FEMALE",
      ]) {
        expect(text, name).toContain(name);
        expect(headerText, name).toMatch(new RegExp(`#const ${name} \\d+`));
      }
      // The ids the corpus maps agree on.
      expect(headerText).toContain("#const PH_NEUTRAL_OFF 346");
      expect(headerText).toContain("#const PH_PLAYER_OFF 647");
    });

    it("turns the flags into villagers and the pig into a carcass", () => {
      const { headerText } = renderStandardPlayerObjects(advancedOptions);
      for (const line of [
        "effect_amount SET_ATTRIBUTE QUICK_START_MALE ATTR_DEAD_ID 83",
        "effect_amount SET_ATTRIBUTE QUICK_START_MALE ATTR_HITPOINTS 0",
        "effect_amount SET_ATTRIBUTE QUICK_START_FEMALE ATTR_DEAD_ID 293",
        "effect_amount SET_ATTRIBUTE QUICK_START_FEMALE ATTR_HITPOINTS 0",
        "effect_amount GAIA_SET_ATTRIBUTE HERDABLE_A ATTR_HITPOINTS 0",
      ]) {
        expect(headerText, line).toContain(line);
      }
    });

    it("defines each name before the first line that uses it", () => {
      const { headerText } = renderStandardPlayerObjects(advancedOptions);
      const lines = headerText!.split("\n");
      for (const name of [
        "QUICK_START_MALE",
        "QUICK_START_FEMALE",
        "HERDABLE_A",
      ]) {
        const defined = lines.findIndex((l) => l.startsWith(`#const ${name} `));
        const used = lines.findIndex(
          (l) => l.startsWith("effect_amount") && l.includes(` ${name} `),
        );
        expect(defined, name).toBeGreaterThanOrEqual(0);
        expect(used, name).toBeGreaterThan(defined);
      }
    });

    it("the whole header parses clean with the sections that follow", () => {
      const { text, headerText } = renderStandardPlayerObjects(advancedOptions);
      scriptClean(
        `${headerText}\n<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`,
      );
    });

    it("writes the kit alone when the script already defines QUICK_START", () => {
      const { headerText } = renderStandardPlayerObjects(advancedOptions, {
        quickStartDefined: true,
      });
      expect(headerText).not.toContain("#define QUICK_START");
      expect(headerText).toContain("#const PH_NEUTRAL_OFF 346");
    });

    it("leaves a name's lines out when the script already defines it", () => {
      const { headerText } = renderStandardPlayerObjects(advancedOptions, {
        quickStartDefined: false,
        kitNamesDefined: ["PH_NEUTRAL_OFF", "HERDABLE_A"],
      });
      expect(headerText).toContain("#define QUICK_START");
      expect(headerText).not.toContain("#const PH_NEUTRAL_OFF");
      expect(headerText).not.toContain("HERDABLE_A");
      // The rest still goes in: one defined name does not excuse the others.
      expect(headerText).toContain("#const PH_PLAYER_OFF 647");
      expect(headerText).toContain("#const QUICK_START_MALE 1285");
    });

    it("writes no header at all when the script has everything", () => {
      const { headerText } = renderStandardPlayerObjects(advancedOptions, {
        quickStartDefined: true,
        kitNamesDefined: QUICK_START_KIT_NAMES,
        startResourceCutsDefined: [
          "AMOUNT_STARTING_WOOD",
          "AMOUNT_STARTING_FOOD",
        ],
      });
      expect(headerText).toBeUndefined();
    });

    it("the simple quick start needs no kit", () => {
      const { headerText } = renderStandardPlayerObjects({
        ...T1_DEFAULTS,
        quickStart: true,
      });
      expect(headerText).not.toContain("#const");
      // Only the resource cuts, no flag or pig effects.
      expect(headerText).not.toContain("SET_ATTRIBUTE");
    });
  });

  it("plain placement has no if and no header text", () => {
    const { text, headerText } = renderStandardPlayerObjects(T1_DEFAULTS);
    expect(headerText).toBeUndefined();
    expect(text).not.toContain("QUICK_START");
  });

  it("advanced is ignored while quick-start is off", () => {
    const withAdvancedOnly = renderStandardPlayerObjects({
      ...T1_DEFAULTS,
      advanced: true,
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

  it("the caret offset lands on the first actor area constant", () => {
    const { text, caretOffset } = renderStandardPlayerResources(T2_DEFAULTS);
    expect(text.slice(caretOffset)).toMatch(/^#const AA_BERRIES 9995/);
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

  it("defaults to DE's pile sizes", () => {
    // F_NearGoldStone.inc, NEAR_GS_STANDARD: 7 and 4 gold, 5 and 4 stone.
    expect([
      T2_DEFAULTS.largeGold.count,
      T2_DEFAULTS.smallGold.count,
      T2_DEFAULTS.largeStone.count,
      T2_DEFAULTS.smallStone.count,
    ]).toEqual(["7", "4", "5", "4"]);
  });

  // Starting resources are never player owned. The one exception is the
  // player's own sheep, so every block but that one carries the line.
  for (const seasonal of [false, true]) {
    it(`every block is gaia-only except the player's own sheep (seasonal=${seasonal})`, () => {
      const { text } = renderStandardPlayerResources({
        ...T2_DEFAULTS,
        seasonal,
      });
      const blocks = [...text.matchAll(/create_object [^{]*\{[^}]*\}/g)].map(
        (m) => m[0],
      );
      const owned = blocks.filter((b) => !b.includes("set_gaia_object_only"));
      // Eight resource blocks plus the five sheep blocks of both starts.
      expect(blocks).toHaveLength(12);
      expect(owned).toHaveLength(2);
      for (const b of owned) expect(b).toContain("owned by the player");
      // Placement is the same closest-valid-tile rule for every block, so
      // no player's layout depends on a random pick.
      for (const b of blocks) expect(b).toContain("find_closest");
      parseClean(text);
    });
  }

  // The two starts, picked by `if QUICK_START`. The else branch is the
  // standard start, so a script with no QUICK_START gets that one.
  describe("the sheep", () => {
    const { text } = renderStandardPlayerResources(T2_DEFAULTS);
    const ifAt = text.indexOf("if QUICK_START");
    const elseAt = text.indexOf("\nelse\n");
    const endAt = text.indexOf("\nendif");
    const sheepIn = (part: string) =>
      [...part.matchAll(/create_object SHEEP[^{]*\{[^}]*\}/g)].map((m) => m[0]);

    it("sits in one if QUICK_START / else / endif, the other animals outside it", () => {
      expect(ifAt).toBeGreaterThan(-1);
      expect(elseAt).toBeGreaterThan(ifAt);
      expect(endAt).toBeGreaterThan(elseAt);
      expect(text.match(/if QUICK_START/g)).toHaveLength(1);
      expect(text.slice(ifAt, endAt)).not.toMatch(
        /create_object (DEER|BOAR|GOLD|STONE)/,
      );
      expect(text.slice(endAt)).toContain("create_object DEER");
    });

    it("quick start is 3 owned sheep a little closer and one gaia pair", () => {
      const [close, far, ...rest] = sheepIn(text.slice(ifAt, elseAt));
      expect(rest).toEqual([]);
      expect(close).not.toContain("set_gaia_object_only");
      expect(close).toContain("number_of_objects 3");
      expect(close).toContain("min_distance_to_players 5");
      expect(close).toContain("max_distance_to_players 6");
      expect(far).toContain("set_gaia_object_only");
      expect(far).toContain("number_of_objects 2");
      expect(far).toContain("number_of_groups 1");
    });

    it("the standard start is 1 owned, 3 gaia beside it and 2 gaia pairs", () => {
      const [owned, beside, far, ...rest] = sheepIn(text.slice(elseAt, endAt));
      expect(rest).toEqual([]);
      expect(owned).not.toContain("set_gaia_object_only");
      expect(owned).toContain("number_of_objects 1");
      expect(beside).toContain("set_gaia_object_only");
      expect(beside).toContain("number_of_objects 3");
      // The three stand in the owned animal's own actor area.
      const area = owned.match(/actor_area (\w+)/)![1];
      expect(beside).toContain(`actor_area_to_place_in ${area}`);
      expect(far).toContain("set_gaia_object_only");
      expect(far).toContain("number_of_objects 2");
      expect(far).toContain("number_of_groups 2");
    });

    it("parses with and without a QUICK_START define", () => {
      parseClean(text);
      scriptClean(
        `#define QUICK_START\n<PLAYER_SETUP>\n<OBJECTS_GENERATION>\n${text}`,
      );
    });
  });

  it("leaves a dropdown parameter out entirely when it is None", () => {
    const none = (patch: Partial<T2Options>) =>
      renderStandardPlayerResources({ ...T2_DEFAULTS, ...patch }).text;
    expect(none({ berryType: "none" })).not.toContain("FORAGE_BUSH");
    expect(none({ huntable: "none" })).not.toMatch(/DEER|Deer/);
    expect(none({ lurable: "none" })).not.toMatch(/BOAR|Boar/);
    // Herdable owns both sheep blocks and the comment above them.
    const noHerd = none({ herdable: "none" });
    expect(noHerd).not.toMatch(/SHEEP|Sheep/);
    // Nothing else moved.
    expect(commandNames(noHerd)).toEqual([
      "FORAGE_BUSH",
      "GOLD",
      "STONE",
      "GOLD",
      "STONE",
      "DEER",
      "BOAR",
    ]);
  });

  it("leaves a pile out when it is unticked, and uses the typed amount", () => {
    const { text } = renderStandardPlayerResources({
      ...T2_DEFAULTS,
      largeGold: { enabled: true, count: "9" },
      smallGold: { enabled: false, count: "4" },
      smallStone: { enabled: true, count: "2" },
    });
    expect(text).not.toContain("Small gold");
    expect(text).toContain("/* Large gold */\ncreate_object GOLD\n{");
    expect(commandNames(text).filter((n) => n === "GOLD")).toHaveLength(1);
    expect(blockBody(text, "Large gold")).toContain("number_of_objects 9");
    expect(blockBody(text, "Small stone")).toContain("number_of_objects 2");
  });

  it("under Seasonal variation, None still drops a block and anything else keeps its placeholder", () => {
    const { text } = renderStandardPlayerResources({
      ...T2_DEFAULTS,
      seasonal: true,
      huntable: "none",
    });
    expect(text).not.toContain("HUNTABLE");
    expect(text).toContain("HERDABLE_A");
    expect(text).toContain("BERRIES");
    parseClean(text);
  });

  it("places the boar as two groups of one, spaced apart", () => {
    const { text } = renderStandardPlayerResources(T2_DEFAULTS);
    const boar = blockOf(text, "BOAR");
    expect(boar).toContain("number_of_objects 1\n");
    expect(boar).toContain("number_of_groups 2");
    expect(boar).toContain("temp_min_distance_group_placement 7");
  });

  // Every resource owns an actor area, named with an AA_ constant, and avoids
  // the area of each block written before it. find_closest alone sent every
  // block to the same nearest tiles and lined them up (2026-10-21).
  describe("actor areas", () => {
    const areaOf = (block: string) =>
      block.match(/(?<!avoid_)actor_area (AA_\w+)/)?.[1] ?? undefined;
    const avoidsOf = (block: string) =>
      [...block.matchAll(/avoid_actor_area (AA_\w+)/g)].map((m) => m[1]);

    for (const seasonal of [false, true]) {
      it(`every resource claims a named area and avoids all earlier ones (seasonal=${seasonal})`, () => {
        const { text } = renderStandardPlayerResources({
          ...T2_DEFAULTS,
          seasonal,
        });
        // Blocks in the order they are written. The close herd's own area
        // is a placement helper, not a resource area, so it is left out.
        const blocks = [
          ...text.matchAll(
            /create_object \w+\s*(?:\/\*[^*]*\*\/\s*)?\{[^}]*\}/g,
          ),
        ].map((m) => m[0]);
        const claimed: string[] = [];
        const resourceBlocks = blocks.filter((b) => {
          const a = areaOf(b);
          return a !== undefined && a !== "AA_HERDABLE_CLOSE";
        });
        expect(resourceBlocks.length).toBeGreaterThanOrEqual(7);
        for (const b of resourceBlocks) {
          const own = areaOf(b)!;
          // Avoids every area claimed before it, never its own.
          expect(avoidsOf(b).sort(), own).toEqual(
            [...new Set(claimed.filter((c) => c !== own))].sort(),
          );
          if (!claimed.includes(own)) claimed.push(own);
        }
        // No resource area is a bare number.
        expect(text).not.toMatch(/(?:avoid_)?actor_area(?:_to_place_in)? \d/);
      });
    }

    it("defines each constant before its first use, and only the ones used", () => {
      const { text } = renderStandardPlayerResources(T2_DEFAULTS);
      const defined = [...text.matchAll(/#const (AA_\w+) (\d+)/g)];
      expect(defined.map((m) => m[1]).sort()).toEqual(
        [
          "AA_BERRIES",
          "AA_GOLD_LARGE",
          "AA_STONE_LARGE",
          "AA_GOLD_SMALL",
          "AA_STONE_SMALL",
          "AA_HERDABLE",
          "AA_HUNTABLE",
          "AA_LURABLE",
          "AA_HERDABLE_CLOSE",
        ].sort(),
      );
      // One id each.
      expect(new Set(defined.map((m) => m[2])).size).toBe(defined.length);
      const firstBlock = text.indexOf("create_object");
      for (const m of defined) expect(m.index).toBeLessThan(firstBlock);
    });

    it("a resource that is left out leaves no constant and no avoid line", () => {
      const { text } = renderStandardPlayerResources({
        ...T2_DEFAULTS,
        berryType: "none",
        lurable: "none",
        largeStone: { enabled: false, count: "5" },
      });
      for (const gone of ["AA_BERRIES", "AA_LURABLE", "AA_STONE_LARGE"])
        expect(text, gone).not.toContain(gone);
      // Large gold is first now, so it avoids nothing.
      expect(avoidsOf(blockOf(text, "GOLD").split("create_object")[1])).toEqual(
        [],
      );
    });

    it("writes no constants at all when every area-owning block is left out", () => {
      const { text } = renderStandardPlayerResources({
        ...T2_DEFAULTS,
        berryType: "none",
        herdable: "none",
        huntable: "none",
        lurable: "none",
        largeGold: { enabled: false, count: "7" },
        smallGold: { enabled: false, count: "4" },
        largeStone: { enabled: true, count: "5" },
        smallStone: { enabled: false, count: "4" },
      });
      expect(text).toContain("#const AA_STONE_LARGE 9998");
      expect(text).not.toMatch(/#const AA_(?!STONE_LARGE)/);
    });
  });

  it("the caret lands on whichever block comes first", () => {
    const { text, caretOffset } = renderStandardPlayerResources({
      ...T2_DEFAULTS,
      berryType: "none",
    });
    expect(text.slice(caretOffset)).toMatch(/^#const AA_GOLD_LARGE 9999/);
    expect(text[caretOffset - 1]).toBe("\n");
  });

  it("reports each bad field, and a None-everything template", () => {
    const bad = (patch: Partial<T2Options>) =>
      playerResourcesProblems({ ...T2_DEFAULTS, ...patch });
    expect(playerResourcesProblems(T2_DEFAULTS)).toEqual([]);
    expect(bad({ largeGold: { enabled: true, count: "0" } })).toHaveLength(1);
    expect(bad({ smallStone: { enabled: true, count: "4x" } })).toHaveLength(1);
    expect(bad({ smallStone: { enabled: true, count: "" } })).toHaveLength(1);
    // A bad amount on an unticked pile is not a problem, it is not emitted.
    expect(bad({ smallStone: { enabled: false, count: "x" } })).toEqual([]);
    expect(bad({ terrainToPlaceOn: "NOT A NAME" })).toHaveLength(1);
    expect(
      bad({
        berryType: "none",
        herdable: "none",
        huntable: "none",
        lurable: "none",
        largeGold: { enabled: false, count: "7" },
        smallGold: { enabled: false, count: "4" },
        largeStone: { enabled: false, count: "5" },
        smallStone: { enabled: false, count: "4" },
      }),
    ).toHaveLength(1);
  });

  // Every on/off combination of the four None-able dropdowns and the four
  // piles, with and without seasonal variation. Each text has to parse with
  // no diagnostics, hold exactly the blocks the options promise, and carry
  // set_gaia_object_only on every one of them but the player's own sheep.
  describe("every None and pile combination", () => {
    const seasonalChoices = [false, true];
    for (const seasonal of seasonalChoices) {
      {
        for (let wildMask = 0; wildMask < 16; wildMask++) {
          for (let pileMask = 0; pileMask < 16; pileMask++) {
            const bit = (mask: number, i: number) => (mask >> i) & 1;
            const options: T2Options = {
              ...T2_DEFAULTS,
              seasonal,
              berryType: bit(wildMask, 0) ? "none" : "DLC_ORANGEBUSH",
              herdable: bit(wildMask, 1) ? "none" : "DLC_GOAT",
              huntable: bit(wildMask, 2) ? "none" : "DLC_ZEBRA",
              lurable: bit(wildMask, 3) ? "none" : "JAVELINA",
              largeGold: { enabled: !bit(pileMask, 0), count: "8" },
              smallGold: { enabled: !bit(pileMask, 1), count: "3" },
              largeStone: { enabled: !bit(pileMask, 2), count: "6" },
              smallStone: { enabled: !bit(pileMask, 3), count: "2" },
            };
            const noneCount = wildMask
              .toString(2)
              .split("")
              .filter((c) => c === "1").length;
            const piles =
              4 -
              pileMask
                .toString(2)
                .split("")
                .filter((c) => c === "1").length;
            const nothing = noneCount === 4 && piles === 0;
            it(`${seasonal ? "seasonal" : "named"}, none-mask ${wildMask}, pile-mask ${pileMask}`, () => {
              const { text } = renderStandardPlayerResources(options);
              const names = commandNames(text);
              const expectedBlocks =
                (bit(wildMask, 0) ? 0 : 1) +
                (bit(wildMask, 1) ? 0 : 5) +
                (bit(wildMask, 2) ? 0 : 1) +
                (bit(wildMask, 3) ? 0 : 1) +
                piles;
              expect(names).toHaveLength(expectedBlocks);
              expect(names.filter((n) => n === "GOLD")).toHaveLength(
                (bit(pileMask, 0) ? 0 : 1) + (bit(pileMask, 1) ? 0 : 1),
              );
              expect(names.filter((n) => n === "STONE")).toHaveLength(
                (bit(pileMask, 2) ? 0 : 1) + (bit(pileMask, 3) ? 0 : 1),
              );
              expect(text.match(/set_gaia_object_only/g) ?? []).toHaveLength(
                // Everything but the two owned close herds, one per start.
                expectedBlocks - (bit(wildMask, 1) ? 0 : 2),
              );
              expect(
                text.match(/set_place_for_every_player/g) ?? [],
              ).toHaveLength(expectedBlocks);
              expect(text.match(/find_closest/g) ?? []).toHaveLength(
                expectedBlocks,
              );
              // The seasons include goes with the seasonal consts only
              // when something still uses them.
              const usesSeasonal = names.some((n) =>
                [
                  "BERRIES",
                  "HERDABLE",
                  "HERDABLE_A",
                  "HUNTABLE",
                  "LURABLE",
                ].includes(n),
              );
              if (seasonal) expect(usesSeasonal).toBe(wildMask !== 15);
              else expect(usesSeasonal).toBe(false);
              expect(text.includes("#include_drs F_seasons.inc")).toBe(
                usesSeasonal,
              );
              if (!nothing) parseClean(text);
            });
          }
        }
      }
    }
  });
});

// Every create_object block of one name, joined, or "" when there is none.
function blockOf(text: string, name: string): string {
  return [
    ...text.matchAll(
      new RegExp(`create_object ${name}\\b[^{]*\\{[^}]*\\}`, "g"),
    ),
  ]
    .map((m) => m[0])
    .join("\n");
}

// The text from a block's label comment up to the close of its braces.
function blockBody(text: string, label: string): string {
  const start = text.indexOf(`/* ${label} */`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("}", start);
  return text.slice(start, end);
}

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
    expect(bad({ tree: "TWO WORDS" })).toHaveLength(1);
    // An empty tree is the dialog's None, a valid choice.
    expect(bad({ tree: "" })).toEqual([]);
  });

  it("with the tree set to None, leaves second_object out and still parses", () => {
    const { text, setupText } = renderPlayerForestsObjects(
      { ...T4_DEFAULTS, tree: "" },
      { setupPresent: false },
    );
    expect(text).not.toContain("second_object");
    scriptClean(`<PLAYER_SETUP>\n${setupText}\n<OBJECTS_GENERATION>\n${text}`);
    expect(commandNames(text)).toEqual([FOREST_MAKER_CONST]);
    // Everything else about the block is untouched.
    expect(text).toContain("set_place_for_every_player");
    expect(text).toContain("number_of_objects 20");
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

  it("reads the starting resources a script cuts, header or section", () => {
    const cuts = startResourceCuts(
      parse(
        [
          "effect_amount MOD_RESOURCE AMOUNT_STARTING_WOOD ATTR_ADD -30",
          "if QUICK_START",
          "  effect_amount MOD_RESOURCE AMOUNT_STARTING_FOOD ATTR_ADD -90",
          "endif",
          "<PLAYER_SETUP>",
          "effect_amount SET_ATTRIBUTE SHEEP ATTR_HITPOINTS 0",
          "effect_amount MOD_RESOURCE AMOUNT_STARTING_GOLD ATTR_ADD 50",
        ].join("\n"),
      ),
    );
    expect(cuts.sort()).toEqual([
      "AMOUNT_STARTING_FOOD",
      "AMOUNT_STARTING_GOLD",
      "AMOUNT_STARTING_WOOD",
    ]);
    expect(startResourceCuts(parse("<PLAYER_SETUP>"))).toEqual([]);
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
