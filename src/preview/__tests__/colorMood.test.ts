// The script's colour mood (colorMood.ts) and its colour transform
// (colourMoods.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import type { ObjectConstant } from "../generator/objects";
import { readColorMood } from "../generator/colorMood";
import { IDENTITY_MOOD, moodTransform } from "../render/colourMoods";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const constants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;

function moodOf(terrainSection: string): number | undefined {
  const script = instantiateScript(
    parseRms(
      `<LAND_GENERATION>\n  base_terrain GRASS\n<TERRAIN_GENERATION>\n${terrainSection}`,
      lang,
    ),
    buildLanguageIndex(lang),
    {
      playerCount: 2,
      mapSize: "Tiny",
      teams: DEFAULT_TEAMS,
      teamPositions: true,
    },
    1,
  );
  return readColorMood(script, constants);
}

describe("readColorMood", () => {
  it("reads a named mood, a script constant and a bare number", () => {
    expect(moodOf("color_correction CC_NIGHT")).toBe(5);
    expect(moodOf("#const MY_MOOD 2\ncolor_correction MY_MOOD")).toBe(2);
    expect(moodOf("color_correction 1")).toBe(1);
  });

  it("takes the last line, and none when there is none", () => {
    expect(
      moodOf("color_correction CC_AUTUMN\ncolor_correction CC_WINTER"),
    ).toBe(2);
    expect(moodOf("")).toBeUndefined();
  });
});

describe("moodTransform", () => {
  it("is the identity for the default mood and an unmeasured one", () => {
    expect(moodTransform(0)).toBe(IDENTITY_MOOD);
    expect(moodTransform(undefined)).toBe(IDENTITY_MOOD);
    expect(moodTransform(999)).toBe(IDENTITY_MOOD);
  });

  it("darkens and blues night as measured", () => {
    const night = moodTransform(5);
    // Mid grey under night: darker, and bluer than it is red.
    const out = night.gain.map((g, i) => 128 * g + night.offset[i]);
    expect(out[0]).toBeLessThan(128);
    expect(out[2]).toBeGreaterThan(out[0]);
  });
});
