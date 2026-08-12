import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokenize } from "../lexer";
import type { Token, TokenKind } from "../types";

// Built from numeric code points rather than embedded as literal
// invisible characters in this file — see the same reasoning in
// lexer.ts. Keeping fixture construction consistent with the
// implementation makes it obvious these tests aren't accidentally
// testing the wrong character.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0x00a0);

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_MAPS_DIR = resolve(__dirname, "../../../test-maps");
const BROKEN_DIR = resolve(TEST_MAPS_DIR, "broken");

function readCorpusFile(name: string): string {
  return readFileSync(resolve(TEST_MAPS_DIR, name), "utf-8");
}

function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);
}

/**
 * The N biggest maps present, largest first. DERIVED, never named: most of
 * test-maps/ is gitignored, so a hardcoded filename is a test that passes on a
 * maintainer's machine and ENOENTs on a fresh clone — which is exactly how
 * `Pa_Site_v1.1.rms` in this file broke CI on 2026-08-10. Sorting by size
 * picks up the most tokens per file it reads; the name tiebreak keeps the
 * selection deterministic when two maps are the same size.
 */
function largestCorpusFiles(n: number): string[] {
  return listRms(TEST_MAPS_DIR)
    .map((name) => ({ name, size: statSync(resolve(TEST_MAPS_DIR, name)).size }))
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((e) => e.name);
}

function kindsOf(tokens: Token[]): TokenKind[] {
  return tokens.map((t) => t.kind);
}

function codesOf(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

describe("tokenize — token kinds", () => {
  it("classifies word tokens (the default/catch-all)", () => {
    const { tokens } = tokenize("create_land land_percent inf -inf");
    expect(kindsOf(tokens)).toEqual(["word", "word", "word", "word"]);
  });

  it("classifies integer and float numbers", () => {
    const { tokens } = tokenize("50 -5 3.14 -2.5");
    expect(kindsOf(tokens)).toEqual(["number", "number", "number", "number"]);
  });

  it("does NOT classify a leading-dot float or comma/percent-suffixed numbers as number", () => {
    // Per docs/parser-design.md Sec.2 the pinned regex is /^-?\d+(\.\d+)?$/ —
    // no leading-digit requirement relaxed, no comma/percent handling
    // (that's the engine's truncation behavior, a parser/validate()
    // concern per RMS0212, not a lexer one).
    const { tokens } = tokenize(".5 1,5 50%");
    expect(kindsOf(tokens)).toEqual(["word", "word", "word"]);
  });

  it("classifies rnd(...) tokens, including negative bounds", () => {
    const { tokens } = tokenize("rnd(1,5) rnd(-10,-1) rnd(-3,7)");
    expect(kindsOf(tokens)).toEqual(["rnd", "rnd", "rnd"]);
  });

  it("does not classify a space-split rnd() as rnd — it stays two word tokens", () => {
    // "rnd(1, 5)" is two whitespace-separated tokens, not one — the
    // canonical form has no interior space (spec Sec.2.2, RMS0214 note).
    const { tokens } = tokenize("rnd(1, 5)");
    expect(tokens.map((t) => t.text)).toEqual(["rnd(1,", "5)"]);
    expect(kindsOf(tokens)).toEqual(["word", "word"]);
  });

  it("classifies exact brace and comment-marker tokens", () => {
    const { tokens } = tokenize("{ } /* */");
    expect(kindsOf(tokens)).toEqual(["openBrace", "closeBrace", "commentOpen", "commentClose"]);
  });

  it("classifies section headers, including ones with digits", () => {
    const { tokens } = tokenize("<PLAYER_SETUP> <LAND_GENERATION> <FOO2>");
    expect(kindsOf(tokens)).toEqual(["sectionHeader", "sectionHeader", "sectionHeader"]);
  });

  it("classifies any #-prefixed token as a directive, known or not", () => {
    // A "#" token is not automatically a *real* directive — that
    // judgment is the parser's (RMS0206). The lexer only classifies by
    // shape.
    const { tokens } = tokenize("#define #const #this_is_not_real");
    expect(kindsOf(tokens)).toEqual(["directive", "directive", "directive"]);
  });
});

describe("tokenize — offsets", () => {
  it("start/end are exact for a simple multi-line snippet", () => {
    const source = "create_land {\n  land_percent 50\n}";
    const { tokens } = tokenize(source);
    for (const token of tokens) {
      expect(source.slice(token.start, token.end)).toBe(token.text);
    }
  });

  it("offsets are exact across a real-world corpus sample (property check)", () => {
    // A cross-section of the real community corpus in test-maps/,
    // including the named perf benchmark and a file with known real
    // defects (BCC2's glued "}8050") — offset exactness must hold
    // regardless of whether the *content* is well-formed. Per
    // docs/parser-design.md Sec.12, this is a non-negotiable CI gate.
    //
    // Collected into a list and asserted ONCE, the way testUtils.checkProperties
    // does, rather than per token. That is a harness decision, not a weaker
    // check — the comparison is identical and every failure still names its
    // file and token. But these files carry tens of thousands of tokens, and an
    // `expect()` per token costs ~7.6s of assertion-object construction against
    // ~0.07s of actual comparison, which pushed a gate that tests a 0.4s
    // workload past the 5s default timeout on a loaded machine. A
    // non-negotiable gate that fails on machine speed stops being a gate.
    //
    // Everything in test-maps/broken/ is always included on top of the four
    // biggest: offset exactness must hold on malformed content too, which is
    // precisely what a known-defective file is for (BCC2's glued "}8050" fires
    // RMS0101 by design).
    const files = [...largestCorpusFiles(4), ...listRms(BROKEN_DIR).map((n) => `broken/${n}`)];
    expect(files.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const file of files) {
      const source = readCorpusFile(file);
      const { tokens } = tokenize(source);
      for (const token of tokens) {
        const slice = source.slice(token.start, token.end);
        if (slice !== token.text) {
          mismatches.push(`${file}: token ${JSON.stringify(token.text)} at ${token.start} slices to ${JSON.stringify(slice)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("tokenize — RMS0003 (glued markers)", () => {
  it("flags a trailing-glued brace", () => {
    const { diagnostics } = tokenize("create_land{");
    expect(codesOf(diagnostics)).toContain("RMS0003");
    expect(diagnostics[0].message).toMatch(/create_land \{/);
  });

  it("flags a leading-glued brace (corpus-real }8050)", () => {
    const { diagnostics } = tokenize("}8050");
    expect(codesOf(diagnostics)).toContain("RMS0003");
    expect(diagnostics[0].message).toMatch(/\} 8050/);
  });

  it("does not flag the exact marker tokens themselves", () => {
    const { diagnostics } = tokenize("{ } /* */");
    expect(diagnostics).toHaveLength(0);
  });
});

describe("tokenize — RMS0004 (non-standard space)", () => {
  it("flags a token containing an embedded NBSP", () => {
    // NBSP is not in the whitespace set, so "abc<NBSP>def" is ONE token
    // (not split), and it should carry the char lint.
    const { tokens, diagnostics } = tokenize(`abc${NBSP}def`);
    expect(tokens).toHaveLength(1);
    expect(codesOf(diagnostics)).toContain("RMS0004");
  });
});

describe("tokenize — leading BOM (RMS0005)", () => {
  it("emits the BOM as its own trivia token and does not merge it into the next token", () => {
    const source = `${BOM}<PLAYER_SETUP>`;
    const { tokens, diagnostics } = tokenize(source);
    expect(tokens[0]).toMatchObject({ text: BOM, start: 0, end: 1, isTrivia: true });
    expect(tokens[1]).toMatchObject({ text: "<PLAYER_SETUP>", start: 1, kind: "sectionHeader", isTrivia: false });
    expect(codesOf(diagnostics)).toContain("RMS0005");
  });

  it("does nothing special for a non-leading FEFF (flagged as RMS0004 instead)", () => {
    const { tokens, diagnostics } = tokenize(`abc${BOM}def`);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].isTrivia).toBe(false);
    expect(codesOf(diagnostics)).toContain("RMS0004");
    expect(codesOf(diagnostics)).not.toContain("RMS0005");
  });
});

describe("tokenize — comments", () => {
  it("marks a simple closed comment span as trivia, including the markers", () => {
    const { tokens, diagnostics } = tokenize("/* hello world */ create_land");
    const [open, hello, world, close, create] = tokens;
    expect([open.isTrivia, hello.isTrivia, world.isTrivia, close.isTrivia]).toEqual([true, true, true, true]);
    expect(create.isTrivia).toBe(false);
    expect(diagnostics).toHaveLength(0);
  });

  it("nests by default (depth 2, properly closed)", () => {
    const { tokens, diagnostics } = tokenize("/* outer /* inner */ still-outer */ create_land");
    // Everything up to and including the second */ is trivia; only the
    // trailing create_land is real code.
    const create = tokens[tokens.length - 1];
    expect(create.text).toBe("create_land");
    expect(create.isTrivia).toBe(false);
    for (const token of tokens.slice(0, -1)) {
      expect(token.isTrivia, token.text).toBe(true);
    }
    expect(diagnostics).toHaveLength(0);
  });

  it("reports RMS0001 for an unclosed comment, nested two deep", () => {
    const { diagnostics } = tokenize("/* outer /* inner still open");
    expect(codesOf(diagnostics)).toEqual(["RMS0001"]);
  });

  it("treats a whole unclosed-comment file as trivia through EOF", () => {
    const { tokens } = tokenize("/* unclosed forever and ever");
    expect(tokens.every((t) => t.isTrivia)).toBe(true);
  });

  it("reports RMS0002 for a stray closer with no matching opener", () => {
    const { diagnostics } = tokenize("create_land */ more_code");
    expect(codesOf(diagnostics)).toEqual(["RMS0002"]);
  });

  it("closes at the first */ when nestedComments: false", () => {
    const { tokens, diagnostics } = tokenize("/* outer /* inner */ still-outer */ create_land", {
      nestedComments: false,
    });
    // The FIRST */ (after "inner") ends the comment; "still-outer" and
    // the trailing "*/" become ordinary (non-trivia) code, and that
    // trailing "*/" is then a stray closer.
    const stillOuterIndex = tokens.findIndex((t) => t.text === "still-outer");
    expect(tokens[stillOuterIndex].isTrivia).toBe(false);
    expect(codesOf(diagnostics)).toContain("RMS0002");
  });

  // Guide fixture strings, docs/parser-design.md Sec.12 (lines 2936-2943 of
  // the archived guide). Interpretation note: the guide's own text wraps
  // these as prose sentences, e.g. "/*this is NOT a comment*/" — under
  // RMS's whitespace-splitting model (Sec.2) that string is actually SIX
  // separate tokens ("/*this", "is", "NOT", "a", "comment*/"), not one.
  // We assert the token-level behavior each fixture actually implies,
  // not a literal reproduction of the guide's prose formatting. The
  // "triple-backtick string" item from the guide's markdown rendering
  // has no independent lexical meaning (backticks aren't special to
  // RMS) and is covered generically by the "one-giant-token" test below
  // rather than reproduced here.
  describe("guide fixture strings", () => {
    it('"/*this is NOT a comment*/" tokenizes as glued words, not a comment', () => {
      const { tokens, diagnostics } = tokenize("/*this is NOT a comment*/");
      expect(tokens.every((t) => !t.isTrivia)).toBe(true);
      expect(codesOf(diagnostics)).toContain("RMS0003"); // both "/*this" and "comment*/" are glued
    });

    it('"/*** ***/" is a single glued token, not a comment', () => {
      const { tokens } = tokenize("/*** ***/");
      expect(tokens.map((t) => t.text)).toEqual(["/***", "***/"]);
      expect(tokens.every((t) => !t.isTrivia)).toBe(true);
    });

    it('"#this is NOT a comment" starts with a directive-shaped token, not a real comment', () => {
      const { tokens } = tokenize("#this is NOT a comment");
      expect(tokens[0].kind).toBe("directive");
      expect(tokens.every((t) => !t.isTrivia)).toBe(true);
    });

    it('"// this is NOT a comment" flags RMS0216 on the leading "//" token only', () => {
      const { tokens, diagnostics } = tokenize("// this is NOT a comment");
      expect(tokens[0].text).toBe("//");
      expect(codesOf(diagnostics)).toEqual(["RMS0216"]);
    });
  });
});

describe("tokenize — line offsets", () => {
  it("computes line offsets for LF line endings", () => {
    const { lineOffsets } = tokenize("a\nb\nc");
    expect(lineOffsets).toEqual([0, 2, 4]);
  });

  it("computes the same token boundaries for CRLF as for LF (the \\r is just whitespace)", () => {
    const lf = tokenize("create_land {\n  land_percent 50\n}");
    const crlf = tokenize("create_land {\r\n  land_percent 50\r\n}");
    expect(lf.tokens.map((t) => t.text)).toEqual(crlf.tokens.map((t) => t.text));
  });
});

describe("tokenize — degenerate inputs", () => {
  it("handles an empty file", () => {
    const result = tokenize("");
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.lineOffsets).toEqual([0]);
  });

  it("handles a file that is one giant token", () => {
    const source = "a".repeat(5000) + "```weird-but-legal-word```" + "b".repeat(5000);
    const { tokens } = tokenize(source);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ start: 0, end: source.length, text: source });
  });

  it("never throws on binary-garbage-ish input", () => {
    const source = "\x00\x01\x02 create_land \x1f\x1f { } \x00";
    expect(() => tokenize(source)).not.toThrow();
  });
});

describe("comment-opening aliases (Sec.2.1 amendment — a word the engine reads as `/*`)", () => {
  // The engine resolves every word to a token id and `/*` is 69, so a constant
  // valued 69 opens a NESTED comment. Comments nest, so the author's closer
  // shuts only the inner one and the rest of the file is gone. Measured
  // 2026-08-11/12 by RMSTEST_56a/56b/57/60.
  const ALIASES = new Set(["SHORE_FISH", "ATTR_PROJECTILE_ARC"]);

  const live = (src: string, opts = {}) =>
    tokenize(src, opts)
      .tokens.filter((t) => !t.isTrivia)
      .map((t) => t.text);

  it("swallows the rest of the file when an alias appears inside a comment", () => {
    const src = "/* place SHORE_FISH here */ base_terrain SNOW";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual([]);
  });

  it("leaves the file alone when the same comment holds no alias", () => {
    // RMSTEST_56b, the control. Without this the test above proves nothing
    // about the WORD as opposed to the comment.
    const src = "/* place a fish here */ base_terrain SNOW";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual(["base_terrain", "SNOW"]);
  });

  it("is not triggered by the bare number, which the engine lexes as a number", () => {
    // RMSTEST_57 came back with a normal map. This is the negative case that
    // makes the rule precise rather than superstitious.
    const src = "/* 69 */ base_terrain SNOW";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual(["base_terrain", "SNOW"]);
  });

  it("applies to any namespace, not just object constants", () => {
    // RMSTEST_60 used the attribute constant precisely to show the namespace
    // is irrelevant and only the value matters.
    const src = "/* tweak ATTR_PROJECTILE_ARC later */ base_terrain SNOW";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual([]);
  });

  it("DOES NOT touch the same word outside a comment", () => {
    // The whole safety of this feature. These are ordinary constants in
    // ordinary positions; treating them as comment openers globally would
    // truncate every map that places a shore fish.
    const src = "create_object SHORE_FISH { number_of_objects 5 }";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual([
      "create_object",
      "SHORE_FISH",
      "{",
      "number_of_objects",
      "5",
      "}",
    ]);
  });

  it("does nothing when no alias set is supplied", () => {
    // The lexer holds no RMS vocabulary of its own, so an un-configured parse
    // must behave exactly as it did before this feature existed.
    const src = "/* place SHORE_FISH here */ base_terrain SNOW";
    expect(live(src)).toEqual(["base_terrain", "SNOW"]);
  });

  it("needs one closer per alias, since the alias opened a real level", () => {
    const src = "/* SHORE_FISH */ */ base_terrain SNOW";
    expect(live(src, { commentOpenAliases: ALIASES })).toEqual(["base_terrain", "SNOW"]);
  });
});
