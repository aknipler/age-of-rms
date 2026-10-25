// The resolve flash's timing rule (docs/name-lookup-design.md Sec.6.1),
// as two pure steps resolveFlash.ts calls from Monaco's content and cursor
// events. Kept free of Monaco so Vitest can load it.

/** The whitespace-delimited token that starts at `start`, RMS's own word rule. */
function wordAt(text: string, start: number): string {
  const rest = text.slice(start);
  const m = /^\S+/.exec(rest);
  return m ? m[0] : "";
}

/** Start of the whitespace-delimited token ending at `offset`. */
function wordStartBefore(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

/** One plain edit as Monaco reports it, with the offset it starts at and the text it inserts. */
export interface TypedChange {
  rangeOffset: number;
  text: string;
}

/**
 * The content half of the rule. Given where the word being typed started
 * (or null) and one plain edit (not an undo, redo, file load or multi-range
 * edit, which the caller turns into null itself), where the word being typed
 * starts now. `textAfter` is the model's text after the edit.
 */
export function pendingAfterChange(
  pending: number | null,
  change: TypedChange,
  textAfter: string,
): number | null {
  if (pending !== null && change.rangeOffset < pending) return null; // an edit before the word moved it
  if (change.text.length === 1 && /\S/.test(change.text))
    return wordStartBefore(textAfter, change.rangeOffset + 1);
  // A paste, or an accepted suggestion (its own command flashes).
  if (change.text.length > 1) return null;
  // A single whitespace character or a deletion leaves `pending` alone.
  // The cursor event that follows decides whether the word was left.
  return pending;
}

/**
 * The caret half of the rule. Null while `caret` is still inside (or at
 * either edge of) the word starting at `pending`; otherwise the word that
 * was left, "" when it was deleted.
 */
export function wordLeft(
  text: string,
  pending: number,
  caret: number,
): string | null {
  const word = wordAt(text, pending);
  if (word !== "" && caret >= pending && caret <= pending + word.length)
    return null;
  return word;
}
