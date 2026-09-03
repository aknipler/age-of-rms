import { describe, expect, it } from "vitest";
import { computeForestWood, type ForestTerrainConstant } from "../generator/forestTrees";
import type { ObjectConstant } from "../generator/objects";
import type { TileGrid } from "../generator/types";

const GRASS = 0;
const FOREST = 10; // real DE id, single-slot terrain in the shipped data
const PINE = 19; // real DE id, single-slot after cosmetic slots are dropped
const OAK_BUSH = 20; // real DE id, three wood-bearing slots
const UNMEASURED_FOREST = 200; // isForest: true, no autoTreeUnits (D9 fallback)

const FOREST_TREE_UNIT = 411;
const PINE_TREE_UNIT = 350;
const BUSH_A_UNIT = 302;
const AFRICAN_BUSH_UNIT = 1053;
const OAK_TREE_UNIT = 349;

function grid(dim: number, terrainIds: readonly number[]): TileGrid {
  const terrain = new Uint16Array(dim * dim);
  for (let i = 0; i < terrain.length; i++) terrain[i] = terrainIds[i % terrainIds.length];
  return {
    dim,
    terrain,
    layer: new Uint16Array(dim * dim),
    elevation: new Uint8Array(dim * dim),
    cliff: new Uint8Array(dim * dim),
    landId: new Int16Array(dim * dim).fill(-1),
    zone: new Int16Array(dim * dim),
    occupied: new Uint8Array(dim * dim),
  };
}

const terrainConstants: ForestTerrainConstant[] = [
  { constId: GRASS, category: "terrain" },
  { constId: FOREST, category: "terrain", isForest: true, autoTreeUnits: [{ objectId: FOREST_TREE_UNIT, density: 1 }] },
  { constId: PINE, category: "terrain", isForest: true, autoTreeUnits: [{ objectId: PINE_TREE_UNIT, density: 1 }] },
  {
    constId: OAK_BUSH,
    category: "terrain",
    isForest: true,
    autoTreeUnits: [
      { objectId: BUSH_A_UNIT, density: 0.2 },
      { objectId: AFRICAN_BUSH_UNIT, density: 0.3 },
      { objectId: OAK_TREE_UNIT, density: 1 },
    ],
  },
  { constId: UNMEASURED_FOREST, category: "terrain", isForest: true },
];

const objectConstants: ObjectConstant[] = [
  { constId: FOREST_TREE_UNIT, rmsConstant: "FOREST_TREE", category: "object", resourceAmounts: { wood: 100 } },
  { constId: PINE_TREE_UNIT, rmsConstant: "PINETREE", category: "object", resourceAmounts: { wood: 100 } },
  { constId: BUSH_A_UNIT, rmsConstant: null, category: "object", resourceAmounts: { wood: 100 } },
  { constId: AFRICAN_BUSH_UNIT, rmsConstant: "DLC_AFRICANBUSH", category: "object", resourceAmounts: { wood: 100 } },
  { constId: OAK_TREE_UNIT, rmsConstant: "OAKTREE", category: "object", resourceAmounts: { wood: 100 } },
];

describe("computeForestWood", () => {
  it("is zero on a grid with no forest terrain", () => {
    expect(computeForestWood(grid(4, [GRASS]), terrainConstants, objectConstants, new Set(), new Map())).toBe(0);
  });

  it("sums density * unit wood over a uniform single-slot forest terrain", () => {
    const g = grid(4, [PINE]); // 16 tiles, density 1, 100 wood
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), new Map())).toBe(1600);
  });

  it("cascades a multi-slot terrain first-hit-wins, not an additive sum over every slot", () => {
    // 1 tile, slots in order 0.2 / 0.3 / 1.0. First-hit-wins fractions:
    // slot1 0.2, slot2 0.3*(1-0.2)=0.24, slot3 1.0*(1-0.2)*(1-0.3)=0.56 — sums to 1.0
    // because the last slot's density is 1 (a guaranteed catch-all). Wood:
    // 0.2*100 + 0.24*100 + 0.56*100 = 100, not the naive additive 150.
    const g = grid(1, [OAK_BUSH]);
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), new Map())).toBe(100);
  });

  it("leaves a fraction of a tile's expected wood unclaimed when no slot's density reaches 1", () => {
    // Reusing OAK_BUSH's first two slots only, via a terrain that stops at 0.3:
    // slot1 0.2, slot2 0.3*(1-0.2)=0.24 — 0.56 of the tile hits no slot at all,
    // and contributes zero, rather than being implicitly caught by a slot that
    // isn't there.
    const short: ForestTerrainConstant[] = [
      {
        constId: OAK_BUSH,
        category: "terrain",
        isForest: true,
        autoTreeUnits: [
          { objectId: BUSH_A_UNIT, density: 0.2 },
          { objectId: AFRICAN_BUSH_UNIT, density: 0.3 },
        ],
      },
    ];
    const g = grid(1, [OAK_BUSH]);
    expect(computeForestWood(g, short, objectConstants, new Set(), new Map())).toBe(44);
  });

  it("a suppressed earlier slot still consumes its own share of remaining, rather than handing it to the next slot", () => {
    // Same OAK_BUSH order, slot1 (density 0.2) suppressed: its 0.2 share yields
    // no wood AND is not redistributed — slot2 and slot3 keep the exact
    // fractions the cascade already assigned them (0.24 and 0.56), matching
    // "the tile is still rolled for that species, suppression only zeroes the
    // yield" rather than "the species never gets a turn".
    const g = grid(1, [OAK_BUSH]);
    const suppressed = new Set([`${OAK_BUSH}:${BUSH_A_UNIT}`]);
    expect(computeForestWood(g, terrainConstants, objectConstants, suppressed, new Map())).toBe(80);
  });

  it("sums across a mixed grid, one terrain at a time", () => {
    const g = grid(2, [FOREST, GRASS, GRASS, PINE]); // 1 FOREST tile (100) + 1 PINE tile (100), 2 GRASS tiles (0)
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), new Map())).toBe(200);
  });

  it("skips a suppressed (terrain, unit) pair", () => {
    const g = grid(1, [FOREST]);
    const suppressed = new Set([`${FOREST}:${FOREST_TREE_UNIT}`]);
    expect(computeForestWood(g, terrainConstants, objectConstants, suppressed, new Map())).toBe(0);
  });

  it("applies a D10 yield override instead of the base wood value", () => {
    const g = grid(1, [FOREST]);
    const overrides = new Map([[FOREST_TREE_UNIT, { key: "wood" as const, amount: 400 }]]);
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), overrides)).toBe(400);
  });

  it("ignores a yield override for a different resource", () => {
    const g = grid(1, [FOREST]);
    const overrides = new Map([[FOREST_TREE_UNIT, { key: "gold" as const, amount: 400 }]]);
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), overrides)).toBe(100);
  });

  it("falls back to Ash's 100-wood/100%-density default for an isForest terrain the extraction has not reached", () => {
    const g = grid(3, [UNMEASURED_FOREST]); // 9 tiles * 100
    expect(computeForestWood(g, terrainConstants, objectConstants, new Set(), new Map())).toBe(900);
  });
});
