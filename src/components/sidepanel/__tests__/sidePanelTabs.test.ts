import { describe, expect, it } from "vitest";
import { DEFAULT_SIDE_PANEL_TAB, isSidePanelTab } from "../sidePanelTabs";

describe("isSidePanelTab", () => {
  it("accepts both tabs and the default is one of them", () => {
    expect(isSidePanelTab("preview")).toBe(true);
    expect(isSidePanelTab("reference")).toBe(true);
    expect(isSidePanelTab(DEFAULT_SIDE_PANEL_TAB)).toBe(true);
  });

  it("rejects anything else the store could hand back", () => {
    expect(isSidePanelTab(undefined)).toBe(false);
    expect(isSidePanelTab(null)).toBe(false);
    expect(isSidePanelTab("both")).toBe(false);
    expect(isSidePanelTab(1)).toBe(false);
  });
});
