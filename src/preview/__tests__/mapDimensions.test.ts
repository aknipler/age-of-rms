import { describe, expect, it } from "vitest";
import languageDataRaw from "../../../reference/data/language.json";
import type { LanguageData } from "../../parser/language";
import { MAP_SIZES } from "../../generationSettings/generationSettingsConstants";
import { resolveMapDim } from "../generator/mapDimensions";

const labels = (languageDataRaw as unknown as LanguageData).predefinedLabels;

describe("resolveMapDim", () => {
  it("answers for every size the picker offers", () => {
    for (const size of MAP_SIZES) {
      expect(resolveMapDim(size, labels)).toBeGreaterThan(0);
    }
  });

  it("reads the legacy/modern label offset correctly", () => {
    // The trap this function exists to avoid: the app's Normal is 200x200 and
    // defines LARGE_MAP, while MAPSIZE_LARGE is the NEXT size up at 220. A
    // consumer inferring a dimension from a label's name gets this wrong on
    // every size-aware map, silently, by taking the wrong branch.
    expect(resolveMapDim("Normal", labels)).toBe(200);
    expect(resolveMapDim("Large", labels)).toBe(220);
    expect(resolveMapDim("Huge", labels)).toBe(240);
    expect(resolveMapDim("Giant", labels)).toBe(252);
    expect(resolveMapDim("Tiny", labels)).toBe(120);
  });

  it("agrees with the legacy and the modern entry for a size", () => {
    // Every size except Giant matches two entries, which is why the lookup
    // uses `find` rather than asserting uniqueness. This is the assertion
    // that makes taking either one safe.
    for (const size of MAP_SIZES) {
      const matches = (labels ?? []).filter(
        (label) => label.category === "mapSize" && label.mapSize === size,
      );
      expect(matches.length).toBeGreaterThan(0);
      const dims = new Set(matches.map((label) => label.dimensions));
      expect(dims.size).toBe(1);
    }
  });

  it("returns null rather than guessing when the data cannot answer", () => {
    expect(resolveMapDim("Normal", [])).toBeNull();
    expect(resolveMapDim("Normal", undefined)).toBeNull();
  });
});
