import { useEffect, useRef } from "react";
import { HelpTip } from "./HelpTip";
import styles from "./UnsavedChangesDialog.module.css";

/**
 * The three ways out of an action that would discard unsaved work.
 *
 * This is a TypeScript *union of string literals*: a `UnsavedChoice` value can
 * only ever be one of these exact three strings. It's the idiomatic way to
 * model "one of a fixed set of outcomes" — better than a plain `string`
 * (which would let a typo like "discrad" compile) and lighter than an enum.
 * The compiler also uses it to check that every `switch`/`if` chain handles
 * all three cases.
 */
export type UnsavedChoice = "save" | "discard" | "cancel";

/** Which action prompted the dialog. Only the wording differs — see LABELS. */
export type UnsavedAction = "close" | "open";

/**
 * Per-action wording. `Record<UnsavedAction, …>` is a *mapped type*: it forces
 * this object to have exactly one entry per member of the union, so adding a
 * third action (say "new") becomes a compile error here until its labels are
 * written. That's the point — it makes the type system enforce the thing a
 * human would otherwise forget.
 */
const LABELS: Record<UnsavedAction, { save: string; discard: string; question: string }> = {
  close: {
    save: "Save and Close",
    discard: "Exit Without Saving",
    question: "What would you like to do before closing?",
  },
  open: {
    save: "Save and Open",
    discard: "Open Without Saving",
    question: "What would you like to do before opening another map?",
  },
};

interface UnsavedChangesDialogProps {
  /** Which action triggered this — selects the button wording. */
  action: UnsavedAction;
  /** Map name, shown so the user knows *what* is unsaved. */
  mapName: string;
  /** Called exactly once, with the user's choice. */
  onChoice: (choice: UnsavedChoice) => void;
}

/**
 * Modal shown when an action would discard unsaved changes — closing the
 * window, or opening a different map.
 *
 * Why this is a custom in-app modal rather than Tauri's native `confirm()`:
 * a native confirm returns a *boolean*, which cannot express three outcomes,
 * and — the actual bug it caused — gives no way to tell an explicit "No"
 * click apart from the user dismissing the dialog (Esc / the X). The old
 * code therefore had to collapse to a 2-way choice to avoid silently
 * discarding work. Owning the markup means we control the button semantics
 * exactly, so "dismiss" can safely mean "cancel".
 *
 * Every dismissal path — the X, Esc, and clicking the backdrop — resolves to
 * `"cancel"`: the action is abandoned and nothing is saved or discarded.
 * That is the safe default; the only ways to lose work are explicit clicks.
 */
export function UnsavedChangesDialog({ action, mapName, onChoice }: UnsavedChangesDialogProps) {
  const labels = LABELS[action];

  // `useRef` holds a mutable value that survives re-renders WITHOUT causing
  // one when it changes (unlike useState). Here it's a latch: the dialog
  // must resolve its promise exactly once, so if a stray second event fires
  // (Esc landing at the same moment as a click, say) we swallow it rather
  // than resolving twice.
  const decidedRef = useRef(false);
  const decide = (choice: UnsavedChoice) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onChoice(choice);
  };

  // Keyboard handling, registered on `window` so it works no matter what
  // has focus. The cleanup function returned from useEffect removes the
  // listener when the dialog unmounts — without it, every open/close cycle
  // would leave another live listener behind (a leak that also causes
  // double-handling).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        decide("cancel");
      }
      if (event.key === "Enter") {
        event.preventDefault();
        decide("save"); // Enter = the safe default action
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `decide` is
    // stable for this component's lifetime (guarded by decidedRef) and the
    // dialog is unmounted as soon as a choice is made.
  }, []);

  return (
    // onMouseDown on the overlay = "clicked the backdrop" → cancel. The
    // inner box stops propagation so a click *inside* the dialog doesn't
    // bubble up and read as a backdrop click.
    <div className={styles.overlay} onMouseDown={() => decide("cancel")}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.titleRow}>
          <h2 className={styles.title} id="unsaved-changes-title">
            Unsaved changes
          </h2>
          <HelpTip id="unsavedChanges.dismiss">
            <button
              type="button"
              className={styles.dismissButton}
              onClick={() => decide("cancel")}
              aria-label="Cancel"
            >
              ✕
            </button>
          </HelpTip>
        </div>

        <p className={styles.message}>
          <span className={styles.fileName}>{mapName}</span> has unsaved changes. {labels.question}
        </p>

        <div className={styles.actions}>
          <HelpTip id="unsavedChanges.save">
            <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => decide("save")}>
              {labels.save}
            </button>
          </HelpTip>
          <HelpTip id="unsavedChanges.discard">
            <button
              type="button"
              className={`${styles.button} ${styles.destructive}`}
              onClick={() => decide("discard")}
            >
              {labels.discard}
            </button>
          </HelpTip>
          <HelpTip id="unsavedChanges.cancel">
            <button type="button" className={styles.button} onClick={() => decide("cancel")}>
              Cancel
            </button>
          </HelpTip>
        </div>
      </div>
    </div>
  );
}
