// Sec.7.1 acceptance: "the cut offset is the start of the first section that
// follows the last <LAND_GENERATION> in source order, or the end of the
// document if there is none." Unit tests plus the corpus check the brief
// names explicitly.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { resolveLandGenerationCutOffset } from "../cutOffset";

const lang = loadLanguage();

describe("resolveLandGenerationCutOffset (Sec.7.1)", () => {
  it("no <LAND_GENERATION> at all: cuts at the end of the document", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("<LAND_GENERATION> is the LAST section: cuts at the end of the document", () => {
    const source =
      "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_land { land_percent 20 }\n";
    const parse = parseRms(source, lang);
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("one <LAND_GENERATION> followed by another section: cuts at that section's start", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    const objSection = parse.script.sections.find(
      (s) => s.name === "OBJECTS_GENERATION",
    )!;
    expect(resolveLandGenerationCutOffset(parse)).toBe(objSection.span.start);
  });

  it("multiple <LAND_GENERATION> sections: cuts after the LAST one, not the first", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { land_percent 10 }\n" +
      "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n" +
      "<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    const objSection = parse.script.sections.find(
      (s) => s.name === "OBJECTS_GENERATION",
    )!;
    // A cut at the FIRST <LAND_GENERATION>'s end would silently drop the
    // second one's layout, exactly the bug this rule exists to avoid.
    expect(resolveLandGenerationCutOffset(parse)).toBe(objSection.span.start);
    expect(
      parse.script.sections.filter((s) => s.name === "LAND_GENERATION"),
    ).toHaveLength(2);
  });
});

// Sec.7.1's own corpus-shaped checks. Both were originally asserted against
// third-party community maps (24hr_Petra.rms, Rage Forest 2026.rms) that were
// never meant to enter the repo; these inline fixtures pin the same two
// SHAPES those maps happened to exhibit instead.
describe("resolveLandGenerationCutOffset — corpus-shaped fixtures (Sec.7.1)", () => {
  it("<LAND_GENERATION> is its own last section (real command follows nothing) — the rule degenerates to end-of-document", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\ncreate_land { land_percent 20 }\n";
    const parse = parseRms(source, lang);
    const landGenSections = parse.script.sections.filter(
      (s) => s.name === "LAND_GENERATION",
    );
    expect(landGenSections).toHaveLength(1);
    // Confirms it IS reached by the AST and IS the last section, the
    // "degenerates, and that is the expected answer" case, not the
    // RawNode-swallowed case below.
    expect(parse.script.sections.at(-1)?.name).toBe("LAND_GENERATION");
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("the AST sees ZERO <LAND_GENERATION> sections (the header sits inside a RawNode) — degenerates to end-of-document for a different reason", () => {
    // Sec.6.4: "the AST may see fewer than the text does". Reuses the exact
    // if-spans-a-section-header degrade parser.test.ts's "Sec.5.3
    // degradation" suite already pins (its <PLAYER_SETUP> case, here with
    // <LAND_GENERATION> as the absorbed header): the marker is present in
    // the source text but never reaches parse.script.sections as a
    // SectionNode. P1 (preconditions.ts) is what reports the raw-node
    // coverage this causes; this function only sees the section list.
    const source =
      "if A <LAND_GENERATION> endif\n<PLAYER_SETUP>\ndirect_placement\n";
    const parse = parseRms(source, lang);
    expect(parse.diagnostics.map((d) => d.code)).toContain("RMS0110");
    const landGenSections = parse.script.sections.filter(
      (s) => s.name === "LAND_GENERATION",
    );
    expect(landGenSections).toHaveLength(0);
    expect(source).toContain("<LAND_GENERATION>");
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });
});
