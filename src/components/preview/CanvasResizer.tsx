import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { HelpTip } from "../HelpTip";
import { usePreviewReferenceSplit } from "../sidepanel/PreviewReferenceSplitContext";
import {
  MAX_CANVAS_HEIGHT,
  MIN_CANVAS_HEIGHT,
} from "../sidepanel/previewReferenceSplit";
import styles from "./CanvasResizer.module.css";

/** One arrow-key press on the focused handle, in pixels. */
const KEYBOARD_STEP = 24;

interface CanvasResizerProps {
  /** The positioned box the canvas sits in; its height is what gets resized. */
  frameRef: RefObject<HTMLDivElement | null>;
  /**
   * The pane that holds the frame. Its parent is the preview slot in
   * `MapSidePanel`; the slot is read to keep it as tall as the pane while the
   * canvas grows.
   */
  paneRef: RefObject<HTMLDivElement | null>;
}

/**
 * The grab strip on the map canvas's bottom edge. Dragging it down makes the
 * map taller (the width already follows the side panel), dragging it up makes
 * it shorter, double-click puts it back to the square default, and the height
 * is remembered between sessions (`PreviewReferenceSplitContext`).
 *
 * Growing the canvas also pushes the divider above the reference table down,
 * so the new height is actually visible. Without that the preview slot, whose
 * height is a fixed share of the column, would just start scrolling and the
 * bottom edge would stop following the pointer once it reached the slot's own
 * bottom.
 *
 * Pointer handling mirrors `PreviewReferenceResizer`: capture is what keeps
 * pointermove arriving once the pointer leaves this thin strip.
 */
export function CanvasResizer({ frameRef, paneRef }: CanvasResizerProps) {
  const {
    canvasHeight,
    setCanvasHeight,
    commitCanvasHeight,
    fraction,
    setFraction,
    commitFraction,
  } = usePreviewReferenceSplit();
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  // Set by the user's own resize gestures only, so restoring the saved height
  // at startup does not rewrite the saved split.
  const fitSlotRef = useRef(false);

  useLayoutEffect(() => {
    if (!fitSlotRef.current) return;
    fitSlotRef.current = false;
    const pane = paneRef.current;
    const slot = pane?.parentElement;
    if (!pane || !slot || fraction <= 0) return;
    if (pane.offsetHeight <= slot.clientHeight) return;
    // The slot's height is `fraction` of the column's free space, so the free
    // space is recoverable from the slot alone, without knowing how tall the
    // divider bar beside it is.
    const freeSpace = slot.clientHeight / fraction;
    setFraction(pane.offsetHeight / freeSpace);
  }, [canvasHeight, fraction, paneRef, setFraction]);

  const currentHeight = (): number =>
    canvasHeight ?? frameRef.current?.getBoundingClientRect().height ?? 0;

  const resize = (next: number) => {
    fitSlotRef.current = true;
    setCanvasHeight(next);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: currentHeight() };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    resize(drag.current.startHeight + event.clientY - drag.current.startY);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // One store write per drag, not one per frame. See commitFraction's doc.
    commitCanvasHeight();
    commitFraction();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;
    if (event.key === "ArrowUp") step = -KEYBOARD_STEP;
    if (event.key === "ArrowDown") step = KEYBOARD_STEP;
    if (step === 0) return;
    event.preventDefault();
    resize(currentHeight() + step);
    // A key press is its own complete gesture, so it commits immediately.
    commitCanvasHeight();
    commitFraction();
  };

  return (
    // The positioned box is THIS div, outside the HelpTip: HelpTip's wrapper
    // span is itself `position: relative`, so an absolutely positioned child
    // inside it would anchor to that (zero-sized) span instead of the canvas
    // frame and land nowhere near the canvas's bottom edge.
    <div className={styles.zone}>
      <HelpTip id="preview.canvasResizer">
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the map preview's height"
          aria-valuenow={Math.round(currentHeight())}
          aria-valuemin={MIN_CANVAS_HEIGHT}
          aria-valuemax={MAX_CANVAS_HEIGHT}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          onDoubleClick={() => {
            setCanvasHeight(null);
            commitCanvasHeight();
          }}
        >
          <span className={styles.grip} aria-hidden="true" />
        </div>
      </HelpTip>
    </div>
  );
}
