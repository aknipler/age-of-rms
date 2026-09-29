import { useRef, useState } from "react";
import {
  NUMERIC_ARGUMENT_TYPES,
  type ArgumentType,
} from "../../parser/language";
import type { ArgValueInput } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import styles from "./AttributeRow.module.css";

/**
 * Sec.4.11 raw-text -> ArgValueInput. Soft validation (Sec.5/Sec.4.11): an
 * out-of-range number or unrecognized constant is legal RMS and commits
 * anyway (the diagnostic surfaces on the row after reparse), this only
 * ever produces a value, never rejects one. Rejection (whitespace in a
 * single-token slot) is handled by the caller before this runs.
 */
export function parseRawValue(raw: string, type: ArgumentType): ArgValueInput {
  const trimmed = raw.trim();
  if (type === "integer" || type === "percent" || type === "flag") {
    if (trimmed === "inf") return Infinity;
    if (trimmed === "-inf") return -Infinity;
    const n = Number(trimmed);
    if (trimmed !== "" && !Number.isNaN(n)) return n;
  }
  return trimmed;
}

interface ValueEditorProps {
  /** Current AST-rendered display text, the value Escape reverts to and the value a same-text commit is a no-op against (Sec.4.11). */
  text: string;
  type: ArgumentType;
  /** The value's current span.start, its identity anchor (Sec.6.3) for the focus registry, and the React key so an unrelated reparse never clobbers in-progress typing on this exact field. */
  anchorOffset: number;
  /** Called only when the committed text differs from `text`. `restoreFocusOnEnter` distinguishes an Enter-commit (should refocus via caret) from a blur-commit (must not, Sec.4.11). */
  onCommit: (value: ArgValueInput, restoreFocusOnEnter: boolean) => void;
  disabled?: boolean;
  helpId: string;
  /** Sec.3.4's quoting round-trip, true only for a quoted filename slot, where internal spaces are legal RMS. */
  allowSpaces?: boolean;
  /**
   * Overrides the type-derived placeholder below. `otherConstant`'s default
   * assumes a `#const`-style numeric alias (effect_amount, water_definition,
   * ...), which is wrong for an if/elseif condition: those resolve against
   * `#define`d flags and predefined labels, not `#const` (parser-design
   * RMS0312; breakdown-design Sec.3.5). ConditionalCard passes its own hint.
   */
  hint?: string;
}

// docs/breakdown-design.md Sec.3.4/Sec.4.11, the shared value editor: typed
// display, uncontrolled during typing (no EditIntent per keystroke),
// commits on blur/Enter, Escape reverts, checkbox/combobox specifics are
// handled by the two branches below (constant combobox uses a native
// <datalist> so free text is always still accepted, per Sec.3.4).
export function ValueEditor({
  text,
  type,
  anchorOffset,
  onCommit,
  disabled,
  helpId,
  allowSpaces,
  hint: hintOverride,
}: ValueEditorProps) {
  const { gameConstants, parseResult, registerFocusable } =
    useBreakdownContext();
  const [error, setError] = useState<string | null>(null);
  // A ref, not state, for the input element. The field is uncontrolled
  // (typing never re-renders, see the header comment), so the clear button
  // needs a handle on the DOM node to empty and refocus it, and a ref is the
  // React idiom for "I need the element, not a value". registerFocusable
  // wants the same node, so the ref callback below feeds both.
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = (raw: string, restoreFocusOnEnter: boolean) => {
    if (raw === text) {
      setError(null);
      return; // Sec.4.11, identical-to-current commits produce no edit/reparse/undo-entry
    }
    // Sec.4.11: only input that can't be RENDERED into a token at all is
    // rejected, internal whitespace in what must stay a single token.
    // `string`-typed slots here are plain name slots (see AttributeRow's
    // usage), not quoted filenames (those are DirectiveCard's own path,
    // Sec.3.4's overload note), so whitespace is rejected uniformly.
    if (!allowSpaces && /\s/.test(raw.trim())) {
      setError("can't contain spaces here");
      return;
    }
    setError(null);
    onCommit(parseRawValue(raw, type), restoreFocusOnEnter);
  };

  const isConstant =
    type === "terrainConstant" ||
    type === "objectConstant" ||
    type === "otherConstant";
  // Beta feedback 2026-09-18, the clear button existed only for constant
  // fields (isConstant below). A numeric field is just as often worth
  // clearing back to empty (so a following commit falls back to the
  // attribute's default), so it gets the same affordance here.
  const isNumeric = NUMERIC_ARGUMENT_TYPES.has(type);
  const showClear = isConstant || isNumeric;
  const listId = isConstant ? `breakdown-values-${type}` : undefined;
  // Shown only while the field is empty, an example rather than a value.
  // Beta feedback 2026-09-17, a real constant sitting in the field read as
  // "the app picked GRASS for me".
  const hint =
    hintOverride ??
    (type === "terrainConstant"
      ? "GRASS, DIRT etc."
      : type === "objectConstant"
        ? "GOLD, SHEEP etc."
        : type === "otherConstant"
          ? "a #const name"
          : undefined);

  const options =
    type === "terrainConstant"
      ? gameConstants.constants.filter((c) => c.category === "terrain")
      : type === "objectConstant"
        ? gameConstants.constants.filter((c) => c.category === "object")
        : type === "otherConstant"
          ? parseResult.symbols
              .map((s) => s.name)
              .map((name) => ({ rmsConstant: name }))
          : [];

  return (
    <HelpTip id={helpId}>
      <span className={styles.editorWrap}>
        {/* .fieldWrap exists so the clear button can sit INSIDE the field
            (beta feedback 2026-09-17), over the spot the native datalist
            arrow used to take. The arrow is hidden by CSS; the list still
            opens on click and while typing, which is how it was used
            anyway. */}
        <span className={styles.fieldWrap}>
          <input
            key={anchorOffset}
            ref={(el) => {
              inputRef.current = el;
              registerFocusable(anchorOffset, el);
            }}
            type="text"
            defaultValue={text}
            placeholder={hint}
            disabled={disabled}
            list={listId}
            className={
              isNumeric
                ? `${styles.numberInput} ${styles.hasClear}`
                : isConstant
                  ? `${styles.textInput} ${styles.hasClear}`
                  : styles.textInput
            }
            onBlur={(e) => commit(e.currentTarget.value, false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value, true);
              } else if (e.key === "Escape") {
                e.currentTarget.value = text;
                setError(null);
              }
            }}
          />
          {listId && (
            <datalist id={listId}>
              {/* A constant with no name is reached by bare id and cannot be
                typed here, so it is dropped rather than offered as a blank
                option. `rmsConstant` became `string | null` on 2026-08-11 to
                match the data; before that these rows were already blank
                options, the type just hid it. */}
              {options
                .map((o) => ("rmsConstant" in o ? o.rmsConstant : null))
                .filter((name): name is string => name !== null && name !== "")
                .map((name) => (
                  <option key={name} value={name} />
                ))}
            </datalist>
          )}
          {showClear && !disabled && (
            <span className={styles.clearSlot}>
              <HelpTip id="breakdown.attributeRow.clearValue">
                <button
                  type="button"
                  className={styles.clearButton}
                  aria-label="Clear value"
                  // onMouseDown, not onClick, and preventDefault. A click first
                  // blurs the input, and blur commits whatever is in it, so by
                  // the time onClick ran the old value would already be
                  // committed and the empty field would be a second commit.
                  // Swallowing the mousedown keeps focus in the input, so the
                  // clear happens inside one editing session and commits once,
                  // when the user clicks away or presses Enter.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const el = inputRef.current;
                    if (!el) return;
                    el.value = "";
                    el.focus();
                  }}
                >
                  ×
                </button>
              </HelpTip>
            </span>
          )}
        </span>
        {error && <span className={styles.inlineError}>{error}</span>}
      </span>
    </HelpTip>
  );
}
