/**
 * Formatter options and the two things that have to be sniffed off the source
 * rather than chosen (docs/formatter-design.md Sec.5.3, Sec.6.2).
 *
 * This file is the whole user-preference surface as a DATA TYPE. The tool's
 * manifest params (scriptFormatter.ts) map onto it and the layout engine reads
 * nothing else, so the engine can be driven from a test, a script, or a future
 * settings page without knowing a params form exists.
 *
 * Pure, src/parser types only, no React/Monaco/Tauri, same rule as
 * src/parser/**, so it runs in plain-Node Vitest and in a worker.
 */

import type { Token } from "../../../parser/types";

/** How a command's `{ … }` block is laid out (design Sec.3). */
export type BlockLayoutPolicy =
  /** Classify each block from the source: one line stays one line. THE DEFAULT. */
  | "preserve"
  /** Header, brace, one attribute per indented line, always. */
  | "expanded"
  /** Whole command on one line wherever that is possible. */
  | "inline"
  /** One line when it fits `inlineMaxWidth`, expanded otherwise. */
  | "compact";

export type IndentStylePolicy = "preserve" | "tab" | "2 spaces" | "4 spaces";

/**
 * Whether a `<SECTION>`'s body sits one level in from column 0 (design Sec.5.0).
 *
 * The same shape as Sec.3's inline/expanded question and it gets the same
 * answer. Measured 2026-08-24 over the 49 corpus scripts that have sections:
 * 88 of 265 section bodies are indented, and the split is per FILE, not per
 * author-mood, 33 scripts never indent one, 13 indent every single one
 * (eleven of them DE official maps), 3 are mixed. So there is no majority to
 * normalise toward, only two conventions, and `preserve` classifies each
 * section from the source.
 */
export type SectionIndentPolicy = "preserve" | "flat" | "indented";

/** Where the `{` of an EXPANDED block goes. Inline blocks are unaffected. */
export type BraceStylePolicy = "preserve" | "ownLine" | "sameLine";

/**
 * What happens to horizontal whitespace between two tokens that were on one
 * source line and stay on one output line. `preserve` keeps deliberate column
 * alignment (design Sec.5.2, 10% of corpus lines have some).
 */
export type IntraLineSpacingPolicy = "preserve" | "collapse";

export interface FormatOptions {
  blockLayout: BlockLayoutPolicy;
  /** Display columns, tabs counted as TAB_DISPLAY_WIDTH. Only `compact` reads it. */
  inlineMaxWidth: number;
  /**
   * Resolved command names always laid out expanded / inline, overriding
   * `blockLayout`. Matched against `CommandNode.def.name`, so `#const L 32`
   * followed by `L { … }` matches "create_land" (live in 24hr_Holler.rms).
   * A name in both lists is EXPANDED, a manifest cannot express a
   * cross-param constraint, so the tie-break is documented, not validated.
   */
  alwaysExpand: readonly string[];
  alwaysInline: readonly string[];
  indentStyle: IndentStylePolicy;
  sectionIndent: SectionIndentPolicy;
  braceStyle: BraceStylePolicy;
  /** Indent the bodies of `if`/`elseif`/`else` and `start_random` branches. */
  indentConditionals: boolean;
  /** Keep an author's comment-headed indentation groups (design Sec.4.4). */
  commentGroups: boolean;
  intraLineSpacing: IntraLineSpacingPolicy;
  /** Consecutive blank lines kept between entries. */
  maxBlankLines: number;
  /**
   * One blank line before every `<SECTION>` header but the first. Not exposed
   * as a manifest param (design Sec.6.1 lists what is); it is here so the
   * engine has no hidden constants and a caller can turn it off.
   *
   * Deliberately NOT capped by `maxBlankLines`: setting the cap to 0 asks for
   * no blank runs BETWEEN entries, which is a different question from whether
   * sections are separated at all.
   */
  blankLineBeforeSections: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: Readonly<FormatOptions> = Object.freeze({
  blockLayout: "preserve",
  inlineMaxWidth: 100,
  alwaysExpand: Object.freeze([]),
  alwaysInline: Object.freeze([]),
  indentStyle: "preserve",
  sectionIndent: "preserve",
  braceStyle: "preserve",
  indentConditionals: true,
  commentGroups: true,
  intraLineSpacing: "preserve",
  maxBlankLines: 1,
  blankLineBeforeSections: true,
} as const);

/**
 * What one tab counts as when measuring a line against `inlineMaxWidth`.
 *
 * A guess about the reader's editor, and unavoidably so. The file does not
 * record a tab stop. It affects ONLY the `compact` fit decision; nothing the
 * formatter writes depends on it.
 */
export const TAB_DISPLAY_WIDTH = 4;

/** Display columns of a whitespace prefix, tabs advancing to the next stop. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === "\t") width += TAB_DISPLAY_WIDTH - (width % TAB_DISPLAY_WIDTH);
    else width += 1;
  }
  return width;
}

/**
 * The document's own line ending.
 *
 * NOT cosmetic and NOT a user option. 48 of the 51 corpus scripts are CRLF;
 * emitting LF into one of them would make every line differ, so a five-edit
 * reformat would arrive as a whole-file rewrite with a whole-file undo entry.
 *
 * Ties and empty input go to LF, matching Monaco's own `defaultEOL` so a
 * brand-new document stays internally consistent.
 */
export function detectLineEnding(source: string): "\n" | "\r\n" {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "\n") continue;
    if (i > 0 && source[i - 1] === "\r") crlf++;
    else lf++;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * The 0-based lines whose leading whitespace is evidence about how the AUTHOR
 * indents code.
 *
 * A line qualifies when a token starts it, only whitespace to its left, and
 * that token is not the continuation of a comment already in progress. The
 * exclusion is the whole point: the inside of a multi-line comment is prose,
 * an ASCII-art box or an aligned table, and its columns say nothing about the
 * indent unit. `test-maps/sample.rms` is a 4-space script whose header comment
 * is inset by three, and reading every raw line made the unit three spaces.
 *
 * A comment that OPENS on its own line still counts. Authors indent those with
 * the code they introduce, which is the same evidence a command carries, and
 * Sec.4.4's comment groups depend on exactly that being deliberate.
 *
 * Incidence, corpus of 51 scripts, 2026-08-24: this changes the answer on ONE
 * file, `sample.rms`. It is fixed anyway because the failure mode does not
 * scale with the corpus. It scales with how much of a short script is header
 * comment, and a new map is mostly header comment.
 */
function evidenceLines(source: string, tokens: readonly Token[]): Set<number> {
  const lines = new Set<number>();
  // One forward walk over both, rather than a lineOfOffset per token: the
  // tokens are in source order, so the line cursor only ever moves forward.
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    while (lineStart < token.start) {
      const next = source.indexOf("\n", lineStart);
      if (next < 0 || next >= token.start) break;
      lineStart = next + 1;
      line++;
    }
    if (token.isTrivia && i > 0 && tokens[i - 1].isTrivia) continue;
    if (/^[ \t]*$/.test(source.slice(lineStart, token.start))) lines.add(line);
  }
  return lines;
}

/**
 * The script's own indent unit.
 *
 * Tabs win on a tie because they dominate the corpus (29 of 51 files) and
 * because a file with no indentation at all is more likely to be joining a
 * tab-indented world than a space-indented one.
 *
 * For spaces the answer is the SMALLEST width that occurs often enough to be
 * real, not the most common one: in a 4-space file indented three levels deep,
 * the most common prefix can easily be 8 or 12, and taking the mode would
 * "detect" a unit no one typed. The 5%-or-two-lines floor is what keeps a
 * stray one-space line from being read as the unit.
 */
export function detectIndentUnit(
  source: string,
  tokens: readonly Token[],
): string {
  const evidence = evidenceLines(source, tokens);
  let tabLines = 0;
  let spaceLines = 0;
  const spaceCounts = new Map<number, number>();

  const lines = source.split("\n");
  for (let n = 0; n < lines.length; n++) {
    if (!evidence.has(n)) continue;
    const line = lines[n];
    const prefix = /^[ \t]*/.exec(line)![0];
    // A blank (or whitespace-only) line says nothing about the indent unit.
    if (prefix.length === 0 || line.trim() === "") continue;
    if (prefix.includes("\t")) {
      tabLines++;
    } else {
      spaceLines++;
      spaceCounts.set(prefix.length, (spaceCounts.get(prefix.length) ?? 0) + 1);
    }
  }

  if (spaceLines === 0 || tabLines >= spaceLines) return "\t";

  const floor = Math.max(2, Math.ceil(spaceLines * 0.05));
  let unit = 0;
  for (const [width, count] of spaceCounts) {
    if (count < floor) continue;
    if (width < 1 || width > 8) continue;
    if (unit === 0 || width < unit) unit = width;
  }
  return " ".repeat(unit === 0 ? 4 : unit);
}

export function resolveIndentUnit(
  source: string,
  tokens: readonly Token[],
  style: IndentStylePolicy,
): string {
  switch (style) {
    case "tab":
      return "\t";
    case "2 spaces":
      return "  ";
    case "4 spaces":
      return "    ";
    case "preserve":
      return detectIndentUnit(source, tokens);
  }
}
