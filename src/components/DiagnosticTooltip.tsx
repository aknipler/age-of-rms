import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { renderProse } from "./InlineCode";
import { useHelpSettings } from "../help/HelpSettingsContext";
import type { DiagnosticSeverity } from "../parser/types";
import styles from "./DiagnosticTooltip.module.css";

const SEVERITY_BORDER: Record<DiagnosticSeverity, string> = {
  error: "#dc3545",
  warning: "#e0a300",
  info: "#17a2b8",
};

// the per-row/per-arg diagnostic message used to be
// a native `title` attribute on the row div (AttributeRow.tsx/
// CommandCard.tsx), which fires the browser's own OS-rendered tooltip.
// That can't be repositioned or suppressed from CSS/JS at all, so it was
// free to land right on top of a HelpTip popup opened by something
// nested inside the same row (the label, the value editor, ...) whenever
// both happened to be hovered at once, one obscuring the other.
//
// Fix, in two parts:
//  - useDiagnosticHover (below): tracks hover state on the ROW ITSELF
//    (spread its `handlers` onto the same div that used to carry
//    `title`), and decides which side of the row the popup should open
//    on. Diagnostics should ALWAYS be visible (never gated behind the
//    Preferences help-mode toggle, unlike HelpTip), but they flip sides
//    depending on whether a HelpTip popup could ALSO be open right now:
//    above the row when help mode is on (HelpTip popups open below their
//    trigger), below when help mode is off (HelpTip never opens, so
//    there's nothing to avoid).
//  - DiagnosticPopup: pure presentation, absolutely positioned WITHIN
//    the row (the row needs `position: relative`) rather than as its own
//    hover-capturing overlay, an overlay spanning the whole row would
//    intercept clicks meant for the buttons/inputs nested inside it,
//    which plain `title` never did.
export function useDiagnosticHover() {
  const { mode } = useHelpSettings();
  const [hovering, setHovering] = useState(false);
  const side: "above" | "below" = mode === "off" ? "below" : "above";
  return {
    hovering,
    side,
    handlers: {
      onMouseEnter: () => setHovering(true),
      onMouseLeave: () => setHovering(false),
    },
  };
}

interface DiagnosticPopupProps {
  message: string;
  severity: DiagnosticSeverity;
  side: "above" | "below";
  /**
   * Buttons under the message, for a warning the user may hide
   * (DismissDiagnosticButtons.tsx). A popup with actions takes the pointer,
   * which a plain one deliberately does not (see above), and bridges the gap
   * to its row so the pointer can travel into it without the row's
   * mouseleave closing it first.
   */
  actions?: ReactNode;
}

// Distance kept between the popup and the viewport edge, and between the
// popup and its row.
const VIEWPORT_MARGIN_PX = 8;
const ROW_GAP_PX = 4;

interface PopupPlacement {
  top: number;
  left: number;
  side: "above" | "below";
}

// The popup renders through a portal into document.body and positions itself
// `fixed` against the viewport, for the reason HelpTip does (HelpTip.tsx): an
// absolutely positioned child is clipped by the Breakdown pane's scroll
// area and runs off the window's right edge for a row near it. The row is
// found through a hidden marker, since the popup's React parent is the row
// but its DOM parent is now body.
//
// React still treats the popup as a child of the row for onMouseEnter and
// onMouseLeave (events follow the React tree through a portal, not the DOM
// tree), so the interactive variant keeps the row hovered while the pointer
// is over its buttons.
export function DiagnosticPopup({
  message,
  severity,
  side,
  actions,
}: DiagnosticPopupProps) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PopupPlacement | null>(null);

  const place = useCallback(() => {
    const row = markerRef.current?.parentElement;
    const popup = popupRef.current;
    if (!row || !popup) return;
    const rowBox = row.getBoundingClientRect();
    const popupBox = popup.getBoundingClientRect();
    const roomAbove = rowBox.top - ROW_GAP_PX - VIEWPORT_MARGIN_PX;
    const roomBelow =
      window.innerHeight - rowBox.bottom - ROW_GAP_PX - VIEWPORT_MARGIN_PX;
    // Keep the preferred side unless the popup does not fit there and the
    // other side has more room.
    const fitsPreferred =
      (side === "above" ? roomAbove : roomBelow) >= popupBox.height;
    const resolved: "above" | "below" = fitsPreferred
      ? side
      : roomAbove > roomBelow
        ? "above"
        : "below";
    const top =
      resolved === "above"
        ? rowBox.top - ROW_GAP_PX - popupBox.height
        : rowBox.bottom + ROW_GAP_PX;
    const maxLeft = window.innerWidth - popupBox.width - VIEWPORT_MARGIN_PX;
    setPlacement({
      side: resolved,
      top: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(
          top,
          window.innerHeight - popupBox.height - VIEWPORT_MARGIN_PX,
        ),
      ),
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(rowBox.left, maxLeft)),
    });
  }, [side]);

  useLayoutEffect(() => {
    place();
    // A scroll under a stationary pointer moves the row but fires no hover
    // event, so follow it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place, message, actions]);

  return (
    <>
      <span ref={markerRef} hidden />
      {createPortal(
        <div
          ref={popupRef}
          className={`${styles.popup} ${styles[placement?.side ?? side]} ${actions ? styles.interactive : ""}`}
          style={{
            borderColor: SEVERITY_BORDER[severity],
            // Laid out but invisible for the commit before it is measured.
            ...(placement ?? { visibility: "hidden", top: 0, left: 0 }),
          }}
        >
          {renderProse(message)}
          {actions}
        </div>,
        document.body,
      )}
    </>
  );
}
