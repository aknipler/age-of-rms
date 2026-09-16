// consistency-checker-design.md Sec.3, Sec.8 item 1, the positive/negative
// fixture pairs for the checks that matter most: the Sec.3.1 boundary, the
// Sec.3.2 declaration forms and the #const-resolved-value soundness rule,
// Sec.3.3's tier-1 fork arms and the placeholder idiom, and Sec.3.4's two
// promoted contradictions. Not exhaustive against every fixture the design
// doc names, a representative slice, cross-checked against the real corpus
// by consistencyChecker.measure.test.ts's static-half table.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { buildLanguageIndex } from "../../../../parser/language";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import type { InstantiatedScript } from "../../../../preview/generator/types";
import type { PublishedGameConstant } from "../../../../../tools-api/index";
import {
  buildStaticContext,
  checkActorAreas,
  checkAllObjectTerrainPlacements,
  checkCliffsMinExceedsMax,
  checkLandOverAllocation,
  checkMinExceedsMaxObjects,
  computeTerrainSurface,
  runStaticChecks,
  type StaticContext,
} from "../staticChecks";
import type { ParseResult } from "../../../../parser/types";

const lang = loadLanguage();
const langIndex = buildLanguageIndex(lang);

function instantiate(
  source: string,
  playerCount = 4,
): { inst: InstantiatedScript; parse: ParseResult; ctx: StaticContext } {
  const parse = parseRms(source, lang);
  const inst = instantiateScript(
    parse,
    langIndex,
    { playerCount, mapSize: "Tiny", teams: [0, 0, 0, 0, 0, 0, 0, 0] },
    1,
  );
  const ctx = buildStaticContext(parse);
  return { inst, parse, ctx };
}

// A minimal, hand-built constants table, precise and independent of
// whatever the real game-constants.json happens to contain today.
const DEER: PublishedGameConstant = {
  constId: 65,
  rmsConstant: "DEER",
  descriptiveName: "Deer",
  category: "object",
  habitat: "land",
  allowedTerrains: [0, 2, 3], // GRASS, BEACH, DIRT, NOT water (1)
  verified: true,
};
const GRASS: PublishedGameConstant = {
  constId: 0,
  rmsConstant: "GRASS",
  descriptiveName: "Grass",
  category: "terrain",
  isWater: false,
  verified: true,
};
const WATER: PublishedGameConstant = {
  constId: 1,
  rmsConstant: "WATER",
  descriptiveName: "Water",
  category: "terrain",
  isWater: true,
  verified: true,
};
const SHORE_FISH_UNVERIFIED: PublishedGameConstant = {
  constId: 302,
  rmsConstant: "SHORE_FISH",
  descriptiveName: "Shore fish",
  category: "object",
  habitat: "water",
  allowedTerrains: [1],
  verified: false,
};
const CONSTANTS = [DEER, GRASS, WATER, SHORE_FISH_UNVERIFIED];

describe("Sec.3.1 land over-allocation", () => {
  it("does not warn exactly at the boundary (sum == dim*dim)", () => {
    // Tiny is 120x120 = 14400 tiles. Two lands at 50% each = 100% exactly.
    const { inst } = instantiate(
      "<LAND_GENERATION>\ncreate_land { land_percent 50 }\ncreate_land { land_percent 50 }",
    );
    expect(checkLandOverAllocation(inst)).toEqual([]);
  });

  it("warns one tile over the boundary", () => {
    const { inst } = instantiate(
      "<LAND_GENERATION>\ncreate_land { number_of_tiles 7201 }\ncreate_land { number_of_tiles 7200 }",
    );
    const findings = checkLandOverAllocation(inst);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    // The count is NOT in the text, it is stamped on the finding by
    // `runStaticChecks` and printed by the renderer only when the finding
    // does not hold at every selected count (Sec.5.1's collapse rule).
    expect(findings[0].text).not.toMatch(/\d+ players/);
    expect(findings[0].text).toContain("% of the map");
  });

  it("excludes a filler land (land_percent >= 100% of the map) from the sum", () => {
    const { inst } = instantiate(
      "<LAND_GENERATION>\ncreate_land { land_percent 10 }\ncreate_land { land_percent 100 }",
    );
    // 10% alone does not exceed the cap; the 100% land is a filler, excluded.
    expect(checkLandOverAllocation(inst)).toEqual([]);
  });

  it("the create_player_lands multiplier cancels — result is player-count invariant", () => {
    const source =
      "<LAND_GENERATION>\ncreate_player_lands { land_percent 30 }\ncreate_land { land_percent 80 }";
    const at2 = checkLandOverAllocation(instantiate(source, 2).inst);
    const at8 = checkLandOverAllocation(instantiate(source, 8).inst);
    expect(at2).toHaveLength(1);
    expect(at8).toHaveLength(1);
    // BYTE-identical now, with no normalising `replace` in the way, which is
    // the property Sec.5.1's cross-count collapse relies on.
    expect(at2[0].text).toBe(at8[0].text);
  });
});

describe("Sec.3.2 undefined actor areas", () => {
  it("form (a): create_actor_area declares, actor_area_to_place_in references — no finding", () => {
    const source = [
      "<PLAYER_SETUP>",
      "create_actor_area 0 0 7 0",
      "<OBJECTS_GENERATION>",
      "create_object DEER { actor_area_to_place_in 7 }",
    ].join("\n");
    const { inst, parse, ctx } = instantiate(source);
    expect(checkActorAreas(inst, parse, ctx)).toEqual([]);
  });

  it("form (b): an object's own actor_area attribute declares — no finding", () => {
    const source = [
      "<OBJECTS_GENERATION>",
      "create_object DEER { actor_area 7 }",
      "create_object DEER { actor_area_to_place_in 7 }",
    ].join("\n");
    const { inst, parse, ctx } = instantiate(source);
    expect(checkActorAreas(inst, parse, ctx)).toEqual([]);
  });

  it("undeclared actor_area_to_place_in is an ERROR", () => {
    const { inst, parse, ctx } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { actor_area_to_place_in 99 }",
    );
    const findings = checkActorAreas(inst, parse, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "actorAreaUndeclaredToPlaceIn",
      severity: "error",
    });
  });

  it("undeclared avoid_actor_area is INFO, not error — a silent no-op, not a placement failure", () => {
    const { inst, parse, ctx } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { avoid_actor_area 99 }",
    );
    const findings = checkActorAreas(inst, parse, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "actorAreaUndeclaredAvoid",
      severity: "info",
    });
  });

  it("resolves references and declarations by VALUE, never by token text — the false-positive the check exists to avoid", () => {
    const source = [
      "#const MY_AREA 7",
      "<PLAYER_SETUP>",
      "<OBJECTS_GENERATION>",
      "create_object DEER { actor_area MY_AREA }",
      "create_object DEER { actor_area_to_place_in 7 }",
    ].join("\n");
    const { inst, parse, ctx } = instantiate(source);
    // A token-text comparison would compare "MY_AREA" against 7 and find
    // nothing, producing a false guaranteed-undefined error.
    expect(checkActorAreas(inst, parse, ctx)).toEqual([]);
  });

  it("an id declared only inside an UNSELECTED start_random branch still counts (rule 1: every branch, selected or not)", () => {
    const source = [
      "<PLAYER_SETUP>",
      "start_random",
      "percent_chance 0 create_actor_area 0 0 7 0",
      "percent_chance 100 create_actor_area 0 0 8 0",
      "end_random",
      "<OBJECTS_GENERATION>",
      "create_object DEER { actor_area_to_place_in 7 }",
    ].join("\n");
    const { inst, parse, ctx } = instantiate(source);
    // id 7 sits in a branch this seed will not take; the declaration side
    // must still count it (over-generous by construction).
    expect(checkActorAreas(inst, parse, ctx)).toEqual([]);
  });
});

describe("Sec.3.3 terrain surface", () => {
  const terrainConstants = CONSTANTS.map((c) => ({
    ...c,
    constId: c.constId ?? null,
  }));
  const noConsts = { all: new Map(), first: new Map() };

  it("collects base_terrain, terrain_type and create_terrain's own terrain", () => {
    const source = [
      "<LAND_GENERATION>",
      "base_terrain GRASS",
      "create_land { terrain_type GRASS }",
      "<TERRAIN_GENERATION>",
      "create_terrain WATER { number_of_clumps 1 }",
    ].join("\n");
    const { inst, parse } = instantiate(source);
    const { surface } = computeTerrainSurface(
      parse,
      inst,
      terrainConstants,
      noConsts,
    );
    expect(surface.has(GRASS.constId!)).toBe(true);
    expect(surface.has(WATER.constId!)).toBe(true);
  });

  it("takes a terrain producer inside an UNTAKEN start_random branch (generous, per Sec.3.3's asymmetric rule)", () => {
    const source = [
      "<TERRAIN_GENERATION>",
      "start_random",
      "percent_chance 0 create_terrain WATER { number_of_clumps 1 }",
      "percent_chance 100 create_terrain GRASS { number_of_clumps 1 }",
      "end_random",
    ].join("\n");
    const { inst, parse } = instantiate(source);
    const { surface } = computeTerrainSurface(
      parse,
      inst,
      terrainConstants,
      noConsts,
    );
    expect(surface.has(WATER.constId!)).toBe(true); // untaken branch, still counted
    expect(surface.has(GRASS.constId!)).toBe(true); // taken branch
  });

  it("does NOT take a terrain producer inside an untaken if branch", () => {
    const source = [
      "<TERRAIN_GENERATION>",
      "if EMPIRE_WARS create_terrain WATER { number_of_clumps 1 } endif",
    ].join("\n");
    const { inst, parse } = instantiate(source);
    const { surface } = computeTerrainSurface(
      parse,
      inst,
      terrainConstants,
      noConsts,
    );
    expect(surface.has(WATER.constId!)).toBe(false);
  });

  it("takes a terrain producer inside a shared (orphan) block", () => {
    const source = [
      "<TERRAIN_GENERATION>",
      "if REGICIDE create_terrain GRASS { number_of_clumps 1 } else create_terrain GRASS { number_of_clumps 1 } endif",
      "{ base_terrain WATER }",
    ].join("\n");
    const { inst, parse } = instantiate(source);
    const { surface } = computeTerrainSurface(
      parse,
      inst,
      terrainConstants,
      noConsts,
    );
    expect(surface.has(WATER.constId!)).toBe(true);
  });
});

describe("Sec.3.3 terrain impossibility (tier 1: the exact engine table)", () => {
  it("create_object DEER { terrain_to_place_on WATER } warns — DEER's table has no water terrain", () => {
    // The named-terrain fork bullet reads allowedTerrains ∩ {that terrain}
    // only, it never consults the surface, so surfaceAbstained here is
    // irrelevant to this assertion and left true for clarity.
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { terrain_to_place_on WATER }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].text).toContain("exact terrain table");
  });

  it("create_object DEER { terrain_to_place_on GRASS } does not warn — GRASS is in DEER's table", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { terrain_to_place_on GRASS }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toEqual([]);
  });

  it("an object whose habitat is UNDECLARED is never checked against a named terrain — no data to narrow with", () => {
    const undeclared: PublishedGameConstant = {
      constId: 900,
      rmsConstant: "MYSTERY",
      descriptiveName: "Mystery",
      category: "object",
      verified: true,
    };
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object MYSTERY { terrain_to_place_on WATER }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: [...CONSTANTS, undeclared],
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toEqual([]);
  });

  it("verified: false downgrades the finding from warning to info (Sec.3.5)", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { terrain_to_place_on GRASS }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("ignore_terrain_restrictions WITH its prerequisite suppresses the check entirely", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { terrain_to_place_on WATER ignore_terrain_restrictions place_on_specific_land_id 1 }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toEqual([]);
  });

  it("ignore_terrain_restrictions WITHOUT its prerequisite is INERT — the check still fires (BUG-007's own shape)", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { terrain_to_place_on WATER ignore_terrain_restrictions }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toHaveLength(1);
  });

  it("an unresolvable named terrain reports nothing (positive-resolver rule) rather than falling through to the surface test", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { terrain_to_place_on SOME_UNDEFINED_NAME }",
    );
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(), // an empty surface would make the (forbidden) fallback warn
      surfaceAbstained: false,
      symbols: inst.symbols,
    });
    expect(findings).toEqual([]);
  });

  it("create_object_group is never checked, even when its members could not all share a habitat", () => {
    const source = [
      "<OBJECTS_GENERATION>",
      "create_object_group MYGROUP { add_object DEER }",
      "create_object MYGROUP { terrain_to_place_on WATER }",
    ].join("\n");
    const { inst } = instantiate(source);
    const findings = checkAllObjectTerrainPlacements(inst, {
      constants: CONSTANTS,
      terrainConstants: CONSTANTS.map((c) => ({
        ...c,
        constId: c.constId ?? null,
      })),
      surface: new Set(),
      surfaceAbstained: true,
      symbols: inst.symbols,
    });
    expect(findings).toEqual([]);
  });
});

describe("Sec.3.4 static contradictions (the two promoted comparisons)", () => {
  it("min_distance_to_players > max_distance_to_players is an ERROR", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { min_distance_to_players 10 max_distance_to_players 5 }",
    );
    const findings = checkMinExceedsMaxObjects(inst);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("min <= max reports nothing", () => {
    const { inst } = instantiate(
      "<OBJECTS_GENERATION>\ncreate_object DEER { min_distance_to_players 5 max_distance_to_players 10 }",
    );
    expect(checkMinExceedsMaxObjects(inst)).toEqual([]);
  });

  it("min_number_of_cliffs > max_number_of_cliffs is an ERROR naming the crash", () => {
    const { inst } = instantiate(
      "<CLIFF_GENERATION>\nmin_number_of_cliffs 20\nmax_number_of_cliffs 5",
    );
    const findings = checkCliffsMinExceedsMax(inst);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].text).toContain("crashes");
  });

  it("a min alone, exceeding the DEFAULTED maximum of 8, still fires and names the default", () => {
    const { inst } = instantiate("<CLIFF_GENERATION>\nmin_number_of_cliffs 9");
    const findings = checkCliffsMinExceedsMax(inst);
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toContain("default maximum of 8");
  });

  it("min 3 / max 8 written explicitly reports nothing", () => {
    const { inst } = instantiate(
      "<CLIFF_GENERATION>\nmin_number_of_cliffs 3\nmax_number_of_cliffs 8",
    );
    expect(checkCliffsMinExceedsMax(inst)).toEqual([]);
  });
});

describe("runStaticChecks — the whole layer together", () => {
  it("runs all five checks without throwing on an empty script", () => {
    const { inst, parse, ctx } = instantiate(
      "<PLAYER_SETUP>\nrandom_placement",
    );
    expect(() => runStaticChecks(inst, parse, CONSTANTS, ctx, 4)).not.toThrow();
    expect(runStaticChecks(inst, parse, CONSTANTS, ctx, 4)).toEqual([]);
  });
});
