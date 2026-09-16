import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import {
  scanAutoTreeEffects,
  type TerrainRestriction,
} from "../generator/forestTreeSuppression";
import type { ObjectConstant } from "../generator/objects";
import {
  DEFAULT_TEAMS,
  type MapSize,
  type TeamNumber,
} from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const languageIndex: LanguageIndex = buildLanguageIndex(lang);

// Small, hand-built world mirroring the real ids the plan's corpus examples
// use (Menindee_AUS_v2.3.rms), NOT the full 3904-row game-constants.json —
// this file's own job is the effect_amount walk and the suppression rule,
// which do not depend on the real roster's size.
const ATTR_TERRAIN_ID = 53;
const ATTR_STORAGE_VALUE = 21;
const PALM_DESERT = 13;
const PALM_GRASS_FOREST = 112;
const FORESTAUTUMN = 104;
const PALMTREE = 351;
const AUTUMNTREE = 1248; // Menindee's TREE_AUTUMN
const GOLD = 66;
const FOREST_TREE_UNIT = 411;

const constants: ObjectConstant[] = [
  {
    constId: PALM_DESERT,
    rmsConstant: "PALM_DESERT",
    category: "terrain",
    isForest: true,
    autoTreeUnits: [{ objectId: PALMTREE, density: 1 }],
  },
  {
    constId: PALM_GRASS_FOREST,
    rmsConstant: "PALM_GRASS_FOREST",
    category: "terrain",
    isForest: true,
    autoTreeUnits: [{ objectId: PALMTREE, density: 1 }],
  },
  {
    constId: FORESTAUTUMN,
    rmsConstant: "DLC_FORESTAUTUMN",
    category: "terrain",
    isForest: true,
    autoTreeUnits: [{ objectId: AUTUMNTREE, density: 1 }],
  },
  {
    constId: PALMTREE,
    rmsConstant: "PALMTREE",
    category: "object",
    resourceAmounts: { wood: 100 },
    resourceStorages: [{ type: 1, amount: 100, resource: "wood" }],
  },
  {
    constId: AUTUMNTREE,
    rmsConstant: "DLC_AUTUMNTREE",
    category: "object",
    resourceAmounts: { wood: 100 },
    resourceStorages: [{ type: 1, amount: 100, resource: "wood" }],
  },
  {
    constId: GOLD,
    rmsConstant: "GOLD",
    category: "object",
    resourceAmounts: { gold: 800 },
  },
  {
    constId: FOREST_TREE_UNIT,
    rmsConstant: "FOREST_TREE",
    category: "object",
    resourceAmounts: { wood: 100 },
    resourceStorages: [{ type: 1, amount: 100, resource: "wood" }],
  },
  // A wood-bearing object that no terrain's autoTreeUnits names — the "the script moved a tree, but not one we know a spawn table for" case.
  {
    constId: 9001,
    rmsConstant: "DRIFT_WOOD",
    category: "object",
    resourceAmounts: { wood: 60 },
    resourceStorages: [{ type: 1, amount: 60, resource: "wood" }],
  },
  // A building whose name merely LOOKS treeish (the TREE_NAME_PATTERN false positive this data-driven check must not reproduce).
  {
    constId: 9002,
    rmsConstant: "FORESTBUILDING",
    category: "object",
    resourceAmounts: {},
  },
  {
    constId: ATTR_TERRAIN_ID,
    rmsConstant: "ATTR_TERRAIN_ID",
    category: "attribute",
  },
  {
    constId: ATTR_STORAGE_VALUE,
    rmsConstant: "ATTR_STORAGE_VALUE",
    category: "attribute",
    writesStorageSlot: 0,
  },
  {
    constId: 15,
    rmsConstant: "TREE_CLASS",
    category: "objectClass",
    memberIds: [FOREST_TREE_UNIT, PALMTREE],
  },
];

const restrictions: TerrainRestriction[] = [
  {
    restrictionId: 0,
    permittedTerrainIds: [PALM_DESERT, PALM_GRASS_FOREST, FORESTAUTUMN],
  }, // unrestricted in this tiny world: permits everything that exists
  { restrictionId: 3, permittedTerrainIds: [] }, // Menindee's OYSTERS restriction: excludes every forest terrain here
];

function settings(
  overrides: {
    playerCount?: number;
    mapSize?: MapSize;
    teams?: readonly TeamNumber[];
  } = {},
) {
  return {
    playerCount: overrides.playerCount ?? 2,
    mapSize: overrides.mapSize ?? "Tiny",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

function scan(source: string) {
  const instantiated = instantiateScript(
    parseRms(source, lang),
    languageIndex,
    settings(),
    1,
  );
  return scanAutoTreeEffects(instantiated, constants, restrictions);
}

describe("scanAutoTreeEffects", () => {
  it("suppresses an aliased target when the rewritten restriction excludes the terrain (Menindee's idiom)", () => {
    const result = scan(`
#const TREE_AUTUMN ${AUTUMNTREE}
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE TREE_AUTUMN ATTR_TERRAIN_ID 3
effect_amount GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 3
`);
    expect(result.suppressed.has(`${FORESTAUTUMN}:${AUTUMNTREE}`)).toBe(true);
    expect(result.suppressed.has(`${PALM_DESERT}:${PALMTREE}`)).toBe(true);
    // PALMTREE serves BOTH forests, per (terrain, unit), not per unit.
    expect(result.suppressed.has(`${PALM_GRASS_FOREST}:${PALMTREE}`)).toBe(
      true,
    );
    expect(result.note).toBeUndefined();
  });

  it("does not suppress or note a non-tree ATTR_TERRAIN_ID rewrite (GOLD)", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE GOLD ATTR_TERRAIN_ID 3
`);
    expect(result.suppressed.size).toBe(0);
    expect(result.note).toBeUndefined();
  });

  it("does not suppress a rewrite to restriction 0 (widening, not narrowing)", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 0
`);
    expect(result.suppressed.size).toBe(0);
  });

  it("emits one drawer note when a wood-bearing but unmapped unit is retargeted, deduped across lines", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE DRIFT_WOOD ATTR_TERRAIN_ID 3
effect_amount GAIA_SET_ATTRIBUTE DRIFT_WOOD ATTR_TERRAIN_ID 0
`);
    expect(result.note?.prominence).toBe("drawer");
    expect(result.note?.text).toContain("DRIFT_WOOD");
  });

  it("does not note a building whose name merely resembles a tree (the TREE_NAME_PATTERN false positive)", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE FORESTBUILDING ATTR_TERRAIN_ID 3
`);
    expect(result.note).toBeUndefined();
  });

  it("records a D10 yield override for a single-unit target", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE PALMTREE ATTR_STORAGE_VALUE 400
`);
    expect(result.yieldOverrides.get(PALMTREE)).toEqual({
      key: "wood",
      amount: 400,
    });
  });

  it("expands a class target to every member (TREE_CLASS)", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE TREE_CLASS ATTR_STORAGE_VALUE 250
`);
    expect(result.yieldOverrides.get(FOREST_TREE_UNIT)).toEqual({
      key: "wood",
      amount: 250,
    });
    expect(result.yieldOverrides.get(PALMTREE)).toEqual({
      key: "wood",
      amount: 250,
    });
  });

  it("resolves a D10 target written as a bare unit id, not only a name", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE ${PALMTREE} ATTR_STORAGE_VALUE 500
`);
    expect(result.yieldOverrides.get(PALMTREE)).toEqual({
      key: "wood",
      amount: 500,
    });
  });

  it("resolves the ATTR_STORAGE_VALUE attribute by its raw id too, since the data carries its constId", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE PALMTREE ${ATTR_STORAGE_VALUE} 500
`);
    expect(result.yieldOverrides.get(PALMTREE)).toEqual({
      key: "wood",
      amount: 500,
    });
  });

  it("ignores an attribute that writes no storage slot and is not ATTR_TERRAIN_ID", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID_UNRELATED 500
`);
    expect(result.yieldOverrides.size).toBe(0);
    expect(result.suppressed.size).toBe(0);
  });

  it("resolves an aliased #const target for a D10 override, mirroring the terrain-id half", () => {
    const result = scan(`
#const MY_PALM ${PALMTREE}
<PLAYER_SETUP>
effect_amount SET_ATTRIBUTE MY_PALM ATTR_STORAGE_VALUE 500
`);
    expect(result.yieldOverrides.get(PALMTREE)).toEqual({
      key: "wood",
      amount: 500,
    });
  });

  it("resolves an unknown restriction id as 'cannot determine' rather than guessing suppressed", () => {
    const result = scan(`
<PLAYER_SETUP>
effect_amount GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 999
`);
    expect(result.suppressed.size).toBe(0);
  });
});
