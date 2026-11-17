import { HelpTip } from "../HelpTip";
import { DIAGNOSTIC_CODES } from "../../parser/diagnostics";
import { useDiagnosticDismissal } from "../../settings/DiagnosticDismissalContext";
import dialogStyles from "../dialog.module.css";
import settingsStyles from "./SettingsDialog.module.css";
import styles from "./DiagnosticsSettings.module.css";

/**
 * Where hidden warnings come back. A warning the user may hide offers "Ok"
 * (this file) and "Don't show me this again" (everywhere) in its popup or
 * hover. This tab lists the second kind, each with a button to turn it back
 * on, and offers one button for every warning hidden with "Ok".
 */
const SWITCH_BRANCH_CODE = "RMS0323";

export function DiagnosticsSettings() {
  const {
    turnedOff,
    turnOff,
    turnBackOn,
    filesWithHidden,
    clearHiddenForFiles,
  } = useDiagnosticDismissal();
  // RMS0323 has a checkbox of its own below, so the list of turned off
  // warnings skips it. Both read and write the same per-code state, so the
  // checkbox and the hover's "Don't show me this again" cannot disagree.
  const listed = turnedOff.filter((code) => code !== SWITCH_BRANCH_CODE);
  const switchBranchesShown = !turnedOff.includes(SWITCH_BRANCH_CODE);

  return (
    <>
      <h3 className={settingsStyles.panelTitle}>Diagnostics</h3>

      <HelpTip id="settings.diagnostics.switchBranches">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Notes</legend>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={switchBranchesShown}
              onChange={(event) =>
                event.target.checked
                  ? turnBackOn(SWITCH_BRANCH_CODE)
                  : turnOff(SWITCH_BRANCH_CODE)
              }
            />
            Report branches a switch turns off
          </label>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.diagnostics.turnedOff">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Warnings turned off</legend>
          {listed.length === 0 ? (
            <p className={settingsStyles.hint}>
              None. A warning you can hide offers &quot;Don&apos;t show me this
              again&quot; when you hover it.
            </p>
          ) : (
            <ul className={styles.list}>
              {listed.map((code) => (
                <li key={code} className={styles.item}>
                  <span className={styles.summary}>
                    {DIAGNOSTIC_CODES[code]?.summary ?? code}
                    <span className={styles.code}> {code}</span>
                  </span>
                  <HelpTip id="settings.diagnostics.turnBackOn">
                    <button
                      type="button"
                      className={dialogStyles.closeButton}
                      onClick={() => turnBackOn(code)}
                    >
                      Turn back on
                    </button>
                  </HelpTip>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.diagnostics.hiddenInFiles">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>
            Warnings hidden in single files
          </legend>
          <div className={styles.item}>
            <p className={settingsStyles.hint}>
              {filesWithHidden === 0
                ? "None. Clicking Ok on a warning hides it in that file only."
                : `${filesWithHidden} ${filesWithHidden === 1 ? "file has" : "files have"} a warning hidden with Ok.`}
            </p>
            <button
              type="button"
              className={dialogStyles.closeButton}
              disabled={filesWithHidden === 0}
              onClick={clearHiddenForFiles}
            >
              Show them again
            </button>
          </div>
        </fieldset>
      </HelpTip>
    </>
  );
}
