// The textured view's tile bytes and terrain table
// (docs/preview-de-textures-design.md Sec.6), against the flat view's own
// rules in terrainBitmap.ts, which the two views must agree on.

import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import { NO_LAYER } from "../generator/grid";
import type { StageSnapshot } from "../generator/types";
import { createTerrainPalette, type TerrainConstant } from "../render/palette";
import {
  DEFAULT_LAYER_MASK,
  FLAG_CLIFF,
  FLAG_FOREST,
  NO_LAYER_BYTE,
  NO_MASK,
  MASK_COVER_EXPONENT,
  NO_TEXTURE,
  TEXTURE_REPEAT_TILES,
  buildCornerHeights,
  buildCornerLight,
  buildTerrainTable,
  buildTileBytes,
  maskNamesFor,
  slopeLight,
  visualTerrainsIn,
  type TexturedTerrainRow,
} from "../render/texturedTiles";
import {
  ATLAS_CELL_OF_TILE,
  BLEND_ATLAS_FILES,
  NEIGHBOURS,
  NO_BLEND,
  SIDE_BOTTOM,
  SIDE_RIGHT,
  buildBlendBytes,
  sideVariant,
  type BlendBytes,
} from "../render/terrainBlends";

const rows = (gameConstantsRaw as unknown as { constants: TerrainConstant[] })
  .constants;
const palette = createTerrainPalette(rows);

const GRASS = 0;
const DIRT = 6;
const FOREST = 10;

function snapshot(
  dim: number,
  fill: Partial<StageSnapshot> = {},
): StageSnapshot {
  return {
    stage: "S6",
    dim,
    terrain: fill.terrain ?? new Uint16Array(dim * dim).fill(GRASS),
    layer: fill.layer ?? new Uint16Array(dim * dim).fill(NO_LAYER),
    elevation: fill.elevation ?? new Uint8Array(dim * dim),
    cliff: fill.cliff ?? new Uint8Array(dim * dim),
  };
}

describe("buildTileBytes", () => {
  it("carries the terrain and, apart, the layer drawn over it", () => {
    const layer = new Uint16Array(4).fill(NO_LAYER);
    layer[1] = DIRT;
    layer[2] = GRASS;
    const bytes = buildTileBytes(snapshot(2, { layer }), palette);
    expect([bytes[0], bytes[3]]).toEqual([GRASS, NO_LAYER_BYTE]);
    expect([bytes[4], bytes[7]]).toEqual([GRASS, DIRT]);
    // A layer of the tile's own terrain draws nothing more.
    expect(bytes[11]).toBe(NO_LAYER_BYTE);
  });

  it("flags forest by the owning terrain, not the layer", () => {
    // A FOREST tile under a DIRT layer keeps its trees, as in the flat view.
    const terrain = new Uint16Array(4).fill(GRASS);
    terrain[0] = FOREST;
    const layer = new Uint16Array(4).fill(NO_LAYER);
    layer[0] = DIRT;
    const cliff = new Uint8Array(4);
    cliff[3] = 1;
    const bytes = buildTileBytes(
      snapshot(2, { terrain, layer, cliff }),
      palette,
    );
    expect(bytes[0]).toBe(FOREST);
    expect(bytes[3]).toBe(DIRT);
    expect(bytes[2]).toBe(FLAG_FOREST);
    expect(bytes[6]).toBe(0);
    expect(bytes[14]).toBe(FLAG_CLIFF);
  });

  it("carries each tile's elevation", () => {
    const elevation = new Uint8Array([0, 0, 0, 4]);
    const bytes = buildTileBytes(snapshot(2, { elevation }), palette);
    expect([bytes[1], bytes[13]]).toEqual([0, 4]);
  });
});

// The hill light of Sec.10.5, fitted against DE's own picture of a hill scene.
describe("hill light", () => {
  it("keeps flat ground and plateau tops at full light", () => {
    expect(slopeLight(0, 0)).toBe(1);
  });

  it("darkens a slope facing away from the light, steeper darker", () => {
    // Rising toward +x faces -x, away from the sun at the screen's right.
    expect(slopeLight(1, 0)).toBeLessThan(1);
    expect(slopeLight(0, 1)).toBeCloseTo(slopeLight(1, 0), 6);
    expect(slopeLight(2, 0)).toBeLessThan(slopeLight(1, 0));
  });

  it("never lights a slope facing the light above flat ground", () => {
    // Measured 165 of 171, within the sand texture's own spread.
    expect(slopeLight(-1, 0)).toBe(1);
    expect(slopeLight(-1, -1)).toBe(1);
  });

  it("raises each corner to the highest tile around it", () => {
    // One tile raised to 2 in the middle of a 3 by 3, so all four of its
    // corners stand at 2 and the slopes fall on its neighbours.
    const elevation = new Uint8Array(9);
    elevation[4] = 2;
    const corners = buildCornerHeights(snapshot(3, { elevation }));
    const at = (x: number, y: number) => corners[y * 4 + x];
    expect([at(1, 1), at(2, 1), at(1, 2), at(2, 2)]).toEqual([2, 2, 2, 2]);
    expect([at(0, 0), at(3, 3), at(0, 2)]).toEqual([0, 0, 0]);
  });

  it("averages the tiles around a corner under the mean rule", () => {
    const elevation = new Uint8Array(9);
    elevation[4] = 2;
    const corners = buildCornerHeights(snapshot(3, { elevation }), "mean");
    const at = (x: number, y: number) => corners[y * 4 + x];
    // An inner corner touches the raised tile and three flat ones.
    expect(at(1, 1)).toBeCloseTo(0.5, 6);
    // A map corner has one tile, a map edge corner two.
    expect(at(0, 0)).toBe(0);
    expect(at(1, 0)).toBe(0);
  });

  it("lights corners by the slope around them, so a slope shades smoothly", () => {
    // A one level step along x, tiles 0 0 1 1, on a 4 by 4 map.
    const elevation = new Uint8Array(16);
    for (let y = 0; y < 4; y++)
      for (let x = 2; x < 4; x++) elevation[y * 4 + x] = 1;
    const corners = buildCornerHeights(snapshot(4, { elevation }));
    const light = buildCornerLight(corners, 4);
    const row = [0, 1, 2, 3, 4].map((x) => light[2 * 5 + x]);
    // Flat ground away from the step stays at full light.
    expect(row[0]).toBe(1);
    expect(row[4]).toBe(1);
    // The step's face rises from corner 1 to corner 2. Both ends of it see
    // half its slope, so the dark part spreads over the tiles either side
    // rather than stopping at the face's edges.
    expect(row[1]).toBeLessThan(1);
    expect(row[2]).toBeLessThan(1);
    expect(row[1]).toBeCloseTo(row[2], 6);
    expect(row[1]).toBeCloseTo(slopeLight(0.5, 0), 6);
  });
});

describe("buildTerrainTable", () => {
  const textured = rows as unknown as TexturedTerrainRow[];

  it("gives each texture one layer, shared by the terrains that use it", () => {
    const forestIds = textured
      .filter((r) => r.category === "terrain" && r.deTextureFile === "g_for")
      .map((r) => r.constId as number)
      .slice(0, 2);
    const table = buildTerrainTable(
      [GRASS, ...forestIds],
      textured,
      palette,
      () => true,
    );
    expect(table.layers).toEqual(["g_grs", "g_for"]);
    expect(table.lut[forestIds[0] * 4 + 3]).toBe(1);
    expect(table.lut[forestIds[1] * 4 + 3]).toBe(1);
  });

  it("falls back to the palette colour for a texture that did not load", () => {
    const table = buildTerrainTable([GRASS], textured, palette, () => false);
    expect(table.layers).toEqual([]);
    expect(table.lut[GRASS * 4 + 3]).toBe(NO_TEXTURE);
    const colour = palette.colorFor(GRASS);
    expect([table.lut[0], table.lut[1], table.lut[2]]).toEqual([
      colour.r,
      colour.g,
      colour.b,
    ]);
  });

  it("gives each mask one layer, and a terrain naming none the default mask", () => {
    // GRASS (0) and GRASS_2 (12) both name grass.png in the dat, DIRT dirt.png,
    // and DESERT (14) none, which DE draws through neutral.png (Sec.10.7).
    const table = buildTerrainTable(
      [GRASS, 12, DIRT, 14],
      textured,
      palette,
      () => true,
      () => true,
    );
    expect(table.masks).toEqual(["grass.png", "dirt.png", DEFAULT_LAYER_MASK]);
    const mask = (id: number) => table.lut[(256 + id) * 4 + 1];
    expect([mask(GRASS), mask(12), mask(DIRT), mask(14)]).toEqual([0, 0, 1, 2]);
    expect(maskNamesFor([GRASS, DIRT, 14], textured)).toEqual([
      "dirt.png",
      "grass.png",
      DEFAULT_LAYER_MASK,
    ]);
  });

  it("leaves a mask that did not load at full cover", () => {
    const table = buildTerrainTable([14], textured, palette, () => true);
    expect(table.masks).toEqual([]);
    expect(table.lut[(256 + 14) * 4 + 1]).toBe(NO_MASK);
  });

  it("repeats every terrain every 10 tiles, whatever the dat's terrain_dimensions says", () => {
    const table = buildTerrainTable([], textured, palette, () => true);
    const repeat = (id: number) => table.lut[(256 + id) * 4];
    // Farm (dat 6), farm construction stage 1 (dat 3) and wet gravel beach
    // (dat 15) all lined up with DE at 10 and no other repeat (Sec.10.7).
    expect([repeat(GRASS), repeat(7), repeat(29), repeat(108)]).toEqual([
      TEXTURE_REPEAT_TILES,
      TEXTURE_REPEAT_TILES,
      TEXTURE_REPEAT_TILES,
      TEXTURE_REPEAT_TILES,
    ]);
    expect(TEXTURE_REPEAT_TILES).toBe(10);
  });

  it("turns each flat mask's value into the cover its file is named for", () => {
    // neutral_33.png holds 63, neutral_42.png 85, neutral_50.png 105 and
    // neutral_66.png 149. The shader raises the value to this exponent.
    for (const [value, named] of [
      [63, 0.33],
      [85, 0.42],
      [105, 0.5],
      [149, 0.66],
    ]) {
      expect((value / 255) ** MASK_COVER_EXPONENT).toBeCloseTo(named, 1);
    }
  });
});

describe("visualTerrainsIn", () => {
  it("lists each drawn terrain once, layers included", () => {
    const layer = new Uint16Array(4).fill(NO_LAYER);
    layer[2] = DIRT;
    const ids = visualTerrainsIn(
      buildTileBytes(snapshot(2, { layer }), palette),
    );
    expect([...ids].sort((a, b) => a - b)).toEqual([GRASS, DIRT]);
  });
});

// The blend rules of docs/preview-de-textures-design.md Sec.10, on small
// grids of real terrains, read back slice by slice.
describe("buildBlendBytes", () => {
  const textured = rows as unknown as TexturedTerrainRow[];
  const WATER = 1; // priority 166, type water
  const BLACK = 47; // priority 198, type land

  function blends(dim: number, terrain: number[], layer?: number[]) {
    const snap = snapshot(dim, {
      terrain: Uint16Array.from(terrain),
      layer: layer ? Uint16Array.from(layer) : undefined,
    });
    return buildBlendBytes(buildTileBytes(snap, palette), dim, textured);
  }
  /** Slice k of tile (x, y), as [terrain, layer, neighbour bits, mode, variant]. */
  function at(b: BlendBytes, dim: number, x: number, y: number, k = 0) {
    const p = k * dim * dim * 4 + (y * dim + x) * 4;
    return [
      b.bytes[p],
      b.bytes[p + 1],
      b.bytes[p + 2],
      b.bytes[p + 3] & 15,
      b.bytes[p + 3] >> 4,
    ];
  }
  const bitAt = (dx: number, dy: number) =>
    NEIGHBOURS.find((n) => n.dx === dx && n.dy === dy)!.bit;

  it("spreads the higher priority terrain only, through a side or a corner", () => {
    // BLACK in the middle of a 3 by 3 of GRASS.
    const g = GRASS;
    const b = blends(3, [g, g, g, g, BLACK, g, g, g, g]);
    expect(b.depth).toBe(1);
    // The middle has nothing over it.
    expect(at(b, 3, 1, 1)[0]).toBe(NO_BLEND);
    // Above the middle, BLACK is on its bottom side, land over land.
    const landland = BLEND_ATLAS_FILES.indexOf("landland");
    expect(at(b, 3, 1, 0)).toEqual([
      BLACK,
      NO_LAYER_BYTE,
      SIDE_BOTTOM,
      landland,
      sideVariant(1, 0),
    ]);
    // The top left corner tile sees BLACK at (+1, +1).
    expect(at(b, 3, 0, 0).slice(0, 3)).toEqual([
      BLACK,
      NO_LAYER_BYTE,
      bitAt(1, 1),
    ]);
  });

  it("draws every neighbour holding the terrain, sides and corners alike", () => {
    // GRASS in the middle, BLACK all around it. The game shows a faint
    // smudge of grass there, which eight stacked tiles give (Sec.10).
    const B = BLACK;
    const b = blends(3, [B, B, B, B, GRASS, B, B, B, B]);
    expect(at(b, 3, 1, 1).slice(0, 4)).toEqual([
      BLACK,
      NO_LAYER_BYTE,
      255,
      BLEND_ATLAS_FILES.indexOf("landland"),
    ]);
  });

  it("picks the atlas from both blend types", () => {
    // WATER over GRASS is watershore, BLACK over GRASS landland, and
    // neither spreads over BLACK.
    const b = blends(2, [GRASS, WATER, BLACK, GRASS]);
    expect(at(b, 2, 0, 0).slice(0, 4)).toEqual([
      WATER,
      NO_LAYER_BYTE,
      SIDE_RIGHT,
      BLEND_ATLAS_FILES.indexOf("watershore"),
    ]);
    expect(at(b, 2, 0, 0, 1)[3]).toBe(BLEND_ATLAS_FILES.indexOf("landland"));
    expect(at(b, 2, 0, 1)[0]).toBe(NO_BLEND);
    expect(b.depth).toBe(2);
  });

  it("orders a tile's upper terrains lowest priority first", () => {
    const b = blends(2, [GRASS, BLACK, WATER, GRASS]);
    // (0, 0) has WATER (166) below and BLACK (198) to its right.
    expect(at(b, 2, 0, 0)[0]).toBe(WATER);
    expect(at(b, 2, 0, 0, 1)[0]).toBe(BLACK);
  });

  it("ranks a layered tile by its layer and blends it as the layer's type", () => {
    // GRASS layered with WATER beside plain GRASS spreads as water would.
    const n = NO_LAYER;
    const b = blends(2, [GRASS, GRASS, GRASS, GRASS], [n, WATER, n, n]);
    expect(at(b, 2, 0, 0).slice(0, 4)).toEqual([
      GRASS,
      WATER,
      SIDE_RIGHT,
      BLEND_ATLAS_FILES.indexOf("watershore"),
    ]);
  });

  it("cycles a side through its four drawings by position", () => {
    expect([0, 1, 2, 3, 4].map((x) => sideVariant(x, 0))).toEqual([
      0, 1, 2, 3, 0,
    ]);
    // The side tiles start each drawing run, the corners follow them.
    expect(NEIGHBOURS.map((n) => n.tile)).toEqual([
      12, 0, 8, 4, 16, 17, 18, 19,
    ]);
  });

  it("places all 31 tiles on distinct atlas cells", () => {
    expect(new Set(ATLAS_CELL_OF_TILE).size).toBe(31);
    expect(Math.max(...ATLAS_CELL_OF_TILE)).toBeLessThan(64);
  });
});
