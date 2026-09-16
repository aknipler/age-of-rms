import { useCodeSettings, TAB_SIZE_OPTIONS } from "../../settings/CodeSettingsContext";
import { HelpTip } from "../HelpTip";
import dialogStyles from "../dialog.module.css";
import settingsStyles from "./SettingsDialog.module.css";
import styles from "./BreakdownSettings.module.css";

export function CodeSettings() {
  const { tabSize, setTabSize, insertSpaces, setInsertSpaces } = useCodeSettings();

  return (
    <>
      <h3 className={settingsStyles.panelTitle}>Code</h3>

      <HelpTip id="settings.code.indentation">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Indentation</legend>
          <select
            className={styles.select}
            value={tabSize}
            onChange={(event) => setTabSize(Number(event.target.value))}
          >
            {TAB_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} spaces per tab
              </option>
            ))}
          </select>
          <div className={dialogStyles.optionRow}>
            <input
              type="radio"
              id="code-indent-spaces"
              name="code-insert-spaces"
              checked={insertSpaces}
              onChange={() => setInsertSpaces(true)}
            />
            <label htmlFor="code-indent-spaces">Insert spaces</label>
          </div>
          <div className={dialogStyles.optionRow}>
            <input
              type="radio"
              id="code-indent-tabs"
              name="code-insert-spaces"
              checked={!insertSpaces}
              onChange={() => setInsertSpaces(false)}
            />
            <label htmlFor="code-indent-tabs">Insert tabs</label>
          </div>
        </fieldset>
      </HelpTip>
    </>
  );
}
