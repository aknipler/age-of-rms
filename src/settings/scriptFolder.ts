// Where the Open dialog starts, split into a pure module so the path rules
// can be unit-tested in plain Node — same split as nameDisplay.ts and
// sidepanel/sidePanelLayout.ts. Nothing here touches Tauri: the two
// filesystem questions ("does this exist", "read this file") arrive as an
// injected `FolderProbe`, which is also what lets the tests drive it with a
// fake disk instead of needing a DE install on the CI machine.
//
// WHY THE APP HAS TO ANSWER THIS AT ALL. `open()` with no `defaultPath` hands
// the decision to the Windows common dialog, which reopens whatever folder
// this executable last used (its own per-app MRU, kept by the shell). That is
// a good rule once someone has opened a script and a useless one on a fresh
// install, where the MRU is empty and the dialog lands on Documents. A new
// user's scripts are not in Documents; they are in the DE install, next to
// the maps the game ships.
//
// SO THE ORDER IS: the folder this app last opened or saved in (ours, not the
// shell's, so it survives a reinstall and is inspectable in settings.json),
// then the DE scripts folder if one can be found, then nothing — which hands
// the decision back to the dialog, exactly as before.
//
// WINDOWS-ONLY PATHS, deliberately. This is a Windows desktop app (see the
// project README), the game is a Windows title, and a probe list written to
// look cross-platform would be three plausible-looking paths that have never
// been tested on either of the other two.

// Re-exported rather than redeclared: there is one settings.json and the
// constant already lives in nameDisplay.ts. Re-exporting keeps `useDocument`
// importing the file name and the key it pairs with from the same module,
// without a second string literal that can drift.
export { APP_SETTINGS_STORE_FILE } from "./nameDisplay";

/** Key under which the last folder an .rms was opened from / saved to is kept. */
export const LAST_SCRIPT_FOLDER_KEY = "lastScriptFolder";

/**
 * The part of the path that is the same in every install: DE reads custom
 * random maps out of `<install>\resources\_common\random-map-scripts`, which
 * is also where this project's own RMSTEST maps are copied to be run.
 */
export const SCRIPTS_SUBPATH = "resources\\_common\\random-map-scripts";

/** Where Steam itself is normally installed, i.e. where to look for the library list. */
export const STEAM_ROOT_CANDIDATES: readonly string[] = [
  "C:\\Program Files (x86)\\Steam",
  "C:\\Program Files\\Steam",
];

/**
 * Script folders that are not under a Steam library at all.
 *
 * The Microsoft Store / Game Pass build installs its read-only package into
 * `C:\Program Files\WindowsApps`, which is ACL'd so tightly that probing it is
 * pointless, but it puts the playable content in `C:\XboxGames`. The two
 * Steam paths are the ones `tools/extract-constants` has always carried as
 * fallbacks, kept here for the case where the library list can't be read.
 */
export const DIRECT_INSTALL_CANDIDATES: readonly string[] = [
  "C:\\XboxGames\\Age of Empires II Definitive Edition\\Content",
  "D:\\SteamLibrary\\steamapps\\common\\AoE2DE",
  "D:\\Steam\\steamapps\\common\\AoE2DE",
];

/** The two filesystem questions this module asks, so the caller owns the Tauri dependency. */
export interface FolderProbe {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
}

/** `<library root>\steamapps\common\AoE2DE` — where Steam puts the game inside any of its libraries. */
export function installFolderIn(steamLibraryRoot: string): string {
  return `${trimTrailingSlash(steamLibraryRoot)}\\steamapps\\common\\AoE2DE`;
}

/** `<install>\resources\_common\random-map-scripts`. */
export function scriptsFolderIn(installFolder: string): string {
  return `${trimTrailingSlash(installFolder)}\\${SCRIPTS_SUBPATH}`;
}

/**
 * Every library root named in a `libraryfolders.vdf`.
 *
 * Deliberately a regex over `"path" "value"` pairs rather than a VDF parser:
 * the file's shape has changed twice across Steam versions (the value used to
 * be a bare `"1" "D:\\Games"` entry, it is now a nested block with `path`,
 * `label`, `apps` and more), and the one field this needs has kept its name
 * throughout. A parser would track the shape; this tracks the field.
 *
 * Backslashes are escaped in VDF, so `D:\\SteamLibrary` on disk is
 * `D:\\\\SteamLibrary` in the file — unescaped here, since every consumer
 * wants a real path.
 */
export function parseSteamLibraryPaths(vdf: string): string[] {
  const paths: string[] = [];
  for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) {
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }
  return paths;
}

/**
 * The DE random-map-scripts folder, or `null` when the game isn't found.
 *
 * `null` is a real answer and not a failure: plenty of people will run this
 * without DE on the same machine, or with it somewhere none of these
 * candidates reach. The caller passes no `defaultPath` in that case and the
 * dialog behaves exactly as it did before this existed.
 *
 * Probes are sequential rather than `Promise.all`ed on purpose. The list is
 * short, the first candidate is right on most machines, and each probe is an
 * IPC hop into the Rust side — parallelising would trade a rare handful of
 * milliseconds for firing every probe on every machine.
 */
export async function findDeScriptsFolder(probe: FolderProbe): Promise<string | null> {
  for (const candidate of await candidateScriptFolders(probe)) {
    if (await probe.exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The folders `findDeScriptsFolder` will try, in order. Exported for the
 * tests, which is the only way to assert the ORDER — the resolver itself can
 * only ever report the one that won.
 */
export async function candidateScriptFolders(probe: FolderProbe): Promise<string[]> {
  const folders: string[] = [];
  const seen = new Set<string>();
  const add = (folder: string) => {
    const key = folder.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    folders.push(folder);
  };

  for (const steamRoot of STEAM_ROOT_CANDIDATES) {
    // The Steam root is itself library 0, and on a single-drive install it is
    // the only one — so it is added whether or not the library list reads.
    add(scriptsFolderIn(installFolderIn(steamRoot)));
    for (const library of await readSteamLibraries(probe, steamRoot)) {
      add(scriptsFolderIn(installFolderIn(library)));
    }
  }
  for (const install of DIRECT_INSTALL_CANDIDATES) add(scriptsFolderIn(install));

  return folders;
}

/**
 * The library roots listed by one Steam installation, or `[]` if it has none
 * to give.
 *
 * Two locations because Steam moved the file: `steamapps\libraryfolders.vdf`
 * is the long-standing one and `config\libraryfolders.vdf` is where newer
 * clients write it. Both are read, since a machine upgraded across that change
 * has both and they can disagree.
 *
 * A read that throws is caught and treated as "no libraries here". The file
 * being unreadable is not an error this feature should surface — it means the
 * probe falls through to the next candidate, which is the whole design.
 */
async function readSteamLibraries(probe: FolderProbe, steamRoot: string): Promise<string[]> {
  const libraries: string[] = [];
  for (const relative of ["steamapps\\libraryfolders.vdf", "config\\libraryfolders.vdf"]) {
    const file = `${steamRoot}\\${relative}`;
    try {
      if (!(await probe.exists(file))) continue;
      libraries.push(...parseSteamLibraryPaths(await probe.readTextFile(file)));
    } catch {
      // Unreadable (permissions, a half-written file, a drive that went away)
      // — the next candidate gets its turn.
    }
  }
  return libraries;
}

function trimTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, "");
}
