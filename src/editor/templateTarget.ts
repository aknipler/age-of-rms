import type { InsertTarget } from "../breakdown/patch/intents";
import {
  templatesFor,
  type TemplateSection,
} from "../breakdown/templates/templates";
import { tokenIndexAt } from "../parser/nameLookup";
import type { Item, ParseResult, SectionNode } from "../parser/types";
import { holdingItem } from "./constOffers";

// Where "Add Template" in the Code tab's right-click menu writes, as plain
// data so it runs in Node. The Breakdown's button writes after the selected
// card, or at the end of the section. Code has a caret instead of a card, so
// this finds the same two things from an offset: which section the caret is
// in, and which item the new text goes after.
//
// Pure on purpose, no Monaco import, for the reason constOffers.ts gives.

export interface TemplateSpot {
  /** The section the caret is in, which picks the templates on offer. */
  section: TemplateSection;
  /** Where the template text goes. */
  target: InsertTarget;
}

/** True for the two sections that have templates of their own. */
function isTemplateSection(name: string): name is TemplateSection {
  return (
    (name === "OBJECTS_GENERATION" || name === "TERRAIN_GENERATION") &&
    templatesFor(name).length > 0
  );
}

/** The section whose span holds `offset`, or undefined in the header or between sections. */
function sectionAt(
  parse: ParseResult,
  offset: number,
): SectionNode | undefined {
  return parse.script.sections.find(
    (s) => offset >= s.span.start && offset <= s.span.end,
  );
}

/**
 * The spot for a template written at `offset`, or null when the caret is
 * outside a section that has templates. `parse` has to be a parse of the
 * text the offset belongs to, since the target holds nodes of that parse.
 *
 * The new text goes after the item the caret is in, so it never lands inside
 * a command's braces. A caret between items goes after the item above it,
 * before the first item when none is above, and into the section itself when
 * it is empty. A caret inside an `if` branch picks the item inside the
 * branch, so the template stays in the branch the person is looking at.
 */
export function templateSpotAt(
  parse: ParseResult,
  offset: number,
): TemplateSpot | null {
  const section = sectionAt(parse, offset);
  if (!section || !isTemplateSection(section.name)) return null;

  const items = section.items;
  if (items.length === 0)
    return { section: section.name, target: { in: "section", section } };

  const inside = items.find(
    (i) => offset > i.span.start && offset < i.span.end,
  );
  if (inside) {
    // `tokenIndexAt` gives the first token that starts at or after the
    // offset, so a caret in the middle of a word reads as the token after it.
    // Step back to the word the caret is in, then clamp into the item.
    let index = tokenIndexAt(parse, offset);
    if (index > 0 && parse.tokens[index - 1].end > offset) index--;
    const at = Math.min(Math.max(index, inside.firstToken), inside.lastToken);
    const holder: Item = holdingItem(parse, at) ?? inside;
    return { section: section.name, target: { after: holder } };
  }

  const above = [...items].reverse().find((i) => i.span.end <= offset);
  return {
    section: section.name,
    target: above ? { after: above } : { before: items[0] },
  };
}
