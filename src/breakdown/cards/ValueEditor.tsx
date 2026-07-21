import { useState } from "react";
import type { ArgumentType } from "../../parser/language";
import type { ArgValueInput } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import styles from "./AttributeRow.module.css";

/**
 * §4.11 raw-text -> ArgValueInput. Soft validation (§5/§4.11): an
 * out-of-range number or unrecognized constant is legal RMS and commits
 * anyway (the diagnostic surfaces on the row after reparse) — this only
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
  /** Current AST-rendered display text — the value Escape reverts to and the value a same-text commit is a no-op against (§4.11). */
  text: string;
  type: ArgumentType;
  /** The value's current span.start — its identity anchor (§6.3) for the focus registry, and the React key so an unrelated reparse never clobbers in-progress typing on this exact field. */
  anchorOffset: number;
  /** Called only when the committed text differs from `text`. `restoreFocusOnEnter` distinguishes an Enter-commit (should refocus via caret) from a blur-commit (must not, §4.11). */
  onCommit: (value: ArgValueInput, restoreFocusOnEnter: boolean) => void;
  disabled?: boolean;
  helpId: string;
  /** §3.4's quoting round-trip — true only for a quoted filename slot, where internal spaces are legal RMS. */
  allowSpaces?: boolean;
}

// docs/breakdown-design.md §3.4/§4.11 — the shared value editor: typed
// display, uncontrolled during typing (no EditIntent per keystroke),
// commits on blur/Enter, Escape reverts, checkbox/combobox specifics are
// handled by the two branches below (constant combobox uses a native
// <datalist> so free text is always still accepted, per §3.4).
export function ValueEditor({ text, type, anchorOffset, onCommit, disabled, helpId, allowSpaces }: ValueEditorProps) {
  const { gameConstants, parseResult, registerFocusable } = useBreakdownContext();
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string, restoreFocusOnEnter: boolean) => {
    if (raw === text) {
      setError(null);
      return; // §4.11 — identical-to-current commits produce no edit/reparse/undo-entry
    }
    // §4.11: only input that can't be RENDERED into a token at all is
    // rejected — internal whitespace in what must stay a single token.
    // `string`-typed slots here are plain name slots (see AttributeRow's
    // usage), not quoted filenames (those are DirectiveCard's own path,
    // §3.4's overload note), so whitespace is rejected uniformly.
    if (!allowSpaces && /\s/.test(raw.trim())) {
      setError("can't contain spaces here");
      return;
    }
    setError(null);
    onCommit(parseRawValue(raw, type), restoreFocusOnEnter);
  };

  const isConstant = type === "terrainConstant" || type === "objectConstant" || type === "otherConstant";
  const listId = isConstant ? `breakdown-values-${type}` : undefined;

  const options =
    type === "terrainConstant"
      ? gameConstants.constants.filter((c) => c.category === "terrain")
      : type === "objectConstant"
        ? gameConstants.constants.filter((c) => c.category === "object")
        : type === "otherConstant"
          ? parseResult.symbols.map((s) => s.name).map((name) => ({ rmsConstant: name }))
          : [];

  return (
    <HelpTip id={helpId}>
      <span className={styles.editorWrap}>
        <input
          key={anchorOffset}
          ref={(el) => registerFocusable(anchorOffset, el)}
          type="text"
          defaultValue={text}
          disabled={disabled}
          list={listId}
          className={type === "integer" || type === "percent" ? styles.numberInput : styles.textInput}
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
            {options.map((o, i) => (
              <option key={i} value={"rmsConstant" in o ? o.rmsConstant : ""} />
            ))}
          </datalist>
        )}
        {error && <span className={styles.inlineError}>{error}</span>}
      </span>
    </HelpTip>
  );
}
