import { useState } from "react";
import type { CommandNode, Span } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { inlineCommentsOf } from "../comments";
import { HelpTip } from "../../components/HelpTip";
import styles from "./InlineComment.module.css";

// A command's inline comment on its own header row (2026-10-21,
// breakdown-design Sec.3.3.2), e.g. the `/* top left island */` in
// `create_land /* top left island */`. Which comments count is
// comments.ts's inlineCommentsOf. Editing reuses editComment and deleting
// reuses removeComment, the intents a comment card already uses, since an
// inline comment is the same trivia in a different place. Only the add is
// new (addInlineComment), because it needs the command to know where the
// comment goes.
//
// The field is uncontrolled and commits on blur or Enter, Escape reverts,
// the Sec.4.11 rule every value editor follows. It is keyed on the
// comment's offset and text, so an edit from the Code tab remounts it with
// the new text rather than leaving a stale defaultValue on screen (an
// uncontrolled input reads defaultValue once, on mount).

export function InlineComments({ command }: { command: CommandNode }) {
  const { tokens, source } = useBreakdownContext();
  const spans = inlineCommentsOf(command, tokens, source);
  return (
    <>
      {spans.map((span) => (
        <InlineCommentField
          key={`${span.start}:${source.slice(span.start, span.end)}`}
          span={span}
        />
      ))}
    </>
  );
}

// Delete is the only button. An inline comment is a note, so it offers no
// uncomment (2026-10-23). Code commented out on the same line shows as a
// comment card or commented code card, which carry the toggle.
function InlineCommentField({ span }: { span: Span }) {
  const { source, applyEdit, registerFocusable } = useBreakdownContext();
  const [error, setError] = useState<string | null>(null);
  const innerSpan = { start: span.start + 2, end: span.end - 2 };
  const inner = source.slice(innerSpan.start, innerSpan.end);
  const shown = inner.trim();
  // A comment that spans lines or nests another one cannot be edited in a
  // one-line field without changing its shape, so it shows as text and
  // can still be deleted. The Code tab edits it.
  const editable = !/[\r\n]/.test(inner) && !/\/\*|\*\//.test(inner);

  const commit = (raw: string) => {
    const text = raw.trim();
    if (text === shown) {
      setError(null);
      return;
    }
    // Same content rule CommentCard applies. Either marker inside would end
    // the comment early or unbalance a nested one.
    if (text.includes("/*") || text.includes("*/")) {
      setError("a comment can't contain /* or */");
      return;
    }
    setError(null);
    applyEdit({ kind: "editComment", innerSpan, text });
  };

  return (
    <span className={styles.slot}>
      <span className={styles.marker}>/*</span>
      {editable ? (
        <HelpTip id="breakdown.commandCard.inlineComment">
          <input
            ref={(el) => registerFocusable(span.start, el)}
            className={styles.field}
            defaultValue={shown}
            // Sized to its text, so a short note stays short on the row.
            // `field-sizing: content` (InlineComment.module.css) does the
            // fitting exactly. `size` is only the fallback for an engine
            // without it, and it counts average-width characters, so it
            // used to leave about one blank character before the closing
            // marker (the extra +1 here) with no way to get it tighter.
            size={Math.max(1, shown.length)}
            aria-label="Inline comment"
            onInput={(e) => {
              e.currentTarget.size = Math.max(1, e.currentTarget.value.length);
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                e.currentTarget.value = shown;
                setError(null);
                e.currentTarget.blur();
              }
            }}
          />
        </HelpTip>
      ) : (
        <HelpTip id="breakdown.commandCard.inlineCommentReadOnly">
          <span className={styles.readOnly}>{shown}</span>
        </HelpTip>
      )}
      <span className={styles.marker}>*/</span>
      <HelpTip id="breakdown.commandCard.inlineCommentDelete">
        <button
          type="button"
          className={styles.remove}
          aria-label="Delete inline comment"
          // Keeps focus where it is, so a pending edit in the field is not
          // committed onto the very span this click removes (CommentCard's
          // delete button has the full story).
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            applyEdit({ kind: "removeComment", span });
          }}
        >
          ×
        </button>
      </HelpTip>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}

/** The add button, shown on a command row that has no inline comment yet. */
export function AddInlineCommentButton({ command }: { command: CommandNode }) {
  const { tokens, source, applyEdit, requestFocus } = useBreakdownContext();
  if (inlineCommentsOf(command, tokens, source).length > 0) return null;
  return (
    <HelpTip id="breakdown.commandCard.addInlineComment">
      <button
        type="button"
        className={styles.add}
        aria-label="Add inline comment"
        onClick={(e) => {
          e.stopPropagation();
          const result = applyEdit({ kind: "addInlineComment", command });
          // The new field registers at the comment's start, which is the
          // caret addInlineComment returns.
          if (result) requestFocus(result.caret);
        }}
      >
        /* */
      </button>
    </HelpTip>
  );
}
