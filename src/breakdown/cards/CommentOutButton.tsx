import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import type { DraggableCard } from "../patch/intents";
import cardStyles from "./cards.module.css";

// The comment toggle that sits beside a card's Delete button (2026-10-22,
// breakdown-design Sec.3.13). On a command, directive, if or start_random
// card it comments the card out; on a comment card, or on an inline comment
// a commented-out neighbour became, it takes the `/* */` off again. One
// component for every card kind, since the intent (toggleCommentOut) already
// decides which way to go from the card it is given.
//
// Like the Delete button beside it, this acts on its own card only, whatever
// else is selected. The hotkey is the way to toggle a whole selection. The
// card stays selected afterwards only when it was the whole selection, so a
// click here never quietly collapses a multi-selection to one card.
export function CommentOutButton({
  card,
  disabled = false,
}: {
  card: DraggableCard;
  /** An unclosed construct, whose span is only a guess at where it ends, which the engine refuses anyway. */
  disabled?: boolean;
}) {
  const { applyEdit, toggleCommentOut, selectedCards, source } =
    useBreakdownContext();
  const isComment = card.kind === "comment";
  // An empty comment holds no code to restore (computeEdit refuses it).
  const empty =
    isComment &&
    source.slice(card.span.start + 2, card.span.end - 2).trim() === "";
  return (
    <HelpTip
      id={isComment ? "breakdown.card.uncomment" : "breakdown.card.commentOut"}
    >
      <button
        type="button"
        className={`${cardStyles.commentToggle} ${
          isComment ? cardStyles.uncomment : ""
        }`}
        // Dimmed until its card is hovered, selected or focused (cards.module.css).
        data-quiet
        // Hidden inside commented-out code (CommentCard.module.css).
        data-comment-toggle
        aria-label={isComment ? "Uncomment" : "Comment out"}
        disabled={disabled || empty}
        // Keeps focus where it is. A comment card's textarea, or a value
        // field on this card, would otherwise blur and commit its unsaved
        // text as an edit overlapping this one, and the patch queue refuses
        // the second (CommentCard's Delete button has the full story).
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          // Stops ItemCard's wrapper from selecting this card first, the
          // same reason every Delete button stops it.
          e.stopPropagation();
          const alone =
            selectedCards?.length === 1 &&
            selectedCards[0].span.start === card.span.start;
          if (toggleCommentOut) toggleCommentOut([card], alone);
          else applyEdit({ kind: "toggleCommentOut", cards: [card] });
        }}
      >
        /*
      </button>
    </HelpTip>
  );
}
