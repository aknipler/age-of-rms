// Where the Open dialog starts, split into a pure module so the path rules
// can be unit-tested in plain Node, same split as nameDisplay.ts and
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
// then the DE scripts folder if one can be found, then nothing, which hands
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
 * Key under which the path of the script that was open when the app last ran
 * is kept, so the next launch can open it again. Cleared by New, since a blank
 * unsaved document has nothing to come back to.
 */
export const LAST_OPEN_FILE_KEY = "lastOpenFile";

/**
 * The part of the path that is the same in every install: DE reads custom
 * random maps out of `<install>\resources\_common\random-map-scripts`, which
 * is also where this project's own RMSTEST maps are copied to be run.
 */
export const SCRIPTS_SUBPATH = "resources\\_common\\random-map-scripts";

/**
 * Where DE keeps the files a script's `#include_drs` names, which resolve
 * against this folder (`includes/scaling.inc` is
 * `<install>\resources\_common\drs\gamedata_x2\includes\scaling.inc`).
 */
export const GAMEDATA_SUBPATH = "resources\\_common\\drs\\gamedata_x2";

/**
 * Where DE keeps its terrain textures. Most sit in its `2x` subfolder and a
 * few directly in this one (docs/preview-de-textures-design.md Sec.2).
 */
export const TERRAIN_TEXTURES_SUBPATH = "resources\\_common\\terrain\\textures";

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

/** `<library root>\steamapps\common\AoE2DE`, where Steam puts the game inside any of its libraries. */
export function installFolderIn(steamLibraryRoot: string): string {
  return `${trimTrailingSlash(steamLibraryRoot)}\\steamapps\\common\\AoE2DE`;
}

/** `<install>\resources\_common\random-map-scripts`. */
export function scriptsFolderIn(installFolder: string): string {
  return `${trimTrailingSlash(installFolder)}\\${SCRIPTS_SUBPATH}`;
}

/** `<install>\resources\_common\drs\gamedata_x2`. */
export function gamedataFolderIn(installFolder: string): string {
  return `${trimTrailingSlash(installFolder)}\\${GAMEDATA_SUBPATH}`;
}

/** `<install>\resources\_common\terrain\textures`. */
export function terrainTexturesFolderIn(installFolder: string): string {
  return `${trimTrailingSlash(installFolder)}\\${TERRAIN_TEXTURES_SUBPATH}`;
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
 * `D:\\\\SteamLibrary` in the file. Unescaped here, since every consumer
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
 * IPC hop into the Rust side, parallelising would trade a rare handful of
 * milliseconds for firing every probe on every machine.
 */
export async function findDeScriptsFolder(
  probe: FolderProbe,
  chosen?: string | null,
): Promise<string | null> {
  return firstExisting(probe, chosen, scriptsFolderIn);
}

/**
 * The folders `findDeScriptsFolder` will try, in order. Exported for the
 * tests, which is the only way to assert the ORDER, the resolver itself can
 * only ever report the one that won. Collects the whole lazy search, drive
 * search included, so only tests should call it.
 */
export async function candidateScriptFolders(
  probe: FolderProbe,
  chosen?: string | null,
): Promise<string[]> {
  const folders: string[] = [];
  for await (const install of candidateInstallFolders(probe, chosen))
    folders.push(scriptsFolderIn(install));
  return folders;
}

/**
 * DE's `gamedata_x2` folder, where `#include_drs` files live, or `null` when
 * the game isn't found. The preview reads include files from here
 * (src/useIncludeFiles.ts). Same candidates and the same sequential probe as
 * `findDeScriptsFolder`.
 */
export async function findDeGamedataFolder(
  probe: FolderProbe,
  chosen?: string | null,
): Promise<string | null> {
  return firstExisting(probe, chosen, gamedataFolderIn);
}

/**
 * DE's terrain texture folder, or `null` when the game isn't found. The
 * preview's textured view reads from here (src/preview/render/deTextureSource.ts).
 * Same candidates and the same sequential probe as `findDeGamedataFolder`.
 */
export async function findDeTerrainTexturesFolder(
  probe: FolderProbe,
  chosen?: string | null,
): Promise<string | null> {
  return firstExisting(probe, chosen, terrainTexturesFolderIn);
}

/** The first candidate install whose `subfolder` exists, as that subfolder. */
async function firstExisting(
  probe: FolderProbe,
  chosen: string | null | undefined,
  subfolder: (install: string) => string,
): Promise<string | null> {
  for await (const install of candidateInstallFolders(probe, chosen)) {
    const candidate = subfolder(install);
    if (await probe.exists(candidate)) return candidate;
  }
  return null;
}

/** Key under which the install folder chosen in Settings > General is kept. Empty or absent means search. */
export const INSTALL_FOLDER_KEY = "aoe2InstallFolder";

/** Drive letters searched when the fixed candidates miss. A and B are floppy letters and never hold a game. */
export const SEARCHED_DRIVES: readonly string[] = [
  ..."CDEFGHIJKLMNOPQRSTUVWXYZ",
];

/**
 * Where a Steam library or a Steam install itself commonly sits on a drive.
 * Each is read for its `libraryfolders.vdf` too, so a Steam installed on D:
 * still leads to a library on E:.
 */
const STEAM_ROOTS_ON_DRIVE: readonly string[] = [
  "Program Files (x86)\\Steam",
  "Program Files\\Steam",
  "Steam",
  "SteamLibrary",
  "Games\\Steam",
  "Games\\SteamLibrary",
  "SteamGames",
];

/** Where the Xbox app puts the Store and Game Pass build on a drive it was told to use. */
const XBOX_CONTENT_ON_DRIVE =
  "XboxGames\\Age of Empires II Definitive Edition\\Content";

/**
 * The install folders a chosen folder could mean. People pick the folder the
 * Xbox app shows (`...\Age of Empires II Definitive Edition`), whose game
 * files are one level down in `Content`, as often as the folder the game
 * files are in, so both are tried.
 */
function chosenFolderCandidates(chosen: string): string[] {
  const trimmed = trimTrailingSlash(chosen.trim());
  if (trimmed === "") return [];
  return [trimmed, `${trimmed}\\Content`];
}

/**
 * The DE install folder (the one holding `resources`), or `null` when the
 * game isn't found. `chosen` is the folder from Settings > General, tried
 * before any search. Judged by `gamedata_x2`, the folder every reader of the
 * install needs.
 */
export async function findDeInstallFolder(
  probe: FolderProbe,
  chosen?: string | null,
): Promise<string | null> {
  for await (const install of candidateInstallFolders(probe, chosen)) {
    if (await probe.exists(gamedataFolderIn(install))) return install;
  }
  return null;
}

/** Whether a folder is a DE install, or the Xbox folder one level above one. Returns the install folder it resolves to. */
export async function checkInstallFolder(
  probe: FolderProbe,
  chosen: string,
): Promise<string | null> {
  for (const install of chosenFolderCandidates(chosen)) {
    try {
      if (await probe.exists(gamedataFolderIn(install))) return install;
    } catch {
      // A path the fs plugin refuses reads as not an install.
    }
  }
  return null;
}

/**
 * Every place DE might be installed, in the order they are tried, each once.
 *
 * An async generator (`async function*`) rather than a function returning an
 * array, so the search is lazy. A finder that stops at the first folder that
 * exists stops the generator there too, and the drive search below never
 * runs on the common machine where the game is in C:'s Steam folder. An
 * array would probe every drive up front to build a list mostly thrown away.
 */
async function* candidateInstallFolders(
  probe: FolderProbe,
  chosen?: string | null,
): AsyncGenerator<string> {
  const seen = new Set<string>();
  for await (const folder of rawInstallCandidates(probe, chosen)) {
    const trimmed = trimTrailingSlash(folder);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    yield trimmed;
  }
}

/** The candidates in order, repeats included. `candidateInstallFolders` drops the repeats. */
async function* rawInstallCandidates(
  probe: FolderProbe,
  chosen?: string | null,
): AsyncGenerator<string> {
  // The folder chosen in Settings wins over every search.
  if (chosen) yield* chosenFolderCandidates(chosen);

  for (const steamRoot of STEAM_ROOT_CANDIDATES) {
    // The Steam root is itself library 0, and on a single-drive install it is
    // the only one, so it is added whether or not the library list reads.
    yield installFolderIn(steamRoot);
    for (const library of await readSteamLibraries(probe, steamRoot)) {
      yield installFolderIn(library);
    }
  }
  yield* DIRECT_INSTALL_CANDIDATES;

  // Then every other drive, for a Steam library or an Xbox app folder that
  // none of the above names. A drive whose root does not exist is skipped
  // with one probe, so a machine with two drives pays for two drives.
  for (const drive of SEARCHED_DRIVES) {
    const root = `${drive}:`;
    let present = false;
    try {
      present = await probe.exists(`${root}\\`);
    } catch {
      present = false;
    }
    if (!present) continue;
    for (const steamRoot of STEAM_ROOTS_ON_DRIVE) {
      const path = `${root}\\${steamRoot}`;
      yield installFolderIn(path);
      for (const library of await readSteamLibraries(probe, path)) {
        yield installFolderIn(library);
      }
    }
    yield `${root}\\${XBOX_CONTENT_ON_DRIVE}`;
  }
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
 * being unreadable is not an error this feature should surface, it means the
 * probe falls through to the next candidate, which is the whole design.
 */
async function readSteamLibraries(
  probe: FolderProbe,
  steamRoot: string,
): Promise<string[]> {
  const libraries: string[] = [];
  for (const relative of [
    "steamapps\\libraryfolders.vdf",
    "config\\libraryfolders.vdf",
  ]) {
    const file = `${steamRoot}\\${relative}`;
    try {
      if (!(await probe.exists(file))) continue;
      libraries.push(...parseSteamLibraryPaths(await probe.readTextFile(file)));
    } catch {
      // Unreadable (permissions, a half-written file, a drive that went away),
      // the next candidate gets its turn.
    }
  }
  return libraries;
}

function trimTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, "");
}
