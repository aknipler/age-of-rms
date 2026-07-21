// Pure logic for the §3.3 "all-attributes model" — kept free of React so
// it's testable the same way as the parser's own pure modules, and so
// CommandCard just renders what this computes.
import type { AttributeNode, CommandNode, Item } from "../parser/types";
import type { AttributeDef, LanguageIndex } from "../parser/language";

export interface AttributeSlot {
  name: string;
  def: AttributeDef;
  /**
   * All AttributeNodes present in the block for this name, in source
   * order. 0 = absent (faint add-row), 1 = present-once (filled row),
   * 2+ = the ground-truth rule: always a list, regardless of
   * `def.repeatable` — presence in the source is ground truth, the flag
   * only gates whether "add another" is offered (docs/breakdown-design.md
   * §3.3, rev 2's load-bearing fix).
   */
  instances: AttributeNode[];
  /** A bare flag (no arguments, or a single bare `flag`-typed arg). */
  isFlag: boolean;
}

export interface CommandBreakdown {
  /** One entry per def.attributes[] name, in that order (display order, not source order). */
  knownSlots: AttributeSlot[];
  /**
   * Everything else in the block, source order: known-but-unlisted
   * attributes (resolved def, not in def.attributes[] — normal typed row,
   * no badge), and non-attribute items (nested conditionals, directives,
   * raw runs, wrong-context commands).
   */
  otherContents: Item[];
}

function isFlagDef(def: AttributeDef): boolean {
  if (!def.arguments || def.arguments.length === 0) return true;
  return def.arguments.length === 1 && def.arguments[0].type === "flag";
}

/**
 * Builds the all-attributes breakdown for a command with a resolved
 * block-kind def and a block. Commands with no def (unknown, block-less)
 * have no slots to derive — callers should fall back to generic rendering.
 */
export function buildCommandBreakdown(command: CommandNode, lang: LanguageIndex): CommandBreakdown {
  const attributeNames = command.def?.attributes ?? [];
  const listedNames = new Set(attributeNames);
  const items = command.block?.items ?? [];

  const instancesByName = new Map<string, AttributeNode[]>();
  const other: Item[] = [];

  for (const it of items) {
    if (it.kind === "attribute" && it.def) {
      const arr = instancesByName.get(it.def.name) ?? [];
      arr.push(it);
      instancesByName.set(it.def.name, arr);
    } else {
      other.push(it);
    }
  }

  const knownSlots: AttributeSlot[] = [];
  for (const name of attributeNames) {
    const def = lang.attributesByName.get(name);
    if (!def) continue; // defensive: def.attributes[] referencing an unknown name shouldn't happen (validate:reference catches it)
    knownSlots.push({ name, def, instances: instancesByName.get(name) ?? [], isFlag: isFlagDef(def) });
  }

  const otherContents: Item[] = [...other];
  for (const [name, nodes] of instancesByName) {
    if (!listedNames.has(name)) otherContents.push(...nodes);
  }
  otherContents.sort((a, b) => a.span.start - b.span.start);

  return { knownSlots, otherContents };
}
