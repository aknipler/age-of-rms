// The cleanup's preview note, and the case that prompted it: a land with
// base_size 0 at land_position 99 0 that shows on a Tiny map and not on a
// Large one. Both are DE's behaviour. 99% rounds to the last column on Tiny
// (118.8 -> 119) and to one column in on Large (217.8 -> 218), and the cleanup
// reads an off-map neighbour as not the reference, which the 111-map DE gate
// pins (lands.ts `cleanTerrainAgainst`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import { terrainKindOf } from "../generator/cleanupNote";
import type { ObjectConstant } from "../generator/objects";
import type { PreviewResult } from "../generator/types";
import type { MapSize } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const constants: readonly ObjectConstant[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants,
};

function terrainId(name: string): number {
  const row = constants.find(
    (c) => c.category === "terrain" && c.rmsConstant === name,
  );
  if (row?.constId == null) throw new Error(`no terrain ${name}`);
  return row.constId;
}
const DESERT = terrainId("DESERT");

function run(source: string, mapSize: MapSize): PreviewResult {
  return generatePreview(
    parseRms(source, lang),
    refDb,
    { playerCount: 2, mapSize, teams: [1, 2] },
    { seed: 1, collectSnapshots: true },
  );
}

/** The terrain at (x, y) when the land stage ends, before S4's beach repaints a lone tile. */
function landStageTerrain(result: PreviewResult, x: number, y: number): number {
  const s1 = result.snapshots?.find((s) => s.stage === "S1");
  if (!s1) throw new Error("no S1 snapshot");
  return s1.terrain[y * s1.dim + x];
}

const oneTileLand = (base: string, position = "99 0"): string =>
  [
    "<LAND_GENERATION>",
    `base_terrain ${base}`,
    `create_land { terrain_type DESERT land_position ${position} base_size 0 land_percent 0 }`,
  ].join("\n");

// Two 5 by 5 WATER stamps on Tiny with the strip x 63 between them, rows 58
// to 62. Their zones differ, so the leftover fill cannot close the strip.
const WATER_STAMPS = [
  "create_land { terrain_type WATER land_position 50 50 base_size 2 land_percent 0 zone 1 }",
  "create_land { terrain_type WATER land_position 55 50 base_size 2 land_percent 0 zone 2 }",
];

const cleanupNote = (result: PreviewResult) =>
  result.notes.find((n) => n.key === "cleanup");

/** The note's closing sentence, the same on every note. */
const ALWAYS =
  "This shows because the terrain class changed, but the cleanup runs on every map.";

describe("a one-tile land at land_position 99 0", () => {
  it.each(["WATER", "GRASS"])(
    "survives on Tiny, on the last column, over %s",
    (base) => {
      const result = run(oneTileLand(base), "Tiny");
      expect(result.dim).toBe(120);
      expect(landStageTerrain(result, 119, 0)).toBe(DESERT);
    },
  );

  it.each(["WATER", "GRASS"])(
    "is cleaned away on Large, one column in, over %s",
    (base) => {
      const result = run(oneTileLand(base), "Large");
      expect(result.dim).toBe(220);
      expect(landStageTerrain(result, 218, 0)).not.toBe(DESERT);
      expect(result.landOrigins[0]).toMatchObject({ x: 218, y: 0 });
    },
  );
});

describe("terrain classes", () => {
  const kind = (name: string) =>
    terrainKindOf(
      constants.find((c) => c.category === "terrain" && c.rmsConstant === name),
    );

  it.each([
    ["GRASS", "land"],
    ["FOREST", "land"],
    ["SNOW", "land"],
    ["WATER", "water"],
    ["DEEP_WATER", "water"],
    ["SHALLOW", "amphibious"],
    ["BEACH", "beach"],
    ["ICYSHORE", "beach"],
    ["ICE", "unbuildable"],
    ["DLC_ROCK", "unbuildable"],
  ])("%s is %s", (name, expected) => {
    expect(kind(name)).toBe(expected);
  });

  it("is unknown for a terrain nothing classifies", () => {
    expect(terrainKindOf(undefined)).toBeUndefined();
    expect(
      terrainKindOf({ constId: 999, rmsConstant: null, category: "terrain" }),
    ).toBeUndefined();
  });
});

describe("the cleanup note", () => {
  it("names the tile and the land the cleanup erased on a WATER base", () => {
    const note = cleanupNote(run(oneTileLand("WATER"), "Large"));
    expect(note).toMatchObject({ stage: "S1", prominence: "drawer" });
    expect(note?.text).toBe(
      "Cleanup turned 1 tile into WATER (DESERT 1) because it sat between WATER tiles, erasing the land on line 3. " +
        ALWAYS,
    );
  });

  // DESERT into GRASS is land into land, so the map plays the same.
  it("is absent when the cleanup keeps every tile's class", () => {
    expect(cleanupNote(run(oneTileLand("GRASS"), "Large"))).toBeUndefined();
  });

  it.each([
    ["BEACH", "beach"],
    ["DLC_ROCK", "unbuildable"],
  ])("names a %s tile turned into GRASS, %s into land", (terrain) => {
    const source = oneTileLand("GRASS").replace("DESERT", terrain);
    expect(cleanupNote(run(source, "Large"))?.text).toBe(
      `Cleanup turned 1 tile into GRASS (${terrain} 1) because it sat between GRASS tiles, erasing the land on line 3. ${ALWAYS}`,
    );
  });

  it("is absent when the cleanup changed nothing", () => {
    expect(cleanupNote(run(oneTileLand("WATER"), "Tiny"))).toBeUndefined();
  });

  it("names every erased land by its line", () => {
    const source = [
      oneTileLand("WATER"),
      "create_land { terrain_type DESERT land_position 50 0 base_size 0 land_percent 0 }",
    ].join("\n");
    expect(cleanupNote(run(source, "Large"))?.text).toBe(
      "Cleanup turned 2 tiles into WATER (DESERT 2) because each sat between WATER tiles, erasing the lands on lines 3 and 4. " +
        ALWAYS,
    );
  });

  // The land stage cleans against GRASS and leaves the strip alone. The beach
  // before <TERRAIN_GENERATION> turns it into BEACH, and the cleanup against
  // WATER at the end of the terrain stage takes it. No land held it, so
  // nothing is erased.
  it("counts the end of the terrain stage, base terrain included", () => {
    const source = ["<LAND_GENERATION>", "base_terrain GRASS", ...WATER_STAMPS];
    const result = run(source.join("\n"), "Tiny");
    expect(landStageTerrain(result, 63, 60)).toBe(terrainId("GRASS"));
    const note = cleanupNote(result);
    expect(note?.stage).toBe("S4");
    expect(note?.text).toBe(
      "Cleanup turned 5 tiles into WATER (BEACH 5) because each sat between WATER tiles. " +
        ALWAYS,
    );
  });

  it("names both passes in one line, the land stage's first", () => {
    const beachTile = oneTileLand("GRASS", "50 0").replace("DESERT", "BEACH");
    const note = cleanupNote(
      run([beachTile, ...WATER_STAMPS].join("\n"), "Tiny"),
    );
    expect(note?.stage).toBe("S1");
    expect(note?.text).toBe(
      "Cleanup turned 1 tile into GRASS (BEACH 1) and 5 into WATER (BEACH 5) because each sat between tiles of the terrain it became, erasing the land on line 3. " +
        ALWAYS,
    );
  });

  it("leaves a same-class pass out of the line", () => {
    const desertTile = oneTileLand("GRASS", "50 0");
    const note = cleanupNote(
      run([desertTile, ...WATER_STAMPS].join("\n"), "Tiny"),
    );
    expect(note?.stage).toBe("S4");
    expect(note?.text).toBe(
      "Cleanup turned 5 tiles into WATER (BEACH 5) because each sat between WATER tiles. " +
        ALWAYS,
    );
  });
});
