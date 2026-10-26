// What kind of RMS text the Code editor's caret is in, for the completion
// provider, the resolve flash and the #const code actions
// (docs/name-lookup-design.md Sec.4.1).
//
// Pure on purpose, no Monaco import. The provider hands in the model's text
// and an offset, and everything that could be wrong about a slot is
// testable in plain Node. Monaco glue stays in aoe2RmsCompletion.ts.
//
// WHY THE LIVE TEXT AND NOT THE LAST PARSE. The parse comes back from the
// worker a beat after typing stops, so while a person types it is a few
// keystrokes behind. Its offsets near the caret are wrong, which is exactly
// where this module looks. So it tokenizes the text before the caret with
// the real lexer and reads the structure (section, enclosing block,
// statement head) from those tokens. The last parse is still what the name
// lookup reads for definitions, since those sit away from the caret.

import type { CommandDef, LanguageIndex } from "../parser/language";
import { tokenize } from "../parser/lexer";
import type { SlotKind } from "../parser/nameLookup";
import type { ParseResult, Token } from "../parser/types";

export interface CaretContext {
  /** The slot the word belongs to. Null where nothing should be suggested or resolved (inside a comment, a name being defined, a file name). */
  slot: SlotKind | null;
  /** The text from the start of the word to the caret. Empty right after whitespace. */
  word: string;
  wordStart: number;
  /** Offset of the start of the caret's line, see `lookupOffset`. */
  lineStart: number;
  /** True inside an unclosed `{`. False inside a comment, where nothing is read. */
  inBlock: boolean;
  /** The statement the word is an argument of, when its first word is a known name before the word on this line. Line prediction reads it (Sec.13.3). */
  statement?: CaretStatement;
}

export interface CaretStatement {
  /** The statement's first word, a command, attribute, directive or control keyword. */
  head: string;
  /** The whole tokens typed between the head and the word, comments left out. */
  args: string[];
  /** The command whose block holds the caret, or undefined outside every block. */
  enclosing: string | undefined;
  section: string | null;
  /** True when nothing but whitespace precedes the head on its line. */
  firstOnLine: boolean;
}

/**
 * The control keywords that take an operand, and which kind. The parser
 * hardcodes control keyword arity (parser-design Sec.5.1's pinned
 * exception, since language.json's controlKeywords carry no `arguments`
 * yet), and this mirrors that one exception rather than adding another.
 */
const CONDITION_KEYWORDS: ReadonlySet<string> = new Set(["if", "elseif"]);
const CHANCE_KEYWORD = "percent_chance";

/** Appended when the caret follows whitespace, so the lexer says whether that spot is inside a comment. No RMS name can contain a control character. */
const SENTINEL = "\u0001";

/**
 * `parse`, when given, is the last parse of the document. It is used for the
 * tokens above the caret's line whenever its source still matches the text
 * there, which is the normal case while typing. Lexing the whole text
 * before the caret instead measured 62 ms median at the end of the corpus's
 * largest map (Arena.rms, 937 KB), too slow for every keystroke. With the
 * parse, only the caret's own line is lexed, 5.9 ms median at the same spot
 * (2026-10-22). What remains is mostly the trivia filter over every token.
 */
export function caretContext(
  text: string,
  caret: number,
  lang: LanguageIndex,
  parse?: ParseResult | null,
): CaretContext {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const atWordEnd = before.length > 0 && !/\s$/.test(before);
  const tokens = tokensBefore(
    text,
    caret,
    lineStart,
    atWordEnd ? "" : SENTINEL,
    parse,
  );
  const last = tokens[tokens.length - 1];
  const wordStart = atWordEnd && last ? last.start : caret;
  const word = before.slice(wordStart);
  const none: CaretContext = {
    slot: null,
    word,
    wordStart,
    lineStart,
    inBlock: false,
  };

  // Inside a comment, the word (or the sentinel) lexed as trivia.
  if (!last || last.isTrivia) return none;

  const nt = tokens.filter((t) => !t.isTrivia);
  // Everything before the word itself.
  const prior = nt.slice(0, nt.length - 1);

  const section = lastSection(prior);
  const enclosingName = enclosingCommandName(prior, lang);
  none.inBlock = enclosingName !== undefined;
  const enclosing =
    enclosingName === undefined
      ? null
      : (lang.commandsByName.get(enclosingName) ?? null);

  // The statement the word belongs to: walk back along this line to the
  // nearest known name. A brace ends the walk, since `create_land {
  // terrain_type X` puts a new statement after it on the same line.
  const onLine = prior.filter((t) => t.start >= lineStart);
  let headIndex = -1;
  for (let i = onLine.length - 1; i >= 0; i--) {
    const t = onLine[i];
    if (t.kind === "openBrace" || t.kind === "closeBrace") break;
    if (isKnownHead(t.text, lang, enclosingName !== undefined)) {
      headIndex = i;
      break;
    }
  }

  if (headIndex === -1) {
    // Nothing known before the word on this line. If nothing at all sits
    // between the last brace (or the line start) and the word, the word
    // starts a statement.
    let i = onLine.length - 1;
    while (
      i >= 0 &&
      onLine[i].kind !== "openBrace" &&
      onLine[i].kind !== "closeBrace"
    )
      i--;
    if (i === onLine.length - 1)
      return {
        ...none,
        slot: {
          kind: "lineStart",
          enclosing: enclosingName === undefined ? null : enclosing,
          section,
          ...(enclosingName === undefined
            ? { pending: pendingBlockCommand(prior, lang) }
            : {}),
        },
      };
    return none;
  }

  const head = onLine[headIndex].text;
  const argIndex = onLine.length - 1 - headIndex;
  none.statement = {
    head,
    args: onLine.slice(headIndex + 1).map((t) => t.text),
    enclosing: enclosingName,
    section,
    firstOnLine: headIndex === 0,
  };

  if (CONDITION_KEYWORDS.has(head))
    return argIndex === 0 ? { ...none, slot: { kind: "condition" } } : none;
  if (head === CHANCE_KEYWORD)
    return argIndex === 0
      ? {
          ...none,
          slot: {
            kind: "argument",
            def: { name: "chance", type: "percent" },
          },
        }
      : none;

  const args = head.startsWith("#")
    ? lang.directivesByName.get(head)?.arguments
    : enclosingName !== undefined && lang.attributesByName.has(head)
      ? lang.attributesByName.get(head)?.arguments
      : lang.commandsByName.get(head)?.arguments;
  const def = args?.[argIndex];
  // A "string" slot holds a file name or a name being defined (#const's
  // first argument), never a name to look up.
  if (!def || def.type === "string") return none;
  return { ...none, slot: { kind: "argument", def } };
}

/**
 * True when `offset` sits inside a comment. The hover asks it for each word,
 * so a comment's own text gets no popup.
 *
 * Reads the text up to the offset with the sentinel glued on, which is the
 * same trick `caretContext` uses after whitespace. A comment still open at
 * the offset swallows the sentinel into its trivia token, and a name outside
 * one turns it into part of a word token. Which kind of token comes last
 * says which side the offset is on.
 */
export function insideComment(
  text: string,
  offset: number,
  parse?: ParseResult | null,
): boolean {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const tokens = tokensBefore(text, offset, lineStart, SENTINEL, parse);
  return tokens[tokens.length - 1]?.isTrivia === true;
}

/**
 * The offset to hand the name lookup as "where the use is". The caret's own
 * line start, not the caret: the last parse lags the text, so a definition
 * on the line being typed is treated as not yet parsed rather than guessed
 * at (design Sec.4.1). Everything on earlier lines keeps its offsets while
 * a person types on this one.
 */
export function lookupOffset(ctx: CaretContext): number {
  return ctx.lineStart;
}

/**
 * The tokens of `text` up to the caret, plus `suffix` lexed at the caret.
 *
 * Reuses the last parse's tokens up to the last non-trivia token that ends
 * before the caret's line, and lexes only from there. Starting right after
 * a non-trivia token is what makes resuming safe: such a token can never
 * sit inside a comment, so the lexer's only state (comment depth) is zero
 * there. Falls back to lexing everything when the parse is missing or its
 * source differs above the caret's line (an edit higher up that the worker
 * has not caught up with yet).
 */
function tokensBefore(
  text: string,
  caret: number,
  lineStart: number,
  suffix: string,
  parse: ParseResult | null | undefined,
): Token[] {
  const lexFrom = (from: number, prefix: readonly Token[]): Token[] => {
    const tail = tokenize(text.slice(from, caret) + suffix).tokens.map((t) => ({
      ...t,
      start: t.start + from,
      end: t.end + from,
    }));
    return prefix.length === 0 ? tail : [...prefix, ...tail];
  };
  if (
    !parse ||
    parse.source.length < lineStart ||
    parse.source.slice(0, lineStart) !== text.slice(0, lineStart)
  )
    return lexFrom(0, []);
  const tokens = parse.tokens;
  let k = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].end <= lineStart && !tokens[i].isTrivia) {
      k = i;
      break;
    }
  }
  if (k === -1) return lexFrom(0, []);
  return lexFrom(tokens[k].end, tokens.slice(0, k + 1));
}

function lastSection(tokens: readonly Token[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i--)
    if (tokens[i].kind === "sectionHeader") return tokens[i].text.slice(1, -1);
  return null;
}

/**
 * The command that owns the innermost unclosed `{`, or undefined outside
 * every block. A section header ends the search, since a block never spans
 * one.
 *
 * The owner is the nearest command name before the brace, not the token
 * right before it. `create_object GOLD {` puts the command's argument there,
 * and reading that token named the block GOLD, so the line start inside it
 * lost create_object's attributes (found building slice E, whose home key
 * needs the real name). With no command name in reach, the token before the
 * brace is still returned, which keeps an orphan block counted as a block.
 */
function enclosingCommandName(
  tokens: readonly Token[],
  lang: LanguageIndex,
): string | undefined {
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "sectionHeader") return undefined;
    if (t.kind === "closeBrace") depth++;
    else if (t.kind === "openBrace") {
      if (depth === 0) {
        for (let j = i - 1; j >= 0; j--) {
          const k = tokens[j].kind;
          if (k === "openBrace" || k === "closeBrace" || k === "sectionHeader")
            break;
          if (lang.commandsByName.has(tokens[j].text)) return tokens[j].text;
        }
        return tokens[i - 1]?.text ?? "";
      }
      depth--;
    }
  }
  return undefined;
}

/**
 * The block command whose header the caret follows, when no `{` has been
 * typed yet. Walks back to the nearest command name and gives up at a brace
 * or a section header, so a finished block never counts. A command with no
 * block (`create_land` style one-liners) is not pending either.
 */
function pendingBlockCommand(
  tokens: readonly Token[],
  lang: LanguageIndex,
): CommandDef | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (
      t.kind === "openBrace" ||
      t.kind === "closeBrace" ||
      t.kind === "sectionHeader"
    )
      return null;
    const def = lang.commandsByName.get(t.text);
    if (def) return def.kind === "block" ? def : null;
  }
  return null;
}

function isKnownHead(
  text: string,
  lang: LanguageIndex,
  inBlock: boolean,
): boolean {
  if (CONDITION_KEYWORDS.has(text) || text === CHANCE_KEYWORD) return true;
  if (text.startsWith("#")) return lang.directivesByName.has(text);
  return inBlock
    ? lang.attributesByName.has(text) || lang.commandsByName.has(text)
    : lang.commandsByName.has(text);
}
