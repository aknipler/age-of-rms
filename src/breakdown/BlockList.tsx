import { Fragment, useEffect, useState } from "react";
import type { Item } from "../parser/types";
import type { InsertTarget } from "./patch/intents";
import { ItemCard } from "./cards/ItemCard";
import { CommentCard } from "./cards/CommentCard";
import { useBreakdownContext } from "./BreakdownContext";
import { useCardDrag } from "./cardDrag";
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
 *
 * `emptyTarget` (2026-09-18) is where a dragged card lands when it is
 * dropped on this list while the list has nothing in it. A list with cards
 * needs no such target, since a drop resolves to before or after one of
 * them, and an empty list has no card to be beside, so it offers its own
 * container as the target instead (an `in: "branch"` for a branch body).
 */
export function BlockList({
  items,
  trailingBoundary,
  emptyTarget,
}: {
  items: Item[];
  trailingBoundary?: number;
  emptyTarget?: InsertTarget;
}) {
  const { comments } = useBreakdownContext();
  if (items.length === 0) {
    return emptyTarget ? (
      <EmptyDropZone target={emptyTarget} />
    ) : (
      <p className={styles.empty}>Nothing here yet.</p>
    );
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

/**
 * The "Nothing here yet." placeholder, registered with the drag layer as a
 * drop target for as long as it is on screen. The `target` holds AST nodes
 * that are replaced on every parse, so the registration is redone whenever
 * it changes and the id on the element follows it. Lit up while a drag
 * hovers it, which is the same signal the between-cards line gives.
 */
function EmptyDropZone({ target }: { target: InsertTarget }) {
  const { registerDropZone, unregisterDropZone, indicator, dragging } =
    useCardDrag();
  const [zoneId, setZoneId] = useState<number | null>(null);
  useEffect(() => {
    const id = registerDropZone(target);
    setZoneId(id);
    return () => unregisterDropZone(id);
  }, [target, registerDropZone, unregisterDropZone]);
  const active =
    zoneId !== null &&
    indicator?.kind === "zone" &&
    indicator.zoneId === zoneId;
  return (
    <p
      className={`${styles.empty} ${dragging ? styles.emptyDroppable : ""} ${
        active ? styles.emptyActive : ""
      }`}
      data-drop-zone={zoneId ?? undefined}
    >
      {dragging ? "Drop here" : "Nothing here yet."}
    </p>
  );
}
