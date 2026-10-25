import * as monaco from "monaco-editor";
import { pendingAfterChange, wordLeft } from "./flashRule";

// The Code editor's confirmation flash (docs/name-lookup-design.md Sec.6):
// a short green tint on a word the person just typed, when it resolves to a
// real const.
//
// WHEN, in one sentence: when the caret leaves a word that was typed one
// character at a time. Watching the CARET rather than the text is what makes
// a space, Enter, punctuation and an arrow key all count the same way
// without a case each. Watching only single-character inserts is what
// keeps a paste, an undo, a file open and a Breakdown edit from flashing,
// since none of those arrive as one typed character (Sec.6.1, a flash
// confirms a keystroke, and twenty on a paste confirm nothing).
//
// Tab accepting a suggestion is the one other way in. The completion item
// carries FLASH_RANGE_COMMAND, which Monaco runs after inserting it.
//
// The rule itself is in flashRule.ts, which imports no Monaco so Vitest can
// load it. This file wires it to the editor's events and draws the tint.

/** Sec.6.2. Long enough to see at the edge of vision, short enough to stay out of the way of the next word. */
export const FLASH_MS = 700;

export const FLASH_RANGE_COMMAND = "aoe2rms.resolveFlash.range";

export interface ResolveFlashOptions {
  /** CSS class with the animation, from CodePane.module.css. */
  className: string;
  /** Read on every flash, so turning the setting off takes effect at once. */
  isEnabled: () => boolean;
  /** Whether the word starting at `start` in the model's text is a const slot name that resolves. */
  resolves: (text: string, start: number, word: string) => boolean;
}

interface Flasher {
  flashRange: (start: number, length: number) => void;
}

// One editor exists at a time (CodePane), and the global command needs to
// reach it. Same module-level bridge as diagnosticActions.ts.
let active: Flasher | null = null;
let commandRegistered = false;

function registerFlashCommand(): void {
  if (commandRegistered) return;
  commandRegistered = true;
  monaco.editor.registerCommand(
    FLASH_RANGE_COMMAND,
    (_accessor, start: unknown, length: unknown) => {
      if (typeof start === "number" && typeof length === "number")
        active?.flashRange(start, length);
    },
  );
}

export function attachResolveFlash(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: ResolveFlashOptions,
): monaco.IDisposable {
  registerFlashCommand();
  const collection = editor.createDecorationsCollection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Offset of the word being typed, or null. A plain variable inside this
  // closure, not React state: nothing renders from it, and it changes on
  // every keystroke.
  let pending: number | null = null;

  const flashRange = (start: number, length: number) => {
    if (!options.isEnabled()) return;
    const model = editor.getModel();
    if (!model) return;
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(start + length);
    // Clearing first makes Monaco render a fresh span, which is what
    // restarts the CSS animation when the same word flashes again.
    collection.clear();
    collection.set([
      {
        range: new monaco.Range(
          from.lineNumber,
          from.column,
          to.lineNumber,
          to.column,
        ),
        options: { inlineClassName: options.className },
      },
    ]);
    clearTimeout(timer);
    timer = setTimeout(() => collection.clear(), FLASH_MS);
  };

  const flasher: Flasher = { flashRange };
  active = flasher;

  const onContent = editor.onDidChangeModelContent((e) => {
    const plain =
      !e.isUndoing && !e.isRedoing && !e.isFlush && e.changes.length === 1;
    const model = editor.getModel();
    pending =
      plain && model
        ? pendingAfterChange(pending, e.changes[0], model.getValue())
        : null;
  });

  const onCursor = editor.onDidChangeCursorPosition((e) => {
    if (pending === null) return;
    const model = editor.getModel();
    if (!model) return;
    const text = model.getValue();
    const left = wordLeft(text, pending, model.getOffsetAt(e.position));
    if (left === null) return; // still inside the word
    const start = pending;
    pending = null;
    if (left !== "" && options.resolves(text, start, left))
      flashRange(start, left.length);
  });

  return {
    dispose() {
      onContent.dispose();
      onCursor.dispose();
      clearTimeout(timer);
      collection.clear();
      if (active === flasher) active = null;
    },
  };
}
