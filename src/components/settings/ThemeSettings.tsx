import { useState } from "react";
import { useThemeSettings } from "../../settings/ThemeSettingsContext";
import { BUILT_IN_THEMES, THEME_TOKEN_GROUPS, resolveThemeName, type ThemeTokenId } from "../../settings/theme";
import { HelpTip } from "../HelpTip";
import settingsStyles from "./SettingsDialog.module.css";
import hotkeyStyles from "./HotkeysSettings.module.css";
import styles from "./ThemeSettings.module.css";

/** Everything a colour token needs to render one grid row. */
function TokenRow({ id, label }: { id: ThemeTokenId; label: string }) {
  const { draftTokens, setDraftToken } = useThemeSettings();
  return (
    <>
      <label htmlFor={`theme-token-${id}`} className={styles.tokenLabel}>
        {label}
      </label>
      <span className={styles.tokenControl}>
        <input
          type="color"
          id={`theme-token-${id}`}
          className={styles.swatch}
          value={/^#[0-9a-fA-F]{6}$/.test(draftTokens[id]) ? draftTokens[id] : "#000000"}
          onChange={(event) => setDraftToken(id, event.target.value)}
        />
        <input
          type="text"
          className={styles.hexInput}
          value={draftTokens[id]}
          onChange={(event) => setDraftToken(id, event.target.value)}
          aria-label={`${label} (hex)`}
        />
      </span>
    </>
  );
}

function FontRow({ id, label }: { id: ThemeTokenId; label: string }) {
  const { draftTokens, setDraftToken } = useThemeSettings();
  return (
    <>
      <label htmlFor={`theme-token-${id}`} className={styles.tokenLabel}>
        {label}
      </label>
      <span className={styles.tokenControl}>
        <input
          type="text"
          id={`theme-token-${id}`}
          className={styles.fontInput}
          value={draftTokens[id]}
          onChange={(event) => setDraftToken(id, event.target.value)}
        />
      </span>
    </>
  );
}

export function ThemeSettings() {
  const {
    activeThemeId,
    customThemes,
    isDirty,
    isActiveThemeCustom,
    selectTheme,
    resetDraft,
    saveAsNewTheme,
    updateActiveTheme,
    renameCustomTheme,
    deleteCustomTheme,
  } = useThemeSettings();

  // Local-only: the inline "name this theme" field is UI state, not
  // something ThemeSettingsContext has any reason to hold — it exists for
  // exactly as long as this form is open.
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  function openSaveAs() {
    setSaveAsName(isActiveThemeCustom ? `${resolveThemeName(activeThemeId, customThemes)} copy` : "My theme");
    setSaveAsOpen(true);
  }

  function confirmSaveAs() {
    if (saveAsName.trim().length === 0) return;
    saveAsNewTheme(saveAsName);
    setSaveAsOpen(false);
  }

  function openRename() {
    setRenameValue(resolveThemeName(activeThemeId, customThemes));
    setRenameOpen(true);
  }

  function confirmRename() {
    if (renameValue.trim().length === 0) return;
    renameCustomTheme(activeThemeId, renameValue);
    setRenameOpen(false);
  }

  return (
    <>
      <h3 className={settingsStyles.panelTitle}>Theme</h3>

      <HelpTip id="settings.theme.picker">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Active theme</legend>
          <div className={styles.themePicker}>
            <select
              className={styles.select}
              value={activeThemeId}
              onChange={(event) => selectTheme(event.target.value)}
            >
              <option value="light">{BUILT_IN_THEMES.light.name}</option>
              <option value="dark">{BUILT_IN_THEMES.dark.name}</option>
              {customThemes.length > 0 && (
                <optgroup label="My themes">
                  {customThemes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {isDirty && <span className={styles.dirtyNote}>Unsaved changes — previewed live, not yet saved</span>}
          </div>

          <div className={styles.actionRow}>
            {isDirty && (
              <button type="button" className={hotkeyStyles.button} onClick={resetDraft}>
                Discard changes
              </button>
            )}
            {isActiveThemeCustom && isDirty && (
              <button type="button" className={hotkeyStyles.button} onClick={updateActiveTheme}>
                Update "{resolveThemeName(activeThemeId, customThemes)}"
              </button>
            )}
            {!saveAsOpen && (
              <button type="button" className={hotkeyStyles.button} onClick={openSaveAs}>
                Save as new theme…
              </button>
            )}
            {saveAsOpen && (
              <>
                <input
                  type="text"
                  className={styles.nameInput}
                  value={saveAsName}
                  autoFocus
                  onChange={(event) => setSaveAsName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmSaveAs();
                    if (event.key === "Escape") setSaveAsOpen(false);
                  }}
                />
                <button type="button" className={hotkeyStyles.button} onClick={confirmSaveAs}>
                  Save
                </button>
                <button type="button" className={hotkeyStyles.button} onClick={() => setSaveAsOpen(false)}>
                  Cancel
                </button>
              </>
            )}
            {isActiveThemeCustom && !renameOpen && (
              <button type="button" className={hotkeyStyles.button} onClick={openRename}>
                Rename…
              </button>
            )}
            {renameOpen && (
              <>
                <input
                  type="text"
                  className={styles.nameInput}
                  value={renameValue}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmRename();
                    if (event.key === "Escape") setRenameOpen(false);
                  }}
                />
                <button type="button" className={hotkeyStyles.button} onClick={confirmRename}>
                  Save name
                </button>
                <button type="button" className={hotkeyStyles.button} onClick={() => setRenameOpen(false)}>
                  Cancel
                </button>
              </>
            )}
            {isActiveThemeCustom && (
              <button type="button" className={hotkeyStyles.button} onClick={() => deleteCustomTheme(activeThemeId)}>
                Delete
              </button>
            )}
          </div>
          <p className={settingsStyles.hint}>
            Light and Dark ship with the app and can&apos;t be edited in place — change a colour below and Save as
            new theme to keep it. A theme you saved can be updated, renamed or deleted here.
          </p>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.theme.customize">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Customize</legend>
          <p className={styles.customizeHint}>
            Every change below previews instantly across the whole app. Nothing is saved until you use Save as new
            theme or Update above.
          </p>
          {THEME_TOKEN_GROUPS.map((group) => (
            <div className={styles.group} key={group.label}>
              <h4 className={styles.groupTitle}>{group.label}</h4>
              <div className={styles.tokenGrid}>
                {group.tokens.map((token) =>
                  token.kind === "color" ? (
                    <TokenRow key={token.id} id={token.id} label={token.label} />
                  ) : (
                    <FontRow key={token.id} id={token.id} label={token.label} />
                  ),
                )}
              </div>
            </div>
          ))}
        </fieldset>
      </HelpTip>
    </>
  );
}
