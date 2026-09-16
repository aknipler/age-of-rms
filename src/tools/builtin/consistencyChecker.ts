/**
 * The Generation Consistency Checker (CREATION_PLAN 5.2, PLAN.md's flagship
 * Advanced Tool). consistency-checker-design.md Sec.4.1 (the loop), Sec.6
 * (the manifest). Ties Sec.3's static checks, Sec.4's Monte Carlo
 * aggregation and Sec.5's report builder into one `ToolImplementation`.
 */

import { buildLanguageIndex } from "../../parser/language";
import type { ParseResult } from "../../parser/types";
import type { InstantiatedScript } from "../../preview/generator/types";
import { instantiateScript } from "../../preview/generator/instantiate";
import type { PreviewReferenceData } from "../../preview/generator/index";
import {
  TOOLS_API_VERSION,
  type OutputBlock,
  type ToolContext,
  type ToolImplementation,
  type ToolManifest,
  type ToolMessage,
  type ToolParamDef,
  type ToolRunHandle,
} from "../../../tools-api/index";
import {
  objectConstantsFromPublished,
  previewSettingsFromContext,
  runPreviewFromContext,
} from "../previewBridge";
import { MonteCarloAggregate } from "./checker/aggregate";
import {
  buildStaticContext,
  runStaticChecks,
  type StaticContext,
  type StaticFinding,
} from "./checker/staticChecks";
import {
  buildFindingTables,
  buildNotesBlocks,
  buildStaticFindingBlocks,
  buildSummaryHeader,
  suppressedActorAreaSpans,
  type StageReasonContext,
} from "./checker/report";

// ---------------------------------------------------------------------------
// Sec.4.4's budget, named constants rather than embedded literals, per
// Sec.8 item 5: the comment must say this bounds the KNOB, not the time,
// since per-generation cost spans 6x across the corpus and a further 1.4x
// across map size (Sec.4.4); no generation count pins a duration.
// ---------------------------------------------------------------------------

export const DEFAULT_PLAYER_COUNTS = [2, 4, 6, 8] as const;
export const DEFAULT_RUNS_PER_PLAYER_COUNT = 15;
export const MIN_RUNS_PER_PLAYER_COUNT = 5;
export const MAX_RUNS_PER_PLAYER_COUNT = 200;
export const DEFAULT_BASE_SEED = 1;
/** [tune]: a ceiling on `runsPerPlayerCount * playerCounts.length`, so a future default change is caught, see Sec.8 item 5. */
export const MAX_GENERATIONS_CEILING = 100;

// ---------------------------------------------------------------------------
// Sec.6: the manifest
// ---------------------------------------------------------------------------

const PLAYER_COUNT_PARAMS: ToolParamDef = {
  key: "playerCounts",
  type: "multiSelect",
  label: "Player counts",
  help: "Which player counts to run the Monte Carlo layer at. The static checks below always run once per selected count regardless.",
  default: DEFAULT_PLAYER_COUNTS.map(String),
  options: DEFAULT_PLAYER_COUNTS.map((n) => ({
    value: String(n),
    label: String(n),
  })),
  minSelected: 1,
};

export const consistencyCheckerManifest: ToolManifest = {
  id: "consistency-checker",
  name: "Generation Consistency Checker",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description:
    "Static checks (undefined actor areas, terrain the engine's own table refuses, land over-allocation, static contradictions) plus a Monte Carlo pass across a player-count matrix, reporting spawn rates, worst player count and failure buckets per command.",
  // read-source is implied by read-ast; declared anyway per the scriptStats convention of the manifest being the copy-paste template.
  capabilities: [
    "read-source",
    "read-ast",
    "read-generation-settings",
    "read-reference",
  ],
  // Sec.5.2: the report's own header states the player-count MATRIX it ran at,
  // which the pane's single-count echo would both duplicate and, reading the
  // LIVE context, mislabel after a settings change (BUG-014).
  ownsSettingsHeader: true,
  params: [
    PLAYER_COUNT_PARAMS,
    {
      key: "runsPerPlayerCount",
      type: "integer",
      label: "Runs per player count",
      help: "How many generations to run at each selected player count.",
      default: DEFAULT_RUNS_PER_PLAYER_COUNT,
      min: MIN_RUNS_PER_PLAYER_COUNT,
      max: MAX_RUNS_PER_PLAYER_COUNT,
    },
    {
      key: "baseSeed",
      type: "integer",
      label: "Base seed",
      help: "The first generation's seed; later runs at one player count use baseSeed + 1, baseSeed + 2, and so on, resetting at each player count.",
      default: DEFAULT_BASE_SEED,
      min: 0,
    },
    {
      key: "hideHealthy",
      type: "boolean",
      label: "Hide commands with no problems",
      help: "Leave out rows that placed everything they attempted at every player count, with no failure buckets. The report always says how many were hidden.",
      // Default ON: the corpus's finding tables run to hundreds of rows, of
      // which the overwhelming majority are healthy, and this tool exists to
      // surface the ones that are not. The count of hidden rows is printed
      // unconditionally, so the default never costs the reader a fact.
      default: true,
    },
    {
      key: "staticOnly",
      type: "boolean",
      label: "Static checks only (fast)",
      help: "Skip the Monte Carlo layer entirely for a fast first pass. The static checks always run regardless of this setting.",
      default: false,
    },
  ],
  // edit-source is not declared, this tool reports, it does not patch code.
  // read-selection is not declared, nothing here is selection-scoped.
};

// ---------------------------------------------------------------------------
// Sec.4.1: the loop
// ---------------------------------------------------------------------------

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resolvePlayerCounts(raw: unknown): number[] {
  const values = Array.isArray(raw) ? raw : PLAYER_COUNT_PARAMS.default;
  const counts = (values as unknown[])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return [...new Set(counts)].sort((a, b) => a - b);
}

interface OutputInputs {
  ctx: ToolContext<ParseResult>;
  parse: ParseResult;
  staticFindings: readonly StaticFinding[];
  aggregate: MonteCarloAggregate;
  selectedCounts: readonly number[];
  reasonCtx: StageReasonContext;
  runsPerPlayerCount: number;
  baseSeed: number;
  totalGenerations: number;
  startedAt: number;
  hideHealthy: boolean;
}

function buildOutput(inputs: OutputInputs): OutputBlock[] {
  const { ctx, parse, staticFindings, aggregate, selectedCounts, reasonCtx } =
    inputs;
  const mapSizeName = ctx.settings?.mapSize.name ?? "?";
  return [
    buildSummaryHeader({
      playerCounts: selectedCounts,
      mapSizeName,
      runsPerPlayerCount: inputs.runsPerPlayerCount,
      baseSeed: inputs.baseSeed,
      totalGenerations: inputs.totalGenerations,
      elapsedMs: Date.now() - inputs.startedAt,
    }),
    ...buildStaticFindingBlocks(
      staticFindings,
      selectedCounts,
      parse.lineOffsets,
    ),
    ...buildFindingTables(aggregate, {
      source: parse.source,
      selectedCounts,
      reasonCtx,
      suppressedActorAreaMissing: suppressedActorAreaSpans(staticFindings),
      hideHealthy: inputs.hideHealthy,
    }),
    ...buildNotesBlocks(aggregate.noteGroups(), parse.lineOffsets),
  ];
}

async function runChecker(
  ctx: ToolContext<ParseResult>,
  emit: (msg: ToolMessage) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const parse = ctx.parseResult;
  if (!parse || !ctx.settings || !ctx.referenceData) {
    emit({
      type: "error",
      message:
        "This tool needs the parsed script, generation settings and reference data, which the host did not provide.",
      reason: "host-error",
    });
    return;
  }

  const selectedCounts = resolvePlayerCounts(ctx.params.playerCounts);
  const runsPerPlayerCount =
    typeof ctx.params.runsPerPlayerCount === "number"
      ? ctx.params.runsPerPlayerCount
      : DEFAULT_RUNS_PER_PLAYER_COUNT;
  const baseSeed =
    typeof ctx.params.baseSeed === "number"
      ? ctx.params.baseSeed
      : DEFAULT_BASE_SEED;
  const staticOnly = ctx.params.staticOnly === true;
  // `!== false` rather than `=== true`: the default is ON, so an absent param
  // (an older saved param set, or a host that sends only what changed) must
  // read as the default rather than silently inverting it.
  const hideHealthy = ctx.params.hideHealthy !== false;

  const languageIndex = buildLanguageIndex(ctx.referenceData.language);
  const constants = ctx.referenceData.gameConstants;
  // Sec.4.1: this conversion happens ONCE, before any loop, never per
  // generation, or the WeakMap index objectEntry builds gets silently rebuilt
  // every single run.
  const refDb: PreviewReferenceData = {
    language: languageIndex,
    constants: objectConstantsFromPublished(constants),
  };

  // -------------------------------------------------------------------
  // Sec.3.0 rule 1: the static layer, once per selected player count, at
  // the SAME baseSeed the Monte Carlo layer starts from.
  // -------------------------------------------------------------------
  // Sec.5.2's "Elapsed" is the whole run's, and with `staticOnly: true` the
  // static layer IS the whole run, set below the static loop it reported
  // `0.0s` for a pass that walks the AST once per selected player count.
  const startedAt = Date.now();

  const astCtx: StaticContext = buildStaticContext(parse);
  const instByCount = new Map<number, InstantiatedScript>();
  const staticFindings: StaticFinding[] = [];

  for (const pc of selectedCounts) {
    const bridged = previewSettingsFromContext(ctx, { playerCount: pc });
    if (!bridged.ok) {
      // NOT `continue`. Skipping every count silently produces a report whose
      // header reads "Total generations 60" over empty tables, the "clean
      // report on a script the tool read none of" failure Sec.5.4's
      // covered-fraction clause exists to prevent, arriving through the
      // settings door. Same treatment as the missing `referenceData` above.
      emit({
        type: "error",
        message: `This tool could not read the generation settings (${bridged.reason}), so it has nothing to check against.`,
        reason: "host-error",
      });
      return;
    }
    const inst = instantiateScript(
      parse,
      languageIndex,
      bridged.settings,
      baseSeed,
    );
    instByCount.set(pc, inst);
    staticFindings.push(...runStaticChecks(inst, parse, constants, astCtx, pc));
    emit({ type: "progress", note: `Static checks at ${pc} players` });
    if (isCancelled()) {
      emit({
        type: "error",
        message: "The static checks were cancelled.",
        reason: "cancelled",
      });
      return;
    }
    await yieldToEventLoop();
  }

  const cliffsContradiction = staticFindings.some(
    (f) => f.kind === "cliffsMinExceedsMax",
  );
  const connectionBlockedSpans = new Set<number>();

  const aggregate = new MonteCarloAggregate();
  aggregate.setSourceLength(parse.source.length);

  const totalGenerations = staticOnly
    ? 0
    : selectedCounts.length * runsPerPlayerCount;
  let completed = 0;

  if (!staticOnly) {
    for (let i = 0; i < selectedCounts.length; i++) {
      const pc = selectedCounts[i];
      // Sec.4.1: `runIndex` RESETS at each player count, 2/4/6/8 is a paired
      // comparison over one seed set, not four unrelated seed ranges.
      for (let runIndex = 0; runIndex < runsPerPlayerCount; runIndex++) {
        if (isCancelled()) {
          emit({
            type: "error",
            message: "The run was cancelled.",
            reason: "cancelled",
          });
          return;
        }
        const seed = baseSeed + runIndex;
        const outcome = runPreviewFromContext(
          ctx,
          refDb,
          { seed, collectSnapshots: false },
          { playerCount: pc },
        );
        if (!outcome.ok) {
          // Unreachable as long as the static loop above ran: every
          // `PreviewBridgeFailure` reason is a property of `ctx`, which that
          // loop already validated and bailed on. Kept, and kept as an ERROR
          // rather than a `continue`, because the alternative is what this
          // loop used to do, count the generation as `completed` and print
          // "Total generations 60" over a report built from fewer.
          emit({
            type: "error",
            message: `The generation settings stopped being readable partway through the run (${outcome.reason}), so these results would be incomplete.`,
            reason: "host-error",
          });
          return;
        }
        aggregate.addGeneration(
          pc,
          outcome.result.reports,
          outcome.result.notes,
        );
        for (const note of outcome.result.notes) {
          const match = /^connectionBlockedByBug:(\d+)$/.exec(note.key);
          if (match) connectionBlockedSpans.add(Number(match[1]));
        }
        completed++;
        emit({
          type: "progress",
          fraction:
            totalGenerations > 0 ? completed / totalGenerations : undefined,
          note: `${pc} players, run ${runIndex + 1} of ${runsPerPlayerCount}`,
        });
        // Sec.4.1: chunk unit is ONE generation, generatePreview is
        // synchronous and cannot yield inside itself, so the macrotask
        // boundary has to sit HERE, between calls, for a pending cancel to
        // ever be serviced.
        await yieldToEventLoop();
      }

      // Sec.4.5: a `partial` after every completed count EXCEPT the last,
      // the last count's batch completing leaves the aggregate identical to
      // what `result` carries next, so a partial there is a redundant
      // full re-render for no benefit.
      if (i < selectedCounts.length - 1) {
        const countsSoFar = selectedCounts.slice(0, i + 1);
        // The reason context is narrowed with the counts, not left wider than
        // its consumer: `stageReason` looks up `worst.playerCount`, and a
        // record whose domain exceeds its consumer's is one edit from the
        // defect the line below is about.
        const partialInstByCount = new Map(
          [...instByCount].filter(([pc]) => countsSoFar.includes(pc)),
        );
        const reasonCtx: StageReasonContext = {
          instByCount: partialInstByCount,
          cliffsContradiction,
          connectionBlockedSpans,
        };
        emit({
          type: "partial",
          output: {
            blocks: buildOutput({
              ctx,
              parse,
              staticFindings,
              aggregate,
              // Sec.4.5: a partial's table ranges over the counts RUN so far,
              // never over the whole selected matrix.
              selectedCounts: countsSoFar,
              reasonCtx,
              runsPerPlayerCount,
              baseSeed,
              totalGenerations,
              startedAt,
              hideHealthy,
            }),
          },
        });
      }
    }
  }

  const reasonCtx: StageReasonContext = {
    instByCount,
    cliffsContradiction,
    connectionBlockedSpans,
  };
  emit({
    type: "result",
    output: {
      blocks: buildOutput({
        ctx,
        parse,
        staticFindings,
        aggregate,
        selectedCounts,
        reasonCtx,
        runsPerPlayerCount,
        baseSeed,
        totalGenerations,
        startedAt,
        hideHealthy,
      }),
    },
  });
}

export const consistencyChecker: ToolImplementation = {
  manifest: consistencyCheckerManifest,
  run(
    ctx: ToolContext<ParseResult>,
    emit: (msg: ToolMessage) => void,
  ): ToolRunHandle {
    let cancelled = false;
    runChecker(ctx, emit, () => cancelled).catch((e: unknown) => {
      emit({ type: "error", message: String(e), reason: "tool-error" });
    });
    return {
      cancel() {
        cancelled = true;
      },
    };
  },
};
