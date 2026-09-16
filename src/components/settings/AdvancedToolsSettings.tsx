import { HelpTip } from "../HelpTip";
import { registeredTools } from "../../tools/registry";
import settingsStyles from "./SettingsDialog.module.css";
import styles from "./AdvancedToolsSettings.module.css";

// The pane this tab describes now exists, so the old placeholder copy ("hasn't
// been built yet, so it has nothing to configure") stopped being true the
// moment ToolsPane landed. Shipping a settings tab that tells the user a
// feature does not exist while they are using it is the defect this replaces.
//
// What it deliberately does NOT offer: default parameter values and a v1.1
// registry URL. Both are real wants and neither is v1, params belong to the
// run, and there is no external registry to point at yet.
export function AdvancedToolsSettings() {
  const tools = registeredTools();

  return (
    <div className={styles.panel}>
      {/* Every sibling tab opens with settingsStyles.panelTitle naming
          itself (2026-09-16 fix); this one went straight to "Installed
          tools" with no "Advanced Tools" heading at all, the one settings
          tab that didn't say which tab you were on. */}
      <h3 className={settingsStyles.panelTitle}>Advanced Tools</h3>
      <p className={styles.intro}>
        Tools run against the open script and return a report, and sometimes
        proposed changes. Changes are never applied on your behalf; the pane
        shows an Apply button and one undo step covers the whole set.
      </p>

      <HelpTip id="settings.tab.advancedTools">
        <div>
          <h3 className={styles.heading}>Installed tools</h3>
          <ul className={styles.list}>
            {tools.map((tool) => (
              <li key={tool.manifest.id} className={styles.item}>
                <span className={styles.name}>{tool.manifest.name}</span>
                <span className={styles.version}>v{tool.manifest.version}</span>
                <p className={styles.description}>
                  {tool.manifest.description}
                </p>
                <p className={styles.capabilities}>
                  Reads: {describeCapabilities(tool.manifest.capabilities)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </HelpTip>
    </div>
  );
}

// Plain language, not capability ids. This copy is the ancestor of the v1.1
// consent dialog, where over-claiming is a trust problem rather than a wording
// one, which is exactly why the capability is named read-generation-settings
// and not read-settings: one settings.json holds several unrelated families and
// a tool gets only the generation one.
function describeCapabilities(capabilities: readonly string[]): string {
  const parts: string[] = [];
  if (capabilities.includes("read-ast") || capabilities.includes("read-source"))
    parts.push("your script");
  if (capabilities.includes("read-generation-settings"))
    parts.push("player count and map size");
  if (capabilities.includes("read-reference"))
    parts.push("the built-in reference data");
  if (capabilities.includes("read-selection"))
    parts.push("where your cursor is");
  if (capabilities.includes("edit-source"))
    parts.push("and can propose changes to your script");
  return parts.length > 0 ? parts.join(", ") : "nothing";
}
