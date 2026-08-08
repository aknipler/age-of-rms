import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import type { StageSnapshot } from "../generator/types";
import { buildTerrainBitmap } from "../render/terrainBitmap";
import { CLIFF_COLOR, createTerrainPalette, type TerrainConstant } from "../render/palette";
import { NO_LAYER } from "../generator/grid";

const palette = createTerrainPalette(
  (gameConstantsRaw as unknown as { constants: TerrainConstant[] }).constants,
);

const GRASS = 0;
const WATER = 1;

function snapshot(dim: number, fill: Partial<Omit<StageSnapshot, "stage" | "dim">> = {}): StageSnapshot {
  return {
    stage: "S6",
    dim,
    terrain: fill.terrain ?? new Uint16Array(dim * dim).fill(GRASS),
    // NO_LAYER, not zero: zero is GRASS, and a zero-filled layer would tint
    // every tile in this fixture with it.
    layer: fill.layer ?? new Uint16Array(dim * dim).fill(NO_LAYER),
    elevation: fill.elevation ?? new Uint8Array(dim * dim),
    cliff: fill.cliff ?? new Uint8Array(dim * dim),
  };
}

function pixelAt(pixels: Uint8ClampedArray, dim: number, x: number, y: number) {
  const p = (y * dim + x) * 4;
  return { r: pixels[p], g: pixels[p + 1], b: pixels[p + 2], a: pixels[p + 3] };
}

describe("buildTerrainBitmap", () => {
  it("emits one opaque RGBA pixel per tile", () => {
    for (const dim of [1, 8, 120, 252]) {
      const bitmap = buildTerrainBitmap(snapshot(dim), palette);
      expect(bitmap.dim).toBe(dim);
      expect(bitmap.pixels.length).toBe(dim * dim * 4);
      for (let i = 3; i < bitmap.pixels.length; i += 4) {
        expect(bitmap.pixels[i]).toBe(255);
      }
    }
  });

  it("colours each tile by its own terrain", () => {
    const dim = 4;
    const terrain = new Uint16Array(dim * dim).fill(GRASS);
    terrain[2 * dim + 1] = WATER;
    const { pixels } = buildTerrainBitmap(snapshot(dim, { terrain }), palette);
    expect(pixelAt(pixels, dim, 1, 2)).toMatchObject(palette.colorFor(WATER));
    expect(pixelAt(pixels, dim, 0, 0)).toMatchObject(palette.colorFor(GRASS));
  });

  it("shades a slope against its neighbour toward the light", () => {
    // Light comes from the screen's upper left, which is -y in tile space,
    // so a tile higher than the tile at (x, y-1) catches a highlight and the
    // reverse is in shadow. Row 0 has no neighbour and must read as flat.
    const dim = 3;
    const elevation = new Uint8Array(dim * dim);
    elevation[1 * dim + 1] = 4; // (1,1) rises above (1,0)
    const { pixels } = buildTerrainBitmap(snapshot(dim, { elevation }), palette);
    const lit = pixelAt(pixels, dim, 1, 1);
    const shadow = pixelAt(pixels, dim, 1, 2); // (1,2) sits below (1,1)
    const flat = pixelAt(pixels, dim, 0, 0);
    expect(lit.r).toBeGreaterThan(flat.r);
    expect(shadow.r).toBeLessThan(flat.r);
  });

  it("does not invent a slope at the y = 0 edge", () => {
    const dim = 3;
    const elevation = new Uint8Array(dim * dim);
    elevation[0] = 5; // (0,0), which has no neighbour toward the light
    const { pixels } = buildTerrainBitmap(snapshot(dim, { elevation }), palette);
    const raised = pixelAt(pixels, dim, 0, 0);
    const flat = pixelAt(pixels, dim, 2, 0);
    // Brighter from height alone, but not by the slope term as well.
    expect(raised.r).toBeGreaterThan(flat.r);
    expect(raised.r - flat.r).toBeLessThan(30);
  });

  it("draws cliffs toward the cliff colour", () => {
    const dim = 3;
    const cliff = new Uint8Array(dim * dim);
    cliff[4] = 1;
    const { pixels } = buildTerrainBitmap(snapshot(dim, { cliff }), palette);
    const cliffPixel = pixelAt(pixels, dim, 1, 1);
    const plain = pixelAt(pixels, dim, 0, 0);
    const distanceToCliff = Math.abs(cliffPixel.r - CLIFF_COLOR.r) + Math.abs(cliffPixel.g - CLIFF_COLOR.g);
    const plainDistance = Math.abs(plain.r - CLIFF_COLOR.r) + Math.abs(plain.g - CLIFF_COLOR.g);
    expect(distanceToCliff).toBeLessThan(plainDistance);
  });

  it("tints a tile carrying a visual layer", () => {
    const dim = 2;
    const layer = new Uint16Array(dim * dim);
    layer[3] = WATER;
    const { pixels } = buildTerrainBitmap(snapshot(dim, { layer }), palette);
    expect(pixelAt(pixels, dim, 1, 1)).not.toMatchObject(pixelAt(pixels, dim, 0, 0));
  });
});
