import { useRef } from "react";
import { PreviewPane } from "../preview/PreviewPane";
import { ReferenceTable } from "./ReferenceTable";
import { useSidePanelLayout } from "./SidePanelLayoutContext";
import { SidePanelReopener, SidePanelResizer } from "./SidePanelResizer";
import { usePreviewReferenceSplit } from "./PreviewReferenceSplitContext";
import {
  PreviewReferenceReopener,
  PreviewReferenceResizer,
} from "./PreviewReferenceResizer";
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
 * Beta feedback added a SECOND split, at right angles to the first: how much
 * of the panel's own height the preview and the reference table each get,
 * adjustable and closable in either direction (previewReferenceSplit.ts,
 * PreviewReferenceSplitContext.tsx). It reuses `panelRef` below rather than a
 * ref of its own; both resizers measure the same node, one for its left edge,
 * the other for its top edge and height, and a second ref pointed at the
 * identical element would just be two names for one thing.
 */
export function MapSidePanel() {
  const { width, collapsed } = useSidePanelLayout();
  const { fraction, collapsedSide } = usePreviewReferenceSplit();
  // Handed to both resizers, which read the panel's own edges on every drag
  // frame to turn a pointer position into a width or a split fraction.
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
        {/* `flex-basis` as a FRACTION rather than a pixel height, same
            reasoning as previewReferenceSplit.ts's own header: the panel's
            total height changes on every window resize, and a fraction
            answers "how should the two split the room" without needing to
            recompute anything when the room's size changes. Omitted
            entirely rather than rendered at zero height when collapsed, so
            neither pane pays for a live worker-backed canvas or a scrolling
            table it cannot show. */}
        {collapsedSide !== "preview" && (
          <div
            className={styles.previewSlot}
            style={{
              flex: collapsedSide === "reference" ? "1 1 0" : `${fraction} 1 0`,
            }}
          >
            <PreviewPane />
          </div>
        )}
        {collapsedSide === null ? (
          <PreviewReferenceResizer containerRef={panelRef} />
        ) : (
          <PreviewReferenceReopener side={collapsedSide} />
        )}
        {collapsedSide !== "reference" && (
          <div
            className={styles.referenceSlot}
            style={{
              flex:
                collapsedSide === "preview" ? "1 1 0" : `${1 - fraction} 1 0`,
            }}
          >
            <ReferenceTable />
          </div>
        )}
      </div>
      <SidePanelResizer panelRef={panelRef} />
    </>
  );
}
