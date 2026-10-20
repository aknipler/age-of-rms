// Renders the finished Comeer map to the PNG the tutorial's first step shows,
// with no canvas, so it runs in Node and the picture can be regenerated and
// checked by a test instead of exported by hand from the running app.
//
// It reuses the preview's own bitmap and palette (buildTerrainBitmap,
// createTerrainPalette), so the colours are the ones a learner sees in the
// preview. What it adds is the projection and a PNG encoder. The projection is
// projection.ts's: tile (0,0) is the west corner, +x runs up and to the right,
// +y runs down and to the right, a tile is a square turned 45 degrees
// (TILE_ASPECT 1), so the map is a diamond.

import { deflateSync, inflateSync } from "node:zlib";
import { buildTerrainBitmap } from "../../preview/render/terrainBitmap";
import {
  categoryColor,
  playerColor,
  type Rgb,
  type TerrainPalette,
} from "../../preview/render/palette";
import type { PreviewResult } from "../../preview/generator/types";

/** Screen pixels per tile half width. 3 makes the 120 tile map 720 pixels across. */
const HALF_WIDTH = 3;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

/**
 * Object circles, in screen pixels of the finished picture. The preview sizes
 * them from the zoom (drawObjects in drawPreview.ts), which at this scale
 * would leave them under 2 px wide and lost in the terrain, so the picture
 * uses a fixed, larger size and the same colours.
 */
const OBJECT_RADIUS = 3.2;
/**
 * Whether the picture draws this placed object. Anything that carries a
 * resource does, whatever the resource (gold, stone, food or wood), judged by
 * the category the preview gives it. Everything else is left out:
 *
 * - Placeholders (ONGRID_PLACEHOLDER and its kin) are scaffolding a script
 *   places to claim ground or to carry an actor area. Comeer places over a
 *   thousand, and none of them is on the finished map. They are refused by
 *   name, ahead of the category test, so one can never be drawn whatever
 *   category the preview gives it.
 * - Units and buildings come out of the preview with no category, drawn as
 *   one pale grey dot that says nothing in a picture.
 */
export function isPictureObject(object: {
  objectRef: string;
  category: string;
}): boolean {
  if (/PLACEHOLDER/i.test(object.objectRef)) return false;
  return object.category.startsWith("resource");
}

/**
 * Fish are food like berries and herds, so the preview paints them the same
 * red. On an island map there are hundreds, and a white dot lets the water
 * read as water and the land's own food stand out from it.
 */
const FISH_COLOR: Rgb = { r: 255, g: 255, b: 255 };
const FISH_NAME =
  /FISH|TUNA|SALMON|PERCH|SNAPPER|DORADO|MARLIN|DOLPHIN|WHALE|SHARK/;

/** Whether the script's name for an object is a fish. */
export function isFish(objectRef: string): boolean {
  return FISH_NAME.test(objectRef);
}

/**
 * Food, a lighter pink than the preview's red. The preview's food red is close
 * to the second player's red, and in a picture of two players a berry bush
 * next to a town reads as that player's.
 */
export const FOOD_COLOR: Rgb = { r: 244, g: 160, b: 156 };

/** The fill of an object's circle. */
function objectColor(object: { objectRef: string; category: string }): Rgb {
  if (isFish(object.objectRef)) return FISH_COLOR;
  if (object.category.startsWith("resource-food")) return FOOD_COLOR;
  return categoryColor(object.category);
}

/** Width and colour of the ring around an object, as in the preview's outlined gaia objects. */
const OBJECT_RING = 1;
const OBJECT_RING_COLOR: Rgb = { r: 0, g: 0, b: 0 };

export function renderComeerImage(
  result: PreviewResult,
  palette: TerrainPalette,
): RgbaImage {
  const snapshot = result.snapshots?.at(-1);
  if (snapshot === undefined) throw new Error("generation has no snapshot");
  const { dim } = snapshot;
  const bitmap = buildTerrainBitmap(snapshot, palette);
  const size = 2 * dim * HALF_WIDTH;
  const data = new Uint8Array(size * size * 4);

  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      // Invert the projection. u = tx + ty and v = ty - tx, so
      // tx = (u - v) / 2 and ty = (u + v) / 2. A pixel centre is sampled, and
      // a pixel outside the diamond stays transparent.
      const u = (sx + 0.5) / HALF_WIDTH;
      const v = (sy + 0.5 - dim * HALF_WIDTH) / HALF_WIDTH;
      const tx = Math.floor((u - v) / 2);
      const ty = Math.floor((u + v) / 2);
      if (tx < 0 || ty < 0 || tx >= dim || ty >= dim) continue;
      const from = (ty * dim + tx) * 4;
      const to = (sy * size + sx) * 4;
      data[to] = bitmap.pixels[from];
      data[to + 1] = bitmap.pixels[from + 1];
      data[to + 2] = bitmap.pixels[from + 2];
      data[to + 3] = 255;
    }
  }

  // One circle per shown object, in the preview's category colour with a dark
  // ring. The ring is never an owner's colour. `object.player` is the player
  // whose frame the object was placed for, which a gaia resource placed with
  // set_place_for_every_player carries too, and the preview gives no way to
  // tell that from a really owned object. Every object drawn here is a resource,
  // and a coloured ring on a gaia one would call it a player's.
  for (const object of result.objects) {
    if (!isPictureObject(object)) continue;
    const cx = (object.x + object.y + 1) * HALF_WIDTH;
    const cy = (object.y - object.x) * HALF_WIDTH + dim * HALF_WIDTH;
    const ring = OBJECT_RING_COLOR;
    fillCircle(data, size, cx, cy, OBJECT_RADIUS + OBJECT_RING, ring);
    fillCircle(data, size, cx, cy, OBJECT_RADIUS, objectColor(object));
  }

  // A disc two tiles across at each player, drawn in tile space and then
  // projected, so it is a diamond like every other tile.
  for (const player of result.players) {
    const { r, g, b } = playerColor(player.player);
    const color = [r, g, b];
    const radius = 2.5;
    for (
      let ty = Math.floor(player.y - radius);
      ty <= player.y + radius;
      ty++
    ) {
      for (
        let tx = Math.floor(player.x - radius);
        tx <= player.x + radius;
        tx++
      ) {
        if ((tx - player.x) ** 2 + (ty - player.y) ** 2 > radius * radius)
          continue;
        if (tx < 0 || ty < 0 || tx >= dim || ty >= dim) continue;
        const u = tx + ty + 1;
        const v = ty - tx;
        for (let dy = 0; dy < HALF_WIDTH * 2; dy++) {
          for (let dx = 0; dx < HALF_WIDTH * 2; dx++) {
            // Cover the screen square the tile's diamond sits in, then keep
            // only the pixels inside the diamond.
            const sx = Math.round(u * HALF_WIDTH) - HALF_WIDTH + dx;
            const sy =
              Math.round(v * HALF_WIDTH + dim * HALF_WIDTH) - HALF_WIDTH + dy;
            if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
            const inside =
              Math.abs(sx + 0.5 - u * HALF_WIDTH) +
                Math.abs(sy + 0.5 - (v * HALF_WIDTH + dim * HALF_WIDTH)) <=
              HALF_WIDTH;
            if (!inside) continue;
            const to = (sy * size + sx) * 4;
            data[to] = color[0];
            data[to + 1] = color[1];
            data[to + 2] = color[2];
            data[to + 3] = 255;
          }
        }
      }
    }
  }

  return { width: size, height: size, data };
}

/** A filled circle in image pixels, clipped to the image. */
function fillCircle(
  data: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius * radius) continue;
      const to = (y * size + x) * 4;
      data[to] = color.r;
      data[to + 1] = color.g;
      data[to + 2] = color.b;
      data[to + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** An 8 bit RGBA PNG with no interlacing and filter 0 on every row, the simplest valid form. */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type, RGBA
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Reads back what `encodePng` writes, and nothing else. The test compares the
 * committed picture's PIXELS against a fresh render and never its bytes,
 * because zlib's output can differ between Node versions for the same input
 * and a byte comparison would go red on a machine that changed nothing.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = new DataView(body.buffer, body.byteOffset).getUint32(0);
      height = new DataView(body.buffer, body.byteOffset).getUint32(4);
    } else if (type === "IDAT") {
      idat.push(body);
    }
    at += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of idat) {
    joined.set(p, offset);
    offset += p.length;
  }
  const raw = inflateSync(joined);
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    data.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    );
  }
  return { width, height, data };
}
