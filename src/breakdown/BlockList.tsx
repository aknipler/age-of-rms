import { Fragment } from "react";
import type { Item } from "../parser/types";
import { ItemCard } from "./cards/ItemCard";
import { CommentCard } from "./cards/CommentCard";
import { useBreakdownContext } from "./BreakdownContext";
import { commentsBetweenItems } from "./comments";
import styles from "./BlockList.module.css";

/**
 * Recursive Item[] renderer (docs/breakdown-design.md Sec.6.1). A branch
 * segment renders a BlockList over branch.items, which is how nested
 * conditionals/blocks-within-branches render uniformly with a section
 * body, same component, different item list.
 *
 * Also where comments get interleaved: every
 * BlockList call independently attributes to itself whichever comments
 * fall strictly between two of ITS OWN consecutive items, safe and
 * unambiguous, since item spans never overlap across different lists.
 * Comments before the first item of any list are out of scope (see
 * comments.ts). Comments after the last item render too, when the caller
 * passes `trailingBoundary` (the offset of whatever closes this specific
 * container). Every call site has that value already, since it's the
 * same one addComment/addCommand need to append there in the first place.
 */
export function BlockList({
  items,
  trailingBoundary,
}: {
  items: Item[];
  trailingBoundary?: number;
}) {
  const { comments } = useBreakdownContext();
  if (items.length === 0) {
    return <p className={styles.empty}>Nothing here yet.</p>;
  }
  const gaps = commentsBetweenItems(items, comments, trailingBoundary);
  return (
    <div className={styles.list}>
      {items.map((item, i) => (
        <Fragment key={item.span.start}>
          <ItemCard item={item} />
          {gaps.get(i)?.map((c) => (
            <CommentCard key={c.start} span={c} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
