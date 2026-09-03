// Sec.9 P1 acceptance: "a pure function asserted against the three maps
// Sec.9 names... Rage Forest 2026.rms 70.9%, Pa_Site_v1.1.rms 4.4%,
// TL Cape of Storms.rms 1.3%." Those figures were measured 2026-08-29 and are
// a statement about the PARSER, not the maps (Sec.13). If a re-run disagrees,
// the parser has moved and the number here should be updated along with a
// build-log note, not treated as this test being wrong.

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
    const parse = parseRms("<LAND_GENERATION>\ncreate_land { land_percent 20 }\n", lang);
    const result = checkP1(parse);
    expect(result).toEqual({ ok: true, rawCoveredChars: 0, rawFraction: 0, unmanagedLandCount: 0 });
  });

  it("empty document: rawFraction is 0, not NaN", () => {
    expect(checkP1(parseRms("", lang)).rawFraction).toBe(0);
  });
});

describe("checkP1 — corpus (Sec.9, measured 2026-08-29)", () => {
  it("Rage Forest 2026.rms: 70.9% raw-covered, with unmanageable lands inside it", () => {
    const parse = parseFile("Rage Forest 2026.rms");
    const result = checkP1(parse);
    expect(result.ok).toBe(false);
    expect(Number(result.rawFraction.toFixed(3))).toBeCloseTo(0.709, 3);
    // Sec.9: "30 create_land ... the tool cannot see".
    expect(result.unmanagedLandCount).toBe(30);
  });

  it("Pa_Site_v1.1.rms: 4.4% raw-covered", () => {
    const parse = parseFile("Pa_Site_v1.1.rms");
    const result = checkP1(parse);
    expect(result.ok).toBe(false);
    expect(Number(result.rawFraction.toFixed(3))).toBeCloseTo(0.044, 3);
  });

  it("TL Cape of Storms.rms: 1.3% raw-covered", () => {
    const parse = parseFile("TL Cape of Storms.rms");
    const result = checkP1(parse);
    expect(result.ok).toBe(false);
    expect(Number(result.rawFraction.toFixed(3))).toBeCloseTo(0.013, 3);
  });

  it("Bulls_Eyes.rms: no raw node at all — the tool's own reference map is fully manageable", () => {
    const parse = parseFile("Bulls_Eyes.rms");
    expect(checkP1(parse)).toEqual({ ok: true, rawCoveredChars: 0, rawFraction: 0, unmanagedLandCount: 0 });
  });
});
