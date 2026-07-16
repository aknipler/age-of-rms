import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHelpSettings } from "../help/HelpSettingsContext";
import uiHelpDataRaw from "../../reference/data/ui-help.json";
import styles from "./HelpTip.module.css";

interface UiHelpEntry {
  id: string;
  text: string;
}
interface UiHelpData {
  entries: UiHelpEntry[];
}
const uiHelpData = uiHelpDataRaw as UiHelpData;
const HELP_TEXT_BY_ID = new Map(uiHelpData.entries.map((entry) => [entry.id, entry.text]));

const HOVER_DELAY_MS = 600;
const FALLBACK_TEXT = "No help written yet — contribute an entry to reference/data/ui-help.json!";

interface HelpTipProps {
  /** Matches an id in reference/data/ui-help.json. */
  id: string;
  children: ReactNode;
}

// Wraps any interactive element to show a short explanation popup on
// hover. Behavior follows the global Preferences setting (see
// HelpSettingsContext): "hover" shows after a short delay so it doesn't
// feel naggy, "alt-hover" only shows while ALT is held, "off" disables
// popups entirely. Every new interactive UI element should be wrapped in
// this as it's built (see CLAUDE.md conventions).
export function HelpTip({ id, children }: HelpTipProps) {
  const { mode, altHeld } = useHelpSettings();
  const [hovering, setHovering] = useState(false);
  const [delayElapsed, setDelayElapsed] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!hovering || mode !== "hover") {
      setDelayElapsed(false);
      return;
    }
    timeoutRef.current = window.setTimeout(() => setDelayElapsed(true), HOVER_DELAY_MS);
    return () => window.clearTimeout(timeoutRef.current);
  }, [hovering, mode]);

  if (mode === "off") {
    return <>{children}</>;
  }

  const visible =
    hovering && ((mode === "hover" && delayElapsed) || (mode === "alt-hover" && altHeld));

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children}
      {visible && <div className={styles.popup}>{HELP_TEXT_BY_ID.get(id) ?? FALLBACK_TEXT}</div>}
    </span>
  );
}
