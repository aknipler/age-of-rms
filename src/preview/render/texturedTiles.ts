import { NO_LAYER } from "../generator/grid";
import type { StageSnapshot } from "../generator/types";
import type { TerrainPalette } from "./palette";

// What the textured view draws on each tile, as bytes a shader can fetch.
// Pure, like terrainBitmap.ts beside it, and it follows the same rules so the
// two views agree on what a tile is (docs/preview-de-textures-design.md
// Sec.6). The one difference is a layer, which the flat view can only tint
// and this view draws over the terrain through the layer's mask, as the game
// does (Sec.10).

/** Every texture layer is decoded to this many texels a side (Sec.5 item 5). */
export const TEXTURE_SIZE = 1024;

/** Every mask and blend atlas in the install is 512 a side. Others are scaled to it. */
export const MASK_SIZE = 512;

export const FLAG_FOREST = 1;
export const FLAG_CLIFF = 2;

/** No texture layer for this terrain, draw its fallback colour. */
export const NO_TEXTURE = 255;

/** No mask loaded for this terrain. A layer of it then covers its tile in full. */
export const NO_MASK = 255;

/**
 * How many tiles one copy of a texture covers, the same for every terrain
 * (Sec.10.7). Measured against DE for beach, road, pasture, farm, both farm
 * construction stages and the wet gravel and rock beaches. Every one lines
 * up pixel for pixel at 10 and at no other repeat tried, including the
 * pasture and farms, which the dat's `terrain_dimensions` gives 6, and the
 * wet beaches, which it gives 15. So that field is not the repeat.
 */
export const TEXTURE_REPEAT_TILES = 10;

/**
 * The mask a layer of a terrain whose dat row names none is drawn through.
 * DE draws such a layer at about two thirds cover, which this flat grey
 * gives through `MASK_COVER_EXPONENT` (Sec.10.7).
 */
export const DEFAULT_LAYER_MASK = "neutral.png";

/**
 * A mask's value becomes cover through `value ^ MASK_COVER_EXPONENT`. The
 * install's flat masks name their cover. `neutral_33.png` holds 63,
 * `neutral_42.png` 85, `neutral_50.png` 105 and `neutral_66.png` 149, and
 * this exponent turns each value into its name within 0.01 (Sec.10.7).
 */
export const MASK_COVER_EXPONENT = 0.78;

/**
 * DE's picture against its textures, per channel: DE's colour is the
 * renderer's times `gain` plus `offset` (0 to 255), with the game's Map
 * lighting on, as the default graphics settings have it. First fitted with
 * lighting off on two painted scenes (gain 1.04, 1.014, 1.08, offset 11.5,
 * 10.0, 7.0, Sec.10.7); refitted 2026-11-25 on the coast and edges scenes
 * captured with lighting on, which came out slightly darker and less blue
 * (Sec.14.6). The game's own colour correction file has brightness 0.95 and a
 * bloom, so this is measured rather than read from the file.
 */
export const DE_COLOUR_GRADE = {
  gain: [0.992, 1.001, 0.983],
  offset: [8.8, 2.3, 11.2],
} as const;

/**
 * The tile byte for "no layer". 255 is free, since a layer is a terrain id
 * and DE's end at 199. Not NO_LAYER itself, which does not fit a byte.
 */
export const NO_LAYER_BYTE = 255;

/**
 * Terrain ids the tile bytes can carry. One byte, since DE's terrain ids end
 * at 199. A larger id draws as the fallback of id 255 (CREATION_PLAN A.7
 * records that the game itself only keeps an id's low byte).
 */
const MAX_TERRAIN_ID = 255;

/**
 * Four bytes a tile, row major in tile space, the same layout as the flat
 * bitmap. Byte 0 is the terrain, byte 1 the elevation, byte 2 the flags,
 * byte 3 the layer (`NO_LAYER_BYTE` for none).
 */
export function buildTileBytes(
  snapshot: StageSnapshot,
  palette: Pick<TerrainPalette, "isForest">,
): Uint8Array {
  const { dim, terrain, layer, elevation, cliff } = snapshot;
  const bytes = new Uint8Array(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const index = y * dim + x;
      const owner = terrain[index];
      const layerId = layer[index];
      const p = index * 4;
      bytes[p] = Math.min(owner, MAX_TERRAIN_ID);
      bytes[p + 1] = Math.min(elevation[index], 255);
      // The canopy follows the owning terrain, as in terrainBitmap.ts.
      bytes[p + 2] =
        (palette.isForest(owner) ? FLAG_FOREST : 0) |
        (cliff[index] !== 0 ? FLAG_CLIFF : 0);
      // A layer equal to its own terrain draws nothing the terrain does not.
      bytes[p + 3] =
        layerId === NO_LAYER || layerId === owner
          ? NO_LAYER_BYTE
          : Math.min(layerId, MAX_TERRAIN_ID - 1);
    }
  }
  return bytes;
}

// --- Hill light (Sec.10) ----------------------------------------------------
//
// The flat view shades a whole tile by one factor, lit from the upper left
// and brighter with height. The game does neither. Its ground is one smooth
// surface lit from the screen's right, and a plateau top is as bright as the
// plain around it. A slope facing away from the light is darker, and one
// facing it no brighter than flat ground.
//
// A first fit (2026-11-24) took one slope's brightness from a screenshot,
// half of flat ground, and lit each tile's face on its own. Against a
// lossless capture of a scene with hills up to level 4 that drew hard facets
// and stair steps DE does not have, and slopes too dark. Light blended from
// the tile corners with the sun 50 degrees up matched DE best (Sec.10.5).

/**
 * How high one elevation level stands, in tiles. The dat raises a level by
 * `elev_height` 24 pixels on its 96 by 48 tile. A 2 to 1 tile is the ground
 * seen from 30 degrees above it, where a tile's side spans 96 / sqrt 2
 * pixels across and a height spans cos 30 times that up the screen, so
 * 24 pixels is 24 / (67.9 * 0.866) tiles.
 */
export const LEVEL_HEIGHT = 0.408;

/** The corner rule the app draws with (`CornerRule`). */
export const CORNER_RULE: CornerRule = "max";

/**
 * Whether the app blends the hill light from tile corners
 * (`buildCornerLight`). On, slopes shade smoothly over neighbouring tiles as
 * DE's do. Off, each tile face is lit on its own, which showed as facets.
 */
export const CORNER_LIGHT = true;

/**
 * The direction toward the sun in tile space, z up, unit length. Its level
 * part points to the screen's right, (+x, +y). 50 degrees above the horizon,
 * from a sweep against DE's own picture of a hill scene, where 45 and 55
 * scored the same and 35 and 65 clearly worse (Sec.10.5).
 */
export const SUN = { x: 0.4545, y: 0.4545, z: 0.766 } as const;

/** A direction toward the sun, as `SUN`. Comparisons try others. */
export interface Sun {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How bright ground is, relative to flat ground, where its height rises by
 * `dx` levels a tile along x and `dy` along y. The shader computes the same.
 */
export function slopeLight(dx: number, dy: number, sun: Sun = SUN): number {
  const gx = dx * LEVEL_HEIGHT;
  const gy = dy * LEVEL_HEIGHT;
  // The surface normal is (-gx, -gy, 1) before it is made unit length.
  const lit = (sun.z - gx * sun.x - gy * sun.y) / Math.hypot(gx, gy, 1);
  return Math.max(0, Math.min(1, lit / sun.z));
}

/**
 * How a tile corner's height comes from the up to four tiles around it.
 * `max` raises it to the highest, so a slope rises within the one lower tile
 * beside a step. `mean` takes their average, so a one level step spreads
 * over the two tiles either side of it and a diagonal edge comes out smooth.
 */
export type CornerRule = "max" | "mean";

/**
 * The ground's height at each tile corner, `(dim + 1)` a side, row major, in
 * levels. Fractional under `mean`, hence a Float32Array.
 */
export function buildCornerHeights(
  snapshot: StageSnapshot,
  rule: CornerRule = CORNER_RULE,
): Float32Array {
  const { dim, elevation } = snapshot;
  const side = dim + 1;
  const corners = new Float32Array(side * side);
  for (let cy = 0; cy <= dim; cy++) {
    for (let cx = 0; cx <= dim; cx++) {
      let high = 0;
      let sum = 0;
      let count = 0;
      for (let ty = cy - 1; ty <= cy; ty++) {
        if (ty < 0 || ty >= dim) continue;
        for (let tx = cx - 1; tx <= cx; tx++) {
          if (tx < 0 || tx >= dim) continue;
          const h = elevation[ty * dim + tx];
          high = Math.max(high, h);
          sum += h;
          count++;
        }
      }
      corners[cy * side + cx] =
        rule === "max" || count === 0 ? high : sum / count;
    }
  }
  return corners;
}

/**
 * The hill light at each tile corner, from the slope of the ground around
 * that corner (the difference of the corners either side of it, over two
 * tiles, or over one at the map's edge). The shader blends it across each
 * tile, as a smooth shaded mesh does, so light changes gradually over a
 * slope rather than in one step per tile face.
 */
export function buildCornerLight(
  corners: Float32Array,
  dim: number,
  sun: Sun = SUN,
): Float32Array {
  const side = dim + 1;
  const light = new Float32Array(side * side);
  const at = (x: number, y: number) => corners[y * side + x];
  for (let cy = 0; cy <= dim; cy++) {
    for (let cx = 0; cx <= dim; cx++) {
      const x0 = Math.max(cx - 1, 0);
      const x1 = Math.min(cx + 1, dim);
      const y0 = Math.max(cy - 1, 0);
      const y1 = Math.min(cy + 1, dim);
      const dx = x1 > x0 ? (at(x1, cy) - at(x0, cy)) / (x1 - x0) : 0;
      const dy = y1 > y0 ? (at(cx, y1) - at(cx, y0)) / (y1 - y0) : 0;
      light[cy * side + cx] = slopeLight(dx, dy, sun);
    }
  }
  return light;
}

/** The slice of a terrain row the textured view reads. */
export interface TexturedTerrainRow {
  constId: number | null;
  category: string;
  deTextureFile?: string | null;
  blendPriority?: number;
  blendType?: number;
  overlayMask?: string;
}

/** Per terrain id, where its texture and mask are and how they repeat. */
export interface TerrainTable {
  /** Texture names in layer order, each once. */
  layers: string[];
  /** Mask file names in mask layer order, each once. */
  masks: string[];
  /**
   * 256 by 2 RGBA texels. Row 0 is the fallback colour with the texture
   * layer in alpha (`NO_TEXTURE` for none). Row 1 holds the repeat in tiles
   * in red and the mask layer in green (`NO_MASK` for none).
   */
  lut: Uint8Array;
}

/** The mask file a terrain's layer is drawn through, lower case. */
export function layerMaskOf(row: TexturedTerrainRow | undefined): string {
  return (row?.overlayMask ?? DEFAULT_LAYER_MASK).toLowerCase();
}

/** Terrain rows by id, the lookup every function below starts from. */
export function terrainRowsById(
  rows: readonly TexturedTerrainRow[],
): Map<number, TexturedTerrainRow> {
  const byId = new Map<number, TexturedTerrainRow>();
  for (const row of rows) {
    if (row.category === "terrain" && row.constId !== null)
      byId.set(row.constId, row);
  }
  return byId;
}

/**
 * Builds the terrain table for the terrains on one grid. `available` says
 * which texture names decoded and `maskAvailable` which mask names did, so a
 * missing texture falls back to the palette colour and a missing mask to
 * full cover, rather than to an empty layer.
 */
export function buildTerrainTable(
  terrainsInUse: Iterable<number>,
  rows: readonly TexturedTerrainRow[],
  palette: Pick<TerrainPalette, "colorFor">,
  available: (textureName: string) => boolean,
  maskAvailable: (maskName: string) => boolean = () => false,
): TerrainTable {
  const byId = terrainRowsById(rows);
  const lut = new Uint8Array(256 * 2 * 4);
  for (let id = 0; id <= MAX_TERRAIN_ID; id++) {
    const colour = palette.colorFor(id);
    lut[id * 4] = colour.r;
    lut[id * 4 + 1] = colour.g;
    lut[id * 4 + 2] = colour.b;
    lut[id * 4 + 3] = NO_TEXTURE;
    // Row 1's red was the per terrain repeat. Every terrain measured repeats
    // the same, and the slot stays so a later measurement can differ.
    lut[(256 + id) * 4] = TEXTURE_REPEAT_TILES;
    lut[(256 + id) * 4 + 1] = NO_MASK;
  }
  // NO_TEXTURE and NO_MASK are byte values themselves, so at most 255 of
  // each. A real map uses a few dozen terrains at most.
  const layers = new NameSlots(NO_TEXTURE);
  const masks = new NameSlots(NO_MASK);
  for (const id of new Set(terrainsInUse)) {
    if (id > MAX_TERRAIN_ID) continue;
    const row = byId.get(id);
    const name = row?.deTextureFile?.toLowerCase();
    if (name && available(name)) {
      const layer = layers.slotFor(name);
      if (layer !== undefined) lut[id * 4 + 3] = layer;
    }
    const mask = layerMaskOf(row);
    if (maskAvailable(mask)) {
      const slot = masks.slotFor(mask);
      if (slot !== undefined) lut[(256 + id) * 4 + 1] = slot;
    }
  }
  return { layers: layers.names, masks: masks.names, lut };
}

/** Hands out one array slot per distinct name, up to a limit. */
class NameSlots {
  readonly names: string[] = [];
  private readonly slots = new Map<string, number>();
  constructor(private readonly limit: number) {}
  slotFor(name: string): number | undefined {
    let slot = this.slots.get(name);
    if (slot === undefined) {
      if (this.names.length >= this.limit) return undefined;
      slot = this.names.length;
      this.names.push(name);
      this.slots.set(name, slot);
    }
    return slot;
  }
}

/**
 * Every terrain id a tile draws, its terrain and its layer, the terrains the
 * table needs textures for. A tile's blends draw only its neighbours'
 * terrains, which are on the grid too, so the grid's terrains are all of them.
 */
export function visualTerrainsIn(tileBytes: Uint8Array): Set<number> {
  const ids = new Set<number>();
  for (let p = 0; p < tileBytes.length; p += 4) {
    ids.add(tileBytes[p]);
    if (tileBytes[p + 3] !== NO_LAYER_BYTE) ids.add(tileBytes[p + 3]);
  }
  return ids;
}

/**
 * The mask file names the given terrains' layers use, lower case, the
 * default mask included for a terrain that names none.
 */
export function maskNamesFor(
  terrainIds: Iterable<number>,
  rows: readonly TexturedTerrainRow[],
): string[] {
  const byId = terrainRowsById(rows);
  const names = new Set<string>();
  for (const id of terrainIds) names.add(layerMaskOf(byId.get(id)));
  return [...names].sort();
}
