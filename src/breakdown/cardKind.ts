// Pure AST-node-kind -> card-kind mapping, docs/breakdown-design.md Sec.3.2's
// table. Kept free of React so it's usable both by BlockList (rendering)
// and by a plain-Node coverage test (every Item from every corpus file
// maps to exactly one card-kind, mirroring the parser's own coverage
// gate spirit) without pulling in jsdom/React.
import type {
  CommandNode,
  DirectiveNode,
  IfNode,
  Item,
  RandomNode,
} from "../parser/types";

export type CardKind =
  | "command" // CommandNode -> CommandCard
  | "strayAttribute" // AttributeNode at statement level -> CommandCard styled as stray + RMS0207 badge
  | "directive" // DirectiveNode -> DirectiveCard
  | "conditional" // IfNode -> ConditionalCard
  | "random" // RandomNode -> RandomCard
  | "sharedBlock" // OrphanBlockNode -> read-only shared-block card (rendered via RawCard shell)
  | "raw"; // RawNode -> RawCard

/** Total mapping (docs/breakdown-design.md Sec.3.2): every Item kind maps to exactly one card kind. */
export function cardKindForItem(item: Item): CardKind {
  switch (item.kind) {
    case "command":
      return "command";
    case "attribute":
      return "strayAttribute";
    case "directive":
      return "directive";
    case "if":
      return "conditional";
    case "random":
      return "random";
    case "orphanBlock":
      return "sharedBlock";
    case "raw":
      return "raw";
    default: {
      // Exhaustiveness guard, if a new Item kind is ever added, this is a
      // compile error (never expression), not a silent drop (goal #3).
      const exhaustive: never = item;
      throw new Error(`Unhandled Item kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Which card kinds carry their own Delete button today (CommandCard,
 * DirectiveCard, ConditionalCard, RandomCard), the set the breakdown
 * delete-selected-card hotkey (BreakdownPane.tsx) is allowed to act on.
 * `strayAttribute`, `sharedBlock` and `raw` are deliberately excluded: none
 * of their cards has ever offered a delete action (a stray attribute wants
 * `RMS0207`'s fix instead, a shared block is read-only, and a raw node
 * offers only the suggestion Fix button), so a hotkey silently doing
 * something the UI has never offered would be a new capability in
 * disguise, not a shortcut for an existing one.
 */
export function canDeleteItem(
  item: Item,
): item is CommandNode | DirectiveNode | IfNode | RandomNode {
  const kind = cardKindForItem(item);
  return (
    kind === "command" ||
    kind === "directive" ||
    kind === "conditional" ||
    kind === "random"
  );
}

/**
 * Which cards a person can move (drag, Alt+arrows, the card menu) or
 * duplicate. The same four kinds as canDeleteItem, and for the same reason
 * (2026-09-18): a card whose span is only an approximation of a construct
 * the parser could not shape (a stray attribute, a shared block, a raw
 * node) can have its text moved without its meaning following, so those
 * stay where they are and get fixed in the Code tab. Kept as its own name
 * so a future divergence between the two sets is one edit here rather than
 * a hunt for every `canDeleteItem` that meant "rearrange".
 */
export function canRearrangeItem(
  item: Item,
): item is CommandNode | DirectiveNode | IfNode | RandomNode {
  return canDeleteItem(item);
}
