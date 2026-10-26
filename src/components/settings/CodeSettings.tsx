import {
  useCodeSettings,
  TAB_SIZE_OPTIONS,
} from "../../settings/CodeSettingsContext";
import {
  isSuggestionKeys,
  useAppSettings,
} from "../../settings/AppSettingsContext";
import { HelpTip } from "../HelpTip";
import dialogStyles from "../dialog.module.css";
import settingsStyles from "./SettingsDialog.module.css";
import styles from "./BreakdownSettings.module.css";

export function CodeSettings() {
  const { tabSize, setTabSize, insertSpaces, setInsertSpaces } =
    useCodeSettings();
  const {
    resolveFlash,
    setResolveFlash,
    codePrediction,
    setCodePrediction,
    suggestionKeys,
    setSuggestionKeys,
  } = useAppSettings();

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

      <HelpTip id="settings.code.suggestionKeys">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Suggestion keys</legend>
          <select
            className={styles.select}
            value={suggestionKeys}
            aria-label="Suggestion keys"
            onChange={(event) => {
              if (isSuggestionKeys(event.target.value))
                setSuggestionKeys(event.target.value);
            }}
          >
            <option value="enter">
              Enter accepts, Tab steps down the list
            </option>
            <option value="tab">Tab accepts, Enter starts a new line</option>
            <option value="both">Enter and Tab both accept</option>
          </select>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.code.resolveFlash">
        <div className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            id="code-resolve-flash"
            checked={resolveFlash}
            onChange={(event) => setResolveFlash(event.target.checked)}
          />
          <label htmlFor="code-resolve-flash">
            Flash a name green when it resolves
          </label>
        </div>
      </HelpTip>

      <HelpTip id="settings.code.prediction">
        <div className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            id="code-prediction"
            checked={codePrediction}
            onChange={(event) => setCodePrediction(event.target.checked)}
          />
          <label htmlFor="code-prediction">
            Predict the rest of a line and whole blocks
          </label>
        </div>
      </HelpTip>
    </>
  );
}
