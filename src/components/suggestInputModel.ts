// The text half of RmsSuggestInput (docs/name-lookup-design.md Sec.4.2), pure
// so Vitest can check it without a DOM. The component owns the events, this
// owns the string arithmetic.

/** A name character. RMS names are letters, digits and underscores, and the numbers around them (`-5`, `(A+5)`) are not part of one. */
const NAME_CHAR = /[A-Za-z0-9_]/;

export interface WordAtCaret {
  /** Start of the name run the caret touches, or the caret itself when it touches none. */
  start: number;
  /** End of that run. */
  end: number;
  /** The part of the run before the caret, what the suggestions are matched against. */
  query: string;
}

/**
 * The name the caret is in or touching. The whole run is replaced on accept
 * (`GR|ASS` becomes `GRASS`, not `GRASSASS`) while only the part before the
 * caret is searched, which is how a completion list in a code editor treats
 * a word it is opened in the middle of.
 */
export function wordAtCaret(value: string, caret: number): WordAtCaret {
  const at = Math.max(0, Math.min(caret, value.length));
  let start = at;
  while (start > 0 && NAME_CHAR.test(value[start - 1])) start--;
  let end = at;
  while (end < value.length && NAME_CHAR.test(value[end])) end++;
  return { start, end, query: value.slice(start, at) };
}

/** `value` with the run at `word` replaced by `name`, and where the caret goes. */
export function replaceWord(
  value: string,
  word: Pick<WordAtCaret, "start" | "end">,
  name: string,
): { value: string; caret: number } {
  return {
    value: value.slice(0, word.start) + name + value.slice(word.end),
    caret: word.start + name.length,
  };
}
