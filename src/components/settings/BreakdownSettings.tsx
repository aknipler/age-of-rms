import {
  useBreakdownSettings,
  type BreakdownDensity,
} from "../../settings/BreakdownSettingsContext";
import type { AttributeOrderMode } from "../../breakdown/attributeModel";
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

export function BreakdownSettings() {
  const { attributeOrderMode, setAttributeOrderMode, density, setDensity } =
    useBreakdownSettings();

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
    </>
  );
}
