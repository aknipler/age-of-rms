// Which sprite frame each object draws with, and in what order
// (docs/preview-de-textures-design.md Sec.12), against rows of the real
// object-sprites.json and hand made ones whose answer is known.

import { describe, expect, it } from "vitest";
import objectData from "../../../../reference/data/object-data.json";
import spritesJson from "../../../../reference/data/object-sprites.json";
import type { DeObjectRecord } from "../../generator/types";
import {
  planSprites,
  sortSprites,
  spriteFrame,
  type SpriteRow,
  type SpriteTables,
} from "../objectSprites";

const rows = (spritesJson as unknown as { sprites: Record<string, SpriteRow> })
  .sprites;
const tables: SpriteTables = {
  sprites: new Map(Object.entries(rows).map(([id, row]) => [Number(id), row])),
  standing: new Map(
    (objectData as unknown as { objects: { id: number; g?: number }[] }).objects
      .filter((o) => o.g !== undefined)
      .map((o) => [o.id, o.g as number]),
  ),
};

function object(
  id: number,
  fields: Partial<DeObjectRecord> = {},
): DeObjectRecord {
  return {
    id,
    owner: 0,
    x: 10.5,
    y: 10.5,
    rotation: 0,
    frame: 0,
    status: 2,
    kind: "terrain",
    ...fields,
  };
}

describe("spriteFrame", () => {
  it("draws an unanimated graphic's stored facet as its variant", () => {
    // A tree, one frame of 42 variants. Facet 29 is frame 29.
    const tree: SpriteRow = ["n_tree_birch_x1", 1, 42, 0, 20, []];
    expect(spriteFrame(tree, 29, 29)).toEqual({ frame: 29, mirrored: false });
  });

  it("turns an animated graphic to its rotation and starts at its frame", () => {
    // 16 angles of 60 frames, no mirroring. A quarter turn is angle 4.
    const unit: SpriteRow = ["u", 60, 16, 0, 20, []];
    expect(spriteFrame(unit, Math.PI / 2 + 0.01, 7)).toEqual({
      frame: 4 * 60 + 7,
      mirrored: false,
    });
  });

  it("draws a later angle of a mirrored graphic as its mirror", () => {
    // 16 angles, mirrored: angles 0 to 8 are stored, 9 to 15 drawn flipped.
    const unit: SpriteRow = ["u", 60, 16, 6, 20, []];
    const angle12 = (12 * 2 * Math.PI) / 16 + 0.01;
    expect(spriteFrame(unit, angle12, 0)).toEqual({
      frame: 4 * 60,
      mirrored: true,
    });
  });

  it("faces angle 0 when a whole number rotation is a stored facet, not radians", () => {
    const fish: SpriteRow = ["a_fish_perch_x1", 90, 1, 0, 11, []];
    expect(spriteFrame(fish, 7, 5)).toEqual({ frame: 5, mirrored: false });
  });
});

describe("planSprites", () => {
  it("draws a gold mine as its own part and skips its pictureless delta", () => {
    // GOLD (66) stands as n_mine_gold_x1, whose second delta names no file.
    const parts = planSprites([object(66, { rotation: 5, frame: 5 })], tables);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      file: "n_mine_gold_x1",
      frame: 5,
      objectId: 66,
    });
  });

  it("stacks a building's delta parts at their offsets", () => {
    // 618, a town centre main, draws itself 48 pixels down and an extra
    // graphic 50 down.
    const parts = planSprites(
      [object(618, { owner: 1, kind: "script" })],
      tables,
    );
    expect(parts.map((p) => [p.file, p.dy, p.owner])).toEqual([
      ["b_dark_town_center_age1_main_x1", 48, 1],
      ["s_town_center_extra_x1", 50, 1],
    ]);
  });

  it("draws a town centre's annexes at their offsets, under the centre's id", () => {
    // The saved map holds only the back piece (109). The main, centre and
    // front pieces are annexes 618, 619 and 620, as the dat places them.
    const annexes = new Map(
      (
        objectData as unknown as {
          objects: { id: number; ann?: [number, number, number][] }[];
        }
      ).objects
        .filter((o) => o.ann !== undefined)
        .map((o) => [o.id, o.ann!]),
    );
    const parts = planSprites([object(109, { owner: 1 })], {
      ...tables,
      annexes,
    });
    const files = parts.map((p) => p.file);
    for (const piece of ["back", "main", "center", "front"])
      expect(files).toContain(`b_dark_town_center_age1_${piece}_x1`);
    const front = parts.find((p) => p.file.endsWith("front_x1"))!;
    expect([front.x, front.y]).toEqual([9.5, 11.5]);
    expect(parts.every((p) => p.objectId === 109 && p.owner === 1)).toBe(true);
    // Without the annex table only the back piece draws, as before.
    expect(planSprites([object(109)], tables).map((p) => p.file)).toEqual([
      "b_dark_town_center_age1_back_x1",
    ]);
  });

  it("draws nothing for an object the game saves as hidden", () => {
    expect(planSprites([object(66, { status: 0 })], tables)).toEqual([]);
  });
});

describe("sortSprites", () => {
  it("draws lower layers first, then from the back of the screen to the front", () => {
    const at = (x: number, y: number, layer: number) => ({
      file: "f",
      frame: 0,
      mirrored: false,
      x,
      y,
      dx: 0,
      dy: 0,
      layer,
      owner: 0,
      objectId: 0,
    });
    // Screen depth grows with y - x. (5, 9) is in front of (5, 5).
    const sorted = sortSprites([at(5, 9, 20), at(5, 5, 20), at(9, 9, 2)]);
    expect(sorted.map((p) => [p.x, p.y, p.layer])).toEqual([
      [9, 9, 2],
      [5, 5, 20],
      [5, 9, 20],
    ]);
  });
});
