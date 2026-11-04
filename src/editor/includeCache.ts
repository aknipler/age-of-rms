// The parser worker's memory of the script's `#include_drs` files
// (docs/include-resolution-design.md Sec.4.1). Pure (no Tauri, no React, no
// `self`), so the logic the worker runs is testable in plain Node;
// parserWorker.ts only holds one state value and forwards messages to these
// functions.
//
// Why the worker keeps the files instead of receiving them with each parse
// request, which is what the preview worker does: a parse request goes out
// on every keystroke burst and the files for a script like Bazi are 458 K
// characters. The parser worker is never replaced (useParsedDocument creates
// it on mount and ends it on unmount), so it can hold them. The state is
// replaced rather than mutated, so a reader never sees half of one message.

import {
  buildIncludeIndex,
  includeKey,
  includePathsIn,
  includePathsInText,
  type IncludeFiles,
  type IncludeIndex,
} from "../parser/includeIndex";
import type { ParseResult } from "../parser/types";

export interface IncludeState {
  /** undefined until the first includes message, null when no install was found. */
  files: IncludeFiles | null | undefined;
  /** Every key the app asked the disk for, found or not. A key here but absent from `files` is a file the install lacks. */
  requested: ReadonlySet<string>;
  /** Each file's parse, kept while its text stays the same. */
  cache: Map<string, { text: string; parse: ParseResult }>;
  /** How a file is parsed. Held here so indexFor can parse a file the cache lacks, which receiveIncludes makes rare. */
  parse: (text: string) => ParseResult;
}

export function emptyIncludeState(
  parse: (text: string) => ParseResult,
): IncludeState {
  return { files: undefined, requested: new Set(), cache: new Map(), parse };
}

/**
 * Takes a new set of files. An entry whose text is identical (`===`) keeps
 * its parse, and the rest are parsed again. A string comparison is exact and
 * costs microseconds next to a parse, which is why it replaces the length and
 * hash the design mentions. Entries whose key left `files` are dropped, so
 * the cache cannot grow past the files of the script that is open.
 */
export function receiveIncludes(
  state: IncludeState,
  files: IncludeFiles | null,
  requested: readonly string[],
  parse: (text: string) => ParseResult,
): IncludeState {
  const cache = new Map<string, { text: string; parse: ParseResult }>();
  if (files !== null) {
    for (const [key, text] of files) {
      const old = state.cache.get(key);
      cache.set(
        key,
        old !== undefined && old.text === text
          ? old
          : { text, parse: parse(text) },
      );
    }
  }
  return { files, requested: new Set(requested), cache, parse };
}

/**
 * What the parser needs before it runs: the names the script's includes
 * define, and whether a name might come from a file nobody read.
 *
 * The parser's RMS0202 check runs inside `parseRms`, before any ParseResult
 * exists, so the full index (which needs `parse.includes`) cannot feed it.
 * This scans the source text for the paths, the way the loader does, and
 * walks the cached files.
 *
 * "Unread" is decided per path. A key the app asked for and the install
 * lacks reads as empty, as DE reads it, so it does not soften. A key the app
 * has not asked for yet (the user just typed it) does, until its files
 * arrive.
 */
export function parseOptionsFor(
  state: IncludeState,
  source: string,
): { externalSymbols: ReadonlySet<string>; includesUnread: boolean } {
  const externalSymbols = new Set<string>();
  const roots = includePathsInText(source);
  if (roots.length === 0) return { externalSymbols, includesUnread: false };
  const { files } = state;
  if (files === undefined || files === null) {
    return { externalSymbols, includesUnread: true };
  }
  let includesUnread = false;
  const seen = new Set<string>();
  const queue = roots.map(includeKey);
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = state.cache.get(key);
    if (entry === undefined) {
      if (!state.requested.has(key)) includesUnread = true;
      continue;
    }
    for (const symbol of entry.parse.symbols) externalSymbols.add(symbol.name);
    queue.push(...includePathsIn(entry.parse).map(includeKey));
  }
  return { externalSymbols, includesUnread };
}

/**
 * The index validate() reads, or undefined when no includes message has
 * arrived yet, in which case validate keeps today's behaviour. `null` files
 * give an index with `installFound: false`, which keeps softening.
 */
export function indexFor(
  state: IncludeState,
  result: ParseResult,
): IncludeIndex | undefined {
  if (state.files === undefined) return undefined;
  return buildIncludeIndex(result, state.files ?? undefined, (key, text) => {
    const entry = state.cache.get(key);
    return entry !== undefined && entry.text === text
      ? entry.parse
      : state.parse(text);
  });
}
