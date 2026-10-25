// docs/name-lookup-design.md Sec.13.3, line prediction. Each fixture marks
// the caret with `|`, and the text after the caret is dropped unless a test
// says otherwise, since the prediction only shows at the end of a line.

import { describe, expect, it } from "vitest";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import type { ParseResult } from "../../parser/types";
import { caretContext } from "../caretContext";
import {
  buildStatementIndex,
  continuation,
  predictLine,
} from "../linePrediction";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

/** The prediction at `|`, against a parse of `parsed` (default: the text itself). */
function predict(marked: string, parsed?: string): string | null {
  const caret = marked.indexOf("|");
  const text = marked.slice(0, caret) + marked.slice(caret + 1);
  const parse: ParseResult = parseRms(parsed ?? text, langData);
  const ctx = caretContext(text, caret, lang, parse);
  return predictLine(text, caret, ctx, buildStatementIndex(parse));
}

describe("predictLine", () => {
  it("shows the rest of the closest earlier line with the same first word", () => {
    expect(
      predict(
        [
          "<OBJECTS_GENERATION>",
          "create_object GOLD {",
          "  number_of_objects 7",
          "  min_distance_to_players 13",
          "}",
          "create_object STONE {",
          "  min_distance_to_players |",
        ].join("\n"),
      ),
    ).toBe("13");
  });

  it("takes the closest line above, not the first", () => {
    expect(
      predict(
        [
          "<LAND_GENERATION>",
          "create_land { land_position 10 10 }",
          "create_land { land_position 85 68 }",
          "create_land {",
          "  land_position |",
        ].join("\n"),
      ),
    ).toBe("85 68");
  });

  it("narrows to lines that start with the partial last word", () => {
    const script = [
      "<LAND_GENERATION>",
      "create_land { terrain_type DESERT }",
      "create_land { terrain_type GRASS }",
      "create_land {",
    ].join("\n");
    expect(predict(script + "\n  terrain_type DE|")).toBe("SERT");
    expect(predict(script + "\n  terrain_type GR|")).toBe("ASS");
    expect(predict(script + "\n  terrain_type FO|")).toBeNull();
  });

  it("matches typed whole words exactly and continues after them", () => {
    const script = [
      "<LAND_GENERATION>",
      "create_land { land_position 85 68 }",
      "create_land { land_position 50 50 }",
      "create_land {",
    ].join("\n");
    expect(predict(script + "\n  land_position 85 |")).toBe("68");
    expect(predict(script + "\n  land_position 8|")).toBe("5 68");
    // A typed word that only shares a prefix with the source's never matches,
    // since showing the rest would rewrite what was typed.
    expect(predict(script + "\n  land_position 851 |")).toBeNull();
  });

  it("never predicts an attribute from one with the same name in another command's block", () => {
    // The mutation test for the home key. terrain_type means the land's
    // terrain in create_land and the painted terrain in create_terrain.
    // Keying on the first word alone predicts FOREST here.
    expect(
      predict(
        [
          "<LAND_GENERATION>",
          "create_terrain FOREST { terrain_type FOREST }",
          "create_land {",
          "  terrain_type |",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("reads the block's own command when the command has arguments", () => {
    // caretContext once named this block GOLD, the token before the brace.
    expect(
      predict(
        [
          "<OBJECTS_GENERATION>",
          "create_object GOLD { number_of_objects 7 }",
          "create_object STONE {",
          "  number_of_objects |",
        ].join("\n"),
      ),
    ).toBe("7");
  });

  it("predicts a command's arguments from the same section", () => {
    expect(
      predict(
        [
          "<TERRAIN_GENERATION>",
          "create_terrain FOREST { }",
          "create_terrain |",
        ].join("\n"),
      ),
    ).toBe("FOREST");
  });

  it("does not predict a directive, a condition or a chance", () => {
    const above = [
      "#const A 1",
      "#define B",
      "if TINY_MAP",
      "#const C 2",
      "elseif SMALL_MAP",
      "#const C 3",
      "endif",
      "start_random",
      "percent_chance 50",
      "#define D",
      "end_random",
    ].join("\n");
    expect(predict(above + "\n#const |")).toBeNull();
    expect(predict(above + "\nif |")).toBeNull();
    expect(predict(above + "\nstart_random\npercent_chance |")).toBeNull();
  });

  it("does not show when text follows the caret on its line", () => {
    const marked = [
      "<LAND_GENERATION>",
      "create_land { base_size 9 }",
      "create_land {",
      "  base_size | 4",
    ].join("\n");
    const caret = marked.indexOf("|");
    const text = marked.slice(0, caret) + marked.slice(caret + 1);
    const parse = parseRms(text, langData);
    expect(
      predictLine(
        text,
        caret,
        caretContext(text, caret, lang, parse),
        buildStatementIndex(parse),
      ),
    ).toBeNull();
  });

  it("leaves out a trailing comment and a comment between arguments", () => {
    expect(
      predict(
        [
          "<LAND_GENERATION>",
          "create_land { land_position 85 /* x */ 68 /* the corner */ }",
          "create_land {",
          "  land_position |",
        ].join("\n"),
      ),
    ).toBe("85 68");
  });

  it("does not predict inside a comment", () => {
    expect(
      predict(
        [
          "<LAND_GENERATION>",
          "create_land { base_size 9 }",
          "/* create_land {",
          "  base_size |",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("never reads a statement below the caret or on its own line", () => {
    const marked = [
      "<LAND_GENERATION>",
      "create_land {",
      "  base_size |",
      "}",
      "create_land { base_size 9 }",
    ].join("\n");
    const caret = marked.indexOf("|");
    const text = marked.slice(0, caret) + marked.slice(caret + 1);
    const parse = parseRms(text, langData);
    expect(
      predictLine(
        text,
        caret,
        caretContext(text, caret, lang, parse),
        buildStatementIndex(parse),
      ),
    ).toBeNull();
    expect(
      predict("<LAND_GENERATION>\ncreate_land { base_size 9 base_size |"),
    ).toBeNull();
  });

  it("reads a stale parse only up to its first difference from the text", () => {
    const text = [
      "<LAND_GENERATION>",
      "create_land { base_size 9 }",
      "create_land {",
      "  base_size |",
    ].join("\n");
    // The worker has not yet seen the caret's line. Nothing changed above,
    // so the earlier line is still read.
    expect(predict(text, text.slice(0, text.indexOf("  base_size")))).toBe("9");
    // The worker's copy has a different first line. Every offset after it
    // is suspect, so nothing is read.
    expect(predict(text, "/* x */" + text.replace("|", ""))).toBeNull();
  });
});

describe("continuation", () => {
  it("returns null when the candidate adds nothing", () => {
    expect(continuation(["GRASS"], [], "GRASS")).toBeNull();
    expect(continuation(["GRASS"], ["GRASS"], "")).toBeNull();
  });

  it("starts with a space when the partial word is already whole", () => {
    expect(continuation(["85", "68"], [], "85")).toBe(" 68");
  });
});
