// The diagnostics built from the liveness analysis (src/parser/liveness/report.ts),
// against the cases of docs/name-liveness-slice-b-brief.md item 3.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../../reference/data/game-constants.json";
import { parseRms } from "../../parser";
import { includeKey } from "../../includeIndex";
import { lineNumberOfOffset } from "../../lineIndex";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../../validate";
import { loadLanguage } from "../../__tests__/testUtils";
import type { Diagnostic, ParseResult } from "../../types";
import { livenessDiagnostics } from "../report";

const lang = loadLanguage();
const gameConstants = gameConstantsRaw as unknown as GameConstantsForValidate;
const OPTIONS = {
  commentOpenAliases: commentOpenAliases(gameConstants.constants),
  commentCloseAliases: commentCloseAliases(gameConstants.constants),
  builtinConstants: builtinConstantNames(gameConstants.constants),
};
const REF_DB: ValidateReferenceDb = { language: lang, gameConstants };
const FIXTURES = join(__dirname, "fixtures");

const readFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

/** Reports on source text. `includes` maps an include file's name to its text. */
function report(
  source: string,
  includes: Record<string, string> = {},
  existing?: Diagnostic[],
) {
  const parse = parseRms(source, lang, OPTIONS);
  const parsed = new Map<string, ParseResult>();
  for (const [file, text] of Object.entries(includes))
    parsed.set(includeKey(file), parseRms(text, lang, OPTIONS));
  const result = livenessDiagnostics({
    parse,
    language: lang,
    builtinConstants: OPTIONS.builtinConstants,
    includeParse: (key) => parsed.get(key),
    includesUnread: false,
    existing: existing ?? [],
  });
  const lineOf = (d: Diagnostic) =>
    lineNumberOfOffset(parse.lineOffsets, d.span.start);
  return { parse, ...result, lineOf };
}

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe("liveness diagnostics, uses", () => {
  it("marks a name defined in one arm only (design Sec.1's FOREST_SIZE)", () => {
    const source = [
      "<LAND_GENERATION>",
      "start_random",
      "  percent_chance 50 #const FOREST_SIZE 40",
      "end_random",
      "create_terrain FOREST { number_of_tiles FOREST_SIZE }",
      "",
    ].join("\n");
    // The start_random sits on line 2 and the #const on line 3.
    const { diagnostics, lineOf } = report(source);
    expect(codes(diagnostics)).toEqual(["RMS0321"]);
    const [d] = diagnostics;
    expect(d.message).toContain("FOREST_SIZE is only defined when");
    expect(d.message).toContain("arm 1 of the start_random on line 2");
    expect(lineOf(d)).toBe(5);
    expect(d.related).toHaveLength(1);
    expect(d.related![0].message).toBe("Defined on line 3");
    expect(
      lineNumberOfOffset(
        parseRms(source, lang, OPTIONS).lineOffsets,
        d.related![0].span.start,
      ),
    ).toBe(3);
  });

  it("marks a use that never sees its definition as RMS0320, naming the label", () => {
    const source = [
      "if TINY_MAP",
      "  #const A 1",
      "endif",
      "if HUGE_MAP",
      "  create_terrain FOREST { number_of_tiles A }",
      "endif",
      "",
    ].join("\n");
    const { diagnostics } = report(source);
    expect(codes(diagnostics)).toEqual(["RMS0320"]);
    expect(diagnostics[0].message).toBe(
      "A is only defined when TINY_MAP, and this line never runs then.",
    );
  });

  it("leaves a use above the name's only definition to RMS0303 (B4)", () => {
    const source = [
      "if TINY_MAP",
      "  create_terrain FOREST { number_of_tiles A }",
      "endif",
      "if HUGE_MAP",
      "  #const A 1",
      "endif",
      "",
    ].join("\n");
    expect(report(source).diagnostics).toEqual([]);
  });

  it("leaves a token that already carries RMS0202 or RMS0303 alone", () => {
    const source = [
      "if TINY_MAP",
      "  #const A 1",
      "endif",
      "if HUGE_MAP",
      "  create_terrain FOREST { number_of_tiles A }",
      "endif",
      "",
    ].join("\n");
    const first = report(source);
    expect(codes(first.diagnostics)).toEqual(["RMS0320"]);
    const shadow: Diagnostic = {
      severity: "info",
      code: "RMS0303",
      message: "constructed",
      span: first.diagnostics[0].span,
    };
    expect(report(source, {}, [shadow]).diagnostics).toEqual([]);
    // A different code on the same token does not shadow it.
    const other = { ...shadow, code: "RMS0201" };
    expect(codes(report(source, {}, [other]).diagnostics)).toEqual(["RMS0320"]);
  });

  it("names the include file for a use defined only there, with no related entry", () => {
    const source = [
      '#include_drs "defs.inc"',
      "if HUGE_MAP",
      "  create_terrain FOREST { number_of_tiles A }",
      "endif",
      "",
    ].join("\n");
    const { diagnostics } = report(source, {
      "defs.inc": "if TINY_MAP\n  #const A 1\nendif\n",
    });
    expect(codes(diagnostics)).toEqual(["RMS0320"]);
    expect(diagnostics[0].message).toContain("It is also defined in defs.inc.");
    expect(diagnostics[0].related).toBeUndefined();
  });
});

describe("liveness diagnostics, branches (design Sec.8 fixtures)", () => {
  it("liveness_test.rms: H and I are each never defined here", () => {
    const { diagnostics } = report(readFixture("liveness_test.rms"), {
      "liveness_test.inc": readFixture("liveness_test.inc"),
    });
    const dead = diagnostics.filter((d) => d.code === "RMS0322");
    expect(dead.map((d) => d.message)).toEqual([
      "This branch never runs, because H is never defined here.",
      "This branch never runs, because I is never defined here.",
    ]);
  });

  it("unified_multiple_def.rms: the last elseif is covered by the ones above it", () => {
    const { diagnostics, parse } = report(
      readFixture("unified_multiple_def.rms"),
    );
    const dead = diagnostics.filter((d) => d.code === "RMS0322");
    expect(dead).toHaveLength(1);
    expect(dead[0].message).toBe(
      "This branch never runs, because the branches above it in this chain already cover every case.",
    );
    // The mark covers `elseif MAPSIZE_MINI`, and the repeated
    // MAPSIZE_INCREDIBLE (RMS0313's) gets nothing.
    expect(parse.source.slice(dead[0].span.start, dead[0].span.end)).toMatch(
      /^elseif\s+MAPSIZE_MINI$/,
    );
  });

  it("test_check_dead_paths.rms: the else is a switch case naming A and its line", () => {
    const { diagnostics, parse } = report(
      readFixture("test_check_dead_paths.rms"),
    );
    const sw = diagnostics.filter((d) => d.code === "RMS0323");
    expect(sw).toHaveLength(1);
    const line = lineNumberOfOffset(
      parse.lineOffsets,
      sw[0].related![0].span.start,
    );
    expect(sw[0].message).toBe(
      `This branch never runs, because A is always defined above (line ${line}).`,
    );
    expect(sw[0].related![0].message).toBe(`Defined on line ${line}`);
    expect(parse.source.slice(sw[0].span.start, sw[0].span.end)).toBe("else");
  });

  it("names a branch that needs one size inside another", () => {
    const source = [
      "if TINY_MAP",
      "  if HUGE_MAP",
      "    #const A 1",
      "  endif",
      "endif",
      "",
    ].join("\n");
    const { diagnostics } = report(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      "This branch never runs, because it needs HUGE_MAP inside a branch that needs TINY_MAP.",
    ]);
  });

  it("back_prop.rms reports nothing", () => {
    expect(report(readFixture("back_prop.rms")).diagnostics).toEqual([]);
  });
});

describe("liveness diagnostics, status", () => {
  it("returns no diagnostics and the status on overflow", () => {
    const source = readFixture("liveness_test.rms");
    const parse = parseRms(source, lang, OPTIONS);
    const result = livenessDiagnostics(
      {
        parse,
        language: lang,
        builtinConstants: OPTIONS.builtinConstants,
        includesUnread: false,
        existing: [],
      },
      { maxNodes: 10 },
    );
    expect(result).toEqual({ status: "overflow", diagnostics: [] });
  });

  it("returns no diagnostics when an include was not read", () => {
    const parse = parseRms("if TINY_MAP\n#const A 1\nendif\n", lang, OPTIONS);
    const result = livenessDiagnostics({
      parse,
      language: lang,
      builtinConstants: OPTIONS.builtinConstants,
      includesUnread: true,
      existing: [],
    });
    expect(result).toEqual({ status: "incomplete", diagnostics: [] });
  });
});

describe("liveness diagnostics, wording", () => {
  it("holds no em dash, colon or semicolon in any message (CLAUDE.md language rule)", () => {
    const all: Diagnostic[] = [];
    const cases: [string, Record<string, string>?][] = [
      [
        readFixture("liveness_test.rms"),
        { "liveness_test.inc": readFixture("liveness_test.inc") },
      ],
      [readFixture("unified_multiple_def.rms")],
      [readFixture("test_check_dead_paths.rms")],
      [
        "if TINY_MAP\n #const A 1\nendif\nif HUGE_MAP\n create_terrain FOREST { number_of_tiles A }\n if TINY_MAP\n endif\nendif\n",
      ],
      [
        "start_random\n percent_chance 50 #const F 40\nend_random\ncreate_terrain FOREST { number_of_tiles F }\n",
      ],
    ];
    for (const [source, includes] of cases)
      all.push(...report(source, includes).diagnostics);
    expect(all.length).toBeGreaterThan(5);
    for (const d of all) {
      expect(d.message).not.toMatch(/[—:;]/);
      for (const r of d.related ?? []) expect(r.message).not.toMatch(/[—:;]/);
    }
  });

  it("validate's own output is unchanged by the liveness pass (they stay separate lists)", () => {
    const parse = parseRms("if TINY_MAP\n#const A 1\nendif\n", lang, OPTIONS);
    expect(validate(parse, REF_DB).some((d) => d.code === "RMS0320")).toBe(
      false,
    );
  });
});
