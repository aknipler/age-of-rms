import { useRef, type KeyboardEvent } from "react";
import { HelpTip } from "../HelpTip";
import { PreviewPane } from "../preview/PreviewPane";
import { ReferenceTable } from "./ReferenceTable";
import { useSidePanelLayout } from "./SidePanelLayoutContext";
import { SidePanelReopener, SidePanelResizer } from "./SidePanelResizer";
import { useSidePanelTab } from "./SidePanelTabContext";
import type { SidePanelTab } from "./sidePanelTabs";
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
 * unmounted. SidePanelLayoutContext.tsx has the full reasoning. This returns
 * a fragment of two siblings (panel, then separator) so both land directly in
 * the surrounding pane's flex row; wrapping them in a div of their own would
 * put a fixed-width box around a column whose whole point is to change width.
 *
 * The preview and the reference table share the panel as TABS (beta
 * feedback), where they used to split its height with a draggable bar. Both
 * stay MOUNTED and the inactive one is hidden with `display: none`, rather
 * than rendering only the selected one. The reference table keeps its mode,
 * search text and sort in local state, so unmounting it on every switch to
 * the preview would put it back on the Terrain list each time, which is
 * exactly wrong for someone ticking objects in the Preview Obj. List and
 * flicking across to see what disappeared. The cost is that a hidden canvas
 * still redraws when a generation lands; that is one drawImage, and a hidden
 * canvas reports a zero size, so OverlayCanvas's ResizeObserver skips the
 * refit until it is shown again.
 */
const TABS: readonly { id: SidePanelTab; label: string; helpId: string }[] = [
  { id: "preview", label: "Preview", helpId: "sidePanel.tabPreview" },
  { id: "reference", label: "Reference", helpId: "sidePanel.tabReference" },
];

export function MapSidePanel() {
  const { width, collapsed } = useSidePanelLayout();
  const { tab, setTab } = useSidePanelTab();
  // Handed to the width resizer, which reads the panel's own edges on every
  // drag frame to turn a pointer position into a width.
  const panelRef = useRef<HTMLDivElement>(null);

  if (collapsed) return <SidePanelReopener />;

  // Left and Right swap tabs, the keyboard model a tab strip is expected to
  // have (the ARIA "tabs" pattern). With two tabs both keys just toggle.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: SidePanelTab = tab === "preview" ? "reference" : "preview";
    setTab(next);
    // Focus follows the selection, or the next arrow press would act on a
    // tab that is no longer the selected one.
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
      ?.focus();
  };

  return (
    <>
      {/* Inline style, not a CSS variable or a class: this is a live numeric
          value that changes on every frame of a drag, which is exactly the
          case inline styles are for. The stylesheet still owns everything
          that does not change, including the max-width that keeps the panel
          from eating the editor on a narrow window. */}
      <div ref={panelRef} className={styles.panel} style={{ width }}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Map panel"
          onKeyDown={handleKeyDown}
        >
          {TABS.map(({ id, label, helpId }) => (
            <HelpTip key={id} id={helpId}>
              <button
                type="button"
                role="tab"
                data-tab={id}
                aria-selected={tab === id}
                // Roving tabindex: only the selected tab is in the Tab
                // order, the arrow keys move between them.
                tabIndex={tab === id ? 0 : -1}
                className={
                  tab === id ? `${styles.tab} ${styles.tabActive}` : styles.tab
                }
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            </HelpTip>
          ))}
        </div>
        <div
          className={
            tab === "preview"
              ? styles.previewSlot
              : `${styles.previewSlot} ${styles.slotHidden}`
          }
        >
          <PreviewPane />
        </div>
        <div
          className={
            tab === "reference"
              ? styles.referenceSlot
              : `${styles.referenceSlot} ${styles.slotHidden}`
          }
        >
          <ReferenceTable />
        </div>
      </div>
      <SidePanelResizer panelRef={panelRef} />
    </>
  );
}
