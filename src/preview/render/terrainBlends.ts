import {
  NO_LAYER_BYTE,
  terrainRowsById,
  type TexturedTerrainRow,
} from "./texturedTiles";

// Which neighbours blend into each tile of the textured view, and through
// which blend tile (docs/preview-de-textures-design.md Sec.10). Pure, so the
// rules are tested in Node, and worked out once per map rather than per
// screen pixel. The shader then only draws what these bytes say.
//
// The game's rule, in short. A terrain spreads over a neighbouring tile when
// its blend priority is higher. How far it spreads, and with what edge, is a
// greyscale "blend tile" from one of the install's nine blend atlases, chosen
// by the two terrains' blend types. Each neighbour draws its own tile, a side
// tile or a corner tile, and they stack. The atlases also hold tiles for two,
// three and four sides at once, which the game does not use. A sand tile with
// black on all four sides shows a faint smudge of sand in the game, which four
// stacked side tiles reproduce and the four sided tile, clear in its middle,
// does not (Sec.10).

/** The install's blend atlases (`terrain/blends/*.png`), by blend mode. */
export const BLEND_ATLAS_FILES = [
  "waterwater",
  "watershore",
  "landland",
  "farmland",
  "snowland",
  "icewater",
  "roadland",
  "shallowswater",
  "reserved",
] as const;

/**
 * The blend mode for a pair of blend types, `[lower][upper]`. Types are
 * 0 land, 1 farm, 2 beach, 3 water, 4 shallows, 5 road, 6 ice, 7 snow, and a
 * mode indexes `BLEND_ATLAS_FILES`. Land under water is watershore (1), water
 * under shallows is shallowswater (7), anything under road is roadland (6).
 */
export const BLEND_MODES: readonly (readonly number[])[] = [
  [2, 3, 2, 1, 1, 6, 5, 4],
  [3, 3, 3, 1, 1, 6, 5, 4],
  [2, 3, 2, 1, 1, 6, 1, 4],
  [1, 1, 1, 0, 7, 6, 5, 4],
  [1, 1, 1, 7, 7, 6, 5, 4],
  [6, 6, 6, 6, 6, 6, 5, 4],
  [5, 5, 1, 5, 5, 5, 5, 4],
  [4, 3, 4, 4, 4, 4, 4, 4],
];

/**
 * Where each of the 31 blend tiles sits in an atlas, as `row * 8 + column` of
 * its 8 by 8 grid of 64 pixel cells. Measured from the atlases themselves
 * (Sec.10): each tile's sides are white where the upper terrain covers and
 * black where the lower shows. Tiles 0 to 19 are the ones drawn. 20 to 30,
 * the several sided tiles, are listed so the table describes the whole atlas.
 */
export const ATLAS_CELL_OF_TILE = [
  1, 2, 3, 6, 8, 16, 24, 48, 31, 39, 47, 55, 59, 60, 61, 62, 0, 7, 56, 63, 12,
  33, 36, 37, 44, 45, 20, 22, 50, 34, 18,
];

// Each neighbour as a bit, in the order the shader reads them. The four sides
// first, by where the upper terrain is relative to the tile (tile y grows
// downward in the atlas, so "top" is the y - 1 neighbour), then the corners.
export const SIDE_TOP = 1;
export const SIDE_BOTTOM = 2;
export const SIDE_LEFT = 4;
export const SIDE_RIGHT = 8;

/**
 * Each neighbour, its bit, and its blend tile. A side's tile is the first of
 * four drawings of that side, picked by `sideVariant`.
 */
export const NEIGHBOURS = [
  { dx: 0, dy: -1, bit: SIDE_TOP, tile: 12 },
  { dx: 0, dy: 1, bit: SIDE_BOTTOM, tile: 0 },
  { dx: -1, dy: 0, bit: SIDE_LEFT, tile: 8 },
  { dx: 1, dy: 0, bit: SIDE_RIGHT, tile: 4 },
  { dx: 1, dy: 1, bit: 16, tile: 16 },
  { dx: -1, dy: 1, bit: 32, tile: 17 },
  { dx: 1, dy: -1, bit: 64, tile: 18 },
  { dx: -1, dy: -1, bit: 128, tile: 19 },
] as const;

/**
 * Which of a side's four drawings tile (x, y) uses. A straight edge would
 * repeat one picture along a coastline, so they cycle by position.
 */
export function sideVariant(x: number, y: number): number {
  return (x + y) & 3;
}

/** No upper terrain in this slot. Later slots of the tile are empty too. */
export const NO_BLEND = 255;

/** Blend data for a map, as the renderer uploads it. */
export interface BlendBytes {
  /**
   * `depth` slices of `dim * dim * 4` bytes, slice k holding each tile's
   * k-th upper terrain, lowest priority first. Per tile and slice, byte 0 is
   * the upper terrain (`NO_BLEND` ends the list), byte 1 its layer, byte 2
   * the neighbour bits where it lies (`NEIGHBOURS`), byte 3 the blend mode in
   * the low four bits and the side variant in the high four.
   */
  bytes: Uint8Array;
  /** Slices, the most upper terrains any one tile has, at least 1. */
  depth: number;
}

interface BlendInfo {
  priority: number;
  type: number;
}

/**
 * Builds the blend data for a map from its tile bytes (texturedTiles.ts).
 * A tile and a neighbour compare as pairs of terrain and layer. A layered
 * tile ranks by its layer's priority first and its terrain's second, and
 * blends as its layer's type.
 */
export function buildBlendBytes(
  tileBytes: Uint8Array,
  dim: number,
  rows: readonly TexturedTerrainRow[],
): BlendBytes {
  const byId = terrainRowsById(rows);
  const info = new Map<number, BlendInfo>();
  for (const [id, row] of byId) {
    if (row.blendPriority !== undefined && row.blendType !== undefined)
      info.set(id, { priority: row.blendPriority, type: row.blendType });
  }

  /** A pair's rank, or undefined when its terrains have no blend data. */
  const keyOf = (terrain: number, layer: number): number | undefined => {
    const base = info.get(terrain);
    if (base === undefined) return undefined;
    if (layer === NO_LAYER_BYTE) return base.priority * 1000;
    const over = info.get(layer);
    return over === undefined
      ? base.priority * 1000
      : over.priority * 1000 + base.priority;
  };
  const typeOf = (terrain: number, layer: number): number | undefined =>
    (layer !== NO_LAYER_BYTE ? info.get(layer)?.type : undefined) ??
    info.get(terrain)?.type;

  // Per tile, the upper pairs in order. Collected first so the slice count is
  // known before the output is allocated.
  interface Upper {
    terrain: number;
    layer: number;
    key: number;
    mode: number;
    neighbours: number;
  }
  const perTile: (Upper[] | null)[] = new Array(dim * dim).fill(null);
  let depth = 1;

  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const index = y * dim + x;
      const terrain = tileBytes[index * 4];
      const layer = tileBytes[index * 4 + 3];
      const key = keyOf(terrain, layer);
      const lowerType = typeOf(terrain, layer);
      if (key === undefined || lowerType === undefined) continue;

      const uppers: Upper[] = [];
      const find = (t: number, l: number): Upper | undefined =>
        uppers.find((u) => u.terrain === t && u.layer === l);
      const neighbour = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= dim || ny >= dim) return undefined;
        const n = (ny * dim + nx) * 4;
        const t = tileBytes[n];
        const l = tileBytes[n + 3];
        if (t === terrain && l === layer) return undefined;
        const nKey = keyOf(t, l);
        const nType = typeOf(t, l);
        if (nKey === undefined || nType === undefined || nKey <= key)
          return undefined;
        let upper = find(t, l);
        if (upper === undefined) {
          upper = {
            terrain: t,
            layer: l,
            key: nKey,
            mode: BLEND_MODES[lowerType]?.[nType] ?? 2,
            neighbours: 0,
          };
          uppers.push(upper);
        }
        return upper;
      };

      for (const { dx, dy, bit } of NEIGHBOURS) {
        const upper = neighbour(dx, dy);
        if (upper) upper.neighbours |= bit;
      }
      if (uppers.length === 0) continue;
      // Lowest priority first, so the highest is drawn last and lands on top.
      uppers.sort(
        (a, b) => a.key - b.key || a.terrain - b.terrain || a.layer - b.layer,
      );
      perTile[index] = uppers;
      depth = Math.max(depth, uppers.length);
    }
  }

  const slice = dim * dim * 4;
  const bytes = new Uint8Array(slice * depth).fill(NO_BLEND);
  for (let index = 0; index < dim * dim; index++) {
    const uppers = perTile[index];
    if (uppers === null) continue;
    const x = index % dim;
    const y = (index - x) / dim;
    uppers.forEach((upper, k) => {
      const p = k * slice + index * 4;
      bytes[p] = upper.terrain;
      bytes[p + 1] = upper.layer;
      bytes[p + 2] = upper.neighbours;
      bytes[p + 3] = upper.mode | (sideVariant(x, y) << 4);
    });
  }
  return { bytes, depth };
}
