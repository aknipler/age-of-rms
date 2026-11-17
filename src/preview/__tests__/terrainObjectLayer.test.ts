// What the app draws from the rev 12 object stage (preview-design Sec.6.6).
// `deObjectMaps.test.ts` holds `deObjects` to DE. This file holds the two
// views the canvas reads off it, `terrainObjects` and `objects`, to
// `deObjects`, so the drawing cannot drift from the objects the gate checks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import type { ObjectDataFile } from "../generator/deObjectData";
import { terrainObjectLayer } from "../generator/deObjects";
import type { DeObjectRecord } from "../generator/types";
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
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants,
  objectData: JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "object-data.json"),
      "utf8",
    ),
  ) as ObjectDataFile,
};

const SCRIPT = `
<PLAYER_SETUP>
  random_placement
<LAND_GENERATION>
  base_terrain GRASS
  create_player_lands { terrain_type DIRT land_percent 30 base_size 8 }
<TERRAIN_GENERATION>
  create_terrain FOREST { base_terrain GRASS number_of_clumps 6 land_percent 12 }
<OBJECTS_GENERATION>
  create_object TOWN_CENTER { set_place_for_every_player max_distance_to_players 0 }
  create_object GOLD { number_of_objects 7 group_placement_radius 2 set_tight_grouping set_gaia_object_only }
  create_object SHEEP { set_place_for_every_player number_of_objects 4 min_distance_to_players 7 max_distance_to_players 8 }
`;

const result = generatePreview(
  parseRms(SCRIPT, lang),
  refDb,
  {
    playerCount: 2,
    mapSize: "Tiny",
    teams: DEFAULT_TEAMS,
    teamPositions: true,
  },
  { seed: 5, collectSnapshots: false },
);
const de = result.deObjects ?? [];

describe("terrainObjects", () => {
  it("is every live terrain object of deObjects, at its own position", () => {
    const live = de.filter((o) => o.kind === "terrain" && o.status === 2);
    const layer = result.terrainObjects!;
    expect(live.length).toBeGreaterThan(100);
    expect(layer.kind.length).toBe(live.length);
    live.forEach((o, i) => {
      expect(layer.kinds[layer.kind[i]].id).toBe(o.id);
      expect(layer.x[i]).toBe(Math.fround(o.x));
      expect(layer.y[i]).toBe(Math.fround(o.y));
    });
  });

  it("colours trees as wood and everything else a terrain spawns as decoration", () => {
    const layer = result.terrainObjects!;
    const categories = new Set(layer.kinds.map((k) => k.category));
    expect(categories.has("resource-wood")).toBe(true);
    for (const c of categories)
      expect(c === "decoration" || c.startsWith("resource")).toBe(true);
  });

  // The Obj. List shows these names. Green grass (1358) has no constant, and
  // its row's readable name is what a user can recognise.
  it("names an object with no constant by its readable name", () => {
    const layer = terrainObjectLayer(
      [
        {
          id: 1358,
          owner: 0,
          x: 1.5,
          y: 1.5,
          rotation: 0,
          frame: 0,
          status: 2,
          kind: "terrain",
        },
      ],
      constants,
    );
    expect(layer.kinds[0].objectRef).toBe("Grass, Green");
    expect(layer.kinds[0].category).toBe("decoration");
  });

  it("leaves out retired terrain objects, cliff pieces and scripted objects", () => {
    const records: DeObjectRecord[] = [
      {
        id: 411,
        owner: 0,
        x: 1.5,
        y: 1.5,
        rotation: 0,
        frame: 0,
        status: 2,
        kind: "terrain",
      },
      {
        id: 411,
        owner: 0,
        x: 2.5,
        y: 2.5,
        rotation: 0,
        frame: 0,
        status: 7,
        kind: "terrain",
      },
      {
        id: 264,
        owner: 0,
        x: 3,
        y: 3,
        rotation: 0,
        frame: 0,
        status: 2,
        kind: "cliff",
      },
      {
        id: 66,
        owner: 0,
        x: 4.5,
        y: 4.5,
        rotation: 0,
        frame: 0,
        status: 2,
        kind: "script",
      },
    ];
    const layer = terrainObjectLayer(records, constants);
    expect(layer.kind.length).toBe(1);
    expect(layer.x[0]).toBe(1.5);
    expect(layer.kinds).toHaveLength(1);
  });
});

describe("objects from the DE stage", () => {
  // `PlacedObject` is in tile indices for every reader. DE's positions are
  // continuous, so passing them through drew each object half a tile off and
  // left the tile readout empty.
  it("are the tiles the scripted objects of deObjects stand on", () => {
    const scripted = de.filter((o) => o.kind === "script");
    expect(result.objects.length).toBe(scripted.length);
    expect(result.objects.length).toBeGreaterThan(10);
    result.objects.forEach((o, i) => {
      expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
      expect(o.x).toBe(Math.floor(scripted[i].x));
      expect(o.y).toBe(Math.floor(scripted[i].y));
    });
  });
});
