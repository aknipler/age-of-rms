import type { Span } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import cardStyles from "./cards.module.css";
import styles from "./CommentCard.module.css";

interface CommentCardProps {
  span: Span;
}

// Ash's follow-up ask: "show comments in Breakdown too." Read-only, same
// as raw/orphan regions (§3.7) — comments are pure trivia (parser-design
// §2), not part of the editable AST, so there's no EditIntent for them
// yet. Showing them doesn't imply making them editable here; that stays
// Code-tab-only for now. BlockList decides WHERE these render (the gaps
// between consecutive items it already knows about, via
// src/breakdown/comments.ts); this component just renders one.
export function CommentCard({ span }: CommentCardProps) {
  const { source } = useBreakdownContext();
  const text = source.slice(span.start, span.end);
  return (
    <div className={`${cardStyles.card} ${styles.card}`}>
      <HelpTip id="breakdown.commentCard">
        <pre className={styles.text}>{text}</pre>
      </HelpTip>
    </div>
  );
}
