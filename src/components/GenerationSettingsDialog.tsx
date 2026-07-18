import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import { MAP_SIZES, MAX_PLAYER_COUNT, MIN_PLAYER_COUNT } from "../generationSettings/generationSettingsConstants";
import { HelpTip } from "./HelpTip";
import styles from "./PreferencesDialog.module.css";

interface GenerationSettingsDialogProps {
  onClose: () => void;
}

// Mirrors PreferencesDialog's shape (overlay + fixed box, reuses its CSS
// module — same look, no need for a near-duplicate stylesheet). Map
// size + player count feed the status-bar resource totals now
// (playerCount only, per Ash's locked 2.5 decision) and the approximate
// preview / consistency checker later (PLAN.md).
export function GenerationSettingsDialog({ onClose }: GenerationSettingsDialogProps) {
  const { playerCount, setPlayerCount, mapSize, setMapSize } = useGenerationSettings();

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

        <div className={styles.actions}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
