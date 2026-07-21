import { useState } from "react";
import { HelpTip } from "../../components/HelpTip";
import styles from "./PreviewPlaceholder.module.css";

// docs/breakdown-design.md §3.8 — Phase-4 stub. Reserves the layout and
// the Current/Final toggle; no preview logic here (that's Phase 4/M4).
export function PreviewPlaceholder() {
  const [view, setView] = useState<"current" | "final">("current");
  return (
    <div className={styles.placeholder}>
      <HelpTip id="breakdown.sidePanel.previewToggle">
        <div className={styles.toggle}>
          <label>
            <input
              type="radio"
              name="preview-view"
              checked={view === "current"}
              onChange={() => setView("current")}
            />
            Current
          </label>
          <label>
            <input type="radio" name="preview-view" checked={view === "final"} onChange={() => setView("final")} />
            Final
          </label>
        </div>
      </HelpTip>
      <div className={styles.diamond}>Approximate preview — arrives in Phase 4</div>
    </div>
  );
}
