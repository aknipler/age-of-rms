import { useEffect, useState, type InputHTMLAttributes } from "react";

// A number box that can be emptied while typing.
//
// A controlled `<input type="number">` whose value is the number itself can
// never be cleared. Deleting the last digit gives `""`, `Number("")` is 0, so
// the box is handed 0 and shows it, and a check that ignores the empty text
// instead hands back the old number. Either way the field refills under the
// cursor. The fix is a *draft*, the text as typed, held in local state apart
// from the committed number. The draft may be empty or out of range for a
// moment. The committed number never is.
//
// A keystroke that leaves a whole, in range value commits it at once, so
// live consumers (a preview seed) update as before. Anything else waits for
// blur or Enter, where an out of range value is clamped and an empty or
// unreadable one goes back to the last committed value. Clamping on every
// keystroke instead would commit 5 the moment "1" is typed on the way to
// "12" in a box whose minimum is 5.

type PassThrough = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur" | "min" | "max"
>;

export interface DraftNumberInputProps extends PassThrough {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  /** Truncate to a whole number. Default true. */
  integer?: boolean;
}

export function DraftNumberInput({
  value,
  onCommit,
  min,
  max,
  integer = true,
  onKeyDown,
  ...rest
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  // Follows the committed value from outside (a reroll, a loaded setting),
  // except while the user is typing, when it would overwrite their draft.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const read = (text: string): number | undefined => {
    if (text.trim() === "") return undefined;
    const n = Number(text);
    if (!Number.isFinite(n)) return undefined;
    return integer ? Math.trunc(n) : n;
  };
  const inRange = (n: number) =>
    (min === undefined || n >= min) && (max === undefined || n <= max);

  const finish = () => {
    setEditing(false);
    const n = read(draft);
    if (n === undefined) {
      setDraft(String(value));
      return;
    }
    let clamped = n;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setEditing(true);
        setDraft(text);
        const n = read(text);
        if (n !== undefined && inRange(n) && n !== value) onCommit(n);
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish();
        onKeyDown?.(event);
      }}
    />
  );
}
