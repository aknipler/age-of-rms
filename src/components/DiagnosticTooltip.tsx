import { useState } from "react";
import { useHelpSettings } from "../help/HelpSettingsContext";
import type { DiagnosticSeverity } from "../parser/types";
import styles from "./DiagnosticTooltip.module.css";

const SEVERITY_BORDER: Record<DiagnosticSeverity, string> = {
  error: "#dc3545",
  warning: "#e0a300",
  info: "#17a2b8",
};

// Ash's follow-up ask: the per-row/per-arg diagnostic message used to be
// a native `title` attribute on the row div (AttributeRow.tsx/
// CommandCard.tsx), which fires the browser's own OS-rendered tooltip.
// That can't be repositioned or suppressed from CSS/JS at all, so it was
// free to land right on top of a HelpTip popup opened by something
// nested inside the same row (the label, the value editor, ...) whenever
// both happened to be hovered at once — one obscuring the other.
//
// Fix, in two parts:
//  - useDiagnosticHover (below): tracks hover state on the ROW ITSELF
//    (spread its `handlers` onto the same div that used to carry
//    `title`), and decides which side of the row the popup should open
//    on. Diagnostics should ALWAYS be visible (never gated behind the
//    Preferences help-mode toggle, unlike HelpTip) — but they flip sides
//    depending on whether a HelpTip popup could ALSO be open right now:
//    above the row when help mode is on (HelpTip popups open below their
//    trigger), below when help mode is off (HelpTip never opens, so
//    there's nothing to avoid).
//  - DiagnosticPopup: pure presentation, absolutely positioned WITHIN
//    the row (the row needs `position: relative`) rather than as its own
//    hover-capturing overlay — an overlay spanning the whole row would
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
}

export function DiagnosticPopup({ message, severity, side }: DiagnosticPopupProps) {
  return (
    <div className={`${styles.popup} ${styles[side]}`} style={{ borderColor: SEVERITY_BORDER[severity] }}>
      {message}
    </div>
  );
}
