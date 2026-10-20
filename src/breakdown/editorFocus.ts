import {
  useCallback,
  useMemo,
  useRef,
  type FocusEvent,
  type RefObject,
} from "react";
import { shiftSingleAnchor, type OffsetEdit } from "./ephemeralAnchors";

// Keeps the keyboard focus on the value editor the user is working in when a
// reparse replaces its element.
//
// Every editor is keyed by a source offset (ValueEditor's `key`, and the
// parents' `key={span.start}`), which is how an unrelated reparse leaves
// in-progress typing alone. The same keys are why a field that sits after an
// edit changes identity when the edit changes the text's length: React throws
// the old input away and mounts a new one. The browser had already focused
// the old one, so the user sees a caret appear and disappear. Pressing the
// mouse on field B while field A holds an unsaved change is the usual trigger,
// because A's blur commits its edit while B is taking focus.
//
// The fix follows the project's existing rule for ephemeral UI state
// (breakdown-design Sec.6.3): remember focus as a SOURCE OFFSET, shift it
// through the edits the way expansion and selection anchors are shifted, and
// hand it back once the matching parse has rendered. This is the idiom React
// itself suggests for a list that remounts items, restore focus from an
// effect after the commit rather than trying to prevent the remount.
//
// Kept as a hook over the pane's own focus registry (offset -> element, fed
// by ValueEditor and CommentCard through registerFocusable) so the pane and a
// test harness share one implementation.

interface Tracked {
  offset: number;
  el: HTMLElement;
}

export interface EditorFocusKeeper {
  /** Attach to the pane's root: records which registered editor holds focus. */
  onFocusCapture: (e: FocusEvent<HTMLElement>) => void;
  /** Attach to the pane's root: forgets the editor once focus leaves to nothing. */
  onBlurCapture: (e: FocusEvent<HTMLElement>) => void;
  /**
   * Call after a parse that follows `edits` has rendered (and its editors have
   * registered). Moves the remembered offset through the edits, and re-focuses
   * the editor now at that offset if the one that had focus was replaced and
   * nothing else has taken focus since.
   */
  restoreAfter: (edits: readonly OffsetEdit[]) => void;
}

export function useEditorFocusKeeper(
  focusableRef: RefObject<Map<number, HTMLElement>>,
): EditorFocusKeeper {
  // A ref, not state: nothing renders from it, it is read back inside
  // handlers and an effect only.
  const trackedRef = useRef<Tracked | null>(null);

  const onFocusCapture = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      for (const [offset, el] of focusableRef.current) {
        if (el === target) {
          trackedRef.current = { offset, el };
          return;
        }
      }
      // Focus went to a button, the tab bar or any other control: not an
      // editor, so there is nothing to give back later.
      trackedRef.current = null;
    },
    [focusableRef],
  );

  const onBlurCapture = useCallback((e: FocusEvent<HTMLElement>) => {
    const tracked = trackedRef.current;
    if (!tracked || tracked.el !== e.target) return;
    // relatedTarget is where focus is going. Another element means the next
    // focus event replaces the record. Null while the element is still in the
    // document means the user clicked on nothing, which is a real "done
    // here". Null on an element already out of the document is the browser
    // tidying up after a remount, and that is the case worth surviving.
    if (e.relatedTarget === null && tracked.el.isConnected)
      trackedRef.current = null;
  }, []);

  const restoreAfter = useCallback(
    (edits: readonly OffsetEdit[]) => {
      const tracked = trackedRef.current;
      if (!tracked) return;
      let offset: number | null = tracked.offset;
      for (const edit of edits) {
        offset = shiftSingleAnchor(offset, edit);
        if (offset === null) break;
      }
      if (offset === null) {
        // The edit replaced the very text the editor sat on. Nothing to
        // return to, and guessing would focus a neighbour.
        trackedRef.current = null;
        return;
      }
      tracked.offset = offset;
      if (tracked.el.isConnected) return; // same element survived, nothing to repair
      const active = document.activeElement;
      if (active && active !== document.body) return; // focus already went somewhere
      const next = focusableRef.current.get(offset);
      if (!next) return;
      next.focus();
      // The click's own caret position is gone with the old element. End of
      // the text keeps typing additive, which is what a click into a field
      // most often means.
      if (
        next instanceof HTMLInputElement ||
        next instanceof HTMLTextAreaElement
      ) {
        const end = next.value.length;
        next.setSelectionRange(end, end);
      }
      trackedRef.current = { offset, el: next };
    },
    [focusableRef],
  );

  return useMemo(
    () => ({ onFocusCapture, onBlurCapture, restoreAfter }),
    [onFocusCapture, onBlurCapture, restoreAfter],
  );
}
