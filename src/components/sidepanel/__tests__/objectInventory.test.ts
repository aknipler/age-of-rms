import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import type { PlacedObject } from "../../../preview/generator/types";
import { buildObjectInventory, tallySpawned } from "../objectInventory";

const lang = loadLanguage();
const parse = (source: string) => parseRms(source, lang);

/** A placement, with only the fields the inventory reads. */
function placed(objectRef: string, count: number): PlacedObject[] {
  return Array.from({ length: count }, (_, index) => ({
    objectRef,
    x: index,
    y: 0,
    category: "unit",
  }));
}

describe("tallySpawned", () => {
  it("counts each name separately", () => {
    const counts = tallySpawned([...placed("GOLD", 3), ...placed("BOAR", 1)]);
    expect(counts.get("GOLD")).toBe(3);
    expect(counts.get("BOAR")).toBe(1);
  });
});

describe("buildObjectInventory", () => {
  it("lists a create_object even when nothing was placed", () => {
    const result = buildObjectInventory(
      parse(`<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 }`),
      [],
    );
    expect(result).toEqual([{ objectRef: "GOLD", spawned: 0 }]);
  });

  it("counts what the generation placed", () => {
    const result = buildObjectInventory(
      parse(`<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 5 }`),
      placed("GOLD", 4),
    );
    expect(result).toEqual([{ objectRef: "GOLD", spawned: 4 }]);
  });

  it("lists group MEMBERS and not the group's own name", () => {
    // The distinguishing case: `create_object FOREST_MIX` writes a group name
    // in object position, and no placement ever carries that name — every one
    // of them is a member. A row for the group would always read 0.
    const result = buildObjectInventory(
      parse(
        `<OBJECTS_GENERATION>\n` +
          `create_object_group FOREST_MIX { add_object OAK_TREE add_object PINE_TREE }\n` +
          `create_object FOREST_MIX { number_of_objects 20 }`,
      ),
      placed("OAK_TREE", 12),
    );
    expect(result).toEqual([
      { objectRef: "OAK_TREE", spawned: 12 },
      { objectRef: "PINE_TREE", spawned: 0 },
    ]);
  });

  it("lists a second_object, which is usually the one that matters", () => {
    // guide:2211's placeholder idiom — the MAIN object is an invisible carrier
    // and the second object is the fish. Missing it would leave the object the
    // author cares about with no row and therefore no way to hide it.
    const result = buildObjectInventory(
      parse(
        `<OBJECTS_GENERATION>\n` +
          `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW second_object FISH }`,
      ),
      [],
    );
    expect(result.map((row) => row.objectRef)).toEqual(["FISH", "FISH_PLACEHOLDER"]);
  });

  it("collects names from inside if and start_random branches", () => {
    const result = buildObjectInventory(
      parse(
        `<OBJECTS_GENERATION>\n` +
          `if TINY_MAP\ncreate_object DEER { number_of_objects 4 }\n` +
          `else\ncreate_object BOAR { number_of_objects 4 }\nendif\n` +
          `start_random\npercent_chance 50 create_object GOLD { number_of_objects 4 }\nend_random`,
      ),
      [],
    );
    expect(result.map((row) => row.objectRef)).toEqual(["BOAR", "DEER", "GOLD"]);
  });

  it("keeps a placed object that the walk never found", () => {
    // The union's whole job: the checkboxes are keyed on these rows, so an
    // object the canvas draws but the table skipped would be undismissable.
    const result = buildObjectInventory(parse(`<OBJECTS_GENERATION>`), placed("RELIC", 2));
    expect(result).toEqual([{ objectRef: "RELIC", spawned: 2 }]);
  });

  it("returns nothing before the first parse", () => {
    expect(buildObjectInventory(null, [])).toEqual([]);
  });
});
