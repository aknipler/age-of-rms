import { useRef } from "react";
import { PreviewPane } from "../preview/PreviewPane";
import { ReferenceTable } from "./ReferenceTable";
import { useSidePanelLayout } from "./SidePanelLayoutContext";
import { SidePanelReopener, SidePanelResizer } from "./SidePanelResizer";
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
 *
 * As of CREATION_PLAN 4.4 it is resizable and collapsible. The width and the
 * collapsed flag come from context rather than local state, because both tabs
 * render their own instance of this component and the inactive one is
 * unmounted — SidePanelLayoutContext.tsx has the full reasoning. This returns
 * a fragment of two siblings (panel, then separator) so both land directly in
 * the surrounding pane's flex row; wrapping them in a div of their own would
 * put a fixed-width box around a column whose whole point is to change width.
 */
export function MapSidePanel() {
  const { width, collapsed } = useSidePanelLayout();
  // Handed to the resizer, which reads the panel's left edge on every drag
  // frame to turn a pointer position into a width.
  const panelRef = useRef<HTMLDivElement>(null);

  if (collapsed) return <SidePanelReopener />;

  return (
    <>
      {/* Inline style, not a CSS variable or a class: this is a live numeric
          value that changes on every frame of a drag, which is exactly the
          case inline styles are for. The stylesheet still owns everything
          that does not change, including the max-width that keeps the panel
          from eating the editor on a narrow window. */}
      <div ref={panelRef} className={styles.panel} style={{ width }}>
        <PreviewPane />
        <ReferenceTable />
      </div>
      <SidePanelResizer panelRef={panelRef} />
    </>
  );
}
