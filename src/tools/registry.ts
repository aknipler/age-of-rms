/**
 * The built-in tool registry (tools-api-design.md Sec.7).
 *
 * `TOOLS` is the list the pane's Select Tool dropdown renders. Adding a built-in
 * is one import and one array entry; the formatter, constants auditor and the
 * rest of CREATION_PLAN 5.2b slot in here without API changes, which is most of
 * what "one contract, two transports" is meant to buy.
 *
 * Registration is where a manifest's own internal consistency is checked, so a
 * malformed tool cannot reach the dropdown. That is deliberately stricter than
 * "does it run": a manifest whose declared default violates its own declared
 * constraints ships a form that cannot be submitted as authored, and nothing at
 * run time would ever report it.
 */

import type { ToolImplementation } from "../../tools-api/index";
import { validateManifest, type ManifestProblem } from "./protocol";
import { scriptStats } from "./builtin/scriptStats";
import { consistencyChecker } from "./builtin/consistencyChecker";
import { constantsAuditor } from "./builtin/constantsAuditor";
import { balanceSummary } from "./builtin/balanceSummary";
import { scriptFormatter } from "./builtin/scriptFormatter";

export const TOOLS: readonly ToolImplementation[] = Object.freeze([
  scriptStats,
  // 5.2: consistencyChecker — the flagship. It declares read-source, read-ast,
  // read-generation-settings and read-reference, and imports the Phase-4 preview
  // generator directly, which is what makes it inexpressible as an external tool
  // until that generator is a standalone library.
  consistencyChecker,
  // 5.2b: the first of the "additional built-ins" — read-ast only, no
  // generation, so it needs no worker runtime entry below.
  constantsAuditor,
  // 5.2b: the second — a Monte Carlo pass like the checker's, so it DOES need
  // the worker runtime entry below.
  balanceSummary,
  // 5.2b: the third, and the first tool of any kind to declare `edit-source` —
  // so it is what the Apply path (Sec.4.5) and the edit-capability enforcement
  // in host.ts have been waiting for. In-process: one linear pass over the
  // token array, no generation, no worker entry.
  scriptFormatter,
]);

/**
 * Tool ids that run in a tool worker rather than in-process (Sec.4.3, Sec.7.2
 * item 3) — looked up by id, at the `ToolsPane.tsx` call site that picks
 * `workerRunner` vs `inProcessRunner` for `ToolHost.start()`'s per-run
 * `runner` argument. Keyed on id rather than on one host per tool: `start()`
 * throws on `isBusy()` to enforce "one run at a time, app-wide", and
 * `isBusy()` is per-`ToolHost`-instance, so a host built per tool would let a
 * cancelled-but-not-yet-terminated run on one host and a fresh run on
 * another both hold "the" run slot at once.
 *
 * `"consistency-checker"` was the first entry — its Monte Carlo layer is the
 * heavy CPU work `tools-api-design.md` Sec.3 names as the reason a tool
 * worker exists at all. `"balance-summary"` runs the identical per-generation
 * cost (`generatePreview`, same run-count range) for the same reason.
 */
export const WORKER_RUNTIME_TOOL_IDS: ReadonlySet<string> = new Set(["consistency-checker", "balance-summary"]);

export interface RegistryCheck {
  ok: boolean;
  problems: ManifestProblem[];
}

/** Run at startup and in a test; a failing tool is kept OUT of the dropdown. */
export function checkRegistry(tools: readonly ToolImplementation[] = TOOLS): RegistryCheck {
  const problems: ManifestProblem[] = [];
  const seenIds = new Set<string>();

  for (const tool of tools) {
    problems.push(...validateManifest(tool.manifest));
    if (seenIds.has(tool.manifest.id)) {
      problems.push({ manifestId: tool.manifest.id, message: "duplicate tool id in the registry" });
    }
    seenIds.add(tool.manifest.id);
  }
  return { ok: problems.length === 0, problems };
}

/** The tools safe to offer. Anything failing registration is dropped, loudly. */
export function registeredTools(tools: readonly ToolImplementation[] = TOOLS): readonly ToolImplementation[] {
  return tools.filter((tool) => {
    const problems = validateManifest(tool.manifest);
    if (problems.length > 0) {
      console.error(`Tool "${tool.manifest.id}" failed registration and will not be offered:`, problems.map((p) => p.message));
      return false;
    }
    return true;
  });
}
