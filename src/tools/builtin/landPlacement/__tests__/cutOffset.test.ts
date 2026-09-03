// Sec.7.1 acceptance: "the cut offset is the start of the first section that
// follows the last <LAND_GENERATION> in source order, or the end of the
// document if there is none." Unit tests plus the corpus check the brief
// names explicitly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { resolveLandGenerationCutOffset } from "../cutOffset";

const lang = loadLanguage();

describe("resolveLandGenerationCutOffset (Sec.7.1)", () => {
  it("no <LAND_GENERATION> at all: cuts at the end of the document", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\n<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("<LAND_GENERATION> is the LAST section: cuts at the end of the document", () => {
    const source = "<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_land { land_percent 20 }\n";
    const parse = parseRms(source, lang);
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("one <LAND_GENERATION> followed by another section: cuts at that section's start", () => {
    const source = "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    const objSection = parse.script.sections.find((s) => s.name === "OBJECTS_GENERATION")!;
    expect(resolveLandGenerationCutOffset(parse)).toBe(objSection.span.start);
  });

  it("multiple <LAND_GENERATION> sections: cuts after the LAST one, not the first", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { land_percent 10 }\n" +
      "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n" +
      "<OBJECTS_GENERATION>\ncreate_object TREE\n";
    const parse = parseRms(source, lang);
    const objSection = parse.script.sections.find((s) => s.name === "OBJECTS_GENERATION")!;
    // A cut at the FIRST <LAND_GENERATION>'s end would silently drop the
    // second one's layout, exactly the bug this rule exists to avoid.
    expect(resolveLandGenerationCutOffset(parse)).toBe(objSection.span.start);
    expect(parse.script.sections.filter((s) => s.name === "LAND_GENERATION")).toHaveLength(2);
  });
});

// Sec.7.1's own corpus check, verified on disk 2026-08-31 in the brief.
describe("resolveLandGenerationCutOffset — corpus (Sec.7.1)", () => {
  function parseFile(name: string) {
    const source = readFileSync(join(REPO_ROOT, "test-maps", name), "utf8");
    return { source, parse: parseRms(source, lang) };
  }

  it("24hr_Petra.rms: <LAND_GENERATION> is its own last section — the rule degenerates to end-of-document", () => {
    const { source, parse } = parseFile("24hr_Petra.rms");
    const landGenSections = parse.script.sections.filter((s) => s.name === "LAND_GENERATION");
    expect(landGenSections).toHaveLength(1);
    // Confirms it IS reached by the AST and IS the last section, the
    // "degenerates, and that is the expected answer" case, not the
    // RawNode-swallowed case below.
    expect(parse.script.sections.at(-1)?.name).toBe("LAND_GENERATION");
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });

  it("Rage Forest 2026.rms: the AST sees ZERO <LAND_GENERATION> sections (they sit inside a RawNode) — degenerates to end-of-document for a different reason", () => {
    const { source, parse } = parseFile("Rage Forest 2026.rms");
    const landGenSections = parse.script.sections.filter((s) => s.name === "LAND_GENERATION");
    // Sec.6.4: "the AST may see fewer than the text does". The three
    // <LAND_GENERATION> markers are absorbed into a RawNode inside
    // <PLAYER_SETUP> (RMS0110), so none of them reach parse.script.sections
    // as a SectionNode at all. The three-in-text figure is a text-level fact,
    // not something this AST-level function can observe; P1 (preconditions.ts)
    // is what reports the raw-node coverage this causes.
    expect(landGenSections).toHaveLength(0);
    expect(source.match(/<LAND_GENERATION>/g)).toHaveLength(3);
    expect(resolveLandGenerationCutOffset(parse)).toBe(source.length);
  });
});
