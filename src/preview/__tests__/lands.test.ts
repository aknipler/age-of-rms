import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createTileGrid, tileIndex } from "../generator/grid";
import {
  placeLandOrigins,
  growLands,
  paintLandTerrain,
  applyBaseElevation,
  bucketWeights,
  reservoirSize,
  type LandPlacementResult,
} from "../generator/lands";
import type { LandOrigin, TileGrid } from "../generator/types";
import type { ObjectConstant } from "../generator/objects";
import { DEFAULT_TEAMS, type MapSize, type TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);
const constants: readonly ObjectConstant[] = (
  JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as { constants: ObjectConstant[] }
).constants;
const GRASS = 0;

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

function place(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]): LandPlacementResult & { dim: number } {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  const result = placeLandOrigins(instantiated, grid, constants, seed);
  return { ...result, dim: instantiated.dim };
}

function distance(a: LandOrigin, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function placeAndGrow(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]): LandPlacementResult & { dim: number; grid: TileGrid } {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  const result = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(result.origins, grid, result.reports, seed);
  return { ...result, dim: instantiated.dim, grid };
}

function placeGrowElevate(
  source: string,
  seed = 1,
  overrides?: Parameters<typeof settings>[0],
): LandPlacementResult & { dim: number; grid: TileGrid; elevationNotes: LandPlacementResult["notes"] } {
  const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(overrides), seed);
  const grid = createTileGrid(instantiated.dim, GRASS);
  const result = placeLandOrigins(instantiated, grid, constants, seed);
  growLands(result.origins, grid, result.reports, seed);
  const elevationNotes = applyBaseElevation(instantiated, result.origins, grid, constants);
  return { ...result, dim: instantiated.dim, grid, elevationNotes };
}

function ownedCount(grid: TileGrid, landIndex: number): number {
  let n = 0;
  for (let i = 0; i < grid.landId.length; i++) if (grid.landId[i] === landIndex) n++;
  return n;
}

/** 4-connected component count for one land's owned tiles — the same connectivity RMSTEST_38 measured against. */
function countComponents(grid: TileGrid, landIndex: number): number {
  const { dim } = grid;
  const visited = new Uint8Array(dim * dim);
  let components = 0;
  for (let start = 0; start < dim * dim; start++) {
    if (grid.landId[start] !== landIndex || visited[start]) continue;
    components++;
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % dim;
      const y = (i - x) / dim;
      const neighbors = [x > 0 ? i - 1 : -1, x < dim - 1 ? i + 1 : -1, y > 0 ? i - dim : -1, y < dim - 1 ? i + dim : -1];
      for (const n of neighbors) {
        if (n >= 0 && grid.landId[n] === landIndex && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
  }
  return components;
}

describe("neutral (unassigned) create_land origin", () => {
  it("places exactly at land_position, rounded then clamped to [0, dim-1]", () => {
    const { origins, dim } = place("<LAND_GENERATION>\ncreate_land {\nland_position 50 50\n}\n");
    expect(origins).toHaveLength(1);
    expect(origins[0].x).toBe(Math.round(dim / 2));
    expect(origins[0].y).toBe(Math.round(dim / 2));
    expect(origins[0].fromOriginFallback).toBe(false);
  });

  it("clamps land_position 100 100 to dim-1, not dim (Michi.rms fix)", () => {
    const { origins, dim } = place("<LAND_GENERATION>\ncreate_land {\nland_position 100 100\n}\n");
    expect(origins[0].x).toBe(dim - 1);
    expect(origins[0].y).toBe(dim - 1);
  });

  it("a random-sampled origin always lands inside the border bounds and the cross-shape region", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { origins, dim } = place("<LAND_GENERATION>\ncreate_land {\nbase_size 3\n}\n", seed);
      const origin = origins[0];
      expect(origin.fromOriginFallback).toBe(false);
      expect(origin.x).toBeGreaterThanOrEqual(0);
      expect(origin.x).toBeLessThan(dim);
      const center = dim / 2;
      const crossHalf = 0.35 * (dim / 2);
      const cornered = Math.abs(origin.x - center) > crossHalf && Math.abs(origin.y - center) > crossHalf;
      expect(cornered).toBe(false);
    }
  });

  it("generate_mode 1 disables the cross-shape restriction (corners become reachable across enough seeds)", () => {
    let sawCorner = false;
    for (let seed = 1; seed <= 60; seed++) {
      const { origins, dim } = place("<LAND_GENERATION>\ncreate_land {\nbase_size 3\ngenerate_mode 1\n}\n", seed);
      const center = dim / 2;
      const crossHalf = 0.35 * (dim / 2);
      const origin = origins[0];
      if (Math.abs(origin.x - center) > crossHalf && Math.abs(origin.y - center) > crossHalf) sawCorner = true;
    }
    expect(sawCorner).toBe(true);
  });

  it("falls back to the map center and reports originFallbackCenter when min_placement_distance makes every candidate too close to a prior origin", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_land {\nland_position 20 20\n}",
      "create_land {\nmin_placement_distance 100000\n}",
    ].join("\n");
    const { origins, reports, dim } = place(source);
    expect(origins).toHaveLength(2);
    const second = origins[1];
    expect(second.fromOriginFallback).toBe(true);
    expect(second.x).toBe(Math.round(dim / 2));
    expect(second.y).toBe(Math.round(dim / 2));
    const secondReport = reports[1];
    expect(secondReport.failures.some((f) => f.bucket === "originFallbackCenter")).toBe(true);
  });

  it("one CommandReport per create_land, attempted=1, placed=1 even on fallback", () => {
    const { reports } = place("<LAND_GENERATION>\ncreate_land {\nland_position 50 50\n}\n");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ attempted: 1, placed: 1 });
  });
});

describe("player lands (create_player_lands) ring", () => {
  it("default ring: evenly spaced, roughly the measured 40% radius, centered near the map center", () => {
    const { origins, dim } = place("<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_player_lands {\nbase_size 3\n}\n", 7, {
      playerCount: 8,
    });
    expect(origins).toHaveLength(8);
    const center = { x: dim / 2, y: dim / 2 };
    const radii = origins.map((o) => distance(o, center));
    const meanRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    // Nominal 40% +/- 10% variance, so the mean across 8 draws should sit
    // comfortably within that band rather than needing an exact figure.
    expect(meanRadius).toBeGreaterThan(0.25 * dim);
    expect(meanRadius).toBeLessThan(0.55 * dim);
    for (const origin of origins) expect(origin.player).toBeGreaterThanOrEqual(1);
  });

  it("explicit circle_radius R with variance 0 puts every player at EXACTLY radius R, no jitter", () => {
    const { origins, dim } = place(
      "<LAND_GENERATION>\ncreate_player_lands {\ncircle_radius 30 0\n}\n",
      3,
      { playerCount: 4 },
    );
    const center = { x: dim / 2, y: dim / 2 };
    for (const origin of origins) {
      expect(distance(origin, center)).toBeCloseTo(0.3 * dim, 0);
    }
  });

  it("circle_radius 0 behaves EXACTLY as if the attribute were absent, for the same seed", () => {
    const withZero = place("<LAND_GENERATION>\ncreate_player_lands {\ncircle_radius 0\n}\n", 5, { playerCount: 4 });
    const withoutAttr = place("<LAND_GENERATION>\ncreate_player_lands {\n}\n", 5, { playerCount: 4 });
    expect(withZero.origins.map((o) => [o.x, o.y])).toEqual(withoutAttr.origins.map((o) => [o.x, o.y]));
  });

  it("negative circle_radius scatters origins (not a perfect ring) but keeps them on the grid", () => {
    const { origins, dim } = place(
      "<LAND_GENERATION>\ncreate_player_lands {\ncircle_radius -20\n}\n",
      11,
      { playerCount: 8 },
    );
    for (const origin of origins) {
      expect(origin.x).toBeGreaterThanOrEqual(0);
      expect(origin.x).toBeLessThan(dim);
      expect(origin.y).toBeGreaterThanOrEqual(0);
      expect(origin.y).toBeLessThan(dim);
    }
    // Scattered, not annular: radii should NOT all cluster on one value the
    // way the positive-radius/variance-0 case does.
    const center = { x: dim / 2, y: dim / 2 };
    const radii = origins.map((o) => distance(o, center));
    const spread = Math.max(...radii) - Math.min(...radii);
    expect(spread).toBeGreaterThan(0.05 * dim);
  });

  it("grouped_by_team clusters teammates together rather than spacing everyone evenly", () => {
    // 4v4: teams 1,1,1,1,2,2,2,2.
    const teams: TeamNumber[] = [1, 1, 1, 1, 2, 2, 2, 2];
    const { origins, dim } = place(
      "<PLAYER_SETUP>\ngrouped_by_team\n<LAND_GENERATION>\ncreate_player_lands {\nbase_size 3\n}\n",
      13,
      { playerCount: 8, teams },
    );
    const center = { x: dim / 2, y: dim / 2 };
    const angleOf = (o: LandOrigin) => Math.atan2(o.y - center.y, o.x - center.x);
    const team1Angles = origins.filter((o) => o.player! <= 4).map(angleOf);
    const team2Angles = origins.filter((o) => o.player! >= 5).map(angleOf);
    const spread = (angles: number[]) => {
      const sorted = [...angles].sort((a, b) => a - b);
      let max = 0;
      for (let i = 1; i < sorted.length; i++) max = Math.max(max, sorted[i] - sorted[i - 1]);
      return max;
    };
    // Within a 4-member team the angular spread end-to-end should be a small
    // fraction of the circle; if members were spaced evenly around the WHOLE
    // ring instead, adjacent-within-team gaps would be ~45 degrees each.
    const team1Span = Math.max(...team1Angles) - Math.min(...team1Angles);
    const team2Span = Math.max(...team2Angles) - Math.min(...team2Angles);
    expect(team1Span).toBeLessThan((60 * Math.PI) / 180);
    expect(team2Span).toBeLessThan((60 * Math.PI) / 180);
    void spread;
  });

  it("direct_placement uses create_player_lands' own land_position for every player", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\ncreate_player_lands {\nland_position 25 75\n}\n";
    const { origins, dim } = place(source, 1, { playerCount: 3 });
    const expectedX = Math.round(0.25 * dim);
    const expectedY = Math.round(0.75 * dim);
    for (const origin of origins) {
      expect(origin.x).toBe(expectedX);
      expect(origin.y).toBe(expectedY);
    }
  });

  it("one CommandReport for the whole create_player_lands command, attempted=playerCount", () => {
    const { reports } = place("<LAND_GENERATION>\ncreate_player_lands {\n}\n", 1, { playerCount: 5 });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ attempted: 5, placed: 5 });
  });
});

describe("zone assignment (Sec.6.1)", () => {
  it("player lands default to zone playerNumber - 10", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_player_lands {\n}\n", 1, { playerCount: 3 });
    const byPlayer = new Map(origins.map((o) => [o.player, o.zone]));
    expect(byPlayer.get(1)).toBe(-9);
    expect(byPlayer.get(2)).toBe(-8);
    expect(byPlayer.get(3)).toBe(-7);
  });

  it("neutral create_land defaults to the shared zone -10", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nland_position 10 10\n}\n");
    expect(origins[0].zone).toBe(-10);
  });

  it("an explicit zone attribute wins over any default", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nzone 42\n}\n");
    expect(origins[0].zone).toBe(42);
  });

  it("set_zone_by_team always reads PLAYER 1's canonical team, even on an unassigned neutral land (guide:1055's footgun)", () => {
    const teams: TeamNumber[] = [3, 3, 0, 0, 0, 0, 0, 0]; // player 1+2 on selected team 3 -> canonical team 1
    const { origins } = place(
      "<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nset_zone_by_team\n}\n",
      1,
      { playerCount: 8, teams },
    );
    expect(origins[0].zone).toBe(1 - 9); // canonical team 1 -> -8
  });

  it("set_zone_randomly draws from [-8, playerCount-9], deterministically for a given seed", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nset_zone_randomly\n}\n", 3, {
      playerCount: 6,
    });
    expect(origins[0].zone).toBeGreaterThanOrEqual(-8);
    expect(origins[0].zone).toBeLessThanOrEqual(6 - 9);
    const again = place("<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nset_zone_randomly\n}\n", 3, {
      playerCount: 6,
    });
    expect(again.origins[0].zone).toBe(origins[0].zone);
  });
});

describe("origin stamp", () => {
  it("stamps a (2*base_size+1) square by default", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\n}\n");
    // 2*2+1 = 5-wide square: base_size is stored, the stamp itself is
    // verified via the grid in the next test (this one just checks the
    // record base_size survives resolution unchanged).
    expect(origins[0].baseSize).toBe(2);
    expect(origins[0].circularBase).toBe(false);
  });

  it("a square stamp claims its corner tiles; a circular stamp (set_circular_base) does not", () => {
    const squareSource = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\n}\n";
    const circularSource = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nset_circular_base\n}\n";
    const instantiatedSquare = instantiateScript(parseRms(squareSource, lang), refDb, settings(), 1);
    const gridSquare = createTileGrid(instantiatedSquare.dim, GRASS);
    placeLandOrigins(instantiatedSquare, gridSquare, constants, 1);
    const instantiatedCircle = instantiateScript(parseRms(circularSource, lang), refDb, settings(), 1);
    const gridCircle = createTileGrid(instantiatedCircle.dim, GRASS);
    placeLandOrigins(instantiatedCircle, gridCircle, constants, 1);

    const ox = Math.round(instantiatedSquare.dim / 2);
    const oy = Math.round(instantiatedSquare.dim / 2);
    const cornerIndex = tileIndex(gridSquare, ox + 3, oy + 3);
    expect(gridSquare.landId[cornerIndex]).toBe(0); // square: corner claimed
    expect(gridCircle.landId[cornerIndex]).toBe(-1); // circle: corner NOT claimed (dx=dy=3, 3^2+3^2=18 > 3^2=9)
  });

  it("later origins overwrite earlier overlapping stamps ('the land placed last will be the one visible')", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 5\n}\ncreate_land {\nland_position 50 50\nbase_size 2\n}\n";
    const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(), 1);
    const grid = createTileGrid(instantiated.dim, GRASS);
    placeLandOrigins(instantiated, grid, constants, 1);
    const center = tileIndex(grid, Math.round(instantiated.dim / 2), Math.round(instantiated.dim / 2));
    expect(grid.landId[center]).toBe(1); // the SECOND land, not the first
  });
});

describe("assign_to / assign_to_player (Sec.6.1)", () => {
  it("assign_to_player takes a ring slot and ignores land_position (guide:1016)", () => {
    const { origins, dim } = place(
      "<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nassign_to_player 1\n}\n",
      1,
      { playerCount: 2 },
    );
    expect(origins).toHaveLength(1);
    expect(origins[0].player).toBe(1);
    // land_position 10 10 on this dim would be near (dim*0.1, dim*0.1); the
    // ring instead centers roughly on the map, so it must land far from that.
    const ignoredX = Math.round(0.1 * dim);
    const ignoredY = Math.round(0.1 * dim);
    expect(Math.hypot(origins[0].x - ignoredX, origins[0].y - ignoredY)).toBeGreaterThan(dim * 0.1);
  });

  it("direct_placement restores land_position on an assigned land (guide:1016's exception)", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\ncreate_land {\nland_position 10 10\nassign_to_player 1\n}\n";
    const { origins, dim } = place(source, 1, { playerCount: 2 });
    expect(origins[0].x).toBe(Math.round(0.1 * dim));
    expect(origins[0].y).toBe(Math.round(0.1 * dim));
  });

  it("a land assigned to a non-playing player is not created (guide:1015)", () => {
    const { origins, reports, notes } = place(
      "<LAND_GENERATION>\ncreate_land {\nassign_to_player 6\n}\n",
      1,
      { playerCount: 4 },
    );
    expect(origins).toHaveLength(0);
    expect(reports[0]).toMatchObject({ attempted: 1, placed: 0 });
    expect(notes.some((n) => n.key.startsWith("landNotCreated:"))).toBe(true);
  });

  it("AT_PLAYER and AT_COLOR resolve to the same player; AT_COLOR notes the difference", () => {
    const atPlayer = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_PLAYER 2 -1 0\n}\n", 1, { playerCount: 4 });
    expect(atPlayer.origins[0].player).toBe(2);
    expect(atPlayer.notes.some((n) => n.key.startsWith("atColor:"))).toBe(false);

    const atColor = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_COLOR 2 -1 0\n}\n", 1, { playerCount: 4 });
    expect(atColor.origins[0].player).toBe(2);
    expect(atColor.notes.some((n) => n.key.startsWith("atColor:"))).toBe(true);
  });

  it("AT_TEAM with a positive n resolves to a player from that canonical team", () => {
    const teams: TeamNumber[] = [1, 1, 0, 0, 0, 0, 0, 0]; // players 1-2 canonical team 1
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 1 -1 0\n}\n", 1, {
      playerCount: 4,
      teams,
    });
    expect([1, 2]).toContain(origins[0].player);
  });

  it("AT_TEAM 0 resolves to an un-teamed player", () => {
    const teams: TeamNumber[] = [1, 1, 0, 0, 0, 0, 0, 0];
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 0 -1 0\n}\n", 1, {
      playerCount: 4,
      teams,
    });
    expect([3, 4]).toContain(origins[0].player);
  });

  it("AT_TEAM negative n (not -10) resolves to a player NOT on that team", () => {
    const teams: TeamNumber[] = [1, 1, 2, 2, 0, 0, 0, 0];
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM -1 -1 0\n}\n", 1, {
      playerCount: 4,
      teams,
    });
    // canonical team 1 is players 1-2; "-1" excludes them, leaving 3 and 4.
    expect([3, 4]).toContain(origins[0].player);
  });

  it("AT_TEAM -10 accepts any player", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM -10 -1 0\n}\n", 1, {
      playerCount: 4,
    });
    expect(origins[0].player).toBeGreaterThanOrEqual(1);
    expect(origins[0].player).toBeLessThanOrEqual(4);
  });

  it("remembers assigned players: two AT_TEAM commands for the same team never resolve to the same player", () => {
    const teams: TeamNumber[] = [1, 1, 0, 0, 0, 0, 0, 0];
    const source = "<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 1 -1 0\n}\ncreate_land {\nassign_to AT_TEAM 1 -1 0\n}\n";
    const { origins } = place(source, 1, { playerCount: 4, teams });
    expect(origins).toHaveLength(2);
    expect(origins[0].player).not.toBe(origins[1].player);
    expect([origins[0].player, origins[1].player].sort()).toEqual([1, 2]);
  });

  it("Mode -1 picks lobby order (lowest eligible player); Mode 0 draws from the S1 substream", () => {
    const teams: TeamNumber[] = [1, 1, 1, 0, 0, 0, 0, 0];
    const lobbyOrder = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 1 -1 0\n}\n", 1, {
      playerCount: 4,
      teams,
    });
    expect(lobbyOrder.origins[0].player).toBe(1); // lowest of {1,2,3}

    // Mode 0 (random): sweep seeds and confirm it sometimes picks something
    // OTHER than the lobby-order answer -- proving it actually draws rather
    // than silently behaving like Mode -1.
    let sawNonLobbyOrder = false;
    for (let seed = 1; seed <= 20; seed++) {
      const result = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 1 0 0\n}\n", seed, {
        playerCount: 4,
        teams,
      });
      if (result.origins[0].player !== 1) sawNonLobbyOrder = true;
    }
    expect(sawNonLobbyOrder).toBe(true);
  });

  it("a non-zero Flags argument is noted as unmodelled", () => {
    const { notes } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_PLAYER 1 -1 1\n}\n", 1, { playerCount: 2 });
    expect(notes.some((n) => n.key.startsWith("assignFlags:"))).toBe(true);
  });

  it("an AT_TEAM domain with no eligible player left is not created", () => {
    // Only 2 players, both on canonical team 1 -- AT_TEAM 0 (un-teamed) has no candidate.
    const teams: TeamNumber[] = [1, 1, 0, 0, 0, 0, 0, 0];
    const { origins, notes } = place("<LAND_GENERATION>\ncreate_land {\nassign_to AT_TEAM 0 -1 0\n}\n", 1, {
      playerCount: 2,
      teams,
    });
    expect(origins).toHaveLength(0);
    expect(notes.some((n) => n.key.startsWith("landNotCreated:"))).toBe(true);
  });

  it("integrates into ONE shared ring with create_player_lands: N+1 evenly spaced slots, not N slots plus an overlap", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_player_lands {\ncircle_radius 30 0\n}",
      "create_land {\ncircle_radius 30 0\nassign_to_player 1\n}",
    ].join("\n");
    const { origins, dim } = place(source, 1, { playerCount: 2 });
    // 2 implicit + 1 extra = 3 ring members, at radius 0.3*dim each (both
    // commands specify the same explicit radius), so all three should sit
    // at approximately that radius from the map center regardless of which
    // command each came from.
    expect(origins).toHaveLength(3);
    const center = { x: dim / 2, y: dim / 2 };
    for (const o of origins) {
      expect(distance(o, center)).toBeCloseTo(0.3 * dim, -1);
    }
  });

  it("grouped_by_team: an assigned extra land hits guide:857's documented bug instead of a working ring slot", () => {
    const teams: TeamNumber[] = [1, 1, 1, 1, 2, 2, 2, 2];
    const source = [
      "<PLAYER_SETUP>",
      "grouped_by_team",
      "<LAND_GENERATION>",
      "create_player_lands {\n}",
      "create_land {\nassign_to_player 1\n}",
    ].join("\n");
    const { origins, reports, dim } = place(source, 1, { playerCount: 8, teams });
    expect(origins).toHaveLength(9); // 8 implicit + 1 extra
    const extra = origins[8];
    expect(extra.player).toBe(1);
    expect(extra.x).toBe(Math.round(dim / 2));
    expect(extra.y).toBe(Math.round(dim / 2));
    const extraReport = reports.find((r) => r.commandSpan.start !== reports[0].commandSpan.start);
    expect(extraReport?.failures.some((f) => f.bucket === "notSimulated")).toBe(true);
  });

  it("a standalone assign_to'd land (no create_player_lands at all) still gets ring-placed, not treated as neutral", () => {
    const { origins, dim } = place("<LAND_GENERATION>\ncreate_land {\nland_position 5 5\nassign_to_player 1\n}\n", 1, {
      playerCount: 2,
    });
    expect(origins).toHaveLength(1);
    // The default ring center/radius apply even with no create_player_lands
    // command to have declared them -- confirms the "no governing command"
    // fallback path, not merely that SOME point was produced.
    const ignoredX = Math.round(0.05 * dim);
    const ignoredY = Math.round(0.05 * dim);
    expect(Math.hypot(origins[0].x - ignoredX, origins[0].y - ignoredY)).toBeGreaterThan(dim * 0.1);
  });

  it("zone still defaults to playerNumber - 10 for an assigned land", () => {
    const { origins } = place("<LAND_GENERATION>\ncreate_land {\nassign_to_player 3\n}\n", 1, { playerCount: 4 });
    expect(origins[0].zone).toBe(3 - 10);
  });
});

describe("detached seeds stay near their land (Sec.15 item 27)", () => {
  it("a fragmenting land's pieces are splinters off it, not tiles on the far side of the map", () => {
    // A detached seed models a land BREAKING APART. Drawn from the whole map,
    // as Sec.6.1's text reads, it instead teleports — and a land whose target
    // it can never reach keeps drawing, so those splinters grow without
    // limit. `AK_Six_Points_v1.4.rms` is the case that exposed it: a
    // `land_percent 100` flood walled inside a closed ellipse put DIRT out in
    // the open water beyond the wall it cannot cross.
    //
    // Pinned on a SMALL land so the only thing that can be far from the
    // origin is a seed. `clumping_factor 8` is the default and the regime
    // RMSTEST_38 measured fragmentation in, so it is the shape that matters.
    const source = [
      "<LAND_GENERATION>",
      "base_terrain WATER",
      "create_land {@land_position 50 50@base_size 2@number_of_tiles 200@terrain_type DIRT@clumping_factor 8@}",
    ]
      .join("\n")
      .replace(/@/g, "\n");
    for (let seed = 1; seed <= 10; seed++) {
      const { grid, dim } = placeAndGrow(source, seed);
      const centre = Math.round(dim / 2);
      let farthest = 0;
      for (let i = 0; i < grid.landId.length; i++) {
        if (grid.landId[i] !== 0) continue;
        const x = i % dim;
        const y = (i - x) / dim;
        farthest = Math.max(farthest, Math.max(Math.abs(x - centre), Math.abs(y - centre)));
      }
      // Seed radius is 0.12 * dim = 24 here, plus whatever a 200-tile land
      // grows around it. Generous, and still far inside the ~90 a map-wide
      // draw reaches.
      expect(farthest).toBeLessThan(50);
    }
  });
});

describe("bucketWeights / reservoirSize (Sec.6.1's two growth knobs, isolated from the full pipeline)", () => {
  // reservoirSize is non-zero for every cf < 20, so a full-pipeline
  // connectivity test can't isolate what bucketWeights alone controls (shape
  // roundness) from what reservoirSize controls (fragmentation) — see the
  // build log entry on the mutation test that found this. Unit-tested here
  // instead.

  it("reservoirSize is 0 at cf >= 20 and rises monotonically as cf falls below it", () => {
    expect(reservoirSize(20)).toBe(0);
    expect(reservoirSize(100)).toBe(0);
    expect(reservoirSize(-20)).toBeGreaterThan(reservoirSize(0));
    expect(reservoirSize(0)).toBeGreaterThan(reservoirSize(19));
  });

  it("bucketWeights(negative) strongly favours neighborsOwned==1 over every other bucket", () => {
    const [w1, w2, w3, w4] = bucketWeights(-20);
    expect(w1).toBeGreaterThan(w2);
    expect(w1).toBeGreaterThan(w3);
    expect(w1).toBeGreaterThan(w4);
  });

  it("bucketWeights(cf) is uniform at cf=0 and increasingly favours high neighborsOwned as cf rises, saturating by cf=15", () => {
    expect(bucketWeights(0)).toEqual([1, 1, 1, 1]);
    const at8 = bucketWeights(8);
    const at15 = bucketWeights(15);
    const at100 = bucketWeights(100);
    expect(at8[3]).toBeGreaterThan(at8[0]); // some preference for infill already
    expect(at15[3]).toBeGreaterThan(at8[3]); // stronger by 15
    expect(at100).toEqual(at15); // saturated: no further change past 15
  });
});

describe("growth (Sec.6.1's synchronized frontier expansion)", () => {
  it("grows a land toward its number_of_tiles target, remaining a superset of the origin stamp", () => {
    const { origins, grid } = placeAndGrow(
      "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 200\n}\n",
    );
    const owned = ownedCount(grid, 0);
    // behavior_version 0 (default): target is ADDITIVE to the origin square,
    // so the final count should be near origin + 200, not exactly 200.
    expect(owned).toBeGreaterThan(150);
    expect(owned).toBeLessThanOrEqual(origins[0].declaredTargetTiles + 25 + 5); // origin square (5x5=25) + target, small slack for edge effects
  });

  it("never claims a tile outside its own border bounds when border_fuzziness is a hard stop (f=100)", () => {
    const { grid, dim } = placeAndGrow(
      [
        "<LAND_GENERATION>",
        "create_land {",
        "land_position 50 50",
        "base_size 2",
        "number_of_tiles 100000", // deliberately impossible to satisfy -- forces growth to press against every border
        "left_border 20",
        "right_border 20",
        "top_border 20",
        "bottom_border 20",
        "border_fuzziness 100",
        "}",
      ].join("\n"),
    );
    let sawOwned = false;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        if (grid.landId[tileIndex(grid, x, y)] !== 0) continue;
        sawOwned = true;
        expect(x).toBeGreaterThanOrEqual(Math.round(0.2 * dim));
        expect(x).toBeLessThan(dim - Math.round(0.2 * dim));
        expect(y).toBeGreaterThanOrEqual(Math.round(0.2 * dim));
        expect(y).toBeLessThan(dim - Math.round(0.2 * dim));
      }
    }
    expect(sawOwned).toBe(true);
  });

  it("border_fuzziness 0 disables the border entirely — a heavily bordered land still grows well past what the bordered region alone could hold", () => {
    // The [45%,55%]x[45%,55%] bordered region on a 200-wide map is only
    // about 20x20 = 400 tiles including its depth-1 fringe, so a 2000-tile
    // target can ONLY be reached by growing tiles genuinely beyond the
    // border -- which border_fuzziness 0 is supposed to permit outright.
    const { grid } = placeAndGrow(
      [
        "<LAND_GENERATION>",
        "create_land {",
        "land_position 50 50",
        "base_size 2",
        "number_of_tiles 2000",
        "left_border 45",
        "right_border 45",
        "top_border 45",
        "bottom_border 45",
        "border_fuzziness 0",
        "}",
      ].join("\n"),
    );
    const owned = ownedCount(grid, 0);
    expect(owned).toBeGreaterThan(1000);
  });

  it("keeps two different-zone lands at least other_zone_avoidance_distance apart", () => {
    // Origins only 20 tiles apart (45/55%), each targeting 15000 tiles -- a
    // ~69-tile-radius circle each -- so without the avoidance check these
    // would overlap by more than 100 tiles. Any gap that survives has to
    // come from the constraint, not from the lands simply never meeting.
    const { grid, dim } = placeAndGrow(
      [
        "<LAND_GENERATION>",
        "create_land {\nland_position 45 50\nbase_size 2\nnumber_of_tiles 15000\nzone 1\nother_zone_avoidance_distance 5\n}",
        "create_land {\nland_position 55 50\nbase_size 2\nnumber_of_tiles 15000\nzone 2\nother_zone_avoidance_distance 5\n}",
      ].join("\n"),
    );
    let minGap = Infinity;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const i = tileIndex(grid, x, y);
        if (grid.landId[i] !== 0) continue;
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue;
            const j = tileIndex(grid, nx, ny);
            if (grid.landId[j] === 1) minGap = Math.min(minGap, Math.hypot(dx, dy));
          }
        }
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(5);
  });

  it("never lets two lands claim the same tile", () => {
    const { grid } = placeAndGrow(
      [
        "<LAND_GENERATION>",
        "create_land {\nland_position 45 50\nbase_size 3\nnumber_of_tiles 3000\n}",
        "create_land {\nland_position 55 50\nbase_size 3\nnumber_of_tiles 3000\n}",
      ].join("\n"),
    );
    // Every tile has exactly one owner by construction (a Int16Array cell can
    // only hold one value) -- this test instead checks BOTH lands actually
    // grew substantially despite competing for the same territory, i.e.
    // neither one silently starved because of an ownership bug.
    expect(ownedCount(grid, 0)).toBeGreaterThan(50);
    expect(ownedCount(grid, 1)).toBeGreaterThan(50);
  });

  it("high clumping_factor produces a single connected piece; very negative clumping_factor fragments", () => {
    const roundSource = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 600\nclumping_factor 100\n}\n";
    const snakeySource = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 600\nclumping_factor -20\n}\n";
    let fragmentedSeeds = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const round = placeAndGrow(roundSource, seed);
      expect(countComponents(round.grid, 0)).toBe(1);
      const snakey = placeAndGrow(snakeySource, seed);
      if (countComponents(snakey.grid, 0) > 1) fragmentedSeeds++;
    }
    expect(fragmentedSeeds).toBeGreaterThan(0);
  });

  it("reports growthShortfall when a tiny bordered land cannot reach an oversized target", () => {
    const { reports } = placeAndGrow(
      [
        "<LAND_GENERATION>",
        "create_land {",
        "land_position 50 50",
        "base_size 1",
        "number_of_tiles 100000",
        "left_border 49",
        "right_border 49",
        "top_border 49",
        "bottom_border 49",
        "border_fuzziness 100",
        "}",
      ].join("\n"),
    );
    expect(reports[0].failures.some((f) => f.bucket === "growthShortfall")).toBe(true);
  });

  it("behavior_version 1 treats the declared target as INCLUSIVE of the origin square", () => {
    const source = "<PLAYER_SETUP>\nbehavior_version 1\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 200\n}\n";
    const { grid } = placeAndGrow(source);
    const owned = ownedCount(grid, 0);
    // Origin square is 5x5=25 tiles; version 1 means the final count should
    // land near 200 total, NOT near 225 (200 + the 25-tile origin) the way
    // the default version 0 test above does.
    expect(owned).toBeLessThan(225);
    expect(owned).toBeGreaterThan(150);
  });
});

describe("terrain_type painting (Sec.6.1, applied after growth)", () => {
  /** placeAndGrow + the paint pass, i.e. everything S1 does to `grid.terrain`. */
  function placeGrowPaint(source: string, seed = 1, overrides?: Parameters<typeof settings>[0]) {
    const grown = placeAndGrow(source, seed, overrides);
    paintLandTerrain(grown.origins, grown.grid);
    return grown;
  }

  /** Every terrain id the grid holds, with tile counts. */
  function terrainHistogram(grid: TileGrid): Map<number, number> {
    const hist = new Map<number, number>();
    for (const id of grid.terrain) hist.set(id, (hist.get(id) ?? 0) + 1);
    return hist;
  }

  it("paints the land's terrain over its whole grown footprint, not just the origin stamp", () => {
    // base_size 2 is a 5x5 origin stamp; number_of_tiles 200 means growth
    // claims far more than that, and every claimed tile must be painted.
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 200\nterrain_type WATER\n}\n";
    const { grid } = placeGrowPaint(source);
    let owned = 0;
    for (let i = 0; i < grid.landId.length; i++) {
      if (grid.landId[i] !== 0) continue;
      owned++;
      expect(grid.terrain[i]).toBe(1); // WATER
    }
    expect(owned).toBeGreaterThan(25);
  });

  it("leaves every unclaimed tile on the base fill", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 200\nterrain_type WATER\n}\n";
    const { grid } = placeGrowPaint(source);
    for (let i = 0; i < grid.landId.length; i++) {
      if (grid.landId[i] === -1) expect(grid.terrain[i]).toBe(GRASS);
    }
  });

  // The three reference forms, one test each. Before 2026-08-07 the first
  // two produced a map identical to the third (nothing painted at all), and
  // the whole map read as one flat base_terrain.
  it("resolves a terrain named by a built-in constant the extraction never had (DEEP_WATER)", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\nterrain_type DEEP_WATER\n}\n";
    const { grid } = placeGrowPaint(source);
    expect(terrainHistogram(grid).get(22)).toBeGreaterThan(50);
  });

  it("resolves a bare terrain id, which is the only way to name 53 of DE's terrains", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\nterrain_type 26\n}\n";
    const { grid } = placeGrowPaint(source);
    expect(terrainHistogram(grid).get(26)).toBeGreaterThan(50);
  });

  it("resolves a script's own #const, the idiom those 53 terrains force (TL Black Forest's WOODIES)", () => {
    const source = "#const WOODIES 48\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\nterrain_type WOODIES\n}\n";
    const { grid } = placeGrowPaint(source);
    expect(terrainHistogram(grid).get(48)).toBeGreaterThan(50);
  });

  it("does not let a #const shadow a built-in name — the engine defines random_map.def first", () => {
    const source = "#const WATER 48\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\nterrain_type WATER\n}\n";
    const { grid } = placeGrowPaint(source);
    const hist = terrainHistogram(grid);
    expect(hist.get(1)).toBeGreaterThan(50); // still WATER
    expect(hist.get(48)).toBeUndefined();
  });

  it("paints nothing for a land with no terrain_type, leaving the base fill intact", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\n}\n";
    const { grid } = placeGrowPaint(source);
    expect([...terrainHistogram(grid).keys()]).toEqual([GRASS]);
  });

  it("paints nothing for an unresolvable terrain_type rather than guessing an id", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 3\nnumber_of_tiles 100\nterrain_type NOT_A_TERRAIN\n}\n";
    const { grid } = placeGrowPaint(source);
    expect([...terrainHistogram(grid).keys()]).toEqual([GRASS]);
  });

  it("a later land's terrain wins on tiles it took from an earlier one", () => {
    // Both at the same position, so the second land's origin stamp overwrites
    // the first's landId — the paint pass must follow that, not script order.
    const source = [
      "<LAND_GENERATION>",
      "create_land {\nland_position 50 50\nbase_size 4\nnumber_of_tiles 1\nterrain_type WATER\n}",
      "create_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 1\nterrain_type SNOW\n}",
    ].join("\n");
    const { grid, dim } = placeGrowPaint(source);
    const centre = tileIndex(grid, Math.round(dim / 2), Math.round(dim / 2));
    expect(grid.terrain[centre]).toBe(32); // SNOW, the later land
    const hist = terrainHistogram(grid);
    expect(hist.get(1)).toBeGreaterThan(0); // WATER survives on the ring the second land didn't cover
  });
});

describe("base_elevation (Sec.6.1, applied after growth)", () => {
  it("sets every tile of the grown land to the declared elevation", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 100\nbase_elevation 7\n}\n";
    const { grid } = placeGrowElevate(source);
    for (let i = 0; i < grid.landId.length; i++) {
      if (grid.landId[i] === 0) expect(grid.elevation[i]).toBe(7);
    }
  });

  it("clamps a negative H to 16 (CONFIRMED in-game: -1 matches 16 exactly)", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation -1\n}\n";
    const { grid } = placeGrowElevate(source);
    const owned = [...grid.landId].some((v, i) => v === 0 && grid.elevation[i] !== 16);
    expect(owned).toBe(false);
  });

  it("clamps an H above 16 down to 16", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation 40\n}\n";
    const { grid } = placeGrowElevate(source);
    const owned = [...grid.landId].some((v, i) => v === 0 && grid.elevation[i] !== 16);
    expect(owned).toBe(false);
  });

  it("H=0 (or absent) is a real no-op — elevation stays at the grid default", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation 0\n}\n";
    const { grid } = placeGrowElevate(source);
    const anyRaised = [...grid.elevation].some((v) => v !== 0);
    expect(anyRaised).toBe(false);
  });

  it("skips a land whose terrain_type is water (guide:959)", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation 10\nterrain_type WATER\n}\n";
    const { grid } = placeGrowElevate(source);
    const anyRaised = [...grid.elevation].some((v) => v !== 0);
    expect(anyRaised).toBe(false);
  });

  it("has no effect and notes it when <ELEVATION_GENERATION> is absent from the script", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation 10\n}\n";
    const { grid, elevationNotes } = placeGrowElevate(source);
    const anyRaised = [...grid.elevation].some((v) => v !== 0);
    expect(anyRaised).toBe(false);
    expect(elevationNotes.some((n) => n.key.startsWith("baseElevationNoSection:"))).toBe(true);
  });

  it("an EMPTY <ELEVATION_GENERATION> section is enough (guide:952) — elevation still applies", () => {
    const source = "<ELEVATION_GENERATION>\n<LAND_GENERATION>\ncreate_land {\nland_position 50 50\nbase_size 2\nnumber_of_tiles 50\nbase_elevation 10\n}\n";
    const { grid } = placeGrowElevate(source);
    const anyRaised = [...grid.elevation].some((v, i) => grid.landId[i] === 0 && v === 10);
    expect(anyRaised).toBe(true);
  });

  it("only touches tiles the land actually owns — an unrelated land stays untouched", () => {
    const source = [
      "<ELEVATION_GENERATION>",
      "<LAND_GENERATION>",
      "create_land {\nland_position 20 50\nbase_size 2\nnumber_of_tiles 200\nbase_elevation 12\n}",
      "create_land {\nland_position 80 50\nbase_size 2\nnumber_of_tiles 200\n}",
    ].join("\n");
    const { grid } = placeGrowElevate(source);
    let sawUnelevatedSecondLand = false;
    for (let i = 0; i < grid.landId.length; i++) {
      if (grid.landId[i] === 1 && grid.elevation[i] === 0) sawUnelevatedSecondLand = true;
      if (grid.landId[i] === 1) expect(grid.elevation[i]).not.toBe(12);
    }
    expect(sawUnelevatedSecondLand).toBe(true);
  });
});

describe("corpus: placeLandOrigins + growLands + applyBaseElevation never throw", () => {
  // One `it()` per map, not one big loop inside a single `it()` — matching
  // corpus.test.ts's and instantiate.test.ts's own convention. Growth on a
  // handful of maps (e.g. Crownwood's deliberately-unclamped land_percent
  // 1024, Sec.6.1) can legitimately run every step of the 4*dim^2 cap before
  // giving up, and vitest's default 5s PER-TEST timeout is per `it()` — a
  // single `it()` looping over 30+ maps accumulates all of their time
  // against that one timeout and can time out under machine load even
  // though no individual map is slow (verified: the full 32-map corpus
  // profiled at under 2s combined, in isolation).
  const corpusDir = join(REPO_ROOT, "test-maps");
  const corpusFiles = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);

  it("found the corpus", () => {
    expect(corpusFiles.length).toBeGreaterThan(0);
  });

  for (const name of corpusFiles) {
    it(name, () => {
      const source = readFileSync(join(corpusDir, name), "utf8");
      const instantiated = instantiateScript(parseRms(source, lang), refDb, settings(), 12345);
      const grid = createTileGrid(instantiated.dim, GRASS);
      const result = placeLandOrigins(instantiated, grid, constants, 12345);
      growLands(result.origins, grid, result.reports, 12345);
      expect(() => applyBaseElevation(instantiated, result.origins, grid, constants)).not.toThrow();
    });
  }
});
