// The hourglass's timings (generationTiming.ts): the recorder on its own, and
// a real generation's sections and command rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import type { ObjectDataFile } from "../generator/deObjectData";
import {
  endTiming,
  markSection,
  startTiming,
  timeCall,
} from "../generator/generationTiming";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

describe("the recorder", () => {
  it("does nothing but run the function when not recording", () => {
    expect(timeCall("x", 0, () => 7)).toBe(7);
    expect(endTiming(() => 1)).toBeNull();
  });

  it("adds repeat runs of one command together and counts them", () => {
    startTiming();
    timeCall("create_object GOLD", 40, () => 0);
    timeCall("create_object GOLD", 40, () => 0);
    timeCall("create_object GOLD", 90, () => 0);
    markSection("S6");
    const timing = endTiming((offset) => (offset === 40 ? 3 : 5))!;
    const calls = timing.sections[0].calls;
    // Two commands with the same text on different lines stay apart.
    expect(calls).toHaveLength(2);
    const counts = calls.map((c) => [c.line, c.count]).sort();
    expect(counts).toEqual([
      [3, 2],
      [5, 1],
    ]);
  });

  it("does not count a call inside another call twice", () => {
    startTiming();
    timeCall("outer", undefined, () => timeCall("inner", undefined, () => 0));
    markSection("S1");
    const timing = endTiming(() => 1)!;
    expect(timing.sections[0].calls.map((c) => c.label)).toEqual(["outer"]);
  });
});

describe("a generation's timing", () => {
  const lang = loadLanguage();
  const constants = (
    JSON.parse(
      readFileSync(
        join(REPO_ROOT, "reference", "data", "game-constants.json"),
        "utf8",
      ),
    ) as { constants: ObjectConstant[] }
  ).constants;
  const objectData = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "object-data.json"),
      "utf8",
    ),
  ) as ObjectDataFile;
  const SCRIPT = [
    "<PLAYER_SETUP>",
    "  random_placement",
    "<LAND_GENERATION>",
    "  base_terrain GRASS",
    "  create_player_lands { terrain_type DIRT land_percent 30 }",
    "<ELEVATION_GENERATION>",
    "  create_elevation 3 { base_terrain GRASS number_of_tiles 300 }",
    "<TERRAIN_GENERATION>",
    "  create_terrain FOREST { base_terrain GRASS land_percent 10 number_of_clumps 4 }",
    "<OBJECTS_GENERATION>",
    "  create_object TOWN_CENTER { set_place_for_every_player max_distance_to_players 0 }",
    "  create_object GOLD { number_of_objects 7 set_tight_grouping }",
  ].join("\n");
  const run = (timing: boolean) =>
    generatePreview(
      parseRms(SCRIPT, lang),
      { language: buildLanguageIndex(lang), constants, objectData },
      {
        playerCount: 2,
        mapSize: "Tiny",
        teams: DEFAULT_TEAMS,
        teamPositions: true,
      },
      { seed: 4, collectSnapshots: false, timing },
    );

  it("is absent unless asked for", () => {
    expect(run(false).timing).toBeUndefined();
  });

  it("has every section in order and a row per command with its line", () => {
    const timing = run(true).timing!;
    expect(timing.sections.map((s) => s.stage)).toEqual([
      "S0",
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
    ]);
    const objects = timing.sections[6].calls;
    // One run per command; the object stage loops over the players inside it.
    expect(
      objects.find((c) => c.label === "create_object TOWN_CENTER"),
    ).toMatchObject({ line: 11, count: 1 });
    expect(objects.find((c) => c.label === "create_object GOLD")?.line).toBe(
      12,
    );
    expect(
      timing.sections[4].calls.find((c) => c.label === "create_terrain FOREST")
        ?.line,
    ).toBe(9);
    expect(timing.sections[2].calls[0]?.label).toBe("create_elevation 3");
    // The sections cover the run; the total includes the work after S6.
    const sum = timing.sections.reduce((t, s) => t + s.ms, 0);
    expect(sum).toBeLessThanOrEqual(timing.totalMs + 0.001);
  });
});
