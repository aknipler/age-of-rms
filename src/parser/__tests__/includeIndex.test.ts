// The include index (src/parser/includeIndex.ts, docs/include-resolution-design.md
// Sec.4.2) on small made-up files, so CI checks the rules without an install.

import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { buildIncludeIndex, includeKey } from "../includeIndex";
import { loadLanguage } from "./testUtils";

const lang = loadLanguage();

/** Builds the index for `source` over `files` the way the worker does, parsing each file on demand. */
function indexOf(source: string, files?: Record<string, string>) {
  const parse = parseRms(source, lang);
  const map = files === undefined ? undefined : new Map(Object.entries(files));
  return {
    parse,
    index: buildIncludeIndex(parse, map, (_key, text) => parseRms(text, lang)),
  };
}

const tokenOf = (parse: ReturnType<typeof parseRms>, nth: number) =>
  parse.includes[nth].directiveToken;

describe("buildIncludeIndex", () => {
  it("lists the names a file defines, with the script's directive token", () => {
    const { parse, index } = indexOf("#include_drs a.inc\n", {
      "a.inc": "#const A 1\n#define B\n",
    });
    expect(index.installFound).toBe(true);
    expect([...index.names.keys()].sort()).toEqual(["A", "B"]);
    const a = index.names.get("A")![0];
    expect(a).toMatchObject({
      directiveKind: "const",
      directiveToken: tokenOf(parse, 0),
      file: "a.inc",
      conditional: false,
    });
    expect(index.names.get("B")![0].directiveKind).toBe("define");
  });

  it("reports the outer directive for a name in a nested include", () => {
    // Tokens before the outer directive, so its index differs from the
    // nested directive's index inside a.inc (which is 0). With both at 0 a
    // mutant that reports the inner directive would pass.
    const { parse, index } = indexOf("#const FIRST 1\n#include_drs a.inc\n", {
      "a.inc": "#include_drs b.inc\n#const A 1\n",
      "b.inc": "#const DEEP 2\n",
    });
    expect(tokenOf(parse, 0)).toBeGreaterThan(0);
    const deep = index.names.get("DEEP")![0];
    expect(deep.file).toBe("b.inc");
    expect(deep.directiveToken).toBe(tokenOf(parse, 0));
    expect(index.names.get("A")![0].directiveToken).toBe(tokenOf(parse, 0));
  });

  it("puts a file the install lacks into missing and adds no names", () => {
    const { index } = indexOf(
      "#include_drs gone.inc\n#include_drs Gone.INC\n#include_drs a.inc\n",
      { "a.inc": "#const A 1\n" },
    );
    expect(index.missing).toEqual(["gone.inc"]);
    expect([...index.names.keys()]).toEqual(["A"]);
  });

  it("finishes on a file that includes itself, and on two that include each other", () => {
    const self = indexOf("#include_drs a.inc\n", {
      "a.inc": "#include_drs a.inc\n#const A 1\n",
    });
    expect(self.index.names.get("A")).toHaveLength(1);

    const pair = indexOf("#include_drs a.inc\n", {
      "a.inc": "#include_drs b.inc\n#const A 1\n",
      "b.inc": "#include_drs a.inc\n#const B 2\n",
    });
    expect(pair.index.names.get("A")).toHaveLength(1);
    expect(pair.index.names.get("B")).toHaveLength(1);
  });

  it("marks a definition conditional by its own branch or by its directive's", () => {
    const inFile = indexOf("#include_drs a.inc\n", {
      "a.inc": "#const PLAIN 1\nif X\n#const BRANCHED 2\nendif\n",
    });
    expect(inFile.index.names.get("PLAIN")![0].conditional).toBe(false);
    expect(inFile.index.names.get("BRANCHED")![0].conditional).toBe(true);

    const viaDirective = indexOf(
      "start_random\npercent_chance 50 #include_drs a.inc\nend_random\n#include_drs b.inc\n",
      { "a.inc": "#const PLAIN 1\n", "b.inc": "#const SURE 1\n" },
    );
    expect(viaDirective.index.names.get("PLAIN")![0].conditional).toBe(true);
    expect(viaDirective.index.names.get("SURE")![0].conditional).toBe(false);
  });

  it("ignores #includeXS lines", () => {
    const { index } = indexOf("#includeXS x.xs\n", { "x.xs": "#const X 1\n" });
    expect(index.names.size).toBe(0);
    expect(index.missing).toEqual([]);
  });

  it("reads undefined files as no install found", () => {
    const { index } = indexOf("#include_drs a.inc\n");
    expect(index).toEqual({
      installFound: false,
      names: new Map(),
      missing: [],
      boundNames: new Set(),
    });
  });

  it("collects the group names an include binds (RMS0324 stays silent on them)", () => {
    const { index } = indexOf("#include_drs a.inc\n", {
      "a.inc":
        "<OBJECTS_GENERATION>\ncreate_object_group HERD {\n add_object COW\n}\n",
    });
    expect([...index.boundNames]).toEqual(["HERD"]);
    // A group is not a #const, so it does not appear among the names.
    expect(index.names.has("HERD")).toBe(false);
  });

  it("keeps a #const's value as written, joining a parenthesised one, and none for a #define", () => {
    const { index } = indexOf("#include_drs a.inc\n", {
      "a.inc": "#const A 5\n#const B (A * 2)\n#define C\n",
    });
    expect(index.names.get("A")![0].valueText).toBe("5");
    expect(index.names.get("B")![0].valueText).toBe("(A * 2)");
    expect(index.names.get("C")![0].valueText).toBeUndefined();
  });

  it("finds a file whatever the case of the path", () => {
    const { index } = indexOf("#include_drs Includes/A.INC\n", {
      [includeKey("includes/a.inc")]: "#const A 1\n",
    });
    expect(index.names.has("A")).toBe(true);
  });
});
