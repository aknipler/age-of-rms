import { exists, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import {
  findDeTerrainTexturesFolder,
  type FolderProbe,
} from "../../settings/scriptFolder";
import {
  chosenInstallFolder,
  onInstallFolderChange,
} from "../../settings/installFolder";
import { UnsupportedDdsError, type DecodedImage } from "./dds";
import { decodeDds } from "./decodeClient";
import { BLEND_ATLAS_FILES } from "./terrainBlends";
import { MASK_SIZE, TEXTURE_SIZE } from "./texturedTiles";

// Reads DE's terrain textures from the user's install for the textured view
// (docs/preview-de-textures-design.md Sec.5). The files are read on the main
// thread, since the Tauri fs plugin talks to the Rust side over IPC that only
// the window has (the same reason useIncludeFiles.ts gives), and decoded in
// the decode worker (decodeClient.ts). The textures are the game's own
// content, so the app never ships or copies them, it reads them where the
// game does.

// readTextFile reads Steam's library list, so a game in a second library is found.
const PROBE: FolderProbe = { exists, readTextFile };

/**
 * Found once per session. A module level promise rather than React state,
 * since the install does not move while the app runs and the answer belongs
 * to no one component. Both canvases, and every re-roll, share it.
 */
let folderPromise: Promise<string | null> | undefined;
function texturesFolder(): Promise<string | null> {
  folderPromise ??= findDeTerrainTexturesFolder(
    PROBE,
    chosenInstallFolder(),
  ).catch(() => null);
  return folderPromise;
}

/**
 * Promises rather than finished images, keyed by lower case file name. A
 * cache of promises is a common pattern worth knowing. A second caller that
 * asks while the first read is still running gets the same promise, so a file
 * is never read or decoded twice, which a cache filled only on completion
 * cannot promise. `null` is a texture that could not be read or decoded.
 */
const cache = new Map<string, Promise<DecodedImage | null>>();

/** True once a texture folder is known to exist. `null` while unknown. */
let folderFound: boolean | null = null;

/** The install's `...\terrain\textures` folder, or null without one. The sprite loader finds `drs\graphics` from it. */
export function deTexturesFolder(): Promise<string | null> {
  return texturesFolder();
}

export function texturesFolderFound(): boolean | null {
  return folderFound;
}

async function readTexture(name: string): Promise<DecodedImage | null> {
  const folder = await texturesFolder();
  folderFound = folder !== null;
  if (folder === null) return null;
  const candidates = [`${folder}\\2x\\${name}.dds`, `${folder}\\${name}.dds`];
  for (const path of candidates) {
    if (!(await exists(path))) continue;
    try {
      const bytes = await readFile(path);
      // Decoded in the decode worker (decodeClient.ts). A texture took about
      // 100 ms here on the window's thread, a dozen of them a visible stutter.
      return await decodeDds(bytes, TEXTURE_SIZE);
    } catch (error) {
      // BC7 and anything else unreadable draws flat. Any other error is
      // unexpected, but a texture is never worth breaking the preview over.
      if (!(error instanceof UnsupportedDdsError))
        console.warn(`DE texture ${name} could not be read`, error);
      return null;
    }
  }
  return null;
}

export function loadDeTexture(name: string): Promise<DecodedImage | null> {
  const key = name.toLowerCase();
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = readTexture(key);
    cache.set(key, pending);
  }
  return pending;
}

// --- Blend atlases and masks (Sec.10) -------------------------------------
//
// Greyscale PNGs in folders beside `textures`. A PNG is decoded by the
// browser rather than in TypeScript, since the window already has a PNG
// decoder and, unlike DDS, nothing here needs to run in Node.

/** One channel, `MASK_SIZE` a side, or null when the file is missing or unreadable. */
const greyCache = new Map<string, Promise<Uint8Array | null>>();

// A new install folder from Settings drops every cached read, so the next
// request reads from the new folder. Images a canvas already holds stay until
// it asks again.
onInstallFolderChange(() => {
  folderPromise = undefined;
  folderFound = null;
  cache.clear();
  greyCache.clear();
});

async function readGreyPng(
  subfolder: "blends" | "masks",
  file: string,
): Promise<Uint8Array | null> {
  const folder = await texturesFolder();
  if (folder === null) return null;
  // The textures folder is `...\terrain\textures`, its siblings hold these.
  const terrainFolder = folder.replace(/[\\/][^\\/]+$/, "");
  const path = `${terrainFolder}\\${subfolder}\\${file}`;
  try {
    if (!(await exists(path))) return null;
    const bytes = await readFile(path);
    // Ask for the stored values untouched. The defaults may convert colour
    // spaces, which would change the numbers a mask is.
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
      { colorSpaceConversion: "none", premultiplyAlpha: "none" },
    );
    const canvas = new OffscreenCanvas(MASK_SIZE, MASK_SIZE);
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0, MASK_SIZE, MASK_SIZE);
    bitmap.close();
    const rgba = context.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
    const grey = new Uint8Array(MASK_SIZE * MASK_SIZE);
    for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4];
    return grey;
  } catch (error) {
    console.warn(`DE ${subfolder} file ${file} could not be read`, error);
    return null;
  }
}

function loadGrey(
  subfolder: "blends" | "masks",
  file: string,
): Promise<Uint8Array | null> {
  const key = `${subfolder}/${file.toLowerCase()}`;
  let pending = greyCache.get(key);
  if (pending === undefined) {
    pending = readGreyPng(subfolder, file.toLowerCase());
    greyCache.set(key, pending);
  }
  return pending;
}

/** The nine blend atlases, by blend mode, null where a file did not read. */
export async function loadDeBlendAtlases(): Promise<(Uint8Array | null)[]> {
  const atlases: (Uint8Array | null)[] = [];
  for (const name of BLEND_ATLAS_FILES)
    atlases.push(await loadGrey("blends", `${name}.png`));
  return atlases;
}

/** Every named mask that could be read, by lower case file name. */
export async function loadDeMasks(
  names: Iterable<string>,
): Promise<Map<string, Uint8Array>> {
  const loaded = new Map<string, Uint8Array>();
  for (const name of new Set([...names].map((n) => n.toLowerCase()))) {
    const mask = await loadGrey("masks", name);
    if (mask !== null) loaded.set(name, mask);
  }
  return loaded;
}

/**
 * Every named texture that could be read, by lower case name. One at a time,
 * so the worker decodes them in turn and memory holds one file's bytes at a
 * time.
 */
export async function loadDeTextures(
  names: Iterable<string>,
): Promise<Map<string, DecodedImage>> {
  const loaded = new Map<string, DecodedImage>();
  for (const name of new Set([...names].map((n) => n.toLowerCase()))) {
    const image = await loadDeTexture(name);
    if (image !== null) loaded.set(name, image);
  }
  return loaded;
}
