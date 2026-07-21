import { PreviewPlaceholder } from "./PreviewPlaceholder";
import { ReferenceTable } from "./ReferenceTable";
import styles from "./BreakdownSidePanel.module.css";

// docs/breakdown-design.md §3.8/§6.1 — left panel: preview placeholder
// (Phase-4 stub) + reference table (3.2 scope).
export function BreakdownSidePanel() {
  return (
    <div className={styles.panel}>
      <PreviewPlaceholder />
      <ReferenceTable />
    </div>
  );
}
