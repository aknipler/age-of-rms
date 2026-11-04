// The game's token filter, docs/preview-design.md Sec.3 (rev 11). PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// The game reads a script as a stream of tokens. `if`, `start_random` and
// their partners switch tokens on and off as they go by, wherever they sit,
// so a conditional may open in one section and close in another. Rage Forest
// writes three whole <LAND_GENERATION> sections inside one `if` and keeps
// one of them. The parser cannot give that a tree, so it degrades such a
// stretch to a raw region (RMS0110), and an AST walk that skipped raw text
// lost every command in it.
//
// So for a script with such a region, `instantiate.ts` runs this filter
// first. It reads the tokens in order the way the game does, spending every
// draw where the game spends it, and writes the script back out with every
// dead token and every control token replaced by spaces and every rnd()
// replaced by the number it drew. Blanking in place keeps every offset and
// every line where it was, so the spans of the commands parsed from the
// result still point at the author's own text. This is a project choice;
// the usual alternative, a source map from the filtered text back to the
// original, would need every span in the pipeline translated.
//
// The rules, from de-findings-cg-cj.md Section 2 and de-land-stage.md Section 3;
//   - every rnd() draws where it is read, in live text and in dead text;
//   - a start_random block rolls when it is reached, before anything inside
//     it, and a block in dead text never rolls;
//   - the first branch whose running total of percent_chance reaches the
//     roll is taken;
//   - a bare `elseif`, followed by something that cannot be a label, acts as
//     `else`;
//   - `#const NAME rnd(a,b)` draws once, where it is written, and the first
//     definition of a name wins;
//   - `set_zone_randomly`, and `assign_to AT_TEAM` in random mode, each take
//     one draw where they are read, when they are live.
//
// Include files (amended 2026-11-02, includes.ts). A live `#include_drs`
// reads the file's text in where it stands, through this same filter, so its
// `#const`, `#define`, conditionals and commands count as if written there.
// One in a dead branch reads nothing and draws nothing. A file that cannot
// be read reads as empty. Reading in adds text, so here alone the output
// is longer than the source. Each insertion is returned, and instantiate.ts
// maps every span back to the author's text through them. Conditionals do
// not cross a file's end, the reading the DE study's model took.

import type { ParseResult, Span, Token } from "../../parser/types";
import type { DeStream } from "./deRandom";
import { includeKey, type Insertion } from "./includes";
import { evaluateExpressionTokens } from "./mathEval";

const RND = /^rnd\((-?[^,()\s]+),(-?[^,()\s]+)\)$/;
const INTEGER = /^-?\d+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * The bounds of an `rnd(a,b)` token, or undefined for any other token. A
 * name as a bound reads as 0 (de-findings-cg-cj.md 2.6).
 */
export function rndBounds(text: string): [number, number] | undefined {
  const m = RND.exec(text);
  if (!m) return undefined;
  const bound = (b: string): number => (INTEGER.test(b) ? Number(b) : 0);
  return [bound(m[1]), bound(m[2])];
}

export interface FilteredScript {
  /**
   * The source with dead and control tokens blanked and every live rnd()
   * replaced by its value. Same length and lines as the source, except
   * where a live include was read in (`insertions`).
   */
  text: string;
  /** The draw each live `assign_to` or `set_zone_randomly` took, by the offset of its name token in `text`. */
  attributeDraws: Map<number, number>;
  /** Each include file read into `text`, in order. Empty without includes. */
  insertions: Insertion[];
  /** The paths of live includes that could not be read, in reading order. */
  missingIncludes: string[];
}

/** How the filter reads include files. Without one, `#include_drs` stays in the text as written. */
export interface IncludeSource {
  /** An include's text by `includeKey(path)`, or undefined when it cannot be read. */
  read(key: string): string | undefined;
  /** The tokens the parser gives a file's text, comments marked as trivia. */
  tokens(text: string): readonly Token[];
}

/** One file's filtered text, its draws by offset in that text, and where its includes went. */
interface FilteredFile {
  text: string;
  draws: Map<number, number>;
  insertions: Insertion[];
}

/** An include file's text is wrapped in line breaks, so its first and last tokens never join the author's. */
const INCLUDE_PAD = "\n";

interface IfFrame {
  kind: "if";
  outerLive: boolean;
  taken: boolean;
  on: boolean;
}

interface RandomFrame {
  kind: "random";
  outerLive: boolean;
  roll: number;
  total: number;
  taken: boolean;
  on: boolean;
}

/**
 * Runs the game's token filter over `parse`. `isLabel` answers whether a
 * lobby label is defined. `controlKeywords` is the parser's set, used for
 * the bare `elseif` test. Every draw comes off `stream`. With `includes`,
 * every live `#include_drs` is read in where it stands.
 */
export function filterScript(
  parse: ParseResult,
  isLabel: (name: string) => boolean,
  controlKeywords: ReadonlySet<string>,
  stream: DeStream,
  includes?: IncludeSource,
): FilteredScript {
  // Shared by every file, since a constant an include defines is defined
  // for the rest of the script.
  const symbols = new Map<string, number | undefined>();
  const defined = (name: string): boolean => isLabel(name) || symbols.has(name);
  const valueOf = (text: string): number | undefined => {
    if (NUMBER.test(text)) return Number(text);
    return symbols.get(text);
  };
  /** A token that cannot be a label, the parser's own test for a missing condition. */
  const structural = (t: Token | undefined): boolean =>
    t === undefined ||
    t.kind === "openBrace" ||
    t.kind === "closeBrace" ||
    t.kind === "sectionHeader" ||
    t.kind === "directive" ||
    (t.kind === "word" && controlKeywords.has(t.text));
  /** Draws for an rnd() token, live or dead. Returns its value. */
  const draw = (t: Token): number | undefined => {
    const bounds = rndBounds(t.text);
    if (!bounds) return undefined;
    return bounds[0] + stream.bounded(bounds[1] - bounds[0] + 1);
  };
  const missingIncludes: string[] = [];
  /** The include files being read, so a file that includes itself reads as empty rather than forever. */
  const open: string[] = [];

  /**
   * The index of the last token of the path that starts at `k`. A quoted
   * path with a space in it runs to the token that closes the quote, and
   * one that never closes before a structural token is the first token alone.
   */
  function pathEnd(tokens: readonly Token[], k: number): number {
    const first = tokens[k];
    if (!first.text.startsWith('"')) return k;
    if (first.text.length > 1 && first.text.endsWith('"')) return k;
    for (let j = k + 1; j < tokens.length && !structural(tokens[j]); j++)
      if (tokens[j].text.endsWith('"')) return j;
    return k;
  }

  function filterFile(
    source: string,
    allTokens: readonly Token[],
  ): FilteredFile {
    const tokens = allTokens.filter((t) => !t.isTrivia);
    const out = source.split("");
    const blank = (t: Token): void => {
      for (let i = t.start; i < t.end; i++) out[i] = " ";
    };
    const replace = (t: Token, value: number): void => {
      const text = String(value);
      for (let i = t.start; i < t.end; i++)
        out[i] = i - t.start < text.length ? text[i - t.start] : " ";
    };
    const draws = new Map<number, number>();
    const frames: (IfFrame | RandomFrame)[] = [];
    const live = (): boolean => frames.every((f) => f.on);
    /** The include files read in, by the offset in `source` where each goes. */
    const reads: { at: number; directive: Span; file: FilteredFile }[] = [];

    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      const isLive = live();
      switch (t.text) {
        case "if":
        case "elseif": {
          blank(t);
          const next = tokens[k + 1];
          const bare = structural(next);
          if (!bare) {
            blank(next);
            k++;
          }
          if (t.text === "if") {
            const on = isLive && !bare && defined(next.text);
            frames.push({ kind: "if", outerLive: isLive, taken: on, on });
            continue;
          }
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "if") continue;
          frame.on =
            frame.outerLive && !frame.taken && (bare || defined(next.text));
          frame.taken ||= frame.on;
          continue;
        }
        case "else": {
          blank(t);
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "if") continue;
          frame.on = frame.outerLive && !frame.taken;
          frame.taken = true;
          continue;
        }
        case "endif":
          blank(t);
          if (frames[frames.length - 1]?.kind === "if") frames.pop();
          continue;
        case "start_random":
          blank(t);
          frames.push({
            kind: "random",
            outerLive: isLive,
            roll: isLive ? stream.bounded(100) : 0,
            total: 0,
            taken: false,
            on: isLive,
          });
          continue;
        case "percent_chance": {
          blank(t);
          const next = tokens[k + 1];
          const frame = frames[frames.length - 1];
          if (next === undefined || frame?.kind !== "random") continue;
          blank(next);
          k++;
          const chance = draw(next) ?? valueOf(next.text) ?? 0;
          frame.total += chance;
          frame.on =
            frame.outerLive && !frame.taken && frame.total >= frame.roll;
          frame.taken ||= frame.on;
          continue;
        }
        case "end_random":
          blank(t);
          if (frames[frames.length - 1]?.kind === "random") frames.pop();
          continue;
      }

      if (
        includes !== undefined &&
        t.kind === "directive" &&
        t.text === "#include_drs" &&
        k + 1 < tokens.length &&
        !structural(tokens[k + 1])
      ) {
        const last = pathEnd(tokens, k + 1);
        const pathFirst = tokens[k + 1];
        const pathLast = tokens[last];
        for (let j = k; j <= last; j++) blank(tokens[j]);
        k = last;
        if (!isLive) continue;
        const path = source.slice(pathFirst.start, pathLast.end);
        const key = includeKey(path);
        const text = open.includes(key) ? undefined : includes.read(key);
        if (text === undefined) {
          missingIncludes.push(path);
          continue;
        }
        open.push(key);
        const file = filterFile(text, includes.tokens(text));
        open.pop();
        reads.push({
          at: pathLast.end,
          directive: { start: t.start, end: pathLast.end },
          file,
        });
        continue;
      }

      if (
        t.kind === "directive" &&
        (t.text === "#const" || t.text === "#define")
      ) {
        const name = tokens[k + 1];
        if (!isLive) blank(t);
        if (name === undefined) continue;
        if (!isLive) blank(name);
        k++;
        if (t.text === "#define") {
          if (isLive && !symbols.has(name.text))
            symbols.set(name.text, undefined);
          continue;
        }
        // The value is one token, or a parenthesised expression of several.
        const first = tokens[k + 1];
        if (first === undefined) continue;
        let last = k + 1;
        if (first.text.startsWith("(") && !first.text.endsWith(")"))
          while (last + 1 < tokens.length && !tokens[last].text.endsWith(")"))
            last++;
        const valueTokens = tokens.slice(k + 1, last + 1);
        k = last;
        const drawn = draw(first);
        if (!isLive) {
          for (const v of valueTokens) blank(v);
          continue;
        }
        if (drawn !== undefined) replace(first, drawn);
        if (symbols.has(name.text)) continue;
        symbols.set(
          name.text,
          drawn ??
            (valueTokens.length > 1
              ? evaluateExpressionTokens(
                  valueTokens.map((v) => v.text),
                  (n) => symbols.get(n),
                )
              : valueOf(first.text)),
        );
        continue;
      }

      const drawn = draw(t);
      if (!isLive) {
        blank(t);
        continue;
      }
      if (drawn !== undefined) {
        replace(t, drawn);
        continue;
      }
      if (t.text === "set_zone_randomly") draws.set(t.start, stream.raw());
      else if (t.text === "assign_to" && tokens[k + 1]?.text === "AT_TEAM") {
        const mode = tokens[k + 3];
        if (mode !== undefined && valueOf(mode.text) === 0)
          draws.set(t.start, stream.raw());
      }
    }

    // Splice the files read in. Every offset after an insertion moves by
    // its length, this file's own draws included, and an included file's
    // draws move to where its text now starts.
    const filtered = out.join("");
    if (reads.length === 0) return { text: filtered, draws, insertions: [] };
    const pieces: string[] = [];
    const insertions: Insertion[] = [];
    const moved = new Map<number, number>();
    let pos = 0;
    let shift = 0;
    for (const { at, directive, file } of reads) {
      pieces.push(filtered.slice(pos, at), INCLUDE_PAD, file.text, INCLUDE_PAD);
      const base = at + shift + INCLUDE_PAD.length;
      for (const [offset, value] of file.draws) moved.set(base + offset, value);
      const length = file.text.length + 2 * INCLUDE_PAD.length;
      insertions.push({ at, length, directive });
      shift += length;
      pos = at;
    }
    pieces.push(filtered.slice(pos));
    for (const [offset, value] of draws) {
      let by = 0;
      for (const ins of insertions) if (ins.at <= offset) by += ins.length;
      moved.set(offset + by, value);
    }
    return { text: pieces.join(""), draws: moved, insertions };
  }

  const top = filterFile(parse.source, parse.tokens);
  return {
    text: top.text,
    attributeDraws: top.draws,
    insertions: top.insertions,
    missingIncludes,
  };
}
