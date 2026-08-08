// Team canonicalisation and label derivation — preview-design.md Sec.3.1.
//
// PURE ON PURPOSE. No React, no Tauri, no I/O. The Phase 4 preview generator
// runs in a bare web worker and must import this same function rather than
// growing a second copy of the rule (CLAUDE.md: "no parallel model"). Today
// only the settings dialog's readout consumes it; that is deliberate
// plumbing-before-consumer, exactly how mapSize landed.

import { MAX_TEAM, NO_TEAM, type TeamNumber } from "./generationSettingsConstants";

export interface CanonicalTeams {
  /**
   * Canonical team per player, index = player - 1, length = playerCount
   * (NOT 8 — players above the count are not in the game at all).
   */
  canonical: readonly TeamNumber[];
  /** Surviving team count: the k in `<k>_TEAM_GAME`. 0 for an FFA lobby. */
  teamCount: number;
  /** Member count per canonical team, indexed 0..4. sizes[0] = un-teamed. */
  sizes: readonly number[];
}

/**
 * Selected team numbers -> the numbering the engine actually uses.
 *
 * The guide states three separate times (guide:1000, 3121, 3151) that team
 * numbers in TEAMn_SIZEm / PLAYERx_TEAMy / assign_to AT_TEAM "refer to lobby
 * order, not the number chosen by the team". So the picker's numbers are an
 * INPUT to this function, never a label suffix.
 *
 * Two rules, both from the guide:
 *   - A team needs >= 2 members or it is not a team (guide:1004, 3115). A
 *     player alone on team 1 is a legal lobby; the engine reads them as
 *     un-teamed. That is why a 1v1 canonicalises to ZERO teams, not two.
 *   - Surviving teams are renumbered 1..4 by their lowest player number.
 *
 * `selected` is length 8 (the settings pane retains assignments for players
 * currently counted out); everything at index >= playerCount is ignored.
 */
export function canonicaliseTeams(
  selected: readonly TeamNumber[],
  playerCount: number,
): CanonicalTeams {
  // Group the players who are actually in the game by their picked number.
  // Insertion order of a Map is insertion order of first appearance, which
  // IS lobby order here — so no explicit sort is needed for step 3 below.
  const bySelected = new Map<TeamNumber, number[]>();
  for (let i = 0; i < playerCount; i += 1) {
    const pick = selected[i] ?? NO_TEAM;
    if (pick === NO_TEAM) continue;
    const members = bySelected.get(pick);
    if (members) members.push(i);
    else bySelected.set(pick, [i]);
  }

  // Drop teams of one, then number the survivors in order of first appearance.
  const canonicalBySelected = new Map<TeamNumber, TeamNumber>();
  let nextCanonical = 1;
  for (const [pick, members] of bySelected) {
    if (members.length < 2) continue;
    canonicalBySelected.set(pick, nextCanonical as TeamNumber);
    nextCanonical += 1;
  }

  const canonical: TeamNumber[] = [];
  const sizes = new Array<number>(MAX_TEAM + 1).fill(0);
  for (let i = 0; i < playerCount; i += 1) {
    const team = canonicalBySelected.get(selected[i] ?? NO_TEAM) ?? NO_TEAM;
    canonical.push(team);
    sizes[team] += 1;
  }

  return { canonical, teamCount: canonicalBySelected.size, sizes };
}

/**
 * The predefined labels this lobby defines (preview-design Sec.3.1).
 *
 * Returns NAMES ONLY. The caller resolves each against
 * language.json's predefinedLabels rather than trusting these strings —
 * constructing a name and assuming it exists is precisely what CLAUDE.md's
 * data-driven-vocabulary rule forbids, and the test asserts every name
 * returned here is really in the data.
 *
 * Every TEAMn_SIZEm is emitted for n = 0..4, including size 0: "team 3 has
 * 0 players" is a real label a script can branch on, not a gap.
 */
export function teamLabels(canonicalised: CanonicalTeams): string[] {
  const { canonical, teamCount, sizes } = canonicalised;
  const labels = [`${teamCount}_TEAM_GAME`];
  for (let team = 0; team <= MAX_TEAM; team += 1) {
    labels.push(`TEAM${team}_SIZE${sizes[team]}`);
  }
  canonical.forEach((team, index) => {
    labels.push(`PLAYER${index + 1}_TEAM${team}`);
  });
  return labels;
}
