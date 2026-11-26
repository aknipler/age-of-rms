import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { highlightFor } from "../commandHighlight";
import type { CommandTiles } from "../generator/commandTiles";

const SCRIPT = [
  "<TERRAIN_GENERATION>",
  "  create_terrain FOREST { base_terrain DIRT }",
  "<OBJECTS_GENERATION>",
  "  create_object GOLD { number_of_objects 4 }",
].join("\n");
const parse = parseRms(SCRIPT, loadLanguage());
const offset = SCRIPT.indexOf("create_object");
const terrainOffset = SCRIPT.indexOf("create_terrain");

const sets = (extra: Partial<CommandTiles>): CommandTiles[] => [
  { offset, kind: "object", first: new Uint32Array([1, 2, 3]), ...extra },
];
const terrainSets = (second: number[]): CommandTiles[] => [
  {
    offset: terrainOffset,
    kind: "terrain",
    first: new Uint32Array([1, 2, 3]),
    second: new Uint32Array(second),
  },
];

describe("highlightFor legend", () => {
  it("shows one row with the tile count for a single set", () => {
    const h = highlightFor(parse, offset + 2, sets({}));
    if (h.state !== "sets") throw new Error("expected sets");
    expect(h.legend).toHaveLength(1);
    expect(h.legend?.[0]).toMatchObject({ swatch: "first", tiles: 3 });
  });

  it("shows one row when both sets hold the same tiles", () => {
    const h = highlightFor(parse, terrainOffset + 2, terrainSets([1, 2, 3]));
    if (h.state !== "sets") throw new Error("expected sets");
    expect(h.second).toBeUndefined();
    expect(h.legend).toHaveLength(1);
  });

  it("shows two rows for two different sets", () => {
    const h = highlightFor(parse, terrainOffset + 2, terrainSets([1]));
    if (h.state !== "sets") throw new Error("expected sets");
    expect(h.legend).toHaveLength(2);
  });
});
