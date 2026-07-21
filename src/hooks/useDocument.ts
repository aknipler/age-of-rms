import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { UnsavedAction, UnsavedChoice } from "../components/UnsavedChangesDialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as monaco from "monaco-editor";

const RMS_FILTERS = [{ name: "AoE2 Random Map Script", extensions: ["rms"] }];

// docs/breakdown-design.md §6.4 — the persistent Monaco ITextModel is the
// authoritative document buffer, created ONCE at module scope (not inside
// the hook) so React 18 StrictMode's double-invoke of component bodies/lazy
// initializers can never try to create a second model at the same URI
// (Monaco throws if you do). `main.tsx` already registers the "aoe2-rms"
// language + self-hosts monaco (src/editor/monacoSetup.ts) before this
// module is ever imported, and `loader.config({ monaco })` there points
// @monaco-editor/react's internal loader at this exact same `monaco-editor`
// module instance — so a model created here via the real `monaco-editor`
// import IS visible to <Editor path=... keepCurrentModel /> in CodePane.tsx;
// there is no async race to coordinate.
export const DOCUMENT_MODEL_PATH = "inmemory://model/document.rms";
const documentModel = monaco.editor.createModel("", "aoe2-rms", monaco.Uri.parse(DOCUMENT_MODEL_PATH));

/** Exposed so CodePane can bind <Editor> to this exact model (§6.4) and so Breakdown's applyEdit glue can push edits onto it. */
export function getDocumentModel(): monaco.editor.ITextModel {
  return documentModel;
}

// Why file access happens on the Rust side, in brief: the webview that
// renders our React UI has no filesystem access of its own — that's a
// deliberate browser-style sandbox. The dialog/fs *plugins* we use here
// are a thin JS wrapper around Tauri "commands": each call
// (open/save/readTextFile/writeTextFile) is serialized, sent over IPC to
// the Rust process, executed there (where real OS file access lives), and
// the result is sent back. `capabilities/default.json` is the allowlist
// that says which of those commands, on which paths, this window is
// permitted to invoke — nothing in JS can read/write a file the
// capability doesn't cover, no matter what the code says.
export function useDocument() {
  const [filePath, setFilePath] = useState<string | null>(null);
  // `content` is now a DERIVED MIRROR of documentModel's text (§6.4),
  // updated via onDidChangeContent below — not the source of truth itself.
  const [content, setContentState] = useState(() => documentModel.getValue());
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Dirty is "model version != last-saved version" (§6.4's suggested
  // cleaner signal than string compare) rather than comparing strings —
  // it also means an undo back to the saved state correctly clears dirty,
  // which a string-equality check would have gotten right anyway but this
  // is the idiom Monaco itself uses (e.g. VS Code's own dirty tracking).
  const savedVersionIdRef = useRef(documentModel.getAlternativeVersionId());

  // The close-request listener below is registered once but needs the
  // *current* isDirty/filePath/content on every close attempt, not
  // whatever they were when the listener was created — reading state
  // directly in that closure would capture stale values ("stale
  // closure"), so we mirror state into refs and read the refs instead.
  const isDirtyRef = useRef(isDirty);
  const filePathRef = useRef(filePath);
  isDirtyRef.current = isDirty;
  filePathRef.current = filePath;

  // --- Unsaved-changes prompt -------------------------------------------
  //
  // Both the close guard and Open need to *wait* for the user to pick one of
  // three outcomes. React can't "await a component", so we bridge the two
  // worlds with a Promise: `askUnsaved(action)` renders the dialog (by
  // setting state) and returns a Promise that stays pending until the dialog
  // calls `resolveUnsavedChoice(...)` with the user's answer.
  //
  // The resolver lives in a ref, not state, because it's plumbing rather
  // than something the UI renders — storing it in state would trigger an
  // extra render for no visual reason. The *action* IS state, because it
  // decides both whether the dialog shows and what its buttons say.
  const [unsavedAction, setUnsavedAction] = useState<UnsavedAction | null>(null);
  const unsavedResolverRef = useRef<((choice: UnsavedChoice) => void) | null>(null);

  const askUnsaved = useCallback(
    (action: UnsavedAction) =>
      new Promise<UnsavedChoice>((resolve) => {
        unsavedResolverRef.current = resolve;
        setUnsavedAction(action);
      }),
    [],
  );

  const resolveUnsavedChoice = useCallback((choice: UnsavedChoice) => {
    setUnsavedAction(null);
    const resolve = unsavedResolverRef.current;
    unsavedResolverRef.current = null;
    resolve?.(choice);
  }, []);

  // Mirror the model's text into React state on every change, whichever
  // side made it — Code-tab typing, Breakdown's pushEditOperations, or
  // undo/redo. This is the "content becomes a derived mirror via
  // onDidChangeContent" piece of §6.4.
  useEffect(() => {
    const subscription = documentModel.onDidChangeContent(() => {
      setContentState(documentModel.getValue());
      setIsDirty(documentModel.getAlternativeVersionId() !== savedVersionIdRef.current);
    });
    return () => subscription.dispose();
  }, []);

  const writeToPath = useCallback(async (path: string) => {
    await writeTextFile(path, documentModel.getValue());
    savedVersionIdRef.current = documentModel.getAlternativeVersionId();
    setFilePath(path);
    setIsDirty(false);
    setLastSavedAt(new Date());
  }, []);

  /**
   * The single unsaved-work guard, shared by Open and the window-close
   * handler — the two places that would otherwise silently discard changes.
   *
   * Returns `true` when it's safe to proceed (nothing was dirty, the save
   * succeeded, or the user chose to discard) and `false` when the user
   * backed out. Callers read as `if (!(await ensureSavedBefore(x))) return;`.
   *
   * Note there are TWO ways to end up cancelling: choosing Cancel in our
   * dialog, and cancelling the native Save As picker afterwards. Both must
   * abandon the whole operation — a cancelled Save As that still closed the
   * window would be the exact data-loss bug this guard exists to prevent.
   */
  const ensureSavedBefore = useCallback(
    async (action: UnsavedAction): Promise<boolean> => {
      if (!isDirtyRef.current) return true;

      const choice = await askUnsaved(action);
      if (choice === "cancel") return false;
      if (choice === "discard") return true;

      if (!filePathRef.current) {
        const target = await save({ filters: RMS_FILTERS });
        if (!target) return false; // backed out of the Save As picker
        await writeToPath(target);
      } else {
        await writeToPath(filePathRef.current);
      }
      return true;
    },
    [askUnsaved, writeToPath],
  );

  const openFile = useCallback(async () => {
    // Guard the *current* document before replacing it. Prompt first, before
    // the file picker: if the answer is Cancel there's no reason to have made
    // the user browse for a file, and "Save and Open" wants the save done
    // before we touch the model.
    if (!(await ensureSavedBefore("open"))) return;

    const selected = await open({ multiple: false, filters: RMS_FILTERS });
    if (!selected) return;
    const text = await readTextFile(selected);
    // setValue (not pushEditOperations) deliberately: opening a different
    // file is a new document buffer, so its undo history should NOT carry
    // over from whatever was previously open — this is the one place we
    // want Monaco's undo stack reset, not preserved.
    documentModel.setValue(text);
    savedVersionIdRef.current = documentModel.getAlternativeVersionId();
    setFilePath(selected);
    setIsDirty(false);
    setLastSavedAt(null);
  }, [ensureSavedBefore]);

  const saveFileAs = useCallback(async () => {
    const target = await save({ filters: RMS_FILTERS, defaultPath: filePath ?? undefined });
    if (!target) return;
    await writeToPath(target);
  }, [filePath, writeToPath]);

  const saveFile = useCallback(async () => {
    if (!filePath) {
      await saveFileAs();
      return;
    }
    await writeToPath(filePath);
  }, [filePath, saveFileAs, writeToPath]);

  // Guard window close when there are unsaved changes.
  //
  // React 18 StrictMode runs effects twice in dev (mount → cleanup →
  // mount) specifically to catch bugs like the one that used to be here:
  // this listener is registered asynchronously (onCloseRequested returns
  // a Promise<UnlistenFn>), and the *first* mount's cleanup could fire
  // before that promise resolved — leaving `unlisten` still undefined, so
  // cleanup was a no-op and the first listener leaked. StrictMode's
  // second mount then added a second listener on top of it, so closing
  // the window fired two independent confirm dialogs and left things in
  // an inconsistent state. The `cancelled` flag below fixes the race: if
  // cleanup runs before registration resolves, we immediately unlisten
  // the moment it does resolve instead of leaving it dangling.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!isDirtyRef.current) return;
        event.preventDefault();

        // The same guard Open uses — a real 3-way choice via our own modal.
        // This used to be Tauri's native confirm(), which returns a boolean:
        // it cannot express three outcomes, and gives no way to tell an
        // explicit "No" from a dismissed dialog, so it had to be collapsed
        // to save-or-stay. Owning the markup fixes that, and every dismissal
        // path (X, Esc, backdrop) reports "cancel".
        //
        // Returning here simply leaves the window open — preventDefault()
        // above already stopped the close.
        if (!(await ensureSavedBefore("close"))) return;

        // destroy() closes without re-emitting closeRequested — calling
        // close() here would just trigger this same handler again.
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureSavedBefore]);

  const mapName = filePath ? fileNameFromPath(filePath) : "Untitled Map";

  // Applies a byte-level TextEdit (docs/breakdown-design.md §4.1's
  // TextEdit shape) to the shared document model via pushEditOperations,
  // which lands on Monaco's own undo/redo stack — the same stack Ctrl+Z
  // in the Code tab uses (§6.4). This is the one function Breakdown's
  // patch-application glue (src/breakdown/applyEdit.ts) needs from this
  // hook; it deliberately takes a structurally-typed edit rather than
  // importing src/breakdown/patch/intents.ts's TextEdit, so this hook
  // stays free of any dependency on the breakdown feature.
  const applyTextEdit = useCallback((edit: { start: number; end: number; newText: string }) => {
    const startPos = documentModel.getPositionAt(edit.start);
    const endPos = documentModel.getPositionAt(edit.end);
    const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
    documentModel.pushEditOperations(
      [],
      [{ range, text: edit.newText, forceMoveMarkers: true }],
      () => null,
    );
  }, []);

  // §6.4's "one undo stack" promise has a reachability gap: the model's
  // undo/redo stack is real and shared, but Ctrl+Z is normally a
  // keybinding the Monaco *editor instance* owns, and that instance only
  // exists while CodePane is mounted (the Code tab is active). Switch to
  // the Breakdown tab — CodePane unmounts, nothing is listening for
  // Ctrl+Z, and a Breakdown edit becomes unreachable to undo even though
  // the data is sitting right there on the shared model. Fix: a
  // window-level listener that calls the model's own undo()/redo()
  // directly, so it works with or without a mounted editor. When the
  // Monaco editor IS focused, its own binding already handles the
  // keystroke (and does it better — cursor/scroll restoration) — detect
  // that via closest(".monaco-editor") and step aside rather than
  // double-handling the same keystroke through two paths.
  useEffect(() => {
    function isInsideMonacoEditor(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && target.closest(".monaco-editor") !== null;
    }
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      if (isInsideMonacoEditor(document.activeElement)) return;
      event.preventDefault();
      if (isUndo) {
        void documentModel.undo();
      } else {
        void documentModel.redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    filePath,
    mapName,
    content,
    isDirty,
    lastSavedAt,
    openFile,
    saveFile,
    saveFileAs,
    applyTextEdit,
    /** Non-null while the unsaved-changes modal should be on screen; also selects its wording. */
    unsavedAction,
    /** Called by that modal with the user's choice; resolves the pending operation. */
    resolveUnsavedChoice,
  };
}

function fileNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/);
  const fileName = segments[segments.length - 1] ?? path;
  return fileName.replace(/\.rms$/i, "");
}
