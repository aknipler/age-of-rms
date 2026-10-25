// Line prediction for the Code editor (docs/name-lookup-design.md Sec.13.3).
// Once the first word of a command or attribute line is typed, the rest of
// the line is copied from the closest earlier statement with the same first
// word in the same home.
//
// Pure, no Monaco import, for the reason constOffers.ts gives (Vitest cannot
// load monaco-editor). aoe2RmsPrediction.ts is the Monaco half.
//
// A statement's HOME is the command whose block holds it, for an attribute,
// or the section, for a command. It is part of the key because one first
// word means different things in different homes. `terrain_type` in a
// create_land block takes the land's terrain and in a create_terrain block
// the terrain being painted, so a create_land line predicted from a
// create_terrain one would copy the wrong kind of value.

import type { CaretContext } from "./caretContext";
import type { Item, ParseResult, Token } from "../parser/types";

export interface StatementEntry {
  /** Offset of the statement's first word. */
  start: number;
  /** Offset just past its last argument. Entries are only used once this is above the caret's line. */
  end: number;
  /** Every token after the first word, comments left out. */
  tokens: string[];
}

export interface StatementIndex {
  parse: ParseResult;
  /** Keyed by `statementKey`, each list in source order. */
  byKey: ReadonlyMap<string, readonly StatementEntry[]>;
}

/** The home part of a key. Exported so the tests can state a key without restating the format. */
export function homeKey(
  enclosing: string | undefined,
  section: string | null,
): string {
  return enclosing !== undefined
    ? `block:${enclosing}`
    : `section:${section ?? ""}`;
}

export function statementKey(home: string, head: string): string {
  return `${home} ${head}`;
}

/**
 * Every command and attribute statement in the parse, by key. Built once per
 * parse (the provider caches it the way getScriptNameIndex caches the name
 * index), since walking the tree costs far more than one lookup.
 */
export function buildStatementIndex(parse: ParseResult): StatementIndex {
  const byKey = new Map<string, StatementEntry[]>();
  const tokens = parse.tokens;
  const add = (home: string, nameToken: number, lastToken: number) => {
    const key = statementKey(home, tokens[nameToken].text);
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push({
      start: tokens[nameToken].start,
      end: tokens[lastToken].end,
      tokens: argTokens(tokens, nameToken + 1, lastToken),
    });
  };
  const walk = (items: readonly Item[], home: string) => {
    for (const item of items) {
      switch (item.kind) {
        case "command": {
          add(home, item.name, lastArgToken(item.name, item.args));
          if (item.block)
            walk(item.block.items, `block:${tokens[item.name].text}`);
          break;
        }
        case "attribute":
          add(home, item.name, lastArgToken(item.name, item.args));
          break;
        case "if":
          for (const b of item.branches) walk(b.items, home);
          break;
        case "random":
          walk(item.preamble, home);
          for (const b of item.branches) walk(b.items, home);
          break;
        default:
          break;
      }
    }
  };
  walk(parse.script.preamble, homeKey(undefined, null));
  for (const s of parse.script.sections)
    walk(s.items, homeKey(undefined, s.name));
  return { parse, byKey };
}

/**
 * The rest of the line to show after the caret, or null for none. `text` is
 * the live model text, which can be ahead of `index.parse` by a few
 * keystrokes. Only statements that end above the caret's line and above the
 * first difference between the two are read, so a stale parse never offers
 * a statement from where the person is typing.
 */
export function predictLine(
  text: string,
  caret: number,
  ctx: CaretContext,
  index: StatementIndex,
): string | null {
  if (!restOfLineIsBlank(text, caret)) return null;
  // No statement inside a comment, since its words lex as trivia. A
  // statement past its declared arguments still has one, and an earlier
  // line that wrote more can continue it.
  const st = ctx.statement;
  if (!st || !isPredictableHead(st.head)) return null;

  const limit = Math.min(
    ctx.lineStart,
    sharedPrefixLength(index.parse.source, text, ctx.lineStart),
  );
  const list = index.byKey.get(
    statementKey(homeKey(st.enclosing, st.section), st.head),
  );
  if (!list) return null;
  const typed = st.args;
  const partial = ctx.word;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.end > limit) continue;
    const rest = continuation(e.tokens, typed, partial);
    if (rest !== null) return rest;
  }
  return null;
}

/**
 * What `candidate` adds after `typed` and the partial word, or null when it
 * does not start with them or adds nothing. Tokens compare whole, since a
 * prediction that only shares a prefix of a typed word would rewrite it.
 */
export function continuation(
  candidate: readonly string[],
  typed: readonly string[],
  partial: string,
): string | null {
  const n = typed.length;
  if (candidate.length <= n) return null;
  for (let k = 0; k < n; k++) if (candidate[k] !== typed[k]) return null;
  const next = candidate[n];
  if (!next.startsWith(partial)) return null;
  if (partial === "") return candidate.slice(n).join(" ");
  const head = next.slice(partial.length);
  const tail = candidate.slice(n + 1).join(" ");
  if (tail === "") return head === "" ? null : head;
  return `${head} ${tail}`;
}

// --- shared with blockTemplate.ts ------------------------------------------

/** True when nothing but spaces and tabs follow the caret on its line. */
export function restOfLineIsBlank(text: string, caret: number): boolean {
  for (let i = caret; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") return true;
    if (c !== " " && c !== "\t") return false;
  }
  return true;
}

/**
 * How far `a` and `b` agree, capped at `cap`. The equal case is one native
 * comparison, which is the usual one while typing, and only a real
 * difference above the caret pays for the scan.
 */
export function sharedPrefixLength(a: string, b: string, cap: number): number {
  const n = Math.min(cap, a.length, b.length);
  if (a.slice(0, n) === b.slice(0, n)) return n;
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** The non-comment token texts from `first` to `last` inclusive. */
export function argTokens(
  tokens: readonly Token[],
  first: number,
  last: number,
): string[] {
  const out: string[] = [];
  for (let i = first; i <= last; i++)
    if (!tokens[i].isTrivia) out.push(tokens[i].text);
  return out;
}

/** The last token of a statement: its last argument's, or the name's when it has none. */
export function lastArgToken(
  nameToken: number,
  args: readonly { lastToken: number }[],
): number {
  return args.length === 0 ? nameToken : args[args.length - 1].lastToken;
}

/**
 * Directives, `if` and `elseif` conditions and `percent_chance` never
 * predict (Sec.13.3). A `#const` name is new by definition, and a condition
 * or a chance copied from the line above is a guess about branching the
 * person has not made yet.
 */
function isPredictableHead(head: string): boolean {
  return (
    !head.startsWith("#") &&
    head !== "if" &&
    head !== "elseif" &&
    head !== "percent_chance"
  );
}
