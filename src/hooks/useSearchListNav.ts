import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Options {
  /** How many rows the list shows right now. */
  count: number;
  onPick: (index: number) => void;
  onEscape: () => void;
  /**
   * True for a suggestion list under a field whose Enter already means
   * "commit what I typed" (name-lookup-design.md Sec.4.2 and Q1). Enter then
   * picks only after the person has moved the highlight with Tab or the
   * arrows, so accepting a suggestion can never be an accident of pressing
   * Enter on a half-typed name.
   */
  enterNeedsMove?: boolean;
}

/**
 * Keyboard behaviour every searchable list in the app shares. Focus stays in
 * the search input, so the highlighted row is state (an index) and not DOM
 * focus, which is the usual combobox pattern.
 *
 * Down and Tab move the highlight forward, Up and Shift+Tab move it back, and
 * both wrap at the ends. Ctrl+Up and Ctrl+Down jump the caret to the start or
 * end of the text instead, because plain Up and Down no longer reach the
 * input's default caret movement. Enter picks the highlighted row and Escape
 * closes. With no rows showing, Tab is left to the browser so focus moves on.
 *
 * Attach `onKeyDown` to the input and `listRef` to the element that holds the
 * rows, and mark the highlighted row with `data-active="true"`. Call `reset`
 * whenever the rows change under the highlight (a new query, a filter toggle).
 */
export function useSearchListNav({
  count,
  onPick,
  onEscape,
  enterNeedsMove = false,
}: Options) {
  const [activeIndex, setActiveIndex] = useState(0);
  // A ref, not state: nothing renders from it, and the key handler must see
  // the value written by the previous keystroke without waiting for a render.
  const movedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const step = (forward: boolean) => {
    movedRef.current = true;
    setActiveIndex((i) =>
      forward ? (i + 1) % count : (i - 1 + count) % count,
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onEscape();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // The default is always cancelled. Left alone, the arrow would jump
      // the caret, and with Ctrl held that jump is done by hand below.
      e.preventDefault();
      const input = e.currentTarget;
      if (e.ctrlKey) {
        const at = e.key === "ArrowUp" ? 0 : input.value.length;
        input.setSelectionRange(at, at);
      } else if (count > 0) {
        step(e.key === "ArrowDown");
      }
    } else if (e.key === "Tab" && count > 0) {
      e.preventDefault();
      step(!e.shiftKey);
    } else if (
      e.key === "Enter" &&
      count > 0 &&
      (!enterNeedsMove || movedRef.current)
    ) {
      e.preventDefault();
      onPick(Math.min(activeIndex, count - 1));
    }
  };

  return {
    activeIndex,
    reset: () => {
      movedRef.current = false;
      setActiveIndex(0);
    },
    /** True once Tab or an arrow has moved the highlight since the last reset. */
    moved: () => movedRef.current,
    listRef,
    onKeyDown,
  };
}
