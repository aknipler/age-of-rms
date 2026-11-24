import type { SpriteImage } from "./objectSprites";
import type { SldFrame } from "./sld";

// Turning a decoded SLD frame into the bitmaps the canvas draws: the player
// colour painted in, the shadow made an alpha. Pure apart from
// createImageBitmap, which a worker has too, so the decode worker
// (decodeWorker.ts) runs it off the window's thread. deSpriteSource.ts
// re-exports it for the comparison page, which draws exactly what the app
// does.

/**
 * DE's team colours, from the install's `palettes/spritecolors.json`
 * (TeamColors), red, green and blue from 0 to 1. Index 0 is Gaia, which the
 * player colour layer leaves as drawn.
 */
export const TEAM_COLOURS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0, 0, 1],
  [1, 0, 0],
  [0, 0.663, 0.106],
  [0.839, 0.839, 0.106],
  [0.482, 0.937, 0.941],
  [0.541, 0.075, 0.969],
  [0.4, 0.4, 0.4],
  [1, 0.573, 0.02],
];

/**
 * How dark a sprite's shadow layer draws, as a factor on its stored value.
 * The layer is the shadow's alpha already (a tree's peaks at 162 of 255), and
 * DE's tree shadows are as dark as that (Sec.12.4).
 */
export const SHADOW_STRENGTH = 1;

/** The player colour a frame's mask paints, over the frame's own shading. */
export function tintPixel(
  rgba: Uint8Array | Uint8ClampedArray,
  at: number,
  mask: number,
  team: readonly [number, number, number],
): void {
  if (mask === 0) return;
  const m = mask / 255;
  const r = rgba[at];
  const g = rgba[at + 1];
  const b = rgba[at + 2];
  // The mask marks cloth and banners drawn in grey, so their light and dark
  // carry over onto the team colour.
  const light = Math.min(1, ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 1.6);
  rgba[at] = r + (team[0] * 255 * light - r) * m;
  rgba[at + 1] = g + (team[1] * 255 * light - g) * m;
  rgba[at + 2] = b + (team[2] * 255 * light - b) * m;
}

async function bitmapOf(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): Promise<ImageBitmap | null> {
  if (width === 0 || height === 0) return null;
  return createImageBitmap(new ImageData(pixels, width, height), {
    premultiplyAlpha: "default",
  });
}

/**
 * A decoded frame as bitmaps, its player colour painted in and its shadow
 * darkened. Exported so a comparison against the game draws exactly what the
 * app does, from files it reads its own way.
 */
export async function composeFrame(
  frame: SldFrame,
  owner: number,
  shadowStrength = SHADOW_STRENGTH,
): Promise<SpriteImage> {
  let image: ImageBitmap | null = null;
  let x = 0;
  let y = 0;
  const main = frame.main;
  if (main !== null) {
    const rgba = new Uint8ClampedArray(main.pixels);
    const team = TEAM_COLOURS[owner];
    if (frame.player !== null && owner > 0 && team !== undefined) {
      const p = frame.player;
      for (let py = 0; py < p.height; py++) {
        for (let px = 0; px < p.width; px++) {
          const mx = p.x + px - main.x;
          const my = p.y + py - main.y;
          if (mx < 0 || my < 0 || mx >= main.width || my >= main.height)
            continue;
          tintPixel(
            rgba,
            (my * main.width + mx) * 4,
            p.pixels[py * p.width + px],
            team,
          );
        }
      }
    }
    image = await bitmapOf(main.width, main.height, rgba);
    x = main.x - frame.hotspotX;
    y = main.y - frame.hotspotY;
  }
  let shadow: ImageBitmap | null = null;
  let shadowX = 0;
  let shadowY = 0;
  if (frame.shadow !== null) {
    const s = frame.shadow;
    const rgba = new Uint8ClampedArray(s.width * s.height * 4);
    for (let i = 0; i < s.pixels.length; i++)
      rgba[i * 4 + 3] = Math.round(s.pixels[i] * shadowStrength);
    shadow = await bitmapOf(s.width, s.height, rgba);
    shadowX = s.x - frame.hotspotX;
    shadowY = s.y - frame.hotspotY;
  }
  return { image, x, y, shadow, shadowX, shadowY };
}
