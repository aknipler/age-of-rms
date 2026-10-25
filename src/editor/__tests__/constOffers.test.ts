// docs/name-lookup-design.md slice B, the Code editor's #const quick fixes
// (Sec.7.2 and Sec.9.1). Each fixture's edits are applied to the text and
// the result read back, so a test fails on a wrong line, not only on a
// wrong title.

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
import { constOffersAt, holdingItem } from "../constOffers";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const stat = buildStaticNameIndex(
  langData,
  (
    JSON.parse(
      readFileSync(
        join(REPO_ROOT, "reference", "data", "game-constants.json"),
        "utf8",
      ),
    ) as { constants: LookupConstantRow[] }
  ).constants,
);

/** The offers at `offset`, against a parse of `parsed` (default: `text` itself). */
function offers(text: string, offset: number, parsed = text) {
  const parse = parseRms(parsed, langData);
  return constOffersAt(
    text,
    offset,
    parse,
    stat,
    buildScriptNameIndex(parse),
    lang,
  );
}

interface Applied {
  title: string;
  text: string;
  selected?: string;
}

/** The offers on `word` (its `nth` occurrence), each with its edits applied. */
function actionsOn(src: string, word: string, nth = 0): Applied[] {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = src.indexOf(word, at + 1);
  if (at < 0) throw new Error(`${word} not in fixture`);
  return offers(src, at).map(({ title, edits, select }) => {
    let text = src;
    for (const e of [...edits].sort((x, y) => y.start - x.start))
      text = text.slice(0, e.start) + e.newText + text.slice(e.end);
    return {
      title,
      text,
      selected: select
        ? text.slice(select.start, select.start + select.length)
        : undefined,
    };
  });
}

describe("constOffersAt", () => {
  const TYPO = ["<LAND_GENERATION>", "create_land { terrain_type FORREST }"];

  it("offers the typo fix, then a #const above the command and in the header", () => {
    const actions = actionsOn(TYPO.join("\n"), "FORREST");
    expect(actions.map((a) => a.title)).toEqual([
      "Change to FOREST",
      expect.stringMatching(/^Create #const FORREST 10 above this command/),
      expect.stringMatching(/^Create #const FORREST 10 in the header/),
    ]);
    expect(actions[0].text).toBe(
      "<LAND_GENERATION>\ncreate_land { terrain_type FOREST }",
    );
  });

  it("writes the #const on its own line above the command and selects the value", () => {
    const [, above] = actionsOn(TYPO.join("\n"), "FORREST");
    expect(above.text.split("\n")).toEqual([
      "<LAND_GENERATION>",
      "#const FORREST 10",
      "create_land { terrain_type FORREST }",
    ]);
    expect(above.selected).toBe("10");
  });

  it("writes the header #const before the first section", () => {
    const [, , header] = actionsOn(TYPO.join("\n"), "FORREST");
    expect(header.text.split("\n")[0]).toBe("#const FORREST 10");
    expect(header.text).toContain("<LAND_GENERATION>");
    expect(header.selected).toBe("10");
  });

  it("puts the #const inside the branch that holds the use", () => {
    const src = [
      "<LAND_GENERATION>",
      "if TINY_MAP",
      "  create_land { terrain_type FORREST }",
      "endif",
    ].join("\n");
    const above = actionsOn(src, "FORREST").find((a) =>
      a.title.includes("above this command"),
    );
    const lines = above!.text.split("\n");
    const at = lines.findIndex((l) => l.includes("#const FORREST"));
    expect(lines[at - 1]).toBe("if TINY_MAP");
    expect(lines[at + 1]).toContain("create_land");
  });

  it("offers only the move when the name is defined below", () => {
    const src = [
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
      "#const MY_FOREST 10",
    ].join("\n");
    const actions = actionsOn(src, "MY_FOREST");
    expect(actions.map((a) => a.title)).toEqual(["Move the #const up here"]);
    expect(actions[0].text.split("\n")).toEqual([
      "<LAND_GENERATION>",
      "#const MY_FOREST 10",
      "create_land { terrain_type MY_FOREST }",
      // The removed line's own newline goes with it, leaving the one before
      // it at the end of the file.
      "",
    ]);
  });

  it("offers nothing on a known name, a number, a defined name or a definition", () => {
    const src = [
      "#const MINE 5",
      "<LAND_GENERATION>",
      "create_land { terrain_type GRASS land_percent 20 }",
      "create_land { terrain_type MINE }",
    ].join("\n");
    expect(actionsOn(src, "GRASS")).toEqual([]);
    expect(actionsOn(src, "20")).toEqual([]);
    expect(actionsOn(src, "MINE", 1)).toEqual([]);
    expect(actionsOn(src, "MINE", 0)).toEqual([]);
  });

  it("offers nothing on a parse of other text", () => {
    const src = TYPO.join("\n");
    expect(offers(src, src.indexOf("FORREST"), src + "\n")).toEqual([]);
  });

  it("works with the caret at either edge of the word", () => {
    const src = TYPO.join("\n");
    const start = src.indexOf("FORREST");
    expect(offers(src, start)).toHaveLength(3);
    expect(offers(src, start + "FORREST".length)).toHaveLength(3);
  });
});

describe("holdingItem", () => {
  const src = [
    "#const A 1",
    "<LAND_GENERATION>",
    "create_land {",
    "  terrain_type A",
    "}",
    "if TINY_MAP",
    "  create_land { terrain_type A }",
    "endif",
    "start_random",
    "  percent_chance 50 create_land { terrain_type A }",
    "end_random",
  ].join("\n");
  const parse = parseRms(src, langData);
  const tokenOf = (nth: number) => {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = src.indexOf(" A", at + 1) + 1;
    return parse.tokens.findIndex((t) => t.start === at);
  };
  const textOf = (nth: number) => {
    const item = holdingItem(parse, tokenOf(nth))!;
    return src.slice(
      parse.tokens[item.firstToken].start,
      parse.tokens[item.lastToken].end,
    );
  };

  it("returns the command for a use in one of its attributes", () => {
    expect(textOf(1)).toMatch(/^create_land \{\n {2}terrain_type A\n\}$/);
  });

  it("returns the command inside an if branch, not the if", () => {
    expect(textOf(2)).toBe("create_land { terrain_type A }");
  });

  it("returns the command inside a start_random branch", () => {
    expect(textOf(3)).toBe("create_land { terrain_type A }");
  });

  it("returns the directive for a token in the header", () => {
    expect(textOf(0)).toBe("#const A 1");
  });
});
