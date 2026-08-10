import { describe, expect, it } from "vitest";
import {
  DEFAULT_BEACH_TERRAIN,
  DEPTH_HYBRID,
  DEPTH_LAND,
  DEPTH_WATER,
  UNREACHABLE,
  beachTerrainFor,
  borderBounds,
  computeSlopeMask,
  createTileGrid,
  distanceTransform,
  distanceTransformFromMask,
  forestZoneMask,
  percentRound,
  NO_LAYER,
  isBeachTerrain,
  isWaterTerrain,
  positionPercentToTile,
  resolveTerrainId,
  terrainDepth,
  tileIndex,
  waterDepthMask,
  waterMask,
  type TerrainConstantForMasks,
} from "../generator/grid";

describe("createTileGrid", () => {
  it("allocates dim*dim typed arrays, filled with the base terrain/layer", () => {
    const grid = createTileGrid(4, 7, 2);
    expect(grid.dim).toBe(4);
    for (const arr of [grid.terrain, grid.layer, grid.elevation, grid.cliff, grid.landId, grid.zone, grid.occupied]) {
      expect(arr.length).toBe(16);
    }
    expect([...grid.terrain]).toEqual(new Array(16).fill(7));
    expect([...grid.layer]).toEqual(new Array(16).fill(2));
  });

  it("defaults landId to -1 (unclaimed) and zone/elevation/cliff/occupied to 0", () => {
    const grid = createTileGrid(3, 0);
    expect([...grid.landId]).toEqual(new Array(9).fill(-1));
    expect([...grid.zone]).toEqual(new Array(9).fill(0));
    expect([...grid.elevation]).toEqual(new Array(9).fill(0));
    expect([...grid.occupied]).toEqual(new Array(9).fill(0));
  });

  it("defaults the layer to NO_LAYER when omitted, which is NOT terrain id 0", () => {
    // 0 is GRASS. A zero fill made "no layer" and "layered with GRASS"
    // indistinguishable in every consumer — see NO_LAYER's own doc.
    const grid = createTileGrid(2, 5);
    expect([...grid.layer]).toEqual([NO_LAYER, NO_LAYER, NO_LAYER, NO_LAYER]);
    expect(NO_LAYER).not.toBe(0);
  });

  it("fills the layer with an explicit base_layer, including GRASS", () => {
    const grid = createTileGrid(2, 5, 0);
    expect([...grid.layer]).toEqual([0, 0, 0, 0]);
  });
});

describe("tileIndex", () => {
  it("is row-major: y * dim + x", () => {
    const grid = createTileGrid(5, 0);
    expect(tileIndex(grid, 0, 0)).toBe(0);
    expect(tileIndex(grid, 3, 0)).toBe(3);
    expect(tileIndex(grid, 0, 2)).toBe(10);
    expect(tileIndex(grid, 4, 4)).toBe(24);
  });
});

describe("percentRound / positionPercentToTile (Sec.4)", () => {
  it("rounds half up, not to even and not down", () => {
    expect(percentRound(2.4)).toBe(2);
    expect(percentRound(2.5)).toBe(3);
    expect(percentRound(3.6)).toBe(4);
    expect(percentRound(10.8)).toBe(11);
  });

  it("matches Test 9's in-game confirmation: land_position 50 50 on a 120 map -> tile (60, 60)", () => {
    expect(positionPercentToTile(50, 120)).toBe(60);
  });

  it("clamps to dim-1 AFTER rounding — the Michi.rms land_position 100 100 fix", () => {
    // round(100/100 * 120) = 120, which is off-grid for x in [0, 120); Sec.4
    // says clamp the TILE, not the percentage, so this must land on 119.
    expect(positionPercentToTile(100, 120)).toBe(119);
  });

  it("never returns a negative tile for a legal (0-99) percent", () => {
    expect(positionPercentToTile(0, 120)).toBe(0);
  });
});

describe("borderBounds (Sec.4, measured RMSTEST_16/17)", () => {
  it("reproduces RMSTEST_16 exactly: left/right/top/bottom 3/2/6/9 on a 120 map", () => {
    const bounds = borderBounds({ left: 3, right: 2, top: 6, bottom: 9 }, 120);
    expect(bounds).toEqual({ minX: 4, maxX: 118, minY: 7, maxY: 109 });
  });

  it("reproduces RMSTEST_17 exactly: all four borders at 2 on Tiny (120)", () => {
    const bounds = borderBounds({ left: 2, right: 2, top: 2, bottom: 2 }, 120);
    expect(bounds).toEqual({ minX: 2, maxX: 118, minY: 2, maxY: 118 });
  });

  it("does not clamp negative border values — Sec.4 says they are legal", () => {
    const bounds = borderBounds({ left: -5, right: 0, top: 0, bottom: 0 }, 100);
    expect(bounds.minX).toBe(-5);
  });
});

describe("distanceTransform (Sec.4's derived mask, 4-connected)", () => {
  it("is 0 at the source terrain and increases by 1 per 4-connected step", () => {
    const grid = createTileGrid(5, 0); // all GRASS(0)
    grid.terrain[tileIndex(grid, 2, 2)] = 9; // one WATER-ish tile at the center
    const dist = distanceTransform(grid, 9);
    expect(dist[tileIndex(grid, 2, 2)]).toBe(0);
    expect(dist[tileIndex(grid, 1, 2)]).toBe(1);
    expect(dist[tileIndex(grid, 2, 1)]).toBe(1);
    // Diagonal neighbor: 4-connected means 2 steps, not 1.
    expect(dist[tileIndex(grid, 1, 1)]).toBe(2);
    expect(dist[tileIndex(grid, 0, 0)]).toBe(4);
  });

  it("multi-source: distance is to the NEAREST occurrence", () => {
    const grid = createTileGrid(7, 0);
    grid.terrain[tileIndex(grid, 0, 0)] = 9;
    grid.terrain[tileIndex(grid, 6, 0)] = 9;
    const dist = distanceTransform(grid, 9);
    // Tile (3,0) is 3 from both sources — check it picked the min, not summed.
    expect(dist[tileIndex(grid, 3, 0)]).toBe(3);
  });

  it("every tile is UNREACHABLE when the terrain never appears on the grid", () => {
    const grid = createTileGrid(3, 0);
    const dist = distanceTransform(grid, 999);
    expect([...dist]).toEqual(new Array(9).fill(UNREACHABLE));
  });
});

const WATER: TerrainConstantForMasks = { constId: 1, rmsConstant: "WATER", category: "terrain" };
const GRASS: TerrainConstantForMasks = { constId: 0, rmsConstant: "GRASS", category: "terrain" };
const FOREST: TerrainConstantForMasks = { constId: 10, rmsConstant: "FOREST", category: "terrain" };
const constants = [WATER, GRASS, FOREST];

describe("waterMask (Sec.4, Sec.12 item 6 name-heuristic fallback)", () => {
  it("flags tiles whose terrain name matches /WATER/ and nothing else", () => {
    const grid = createTileGrid(2, GRASS.constId!);
    grid.terrain[tileIndex(grid, 1, 0)] = WATER.constId!;
    const { mask, usedHeuristic } = waterMask(grid, constants);
    expect([...mask]).toEqual([0, 1, 0, 0]);
    expect(usedHeuristic).toBe(true);
  });

  it("leaves an unknown terrain id unflagged rather than throwing", () => {
    const grid = createTileGrid(1, 12345);
    const { mask } = waterMask(grid, constants);
    expect([...mask]).toEqual([0]);
  });
});

describe("forestZoneMask (Sec.4, guide place_on_forest_zone semantics)", () => {
  it("flags the forest tile itself and its 8-neighbours, not tiles two away", () => {
    const grid = createTileGrid(5, GRASS.constId!);
    grid.terrain[tileIndex(grid, 2, 2)] = FOREST.constId!;
    const { mask } = forestZoneMask(grid, constants);
    expect(mask[tileIndex(grid, 2, 2)]).toBe(1); // the tile itself
    expect(mask[tileIndex(grid, 1, 1)]).toBe(1); // diagonal neighbour (Moore, not 4-connected)
    expect(mask[tileIndex(grid, 3, 3)]).toBe(1);
    expect(mask[tileIndex(grid, 0, 0)]).toBe(0); // two tiles away
  });

  it("flags a placed-tree-object tile even on non-forest terrain, plus its neighbours", () => {
    const grid = createTileGrid(3, GRASS.constId!);
    const treeTile = tileIndex(grid, 1, 1);
    const { mask } = forestZoneMask(grid, constants, [treeTile]);
    expect(mask[treeTile]).toBe(1);
    expect(mask[tileIndex(grid, 0, 0)]).toBe(1); // adjacent to the tree tile
  });
});

describe("resolveTerrainId (the one resolver every stage shares)", () => {
  const symbols = new Map([["WOODIES", 48]]);

  it("resolves a built-in constant name", () => {
    expect(resolveTerrainId(constants, "WATER")).toBe(1);
  });

  it("takes a bare number as the id itself — 53 DE terrains have no other name", () => {
    expect(resolveTerrainId(constants, 26)).toBe(26);
  });

  it("accepts a bare id the reference data has never heard of", () => {
    // CLAUDE.md's positive-resolver rule: absence from our data proves
    // nothing about whether the terrain exists in the game.
    expect(resolveTerrainId(constants, 9999)).toBe(9999);
  });

  it("rejects a negative or fractional id rather than writing it to the grid", () => {
    expect(resolveTerrainId(constants, -1)).toBeUndefined();
    expect(resolveTerrainId(constants, 2.5)).toBeUndefined();
  });

  it("resolves a script's own #const", () => {
    expect(resolveTerrainId(constants, "WOODIES", symbols)).toBe(48);
  });

  it("does not let a #const shadow a built-in name", () => {
    // The engine loads random_map.def before the script and #const is
    // first-definition-wins, so a redefinition never takes effect in game.
    expect(resolveTerrainId(constants, "WATER", new Map([["WATER", 48]]))).toBe(1);
  });

  it("returns undefined for a name nothing defines", () => {
    expect(resolveTerrainId(constants, "NOT_A_TERRAIN", symbols)).toBeUndefined();
    expect(resolveTerrainId(constants, undefined)).toBeUndefined();
  });

  it("never matches an entry whose rmsConstant is null", () => {
    const unnamed: TerrainConstantForMasks[] = [{ constId: 26, rmsConstant: null, category: "terrain" }];
    expect(resolveTerrainId(unnamed, "26")).toBeUndefined();
    expect(resolveTerrainId(unnamed, 26)).toBe(26);
  });
});

describe("isWaterTerrain (the single-terrain form of waterMask)", () => {
  it("prefers the data flag over the name", () => {
    const flagged: TerrainConstantForMasks[] = [
      { constId: 54, rmsConstant: "DLC_MANGROVESHALLOW", category: "terrain", isWater: false },
      { constId: 15, rmsConstant: null, category: "terrain", isWater: true },
    ];
    expect(isWaterTerrain(flagged, 54)).toBe(false);
    // Unnamed, so the /WATER/ heuristic could never have seen it at all.
    expect(isWaterTerrain(flagged, 15)).toBe(true);
  });

  it("falls back to the name when the entry carries no flag", () => {
    expect(isWaterTerrain(constants, 1)).toBe(true); // WATER, no isWater in this fixture
    expect(isWaterTerrain(constants, 0)).toBe(false);
  });

  it("is false for an unknown id and for undefined", () => {
    expect(isWaterTerrain(constants, 9999)).toBe(false);
    expect(isWaterTerrain(constants, undefined)).toBe(false);
  });
});

describe("terrainDepth / waterDepthMask (the automatic beach rule's own three-level scale)", () => {
  // Deliberately mixed against `isWater` in both directions, because the
  // point of the flag is that it is orthogonal rather than a rereading: a
  // shallow that IS water, a shallow that is NOT, and open water.
  const depthConstants: TerrainConstantForMasks[] = [
    { constId: 0, rmsConstant: "GRASS", category: "terrain", isWater: false },
    { constId: 4, rmsConstant: "SHALLOW", category: "terrain", isWater: true, isHybrid: true },
    { constId: 54, rmsConstant: "DLC_MANGROVESHALLOW", category: "terrain", isWater: false, isHybrid: true },
    { constId: 22, rmsConstant: "DEEP_WATER", category: "terrain", isWater: true },
  ];

  it("puts hybrid between land and water whichever way its isWater flag reads", () => {
    expect(terrainDepth(depthConstants, 0)).toBe(DEPTH_LAND);
    expect(terrainDepth(depthConstants, 4)).toBe(DEPTH_HYBRID); // hybrid AND water
    expect(terrainDepth(depthConstants, 54)).toBe(DEPTH_HYBRID); // hybrid AND dry
    expect(terrainDepth(depthConstants, 22)).toBe(DEPTH_WATER);
    expect(DEPTH_LAND).toBeLessThan(DEPTH_HYBRID);
    expect(DEPTH_HYBRID).toBeLessThan(DEPTH_WATER);
  });

  it("treats a terrain the table has never covered exactly as isWater alone would", () => {
    // No name heuristic for hybrid, on purpose — YELLOW_SHALLOW is a shallow
    // and YELLOW_SHALLOW_WATER is open water, so no pattern separates them.
    expect(terrainDepth(constants, 1)).toBe(DEPTH_WATER); // /WATER/ name, unflagged
    expect(terrainDepth(constants, 9999)).toBe(DEPTH_LAND); // unknown id
    expect(terrainDepth(constants, undefined)).toBe(DEPTH_LAND);
  });

  it("classifies a whole grid, and reports the heuristic only for the water half", () => {
    const grid = createTileGrid(2, 0);
    grid.terrain[tileIndex(grid, 1, 0)] = 4;
    grid.terrain[tileIndex(grid, 0, 1)] = 22;
    const { depth, usedHeuristic } = waterDepthMask(grid, depthConstants);
    expect([...depth]).toEqual([DEPTH_LAND, DEPTH_HYBRID, DEPTH_WATER, DEPTH_LAND]);
    expect(usedHeuristic).toBe(false); // every terrain here carries a flag
  });

  it("gives a shallow a beach of its own, where isWater alone would have said never", () => {
    // The seven shallows carrying `beachTerrain: null` were the old rule
    // showing through: water grows no beach, and a shallow read as water.
    expect(beachTerrainFor(depthConstants, 4)).toBe(DEFAULT_BEACH_TERRAIN);
    expect(beachTerrainFor(depthConstants, 22)).toBeUndefined(); // open water still grows none
    expect(beachTerrainFor(depthConstants, 0)).toBe(DEFAULT_BEACH_TERRAIN);
  });

  it("asks 'is this sand' separately from 'what sand would this grow'", () => {
    // The nine beach rows satisfy both — a beach does not grow a beach — and
    // reading one off the other would be wrong anyway: open water grows no
    // beach either and is emphatically not sand. The `shore` habitat depends
    // on the difference.
    const sand: TerrainConstantForMasks[] = [
      { constId: 2, rmsConstant: "BEACH", category: "terrain", isWater: false, isBeach: true, beachTerrain: null },
      { constId: 22, rmsConstant: "DEEP_WATER", category: "terrain", isWater: true, isBeach: false, beachTerrain: null },
    ];
    expect(isBeachTerrain(sand, 2)).toBe(true);
    expect(isBeachTerrain(sand, 22)).toBe(false); // grows no beach, still not sand
    expect(beachTerrainFor(sand, 2)).toBeUndefined();
    expect(beachTerrainFor(sand, 22)).toBeUndefined();
    expect(isBeachTerrain(sand, 9999)).toBe(false); // unknown id
    expect(isBeachTerrain(sand, undefined)).toBe(false);
  });

  it("honours an explicit beachTerrain over the fallback, including a null one", () => {
    const explicit: TerrainConstantForMasks[] = [
      { constId: 2, rmsConstant: "BEACH", category: "terrain", isWater: false, beachTerrain: null },
      { constId: 26, rmsConstant: null, category: "terrain", isWater: false, isHybrid: true, beachTerrain: 37 },
    ];
    expect(beachTerrainFor(explicit, 2)).toBeUndefined(); // a beach does not grow a beach
    expect(beachTerrainFor(explicit, 26)).toBe(37); // navigable ice grows ICYSHORE
  });
});

describe("distanceTransformFromMask (distanceTransform's sibling for arbitrary masks, S3/S4's shared need)", () => {
  it("returns UNREACHABLE everywhere for an empty mask", () => {
    const dist = distanceTransformFromMask(10, new Uint8Array(100));
    expect(dist.every((v) => v === UNREACHABLE)).toBe(true);
  });

  it("matches distanceTransform's own 4-connected step distance, built from an equivalent hand-made mask", () => {
    const grid = createTileGrid(5, GRASS.constId!);
    grid.terrain[tileIndex(grid, 2, 2)] = WATER.constId!;
    const viaTerrainId = distanceTransform(grid, WATER.constId!);
    const mask = new Uint8Array(25);
    mask[tileIndex(grid, 2, 2)] = 1;
    const viaMask = distanceTransformFromMask(5, mask);
    expect([...viaMask]).toEqual([...viaTerrainId]);
  });
});

describe("computeSlopeMask (Sec.6.3's cliff rule, Sec.6.4's set_flat_terrain_only)", () => {
  it("marks nothing sloped on a flat grid", () => {
    const grid = createTileGrid(4, GRASS.constId!);
    expect(computeSlopeMask(grid).some((v) => v !== 0)).toBe(false);
  });

  it("marks a raised tile and its 4-neighbours sloped, and leaves tiles further away flat", () => {
    const grid = createTileGrid(6, GRASS.constId!);
    const center = tileIndex(grid, 3, 3);
    grid.elevation[center] = 5;
    const mask = computeSlopeMask(grid);
    expect(mask[center]).toBe(1);
    expect(mask[tileIndex(grid, 3, 2)]).toBe(1);
    expect(mask[tileIndex(grid, 4, 3)]).toBe(1);
    expect(mask[tileIndex(grid, 0, 0)]).toBe(0);
    // Diagonal neighbour is untouched: this is a 4-connected check, not Moore.
    expect(mask[tileIndex(grid, 4, 4)]).toBe(0);
  });
});
