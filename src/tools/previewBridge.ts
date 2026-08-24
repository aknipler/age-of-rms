/**
 * ToolContext -> PreviewSettings (tools-api-design.md Sec.3, Sec.9 item 2).
 *
 * The two specs meet exactly here, and this seam has broken three consecutive
 * revisions of the tools contract: `settings.mapSize` typed `number` when the
 * app had a string union; `mapSize.tiles` with no source of truth while the data
 * had one; `settings` missing `teams` three weeks after the app grew the
 * concept. Each was caught by a human reading two documents side by side. This
 * module exists so the fourth is caught by `tsc` instead — it stops compiling
 * the day `PreviewSettings` grows a required field, which is precisely the event
 * all three are instances of.
 *
 * Its honest limits, since overselling it is how the next one gets missed:
 * it catches added REQUIRED fields and changed types. It does not catch a new
 * optional field, a field whose meaning changes under a stable type, or the
 * reverse dependency — `ToolContext` gaining a field `PreviewSettings` should
 * have consumed is exactly what `teams` was, and nothing here would have seen
 * it. And it watches ONE seam: the Current/Final cut point broke the contract at
 * a seam where these two types never meet.
 */

import { generatePreview, type PreviewReferenceData } from "../preview/generator/index";
import type { PreviewOptions, PreviewResult, PreviewSettings } from "../preview/generator/types";
import type { ObjectConstant } from "../preview/generator/objects";
import { isMapSize, isTeams } from "../generationSettings/generationSettingsConstants";
import type { ParseResult } from "../parser/types";
import type { PublishedGameConstants, ToolContext } from "../../tools-api/index";

export type PreviewBridgeFailure =
  | { ok: false; reason: "no-settings" }
  | { ok: false; reason: "bad-map-size"; value: string }
  | { ok: false; reason: "bad-teams" };

export type PreviewBridgeResult = { ok: true; settings: PreviewSettings } | PreviewBridgeFailure;

/**
 * Bridge the two shape mismatches, both deliberate and both cheap:
 * `mapSize.name` is a plain `string` (so external tools need no import) while
 * `PreviewSettings.mapSize` is the `MapSize` union, and `settings.teams` is
 * `number[]` while `PreviewSettings.teams` is `readonly TeamNumber[]`.
 *
 * NARROW with the app's own guards; do NOT cast. A cast here would let a
 * malformed context reach the generator and fail somewhere unrecognisable — and
 * for a v1.1 external tool the context round-trips through JSON, so "it came
 * from our own UI" stops being true.
 *
 * `overrides.playerCount`, applied AFTER narrowing (consistency-checker-
 * design.md Sec.4.1, Sec.7.2 item 2): without it every "player count" a
 * caller wants to sweep reads back as `ctx.settings.playerCount` — the pane's
 * one live value — because that is the only source this function has. The
 * override lives here rather than only on `runPreviewFromContext` so the
 * STATIC layer (which needs a bare `PreviewSettings` per count, never a full
 * `PreviewResult`) has a sanctioned path too; putting it one level up would
 * leave that caller to either re-spread `{ ...bridged.settings, playerCount }`
 * itself — the parallel construction this module exists to prevent — or run
 * at one count and mislabel the rest.
 */
export function previewSettingsFromContext(
  ctx: ToolContext<ParseResult>,
  overrides?: { playerCount?: number },
): PreviewBridgeResult {
  const settings = ctx.settings;
  if (!settings) return { ok: false, reason: "no-settings" };

  if (!isMapSize(settings.mapSize.name)) {
    return { ok: false, reason: "bad-map-size", value: settings.mapSize.name };
  }
  if (!isTeams(settings.teams)) return { ok: false, reason: "bad-teams" };

  return {
    ok: true,
    settings: {
      playerCount: overrides?.playerCount ?? settings.playerCount,
      mapSize: settings.mapSize.name,
      teams: settings.teams,
    },
  };
}

/**
 * `ToolReferenceData.gameConstants` (`PublishedGameConstants`) does NOT
 * assign to `PreviewReferenceData.constants` (`readonly ObjectConstant[]`)
 * (consistency-checker-design.md Sec.4.1, Sec.7.2 item 2): the published
 * element declares `constId?: number | null` while `ObjectConstant` declares
 * it `number | null`, REQUIRED — optionality widens the domain by
 * `undefined`, which is a `TS2322` against this repo's own `tsconfig.json`.
 * This is the one named conversion, in the module whose entire purpose is
 * this class of seam; the call site must never paper over it with
 * `as unknown as readonly ObjectConstant[]` instead.
 *
 * Widening `ObjectConstant.constId` to optional was the alternative and is
 * NOT free: `grid.ts`/`palette.ts` and four test files narrow it with
 * `!== null`, and the widening produces ~30 fresh compiler errors measured
 * against this tree. Defaulting an absent `constId` to `null` here is inert
 * at runtime — `objectIndex` (`objects.ts`) already guards
 * `c.constId !== null && c.constId !== undefined` — and costs nothing at the
 * many call sites that already assume `ObjectConstant`.
 */
export function objectConstantsFromPublished(constants: PublishedGameConstants): readonly ObjectConstant[] {
  return constants.map((c) => ({
    constId: c.constId ?? null,
    rmsConstant: c.rmsConstant,
    category: c.category,
    resourceAmounts: c.resourceAmounts,
    isWater: c.isWater,
    isForest: c.isForest,
    habitat: c.habitat,
  }));
}

/**
 * The whole point of the exercise: a built-in hands `ctx.parseResult` STRAIGHT
 * to `generatePreview`, with no conversion, no clone and no decode.
 *
 * That is only possible because the `±Infinity` sentinel is scoped to the
 * external wire (Sec.4). Re-scope it to both transports and this line stops
 * compiling — `generatePreview` takes a `ParseResult` and the serialized form is
 * its supertype — which is precisely the change that would otherwise silently
 * break the flagship tool at runtime, since every numeric read in the generator
 * is a `typeof v === "number"` guard that a sentinel object falls straight past.
 */
export function runPreviewFromContext(
  ctx: ToolContext<ParseResult>,
  refDb: PreviewReferenceData,
  opts: PreviewOptions,
  overrides?: { playerCount?: number },
): { ok: true; result: PreviewResult } | PreviewBridgeFailure {
  const bridged = previewSettingsFromContext(ctx, overrides);
  if (!bridged.ok) return bridged;
  if (!ctx.parseResult) return { ok: false, reason: "no-settings" };
  return { ok: true, result: generatePreview(ctx.parseResult, refDb, bridged.settings, opts) };
}
