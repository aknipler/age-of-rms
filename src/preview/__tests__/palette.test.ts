import { describe, expect, it } from "vitest";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import {
  CLIFF_COLOR,
  UNKNOWN_CATEGORY_COLOR,
  UNKNOWN_TERRAIN_COLOR,
  categoryColor,
  clampByte,
  createTerrainPalette,
  cssColor,
  hashColor,
  hashString,
  mix,
  playerColor,
  scale,
  shadeForElevation,
  terrainDisplayName,
  type TerrainConstant,
} from "../render/palette";

const constants = (gameConstantsRaw as unknown as { constants: TerrainConstant[] }).constants;

describe("hashString", () => {
  // Pinned against the published FNV-1a 32-bit test vectors rather than
  // against our own output. A hash test that only asserts "what it currently
  // returns" cannot tell a correct implementation from a subtly broken one —
  // these three say the algorithm is the one it claims to be.
  it("matches the FNV-1a reference vectors", () => {
    expect(hashString("").toString(16)).toBe("811c9dc5");
    expect(hashString("a").toString(16)).toBe("e40c292c");
    expect(hashString("foobar").toString(16)).toBe("bf9cf968");
  });

  it("stays unsigned", () => {
    for (const name of ["WATER", "SNOW", "PALM_DESERT", "ÿÿÿ"]) {
      expect(hashString(name)).toBeGreaterThanOrEqual(0);
      expect(hashString(name)).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("hashColor", () => {
  it("gives the same colour for the same name every time", () => {
    expect(hashColor("GRASS")).toEqual(hashColor("GRASS"));
    // The pinned value. This is now only the last-resort fallback for a
    // terrain with no colour in the reference data, but "stable" is still the
    // one thing it promises, so a change to the hash or the HSL bands has to
    // be a deliberate one.
    expect(hashColor("GRASS")).toEqual({ r: 185, g: 201, b: 94 });
  });

  it("separates every terrain the reference DB knows", () => {
    // Keyed through terrainDisplayName, not rmsConstant: 53 of the 131 DE
    // terrains have no constant, and hashing `null` for all of them would
    // collapse a third of the table onto one colour.
    const terrains = constants.filter((entry) => entry.category === "terrain");
    const colors = new Set(terrains.map((entry) => cssColor(hashColor(terrainDisplayName(entry)))));
    expect(terrains.length).toBeGreaterThan(10);
    expect(colors.size).toBe(terrains.length);
  });

  it("stays inside the mid-lightness band so shading has headroom both ways", () => {
    for (const entry of constants) {
      const { r, g, b } = hashColor(terrainDisplayName(entry));
      const luma = (r * 299 + g * 587 + b * 114) / 1000;
      expect(luma).toBeGreaterThan(40);
      expect(luma).toBeLessThan(215);
    }
  });
});

describe("createTerrainPalette", () => {
  const palette = createTerrainPalette(constants);

  it("draws every terrain the extraction has covered from the data, not the hash", () => {
    // The whole point of decoding the install's colours. If this goes red
    // because a terrain lost its previewColor, the map silently reverts to
    // confetti for that terrain and only the legend would say so.
    //
    // Scoped to entries that CARRY a colour, which is the honest claim now
    // that the terrain table is the full DE set (131 terrains) rather than
    // the 15 the extraction had run against. The rest are pending one
    // `extract_constants.py --colors-only` run on a machine with the game
    // installed; the count below is the pin, so that run shows up here as a
    // number going down rather than as nothing at all.
    const terrains = constants.filter((c) => c.category === "terrain");
    for (const entry of terrains.filter((c) => c.previewColor !== undefined)) {
      expect(palette.sourceFor(entry.constId as number)).toBe("game");
    }
    const uncoloured = terrains.filter((c) => c.previewColor === undefined && c.minimapColor === undefined);
    expect(uncoloured.length).toBeLessThanOrEqual(96);
  });

  it("reads the colour out of the data rather than computing one", () => {
    // GRASS's texture mean, as extracted. Pinned so a change to the data is a
    // deliberate re-extraction rather than a silent drift.
    expect(palette.colorFor(0)).toEqual({ r: 129, g: 146, b: 63 });
    expect(palette.colorFor(1)).toEqual({ r: 33, g: 119, b: 162 });
  });

  it("tells snow from grass, which is the defect that motivated the extraction", () => {
    // preview-design Sec.12 item 5: the dat's own colour field gives SNOW and
    // GRASS the identical green. Game mode must not.
    expect(palette.colorFor(32)).not.toEqual(palette.colorFor(0));
  });

  it("resolves known terrain ids to their constant name", () => {
    expect(palette.nameFor(0)).toBe("GRASS");
    expect(palette.nameFor(1)).toBe("WATER");
    expect(palette.nameFor(10)).toBe("FOREST");
  });

  it("does not claim to know terrains it has never seen", () => {
    // The reference DB holds 31 of several hundred constants, so an
    // unresolved id is the normal case, not an error. CLAUDE.md's hard rule:
    // reference data is a positive resolver, never a negative authority.
    expect(palette.nameFor(9999)).toBeNull();
    expect(palette.colorFor(9999)).toEqual(UNKNOWN_TERRAIN_COLOR);
  });

  it("ignores object entries when building the terrain table", () => {
    // GOLD is constId 66 and category "object", and terrain 66 is a rice
    // farm — so this is no longer a null check but a collision check, which
    // is the stronger version of the same claim. A palette that indexed the
    // whole file by constId would colour that terrain gold.
    const gold = constants.find((c) => c.category === "object" && c.rmsConstant === "GOLD");
    expect(gold?.constId).toBe(66);
    expect(palette.nameFor(66)).not.toBe("GOLD");
    // And an id no terrain claims still resolves to nothing at all.
    expect(palette.nameFor(9998)).toBeNull();
  });

  it("names an unnamed terrain by its descriptive name rather than by its id", () => {
    // 53 of DE's 131 terrains have no RMS constant. They are reachable only
    // by bare id, which is exactly when a legend row saying "terrain 26" is
    // least useful.
    const unnamed = constants.find((c) => c.category === "terrain" && c.rmsConstant === null);
    expect(unnamed).toBeDefined();
    expect(palette.nameFor(unnamed!.constId as number)).toBe(unnamed!.descriptiveName);
  });

  it("memoises, so the per-tile lookup is one map read", () => {
    expect(palette.colorFor(0)).toBe(palette.colorFor(0));
  });

  it("lists its entries in id order for the legend", () => {
    const ids = palette.entries().map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe("terrain colour modes", () => {
  const game = createTerrainPalette(constants, "game");
  const minimap = createTerrainPalette(constants, "minimap");

  it("defaults to game mode", () => {
    expect(createTerrainPalette(constants).mode).toBe("game");
  });

  it("each mode separates a pair the other one collapses", () => {
    // This is the reason there are two modes rather than one, so it is worth
    // asserting rather than describing. Game mode is per-texture: SNOW and
    // GRASS differ, but FOREST and LEAVES share g_for. Minimap mode is the
    // dat's 12-value colour class: FOREST and LEAVES differ, but every snow
    // carries grass's green.
    expect(game.colorFor(32)).not.toEqual(game.colorFor(0)); // SNOW vs GRASS
    expect(game.colorFor(10)).toEqual(game.colorFor(5)); // FOREST vs LEAVES

    expect(minimap.colorFor(32)).toEqual(minimap.colorFor(0));
    expect(minimap.colorFor(10)).not.toEqual(minimap.colorFor(5));
  });

  it("falls back to the other source and says so, rather than silently hashing", () => {
    const noGameColor: TerrainConstant[] = [
      { constId: 0, rmsConstant: "GRASS", category: "terrain", minimapColor: [1, 2, 3] },
    ];
    const palette = createTerrainPalette(noGameColor, "game");
    expect(palette.colorFor(0)).toEqual({ r: 1, g: 2, b: 3 });
    expect(palette.sourceFor(0)).toBe("minimap");
  });

  it("hashes only when the data has no colour at all", () => {
    const bare: TerrainConstant[] = [{ constId: 0, rmsConstant: "GRASS", category: "terrain" }];
    const palette = createTerrainPalette(bare, "game");
    expect(palette.colorFor(0)).toEqual(hashColor("GRASS"));
    expect(palette.sourceFor(0)).toBe("hashed");
  });

  it("keeps a separate cache per mode", () => {
    // The memoisation is per palette instance for exactly this reason: one
    // shared cache would serve game colours to minimap mode after a toggle.
    expect(game.colorFor(32)).not.toEqual(minimap.colorFor(32));
  });
});

describe("shadeForElevation", () => {
  const base = { r: 120, g: 120, b: 120 };

  it("lightens a tile facing the light and darkens one facing away", () => {
    const lit = shadeForElevation(base, 4, 2);
    const shaded = shadeForElevation(base, 2, 4);
    const flat = shadeForElevation(base, 3, 3);
    expect(lit.r).toBeGreaterThan(flat.r);
    expect(shaded.r).toBeLessThan(flat.r);
  });

  it("brightens with absolute height even on flat ground", () => {
    expect(shadeForElevation(base, 6, 6).r).toBeGreaterThan(shadeForElevation(base, 0, 0).r);
  });

  it("caps the slope term so a sheer drop does not go pure black", () => {
    const steep = shadeForElevation(base, 0, 16);
    const lessSteep = shadeForElevation(base, 0, 3);
    expect(steep.r).toBe(lessSteep.r);
    expect(steep.r).toBeGreaterThan(0);
  });
});

describe("colour arithmetic", () => {
  it("clamps rather than wrapping", () => {
    expect(clampByte(-40)).toBe(0);
    expect(clampByte(900)).toBe(255);
    expect(scale({ r: 250, g: 10, b: 10 }, 4)).toEqual({ r: 255, g: 40, b: 40 });
  });

  it("mixes toward the second colour", () => {
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 40 }, 0.5)).toEqual({
      r: 50,
      g: 100,
      b: 20,
    });
    expect(mix({ r: 10, g: 10, b: 10 }, CLIFF_COLOR, 1)).toEqual(CLIFF_COLOR);
  });
});

describe("object and player colours", () => {
  it("falls back through the category family before giving up", () => {
    // An unseen sub-category walks up to the nearest family it does know,
    // rather than dropping straight to the unknown colour — the spec's
    // category list ends with "...", so new values are expected.
    expect(categoryColor("resource-food-berry")).toEqual(categoryColor("resource-food"));
    expect(categoryColor("resource-obsidian")).toEqual(categoryColor("resource"));
    expect(categoryColor("siege-weapon-trebuchet")).toEqual(UNKNOWN_CATEGORY_COLOR);
  });

  it("gives every player a distinct colour", () => {
    const colors = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((p) => cssColor(playerColor(p))));
    expect(colors.size).toBe(8);
  });
});
