// land-placement-design.md Sec.3.4 layer 1 (generate/sliceRequest/release)
// and Sec.3.8 (the handle lifecycle: one live result per tool, supersession,
// staleness, the per-rect area cap and per-run byte budget).

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
import { TOOLS_API_VERSION, type ToolContext } from "../../../tools-api/index";
import { PreviewHandleStore } from "../runPreview";

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
create_land {
  terrain_type GRASS
  land_percent 10
  land_position 70 70
}
`;

function context(source = SCRIPT): ToolContext<ParseResult> {
  const name = "Tiny";
  const tiles = resolveMapDim(name as never, lang.predefinedLabels ?? []) ?? 0;
  return {
    apiVersion: TOOLS_API_VERSION,
    parseResult: parseRms(source, lang),
    source,
    settings: { playerCount: 4, mapSize: { name, tiles }, teams: [...DEFAULT_TEAMS] },
    params: {},
  };
}

describe("PreviewHandleStore.generate", () => {
  it("returns a summary bounded by land count — no grid, no object list", () => {
    const store = new PreviewHandleStore();
    const msg = store.generate("land-placement", context(), refDb, { type: "generate", seed: 7 });
    expect(msg.type).toBe("generated");
    if (msg.type !== "generated") return;
    // 4 player lands + 1 explicit create_land.
    expect(msg.summary.landOrigins.length).toBe(5);
    expect(msg.summary.objectCount).toBeGreaterThanOrEqual(0);
    expect("grid" in msg.summary).toBe(false);
    expect("objects" in msg.summary).toBe(false);
  });

  it("landOrigins[].tiles reflects growth, not just the declared target", () => {
    const store = new PreviewHandleStore();
    const msg = store.generate("land-placement", context(), refDb, { type: "generate", seed: 7 });
    if (msg.type !== "generated") throw new Error("expected generated");
    for (const origin of msg.summary.landOrigins) {
      expect(origin.tiles).toBeGreaterThan(0);
    }
  });

  it("is deterministic for one seed", () => {
    const store = new PreviewHandleStore();
    const a = store.generate("t", context(), refDb, { type: "generate", seed: 3 });
    const b = store.generate("t", context(), refDb, { type: "generate", seed: 3 });
    if (a.type !== "generated" || b.type !== "generated") throw new Error("expected generated");
    expect(a.summary.landOrigins).toEqual(b.summary.landOrigins);
  });

  it("cutOffset truncates the script before generating (Sec.7.1)", () => {
    const store = new PreviewHandleStore();
    const full = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    const source = context().source!;
    const cutBeforeSecondLand = source.indexOf("create_land {");
    const cut = store.generate("t", context(), refDb, { type: "generate", seed: 7, cutOffset: cutBeforeSecondLand });
    if (full.type !== "generated" || cut.type !== "generated") throw new Error("expected generated");
    // The explicit create_land after the cut point never ran.
    expect(full.summary.landOrigins.length).toBe(5);
    expect(cut.summary.landOrigins.length).toBe(4);
  });

  it("a later generate for the SAME tool supersedes the earlier handle", () => {
    const store = new PreviewHandleStore();
    const first = store.generate("t", context(), refDb, { type: "generate", seed: 1 });
    const second = store.generate("t", context(), refDb, { type: "generate", seed: 2 });
    if (first.type !== "generated" || second.type !== "generated") throw new Error("expected generated");
    expect(first.handle).not.toBe(second.handle);
    expect(store.size()).toBe(1); // one entry per tool, not one per generate
  });

  it("two different tools each hold their own live handle", () => {
    const store = new PreviewHandleStore();
    store.generate("a", context(), refDb, { type: "generate", seed: 1 });
    store.generate("b", context(), refDb, { type: "generate", seed: 1 });
    expect(store.size()).toBe(2);
  });
});

describe("PreviewHandleStore.sliceRequest", () => {
  it("returns terrain/elevation for the requested rect", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    const slice = store.sliceRequest("t", { type: "sliceRequest", handle: generated.handle, rect: { x: 0, y: 0, w: 4, h: 4 } });
    expect(slice.type).toBe("previewSlice");
    if (slice.type !== "previewSlice") return;
    expect(slice.terrain).toHaveLength(16);
    expect(slice.elevation).toHaveLength(16);
  });

  it("fails, naming the reason, against a stale handle", () => {
    const store = new PreviewHandleStore();
    const first = store.generate("t", context(), refDb, { type: "generate", seed: 1 });
    store.generate("t", context(), refDb, { type: "generate", seed: 2 }); // supersedes
    if (first.type !== "generated") throw new Error("expected generated");
    const slice = store.sliceRequest("t", { type: "sliceRequest", handle: first.handle, rect: { x: 0, y: 0, w: 2, h: 2 } });
    expect(slice).toEqual({ type: "generateFailed", reason: expect.stringContaining("stale") });
  });

  it("fails against a handle for a tool that never generated", () => {
    const store = new PreviewHandleStore();
    const slice = store.sliceRequest("nobody", { type: "sliceRequest", handle: "h1", rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(slice.type).toBe("generateFailed");
  });

  it("rejects a rect over the per-request area cap", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    const slice = store.sliceRequest("t", {
      type: "sliceRequest",
      handle: generated.handle,
      rect: { x: 0, y: 0, w: 300, h: 300 },
    });
    expect(slice).toEqual({ type: "generateFailed", reason: expect.stringContaining("cap") });
  });

  it("rejects a non-positive rect rather than returning an empty slice silently", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    const slice = store.sliceRequest("t", { type: "sliceRequest", handle: generated.handle, rect: { x: 0, y: 0, w: 0, h: 5 } });
    expect(slice.type).toBe("generateFailed");
  });

  it("clamps a rect that runs off the grid edge rather than reading out of bounds", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    const dim = generated.summary.dim;
    const slice = store.sliceRequest("t", {
      type: "sliceRequest",
      handle: generated.handle,
      rect: { x: dim - 2, y: dim - 2, w: 10, h: 10 },
    });
    expect(slice.type).toBe("previewSlice");
    if (slice.type !== "previewSlice") return;
    expect(slice.terrain).toHaveLength(4); // only the 2x2 that's actually on the grid
  });

  it("exhausts the per-generation byte budget across repeated slices", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    const dim = generated.summary.dim;
    let lastFailed = false;
    for (let i = 0; i < 10_000; i++) {
      const result = store.sliceRequest("t", {
        type: "sliceRequest",
        handle: generated.handle,
        rect: { x: 0, y: 0, w: dim, h: dim },
      });
      if (result.type === "generateFailed") {
        lastFailed = true;
        expect(result.reason).toContain("budget");
        break;
      }
    }
    expect(lastFailed).toBe(true);
  });
});

describe("PreviewHandleStore.release", () => {
  it("frees a matching handle early, before the next generate", () => {
    const store = new PreviewHandleStore();
    const generated = store.generate("t", context(), refDb, { type: "generate", seed: 7 });
    if (generated.type !== "generated") throw new Error("expected generated");
    store.release("t", { type: "release", handle: generated.handle });
    expect(store.size()).toBe(0);
  });

  it("is a no-op for a handle that doesn't match the current one — never a step a correct host waits for", () => {
    const store = new PreviewHandleStore();
    store.generate("t", context(), refDb, { type: "generate", seed: 1 });
    store.release("t", { type: "release", handle: "not-a-real-handle" });
    expect(store.size()).toBe(1);
  });
});

describe("PreviewHandleStore invalidation", () => {
  it("invalidateAll drops every tool's handle (documentReplaced, Sec.3.8)", () => {
    const store = new PreviewHandleStore();
    store.generate("a", context(), refDb, { type: "generate", seed: 1 });
    store.generate("b", context(), refDb, { type: "generate", seed: 1 });
    store.invalidateAll();
    expect(store.size()).toBe(0);
  });

  it("invalidateTool drops only that tool's handle (panel unmount, Sec.3.8)", () => {
    const store = new PreviewHandleStore();
    store.generate("a", context(), refDb, { type: "generate", seed: 1 });
    store.generate("b", context(), refDb, { type: "generate", seed: 1 });
    store.invalidateTool("a");
    expect(store.size()).toBe(1);
  });
});
