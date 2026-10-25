import { Fragment, useEffect, useState } from "react";
import type { DirectiveNode, Item } from "../parser/types";
import type { InsertTarget } from "./patch/intents";
import { ItemCard } from "./cards/ItemCard";
import { CommentCard } from "./cards/CommentCard";
import { ConstTable } from "./cards/ConstTable";
import { segmentList } from "./constTableModel";
import { useBreakdownContext } from "./BreakdownContext";
import { useCardDrag } from "./cardDrag";
import {
  commentsBetweenItems,
  inlineCommentStarts,
  leadingComments,
} from "./comments";
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
 * Comments before the first item render too since 2026-10-22, and so do the
 * comments of a list with no items, since commenting out the first or only
 * card of a list puts one there (comments.ts's leadingComments). Comments
 * after the last item render too, when the caller
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
  const { comments, tokens, source } = useBreakdownContext();
  const leading = leadingComments(items, comments, tokens, trailingBoundary);
  if (items.length === 0) {
    // A list emptied by commenting out its last card still shows that
    // comment, which is how the card comes back. A drop beside it lands in
    // this list, so the comment cards stand in for the empty drop zone.
    if (leading.length > 0)
      return (
        <div className={styles.list}>
          {leading.map((c) => (
            <CommentCard key={c.start} span={c} />
          ))}
        </div>
      );
    return emptyTarget ? (
      <EmptyDropZone target={emptyTarget} />
    ) : (
      <p className={styles.empty}>Nothing here yet.</p>
    );
  }
  // A block-less command's inline comment trails its span, so it sits in a
  // gap, but the command's own row shows it (CommandCard.tsx). Left out
  // here so it does not render twice.
  const inline = inlineCommentStarts(items, tokens, source);
  const gaps = commentsBetweenItems(
    items,
    inline.size > 0 ? comments.filter((c) => !inline.has(c.start)) : comments,
    trailingBoundary,
  );
  // Runs of #const and #define draw as one table (ConstTable.tsx). A
  // segment's key is its first item's offset, which an edit inside the
  // table never moves, so the table element outlives the reparse that an
  // edit to one of its rows causes. Enter navigation relies on that
  // (enterNav.ts's resolveEnterTarget).
  const segments = segmentList(
    items,
    tokens,
    (i) => (gaps.get(i)?.length ?? 0) > 0,
  );
  return (
    <div className={styles.list}>
      {leading.map((c) => (
        <CommentCard key={c.start} span={c} />
      ))}
      {segments.map((seg) => {
        const lastIndex = seg.kind === "item" ? seg.index : seg.last;
        const first = items[seg.kind === "item" ? seg.index : seg.first];
        return (
          <Fragment key={first.span.start}>
            {seg.kind === "item" ? (
              <ItemCard item={first} />
            ) : (
              <ConstTable
                rows={items.slice(seg.first, seg.last + 1) as DirectiveNode[]}
                directive={seg.directive}
              />
            )}
            {gaps.get(lastIndex)?.map((c) => (
              <CommentCard key={c.start} span={c} />
            ))}
          </Fragment>
        );
      })}
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
