import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useSearchListNav } from "../hooks/useSearchListNav";
import { HelpTip } from "./HelpTip";
import {
  replaceWord,
  wordAtCaret,
  type WordAtCaret,
} from "./suggestInputModel";
import styles from "./RmsSuggestInput.module.css";

// A text input with a name suggestion list under it
// (docs/name-lookup-design.md Sec.4.2). Used by the Breakdown's value field,
// and by the Land Placement formula field and the Add Template terrain field
// (Sec.4.3, Sec.4.4).
//
// WHY NOT A <datalist>. The field this replaces used one. A datalist cannot be
// accepted with Tab, cannot rank, and cannot say where a name came from. That
// is why the list here is built by hand, and why it has to carry its own
// keyboard and ARIA behaviour: the browser no longer does it.
//
// UNCONTROLLED FRIENDLY. ValueEditor edits through `defaultValue` and commits
// on Enter or blur, with no state per keystroke. Accepting a row therefore
// writes the DOM node's value directly and fires a real `input` event, which
// is what a controlled caller's `onChange` listens for too, so one component
// serves both. React tracks an input's last known value to decide whether to
// call onChange, and assigning `el.value` would update that record and swallow
// the event. Going through the prototype's setter is the standard way around
// it, and the one React's own testing library uses.
//
// KEYS (Sec.5). Tab and Shift+Tab cycle the highlight. Enter accepts only
// after the highlight has been moved, so an Enter that means "commit what I
// typed" can never accept a suggestion by accident. Escape closes the list
// and goes no further (the Breakdown field's own Escape reverts the field).
// Up and Down move the highlight through useSearchListNav, as every
// searchable list does. Ctrl+Space opens the list on an empty word.
//
// HELPTIP. The list is wrapped in one HelpTip, `components.suggestList`, since
// the keys are not discoverable by looking at it. The rows are not wrapped
// one by one, each is a line of the same list and the tip describes them all.

/** One line of the list. `name` is also what gets inserted. */
export interface SuggestRow {
  name: string;
  /** What the name is and where it came from, shown dimmed after it. */
  detail?: string;
  /** Rows that sort last and read as second choice, such as a name defined below the caret. */
  dim?: boolean;
}

/** How many rows are visible at once. The list scrolls past that (Sec.3). */
const VISIBLE_ROWS = 12;

type PassThrough = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "list" | "onInput" | "ref"
>;

interface RmsSuggestInputProps extends PassThrough {
  /**
   * The rows for the name being typed, strongest first. `word` is the part
   * before the caret and `start` where the name begins. Null makes this a
   * plain input, for a field that takes no names.
   */
  rowsFor: ((word: string, start: number) => readonly SuggestRow[]) | null;
  /** The input element, for callers that register it (focus restore) or clear it. A callback ref so a caller can fan it out. */
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Class on the wrapper, for a caller that needs the field to stretch. */
  wrapClassName?: string;
}

export function RmsSuggestInput({
  rowsFor,
  inputRef,
  wrapClassName,
  onKeyDown,
  onKeyUp,
  onBlur,
  onClick,
  ...inputProps
}: RmsSuggestInputProps) {
  const [rows, setRows] = useState<readonly SuggestRow[]>([]);
  const [open, setOpen] = useState(false);
  // The run the rows were computed for, so an accept replaces exactly it. A
  // ref, not state: nothing renders from it.
  const wordRef = useRef<WordAtCaret>({ start: 0, end: 0, query: "" });
  // True while this component is writing the value itself, so the `input`
  // event it fires does not reopen the list it just closed.
  const writingRef = useRef(false);
  const elRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const close = () => setOpen(false);

  const accept = (index: number) => {
    const el = elRef.current;
    const row = rows[index];
    if (!el || !row) return;
    const next = replaceWord(el.value, wordRef.current, row.name);
    writingRef.current = true;
    try {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, next.value);
      el.setSelectionRange(next.caret, next.caret);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      writingRef.current = false;
    }
    close();
  };

  const nav = useSearchListNav({
    count: open ? rows.length : 0,
    onPick: accept,
    onEscape: close,
    enterNeedsMove: true,
  });

  /** Recompute the rows for the word at the caret. `force` opens on an empty word (Ctrl+Space). */
  const refresh = (el: HTMLInputElement, force: boolean) => {
    if (!rowsFor) return close();
    const word = wordAtCaret(el.value, el.selectionStart ?? el.value.length);
    wordRef.current = word;
    if (word.query === "" && !force) return close();
    const next = rowsFor(word.query, word.start);
    setRows(next);
    nav.reset();
    setOpen(next.length > 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "Escape") {
        // Swallowed here. The caller's Escape reverts the whole field, and a
        // person closing a list has not asked for that.
        e.preventDefault();
        e.stopPropagation();
        return close();
      }
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Tab" ||
        // Enter picks only once Tab or an arrow has moved the highlight.
        // Before that it commits the typed text, as the caller's handler says.
        (e.key === "Enter" && nav.moved())
      ) {
        nav.onKeyDown(e);
        return;
      }
    } else if (rowsFor && e.key === " " && e.ctrlKey) {
      e.preventDefault();
      return refresh(e.currentTarget, true);
    }
    onKeyDown?.(e);
    // Enter commits in the Breakdown. The commit may leave the field in
    // place, so the list is closed here rather than left floating.
    if (e.key === "Enter") close();
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyUp?.(e);
    // Sec.5, the caret moved: the list follows the new word or closes.
    if (open && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
      refresh(e.currentTarget, false);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    close();
    onBlur?.(e);
  };

  const active = open ? Math.min(nav.activeIndex, rows.length - 1) : -1;

  return (
    <span className={`${styles.wrap} ${wrapClassName ?? ""}`}>
      <input
        {...inputProps}
        ref={(el) => {
          elRef.current = el;
          inputRef?.(el);
        }}
        autoComplete="off"
        spellCheck={false}
        {...(rowsFor
          ? {
              "aria-autocomplete": "list" as const,
              "aria-expanded": open,
              "aria-controls": open ? listId : undefined,
              "aria-activedescendant":
                active >= 0 ? `${listId}-${active}` : undefined,
            }
          : {})}
        onInput={(e) => {
          if (writingRef.current) return;
          refresh(e.currentTarget, false);
        }}
        onClick={(e) => {
          onClick?.(e);
          if (open) refresh(e.currentTarget, false);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
      />
      {open && (
        <div className={styles.popup}>
          <HelpTip id="components.suggestList">
            <div
              id={listId}
              role="listbox"
              ref={nav.listRef}
              className={styles.list}
              style={{ maxHeight: `${VISIBLE_ROWS * 1.5}rem` }}
            >
              {rows.map((row, i) => (
                <div
                  key={`${row.name}-${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active ? "true" : undefined}
                  className={`${styles.row} ${row.dim ? styles.dim : ""}`}
                  // mousedown, not click, with preventDefault. A click first
                  // blurs the input, and blur closes the list and commits the
                  // field, so by the time onClick ran the row would be gone.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(i);
                  }}
                >
                  <span className={styles.name}>{row.name}</span>
                  {row.detail && (
                    <span className={styles.detail}>{row.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </HelpTip>
        </div>
      )}
    </span>
  );
}
