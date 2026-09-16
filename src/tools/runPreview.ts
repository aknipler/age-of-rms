/**
 * Layer 1 (land-placement-design.md Sec.3.4): "the tool asks, the host
 * runs." Given a `ToolToHost` "generate" message and the app's own
 * `ToolContext`, runs `generatePreview` in-process and hands back a
 * `PreviewSummary`, bounded by land count, never the grid or the object
 * list (Sec.3.8's whole argument for why that is cheaper AND more useful
 * than shipping the grid).
 *
 * BUILT-IN ONLY, same restriction as `ToolManifest.surface: "panel"` itself:
 * this calls `generatePreview` directly, in-process, with zero copy. The
 * "one contract, two costs" split `tools-api-design.md` Sec.1 already runs
 * on. An external (v1.1) tool would need this SAME logic re-hosted behind
 * the wire transport, which is future work this module does not attempt.
 *
 * Sec.3.8's handle policy: "a `generate` supersedes that tool's previous
 * handle. The host retains at most one result per tool, and the superseded
 * one is freed at the moment the new one is produced." `release` survives
 * only as an early free a well-behaved tool can offer, never a step a
 * correct host waits for. Correctness cannot depend on a tool that may
 * have crashed.
 */

import type { PreviewReferenceData } from "../preview/generator/index";
import { countOwnedTiles } from "../preview/generator/lands";
import { truncateAst } from "../preview/generator/truncateAst";
import type {
  PlacementFailure,
  PreviewResult,
} from "../preview/generator/types";
import type { ParseResult } from "../parser/types";
import { runPreviewFromContext } from "./previewBridge";
import {
  LIMITS,
  type HostToTool,
  type PreviewSummary,
  type ToolContext,
  type ToolToHost,
} from "../../tools-api/index";

/**
 * Sec.3.8: "a result describes one (source text, playerCount, mapSize, seed,
 * cutOffset). When any of them changes the handle is stale." Under the
 * one-entry-per-tool supersession policy this is checked by HANDLE IDENTITY
 * rather than by re-comparing those five values: a changed generation always
 * produces a fresh handle id and replaces the old entry outright, so
 * `entry.handle !== msg.handle` is the value-equality check's cheaper
 * equivalent, not an approximation of it.
 */
interface HandleEntry {
  handle: string;
  result: PreviewResult;
  /** Reset on every `generate`; Sec.3.8's per-run byte budget for `sliceRequest`. */
  bytesServed: number;
}

let nextHandleId = 1;

/**
 * One live result per tool (Sec.3.8), a `Map` keyed by tool id is the whole
 * policy: setting a new entry for a tool is what frees the old one (nothing
 * else references it after that), so a leak is unrepresentable rather than
 * merely avoided by discipline.
 */
export class PreviewHandleStore {
  private readonly byTool = new Map<string, HandleEntry>();

  /** Sec.3.4 layer 1's `generate`. Always supersedes; never returns `generateFailed` for a NEW request. */
  generate(
    toolId: string,
    ctx: ToolContext<ParseResult>,
    refDb: PreviewReferenceData,
    msg: Extract<ToolToHost, { type: "generate" }>,
  ): HostToTool {
    if (!ctx.parseResult)
      return { type: "generateFailed", reason: "no parse result in context" };

    const cutOffset = msg.cutOffset ?? null;
    const parse =
      cutOffset === null
        ? ctx.parseResult
        : truncateAst(ctx.parseResult, cutOffset);
    // A real panel always pins its own seed (Sec.3.3: "an unpinned draw
    // inside a land_position cannot be held still between two frames") and
    // supplies it on every call; the fallback exists only so an omitted
    // seed fails safely (a stable-within-this-process default) rather than
    // throwing.
    const seed = msg.seed ?? 1;

    const bridged = runPreviewFromContext(
      { ...ctx, parseResult: parse },
      refDb,
      { seed, collectSnapshots: false },
      msg.settings?.playerCount !== undefined
        ? { playerCount: msg.settings.playerCount }
        : undefined,
    );
    if (!bridged.ok) return { type: "generateFailed", reason: bridged.reason };

    const result = bridged.result;
    const handle = `h${nextHandleId++}`;
    this.byTool.set(toolId, { handle, result, bytesServed: 0 });

    return { type: "generated", handle, summary: buildSummary(result) };
  }

  /** Sec.3.4 layer 1's `sliceRequest`, bounded by Sec.3.8's per-rect area cap and per-run byte budget. */
  sliceRequest(
    toolId: string,
    msg: Extract<ToolToHost, { type: "sliceRequest" }>,
  ): HostToTool {
    const entry = this.byTool.get(toolId);
    if (!entry || entry.handle !== msg.handle) {
      return {
        type: "generateFailed",
        reason:
          "this handle is stale, a newer generate has already superseded it",
      };
    }

    const { rect } = msg;
    if (rect.w <= 0 || rect.h <= 0)
      return {
        type: "generateFailed",
        reason: "sliceRequest rect must have positive width and height",
      };
    const area = rect.w * rect.h;
    if (area > MAX_SLICE_AREA_TILES) {
      return {
        type: "generateFailed",
        reason: `sliceRequest rect covers ${area} tiles, over the ${MAX_SLICE_AREA_TILES}-tile cap`,
      };
    }
    // Sec.13: "the outbound sibling" of LIMITS.maxInboundLineBytes, same
    // asymmetry tools-api/index.ts already draws between the inbound line
    // cap and maxOutboundRunBytes, reused rather than a fresh constant.
    const bytesThisSlice = area * BYTES_PER_SLICED_TILE;
    if (entry.bytesServed + bytesThisSlice > LIMITS.maxOutboundRunBytes) {
      return {
        type: "generateFailed",
        reason:
          "this generation's slice budget is exhausted, request a smaller rect or call generate again",
      };
    }

    const { dim, grid } = entry.result;
    const terrain: number[] = [];
    const elevation: number[] = [];
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(dim, x0 + rect.w);
    const y1 = Math.min(dim, y0 + rect.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * dim + x;
        terrain.push(grid.terrain[i]);
        elevation.push(grid.elevation[i]);
      }
    }

    entry.bytesServed += bytesThisSlice;
    return {
      type: "previewSlice",
      handle: entry.handle,
      rect,
      terrain,
      elevation,
    };
  }

  /** Sec.3.4 layer 1's `release`, an early free, never a step a correct host waits for. */
  release(toolId: string, msg: Extract<ToolToHost, { type: "release" }>): void {
    const entry = this.byTool.get(toolId);
    if (entry && entry.handle === msg.handle) this.byTool.delete(toolId);
  }

  /** Sec.3.8: `documentReplaced()` (File > Open) invalidates every handle. */
  invalidateAll(): void {
    this.byTool.clear();
  }

  /** Sec.3.8: a panel's unmount `reset()` drops handles with the run, handles are run-scoped. */
  invalidateTool(toolId: string): void {
    this.byTool.delete(toolId);
  }

  /** Test/debug only, the number of tools currently holding a live handle. */
  size(): number {
    return this.byTool.size;
  }
}

/**
 * Measured worst case (Sec.3.8): a Giant grid is 682 KB for terrain+elevation
 * combined at ~11 bytes/tile across all seven arrays, but a slice ships only
 * TWO of those (terrain, elevation) as plain JSON numbers, 2 bytes/tile is
 * the honest per-array cost; JSON's own overhead (`,` and digit text) is
 * what the byte budget below is actually pricing, not the typed-array size.
 * A conservative 8 bytes/tile (two 4-byte JSON numbers with separators)
 * keeps the cap from under-pricing a real request.
 */
const BYTES_PER_SLICED_TILE = 8;

/** One `sliceRequest` may not ask for more than a Giant map's worth of tiles at once. */
const MAX_SLICE_AREA_TILES = 252 * 252;

function buildSummary(result: PreviewResult): PreviewSummary {
  const owned = countOwnedTiles(result.landOrigins, result.grid);
  return {
    dim: result.dim,
    seedUsed: result.seedUsed,
    landOrigins: result.landOrigins.map((origin, index) => ({
      commandSpan: origin.commandSpan,
      x: origin.x,
      y: origin.y,
      zone: origin.zone,
      player: origin.player,
      tiles: owned[index],
      declaredTargetTiles: origin.declaredTargetTiles,
    })),
    reports: result.reports.map((report) => ({
      commandSpan: report.commandSpan,
      stage: report.stage,
      attempted: report.attempted,
      placed: report.placed,
      failureBuckets: failureBucketCounts(report.failures),
    })),
    notes: result.notes.map((note) => ({ key: note.key, text: note.text })),
    objectCount: result.objects.length,
  };
}

/**
 * `occurrences ?? 1`, never `.count`, `PlacementFailure` has no `count`
 * field (`types.ts`), and this exact confusion shipped a silently-wrong
 * figure once already (build-log.md's rev-12 fold: `failure.count ?? 1`
 * evaluated to `1` for every record because the field does not exist).
 */
function failureBucketCounts(
  failures: readonly PlacementFailure[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of failures)
    out[f.bucket] = (out[f.bucket] ?? 0) + (f.occurrences ?? 1);
  return out;
}
