/**
 * Balance Summary, the second of CREATION_PLAN 5.2b's additional built-ins.
 *
 * A Monte Carlo pass across a selected player-count matrix (same shape as
 * 5.2's consistency checker, and reusing its tuned run-count constants
 * rather than inventing a fresh, unmeasured range) reporting, per player and
 * resource type: how much of it they average, how far the nearest patch
 * sits from their land origin, and how many patches a generation gives them.
 * Printed side by side across players, so a script that quietly favours one
 * spawn over another shows up as a number instead of a hunch.
 *
 * Ties into the same generator plumbing 5.2 already proved out
 * (`previewBridge.ts`, `objects.ts`'s `objectEntry`/category resolution).
 * This tool's whole job is reading `PreviewResult.objects` and `.players`
 * that generation already produces, not deriving anything new about how the
 * game places resources.
 */

import type { ParseResult } from "../../parser/types";
import type { PlacedObject, PlayerMarker } from "../../preview/generator/types";
import type { PreviewReferenceData } from "../../preview/generator/index";
import { objectEntry } from "../../preview/generator/objects";
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
  runPreviewFromContext,
  toolPreviewReferenceData,
} from "../previewBridge";
import {
  DEFAULT_BASE_SEED,
  DEFAULT_PLAYER_COUNTS,
  DEFAULT_RUNS_PER_PLAYER_COUNT,
  MAX_RUNS_PER_PLAYER_COUNT,
  MIN_RUNS_PER_PLAYER_COUNT,
} from "./consistencyChecker";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const PLAYER_COUNT_PARAMS: ToolParamDef = {
  key: "playerCounts",
  type: "multiSelect",
  label: "Player counts",
  help: "Which player counts to run the Monte Carlo pass at.",
  default: DEFAULT_PLAYER_COUNTS.map(String),
  options: DEFAULT_PLAYER_COUNTS.map((n) => ({
    value: String(n),
    label: String(n),
  })),
  minSelected: 1,
};

/** Tiles from a player's start within which a resource counts as theirs. */
export const DEFAULT_MAX_DISTANCE = 28;
const MIN_MAX_DISTANCE = 1;
const MAX_MAX_DISTANCE = 500;

export const balanceSummaryManifest: ToolManifest = {
  id: "balance-summary",
  name: "Balance Summary",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description:
    "Runs generations across a player-count matrix and reports each player's average gold/stone/food/wood and nearest-patch distance, side by side.",
  capabilities: [
    "read-source",
    "read-ast",
    "read-generation-settings",
    "read-reference",
  ],
  // Same reasoning as the consistency checker: the report's own header states
  // the player-count MATRIX it ran, which the pane's single-count echo would
  // both duplicate and mislabel after a live settings change.
  ownsSettingsHeader: true,
  params: [
    PLAYER_COUNT_PARAMS,
    {
      key: "runsPerPlayerCount",
      type: "integer",
      label: "Runs per player count",
      help: "How many generations to average at each selected player count.",
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
    },
    {
      key: "maxDistance",
      type: "integer",
      label: "Max distance (tiles)",
      help: "A resource counts for the player whose start is nearest, in a straight line, if it is within this many tiles. Farther ones count for nobody. Each resource counts for one player at most.",
      default: DEFAULT_MAX_DISTANCE,
      min: MIN_MAX_DISTANCE,
      max: MAX_MAX_DISTANCE,
    },
  ],
};

// ---------------------------------------------------------------------------
// Attribution: which player a resource patch belongs to
// ---------------------------------------------------------------------------

/**
 * The four categories `objects.ts`'s `objectCategory` ever produces for a
 * resource. Not a new vocabulary, the same fixed set that function already
 * commits to; kept here as the iteration order for this tool's tables.
 */
const RESOURCE_KEYS = ["gold", "stone", "food", "wood"] as const;
type ResourceKey = (typeof RESOURCE_KEYS)[number];

function resourceKeyOf(category: string): ResourceKey | undefined {
  if (!category.startsWith("resource-")) return undefined;
  const key = category.slice("resource-".length);
  return (RESOURCE_KEYS as readonly string[]).includes(key)
    ? (key as ResourceKey)
    : undefined;
}

// ---------------------------------------------------------------------------
// Cross-run aggregation
// ---------------------------------------------------------------------------

interface ResourceCell {
  /** Out of `runsPerPlayerCount`, how many generations placed >=1 patch of this resource for this player. */
  runsWithAny: number;
  /** Summed across EVERY run, absent contributing 0. The average is over the whole batch, not just the runs where it showed up. */
  totalAmountSum: number;
  /** Summed only across runs where it showed up, a "how far, when present" average, which is meaningless to divide by a run that had nothing. */
  nearestDistanceSum: number;
  patchCountSum: number;
  /** Sums of squares of the three per-run figures, for the standard deviation. Same denominators as the sums above. */
  totalAmountSqSum: number;
  nearestDistanceSqSum: number;
  patchCountSqSum: number;
}

function emptyCell(): ResourceCell {
  return {
    runsWithAny: 0,
    totalAmountSum: 0,
    nearestDistanceSum: 0,
    patchCountSum: 0,
    totalAmountSqSum: 0,
    nearestDistanceSqSum: 0,
    patchCountSqSum: 0,
  };
}

/** playerCount -> player -> resource -> cell. */
type BalanceStats = Map<number, Map<number, Map<ResourceKey, ResourceCell>>>;

function cellFor(
  stats: BalanceStats,
  pc: number,
  player: number,
  key: ResourceKey,
): ResourceCell {
  let byPlayer = stats.get(pc);
  if (!byPlayer) {
    byPlayer = new Map();
    stats.set(pc, byPlayer);
  }
  let byResource = byPlayer.get(player);
  if (!byResource) {
    byResource = new Map();
    byPlayer.set(player, byResource);
  }
  let cell = byResource.get(key);
  if (!cell) {
    cell = emptyCell();
    byResource.set(key, cell);
  }
  return cell;
}

/** The player whose start is nearest to (x, y) in a straight line, and how far. */
function nearestPlayer(
  x: number,
  y: number,
  players: readonly PlayerMarker[],
): { player: number; dist: number } | undefined {
  let best: { player: number; dist: number } | undefined;
  for (const p of players) {
    const dist = Math.hypot(x - p.x, y - p.y);
    if (!best || dist < best.dist) best = { player: p.player, dist };
  }
  return best;
}

/**
 * Folds one generation's placements into `stats`. Exported for its own unit
 * test. The amount/distance/attribution split is the entire point of this
 * tool, and it is the one part with no coverage from re-running the checker's
 * own tests (this tool reads the SAME `PreviewResult` shape, but nothing
 * about resource attribution).
 */
export function foldGeneration(
  stats: BalanceStats,
  pc: number,
  objects: readonly PlacedObject[],
  players: readonly PlayerMarker[],
  refDb: PreviewReferenceData,
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): void {
  const originByPlayer = new Map(players.map((p) => [p.player, p]));
  // Per-run scratch: player -> resource -> running total/nearest/count, folded into `stats` once per player/resource at the end of this function.
  const perRun = new Map<
    number,
    Map<ResourceKey, { total: number; nearest: number; count: number }>
  >();

  for (const obj of objects) {
    const key = resourceKeyOf(obj.category);
    if (!key) continue;
    // The nearest player's start in a straight line, if within maxDistance.
    // This asks what a player can reach, so neither ownership nor the
    // command that spawned a resource decides, and one resource counts for
    // one player at most. Farther than maxDistance from every start counts
    // for nobody, which keeps the middle of the map out of every player's
    // figures.
    const nearest = nearestPlayer(obj.x, obj.y, players);
    if (nearest === undefined || nearest.dist > maxDistance) continue;
    const owner = nearest.player;
    if (!originByPlayer.has(owner)) continue;

    const amount =
      objectEntry(obj.objectRef, refDb.constants)?.resourceAmounts?.[key] ?? 0;
    const dist = nearest.dist;

    let byResource = perRun.get(owner);
    if (!byResource) {
      byResource = new Map();
      perRun.set(owner, byResource);
    }
    const running = byResource.get(key) ?? {
      total: 0,
      nearest: Infinity,
      count: 0,
    };
    running.total += amount;
    running.nearest = Math.min(running.nearest, dist);
    running.count++;
    byResource.set(key, running);
  }

  for (const player of originByPlayer.keys()) {
    for (const key of RESOURCE_KEYS) {
      const cell = cellFor(stats, pc, player, key);
      const running = perRun.get(player)?.get(key);
      if (!running) continue;
      cell.runsWithAny++;
      cell.totalAmountSum += running.total;
      cell.nearestDistanceSum += running.nearest;
      cell.patchCountSum += running.count;
      cell.totalAmountSqSum += running.total * running.total;
      cell.nearestDistanceSqSum += running.nearest * running.nearest;
      cell.patchCountSqSum += running.count * running.count;
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  gold: "Gold",
  stone: "Stone",
  food: "Food",
  wood: "Wood",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Population standard deviation from a sum and a sum of squares over `n`
 * runs, the square root of E[x^2] - E[x]^2. A standard deviation rather than
 * the variance it is the root of, because it is in the figure's own units. A
 * swing of about 1650 wood a run is a variance of about 2.7 million, which
 * reads as alarming when it is a moderate swing (measured on Menindee).
 * Floating point can leave a tiny negative variance for a figure that never
 * changed, so it is clamped at 0 before the root.
 */
function standardDeviation(sum: number, sqSum: number, n: number): number {
  if (n <= 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sqSum / n - mean * mean));
}

function buildPlayerCountSection(
  pc: number,
  byPlayer: Map<number, Map<ResourceKey, ResourceCell>>,
  runsPerPlayerCount: number,
): OutputBlock[] {
  const players = [...byPlayer.keys()].sort((a, b) => a - b);

  // A resource with zero occurrences for EVERY player at this count is left
  // out of the table entirely. An all-zero row for every player is not a
  // finding, it is "this script has no stone", which the reader can already
  // tell from the resource's absence.
  const activeKeys = RESOURCE_KEYS.filter((key) =>
    players.some((p) => (byPlayer.get(p)?.get(key)?.runsWithAny ?? 0) > 0),
  );
  if (activeKeys.length === 0 || players.length === 0) {
    return [
      {
        kind: "text",
        text: `${pc} players: no per-player resource patches were placed in any of the ${runsPerPlayerCount} generations.`,
      },
    ];
  }

  // Resource first, then player, so one resource's players sit side by side.
  const rows: string[][] = [];
  for (const key of activeKeys) {
    for (const player of players) {
      const cell = byPlayer.get(player)?.get(key) ?? emptyCell();
      const n = runsPerPlayerCount;
      const avgAmount = Math.round(cell.totalAmountSum / n);
      const amountVar = Math.round(
        standardDeviation(cell.totalAmountSum, cell.totalAmountSqSum, n),
      );
      const withAny = cell.runsWithAny;
      const avgNearest =
        withAny > 0 ? String(round1(cell.nearestDistanceSum / withAny)) : "—";
      const nearestVar =
        withAny > 0
          ? String(
              round1(
                standardDeviation(
                  cell.nearestDistanceSum,
                  cell.nearestDistanceSqSum,
                  withAny,
                ),
              ),
            )
          : "—";
      rows.push([
        RESOURCE_LABEL[key],
        `Player ${player}`,
        String(avgAmount),
        String(amountVar),
        avgNearest,
        nearestVar,
        String(round1(cell.patchCountSum / n)),
        String(
          round1(
            standardDeviation(cell.patchCountSum, cell.patchCountSqSum, n),
          ),
        ),
      ]);
    }
  }

  const spreadLines: string[] = [];
  for (const key of activeKeys) {
    const amounts = players.map(
      (p) =>
        (byPlayer.get(p)?.get(key)?.totalAmountSum ?? 0) / runsPerPlayerCount,
    );
    const maxAmount = Math.max(...amounts);
    const minAmount = Math.min(...amounts);
    if (maxAmount === 0) continue; // nothing to compare
    const maxPlayer = players[amounts.indexOf(maxAmount)];
    const minPlayer = players[amounts.indexOf(minAmount)];
    if (maxPlayer === minPlayer) continue; // one player at this count, or a tie across the board
    const ratio =
      minAmount > 0
        ? ` (${round1(maxAmount / minAmount)}×)`
        : " (least player averages 0)";
    spreadLines.push(
      `${RESOURCE_LABEL[key]}: player ${minPlayer} averages the least at ${Math.round(minAmount)}, player ${maxPlayer} the most at ${Math.round(maxAmount)}${ratio}.`,
    );
  }

  const blocks: OutputBlock[] = [
    {
      kind: "table",
      columns: [
        "Resource",
        "Player",
        "Avg amount",
        "Amount SD",
        "Avg nearest (tiles)",
        "Nearest SD",
        "Objects/run",
        "Objects SD",
      ],
      rows,
    },
  ];
  if (spreadLines.length > 0)
    blocks.push({ kind: "text", text: spreadLines.join("\n") });
  return blocks;
}

/**
 * The Average tab. Per resource, what one player gets on average across every
 * run at every player count, and the player and count that got the least and
 * the most. One row per resource, since a player number is a different start
 * at each count, so a row per player would compare unlike things.
 */
function buildAverageSection(
  stats: BalanceStats,
  counts: readonly number[],
  runsPerPlayerCount: number,
): OutputBlock[] {
  const rows: string[][] = [];
  for (const key of RESOURCE_KEYS) {
    let amountSum = 0;
    let nearestSum = 0;
    let nearestRuns = 0;
    let objectSum = 0;
    let playerRuns = 0;
    let least: { avg: number; player: number; pc: number } | undefined;
    let most: { avg: number; player: number; pc: number } | undefined;
    for (const pc of counts) {
      for (const [player, byResource] of stats.get(pc) ?? new Map()) {
        const cell: ResourceCell = byResource.get(key) ?? emptyCell();
        amountSum += cell.totalAmountSum;
        objectSum += cell.patchCountSum;
        nearestSum += cell.nearestDistanceSum;
        nearestRuns += cell.runsWithAny;
        playerRuns += runsPerPlayerCount;
        const avg = cell.totalAmountSum / runsPerPlayerCount;
        if (!least || avg < least.avg) least = { avg, player, pc };
        if (!most || avg > most.avg) most = { avg, player, pc };
      }
    }
    if (playerRuns === 0 || amountSum === 0) continue;
    rows.push([
      RESOURCE_LABEL[key],
      String(Math.round(amountSum / playerRuns)),
      least
        ? `${Math.round(least.avg)} (player ${least.player}, ${least.pc} players)`
        : "\u2014",
      most
        ? `${Math.round(most.avg)} (player ${most.player}, ${most.pc} players)`
        : "\u2014",
      nearestRuns > 0 ? String(round1(nearestSum / nearestRuns)) : "\u2014",
      String(round1(objectSum / playerRuns)),
    ]);
  }
  if (rows.length === 0)
    return [
      {
        kind: "text",
        text: "No resource was within the max distance of any player in these runs.",
      },
    ];
  return [
    {
      kind: "table",
      columns: [
        "Resource",
        "Avg amount per player",
        "Least",
        "Most",
        "Avg nearest (tiles)",
        "Objects/run per player",
      ],
      rows,
    },
  ];
}

export function buildBalanceOutput(
  stats: BalanceStats,
  selectedCounts: readonly number[],
  runsPerPlayerCount: number,
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): OutputBlock[] {
  // Average first, then one tab per count that has run, the same layout as
  // the consistency checker. A partial report grows its tabs as each count's
  // batch finishes.
  // Every count passed has run (the run loop passes only finished counts),
  // so one that placed nothing for anyone still gets its tab, which says so.
  const ran = selectedCounts;
  const tabs = [
    {
      label: "Average",
      blocks: buildAverageSection(stats, ran, runsPerPlayerCount),
    },
    ...ran.map((pc) => ({
      label: `${pc} players`,
      blocks: buildPlayerCountSection(
        pc,
        stats.get(pc) ?? new Map(),
        runsPerPlayerCount,
      ),
    })),
  ];
  const blocks: OutputBlock[] = [
    { kind: "heading", text: "Balance summary" },
    {
      kind: "text",
      text: `Each resource counts for the player whose start is nearest in a straight line, if it is within ${maxDistance} tiles, and for nobody if it is farther from every start. A resource counts once at most. Objects/run counts each placed resource object (one mine, one bush, one tree), not clusters. SD is the standard deviation across the generations, in the column's own units, so a low figure means the player gets nearly the same result every time.`,
    },
  ];
  if (ran.length > 0) blocks.push({ kind: "tabs", tabs });
  return blocks;
}

// ---------------------------------------------------------------------------
// Run loop, same shape as the consistency checker's (tools-api-design.md
// Sec.4.1's chunk-per-generation rule: generatePreview is synchronous and
// cannot yield inside itself, so the cancellation check has to sit between
// calls).
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

async function runBalanceSummary(
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
      ? // Clamped here as well as in the box, since a saved parameter set
        // can still carry a value from before the bounds changed.
        Math.min(
          MAX_RUNS_PER_PLAYER_COUNT,
          Math.max(
            MIN_RUNS_PER_PLAYER_COUNT,
            Math.trunc(ctx.params.runsPerPlayerCount),
          ),
        )
      : DEFAULT_RUNS_PER_PLAYER_COUNT;
  const baseSeed =
    typeof ctx.params.baseSeed === "number"
      ? ctx.params.baseSeed
      : DEFAULT_BASE_SEED;
  const maxDistance =
    typeof ctx.params.maxDistance === "number"
      ? Math.min(
          MAX_MAX_DISTANCE,
          Math.max(MIN_MAX_DISTANCE, ctx.params.maxDistance),
        )
      : DEFAULT_MAX_DISTANCE;

  const refDb: PreviewReferenceData = toolPreviewReferenceData(
    ctx.referenceData,
  );

  const stats: BalanceStats = new Map();
  const totalGenerations = selectedCounts.length * runsPerPlayerCount;
  let completed = 0;

  for (let i = 0; i < selectedCounts.length; i++) {
    const pc = selectedCounts[i];
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
        emit({
          type: "error",
          message: `The generation settings stopped being readable partway through the run (${outcome.reason}), so these results would be incomplete.`,
          reason: "host-error",
        });
        return;
      }
      foldGeneration(
        stats,
        pc,
        outcome.result.objects,
        outcome.result.players,
        refDb,
        maxDistance,
      );
      completed++;
      emit({
        type: "progress",
        fraction:
          totalGenerations > 0 ? completed / totalGenerations : undefined,
        note: `${pc} players, run ${runIndex + 1} of ${runsPerPlayerCount}`,
      });
      await yieldToEventLoop();
    }

    if (i < selectedCounts.length - 1) {
      emit({
        type: "partial",
        output: {
          blocks: buildBalanceOutput(
            stats,
            selectedCounts.slice(0, i + 1),
            runsPerPlayerCount,
            maxDistance,
          ),
        },
      });
    }
  }

  emit({
    type: "result",
    output: {
      blocks: buildBalanceOutput(
        stats,
        selectedCounts,
        runsPerPlayerCount,
        maxDistance,
      ),
    },
  });
}

export const balanceSummary: ToolImplementation = {
  manifest: balanceSummaryManifest,
  run(
    ctx: ToolContext<ParseResult>,
    emit: (msg: ToolMessage) => void,
  ): ToolRunHandle {
    let cancelled = false;
    runBalanceSummary(ctx, emit, () => cancelled).catch((e: unknown) => {
      emit({ type: "error", message: String(e), reason: "tool-error" });
    });
    return {
      cancel() {
        cancelled = true;
      },
    };
  },
};
