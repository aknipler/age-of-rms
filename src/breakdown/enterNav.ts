// Enter moves forward through a group of fields (2026-10-23).
//
// A `#const` table and a repeatable attribute (replace_terrain and the like)
// are rows of fields with an add button under them. Inside one of those,
// Enter on a value field commits it and moves to the next field in reading
// order. From the last field it lands on the add button, where a second
// Enter adds a row. Everywhere else Enter keeps its old meaning, commit and
// stay. Tab is untouched, it moves through every focusable element the way
// the browser always does.
//
// The group is marked in the DOM rather than passed down as props. A
// ValueEditor has no idea which rows sit beside it, and threading "who is
// next" through AttributeRow, DirectiveCard and the table would couple them
// for one keystroke. The markers below are read only at the moment Enter is
// pressed.

/** On the element that holds the group (the `#const` table, a repeatable attribute's rows). */
export const ENTER_SCOPE = "data-enter-scope";
/** On every value input. Only those inside a scope take part. */
export const ENTER_FIELD = "data-enter-field";
/** On the group's add button, the last stop. */
export const ENTER_ADD = "data-enter-add";

/**
 * The scope's own stops in DOM order. A stop belongs to the nearest scope
 * around it, so a group nested inside another (a `#const` table inside a
 * branch inside a larger table) never leaks its fields into the outer one.
 */
export function enterStops(scope: Element): HTMLElement[] {
  return Array.from(
    scope.querySelectorAll<HTMLElement>(`[${ENTER_FIELD}], [${ENTER_ADD}]`),
  ).filter(
    (el) =>
      el.closest(`[${ENTER_SCOPE}]`) === scope &&
      !(el as HTMLInputElement | HTMLButtonElement).disabled,
  );
}

export interface EnterTarget {
  scope: Element;
  /** Position in enterStops(scope), which survives a re-render that replaces the elements. */
  index: number;
  el: HTMLElement;
  /** True for a value field, false for the add button. */
  isField: boolean;
}

/** Where Enter in `from` should go, or null when `from` is outside a group (Enter commits and stays). */
export function nextEnterTarget(from: HTMLElement): EnterTarget | null {
  const scope = from.closest(`[${ENTER_SCOPE}]`);
  if (!scope) return null;
  const stops = enterStops(scope);
  const i = stops.indexOf(from);
  if (i < 0 || i + 1 >= stops.length) return null;
  const el = stops[i + 1];
  return { scope, index: i + 1, el, isField: el.hasAttribute(ENTER_FIELD) };
}

/**
 * Finds the target again after a re-render. The commit that Enter made
 * changes the source, the reparse replaces every field whose offset moved,
 * and the element held in `target.el` may be gone by then. The scope itself
 * is keyed by an offset before the edit, so it survives, and the field's
 * position in it does not change.
 */
export function resolveEnterTarget(target: EnterTarget): HTMLElement | null {
  if (!target.scope.isConnected) return null;
  return enterStops(target.scope)[target.index] ?? null;
}
