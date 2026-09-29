import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Span } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { isInteractiveTarget, useCardDrag } from "../cardDrag";
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
//
// Draggable the same way ItemCard's cards are (cardDrag.tsx, Sec.3.11),
// added here directly rather than by wrapping this card in ItemCard: that
// wrapper's selection/context-menu machinery is Item-only and a comment has
// neither, but the drag layer itself only ever needs a span, so
// beginDrag/isDragSource/dropEdge port over unchanged with a CommentRef
// (`{ kind: "comment"; span }`) standing in for the Item ItemCard would
// pass. Previously nothing here called beginDrag at all, so a comment card
// could be dropped ON (as an insert anchor) but never picked UP.
export function CommentCard({ span }: CommentCardProps) {
  const { source, applyEdit, registerFocusable, isExpanded, toggleExpanded } =
    useBreakdownContext();
  const { dragging, indicator, beginDrag, consumeDragClick } = useCardDrag();
  const innerStart = span.start + 2; // past "/*"
  const innerEnd = span.end - 2; // before "*/"
  const inner = source.slice(innerStart, innerEnd);
  const [error, setError] = useState<string | null>(null);
  const isDragSource = dragging !== null && dragging.span.start === span.start;
  const dropEdge =
    indicator?.kind === "edge" && indicator.anchor === span.start
      ? indicator.edge
      : null;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (isInteractiveTarget(e.target)) return;
    beginDrag({ kind: "comment", span }, e);
  };
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

  // Toggle and content share ONE flex row (still called `.header`, but it's
  // the card's only row now): collapsed shows the summary right after the
  // toggle, expanded puts `.body` there instead, both the same way
  // CommandCard's own collapsed label sits next to ITS toggle. `.body`'s
  // `flex: 1` box lands at exactly toggle-width + gap from the card's left
  // edge, which is what used to take a whole second, indented row below
  // the toggle — that row's own height was the dead space users were
  // seeing above the textarea. `styles.expanded` swaps `align-items` to
  // `flex-start`, since a multi-line textarea shouldn't vertically center
  // against the toggle the way a single-line summary does.
  return (
    <div
      className={`${cardStyles.card} ${styles.card} ${
        isDragSource ? styles.dragSource : ""
      } ${dropEdge === "before" ? styles.dropBefore : ""} ${
        dropEdge === "after" ? styles.dropAfter : ""
      }`}
      // Same anchor attribute ItemCard sets, so a scroll request (Add
      // Comment's reveal, BreakdownPane) can find this card too, and so
      // cardDrag.tsx's resolveHit can find this card as a drop target.
      data-anchor={span.start}
      onPointerDown={onPointerDown}
      // Capture phase, so the click a completed drag's pointerup
      // synthesizes is swallowed before it can reach SectionView's
      // click-empty-space-to-deselect handler (ItemCard.tsx does the same).
      onClickCapture={(e) => {
        if (consumeDragClick()) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div className={`${styles.header} ${expanded ? styles.expanded : ""}`}>
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
        {expanded && isNested && (
          <div className={styles.body}>
            <HelpTip id="breakdown.commentCard.nested">
              <pre className={styles.text}>
                {source.slice(span.start, span.end)}
              </pre>
            </HelpTip>
          </div>
        )}
        {expanded && !isNested && (
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
    </div>
  );
}
