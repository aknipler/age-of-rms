// ToolRunner factory backing the worker transport (consistency-checker-
// design.md Sec.4.3, Sec.7.2 item 3). Mirrors usePreviewResult.ts's own
// `?worker` import convention for the preview worker.
//
// ONE Worker per run, matching host.ts's own reasoning for `inProcessRunner`:
// a fresh worker means nothing to reconcile on kill, so kill() IS the whole
// recovery, and no tool module state can persist across runs.

import CheckerWorker from "./checkerWorker?worker";
import type { CheckerWorkerRequest } from "./checkerWorker";
import type { ToolContext } from "../../tools-api/index";
import type { ParseResult } from "../parser/types";
import type { RunnerHandle, ToolRunner } from "./host";

/** The slice of `Worker` this file touches, narrow enough that a test can inject a fake without a real worker thread. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/**
 * Factory rather than the bare object, so a test can inject a fake
 * `WorkerLike`, same shape as `host.ts` taking injected `Timers`/`ToolRunner`
 * rather than touching real clocks or real workers. `workerRunner` below is
 * the one real instance the app uses.
 */
export function createWorkerRunner(makeWorker: () => WorkerLike): ToolRunner {
  return {
    start(tool, contextJson, onMessage): RunnerHandle {
      // Arm narrowing (external-tools-design.md Sec.10), same rule as
      // inProcessRunner's: a panel never reaches a runner at all (Sec.3.2),
      // so a caller handing one here is a bug and must be told loudly.
      if (tool.kind !== "builtin") {
        throw new Error(`workerRunner: cannot run a "${tool.kind}" tool ("${tool.manifest.id}") — only "builtin" has a run()`);
      }
      const worker = makeWorker();
      worker.onmessage = (event: MessageEvent) => onMessage(event.data);
      // Sec.8 item 4: "a worker crash... synthesizes error/killed exactly as
      // the in-process path does", `inProcessRunner`'s crash path is
      // `host.start()`'s try/catch around a SYNCHRONOUS throw, which a
      // worker's ASYNC internal crash never reaches (postMessage already
      // returned normally by the time the worker dies). The `error` event is
      // the worker's own signal for that; without this handler such a crash
      // is silent forever, since neither the run watchdog message-shape nor
      // any `onmessage` ever fires.
      worker.onerror = (event: ErrorEvent) => {
        onMessage({ type: "error", message: `Tool worker crashed: ${event.message}`, reason: "tool-error" });
      };

      // `contextJson` is `unknown` at this boundary (host.ts's existing
      // `ToolRunner` shape, unchanged by this section), the SAME cast
      // `inProcessRunner` already makes (`as never`, even less safe) at the
      // identical seam. This is `postMessage`, not `JSON.stringify`: structured
      // clone preserves `Infinity` and `def` (Sec.4.3), so nothing here
      // serializes the context through JSON.
      const run: CheckerWorkerRequest = { type: "run", toolId: tool.manifest.id, context: contextJson as ToolContext<ParseResult> };
      worker.postMessage(run);

      return {
        cancel() {
          const cancel: CheckerWorkerRequest = { type: "cancel" };
          worker.postMessage(cancel);
        },
        kill() {
          worker.terminate();
        },
      };
    },
  };
}

export const workerRunner: ToolRunner = createWorkerRunner(() => new CheckerWorker());
