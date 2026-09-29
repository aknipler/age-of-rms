import { useEffect, useState } from "react";
import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import {
  MAP_SIZES,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
} from "../generationSettings/generationSettingsConstants";
import { HelpTip } from "./HelpTip";
import { TeamSection } from "./TeamSection";
import styles from "./dialog.module.css";
import genStyles from "./GenerationSettingsDialog.module.css";

interface GenerationSettingsDialogProps {
  onClose: () => void;
}

// Mirrors SettingsDialog's shape (overlay + fixed box, reuses the shared
// dialog.module.css, same look, no need for a near-duplicate
// stylesheet). Deliberately still its own dialog rather than a Settings
// tab: these are properties of the script being written, not preferences
// about the app, which is why they open from the status bar. Map
// size + player count feed the status-bar resource totals now
// (playerCount only) and the approximate
// preview / consistency checker later (PLAN.md).
export function GenerationSettingsDialog({
  onClose,
}: GenerationSettingsDialogProps) {
  const { playerCount, setPlayerCount, mapSize, setMapSize } =
    useGenerationSettings();

  // A string draft, not the committed number directly: the field is
  // controlled, so a `value` that always mirrors `playerCount` snaps back on
  // every keystroke that isn't itself a valid count, which is exactly what
  // made deleting the digit impossible (backspace produces "", `Number("")`
  // is 0, 0 fails the min check, so `setPlayerCount` never runs and the
  // input is forced right back to its old value before the user sees the
  // blank field at all). Typing a valid digit still commits immediately;
  // this only buys room for the momentarily-empty/invalid states in between.
  const [draft, setDraft] = useState(String(playerCount));

  useEffect(() => {
    setDraft(String(playerCount));
  }, [playerCount]);

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={`${styles.dialog} ${genStyles.fixedSize}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className={styles.title}>Generation Settings</h2>

        {/* The fixed height box's stretchy middle. The title and Close sit
            outside it, so they stay put, and on a window too short for the
            whole dialog it is this part that scrolls. */}
        <div className={genStyles.body}>
          {/* An explicit row, not two HelpTip spans left to land side by
              side on their own inline-block default (HelpTip.module.css).
              That accident is what SettingsDialog.module.css's `.panel >
              span` fix just replaced elsewhere, and building on the same
              accident here would only reintroduce it the next time either
              field's content changes width. */}
          <div className={genStyles.topRow}>
            <HelpTip id="generationSettings.playerCount">
              <div className={styles.optionRow}>
                <label htmlFor="generation-player-count">Player count</label>
                <input
                  id="generation-player-count"
                  type="number"
                  min={MIN_PLAYER_COUNT}
                  max={MAX_PLAYER_COUNT}
                  // Editable even while a preset is active (2026-09-16):
                  // typing a count here is a deliberate override, and
                  // GenerationSettingsContext's setPlayerCount now clears the
                  // preset itself (restoring the teams it displaced) rather
                  // than this component needing to know about presets at all.
                  value={draft}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setDraft(raw);
                    const next = Number(raw);
                    if (
                      raw !== "" &&
                      Number.isInteger(next) &&
                      next >= MIN_PLAYER_COUNT &&
                      next <= MAX_PLAYER_COUNT
                    ) {
                      setPlayerCount(next);
                    }
                  }}
                  onBlur={() => {
                    // Left empty or mid-edit invalid: snap the display back to
                    // the last committed count rather than leaving a blank or
                    // out-of-range number showing.
                    setDraft(String(playerCount));
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
                  onChange={(event) =>
                    setMapSize(event.target.value as (typeof MAP_SIZES)[number])
                  }
                >
                  {MAP_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            </HelpTip>
          </div>

          <TeamSection />
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
