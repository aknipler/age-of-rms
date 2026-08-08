import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import {
  cycleTeam,
  NO_TEAM,
  TEAM_PRESETS,
  type TeamNumber,
} from "../generationSettings/generationSettingsConstants";
import { canonicaliseTeams } from "../generationSettings/teamModel";
import { HelpTip } from "./HelpTip";
import styles from "./TeamSection.module.css";

// preview-design.md Sec.3.1 / Sec.15 item 4. A row per player with a cycling
// team button, matching the lobby's own control: left click advances through
// - 1 2 3 4 and wraps, right click reverses.
//
// Rows are shown for players 1..playerCount only. Assignments for players
// above the count are RETAINED in context (see DEFAULT_TEAMS' comment) so
// raising the count brings them back rather than silently zeroing them.

function teamGlyph(team: TeamNumber): string {
  return team === NO_TEAM ? "-" : String(team);
}

export function TeamSection() {
  const {
    playerCount,
    teams,
    setPlayerTeam,
    activePreset,
    toggleTeamPreset,
    teamsLocked,
    playerCountLocked,
  } = useGenerationSettings();

  const { teamCount, sizes, canonical } = canonicaliseTeams(teams, playerCount);

  // A player who picked a team but ended up un-teamed was alone on it. This
  // is the one genuinely surprising rule in the model (guide:1004) and it is
  // why a 1v1 reports zero teams, so the readout names it rather than
  // leaving the user to wonder why their team vanished.
  const strandedCount = canonical.filter(
    (team, index) => team === NO_TEAM && teams[index] !== NO_TEAM,
  ).length;
  const unteamedCount = sizes[NO_TEAM];

  const summary =
    teamCount === 0
      ? "No teams — 0_TEAM_GAME"
      : `${teamCount} teams (${sizes.slice(1, teamCount + 1).join(" v ")}) — ${teamCount}_TEAM_GAME`;

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>Teams</h3>

      <div className={styles.presets}>
        {TEAM_PRESETS.map((preset) => (
          <HelpTip
            key={preset.id}
            id="generationSettings.teamPreset"
            text={
              preset.playerCount === null
                ? `${preset.label}: clears every team at the current player count. Press again to restore what you had.`
                : `${preset.label}: sets ${preset.playerCount} players and assigns the teams. Press again to restore what you had.`
            }
          >
            <button
              type="button"
              className={`${styles.presetButton} ${activePreset === preset.id ? styles.presetActive : ""}`}
              aria-pressed={activePreset === preset.id}
              onClick={() => toggleTeamPreset(preset.id)}
            >
              {preset.label}
            </button>
          </HelpTip>
        ))}
      </div>

      <div className={styles.rows}>
        {teams.slice(0, playerCount).map((team, index) => (
          <div className={styles.row} key={index}>
            <span className={styles.playerLabel}>Player {index + 1}</span>
            <HelpTip
              id="generationSettings.teamButton"
              text={`Player ${index + 1}'s team. Left click to advance, right click to go back. "-" means no team.`}
            >
              <button
                type="button"
                className={styles.teamButton}
                disabled={teamsLocked}
                aria-label={`Player ${index + 1} team: ${team === NO_TEAM ? "none" : team}`}
                onClick={() => setPlayerTeam(index, cycleTeam(team, 1))}
                onContextMenu={(event) => {
                  // Suppress the OS menu so right click is usable as a
                  // decrement. Only meaningful because the button is the
                  // whole hit area.
                  event.preventDefault();
                  if (!teamsLocked) setPlayerTeam(index, cycleTeam(team, -1));
                }}
                onKeyDown={(event) => {
                  // Right click is unreachable from a keyboard, so the arrows
                  // carry the decrement. Enter/Space already advance via the
                  // button's native click.
                  if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    setPlayerTeam(index, cycleTeam(team, -1));
                  } else if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setPlayerTeam(index, cycleTeam(team, 1));
                  }
                }}
              >
                {teamGlyph(team)}
              </button>
            </HelpTip>
          </div>
        ))}
      </div>

      <HelpTip id="generationSettings.teamReadout">
        <div className={styles.readout}>
          {summary}
          {unteamedCount > 0 && teamCount > 0 && ` · ${unteamedCount} un-teamed`}
          {strandedCount > 0 &&
            ` · ${strandedCount} ${strandedCount === 1 ? "player is" : "players are"} alone on a team, which the engine reads as un-teamed`}
        </div>
      </HelpTip>

      {teamsLocked && (
        <div className={styles.lockNote}>
          {activePreset?.toUpperCase()} preset active — press it again to unlock
          {playerCountLocked ? " the teams and player count." : " the teams."}
        </div>
      )}
    </div>
  );
}
