// Colours for the preview: terrain fills, elevation shading, layer tint,
// cliffs, object glyphs, player markers.
//
// Pure — no canvas, no DOM — so every rule in here is unit-testable and the
// bitmap builder next door can run in Node.
//
// ---------------------------------------------------------------------------
// TERRAIN COLOURS ARE REAL NOW, AND THERE ARE TWO SETS OF THEM. Sec.12 item 5
// is discharged (2026-08-05); the hash below survives only as a last-resort
// fallback for terrains the refDb has no colour for.
//
// The item recorded `Terrain.colors` in the .dat as "sourced but not yet
// decodable" — it holds PALETTE INDICES, not RGB, so SNOW read (55,236,54),
// byte-identical to GRASS. Decoding it turned out to be easy (the palette is a
// plain-text JASC-PAL file) and NOT to be the fix, which is the finding worth
// carrying: across the 131 enabled terrain records that field takes only 12
// distinct values. It is a legacy colour CLASS, so every snow variant really
// does carry grass's green, one level above the encoding.
//
// So the extraction now produces two colours per terrain, and each resolves
// what the other collapses:
//
//   previewColor  GAME mode, the default. Mean of the opaque texels of the
//                 terrain's own .dds texture. SNOW (180,205,219) is pale, GRASS
//                 (129,146,63) olive. Terrains SHARING a texture file share a
//                 colour — FOREST and LEAVES are both g_for, DESERT and
//                 PALM_DESERT both g_pal.
//   minimapColor  MINIMAP mode. The dat's colour class, decoded. Flat and
//                 saturated, and it separates FOREST (dark green) from LEAVES
//                 (grass green) — but draws every snow as grass.
//
// Neither is "the" answer, which is why the pane offers a toggle rather than
// this module picking. Both are honest about what they are: one is the ground
// texture, one is the game's own colour class, and the mode label says which
// you are looking at.
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The two colour sources the pane toggles between. `game` is the default. */
export type TerrainColorMode = "game" | "minimap";

export const DEFAULT_TERRAIN_COLOR_MODE: TerrainColorMode = "game";

/**
 * Where a given terrain's colour actually came from. The pane reports this
 * rather than assuming, so a data gap shows up as "hashed" in the legend
 * instead of quietly looking like a real colour.
 */
export type TerrainColorSource = "game" | "minimap" | "hashed" | "unknown";

export const COLOR_MODE_NOTES: Record<TerrainColorMode, string> = {
  game:
    "Game colours: the average colour of each terrain's own texture, from your game install. " +
    "Terrains that share a texture file share a colour — FOREST and LEAVES are both g_for.",
  minimap:
    "Minimap colours: the game data's own terrain colour class. It is coarse — only 12 colours " +
    "cover every terrain, so all the snow terrains share grass's green. It does separate forest from underbrush.",
};

export const HASHED_COLOR_NOTE =
  "Some terrains have no colour in the reference data and are drawn in an arbitrary but consistent " +
  "colour instead. The legend marks them.";

// ---------------------------------------------------------------------------
// Stable hashing
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit. Chosen because it is four lines, has no dependencies, and
 * spreads short ASCII strings well — which is all "stable hash colour" needs.
 *
 * `>>> 0` after each step is the JavaScript detail worth naming: bitwise
 * operators here coerce to a SIGNED 32-bit int, so without it the value goes
 * negative and the arithmetic below would need to handle that. The unsigned
 * shift is the idiomatic way to say "reinterpret those 32 bits as unsigned".
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // The FNV prime, 16777619, via shifts because a plain `*` overflows the
    // 53-bit float mantissa and stops being exact.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A colour from a name. Hue takes the whole circle; saturation and lightness
 * are held in narrow bands so no terrain comes out neon or near-black, and so
 * the elevation shading below has headroom in both directions.
 */
export function hashColor(name: string): Rgb {
  const hash = hashString(name);
  const hue = hash % 360;
  const saturation = 0.38 + ((hash >>> 9) % 24) / 100; // 0.38 - 0.61
  const lightness = 0.42 + ((hash >>> 17) % 20) / 100; // 0.42 - 0.61
  return hslToRgb(hue, saturation, lightness);
}

export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((hue % 360) + 360) % 360 / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = lightness - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (sector < 1) [r, g, b] = [chroma, second, 0];
  else if (sector < 2) [r, g, b] = [second, chroma, 0];
  else if (sector < 3) [r, g, b] = [0, chroma, second];
  else if (sector < 4) [r, g, b] = [0, second, chroma];
  else if (sector < 5) [r, g, b] = [second, 0, chroma];
  else [r, g, b] = [chroma, 0, second];
  return {
    r: Math.round((r + match) * 255),
    g: Math.round((g + match) * 255),
    b: Math.round((b + match) * 255),
  };
}

// ---------------------------------------------------------------------------
// Terrain palette
// ---------------------------------------------------------------------------

/**
 * The slice of reference/data/game-constants.json this module needs.
 * Declared locally rather than imported from breakdown/, following
 * resourceTotals.ts and validate.ts: each consumer states the narrow shape it
 * depends on, so a schema change breaks the consumers that actually care.
 */
export interface TerrainConstant {
  constId: number | null;
  /** Null for the 53 DE terrains with no callable constant — the legend shows `descriptiveName` for those, since "Water, Deep Ocean" beats "terrain 57". */
  rmsConstant: string | null;
  descriptiveName?: string;
  category: string;
  /** Community-sourced. Drives the canopy tint below, not just the generator's forest-zone mask. */
  isForest?: boolean;
  /** [r, g, b], game mode. Absent when the extraction could not read the texture. */
  previewColor?: readonly number[];
  /** [r, g, b], minimap mode. Absent when the palette or dat could not be read. */
  minimapColor?: readonly number[];
}

/**
 * What to call a terrain in the UI, and — because the two must not drift —
 * the key its fallback hash colour is derived from.
 *
 * A terrain with no RMS constant still has a name a reader knows it by, the
 * scenario editor's own. 53 of DE's 131 terrains are in that position, and
 * they are exactly the ones a script reaches by bare id, so "terrain 57" as a
 * legend row would be unreadable precisely where it is most needed.
 */
export function terrainDisplayName(entry: Pick<TerrainConstant, "rmsConstant" | "descriptiveName" | "constId">): string {
  return entry.rmsConstant ?? entry.descriptiveName ?? `terrain ${entry.constId}`;
}

export interface TerrainLegendEntry {
  id: number;
  name: string;
  color: Rgb;
  source: TerrainColorSource;
}

export interface TerrainPalette {
  mode: TerrainColorMode;
  /** Colour for a terrain id, memoised. Unknown ids get a neutral placeholder. */
  colorFor(terrainId: number): Rgb;
  /** True when this terrain carries trees, so the bitmap can draw a canopy over it. */
  isForest(terrainId: number): boolean;
  /** Where that colour came from — see TerrainColorSource. */
  sourceFor(terrainId: number): TerrainColorSource;
  /** Constant name for a terrain id, or null if the refDb has never heard of it. */
  nameFor(terrainId: number): string | null;
  /** Every terrain the refDb knows, for the legend. */
  entries(): TerrainLegendEntry[];
}

/** Used for terrain ids the refDb cannot name — 31 of several hundred are known. */
export const UNKNOWN_TERRAIN_COLOR: Rgb = { r: 122, g: 122, b: 126 };

function toRgb(channels: readonly number[] | undefined): Rgb | null {
  // Length is schema-enforced at build time by `npm run validate:reference`;
  // this guard is for the runtime path, where the JSON is cast rather than
  // validated (the same double-cast situation as parserWorker.ts).
  if (!channels || channels.length < 3) return null;
  return { r: clampByte(channels[0]), g: clampByte(channels[1]), b: clampByte(channels[2]) };
}

export function createTerrainPalette(
  constants: readonly TerrainConstant[],
  mode: TerrainColorMode = DEFAULT_TERRAIN_COLOR_MODE,
): TerrainPalette {
  const nameById = new Map<number, string>();
  const entryById = new Map<number, TerrainConstant>();
  for (const entry of constants) {
    if (entry.category !== "terrain" || entry.constId === null) continue;
    // First definition wins, matching the engine's #const rule, so a
    // duplicate id in the data cannot silently retint the map.
    if (!nameById.has(entry.constId)) {
      nameById.set(entry.constId, terrainDisplayName(entry));
      entryById.set(entry.constId, entry);
    }
  }

  /**
   * The mode's own colour first, then the other mode's, then a hash.
   *
   * Falling back to the other source rather than straight to a hash is a
   * deliberate choice and the reason `sourceFor` exists: a real colour from
   * the wrong source beats an arbitrary one, but the caller has to be able to
   * find out that is what happened. Today both fields are populated for all
   * 15 known terrains, so this path only runs on future data gaps.
   */
  function resolve(terrainId: number): { color: Rgb; source: TerrainColorSource } {
    const entry = entryById.get(terrainId);
    if (entry === undefined) return { color: UNKNOWN_TERRAIN_COLOR, source: "unknown" };
    const own = toRgb(mode === "game" ? entry.previewColor : entry.minimapColor);
    if (own) return { color: own, source: mode };
    const other = toRgb(mode === "game" ? entry.minimapColor : entry.previewColor);
    if (other) return { color: other, source: mode === "game" ? "minimap" : "game" };
    return { color: hashColor(terrainDisplayName(entry)), source: "hashed" };
  }

  // Memoised because the bitmap builder asks once per tile — 40,000 times on
  // a Normal map.
  const cache = new Map<number, { color: Rgb; source: TerrainColorSource }>();
  function resolveCached(terrainId: number) {
    let hit = cache.get(terrainId);
    if (hit === undefined) {
      hit = resolve(terrainId);
      cache.set(terrainId, hit);
    }
    return hit;
  }

  return {
    mode,
    colorFor: (terrainId) => resolveCached(terrainId).color,
    isForest: (terrainId) => entryById.get(terrainId)?.isForest === true,
    sourceFor: (terrainId) => resolveCached(terrainId).source,
    nameFor: (terrainId) => nameById.get(terrainId) ?? null,
    entries() {
      return [...nameById.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, name]) => ({ id, name, ...resolveCached(id) }));
    },
  };
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

/** Brightness gained per elevation step, before slope shading. */
const HEIGHT_GAIN = 0.03;
/** Brightness swing on a slope face, per step of difference, capped below. */
const SLOPE_GAIN = 0.09;
/** Steps of elevation difference beyond which a slope shades no harder. */
const SLOPE_CAP = 3;

/**
 * Sec.2's renderer contract: "elevation as brightness shading (lighten toward
 * the light-source edge per height step, darken opposite — cheap slope
 * shading, no 3D)".
 *
 * Two components. A flat gain with absolute height, so a plateau reads as
 * high even where it is level; and a slope term comparing the tile against
 * its neighbour toward the light, so the edges of a hill catch a highlight on
 * one side and a shadow on the other. That second term is what makes a hill
 * look like a hill rather than a lighter patch.
 *
 * The light comes from the screen's upper left, which in tile space is the
 * -y direction (see projection.ts's compass) — hence the neighbour sampled is
 * (x, y-1). Choosing a diagonal light would mean sampling two neighbours for
 * no visible gain at these tile sizes.
 */
export function shadeForElevation(color: Rgb, elevation: number, lightNeighbour: number): Rgb {
  const slope = Math.max(-SLOPE_CAP, Math.min(SLOPE_CAP, elevation - lightNeighbour));
  const factor = 1 + elevation * HEIGHT_GAIN + slope * SLOPE_GAIN;
  return scale(color, factor);
}

export function scale(color: Rgb, factor: number): Rgb {
  return {
    r: clampByte(color.r * factor),
    g: clampByte(color.g * factor),
    b: clampByte(color.b * factor),
  };
}

export function mix(a: Rgb, b: Rgb, weightOfB: number): Rgb {
  const w = Math.max(0, Math.min(1, weightOfB));
  return {
    r: clampByte(a.r * (1 - w) + b.r * w),
    g: clampByte(a.g * (1 - w) + b.g * w),
    b: clampByte(a.b * (1 - w) + b.b * w),
  };
}

export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/**
 * How strongly a `base_layer` / `terrain_mask` layer tints the terrain under
 * it. Sec.9 item 6 excludes true visual blending from simulation, so this is
 * deliberately a flat overlay tint and says so in the notes.
 *
 * Raised from 0.45 on 2026-08-07. A mask is a real texture in game, covering
 * most of what you see, and at 0.45 a mask between two similar colours was
 * invisible: `AD4 - Pag - v1.2.rms` masks DIRT over DESERT across most of its
 * landmass, which came out (218,169,110) against bare desert's
 * (221,180,124) — a difference no one could see, so the map read as
 * undifferentiated sand and the mask looked like it had not run at all.
 */
export const LAYER_TINT_WEIGHT = 0.7;

/**
 * Forest terrains are drawn toward a canopy green rather than in their raw
 * texture colour.
 *
 * This is not decoration. A forest terrain's own `.dds` is the GROUND under
 * the trees — `MEDITERRANEAN_FOREST` and plain `LEAVES` are both `g_for`, an
 * earthy brown — while the thing that makes a forest tile recognisable in
 * game is the trees standing on it, which the engine places automatically
 * from the terrain itself (guide:1509, "automatic objects (such as trees for
 * forest terrains)"). The preview does not emit those trees as objects, so
 * without this a 4,000-tile forest renders as bare dirt.
 *
 * Applied from the `isForest` flag, so it follows the reference data rather
 * than a name, and it follows whichever terrain owns the tile — which under
 * `terrain_mask` is the property-bearing one, exactly as the engine's own
 * automatic-object rule does.
 */
export const CANOPY_COLOR: Rgb = { r: 42, g: 74, b: 40 };
export const CANOPY_WEIGHT = 0.62;

/**
 * Cliffs. Sec.9 item 7 simulates only a coarse walk, so they get a flat
 * stone tone rather than any attempt at geometry — visible at every zoom,
 * which is the property that matters in a 288px panel.
 */
export const CLIFF_COLOR: Rgb = { r: 74, g: 68, b: 62 };
export const CLIFF_WEIGHT = 0.82;

// ---------------------------------------------------------------------------
// Objects and players
// ---------------------------------------------------------------------------

/**
 * Glyph colours by PlacedObject.category (Sec.12 item 8). Matched longest
 * prefix first, dropping one dash-separated segment at a time, so a future
 * "resource-food-berry" lands on the food colour rather than the fallback.
 * The spec's own category list ends with "...", so a category we have never
 * seen is the expected case rather than a data error.
 */
const CATEGORY_COLORS: Record<string, Rgb> = {
  "resource-food": { r: 226, g: 92, b: 86 },
  "resource-wood": { r: 60, g: 118, b: 66 },
  "resource-gold": { r: 240, g: 196, b: 62 },
  "resource-stone": { r: 176, g: 176, b: 184 },
  resource: { r: 240, g: 196, b: 62 },
  unit: { r: 250, g: 250, b: 250 },
  building: { r: 208, g: 150, b: 96 },
  relic: { r: 196, g: 120, b: 232 },
  decoration: { r: 130, g: 150, b: 130 },
};

export const UNKNOWN_CATEGORY_COLOR: Rgb = { r: 236, g: 236, b: 236 };

export function categoryColor(category: string): Rgb {
  const parts = category.split("-");
  for (let length = parts.length; length > 0; length--) {
    const match = CATEGORY_COLORS[parts.slice(0, length).join("-")];
    if (match !== undefined) return match;
  }
  return UNKNOWN_CATEGORY_COLOR;
}

/**
 * DE's lobby player colours, player 1 first. Used for the numbered markers so
 * the preview reads the same way as the game's own player list.
 */
export const PLAYER_COLORS: readonly Rgb[] = [
  { r: 60, g: 100, b: 220 }, // 1 blue
  { r: 214, g: 56, b: 48 }, // 2 red
  { r: 60, g: 168, b: 72 }, // 3 green
  { r: 236, g: 200, b: 60 }, // 4 yellow
  { r: 64, g: 198, b: 214 }, // 5 cyan
  { r: 226, g: 116, b: 214 }, // 6 magenta
  { r: 140, g: 140, b: 146 }, // 7 grey
  { r: 236, g: 142, b: 52 }, // 8 orange
];

export function playerColor(player: number): Rgb {
  return PLAYER_COLORS[(player - 1) % PLAYER_COLORS.length] ?? UNKNOWN_CATEGORY_COLOR;
}

export function cssColor(color: Rgb): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}
