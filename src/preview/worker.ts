/// <reference lib="webworker" />
// Runs generatePreview() off the main thread — docs/preview-design.md Sec.10.
// src/preview/generator/** has no React/Monaco/Tauri imports by design (same
// purity rule as src/parser/**), so it drops into a worker unchanged. This
// file is the only place that bridges the two worlds, mirroring
// src/editor/parserWorker.ts's own shape closely on purpose: one long-lived
// worker, an incrementing id, the worker importing its own reference data,
// stale responses discarded by id on the host side (Sec.10: "it does mirror
// parserWorker.ts after all").
//
// WHAT IS NOT HERE, both deliberately (Sec.10 pins this):
//   - The watchdog (terminate-and-respawn a request outstanding > 1000ms) is
//     HOST logic, not worker logic — a worker cannot terminate itself, and
//     Sec.10 is explicit that the host owns this, not the worker. See
//     usePreviewResult.ts.
//   - Real cancellation. `generatePreview` is synchronous, so this worker's
//     onmessage cannot fire mid-run to check anything — there is nothing a
//     `shouldStop` flag could poll between messages. Sec.10 calls this the
//     right call for v1, not an oversight.
//   - Debouncing. That's the host's job too (~300ms after the parse
//     settles, per Sec.10), same split as parserWorker.ts/useParsedDocument.ts.
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import objectDataRaw from "../../reference/data/object-data.json";
import { buildLanguageIndex, type LanguageData } from "../parser/language";
import { parseRms } from "../parser/parser";
import type { ParseResult } from "../parser/types";
import {
  builtinConstantNames,
  commentCloseAliases,
  commentOpenAliases,
  type GameConstantsForValidate,
} from "../parser/validate";
import { truncateAst } from "./generator/truncateAst";
import { packDeObjects } from "./generator/deObjectsWire";
import { generatePreview, type PreviewReferenceData } from "./generator/index";
import type { ObjectConstant } from "./generator/objects";
import type { TerrainRestriction } from "./generator/forestTreeSuppression";
import type { ObjectDataFile } from "./generator/deObjectData";
import type {
  PreviewRequest,
  PreviewResponse,
  PreviewResult,
  PreviewWireResult,
} from "./generator/types";

// Same double-cast reasoning as parserWorker.ts: resolveJsonModule infers a
// literal type from the file that doesn't necessarily structurally overlap
// the hand-written interfaces closely enough for a single-step cast to
// always typecheck. `validate:reference` (ajv) is the real guarantee this
// data is shaped correctly.
const languageData = languageDataRaw as unknown as LanguageData;
const gameConstantsParsed = gameConstantsRaw as unknown as {
  constants: ObjectConstant[];
  terrainRestrictions?: TerrainRestriction[];
};
const constants = gameConstantsParsed.constants;

// Built once per worker instance, not per request — refDb never changes
// mid-session (Sec.10: "the worker imports language.json and
// game-constants.json directly... shipping it per request would structured-
// clone ~111 KB of JSON on every keystroke burst for data that never
// changes"). buildLanguageIndex does its own real work (building lookup
// maps), so this is also strictly cheaper than repeating it per message.
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(languageData),
  constants,
  terrainRestrictions: gameConstantsParsed.terrainRestrictions,
  // The dat's object fields, which make the object stage DE's own (Sec.6.6,
  // rev 12). Imported once with the worker, like the two files above.
  objectData: objectDataRaw as unknown as ObjectDataFile,
};

/**
 * Explicit field list, not a `{ grid, ...rest }` destructure-to-discard:
 * `PreviewWireResult` is `Omit<PreviewResult, "grid">`, so a future field
 * added to `PreviewResult` and forgotten here is a compile error rather than
 * a silently-dropped field. See `types.ts`'s `PreviewWireResult` doc for why
 * `grid` itself is the one field this worker does not relay.
 */
function toWireResult(result: PreviewResult): PreviewWireResult {
  const {
    dim,
    seedUsed,
    snapshots,
    objects,
    players,
    reports,
    failureMarks,
    notes,
    landOrigins,
    resourceTotals,
    cliffPieces,
    terrainObjects,
    standingGraphics,
    colorMood,
    timing,
  } = result;
  return {
    dim,
    seedUsed,
    snapshots,
    objects,
    players,
    reports,
    failureMarks,
    notes,
    landOrigins,
    resourceTotals,
    cliffPieces,
    terrainObjects,
    standingGraphics,
    colorMood,
    timing,
    // The textured view draws every object as DE's sprite, which needs the
    // saved map's own fields (frame, rotation, status). Packed into one
    // buffer and transferred, since as tens of thousands of small objects
    // the clone cost about 30 ms on each side per preview.
    deObjectsPacked:
      result.deObjects === undefined
        ? undefined
        : packDeObjects(result.deObjects),
  };
}

// The lexer options the editor's parser worker uses (parserWorker.ts), so both
// read the script the same way. The comment words change where a comment
// ends, which changes the tree. Include names and the other parse options
// only change diagnostics, which the generator does not read apart from
// RMS0110, and that one comes from the parse itself.
const constantsForParse = (
  gameConstantsRaw as unknown as GameConstantsForValidate
).constants;
const parseOptions = {
  commentOpenAliases: commentOpenAliases(constantsForParse),
  commentCloseAliases: commentCloseAliases(constantsForParse),
  builtinConstants: builtinConstantNames(constantsForParse),
};

// The last script parsed. A re-roll, a settings change and a cursor move in
// Current view all send the same text again, and parsing is the part of a
// request that does not depend on any of them.
let lastSource: string | null = null;
let lastParse: ParseResult | null = null;

function parseFor(source: string): ParseResult {
  if (lastParse === null || lastSource !== source) {
    lastParse = parseRms(source, languageData, parseOptions);
    lastSource = source;
  }
  return lastParse;
}

self.onmessage = (event: MessageEvent<PreviewRequest>) => {
  const { id, source, cutOffset, settings, opts } = event.data;
  // Parsing happens here, before generatePreview, so the hourglass gets its
  // time from here. A re-roll reuses the last parse and reports 0.
  const parseStart = performance.now();
  const full = parseFor(source);
  const parseMs = performance.now() - parseStart;
  const parse = cutOffset === null ? full : truncateAst(full, cutOffset);
  const result = generatePreview(parse, refDb, settings, opts);
  if (result.timing) result.timing.parseMs = parseMs;
  const response: PreviewResponse = {
    id,
    ok: true,
    result: toWireResult(result),
  };
  // The transfer list hands the buffer over instead of copying it. The
  // worker's own view of it is emptied, which is fine since it is never
  // read again here.
  const packed = response.result.deObjectsPacked;
  self.postMessage(response, packed === undefined ? [] : [packed.buffer]);
};
