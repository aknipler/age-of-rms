// The part of the Comeer script the learner may have written for them
// (tutorial-islands-design.md Sec.2, step 7). It is Captain Kniples' own
// Comeer v1.5, everything except the land generation the learner wrote and the
// player setup they already have: the constants and effects the file opens
// with, then its elevation, terrain and object sections.
//
// The text lives in comeerRest.rms, a copy of test-maps/Comeer v1.5.rms
// with two changes, `#const BORDERS_PL` is dropped because the learner has
// written their own, and `TERR_PLAYER_TEMP` is 124 (SNOW_SOFT), the terrain
// the tutorial teaches for the player lands. `restOfScript.test.ts` rebuilds
// the copy from the original and fails when they drift apart.
//
// `?raw` is a Vite import suffix that gives the file's text as a string. It
// keeps 900 lines of RMS out of a TypeScript string literal, and Vitest
// resolves it the same way, so a test sees what the app ships.
//
// Split into blocks keyed by section name, and not appended whole, so the
// button can add only the sections the learner has not written. A learner who
// typed their own forest and then pressed the button would otherwise get a
// second `<TERRAIN_GENERATION>` header, which the parser accepts and which
// reads as a mistake.

import comeerRest from "./comeerRest.rms?raw";
import type { ParseResult } from "../../parser/types";
import { detectEol } from "../../breakdown/patch/formatStyle";
import type { StepTextEdit } from "../types";

export interface SectionBlock {
  name: string;
  lines: string[];
}

const SECTION_NAMES = [
  "ELEVATION_GENERATION",
  "TERRAIN_GENERATION",
  "OBJECTS_GENERATION",
] as const;

/**
 * Splits the file at the three section headers. A line-start `<NAME>` only
 * counts for these three names, because the terrain section ends with a
 * commented-out `<CONNECTION_GENERATION>` block that must stay inside its
 * comment.
 */
export function splitRest(text: string): {
  header: string[];
  blocks: SectionBlock[];
} {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const starts = SECTION_NAMES.map((name) => lines.indexOf(`<${name}>`));
  if (starts.some((i) => i < 0)) {
    throw new Error("comeerRest.rms is missing a section header");
  }
  const blocks = SECTION_NAMES.map((name, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    return { name, lines: lines.slice(starts[i] + 1, end) };
  });
  return { header: lines.slice(0, starts[0]), blocks };
}

const REST = splitRest(comeerRest);

/** The marker that says the constants block is already in the script. */
const HEADER_MARKER = "#const PLAYER_TEMP_TERR";

export const REST_OF_SCRIPT: readonly SectionBlock[] = REST.blocks;

/** Section names already in the script, uppercased. */
function presentSections(parse: ParseResult): Set<string> {
  return new Set(parse.script.sections.map((s) => s.name.toUpperCase()));
}

/**
 * One edit that appends the constants block and every section whose header is
 * not in the script yet, after everything already there. The order of the
 * sections follows the game's own generation order, which is also the order
 * they are listed in, so appending keeps them correct as long as the learner's
 * sections so far are earlier ones. The constants go first so the sections can
 * use them, and are left out when they are already present. Returns null when
 * nothing is missing, so the button does nothing on a finished script.
 */
export function appendRestOfScript(parse: ParseResult): StepTextEdit | null {
  const have = presentSections(parse);
  const missing = REST_OF_SCRIPT.filter((block) => !have.has(block.name));
  if (missing.length === 0) return null;

  const src = parse.source;
  const eol = detectEol(src);
  const parts: string[] = [];
  if (!src.includes(HEADER_MARKER)) parts.push(REST.header.join(eol));
  for (const block of missing) {
    parts.push([`<${block.name}>`, ...block.lines].join(eol));
  }
  const text = parts.join(eol + eol);
  // A blank line before the first appended text unless the source already
  // ends with one, and none at the very start of an empty file.
  const lead =
    src.length === 0
      ? ""
      : src.endsWith(eol + eol)
        ? ""
        : src.endsWith(eol)
          ? eol
          : eol + eol;
  return {
    start: src.length,
    end: src.length,
    newText: lead + text + eol,
  };
}
