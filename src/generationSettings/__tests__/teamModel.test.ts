// preview-design.md Sec.13's teams block. Five cases, each pinning one way
// the canonicalisation goes silently wrong.

import { describe, expect, it } from "vitest";
import languageData from "../../../reference/data/language.json";
import { canonicaliseTeams, teamLabels } from "../teamModel";
import { MAX_PLAYER_COUNT, type TeamNumber } from "../generationSettingsConstants";

const PREDEFINED_LABELS = new Set(
  (languageData as { predefinedLabels?: { name: string }[] }).predefinedLabels?.map((l) => l.name) ?? [],
);

function pad(picks: number[]): TeamNumber[] {
  const out = picks.slice() as TeamNumber[];
  while (out.length < MAX_PLAYER_COUNT) out.push(0);
  return out;
}

describe("canonicaliseTeams", () => {
  // (1) Renumbering. Invisible in a plain 2v2 where picked and canonical
  // numbers coincide, wrong the moment a lobby picks a high number first.
  it("renumbers surviving teams by lowest player number", () => {
    const { canonical, teamCount } = canonicaliseTeams(pad([0, 3, 3, 0, 1, 1, 2, 0]), 8);
    expect(canonical).toEqual([0, 1, 1, 0, 2, 2, 0, 0]);
    expect(teamCount).toBe(2);
  });

  it("maps 1,1 and 4,4 onto canonical teams 1 and 2", () => {
    const { canonical, teamCount } = canonicaliseTeams(pad([1, 1, 4, 4]), 4);
    expect(canonical).toEqual([1, 1, 2, 2]);
    expect(teamCount).toBe(2);
  });

  // (2) The >=2 rule (guide:1004, 3115).
  it("reads a player alone on a team as un-teamed", () => {
    const result = canonicaliseTeams(pad([1, 0, 0, 0]), 4);
    expect(result.teamCount).toBe(0);
    expect(result.canonical).toEqual([0, 0, 0, 0]);
    expect(teamLabels(result)).toContain("0_TEAM_GAME");
    expect(teamLabels(result)).toContain("TEAM0_SIZE4");
    expect(teamLabels(result)).toContain("PLAYER1_TEAM0");
    expect(teamLabels(result)).not.toContain("1_TEAM_GAME");
  });

  it("reports a 1v1 as zero teams, since neither side has two members", () => {
    // The 1v1 preset assigns teams 1 and 2 because that is what a lobby
    // shows. Both are teams of one, so the engine sees no teams at all.
    expect(canonicaliseTeams(pad([1, 2]), 2).teamCount).toBe(0);
  });

  // (3) The length-8 trap: retained assignments for players who are not in
  // the game must not leak into the derivation.
  it("ignores assignments above playerCount", () => {
    const withRetained = canonicaliseTeams(pad([1, 1, 0, 0, 2, 2, 2, 2]), 4);
    const withoutRetained = canonicaliseTeams(pad([1, 1, 0, 0]), 4);
    expect(withRetained).toEqual(withoutRetained);
    expect(withRetained.teamCount).toBe(1);
    expect(withRetained.sizes[0]).toBe(2);
  });

  // (4) FFA defines a label. The retired solo-team premise defined none.
  it("defines 0_TEAM_GAME for an all-un-teamed lobby", () => {
    expect(teamLabels(canonicaliseTeams(pad([]), 8))).toContain("0_TEAM_GAME");
  });

  it("derives the expected labels for a 4v4", () => {
    const labels = teamLabels(canonicaliseTeams(pad([1, 1, 1, 1, 2, 2, 2, 2]), 8));
    expect(labels).toContain("2_TEAM_GAME");
    expect(labels).toContain("TEAM1_SIZE4");
    expect(labels).toContain("TEAM2_SIZE4");
    expect(labels).toContain("TEAM0_SIZE0");
    expect(labels).toContain("PLAYER8_TEAM2");
  });
});

describe("teamLabels", () => {
  // (5) The mutation-testable one. Sec.3.1 rests on the claim that the
  // guide's teamSize enumeration is exactly the reachable set; this asserts
  // it over every lobby we can actually produce, so a derivation that
  // invents a name fails here rather than in the generator.
  it("only emits names that exist in predefinedLabels, across every reachable lobby", () => {
    expect(PREDEFINED_LABELS.size).toBeGreaterThan(0);

    // Collect, then assert ONCE. An expect() per label here costs ~200k
    // assertions and times the suite out — the same trap CLAUDE.md records
    // for lexer.test.ts, where an expect() per token cost 7.6 s against
    // 0.07 s of real work. The loop must measure the code, not vitest.
    const seen = new Set<string>();
    const missing = new Set<string>();
    const walk = (picks: TeamNumber[], playerCount: number) => {
      if (picks.length === playerCount) {
        for (const label of teamLabels(canonicaliseTeams(pad(picks), playerCount))) {
          seen.add(label);
          if (!PREDEFINED_LABELS.has(label)) missing.add(label);
        }
        return;
      }
      for (const pick of [0, 1, 2, 3, 4] as TeamNumber[]) walk([...picks, pick], playerCount);
    };
    // Exhaustive to 6 players (5^6 = 15625 lobbies); 8 would be 390k and
    // adds no distinct team shape the smaller counts don't already reach.
    for (let playerCount = 2; playerCount <= 6; playerCount += 1) walk([], playerCount);

    expect([...missing].sort()).toEqual([]);

    // Guards against the assertion passing vacuously if the walk broke.
    expect(seen.has("0_TEAM_GAME")).toBe(true);
    expect(seen.has("3_TEAM_GAME")).toBe(true);
  });
});
