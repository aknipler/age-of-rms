import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { commandAtOffset } from "../commandAtOffset";

const SCRIPT = [
  "<LAND_GENERATION>",
  "  base_terrain GRASS",
  "  create_land { terrain_type DIRT land_percent 10 }",
  "  /* a note between commands */",
  "  create_player_lands {",
  "    terrain_type DIRT",
  "  }",
  "<CLIFF_GENERATION>",
  "  min_number_of_cliffs 3",
  "  /* a cliff note */",
  "<TERRAIN_GENERATION>",
  "  create_terrain FOREST { base_terrain DIRT }",
  "  create_connect_all_lands { replace_terrain GRASS DIRT }",
  "<OBJECTS_GENERATION>",
  "  create_object GOLD { number_of_objects 4 }",
].join("\n");

describe("commandAtOffset", () => {
  const parse = parseRms(SCRIPT, loadLanguage());
  const at = (text: string, into = 0) => SCRIPT.indexOf(text) + into;
  const startOf = (text: string) => SCRIPT.indexOf(text);

  it("finds a command from its name", () => {
    expect(commandAtOffset(parse, at("create_land", 3))).toEqual({
      start: startOf("create_land"),
      kind: "land",
    });
    expect(commandAtOffset(parse, at("create_terrain FOREST", 2))).toEqual({
      start: startOf("create_terrain"),
      kind: "terrain",
    });
    expect(commandAtOffset(parse, at("create_object GOLD", 2))?.kind).toBe(
      "object",
    );
    expect(
      commandAtOffset(parse, at("create_connect_all_lands", 2))?.kind,
    ).toBe("connection");
  });

  it("counts an attribute line inside the block as its command", () => {
    expect(commandAtOffset(parse, at("terrain_type DIRT\n", 4))).toEqual({
      start: startOf("create_player_lands"),
      kind: "land",
    });
  });

  it("counts the closing brace as part of the command", () => {
    const brace = SCRIPT.indexOf("}", startOf("create_player_lands"));
    expect(commandAtOffset(parse, brace)?.kind).toBe("land");
  });

  it("is null between two commands and in a comment between commands", () => {
    expect(commandAtOffset(parse, at("/* a note between", 4))).toBeNull();
    // On the base_terrain line, which is not a command the highlight covers.
    expect(commandAtOffset(parse, at("base_terrain GRASS", 2))).toBeNull();
  });

  it("maps anywhere in the cliff section to the cliff entry", () => {
    const cliff = { start: -1, kind: "cliff" };
    expect(commandAtOffset(parse, at("min_number_of_cliffs", 3))).toEqual(
      cliff,
    );
    expect(commandAtOffset(parse, at("<CLIFF_GENERATION>", 3))).toEqual(cliff);
    expect(commandAtOffset(parse, at("/* a cliff note", 4))).toEqual(cliff);
  });
});
