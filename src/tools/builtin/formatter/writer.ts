/**
 * The gap writer, the formatter's whole contact with the text
 * (docs/formatter-design.md Sec.2).
 *
 * THE INVARIANT: the formatter never changes a token, only the whitespace
 * between tokens. A script is exactly
 *
 *     gap[0] + tokens[0].text + gap[1] + … + tokens[n-1].text + gap[n]
 *
 * with `gap[i] === source.slice(tokens[i-1].end, tokens[i].start)` and pure
 * whitespace by construction, because the lexer splits on whitespace and keeps
 * every other character. So formatting is choosing a new `gap[]`, and nothing
 * else in this directory is allowed to build output text any other way.
 *
 * Everything the design doc promises falls out of that: comments and
 * unparseable regions cannot be dropped because they are tokens; no token text
 * can be invented; minimal edits are a diff of two whitespace arrays; and
 * correctness is checkable by re-tokenizing (Sec.8).
 *
 * The two ways to break it are mechanical, so both are refused here rather
 * than tested for later: an empty gap would merge two tokens, and a
 * non-increasing placement would duplicate or drop one.
 */

import type { ParseResult } from "../../../parser/types";
import type { IntraLineSpacingPolicy } from "./options";

/**
 * Structurally identical to the tools API's `TextEdit` and to breakdown
 * Sec.4.1's. Declared locally so this engine imports nothing but `src/parser`;
 * TypeScript is STRUCTURALLY typed, so the array flows into `ToolMessage`'s
 * `edits?: TextEdit[]` slot with no cast and no adapter.
 */
export interface SourceEdit {
  start: number;
  end: number;
  newText: string;
}

export interface WriterOptions {
  eol: "\n" | "\r\n";
  intraLineSpacing: IntraLineSpacingPolicy;
}

/** Whitespace containing a line break, in any of the forms the lexer accepts. */
function hasBreak(gap: string): boolean {
  return gap.includes("\n") || gap.includes("\r");
}

export class GapWriter {
  /** `undefined` until placed; `finish()` refuses to run while any remain. */
  private readonly gaps: (string | undefined)[];
  private readonly source: string;
  private readonly parse: ParseResult;
  private readonly opts: WriterOptions;
  /** Index of the last token placed, -1 before the first. */
  private last = -1;
  /** Indent string of the output line currently being written. */
  private lineIndent = "";
  /** Offset of each token in the FORMATTED text. Filled by `finish()`. */
  private starts: number[] = [];

  constructor(parse: ParseResult, opts: WriterOptions) {
    this.parse = parse;
    this.source = parse.source;
    this.opts = opts;
    this.gaps = new Array<string | undefined>(parse.tokens.length + 1).fill(
      undefined,
    );
  }

  /** The indent of the output line in progress, what a verbatim run shifts to. */
  get currentIndent(): string {
    return this.lineIndent;
  }

  get lastPlaced(): number {
    return this.last;
  }

  /** The original whitespace before token `i` (or after the last token, at `i === n`). */
  origGap(i: number): string {
    const tokens = this.parse.tokens;
    const from = i === 0 ? 0 : tokens[i - 1].end;
    const to = i < tokens.length ? tokens[i].start : this.source.length;
    return this.source.slice(from, to);
  }

  /** Line breaks in the gap before token `i`, i.e. 1 + the blank lines. */
  breaksBefore(i: number): number {
    const gap = this.origGap(i);
    let n = 0;
    for (let k = 0; k < gap.length; k++) if (gap[k] === "\n") n++;
    return n;
  }

  private write(i: number, text: string): void {
    if (i <= this.last) {
      throw new Error(
        `formatter: token ${i} placed out of order (last was ${this.last})`,
      );
    }
    // Only the byte-order mark may legally abut its neighbour: the lexer emits
    // it as its own token at offset 0 and the next token can start at 1.
    // Anywhere else an empty gap MERGES two tokens, which is the invariant.
    if (
      text === "" &&
      this.last >= 0 &&
      !(
        this.last === 0 &&
        this.parse.tokens[0].isTrivia &&
        this.origGap(i) === ""
      )
    ) {
      text = " ";
    }
    this.gaps[i] = text;
    this.last = i;
  }

  /** Place token `i` on the line already in progress. */
  placeSameLine(i: number): void {
    if (this.last < 0) {
      // Nothing precedes it, so "same line" means the start of the file.
      this.write(i, "");
      return;
    }
    const orig = this.origGap(i);
    const keep = this.opts.intraLineSpacing === "preserve" && !hasBreak(orig);
    this.write(i, keep ? orig : " ");
  }

  /**
   * Place token `i` at the start of a fresh line, `blankLines` empty lines
   * above it. A leading break is suppressed at the top of the file, so a
   * script never starts with a blank line it did not have.
   */
  placeOnLine(i: number, indent: string, blankLines: number): void {
    this.lineIndent = indent;
    if (this.last < 0) {
      this.write(i, indent);
      return;
    }
    this.write(i, this.opts.eol.repeat(1 + Math.max(0, blankLines)) + indent);
  }

  /**
   * Place token `i` keeping its original gap, shifting only indentation.
   *
   * For the inside of a multi-line comment and for a `RawNode`. A uniform
   * prefix swap is what preserves an ASCII-art box or an aligned table through
   * a change of indent level; recomputing each line's indent would not, and
   * expanding tabs to do the arithmetic is the trap in the obvious
   * alternative (design Sec.4.2).
   */
  placeVerbatim(i: number, oldIndent: string, newIndent: string): void {
    const orig = this.origGap(i);
    if (!hasBreak(orig)) {
      // Intra-line spacing inside a comment is never collapsed, whatever the
      // policy says. That spacing IS the comment.
      this.write(i, orig);
      return;
    }
    let out = "";
    let cursor = 0;
    const breakPattern = /\r?\n[ \t]*/g;
    let match: RegExpExecArray | null;
    while ((match = breakPattern.exec(orig)) !== null) {
      out += orig.slice(cursor, match.index).replace(/[ \t]+$/, "");
      const ws = match[0].replace(/^\r?\n/, "");
      out +=
        this.opts.eol +
        (ws.startsWith(oldIndent)
          ? newIndent + ws.slice(oldIndent.length)
          : ws);
      cursor = match.index + match[0].length;
    }
    out += orig.slice(cursor);
    this.write(i, out);
    // The line in progress is now the comment's last line.
    const lastBreak = out.lastIndexOf("\n");
    this.lineIndent =
      lastBreak < 0
        ? this.lineIndent
        : /^[ \t]*/.exec(out.slice(lastBreak + 1))![0];
  }

  /**
   * Close the file and hand back the text.
   *
   * The final newline is PRESERVED, present or absent: 30 of 51 corpus files
   * end without one and adding it would be an unrequested edit at the bottom
   * of each.
   */
  finish(): string {
    const tokens = this.parse.tokens;
    const tail = this.origGap(tokens.length);
    this.gaps[tokens.length] = hasBreak(tail) ? this.opts.eol : "";

    const parts: string[] = [];
    this.starts = new Array<number>(tokens.length);
    let offset = 0;
    for (let i = 0; i < tokens.length; i++) {
      const gap = this.gaps[i];
      if (gap === undefined)
        throw new Error(`formatter: token ${i} was never placed`);
      offset += gap.length;
      this.starts[i] = offset;
      offset += tokens[i].text.length;
      parts.push(gap, tokens[i].text);
    }
    parts.push(this.gaps[tokens.length]!);
    return parts.join("");
  }

  /**
   * Where each token landed in the formatted text. Valid only after `finish()`.
   *
   * The diff preview needs to say "this original line became these output
   * lines", and the token array is the only thing the two texts share. Token
   * `i` is the same token in both, so its two offsets are the correspondence.
   */
  tokenStarts(): readonly number[] {
    return this.starts;
  }

  /**
   * One edit per changed gap, coalesced across short unchanged stretches.
   *
   * Uncoalesced, a badly indented 4,000-line map yields tens of thousands of
   * edits and `pushEditOperations` has to sort and apply every one. Merging
   * across runs shorter than `maxUnchanged` characters costs a little payload
   * and takes the count down by roughly an order of magnitude.
   *
   * Ascending and non-overlapping by construction, which is exactly what
   * protocol.ts's `validateEdits` requires.
   */
  edits(maxUnchanged = 80): SourceEdit[] {
    const tokens = this.parse.tokens;
    const out: SourceEdit[] = [];
    /** The open edit: gap indices [from, to] inclusive, still growing. */
    let from = -1;
    let to = -1;

    const flush = () => {
      if (from < 0) return;
      const start = from === 0 ? 0 : tokens[from - 1].end;
      const end = to < tokens.length ? tokens[to].start : this.source.length;
      let text = this.gaps[from]!;
      for (let i = from; i < to; i++)
        text += tokens[i].text + this.gaps[i + 1]!;
      if (this.source.slice(start, end) !== text)
        out.push({ start, end, newText: text });
      from = -1;
      to = -1;
    };

    for (let i = 0; i <= tokens.length; i++) {
      if (this.gaps[i] === this.origGap(i)) continue;
      if (from >= 0) {
        // Characters of unchanged source between the open edit and this gap.
        const between = tokens[i - 1].end - tokens[to].start;
        if (between > maxUnchanged) flush();
      }
      if (from < 0) from = i;
      to = i;
    }
    flush();
    return out;
  }
}
