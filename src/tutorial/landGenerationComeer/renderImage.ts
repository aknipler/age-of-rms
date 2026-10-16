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
import type { TerrainPalette } from "../../preview/render/palette";
import type { PreviewResult } from "../../preview/generator/types";

/** Screen pixels per tile half width. 3 makes the 120 tile map 720 pixels across. */
const HALF_WIDTH = 3;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

/** Colours for the player markers, player 1 first. Plain, since the preview draws these as flags, not tiles. */
const PLAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [43, 108, 255],
  [224, 48, 48],
];

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

  // A disc two tiles across at each player, drawn in tile space and then
  // projected, so it is a diamond like every other tile.
  for (const player of result.players) {
    const color = PLAYER_COLORS[(player.player - 1) % PLAYER_COLORS.length];
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
