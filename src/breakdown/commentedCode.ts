// Commented-out code in the Breakdown (2026-10-23, breakdown-design
// Sec.3.14). A comment whose text reads as RMS renders as the cards it would
// be if uncommented, in italics, and stays editable. Pure, no React, so the
// two decisions it makes can be tested on their own:
//
// - whether a comment's text is code at all (parseCommentedCode), and
// - how an edit to those cards becomes an edit to the comment
//   (commentRangeEdit).

import { parseRms } from "../parser/parser";
import type { LanguageIndex } from "../parser/language";
import type { Item, ParseResult } from "../parser/types";
import { padCommentContent } from "./comments";

/**
 * Every item is a command, directive, if or start_random the language knows,
 * all the way down. One word the language does not know (the "Half" of
 * "Half the time, add a forest island") makes the whole text prose. A known
 * command with a misspelt attribute inside its block still counts as code,
 * since that is a typo in code rather than a sentence.
 */
function isKnownCode(item: Item): boolean {
  switch (item.kind) {
    case "command":
    case "directive":
      return item.def !== undefined;
    case "if":
      return item.branches.every((b) => b.items.every(isKnownCode));
    case "random":
      return (
        item.preamble.length === 0 &&
        item.branches.every((b) => b.items.every(isKnownCode))
      );
    default:
      return false;
  }
}

/**
 * The comment's text parsed as RMS, or null when it is prose. Text with a
 * section header, or with any parse error, stays prose too. A section header
 * would need a tab of its own to show, and a parse error means a card would
 * be a guess at what the person meant.
 */
export function parseCommentedCode(
  inner: string,
  lang: LanguageIndex,
): ParseResult | null {
  if (inner.trim() === "") return null;
  const parse = parseRms(inner, lang.data);
  if (parse.script.sections.length > 0) return null;
  const items = parse.script.preamble;
  if (items.length === 0) return null;
  if (parse.diagnostics.some((d) => d.severity === "error")) return null;
  return items.every(isKnownCode) ? parse : null;
}

export interface CommentRangeEdit {
  /** Replaced range, as offsets into the old comment text. */
  start: number;
  end: number;
  /** The text editComment is given for that range. */
  text: string;
  /**
   * Turns an offset in the new comment text, as the patch engine computed
   * it before editComment padded the replacement, into an offset in the
   * text that actually lands.
   */
  mapNew: (offset: number) => number;
}

/**
 * The smallest editComment that turns `oldInner` into `newInner`, or null
 * when the result would no longer be one comment.
 *
 * Small, rather than replacing the whole comment text, because the pane
 * drops an expansion or focus anchor caught inside a replaced range. A
 * whole-text replacement would close every open card inside the comment on
 * every keystroke committed.
 *
 * editComment pads its text with a space at either end that lacks one
 * (comments.ts's padCommentContent, which keeps `/*` and `*\/` apart from
 * the content when the range touches them). A range in the middle of the
 * text must not grow spaces, so it is widened until its text starts and
 * ends with whitespace, and the padding then adds nothing. Only a range
 * reaching an end of the text can still be padded, which mapNew accounts
 * for.
 */
export function commentRangeEdit(
  oldInner: string,
  newInner: string,
): CommentRangeEdit | null {
  const max = Math.min(oldInner.length, newInner.length);
  let p = 0;
  while (p < max && oldInner[p] === newInner[p]) p++;
  let s = 0;
  while (
    s < max - p &&
    oldInner[oldInner.length - 1 - s] === newInner[newInner.length - 1 - s]
  )
    s++;
  let e = newInner.length - s;
  const ws = (c: string | undefined) => c !== undefined && /\s/.test(c);
  while (p > 0 && !(p < e && ws(newInner[p]))) p--;
  while (s > 0 && !(e > p && ws(newInner[e - 1]))) {
    s--;
    e++;
  }
  const text = newInner.slice(p, e);
  const padded = padCommentContent(text);
  const lead = text === "" || !ws(text[0]) ? 1 : 0;
  const trail = padded.length - text.length - lead;
  const final = newInner.slice(0, p) + padded + newInner.slice(e);
  if (final.includes("/*") || final.includes("*/")) return null;
  return {
    start: p,
    end: oldInner.length - s,
    text,
    mapNew: (x) => (x < p ? x : x <= e ? x + lead : x + lead + trail),
  };
}
