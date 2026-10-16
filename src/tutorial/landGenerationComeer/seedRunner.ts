// The host side of seedWorker.ts. `runComeerSeedCheck` is what a tutorial's
// `prepare` hook calls (types.ts).
import ComeerSeedWorker from "./seedWorker?worker";
import type { ComeerSeedResponse } from "./seedWorker";
import type { SeedOutcome } from "./seedCheck";

/** Twice the measured worst case of a search that finds nothing (seedCheck.ts). */
export const SEED_CHECK_TIMEOUT_MS = 60_000;

/**
 * `unavailable` is for the check itself failing to run (worker error or the
 * timeout), which is a different statement from `none`, which says the check
 * ran and found no seed. The tutorial treats both as "do not promise the
 * discovery step", but the console message differs.
 */
export type SeedRunResult =
  SeedOutcome | { status: "unavailable"; reason: string };

/**
 * Starts the check and resolves with its result. One worker per run, torn down
 * afterwards: the work is a few seconds once per tutorial start, so a worker
 * kept alive between runs would hold memory for nothing. `signal` lets the
 * caller abandon the run, so exiting the tutorial early does not leave a
 * search burning a core.
 */
export function runComeerSeedCheck(
  candidates: readonly number[],
  signal?: AbortSignal,
): Promise<SeedRunResult> {
  return new Promise((resolve) => {
    const worker = new ComeerSeedWorker();
    let settled = false;
    const finish = (result: SeedRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(result);
    };
    const onAbort = (): void =>
      finish({ status: "unavailable", reason: "abandoned" });
    const timer = setTimeout(
      () => finish({ status: "unavailable", reason: "timeout" }),
      SEED_CHECK_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<ComeerSeedResponse>) =>
      finish(event.data.outcome);
    worker.onerror = (event) =>
      finish({ status: "unavailable", reason: event.message });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    worker.postMessage({ id: 1, candidates });
  });
}
