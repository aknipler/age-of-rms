import { useHelpSettings } from "../../help/HelpSettingsContext";
import type { HelpMode } from "../../help/helpConstants";
import { useAppSettings } from "../../settings/AppSettingsContext";
import { NAME_LENGTH_LIMIT, SHORTENED_PREFIX_LENGTH } from "../../settings/nameDisplay";
import { HelpTip } from "../HelpTip";
import dialogStyles from "../dialog.module.css";
import styles from "./SettingsDialog.module.css";

const HELP_MODE_OPTIONS: ReadonlyArray<{ value: HelpMode; label: string }> = [
  { value: "hover", label: "Show tips on hover" },
  { value: "alt-hover", label: "Show tips only while holding ALT" },
  { value: "off", label: "Off" },
];

// The only tab with real controls today. Help mode moved here verbatim
// from the old PreferencesDialog — same state, same persisted key, just a
// different place in the tree.
export function GeneralSettings() {
  const { mode, setMode } = useHelpSettings();
  const { shortenLongNames, setShortenLongNames } = useAppSettings();

  return (
    <>
      <h3 className={styles.panelTitle}>General</h3>
      <HelpTip id="settings.helpMode">
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Help tips</legend>
          {HELP_MODE_OPTIONS.map((option) => (
            <div className={dialogStyles.optionRow} key={option.value}>
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
          <p className={styles.hint}>
            Tips are the small popups that explain a control when you hover it.
          </p>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.shortenLongNames">
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Names</legend>
          <div className={dialogStyles.optionRow}>
            <input
              type="checkbox"
              id="shorten-long-names"
              checked={shortenLongNames}
              onChange={(event) => setShortenLongNames(event.target.checked)}
            />
            <label htmlFor="shorten-long-names">Shorten long #const / #define names</label>
          </div>
          <p className={styles.hint}>
            Names longer than {NAME_LENGTH_LIMIT} characters show their first{" "}
            {SHORTENED_PREFIX_LENGTH} letters followed by an ellipsis. Hover one to read it in
            full.
          </p>
        </fieldset>
      </HelpTip>
    </>
  );
}
