// The rms-check fixtures against the answers of docs/name-liveness-design.md
// Sec.8. The files are copied from rms-check by Divy1211 (GPL-3.0) with a
// credit header each. An expected answer here is the design's, so a mismatch
// means the model is wrong and never that the expectation should move.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../../reference/data/game-constants.json";
import { parseRms } from "../../parser";
import { includeKey } from "../../includeIndex";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  type GameConstantsForValidate,
} from "../../validate";
import { loadLanguage } from "../../__tests__/testUtils";
import type { ParseResult } from "../../types";
import { analyseLiveness, type LivenessResult } from "../analyse";

const lang = loadLanguage();
const constants = (gameConstantsRaw as unknown as GameConstantsForValidate)
  .constants;
const OPTIONS = {
  commentOpenAliases: commentOpenAliases(constants),
  commentCloseAliases: commentCloseAliases(constants),
  builtinConstants: builtinConstantNames(constants),
};
const FIXTURES = join(__dirname, "fixtures");

const read = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

/** Parses a fixture and runs the analysis with the include files given by name. */
function analyse(name: string, includes: Record<string, string> = {}) {
  const parse = parseRms(read(name), lang, OPTIONS);
  const parsed = new Map<string, ParseResult>();
  for (const [file, text] of Object.entries(includes))
    parsed.set(includeKey(file), parseRms(text, lang, OPTIONS));
  const result: LivenessResult = analyseLiveness({
    parse,
    language: lang,
    builtinConstants: OPTIONS.builtinConstants,
    includeParse: (key) => parsed.get(key),
    includesUnread: false,
  });
  /** The word after a branch's keyword, which is its condition for `if` and `elseif`. */
  const branchLabel = (b: LivenessResult["deadBranches"][number]): string =>
    `${parse.tokens[b.keywordToken].text} ${
      parse.tokens.slice(b.keywordToken + 1).find((t) => !t.isTrivia)?.text
    }`;
  return { parse, result, branchLabel };
}

describe("rms-check fixtures", () => {
  it("liveness_test.rms, name by name", () => {
    const { result, branchLabel } = analyse("liveness_test.rms", {
      "liveness_test.inc": read("liveness_test.inc"),
    });
    expect(result.status).toBe("complete");
    const at = (n: string) => result.namesAtEnd.get(n);
    // Two 50% arms both define A. The total is 100, which covers every roll.
    expect(at("A")).toBe("live");
    // Only one arm of the exhaustive block defines each of B and C.
    expect(at("B")).toBe("maybe");
    expect(at("C")).toBe("maybe");
    // Two 25% arms both define D. The total is 50, so neither is certain.
    expect(at("D")).toBe("maybe");
    // `if A #define E`, then `if E #define F`, certain through A.
    expect(at("E")).toBe("live");
    expect(at("F")).toBe("live");
    // `if H #const I`, then `if I #const H`. Each sits above the only
    // definition of the other, so both are never defined.
    expect(at("H")).toBe("dead");
    expect(at("I")).toBe("dead");
    // One player count only.
    expect(at("J")).toBe("maybe");
    // B and C come from the two exclusive arms of an exhaustive block.
    expect(at("K")).toBe("live");
    expect(at("L")).toBe("live");
    // Defined under all eight player counts, as a chain and as eight ifs.
    expect(at("M")).toBe("live");
    expect(at("N")).toBe("live");
    // Both `if H` and `if I` can never run.
    expect(result.deadBranches.map(branchLabel)).toEqual(["if H", "if I"]);
    expect(result.deadBranches.map((b) => b.kind)).toEqual([
      "contradiction",
      "contradiction",
    ]);
  });

  it("unified_random_else.rms reads PLAYER_COUNT as live", () => {
    const { result } = analyse("unified_random_else.rms");
    expect(result.uses.map((u) => [u.name, u.verdict])).toEqual([
      ["PLAYER_COUNT", "live"],
    ]);
    expect(result.deadBranches).toEqual([]);
  });

  it("unified_random_else2.rms reads WATER_MASK as live", () => {
    const { result } = analyse("unified_random_else2.rms");
    expect(result.uses.map((u) => [u.name, u.verdict])).toEqual([
      ["WATER_MASK", "live"],
    ]);
    expect(result.deadBranches).toEqual([]);
  });

  it("unified_multiple_def.rms: LENGTH live, only the last elseif is dead", () => {
    const { result, branchLabel } = analyse("unified_multiple_def.rms");
    expect(result.uses.map((u) => [u.name, u.verdict])).toEqual([
      ["LENGTH", "live"],
    ]);
    // The repeated MAPSIZE_INCREDIBLE belongs to RMS0313 and is not reported.
    expect(result.deadBranches.map(branchLabel)).toEqual([
      "elseif MAPSIZE_MINI",
    ]);
    expect(result.deadBranches[0].kind).toBe("contradiction");
  });

  it("test_check_dead_paths.rms: `if B` lives, the else is a switch case", () => {
    const { result, branchLabel } = analyse("test_check_dead_paths.rms");
    expect(result.deadBranches.map(branchLabel)).toEqual([
      "else create_terrain",
    ]);
    expect(result.deadBranches[0].kind).toBe("switch");
  });

  it("back_prop.rms has no value use and no dead branch", () => {
    const { result } = analyse("back_prop.rms");
    expect(result.uses).toEqual([]);
    expect(result.deadBranches).toEqual([]);
  });
});

describe("the node cap", () => {
  it("reports overflow, and nothing else, when the cap is tiny", () => {
    const parse = parseRms(read("liveness_test.rms"), lang, OPTIONS);
    const result = analyseLiveness(
      {
        parse,
        language: lang,
        builtinConstants: OPTIONS.builtinConstants,
        includesUnread: false,
      },
      { maxNodes: 10 },
    );
    expect(result.status).toBe("overflow");
    expect(result.uses).toEqual([]);
    expect(result.deadBranches).toEqual([]);
  });
});
