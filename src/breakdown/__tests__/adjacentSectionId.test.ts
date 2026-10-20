import { describe, expect, it } from "vitest";
import { adjacentSectionId } from "../sectionTabsModel";

const tabs = [{ id: "header" }, { id: "LAND" }, { id: "TERRAIN" }];

describe("adjacentSectionId", () => {
  it("steps forward and back", () => {
    expect(adjacentSectionId(tabs, "header", 1)).toBe("LAND");
    expect(adjacentSectionId(tabs, "TERRAIN", -1)).toBe("LAND");
  });

  it("wraps at both ends", () => {
    expect(adjacentSectionId(tabs, "TERRAIN", 1)).toBe("header");
    expect(adjacentSectionId(tabs, "header", -1)).toBe("TERRAIN");
  });

  it("treats an unknown or missing current id as the first tab", () => {
    expect(adjacentSectionId(tabs, null, 1)).toBe("LAND");
    expect(adjacentSectionId(tabs, "GONE", 1)).toBe("LAND");
  });

  it("has nowhere to go with fewer than two tabs", () => {
    expect(adjacentSectionId([], null, 1)).toBeNull();
    expect(adjacentSectionId([{ id: "header" }], "header", 1)).toBeNull();
  });
});
