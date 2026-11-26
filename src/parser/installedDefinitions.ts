// The names the user's INSTALLED random_map.def defines
// (docs/undefined-name-warning-brief.md Sec.4.2 rule D). Pure, so it runs in
// plain Node tests and could run in a worker.
//
// Why read the real file when game-constants.json already holds about 4,400
// names. The table is extracted from one DE build, and a later DE update adds
// names (MAP_FORTRESS, MAP_BOGLAND and MAP_COASTAL_FOREST arrived that way).
// The installed file is positive evidence and never stale, so a name found in
// it silences RMS0324 whatever our table says.

import type { LanguageData } from "./language";
import { parseRms } from "./parser";

/**
 * The name of every `#const` and `#define` in a `random_map.def` text.
 *
 * Reads `parse.symbols` instead of scanning lines with a regular expression,
 * so a commented out definition is absent and one inside an `if` is present,
 * exactly as everywhere else in the app. A regex would see through comments,
 * which is the usual way a hand-rolled scan goes wrong.
 *
 * `language` is a parameter because parseRms takes the vocabulary as data
 * (CLAUDE.md, "Vocabulary is data-driven"). The file defines no commands, so
 * any complete copy of language.json does.
 */
export function definitionNamesIn(
  text: string,
  language: LanguageData,
): Set<string> {
  const names = new Set<string>();
  for (const symbol of parseRms(text, language).symbols) {
    names.add(symbol.name);
  }
  return names;
}
