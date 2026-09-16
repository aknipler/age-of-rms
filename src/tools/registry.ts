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

import type { ToolImplementation, ToolManifest } from "../../tools-api/index";
import { validateManifest, type ManifestProblem } from "./protocol";
import { scriptStats } from "./builtin/scriptStats";
import { consistencyChecker } from "./builtin/consistencyChecker";
import { constantsAuditor } from "./builtin/constantsAuditor";
import { balanceSummary } from "./builtin/balanceSummary";
import { scriptFormatter } from "./builtin/scriptFormatter";
import { landPlacementManifest } from "./builtin/landPlacement/panel/manifest";
import { LandPlacementPanel } from "./builtin/landPlacement/panel/LandPlacementPanel";

/**
 * The registry seam (external-tools-design.md Sec.10, land-placement-design.md
 * Sec.3.2), widened here with the two arms THIS slice needs. `external` is
 * left for M6 to add, nothing here anticipates its shape beyond the fact that
 * a `"panel"` manifest must never be constructible from it (Sec.3.2: a panel
 * carries a React component, a *function*, and JSON cannot carry one, so an
 * external/JSON-sourced entry can never produce a `panel` arm **by
 * construction**, strictly stronger than a validator check).
 *
 * `manifest` is carried at the top level on every arm (not just reachable via
 * `.impl.manifest`) so every caller that only ever needs "what tool is this",
 * the Select Tool dropdown, `ToolHost` (which Sec.10 pins as touching only
 * `tool.manifest.id`), reads `tool.manifest` with no narrowing.
 */
export type RegisteredTool =
  | { kind: "builtin"; manifest: ToolManifest; impl: ToolImplementation }
  | {
      kind: "panel";
      manifest: ToolManifest;
      /**
       * 4b's real React panel component. Untyped here on purpose: no panel
       * component exists yet (4a is headless-only, per the slice-4 brief),
       * and this module must not import React to type it. 4b narrows this to
       * a real component type at the one call site that renders it.
       */
      component: unknown;
    };

const BUILTINS: readonly ToolImplementation[] = Object.freeze([
  scriptStats,
  // 5.2: consistencyChecker, the flagship. It declares read-source, read-ast,
  // read-generation-settings and read-reference, and imports the Phase-4 preview
  // generator directly, which is what makes it inexpressible as an external tool
  // until that generator is a standalone library.
  consistencyChecker,
  // 5.2b: the first of the "additional built-ins", read-ast only, no
  // generation, so it needs no worker runtime entry below.
  constantsAuditor,
  // 5.2b: the second, a Monte Carlo pass like the checker's, so it DOES need
  // the worker runtime entry below.
  balanceSummary,
  // 5.2b: the third, and the first tool of any kind to declare `edit-source`,
  // so it is what the Apply path (Sec.4.5) and the edit-capability enforcement
  // in host.ts have been waiting for. In-process: one linear pass over the
  // token array, no generation, no worker entry.
  scriptFormatter,
]);

/**
 * `TOOLS` keeps its meaning as "the built-ins", wrapped in the `builtin` arm
 * (external-tools-design.md Sec.10: "`registry.ts` wraps the five built-ins;
 * `TOOLS` keeps its meaning... and gains a sibling for the installed
 * externals", that sibling is M6's, not this slice's), plus ONE `panel` arm:
 * Land Placement (slice-4b item 3). The lifecycle a panel needs (`mountPanel`/
 * `unmountPanel`/`suspendPanel`/`resumePanel`, host.ts) is wired in
 * `ToolsPane.tsx` as of this slice, which is what makes registering it here
 * safe, before 4b, adding it would have let a user select a tool with no
 * mount path at all.
 */
export const TOOLS: readonly RegisteredTool[] = Object.freeze([
  ...BUILTINS.map((impl) => ({
    kind: "builtin" as const,
    manifest: impl.manifest,
    impl,
  })),
  {
    kind: "panel" as const,
    manifest: landPlacementManifest,
    component: LandPlacementPanel,
  },
]);

/**
 * Tool ids that run in a tool worker rather than in-process (Sec.4.3, Sec.7.2
 * item 3), looked up by id, at the `ToolsPane.tsx` call site that picks
 * `workerRunner` vs `inProcessRunner` for `ToolHost.start()`'s per-run
 * `runner` argument. Keyed on id rather than on one host per tool: `start()`
 * throws on `isBusy()` to enforce "one run at a time, app-wide", and
 * `isBusy()` is per-`ToolHost`-instance, so a host built per tool would let a
 * cancelled-but-not-yet-terminated run on one host and a fresh run on
 * another both hold "the" run slot at once.
 *
 * `"consistency-checker"` was the first entry, its Monte Carlo layer is the
 * heavy CPU work `tools-api-design.md` Sec.3 names as the reason a tool
 * worker exists at all. `"balance-summary"` runs the identical per-generation
 * cost (`generatePreview`, same run-count range) for the same reason.
 */
export const WORKER_RUNTIME_TOOL_IDS: ReadonlySet<string> = new Set([
  "consistency-checker",
  "balance-summary",
]);

export interface RegistryCheck {
  ok: boolean;
  problems: ManifestProblem[];
}

/**
 * Run at startup and in a test; a failing tool is kept OUT of the dropdown.
 * Unaffected by the `RegisteredTool` widening beyond the parameter type
 * (external-tools-design.md Sec.10), every arm carries a `manifest` at the
 * top level, so validation reads it identically regardless of `kind`.
 */
export function checkRegistry(
  tools: readonly RegisteredTool[] = TOOLS,
): RegistryCheck {
  const problems: ManifestProblem[] = [];
  const seenIds = new Set<string>();

  for (const tool of tools) {
    problems.push(...validateManifest(tool.manifest));
    if (seenIds.has(tool.manifest.id)) {
      problems.push({
        manifestId: tool.manifest.id,
        message: "duplicate tool id in the registry",
      });
    }
    seenIds.add(tool.manifest.id);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The tools safe to offer, what the Select Tool dropdown renders (it maps
 * over `.manifest` alone, so a `panel`-kind entry reaches it exactly like a
 * `builtin` one). Anything failing registration is dropped, loudly.
 */
export function registeredTools(
  tools: readonly RegisteredTool[] = TOOLS,
): readonly RegisteredTool[] {
  return tools.filter((tool) => {
    const problems = validateManifest(tool.manifest);
    if (problems.length > 0) {
      console.error(
        `Tool "${tool.manifest.id}" failed registration and will not be offered:`,
        problems.map((p) => p.message),
      );
      return false;
    }
    return true;
  });
}
