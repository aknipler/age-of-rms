// Sec.9 acceptance (slice-3 item 7): P2-P5 as pure predicates.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { checkP2, checkP3, checkP4, checkP5 } from "../preconditions";
import type { LandRole, RandomParam } from "../model";

const lang = loadLanguage();

function role(overrides: Partial<LandRole> = {}): LandRole {
  return {
    id: "r1",
    label: "Player",
    terrain: { k: "name", name: "GRASS" },
    baseSize: { k: "num", v: 10 },
    baseElevation: { k: "num", v: 0 },
    landPercent: { k: "num", v: 0 },
    zone: { kind: "none" },
    assignToPlayer: false,
    ...overrides,
  };
}

describe("P2 — a perPlayer random parameter pins a player count (Sec.4.4)", () => {
  it("ok when the live count matches what it was emitted for", () => {
    const params: RandomParam[] = [{ id: "p1", label: "VAR", min: -2, max: 2, perPlayer: true, emittedForPlayerCount: 4 }];
    expect(checkP2(params, 4).ok).toBe(true);
  });

  it("flags a mismatch when the live count has changed since emission", () => {
    const params: RandomParam[] = [{ id: "p1", label: "VAR", min: -2, max: 2, perPlayer: true, emittedForPlayerCount: 4 }];
    const result = checkP2(params, 6);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ paramId: "p1", label: "VAR", emittedFor: 4, livePlayerCount: 6 }]);
  });

  it("ignores a shared (non-perPlayer) param regardless of player count", () => {
    const params: RandomParam[] = [{ id: "p1", label: "ROT", min: -180, max: 180, perPlayer: false }];
    expect(checkP2(params, 8).ok).toBe(true);
  });

  it("ignores a perPlayer param that has never been emitted yet (no emittedForPlayerCount)", () => {
    const params: RandomParam[] = [{ id: "p1", label: "VAR", min: -2, max: 2, perPlayer: true }];
    expect(checkP2(params, 8).ok).toBe(true);
  });
});

describe("P3 — direct_placement for any player-assigned land (Sec.6.3)", () => {
  it("ok when no role assigns a player at all", () => {
    const result = checkP3([role({ assignToPlayer: false })], parseRms("<PLAYER_SETUP>\n", lang));
    expect(result.ok).toBe(true);
    expect(result.hasPlayerAssignedLand).toBe(false);
  });

  it("ok when a player-assigned role exists AND direct_placement is declared", () => {
    const parse = parseRms("<PLAYER_SETUP>\ndirect_placement\n", lang);
    const result = checkP3([role({ assignToPlayer: true })], parse);
    expect(result.ok).toBe(true);
    expect(result.hasPlayerAssignedLand).toBe(true);
    expect(result.directPlacementDeclared).toBe(true);
  });

  it("warns when a player-assigned role exists and direct_placement is NOT declared (the silent no-op Sec.6.3 names)", () => {
    const parse = parseRms("<PLAYER_SETUP>\n", lang);
    const result = checkP3([role({ assignToPlayer: true })], parse);
    expect(result.ok).toBe(false);
    expect(result.directPlacementDeclared).toBe(false);
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
    expect(result.model).toEqual({ v: 1, placements: [], roles: [], randomParams: [], groups: [] });
  });
});
