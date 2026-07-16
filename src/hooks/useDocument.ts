import { useCallback, useEffect, useRef, useState } from "react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";

const RMS_FILTERS = [{ name: "AoE2 Random Map Script", extensions: ["rms"] }];

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
  const [content, setContentState] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // The close-request listener below is registered once but needs the
  // *current* isDirty/filePath/content on every close attempt, not
  // whatever they were when the listener was created — reading state
  // directly in that closure would capture stale values ("stale
  // closure"), so we mirror state into refs and read the refs instead.
  const isDirtyRef = useRef(isDirty);
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  isDirtyRef.current = isDirty;
  filePathRef.current = filePath;
  contentRef.current = content;

  const setContent = useCallback((next: string) => {
    setContentState(next);
    setIsDirty(true);
  }, []);

  const openFile = useCallback(async () => {
    const selected = await open({ multiple: false, filters: RMS_FILTERS });
    if (!selected) return;
    const text = await readTextFile(selected);
    setFilePath(selected);
    setContentState(text);
    setIsDirty(false);
    setLastSavedAt(null);
  }, []);

  const writeToPath = useCallback(async (path: string) => {
    await writeTextFile(path, contentRef.current);
    setFilePath(path);
    setIsDirty(false);
    setLastSavedAt(new Date());
  }, []);

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

        // Deliberately a 2-way choice, not Save/Discard/Cancel: Tauri's
        // dialog plugin doesn't cleanly expose a 3-button dialog from JS,
        // and there's no reliable way to tell "explicit Discard click"
        // apart from "dismissed the dialog" via the boolean it returns —
        // that ambiguity was the bug (Cancel and dismiss both fell
        // through to close-without-saving). Collapsing to "save & close"
        // vs. "stay open" removes any path that can silently drop work.
        const shouldSaveAndClose = await confirm(
          "This map has unsaved changes. Save and close?",
          { title: "Unsaved changes", kind: "warning" },
        );

        if (!shouldSaveAndClose) return; // Cancel, or dismissed — stay open.

        if (!filePathRef.current) {
          const target = await save({ filters: RMS_FILTERS });
          if (!target) return; // user cancelled Save As — stay open
          await writeToPath(target);
        } else {
          await writeToPath(filePathRef.current);
        }

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
  }, [writeToPath]);

  const mapName = filePath ? fileNameFromPath(filePath) : "Untitled Map";

  return {
    filePath,
    mapName,
    content,
    setContent,
    isDirty,
    lastSavedAt,
    openFile,
    saveFile,
    saveFileAs,
  };
}

function fileNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/);
  const fileName = segments[segments.length - 1] ?? path;
  return fileName.replace(/\.rms$/i, "");
}
