// Phase 2.5 — resource totals. Covers the two UX decisions locked with
// Ash before implementing (range display for if/random, flag-based
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

describe("Player vs Neutral split (flag-based, per Ash's v1 decision)", () => {
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

describe("random-block range display (per Ash's v1 decision: range, not expected value)", () => {
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

describe("second_object companion type (Ash's bug report — MENINDEE's fish weren't counted)", () => {
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
