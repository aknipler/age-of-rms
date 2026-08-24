// Unit gates for the script formatter (docs/formatter-design.md Sec.11).
//
// Every case here is written against the SOURCE TEXT the formatter produces,
// not against internal state: the tool's whole contract is "this text, these
// edits", and a test that asserts on a gap array would pass while the file it
// writes is wrong.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { tokenize } from "../../../../parser/lexer";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { formatScript, type FormatScriptOptions } from "../index";
import { detectIndentUnit, detectLineEnding } from "../options";

const lang = loadLanguage();

/** `detectIndentUnit` needs the token array to tell code from comment prose. */
function indentUnit(source: string): string {
  return detectIndentUnit(source, tokenize(source).tokens);
}

/** Format a source string; two-space indent unless a test says otherwise. */
function fmt(source: string, options: FormatScriptOptions = {}): string {
  const parse = parseRms(source, lang);
  const result = formatScript(parse, { indentStyle: "2 spaces", ...options });
  // Non-negotiable on every single case, not only in the corpus gate: if the
  // token stream changed, nothing else the test asserts is worth reading.
  expect(result.verifyProblem).toBeUndefined();
  expect(result.verified).toBe(true);
  return result.text;
}

function edits(source: string, options: FormatScriptOptions = {}) {
  const parse = parseRms(source, lang);
  return formatScript(parse, { indentStyle: "2 spaces", ...options });
}

describe("block layout — the two philosophies (Sec.3)", () => {
  const inline = `<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n`;
  const expanded = `<LAND_GENERATION>\ncreate_land\n{\nterrain_type GRASS\nland_percent 20\n}\n`;

  it("preserve keeps a one-line command on one line", () => {
    expect(fmt(inline)).toBe(inline);
  });

  it("preserve keeps an expanded command expanded, and indents it", () => {
    expect(fmt(expanded)).toBe("<LAND_GENERATION>\ncreate_land\n{\n  terrain_type GRASS\n  land_percent 20\n}\n");
  });

  it("preserve is the default, so the two shapes coexist in one file", () => {
    const mixed = `${inline}create_land\n{\nland_percent 5\n}\n`;
    expect(fmt(mixed)).toBe(
      "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\ncreate_land\n{\n  land_percent 5\n}\n",
    );
  });

  it("expanded imposes one attribute per line", () => {
    expect(fmt(inline, { blockLayout: "expanded" })).toBe(
      "<LAND_GENERATION>\ncreate_land\n{\n  terrain_type GRASS\n  land_percent 20\n}\n",
    );
  });

  it("inline puts the whole command on one line", () => {
    expect(fmt(expanded, { blockLayout: "inline" })).toBe("<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n");
  });

  it("compact inlines what fits and expands what does not", () => {
    const narrow = fmt(expanded, { blockLayout: "compact", inlineMaxWidth: 40 });
    expect(narrow).toContain("create_land\n{\n");
    const wide = fmt(expanded, { blockLayout: "compact", inlineMaxWidth: 200 });
    expect(wide).toContain("create_land { terrain_type GRASS land_percent 20 }");
  });
});

describe("when one line is refused (Sec.3.3)", () => {
  it("preserve keeps a one-line block that holds a conditional — 810 corpus blocks do", () => {
    const source = "<LAND_GENERATION>\ncreate_land { if TINY_MAP base_size 2 else base_size 3 endif }\n";
    expect(fmt(source)).toBe(source);
  });

  it("inline declines to CREATE one out of a block holding a conditional", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nif TINY_MAP\nbase_size 2\nendif\n}\n";
    expect(fmt(source, { blockLayout: "inline" })).toBe(
      "<LAND_GENERATION>\ncreate_land\n{\n  if TINY_MAP\n    base_size 2\n  endif\n}\n",
    );
  });

  it("a comment spanning lines inside the block forces expansion whatever the policy", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\n/* one\n   two */\nland_percent 5\n}\n";
    const out = fmt(source, { blockLayout: "inline" });
    expect(out).toContain("create_land\n{\n");
    expect(out).toContain("/* one\n     two */");
  });

  it("an unclosed block is never inlined and never gets a brace invented for it", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nland_percent 5\n";
    const out = fmt(source, { blockLayout: "inline" });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land\n{\n  land_percent 5\n");
  });
});

describe("per-command overrides (Sec.6.1)", () => {
  const inline = "<LAND_GENERATION>\ncreate_land { land_percent 20 }\ncreate_terrain GRASS { land_percent 5 }\n";

  it("alwaysExpand overrides the policy for the named command only", () => {
    expect(fmt(inline, { alwaysExpand: ["create_land"] })).toBe(
      "<LAND_GENERATION>\ncreate_land\n{\n  land_percent 20\n}\ncreate_terrain GRASS { land_percent 5 }\n",
    );
  });

  it("alwaysExpand beats alwaysInline, as options.ts documents", () => {
    const out = fmt(inline, { alwaysExpand: ["create_land"], alwaysInline: ["create_land"] });
    expect(out).toContain("create_land\n{\n");
  });

  it("matches the RESOLVED name, so a #const alias of create_land is caught", () => {
    // 24hr_Holler.rms does exactly this: `#const L 32` then `L { … }`.
    const source = "#const L 32\n<LAND_GENERATION>\nL { land_percent 20 }\n";
    expect(fmt(source, { alwaysExpand: ["create_land"] })).toBe(
      "#const L 32\n\n<LAND_GENERATION>\nL\n{\n  land_percent 20\n}\n",
    );
  });
});

describe("conditionals and start_random (Sec.5)", () => {
  it("indents if bodies by default — 47,063 of 55,327 corpus lines do", () => {
    const source = "<LAND_GENERATION>\nif TINY_MAP\nland_percent 5\nelse\nland_percent 9\nendif\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\nif TINY_MAP\n  land_percent 5\nelse\n  land_percent 9\nendif\n");
  });

  it("leaves them level with the keyword when asked", () => {
    const source = "<LAND_GENERATION>\nif TINY_MAP\n  land_percent 5\nendif\n";
    expect(fmt(source, { indentConditionals: false })).toBe("<LAND_GENERATION>\nif TINY_MAP\nland_percent 5\nendif\n");
  });

  it("puts percent_chance one level in and its body two", () => {
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 50\nland_percent 5\npercent_chance 50\nland_percent 9\nend_random\n";
    expect(fmt(source)).toBe(
      "<LAND_GENERATION>\nstart_random\n  percent_chance 50\n    land_percent 5\n  percent_chance 50\n    land_percent 9\nend_random\n",
    );
  });
});

describe("section bodies (Sec.5.0)", () => {
  it("keeps a section body that was indented", () => {
    const source = "<LAND_GENERATION>\n  land_percent 5\n  base_terrain GRASS\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\n  land_percent 5\n  base_terrain GRASS\n");
  });

  it("keeps a section body that was flush", () => {
    const source = "<LAND_GENERATION>\nland_percent 5\nbase_terrain GRASS\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\nland_percent 5\nbase_terrain GRASS\n");
  });

  it("classifies per section, so a mixed script keeps both halves", () => {
    const source = "<LAND_GENERATION>\n  land_percent 5\n<TERRAIN_GENERATION>\nbase_terrain GRASS\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\n  land_percent 5\n\n<TERRAIN_GENERATION>\nbase_terrain GRASS\n");
  });

  it("reads the minimum column, so a leading comment group does not fake it", () => {
    // The comment group indents `land_percent`; the section itself is flush,
    // and `base_terrain` at column 0 is what proves it.
    const source = "<LAND_GENERATION>\n/* lands */\n  land_percent 5\nbase_terrain GRASS\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\n/* lands */\n  land_percent 5\nbase_terrain GRASS\n");
  });

  it("imposes either convention when asked", () => {
    const flat = "<LAND_GENERATION>\nland_percent 5\n";
    const stepped = "<LAND_GENERATION>\n  land_percent 5\n";
    expect(fmt(stepped, { sectionIndent: "flat" })).toBe(flat);
    expect(fmt(flat, { sectionIndent: "indented" })).toBe(stepped);
  });
});

describe("comments (Sec.4)", () => {
  it("keeps a trailing comment on the line it trails", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nland_percent 5 /* half */\n}\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\ncreate_land\n{\n  land_percent 5 /* half */\n}\n");
  });

  it("indents an own-line comment with what follows it", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\n/* why */\nland_percent 5\n}\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\ncreate_land\n{\n  /* why */\n  land_percent 5\n}\n");
  });

  it("indents a comment written last inside a block with the block, not with the brace", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nland_percent 5\n/* trailing thought */\n}\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\ncreate_land\n{\n  land_percent 5\n  /* trailing thought */\n}\n");
  });

  it("shifts a multi-line comment as a block, keeping its internal alignment", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\n/* +-----+\n   | box |\n   +-----+ */\nland_percent 5\n}\n";
    const out = fmt(source);
    // Two spaces of block indent added to every line of the comment, and the
    // three edges still line up with each other.
    expect(out).toContain("  /* +-----+\n     | box |\n     +-----+ */\n");
  });

  it("collapses nothing inside a comment even when told to collapse spacing", () => {
    const source = "<LAND_GENERATION>\n/* a     b */\ncreate_land { land_percent 5 }\n";
    expect(fmt(source, { intraLineSpacing: "collapse" })).toContain("/* a     b */");
  });
});

describe("comment-headed groups (Sec.4.4)", () => {
  const grouped =
    "<LAND_GENERATION>\n/* corners */\n  create_land { land_percent 1 }\n  create_land { land_percent 2 }\ncreate_land { land_percent 3 }\n";

  it("keeps the extra level the author gave the group", () => {
    expect(fmt(grouped)).toBe(
      "<LAND_GENERATION>\n/* corners */\n  create_land { land_percent 1 }\n  create_land { land_percent 2 }\ncreate_land { land_percent 3 }\n",
    );
  });

  it("nests, which is what 24hr_Battle Lines does", () => {
    const source =
      "<LAND_GENERATION>\n/* corners */\n  /* left */\n    create_land { land_percent 1 }\n  /* right */\n    create_land { land_percent 2 }\n";
    expect(fmt(source)).toBe(source);
  });

  it("flattens the group when the rule is switched off", () => {
    expect(fmt(grouped, { commentGroups: false })).toBe(
      "<LAND_GENERATION>\n/* corners */\ncreate_land { land_percent 1 }\ncreate_land { land_percent 2 }\ncreate_land { land_percent 3 }\n",
    );
  });

  it("a comment level with what follows opens no group", () => {
    const source = "<LAND_GENERATION>\n/* corners */\ncreate_land { land_percent 1 }\n";
    expect(fmt(source)).toBe(source);
  });
});

describe("spacing, blank lines and file edges (Sec.5.1-5.3)", () => {
  it("preserves hand-aligned columns by default", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nterrain_type      GRASS\nland_percent      20\n}\n";
    expect(fmt(source)).toContain("  terrain_type      GRASS\n  land_percent      20\n");
  });

  it("collapses them when asked", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nterrain_type      GRASS\n}\n";
    expect(fmt(source, { intraLineSpacing: "collapse" })).toContain("  terrain_type GRASS\n");
  });

  it("caps runs of blank lines", () => {
    const source = "<LAND_GENERATION>\nland_percent 5\n\n\n\n\nland_percent 9\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\nland_percent 5\n\nland_percent 9\n");
    expect(fmt(source, { maxBlankLines: 0 })).toBe("<LAND_GENERATION>\nland_percent 5\nland_percent 9\n");
  });

  it("puts a blank line before a section header but not before the first thing in the file", () => {
    const source = "<LAND_GENERATION>\nland_percent 5\n<TERRAIN_GENERATION>\nland_percent 9\n";
    expect(fmt(source)).toBe("<LAND_GENERATION>\nland_percent 5\n\n<TERRAIN_GENERATION>\nland_percent 9\n");
  });

  it("strips trailing whitespace", () => {
    expect(fmt("<LAND_GENERATION>   \nland_percent 5\t\n")).toBe("<LAND_GENERATION>\nland_percent 5\n");
  });

  it("keeps CRLF, and keeps it everywhere it writes a break", () => {
    const out = fmt("<LAND_GENERATION>\r\ncreate_land\r\n{\r\nland_percent 5\r\n}\r\n");
    expect(out).toBe("<LAND_GENERATION>\r\ncreate_land\r\n{\r\n  land_percent 5\r\n}\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("preserves a missing final newline rather than adding one", () => {
    expect(fmt("<LAND_GENERATION>\nland_percent 5")).toBe("<LAND_GENERATION>\nland_percent 5");
  });

  it("keeps a leading byte-order mark", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(fmt(`${bom}<LAND_GENERATION>\nland_percent 5\n`).startsWith(bom)).toBe(true);
  });

  it("handles an empty script", () => {
    expect(fmt("")).toBe("");
    expect(edits("").edits).toHaveLength(0);
  });

  it("handles a comment-only script", () => {
    expect(fmt("/* nothing here */\n")).toBe("/* nothing here */\n");
  });
});

describe("unparseable regions", () => {
  it("reproduces a raw run verbatim rather than laying it out", () => {
    // A stray closing brace with no opener: the parser cannot read it, so the
    // formatter must not pretend it can either.
    const source = "<LAND_GENERATION>\n}   }\nland_percent 5\n";
    const out = fmt(source);
    expect(out).toContain("}   }");
  });

  it("leaves everything after an unclosed comment exactly as written", () => {
    const source = "<LAND_GENERATION>\n/* opened and never closed\n    still inside\n        deeper\n";
    expect(fmt(source)).toBe(source);
  });
});

describe("edits (Sec.7)", () => {
  it("proposes nothing for a script that already matches the settings", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\n  land_percent 5\n}\n";
    const result = edits(source);
    expect(result.edits).toEqual([]);
    expect(result.stats.changedLines).toBe(0);
  });

  it("returns ascending, non-overlapping edits", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nland_percent 5\nland_percent 9\n}\ncreate_land\n{\nland_percent 1\n}\n";
    const result = edits(source);
    expect(result.edits.length).toBeGreaterThan(0);
    for (let i = 1; i < result.edits.length; i++) {
      expect(result.edits[i].start).toBeGreaterThanOrEqual(result.edits[i - 1].end);
    }
  });

  it("applying the edits reproduces the formatted text exactly", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nland_percent 5\n}\n\n\n\nif TINY_MAP\nland_percent 9\nendif\n";
    const result = edits(source);
    let applied = source;
    for (const edit of [...result.edits].sort((a, b) => b.start - a.start)) {
      applied = applied.slice(0, edit.start) + edit.newText + applied.slice(edit.end);
    }
    expect(applied).toBe(result.text);
  });
});

describe("detection helpers (Sec.5.3)", () => {
  it("detects CRLF only when it dominates", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectLineEnding("a\nb\n")).toBe("\n");
    expect(detectLineEnding("")).toBe("\n");
  });

  it("takes the smallest space width that occurs often enough, not the most common", () => {
    // Level 2 outnumbers level 1 here; the unit is still 2. Two lines is the
    // floor at which a width stops being an outlier.
    const source = ["a", "  b", "  c", "    d", "    e", "    f", "    g"].join("\n");
    expect(indentUnit(source)).toBe("  ");
  });

  it("prefers a tab on a tie and when nothing is indented", () => {
    expect(indentUnit("a\n\tb\n  c\n")).toBe("\t");
    expect(indentUnit("a\nb\n")).toBe("\t");
  });

  it("reads code indentation, not the inside of a comment", () => {
    // The header comment is inset by three, the code by four. Counting raw
    // lines made this a 3-space script (test-maps/sample.rms, live).
    const source = [
      "/* a header",
      "   inset by three",
      "   for looks */",
      "<LAND_GENERATION>",
      "create_land",
      "{",
      "    land_percent 5",
      "}",
    ].join("\n");
    expect(indentUnit(source)).toBe("    ");
  });

  it("still reads a comment that opens its own line", () => {
    // Own-line comments are indented WITH the code they introduce, which is
    // the same evidence a command carries — and Sec.4.4 depends on it.
    const source = ["<LAND_GENERATION>", "create_land", "{", "  /* why */", "  land_percent 5", "}"].join("\n");
    expect(indentUnit(source)).toBe("  ");
  });
});
