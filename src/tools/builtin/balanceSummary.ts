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

import { buildLanguageIndex } from "../../parser/language";
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
import { objectConstantsFromPublished, runPreviewFromContext } from "../previewBridge";
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
  options: DEFAULT_PLAYER_COUNTS.map((n) => ({ value: String(n), label: String(n) })),
  minSelected: 1,
};

export const balanceSummaryManifest: ToolManifest = {
  id: "balance-summary",
  name: "Balance Summary",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description: "Runs generations across a player-count matrix and reports each player's average gold/stone/food/wood and nearest-patch distance, side by side.",
  capabilities: ["read-source", "read-ast", "read-generation-settings", "read-reference"],
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
  return (RESOURCE_KEYS as readonly string[]).includes(key) ? (key as ResourceKey) : undefined;
}

/**
 * Nearest player-land origin by straight-line distance. This is the fallback
 * for a resource the script never tied to a player frame at all (no
 * `set_place_for_every_player` / `place_on_specific_land_id`), a real
 * approximation, not a fact read off the script, which is why the report
 * says so once rather than per row (Sec.9's honesty-surface convention).
 */
function nearestPlayer(x: number, y: number, players: readonly PlayerMarker[]): number | undefined {
  let best: { player: number; dist: number } | undefined;
  for (const p of players) {
    const dist = Math.hypot(x - p.x, y - p.y);
    if (!best || dist < best.dist) best = { player: p.player, dist };
  }
  return best?.player;
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
}

function emptyCell(): ResourceCell {
  return { runsWithAny: 0, totalAmountSum: 0, nearestDistanceSum: 0, patchCountSum: 0 };
}

/** playerCount -> player -> resource -> cell. */
type BalanceStats = Map<number, Map<number, Map<ResourceKey, ResourceCell>>>;

function cellFor(stats: BalanceStats, pc: number, player: number, key: ResourceKey): ResourceCell {
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

/**
 * Folds one generation's placements into `stats`. Exported for its own unit
 * test. The amount/distance/attribution split is the entire point of this
 * tool, and it is the one part with no coverage from re-running the checker's
 * own tests (this tool reads the SAME `PreviewResult` shape, but nothing
 * about resource attribution).
 */
export function foldGeneration(stats: BalanceStats, pc: number, objects: readonly PlacedObject[], players: readonly PlayerMarker[], refDb: PreviewReferenceData): void {
  const originByPlayer = new Map(players.map((p) => [p.player, p]));
  // Per-run scratch: player -> resource -> running total/nearest/count, folded into `stats` once per player/resource at the end of this function.
  const perRun = new Map<number, Map<ResourceKey, { total: number; nearest: number; count: number }>>();

  for (const obj of objects) {
    const key = resourceKeyOf(obj.category);
    if (!key) continue;
    const owner = obj.player ?? nearestPlayer(obj.x, obj.y, players);
    if (owner === undefined) continue;
    const origin = originByPlayer.get(owner);
    if (!origin) continue;

    const amount = objectEntry(obj.objectRef, refDb.constants)?.resourceAmounts?.[key] ?? 0;
    const dist = Math.hypot(obj.x - origin.x, obj.y - origin.y);

    let byResource = perRun.get(owner);
    if (!byResource) {
      byResource = new Map();
      perRun.set(owner, byResource);
    }
    const running = byResource.get(key) ?? { total: 0, nearest: Infinity, count: 0 };
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
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const RESOURCE_LABEL: Record<ResourceKey, string> = { gold: "Gold", stone: "Stone", food: "Food", wood: "Wood" };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildPlayerCountSection(pc: number, byPlayer: Map<number, Map<ResourceKey, ResourceCell>>, runsPerPlayerCount: number): OutputBlock[] {
  const players = [...byPlayer.keys()].sort((a, b) => a - b);

  // A resource with zero occurrences for EVERY player at this count is left
  // out of the table entirely. An all-zero row for every player is not a
  // finding, it is "this script has no stone", which the reader can already
  // tell from the resource's absence.
  const activeKeys = RESOURCE_KEYS.filter((key) => players.some((p) => (byPlayer.get(p)?.get(key)?.runsWithAny ?? 0) > 0));
  if (activeKeys.length === 0 || players.length === 0) {
    return [{ kind: "text", text: `${pc} players: no per-player resource patches were placed in any of the ${runsPerPlayerCount} generations.` }];
  }

  const rows: string[][] = [];
  for (const player of players) {
    for (const key of activeKeys) {
      const cell = byPlayer.get(player)?.get(key) ?? emptyCell();
      const avgAmount = Math.round(cell.totalAmountSum / runsPerPlayerCount);
      const avgNearest = cell.runsWithAny > 0 ? String(round1(cell.nearestDistanceSum / cell.runsWithAny)) : "—";
      const avgPatches = round1(cell.patchCountSum / runsPerPlayerCount);
      rows.push([`Player ${player}`, RESOURCE_LABEL[key], String(avgAmount), avgNearest, String(avgPatches)]);
    }
  }

  const spreadLines: string[] = [];
  for (const key of activeKeys) {
    const amounts = players.map((p) => (byPlayer.get(p)?.get(key)?.totalAmountSum ?? 0) / runsPerPlayerCount);
    const maxAmount = Math.max(...amounts);
    const minAmount = Math.min(...amounts);
    if (maxAmount === 0) continue; // nothing to compare
    const maxPlayer = players[amounts.indexOf(maxAmount)];
    const minPlayer = players[amounts.indexOf(minAmount)];
    if (maxPlayer === minPlayer) continue; // one player at this count, or a tie across the board
    const ratio = minAmount > 0 ? ` (${round1(maxAmount / minAmount)}×)` : " (least player averages 0)";
    spreadLines.push(`${RESOURCE_LABEL[key]}: player ${minPlayer} averages the least at ${Math.round(minAmount)}, player ${maxPlayer} the most at ${Math.round(maxAmount)}${ratio}.`);
  }

  const blocks: OutputBlock[] = [
    { kind: "heading", text: `${pc} players` },
    { kind: "table", columns: ["Player", "Resource", "Avg amount", "Avg nearest (tiles)", "Patches/run"], rows },
  ];
  if (spreadLines.length > 0) blocks.push({ kind: "text", text: spreadLines.join("\n") });
  return blocks;
}

export function buildBalanceOutput(stats: BalanceStats, selectedCounts: readonly number[], runsPerPlayerCount: number): OutputBlock[] {
  const blocks: OutputBlock[] = [
    { kind: "heading", text: "Balance summary" },
    {
      kind: "text",
      text:
        "A resource the script ties to a player explicitly (set_place_for_every_player, or place_on_specific_land_id on that player's own land) is attributed to that player. Anything else is attributed to its nearest player by distance — an approximation, since the script itself does not say whose it is.",
    },
  ];
  for (const pc of selectedCounts) {
    blocks.push(...buildPlayerCountSection(pc, stats.get(pc) ?? new Map(), runsPerPlayerCount));
  }
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
  const counts = (values as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n));
  return [...new Set(counts)].sort((a, b) => a - b);
}

async function runBalanceSummary(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void, isCancelled: () => boolean): Promise<void> {
  const parse = ctx.parseResult;
  if (!parse || !ctx.settings || !ctx.referenceData) {
    emit({
      type: "error",
      message: "This tool needs the parsed script, generation settings and reference data, which the host did not provide.",
      reason: "host-error",
    });
    return;
  }

  const selectedCounts = resolvePlayerCounts(ctx.params.playerCounts);
  const runsPerPlayerCount = typeof ctx.params.runsPerPlayerCount === "number" ? ctx.params.runsPerPlayerCount : DEFAULT_RUNS_PER_PLAYER_COUNT;
  const baseSeed = typeof ctx.params.baseSeed === "number" ? ctx.params.baseSeed : DEFAULT_BASE_SEED;

  const refDb: PreviewReferenceData = {
    language: buildLanguageIndex(ctx.referenceData.language),
    constants: objectConstantsFromPublished(ctx.referenceData.gameConstants),
  };

  const stats: BalanceStats = new Map();
  const totalGenerations = selectedCounts.length * runsPerPlayerCount;
  let completed = 0;

  for (let i = 0; i < selectedCounts.length; i++) {
    const pc = selectedCounts[i];
    for (let runIndex = 0; runIndex < runsPerPlayerCount; runIndex++) {
      if (isCancelled()) {
        emit({ type: "error", message: "The run was cancelled.", reason: "cancelled" });
        return;
      }
      const seed = baseSeed + runIndex;
      const outcome = runPreviewFromContext(ctx, refDb, { seed, collectSnapshots: false }, { playerCount: pc });
      if (!outcome.ok) {
        emit({
          type: "error",
          message: `The generation settings stopped being readable partway through the run (${outcome.reason}), so these results would be incomplete.`,
          reason: "host-error",
        });
        return;
      }
      foldGeneration(stats, pc, outcome.result.objects, outcome.result.players, refDb);
      completed++;
      emit({
        type: "progress",
        fraction: totalGenerations > 0 ? completed / totalGenerations : undefined,
        note: `${pc} players — run ${runIndex + 1} of ${runsPerPlayerCount}`,
      });
      await yieldToEventLoop();
    }

    if (i < selectedCounts.length - 1) {
      emit({ type: "partial", output: { blocks: buildBalanceOutput(stats, selectedCounts.slice(0, i + 1), runsPerPlayerCount) } });
    }
  }

  emit({ type: "result", output: { blocks: buildBalanceOutput(stats, selectedCounts, runsPerPlayerCount) } });
}

export const balanceSummary: ToolImplementation = {
  manifest: balanceSummaryManifest,
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle {
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
