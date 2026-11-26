import { exists, readFile } from "@tauri-apps/plugin-fs";
import { deTexturesFolder } from "./deTextureSource";
import { onInstallFolderChange } from "../../settings/installFolder";
import { spriteKey, type SpriteImage } from "./objectSprites";
import { decodeSprite, openSprite } from "./decodeClient";
// Re-exported for the comparison page, which draws exactly what the app does.
export {
  SHADOW_STRENGTH,
  TEAM_COLOURS,
  composeFrame,
  tintPixel,
} from "./spriteCompose";

// Reads DE's object sprites from the user's install and turns the frames a
// map needs into bitmaps the canvas draws (docs/preview-de-textures-design.md
// Sec.12). Read on the main thread, for the reason deTextureSource.ts gives,
// and decoded in the decode worker (decodeClient.ts). Like the textures,
// nothing is shipped or copied, the files are read where the game reads them.

let graphicsFolderPromise: Promise<string | null> | undefined;
/** `...\resources\_common\drs\graphics`, beside the terrain folder. */
function graphicsFolder(): Promise<string | null> {
  graphicsFolderPromise ??= deTexturesFolder().then((textures) =>
    textures === null
      ? null
      : `${textures.replace(/[\\/]terrain[\\/]textures$/i, "")}\\drs\\graphics`,
  );
  return graphicsFolderPromise;
}

/**
 * Files handed to the decode worker, by lower case name, as their frame
 * count, a promise each so a file is read once however many ask. The worker
 * keeps the parsed file and decodes frames from it (decodeClient.ts).
 */
const files = new Map<string, Promise<number | null>>();

function loadSld(file: string): Promise<number | null> {
  const key = file.toLowerCase();
  let pending = files.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const folder = await graphicsFolder();
      if (folder === null) return null;
      const path = `${folder}\\${key}.sld`;
      try {
        if (!(await exists(path))) return null;
        return await openSprite(key, await readFile(path));
      } catch (error) {
        console.warn(`DE sprite ${file} could not be read`, error);
        return null;
      }
    })();
    files.set(key, pending);
  }
  return pending;
}

const images = new Map<string, Promise<SpriteImage | null>>();

// Same reset as deTextureSource.ts, for a new install folder from Settings.
onInstallFolderChange(() => {
  graphicsFolderPromise = undefined;
  files.clear();
  images.clear();
});

/** One frame of one file in one player's colour, decoded once per session. */
export function loadSpriteImage(
  file: string,
  frame: number,
  owner: number,
): Promise<SpriteImage | null> {
  const key = spriteKey(file, frame, owner);
  let pending = images.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const frameCount = await loadSld(file);
      if (frameCount === null || frame < 0 || frame >= frameCount) return null;
      try {
        return await decodeSprite(file.toLowerCase(), frame, owner);
      } catch (error) {
        console.warn(
          `DE sprite ${file} frame ${frame} could not be decoded`,
          error,
        );
        return null;
      }
    })();
    images.set(key, pending);
  }
  return pending;
}

/**
 * Every named frame that could be decoded, by `spriteKey`. All asked of the
 * decode worker at once: it works through them in turn while the window
 * stays free, which a loop with pauses on the window's thread only
 * approximated.
 */
export async function loadSpriteImages(
  wanted: Iterable<{ file: string; frame: number; owner: number }>,
): Promise<Map<string, SpriteImage>> {
  const loaded = new Map<string, SpriteImage>();
  const keys = new Set<string>();
  const pending: Promise<void>[] = [];
  for (const { file, frame, owner } of wanted) {
    const key = spriteKey(file, frame, owner);
    if (keys.has(key)) continue;
    keys.add(key);
    pending.push(
      loadSpriteImage(file, frame, owner).then((image) => {
        if (image !== null) loaded.set(key, image);
      }),
    );
  }
  await Promise.all(pending);
  return loaded;
}
