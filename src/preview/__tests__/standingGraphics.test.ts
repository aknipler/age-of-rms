// A script's `effect_amount (GAIA_)SET_ATTRIBUTE <object> ATTR_STANDING_GRAPHIC
// <graphic>` reaches the textured view (docs/preview-de-textures-design.md
// Sec.14.3). Mont Saint Michel draws its hay stacks as a bridge piece this
// way, and the preview drew the hay stack's own picture.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import spritesJson from "../../../reference/data/object-sprites.json";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import type { ObjectDataFile } from "../generator/deObjectData";
import type { DeObjectRecord } from "../generator/types";
import { planSprites, type SpriteRow } from "../render/objectSprites";
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
const objectData = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "object-data.json"),
    "utf8",
  ),
) as ObjectDataFile & { objects: { id: number; g?: number }[] };
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants,
  objectData,
};

const HAY_STACK = 857;
const BRIDGE_PIECE = 12783;

function generate(script: string) {
  return generatePreview(
    parseRms(script, lang),
    refDb,
    {
      playerCount: 2,
      mapSize: "Tiny",
      teams: DEFAULT_TEAMS,
      teamPositions: true,
    },
    { seed: 3, collectSnapshots: false },
  );
}

describe("standingGraphics", () => {
  it("carries a Gaia standing graphic, the last line winning", () => {
    const result = generate(`
<LAND_GENERATION>
  base_terrain GRASS
effect_amount GAIA_SET_ATTRIBUTE HAY_STACK ATTR_STANDING_GRAPHIC 100
effect_amount GAIA_SET_ATTRIBUTE HAY_STACK ATTR_STANDING_GRAPHIC ${BRIDGE_PIECE}
`);
    expect(result.standingGraphics?.gaia).toContainEqual([
      HAY_STACK,
      BRIDGE_PIECE,
    ]);
    expect(result.standingGraphics?.player).toEqual([]);
  });

  it("gives a plain SET_ATTRIBUTE to players and Gaia both", () => {
    const result = generate(`
<LAND_GENERATION>
  base_terrain GRASS
effect_amount SET_ATTRIBUTE HAY_STACK ATTR_STANDING_GRAPHIC ${BRIDGE_PIECE}
`);
    expect(result.standingGraphics?.gaia).toContainEqual([
      HAY_STACK,
      BRIDGE_PIECE,
    ]);
    expect(result.standingGraphics?.player).toContainEqual([
      HAY_STACK,
      BRIDGE_PIECE,
    ]);
  });
});

describe("planSprites with the script's graphics", () => {
  const rows = (
    spritesJson as unknown as { sprites: Record<string, SpriteRow> }
  ).sprites;
  const tables = {
    sprites: new Map(Object.entries(rows).map(([id, r]) => [Number(id), r])),
    standing: new Map(
      objectData.objects
        .filter((o) => o.g !== undefined)
        .map((o) => [o.id, o.g as number]),
    ),
    graphicOverrides: {
      gaia: new Map([[HAY_STACK, BRIDGE_PIECE]]),
      player: new Map<number, number>(),
    },
  };
  const hay = (owner: number): DeObjectRecord => ({
    id: HAY_STACK,
    owner,
    x: 5.5,
    y: 5.5,
    rotation: 0,
    frame: 0,
    status: 2,
    kind: "script",
  });

  it("draws a Gaia object as the script's graphic, a player's as the dat's", () => {
    const own = rows[String(tables.standing.get(HAY_STACK))][0];
    expect(planSprites([hay(0)], tables).map((p) => p.file)).toEqual([
      rows[String(BRIDGE_PIECE)][0],
    ]);
    expect(planSprites([hay(1)], tables).map((p) => p.file)).toEqual([own]);
  });

  it("reports a graphic the table lacks instead of drawing nothing silently", () => {
    const unknown = new Set<number>();
    const parts = planSprites(
      [hay(0)],
      {
        ...tables,
        graphicOverrides: {
          gaia: new Map([[HAY_STACK, 999999]]),
          player: new Map(),
        },
      },
      unknown,
    );
    expect(parts).toEqual([]);
    expect([...unknown]).toEqual([HAY_STACK]);
  });
});
