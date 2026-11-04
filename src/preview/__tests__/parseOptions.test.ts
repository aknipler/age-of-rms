import { describe, expect, it } from "vitest";
import { parseOptionsFor } from "../generator/parseOptions";

const table = [
  { rmsConstant: "SHORE_FISH", constId: 69, category: "terrain" },
  { rmsConstant: "HOUSE", constId: 70, category: "building" },
  { rmsConstant: "GRASS", constId: 0, category: "terrain" },
  { rmsConstant: null, constId: 69, category: "terrain" },
];

describe("parseOptionsFor", () => {
  it("collects the words valued 69 and 70 and every ambient name", () => {
    const options = parseOptionsFor(table);
    expect([...(options.commentOpenAliases ?? [])]).toEqual(["SHORE_FISH"]);
    expect([...(options.commentCloseAliases ?? [])]).toEqual(["HOUSE"]);
    expect(options.builtinConstants?.has("GRASS")).toBe(true);
  });

  it("returns the same object for the same table and a new one for a new table", () => {
    expect(parseOptionsFor(table)).toBe(parseOptionsFor(table));
    expect(parseOptionsFor([...table])).not.toBe(parseOptionsFor(table));
  });
});
