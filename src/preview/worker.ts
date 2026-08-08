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
import { buildLanguageIndex, type LanguageData } from "../parser/language";
import { generatePreview, type PreviewReferenceData } from "./generator/index";
import type { ObjectConstant } from "./generator/objects";
import type { PreviewRequest, PreviewResponse } from "./generator/types";

// Same double-cast reasoning as parserWorker.ts: resolveJsonModule infers a
// literal type from the file that doesn't necessarily structurally overlap
// the hand-written interfaces closely enough for a single-step cast to
// always typecheck. `validate:reference` (ajv) is the real guarantee this
// data is shaped correctly.
const languageData = languageDataRaw as unknown as LanguageData;
const constants = (gameConstantsRaw as unknown as { constants: ObjectConstant[] }).constants;

// Built once per worker instance, not per request — refDb never changes
// mid-session (Sec.10: "the worker imports language.json and
// game-constants.json directly... shipping it per request would structured-
// clone ~111 KB of JSON on every keystroke burst for data that never
// changes"). buildLanguageIndex does its own real work (building lookup
// maps), so this is also strictly cheaper than repeating it per message.
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(languageData),
  constants,
};

self.onmessage = (event: MessageEvent<PreviewRequest>) => {
  const { id, parse, settings, opts } = event.data;
  const result = generatePreview(parse, refDb, settings, opts);
  const response: PreviewResponse = { id, ok: true, result };
  self.postMessage(response);
};
