import type { Item, ParseResult } from "../parser/types";
import type { CommandTileKind } from "./generator/commandTiles";

// Which command the caret (Code tab) or the selected card (Breakdown) is on,
// for "Highlight selected command". Pure, so a test can drive it with a parse
// and an offset and no editor.

/** The result: the command's source offset, which keys `CommandTiles`, and its kind. */
export interface CommandAtOffset {
  start: number;
  kind: CommandTileKind;
}

/**
 * The commands the highlight covers, by name. These six strings are the only
 * RMS vocabulary written into this file, and they are the feature's own scope
 * (the table in docs/highlight-selected-command-brief.md), not a reading of the
 * language data, so they live here as a scope list and nothing else.
 */
function kindOf(name: string): CommandTileKind | null {
  if (name === "create_terrain") return "terrain";
  if (name === "create_land" || name === "create_player_lands") return "land";
  if (name === "create_object") return "object";
  if (name === "create_elevation") return "elevation";
  if (name.startsWith("create_connect_")) return "connection";
  return null;
}

/** The section whose lines all count as one command, since cliffs are one stage. */
const CLIFF_SECTION = "CLIFF_GENERATION";

const contains = (
  span: { start: number; end: number },
  offset: number,
): boolean => offset >= span.start && offset <= span.end;

/**
 * Finds the command at `offset`, or null when the caret is on something the
 * highlight does not cover (a directive, a comment between commands, a
 * command of another kind).
 *
 * "Innermost" in the brief's wording. Commands do not nest in RMS, but a
 * command can sit inside an `if` or a `start_random` arm, so the walk goes
 * through those. An attribute line inside a block is inside its command's
 * span, so it counts as the command with no extra rule.
 */
export function commandAtOffset(
  parse: ParseResult,
  offset: number,
): CommandAtOffset | null {
  const search = (items: readonly Item[]): CommandAtOffset | null => {
    for (const item of items) {
      if (!contains(item.span, offset)) continue;
      switch (item.kind) {
        case "command": {
          const name = item.def?.name ?? parse.tokens[item.name]?.text ?? "";
          const kind = kindOf(name);
          return kind === null ? null : { start: item.span.start, kind };
        }
        case "if":
          for (const branch of item.branches) {
            const found = search(branch.items);
            if (found !== null) return found;
          }
          return null;
        case "random": {
          const inPreamble = search(item.preamble);
          if (inPreamble !== null) return inPreamble;
          for (const branch of item.branches) {
            const found = search(branch.items);
            if (found !== null) return found;
          }
          return null;
        }
        case "orphanBlock":
          return null;
        default:
          return null;
      }
    }
    return null;
  };

  const { sections } = parse.script;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    // A section node's span stops at its last item, so a comment after the
    // last line would fall outside it. A section really runs to the next
    // header, so measure it that way.
    const end =
      s + 1 < sections.length
        ? sections[s + 1].span.start
        : parse.source.length;
    if (offset < section.span.start || offset >= end) continue;
    // Anywhere in the cliff section, header and comments included, since the
    // highlight there is every cliff tile whichever line made it.
    if (section.name === CLIFF_SECTION) return { start: -1, kind: "cliff" };
    return search(section.items);
  }
  return search(parse.script.preamble);
}
