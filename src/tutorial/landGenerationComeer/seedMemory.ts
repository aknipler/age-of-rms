// What the Comeer tutorial's background seed check does with a replacement
// seed (owner's request, 2026-10-14). When the pinned seed no longer passes
// and a search finds one that does, the found seed is saved, so later starts
// check it first and use it straight away instead of searching again and
// showing the stale seed on the steps before the search ends.
//
// Every dependency is passed in, the same dependency injection seedCheck.ts
// uses. The real ones (the Tauri store, the worker) cannot load in plain-Node
// Vitest, so prepareSeed.ts wires them and this file stays testable.

import type { RememberedSeed } from "../tutorialConstants";
import type { SeedRunResult } from "./seedRunner";

/** Where a replacement seed is kept between starts. `null` clears it. */
export interface SeedMemory {
  read: () => Promise<RememberedSeed | undefined>;
  write: (value: RememberedSeed | null) => Promise<void>;
}

export interface PrepareSeedDeps {
  pinned: number;
  memory: SeedMemory;
  run: (
    candidates: readonly number[],
    signal: AbortSignal,
  ) => Promise<SeedRunResult>;
  setResult: (result: SeedRunResult | null) => void;
  setProvisional: (seed: number | null) => void;
}

/**
 * Checks the remembered seed and the pinned seed, searches if both fail, and
 * keeps the memory in step with the answer. Resolves with the result, or null
 * when the run was abandoned.
 *
 * A remembered seed only counts for the pinned seed it replaced. A release
 * that pins a new seed checked it against that release's engine, so an older
 * replacement is ignored and then overwritten or cleared.
 */
export async function prepareWithMemory(
  deps: PrepareSeedDeps,
  signal: AbortSignal,
): Promise<SeedRunResult | null> {
  // Forget the previous run's answer first. A restarted tutorial must not show
  // a stale `none` while its own check is still working.
  deps.setResult(null);
  deps.setProvisional(null);

  let remembered: RememberedSeed | undefined;
  try {
    remembered = await deps.memory.read();
  } catch (error: unknown) {
    // No memory is the state a fresh install is in, so carry on without it.
    console.warn("Comeer tutorial: could not read the saved seed", error);
  }
  if (signal.aborted) return null;

  const usable =
    remembered !== undefined && remembered.replaces === deps.pinned
      ? remembered.seed
      : undefined;
  if (usable !== undefined) deps.setProvisional(usable);

  const result = await deps.run(
    usable !== undefined ? [usable, deps.pinned] : [deps.pinned],
    signal,
  );
  if (signal.aborted) return null;
  deps.setResult(result);

  try {
    if (result.status === "found") {
      await deps.memory.write({ seed: result.seed, replaces: deps.pinned });
    } else if (
      result.status === "pinned" &&
      result.seed === deps.pinned &&
      remembered !== undefined
    ) {
      // The pinned seed passes again, so the replacement is no longer needed.
      await deps.memory.write(null);
    }
  } catch (error: unknown) {
    console.warn("Comeer tutorial: could not save the seed", error);
  }
  return result;
}
