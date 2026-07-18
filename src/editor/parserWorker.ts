/// <reference lib="webworker" />
// Runs src/parser/parseRms() off the main thread. src/parser/* has no
// React/Monaco/Tauri imports by design (docs/parser-design.md §14), so
// it drops into a worker unchanged — this file is the only place that
// bridges the two worlds: it imports the reference data (JSON, not
// worker-unsafe) and relays plain messages in and out.
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import { parseRms } from "../parser/parser";
import { computeResourceTotals, type GameConstantsForTotals, type ResourceTotals } from "../parser/resourceTotals";
import type { LanguageData } from "../parser/language";
import type { Diagnostic } from "../parser/types";

// Double-cast rather than a direct `as LanguageData`: the JSON's
// TS-inferred literal type (from resolveJsonModule) doesn't necessarily
// structurally overlap with LanguageData's hand-written interface (which
// has grown fields like `repeatable`/`nonFunctional` since the JSON was
// first populated in Phase 1.5) closely enough for a single-step cast to
// always typecheck. `validate:reference` (ajv) is the real guarantee
// this data is shaped correctly, same reasoning as aoe2RmsHover.ts.
const languageData = languageDataRaw as unknown as LanguageData;
// Same reasoning: game-constants.json's real shape is a superset of the
// narrow GameConstantsForTotals view resourceTotals.ts actually needs
// (constId/descriptiveName/deTextureFile/verified/notes are along for
// the ride but unused here).
const gameConstants = gameConstantsRaw as unknown as GameConstantsForTotals;

export interface ParseRequestMessage {
  requestId: number;
  source: string;
  /** From GenerationSettingsContext (Phase 2.5) — scales set_place_for_every_player counts. */
  playerCount: number;
}

export interface ParseResponseMessage {
  requestId: number;
  diagnostics: Diagnostic[];
  tokenCount: number;
  parseTimeMs: number;
  resourceTotals: ResourceTotals;
}

self.onmessage = (event: MessageEvent<ParseRequestMessage>) => {
  const { requestId, source, playerCount } = event.data;
  const startedAt = performance.now();
  const result = parseRms(source, languageData);
  const resourceTotals = computeResourceTotals(result.script, result.tokens, gameConstants, playerCount);
  const parseTimeMs = performance.now() - startedAt;

  const response: ParseResponseMessage = {
    requestId,
    diagnostics: result.diagnostics,
    tokenCount: result.tokens.length,
    parseTimeMs,
    resourceTotals,
  };
  self.postMessage(response);
};
