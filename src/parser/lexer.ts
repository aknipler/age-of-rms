import type { Diagnostic, LexOptions, LexResult, Token, TokenKind } from "./types";
import {
  embeddedMarker,
  leadingByteOrderMark,
  nonStandardSpace,
  slashSlashComment,
  strayCommentClose,
  unclosedComment,
} from "./diagnostics";

// Whitespace is pinned as the C `isspace` set — nothing more. Unicode
// space-lookalikes (NBSP etc.) are deliberately NOT whitespace; they end
// up glued inside a token instead, which is what RMS0004 flags. See
// docs/parser-design.md §2.
const WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r"]);

const SECTION_HEADER_PATTERN = /^<[A-Z0-9_]+>$/;
const RND_PATTERN = /^rnd\(-?\d+,-?\d+\)$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

// Checked in this order — exact-match markers before the looser regexes,
// since e.g. "{" must win over "word" and a token merely *containing* a
// brace is a lint (RMS0003), not a different token kind.
const GLUED_MARKERS = ["{", "}", "/*", "*/"];

// Byte-order mark. Built from its numeric code point (0xFEFF) rather
// than a literal invisible character embedded in this source file,
// which is easy to silently corrupt via editors/encodings.
const BOM = String.fromCharCode(0xfeff);

// Non-standard space characters per docs/parser-design.md §2: NBSP
// (0x00A0), Ogham space mark (0x1680), the general punctuation space
// run (0x2000-0x200B), narrow no-break space (0x202F), medium
// mathematical space (0x205F), ideographic space (0x3000), and a
// *non-leading* BOM (0xFEFF) — a leading one is the real BOM, handled
// above as its own trivia token before this check ever runs. Built from
// numeric code points at runtime for the same corruption-avoidance
// reason as BOM.
const NON_STANDARD_SPACE_CODE_POINTS = [0x00a0, 0x1680, 0x202f, 0x205f, 0x3000, 0xfeff];
for (let cp = 0x2000; cp <= 0x200b; cp++) {
  NON_STANDARD_SPACE_CODE_POINTS.push(cp);
}
const NON_STANDARD_SPACE_CHARS = new Set(NON_STANDARD_SPACE_CODE_POINTS.map((cp) => String.fromCharCode(cp)));

function findNonStandardSpaceChar(text: string): string | undefined {
  for (const ch of text) {
    if (NON_STANDARD_SPACE_CHARS.has(ch)) return ch;
  }
  return undefined;
}

function classify(text: string): TokenKind {
  if (text === "{") return "openBrace";
  if (text === "}") return "closeBrace";
  if (text === "/*") return "commentOpen";
  if (text === "*/") return "commentClose";
  if (SECTION_HEADER_PATTERN.test(text)) return "sectionHeader";
  if (text.startsWith("#")) return "directive";
  if (RND_PATTERN.test(text)) return "rnd";
  if (NUMBER_PATTERN.test(text)) return "number";
  return "word";
}

function computeLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Splits `source` into whitespace-separated tokens and classifies each
 * one, per docs/parser-design.md §2 ("The RMS lexical model — the
 * insight everything rests on"). This is a pure splitter: it does not
 * know what a command, attribute, or expression is — that's the parser's
 * job (Phase 2.3). Never throws, per spec goal #1 — any input (empty,
 * binary garbage, one giant token) produces a result, never an
 * exception.
 */
export function tokenize(source: string, opts: LexOptions = {}): LexResult {
  const nestedComments = opts.nestedComments ?? true;
  const diagnostics: Diagnostic[] = [];
  const tokens: Token[] = [];

  let cursor = 0;

  // A leading BOM gets its own token — kept in the stream (nothing is
  // ever silently dropped) but marked trivia since it carries no
  // meaning to the engine.
  if (source.length > 0 && source[0] === BOM) {
    const bomToken: Token = { text: BOM, start: 0, end: 1, kind: "word", isTrivia: true };
    tokens.push(bomToken);
    diagnostics.push(leadingByteOrderMark(bomToken));
    cursor = 1;
  }

  while (cursor < source.length) {
    if (WHITESPACE.has(source[cursor])) {
      cursor++;
      continue;
    }
    const start = cursor;
    while (cursor < source.length && !WHITESPACE.has(source[cursor])) {
      cursor++;
    }
    const text = source.slice(start, cursor);
    tokens.push({ text, start, end: cursor, kind: classify(text), isTrivia: false });
  }

  markComments(tokens, nestedComments, diagnostics);
  lintTokens(tokens, diagnostics);

  return { tokens, lineOffsets: computeLineOffsets(source), diagnostics };
}

/**
 * Comment-span pass: walks the token array matching commentOpen/
 * commentClose with a nesting-depth counter, marking every enclosed
 * token — including the markers themselves — as trivia. Mutates the
 * tokens in place (isTrivia only). See §2 "Comment handling".
 *
 * When `nestedComments` is false, a second `/*` encountered while
 * already inside a comment does not open a new level (depth stays at 1)
 * — so the *next* closer closes the whole thing, emulating non-nesting
 * behavior without a separate code path.
 */
function markComments(tokens: Token[], nestedComments: boolean, diagnostics: Diagnostic[]): void {
  let depth = 0;
  let openerIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.isTrivia) continue; // already handled (the BOM token)

    if (token.kind === "commentOpen") {
      if (depth === 0) openerIndex = i;
      if (nestedComments || depth === 0) depth++;
      token.isTrivia = true;
      continue;
    }
    if (token.kind === "commentClose") {
      if (depth === 0) {
        diagnostics.push(strayCommentClose(token));
        token.isTrivia = true;
        continue;
      }
      depth--;
      token.isTrivia = true;
      continue;
    }
    if (depth > 0) {
      token.isTrivia = true;
    }
  }

  // Unclosed at EOF: every token from the outermost opener onward was
  // already marked trivia above (depth never returned to 0), so all
  // that's left is the diagnostic itself.
  if (depth > 0 && openerIndex >= 0) {
    diagnostics.push(unclosedComment(tokens[openerIndex]));
  }
}

// RMS0003 / RMS0004 / RMS0216 — beginner-facing lints over whatever
// non-trivia tokens remain after comment marking. Comment *contents*
// (now trivia) are deliberately skipped: a stray "//" inside a real
// /* */ comment is not a mistake worth flagging.
function lintTokens(tokens: Token[], diagnostics: Diagnostic[]): void {
  for (const token of tokens) {
    if (token.isTrivia) continue;

    for (const marker of GLUED_MARKERS) {
      if (token.text !== marker && token.text.includes(marker)) {
        diagnostics.push(embeddedMarker(token, marker));
        break; // one diagnostic per token, per docs/parser-design.md §10
      }
    }

    const nonStandardChar = findNonStandardSpaceChar(token.text);
    if (nonStandardChar !== undefined) {
      diagnostics.push(nonStandardSpace(token, nonStandardChar));
    }

    // "//" is only ever a beginner mistake reaching for C-style
    // comments — RMS comments are exclusively /* */. Scoped to
    // word-kind tokens starting with "//" (a lone "//" token, or
    // "//foo" glued together both count; RMS's whitespace splitting
    // means "// this is a comment" tokenizes as several separate words,
    // and only the first carries the "//").
    if (token.kind === "word" && token.text.startsWith("//")) {
      diagnostics.push(slashSlashComment(token));
    }
  }
}
