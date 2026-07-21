import { describe, expect, it } from "vitest";
import { buildSectionTabs } from "../sectionTabsModel";
import type { ScriptNode, SectionNode, Item } from "../../parser/types";

// Minimal fixtures — only the fields buildSectionTabs actually reads.
function section(name: string, known = true): SectionNode {
  return {
    kind: "section",
    name,
    known,
    items: [] as Item[],
    span: { start: 0, end: 1 },
  } as unknown as SectionNode;
}

function script(preambleLen: number, sections: SectionNode[]): ScriptNode {
  return {
    preamble: Array.from({ length: preambleLen }, () => ({ span: { start: 0, end: 1 } }) as Item),
    sections,
  } as unknown as ScriptNode;
}

// Ash's ask: tab numbering must be absolute (tied to a section's fixed
// canonical identity), not derived from which tabs happen to render — a
// missing section (e.g. no <ELEVATION_GENERATION> in the file) must not
// change the numbers of the sections after it.
describe("buildSectionTabs — absolute numbering (Ash's ask)", () => {
  it("numbers Header=0 and the canonical seven 1-7 regardless of which sections are present", () => {
    // Only PLAYER_SETUP and OBJECTS_GENERATION actually present in source —
    // ELEVATION_GENERATION and everything between is "missing" (empty tab).
    const tabs = buildSectionTabs(script(1, [section("PLAYER_SETUP"), section("OBJECTS_GENERATION")]));
    const byId = new Map(tabs.map((t) => [t.id, t.number]));
    expect(byId.get("header")).toBe(0);
    expect(byId.get("PLAYER_SETUP")).toBe(1);
    expect(byId.get("LAND_GENERATION")).toBe(2);
    expect(byId.get("ELEVATION_GENERATION")).toBe(3);
    expect(byId.get("CLIFF_GENERATION")).toBe(4);
    expect(byId.get("TERRAIN_GENERATION")).toBe(5);
    expect(byId.get("CONNECTION_GENERATION")).toBe(6);
    expect(byId.get("OBJECTS_GENERATION")).toBe(7);
  });

  it("numbers stay identical whether or not a middle section is actually missing", () => {
    const withGap = buildSectionTabs(script(1, [section("PLAYER_SETUP"), section("OBJECTS_GENERATION")]));
    const withoutGap = buildSectionTabs(
      script(1, [section("PLAYER_SETUP"), section("ELEVATION_GENERATION"), section("OBJECTS_GENERATION")]),
    );
    const numbersOf = (tabs: typeof withGap) => tabs.map((t) => `${t.id}:${t.number}`);
    expect(numbersOf(withGap)).toEqual(numbersOf(withoutGap));
  });

  it("Header absent: canonical numbers still start at 1, not 0", () => {
    const tabs = buildSectionTabs(script(0, [section("PLAYER_SETUP")]));
    expect(tabs.find((t) => t.id === "header")).toBeUndefined();
    expect(tabs.find((t) => t.id === "PLAYER_SETUP")?.number).toBe(1);
  });

  it("unknown sections continue the count after the canonical seven", () => {
    const tabs = buildSectionTabs(script(0, [section("PLAYER_SETUP"), section("TYPO_SECTION", false)]));
    expect(tabs.find((t) => t.id === "unknown:TYPO_SECTION")?.number).toBe(8);
  });
});
