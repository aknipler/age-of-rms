// Where the Comeer tutorial's steps read the seed the background check chose.
//
// A module-level variable and not React state, on purpose. The writer is a
// promise that settles whenever the worker finishes and the readers are
// tutorial steps, which are plain data and not components, so there is no
// render for a state update to trigger. A step's `preview.seed` is read at the
// moment the step becomes active (tutorial-islands-design.md Sec.4.3), which is
// the moment a plain getter is right.
import { PINNED_COMEER_SEED } from "./comeerValues";
import type { SeedRunResult } from "./seedRunner";

let latest: SeedRunResult | null = null;
let provisional: number | null = null;

export function setComeerSeedResult(result: SeedRunResult | null): void {
  latest = result;
}

export function getComeerSeedResult(): SeedRunResult | null {
  return latest;
}

/**
 * The seed to use until the check finishes, a replacement an earlier start
 * saved (seedMemory.ts), or null for the pinned seed.
 */
export function setProvisionalComeerSeed(seed: number | null): void {
  provisional = seed;
}

/**
 * The seed to pin. While the check is still running, or if it could not run,
 * this is the replacement an earlier start found, if one was saved, and the
 * pinned seed otherwise. That is the right fallback for the common case,
 * since the seed the last check settled on passes unless the engine changed
 * again.
 */
export function currentComeerSeed(): number {
  if (latest?.status === "pinned" || latest?.status === "found") {
    return latest.seed;
  }
  return provisional ?? PINNED_COMEER_SEED;
}

/**
 * True only when the check ran to completion and found no seed that shows the
 * planted problem. The tutorial uses this to skip the discovery step and say
 * so, instead of asking the learner to find something that is not there.
 */
export function comeerDiscoveryUnavailable(): boolean {
  return latest?.status === "none";
}
