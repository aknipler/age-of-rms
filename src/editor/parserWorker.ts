/// <reference lib="webworker" />
// Runs src/parser/parseRms() off the main thread. src/parser/* has no
// React/Monaco/Tauri imports by design (docs/parser-design.md Sec.14), so
// it drops into a worker unchanged. This file is the only place that
// bridges the two worlds: it imports the reference data (JSON, not
// worker-unsafe) and relays plain messages in and out.
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import { parseRms } from "../parser/parser";
import {
  builtinConstantNames,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../parser/validate";
import type { LanguageData } from "../parser/language";
import type { Diagnostic, ParseResult } from "../parser/types";

// Double-cast rather than a direct `as LanguageData`: the JSON's
// TS-inferred literal type (from resolveJsonModule) doesn't necessarily
// structurally overlap with LanguageData's hand-written interface (which
// has grown fields like `repeatable`/`nonFunctional` since the JSON was
// first populated in Phase 1.5) closely enough for a single-step cast to
// always typecheck. `validate:reference` (ajv) is the real guarantee
// this data is shaped correctly, same reasoning as aoe2RmsHover.ts.
const languageData = languageDataRaw as unknown as LanguageData;
// validate() reads a different (also narrow) slice of the same file,
// constId/category/idSource rather than resourceAmounts, so it gets its own
// view of the identical object rather than a widened shared one.
const validateRefDb: ValidateReferenceDb = {
  language: languageData,
  gameConstants: gameConstantsRaw as unknown as GameConstantsForValidate,
};

// Computed ONCE at module scope, not per parse. The worker is long-lived and
// this walks the whole constants table to find the two names in it valued 69.
const COMMENT_OPEN_ALIASES = commentOpenAliases(
  (gameConstantsRaw as unknown as GameConstantsForValidate).constants,
);
// Also once. Lets `effect_amount ... ATTR_FOUNDATION_TERRAIN FOREST` resolve
// FOREST the way the engine does, from random_map.def, instead of warning
// that the file never defines it.
const BUILTIN_CONSTANTS = builtinConstantNames(
  (gameConstantsRaw as unknown as GameConstantsForValidate).constants,
);

export interface ParseRequestMessage {
  requestId: number;
  source: string;
}

export interface ParseResponseMessage {
  requestId: number;
  diagnostics: Diagnostic[];
  tokenCount: number;
  parseTimeMs: number;
  /**
   * Full ParseResult (docs/breakdown-design.md Sec.6.2: "one parse, in the
   * worker". Breakdown needs the whole AST, not just diagnostics, and
   * rev 2 pinned this as the resolution rather than a second main-thread
   * parse). Plain data (token indices/numbers/strings, no class instances
   * or cycles), so it structured-clones without special handling.
   *
   * Sec.6.2's `wantAst` payload-size flag is a measured optimization
   * trigger, not built preemptively. Profile against AK_Vanguard_v1.2.rms
   * (~49.7k tokens) before adding it.
   */
  parseResult: ParseResult;
}

self.onmessage = (event: MessageEvent<ParseRequestMessage>) => {
  const { requestId, source } = event.data;
  const startedAt = performance.now();
  // The lexer needs this to model the truncation, not merely report it: a word
  // valued 69 inside a comment opens a nested one in the engine, so everything
  // after it is invisible and the AST has to say so. Built from reference data
  // here rather than inside the parser, which holds no RMS vocabulary.
  const result = parseRms(source, languageData, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
  });
  // The semantic pass (docs/parser-design.md Sec.8) runs here, in the worker,
  // for the same reason the parse does: it's another whole-file walk, and the
  // UI thread should never do one. Its diagnostics are ADDITIVE. The parser's
  // are lexical/syntactic, these are semantic, and neither pass reports what
  // the other already said, so they concatenate.
  const semanticDiagnostics = validate(result, validateRefDb);
  // The merge happens HERE, at the app boundary, and not in either pure
  // module. Inside src/parser/* the split stays real: parseRms never sees a
  // semantic diagnostic and validate() returns its own array (spec Sec.3,
  // ParseResult.diagnostics is "syntax-level only"). But every consumer
  // downstream of this line; Monaco markers, the status bar, Breakdown's
  // card badges, its diagnostics ruler, its section tabs; wants one list for
  // one source, and all of them reach it through parseResult.diagnostics.
  // Merging once here beats threading a parallel array through five layers of
  // props, and it means a new semantic check lights up the whole UI for free.
  const allDiagnostics = [...result.diagnostics, ...semanticDiagnostics];
  // Covers parse + validate: it's the whole off-thread turnaround, which is
  // the number worth watching against the Sec.9 budget.
  const parseTimeMs = performance.now() - startedAt;

  const response: ParseResponseMessage = {
    requestId,
    diagnostics: allDiagnostics,
    tokenCount: result.tokens.length,
    parseTimeMs,
    parseResult: { ...result, diagnostics: allDiagnostics },
  };
  self.postMessage(response);
};
