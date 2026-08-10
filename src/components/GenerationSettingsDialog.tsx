import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import { MAP_SIZES, MAX_PLAYER_COUNT, MIN_PLAYER_COUNT } from "../generationSettings/generationSettingsConstants";
import { HelpTip } from "./HelpTip";
import { TeamSection } from "./TeamSection";
import styles from "./dialog.module.css";

interface GenerationSettingsDialogProps {
  onClose: () => void;
}

// Mirrors SettingsDialog's shape (overlay + fixed box, reuses the shared
// dialog.module.css — same look, no need for a near-duplicate
// stylesheet). Deliberately still its own dialog rather than a Settings
// tab: these are properties of the script being written, not preferences
// about the app, which is why they open from the status bar. Map
// size + player count feed the status-bar resource totals now
// (playerCount only) and the approximate
// preview / consistency checker later (PLAN.md).
export function GenerationSettingsDialog({ onClose }: GenerationSettingsDialogProps) {
  const { playerCount, setPlayerCount, mapSize, setMapSize, playerCountLocked } = useGenerationSettings();

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <h2 className={styles.title}>Generation Settings</h2>

        <HelpTip id="generationSettings.playerCount">
          <div className={styles.optionRow}>
            <label htmlFor="generation-player-count">Player count</label>
            <input
              id="generation-player-count"
              type="number"
              min={MIN_PLAYER_COUNT}
              max={MAX_PLAYER_COUNT}
              // Locked while a preset that names a player count is active
              // ("2v2" asserts four players). FFA leaves this enabled — see
              // TeamPreset.playerCount.
              disabled={playerCountLocked}
              value={playerCount}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= MIN_PLAYER_COUNT && next <= MAX_PLAYER_COUNT) {
                  setPlayerCount(next);
                }
              }}
            />
          </div>
        </HelpTip>

        <HelpTip id="generationSettings.mapSize">
          <div className={styles.optionRow}>
            <label htmlFor="generation-map-size">Map size</label>
            <select
              id="generation-map-size"
              value={mapSize}
              onChange={(event) => setMapSize(event.target.value as (typeof MAP_SIZES)[number])}
            >
              {MAP_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </HelpTip>

        <TeamSection />

        <div className={styles.actions}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
