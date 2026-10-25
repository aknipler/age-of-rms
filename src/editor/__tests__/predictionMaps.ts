// The maps line and block prediction are measured on and built from
// (docs/name-lookup-design.md Sec.13.1), and the replay that measures them.
// Shared by the replay gate and the skeleton generator so the two can never
// disagree about what a fixture is.

import type { LanguageData, LanguageIndex } from "../../parser/language";
import { parseRms } from "../../parser/parser";
import type { CommandNode, Item, ParseResult } from "../../parser/types";
import { closedBlockCommands } from "../blockSkeletons";
import { blockTemplate } from "../blockTemplate";
import { caretContext } from "../caretContext";
import {
  argTokens,
  buildStatementIndex,
  lastArgToken,
  predictLine,
} from "../linePrediction";

export interface LineReplay {
  /** Command and attribute statements with something after their first word. */
  statements: number;
  offered: number;
  exact: number;
}

/**
 * Sec.13.1's line replay through the shipped code. For every command and
 * attribute statement with an argument, the text is cut right after its
 * first word and a space, and the prediction there is compared with what
 * the map actually wrote, tokens joined by single spaces.
 */
export function replayLines(
  source: string,
  parse: ParseResult,
  lang: LanguageIndex,
): LineReplay {
  const index = buildStatementIndex(parse);
  const t = parse.tokens;
  const out: LineReplay = { statements: 0, offered: 0, exact: 0 };
  for (const s of statements(parse)) {
    const actual = argTokens(t, s.name + 1, lastArgToken(s.name, s.args));
    if (actual.length === 0) continue;
    out.statements++;
    const text = source.slice(0, t[s.name].end) + " ";
    const ctx = caretContext(text, text.length, lang, parse);
    const got = predictLine(text, text.length, ctx, index);
    if (got === null) continue;
    out.offered++;
    if (got === actual.join(" ")) out.exact++;
  }
  return out;
}

export interface BlockReplay {
  /** Closed blocks of block commands. */
  blocks: number;
  offered: number;
  /** The inserted block holds the same attribute names in the same order, branches included. */
  sameNames: number;
  /** The inserted block, with every tab stop left at its starting value, is the block the map wrote. */
  exact: number;
}

/**
 * Sec.13.1's block replay through the shipped code, script source only
 * (skeletons off, since the gate pins the script rule). The text is cut at
 * the end of each block command's line, and the template offered there is
 * inserted with its starting values and parsed back, so the comparison is
 * on what the person would actually get.
 */
export function replayBlocks(
  source: string,
  parse: ParseResult,
  lang: LanguageIndex,
  langData: LanguageData,
): BlockReplay {
  const t = parse.tokens;
  const out: BlockReplay = { blocks: 0, offered: 0, sameNames: 0, exact: 0 };
  for (const cmd of closedBlockCommands(parse)) {
    out.blocks++;
    const caret = t[lastArgToken(cmd.name, cmd.args)].end;
    const text = source.slice(0, caret);
    const ctx = caretContext(text, caret, lang, parse);
    const got = blockTemplate(text, caret, ctx, lang, parse, null);
    if (!got) continue;
    out.offered++;
    const inserted =
      source.slice(t[cmd.name].start, caret) + resolve(got.snippet);
    const back = parseRms(inserted, langData);
    const rebuilt = back.script.preamble.find(
      (i): i is CommandNode => i.kind === "command" && i.block !== undefined,
    );
    if (!rebuilt) continue;
    if (
      attributeNames(back, rebuilt.block!.items).join(" ") ===
      attributeNames(parse, cmd.block!.items).join(" ")
    )
      out.sameNames++;
    if (blockTokens(back, rebuilt) === blockTokens(parse, cmd)) out.exact++;
  }
  return out;
}

/** A snippet as it reads with every tab stop left at its starting value. */
export function resolve(snippet: string): string {
  return snippet
    .replace(/\$\{\d+:((?:\\.|[^}\\])*)\}/g, "$1")
    .replace(/\$0/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\t/g, "  ");
}

function statements(parse: ParseResult) {
  const out: { name: number; args: { lastToken: number }[] }[] = [];
  const walk = (items: readonly Item[]) => {
    for (const item of items) {
      if (item.kind === "command") {
        out.push(item);
        if (item.block) walk(item.block.items);
      } else if (item.kind === "attribute") out.push(item);
      else if (item.kind === "if") for (const b of item.branches) walk(b.items);
      else if (item.kind === "random") {
        walk(item.preamble);
        for (const b of item.branches) walk(b.items);
      }
    }
  };
  walk(parse.script.preamble);
  for (const s of parse.script.sections) walk(s.items);
  return out;
}

function attributeNames(parse: ParseResult, items: readonly Item[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === "attribute") out.push(parse.tokens[item.name].text);
    else if (item.kind === "if")
      for (const b of item.branches)
        out.push(...attributeNames(parse, b.items));
    else if (item.kind === "random") {
      out.push(...attributeNames(parse, item.preamble));
      for (const b of item.branches)
        out.push(...attributeNames(parse, b.items));
    }
  }
  return out;
}

function blockTokens(parse: ParseResult, cmd: CommandNode): string {
  const b = cmd.block!;
  return argTokens(parse.tokens, b.open, b.close!).join(" ");
}

/**
 * The app's own fixtures, left out of every prediction figure. They were
 * written to exercise the app rather than to make a map, and several are
 * near copies of one another, so counting them would credit the prediction
 * with repetition nobody typed.
 */
export function isAppFixture(fileName: string): boolean {
  const n = fileName.toLowerCase();
  return (
    n.startsWith("test") ||
    [
      "sample.rms",
      "new_map.rms",
      "tour.rms",
      "gold.rms",
      "golden_hill.rms",
      "alp_test.rms",
    ].includes(n)
  );
}

/**
 * The maps `.gitignore` tracks, less `sample.rms`. The replay gate pins its
 * figures on exactly these, so the number a clone measures is the number
 * this disk measures. Every other map here is untracked, and a gate that
 * read them would pin a figure CI cannot reproduce.
 */
export const TRACKED_PREDICTION_MAPS = [
  "13_Rings_v1.2.rms",
  "AD4 - Ra.rms",
  "AK_ForeDaut_v1.3.rms",
  "AK_Hourglass_v2.0.rms",
  "AK_Namatjira.rms",
  "AK_Six_Points_v1.4.rms",
  "AK_Vanguard_v1.2.rms",
  "Bulls_Eyes.rms",
  "Chaotic_Straitv0.99.rms",
  "Comeer v1.5.rms",
  "Menindee_AUS_v2.3.rms",
  "Venn.rms",
] as const;
