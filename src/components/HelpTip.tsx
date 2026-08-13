import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHelpSettings } from "../help/HelpSettingsContext";
import { helpTextFor } from "../help/uiHelpText";
import styles from "./HelpTip.module.css";

const HOVER_DELAY_MS = 600;
const FALLBACK_TEXT = "No help written yet — contribute an entry to reference/data/ui-help.json!";

/** Gap between the anchor and the popup, and the popup's minimum clearance from the viewport edge. */
const POPUP_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 4;

interface PopupPosition {
  top: number;
  left: number;
}

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
   * surfaces never disagree — breakdown-design.md Sec.8). `id` is still
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

  // Add Command's width, attribute-column alignment, the
  // StatusBar cog, and a small row-height difference all turned out to
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

  const content = text ?? helpTextFor(id) ?? FALLBACK_TEXT;

  // The popup renders through a PORTAL into document.body, positioned
  // `fixed` against the viewport, rather than absolutely inside the wrapper.
  // Two separate defects forced this and neither is fixable with CSS at the
  // call site:
  //
  //   1. An absolutely-positioned popup is CLIPPED by any ancestor with
  //      `overflow` — DiagnosticsRuler's 10px-wide `.ruler` sets
  //      `overflow: hidden` deliberately, and the StatusBar's own row
  //      scrolls horizontally, so tips on both were being cut off.
  //   2. `top: 100%` always opens DOWNWARD. For the StatusBar — the last
  //      row above the window's bottom edge — "downward" is off-screen, so
  //      those tips could not be read at all.
  //
  // A portal escapes every ancestor's overflow AND every ancestor's
  // `transform` (a transformed ancestor becomes the containing block for
  // `position: fixed` descendants, which would have silently broken
  // DiagnosticsRuler's `.tickWrapper`). The flip below then picks the side
  // with room, so a tip near the bottom opens upward.
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;

    const anchorBox = anchor.getBoundingClientRect();
    const popupBox = popup.getBoundingClientRect();

    // Prefer below (where the tip has always been), flip above when the
    // popup wouldn't fit, and fall back to pinning it inside the viewport
    // when neither side has room.
    let top = anchorBox.bottom + POPUP_GAP_PX;
    if (top + popupBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
      const above = anchorBox.top - POPUP_GAP_PX - popupBox.height;
      top =
        above >= VIEWPORT_MARGIN_PX
          ? above
          : Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - popupBox.height - VIEWPORT_MARGIN_PX);
    }

    let left = anchorBox.left;
    if (left + popupBox.width + VIEWPORT_MARGIN_PX > window.innerWidth) {
      left = window.innerWidth - popupBox.width - VIEWPORT_MARGIN_PX;
    }
    setPosition({ top, left: Math.max(VIEWPORT_MARGIN_PX, left) });
  }, []);

  // useLayoutEffect, not useEffect: this measures the popup and then moves
  // it, and useEffect runs AFTER paint — the user would see one frame of the
  // popup at the top-left corner before it jumped into place.
  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }
    place();
    // The anchor can move under a popup that is already open (the pane
    // scrolls, the window resizes). Capture-phase listening catches scrolls
    // inside any nested scroller, not just the window's own.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // `content` is a dependency because a longer string is a taller popup,
    // and the flip decision is made from the measured height.
  }, [visible, content, place]);

  return (
    <span
      ref={anchorRef}
      className={styles.wrapper}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={popupRef}
            className={styles.popup}
            // Hidden (but still laid out, so it can be measured) for the one
            // commit between rendering and the layout effect resolving where
            // it goes. `display: none` would measure as a 0x0 box.
            style={position ?? { visibility: "hidden", top: 0, left: 0 }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
