import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { UnsavedAction, UnsavedChoice } from "../components/UnsavedChangesDialog";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dirname } from "@tauri-apps/api/path";
import { load } from "@tauri-apps/plugin-store";
import * as monaco from "monaco-editor";
import {
  APP_SETTINGS_STORE_FILE,
  findDeScriptsFolder,
  LAST_SCRIPT_FOLDER_KEY,
  type FolderProbe,
} from "../settings/scriptFolder";
import {
  buildScriptHeader,
  HEADER_SEPARATOR,
  refreshScriptHeader,
  type ScriptHeaderFields,
  type StampedHeader,
} from "./scriptHeader";

const RMS_FILTERS = [{ name: "AoE2 Random Map Script", extensions: ["rms"] }];

// The Tauri half of scriptFolder.ts's two filesystem questions. It is this
// object, and not the module, that can't run in Vitest, which is the whole
// reason the resolver takes it as a parameter.
const TAURI_PROBE: FolderProbe = { exists, readTextFile };

/**
 * Which folder the Open / Save As dialog should start in.
 *
 * `undefined` means "pass no `defaultPath`", which hands the choice back to
 * the Windows common dialog and its per-app MRU, the behaviour before this
 * existed, and still the right answer once neither of the two better ones is
 * available.
 *
 * The remembered folder is checked with `exists` rather than trusted: it is
 * persisted across runs, so it outlives the drive it was on. A `defaultPath`
 * pointing at a folder that has gone makes the dialog open somewhere
 * arbitrary, which looks like the app losing your place.
 */
async function dialogStartFolder(): Promise<string | undefined> {
  try {
    const store = await load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} });
    const remembered = await store.get<string>(LAST_SCRIPT_FOLDER_KEY);
    if (remembered && (await exists(remembered))) return remembered;
    return (await findDeScriptsFolder(TAURI_PROBE)) ?? undefined;
  } catch {
    // Every branch above is a nicety. A store that won't load or a probe that
    // throws must not be able to stop someone opening a file.
    return undefined;
  }
}

/**
 * Remember the folder a file was opened from or saved to, so the next dialog
 * starts there.
 *
 * Ours rather than the shell's MRU on purpose: the shell keys its MRU on the
 * executable, so it resets on a reinstall and differs between the dev build
 * and the installed one, which is exactly how the release ended up opening
 * on a folder from someone's development tree.
 */
async function rememberScriptFolder(filePath: string): Promise<void> {
  try {
    const store = await load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} });
    await store.set(LAST_SCRIPT_FOLDER_KEY, await dirname(filePath));
  } catch {
    // Same reasoning as above, failing to remember must never fail the save.
  }
}

// docs/breakdown-design.md Sec.6.4, the persistent Monaco ITextModel is the
// authoritative document buffer, created ONCE at module scope (not inside
// the hook) so React 18 StrictMode's double-invoke of component bodies/lazy
// initializers can never try to create a second model at the same URI
// (Monaco throws if you do). `main.tsx` already registers the "aoe2-rms"
// language + self-hosts monaco (src/editor/monacoSetup.ts) before this
// module is ever imported, and `loader.config({ monaco })` there points
// @monaco-editor/react's internal loader at this exact same `monaco-editor`
// module instance, so a model created here via the real `monaco-editor`
// import IS visible to <Editor path=... keepCurrentModel /> in CodePane.tsx;
// there is no async race to coordinate.
export const DOCUMENT_MODEL_PATH = "inmemory://model/document.rms";
const documentModel = monaco.editor.createModel("", "aoe2-rms", monaco.Uri.parse(DOCUMENT_MODEL_PATH));

/** Exposed so CodePane can bind <Editor> to this exact model (Sec.6.4) and so Breakdown's applyEdit glue can push edits onto it. */
export function getDocumentModel(): monaco.editor.ITextModel {
  return documentModel;
}

/**
 * Every call site below (the header stamp, a single Breakdown card action,
 * an Advanced Tools Apply covering N edits) is one discrete, semantically
 * atomic action, and each one must land as its OWN undo entry rather than
 * silently merging with whatever the model's undo stack last left open.
 *
 * Monaco's `pushEditOperations` APPENDS onto the previous undo entry
 * whenever that entry is still open (`SingleModelEditStackElement.
 * canAppend`, monaco-editor's `editStack.js`); the only thing that closes
 * one is `pushStackElement()`, which a real editor's Cursor controller
 * calls automatically while the user types, but that controller only
 * exists while CodePane is mounted. Nothing else in this app ever called
 * it, so every Breakdown action performed back-to-back (the Code tab never
 * in between) used to accumulate onto ONE growing entry until it happened
 * to fork fresh (e.g. right after an undo), and a single Ctrl+Z would then
 * revert the whole streak at once instead of just the last action.
 * Reported by a user as "the undo button sometimes undoes a lot of work."
 */
function pushOwnUndoEntry(operations: monaco.editor.IIdentifiedSingleEditOperation[]): void {
  documentModel.pushStackElement();
  documentModel.pushEditOperations([], operations, () => null);
}

/**
 * Replace a byte range of the shared model, on the model's own undo stack.
 *
 * Module scope, beside the model, because the header stamp is the one edit
 * the app makes on the user's behalf rather than at their request, and it has
 * to land on the same stack everything else does. An edit Ctrl+Z cannot
 * reach is worse than no edit at all.
 */
function replaceRanges(edits: readonly { start: number; end: number; newText: string }[]): void {
  if (edits.length === 0) return;
  const operations = edits.map((edit) => {
    const startPos = documentModel.getPositionAt(edit.start);
    const endPos = documentModel.getPositionAt(edit.end);
    return {
      range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
      text: edit.newText,
      forceMoveMarkers: true,
    };
  });
  // Offsets are in ORIGINAL coordinates and Monaco handles the ordering
  // itself, so the edits need no descending sort. That is what manual string
  // splicing needs. Non-overlap is the requirement, and refreshScriptHeader
  // produces one edit per distinct line.
  pushOwnUndoEntry(operations);
}

function replaceRange(start: number, end: number, newText: string): void {
  replaceRanges([{ start, end, newText }]);
}

/** `C:\maps\Sacred Springs.rms` -> `Sacred Springs.rms`. Both separators, since a path can arrive with either. */
function baseName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] ?? path;
}

export interface UseDocumentOptions {
  /**
   * Whose name the stamped script header carries, from Settings > General.
   *
   * A parameter rather than a `useAppSettings()` call inside the hook. The
   * hook is otherwise about files and nothing else, and taking the value in
   * keeps it that way, the same reason `applyTextEdit` takes a structurally
   * typed edit instead of importing Breakdown's `TextEdit`.
   */
  authorName: string;
}

// Why file access happens on the Rust side, in brief: the webview that
// renders our React UI has no filesystem access of its own. That's a
// deliberate browser-style sandbox. The dialog/fs *plugins* we use here
// are a thin JS wrapper around Tauri "commands": each call
// (open/save/readTextFile/writeTextFile) is serialized, sent over IPC to
// the Rust process, executed there (where real OS file access lives), and
// the result is sent back. `capabilities/default.json` is the allowlist
// that says which of those commands, on which paths, this window is
// permitted to invoke. Nothing in JS can read/write a file the
// capability doesn't cover, no matter what the code says.
export function useDocument({ authorName }: UseDocumentOptions) {
  const [filePath, setFilePath] = useState<string | null>(null);
  // `content` is now a DERIVED MIRROR of documentModel's text (Sec.6.4),
  // updated via onDidChangeContent below, not the source of truth itself.
  const [content, setContentState] = useState(() => documentModel.getValue());
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Dirty is "model version != last-saved version" (Sec.6.4's suggested
  // cleaner signal than string compare) rather than comparing strings,
  // it also means an undo back to the saved state correctly clears dirty,
  // which a string-equality check would have gotten right anyway but this
  // is the idiom Monaco itself uses (e.g. VS Code's own dirty tracking).
  const savedVersionIdRef = useRef(documentModel.getAlternativeVersionId());

  // The close-request listener below is registered once but needs the
  // *current* isDirty/filePath/content on every close attempt, not
  // whatever they were when the listener was created, reading state
  // directly in that closure would capture stale values ("stale
  // closure"), so we mirror state into refs and read the refs instead.
  const isDirtyRef = useRef(isDirty);
  const filePathRef = useRef(filePath);
  isDirtyRef.current = isDirty;
  filePathRef.current = filePath;

  // Same mirror, same reason, for the author name, but note the second
  // reason it has to be a ref here. `writeToPath` below is a `useCallback`
  // with an empty dependency array, and `ensureSavedBefore` and the
  // close-request effect are both built on top of it. Adding `authorName` to
  // those dependencies would give the callback a new identity on every
  // keystroke in the Settings author field, which would tear down and
  // re-register the window close listener each time. A ref carries the
  // current value without participating in the dependency graph at all.
  const authorNameRef = useRef(authorName);
  authorNameRef.current = authorName;

  // --- The stamped script header (scriptHeader.ts) -----------------------
  //
  // TWO pieces of state, because "should one be added?" and "may this row be
  // rewritten?" are different questions whose answers diverge the moment
  // somebody edits the comment.
  //
  // `hasHeaderRef`. Has this document been stamped at all? It is what stops
  // the comment being written a second time. Deleting the block does NOT
  // clear it: a deleted header is an answer, and re-adding it on the next
  // save would be the app arguing with the user.
  //
  // `stampedHeaderRef`, the record of what was written, carrying a per-row
  // ownership set that only ever shrinks (scriptHeader.ts's StampedHeader).
  // Ownership is per ROW rather than per block, so hand-correcting the
  // created date costs you the created row and nothing else; the file name,
  // modified date and version keep updating around your edit.
  //
  // The boolean cannot do the second job on its own: "already added" has to
  // stay true after an edit (or the comment comes back) while "may be
  // rewritten" has to go false for the edited row (or the edit is undone by
  // the next save).
  const hasHeaderRef = useRef(false);
  const stampedHeaderRef = useRef<StampedHeader | null>(null);

  // --- Unsaved-changes prompt -------------------------------------------
  //
  // Both the close guard and Open need to *wait* for the user to pick one of
  // three outcomes. React can't "await a component", so we bridge the two
  // worlds with a Promise: `askUnsaved(action)` renders the dialog (by
  // setting state) and returns a Promise that stays pending until the dialog
  // calls `resolveUnsavedChoice(...)` with the user's answer.
  //
  // The resolver lives in a ref, not state, because it's plumbing rather
  // than something the UI renders. Storing it in state would trigger an
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
  // side made it; Code-tab typing, Breakdown's pushEditOperations, or
  // undo/redo. This is the "content becomes a derived mirror via
  // onDidChangeContent" piece of Sec.6.4.
  useEffect(() => {
    const subscription = documentModel.onDidChangeContent(() => {
      setContentState(documentModel.getValue());
      setIsDirty(documentModel.getAlternativeVersionId() !== savedVersionIdRef.current);
    });
    return () => subscription.dispose();
  }, []);

  /**
   * Put the standard comment at the top of the document, or bring the block
   * already there up to date. Runs immediately before every write to disk.
   *
   * It edits the MODEL rather than the string on its way to the file, so the
   * comment is a real part of the document: visible in the Code tab, undoable
   * with Ctrl+Z like any other edit, and deletable by anyone who does not
   * want it. Stamping it only into the written bytes would produce a file
   * whose contents did not match the editor, which is the sort of difference
   * people find out about later, in the game.
   */
  const stampHeader = useCallback((path: string) => {
    const fileName = baseName(path);
    const now = new Date();

    if (!hasHeaderRef.current) {
      const fields: ScriptHeaderFields = {
        fileName,
        author: authorNameRef.current,
        created: now,
        modified: now,
        appVersion: __APP_VERSION__,
      };
      const { text, stamped } = buildScriptHeader(fields);
      // An empty range at offset 0, an insertion rather than a replacement,
      // so whatever the document already held moves down intact.
      replaceRange(0, 0, `${text}${HEADER_SEPARATOR}`);
      hasHeaderRef.current = true;
      stampedHeaderRef.current = stamped;
      return;
    }

    const previous = stampedHeaderRef.current;
    if (!previous) return;

    const refresh = refreshScriptHeader(documentModel.getValue(), previous, {
      fileName,
      appVersion: __APP_VERSION__,
      modified: now,
    });
    // Stored whether or not there are edits, a refresh that found nothing to
    // change may still have found a row missing, and that narrowed ownership
    // is the part that has to survive to the next save.
    stampedHeaderRef.current = refresh.stamped;
    // One call, not one per edit: N calls would be N undo entries, and the
    // header is one action. Same reasoning as applyTextEdits below.
    replaceRanges(refresh.edits);
  }, []);

  const writeToPath = useCallback(async (path: string) => {
    // Before the read below, so the file gets the stamped text rather than
    // the text as it was a line earlier. pushEditOperations is synchronous,
    // so getValue() here already includes it.
    stampHeader(path);
    await writeTextFile(path, documentModel.getValue());
    savedVersionIdRef.current = documentModel.getAlternativeVersionId();
    setFilePath(path);
    setIsDirty(false);
    setLastSavedAt(new Date());
    // Not awaited: the document is saved, the UI should say so now, and
    // remembering the folder is a background nicety that cannot fail the
    // save (rememberScriptFolder swallows its own errors).
    void rememberScriptFolder(path);
  }, [stampHeader]);

  /**
   * The single unsaved-work guard, shared by Open and the window-close
   * handler, the two places that would otherwise silently discard changes.
   *
   * Returns `true` when it's safe to proceed (nothing was dirty, the save
   * succeeded, or the user chose to discard) and `false` when the user
   * backed out. Callers read as `if (!(await ensureSavedBefore(x))) return;`.
   *
   * Note there are TWO ways to end up cancelling: choosing Cancel in our
   * dialog, and cancelling the native Save As picker afterwards. Both must
   * abandon the whole operation, a cancelled Save As that still closed the
   * window would be the exact data-loss bug this guard exists to prevent.
   */
  const ensureSavedBefore = useCallback(
    async (action: UnsavedAction): Promise<boolean> => {
      if (!isDirtyRef.current) return true;

      const choice = await askUnsaved(action);
      if (choice === "cancel") return false;
      if (choice === "discard") return true;

      if (!filePathRef.current) {
        const target = await save({ filters: RMS_FILTERS, defaultPath: await dialogStartFolder() });
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

    const selected = await open({ multiple: false, filters: RMS_FILTERS, defaultPath: await dialogStartFolder() });
    if (!selected) return;
    const text = await readTextFile(selected);
    void rememberScriptFolder(selected);
    // setValue (not pushEditOperations) deliberately: opening a different
    // file is a new document buffer, so its undo history should NOT carry
    // over from whatever was previously open, this is the one place we
    // want Monaco's undo stack reset, not preserved.
    documentModel.setValue(text);
    // An opened script was not built here, so it does not get stamped.
    // "every script built with AoRMS" is the promise, and writing a header
    // onto somebody else's file (or onto your own, saved before this feature
    // existed) is editing their work uninvited. Marking it as already
    // headered is how that is expressed: `hasHeaderRef` is the "do not add
    // one" flag, and it is set here for a document that never had one, which
    // reads oddly until you notice both states want the same behaviour.
    //
    // The stamp record goes the other way. The file on disk may well contain
    // a block this app wrote in an earlier session, and it looks identical to
    // one written a minute ago, but nothing in the file records whether a
    // human has since rewritten it, so the app has no basis for editing it
    // and does not. A reopened script keeps whatever date it was saved with.
    hasHeaderRef.current = true;
    stampedHeaderRef.current = null;
    savedVersionIdRef.current = documentModel.getAlternativeVersionId();
    setFilePath(selected);
    setIsDirty(false);
    setLastSavedAt(null);
  }, [ensureSavedBefore]);

  const newFile = useCallback(async () => {
    // Same guard as openFile, and for the same reason: a blank document is
    // a replacement for the current model's contents, so anything unsaved
    // in it has to be resolved first.
    if (!(await ensureSavedBefore("new"))) return;
    // setValue (not pushEditOperations), same as openFile: a new document
    // starts a new undo history rather than inheriting the old one.
    documentModel.setValue("");
    // The one place the header state resets to "not stamped yet". New is the
    // start of a script built here, so its first save writes a fresh comment
    // with today as the created date, where Open, just above, does the
    // opposite for the opposite reason.
    hasHeaderRef.current = false;
    stampedHeaderRef.current = null;
    savedVersionIdRef.current = documentModel.getAlternativeVersionId();
    setFilePath(null);
    setIsDirty(false);
    setLastSavedAt(null);
  }, [ensureSavedBefore]);

  const saveFileAs = useCallback(async () => {
    // An open document's own path wins: Save As on a real file means "next to
    // this one, under another name" far more often than it means "somewhere
    // else entirely", and the dialog pre-fills the name from it too.
    const target = await save({ filters: RMS_FILTERS, defaultPath: filePath ?? (await dialogStartFolder()) });
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
  // before that promise resolved, leaving `unlisten` still undefined, so
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

        // The same guard Open uses, a real 3-way choice via our own modal.
        // This used to be Tauri's native confirm(), which returns a boolean:
        // it cannot express three outcomes, and gives no way to tell an
        // explicit "No" from a dismissed dialog, so it had to be collapsed
        // to save-or-stay. Owning the markup fixes that, and every dismissal
        // path (X, Esc, backdrop) reports "cancel".
        //
        // Returning here simply leaves the window open, preventDefault()
        // above already stopped the close.
        if (!(await ensureSavedBefore("close"))) return;

        // destroy() closes without re-emitting closeRequested, calling
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

  // Applies a byte-level TextEdit (docs/breakdown-design.md Sec.4.1's
  // TextEdit shape) to the shared document model via pushOwnUndoEntry,
  // which lands on Monaco's own undo/redo stack, the same stack Ctrl+Z
  // in the Code tab uses (Sec.6.4), as its own entry (see that function's
  // doc comment: without the pushStackElement it calls first, this is
  // exactly the call site that used to let consecutive Breakdown actions
  // accumulate onto one growing undo entry). This is the one function
  // Breakdown's patch-application glue (src/breakdown/applyEdit.ts) needs
  // from this hook; it deliberately takes a structurally-typed edit rather
  // than importing src/breakdown/patch/intents.ts's TextEdit, so this hook
  // stays free of any dependency on the breakdown feature.
  const applyTextEdit = useCallback((edit: { start: number; end: number; newText: string }) => {
    const startPos = documentModel.getPositionAt(edit.start);
    const endPos = documentModel.getPositionAt(edit.end);
    const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
    pushOwnUndoEntry([{ range, text: edit.newText, forceMoveMarkers: true }]);
  }, []);

  // The N-edit form, for the Advanced Tools pane (docs/tools-api-design.md
  // Sec.4.5). It exists because calling applyTextEdit N times, each as its
  // own pushOwnUndoEntry call, would produce N undo entries, which breaks
  // that spec's central promise that a tool's Apply is one undoable action:
  // a user who applied 40 changes should press Ctrl+Z once, not forty times.
  //
  // Converting all N and passing ONE array to a single pushOwnUndoEntry
  // call is the whole mechanism. pushEditOperations takes ranges in
  // ORIGINAL coordinates and handles ordering itself, so the edits need no
  // descending sort. That is what manual string splicing needs, and
  // presenting it as the mechanism invites a later "fix" of the wrong
  // thing. What Monaco does require is non-overlap, which the caller
  // validates (protocol.ts's validateEdits) before reaching here.
  const applyTextEdits = useCallback((edits: readonly { start: number; end: number; newText: string }[]) => {
    if (edits.length === 0) return;
    const operations = edits.map((edit) => {
      const startPos = documentModel.getPositionAt(edit.start);
      const endPos = documentModel.getPositionAt(edit.end);
      return {
        range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
        text: edit.newText,
        forceMoveMarkers: true,
      };
    });
    pushOwnUndoEntry(operations);
  }, []);

  // Sec.6.4's "one undo stack" promise has a reachability gap: the model's
  // undo/redo stack is real and shared, but Ctrl+Z is normally a
  // keybinding the Monaco *editor instance* owns, and that instance only
  // exists while CodePane is mounted (the Code tab is active). Switch to
  // the Breakdown tab, CodePane unmounts, nothing is listening for
  // Ctrl+Z, and a Breakdown edit becomes unreachable to undo even though
  // the data is sitting right there on the shared model. Fix: a
  // window-level listener that calls the model's own undo()/redo()
  // directly, so it works with or without a mounted editor. When the
  // Monaco editor IS focused, its own binding already handles the
  // keystroke (and does it better, cursor/scroll restoration), detect
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
    newFile,
    openFile,
    saveFile,
    saveFileAs,
    applyTextEdit,
    applyTextEdits,
    /** Non-null while the unsaved-changes modal should be on screen; also selects its wording. */
    unsavedAction,
    /** Called by that modal with the user's choice; resolves the pending operation. */
    resolveUnsavedChoice,
  };
}

function fileNameFromPath(path: string): string {
  return baseName(path).replace(/\.rms$/i, "");
}
