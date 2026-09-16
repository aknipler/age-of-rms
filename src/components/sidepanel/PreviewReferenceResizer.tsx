import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { HelpTip } from "../HelpTip";
import { usePreviewReferenceSplit } from "./PreviewReferenceSplitContext";
import { MIN_PANE_FRACTION, resolvePreviewReferenceDrag } from "./previewReferenceSplit";
import styles from "./PreviewReferenceResizer.module.css";

/** One arrow-key press on the focused separator, in fraction units. Small: the whole range is 0..1, unlike the side panel's pixel-sized step. */
const KEYBOARD_STEP = 0.02;

interface PreviewReferenceResizerProps {
  /**
   * The column both panes share. Read for its top edge and height at drag
   * time, the same "measure the container, not the panes" approach
   * `SidePanelResizer` takes with `panelRef`, which stays correct regardless
   * of how the preview and reference table are currently split.
   */
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * The draggable bar between the map preview and the reference table, plus
 * the two buttons that fully close one side or the other (beta feedback:
 * "make it so the horizontal bar ... can be adjusted by the user, and fully
 * closed in either direction").
 *
 * Pointer handling mirrors `SidePanelResizer` almost exactly, on the Y axis
 * instead of X: `setPointerCapture` is what keeps pointermove events arriving
 * here for the whole drag even once the pointer leaves this 10px strip, and
 * without it a fast drag drops the resize partway through.
 */
export function PreviewReferenceResizer({ containerRef }: PreviewReferenceResizerProps) {
  const { fraction, setFraction, commitFraction, setCollapsedSide } = usePreviewReferenceSplit();
  const [dragging, setDragging] = useState(false);
  // Mirrors `dragging` for the pointermove handler, same reason
  // SidePanelResizer's own draggingRef exists: the collapse path has to stop
  // the drag and ignore any further move in the same frame, before a
  // re-render has happened, and a ref is the only value already updated then.
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
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const container = containerRef.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    if (rect.height === 0) return;
    const outcome = resolvePreviewReferenceDrag((event.clientY - rect.top) / rect.height);
    if (outcome.collapsedSide !== null) {
      // Dragged past the minimum by more than the margin: treat it as a
      // collapse and let go of the pointer, so the user is not still
      // dragging a bar that no longer separates two visible panes.
      endDrag(event);
      setCollapsedSide(outcome.collapsedSide);
      return;
    }
    setFraction(outcome.fraction);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    endDrag(event);
    // One store write per drag, not one per frame. See commitFraction's doc.
    commitFraction();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;
    if (event.key === "ArrowUp") step = -KEYBOARD_STEP;
    if (event.key === "ArrowDown") step = KEYBOARD_STEP;
    if (step === 0) return;
    event.preventDefault();
    setFraction(fraction + step);
    // A key press is its own complete gesture, so it commits immediately,
    // same reasoning as SidePanelResizer's own handleKeyDown.
    commitFraction();
  };

  return (
    <div
      className={dragging ? `${styles.resizer} ${styles.dragging}` : styles.resizer}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the split between the map preview and the reference table"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round((1 - MIN_PANE_FRACTION) * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <HelpTip id="sidePanel.previewReferenceResizer">
        {/* Two buttons, not one: unlike the side panel's single collapse
            direction, this bar can close EITHER neighbour, and each needs
            its own affordance rather than one button whose meaning depends
            on state the user cannot see from the bar alone.
            stopPropagation on pointerdown for the same reason
            SidePanelResizer's own collapse button needs it: without it, the
            press bubbles to the separator above and starts a drag instead of
            registering as a click. */}
        <span className={styles.buttons}>
          <button
            type="button"
            className={styles.collapseButton}
            aria-label="Hide the map preview"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setCollapsedSide("preview")}
          >
            <span aria-hidden="true">▴</span>
          </button>
          <button
            type="button"
            className={styles.collapseButton}
            aria-label="Hide the reference table"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setCollapsedSide("reference")}
          >
            <span aria-hidden="true">▾</span>
          </button>
        </span>
      </HelpTip>
    </div>
  );
}

/**
 * What is left on screen once one pane is collapsed: a strip the same height
 * as the separator it replaces, holding the button that brings that pane
 * back. Always visible, same "a collapse with no way back is a one-way door"
 * reasoning as `SidePanelReopener`.
 */
export function PreviewReferenceReopener({ side }: { side: "preview" | "reference" }) {
  const { setCollapsedSide } = usePreviewReferenceSplit();
  const label = side === "preview" ? "Show the map preview" : "Show the reference table";
  const glyph = side === "preview" ? "▾" : "▴";
  return (
    <div className={styles.reopener}>
      <HelpTip id="sidePanel.previewReferenceReopen">
        <button type="button" className={styles.collapseButton} aria-label={label} onClick={() => setCollapsedSide(null)}>
          <span aria-hidden="true">{glyph}</span>
        </button>
      </HelpTip>
    </div>
  );
}

