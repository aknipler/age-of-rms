import { useEffect } from "react";
import { useHotkeySettings } from "../../settings/HotkeySettingsContext";
import { DEFAULT_HOTKEYS, formatHotkey, hotkeyFromEvent, hotkeysEqual, type HotkeyId } from "../../settings/hotkeys";
import { HelpTip } from "../HelpTip";
import dialogStyles from "../dialog.module.css";
import styles from "./SettingsDialog.module.css";
import hotkeyStyles from "./HotkeysSettings.module.css";

/**
 * UI-only metadata for each binding — legend/hint copy belongs here, not in
 * hotkeys.ts, which stays free of React/UI concerns for the same reason
 * nameDisplay.ts's matching logic does (see that file's header). Order here
 * is the order rows render in, grouped by where the action lives.
 */
const HOTKEY_ROWS: { id: HotkeyId; legend: string; hint: string }[] = [
  { id: "save", legend: "Save", hint: "Saves the open file, wherever you are in the app — including while editing." },
  {
    id: "saveAs",
    legend: "Save As",
    hint: "Opens the Save As dialog to save the open file under a new name or location, same as File > Save As…",
  },
  {
    id: "newFile",
    legend: "New File",
    hint: "Starts a blank map, prompting to save first if the current one has unsaved changes.",
  },
  {
    id: "openFile",
    legend: "Open File",
    hint: "Opens the file picker to load a different .rms file, same as File > Open.",
  },
  {
    id: "previewToggleView",
    legend: "Preview: Toggle Current/Final",
    hint: "Switches the preview between Final (the whole script) and Current (truncated at the pin, or the caret). A pin stays set across the switch either way.",
  },
  {
    id: "previewReseed",
    legend: "Preview: Re-roll Seed",
    hint: "Draws a new random seed for the preview, same as clicking Re-roll.",
  },
  {
    id: "breakdownDeleteCard",
    legend: "Breakdown: Delete Selected Card",
    hint: "Deletes the selected command, directive, if/elseif or start_random card — same as its own Delete button. Does nothing when the selection isn't a deletable card.",
  },
  {
    id: "breakdownAddCommand",
    legend: "Breakdown: Add Command",
    hint: "Opens the command picker, inserting after the selected card or at the end of the active section — same as the + Add command button.",
  },
  {
    id: "codeToggleLayout",
    legend: "Code: Toggle Command Layout",
    hint: "Flips the command under the cursor between one line and one attribute per line. With a selection, every command it touches is toggled independently — each to the opposite of its own current shape, not to a shared target. Does nothing where flipping isn't safe, such as a block holding a nested if/start_random.",
  },
];

function HotkeyRow({ id, legend, hint }: { id: HotkeyId; legend: string; hint: string }) {
  const { hotkeys, resetHotkey, recordingId, setRecordingId } = useHotkeySettings();
  const recording = recordingId === id;
  const isDefault = hotkeysEqual(hotkeys[id], DEFAULT_HOTKEYS[id]);

  return (
    <HelpTip id={`settings.hotkeys.${id}`}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{legend}</legend>
        <div className={dialogStyles.optionRow}>
          <kbd className={hotkeyStyles.keyChip}>{recording ? "Press a key…" : formatHotkey(hotkeys[id])}</kbd>
          <button
            type="button"
            className={hotkeyStyles.button}
            onClick={() => setRecordingId(recording ? null : id)}
          >
            {recording ? "Cancel" : "Change"}
          </button>
          {!isDefault && !recording && (
            <button type="button" className={hotkeyStyles.button} onClick={() => resetHotkey(id)}>
              Reset to {formatHotkey(DEFAULT_HOTKEYS[id])}
            </button>
          )}
        </div>
        <p className={styles.hint}>
          {recording ? "Press a key combination that includes Ctrl or Alt. Escape cancels." : hint}
        </p>
      </fieldset>
    </HelpTip>
  );
}

export function HotkeysSettings() {
  const { setHotkey, recordingId, setRecordingId } = useHotkeySettings();

  // Closing Settings (or switching to a different settings tab) mid-record
  // unmounts this component without ever pressing Escape or a valid key —
  // without this, `recordingId` would stay stuck non-null forever, which
  // silently suppresses every hotkey listener in the app (they all check
  // recordingId first — see HotkeySettingsContext.tsx), not just the one
  // being recorded. Mount-only: the cleanup, not the effect body, is the
  // point.
  useEffect(() => {
    return () => setRecordingId(null);
  }, [setRecordingId]);

  // The one listener that actually captures a new binding, live only while
  // some row is recording — recordingId already guarantees at most one row
  // is ever "Press a key…" at a time, so one shared listener (rather than
  // one per HotkeyRow) is both correct and cheaper. A bare modifier or a
  // press with neither Ctrl nor Alt held (hotkeyFromEvent returning null —
  // see its own doc comment for why) is swallowed rather than accepted, so
  // the box just keeps listening instead of quietly binding the action to
  // something that would fire while typing.
  useEffect(() => {
    if (recordingId === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      if (event.key === "Escape") {
        setRecordingId(null);
        return;
      }
      const next = hotkeyFromEvent(event);
      if (next && recordingId !== null) {
        setHotkey(recordingId, next);
        setRecordingId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recordingId, setHotkey, setRecordingId]);

  return (
    <>
      <h3 className={styles.panelTitle}>Hotkeys</h3>
      {HOTKEY_ROWS.map((row) => (
        <HotkeyRow key={row.id} {...row} />
      ))}
    </>
  );
}
