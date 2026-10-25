import { useEffect, useRef, useState } from "react";
import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import {
  MAP_SIZES,
  MAP_SIZE_DEFAULT_PLAYERS,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
} from "../generationSettings/generationSettingsConstants";
import languageDataRaw from "../../reference/data/language.json";
import type { LanguageData } from "../parser/language";
import { resolveMapDim } from "../preview/generator/mapDimensions";
import { HelpTip } from "./HelpTip";
import { TeamSection } from "./TeamSection";
import styles from "./dialog.module.css";
import genStyles from "./GenerationSettingsDialog.module.css";

// Same double-cast as ReferenceTable.tsx and parserWorker.ts: the JSON import
// infers a literal type that does not always overlap the hand-written
// interface, and `npm run validate:reference` is the real guarantee.
const predefinedLabels = (languageDataRaw as unknown as LanguageData)
  .predefinedLabels;

interface GenerationSettingsDialogProps {
  onClose: () => void;
}

/** "Normal (200)": the picker's name plus the grid's side length, resolved from language.json. */
function mapSizeLabel(size: (typeof MAP_SIZES)[number]): string {
  const dim = resolveMapDim(size, predefinedLabels);
  return dim === null ? size : `${size} (${dim})`;
}

/**
 * A custom dropdown rather than a native <select>: an <option> holds plain
 * text only, so two aligned columns (name with tiles, then the size's default
 * player count) need real elements. The tile count comes from the lookup the
 * preview uses to size the grid (mapDimensions.ts).
 */
function MapSizePicker({
  value,
  onChange,
}: {
  value: (typeof MAP_SIZES)[number];
  onChange: (size: (typeof MAP_SIZES)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const players = (size: (typeof MAP_SIZES)[number]) => {
    const n = MAP_SIZE_DEFAULT_PLAYERS[size];
    return n === undefined ? "" : `${n}p`;
  };

  return (
    <div
      className={genStyles.sizePicker}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        id="generation-map-size"
        className={genStyles.sizeButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {mapSizeLabel(value)}
        <span aria-hidden="true"> &#9662;</span>
      </button>
      {open && (
        <ul className={genStyles.sizeList} role="listbox">
          {MAP_SIZES.map((size) => (
            <li
              key={size}
              role="option"
              aria-selected={size === value}
              className={`${genStyles.sizeItem} ${size === value ? genStyles.sizeItemActive : ""}`}
              onClick={() => {
                onChange(size);
                setOpen(false);
              }}
            >
              <span>{mapSizeLabel(size)}</span>
              <span className={genStyles.sizePlayers}>{players(size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const {
    playerCount,
    setPlayerCount,
    mapSize,
    setMapSize,
    teamPositions,
    setTeamPositions,
  } = useGenerationSettings();

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

  // Escape closes the dialog. The map size list stops propagation of its own
  // Escape while open, so that press closes only the list.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
                <MapSizePicker value={mapSize} onChange={setMapSize} />
              </div>
            </HelpTip>

            {/* A lobby setting like the two fields beside it, so it sits in
                their row rather than under Teams, and adds no height to a
                dialog whose height is fixed (GenerationSettingsDialog.module.css).
                The checkbox comes first and the label points at it with
                htmlFor, the same idiom as GeneralSettings, so clicking the
                words toggles it too. */}
            <HelpTip id="generationSettings.teamPositions">
              <div className={styles.optionRow}>
                <input
                  id="generation-team-positions"
                  type="checkbox"
                  checked={teamPositions}
                  onChange={(event) => setTeamPositions(event.target.checked)}
                />
                <label htmlFor="generation-team-positions">
                  Team Positions
                </label>
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
