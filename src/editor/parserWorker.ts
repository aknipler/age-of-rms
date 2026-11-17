/// <reference lib="webworker" />
// Runs src/parser/parseRms() off the main thread. src/parser/* has no
// React/Monaco/Tauri imports by design (docs/parser-design.md Sec.14), so
// it drops into a worker unchanged. This file is the only place that
// bridges the two worlds: it imports the reference data (JSON, not
// worker-unsafe) and relays plain messages in and out.
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import { parseRms } from "../parser/parser";
import type { IncludeFiles } from "../parser/includeIndex";
import {
  emptyIncludeState,
  indexFor,
  parseOptionsFor,
  receiveIncludes,
  type IncludeState,
} from "./includeCache";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../parser/validate";
import type { LanguageData } from "../parser/language";
import type { Diagnostic, ParseResult } from "../parser/types";
import {
  EARLY_DIAGNOSTICS_MIN_TOKENS,
  LIVENESS_IDLE_MS,
  type ParseDiagnosticsMessage,
  type ParseLivenessMessage,
} from "./parseResponses";
import { createLivenessScheduler } from "./livenessPass";
import { livenessDiagnostics } from "../parser/liveness/report";

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
// this walks the whole constants table to find the two names in it valued 69
// and the three valued 70.
const COMMENT_OPEN_ALIASES = commentOpenAliases(
  (gameConstantsRaw as unknown as GameConstantsForValidate).constants,
);
const COMMENT_CLOSE_ALIASES = commentCloseAliases(
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

/**
 * The script's `#include_drs` files, read by the main thread (the Tauri fs
 * plugin only works there). Sent when the set of files changes, not with
 * each parse request: this worker is never replaced, so it can hold them
 * (src/editor/includeCache.ts). `files` is null when no install was found,
 * and `requested` lists every key the main thread asked the disk for, so a
 * file the install lacks can be told from one not asked for yet.
 */
export interface IncludesMessage {
  kind: "includes";
  files: IncludeFiles | null;
  requested: string[];
}

/** The full reply. For a big document a ParseDiagnosticsMessage comes just before it (parseResponses.ts). */
export interface ParseResultMessage {
  kind: "result";
  requestId: number;
  diagnostics: Diagnostic[];
  tokenCount: number;
  parseTimeMs: number;
  /**
   * The split behind parseTimeMs, read only by src/perfTrace.ts. Always sent,
   * since three numbers cost nothing to clone and the worker has no access to
   * the main thread's localStorage flag.
   */
  lexParseMs: number;
  validateMs: number;
  /**
   * When the worker called postMessage, as `performance.timeOrigin + now()`.
   * A worker's performance.now() counts from the WORKER's start, not the
   * page's, so only the timeOrigin sum compares across the two threads.
   */
  postedAtEpochMs: number;
  /**
   * Full ParseResult (docs/breakdown-design.md Sec.6.2: "one parse, in the
   * worker". Breakdown needs the whole AST, not just diagnostics, and
   * rev 2 pinned this as the resolution rather than a second main-thread
   * parse). Plain data (token indices/numbers/strings, no class instances
   * or cycles), so it structured-clones without special handling.
   *
   * The copy of this field is most of the reply's cost on a big map
   * (docs/diagnostics-latency-report.md). Sending the diagnostics ahead of
   * it is how squiggles stop waiting for it, see breakdown-design.md
   * Sec.6.2's note of 2026-10-22.
   */
  parseResult: ParseResult;
}

/**
 * Everything this worker posts. A *discriminated union* on `kind`, so the
 * main thread's handler (createParseResponseRouter) is made by the compiler
 * to tell the two apart before it reads a field only one of them has.
 */
export type ParseResponseMessage =
  ParseDiagnosticsMessage | ParseResultMessage | ParseLivenessMessage;

// The one place this worker keeps state between messages. Replaced, never
// mutated, by receiveIncludes.
let includeState: IncludeState = emptyIncludeState((text) =>
  parseRms(text, languageData, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    commentCloseAliases: COMMENT_CLOSE_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
  }),
);

/**
 * Everything the liveness pass needs, captured when it was requested. The
 * include state is replaced and never mutated, so holding the reference holds
 * the files as they were for this parse, even if an includes message arrives
 * before the timer fires (that message cancels the job anyway).
 */
interface LivenessJob {
  parse: ParseResult;
  existing: Diagnostic[];
  state: IncludeState;
  includesUnread: boolean;
}

// The name liveness analysis (src/parser/liveness/) is too slow for the typing
// path, 47 to 66 of 243 scripts took over 50 ms, so it runs here as a second
// pass after the result is posted, once the worker has been idle for
// LIVENESS_IDLE_MS. A message that reaches the worker first cancels it. Once
// it starts it runs to the end, which is the cost the owner accepted.
const liveness = createLivenessScheduler<
  LivenessJob,
  Omit<ParseLivenessMessage, "kind" | "requestId">,
  ReturnType<typeof setTimeout>
>({
  delayMs: LIVENESS_IDLE_MS,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle),
  run: ({ parse, existing, state, includesUnread }) => {
    const startedAt = performance.now();
    const { status, diagnostics } = livenessDiagnostics({
      parse,
      language: languageData,
      builtinConstants: BUILTIN_CONSTANTS,
      includeParse: (key) => state.cache.get(key)?.parse,
      includesUnread,
      existing,
    });
    return { status, diagnostics, ms: performance.now() - startedAt };
  },
  post: (requestId, reply) => {
    const message: ParseLivenessMessage = {
      kind: "liveness",
      requestId,
      ...reply,
    };
    self.postMessage(message);
  },
});

self.onmessage = (
  event: MessageEvent<ParseRequestMessage | IncludesMessage>,
) => {
  // Any message makes a waiting liveness job stale: a parse request is newer
  // text, and an includes message changes what the job would read.
  liveness.cancel();
  // A discriminated union tells the two apart. A parse request has no `kind`,
  // so the `in` check narrows it before either field is read.
  if ("kind" in event.data && event.data.kind === "includes") {
    includeState = receiveIncludes(
      includeState,
      event.data.files,
      event.data.requested,
      includeState.parse,
    );
    return;
  }
  const { requestId, source } = event.data as ParseRequestMessage;
  const startedAt = performance.now();
  // The lexer needs these to model comment ends, not merely report them: a
  // word valued 69 inside a comment opens a nested one in the engine, so the
  // comment runs on, and a word valued 70 closes one, so the text after it
  // runs as code. The AST has to say so either way. Built from reference data
  // here rather than inside the parser, which holds no RMS vocabulary.
  const includeOptions = parseOptionsFor(includeState, source);
  const result = parseRms(source, languageData, {
    commentOpenAliases: COMMENT_OPEN_ALIASES,
    commentCloseAliases: COMMENT_CLOSE_ALIASES,
    builtinConstants: BUILTIN_CONSTANTS,
    // The names the script's include files define, and whether any file was
    // not read. Both come from the cache, so a keystroke parses nothing new.
    ...includeOptions,
  });
  const parsedAt = performance.now();
  // The semantic pass (docs/parser-design.md Sec.8) runs here, in the worker,
  // for the same reason the parse does: it's another whole-file walk, and the
  // UI thread should never do one. Its diagnostics are ADDITIVE. The parser's
  // are lexical/syntactic, these are semantic, and neither pass reports what
  // the other already said, so they concatenate.
  // Built once and used twice. validate() reads it for the checks, and the
  // parse carries it out (below) so the name lookup can offer and describe
  // included names without a second walk of the files.
  const includeIndex = indexFor(includeState, result);
  const semanticDiagnostics = validate(result, validateRefDb, {
    resolvedIncludes: includeIndex,
  });
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
  const finishedAt = performance.now();
  const parseTimeMs = finishedAt - startedAt;

  // A big result takes tens to hundreds of ms to copy, on both threads. The
  // diagnostics are a few KB, so they go first on their own and the
  // squiggles do not wait for the tree. The two posts are back to back on
  // the same channel, which keeps their order, and the main thread's router
  // relies on that order (parseResponses.ts). Small results stay one message,
  // see EARLY_DIAGNOSTICS_MIN_TOKENS for why.
  if (result.tokens.length >= EARLY_DIAGNOSTICS_MIN_TOKENS) {
    const early: ParseDiagnosticsMessage = {
      kind: "diagnostics",
      requestId,
      diagnostics: allDiagnostics,
    };
    self.postMessage(early);
  }

  const response: ParseResultMessage = {
    kind: "result",
    requestId,
    diagnostics: allDiagnostics,
    tokenCount: result.tokens.length,
    parseTimeMs,
    lexParseMs: parsedAt - startedAt,
    validateMs: finishedAt - parsedAt,
    postedAtEpochMs: performance.timeOrigin + performance.now(),
    parseResult: { ...result, diagnostics: allDiagnostics, includeIndex },
  };
  self.postMessage(response);

  liveness.request(requestId, {
    parse: result,
    existing: allDiagnostics,
    state: includeState,
    includesUnread: includeOptions.includesUnread,
  });
};
