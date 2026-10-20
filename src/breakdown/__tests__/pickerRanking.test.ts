import { describe, expect, it } from "vitest";
import languageData from "../../../reference/data/language.json";
import { matchRank, rankByQuery } from "../pickerRanking";

const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("matchRank", () => {
  it("orders exact, prefix, in-name, then description-only", () => {
    const q = "land";
    const exact = matchRank({ name: "land" }, q);
    const prefix = matchRank({ name: "land_percent" }, q);
    const inName = matchRank({ name: "create_land" }, q);
    const inDescription = matchRank(
      { name: "base_terrain", description: "a land" },
      q,
    );
    expect(exact).toBeLessThan(prefix!);
    expect(prefix).toBeLessThan(inName!);
    expect(inName).toBeLessThan(inDescription!);
  });

  it("returns null when neither name nor description contains the query", () => {
    expect(matchRank({ name: "a", description: "b" }, "zzz")).toBeNull();
  });
});

describe("rankByQuery", () => {
  it("puts a name match above a description-only match that sorts earlier", () => {
    const items = [
      { name: "create_land", description: "Same as create_player_lands." },
      { name: "create_player_lands", description: "Makes player lands." },
    ];
    expect(names(rankByQuery(items, "player"))).toEqual([
      "create_player_lands",
      "create_land",
    ]);
  });

  it("sorts alphabetically within a rank", () => {
    const items = [{ name: "b_land" }, { name: "a_land" }, { name: "land_x" }];
    expect(names(rankByQuery(items, "land"))).toEqual([
      "land_x",
      "a_land",
      "b_land",
    ]);
  });

  it("falls back to alphabetical order for an empty or blank query", () => {
    const items = [{ name: "b" }, { name: "a" }];
    expect(names(rankByQuery(items, ""))).toEqual(["a", "b"]);
    expect(names(rankByQuery(items, "   "))).toEqual(["a", "b"]);
  });

  it("ignores case in the query and the name", () => {
    expect(names(rankByQuery([{ name: "Create_Land" }], "LAND"))).toEqual([
      "Create_Land",
    ]);
  });

  it("drops items that do not match", () => {
    expect(rankByQuery([{ name: "a", description: "b" }], "zzz")).toEqual([]);
  });

  it("ranks create_player_lands above create_land for 'player' in the real data", () => {
    const result = names(rankByQuery(languageData.commands, "player"));
    expect(result).toContain("create_land");
    expect(result.indexOf("create_player_lands")).toBeLessThan(
      result.indexOf("create_land"),
    );
  });
});
