// Multi-select for Breakdown cards (2026-10-21, breakdown-design Sec.3.12).
// Pure and framework-free, same convention as selectionResolve.ts, so the
// click rules can be tested without rendering a pane.
//
// The selection is one PRIMARY card plus any number of EXTRA cards, all
// held as source offsets (each card's span.start), the same anchoring
// Sec.6.3 uses for everything that must survive a reparse. The primary is
// the one the rest of the pane already knows about: Add inserts after it,
// the Code tab's cursor follows it, Alt+Up/Down moves it. Extras only ever
// add cards to delete or drag alongside it. Keeping the two apart means a
// single click behaves exactly as it did before multi-select existed.
import type { Item, ScriptNode, Span } from "../parser/types";
import type { CommentRef } from "./patch/intents";
import type { CommentCardPlace } from "./comments";
import { listPathOf } from "./selectionResolve";

/**
 * A card a person can select. Since 2026-10-22 a comment card is one too, so
 * it can be commented back in by hotkey, deleted with the rest of a
 * selection and dragged with it. It is addressed by its own span, the same
 * CommentRef the drag layer already uses.
 */
export type SelectableCard = Item | CommentRef;

export interface CardSelection {
  primary: number | null;
  extras: readonly number[];
}

/**
 * What a click on a card does, read off its modifier keys the way a file
 * list does on each platform. Ctrl on Windows and Linux, Cmd on macOS,
 * toggles one card. Shift selects the run from the primary card to this one.
 * Both are read on every platform, as useDocument.ts does for its own
 * shortcuts, since nobody presses Cmd on Windows by accident.
 */
export type ClickMode = "replace" | "toggle" | "range";

export function clickModeOf(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ClickMode {
  if (event.shiftKey) return "range";
  if (event.ctrlKey || event.metaKey) return "toggle";
  return "replace";
}

/**
 * The selection after a click on `clicked`.
 *
 * `sameScope` says whether two cards may be selected together. The pane
 * passes "in the same section", so a selection never spans two sections:
 * Add then has one section to insert into, and a drag stays inside one
 * section the way it always has. A modified click outside the current
 * scope starts over there, like a plain click.
 *
 * Shift with no primary starts over. Shift between two different lists of
 * the same section (into or out of a branch) lifts both cards to the
 * deepest list holding them both, each standing in for the if or random
 * card it sits inside, and selects the run there (owner's call,
 * 2026-10-22). The run is then one unbroken stretch of text, and the
 * clicked card is still selected, inside the block that holds it.
 *
 * Comment cards (2026-10-22) take part when `places` is given
 * (comments.ts's commentCardPlaces): a comment end of a Shift click is found
 * in the list its card shows in, and a run takes the comment cards between
 * its cards along. Generic over the card type so a caller holding only
 * Items, as before, keeps its own types.
 */
export function nextSelection<C extends SelectableCard>(
  script: ScriptNode,
  primary: C | undefined,
  extras: readonly C[],
  clicked: C,
  mode: ClickMode,
  sameScope: (a: C, b: C) => boolean,
  places?: ReadonlyMap<number, CommentCardPlace>,
): CardSelection {
  const replace: CardSelection = { primary: clicked.span.start, extras: [] };
  if (mode === "replace" || !primary || !sameScope(primary, clicked))
    return replace;

  const all = [primary, ...extras];
  if (mode === "toggle") {
    const remaining = all.filter((i) => i.span.start !== clicked.span.start);
    if (remaining.length === all.length) {
      // Adding. The clicked card becomes the primary, so the next Shift
      // click runs from here, as it does in a file list. The old primary
      // goes on the END of the extras, which keeps them oldest first, the
      // order the removal below relies on.
      return {
        primary: clicked.span.start,
        extras: [...extras, primary].map((i) => i.span.start),
      };
    }
    if (remaining.length === 0) return { primary: null, extras: [] };
    // Removing. If the primary went, the most recently added extra takes
    // its place.
    const nextPrimary =
      clicked.span.start === primary.span.start
        ? remaining[remaining.length - 1]
        : primary;
    return {
      primary: nextPrimary.span.start,
      extras: remaining
        .filter((i) => i !== nextPrimary)
        .map((i) => i.span.start),
    };
  }

  // Range. A run is a stretch of one list: the deepest list on both cards'
  // paths, where each is represented by the card holding it. The primary
  // stays the anchor, even when it is deeper than the run (the run then
  // holds the block it is in), and the run replaces any extras, as Shift
  // does in a file list.
  const fromPath = cardPathOf(script, primary, places);
  const toPath = cardPathOf(script, clicked, places);
  let shared = -1;
  while (
    shared + 1 < fromPath.length &&
    shared + 1 < toPath.length &&
    fromPath[shared + 1].items === toPath[shared + 1].items
  )
    shared++;
  if (shared === -1) return replace;
  const siblings = fromPath[shared].items;
  // By text position rather than list index, since a comment end of the
  // run is a holder without an index in the list.
  const a = fromPath[shared].holder.span;
  const b = toPath[shared].holder.span;
  const lo = Math.min(a.start, b.start);
  const hi = Math.max(a.end, b.end);
  const runItems = siblings
    .filter((i) => i.span.start >= lo && i.span.end <= hi)
    .map(startOf);
  const runComments: number[] = [];
  if (places)
    for (const [start, place] of places)
      if (place.items === siblings && start >= lo && start < hi)
        runComments.push(start);
  return {
    primary: primary.span.start,
    extras: [...runItems, ...runComments]
      .sort((x, y) => x - y)
      .filter((start) => start !== primary.span.start),
  };
}

type CardPath = { items: readonly Item[]; holder: SelectableCard }[];

/**
 * listPathOf for any selectable card. A comment card's path is the path of
 * the list its card shows in, ending in the comment itself. That list's first
 * item has the same path above it, and an empty list's path is its
 * container's plus the list. A comment with no card, or no `places` to look
 * it up in, has no path, so a Shift click onto it starts over.
 */
function cardPathOf(
  script: ScriptNode,
  card: SelectableCard,
  places: ReadonlyMap<number, CommentCardPlace> | undefined,
): CardPath {
  if (card.kind !== "comment") return listPathOf(script, card);
  const place = places?.get(card.span.start);
  if (!place) return [];
  const above: CardPath =
    place.items.length > 0
      ? listPathOf(script, place.items[0]).slice(0, -1)
      : place.container
        ? listPathOf(script, place.container)
        : [];
  return [...above, { items: place.items, holder: card }];
}

function startOf(item: { span: Span }): number {
  return item.span.start;
}

/**
 * The cards a multi-card action acts on: duplicates removed, any card
 * inside another selected card dropped (its text goes with the outer one),
 * in source order. Spans are well nested (parser guarantee), so after
 * sorting by start, with the outer of two same-start spans first, a card is
 * inside an earlier one exactly when it is inside the last one kept.
 */
export function outermostInOrder<T extends { span: Span }>(
  nodes: readonly T[],
): T[] {
  const sorted = [...nodes].sort(
    (a, b) => a.span.start - b.span.start || b.span.end - a.span.end,
  );
  const out: T[] = [];
  for (const node of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      node.span.start >= last.span.start &&
      node.span.end <= last.span.end
    )
      continue;
    out.push(node);
  }
  return out;
}
