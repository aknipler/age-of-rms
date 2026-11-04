// `#include_drs` files from the player's own game install,
// docs/preview-design.md Sec.3 (rev 11, amended 2026-11-02). PURE (CLAUDE.md
// hard rule / preview-design Sec.2).
//
// DE reads an include as plain map script from its `gamedata_x2` folder
// and runs its text where the directive stands, as if it were written
// there. The files are the game's own content, so they never enter the
// repo, a fixture or a build. The app reads them from the user's install
// and hands the generator their text as data (`IncludeFiles`). The filter
// in tokenFilter.ts does the reading in, since it already decides which
// lines are live and spends the draws in reading order.
//
// This module holds the parts the app and the generator share. How a path
// is keyed, which files a script needs, and how an offset in the expanded
// text maps back to the author's own text. Where the folder sits under an
// install is settings/scriptFolder.ts's, beside the scripts folder.

import { includeKey, includePathsInText } from "../../parser/includeIndex";
import type { Span } from "../../parser/types";

// How a path is keyed and which paths a text names live in the parser layer
// (src/parser/includeIndex.ts), since the editor's checks read the same files.
// Re-exported so the generator's own imports stay as they were.
export {
  includeKey,
  includePathsIn,
  includePathsInText,
  type IncludeFiles,
} from "../../parser/includeIndex";

/**
 * Reads every include file a script needs, the files those include
 * included. `read` returns a file's text by its key (`includeKey`), a path
 * relative to the `gamedata_x2` folder, or undefined when it cannot. A file
 * is read once however many times it is named. The walk takes every path it
 * finds, the ones in dead branches included, because which branch is live
 * depends on the lobby, and reading a few spare files is cheaper than
 * reading again whenever the lobby changes.
 *
 * `requested`, when given, is filled with every key the walk asked `read`
 * for, found or not. The editor's checks need it to tell a file the install
 * lacks (asked for, absent, reads as empty) from a file nobody has asked for
 * yet (a path the user has just typed). It is an optional third parameter on
 * a function nothing passes to `map` or `filter` by name, so the index-fills-
 * the-parameter trap does not apply here.
 */
export async function loadIncludeFiles(
  rootPaths: readonly string[],
  read: (key: string) => Promise<string | undefined>,
  requested?: Set<string>,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [...rootPaths];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const key = includeKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    requested?.add(key);
    const text = await read(key);
    if (text === undefined) continue;
    files.set(key, text);
    queue.push(...includePathsInText(text));
  }
  return files;
}

/**
 * One include file's text placed into the expanded script. `at` is the
 * offset in the author's text where it begins (just after the directive's
 * path), `length` its length in the expanded text, and `directive` the span
 * of the `#include_drs` line it came from.
 */
export interface Insertion {
  at: number;
  length: number;
  directive: Span;
}

/**
 * Maps a span of the expanded text back to the author's text. A span that
 * starts inside an included file maps to the directive that brought it in,
 * which is the one place in the author's text the user can be shown. A
 * span that starts in the author's text and ends inside an included file
 * (a block whose attributes come from an include) ends at that directive.
 * `insertions` are in order, as tokenFilter.ts returns them.
 */
export function mapSpanToSource(
  span: Span,
  insertions: readonly Insertion[],
): Span {
  if (insertions.length === 0) return span;
  let shift = 0;
  let start: number | undefined;
  for (const ins of insertions) {
    const from = ins.at + shift;
    const to = from + ins.length;
    if (start === undefined) {
      if (span.start < from) start = span.start - shift;
      else if (span.start < to) return ins.directive;
    }
    if (start !== undefined) {
      if (span.end <= from) return { start, end: span.end - shift };
      if (span.end <= to) return { start, end: ins.directive.end };
    }
    shift += ins.length;
  }
  return { start: start ?? span.start - shift, end: span.end - shift };
}
