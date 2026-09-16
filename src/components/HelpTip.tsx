import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHelpSettings } from "../help/HelpSettingsContext";
import { helpTextFor } from "../help/uiHelpText";
import styles from "./HelpTip.module.css";

const HOVER_DELAY_MS = 600;
const FALLBACK_TEXT =
  "No help written yet. Contribute an entry to reference/data/ui-help.json!";

/** Gap between the anchor and the popup, and the popup's minimum clearance from the viewport edge. */
const POPUP_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 4;

/**
 * How far the pointer may drift after a `dismissOnInteract` popup opens before
 * that counts as "the user has moved on". Small enough that deliberately
 * moving to another tile dismisses immediately, large enough that the jitter
 * of a hand resting on a mouse does not.
 */
const DISMISS_MOVE_SLOP_PX = 6;

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
   * content, `text` lets the caller supply that content directly
   * (typically sourced from doc-strings.json / language.json, the same
   * data src/editor/aoe2RmsHover.ts's Monaco hover reads, so the two
   * surfaces never disagree, breakdown-design.md Sec.8). `id` is still
   * required and still used as the ui-help.json fallback if `text` is
   * itself undefined (e.g. no doc-string exists for this exact name).
   */
  text?: string;
  /**
   * Hide the popup as soon as the user starts USING the wrapped element, and
   * do not show it again until the pointer leaves and comes back.
   *
   * Off by default, because for an ordinary control (a button, a radio, a
   * chip) it changes nothing: you cross those in well under HOVER_DELAY_MS,
   * so the popup rarely opens at all, and when it does it sits beside a
   * 20px-tall anchor and covers nothing you were reading.
   *
   * It exists for the opposite case, a LARGE anchor that is also a work
   * surface. The preview canvas is the whole of it today: the anchor box is
   * the entire map, so the popup opens off the canvas's BOTTOM edge, which is
   * exactly where the tile readout lives, and, unlike every other tip in the
   * app, the pointer rests inside that anchor for minutes at a time, so the
   * delay always elapses and the popup stays up for the whole time you are
   * reading the rows it is covering. `pointer-events: none` on the popup means
   * it cannot even be pushed out of the way.
   *
   * The fix is behavioural rather than geometric on purpose: this tip is
   * ORIENTATION ("drag to pan, wheel to zoom"), which is worth reading once on
   * arrival and never again in that session. Re-arming on every pause is the
   * actual defect; moving where it opens would only relocate it onto something
   * else the canvas overlays.
   */
  dismissOnInteract?: boolean;
  /**
   * Force the popup closed regardless of hover state, without touching the
   * DOM shape (see the comment below on why the wrapper always renders).
   *
   * For an anchor that can itself spawn a sibling overlay, Add Command's
   * button opens `CommandPicker` right below itself, `place()` only ever
   * measures the anchor, so a tip that (re)opens while that overlay is up
   * would sit on top of it. `dismissOnInteract` alone doesn't close that
   * gap: it clears on pointerleave, so hovering off the button and back
   * onto it while the overlay is still open re-arms the tip. The caller
   * passes its own "overlay is open" state through here instead of this
   * component trying to discover the overlay geometrically.
   */
  suppressed?: boolean;
}

// Wraps any interactive element to show a short explanation popup on
// hover. Behavior follows the global Preferences setting (see
// HelpSettingsContext): "hover" shows after a short delay so it doesn't
// feel naggy, "alt-hover" only shows while ALT is held, "off" disables
// popups entirely. Every new interactive UI element should be wrapped in
// this as it's built (see CLAUDE.md conventions).
export function HelpTip({
  id,
  children,
  text,
  dismissOnInteract = false,
  suppressed = false,
}: HelpTipProps) {
  const { mode, altHeld } = useHelpSettings();
  const [hovering, setHovering] = useState(false);
  const [delayElapsed, setDelayElapsed] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);
  // Set by an interaction, cleared on pointerleave. State rather than a ref
  // because the popup has to disappear when it flips, a ref write schedules
  // no render, so the popup would stay on screen until something else caused
  // one. (The `userFramedRef` in PreviewCanvas is a ref for the mirror-image
  // reason: nothing renders from it.)
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!hovering || mode !== "hover") {
      setDelayElapsed(false);
      return;
    }
    timeoutRef.current = window.setTimeout(
      () => setDelayElapsed(true),
      HOVER_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutRef.current);
  }, [hovering, mode]);

  // Add Command's width, attribute-column alignment, the
  // StatusBar cog, and a small row-height difference all turned out to
  // be the SAME root cause: this component used to render a completely
  // different DOM shape depending on the setting, a real `<span>`
  // wrapper when help mode was on, nothing at all (a bare Fragment) when
  // off. Any CSS anywhere in the app that assumed "the element I'm
  // wrapping IS the flex item / IS the percentage-width child" broke the
  // moment help mode flipped, because that assumption was only true in
  // ONE of the two states. Rather than keep chasing each individual
  // call site (three rounds of that so far), the wrapper is now ALWAYS
  // rendered, every HelpTip usage has the exact same DOM structure
  // regardless of the setting. Only the POPUP's presence is gated by
  // `visible` below, which already can't be true unless mode is "hover"
  // (post-delay) or "alt-hover" (while ALT is held), mode "off" still
  // never shows a popup, just via an always-empty `visible` here instead
  // of skipping the wrapper entirely.
  const visible =
    mode !== "off" &&
    hovering &&
    !dismissed &&
    !suppressed &&
    ((mode === "hover" && delayElapsed) || (mode === "alt-hover" && altHeld));

  const content = text ?? helpTextFor(id) ?? FALLBACK_TEXT;

  // --- dismissOnInteract ----------------------------------------------------
  //
  // Both refs, not state: they are read inside event handlers and never
  // rendered, so writing them must not schedule a render. `moveOrigin` is the
  // pointer position at the moment the popup OPENED, drift is measured from
  // there rather than from the previous move event, so a slow deliberate
  // traverse across the map still dismisses instead of staying under the
  // per-event threshold forever.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const moveOriginRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (visible) moveOriginRef.current = pointerRef.current;
  }, [visible]);

  const handlePointerMove = (event: React.PointerEvent) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!dismissOnInteract || !visible) return;
    const origin = moveOriginRef.current;
    // No origin means the popup opened without the pointer ever having moved
    // inside the anchor (ALT-hover fires on the keypress, not on a move).
    // Adopt this position as the origin instead of dismissing on it.
    if (origin === null) {
      moveOriginRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    const travel =
      Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y);
    if (travel > DISMISS_MOVE_SLOP_PX) setDismissed(true);
  };

  // A click always dismisses, for every HelpTip, not only ones opted into
  // `dismissOnInteract` (that flag governs the stricter drift/wheel
  // dismissal below, for a large work-surface anchor like the preview
  // canvas). pointerdown rather than click so the popup is gone by the time
  // a drag starts, not when it ends.
  const handlePointerDown = () => setDismissed(true);

  // Wheel is unconditional on `dismissOnInteract` alone: unlike a move,
  // scrolling never happens by accident, so there is no slop to allow for.
  const handleWheel = () => {
    if (dismissOnInteract) setDismissed(true);
  };

  // The popup renders through a PORTAL into document.body, positioned
  // `fixed` against the viewport, rather than absolutely inside the wrapper.
  // Two separate defects forced this and neither is fixable with CSS at the
  // call site:
  //
  //   1. An absolutely-positioned popup is CLIPPED by any ancestor with
  //      `overflow`, DiagnosticsRuler's 10px-wide `.ruler` sets
  //      `overflow: hidden` deliberately, and the StatusBar's own row
  //      scrolls horizontally, so tips on both were being cut off.
  //   2. `top: 100%` always opens DOWNWARD. For the StatusBar, the last
  //      row above the window's bottom edge, "downward" is off-screen, so
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

    // A tip whose anchor sits inside a stacked list of siblings (a dropdown
    // menu item) can't open below/above like an ordinary tip: that would
    // land it on top of the very next item in the same list, which is no
    // easier to read than the z-index bug this component used to have. Any
    // such list opts in with `data-help-flyout`, and the tip then opens
    // beside the WHOLE list instead of beside just the one item, flipping
    // to the other side when the preferred one doesn't fit.
    const flyout = anchor.closest<HTMLElement>("[data-help-flyout]");
    if (flyout) {
      const flyoutBox = flyout.getBoundingClientRect();
      let left = flyoutBox.right + POPUP_GAP_PX;
      if (left + popupBox.width + VIEWPORT_MARGIN_PX > window.innerWidth) {
        left = flyoutBox.left - POPUP_GAP_PX - popupBox.width;
      }
      let top = anchorBox.top;
      if (top + popupBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
        top = window.innerHeight - popupBox.height - VIEWPORT_MARGIN_PX;
      }
      setPosition({
        top: Math.max(VIEWPORT_MARGIN_PX, top),
        left: Math.max(VIEWPORT_MARGIN_PX, left),
      });
      return;
    }

    // Prefer below (where the tip has always been), flip above when the
    // popup wouldn't fit, and fall back to pinning it inside the viewport
    // when neither side has room.
    let top = anchorBox.bottom + POPUP_GAP_PX;
    if (top + popupBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
      const above = anchorBox.top - POPUP_GAP_PX - popupBox.height;
      top =
        above >= VIEWPORT_MARGIN_PX
          ? above
          : Math.max(
              VIEWPORT_MARGIN_PX,
              window.innerHeight - popupBox.height - VIEWPORT_MARGIN_PX,
            );
    }

    let left = anchorBox.left;
    if (left + popupBox.width + VIEWPORT_MARGIN_PX > window.innerWidth) {
      left = window.innerWidth - popupBox.width - VIEWPORT_MARGIN_PX;
    }
    setPosition({ top, left: Math.max(VIEWPORT_MARGIN_PX, left) });
  }, []);

  // useLayoutEffect, not useEffect: this measures the popup and then moves
  // it, and useEffect runs AFTER paint, the user would see one frame of the
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
      // Turns every HelpTip's wrapper into a stable tutorial anchor
      // (tutorial-design.md Sec.4.1), inert for every other consumer: no
      // styling hooks off it, no behaviour reads it.
      data-help-id={id}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        // Leaving re-arms the tip. Dismissal is scoped to one visit, not to
        // the session: coming back to the canvas later is a fair moment to be
        // reminded what it does, and persisting the flag would need somewhere
        // to persist it to.
        setDismissed(false);
        pointerRef.current = null;
        moveOriginRef.current = null;
      }}
      // onPointerMove/onWheel are attached only where the drift/wheel
      // behaviour is opted into. Every HelpTip in the app wraps something,
      // and a pointermove handler on all of them would be paying for a
      // feature one call site uses. This does not change the DOM SHAPE the
      // wrapper renders, which is the invariant the comment above is about.
      // onPointerDown is unconditional: every tip dismisses on click.
      onPointerMove={dismissOnInteract ? handlePointerMove : undefined}
      onPointerDown={handlePointerDown}
      onWheel={dismissOnInteract ? handleWheel : undefined}
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
