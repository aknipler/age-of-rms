// Pins the token id data in language.json (docs/token-alias-design.md Sec.4)
// to the two numbers the code keeps as constants, and checks the import left
// the entries it should have left alone.

import { describe, expect, it } from "vitest";

import { COMMENT_CLOSE_ID, COMMENT_OPEN_ID } from "../validate";
import { loadLanguage } from "./testUtils";

const lang = loadLanguage();
const structural = new Map(
  (lang.structuralTokens ?? []).map((t) => [t.text, t]),
);

describe("token ids in language.json", () => {
  it("gives the comment markers the ids the code keeps as constants", () => {
    // The constants exist because constReview.ts and constOffers.ts cannot reach
    // the language data. This is what stops the two copies drifting apart.
    expect(structural.get("/*")?.tokenId).toBe(COMMENT_OPEN_ID);
    expect(structural.get("*/")?.tokenId).toBe(COMMENT_CLOSE_ID);
  });

  it("reads back the three numbers the design's gate names", () => {
    expect(lang.commands.find((c) => c.name === "create_land")?.tokenId).toBe(
      32,
    );
    expect(structural.get("/*")?.tokenId).toBe(69);
    expect(structural.get("*/")?.tokenId).toBe(70);
  });

  it("keeps create_land's measured source, which the sheet import must not replace", () => {
    const land = lang.commands.find((c) => c.name === "create_land");
    expect(land?.tokenIdSource).toBe("RMSTEST_62");
  });

  it("has a header row for every section", () => {
    const missing = lang.sections.filter(
      (name) => !structural.has(`<${name}>`),
    );
    expect(missing).toEqual([]);
  });

  it("holds the braces and both comment markers", () => {
    expect([...structural.keys()]).toEqual(
      expect.arrayContaining(["{", "}", "/*", "*/"]),
    );
    expect(structural.size).toBe(11);
  });

  it("leaves exactly the seven names the sheet lacks without an id", () => {
    // An absent tokenId means unknown (Sec.4), so these seven stay empty until
    // a run measures them, and nothing else should be empty. A new vocabulary
    // entry lands here and has to be answered for on purpose.
    const without: string[] = [];
    for (const kind of [
      "commands",
      "attributes",
      "directives",
      "controlKeywords",
    ] as const) {
      for (const entry of lang[kind]) {
        if (typeof entry.tokenId !== "number") without.push(entry.name);
      }
    }
    expect(without.sort()).toEqual(
      [
        "building_architecture",
        "create_connect_teams_lands",
        "match_player_civ",
        "other_zone_avoidance_distance",
        "temp_min_distance_to_players",
        "terrain_state",
        "weather_type",
      ].sort(),
    );
  });

  it("gives a word that is both a command and an attribute one id", () => {
    // base_terrain and base_layer are each a standalone command and a block
    // attribute. The engine reads one word, so the two entries cannot differ.
    for (const name of ["base_terrain", "base_layer"]) {
      const ids = [
        ...lang.commands.filter((c) => c.name === name),
        ...lang.attributes.filter((a) => a.name === name),
      ].map((e) => e.tokenId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(1);
      expect(typeof ids[0]).toBe("number");
    }
  });
});
