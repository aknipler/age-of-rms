/// <reference lib="webworker" />
// Runs verifyOrFindSeed() off the main thread when the Comeer tutorial starts.
// A full inspection is about 700 ms and a search up to about 26 s, so on the
// main thread it would freeze the editor the learner is about to use. Same
// shape as src/preview/worker.ts, for the same reason, one long-lived reference
// table built once per worker and not once per request.
import languageDataRaw from "../../../reference/data/language.json";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import type { LanguageData } from "../../parser/language";
import type { ObjectConstant } from "../../preview/generator/objects";
import { createSeedCheckDeps } from "./seedCheckGenerate";
import { verifyOrFindSeed, type SeedOutcome } from "./seedCheck";

// The same double cast preview/worker.ts uses: resolveJsonModule infers a
// literal type that need not overlap the hand-written interface closely enough
// for a single cast, and `validate:reference` is the real guarantee the shape
// is right.
const deps = createSeedCheckDeps(
  languageDataRaw as unknown as LanguageData,
  (gameConstantsRaw as unknown as { constants: ObjectConstant[] }).constants,
);

export interface ComeerSeedRequest {
  id: number;
  /** Seeds to check in order before searching (seedCheck.ts, `verifyOrFindSeed`). */
  candidates: readonly number[];
}

export interface ComeerSeedResponse {
  id: number;
  outcome: SeedOutcome;
}

self.onmessage = (event: MessageEvent<ComeerSeedRequest>) => {
  const { id, candidates } = event.data;
  const response: ComeerSeedResponse = {
    id,
    outcome: verifyOrFindSeed(deps, candidates),
  };
  self.postMessage(response);
};
