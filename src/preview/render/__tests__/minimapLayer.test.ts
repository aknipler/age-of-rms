// What the minimap view shows (minimapLayer.ts), against the dat's own rows
// for the objects the owner named.

import { describe, expect, it } from "vitest";
import objectData from "../../../../reference/data/object-data.json";
import type { DeObjectRecord } from "../../generator/types";
import {
  MINIMAP_COLOURS,
  OCEAN_FISH_SCALE,
  SQUARE_SCALE,
  buildMinimapLayer,
  minimapKind,
  type MinimapObjectRow,
} from "../minimapLayer";
import { cssColor, playerColor } from "../palette";

const rows = new Map(
  (
    objectData as unknown as { objects: ({ id: number } & MinimapObjectRow)[] }
  ).objects.map((o) => [o.id, o]),
);
const kind = (id: number, owner = 0) => minimapKind(rows.get(id), owner);

describe("minimapKind", () => {
  it("names each resource the owner gave a colour", () => {
    expect(kind(59)).toBe("food"); // FORAGE
    expect(kind(594, 1)).toBe("food"); // a player's SHEEP is still food
    expect(kind(48)).toBe("food"); // BOAR
    expect(kind(65)).toBe("food"); // DEER
    expect(kind(102)).toBe("stone");
    expect(kind(66)).toBe("gold");
    expect(kind(69)).toBe("fish"); // SHORE_FISH
    expect(kind(53)).toBe("fish"); // FISH_PERCH
    expect(kind(285)).toBe("relic");
    expect(kind(349)).toBe("tree"); // OAKTREE
  });

  it("shows players' objects and leaves out Gaia's other objects", () => {
    expect(kind(109, 2)).toBe("player"); // a town centre
    expect(kind(109, 0)).toBeNull();
    expect(kind(126)).toBeNull(); // WOLF, 0 food
    expect(kind(857)).toBeNull(); // HAY_STACK
    expect(kind(96)).toBeNull(); // HAWK
  });
});

describe("buildMinimapLayer", () => {
  const object = (
    id: number,
    x: number,
    y: number,
    owner = 0,
  ): DeObjectRecord => ({
    id,
    owner,
    x,
    y,
    rotation: 0,
    frame: 0,
    status: 2,
    kind: "script",
  });

  it("fills tree and cliff tiles and squares the rest by footprint", () => {
    const cliff = new Uint8Array(16);
    cliff[5] = 1;
    const layer = buildMinimapLayer(
      [
        object(349, 2.5, 3.5),
        object(285, 1.5, 1.5),
        object(109, 2, 2, 1),
        object(857, 0.5, 0.5),
      ],
      rows,
      { dim: 4, cliff },
    );
    expect(layer.tiles.get(MINIMAP_COLOURS.tree)).toEqual([2, 3]);
    expect(layer.tiles.get(MINIMAP_COLOURS.cliff)).toEqual([1, 1]);
    expect(layer.squares.get(MINIMAP_COLOURS.relic)).toEqual([
      1.5,
      1.5,
      SQUARE_SCALE,
    ]);
    // A town centre's square covers its 4 by 4 footprint, in its owner's colour.
    expect(layer.squares.get(cssColor(playerColor(1)))).toEqual([
      2,
      2,
      4 * SQUARE_SCALE,
    ]);
    // The hay stack is not on the minimap at all.
    const drawn = [...layer.squares.values()].flat().length / 3;
    expect(drawn).toBe(2);
  });

  it("draws players' objects over gold over stone over the rest", () => {
    const layer = buildMinimapLayer(
      [
        object(109, 5, 5, 1),
        object(66, 5, 5),
        object(285, 5, 5),
        object(102, 5, 5),
        object(59, 5, 5),
      ],
      rows,
      { dim: 8, cliff: new Uint8Array(64) },
    );
    const order = [...layer.squares.keys()];
    expect(order.slice(-3)).toEqual([
      MINIMAP_COLOURS.stone,
      MINIMAP_COLOURS.gold,
      cssColor(playerColor(1)),
    ]);
  });

  it("keeps shore fish at the full scale and shrinks deep water fish", () => {
    const layer = buildMinimapLayer(
      [object(69, 1.5, 1.5), object(53, 3.5, 3.5)],
      rows,
      { dim: 8, cliff: new Uint8Array(64) },
    );
    expect(layer.squares.get(MINIMAP_COLOURS.fish)).toEqual([
      1.5,
      1.5,
      SQUARE_SCALE,
      3.5,
      3.5,
      // A perch's footprint is 2 tiles, a shore fish's 1.
      2 * OCEAN_FISH_SCALE,
    ]);
  });
});
