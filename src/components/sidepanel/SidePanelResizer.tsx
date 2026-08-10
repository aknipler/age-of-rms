import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { HelpTip } from "../HelpTip";
import { useSidePanelLayout } from "./SidePanelLayoutContext";
import {
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  resolveSidePanelDrag,
  SIDE_PANEL_KEYBOARD_STEP,
} from "./sidePanelLayout";
import styles from "./SidePanelResizer.module.css";

interface SidePanelResizerProps {
  /**
   * The panel this handle resizes. Read for its left edge at drag time —
   * the new width is "pointer x minus panel left", which is exact regardless
   * of what padding or borders the surrounding pane happens to have, and
   * survives the pane's own layout changing later.
   *
   * `RefObject<T | null>` rather than `RefObject<T>` because React 19 types
   * `useRef<HTMLDivElement>(null)` as holding `HTMLDivElement | null` — the
   * ref genuinely is null between render and commit, and the type says so.
   */
  panelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The draggable separator between the map side panel and the tab's own
 * content, plus the button that collapses the panel (CREATION_PLAN 4.4).
 *
 * This is a pointer-events exercise, not a library. The one detail that
 * separates a splitter that works from one that drops the drag the moment you
 * move fast is `setPointerCapture`: without it, events stop arriving as soon
 * as the pointer leaves this 14px strip, and a fast drag leaves the panel
 * stuck mid-resize. With it, every pointermove until pointerup is delivered
 * here no matter what the pointer is over — including outside the window.
 *
 * On the HelpTip placement: it wraps the BUTTON, not this strip, and the
 * strip is a plain flex item. HelpTip's wrapper is `position: relative` and
 * its popup is `top: 100%` of that wrapper, so wrapping a full-height element
 * would anchor the popup below the whole pane, off the bottom of the app.
 * Same trap DiagnosticsRuler.tsx documents for its ticks, and the same fix:
 * the sized element is the outer div, HelpTip goes inside it. One entry
 * covers resizing and hiding both, because this reads as one control — the
 * call PreviewPane made when it reused `breakdown.sidePanel.previewToggle`
 * rather than minting a second id for one toggle.
 */
export function SidePanelResizer({ panelRef }: SidePanelResizerProps) {
  const { width, setWidth, commitWidth, setCollapsed } = useSidePanelLayout();
  const [dragging, setDragging] = useState(false);
  // Mirrors `dragging` for the pointermove handler. Reading the `dragging`
  // state variable would usually be fine (React re-attaches the current
  // closure each render), but the collapse path below has to stop the drag
  // and then ignore any further move in the same frame, before any re-render
  // has happened — a ref is the only value already updated at that point.
  const draggingRef = useRef(false);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Stops the browser starting a text selection in whichever pane the
    // pointer wanders over mid-drag. preventDefault on pointerdown also
    // suppresses the focus a click would normally give, so focus is taken
    // explicitly — the handle is keyboard-operable (see handleKeyDown) and
    // that only means anything if it can be focused.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const panel = panelRef.current;
    if (panel === null) return;
    const outcome = resolveSidePanelDrag(event.clientX - panel.getBoundingClientRect().left);
    if (outcome.collapsed) {
      // Dragged past the minimum by more than the margin: treat it as a
      // collapse and let go of the pointer, so the user is not still dragging
      // a handle that no longer exists.
      endDrag(event);
      setCollapsed(true);
      return;
    }
    setWidth(outcome.width);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    endDrag(event);
    // One store write per drag, not one per frame — see commitWidth's doc.
    commitWidth();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;
    if (event.key === "ArrowLeft") step = -SIDE_PANEL_KEYBOARD_STEP;
    if (event.key === "ArrowRight") step = SIDE_PANEL_KEYBOARD_STEP;
    if (step === 0) return;
    event.preventDefault();
    setWidth(width + step);
    // A key press is its own complete gesture, so it commits immediately.
    // Held-down auto-repeat writes a few times a second rather than the ~60
    // a drag produces, which is what commitWidth exists to keep off the wire.
    commitWidth();
  };

  return (
    <div
      className={dragging ? `${styles.resizer} ${styles.dragging}` : styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the map panel"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDE_PANEL_WIDTH}
      aria-valuemax={MAX_SIDE_PANEL_WIDTH}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <HelpTip id="sidePanel.resizer">
        <button
          type="button"
          className={styles.collapseButton}
          aria-label="Hide the map panel"
          // Without this the button's pointerdown bubbles to the separator
          // above and starts a drag, so the click that should hide the panel
          // instead resizes it to wherever the pointer happens to be.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setCollapsed(true)}
        >
          <span aria-hidden="true">‹</span>
        </button>
      </HelpTip>
    </div>
  );
}

/**
 * What is left on screen once the panel is collapsed: a strip the same width
 * as the separator it replaces, holding the button that brings the panel
 * back. Always visible, because a collapse with no way back is a one-way door
 * — and the collapse half of 4.4 is a fix, not a nicety, since 4.2 put this
 * column on a Code tab that used to be full width.
 */
export function SidePanelReopener() {
  const { setCollapsed } = useSidePanelLayout();
  return (
    <div className={styles.reopener}>
      <HelpTip id="sidePanel.reopen">
        <button
          type="button"
          className={styles.collapseButton}
          aria-label="Show the map panel"
          onClick={() => setCollapsed(false)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </HelpTip>
    </div>
  );
}
