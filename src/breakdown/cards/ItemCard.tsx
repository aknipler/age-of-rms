import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  AttributeNode,
  CommandNode,
  DirectiveNode,
  IfNode,
  Item,
  OrphanBlockNode,
  RandomNode,
  RawNode,
} from "../../parser/types";
import { canActOnCard, canRearrangeItem, cardKindForItem } from "../cardKind";
import { useBreakdownContext } from "../BreakdownContext";
import { isInteractiveTarget, useCardDrag } from "../cardDrag";
import { clickModeOf } from "../multiSelect";
import { usePreviewCut } from "../../PreviewCutContext";
import { usePreviewView } from "../../components/preview/PreviewViewContext";
import { CardMenu } from "./CardMenu";
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
      return (
        <RawCard node={item as OrphanBlockNode} kindLabel="Shared block" />
      );
    case "raw":
      return <RawCard node={item as RawNode} kindLabel="Raw" />;
  }
}

/**
 * Central dispatcher, docs/breakdown-design.md Sec.3.2's table. Every `Item`
 * kind maps to exactly one card component. The mapping is total
 * (cardKindForItem throws on an unhandled kind at compile time via its
 * `never` exhaustiveness check), so nothing in the AST is silently
 * dropped from the UI (goal #3).
 *
 * Sec.3.9 (post-3.4), this is also the single place that makes every card
 * selectable, incl. nested ones: BlockList recursively renders ItemCard
 * for a branch's items too, so wrapping here covers top-level AND nested
 * cards uniformly with no per-card-type change. stopPropagation is the
 * whole mechanism for "clicking a value editor inside a card also
 * selects that card, but doesn't ALSO select an ancestor conditional",
 * the innermost ItemCard's click handler fires first (React bubbles
 * child-to-parent) and stops it there.
 *
 * Since 2026-09-18 (Sec.3.11) the same wrapper is where a card is picked
 * up for dragging and where its right-click menu opens, for the same
 * reason. One wrapper reaches every card kind at every depth, and the
 * innermost one wins by stopping propagation, so pressing on a command
 * inside a branch drags that command and never the conditional around it.
 */
export function ItemCard({ item }: { item: Item }) {
  const { isSelected, selectCard, clickCard, selectedCards } =
    useBreakdownContext();
  const { dragging, draggingGroup, indicator, beginDrag, consumeDragClick } =
    useCardDrag();
  const { cutOffset } = usePreviewCut();
  const { view } = usePreviewView();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const selected = isSelected(item.span);
  const rearrangeable = canRearrangeItem(item);
  // The Breakdown half of the Current cut point's shading (preview-design
  // Sec.5): a card the preview is ignoring is dimmed, so "the map stops
  // here" is visible on this tab too and not only in the code.
  //
  // Nested cards get this for free, and correctly. BlockList renders
  // ItemCard recursively, so a `create_land` whose block was cut in half
  // stays lit while the attributes below the cut dim inside it. That is
  // exactly what the generator did to it.
  const ignoredByPreview =
    view === "current" && cutOffset !== null && item.span.start >= cutOffset;
  const isDragSource =
    (dragging !== null && dragging.span.start === item.span.start) ||
    (draggingGroup?.some((g) => g.span.start === item.span.start) ?? false);
  // Multi-select (2026-10-21, Sec.3.12). Pressing on one of several
  // selected cards drags them all, the way a file list does. The group is
  // the selection's movable cards, selected comment cards included since
  // 2026-10-22, and only counts when it holds this one.
  const inMultiSelection =
    (selectedCards?.length ?? 0) > 1 &&
    (selectedCards?.some((s) => s.span.start === item.span.start) ?? false);
  const dragGroup = inMultiSelection
    ? selectedCards!.filter(canActOnCard)
    : undefined;
  const dropEdge =
    indicator?.kind === "edge" && indicator.anchor === item.span.start
      ? indicator.edge
      : null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Stop here whichever way this goes. A press inside a nested card
    // must never reach the ancestor card's own handler and pick THAT up.
    e.stopPropagation();
    if (!rearrangeable || isInteractiveTarget(e.target)) return;
    beginDrag(
      item,
      e,
      dragGroup?.some((g) => g.span.start === item.span.start)
        ? dragGroup
        : undefined,
    );
  };

  return (
    <div
      className={`${styles.selectable} ${selected ? styles.selected : ""} ${
        ignoredByPreview ? styles.ignoredByPreview : ""
      } ${isDragSource ? styles.dragSource : ""} ${
        dropEdge === "before" ? styles.dropBefore : ""
      } ${dropEdge === "after" ? styles.dropAfter : ""}`}
      // Cross-tab sync (post-3.9 follow-up) scrolls a specific card into
      // view by querying for this exact attribute, see BreakdownPane's
      // mount-sync effect. The offset (span.start) is the same value used
      // as the anchor everywhere else in the selection system. The drag
      // layer reads it back off the element under the pointer to find the
      // drop target (cardDrag.tsx).
      data-anchor={item.span.start}
      // Read by cards.module.css to show this card's Delete and comment
      // buttons at full strength while it is selected.
      data-selected={selected || undefined}
      onPointerDown={onPointerDown}
      // Capture phase, so the click that ends a drag is swallowed before
      // any header toggle or value editor inside the card can see it.
      onClickCapture={(e) => {
        if (consumeDragClick()) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      // Shift and a press on card chrome would otherwise start a browser
      // text selection across every card in between.
      onMouseDown={(e) => {
        if (e.shiftKey && !isInteractiveTarget(e.target)) e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        // A click into a field is someone starting to edit, never a
        // selection gesture, so modifiers there (Shift extends a text
        // selection inside an input) leave the card selection plain.
        const mode = isInteractiveTarget(e.target) ? "replace" : clickModeOf(e);
        if (clickCard) clickCard(item, mode);
        else selectCard(item.span);
      }}
      onContextMenu={(e) => {
        // Only the cards the menu can act on take over the right click.
        // The rest keep whatever the host does with it.
        if (!rearrangeable) return;
        e.preventDefault();
        e.stopPropagation();
        // A right click inside a multi-selection keeps it, so the menu's
        // Delete can act on all of it.
        if (!inMultiSelection) selectCard(item.span);
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
    >
      {renderInner(item)}
      {menuAt && rearrangeable && (
        <CardMenu item={item} at={menuAt} onClose={() => setMenuAt(null)} />
      )}
    </div>
  );
}
