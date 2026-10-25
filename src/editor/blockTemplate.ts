// Block templates for the Code editor (docs/name-lookup-design.md Sec.13.4).
// Once a block command's line is complete, its whole block is offered,
// copied from the script's last block of the same command, with every value
// a snippet tab stop the person keeps with Tab or types over.
//
// Pure, no Monaco import. The result is a snippet STRING in Monaco's
// (TextMate's) snippet syntax, which is plain text with `${1:value}` marks,
// so building it needs no Monaco types. aoe2RmsPrediction.ts hands it over.
//
// WHY A TEMPLATE AND NOT A COPY. Replaying the corpus, a copied block was
// exactly right 15% of the time, while its attribute names were right and in
// order 81% of the time and 84% of its values already matched (Sec.13.1).
// So the shape is copied as fixed text and every value becomes a tab stop
// that starts out holding the old value.

import type { LanguageIndex } from "../parser/language";
import { lineOfOffset } from "../parser/lineIndex";
import type { CommandNode, Item, ParseResult } from "../parser/types";
import {
  closedBlockCommands,
  findSkeleton,
  type BlockSkeletonData,
} from "./blockSkeletons";
import type { CaretContext } from "./caretContext";
import { argTokens, sharedPrefixLength } from "./linePrediction";

export interface BlockTemplate {
  /** Monaco snippet text, inserted at the caret. Starts with the `{` and ends with the final tab stop after `}`. */
  snippet: string;
  /** Where the block came from, for the tests and the run sheet. */
  source: "script" | "skeleton";
}

/**
 * The block to offer at the caret, or null for none. `ctx` is caretContext's
 * answer at the caret. `parse` can lag `text` by a few keystrokes, so only
 * blocks that close above the caret's line and above the first difference
 * between the two are read.
 */
export function blockTemplate(
  text: string,
  caret: number,
  ctx: CaretContext,
  lang: LanguageIndex,
  parse: ParseResult,
  skeletons: BlockSkeletonData | null,
): BlockTemplate | null {
  // The caret at the very end of its line. A multi-line inline completion
  // must end at the end of a line (Monaco's own rule for its range), and
  // text after the caret would be pushed below the block.
  const nl = text.indexOf("\n", caret);
  const lineEnd = nl === -1 ? text.length : nl;
  if (text.slice(caret, lineEnd).replace(/\r$/, "") !== "") return null;
  if (ctx.inBlock) return null;

  const line = commandLine(text, ctx);
  if (!line) return null;
  const def = lang.commandsByName.get(line.head);
  if (!def || def.kind !== "block") return null;
  const required = (def.arguments ?? []).filter(
    (a) => !a.optional && !a.variadic,
  ).length;
  if (line.args.length < required) return null;
  if (braceFollows(text, lineEnd)) return null;

  const limit = Math.min(
    ctx.lineStart,
    sharedPrefixLength(parse.source, text, ctx.lineStart),
  );
  const above = closedBlockCommands(parse).filter(
    (c) => parse.tokens[c.block!.close!].end <= limit,
  );
  const typedArgs = line.args.join(" ");
  let sameName: CommandNode | undefined;
  let sameArgs: CommandNode | undefined;
  for (const c of above) {
    if (c.def!.name !== def.name) continue;
    sameName = c;
    if (commandArgs(parse, c).join(" ") === typedArgs) sameArgs = c;
  }
  const source = sameArgs ?? sameName;
  if (source)
    return { snippet: snippetFromBlock(parse, source), source: "script" };

  const skeleton = skeletons && findSkeleton(skeletons, def.name, line.args);
  if (!skeleton) return null;
  const tabs = new TabStops();
  const body = skeleton.attributes.map(
    (a) =>
      "\n\t" +
      escapeSnippet(a.name) +
      a.values.map((v) => " " + tabs.next(v)).join(""),
  );
  return {
    snippet:
      (braceGoesBelow(parse, above) ? "\n{" : " {") + body.join("") + "\n}$0",
    source: "skeleton",
  };
}

/** The command and the arguments typed on the caret's line, when the line holds nothing else. */
function commandLine(
  text: string,
  ctx: CaretContext,
): { head: string; args: string[] } | null {
  const st = ctx.statement;
  if (st) {
    if (!st.firstOnLine) return null;
    return {
      head: st.head,
      args: ctx.word === "" ? st.args : [...st.args, ctx.word],
    };
  }
  // A command with no argument typed yet, `create_land|`. The word is the
  // command itself, so no statement was found before it.
  if (
    ctx.slot?.kind === "lineStart" &&
    ctx.word !== "" &&
    text.slice(ctx.lineStart, ctx.wordStart).trim() === ""
  )
    return { head: ctx.word, args: [] };
  return null;
}

/** True when the next line that is not blank starts with `{`. */
function braceFollows(text: string, lineEnd: number): boolean {
  let i = lineEnd;
  while (i < text.length && /\s/.test(text[i])) i++;
  return text[i] === "{";
}

function commandArgs(parse: ParseResult, c: CommandNode): string[] {
  return c.args.map((a) =>
    argTokens(parse.tokens, a.firstToken, a.lastToken).join(" "),
  );
}

/**
 * Where the script's blocks above put their `{`. True when most put it
 * on the line below the command. False on a tie and when there are none,
 * which puts it on the command's own line.
 */
function braceGoesBelow(
  parse: ParseResult,
  blocks: readonly CommandNode[],
): boolean {
  let below = 0;
  for (const c of blocks) if (braceIsBelow(parse, c)) below++;
  return below * 2 > blocks.length;
}

function braceIsBelow(parse: ParseResult, c: CommandNode): boolean {
  const t = parse.tokens;
  const lastHead =
    c.args.length === 0 ? c.name : c.args[c.args.length - 1].lastToken;
  return (
    lineOfOffset(parse.lineOffsets, t[c.block!.open].start) !==
    lineOfOffset(parse.lineOffsets, t[lastHead].start)
  );
}

/** Numbers tab stops in reading order. */
class TabStops {
  private n = 0;
  next(value: string): string {
    this.n++;
    return `\${${this.n}:${escapeSnippet(value)}}`;
  }
}

/**
 * Snippet syntax reads `$`, `}` and backslash specially. Build artefacts
 * carry `$` words (BUG-002), and an unescaped one would become a tab stop.
 * Escaping `}` outside a placeholder is harmless, so every piece of copied
 * text goes through here.
 */
export function escapeSnippet(s: string): string {
  return s.replace(/[\\$}]/g, (c) => `\\${c}`);
}

/**
 * The source block rebuilt as a snippet. Fixed text is the braces, every
 * attribute name and every branch keyword with its condition. Each
 * attribute argument and each `percent_chance` number is a tab stop holding
 * the source's value. Comments are left out, since a comment describes the
 * block it was written for.
 *
 * The layout follows the source. A block on one line comes back on one
 * line. Otherwise each item goes on its own line, one indent deeper than
 * the command and a branch's items one more. Indents are written as tabs,
 * which Monaco turns into the editor's own indent unit and to which it adds
 * the command line's indent (spike S2, 2026-10-23).
 */
export function snippetFromBlock(parse: ParseResult, cmd: CommandNode): string {
  const t = parse.tokens;
  const block = cmd.block!;
  const tabs = new TabStops();
  const lines: { depth: number; text: string }[] = [];
  const literal = (first: number, last: number) =>
    escapeSnippet(argTokens(t, first, last).join(" "));

  const walk = (items: readonly Item[], depth: number) => {
    for (const item of items) {
      switch (item.kind) {
        case "attribute":
          lines.push({
            depth,
            text:
              escapeSnippet(t[item.name].text) +
              item.args
                .map(
                  (a) =>
                    " " +
                    tabs.next(
                      argTokens(t, a.firstToken, a.lastToken).join(" "),
                    ),
                )
                .join(""),
          });
          break;
        case "if":
          for (const b of item.branches) {
            lines.push({
              depth,
              text:
                escapeSnippet(t[b.keyword].text) +
                (b.condition !== undefined
                  ? " " + escapeSnippet(t[b.condition].text)
                  : ""),
            });
            walk(b.items, depth + 1);
          }
          if (item.endif !== undefined)
            lines.push({ depth, text: escapeSnippet(t[item.endif].text) });
          break;
        case "random":
          lines.push({ depth, text: escapeSnippet(t[item.start].text) });
          walk(item.preamble, depth + 1);
          for (const b of item.branches) {
            lines.push({
              depth,
              text:
                escapeSnippet(t[b.chanceKeyword].text) +
                (b.chance
                  ? " " +
                    tabs.next(
                      argTokens(
                        t,
                        b.chance.firstToken,
                        b.chance.lastToken,
                      ).join(" "),
                    )
                  : ""),
            });
            walk(b.items, depth + 1);
          }
          if (item.end !== undefined)
            lines.push({ depth, text: escapeSnippet(t[item.end].text) });
          break;
        default:
          // A directive, a stray command or an unparsed run, copied as it
          // reads. Never dropped, since leaving out a line the source block
          // had would change what the block does.
          lines.push({ depth, text: literal(item.firstToken, item.lastToken) });
          break;
      }
    }
  };
  walk(block.items, 1);

  const lineOf = (tokenIndex: number) =>
    lineOfOffset(parse.lineOffsets, t[tokenIndex].start);
  const open = braceIsBelow(parse, cmd) ? "\n{" : " {";
  if (lineOf(block.open) === lineOf(block.close!)) {
    const inner = lines.map((l) => l.text).join(" ");
    return `${open}${inner === "" ? "" : " " + inner} }$0`;
  }
  const body = lines.map((l) => "\n" + "\t".repeat(l.depth) + l.text).join("");
  return `${open}${body}\n}$0`;
}
