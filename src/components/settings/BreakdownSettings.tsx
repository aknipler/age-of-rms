import {
  useBreakdownSettings,
  type BreakdownDensity,
  type SummaryClickAction,
} from "../../settings/BreakdownSettingsContext";
import type { AttributeOrderMode } from "../../breakdown/attributeModel";
import { useState } from "react";
import languageDataRaw from "../../../reference/data/language.json";
import { HelpTip } from "../HelpTip";
import settingsStyles from "./SettingsDialog.module.css";
import styles from "./BreakdownSettings.module.css";

const ATTRIBUTE_ORDER_OPTIONS: { id: AttributeOrderMode; label: string }[] = [
  {
    id: "required",
    label: "Required first, then text, then number, then boolean",
  },
  { id: "alphabetical", label: "Alphabetical" },
  { id: "fileOrder", label: "File order (as written in the code)" },
  { id: "custom", label: "Custom (drag to reorder within each card)" },
];

const DENSITY_OPTIONS: { id: BreakdownDensity; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

// Every attribute name the language data knows, for the exclusion list's
// autocomplete. Read from language.json rather than typed here (hard rule,
// vocabulary is data-driven).
const ATTRIBUTE_NAMES: string[] = (
  languageDataRaw as { attributes: { name: string }[] }
).attributes
  .map((a) => a.name)
  .sort();

const SUMMARY_CLICK_OPTIONS: { id: SummaryClickAction; label: string }[] = [
  { id: "open", label: "Open the card and go to that attribute" },
  { id: "edit", label: "Edit it in place, in the summary line" },
];

export function BreakdownSettings() {
  const {
    attributeOrderMode,
    setAttributeOrderMode,
    density,
    setDensity,
    scrollToAddedCard,
    setScrollToAddedCard,
    summaryClick,
    setSummaryClick,
    hideUnused,
    setHideUnused,
    hideUnusedExceptions,
    setHideUnusedExceptions,
  } = useBreakdownSettings();
  // Draft text for the exclusion-list input. Local state, committed on
  // Enter or the Add button, so a half-typed name is never persisted.
  const [exceptionDraft, setExceptionDraft] = useState("");
  const addException = () => {
    const name = exceptionDraft.trim();
    if (!name) return;
    setHideUnusedExceptions([...hideUnusedExceptions, name]);
    setExceptionDraft("");
  };

  return (
    <>
      <h3 className={settingsStyles.panelTitle}>Breakdown</h3>

      <HelpTip id="settings.breakdown.density">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Density</legend>
          <select
            className={styles.select}
            value={density}
            onChange={(event) =>
              setDensity(event.target.value as BreakdownDensity)
            }
          >
            {DENSITY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.breakdown.attributeOrder">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Attribute order</legend>
          <select
            className={styles.select}
            value={attributeOrderMode}
            onChange={(event) =>
              setAttributeOrderMode(event.target.value as AttributeOrderMode)
            }
          >
            {ATTRIBUTE_ORDER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.breakdown.scrollToAddedCard">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Adding cards</legend>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={scrollToAddedCard}
              onChange={(event) => setScrollToAddedCard(event.target.checked)}
            />
            Scroll to a card when it is added
          </label>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.breakdown.hideUnused">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>Unused attributes</legend>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={hideUnused}
              onChange={(event) => setHideUnused(event.target.checked)}
            />
            Hide unused attributes
          </label>
          <p className={styles.hint}>
            Which rows a card shows is decided when it opens. A search bar at
            the top of each card adds hidden attributes back.
          </p>
          <HelpTip id="settings.breakdown.hideUnusedExceptions">
            <div className={styles.exceptions}>
              <span className={styles.exceptionsLabel}>Always show</span>
              {hideUnusedExceptions.map((name) => (
                <span key={name} className={styles.chip}>
                  {name}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Stop always showing ${name}`}
                    onClick={() =>
                      setHideUnusedExceptions(
                        hideUnusedExceptions.filter((n) => n !== name),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                className={styles.exceptionInput}
                list="settings-attribute-names"
                placeholder="attribute name"
                value={exceptionDraft}
                onChange={(event) => setExceptionDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addException();
                  }
                }}
              />
              <datalist id="settings-attribute-names">
                {ATTRIBUTE_NAMES.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <button
                type="button"
                className={styles.addException}
                onClick={addException}
              >
                Add
              </button>
            </div>
          </HelpTip>
        </fieldset>
      </HelpTip>

      <HelpTip id="settings.breakdown.summaryClick">
        <fieldset className={settingsStyles.fieldset}>
          <legend className={settingsStyles.legend}>
            Clicking an attribute in a collapsed card
          </legend>
          <select
            className={styles.select}
            value={summaryClick}
            onChange={(event) =>
              setSummaryClick(event.target.value as SummaryClickAction)
            }
          >
            {SUMMARY_CLICK_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </fieldset>
      </HelpTip>
    </>
  );
}
