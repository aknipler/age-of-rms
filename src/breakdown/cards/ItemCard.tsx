import type { AttributeNode, CommandNode, DirectiveNode, IfNode, Item, OrphanBlockNode, RandomNode, RawNode } from "../../parser/types";
import { cardKindForItem } from "../cardKind";
import { useBreakdownContext } from "../BreakdownContext";
import { CommandCard } from "./CommandCard";
import { DirectiveCard } from "./DirectiveCard";
import { ConditionalCard } from "./ConditionalCard";
import { RandomCard } from "./RandomCard";
import { RawCard } from "./RawCard";
import { StrayAttributeCard } from "./StrayAttributeCard";
import styles from "./ItemCard.module.css";

function renderInner(item: Item) {
  switch (cardKindForItem(item)) {
    case "command":
      return <CommandCard command={item as CommandNode} />;
    case "strayAttribute":
      return <StrayAttributeCard attribute={item as AttributeNode} />;
    case "directive":
      return <DirectiveCard directive={item as DirectiveNode} />;
    case "conditional":
      return <ConditionalCard node={item as IfNode} />;
    case "random":
      return <RandomCard node={item as RandomNode} />;
    case "sharedBlock":
      return <RawCard node={item as OrphanBlockNode} kindLabel="Shared block" />;
    case "raw":
      return <RawCard node={item as RawNode} kindLabel="Raw" />;
  }
}

/**
 * Central dispatcher, docs/breakdown-design.md §3.2's table. Every `Item`
 * kind maps to exactly one card component — the mapping is total
 * (cardKindForItem throws on an unhandled kind at compile time via its
 * `never` exhaustiveness check), so nothing in the AST is silently
 * dropped from the UI (goal #3).
 *
 * §3.9 (post-3.4) — this is also the single place that makes every card
 * selectable, incl. nested ones: BlockList recursively renders ItemCard
 * for a branch's items too, so wrapping here covers top-level AND nested
 * cards uniformly with no per-card-type change. stopPropagation is the
 * whole mechanism for "clicking a value editor inside a card also
 * selects that card, but doesn't ALSO select an ancestor conditional" —
 * the innermost ItemCard's click handler fires first (React bubbles
 * child-to-parent) and stops it there.
 */
export function ItemCard({ item }: { item: Item }) {
  const { isSelected, selectCard } = useBreakdownContext();
  const selected = isSelected(item.span);
  return (
    <div
      className={`${styles.selectable} ${selected ? styles.selected : ""}`}
      // Cross-tab sync (post-3.9 follow-up) scrolls a specific card into
      // view by querying for this exact attribute — see BreakdownPane's
      // mount-sync effect. The offset (span.start) is the same value used
      // as the anchor everywhere else in the selection system.
      data-anchor={item.span.start}
      onClick={(e) => {
        e.stopPropagation();
        selectCard(item.span);
      }}
    >
      {renderInner(item)}
    </div>
  );
}
