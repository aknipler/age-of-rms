import { useEffect, useMemo, useRef, useState } from "react";
import {
  NUMERIC_ARGUMENT_TYPES,
  type ArgumentType,
} from "../../parser/language";
import {
  describeSuggestion,
  suggest,
  type SlotKind,
} from "../../parser/nameLookup";
import {
  getStaticNameIndex,
  scriptIndexFor,
} from "../../editor/staticNameIndex";
import type { ArgValueInput, EditResult } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { reviewCommit, type CommitReview } from "../constReview";
import { HelpTip } from "../../components/HelpTip";
import {
  RmsSuggestInput,
  type SuggestRow,
} from "../../components/RmsSuggestInput";
import { useResolveFlashEnabled } from "../../settings/AppSettingsContext";
import { ConstOfferStrip } from "./ConstOfferStrip";
import { isConstantWord } from "../syntaxWords";
import { ENTER_FIELD, nextEnterTarget, resolveEnterTarget } from "../enterNav";
import styles from "./AttributeRow.module.css";

/** Sec.6.2, the Code editor's FLASH_MS. The CSS animation in AttributeRow.module.css runs for the same time. */
const FLASH_MS = 700;

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
  /** Return the edit's result, so Enter inside a group (enterNav.ts) can find the next field again after the reparse. */
  onCommit: (
    value: ArgValueInput,
    restoreFocusOnEnter: boolean,
  ) => EditResult | null | void;
  disabled?: boolean;
  helpId: string;
  /**
   * What the field's tip says, overriding the shared `helpId` entry (which
   * can only describe "an attribute's value" in general). `null` shows no
   * tip, for a field with nothing specific to say.
   */
  helpText?: string | null;
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
  /**
   * Which names this field takes, so it can suggest them, flash when one
   * resolves and offer to create one that does not exist
   * (docs/name-lookup-design.md). Absent for a field that holds something
   * else, such as a filename or a math expression.
   */
  names?: SlotKind | null;
}

// docs/breakdown-design.md Sec.3.4/Sec.4.11, the shared value editor: typed
// display, uncontrolled during typing (no EditIntent per keystroke),
// commits on blur/Enter, Escape reverts. Free text is always still accepted
// (Sec.3.4), the suggestion list under the field (RmsSuggestInput) only ever
// offers names and never restricts them.
export function ValueEditor({
  text,
  type,
  anchorOffset,
  onCommit,
  disabled,
  helpId,
  helpText,
  allowSpaces,
  hint: hintOverride,
  names,
}: ValueEditorProps) {
  const {
    parseResult,
    registerFocusable,
    requestFocus,
    constNote,
    clearConstNote,
    announce,
  } = useBreakdownContext();
  const [error, setError] = useState<string | null>(null);
  const flashEnabled = useResolveFlashEnabled();
  const [flashing, setFlashing] = useState(false);
  // The timer is a ref and is not cleared by the effect below. That effect
  // consumes the note, which re-renders this component with no note, and an
  // effect cleanup tied to the note would then cancel the timer and leave
  // the field tinted for good.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  // A ref, not state, for the input element. The field is uncontrolled
  // (typing never re-renders, see the header comment), so the clear button
  // needs a handle on the DOM node to empty and refocus it, and a ref is the
  // React idiom for "I need the element, not a value". registerFocusable
  // wants the same node, so the ref callback below feeds both.
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Set when Enter has already committed and is moving focus on. Moving
  // focus blurs this field, and the blur would otherwise commit the same
  // text a second time against the parse the first commit made stale.
  const skipBlurCommit = useRef(false);

  /**
   * "rejected" when the text cannot be written (the error shows and focus
   * stays), "unchanged" for a no-op, otherwise whatever onCommit returned.
   */
  const commit = (
    raw: string,
    restoreFocusOnEnter: boolean,
  ): "rejected" | "unchanged" | EditResult | null | void => {
    if (raw === text) {
      setError(null);
      return "unchanged"; // Sec.4.11, identical-to-current commits produce no edit/reparse/undo-entry
    }
    // Sec.4.11: only input that can't be RENDERED into a token at all is
    // rejected, internal whitespace in what must stay a single token.
    // `string`-typed slots here are plain name slots (see AttributeRow's
    // usage), not quoted filenames (those are DirectiveCard's own path,
    // Sec.3.4's overload note), so whitespace is rejected uniformly.
    if (!allowSpaces && /\s/.test(raw.trim())) {
      setError("can't contain spaces here");
      return "rejected";
    }
    setError(null);
    return onCommit(parseRawValue(raw, type), restoreFocusOnEnter);
  };

  // Enter inside a group of fields (enterNav.ts) commits and moves on.
  // Focus moves at once, so the next field is live while the reparse is in
  // flight. When the commit changed the source, the reparse may replace
  // that field (its key is its offset), so the pane is also asked to find
  // it again by position once the new parse has rendered.
  const commitAndAdvance = (el: HTMLInputElement) => {
    const next = nextEnterTarget(el);
    if (!next) {
      commit(el.value, true);
      return;
    }
    const outcome = commit(el.value, false);
    if (outcome === "rejected") return;
    skipBlurCommit.current = true;
    next.el.focus();
    // A focus that did not take never blurred this field, and a flag left
    // set would swallow the next real blur's commit.
    if (document.activeElement !== next.el) skipBlurCommit.current = false;
    if (next.el instanceof HTMLInputElement) next.el.select();
    if (outcome && outcome !== "unchanged" && next.isField)
      requestFocus(() => resolveEnterTarget(next));
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

  // Sec.4.2, the rows under the field. Built from the last parse. The field
  // is only edited between commits, so that parse is the document the person
  // is looking at.
  const rowsFor = useMemo(() => {
    if (!names || !parseResult) return null;
    return (word: string): SuggestRow[] =>
      suggest(
        getStaticNameIndex(),
        scriptIndexFor(parseResult),
        word,
        anchorOffset,
        names,
      ).map((s) => ({
        name: s.name,
        detail: describeSuggestion(s),
        dim: s.definedBelow,
      }));
  }, [names, parseResult, anchorOffset]);

  // Sec.6.1 and Sec.7. A note names a commit whose parse has now rendered. It
  // belongs to this field when it points at this field's own offset, and
  // `text` already shows the committed name.
  const note =
    constNote &&
    parseResult &&
    parseResult.source === constNote.source &&
    constNote.anchor === anchorOffset &&
    constNote.name === text.trim()
      ? constNote
      : null;
  const review: CommitReview = useMemo(
    () =>
      note && names && parseResult
        ? reviewCommit(parseResult, note.name, anchorOffset, names)
        : { kind: "none" },
    [note, names, parseResult, anchorOffset],
  );

  // A flash is consumed the moment it starts: the note is cleared, so
  // re-mounting this card later (a tab switch back) cannot replay it.
  useEffect(() => {
    if (review.kind !== "flash") return;
    clearConstNote?.();
    if (!flashEnabled) return;
    announce?.(review.message);
    setFlashing(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), FLASH_MS);
  }, [review, clearConstNote, announce, flashEnabled]);

  return (
    <HelpTip id={helpId} text={helpText}>
      <span className={styles.editorWrap}>
        {/* .fieldWrap exists so the clear button can sit INSIDE the field
            (beta feedback 2026-09-17), over the spot the native datalist
            arrow used to take. The arrow is hidden by CSS; the list still
            opens on click and while typing, which is how it was used
            anyway. */}
        <span className={styles.fieldWrap}>
          <RmsSuggestInput
            key={anchorOffset}
            inputRef={(el) => {
              inputRef.current = el;
              registerFocusable(anchorOffset, el);
            }}
            rowsFor={rowsFor}
            type="text"
            defaultValue={text}
            placeholder={hint}
            disabled={disabled}
            className={`${
              isNumeric
                ? `${styles.numberInput} ${styles.hasClear}`
                : isConstant
                  ? `${styles.textInput} ${styles.hasClear}`
                  : styles.textInput
            } ${flashing ? styles.resolveFlash : ""}`}
            // The Code tab's constant colour while the text is one all caps
            // word (syntaxWords.ts). Kept up to date while typing by writing
            // the attribute straight onto the element, since the field is
            // uncontrolled and a state update per keystroke would re-render
            // it for nothing.
            data-constant={isConstantWord(text) || undefined}
            onChange={(e) => {
              const el = e.currentTarget;
              if (isConstantWord(el.value)) el.dataset.constant = "true";
              else delete el.dataset.constant;
            }}
            {...{ [ENTER_FIELD]: true }}
            onBlur={(e) => {
              if (skipBlurCommit.current) {
                skipBlurCommit.current = false;
                return;
              }
              commit(e.currentTarget.value, false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAndAdvance(e.currentTarget);
              } else if (e.key === "Escape") {
                e.currentTarget.value = text;
                setError(null);
              }
            }}
          />
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
        {(review.kind === "offer" || review.kind === "definedBelow") &&
          note && (
            <ConstOfferStrip
              review={review}
              name={note.name}
              anchor={note.anchor}
              onUseName={(name) => {
                const el = inputRef.current;
                if (!el) return;
                el.value = name;
                commit(name, false);
              }}
            />
          )}
      </span>
    </HelpTip>
  );
}
