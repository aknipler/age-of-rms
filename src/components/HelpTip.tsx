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
  /**
   * Overrides the ui-help.json lookup with dynamic text. For a wrapper
   * reused across many different names (e.g. one `id` shared by every
   * attribute row's label, or every command's positional-argument
   * label), a single static ui-help.json entry can't carry per-attribute
   * content — `text` lets the caller supply that content directly
   * (typically sourced from doc-strings.json / language.json, the same
   * data src/editor/aoe2RmsHover.ts's Monaco hover reads, so the two
   * surfaces never disagree — breakdown-design.md §8). `id` is still
   * required and still used as the ui-help.json fallback if `text` is
   * itself undefined (e.g. no doc-string exists for this exact name).
   */
  text?: string;
}

// Wraps any interactive element to show a short explanation popup on
// hover. Behavior follows the global Preferences setting (see
// HelpSettingsContext): "hover" shows after a short delay so it doesn't
// feel naggy, "alt-hover" only shows while ALT is held, "off" disables
// popups entirely. Every new interactive UI element should be wrapped in
// this as it's built (see CLAUDE.md conventions).
export function HelpTip({ id, children, text }: HelpTipProps) {
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

  // Ash's reports (Add Command's width, attribute-column alignment, the
  // StatusBar cog, and a small row-height difference) all turned out to
  // be the SAME root cause: this component used to render a completely
  // different DOM shape depending on the setting — a real `<span>`
  // wrapper when help mode was on, nothing at all (a bare Fragment) when
  // off. Any CSS anywhere in the app that assumed "the element I'm
  // wrapping IS the flex item / IS the percentage-width child" broke the
  // moment help mode flipped, because that assumption was only true in
  // ONE of the two states. Rather than keep chasing each individual
  // call site (three rounds of that so far), the wrapper is now ALWAYS
  // rendered — every HelpTip usage has the exact same DOM structure
  // regardless of the setting. Only the POPUP's presence is gated by
  // `visible` below, which already can't be true unless mode is "hover"
  // (post-delay) or "alt-hover" (while ALT is held) — mode "off" still
  // never shows a popup, just via an always-empty `visible` here instead
  // of skipping the wrapper entirely.
  const visible =
    mode !== "off" && hovering && ((mode === "hover" && delayElapsed) || (mode === "alt-hover" && altHeld));

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children}
      {visible && <div className={styles.popup}>{text ?? HELP_TEXT_BY_ID.get(id) ?? FALLBACK_TEXT}</div>}
    </span>
  );
}
