// consistency-checker-design.md Sec.4.3, Sec.7.2 item 3, Sec.8 item 4 — the
// worker TRANSPORT's own contract, exercised against an injected fake
// `WorkerLike` rather than a real Worker thread. `checkerWorker.ts` itself
// (the actual `self.onmessage` entry point) is UI/worker wiring with no
// automated coverage of its own, matching this repo's existing convention
// for `preview/worker.ts` — verified by typecheck + lint instead, and its
// dispatch table is empty until Sec.7.3 registers a worker-runtime tool.

import { describe, expect, it, vi } from "vitest";
import { TOOLS_API_VERSION, type ToolContext, type ToolImplementation, type ToolManifest } from "../../../tools-api/index";
import type { ParseResult } from "../../parser/types";
import { createWorkerRunner, type WorkerLike } from "../workerRunner";

function manifest(): ToolManifest {
  return { id: "t", name: "T", version: "1.0.0", apiVersion: TOOLS_API_VERSION, description: "d", capabilities: [] };
}
const tool: ToolImplementation = { manifest: manifest(), run: () => ({ cancel() {} }) };

function fakeWorker() {
  const posted: unknown[] = [];
  let terminated = false;
  const worker: WorkerLike = {
    postMessage: (msg) => posted.push(msg),
    terminate: () => {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return { worker, posted, wasTerminated: () => terminated };
}

describe("workerRunner", () => {
  it("posts a run message carrying the tool's id and the raw context, unconverted", () => {
    const { worker, posted } = fakeWorker();
    const runner = createWorkerRunner(() => worker);
    const ctx = { apiVersion: TOOLS_API_VERSION, params: {} } as ToolContext<ParseResult>;
    runner.start(tool, ctx, () => {});
    expect(posted).toEqual([{ type: "run", toolId: "t", context: ctx }]);
  });

  it("relays every message the worker posts back, in order — progress, partial, result", () => {
    const { worker } = fakeWorker();
    const runner = createWorkerRunner(() => worker);
    const received: unknown[] = [];
    runner.start(tool, {}, (msg) => received.push(msg));

    const progress = { type: "progress", fraction: 0.5 };
    const partial = { type: "partial", output: { blocks: [] } };
    const result = { type: "result", output: { blocks: [] } };
    worker.onmessage?.({ data: progress } as MessageEvent);
    worker.onmessage?.({ data: partial } as MessageEvent);
    worker.onmessage?.({ data: result } as MessageEvent);

    expect(received).toEqual([progress, partial, result]);
  });

  it("cancel() posts a cancel message rather than terminating outright — the grace period is host.ts's job", () => {
    const { worker, posted, wasTerminated } = fakeWorker();
    const runner = createWorkerRunner(() => worker);
    const handle = runner.start(tool, {}, () => {});
    handle.cancel();
    expect(posted).toContainEqual({ type: "cancel" });
    expect(wasTerminated()).toBe(false);
  });

  it("kill() terminates the worker — the hard stop host.ts calls at the cancel grace or the run watchdog", () => {
    const { worker, wasTerminated } = fakeWorker();
    const runner = createWorkerRunner(() => worker);
    const handle = runner.start(tool, {}, () => {});
    handle.kill();
    expect(wasTerminated()).toBe(true);
  });

  // Sec.8 item 4: "a worker crash... synthesizes error/killed exactly as the
  // in-process path does". inProcessRunner's crash path is a SYNCHRONOUS
  // throw caught by host.ts's own try/catch; a worker's crash is asynchronous
  // (postMessage has already returned by the time the worker dies) and
  // arrives as the worker's `error` event instead of any message, so nothing
  // else in this file would ever see it without this handler.
  it("onerror synthesizes a ToolMessage error rather than going silent forever", () => {
    const { worker } = fakeWorker();
    const runner = createWorkerRunner(() => worker);
    const received: unknown[] = [];
    runner.start(tool, {}, (msg) => received.push(msg));

    worker.onerror?.({ message: "out of memory" } as ErrorEvent);

    expect(received).toEqual([{ type: "error", message: expect.stringContaining("out of memory"), reason: "tool-error" }]);
  });

  it("each run gets its own fresh worker (one worker per run, matching inProcessRunner's no-shared-state rule)", () => {
    const make = vi.fn(() => fakeWorker().worker);
    const runner = createWorkerRunner(make);
    runner.start(tool, {}, () => {});
    runner.start(tool, {}, () => {});
    expect(make).toHaveBeenCalledTimes(2);
  });
});
