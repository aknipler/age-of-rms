// Gate 3 of docs/undefined-name-warning-brief.md.

import { describe, expect, it } from "vitest";
import { definitionNamesIn } from "../installedDefinitions";
import { loadLanguage } from "./testUtils";

const lang = loadLanguage();

describe("definitionNamesIn", () => {
  it("reads #const and #define, skips a commented one, keeps one inside an if", () => {
    const text = [
      "#const PLAIN_CONST 10",
      "#define PLAIN_DEFINE",
      "/* #const COMMENTED_OUT 5 */",
      "if SOME_FLAG",
      "  #const GUARDED_CONST 7",
      "endif",
      "",
    ].join("\n");
    const names = definitionNamesIn(text, lang);
    // The commented line is the control. A regex scan finds all four, so
    // this fails for the obvious wrong implementation.
    expect([...names].sort()).toEqual([
      "GUARDED_CONST",
      "PLAIN_CONST",
      "PLAIN_DEFINE",
    ]);
  });
});
