// Pure AST-node-kind -> card-kind mapping, docs/breakdown-design.md §3.2's
// table. Kept free of React so it's usable both by BlockList (rendering)
// and by a plain-Node coverage test (every Item from every corpus file
// maps to exactly one card-kind, mirroring the parser's own coverage
// gate spirit) without pulling in jsdom/React.
import type { Item } from "../parser/types";

export type CardKind =
  | "command" // CommandNode -> CommandCard
  | "strayAttribute" // AttributeNode at statement level -> CommandCard styled as stray + RMS0207 badge
  | "directive" // DirectiveNode -> DirectiveCard
  | "conditional" // IfNode -> ConditionalCard
  | "random" // RandomNode -> RandomCard
  | "sharedBlock" // OrphanBlockNode -> read-only shared-block card (rendered via RawCard shell)
  | "raw"; // RawNode -> RawCard

/** Total mapping (docs/breakdown-design.md §3.2): every Item kind maps to exactly one card kind. */
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
      // Exhaustiveness guard — if a new Item kind is ever added, this is a
      // compile error (never expression), not a silent drop (goal #3).
      const exhaustive: never = item;
      throw new Error(`Unhandled Item kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
