// The two terrain facts the game's own generator reads from its data file,
// docs/preview-design.md Sec.6.2 to 6.4 (rev 10). PURE (CLAUDE.md hard rule /
// preview-design Sec.2).
//
// The land stage's cleanup, the elevation stage and the cliff stage all ask
// a terrain one of two questions, and both answers come from
// `empires2_x2_p1.dat` (tools/extract-constants --terrain-generation writes
// them onto game-constants.json's terrain rows).
//
//   - Its PLACEMENT CLASS, a bitfield (genieutils names the field `is_water`,
//     which undersells it). 0x0F holds the water kinds, 0x10 marks a shore,
//     0x20 land, 0x40 a shallows-type terrain and 0x80 a frozen one.
//   - Its DECORATIONS, the small objects the game scatters on the terrain as
//     it paints. Each one costs a fixed number of random draws per tile, and
//     those draws come off the same stream as the hills and cliffs, so a
//     wrong count moves every hill and cliff on the map.
//
// A lookup table per constants array rather than a scan per question. The
// cliff stage asks for the class of every tile of every 3x3 cell, which on a
// Ludicrous map is 230,400 questions before the first cliff is drawn, and
// `constants` holds several thousand rows. A WeakMap keyed on the array is
// the cache, so the table is built once per reference database and is
// garbage collected with it. This is the standard JS idiom for attaching
// derived data to an object you do not own (here, a caller's array) without
// mutating it or leaking it.

export interface TerrainGenerationConstant {
  constId: number | null;
  category: string;
  isWater?: boolean;
  isBeach?: boolean;
  /** The dat's placement class bitfield. Absent on a row nobody has read from the dat. */
  placementClass?: number;
  /** Every decoration slot of the terrain in the dat. Absent on a row nobody has read. */
  decorations?: readonly {
    objectId: number;
    densityPerMille: number;
    centered: boolean;
  }[];
}

/** Placement class bits, named as the game write-up names them. */
export const CLASS_WATER = 0x0f;
export const CLASS_SHORE = 0x10;
export const CLASS_SHALLOWS = 0x40;
export const CLASS_FROZEN = 0x80;
/** A cliff cell holding any of these bits is blocked (preview-design Sec.6.3 rule 2). */
export const CLASS_CLIFF_BLOCKING = 0x4f;
/** A land of a terrain with any of these bits writes height 0 whatever its `base_elevation` (3.0). */
export const CLASS_FLAT_LAND = 0x47;

/** Terrain ids reach 199 in the dat. The table is sized past that so an id from a newer patch still indexes it. */
const TABLE_SIZE = 1024;

export interface TerrainClassTable {
  /** Placement class by terrain id. */
  readonly placementClass: Uint8Array;
  /** Random draws one tile of this terrain spends on its decorations, by terrain id. */
  readonly decorationDraws: Uint8Array;
}

const cache = new WeakMap<
  readonly TerrainGenerationConstant[],
  TerrainClassTable
>();

/**
 * The draws one decoration slot spends on one tile, as measured (gr1, cl4 and
 * co1). A randomized slot draws for its chance and then for its spot in the
 * tile, and a weight of 1000 needs no chance draw. A centered slot has no
 * spot to draw, so it costs one draw for its chance and none at weight 1000.
 * A weight of 0 never fires, and the game skips it without drawing.
 */
function slotDraws(densityPerMille: number, centered: boolean): number {
  if (densityPerMille === 0) return 0;
  if (centered) return densityPerMille === 1000 ? 0 : 1;
  return densityPerMille === 1000 ? 2 : 3;
}

/**
 * A row's class when the dat was never read for it, from the community flags
 * every row carries. Only stub reference data in tests reaches this. Real
 * terrain rows all carry `placementClass`.
 */
function fallbackClass(row: TerrainGenerationConstant): number {
  if (row.isWater) return 0x01;
  if (row.isBeach) return CLASS_SHORE;
  return 0x20;
}

export function terrainClassTable(
  constants: readonly TerrainGenerationConstant[],
): TerrainClassTable {
  const cached = cache.get(constants);
  if (cached) return cached;
  // Land (0x20) for an id no row names, so an unknown terrain neither blocks
  // a cliff nor counts as water. Terrain 16, the cliff line's own terrain, and
  // 70, the water repair's marker, are both rows of the dat and land there.
  const placementClass = new Uint8Array(TABLE_SIZE).fill(0x20);
  const decorationDraws = new Uint8Array(TABLE_SIZE);
  for (const row of constants) {
    if (row.category !== "terrain" || row.constId === null) continue;
    const id = row.constId;
    if (id < 0 || id >= TABLE_SIZE) continue;
    placementClass[id] = row.placementClass ?? fallbackClass(row);
    let draws = 0;
    for (const slot of row.decorations ?? [])
      draws += slotDraws(slot.densityPerMille, slot.centered);
    decorationDraws[id] = draws;
  }
  const table = { placementClass, decorationDraws };
  cache.set(constants, table);
  return table;
}

/** The class of terrain `id`, land for an id outside the table. */
export function classOf(table: TerrainClassTable, id: number): number {
  return id >= 0 && id < TABLE_SIZE ? table.placementClass[id] : 0x20;
}

/** The decoration draws of terrain `id`, none for an id outside the table. */
export function decorationDrawsOf(
  table: TerrainClassTable,
  id: number,
): number {
  return id >= 0 && id < TABLE_SIZE ? table.decorationDraws[id] : 0;
}
