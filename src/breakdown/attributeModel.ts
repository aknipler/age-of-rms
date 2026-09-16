// Pure logic for the Sec.3.3 "all-attributes model", kept free of React so
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
   * `def.repeatable`. Presence in the source is ground truth, the flag
   * only gates whether "add another" is offered (docs/breakdown-design.md
   * Sec.3.3, rev 2's load-bearing fix).
   */
  instances: AttributeNode[];
  /** A bare flag (no arguments, or a single bare `flag`-typed arg). */
  isFlag: boolean;
}

export interface CommandBreakdown {
  /** One entry per def.attributes[] name, alphabetical (display order, not source order). */
  knownSlots: AttributeSlot[];
  /**
   * Everything else in the block, source order: known-but-unlisted
   * attributes (resolved def, not in def.attributes[], normal typed row,
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
 * have no slots to derive. Callers should fall back to generic rendering.
 */
export function buildCommandBreakdown(command: CommandNode, lang: LanguageIndex): CommandBreakdown {
  const attributeNames = command.def?.attributes ?? [];
  const listedNames = new Set(attributeNames);
  const sortedNames = [...attributeNames].sort((a, b) => a.localeCompare(b));
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
  for (const name of sortedNames) {
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

/** The Breakdown "attribute order" setting's four modes, see BreakdownSettingsContext.tsx. */
export type AttributeOrderMode = "required" | "alphabetical" | "fileOrder" | "custom";

/**
 * text < number < boolean, matching ValueEditor.tsx's own split (numberInput
 * for integer/percent, textInput for everything else) with isFlag pulled out
 * first since a bare flag never reaches ValueEditor at all.
 */
function typeBucket(slot: AttributeSlot): 0 | 1 | 2 {
  if (slot.isFlag) return 2;
  const firstType = slot.def.arguments?.[0]?.type;
  return firstType === "integer" || firstType === "percent" ? 1 : 0;
}

/** required (def.required, curated data) outranks every type bucket; ties break alphabetically. */
function requiredFirstGroup(slot: AttributeSlot): number {
  return slot.def.required ? 0 : typeBucket(slot) + 1;
}

function compareRequiredFirst(a: AttributeSlot, b: AttributeSlot): number {
  const diff = requiredFirstGroup(a) - requiredFirstGroup(b);
  return diff !== 0 ? diff : a.name.localeCompare(b.name);
}

/**
 * Present slots (>=1 instance) sort by where their first instance appears in
 * the source; absent slots (the faint add-rows) have no source position, so
 * they're appended after every present slot, ordered among themselves the
 * same way "required" mode orders everything.
 */
function compareFileOrder(a: AttributeSlot, b: AttributeSlot): number {
  const aPresent = a.instances.length > 0;
  const bPresent = b.instances.length > 0;
  if (aPresent && bPresent) return a.instances[0].span.start - b.instances[0].span.start;
  if (aPresent !== bPresent) return aPresent ? -1 : 1;
  return compareRequiredFirst(a, b);
}

/**
 * Orders a command's knownSlots per the Breakdown attribute-order setting.
 * `customOrder` is this command's own saved slot-name order (set via the
 * "Set as default" button in CommandCard, when mode is "custom"); a slot
 * that's since appeared in `attributes[]` but isn't in `customOrder` yet
 * (a language.json edit, not a drag) falls back to "required" order for
 * just that slot rather than disappearing or crashing.
 */
export function sortKnownSlots(
  slots: readonly AttributeSlot[],
  mode: AttributeOrderMode,
  customOrder?: readonly string[],
): AttributeSlot[] {
  const sorted = [...slots];
  if (mode === "alphabetical") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === "fileOrder") {
    sorted.sort(compareFileOrder);
  } else if (mode === "custom" && customOrder && customOrder.length > 0) {
    const rank = new Map(customOrder.map((name, i) => [name, i]));
    sorted.sort((a, b) => {
      const ra = rank.get(a.name);
      const rb = rank.get(b.name);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return compareRequiredFirst(a, b);
    });
  } else {
    sorted.sort(compareRequiredFirst);
  }
  return sorted;
}

/**
 * Splits an already-ordered slot list into the compact two-column layout's
 * two columns, preserving relative order within each (CommandCard.tsx
 * renders left/right as two independent stacks, so this is the only place
 * that decides membership). `rightColumnNames`, when given, is this
 * command's saved custom column arrangement (BreakdownSettingsContext's
 * CustomAttributeOrder.rightColumn) — set only in attributeOrderMode
 * "custom", where a drag is free to move any slot into either column.
 * Every other mode has no drag and always uses the default split below.
 */
export function splitAttributeColumns(
  slots: readonly AttributeSlot[],
  rightColumnNames?: readonly string[],
): { left: AttributeSlot[]; right: AttributeSlot[] } {
  const rightSet = rightColumnNames ? new Set(rightColumnNames) : null;
  const isRight = (slot: AttributeSlot) => (rightSet ? rightSet.has(slot.name) : slot.isFlag);
  return {
    left: slots.filter((slot) => !isRight(slot)),
    right: slots.filter((slot) => isRight(slot)),
  };
}
