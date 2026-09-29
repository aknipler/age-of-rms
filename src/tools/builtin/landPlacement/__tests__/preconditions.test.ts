// Sec.9 acceptance (slice-3 item 7): P2-P5 as pure predicates.

import { describe, expect, it } from "vitest";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import {
  buildDirectPlacementFix,
  buildElevationSectionFix,
  checkP2,
  checkP3,
  checkP4,
  checkP5,
  checkP6,
} from "../preconditions";
import type { LandRole, Placement, RandomParam } from "../model";

const lang = loadLanguage();

function role(overrides: Partial<LandRole> = {}): LandRole {
  return {
    id: "r1",
    label: "Player",
    terrain: { k: "name", name: "GRASS" },
    baseSize: { k: "num", v: 10 },
    baseElevation: { k: "num", v: 0 },
    extent: { kind: "percent", value: { k: "num", v: 0 } },
    zone: { kind: "none" },
    assign: { kind: "none" },
    ...overrides,
  };
}

describe("P2 — a perPlayer random parameter pins a player count (Sec.4.4)", () => {
  it("ok when the live count matches what it was emitted for", () => {
    const params: RandomParam[] = [
      {
        id: "p1",
        label: "VAR",
        min: -2,
        max: 2,
        perPlayer: true,
        emittedForPlayerCount: 4,
      },
    ];
    expect(checkP2(params, 4).ok).toBe(true);
  });

  it("flags a mismatch when the live count has changed since emission", () => {
    const params: RandomParam[] = [
      {
        id: "p1",
        label: "VAR",
        min: -2,
        max: 2,
        perPlayer: true,
        emittedForPlayerCount: 4,
      },
    ];
    const result = checkP2(params, 6);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { paramId: "p1", label: "VAR", emittedFor: 4, livePlayerCount: 6 },
    ]);
  });

  it("ignores a shared (non-perPlayer) param regardless of player count", () => {
    const params: RandomParam[] = [
      { id: "p1", label: "ROT", min: -180, max: 180, perPlayer: false },
    ];
    expect(checkP2(params, 8).ok).toBe(true);
  });

  it("ignores a perPlayer param that has never been emitted yet (no emittedForPlayerCount)", () => {
    const params: RandomParam[] = [
      { id: "p1", label: "VAR", min: -2, max: 2, perPlayer: true },
    ];
    expect(checkP2(params, 8).ok).toBe(true);
  });
});

describe("P3 — direct_placement for any player-assigned land (Sec.6.3)", () => {
  it("ok when no role assigns a player at all", () => {
    const result = checkP3(
      [role({ assign: { kind: "none" } })],
      parseRms("<PLAYER_SETUP>\n", lang),
    );
    expect(result.ok).toBe(true);
    expect(result.hasPlayerAssignedLand).toBe(false);
  });

  it("ok when a player-assigned role exists AND direct_placement is declared", () => {
    const parse = parseRms("<PLAYER_SETUP>\ndirect_placement\n", lang);
    const result = checkP3(
      [role({ assign: ASSIGN_TO_PLAYER_PER_REPEAT })],
      parse,
    );
    expect(result.ok).toBe(true);
    expect(result.hasPlayerAssignedLand).toBe(true);
    expect(result.directPlacementDeclared).toBe(true);
  });

  it("warns when a player-assigned role exists and direct_placement is NOT declared (the silent no-op Sec.6.3 names)", () => {
    const parse = parseRms("<PLAYER_SETUP>\n", lang);
    const result = checkP3(
      [role({ assign: ASSIGN_TO_PLAYER_PER_REPEAT })],
      parse,
    );
    expect(result.ok).toBe(false);
    expect(result.directPlacementDeclared).toBe(false);
  });

  it("an AT_TEAM or assign_to_player assignment is a player-assigned land too, the guide's rule is about ownership not spelling", () => {
    const parse = parseRms("<PLAYER_SETUP>" + String.fromCharCode(10), lang);
    const team = role({
      assign: {
        kind: "assignTo",
        target: "AT_TEAM",
        number: { kind: "perRepeat", base: 1, step: 1 },
        mode: 0,
        flags: 0,
      },
    });
    expect(checkP3([team], parse).ok).toBe(false);
    const byPlayer = role({
      assign: {
        kind: "player",
        number: { kind: "fixed", value: { k: "num", v: 3 } },
      },
    });
    expect(checkP3([byPlayer], parse).ok).toBe(false);
  });
});

describe("P4 — emitted names must not collide (Sec.5.6)", () => {
  it("ok when candidate names avoid both the script's own symbols and language.json's vocabulary", () => {
    const parse = parseRms("#const EXISTING 1\n", lang);
    const result = checkP4(["ALP_X_P1"], parse, lang);
    expect(result.ok).toBe(true);
  });

  it("flags a candidate colliding with a script-defined symbol", () => {
    const parse = parseRms("#const ALP_X_P1 1\n", lang);
    const result = checkP4(["ALP_X_P1"], parse, lang);
    expect(result.ok).toBe(false);
    expect(result.collisions).toEqual(["ALP_X_P1"]);
  });

  it("flags a candidate colliding with language.json vocabulary (a real command name)", () => {
    const parse = parseRms("", lang);
    const result = checkP4(["create_land"], parse, lang);
    expect(result.ok).toBe(false);
    expect(result.collisions).toEqual(["create_land"]);
  });
});

describe("P5 — the fence's @alp-model must parse (Sec.6.1)", () => {
  it("ok: false with no association when there is no fence at all", () => {
    const result = checkP5(parseRms("#const A 1\n", lang));
    expect(result.ok).toBe(false);
    expect(result.model).toBeNull();
  });

  it("ok: true, model populated, for a well-formed fence", () => {
    const source = `/* @alp v1 begin — x.\n   @alp-model {"v":1,"placements":[],"roles":[],"randomParams":[],"groups":[]} */\n/* @alp end */\n`;
    const result = checkP5(parseRms(source, lang));
    expect(result.ok).toBe(true);
    expect(result.model).toEqual({
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    });
  });
});

describe("P6 — <ELEVATION_GENERATION> must exist when any land carries base_elevation (role-attributes-escalation.md Sec.8)", () => {
  const land: Placement = {
    id: "L",
    parent: "center",
    frame: "radial",
    label: "L",
    role: "r",
    offset: {
      kind: "polar",
      r: { k: "num", v: 10 },
      theta: { k: "num", v: 0 },
    },
  };
  const NL = String.fromCharCode(10);

  it("red on a script with no section, green on an EMPTY one, and not needed when no land wears a role", () => {
    const without = parseRms(`<PLAYER_SETUP>${NL}<LAND_GENERATION>${NL}`, lang);
    expect(checkP6([land], without)).toEqual({
      ok: false,
      needsSection: true,
      sectionDeclared: false,
    });
    const withEmpty = parseRms(
      `<PLAYER_SETUP>${NL}<LAND_GENERATION>${NL}<ELEVATION_GENERATION>${NL}`,
      lang,
    );
    expect(checkP6([land], withEmpty).ok).toBe(true);
    expect(checkP6([{ ...land, role: undefined }], without)).toEqual({
      ok: true,
      needsSection: false,
      sectionDeclared: false,
    });
  });

  it("the one-click fix inserts the section after the last land section, and the check then passes", () => {
    const source = `<PLAYER_SETUP>${NL}<LAND_GENERATION>${NL}create_land { land_percent 5 }${NL}<OBJECTS_GENERATION>${NL}`;
    const parse = parseRms(source, lang);
    const [edit] = buildElevationSectionFix(parse);
    const fixed =
      source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
    const reparsed = parseRms(fixed, lang);
    expect(checkP6([land], reparsed).ok).toBe(true);
    expect(reparsed.script.sections.map((s) => s.name)).toEqual([
      "PLAYER_SETUP",
      "LAND_GENERATION",
      "ELEVATION_GENERATION",
      "OBJECTS_GENERATION",
    ]);
    // The land section's own content is untouched.
    expect(fixed).toContain(`create_land { land_percent 5 }${NL}`);
    // No land section at all: appended at the end, still one clean section.
    const bare = parseRms("#const X 1", lang);
    const [e2] = buildElevationSectionFix(bare);
    const fixed2 =
      "#const X 1".slice(0, e2.start) + e2.newText + "#const X 1".slice(e2.end);
    expect(parseRms(fixed2, lang).script.sections.map((s) => s.name)).toEqual([
      "ELEVATION_GENERATION",
    ]);
  });
});

describe("P3's one-click fix, buildDirectPlacementFix", () => {
  const NL = String.fromCharCode(10);
  const player = role({ assign: ASSIGN_TO_PLAYER_PER_REPEAT });

  it("writes direct_placement on its own line under an existing <PLAYER_SETUP>, and P3 then passes", () => {
    const source = `#const A 1${NL}<PLAYER_SETUP>${NL}random_placement${NL}<LAND_GENERATION>${NL}`;
    const parse = parseRms(source, lang);
    expect(checkP3([player], parse).ok).toBe(false);
    const [edit] = buildDirectPlacementFix(parse);
    const fixed =
      source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
    expect(fixed).toBe(
      `#const A 1${NL}<PLAYER_SETUP>${NL}direct_placement${NL}random_placement${NL}<LAND_GENERATION>${NL}`,
    );
    expect(checkP3([player], parseRms(fixed, lang)).ok).toBe(true);
  });

  it("opens a <PLAYER_SETUP> before the first section when there is none, keeping the preamble where it is", () => {
    const source = `#const A 1${NL}<LAND_GENERATION>${NL}`;
    const parse = parseRms(source, lang);
    const [edit] = buildDirectPlacementFix(parse);
    const fixed =
      source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
    const reparsed = parseRms(fixed, lang);
    expect(reparsed.script.sections.map((s) => s.name)).toEqual([
      "PLAYER_SETUP",
      "LAND_GENERATION",
    ]);
    expect(fixed.startsWith(`#const A 1${NL}`)).toBe(true);
    expect(checkP3([player], reparsed).ok).toBe(true);
  });
});
