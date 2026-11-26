// The per command tile sets behind "Highlight selected command"
// (commandTiles.ts), on their own and in a real generation.

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
  endCommandTiles,
  objectFootprintTiles,
  recordPaint,
  recordTiles,
  startCommandTiles,
  traceCommandTiles,
} from "../generator/commandTiles";
import { createTileGrid } from "../generator/grid";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

describe("the recorder", () => {
  it("runs the function and records nothing when not recording", () => {
    const grid = createTileGrid(4, 0, 0);
    expect(
      traceCommandTiles({ span: { start: 5 } }, "terrain", grid, () => 7),
    ).toBe(7);
    expect(endCommandTiles(grid.terrain)).toBeNull();
  });

  it("tells placed tiles from surviving ones", () => {
    const dim = 4;
    const grid = createTileGrid(dim, 0, 0);
    startCommandTiles(dim);
    // Command A paints tiles 0 to 5 with terrain 7.
    traceCommandTiles({ span: { start: 10 } }, "terrain", grid, () => {
      for (let i = 0; i <= 5; i++) grid.terrain[i] = 7;
    });
    // Command B paints tiles 3 to 8 with terrain 9, over A's tiles 3 to 5.
    traceCommandTiles({ span: { start: 20 } }, "terrain", grid, () => {
      for (let i = 3; i <= 8; i++) grid.terrain[i] = 9;
    });
    // Command C paints tile 0 with the terrain it already holds, so it does
    // not count as placed at all.
    traceCommandTiles({ span: { start: 30 } }, "terrain", grid, () => {
      grid.terrain[0] = 7;
    });
    // Something after the commands repaints tile 1, so A no longer holds it.
    grid.terrain[1] = 2;
    const sets = endCommandTiles(grid.terrain)!;
    const a = sets.find((s) => s.offset === 10)!;
    const b = sets.find((s) => s.offset === 20)!;
    expect([...a.first]).toEqual([0, 1, 2, 3, 4, 5]);
    // Tiles 3 to 5 went to B, tile 1 was repainted, so only 0 and 2 survive.
    expect([...a.second!]).toEqual([0, 2]);
    expect([...b.first]).toEqual([3, 4, 5, 6, 7, 8]);
    expect([...b.second!]).toEqual([3, 4, 5, 6, 7, 8]);
    expect(sets.find((s) => s.offset === 30)).toMatchObject({
      first: new Uint32Array(0),
    });
  });

  it("unions repeated runs of one offset and one set kinds", () => {
    startCommandTiles(4);
    recordTiles(8, "object", [3, 1]);
    recordTiles(8, "object", [1, 2]);
    recordTiles(-1, "cliff", [9]);
    const sets = endCommandTiles(new Uint16Array(16))!;
    expect([...sets.find((s) => s.offset === 8)!.first]).toEqual([1, 2, 3]);
    expect(sets.find((s) => s.offset === 8)!.second).toBeUndefined();
    expect(sets.find((s) => s.offset === -1)!.kind).toBe("cliff");
  });

  it("takes connection paint from recordPaint", () => {
    startCommandTiles(2);
    recordPaint(
      4,
      "connection",
      new Map([
        [0, 5],
        [1, 5],
      ]),
    );
    const final = Uint16Array.from([5, 6, 0, 0]);
    const set = endCommandTiles(final)!.find((s) => s.offset === 4)!;
    expect([...set.first]).toEqual([0, 1]);
    expect([...set.second!]).toEqual([0]);
  });
});

describe("objectFootprintTiles", () => {
  it("is one tile for a half size under 1 and a clamped square otherwise", () => {
    expect(objectFootprintTiles(3.5, 2.5, [0.5, 0.5], 10)).toEqual([
      2 * 10 + 3,
    ]);
    // Centred on a corner with half size 2, 4 tiles a side.
    expect(objectFootprintTiles(5, 5, [2, 2], 10)).toHaveLength(16);
    // Clamped at the map edge.
    expect(objectFootprintTiles(0, 0, [2, 2], 10)).toHaveLength(4);
  });
});

describe("a generation's command tiles", () => {
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
    "  create_elevation 3 { base_terrain DIRT number_of_tiles 300 }",
    "<TERRAIN_GENERATION>",
    "  create_terrain FOREST { base_terrain DIRT land_percent 10 number_of_clumps 4 }",
    "  create_terrain SAND { base_terrain DIRT land_percent 10 number_of_clumps 4 }",
    "<OBJECTS_GENERATION>",
    "  create_object TOWN_CENTER { set_place_for_every_player max_distance_to_players 0 }",
    "  create_object GOLD { number_of_objects 7 set_tight_grouping }",
  ].join("\n");
  const run = (commandTiles: boolean) =>
    generatePreview(
      parseRms(SCRIPT, lang),
      { language: buildLanguageIndex(lang), constants, objectData },
      {
        playerCount: 2,
        mapSize: "Tiny",
        teams: DEFAULT_TEAMS,
        teamPositions: true,
      },
      { seed: 4, collectSnapshots: false, commandTiles },
    );
  const offsetOf = (text: string) => SCRIPT.indexOf(text);

  it("is absent unless asked for and never changes the generation", () => {
    const off = run(false);
    const on = run(true);
    expect(off.commandTiles).toBeUndefined();
    expect(on.commandTiles).toBeDefined();
    expect(on.objects).toEqual(off.objects);
    expect(Array.from(on.grid.terrain)).toEqual(Array.from(off.grid.terrain));
    expect(Array.from(on.grid.elevation)).toEqual(
      Array.from(off.grid.elevation),
    );
  });

  it("gives surviving tiles inside the placed set, holding the final terrain", () => {
    const r = run(true);
    const sets = r.commandTiles!;
    const forest = sets.find(
      (s) => s.offset === offsetOf("create_terrain FOREST"),
    )!;
    const sand = sets.find(
      (s) => s.offset === offsetOf("create_terrain SAND"),
    )!;
    for (const set of [forest, sand]) {
      expect(set.kind).toBe("terrain");
      const placed = new Set(set.first);
      for (const i of set.second!) expect(placed.has(i)).toBe(true);
    }
    // A tile in both commands' placed sets survives for at most one of them.
    const sandPlaced = new Set(sand.first);
    const shared = [...forest.second!].filter((i) => sandPlaced.has(i));
    for (const i of shared) expect(new Set(sand.second!).has(i)).toBe(false);
  });

  it("gives every land a grown set inside its zone set, and objects a footprint", () => {
    const r = run(true);
    const sets = r.commandTiles!;
    const lands = sets.find(
      (s) => s.offset === offsetOf("create_player_lands"),
    )!;
    expect(lands.kind).toBe("land");
    expect(lands.first.length).toBeGreaterThan(0);
    const zone = new Set(lands.second!);
    // Not strictly a subset. The leftover fill after growth gives a land the
    // tiles between two of its own, without writing the zone byte (growLands,
    // as the game does), so a few grown tiles sit outside their zone's set.
    const inside = [...lands.first].filter((i) => zone.has(i)).length;
    expect(inside / lands.first.length).toBeGreaterThan(0.9);
    expect(zone.size).toBeGreaterThan(0);
    expect(lands.zone!.lands).toBeGreaterThanOrEqual(1);
    const tc = sets.find(
      (s) => s.offset === offsetOf("create_object TOWN_CENTER"),
    )!;
    expect(tc.kind).toBe("object");
    expect(tc.first.length).toBeGreaterThan(0);
    const elevation = sets.find(
      (s) => s.offset === offsetOf("create_elevation"),
    )!;
    expect(elevation.first.length).toBeGreaterThan(0);
  });
});
