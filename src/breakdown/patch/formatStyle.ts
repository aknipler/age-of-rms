// Phase 3.3 — formatting inference + item rendering, docs/breakdown-design.md §4.3 (rev 4).
// All inference reads the source via token spans; nothing is guessed.

import type { ParseResult } from "../../parser/types";
import type { ArgumentDef, AttributeDef, CommandDef } from "../../parser/language";
import { NUMERIC_ARGUMENT_TYPES } from "../../parser/language";
import type { ArgValueInput } from "./intents";

export interface BlockStyle {
  indentUnit: string; // whitespace prefix for items one level inside the container
  onOwnLines: boolean;
  eol: "\n" | "\r\n";
}

export function detectEol(source: string): "\n" | "\r\n" {
  const i = source.indexOf("\n");
  return i > 0 && source[i - 1] === "\r" ? "\r\n" : "\n";
}

/** File-wide dominant indent step: tab if any line starts with one, else first space-run, else tab. */
export function detectIndentStep(source: string): string {
  if (/(^|\n)\t/.test(source)) return "\t";
  const m = /(^|\n)( +)\S/.exec(source);
  return m ? m[2] : "\t";
}

export function lineStartOf(source: string, pos: number): number {
  return source.lastIndexOf("\n", pos - 1) + 1;
}

export function lineIndentOf(source: string, pos: number): string {
  const ls = lineStartOf(source, pos);
  let i = ls;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(ls, i);
}

/**
 * Infer style for a container described by boundary offsets and its items'
 * spans. `openerEnd` = offset just after the container's opening construct
 * (header token, `{`, branch keyword+condition); `closerStart` = offset of
 * the closer (`}`/`endif`/next-branch keyword) or undefined; `itemSpans` =
 * the existing items' spans in order.
 */
export function inferStyle(
  result: ParseResult,
  openerEnd: number,
  closerStart: number | undefined,
  itemSpans: { start: number; end: number }[],
): BlockStyle {
  const src = result.source;
  const eol = detectEol(src);
  let onOwnLines: boolean;
  if (itemSpans.length > 0) {
    // Own-lines iff a newline separates the opener from the first item, or
    // any consecutive pair of items (spec §4.3).
    onOwnLines = /\n/.test(src.slice(openerEnd, itemSpans[0].start));
    for (let i = 1; !onOwnLines && i < itemSpans.length; i++) {
      onOwnLines = /\n/.test(src.slice(itemSpans[i - 1].end, itemSpans[i].start));
    }
  } else if (closerStart !== undefined) {
    onOwnLines = /\n/.test(src.slice(openerEnd, closerStart));
  } else {
    onOwnLines = true; // empty section / empty file default (spec §4.3)
  }

  let indentUnit: string;
  const firstOwnLineItem = itemSpans.find((s) => lineStartOf(src, s.start) > openerEnd);
  if (firstOwnLineItem) {
    indentUnit = lineIndentOf(src, firstOwnLineItem.start);
  } else {
    // Empty container (or all items inline): parent indent + one step.
    indentUnit = lineIndentOf(src, openerEnd) + detectIndentStep(src);
  }
  return { indentUnit, onOwnLines, eol };
}

// ---- value / item rendering (spec §4.3 "Rendering an item to text") ----

export function renderValue(value: ArgValueInput): string {
  if (typeof value === "number") {
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return String(value);
  }
  if (typeof value === "string") return value;
  return `rnd(${value.rnd[0]},${value.rnd[1]})`;
}

/**
 * Placeholder for a required arg with no supplied value (rev 4 pin):
 * numeric types → def.default ?? def.min ?? 0; constant/string → def.default
 * ?? "TODO". Both are always consumed as ArgNodes by the parser, so a
 * placeholder can never coalesce into an unknown-run (spec §4.3).
 */
export function placeholderFor(def: ArgumentDef): string {
  if (def.default !== undefined) return String(def.default);
  if (NUMERIC_ARGUMENT_TYPES.has(def.type)) return String(def.min ?? 0);
  return "TODO";
}

export interface Rendered {
  text: string;
  /** Offset within `text` of the first value the user should fill/see (caret target). */
  caretOffset: number;
}

/** `<name> <arg1> <arg2> …` from explicit values and/or placeholders. */
export function renderNamed(
  name: string,
  argDefs: ArgumentDef[] | undefined,
  values: ArgValueInput[] | undefined,
): Rendered {
  const parts: string[] = [name];
  let caretOffset = 0; // default: start of name
  const defs = argDefs ?? [];
  for (let i = 0; i < defs.length; i++) {
    const supplied = values?.[i];
    const text = supplied !== undefined ? renderValue(supplied) : placeholderFor(defs[i]);
    if (i === 0) caretOffset = parts.join(" ").length + 1;
    parts.push(text);
  }
  return { text: parts.join(" "), caretOffset };
}

export function renderAttribute(def: AttributeDef | undefined, name: string, values?: ArgValueInput[]): Rendered {
  return renderNamed(name, def?.arguments, values);
}

export function renderCommand(def: CommandDef | undefined, name: string): Rendered {
  // Bare command (no braces) even for block-kind defs: legal RMS; the block
  // is synthesized by the first addAttribute (§4.6) — one brace-adding path.
  return renderNamed(name, def?.arguments, undefined);
}
