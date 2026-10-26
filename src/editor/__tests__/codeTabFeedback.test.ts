// The Code tab feedback round of 2026-10-25. The comment test for the hover,
// the one-line constant hover, the Add Template spot, the did-you-mean fix
// and the move offer for an `if` condition. Each lives in a Monaco-free
// module so Vitest can load it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLanguageIndex } from "../../parser/language";
import {
  buildScriptNameIndex,
  buildStaticNameIndex,
  type LookupConstantRow,
} from "../../parser/nameLookup";
import { parseRms } from "../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { validate } from "../../parser/validate";
import { insideComment } from "../caretContext";
import { constantHoverLine, RELIC_RATE_LINE } from "../constantHover";
import { constOffersAt, suggestionOffersAt } from "../constOffers";
import { templateSpotAt } from "../templateTarget";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const gameConstants = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "game-constants.json"),
    "utf8",
  ),
) as { constants: (LookupConstantRow & { rmsConstant: string })[] };
const stat = buildStaticNameIndex(langData, gameConstants.constants);

describe("insideComment", () => {
  const text = "create_land { /* a note here */ terrain_type GRASS }";
  const inNote = text.indexOf("note") + 4;
  const inGrass = text.indexOf("GRASS") + 5;

  it("is true for a word in a comment and false for code", () => {
    expect(insideComment(text, inNote)).toBe(true);
    expect(insideComment(text, inGrass)).toBe(false);
  });

  it("reads a comment that spans lines", () => {
    const multi = "/* first line\nsecond word */\ncreate_land";
    expect(insideComment(multi, multi.indexOf("word") + 4)).toBe(true);
    expect(insideComment(multi, multi.length)).toBe(false);
  });

  it("agrees when it reuses a parse of the same text", () => {
    const parse = parseRms(text, langData);
    expect(insideComment(text, inNote, parse)).toBe(true);
    expect(insideComment(text, inGrass, parse)).toBe(false);
  });

  it("treats the end of a word just before the closing mark as inside", () => {
    const tight = "/* word */ GOLD";
    expect(insideComment(tight, tight.indexOf("word") + 4)).toBe(true);
    expect(insideComment(tight, tight.length)).toBe(false);
  });
});

describe("constantHoverLine", () => {
  const row = (name: string) => {
    const found = gameConstants.constants.find(
      (c) => c.rmsConstant === name && c.category === "object",
    );
    if (!found) throw new Error(`${name} not in game-constants.json`);
    return found as unknown as Parameters<typeof constantHoverLine>[0];
  };

  it("gives a resource object its default amount", () => {
    expect(constantHoverLine(row("GOLD"))).toBe("Default res: 800");
    expect(constantHoverLine(row("FORAGE"))).toBe("Default res: 125");
  });

  it("gives every relic the rate line", () => {
    expect(constantHoverLine(row("RELIC"))).toBe(RELIC_RATE_LINE);
    expect(constantHoverLine(row("BRITISH_RELIC"))).toBe(RELIC_RATE_LINE);
  });

  it("calls anything else a predefined constant", () => {
    expect(constantHoverLine(row("TOWN_CENTER"))).toBe("Predefined constant.");
    expect(constantHoverLine({ category: "terrain" })).toBe(
      "Predefined constant.",
    );
  });

  it("does not hide the amounts when a row holds more than one", () => {
    expect(
      constantHoverLine({
        category: "object",
        resourceAmounts: { food: 100, wood: 50 },
      }),
    ).toBe("Default res: 100 food, 50 wood");
  });
});

describe("templateSpotAt", () => {
  const SRC = [
    "<PLAYER_SETUP>",
    "random_placement",
    "<OBJECTS_GENERATION>",
    "create_object GOLD {",
    "  number_of_objects 4",
    "}",
    "",
    "create_object STONE",
    "<TERRAIN_GENERATION>",
    "<ELEVATION_GENERATION>",
  ].join("\n");
  const parse = parseRms(SRC, langData);
  const at = (needle: string, shift = 0) => SRC.indexOf(needle) + shift;

  it("is null outside the two sections that have templates", () => {
    expect(templateSpotAt(parse, at("random_placement"))).toBeNull();
    expect(templateSpotAt(parse, at("<ELEVATION_GENERATION>", 3))).toBeNull();
    expect(templateSpotAt(parse, 0)).toBeNull();
  });

  it("goes after the command the caret is inside, not into its braces", () => {
    const spot = templateSpotAt(parse, at("number_of_objects", 4));
    expect(spot?.section).toBe("OBJECTS_GENERATION");
    expect(spot?.target).toHaveProperty("after");
    const target = spot?.target as { after: { span: { start: number } } };
    expect(target.after.span.start).toBe(at("create_object GOLD"));
  });

  it("goes after the item above when the caret sits between items", () => {
    const target = templateSpotAt(parse, at("create_object STONE") - 1)
      ?.target as { after: { span: { start: number } } };
    expect(target.after.span.start).toBe(at("create_object GOLD"));
  });

  it("goes before the first item when the caret is above all of them", () => {
    const spot = templateSpotAt(parse, at("<OBJECTS_GENERATION>", 20));
    expect(spot?.target).toHaveProperty("before");
  });

  it("goes into an empty section itself", () => {
    const spot = templateSpotAt(parse, at("<TERRAIN_GENERATION>", 20));
    expect(spot?.section).toBe("TERRAIN_GENERATION");
    expect(spot?.target).toHaveProperty("in", "section");
  });

  it("keeps a caret inside an if branch in that branch", () => {
    const src = [
      "<OBJECTS_GENERATION>",
      "if TINY_MAP",
      "  create_object GOLD",
      "endif",
    ].join("\n");
    const p = parseRms(src, langData);
    const target = templateSpotAt(p, src.indexOf("GOLD") + 2)?.target as {
      after: { kind: string };
    };
    expect(target.after.kind).toBe("command");
  });
});

describe("suggestionOffersAt", () => {
  function diagnosticsOf(src: string) {
    const parse = parseRms(src, langData);
    return [
      ...parse.diagnostics,
      ...validate(parse, {
        language: lang,
        gameConstants,
      } as unknown as Parameters<typeof validate>[1]),
    ];
  }

  it("offers the did-you-mean for a misspelled attribute", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_object 3 }";
    const word = src.indexOf("number_of_object");
    const offers = suggestionOffersAt(src, word + 3, src, diagnosticsOf(src));
    expect(offers.map((o) => o.title)).toEqual(["Change to number_of_objects"]);
    const [{ start, end, newText }] = offers[0].edits;
    expect(src.slice(0, start) + newText + src.slice(end)).toContain(
      "number_of_objects 3",
    );
  });

  it("offers the did-you-mean for a misspelled command", () => {
    const src = "<LAND_GENERATION>\ncreate_lan { terrain_type GRASS }";
    const offers = suggestionOffersAt(
      src,
      src.indexOf("create_lan") + 10,
      src,
      diagnosticsOf(src),
    );
    expect(offers.map((o) => o.title)).toEqual(["Change to create_land"]);
  });

  it("offers nothing off the word, or against other text", () => {
    const src = "<LAND_GENERATION>\ncreate_lan { terrain_type GRASS }";
    const diagnostics = diagnosticsOf(src);
    expect(
      suggestionOffersAt(src, src.indexOf("GRASS"), src, diagnostics),
    ).toEqual([]);
    expect(
      suggestionOffersAt(
        src + " ",
        src.indexOf("create_lan"),
        src,
        diagnostics,
      ),
    ).toEqual([]);
  });
});

describe("move offer for an if condition", () => {
  const offersOn = (src: string, word: string) => {
    const parse = parseRms(src, langData);
    return constOffersAt(
      src,
      src.indexOf(word),
      parse,
      stat,
      buildScriptNameIndex(parse),
      lang,
    );
  };

  it("offers to move a #define that sits below the if", () => {
    const src = [
      "<LAND_GENERATION>",
      "if MY_FLAG",
      "  create_land { terrain_type GRASS }",
      "endif",
      "#define MY_FLAG",
    ].join("\n");
    expect(offersOn(src, "MY_FLAG").map((o) => o.title)).toEqual([
      "Move the #const up here",
    ]);
  });

  it("never offers to create a label in a condition", () => {
    const src = [
      "<LAND_GENERATION>",
      "if NOT_DEFINED_ANYWHERE",
      "  create_land { terrain_type GRASS }",
      "endif",
    ].join("\n");
    expect(offersOn(src, "NOT_DEFINED_ANYWHERE")).toEqual([]);
  });
});
