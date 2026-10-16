// The Comeer tutorial's `prepare` (types.ts). Runs the seed check in a worker
// each time the tutorial starts and records the result for the steps to read.
// seedMemory.ts holds the logic, this file only hands it the real store and
// worker.
import { load } from "@tauri-apps/plugin-store";
import {
  COMEER_SEED_KEY,
  isRememberedSeed,
  TUTORIAL_STORE_FILE,
} from "../tutorialConstants";
import { PINNED_COMEER_SEED } from "./comeerValues";
import {
  setComeerSeedResult,
  setProvisionalComeerSeed,
} from "./pinnedSeedStore";
import { prepareWithMemory, type SeedMemory } from "./seedMemory";
import { runComeerSeedCheck } from "./seedRunner";

// `load` hands back the instance TutorialContext already opened for this
// file, so this is the same settings.json and not a second copy of it.
const storeMemory: SeedMemory = {
  read: async () => {
    const store = await load(TUTORIAL_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    const value = await store.get<unknown>(COMEER_SEED_KEY);
    return isRememberedSeed(value) ? value : undefined;
  },
  write: async (value) => {
    const store = await load(TUTORIAL_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    if (value === null) await store.delete(COMEER_SEED_KEY);
    else await store.set(COMEER_SEED_KEY, value);
  },
};

export async function prepareComeerSeed(signal: AbortSignal): Promise<void> {
  const result = await prepareWithMemory(
    {
      pinned: PINNED_COMEER_SEED,
      memory: storeMemory,
      run: runComeerSeedCheck,
      setResult: setComeerSeedResult,
      setProvisional: setProvisionalComeerSeed,
    },
    signal,
  );
  if (result === null) return;
  if (result.status === "found") {
    console.warn(
      `Comeer tutorial: pinned seed ${PINNED_COMEER_SEED} no longer passes, using ${result.seed} (found after ${result.tried}) and saving it for later starts. Update PINNED_COMEER_SEED.`,
    );
  } else if (result.status === "pinned" && result.seed !== PINNED_COMEER_SEED) {
    console.warn(
      `Comeer tutorial: pinned seed ${PINNED_COMEER_SEED} no longer passes, using the saved seed ${result.seed}. Update PINNED_COMEER_SEED.`,
    );
  } else if (result.status === "none") {
    console.error(
      `Comeer tutorial: no seed passes. Failing properties on the pinned seed: ${result.failed.join(", ")}`,
    );
  } else if (result.status === "unavailable") {
    console.warn(`Comeer tutorial: seed check unavailable (${result.reason})`);
  }
}
