import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { HelpTip } from "../HelpTip";
import { PreviewControls, PreviewPane } from "../preview/PreviewPane";
import {
  ReferenceModeTabs,
  ReferenceTable,
  type ReferenceMode,
} from "./ReferenceTable";
import { useSidePanelLayout } from "./SidePanelLayoutContext";
import { SidePanelReopener, SidePanelResizer } from "./SidePanelResizer";
import { useSidePanelTab } from "./SidePanelTabContext";
import type { SidePanelTab } from "./sidePanelTabs";
import {
  FOCUS_REGION_ATTR,
  SIDE_PANEL_REGION,
} from "../../settings/focusRegion";
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
 * The top row holds the two tabs as icons, and beside them the selected
 * tab's own first row: the preview's settings, Current, Minimap and seed
 * (PreviewControls), or the reference table's Terrain / Objects / Commands /
 * Attributes switch (ReferenceModeTabs). Its minimum height is the map
 * header's (`--workspace-header-height`, set on App's `.workspace`), so the
 * two rows read as one band across the window.
 *
 * The reference table's mode lives here, not in ReferenceTable, because the
 * switch that sets it is in this row and the table that reads it is below.
 * This component is the nearest one above both (lifting state up).
 *
 * App renders it once, as the left column of the workspace, running the full
 * height beside the map header and the active tab. It used to be rendered
 * inside BreakdownPane and CodePane, below the header.
 *
 * As of CREATION_PLAN 4.4 it is resizable and collapsible. The width and the
 * collapsed flag come from context rather than local state, because this
 * component unmounts on Advanced Tools and with no file open.
 * SidePanelLayoutContext.tsx has the full reasoning. This returns a fragment
 * of two siblings (panel, then separator) so both land directly in the
 * workspace's flex row; wrapping them in a div of their own would put a
 * fixed-width box around a column whose whole point is to change width.
 *
 * The preview and the reference table share the panel as TABS (beta
 * feedback), where they used to split its height with a draggable bar. Both
 * stay MOUNTED and the inactive one is hidden with `display: none`, rather
 * than rendering only the selected one. The reference table keeps its
 * search text and sort in local state, so unmounting it on every switch to
 * the preview would clear a search the user flicked away from to check the
 * map. The cost is that a hidden canvas
 * still redraws when a generation lands; that is one drawImage, and a hidden
 * canvas reports a zero size, so OverlayCanvas's ResizeObserver skips the
 * refit until it is shown again.
 */
/** A small isometric map, the diamond the preview draws, with a patch of land and two players. */
function PreviewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 1.5 14.5 8 8 14.5 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M5.5 8.5 8 6l2.5 2.5L8 11Z" fill="currentColor" opacity="0.35" />
      <circle cx="5" cy="8" r="1" fill="currentColor" />
      <circle cx="11" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

/** A small spreadsheet, a header band over a grid of cells. */
function ReferenceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect
        x="2"
        y="2.5"
        width="12"
        height="11"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="2"
        y="2.5"
        width="12"
        height="3"
        fill="currentColor"
        opacity="0.35"
      />
      <path
        d="M2 8.5h12M2 11h12M6.5 5.5v8"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

const TABS: readonly {
  id: SidePanelTab;
  label: string;
  icon: ReactNode;
  helpId: string;
}[] = [
  {
    id: "preview",
    label: "Preview",
    icon: <PreviewIcon />,
    helpId: "sidePanel.tabPreview",
  },
  {
    id: "reference",
    label: "Reference",
    icon: <ReferenceIcon />,
    helpId: "sidePanel.tabReference",
  },
];

export function MapSidePanel() {
  const { width, collapsed } = useSidePanelLayout();
  const { tab, setTab } = useSidePanelTab();
  // Called before the `collapsed` early return below, since hooks have to run
  // in the same order on every render.
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("terrain");
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
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width }}
        {...{ [FOCUS_REGION_ATTR]: SIDE_PANEL_REGION }}
      >
        <div className={styles.topRow}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Map panel"
            onKeyDown={handleKeyDown}
          >
            {TABS.map(({ id, label, icon, helpId }) => (
              <HelpTip key={id} id={helpId}>
                <button
                  type="button"
                  role="tab"
                  data-tab={id}
                  aria-selected={tab === id}
                  // The icon carries no text, so the name comes from here.
                  aria-label={label}
                  // Roving tabindex: only the selected tab is in the Tab
                  // order, the arrow keys move between them.
                  tabIndex={tab === id ? 0 : -1}
                  className={
                    tab === id
                      ? `${styles.tab} ${styles.tabActive}`
                      : styles.tab
                  }
                  onClick={() => setTab(id)}
                >
                  {icon}
                </button>
              </HelpTip>
            ))}
          </div>
          <div className={styles.topRowControls}>
            {tab === "preview" ? (
              <PreviewControls />
            ) : (
              <ReferenceModeTabs
                mode={referenceMode}
                onModeChange={setReferenceMode}
              />
            )}
          </div>
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
          <ReferenceTable mode={referenceMode} />
        </div>
      </div>
      <SidePanelResizer panelRef={panelRef} />
    </>
  );
}
