// tools-api-design.md Sec.9 item 2 — the test the spec says to write FIRST,
// and the reason is not sequencing pedantry: writing these "four lines" is what
// found the sentinel-scoping bug in the first place. Under a both-transports
// sentinel this file does not compile, because `ctx.parseResult` would be a
// `SerializedParseResult` and `generatePreview` takes a `ParseResult`.
//
// So the load-bearing assertion here is the one vitest cannot see: that
// `runPreviewFromContext` TYPECHECKS. The runtime assertions below exist to
// prove the narrowing does what it claims and that the wiring is real rather
// than merely well-typed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import type { PreviewReferenceData } from "../../preview/generator/index";
import type { ObjectConstant } from "../../preview/generator/objects";
import { resolveMapDim } from "../../preview/generator/mapDimensions";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";
import type { ParseResult } from "../../parser/types";
import { TOOLS_API_VERSION, type PublishedGameConstants, type ToolContext } from "../../../tools-api/index";
import { objectConstantsFromPublished, previewSettingsFromContext, runPreviewFromContext } from "../previewBridge";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);
const constants = (
  JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as {
    constants: ObjectConstant[];
  }
).constants;
const refDb: PreviewReferenceData = { language, constants };

const SCRIPT = `
<PLAYER_SETUP>
  random_placement
<LAND_GENERATION>
  base_terrain GRASS
  create_player_lands { terrain_type GRASS land_percent 20 }
`;

/**
 * Build the IN-PROCESS context a built-in receives: real `ParseResult`, real
 * numbers, no sentinels. `mapSize.tiles` comes from `resolveMapDim` rather than
 * a literal — the spec withdraws its own earlier instruction to create a
 * `MAP_SIZE_TILES` constant, because that resolver already exists and writing a
 * second one is the same mistake one level down.
 */
function context(overrides: Partial<ToolContext<ParseResult>["settings"]> = {}): ToolContext<ParseResult> {
  const name = overrides?.mapSize?.name ?? "Tiny";
  const tiles = overrides?.mapSize?.tiles ?? resolveMapDim(name as never, lang.predefinedLabels ?? []) ?? 0;
  return {
    apiVersion: TOOLS_API_VERSION,
    parseResult: parseRms(SCRIPT, lang),
    source: SCRIPT,
    settings: {
      playerCount: overrides?.playerCount ?? 4,
      mapSize: { name, tiles },
      teams: overrides?.teams ?? [...DEFAULT_TEAMS],
    },
    params: {},
  };
}

describe("previewSettingsFromContext", () => {
  it("narrows a well-formed context into PreviewSettings", () => {
    const bridged = previewSettingsFromContext(context());
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;
    expect(bridged.settings.mapSize).toBe("Tiny");
    expect(bridged.settings.playerCount).toBe(4);
    expect(bridged.settings.teams).toHaveLength(8);
  });

  it("reports a missing settings block rather than defaulting it away", () => {
    const ctx = context();
    delete ctx.settings;
    expect(previewSettingsFromContext(ctx)).toEqual({ ok: false, reason: "no-settings" });
  });

  // The context is `{ name: string }` on purpose so external tools need no
  // import of the app's union. That makes an unrecognised size REACHABLE rather
  // than hypothetical, and a cast here would carry it into the generator.
  it("rejects a map size outside the app's union instead of casting it through", () => {
    const bridged = previewSettingsFromContext(context({ mapSize: { name: "Enormous", tiles: 999 } }));
    expect(bridged).toEqual({ ok: false, reason: "bad-map-size", value: "Enormous" });
  });

  // isTeams checks BOTH length and membership. Length matters independently:
  // `teams` is always 8 regardless of playerCount, because the settings pane
  // retains assignments for players currently counted out.
  it("rejects a teams array of the wrong length", () => {
    const bridged = previewSettingsFromContext(context({ teams: [0, 0, 0, 0] }));
    expect(bridged).toEqual({ ok: false, reason: "bad-teams" });
  });

  it("rejects a team number outside 0-4", () => {
    const bridged = previewSettingsFromContext(context({ teams: [0, 0, 0, 0, 0, 0, 0, 9] }));
    expect(bridged).toEqual({ ok: false, reason: "bad-teams" });
  });

  // Sec.7.2 item 2 / Sec.4.1: without this, every "player count" the Monte
  // Carlo loop wants to sweep reads back as ctx.settings.playerCount, the
  // pane's one live value, and the matrix generates the same map four times.
  describe("playerCount override (Sec.7.2 item 2)", () => {
    it("overrides playerCount AFTER narrowing, leaving mapSize/teams untouched", () => {
      const bridged = previewSettingsFromContext(context({ playerCount: 4 }), { playerCount: 8 });
      expect(bridged.ok).toBe(true);
      if (!bridged.ok) return;
      expect(bridged.settings.playerCount).toBe(8);
      expect(bridged.settings.mapSize).toBe("Tiny");
    });

    it("falls back to ctx.settings.playerCount when no override is given", () => {
      const bridged = previewSettingsFromContext(context({ playerCount: 4 }));
      expect(bridged.ok).toBe(true);
      if (!bridged.ok) return;
      expect(bridged.settings.playerCount).toBe(4);
    });

    it("still rejects a malformed context before ever reading the override", () => {
      const bridged = previewSettingsFromContext(context({ mapSize: { name: "Enormous", tiles: 999 } }), { playerCount: 8 });
      expect(bridged).toEqual({ ok: false, reason: "bad-map-size", value: "Enormous" });
    });
  });
});

describe("runPreviewFromContext", () => {
  // The point of the whole item: ctx.parseResult goes STRAIGHT into
  // generatePreview. If this file ever stops compiling on that line, the
  // sentinel has been re-scoped to both transports and the flagship tool is
  // broken — silently, at runtime, in the "your map is fine" direction.
  it("feeds the context's own ParseResult to generatePreview unconverted", () => {
    const outcome = runPreviewFromContext(context(), refDb, { seed: 7, collectSnapshots: false });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.dim).toBeGreaterThan(0);
    expect(outcome.result.reports.length).toBeGreaterThan(0);
  });

  it("propagates a bridge failure rather than running against a guessed setting", () => {
    const outcome = runPreviewFromContext(
      context({ mapSize: { name: "Enormous", tiles: 999 } }),
      refDb,
      { seed: 7, collectSnapshots: false },
    );
    expect(outcome.ok).toBe(false);
  });

  // The generator returns snapshots rather than a live grid, so the terrain
  // comparison goes through S6's snapshot. `collectSnapshots` is the only cost
  // knob the generator offers and 5.2 runs with it false; this test turns it on
  // deliberately, because the terrain array is the widest observable there is
  // and determinism is the property 5.2's whole Monte Carlo layer rests on.
  it("is deterministic for one seed, which is what 5.2's Monte Carlo layer varies", () => {
    const opts = { seed: 3, collectSnapshots: true };
    const a = runPreviewFromContext(context(), refDb, opts);
    const b = runPreviewFromContext(context(), refDb, opts);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.result.snapshots?.at(-1)?.terrain).toEqual(b.result.snapshots?.at(-1)?.terrain);
    expect(a.result.objects).toEqual(b.result.objects);
    expect(a.result.seedUsed).toBe(3);
  });

  // Sec.7.2 item 2 / Sec.4.1: this is the loop's own reason for existing —
  // without the override every count in a 2/4/6/8 matrix would generate the
  // same map at ctx.settings.playerCount. SCRIPT's create_player_lands makes
  // one land (and PlayerMarker) per player, so the count is directly
  // observable in the result.
  it("drives generatePreview at the OVERRIDDEN player count, not ctx.settings'", () => {
    const at2 = runPreviewFromContext(context({ playerCount: 4 }), refDb, { seed: 7, collectSnapshots: false }, { playerCount: 2 });
    const at8 = runPreviewFromContext(context({ playerCount: 4 }), refDb, { seed: 7, collectSnapshots: false }, { playerCount: 8 });
    expect(at2.ok && at8.ok).toBe(true);
    if (!at2.ok || !at8.ok) return;
    expect(at2.result.players).toHaveLength(2);
    expect(at8.result.players).toHaveLength(8);
  });
});

describe("objectConstantsFromPublished (Sec.7.2 item 2)", () => {
  it("defaults an absent constId to null rather than leaving it undefined", () => {
    const published = [
      { rmsConstant: "GOLD", descriptiveName: "Gold", category: "object", habitat: "land", verified: true },
    ] as unknown as PublishedGameConstants;
    const out = objectConstantsFromPublished(published);
    expect(out[0].constId).toBeNull();
    expect(out[0].rmsConstant).toBe("GOLD");
    expect(out[0].habitat).toBe("land");
  });

  it("keeps a real constId rather than nulling it", () => {
    const published = [
      { rmsConstant: "GOLD", constId: 66, descriptiveName: "Gold", category: "object", verified: true },
    ] as unknown as PublishedGameConstants;
    expect(objectConstantsFromPublished(published)[0].constId).toBe(66);
  });

  // The real published data, cast the same way ToolsPane.tsx casts it —
  // proves the conversion compiles and runs against the actual schema shape,
  // not just a hand-shaped fixture.
  it("runs over the real reference/data/game-constants.json without throwing", () => {
    const published = (
      JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as {
        constants: PublishedGameConstants;
      }
    ).constants;
    const out = objectConstantsFromPublished(published);
    expect(out.length).toBe(published.length);
    expect(out.some((c) => c.category === "object" && c.constId !== null)).toBe(true);
  });
});
