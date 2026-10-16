import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Options {
  /** How many rows the list shows right now. */
  count: number;
  onPick: (index: number) => void;
  onEscape: () => void;
}

/**
 * Keyboard behaviour every searchable list in the app shares. Focus stays in
 * the search input, so the highlighted row is state (an index) and not DOM
 * focus, which is the usual combobox pattern.
 *
 * Up and Down move the highlight and wrap at the ends. Ctrl+Up and Ctrl+Down
 * jump the caret to the start or end of the text instead, because plain Up
 * and Down no longer reach the input's default caret movement. Enter picks
 * the highlighted row and Escape closes.
 *
 * Attach `onKeyDown` to the input and `listRef` to the element that holds the
 * rows, and mark the highlighted row with `data-active="true"`. Call `reset`
 * whenever the rows change under the highlight (a new query, a filter toggle).
 */
export function useSearchListNav({ count, onPick, onEscape }: Options) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

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
        setActiveIndex((i) =>
          e.key === "ArrowDown" ? (i + 1) % count : (i - 1 + count) % count,
        );
      }
    } else if (e.key === "Enter" && count > 0) {
      e.preventDefault();
      onPick(Math.min(activeIndex, count - 1));
    }
  };

  return {
    activeIndex,
    reset: () => setActiveIndex(0),
    listRef,
    onKeyDown,
  };
}
