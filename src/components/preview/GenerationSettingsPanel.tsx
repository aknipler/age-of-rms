import { useEffect, useRef, useState } from "react";
import { useGenerationSettings } from "../../generationSettings/GenerationSettingsContext";
import {
  MAP_SIZES,
  MAP_SIZE_DEFAULT_PLAYERS,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
} from "../../generationSettings/generationSettingsConstants";
import languageDataRaw from "../../../reference/data/language.json";
import type { LanguageData } from "../../parser/language";
import { resolveMapDim } from "../../preview/generator/mapDimensions";
import { isSidePanelKeyEvent } from "../../settings/focusRegion";
import { HelpTip } from "../HelpTip";
import { TeamSection } from "../TeamSection";
import styles from "./GenerationSettingsPanel.module.css";

// Same double-cast as ReferenceTable.tsx and parserWorker.ts: the JSON import
// infers a literal type that does not always overlap the hand-written
// interface, and `npm run validate:reference` is the real guarantee.
const predefinedLabels = (languageDataRaw as unknown as LanguageData)
  .predefinedLabels;

interface GenerationSettingsPanelProps {
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
      className={styles.sizePicker}
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
        className={styles.sizeButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {mapSizeLabel(value)}
        <span aria-hidden="true"> &#9662;</span>
      </button>
      {open && (
        <ul className={styles.sizeList} role="listbox">
          {MAP_SIZES.map((size) => (
            <li
              key={size}
              role="option"
              aria-selected={size === value}
              className={`${styles.sizeItem} ${size === value ? styles.sizeItemActive : ""}`}
              onClick={() => {
                onChange(size);
                setOpen(false);
              }}
            >
              <span>{mapSizeLabel(size)}</span>
              <span className={styles.sizePlayers}>{players(size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Map size, player count, Team Positions and the teams, in a box over the map
 * preview (PreviewCanvas hands it to OverlayCanvas's top right panel slot).
 * It was a modal dialog laid over the side panel. It sits on the map now
 * because these are the settings the map is drawn from, so a change shows
 * behind the box as it is made, and the box takes the other preview boxes'
 * look (compact text, the themed surface, a header with a small button)
 * rather than the dialogs'.
 *
 * Not modal, so Escape closes it only while focus is in the map preview. A
 * global Escape would also fire for a press meant for the code editor.
 */
export function GenerationSettingsPanel({
  onClose,
}: GenerationSettingsPanelProps) {
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

  // Focus moves into the box when it opens, so the preview is the focused
  // region and Escape works at once, even when the cog was opened from the
  // keyboard while focus was in the editor.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape closes the box while focus is anywhere in the map preview, the
  // box, the canvas or the other side panel controls, and not for a press in
  // the code editor or Breakdown. The map size list takes the first Escape
  // while it is open (its own handler stops the event before it reaches the
  // window), so that press closes only the list.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isSidePanelKeyEvent(event)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div ref={rootRef} className={styles.panel} tabIndex={-1}>
      <div className={styles.header}>
        <span className={styles.title}>Generation Settings</span>
        <HelpTip id="generationSettings.close">
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close generation settings"
            onClick={onClose}
          >
            ✕
          </button>
        </HelpTip>
      </div>

      {/* An explicit row, not three HelpTip spans left to land side by side
          on their own inline-block default (HelpTip.module.css). Building on
          that accident is what SettingsDialog.module.css's `.panel > span`
          fix replaced elsewhere. */}
      <div className={styles.topRow}>
        <HelpTip id="generationSettings.playerCount">
          <div className={styles.field}>
            <label htmlFor="generation-player-count">Players</label>
            <input
              id="generation-player-count"
              className={styles.playerInput}
              type="number"
              min={MIN_PLAYER_COUNT}
              max={MAX_PLAYER_COUNT}
              // Editable even while a preset is active (2026-09-16): typing a
              // count here is a deliberate override, and
              // GenerationSettingsContext's setPlayerCount clears the preset
              // itself (restoring the teams it displaced) rather than this
              // component needing to know about presets at all.
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
          <div className={styles.field}>
            <label htmlFor="generation-map-size">Map size</label>
            <MapSizePicker value={mapSize} onChange={setMapSize} />
          </div>
        </HelpTip>

        {/* A lobby setting like the two fields beside it. The checkbox comes
            first and the label points at it with htmlFor, the same idiom as
            GeneralSettings, so clicking the words toggles it too. */}
        <HelpTip id="generationSettings.teamPositions">
          <div className={styles.field}>
            <input
              id="generation-team-positions"
              type="checkbox"
              checked={teamPositions}
              onChange={(event) => setTeamPositions(event.target.checked)}
            />
            <label htmlFor="generation-team-positions">Team Positions</label>
          </div>
        </HelpTip>
      </div>

      <TeamSection />
    </div>
  );
}
