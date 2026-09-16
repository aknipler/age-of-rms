import { useState } from "react";
import type { Span } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import cardStyles from "./cards.module.css";
import styles from "./CommentCard.module.css";

interface CommentCardProps {
  span: Span;
}

// Show comments in Breakdown, editable via a plain
// textarea over the content between the `/*`/`*/` delimiters (`span`
// itself always includes them, see comments.ts's extractComments).
// Comments are pure trivia (parser-design Sec.2), not part of the AST, so
// editComment/addComment (patch/intents.ts) work on a raw span rather
// than on any Item, the same way the rest of the patch engine works on
// ArgNode/CommandNode spans. BlockList decides WHERE these render (the
// gaps between consecutive items, or after the last one when a
// `trailingBoundary` is given, via src/breakdown/comments.ts); this
// component just renders and edits one.
export function CommentCard({ span }: CommentCardProps) {
  const { source, applyEdit, registerFocusable, isExpanded, toggleExpanded } =
    useBreakdownContext();
  const innerStart = span.start + 2; // past "/*"
  const innerEnd = span.end - 2; // before "*/"
  const inner = source.slice(innerStart, innerEnd);
  const [error, setError] = useState<string | null>(null);
  // Same anchor-by-span scheme as every other card (Sec.6.3), so a comment's
  // collapse state survives a reparse the same way a command's does, with
  // the sense INVERTED from CommandCard's: a comment starts open (there's
  // usually only a few, so hiding them all by default costs more than it
  // saves), and toggleExpanded(span) here means "this one's been
  // explicitly closed", not "explicitly opened". The underlying Set is the
  // same shared expandedAnchors, spans never collide across node kinds, so
  // there's no need for a second per-kind Set just to flip one card type's
  // default.
  const expanded = !isExpanded(span);
  const firstLine = inner.split("\n")[0]?.trim();

  // extractComments folds a nested comment (nestedComments: true, the
  // parser's default) into ONE outer span, so `inner` here already
  // contains its own `/*`/`*/` pair. Editing that safely means matching
  // nesting depth, not just banning the substrings, real parsing this
  // component has no business doing, so a nested comment stays the old
  // read-only `<pre>` rather than a half-working textarea that rejects
  // every edit (its own unedited content would always fail that check).
  const isNested = inner.includes("/*") || inner.includes("*/");

  // Unlike ValueEditor's single-line fields, Enter has to stay literal
  // here (real RMS comments span multiple lines), so this only commits on
  // blur, never on Enter. Escape still reverts, same convention.
  const commit = (raw: string) => {
    if (raw === inner) {
      setError(null);
      return;
    }
    // A block comment has no escape for its own delimiters: embedding
    // either substring here would either end the comment early or (with
    // nestedComments on) leave it unbalanced. Reject rather than silently
    // mangling the source, same "only truly unrenderable input is
    // rejected" rule ValueEditor.tsx follows.
    if (raw.includes("/*") || raw.includes("*/")) {
      setError("a comment can't contain /* or */");
      return;
    }
    setError(null);
    applyEdit({
      kind: "editComment",
      innerSpan: { start: innerStart, end: innerEnd },
      text: raw,
    });
  };

  // Open by default (see the `expanded` comment above for why this differs
  // from CommandCard), collapsible to a one-line header showing the
  // comment's own first line rather than a generic label, so a comment
  // that's been closed is still easy to tell apart from its neighbors.
  // Auto-grows the textarea to fit its content so an expanded comment never
  // needs its own internal scrollbar — the card just gets taller. Runs on
  // mount and on every keystroke; resetting to "auto" first is what lets
  // scrollHeight shrink back down after deleting a line, not just grow.
  const autoSize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Collapsed, the header IS the only content, so it shows the first line
  // as a summary. Expanded, the full text is already visible below —
  // repeating the first line here would just print it twice.
  const header = (
    <div className={styles.header}>
      <HelpTip id="breakdown.commentCard.toggle">
        <button
          type="button"
          className={styles.toggle}
          onClick={() => toggleExpanded(span)}
          aria-expanded={expanded}
        >
          {expanded ? "−" : "+"}
        </button>
      </HelpTip>
      {!expanded && (
        <span className={styles.summary}>{firstLine || "(empty)"}</span>
      )}
    </div>
  );

  if (isNested) {
    return (
      <div className={`${cardStyles.card} ${styles.card}`}>
        {header}
        {expanded && (
          <div className={styles.body}>
            <HelpTip id="breakdown.commentCard.nested">
              <pre className={styles.text}>
                {source.slice(span.start, span.end)}
              </pre>
            </HelpTip>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${cardStyles.card} ${styles.card}`}>
      {header}
      {expanded && (
        <div className={styles.body}>
          <HelpTip id="breakdown.commentCard">
            <textarea
              key={span.start}
              ref={(el) => {
                registerFocusable(span.start, el);
                autoSize(el);
              }}
              className={styles.text}
              defaultValue={inner}
              rows={1}
              onInput={(e) => autoSize(e.currentTarget)}
              onBlur={(e) => commit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.currentTarget.value = inner;
                  setError(null);
                  e.currentTarget.blur();
                }
              }}
            />
          </HelpTip>
          {error && <span className={styles.inlineError}>{error}</span>}
        </div>
      )}
    </div>
  );
}
