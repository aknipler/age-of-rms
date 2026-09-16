// slice-4 brief item 4: buildToolContext(), extracted out of ToolsPane.tsx.
// Acceptance: an undeclared capability leaves the field ABSENT (not
// undefined-valued); read-preview-view grants both fields.

import { describe, expect, it } from "vitest";
import { TOOLS_API_VERSION } from "../../../tools-api/index";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import { buildToolContext } from "../buildToolContext";

const lang = loadLanguage();
const gameConstants = { objects: [], terrains: [] } as never;

function baseInput(
  capabilities: import("../../../tools-api/index").Capability[],
) {
  const parseResult = parseRms(
    "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n",
    lang,
  );
  return {
    capabilities,
    params: {},
    parseResult,
    generation: {
      playerCount: 4,
      mapSize: "Tiny" as const,
      teams: [1, 1, 2, 2, 0, 0, 0, 0],
    },
    lang,
    gameConstants,
    previewView: { seed: 42, cutOffset: 17 as number | null },
  };
}

describe("buildToolContext", () => {
  it("with no declared capabilities, every gated field is ABSENT — not undefined-valued", () => {
    const ctx = buildToolContext(baseInput([]));
    expect(ctx).toEqual({ apiVersion: TOOLS_API_VERSION, params: {} });
    expect("source" in ctx).toBe(false);
    expect("parseResult" in ctx).toBe(false);
    expect("settings" in ctx).toBe(false);
    expect("referenceData" in ctx).toBe(false);
    expect("previewView" in ctx).toBe(false);
  });

  it("read-source grants source", () => {
    const ctx = buildToolContext(baseInput(["read-source"]));
    expect(ctx.source).toBeDefined();
    expect("parseResult" in ctx).toBe(false);
  });

  it("read-ast grants parseResult (and implies read-source, via effectiveCapabilities)", () => {
    const ctx = buildToolContext(baseInput(["read-ast"]));
    expect(ctx.parseResult).toBeDefined();
    expect(ctx.source).toBeDefined();
  });

  it("read-generation-settings grants settings, with mapSize resolved to tiles", () => {
    const ctx = buildToolContext(baseInput(["read-generation-settings"]));
    expect(ctx.settings).toEqual({
      playerCount: 4,
      mapSize: { name: "Tiny", tiles: expect.any(Number) },
      teams: [1, 1, 2, 2, 0, 0, 0, 0],
    });
  });

  it("read-reference grants referenceData", () => {
    const ctx = buildToolContext(baseInput(["read-reference"]));
    expect(ctx.referenceData).toEqual({ language: lang, gameConstants });
  });

  it("read-preview-view grants BOTH seed and cutOffset", () => {
    const ctx = buildToolContext(baseInput(["read-preview-view"]));
    expect(ctx.previewView).toEqual({ seed: 42, cutOffset: 17 });
  });

  it("read-preview-view passes a null cutOffset through unchanged (Final, or no pin)", () => {
    const input = baseInput(["read-preview-view"]);
    input.previewView = { seed: 42, cutOffset: null };
    expect(buildToolContext(input).previewView).toEqual({
      seed: 42,
      cutOffset: null,
    });
  });
});
