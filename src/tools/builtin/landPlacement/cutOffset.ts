// Sec.7.1: where the canvas cuts the script.
//
// "The cut offset is the start of the first section that follows the last
// <LAND_GENERATION> in source order, or the end of the document if there is
// none." Not the FIRST <LAND_GENERATION>. A multi-mode map declares several
// (Rage Forest 2026.rms has three, one per game mode, selected by `if`
// branches), and cutting at the first silently drops the layouts defined
// later, which are exactly the ones a placement tool exists to edit.

import type { ParseResult } from "../../../parser/types";

const LAND_GENERATION = "LAND_GENERATION";

/**
 * Pure function over a `ParseResult`. `parse.script.sections` is already in
 * source order (the parser walks the token stream once), so "the last
 * <LAND_GENERATION>" is the last matching entry in the array, and "the first
 * section that follows it" is simply the next entry.
 */
export function resolveLandGenerationCutOffset(parse: ParseResult): number {
  const sections = parse.script.sections;
  let lastLandGenIndex = -1;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].name === LAND_GENERATION) lastLandGenIndex = i;
  }
  if (lastLandGenIndex === -1) return parse.source.length;
  const next = sections[lastLandGenIndex + 1];
  return next ? next.span.start : parse.source.length;
}
