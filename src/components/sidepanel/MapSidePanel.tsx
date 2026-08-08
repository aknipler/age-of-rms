import { PreviewPane } from "../preview/PreviewPane";
import { ReferenceTable } from "./ReferenceTable";
import styles from "./MapSidePanel.module.css";

/**
 * The map preview + reference table column, shared by the Breakdown and Code
 * tabs.
 *
 * It began as `BreakdownSidePanel` under `src/breakdown/` (breakdown-design
 * Sec.3.8/Sec.6.1) and moved here when Code grew the same column: a component
 * both tabs render does not belong inside one of them, and the old name
 * claimed an ownership that had stopped being true. Nothing about its
 * contents changed in the move.
 *
 * Neither child takes props. Both read what they need from module-level
 * reference data or context, which is what lets the same element be dropped
 * into two different panes without either pane knowing anything about them.
 */
export function MapSidePanel() {
  return (
    <div className={styles.panel}>
      <PreviewPane />
      <ReferenceTable />
    </div>
  );
}
