// The parse options that make a second parse of a script read comments the
// way the editor's first parse did. Pure, so the preview, the Consistency
// Checker and Land Placement's emission share one definition.
//
// `instantiateScript` parses the script again after the token filter and after
// it splices in include files. Without these options that second parse has no
// comment aliases, so a comment holding a word valued 69 (SHORE_FISH) runs to
// the end of the file in the first parse and closes at its own marker in the
// second, and the generator reads text the game never reads
// (docs/token-alias-design.md Sec.5, B2).

import type { ParseOptions } from "../../parser/types";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
} from "../../parser/validate";

/** The fields the three name sets read, so any constants table fits. */
export interface ParseOptionsConstant {
  rmsConstant?: string | null;
  constId?: number | null;
  category?: string | null;
}

// Cached per constants array because walking the whole table is not free and
// the preview runs on every edit. A `WeakMap` keyed on the array holds the
// entry only as long as the array lives, so a caller that builds a fresh array
// each time leaks nothing, where a plain `Map` would keep every one.
const optionsByConstants = new WeakMap<
  readonly ParseOptionsConstant[],
  ParseOptions
>();

export function parseOptionsFor(
  constants: readonly ParseOptionsConstant[],
): ParseOptions {
  let options = optionsByConstants.get(constants);
  if (!options) {
    options = {
      commentOpenAliases: commentOpenAliases(constants),
      commentCloseAliases: commentCloseAliases(constants),
      builtinConstants: builtinConstantNames(constants),
    };
    optionsByConstants.set(constants, options);
  }
  return options;
}
