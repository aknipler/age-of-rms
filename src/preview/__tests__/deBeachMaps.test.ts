// The automatic beach against DE itself.
//
// `fixtures/de-beach-maps.json` holds five maps DE generated, read back tile by
// tile from the saved scenarios with AoE2ScenarioParser. It is frozen measured
// data, and nothing in the repo regenerates it. Each map's BEACH tiles are turned back into the land terrain they
// were laid on, the preview's beach pass runs over the result, and every tile
// has to come out as DE left it. That isolates the beach rule from the land
// stage, so a land stage difference cannot hide or fake a beach difference.
//
// The maps were chosen to tell 4 connected adjacency from 8 connected. Straight
// coasts give the same sand either way. RMSTEST_75's border cuts run at 45
// degrees for 20 rows, and RMSTEST_52's coasts are ragged against both open
// water and shallows, and on those the two readings differ by 40 to 231 tiles.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../parser/__tests__/testUtils";
import type { ObjectConstant } from "../generator/objects";
import { createTileGrid } from "../generator/grid";
import { applyAutomaticBeach } from "../generator/terrains";

const constants: readonly ObjectConstant[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;

function terrainId(name: string): number {
  const row = constants.find(
    (c) => c.category === "terrain" && c.rmsConstant === name,
  );
  if (row?.constId == null) throw new Error(`no terrain ${name}`);
  return row.constId;
}

// The fixture's letters, as terrain ids. A Map rather than a lookup by name at
// each use, so an unexpected letter fails loudly in `decode` instead of
// quietly becoming some default terrain.
const ID_OF = new Map<string, number>([
  ["G", terrainId("GRASS")],
  ["R", terrainId("DIRT")],
  ["D", terrainId("DESERT")],
  ["W", terrainId("WATER")],
  ["S", terrainId("SHALLOW")],
  ["B", terrainId("BEACH")],
]);

interface DeBeachMap {
  name: string;
  note: string;
  dim: number;
  /** The letter of the terrain this map's beach was laid on. */
  land: string;
  /** DE's own BEACH count, stored so a reader sees the target without decoding. */
  beach: number;
  terrain: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "src",
      "preview",
      "__tests__",
      "fixtures",
      "de-beach-maps.json",
    ),
    "utf8",
  ),
) as { maps: DeBeachMap[] };

function decode(rle: string): string {
  let out = "";
  for (const m of rle.matchAll(/(\d+)(.)/g)) out += m[2].repeat(Number(m[1]));
  return out;
}

function idOf(letter: string): number {
  const id = ID_OF.get(letter);
  if (id === undefined) throw new Error(`unknown fixture letter ${letter}`);
  return id;
}

describe("the automatic beach matches DE tile for tile", () => {
  it("covers every saved map in the fixture", () => {
    expect(fixture.maps.length).toBe(5);
  });

  it.each(fixture.maps.map((m) => [m.name, m] as const))("%s", (_name, map) => {
    const expected = decode(map.terrain);
    expect(expected.length).toBe(map.dim * map.dim);
    const beach = idOf("B");
    const land = idOf(map.land);

    // DE's map before its beach, with every BEACH tile back on its land.
    const grid = createTileGrid(map.dim, land);
    for (let i = 0; i < expected.length; i++) {
      const id = idOf(expected[i]);
      grid.terrain[i] = id === beach ? land : id;
    }

    const written = applyAutomaticBeach(grid, constants);
    expect(written).toBe(map.beach);
    let differing = 0;
    for (let i = 0; i < expected.length; i++)
      if (grid.terrain[i] !== idOf(expected[i])) differing++;
    expect(differing, `${differing} tiles differ from DE`).toBe(0);
  });
});
