import { useEffect, useMemo, useState } from "react";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import type { ParseResult } from "./parser/types";
import {
  includePathsInText,
  loadIncludeFiles,
  type IncludeFiles,
} from "./preview/generator/includes";
import {
  findDeGamedataFolder,
  type FolderProbe,
} from "./settings/scriptFolder";

// The game's own `#include_drs` files, read from the user's DE install for
// the preview (docs/preview-design.md Sec.3, amended 2026-11-02) and for the
// editor's checks (docs/include-resolution-design.md). They are Microsoft's
// content, so the app never ships them and reads them where the game does.
//
// Read here, on the main thread, rather than in a worker, because the Tauri
// fs plugin talks to the Rust side over IPC that only the window has. The
// preview worker gets the text with each request, so a worker the watchdog
// replaces needs nothing resent. The parser worker is never replaced, so it
// is sent the text once per change of the file set (useParsedDocument).
// Measured on 24hr_Bazi (2026-11-02, Node), its 45 files are 458 K
// characters and clone in about 8 ms, against about 250 ms for the
// ParseResult sent beside them.

const TAURI_PROBE: FolderProbe = { exists, readTextFile };

/** What one read of a script's include files produced. */
export interface IncludeLoad {
  files: IncludeFiles;
  /**
   * Every key the loader asked the disk for, found or not. The parser's
   * checks need it to tell a file the install lacks (it reads as empty, as
   * DE reads it) from one nobody has asked for yet.
   */
  requested: string[];
}

/**
 * Found once per session and shared by every caller. A module-level promise
 * rather than state, since the install does not move while the app runs and
 * the answer belongs to no one component. A failed probe reads as no
 * install, the same as the Open dialog's use of the same search.
 */
let gamedataFolder: Promise<string | null> | undefined;
function findGamedataFolder(): Promise<string | null> {
  gamedataFolder ??= findDeGamedataFolder(TAURI_PROBE).catch(() => null);
  return gamedataFolder;
}

/**
 * The last read, shared the same way. The preview pane, the parser and the
 * Advanced Tools tab each call the hook for the same script, and this lets
 * the later callers take the first one's files instead of reading the disk
 * again. One entry is enough, since all follow the one open script, and a
 * new set of paths replaces it. `null` is no install found.
 */
let lastLoad:
  { pathsKey: string; loaded: Promise<IncludeLoad | null> } | undefined;
function loadFor(pathsKey: string): Promise<IncludeLoad | null> {
  if (lastLoad?.pathsKey !== pathsKey) {
    const loaded = (async () => {
      const folder = await findGamedataFolder();
      if (folder === null) return null;
      const asked = new Set<string>();
      const files = await loadIncludeFiles(
        pathsKey.split("\n"),
        (key) => readInclude(folder, key),
        asked,
      );
      return { files, requested: [...asked] };
    })();
    lastLoad = { pathsKey, loaded };
  }
  return lastLoad.loaded;
}

/**
 * The include files a text needs, read once per change of the set of paths.
 * `undefined` while nothing has loaded or the text names no include, `null`
 * when no install was found. Takes the text itself so the parser's hook
 * (useParsedDocument, which has no ParseResult to hand yet) and the
 * preview's share one implementation and one disk read.
 */
export function useIncludeLoad(
  source: string | null,
): IncludeLoad | null | undefined {
  // Keyed on the joined paths, a string, so the effect below reruns only
  // when the set of includes changes and not on every keystroke's new
  // ParseResult. Depending on the array itself would rerun every time,
  // because React compares dependencies by reference.
  const pathsKey = useMemo(
    () => (source === null ? "" : includePathsInText(source).join("\n")),
    [source],
  );
  const [load, setLoad] = useState<IncludeLoad | null | undefined>(undefined);

  useEffect(() => {
    if (pathsKey === "") {
      setLoad(undefined);
      return;
    }
    // Set by the cleanup when the paths change again before this load
    // finishes, so a slow read can never overwrite a newer one's files.
    let stale = false;
    void loadFor(pathsKey).then((loaded) => {
      if (!stale) setLoad(loaded);
    });
    return () => {
      stale = true;
    };
  }, [pathsKey]);

  return load;
}

/**
 * The include files the open script needs, or undefined when it names none
 * or no install was found. The generator reads undefined as "no install"
 * and says so in a note, and a file missing from the map as a file the game
 * also lacks.
 */
export function useIncludeFiles(
  parseResult: ParseResult | null,
): IncludeFiles | undefined {
  return useIncludeLoad(parseResult?.source ?? null)?.files;
}

/** One include file's text, or undefined when it is not there or will not read. */
async function readInclude(
  folder: string,
  key: string,
): Promise<string | undefined> {
  const path = `${folder}\\${key.replace(/\//g, "\\")}`;
  try {
    if (!(await exists(path))) return undefined;
    return (await readTextFile(path)).replace(/\r\n/g, "\n");
  } catch {
    return undefined;
  }
}
