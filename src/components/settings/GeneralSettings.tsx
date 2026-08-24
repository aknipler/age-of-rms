import { useHelpSettings } from "../../help/HelpSettingsContext";
import type { HelpMode } from "../../help/helpConstants";
import { useAppSettings } from "../../settings/AppSettingsContext";
import { NAME_LENGTH_LIMIT, SHORTENED_PREFIX_LENGTH } from "../../settings/nameDisplay";
import { AUTHOR_NAME_MAX_LENGTH } from "../../settings/authorName";
import { UNKNOWN_AUTHOR } from "../../hooks/scriptHeader";
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
  const { shortenLongNames, setShortenLongNames, authorName, setAuthorName } = useAppSettings();

  return (
    <>
      <h3 className={styles.panelTitle}>General</h3>

      {/* A controlled input: React holds the value and the DOM node only
          reports what was typed. Standard React practice rather than a
          project quirk, and it is what lets the setter clamp the length and
          write the store on the same keystroke. */}
      <HelpTip id="settings.authorName">
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Author</legend>
          <div className={dialogStyles.optionRow}>
            <label htmlFor="author-name">Your name</label>
            <input
              type="text"
              id="author-name"
              className={styles.textInput}
              value={authorName}
              maxLength={AUTHOR_NAME_MAX_LENGTH}
              placeholder={UNKNOWN_AUTHOR}
              onChange={(event) => setAuthorName(event.target.value)}
            />
          </div>
          <p className={styles.hint}>
            Written into the comment at the top of every script this app creates. Scripts already
            saved keep the name they were stamped with.
          </p>
        </fieldset>
      </HelpTip>

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
