// tutorial-design.md Sec.13 item 1, the real coverage. Every helper is
// asserted against the actual Golden Hill fixture, parsed with the real
// parser, plus the negative cases the design calls out by name.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import {
  countCommand,
  hasCommand,
  hasCommandWhere,
  hasCommandWithAttribute,
  hasCommandWithAttributeWhere,
  hasObject,
  hasObjectWith,
  hasObjectWithAttributeWhere,
  isEmptyScript,
} from "../scriptChecks";

const lang = loadLanguage();
const goldenHillSource = readFileSync(join(__dirname, "fixtures", "goldenHill.rms"), "utf8");
const goldenHill = parseRms(goldenHillSource, lang);

describe("scriptChecks against the Golden Hill fixture", () => {
  it("parses with zero errors", () => {
    const errors = goldenHill.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("hasCommand finds every command the tutorial asks for", () => {
    expect(hasCommand(goldenHill, "PLAYER_SETUP", "random_placement")).toBe(true);
    expect(hasCommand(goldenHill, "ELEVATION_GENERATION", "create_elevation")).toBe(true);
    expect(hasCommand(goldenHill, "CLIFF_GENERATION", "min_number_of_cliffs")).toBe(true);
    expect(hasCommand(goldenHill, "CLIFF_GENERATION", "max_number_of_cliffs")).toBe(true);
    expect(hasCommand(goldenHill, "CONNECTION_GENERATION", "create_connect_to_nonplayer_land")).toBe(true);
  });

  it("hasCommand is false for a command in the wrong section", () => {
    expect(hasCommand(goldenHill, "OBJECTS_GENERATION", "random_placement")).toBe(false);
    expect(hasCommand(goldenHill, "PLAYER_SETUP", "create_elevation")).toBe(false);
  });

  it("hasCommand is case-insensitive on both command and section name", () => {
    expect(hasCommand(goldenHill, "player_setup", "RANDOM_PLACEMENT")).toBe(true);
    expect(hasCommand(goldenHill, "Elevation_Generation", "CREATE_ELEVATION")).toBe(true);
  });

  it("hasCommandWithAttribute finds attributes on the right command", () => {
    expect(hasCommandWithAttribute(goldenHill, "LAND_GENERATION", "create_player_lands", "circle_radius")).toBe(true);
    expect(hasCommandWithAttribute(goldenHill, "LAND_GENERATION", "create_land", "base_elevation")).toBe(true);
    expect(hasCommandWithAttribute(goldenHill, "LAND_GENERATION", "create_land", "land_id")).toBe(true);
    expect(hasCommandWithAttribute(goldenHill, "TERRAIN_GENERATION", "create_terrain", "base_terrain")).toBe(true);
  });

  it("hasCommandWithAttribute is false when the attribute belongs to a different command", () => {
    expect(hasCommandWithAttribute(goldenHill, "LAND_GENERATION", "create_player_lands", "land_id")).toBe(false);
  });

  it("hasCommandWithAttributeWhere reads the attribute's argument text", () => {
    expect(
      hasCommandWithAttributeWhere(goldenHill, "OBJECTS_GENERATION", "create_object", "number_of_objects", (args) =>
        args.includes("3"),
      ),
    ).toBe(true);
    expect(
      hasCommandWithAttributeWhere(goldenHill, "OBJECTS_GENERATION", "create_object", "number_of_objects", (args) =>
        args.includes("999"),
      ),
    ).toBe(false);
  });

  it("hasCommandWhere reads the COMMAND's own argument text, not a nested attribute's", () => {
    expect(hasCommandWhere(goldenHill, "CLIFF_GENERATION", "min_number_of_cliffs", (args) => args[0] === "3")).toBe(
      true,
    );
    expect(hasCommandWhere(goldenHill, "CLIFF_GENERATION", "min_number_of_cliffs", (args) => args[0] === "999")).toBe(
      false,
    );
  });

  it("hasObjectWithAttributeWhere reads the attribute's argument text on the matching placement", () => {
    expect(
      hasObjectWithAttributeWhere(goldenHill, "GOLD", "place_on_specific_land_id", (args) => args[0] === "10"),
    ).toBe(true);
    expect(
      hasObjectWithAttributeWhere(goldenHill, "GOLD", "place_on_specific_land_id", (args) => args[0] === "999"),
    ).toBe(false);
    // STONE never carries place_on_specific_land_id in this fixture, same fixture fact as hasObjectWith below.
    expect(
      hasObjectWithAttributeWhere(goldenHill, "STONE", "place_on_specific_land_id", () => true),
    ).toBe(false);
  });

  it("countCommand counts every match in the aggregated section", () => {
    // TOWN_CENTER, VILLAGER, SCOUT, GOLD x2, FORAGE_BUSH, STONE, OAKTREE.
    expect(countCommand(goldenHill, "OBJECTS_GENERATION", "create_object")).toBe(8);
    expect(countCommand(goldenHill, "OBJECTS_GENERATION", "create_land")).toBe(0);
  });

  it("hasObject and hasObjectWith find the gold on the hill", () => {
    expect(hasObject(goldenHill, "GOLD")).toBe(true);
    expect(hasObject(goldenHill, "gold")).toBe(true);
    expect(hasObjectWith(goldenHill, "GOLD", "place_on_specific_land_id")).toBe(true);
    expect(hasObjectWith(goldenHill, "GOLD", "set_tight_grouping")).toBe(true);
  });

  it("hasObjectWith requires both the object AND the attribute to match the same placement", () => {
    // STONE never carries place_on_specific_land_id in this fixture, only
    // the first GOLD block does.
    expect(hasObjectWith(goldenHill, "STONE", "place_on_specific_land_id")).toBe(false);
  });

  it("hasObject is false for an object never placed", () => {
    expect(hasObject(goldenHill, "RELIC")).toBe(false);
  });

  it("isEmptyScript is false for the finished map", () => {
    expect(isEmptyScript(goldenHill)).toBe(false);
  });
});

describe("scriptChecks negative cases", () => {
  it("every helper returns its empty value on a null parse", () => {
    expect(hasCommand(null, "PLAYER_SETUP", "random_placement")).toBe(false);
    expect(hasCommandWithAttribute(null, "LAND_GENERATION", "create_land", "land_id")).toBe(false);
    expect(hasCommandWithAttributeWhere(null, "LAND_GENERATION", "create_land", "land_id", () => true)).toBe(false);
    expect(hasCommandWhere(null, "CLIFF_GENERATION", "min_number_of_cliffs", () => true)).toBe(false);
    expect(countCommand(null, "OBJECTS_GENERATION", "create_object")).toBe(0);
    expect(hasObject(null, "GOLD")).toBe(false);
    expect(hasObjectWith(null, "GOLD", "set_tight_grouping")).toBe(false);
    expect(hasObjectWithAttributeWhere(null, "GOLD", "place_on_specific_land_id", () => true)).toBe(false);
    expect(isEmptyScript(null)).toBe(false);
  });

  it("isEmptyScript is true for a genuinely empty script and false once anything is written", () => {
    // RMS comments are exclusively /* */ (parser-design.md), comments are
    // lexer trivia either way, never an Item, so a comment-only script is
    // still empty.
    expect(isEmptyScript(parseRms("", lang))).toBe(true);
    expect(isEmptyScript(parseRms("/* just a comment, no sections */\n", lang))).toBe(true);
    expect(isEmptyScript(parseRms("<PLAYER_SETUP>\n", lang))).toBe(false);
  });

  it("a command wrapped in if still matches", () => {
    const wrapped = parseRms(
      `<PLAYER_SETUP>\nif SOME_FLAG\n  random_placement\nendif\n`,
      lang,
    );
    expect(hasCommand(wrapped, "PLAYER_SETUP", "random_placement")).toBe(true);
  });

  it("a command wrapped in start_random still matches", () => {
    const wrapped = parseRms(
      `<PLAYER_SETUP>\nstart_random\n  percent_chance 100\n    random_placement\nend_random\n`,
      lang,
    );
    expect(hasCommand(wrapped, "PLAYER_SETUP", "random_placement")).toBe(true);
  });

  // Command KEYWORDS are genuinely case-sensitive in this engine, an
  // all-caps command word is unrecognised and degrades to a RawNode
  // (RMS0200), so no amount of case-folding in scriptChecks can find it as a
  // command. What Sec.8's "the lexer does not fold case" note governs is
  // free-form text the parser never resolves against a keyword table, an
  // object constant argument, which a script can legally write in either
  // case.
  it("case variants of an object constant still match", () => {
    const lowercase = parseRms(
      `<OBJECTS_GENERATION>\ncreate_object gold {\n  place_on_specific_land_id 10\n}\n`,
      lang,
    );
    expect(hasObject(lowercase, "GOLD")).toBe(true);
    expect(hasObjectWith(lowercase, "GOLD", "place_on_specific_land_id")).toBe(true);
  });

  it("duplicate sections of the same name are aggregated, matching buildSectionTabs", () => {
    const duplicated = parseRms(
      `<OBJECTS_GENERATION>\ncreate_object SCOUT {\n}\n<OBJECTS_GENERATION>\ncreate_object GOLD {\n  place_on_specific_land_id 10\n}\n`,
      lang,
    );
    expect(countCommand(duplicated, "OBJECTS_GENERATION", "create_object")).toBe(2);
    expect(hasObjectWith(duplicated, "GOLD", "place_on_specific_land_id")).toBe(true);
  });
});
