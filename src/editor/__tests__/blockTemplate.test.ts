// docs/name-lookup-design.md Sec.13.4 and Sec.13.4.1, block templates and
// the skeleton from other maps. Each fixture marks the caret with `|` and
// ends there, since a template only shows at the end of a line.

import { describe, expect, it } from "vitest";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import {
  buildSkeletons,
  findSkeleton,
  type BlockSkeletonData,
} from "../blockSkeletons";
import { blockTemplate } from "../blockTemplate";
import { caretContext } from "../caretContext";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

function template(marked: string, skeletons: BlockSkeletonData | null = null) {
  const caret = marked.indexOf("|");
  const text = marked.slice(0, caret) + marked.slice(caret + 1);
  const parse = parseRms(text, langData);
  return blockTemplate(
    text,
    caret,
    caretContext(text, caret, lang, parse),
    lang,
    parse,
    skeletons,
  );
}

const GOLD = [
  "<OBJECTS_GENERATION>",
  "create_object GOLD {",
  "  number_of_objects 7",
  "  set_gaia_object_only",
  "  min_distance_to_players 13   /* far from TCs */",
  "  max_distance_to_players 15",
  "}",
].join("\n");

describe("blockTemplate from the script", () => {
  it("rebuilds the design's example with every value a tab stop and no comment", () => {
    expect(template(GOLD + "\ncreate_object GOLD|")).toEqual({
      source: "script",
      snippet: [
        " {",
        "\tnumber_of_objects ${1:7}",
        "\tset_gaia_object_only",
        "\tmin_distance_to_players ${2:13}",
        "\tmax_distance_to_players ${3:15}",
        "}$0",
      ].join("\n"),
    });
  });

  it("shows for a command with no arguments typed yet, and after a trailing space", () => {
    const above = "<LAND_GENERATION>\ncreate_land {\n  base_size 9\n}";
    expect(template(above + "\ncreate_land|")?.snippet).toBe(
      " {\n\tbase_size ${1:9}\n}$0",
    );
    expect(template(GOLD + "\ncreate_object GOLD |")?.source).toBe("script");
  });

  it("prefers the last block with the same arguments over a later one with only the same name", () => {
    const script = [
      GOLD,
      "create_object STONE {",
      "  number_of_objects 5",
      "}",
      "create_object GOLD|",
    ].join("\n");
    expect(template(script)?.snippet).toContain("${1:7}");
    expect(
      template(script.replace("create_object GOLD|", "create_object BOAR|"))
        ?.snippet,
    ).toBe(" {\n\tnumber_of_objects ${1:5}\n}$0");
  });

  it("keeps a one-line block on one line", () => {
    expect(
      template(
        "<LAND_GENERATION>\ncreate_land { terrain_type GRASS base_size 9 }\ncreate_land|",
      )?.snippet,
    ).toBe(" { terrain_type ${1:GRASS} base_size ${2:9} }$0");
  });

  it("puts the brace on the next line when the source did", () => {
    expect(
      template(
        "<LAND_GENERATION>\ncreate_land\n{\n  base_size 9\n}\ncreate_land|",
      )?.snippet,
    ).toBe("\n{\n\tbase_size ${1:9}\n}$0");
  });

  it("keeps branch keywords and conditions fixed and indents their items one more", () => {
    const script = [
      "<OBJECTS_GENERATION>",
      "create_object GOLD {",
      "  if TINY_MAP",
      "    number_of_objects 4",
      "  else",
      "    number_of_objects 7",
      "  endif",
      "  start_random",
      "    percent_chance 30",
      "      set_gaia_object_only",
      "  end_random",
      "}",
      "create_object GOLD|",
    ].join("\n");
    expect(template(script)?.snippet).toBe(
      [
        " {",
        "\tif TINY_MAP",
        "\t\tnumber_of_objects ${1:4}",
        "\telse",
        "\t\tnumber_of_objects ${2:7}",
        "\tendif",
        "\tstart_random",
        "\tpercent_chance ${3:30}",
        "\t\tset_gaia_object_only",
        "\tend_random",
        "}$0",
      ].join("\n"),
    );
  });

  it("escapes a $ word so it stays text", () => {
    expect(
      template(
        "<OBJECTS_GENERATION>\ncreate_object GOLD {\n  number_of_objects $GoldCount\n}\ncreate_object GOLD|",
      )?.snippet,
    ).toBe(" {\n\tnumber_of_objects ${1:\\$GoldCount}\n}$0");
  });

  it("does not show when a brace already follows on the next line that is not blank", () => {
    const text = GOLD + "\ncreate_object GOLD|\n\n  {\n}";
    const caret = text.indexOf("|");
    const clean = text.replace("|", "");
    const parse = parseRms(clean, langData);
    expect(
      blockTemplate(
        clean,
        caret,
        caretContext(clean, caret, lang, parse),
        lang,
        parse,
        null,
      ),
    ).toBeNull();
  });

  it("waits for a command's required arguments", () => {
    expect(template(GOLD + "\ncreate_object|")).toBeNull();
    expect(template(GOLD + "\ncreate_object |")).toBeNull();
  });

  it("does not show inside another block, after a standalone command, or with text after the caret", () => {
    expect(
      template(GOLD + "\ncreate_object STONE {\n  create_object GOLD|"),
    ).toBeNull();
    expect(
      template("<PLAYER_SETUP>\nrandom_placement\nrandom_placement|"),
    ).toBeNull();
    const text = GOLD + "\ncreate_object GOLD /* x */";
    const caret = (GOLD + "\ncreate_object GOLD").length;
    const parse = parseRms(text, langData);
    expect(
      blockTemplate(
        text,
        caret,
        caretContext(text, caret, lang, parse),
        lang,
        parse,
        null,
      ),
    ).toBeNull();
  });
});

// Four tiny maps. Every one has create_object GOLD with number_of_objects.
// Map 1 writes set_gaia_object_only in all of its many blocks, the others
// never, which is one map's vote of four.
const MAP1 = [
  "<OBJECTS_GENERATION>",
  ...Array.from(
    { length: 20 },
    () => "create_object GOLD { set_gaia_object_only number_of_objects 7 }",
  ),
  "create_object STONE { number_of_objects 5 }",
].join("\n");
const MAP2 =
  "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 group_placement_radius 2 }\ncreate_object STONE { number_of_objects 4 }";
const MAP3 =
  "<OBJECTS_GENERATION>\ncreate_object GOLD {\n  number_of_objects 5\n  if TINY_MAP\n    group_placement_radius 3\n  endif\n  group_placement_radius 2\n}";
const MAP4 =
  "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 6 group_placement_radius 2 }";
const SKELETONS = buildSkeletons(
  [MAP1, MAP2, MAP3, MAP4].map((m) => parseRms(m, langData)),
);

describe("buildSkeletons", () => {
  it("keeps what half the maps write, each map voting once", () => {
    const gold = SKELETONS.skeletons.find(
      (s) => s.key === "create_object GOLD",
    );
    expect(gold).toEqual({
      key: "create_object GOLD",
      maps: 4,
      attributes: [
        // Map 1's 20 blocks are still one vote, so its value 7 loses to 5.
        { name: "number_of_objects", values: ["5"] },
        { name: "group_placement_radius", values: ["2"] },
      ],
    });
  });

  it("needs three maps behind a key", () => {
    // create_object STONE is in two maps.
    expect(
      SKELETONS.skeletons.find((s) => s.key === "create_object STONE"),
    ).toBeUndefined();
    expect(
      SKELETONS.skeletons.find((s) => s.key === "create_object"),
    ).toBeDefined();
  });

  it("counts only a block's own attributes, never a branch's", () => {
    // MAP3's group_placement_radius 3 sits in an if, so it is no vote for 3.
    const gold = findSkeleton(SKELETONS, "create_object", ["GOLD"]);
    expect(gold?.attributes[1].values).toEqual(["2"]);
  });

  it("falls back from the command with its arguments to the command's name", () => {
    expect(findSkeleton(SKELETONS, "create_object", ["GOLD"])?.key).toBe(
      "create_object GOLD",
    );
    expect(findSkeleton(SKELETONS, "create_object", ["STONE"])?.key).toBe(
      "create_object",
    );
  });
});

describe("blockTemplate from a skeleton", () => {
  it("is used when the script has no block of that command", () => {
    expect(
      template("<OBJECTS_GENERATION>\ncreate_object GOLD|", SKELETONS),
    ).toEqual({
      source: "skeleton",
      snippet:
        " {\n\tnumber_of_objects ${1:5}\n\tgroup_placement_radius ${2:2}\n}$0",
    });
  });

  it("never wins over a script block of the same command name", () => {
    expect(
      template(
        "<OBJECTS_GENERATION>\ncreate_object STONE { number_of_objects 9 }\ncreate_object GOLD|",
        SKELETONS,
      ),
    ).toEqual({
      source: "script",
      snippet: " { number_of_objects ${1:9} }$0",
    });
  });

  it("puts the brace where most of the script's blocks above put it", () => {
    const below = [
      "<LAND_GENERATION>",
      "create_land",
      "{",
      "}",
      "create_land",
      "{",
      "}",
      "create_land {",
      "}",
      "<OBJECTS_GENERATION>",
      "create_object GOLD|",
    ].join("\n");
    expect(template(below, SKELETONS)?.snippet.startsWith("\n{")).toBe(true);
  });
});
