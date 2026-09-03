import type * as Monaco from "monaco-editor";

export type EditMenuAction = "cut" | "copy" | "paste" | "find" | "selectAll" | "findReplace" | "toggleComment";

// Monaco's own built-in action ids. Going through `getAction(...).run()`
// rather than `document.execCommand` is what makes Cut/Copy/Paste behave
// exactly like pressing Ctrl+X/C/V with the editor focused: Monaco routes
// them through its own hidden-textarea clipboard handling (the same path a
// keyboard shortcut takes), which is the thing a webview actually grants
// clipboard access to on a plain button click.
//
// "toggleComment" -> `commentLine`: the aoe2-rms language only declares a
// block comment (`/* */`, aoe2RmsLanguage.ts's `setLanguageConfiguration`),
// no line-comment token, and Monaco's own `LineCommentCommand` falls back to
// wrapping the selected lines in the block-comment tokens when no
// line-comment string is configured, so this still does the right thing
// rather than silently no-op-ing.
const ACTION_IDS: Record<EditMenuAction, string> = {
  cut: "editor.action.clipboardCutAction",
  copy: "editor.action.clipboardCopyAction",
  paste: "editor.action.clipboardPasteAction",
  find: "actions.find",
  selectAll: "editor.action.selectAll",
  findReplace: "editor.action.startFindReplaceAction",
  toggleComment: "editor.action.commentLine",
};

/** Focuses the editor (so the action has something to act on) and runs it. */
export function runEditMenuAction(editor: Monaco.editor.IStandaloneCodeEditor, action: EditMenuAction): void {
  editor.focus();
  void editor.getAction(ACTION_IDS[action])?.run();
}
