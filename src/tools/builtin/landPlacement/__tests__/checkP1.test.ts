// Sec.9 P1 acceptance: "a pure function asserted against the three maps
// Sec.9 names... Rage Forest 2026.rms 70.9%, Pa_Site_v1.1.rms 4.4%,
// TL Cape of Storms.rms 1.3%." Those three maps are third-party community
// scripts and were never meant to enter the repo, so the assertion below
// pins the SHAPE Sec.9 cared about — a RawNode swallowing part of
// <LAND_GENERATION>, including a create_land the tool can no longer see,
// while a create_land outside the RawNode stays visible — on an inline
// fixture instead. It reuses the exact if/endif-inside-a-block degrade
// already pinned in parser.test.ts's "Sec.5.3 degradation" suite, so the
// mechanism producing the RawNode is not this file's own invention.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../parser/__tests__/testUtils";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { checkP1 } from "../preconditions";

const lang = loadLanguage();

function parseFile(name: string) {
  const source = readFileSync(join(REPO_ROOT, "test-maps", name), "utf8");
  return parseRms(source, lang);
}

describe("checkP1 — unit", () => {
  it("ok, zero coverage, on a script with no raw node at all", () => {
    const parse = parseRms(
      "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n",
      lang,
    );
    const result = checkP1(parse);
    expect(result).toEqual({
      ok: true,
      rawCoveredChars: 0,
      rawFraction: 0,
      unmanagedLandCount: 0,
    });
  });

  it("empty document: rawFraction is 0, not NaN", () => {
    expect(checkP1(parseRms("", lang)).rawFraction).toBe(0);
  });
});

describe("checkP1 — corpus-shaped fixture (Sec.9)", () => {
  it("a RawNode swallowing part of <LAND_GENERATION>: partial coverage, the create_land inside it is unmanaged, the one outside is not", () => {
    const source =
      "<LAND_GENERATION>\nif A create_land { land_percent 20 endif land_percent 10 }\ncreate_land { land_percent 5 }\n";
    const parse = parseRms(source, lang);
    expect(parse.diagnostics.map((d) => d.code)).toContain("RMS0110");
    const result = checkP1(parse);
    expect(result.ok).toBe(false);
    expect(result.rawCoveredChars).toBe(58);
    expect(result.rawFraction).toBeCloseTo(58 / source.length, 10);
    // One create_land sits inside the RawNode span (unmanaged); the second,
    // written after the degraded range closes, stays a normal command and
    // must not be counted.
    expect(result.unmanagedLandCount).toBe(1);
  });

  it("Bulls_Eyes.rms: no raw node at all — the tool's own reference map is fully manageable", () => {
    const parse = parseFile("Bulls_Eyes.rms");
    expect(checkP1(parse)).toEqual({
      ok: true,
      rawCoveredChars: 0,
      rawFraction: 0,
      unmanagedLandCount: 0,
    });
  });
});
