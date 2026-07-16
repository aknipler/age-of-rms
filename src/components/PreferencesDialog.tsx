import { useHelpSettings } from "../help/HelpSettingsContext";
import type { HelpMode } from "../help/helpConstants";
import { HelpTip } from "./HelpTip";
import styles from "./PreferencesDialog.module.css";

const HELP_MODE_OPTIONS: ReadonlyArray<{ value: HelpMode; label: string }> = [
  { value: "hover", label: "Show tips on hover" },
  { value: "alt-hover", label: "Show tips only while holding ALT" },
  { value: "off", label: "Off" },
];

interface PreferencesDialogProps {
  onClose: () => void;
}

// A simple modal, not a separate window — Tauri windows are heavier to
// set up (own webview, own close-guard) and this dialog is small enough
// that an overlay + fixed-position box is the simpler choice.
export function PreferencesDialog({ onClose }: PreferencesDialogProps) {
  const { mode, setMode } = useHelpSettings();

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <h2 className={styles.title}>Preferences</h2>
        <HelpTip id="preferences.helpMode">
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend>Help tips</legend>
            {HELP_MODE_OPTIONS.map((option) => (
              <div className={styles.optionRow} key={option.value}>
                <input
                  type="radio"
                  id={`help-mode-${option.value}`}
                  name="help-mode"
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <label htmlFor={`help-mode-${option.value}`}>{option.label}</label>
              </div>
            ))}
          </fieldset>
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
