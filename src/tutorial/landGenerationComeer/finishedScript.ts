// The complete script the Comeer tutorial builds, in one place. The first
// step's picture is rendered from it (renderImage.ts) and the tutorial test
// asserts it equals the script the steps' own stage builders reach, so the
// picture cannot show a map the tutorial does not teach.

import { parseRms } from "../../parser/parser";
import type { LanguageData } from "../../parser/language";
import { COMEER, comeerScript } from "./comeerValues";
import { appendRestOfScript } from "./restOfScript";

/**
 * Players, water, the named border, four neutral islands. Everything the
 * learner writes by hand, built by the same `comeerScript` the seed gate
 * proves, so the two cannot describe different maps. The island size is the
 * range the learner is asked for in the last random step, and the clumping
 * factor is the pick the shape step states.
 */
export const FINISHED_LAND_SECTION = comeerScript({
  namedBorder: true,
  neutrals: true,
  neutralBaseSize: `rnd(${COMEER.neutral.baseSize.min},${COMEER.neutral.baseSize.max})`,
  neutralClumpingFactor: 18,
});

/** The land section plus the sections the fill-in button adds. */
export function finishedComeerScript(language: LanguageData): string {
  const edit = appendRestOfScript(parseRms(FINISHED_LAND_SECTION, language));
  if (edit === null) return FINISHED_LAND_SECTION;
  return (
    FINISHED_LAND_SECTION.slice(0, edit.start) +
    edit.newText +
    FINISHED_LAND_SECTION.slice(edit.end)
  );
}
