// Hide Unused Attributes (docs/breakdown-design.md Sec.3.3.1, amended
// 2026-09-17 from beta feedback). Pure rules over AttributeSlots, kept out
// of CommandCard so they can be tested without rendering a card.
//
// The rule that matters most is the SNAPSHOT. Which slots a card shows is
// decided when the card opens (or when the switch is turned on while it
// is open), not on every render: unticking a flag must not make its row
// vanish under the pointer. The snapshot is the set of names present at
// that moment plus the exclusion list. Anything present NOW is always
// shown too, so an attribute added through the search bar appears at
// once, and anything the snapshot named stays until the card closes.

import type { AttributeSlot } from "./attributeModel";
import { CONSTANT_ARGUMENT_TYPES } from "../parser/language";
import type { AttributeTarget, EditIntent } from "./patch/intents";

/** The names to keep showing for the life of one card opening. */
export function snapshotVisibleNames(
  slots: readonly AttributeSlot[],
  alwaysShow: readonly string[],
): ReadonlySet<string> {
  const names = new Set<string>(alwaysShow);
  for (const slot of slots) if (slot.instances.length > 0) names.add(slot.name);
  return names;
}

/** Splits the ordered slots into the ones to render and the ones the search bar offers. */
export function partitionSlots(
  slots: readonly AttributeSlot[],
  snapshot: ReadonlySet<string>,
): { shown: AttributeSlot[]; hidden: AttributeSlot[] } {
  const shown: AttributeSlot[] = [];
  const hidden: AttributeSlot[] = [];
  for (const slot of slots) {
    if (slot.instances.length > 0 || snapshot.has(slot.name)) shown.push(slot);
    else hidden.push(slot);
  }
  return { shown, hidden };
}

/**
 * The intent that adds an absent slot, shared by AttributeRow's "click to
 * add" row and the Hide Unused search bar so both insert the same thing.
 * Flags toggle on. Constant-typed first arguments insert bare (the Sec.4.3
 * amendment). Everything else carries its default when it has one.
 */
export function addAbsentSlotIntent(
  slot: AttributeSlot,
  target: AttributeTarget,
): EditIntent {
  if (slot.isFlag)
    return { kind: "toggleFlag", target, name: slot.name, on: true };
  const first = slot.def.arguments?.[0];
  if (first && CONSTANT_ARGUMENT_TYPES.has(first.type))
    return { kind: "addAttribute", target, name: slot.name, bare: true };
  const value = first?.default !== undefined ? [first.default] : undefined;
  return { kind: "addAttribute", target, name: slot.name, value };
}

/** Case-insensitive substring match on name or description, for the search bar. */
export function filterSlots(
  slots: readonly AttributeSlot[],
  query: string,
): AttributeSlot[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...slots];
  return slots.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.def.description ?? "").toLowerCase().includes(q),
  );
}
