import { Fragment } from "react";
import type { Item } from "../parser/types";
import { ItemCard } from "./cards/ItemCard";
import { CommentCard } from "./cards/CommentCard";
import { useBreakdownContext } from "./BreakdownContext";
import { commentsBetweenItems } from "./comments";
import styles from "./BlockList.module.css";

/**
 * Recursive Item[] renderer (docs/breakdown-design.md §6.1). A branch
 * segment renders a BlockList over branch.items, which is how nested
 * conditionals/blocks-within-branches render uniformly with a section
 * body — same component, different item list.
 *
 * Also where comments get interleaved (Ash's follow-up ask): every
 * BlockList call independently attributes to itself whichever comments
 * fall strictly between two of ITS OWN consecutive items — safe and
 * unambiguous, since item spans never overlap across different lists.
 * Comments before the first item or after the last item of any list are
 * out of scope for v1 (see comments.ts's own doc comment) — they simply
 * don't render yet.
 */
export function BlockList({ items }: { items: Item[] }) {
  const { comments } = useBreakdownContext();
  if (items.length === 0) {
    return <p className={styles.empty}>Nothing here yet.</p>;
  }
  const gaps = commentsBetweenItems(items, comments);
  return (
    <div className={styles.list}>
      {items.map((item, i) => (
        <Fragment key={item.span.start}>
          <ItemCard item={item} />
          {gaps.get(i)?.map((c) => <CommentCard key={c.start} span={c} />)}
        </Fragment>
      ))}
    </div>
  );
}
