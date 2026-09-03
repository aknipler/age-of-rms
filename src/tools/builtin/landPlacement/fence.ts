// Sec.6.1: the fenced region a script carries the Advanced Land Placement
// model in. The banner is two SEPARATE comments,
// `/* @alp v1 begin … @alp-model {…} */` and `/* @alp end */`, never one
// spanning comment, because the `#const` lines between them are live RMS
// code the engine has to see, not commentary.
//
// REGENERATE WHOLESALE, NEVER REPAIR. Everything outside the fence is
// byte-identical, always (Sec.10.4 #1). A missing or malformed `@alp-model`
// or a `v` this module does not recognise, means NO ASSOCIATION: the
// script is read as a plain RMS script and the caller starts empty. There is
// no partial adopt (Sec.9 P5, Sec.10.4 #3).
//
// THE HAZARD THIS MODULE EXISTS TO CLOSE (slice-3 brief Sec.3, hazard 2):
// `AlpModel` carries user-authored `Placement.label` text straight into a
// comment. Two things can go wrong with what is INSIDE a comment on this
// engine:
//   1. Comment markers are whole TOKENS. A literal "/*" or "*/" that ends up
//      flanked by real whitespace lexes as its own commentOpen/commentClose
//      token, same as if it were written at top level (parser-design Sec.2).
//   2. A bare word equal to the name of a constant whose engine value is 69
//      opens a SECOND, nested comment (RMS0111), "SHORE_FISH" is exactly
//      such a name, and it is an ordinary word a user might type as a label.
// Both hazards need the dangerous text to land as its own whitespace-
// delimited token. `JSON.stringify` with no indent argument never emits
// whitespace of its own, every space, tab or newline in its output
// originates from a string VALUE, because JSON's own punctuation
// (`{}[]",:`) carries none, so replacing every whitespace character in the
// compact output with its `\uXXXX` escape (still valid JSON; `JSON.parse`
// reads either form identically) collapses the ENTIRE model blob into one
// unbreakable token no matter what a user typed. That is more general than
// hunting for "/*", "*/" or any specific 69-valued name, and, unlike a
// defence keyed on `commentOpenAliases`, it does not need reference data to
// be correct.

import type { ParseResult, Span } from "../../../parser/types";
import type { TextEdit } from "../../../../tools-api/index";
import type { LandRole, Placement, RandomParam, ShapeGroup } from "./model";

export const FENCE_VERSION = 1;

/** Sec.4.1's whole graph, JSON-serialisable by construction (Sec.5.0: no functions, no cycles, no Infinity). */
export interface AlpModel {
  v: 1;
  placements: Placement[];
  roles: LandRole[];
  randomParams: RandomParam[];
  groups: ShapeGroup[];
}

const BEGIN_TEXT = "@alp v1 begin";
const MODEL_KEY = "@alp-model";
const END_TEXT = "@alp end";

export interface FenceLocation {
  /** The whole fence: both comments and the generated body between them. */
  span: Span;
  /** Where the generated body (the `#const` lines) goes, between the two comments. */
  bodySpan: Span;
}

/**
 * Every whitespace character the lexer's tokenizer treats as a separator
 * (`src/parser/lexer.ts`'s `WHITESPACE` set, the C `isspace` set, nothing
 * Unicode). Escaping exactly this set, no more and no less, is what makes
 * the argument above exact rather than a heuristic.
 */
const LEXER_WHITESPACE = /[ \t\n\v\f\r]/g;

function escapeModelForComment(model: AlpModel): string {
  const compact = JSON.stringify(model);
  return compact.replace(LEXER_WHITESPACE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function renderFenceText(model: AlpModel, body: string): string {
  const json = escapeModelForComment(model);
  const begin = `/* ${BEGIN_TEXT} — Advanced Land Placement. Do not edit inside this block by hand.\n   ${MODEL_KEY} ${json} */`;
  const end = `/* ${END_TEXT} */`;
  return body.length > 0 ? `${begin}\n${body}\n${end}` : `${begin}\n${end}`;
}

/**
 * Matches a `commentOpen` token at `openIdx` to its own `commentClose`, by a
 * plain nesting-depth walk over the two marker token KINDS.
 *
 * Deliberately NOT alias-aware (it does not consult `commentOpenAliases`,
 * unlike the lexer's own `markComments` pass): this module's only job is to
 * find comments IT wrote, and the escaping above guarantees a fence this
 * module writes can never contain a word that opens a nested comment. For
 * anything else, a hand-edited or foreign fence, failing to find a clean
 * pair is the correct outcome anyway, since Sec.6.1's rule for anything this
 * module cannot read confidently is "no association", not "guess".
 */
function findMatchingClose(tokens: ParseResult["tokens"], openIdx: number): number | null {
  if (tokens[openIdx]?.kind !== "commentOpen") return null;
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const kind = tokens[i].kind;
    if (kind === "commentOpen") depth++;
    else if (kind === "commentClose") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** The comment's own text, `/*` and `*\/` stripped and trimmed. */
function commentBody(source: string, openIdx: number, closeIdx: number, tokens: ParseResult["tokens"]): string {
  return source.slice(tokens[openIdx].end, tokens[closeIdx].start).trim();
}

/**
 * Finds the fence's two markers, in order, as the FIRST pair in the file
 * that matches, never the largest match, never a best-effort search past a
 * failure. Returns null the moment anything is ambiguous.
 */
export function locateFence(parse: ParseResult): FenceLocation | null {
  const { tokens, source } = parse;
  let beginOpen = -1;
  let beginClose = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "commentOpen") continue;
    const close = findMatchingClose(tokens, i);
    if (close === null) continue;
    if (!commentBody(source, i, close, tokens).startsWith(BEGIN_TEXT)) continue;
    beginOpen = i;
    beginClose = close;
    break;
  }
  if (beginOpen === -1) return null;

  let endOpen = -1;
  let endClose = -1;
  for (let i = beginClose + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== "commentOpen") continue;
    const close = findMatchingClose(tokens, i);
    if (close === null) continue;
    if (commentBody(source, i, close, tokens) !== END_TEXT) continue;
    endOpen = i;
    endClose = close;
    break;
  }
  if (endOpen === -1) return null;

  return {
    span: { start: tokens[beginOpen].start, end: tokens[endClose].end },
    bodySpan: { start: tokens[beginClose].end, end: tokens[endOpen].start },
  };
}

/**
 * Sec.9 P5 / Sec.10.4 #3: parses `@alp-model` out of the fence's banner
 * comment, or returns null. NEVER repairs, NEVER partially adopts; a
 * truncated JSON body, a `v` this module doesn't recognise, or a banner
 * comment with no `@alp-model` key at all are all exactly one outcome: no
 * association, same as no fence.
 */
export function readFenceModel(parse: ParseResult): AlpModel | null {
  const loc = locateFence(parse);
  if (!loc) return null;
  const { tokens, source } = parse;
  // Re-find the begin comment's own bounds to read its raw text; locateFence
  // already proved they exist, so this walk cannot fail.
  let beginOpen = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start === loc.span.start) {
      beginOpen = i;
      break;
    }
  }
  if (beginOpen === -1) return null;
  const beginClose = findMatchingClose(tokens, beginOpen);
  if (beginClose === null) return null;
  const banner = commentBody(source, beginOpen, beginClose, tokens);

  const keyIdx = banner.indexOf(MODEL_KEY);
  if (keyIdx === -1) return null;
  const jsonText = banner.slice(keyIdx + MODEL_KEY.length).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== FENCE_VERSION ||
    !Array.isArray((parsed as { placements?: unknown }).placements) ||
    !Array.isArray((parsed as { roles?: unknown }).roles) ||
    !Array.isArray((parsed as { randomParams?: unknown }).randomParams) ||
    !Array.isArray((parsed as { groups?: unknown }).groups)
  ) {
    return null;
  }
  return parsed as AlpModel;
}

/**
 * Sec.6.1's whole promise: regenerate wholesale, touch nothing outside the
 * fence, and produce ZERO edits when the fence would come out byte-identical
 * (Sec.10.4 #4, idempotence). `body` is the caller's already-emitted
 * `#const` text (frame.ts + compiler/emit.ts); this module only owns the
 * markers and the model header around it.
 *
 * When no fence exists yet, one is inserted at `insertionOffset`, default
 * end-of-document, the placeholder slice 3 shipped when "no better answer"
 * existed yet. Slice 4a's Apply path (applyEdits.ts) is what now has a
 * better answer (the start of the last `<LAND_GENERATION>` section, so the
 * fence's `#const`s precede every skeleton Apply inserts into it) and passes
 * it explicitly; every other caller keeps the old default unchanged.
 */
export function buildFenceEdits(parse: ParseResult, model: AlpModel, body: string, insertionOffset?: number): TextEdit[] {
  const newText = renderFenceText(model, body);
  const loc = locateFence(parse);
  if (loc) {
    const oldText = parse.source.slice(loc.span.start, loc.span.end);
    if (oldText === newText) return [];
    return [{ start: loc.span.start, end: loc.span.end, newText }];
  }
  const at = insertionOffset ?? parse.source.length;
  const before = parse.source.slice(0, at);
  const after = parse.source.slice(at);
  const needsLeadingBlankLine = before.length > 0 && !before.endsWith("\n\n");
  const prefix = before.length === 0 ? "" : before.endsWith("\n") ? (needsLeadingBlankLine ? "\n" : "") : "\n\n";
  const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");
  const suffix = needsTrailingNewline ? "\n" : "";
  return [{ start: at, end: at, newText: prefix + newText + suffix }];
}
