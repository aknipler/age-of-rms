import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RearrangeableNode } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { siblingMoveTarget } from "../selectionResolve";
import { useHotkeySettings } from "../../settings/HotkeySettingsContext";
import { formatHotkey } from "../../settings/hotkeys";
import { HelpTip } from "../../components/HelpTip";
import styles from "./CardMenu.module.css";

/** Clearance kept between the menu and the viewport edge when it has to be nudged. */
const VIEWPORT_MARGIN_PX = 4;

interface CardMenuProps {
  item: RearrangeableNode;
  /** Pointer position of the right click, in viewport coordinates. */
  at: { x: number; y: number };
  onClose: () => void;
}

/**
 * The right-click menu on a card (2026-09-18, breakdown-design Sec.3.11).
 * Four entries, each a shortcut for something that already exists
 * elsewhere in the pane. Duplicate and the two moves call the same
 * context functions the hotkeys do, and Delete is the card's own trash
 * button. So the menu adds discoverability and nothing else, which is the
 * bar every entry here has to clear (a menu is where capabilities go to
 * be forgotten).
 *
 * Portalled to body with a fixed position, the same as HelpTip's popup,
 * because a card sits inside a scroll container with its own stacking
 * context and an absolutely positioned menu would be clipped by it. Closes
 * on any press outside itself, on Escape, and when the pane scrolls
 * (a menu that stays put while its card slides away is pointing at the
 * wrong thing).
 */
export function CardMenu({ item, at, onClose }: CardMenuProps) {
  const { parseResult, moveItem, duplicateItem, applyEdit } =
    useBreakdownContext();
  const { hotkeys } = useHotkeySettings();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);

  const upTarget = siblingMoveTarget(parseResult.script, item, "up");
  const downTarget = siblingMoveTarget(parseResult.script, item, "down");

  // Keep the whole menu on screen. Measured after the first paint, since
  // the size depends on the rendered entries.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN_PX;
    const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN_PX;
    setPosition({
      x: Math.max(VIEWPORT_MARGIN_PX, Math.min(at.x, maxLeft)),
      y: Math.max(VIEWPORT_MARGIN_PX, Math.min(at.y, maxTop)),
    });
  }, [at]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // Capture phase for the press, so a click that lands on another card
    // closes this menu before that card's own handlers open a new one.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Card actions"
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
      // A press inside the menu must not reach the card underneath the
      // portal's DOM position (body), nor the drag layer.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <HelpTip id="breakdown.cardMenu.duplicate">
        <button
          type="button"
          role="menuitem"
          className={styles.entry}
          onClick={run(() => duplicateItem(item))}
        >
          <span>Duplicate</span>
          <kbd className={styles.key}>
            {formatHotkey(hotkeys.breakdownDuplicateCard)}
          </kbd>
        </button>
      </HelpTip>
      <HelpTip id="breakdown.cardMenu.moveUp">
        <button
          type="button"
          role="menuitem"
          className={styles.entry}
          disabled={!upTarget}
          onClick={run(() => upTarget && moveItem(item, upTarget))}
        >
          <span>Move up</span>
          <kbd className={styles.key}>
            {formatHotkey(hotkeys.breakdownMoveCardUp)}
          </kbd>
        </button>
      </HelpTip>
      <HelpTip id="breakdown.cardMenu.moveDown">
        <button
          type="button"
          role="menuitem"
          className={styles.entry}
          disabled={!downTarget}
          onClick={run(() => downTarget && moveItem(item, downTarget))}
        >
          <span>Move down</span>
          <kbd className={styles.key}>
            {formatHotkey(hotkeys.breakdownMoveCardDown)}
          </kbd>
        </button>
      </HelpTip>
      <div className={styles.separator} role="separator" />
      <HelpTip id="breakdown.cardMenu.delete">
        <button
          type="button"
          role="menuitem"
          className={`${styles.entry} ${styles.danger}`}
          onClick={run(() => applyEdit({ kind: "removeNode", node: item }))}
        >
          <span>Delete</span>
          <kbd className={styles.key}>
            {formatHotkey(hotkeys.breakdownDeleteCard)}
          </kbd>
        </button>
      </HelpTip>
    </div>,
    document.body,
  );
}
