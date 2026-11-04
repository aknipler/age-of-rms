// What the editor's checks know about a script's `#include_drs` files
// (docs/include-resolution-design.md, CREATION_PLAN A.1). PURE: the parser
// layer imports no React, Monaco or Tauri, so this runs in the parser worker
// and in plain Node tests.
//
// The preview already reads these files (preview-design Sec.3, amended
// 2026-11-02). This module is the lower layer both share. It holds how a
// path is keyed and which paths a text names, which the generator's loader
// uses too, and the index the checks read: every name an include defines,
// with the directive in the open script that brought it in.
//
// Every definition in every branch counts. Which branch is live under which
// lobby is CREATION_PLAN A.4, and the parser already applies the same rule
// to a script's own definitions (scope.ts, "any definition counts").

import type { ParseResult, SymbolInfo } from "./types";

/**
 * Include files by `includeKey(path)`. A name that is not in the map is a
 * file that could not be read, which reads as empty, as DE reads a missing
 * file (24hr_Bazi includes `defend_wonder.inc`, which DE lacks, and still
 * generates). The map as a whole being undefined means no install was found.
 */
export type IncludeFiles = ReadonlyMap<string, string>;

/**
 * The key a path is stored under. Windows paths ignore case and take either
 * slash, so `Includes\\Scaling.inc` and `includes/scaling.inc` are one file.
 * Surrounding quotes are dropped, the parser's quoted form of a path with a
 * space in it.
 */
export function includeKey(path: string): string {
  let p = path.trim();
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .toLowerCase();
}

/** The `#include_drs` paths a parsed script names, live or not, in order. */
export function includePathsIn(parse: ParseResult): string[] {
  return parse.includes
    .filter((inc) => parse.tokens[inc.directiveToken]?.text === "#include_drs")
    .map((inc) => inc.path);
}

const INCLUDE_LINE = /#include_drs\s+("[^"\n]*"|\S+)/g;

/**
 * The `#include_drs` paths in a file's text, found by a plain scan rather
 * than a parse. It also finds a path inside a comment, which only means one
 * more file is read and never used. The loader runs on the app's main
 * thread, where parsing the 676 KB of DE's include files would stall typing,
 * and the parse that decides what a file does happens in the worker anyway.
 */
export function includePathsInText(text: string): string[] {
  return [...text.matchAll(INCLUDE_LINE)].map((m) => m[1]);
}

/** What the editor's checks know about one script's includes. */
export interface IncludeIndex {
  /** False when no install was found. Every include then reads as unknown, and softening stays. */
  readonly installFound: boolean;
  /** Each name an include defines, with where the script brought it in. */
  readonly names: ReadonlyMap<string, readonly IncludedName[]>;
  /** Include paths the install does not have, as written, in the order the script names them. */
  readonly missing: readonly string[];
}

export interface IncludedName {
  name: string;
  directiveKind: "define" | "const";
  /** The #include_drs token in the open script that brought the file in. Nested includes report the outer directive. */
  directiveToken: number;
  /** The include file the definition sits in, by includeKey. */
  file: string;
  /** True when the definition sits inside an if or start_random in its file, or a directive on the way to it does. */
  conditional: boolean;
  /** The value of a `#const` as written in its file, for the hover. Absent for a `#define`. */
  valueText?: string;
}

const BRANCH_OPENERS = new Set(["if", "start_random"]);
const BRANCH_CLOSERS = new Set(["endif", "end_random"]);

/**
 * The branch depth at each token index asked for, in one pass over the
 * tokens. `SymbolInfo.conditionalDepth` answers this for a definition, but
 * `IncludeInfo` carries no depth, and a directive inside a branch makes
 * everything its file defines conditional. Floored at 0 so a stray `endif`
 * in a broken script cannot push later depths negative.
 */
function branchDepthsAt(
  parse: ParseResult,
  indices: readonly number[],
): Map<number, number> {
  const wanted = new Set(indices);
  const depths = new Map<number, number>();
  if (wanted.size === 0) return depths;
  let depth = 0;
  for (let i = 0; i < parse.tokens.length && depths.size < wanted.size; i++) {
    const token = parse.tokens[i];
    if (wanted.has(i)) depths.set(i, depth);
    if (token.isTrivia) continue;
    if (BRANCH_OPENERS.has(token.text)) depth += 1;
    else if (BRANCH_CLOSERS.has(token.text)) depth = Math.max(0, depth - 1);
  }
  return depths;
}

/** The `#include_drs` entries of a parse with the branch depth of each. */
function includeDirectives(parse: ParseResult) {
  const found = parse.includes.filter(
    (inc) => parse.tokens[inc.directiveToken]?.text === "#include_drs",
  );
  const depths = branchDepthsAt(
    parse,
    found.map((inc) => inc.directiveToken),
  );
  return found.map((inc) => ({
    path: inc.path,
    directiveToken: inc.directiveToken,
    conditional: (depths.get(inc.directiveToken) ?? 0) > 0,
  }));
}

/**
 * A `#const`'s value as written. Tokens split on whitespace only, so
 * `(A * 2)` arrives as `(A`, `*`, `2)`. A value starting with `(` and not
 * ending with `)` takes the following tokens, joined by single spaces, up to
 * the one that ends with `)`, as tokenFilter.ts reads a parenthesised value.
 */
function valueTextOf(
  file: ParseResult,
  symbol: SymbolInfo,
): string | undefined {
  if (symbol.directiveKind !== "const" || symbol.valueToken === undefined)
    return undefined;
  const first = file.tokens[symbol.valueToken]?.text;
  if (first === undefined) return undefined;
  if (!first.startsWith("(") || first.endsWith(")")) return first;
  const parts = [first];
  for (let t = symbol.valueToken + 1; t < file.tokens.length; t++) {
    const token = file.tokens[t];
    if (token.isTrivia) continue;
    parts.push(token.text);
    if (token.text.endsWith(")")) break;
  }
  return parts.join(" ");
}

/**
 * Every name the script's `#include_drs` files define.
 *
 * `parseFile` is how the worker's cache gets in without this module holding
 * state: the same file is named by dozens of scripts and must be parsed once,
 * and a pure function cannot own that. The idiom is dependency injection by
 * parameter, the alternative (a module-level Map here) would make two
 * callers with different caches share one by accident.
 *
 * Each name carries the OUTER directive's token however deep the nesting,
 * because that is the one place in the open script the user can be shown. A
 * key already on the current chain reads as empty, the cycle guard the
 * preview's token filter uses.
 */
export function buildIncludeIndex(
  parse: ParseResult,
  files: IncludeFiles | undefined,
  parseFile: (key: string, text: string) => ParseResult,
): IncludeIndex {
  if (files === undefined) {
    return { installFound: false, names: new Map(), missing: [] };
  }
  const names = new Map<string, IncludedName[]>();
  const missing: string[] = [];
  const missingKeys = new Set<string>();

  const walk = (
    path: string,
    directiveToken: number,
    viaBranch: boolean,
    chain: Set<string>,
  ): void => {
    const key = includeKey(path);
    if (chain.has(key)) return;
    const text = files.get(key);
    if (text === undefined) {
      if (!missingKeys.has(key)) {
        missingKeys.add(key);
        missing.push(path);
      }
      return;
    }
    chain.add(key);
    const file = parseFile(key, text);
    for (const symbol of file.symbols) {
      const entry: IncludedName = {
        name: symbol.name,
        directiveKind: symbol.directiveKind,
        directiveToken,
        file: key,
        conditional: viaBranch || symbol.conditionalDepth > 0,
        valueText: valueTextOf(file, symbol),
      };
      const list = names.get(symbol.name);
      if (list) list.push(entry);
      else names.set(symbol.name, [entry]);
    }
    for (const nested of includeDirectives(file)) {
      walk(nested.path, directiveToken, viaBranch || nested.conditional, chain);
    }
    chain.delete(key);
  };

  for (const directive of includeDirectives(parse)) {
    walk(
      directive.path,
      directive.directiveToken,
      directive.conditional,
      new Set(),
    );
  }
  return { installFound: true, names, missing };
}
