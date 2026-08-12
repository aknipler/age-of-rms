// Phase 2.5 — resource totals. Covers the two UX decisions locked 
// before implementing (range display for if/random, flag-based
// Player/Neutral split via set_place_for_every_player), plus the count
// arithmetic (number_of_objects x number_of_groups, rnd(...) widening,
// player-count scaling).

import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { computeResourceTotals, type GameConstantsForTotals } from "../resourceTotals";
import { loadLanguage } from "./testUtils";

const lang = loadLanguage();

const GOLD_ONLY: GameConstantsForTotals = {
  constants: [
    { rmsConstant: "GOLD", category: "object", resourceAmounts: { gold: 800 } },
    { rmsConstant: "FORAGE", category: "object", resourceAmounts: { food: 125 } },
    { rmsConstant: "HOUSE", category: "object" }, // no resourceAmounts — must contribute 0
  ],
};

function totalsFor(source: string, gameConstants: GameConstantsForTotals = GOLD_ONLY, playerCount = 4) {
  const result = parseRms(source, lang);
  return computeResourceTotals(result.script, result.tokens, gameConstants, playerCount);
}

describe("create_object contribution basics", () => {
  it("bare create_object counts as exactly 1 instance", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD");
    expect(t.total.min.gold).toBe(800);
    expect(t.total.max.gold).toBe(800);
    expect(t.neutral.min.gold).toBe(800);
    expect(t.player.min.gold).toBe(0);
  });

  it("unknown object / object with no resourceAmounts contributes 0", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object HOUSE");
    expect(t.total.min).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });

  it("number_of_objects x number_of_groups multiplies the count", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 3 number_of_groups 2 }");
    expect(t.total.min.gold).toBe(800 * 3 * 2);
    expect(t.total.max.gold).toBe(800 * 3 * 2);
  });

  it("multiple create_object calls sum together, across resources", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 2 }\ncreate_object FORAGE { number_of_objects 3 }",
    );
    expect(t.total.min.gold).toBe(1600);
    expect(t.total.min.food).toBe(375);
  });
});

describe("Player vs Neutral split", () => {
  it("set_place_for_every_player -> Player bucket is PER-PLAYER (unscaled); Total is map-wide (scaled)", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD { set_place_for_every_player }", GOLD_ONLY, 4);
    expect(t.player.min.gold).toBe(800);
    expect(t.player.max.gold).toBe(800);
    expect(t.neutral.min.gold).toBe(0);
    expect(t.total.min.gold).toBe(800 * 4);
  });

  it("Player bucket does not change shape with playerCount, only Total does", () => {
    const t8 = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD { set_place_for_every_player }", GOLD_ONLY, 8);
    expect(t8.player.min.gold).toBe(800);
    expect(t8.total.min.gold).toBe(800 * 8);
  });

  it("no set_place_for_every_player -> Neutral bucket, NOT scaled by playerCount", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD", GOLD_ONLY, 4);
    expect(t.neutral.min.gold).toBe(800);
    expect(t.player.min.gold).toBe(0);
  });
});

describe("random-block range display", () => {
  it("start_random with two percent_chance branches -> min/max span both branches", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\nstart_random\npercent_chance 50 create_object GOLD { number_of_objects 2 }\npercent_chance 50 create_object GOLD { number_of_objects 5 }\nend_random",
    );
    expect(t.total.min.gold).toBe(800 * 2);
    expect(t.total.max.gold).toBe(800 * 5);
  });

  it("start_random always has exactly one branch run -> no implicit 0 floor", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\nstart_random\npercent_chance 100 create_object GOLD { number_of_objects 3 }\nend_random",
    );
    expect(t.total.min.gold).toBe(800 * 3);
    expect(t.total.max.gold).toBe(800 * 3);
  });

  it("if without else CAN result in nothing placed -> min floors at 0", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\nif REGICIDE create_object GOLD { number_of_objects 3 } endif");
    expect(t.total.min.gold).toBe(0);
    expect(t.total.max.gold).toBe(800 * 3);
  });

  it("if WITH else always places something -> min does NOT floor at 0", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\nif REGICIDE create_object GOLD { number_of_objects 2 } else create_object GOLD { number_of_objects 5 } endif",
    );
    expect(t.total.min.gold).toBe(800 * 2);
    expect(t.total.max.gold).toBe(800 * 5);
  });

  it("rnd(...) in number_of_objects widens the range directly", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects rnd(2,4) }");
    expect(t.total.min.gold).toBe(800 * 2);
    expect(t.total.max.gold).toBe(800 * 4);
  });

  it("sibling items inside the same branch sum together (not just the last one)", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\nif REGICIDE\ncreate_object GOLD { number_of_objects 1 }\ncreate_object GOLD { number_of_objects 1 }\nendif",
    );
    expect(t.total.max.gold).toBe(1600);
  });
});

describe("second_object companion type", () => {
  // Real maps pair a resource-less placeholder primary type with the
  // actual resource object via second_object, e.g.
  // `create_object FISH_PLACEHOLDER { number_of_objects 1 second_object FISH }`.
  // FISH_PLACEHOLDER is deliberately absent from this constants set —
  // that's the whole point of the fixture.
  const WITH_PLACEHOLDER: GameConstantsForTotals = {
    constants: [
      { rmsConstant: "GOLD", category: "object", resourceAmounts: { gold: 800 } },
      { rmsConstant: "FISH", category: "object", resourceAmounts: { food: 200 } },
      { rmsConstant: "FISH_PLACEHOLDER", category: "object" }, // no resourceAmounts, by design
    ],
  };

  it("second_object's resources count even when the primary type has none", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\ncreate_object FISH_PLACEHOLDER { number_of_objects 3 second_object FISH }",
      WITH_PLACEHOLDER,
    );
    expect(t.total.min.food).toBe(200 * 3);
    expect(t.neutral.min.food).toBe(200 * 3);
  });

  it("second_object's resources SUM with the primary's when both resolve", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 2 second_object FISH }",
      WITH_PLACEHOLDER,
    );
    expect(t.total.min.gold).toBe(800 * 2);
    expect(t.total.min.food).toBe(200 * 2);
  });

  it("second_object naming an unresolved constant contributes nothing extra, primary still counts", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 2 second_object NOT_A_REAL_CONSTANT }",
      WITH_PLACEHOLDER,
    );
    expect(t.total.min.gold).toBe(800 * 2);
    expect(t.total.min.food).toBe(0);
  });

  it("block with neither primary nor second_object resolving still contributes 0, no throw", () => {
    const t = totalsFor("<OBJECTS_GENERATION>\ncreate_object FISH_PLACEHOLDER { number_of_objects 3 }", WITH_PLACEHOLDER);
    expect(t.total.min).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });

  it("second_object respects set_place_for_every_player the same as the primary", () => {
    const t = totalsFor(
      "<OBJECTS_GENERATION>\ncreate_object FISH_PLACEHOLDER { second_object FISH set_place_for_every_player }",
      WITH_PLACEHOLDER,
      4,
    );
    expect(t.player.min.food).toBe(200);
    expect(t.total.min.food).toBe(200 * 4);
    expect(t.neutral.min.food).toBe(0);
  });
});

describe("robustness on real corpus files (smoke — must not throw, all-zero-safe)", () => {
  it("parses this repo's own sample.rms without throwing", () => {
    const result = parseRms(
      "<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 }",
      lang,
    );
    expect(() => computeResourceTotals(result.script, result.tokens, GOLD_ONLY, 4)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Script-level storage overrides — effect_amount ... ATTR_STORAGE_VALUE
// ---------------------------------------------------------------------------
//
// The fixture mirrors the real reference data's shape rather than a convenient
// one: object rows carry constId + resourceStorages (with the resolved
// `resource`), the class row carries memberIds over the whole roster, and the
// attribute row carries writesStorageSlot. Nothing here names ATTR_STORAGE_VALUE
// in production code — the data says which attribute writes a storage slot.

const WITH_OVERRIDES: GameConstantsForTotals = {
  constants: [
    {
      rmsConstant: "GOLD",
      category: "object",
      constId: 66,
      resourceAmounts: { gold: 800 },
      resourceStorages: [{ type: 3, amount: 800, resource: "gold" }],
    },
    {
      rmsConstant: "OAK_TREE",
      category: "object",
      constId: 349,
      resourceAmounts: { wood: 100 },
      resourceStorages: [{ type: 1, amount: 100, resource: "wood" }],
    },
    {
      rmsConstant: "BIRCH_TREE",
      category: "object",
      constId: 350,
      resourceAmounts: { wood: 100 },
      resourceStorages: [{ type: 1, amount: 100, resource: "wood" }],
    },
    {
      // Slot 0 is population, so ATTR_STORAGE_VALUE moves nothing countable.
      rmsConstant: "HOUSE",
      category: "object",
      constId: 70,
      resourceStorages: [{ type: 4, amount: 5 }],
    },
    {
      // A DEAD HERO, and the shape that separates "slot 0 is not a resource"
      // from "this object has no resources at all". 15 real units look like
      // this (MONKX_S_D, EDWARD_D, ...): slot 0 is a decay timer and the gold
      // lives in a LATER slot. ATTR_STORAGE_VALUE writes slot 0, so it changes
      // how long the corpse lasts, not what it is worth.
      rmsConstant: "DEAD_HERO",
      category: "object",
      constId: 412,
      resourceAmounts: { gold: 33 },
      resourceStorages: [
        { type: 12, amount: 300 },
        { type: 3, amount: 33, resource: "gold" },
      ],
    },
    {
      // No classId here on purpose: the real row carries one and this module
      // never reads it, so the interface stays the minimal slice it claims.
      rmsConstant: "TREE_CLASS",
      category: "objectClass",
      constId: 915,
      memberIds: [349, 350],
    },
    { rmsConstant: "ATTR_STORAGE_VALUE", category: "attribute", constId: 21, writesStorageSlot: 0 },
  ],
};

const OBJECTS = "<OBJECTS_GENERATION>\n";

describe("effect_amount ATTR_STORAGE_VALUE overrides", () => {
  it("an unconditional override REPLACES the base value", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE 500\n" + OBJECTS + "create_object GOLD",
      WITH_OVERRIDES,
    );
    // Always runs, so 800 is no longer reachable and this is not a range.
    expect(t.total.min.gold).toBe(500);
    expect(t.total.max.gold).toBe(500);
  });

  it("zero is a real value, not an absent one — the idiom for switching a resource off", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE 0\n" + OBJECTS + "create_object GOLD",
      WITH_OVERRIDES,
    );
    expect(t.total.max.gold).toBe(0);
  });

  it("a CONDITIONAL override widens the range instead of replacing", () => {
    // 353 of the corpus's 374 uses sit inside a conditional, so this is the
    // common case rather than the exotic one. Both outcomes are possible, so
    // both ends are reported.
    const t = totalsFor(
      "<PLAYER_SETUP>\nif REGICIDE\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE 200\nendif\n" +
        OBJECTS +
        "create_object GOLD",
      WITH_OVERRIDES,
    );
    expect(t.total.min.gold).toBe(200);
    expect(t.total.max.gold).toBe(800);
  });

  it("targets a CLASS, hitting every member", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount GAIA_SET_ATTRIBUTE TREE_CLASS ATTR_STORAGE_VALUE 250\n" +
        OBJECTS +
        "create_object OAK_TREE\ncreate_object BIRCH_TREE",
      WITH_OVERRIDES,
    );
    expect(t.total.max.wood).toBe(500); // both trees, 250 each
  });

  it("resolves a target written as the script's own #const", () => {
    // The common shape: 216 of the corpus's 397 object names are script
    // constants, and the unit often has no DE name at all.
    const t = totalsFor(
      "#const MY_TREE 349\n<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE MY_TREE ATTR_STORAGE_VALUE 25\n" +
        OBJECTS +
        "create_object OAK_TREE",
      WITH_OVERRIDES,
    );
    expect(t.total.max.wood).toBe(25);
  });

  it("resolves a target written as a bare unit id", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE 349 ATTR_STORAGE_VALUE 30\n" + OBJECTS + "create_object OAK_TREE",
      WITH_OVERRIDES,
    );
    expect(t.total.max.wood).toBe(30);
  });

  it("resolves the ATTRIBUTE by id too, since the data carries its constId", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD 21 500\n" + OBJECTS + "create_object GOLD",
      WITH_OVERRIDES,
    );
    expect(t.total.max.gold).toBe(500);
  });

  it("ignores an attribute that does not write a storage slot", () => {
    // ATTR_HITPOINTS has 86 corpus uses and must not touch a resource total.
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_HITPOINTS 5\n" + OBJECTS + "create_object GOLD",
      WITH_OVERRIDES,
    );
    expect(t.total.min.gold).toBe(800);
    expect(t.total.max.gold).toBe(800);
  });

  it("changes nothing when slot 0 is not a resource at all", () => {
    // A house's slot 0 is population support. The same attribute, the same
    // syntax, and no effect on any total — which is why the slot carries a
    // resolved `resource` and the code checks it.
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE HOUSE ATTR_STORAGE_VALUE 999\n" + OBJECTS + "create_object HOUSE",
      WITH_OVERRIDES,
    );
    expect(t.total.max).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });

  it("does not repoint a LATER slot's resource when slot 0 is not one", () => {
    // The test above passes even with the `resource` check removed, because a
    // house has no resourceAmounts to move and an earlier guard catches it.
    // Found by mutation testing; this is the case that actually pins the check.
    // A dead hero carries a decay timer in slot 0 and gold in slot 1, so an
    // ATTR_STORAGE_VALUE line changes how long the corpse lasts. Its 33 gold
    // must not become 7.
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE DEAD_HERO ATTR_STORAGE_VALUE 7\n" +
        OBJECTS +
        "create_object DEAD_HERO",
      WITH_OVERRIDES,
    );
    expect(t.total.min.gold).toBe(33);
    expect(t.total.max.gold).toBe(33);
  });

  it("multiplies the overridden amount by the count, not the base", () => {
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE 100\n" +
        OBJECTS +
        "create_object GOLD { number_of_objects 7 }",
      WITH_OVERRIDES,
    );
    expect(t.total.max.gold).toBe(700);
  });

  it("an override reaches an object placed as a second_object", () => {
    // guide:2211's placeholder idiom: the carrier holds no resource and the
    // second object is the one that matters, so the override has to follow it.
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE 50\n" +
        OBJECTS +
        "create_object HOUSE { second_object GOLD }",
      WITH_OVERRIDES,
    );
    expect(t.total.max.gold).toBe(50);
  });

  it("leaves every total alone when the script writes no effect_amount", () => {
    const t = totalsFor(OBJECTS + "create_object GOLD", WITH_OVERRIDES);
    expect(t.total.min.gold).toBe(800);
    expect(t.total.max.gold).toBe(800);
  });

  it("ignores an amount it cannot statically evaluate rather than guessing", () => {
    // A guess here silently moves a number the user is reading off the status
    // bar, which is worse than reporting the base value.
    const t = totalsFor(
      "<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE GOLD ATTR_STORAGE_VALUE rnd(1,9)\n" + OBJECTS + "create_object GOLD",
      WITH_OVERRIDES,
    );
    expect(t.total.min.gold).toBe(800);
    expect(t.total.max.gold).toBe(800);
  });
});
