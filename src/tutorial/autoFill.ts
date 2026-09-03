// A step's `autoFill` button performs the step's own instructions for the
// user rather than teaching a new mechanism, so it deliberately bypasses the
// Breakdown patch engine's node-anchored intents (addCommand/addAttribute):
// those need the newly-created node back before the next attribute can
// target it, which isn't available synchronously outside a React re-render.
// One text edit, built directly from the current ParseResult, is simpler and
// exactly matches what a user who typed all of this by hand would produce.

import type { Item, ParseResult, SectionNode } from "../parser/types";
import { detectEol, detectIndentStep, lineIndentOf } from "../breakdown/patch/formatStyle";
import type { StepTextEdit } from "./types";

function lastSectionNamed(parse: ParseResult, name: string): SectionNode | undefined {
  const target = name.toLowerCase();
  const matches = parse.script.sections.filter((s) => s.name.toLowerCase() === target);
  return matches[matches.length - 1];
}

/**
 * Appends fully-formed `create_object` blocks after the last top-level item
 * of `section`'s last concrete SectionNode, same anchor rule
 * computeEdit.ts's insertIntoSection uses for a single Add Command click
 * (docs/breakdown-design.md Sec.3.1's "last section of that type"), applied
 * to a whole batch in one edit. Returns null when the section doesn't exist
 * yet (nothing to anchor to, shouldn't happen by the time this step is
 * reachable, since it always follows a step that creates the section, but
 * the button has nothing safe to do if it somehow is skipped ahead of).
 */
export function appendObjectBlocks(
  parse: ParseResult,
  section: string,
  blocks: { name: string; attributes: string[] }[],
): StepTextEdit | null {
  const target = lastSectionNamed(parse, section);
  if (!target) return null;

  const src = parse.source;
  const tokens = parse.tokens;
  const eol = detectEol(src);
  const step = detectIndentStep(src);
  const items: readonly Item[] = target.items;
  const last = items[items.length - 1];

  const anchorEnd = last ? tokens[last.lastToken].end : tokens[target.header].end;
  const indent = last ? lineIndentOf(src, last.span.start) : lineIndentOf(src, tokens[target.header].start);
  const inner = indent + step;

  const rendered = blocks
    .map((b) => [`${indent}create_object ${b.name} {`, ...b.attributes.map((a) => `${inner}${a}`), `${indent}}`].join(eol))
    .join(eol);

  return { start: anchorEnd, end: anchorEnd, newText: eol + rendered };
}
