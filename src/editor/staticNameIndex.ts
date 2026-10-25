import languageDataRaw from "../../reference/data/language.json";
import gameConstantsDataRaw from "../../reference/data/game-constants.json";
import { buildLanguageIndex, type LanguageData } from "../parser/language";
import {
  buildScriptNameIndex,
  buildStaticNameIndex,
  type LookupConstantRow,
  type ScriptNameIndex,
  type StaticNameIndex,
} from "../parser/nameLookup";
import type { ParseResult } from "../parser/types";

// The two halves of the name lookup (src/parser/nameLookup.ts) as shared
// instances, for every surface that asks "what is this name here".
//
// Split out of aoe2RmsCompletion.ts, which imports monaco-editor and so
// cannot be loaded by Vitest (undoGrouping.test.ts says why). The Breakdown
// and the Land Placement panel need the same indexes and have their own
// component tests, so the instances live on this side of that import.
// aoe2RmsCompletion.ts re-exports them, so the Code editor's imports are
// unchanged.

// Double cast for the reason parserWorker.ts gives: the JSON's inferred
// literal type is a union per element, and `validate:reference` already
// holds the file to the schema this type mirrors.
export const languageData = languageDataRaw as unknown as LanguageData;
export const languageIndex = buildLanguageIndex(languageData);

// Built on first use, not at import. The 4000 constant rows are not needed
// until the first keystroke in a field that suggests names.
let staticIndex: StaticNameIndex | null = null;
export function getStaticNameIndex(): StaticNameIndex {
  staticIndex ??= buildStaticNameIndex(
    languageData,
    (gameConstantsDataRaw as unknown as { constants: LookupConstantRow[] })
      .constants,
  );
  return staticIndex;
}

// One script index per ParseResult. A WeakMap keyed by the parse object, so
// an old parse and its index are collected together and no caller has to
// decide when a cache is stale. A new parse is a new key by construction,
// which is the same "rebuilt from each new ParseResult" rule nameLookup.ts
// states, without a hand-written dependency check.
const scriptIndexes = new WeakMap<ParseResult, ScriptNameIndex>();
export function scriptIndexFor(parse: ParseResult): ScriptNameIndex {
  let index = scriptIndexes.get(parse);
  if (!index) {
    index = buildScriptNameIndex(parse);
    scriptIndexes.set(parse, index);
  }
  return index;
}
