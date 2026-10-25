import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Item } from "../parser/types";
import type {
  DraggableCard,
  InsertAnchor,
  InsertTarget,
} from "./patch/intents";
import { useBreakdownContext } from "./BreakdownContext";
import { findItemAtOffset } from "./selectionResolve";
import { findCommentAtOffset } from "./comments";

// Dragging a card to a new place (2026-09-18, breakdown-design Sec.3.11).
//
// Pointer events with capture, not the HTML5 drag-and-drop API. That is the
// house idiom (the side-panel resizer, the Land Placement canvas) and it
// sidesteps two things HTML5 DnD does badly here. It fires a drag the
// moment the button goes down, so selecting text inside a value editor
// would start moving the card, and its ghost image is the whole card
// painted at 50%, which for an expanded conditional is most of the screen.
// Here a press is only a drag once the pointer has travelled DRAG_SLOP_PX,
// the same click-versus-pan rule the canvas uses, and the card itself dims
// in place while a thin line marks where it will land.
//
// The drop target is found by asking the DOM what is under the pointer.
// Every card already carries `data-anchor` (its span.start, the offset the
// selection system keys on), so resolving the element back to its Item is
// the same findItemAtOffset lookup selection uses, against the active tab's
// items. An empty branch body is a card list with nothing to hover over,
// so BlockList renders a DropZone there that registers its own container
// InsertTarget. Those two kinds of hit are the only two, which mirrors the
// two shapes InsertTarget has for a card list, beside/inside.
//
// A comment card carries the same `data-anchor` convention (its own
// span.start), so resolveHit falls back to findCommentAtOffset whenever
// findItemAtOffset comes back empty. That is what lets a comment be both
// something a drag can pick up (CommentCard.tsx calls beginDrag with a
// CommentRef, DraggableCard's non-Item half) and something a drop can land
// beside (InsertAnchor). Comments carry no InsertTarget shape of their own,
// they only ever appear as the `before`/`after` anchor of one.

/** How far the pointer moves before a press becomes a drag rather than a click. */
const DRAG_SLOP_PX = 4;
/** Distance from the scroll container's edge inside which dragging scrolls it. */
const AUTOSCROLL_BAND_PX = 36;
const AUTOSCROLL_STEP_PX = 12;

export type DropIndicator =
  | { kind: "edge"; anchor: number; edge: "before" | "after" }
  | { kind: "zone"; zoneId: number };

export interface CardDragApi {
  /** The card under the pointer, once the press has become a drag. */
  dragging: DraggableCard | null;
  /**
   * Every card travelling with it when the press was on one of several
   * selected cards (2026-10-21, multi-select), the pressed card included.
   * null for an ordinary one-card drag.
   */
  draggingGroup: readonly DraggableCard[] | null;
  /** Where a release would put it, or null over nothing droppable. */
  indicator: DropIndicator | null;
  /** ItemCard/CommentCard call this on a primary-button press on card chrome. */
  beginDrag: (
    item: DraggableCard,
    event: ReactPointerEvent<HTMLElement>,
    group?: readonly DraggableCard[],
  ) => void;
  /** A container with no cards registers itself as a drop target; returns the id its element must carry as `data-drop-zone`. */
  registerDropZone: (target: InsertTarget) => number;
  unregisterDropZone: (id: number) => void;
  /** True right after a drag released, so ItemCard swallows the click the browser synthesises from the same press. */
  consumeDragClick: () => boolean;
}

const CardDragCtx = createContext<CardDragApi | null>(null);

/**
 * Outside a provider (a card rendered on its own, as the card test
 * harnesses do) dragging is simply off. Cards render the same either way,
 * so an inert api beats a throw here; the drag layer is an addition to a
 * card, not something a card depends on.
 */
const INERT_API: CardDragApi = {
  dragging: null,
  draggingGroup: null,
  indicator: null,
  beginDrag: () => {},
  registerDropZone: () => 0,
  unregisterDropZone: () => {},
  consumeDragClick: () => false,
};

export function useCardDrag(): CardDragApi {
  return useContext(CardDragCtx) ?? INERT_API;
}

/**
 * Turns dragging off for every card inside it. The cards of commented-out
 * code (CommentedCode.tsx) are drawn from the comment's own text, so their
 * spans are offsets into that text, and the pane's drag layer would read
 * them as offsets into the document.
 */
export function NoCardDrag({ children }: { children: ReactNode }) {
  return (
    <CardDragCtx.Provider value={INERT_API}>{children}</CardDragCtx.Provider>
  );
}

interface PendingDrag {
  item: DraggableCard;
  group: readonly DraggableCard[] | null;
  pointerId: number;
  startX: number;
  startY: number;
  /** The element that took pointer capture, released on the way out. */
  captureEl: HTMLElement;
}

/** Which target a hit resolves to, kept beside the indicator so the drop and the line always agree. */
interface Hit {
  indicator: DropIndicator;
  target: InsertTarget;
}

export function CardDragProvider({
  items,
  scrollContainerRef,
  children,
}: {
  /** The active tab's top-level items, the roots findItemAtOffset descends from. */
  items: readonly Item[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { moveItem, moveItems, comments } = useBreakdownContext();
  const [dragging, setDragging] = useState<DraggableCard | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<
    readonly DraggableCard[] | null
  >(null);
  const groupRef = useRef<readonly DraggableCard[] | null>(null);
  // This provider's own stretch of the DOM. The stacked view (2026-10-21)
  // puts one provider per section in one scroll container, and a comment
  // card or empty branch from another section is under the pointer just as
  // easily as one from this section. Items already resolve against this
  // section's own list; comments and drop zones are checked against this
  // element instead, which is the same question asked of the page.
  const scopeRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // Refs for everything the window listeners read. They are attached once
  // per press and would otherwise close over the state of the render they
  // were created in, the stale-closure trap useDocument.ts documents.
  const pendingRef = useRef<PendingDrag | null>(null);
  const draggingRef = useRef<DraggableCard | null>(null);
  const hitRef = useRef<Hit | null>(null);
  // The items a drag is resolved against change on every parse, so this is
  // the latest-value ref pattern, assigned every render. A drag in flight
  // across a parse simply resolves against the newer tree on its next move.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Same latest-value pattern for comments (CommentCard drop targets),
  // re-derived on every parse the same way items is.
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const zonesRef = useRef(new Map<number, InsertTarget>());
  const nextZoneId = useRef(1);
  const dragClickPendingRef = useRef(false);

  const registerDropZone = useCallback((target: InsertTarget) => {
    const id = nextZoneId.current++;
    zonesRef.current.set(id, target);
    return id;
  }, []);
  const unregisterDropZone = useCallback((id: number) => {
    zonesRef.current.delete(id);
  }, []);

  const resolveHit = useCallback((x: number, y: number): Hit | null => {
    const node = draggingRef.current;
    if (!node) return null;
    const under = document.elementFromPoint(x, y);
    const el = under?.closest<HTMLElement>("[data-drop-zone], [data-anchor]");
    if (!el || !scopeRef.current?.contains(el)) return null;
    // Everything that moves: the group, or the one card.
    const moving: readonly { span: { start: number; end: number } }[] =
      groupRef.current ?? [node];
    const zoneAttr = el.dataset.dropZone;
    if (zoneAttr !== undefined) {
      const zoneId = Number(zoneAttr);
      const target = zonesRef.current.get(zoneId);
      // A zone inside the card being dragged (its own empty branch) is not
      // a place it can go. computeEdit refuses that too, but the line
      // should not promise what the drop will not do.
      if (
        !target ||
        moving.some((m) => el.closest(`[data-anchor="${m.span.start}"]`))
      )
        return null;
      return { indicator: { kind: "zone", zoneId }, target };
    }
    const anchor = Number(el.dataset.anchor);
    const item = findItemAtOffset(itemsRef.current, anchor);
    // A comment carries the same data-anchor convention but is not an Item
    // (comments.ts), so a miss above falls back to the comment list before
    // giving up — this is the one lookup that lets a comment be dropped
    // beside, the mirror of CommentCard.tsx calling beginDrag to let one be
    // picked up.
    const commentSpan = item
      ? undefined
      : findCommentAtOffset(commentsRef.current, anchor);
    const target: InsertAnchor | undefined =
      item ??
      (commentSpan ? { kind: "comment", span: commentSpan } : undefined);
    if (!target) return null;
    if (
      moving.some(
        (m) =>
          target.span.start >= m.span.start && target.span.end <= m.span.end,
      )
    )
      return null; // a moving card itself, or a card inside one
    const rect = el.getBoundingClientRect();
    const edge: "before" | "after" =
      y < rect.top + rect.height / 2 ? "before" : "after";
    return {
      indicator: { kind: "edge", anchor: target.span.start, edge },
      target: edge === "before" ? { before: target } : { after: target },
    };
  }, []);

  const autoscroll = useCallback(
    (y: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (y < rect.top + AUTOSCROLL_BAND_PX)
        container.scrollTop -= AUTOSCROLL_STEP_PX;
      else if (y > rect.bottom - AUTOSCROLL_BAND_PX)
        container.scrollTop += AUTOSCROLL_STEP_PX;
    },
    [scrollContainerRef],
  );

  const endDrag = useCallback(
    (drop: boolean) => {
      const pending = pendingRef.current;
      const node = draggingRef.current;
      const group = groupRef.current;
      const hit = hitRef.current;
      if (pending) {
        try {
          pending.captureEl.releasePointerCapture(pending.pointerId);
        } catch {
          // Capture may already be gone (pointercancel), nothing to release.
        }
      }
      pendingRef.current = null;
      draggingRef.current = null;
      groupRef.current = null;
      hitRef.current = null;
      if (node) {
        // A real drag happened, so the click the browser fires after this
        // pointerup belongs to the drag and must not toggle or select.
        dragClickPendingRef.current = true;
        document.body.classList.remove("breakdown-dragging");
      }
      setDragging(null);
      setDraggingGroup(null);
      setIndicator(null);
      if (drop && node && hit) {
        if (group && moveItems) moveItems(group, hit.target);
        else moveItem(node, hit.target);
      }
    },
    [moveItem, moveItems],
  );

  // Window-level listeners live for the duration of one press. Attaching
  // them in beginDrag and removing them in the up/cancel handler (rather
  // than a mount-time effect) means an idle pane has no pointermove
  // listener at all.
  const beginDrag = useCallback(
    (
      item: DraggableCard,
      event: ReactPointerEvent<HTMLElement>,
      group?: readonly DraggableCard[],
    ) => {
      if (event.button !== 0 || pendingRef.current) return;
      const captureEl = event.currentTarget;
      pendingRef.current = {
        item,
        group: group && group.length > 1 ? group : null,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        captureEl,
      };

      const onMove = (e: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending || e.pointerId !== pending.pointerId) return;
        if (!draggingRef.current) {
          const travel =
            Math.abs(e.clientX - pending.startX) +
            Math.abs(e.clientY - pending.startY);
          if (travel < DRAG_SLOP_PX) return;
          draggingRef.current = pending.item;
          groupRef.current = pending.group;
          setDragging(pending.item);
          setDraggingGroup(pending.group);
          document.body.classList.add("breakdown-dragging");
          // Capture only once it IS a drag, so an ordinary click on card
          // chrome never has its pointer taken from the element it pressed.
          try {
            captureEl.setPointerCapture(pending.pointerId);
          } catch {
            // Not capturable (element gone mid-press), the window listeners still see the pointer.
          }
        }
        autoscroll(e.clientY);
        const hit = resolveHit(e.clientX, e.clientY);
        hitRef.current = hit;
        setIndicator(hit?.indicator ?? null);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pendingRef.current?.pointerId) return;
        cleanup();
        endDrag(true);
      };
      const onCancel = () => {
        cleanup();
        endDrag(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && draggingRef.current) {
          e.preventDefault();
          cleanup();
          endDrag(false);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    },
    [autoscroll, endDrag, resolveHit],
  );

  const consumeDragClick = useCallback(() => {
    const pending = dragClickPendingRef.current;
    dragClickPendingRef.current = false;
    return pending;
  }, []);

  const api = useMemo<CardDragApi>(
    () => ({
      dragging,
      draggingGroup,
      indicator,
      beginDrag,
      registerDropZone,
      unregisterDropZone,
      consumeDragClick,
    }),
    [
      dragging,
      draggingGroup,
      indicator,
      beginDrag,
      registerDropZone,
      unregisterDropZone,
      consumeDragClick,
    ],
  );

  // `display: contents` keeps this wrapper out of layout entirely, so the
  // card list lays out as if it were not there, while the DOM still has an
  // element whose contains() answers "is this inside my section".
  return (
    <CardDragCtx.Provider value={api}>
      <div ref={scopeRef} style={{ display: "contents" }}>
        {children}
      </div>
    </CardDragCtx.Provider>
  );
}

/**
 * True when a press at this element should not start a drag, which is
 * anything a person clicks or types into. The card chrome (header, summary, padding)
 * is what drags. Buttons are included so a press on the delete or expand
 * button stays a click even if the hand drifts.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="menu"]',
    ) !== null
  );
}
