import { readFileSync } from "node:fs";
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

function readCorpusFile(name: string): string {
  return readFileSync(resolve(TEST_MAPS_DIR, name), "utf-8");
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
    // Per docs/parser-design.md §2 the pinned regex is /^-?\d+(\.\d+)?$/ —
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
    // canonical form has no interior space (spec §2.2, RMS0214 note).
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
    // docs/parser-design.md §12, this is a non-negotiable CI gate.
    const files = ["sample.rms", "AK_Vanguard_v1.2.rms", "BCC2-Rekawa.rms", "Pa_Site_v1.1.rms", "AK_Six_Points_v1.4.rms"];
    for (const file of files) {
      const source = readCorpusFile(file);
      const { tokens } = tokenize(source);
      for (const token of tokens) {
        expect(source.slice(token.start, token.end), `${file}: token ${JSON.stringify(token.text)}`).toBe(
          token.text,
        );
      }
    }
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

  // Guide fixture strings, docs/parser-design.md §12 (lines 2936-2943 of
  // the archived guide). Interpretation note: the guide's own text wraps
  // these as prose sentences, e.g. "/*this is NOT a comment*/" — under
  // RMS's whitespace-splitting model (§2) that string is actually SIX
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
