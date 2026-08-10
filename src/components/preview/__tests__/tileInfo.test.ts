import { describe, expect, it } from "vitest";
import { NO_LAYER } from "../../../preview/generator/grid";
import type { FailureMark, PlacedObject, StageSnapshot } from "../../../preview/generator/types";
import type { TerrainPalette } from "../../../preview/render/palette";
import { describeTile, indexMarksByTile, indexObjectsByTile, tallyObjects } from "../tileInfo";

// A 3x3 grid built by hand. Small enough that every index is checkable by
// eye, which is the point â€” these tests exist to pin the y * dim + x
// addressing that both hover and selection now share.
function makeSnapshot(dim = 3): StageSnapshot {
  return {
    stage: "S6",
    dim,
    terrain: new Uint16Array(dim * dim),
    layer: new Uint16Array(dim * dim).fill(NO_LAYER),
    elevation: new Uint8Array(dim * dim),
    cliff: new Uint8Array(dim * dim),
  };
}

// Only nameFor is exercised here; the rest of the palette surface is
// palette.test.ts's job. Stubbed rather than built from real reference data
// so a name change in game-constants.json can't turn these red.
const palette: TerrainPalette = {
  mode: "game",
  colorFor: () => ({ r: 0, g: 0, b: 0 }),
  isForest: () => false,
  sourceFor: () => "game",
  nameFor: (id) => (id === 0 ? "GRASS" : id === 1 ? "WATER" : null),
  entries: () => [],
};

function object(overrides: Partial<PlacedObject>): PlacedObject {
  return { objectRef: "GOLD", x: 0, y: 0, category: "resource-gold", ...overrides };
}

function mark(overrides: Partial<FailureMark>): FailureMark {
  return {
    x: 0,
    y: 0,
    kind: "landAtMapCenter",
    commandSpan: { start: 0, end: 1 },
    label: "placed at the map centre",
    ...overrides,
  };
}

describe("indexMarksByTile (Sec.15 item 5)", () => {
  it("buckets by y * dim + x, not the transpose", () => {
    const index = indexMarksByTile([mark({ x: 2, y: 1 })], 3);
    expect(index.get(1 * 3 + 2)).toHaveLength(1);
    expect(index.get(2 * 3 + 1)).toBeUndefined();
  });

  it("keeps both marks when two lands share an origin tile", () => {
    // Two create_land commands with the same land_position is ordinary, so a
    // tile carrying two marks has to survive rather than the second replacing
    // the first.
    const index = indexMarksByTile([mark({}), mark({ label: "and another" })], 3);
    expect(index.get(0)).toHaveLength(2);
  });
});

describe("indexObjectsByTile", () => {
  it("buckets by y * dim + x", () => {
    const index = indexObjectsByTile([object({ x: 2, y: 1 })], 3);
    expect(index.get(1 * 3 + 2)).toHaveLength(1);
    // The transposed key must NOT hit â€” (2,1) and (1,2) are different tiles
    // and a swapped index would look right on any square example that
    // happens to be symmetric.
    expect(index.get(2 * 3 + 1)).toBeUndefined();
  });

  it("keeps every object on a stacked tile, in placement order", () => {
    const index = indexObjectsByTile(
      [object({ objectRef: "GOLD" }), object({ objectRef: "STONE" })],
      3,
    );
    expect(index.get(0)?.map((o) => o.objectRef)).toEqual(["GOLD", "STONE"]);
  });
});

describe("describeTile", () => {
  it("reads terrain, elevation and cliff off the grid", () => {
    const snapshot = makeSnapshot();
    snapshot.terrain[1 * 3 + 2] = 1;
    snapshot.elevation[1 * 3 + 2] = 4;
    snapshot.cliff[1 * 3 + 2] = 1;
    const tile = describeTile(snapshot, palette, new Map(), new Map(), 2, 1);
    expect(tile).toMatchObject({ x: 2, y: 1, terrain: 1, terrainName: "WATER", elevation: 4, cliff: true });
  });

  it("reports NO_LAYER as no layer rather than as terrain 65535", () => {
    const tile = describeTile(makeSnapshot(), palette, new Map(), new Map(), 0, 0);
    expect(tile.layer).toBeNull();
    expect(tile.layerName).toBeNull();
  });

  it("reports a GRASS layer, which is terrain id 0", () => {
    // The sentinel used to be 0, which is GRASS â€” a real GRASS layer read as
    // "nothing layered here" (see CLAUDE.md, preview review round 3). The
    // case is cheap to pin and it is the one that regressed.
    const snapshot = makeSnapshot();
    snapshot.layer[0] = 0;
    const tile = describeTile(snapshot, palette, new Map(), new Map(), 0, 0);
    expect(tile.layer).toBe(0);
    expect(tile.layerName).toBe("GRASS");
  });

  it("leaves terrainName null for an id the reference data cannot name", () => {
    // Naming is a positive resolver: 78 of DE's 131 terrains have a callable
    // constant, so an unnamed id is normal and the readout falls back to
    // "terrain N" rather than pretending.
    const snapshot = makeSnapshot();
    snapshot.terrain[0] = 99;
    expect(describeTile(snapshot, palette, new Map(), new Map(), 0, 0).terrainName).toBeNull();
  });

  it("returns the shared empty array for a tile with nothing on it", () => {
    const snapshot = makeSnapshot();
    const first = describeTile(snapshot, palette, new Map(), new Map(), 0, 0).objects;
    const second = describeTile(snapshot, palette, new Map(), new Map(), 1, 1).objects;
    // Same reference, not merely equal: a fresh [] per read would make every
    // pointer move a new object and re-render the readout for no change.
    expect(first).toBe(second);
  });

  it("hands back the marks on the hovered tile and nothing from a neighbour", () => {
    const marks = indexMarksByTile([mark({ x: 1, y: 1, label: "this one" })], 3);
    expect(describeTile(makeSnapshot(), palette, new Map(), marks, 1, 1).marks).toHaveLength(1);
    expect(describeTile(makeSnapshot(), palette, new Map(), marks, 1, 2).marks).toHaveLength(0);
  });

  it("re-reads the grid rather than caching, so a regenerated map shows through", () => {
    const snapshot = makeSnapshot();
    expect(describeTile(snapshot, palette, new Map(), new Map(), 0, 0).terrain).toBe(0);
    snapshot.terrain[0] = 1;
    expect(describeTile(snapshot, palette, new Map(), new Map(), 0, 0).terrain).toBe(1);
  });
});

describe("tallyObjects", () => {
  it("counts repeats of the same object", () => {
    expect(tallyObjects([object({}), object({}), object({})])).toEqual([
      { objectRef: "GOLD", player: undefined, count: 3 },
    ]);
  });

  it("keeps two owners of the same object apart", () => {
    const tallies = tallyObjects([
      object({ objectRef: "BOAR", player: 3 }),
      object({ objectRef: "BOAR", player: 4 }),
      object({ objectRef: "BOAR", player: 3 }),
    ]);
    expect(tallies).toEqual([
      { objectRef: "BOAR", player: 3, count: 2 },
      { objectRef: "BOAR", player: 4, count: 1 },
    ]);
  });

  it("keeps a gaia placement apart from a player-owned one", () => {
    const tallies = tallyObjects([object({ objectRef: "BOAR" }), object({ objectRef: "BOAR", player: 1 })]);
    expect(tallies).toHaveLength(2);
  });

  it("does not merge a name ending in a digit with the same stem owned by that player", () => {
    // MARLIN and MARLIN1 are both real DE constants, so this pair is not
    // contrived. It is the case that decides the key's shape: with the name
    // first and no separator, gaia MARLIN1 and player 1's MARLIN produce the
    // identical key and one of them vanishes from the readout. The test above
    // does NOT catch that â€” it was written first, passed under the broken
    // key, and this is the observation that separates the two forms.
    const tallies = tallyObjects([
      object({ objectRef: "MARLIN1" }),
      object({ objectRef: "MARLIN", player: 1 }),
    ]);
    expect(tallies).toHaveLength(2);
    expect(tallies.map((t) => t.count)).toEqual([1, 1]);
  });

  it("preserves first-seen order", () => {
    const tallies = tallyObjects([
      object({ objectRef: "STONE" }),
      object({ objectRef: "GOLD" }),
      object({ objectRef: "STONE" }),
    ]);
    expect(tallies.map((t) => t.objectRef)).toEqual(["STONE", "GOLD"]);
  });
});
