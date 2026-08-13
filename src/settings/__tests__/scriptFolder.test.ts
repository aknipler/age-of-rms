// The Open dialog's starting folder — the path rules only. The Tauri half
// (the store read, the `exists` IPC) is wired in useDocument.ts and has no
// automated coverage, same as every other hook in this codebase; everything
// that can be a pure function is one, and this is that function.

import { describe, expect, it } from "vitest";
import {
  candidateScriptFolders,
  findDeScriptsFolder,
  installFolderIn,
  parseSteamLibraryPaths,
  scriptsFolderIn,
  type FolderProbe,
} from "../scriptFolder";

/**
 * A fake disk. `exists` answers from a set of paths, case-insensitively
 * because Windows is, and `readTextFile` throws for anything absent — the
 * same way the real plugin does, which is the behaviour `readSteamLibraries`
 * has to survive.
 */
function fakeDisk(files: Record<string, string>, folders: string[] = []): FolderProbe & { probed: string[] } {
  const lower = new Map(Object.entries(files).map(([path, body]) => [path.toLowerCase(), body]));
  const folderSet = new Set(folders.map((f) => f.toLowerCase()));
  const probed: string[] = [];
  return {
    probed,
    async exists(path) {
      probed.push(path);
      return folderSet.has(path.toLowerCase()) || lower.has(path.toLowerCase());
    },
    async readTextFile(path) {
      const body = lower.get(path.toLowerCase());
      if (body === undefined) throw new Error(`ENOENT: ${path}`);
      return body;
    },
  };
}

const DEFAULT_LIBRARY = "C:\\Program Files (x86)\\Steam";
const DEFAULT_SCRIPTS = scriptsFolderIn(installFolderIn(DEFAULT_LIBRARY));

describe("parseSteamLibraryPaths", () => {
  it("reads every library out of a modern nested libraryfolders.vdf", () => {
    const vdf = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"813780"\t\t"12345678"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"E:\\\\SteamLibrary"
\t}
}`;
    expect(parseSteamLibraryPaths(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "E:\\SteamLibrary"]);
  });

  it("returns nothing rather than throwing on a file that holds no paths", () => {
    expect(parseSteamLibraryPaths("")).toEqual([]);
    expect(parseSteamLibraryPaths('"libraryfolders"\n{\n}\n')).toEqual([]);
  });
});

describe("findDeScriptsFolder", () => {
  it("finds the install under the default Steam root", async () => {
    const disk = fakeDisk({}, [DEFAULT_SCRIPTS]);
    expect(await findDeScriptsFolder(disk)).toBe(DEFAULT_SCRIPTS);
  });

  it("finds an install on a second drive, via the library list", async () => {
    // The whole reason the .vdf is read at all: a library on E: is named
    // nowhere in the hardcoded candidates, and putting the game on the big
    // drive is the normal case, not the exotic one.
    const onE = scriptsFolderIn(installFolderIn("E:\\SteamLibrary"));
    const disk = fakeDisk(
      {
        "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf": '"0"\n{\n"path" "E:\\\\SteamLibrary"\n}\n',
      },
      [onE],
    );
    expect(await findDeScriptsFolder(disk)).toBe(onE);
  });

  it("prefers the default root when the game is in two libraries", async () => {
    const onE = scriptsFolderIn(installFolderIn("E:\\SteamLibrary"));
    const disk = fakeDisk(
      {
        "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf": '"path" "E:\\\\SteamLibrary"',
      },
      [DEFAULT_SCRIPTS, onE],
    );
    expect(await findDeScriptsFolder(disk)).toBe(DEFAULT_SCRIPTS);
  });

  it("finds the Game Pass install, which is under no Steam library at all", async () => {
    const xbox = scriptsFolderIn("C:\\XboxGames\\Age of Empires II Definitive Edition\\Content");
    expect(await findDeScriptsFolder(fakeDisk({}, [xbox]))).toBe(xbox);
  });

  it("answers null when the game isn't installed, having thrown nothing", async () => {
    // null is the caller's cue to pass no defaultPath, leaving the dialog to
    // behave exactly as it did before this existed. A throw here would break
    // Open on every machine without DE on it.
    expect(await findDeScriptsFolder(fakeDisk({}))).toBeNull();
  });

  it("survives a libraryfolders.vdf that exists but cannot be read", async () => {
    const disk: FolderProbe = {
      async exists(path) {
        return path.endsWith("libraryfolders.vdf") || path === DEFAULT_SCRIPTS;
      },
      async readTextFile() {
        throw new Error("EACCES");
      },
    };
    expect(await findDeScriptsFolder(disk)).toBe(DEFAULT_SCRIPTS);
  });
});

describe("candidateScriptFolders", () => {
  it("never probes the same folder twice, however many libraries name it", async () => {
    // Steam lists its own root as library 0, and both .vdf locations exist on
    // a machine upgraded across the move — so the default root arrives three
    // times before any deduplication.
    const vdf = '"path" "C:\\\\Program Files (x86)\\\\Steam"';
    const disk = fakeDisk({
      "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf": vdf,
      "C:\\Program Files (x86)\\Steam\\config\\libraryfolders.vdf": vdf,
    });
    const candidates = await candidateScriptFolders(disk);
    expect(candidates.filter((c) => c === DEFAULT_SCRIPTS)).toHaveLength(1);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("puts the Steam roots ahead of the hardcoded fallbacks", async () => {
    const candidates = await candidateScriptFolders(fakeDisk({}));
    expect(candidates[0]).toBe(DEFAULT_SCRIPTS);
    expect(candidates.at(-1)).toBe(scriptsFolderIn("D:\\Steam\\steamapps\\common\\AoE2DE"));
  });

  it("builds the path DE actually reads custom maps from", async () => {
    expect(DEFAULT_SCRIPTS).toBe(
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\AoE2DE\\resources\\_common\\random-map-scripts",
    );
    // A trailing separator on a library path from the .vdf must not double up.
    expect(installFolderIn("E:\\SteamLibrary\\")).toBe("E:\\SteamLibrary\\steamapps\\common\\AoE2DE");
  });
});
