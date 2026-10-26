import * as monaco from "monaco-editor";

// Two light bulbs say "this has quick fixes", and both stay on purpose.
//
// The gutter bulb sits between the line number and the start of the line,
// where other editors put theirs. It follows the caret's LINE. It shows while
// the caret is anywhere on a line holding a word with offers, so moving off
// the word does not make it vanish. It is a line decoration, Monaco's public
// tool for "a small mark in the margin of one line", and a click on it is
// read through `onMouseUp`, since a decoration has no click handler of its
// own.
//
// The word bulb is a content widget above the word the caret is in or
// touching. It shows only while the caret is on that word, so it points at
// exactly what is being typed.
//
// Monaco's own bulb is switched off (CodePane's `lightbulb.enabled: off`)
// because it sits at the start of the line with no option to move it.
//
// Clicking either one runs Monaco's own `editor.action.quickFix`, so the
// menu, the keyboard handling and the actions themselves are the built-in
// ones. The gutter bulb first puts the caret on the first word with offers.
// Only the icons are ours.
//
// HELPTIP EXCEPTION. The icons are drawn inside Monaco's gutter and content
// layer, where a React HelpTip cannot wrap them. The menu they open names
// each fix.

export interface OfferBulbOptions {
  /** CSS class of the gutter bulb, from CodePane.module.css. */
  className: string;
  /** CSS class of the bulb above the word. */
  wordClassName: string;
  /** Offset where the word the caret is in or touching begins, if it has offers. */
  wordAtCaret: (text: string, caret: number) => number | null;
  /** Offset where the first word with offers on the line begins, else null. */
  wordWithOffers: (
    text: string,
    lineStart: number,
    lineEnd: number,
  ) => number | null;
}

export interface OfferBulb extends monaco.IDisposable {
  /** Re-reads the caret's line, for a new parse that may have changed the answer. */
  refresh: () => void;
}

export function attachOfferBulb(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: OfferBulbOptions,
): OfferBulb {
  const decorations = editor.createDecorationsCollection();
  // The line the bulb is on and the word it stands for, null while hidden.
  let shown: { line: number; wordStart: number } | null = null;

  // Where the word bulb sits, null while hidden. A content widget reads its
  // position through `getPosition`, so changing `at` and then calling
  // `layoutContentWidget` moves it.
  let at: monaco.IPosition | null = null;
  const node = document.createElement("span");
  node.className = `codicon codicon-lightbulb ${options.wordClassName}`;
  // Mouse down with the default prevented, so the editor keeps its focus and
  // its caret while the menu opens.
  node.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void editor.getAction("editor.action.quickFix")?.run();
  });
  const widget: monaco.editor.IContentWidget = {
    getId: () => "aoe2rms.offerBulbWord",
    getDomNode: () => node,
    getPosition: () =>
      at === null
        ? null
        : {
            position: at,
            preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
          },
  };
  editor.addContentWidget(widget);

  const moveWordBulb = (next: monaco.IPosition | null) => {
    if (next?.lineNumber === at?.lineNumber && next?.column === at?.column)
      return;
    at = next;
    editor.layoutContentWidget(widget);
  };

  const hide = () => {
    shown = null;
    decorations.clear();
    moveWordBulb(null);
  };

  const refresh = () => {
    const model = editor.getModel();
    const caret = editor.getPosition();
    if (!model || !caret) return hide();
    const text = model.getValue();
    const wordAt = options.wordAtCaret(text, model.getOffsetAt(caret));
    moveWordBulb(wordAt === null ? null : model.getPositionAt(wordAt));
    const lineStart = model.getOffsetAt({
      lineNumber: caret.lineNumber,
      column: 1,
    });
    const lineEnd = model.getOffsetAt({
      lineNumber: caret.lineNumber,
      column: model.getLineMaxColumn(caret.lineNumber),
    });
    const wordStart = options.wordWithOffers(text, lineStart, lineEnd);
    if (wordStart === null) {
      shown = null;
      decorations.clear();
      return;
    }
    if (shown?.line === caret.lineNumber && shown.wordStart === wordStart)
      return;
    shown = { line: caret.lineNumber, wordStart };
    decorations.set([
      {
        range: new monaco.Range(caret.lineNumber, 1, caret.lineNumber, 1),
        options: {
          linesDecorationsClassName: `codicon codicon-lightbulb ${options.className}`,
        },
      },
    ]);
  };

  const onCursor = editor.onDidChangeCursorPosition(refresh);
  // Typing makes the last parse stale, and its offers with it. Hide at once
  // and let the next parse bring the bulb back.
  const onContent = editor.onDidChangeModelContent(hide);
  // Mouse up and not down: Monaco selects the clicked line on mouse down, so
  // moving the caret before it would be undone a moment later.
  const onMouseUp = editor.onMouseUp((event) => {
    if (
      shown === null ||
      event.target.type !==
        monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
      event.target.position?.lineNumber !== shown.line
    )
      return;
    const model = editor.getModel();
    if (!model) return;
    const word = shown.wordStart;
    // The caret goes to the word's end, where the offers are asked for.
    const text = model.getValue();
    let end = word;
    while (end < text.length && /[A-Za-z0-9_]/.test(text.charAt(end))) end++;
    editor.setPosition(model.getPositionAt(end));
    editor.focus();
    void editor.getAction("editor.action.quickFix")?.run();
  });

  return {
    refresh,
    dispose() {
      onCursor.dispose();
      onContent.dispose();
      onMouseUp.dispose();
      decorations.clear();
      editor.removeContentWidget(widget);
    },
  };
}
