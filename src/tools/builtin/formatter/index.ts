/**
 * `formatScript`, the formatter's whole public surface
 * (docs/formatter-design.md Sec.10).
 *
 * Pure: `src/parser` types plus `tokenize` and `lineOfOffset`, nothing else.
 * No React, no Monaco, no Tauri, no tools-api. That is what lets the engine be
 * driven from a test, a script, a worker, or a future settings page, and it is
 * the concrete form of the design's "users can alter the pretty printer"
 * requirement one layer below the params form.
 */

import { tokenize } from "../../../parser/lexer";
import { lineOfOffset } from "../../../parser/lineIndex";
import type { ParseResult, Span } from "../../../parser/types";
import { Layout, type LayoutStats } from "./layout";
import {
  DEFAULT_FORMAT_OPTIONS,
  detectLineEnding,
  resolveIndentUnit,
  type FormatOptions,
} from "./options";
import { GapWriter, type SourceEdit } from "./writer";

export type { FormatOptions, SourceEdit };
export { DEFAULT_FORMAT_OPTIONS } from "./options";

export interface FormatStats extends LayoutStats {
  /** What `indentStyle: "preserve"` actually resolved to. */
  indentUnit: string;
  lineEnding: "\n" | "\r\n";
  /**
   * Source lines whose text really changed, or that became more than one line.
   * Compared as text, never derived from the edit list, see collectChanges.
   */
  changedLines: number;
  /** Line counts before and after, which is where blank-line changes show up. */
  sourceLines: number;
  formattedLines: number;
}

/** One source line that changed, with what it became. For the preview. */
export interface FormatChange {
  /** 1-based, because a person reads it and then goes and looks. */
  line: number;
  /** Offsets, for click-to-jump. Prose gets the line number, spans get offsets. */
  span: Span;
  before: string;
  after: string[];
}

export interface FormatResult {
  text: string;
  /** Empty when nothing changed, and empty when verification failed. */
  edits: SourceEdit[];
  stats: FormatStats;
  /**
   * False means the formatter could not prove it preserved the script, and
   * `edits` is empty as a result. A formatter that cannot prove it kept every
   * token does not get to modify the file (Sec.8).
   */
  verified: boolean;
  verifyProblem?: string;
  changes: FormatChange[];
}

/**
 * Re-tokenize the output and compare token texts with the input's.
 *
 * Sound WITHOUT knowing anything about comments or reference data, which is
 * the point: the lexer's splitting is purely whitespace-based, and
 * `commentOpenAliases` / `nestedComments` change only which tokens get marked
 * trivia, never where the boundaries fall. So an identical array of token
 * texts proves no character of content was added, dropped, merged or split.
 */
function verify(
  parse: ParseResult,
  formatted: string,
): { ok: true; lineOffsets: number[] } | { ok: false; problem: string } {
  const relexed = tokenize(formatted);
  if (relexed.tokens.length !== parse.tokens.length) {
    return {
      ok: false,
      problem: `the formatted script has ${relexed.tokens.length} tokens, the original has ${parse.tokens.length}`,
    };
  }
  for (let i = 0; i < relexed.tokens.length; i++) {
    if (relexed.tokens[i].text !== parse.tokens[i].text) {
      return {
        ok: false,
        problem: `token ${i} changed from "${parse.tokens[i].text}" to "${relexed.tokens[i].text}"`,
      };
    }
  }
  return { ok: true, lineOffsets: relexed.lineOffsets };
}

/**
 * The changed source lines, each with the output line(s) it became.
 *
 * Built off the token correspondence rather than a text diff: token `i` is the
 * same token in both strings, so grouping tokens by their original line and
 * reading off their new lines is exact and costs one pass. A generic LCS diff
 * would be slower, approximate, and would have to rediscover a correspondence
 * that is already sitting there.
 */
function collectChanges(
  parse: ParseResult,
  formatted: string,
  newLineOffsets: readonly number[],
  tokenStarts: readonly number[],
  limit: number,
): { changes: FormatChange[]; changedLines: number } {
  const source = parse.source;
  const lineText = (
    offsets: readonly number[],
    text: string,
    line: number,
  ): string =>
    text
      .slice(offsets[line], offsets[line + 1] ?? text.length)
      .replace(/\r?\n$/, "");

  // Tokens are in source order, so buckets are created in ascending line order
  // and a Map hands them back that way.
  const byOriginalLine = new Map<number, number[]>();
  for (let i = 0; i < parse.tokens.length; i++) {
    const line = lineOfOffset(parse.lineOffsets, parse.tokens[i].start);
    const bucket = byOriginalLine.get(line);
    if (bucket) bucket.push(i);
    else byOriginalLine.set(line, [i]);
  }

  const changes: FormatChange[] = [];
  let changedLines = 0;
  for (const [line, tokens] of byOriginalLine) {
    const newLines: number[] = [];
    for (const i of tokens) {
      const nl = lineOfOffset(newLineOffsets, tokenStarts[i]);
      if (newLines[newLines.length - 1] !== nl) newLines.push(nl);
    }
    const before = lineText(parse.lineOffsets, source, line);
    const after = newLines.map((nl) => lineText(newLineOffsets, formatted, nl));
    // NOT derived from the edit list. Coalescing (writer.ts) merges across
    // short unchanged runs, so one edit can span a thousand lines of which
    // three differ, and counting edit ranges reported 5,468 changed lines for
    // a file whose real diff was six. Compare the text.
    if (after.length === 1 && after[0] === before) continue;
    changedLines++;
    if (changes.length < limit) {
      changes.push({
        line: line + 1,
        span: {
          start: parse.lineOffsets[line],
          end: parse.lineOffsets[line + 1] ?? source.length,
        },
        before,
        after,
      });
    }
  }
  return { changes, changedLines };
}

export interface FormatScriptOptions extends Partial<FormatOptions> {
  /** Cap on `changes`; the caller states the real total from `stats`. */
  maxChanges?: number;
}

export function formatScript(
  parse: ParseResult,
  options: FormatScriptOptions = {},
): FormatResult {
  const opts: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const lineEnding = detectLineEnding(parse.source);
  const indentUnit = resolveIndentUnit(
    parse.source,
    parse.tokens,
    opts.indentStyle,
  );

  const writer = new GapWriter(parse, {
    eol: lineEnding,
    intraLineSpacing: opts.intraLineSpacing,
  });
  const layout = new Layout(parse, opts, writer, indentUnit);
  layout.run();

  const text = writer.finish();
  const checked = verify(parse, text);

  const sourceLines = parse.lineOffsets.length;
  const base: FormatStats = {
    ...layout.stats,
    indentUnit,
    lineEnding,
    changedLines: 0,
    sourceLines,
    formattedLines: sourceLines,
  };
  if (!checked.ok) {
    return {
      text,
      edits: [],
      stats: base,
      verified: false,
      verifyProblem: checked.problem,
      changes: [],
    };
  }

  const edits = writer.edits();
  const { changes, changedLines } = collectChanges(
    parse,
    text,
    checked.lineOffsets,
    writer.tokenStarts(),
    options.maxChanges ?? 200,
  );
  return {
    text,
    edits,
    stats: {
      ...base,
      changedLines,
      formattedLines: checked.lineOffsets.length,
    },
    verified: true,
    changes,
  };
}
