/// <reference lib="webworker" />
// Tool worker entry point (consistency-checker-design.md Sec.4.3, Sec.7.2
// item 3), the "not the parser worker, a stuck tool must not stall
// diagnostics" runtime tools-api-design.md Sec.3 pins. Mirrors
// src/preview/worker.ts's shape: one worker instance PER RUN (not
// long-lived like the parser/preview workers, host.ts's own "no recovery
// logic" reasoning for the in-process runner applies here too, so kill() is
// the whole recovery), self.onmessage in, self.postMessage out.
//
// A ToolImplementation's `run` closure cannot be postMessage'd (functions
// are not structured-cloneable), so this file holds its OWN static import of
// each worker-runtime tool, a second module instantiation in a separate JS
// realm, safe because every ToolImplementation in this codebase is a
// stateless singleton, and dispatches on `toolId`, a plain string that
// crosses the boundary fine.

import type {
  ToolContext,
  ToolImplementation,
  ToolMessage,
  ToolRunHandle,
} from "../../tools-api/index";
import type { ParseResult } from "../parser/types";
import { consistencyChecker } from "./builtin/consistencyChecker";
import { balanceSummary } from "./builtin/balanceSummary";

/**
 * The wire shape this worker speaks, deliberately NOT `HostMessage`
 * (`tools-api/index.ts`), which has no `toolId` field: that message is the
 * PUBLISHED contract's `run`/`cancel` pair, scoped to one tool implicitly (a
 * v1.1 external tool's own process). This worker is shared machinery for
 * every worker-runtime BUILT-IN, so it needs the one field the published
 * message doesn't: which tool to dispatch to. Exported so `workerRunner.ts`
 * constructs exactly this shape rather than a hand-rolled equivalent.
 */
export type CheckerWorkerRequest =
  | { type: "run"; toolId: string; context: ToolContext<ParseResult> }
  | { type: "cancel" };

/** Registered alongside `registry.ts`'s `TOOLS` array and `WORKER_RUNTIME_TOOL_IDS`. */
const TOOLS: Readonly<Record<string, ToolImplementation>> = Object.freeze({
  "consistency-checker": consistencyChecker,
  "balance-summary": balanceSummary,
});

let activeHandle: ToolRunHandle | null = null;

self.onmessage = (event: MessageEvent<CheckerWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "cancel") {
    activeHandle?.cancel();
    return;
  }

  const tool = TOOLS[msg.toolId];
  if (!tool) {
    const error: ToolMessage = {
      type: "error",
      message: `No worker-runtime tool registered for id "${msg.toolId}".`,
      reason: "host-error",
    };
    self.postMessage(error);
    return;
  }

  activeHandle = tool.run(msg.context, (out) => self.postMessage(out));
};
