// Reads the DirectDraw Surface files DE keeps its terrain textures in, and
// decodes one mip level to plain RGBA. Pure. Bytes in, bytes out, no canvas
// and no DOM, so every format here is asserted in plain Node against blocks
// built by hand (docs/preview-de-textures-design.md Sec.5).
//
// The install holds four formats (Sec.2's table). DXT1, DXT5, BC7 and one
// uncompressed 32 bit file are decoded here, DXT3 too since it costs one more
// branch. BC7 has its own module, bc7.ts, since its mode tables are most of
// its length. Five pasture textures use it.

import { decodeBc7Block } from "./bc7";

/** One decoded image, RGBA, 4 bytes per texel, row major, the layout `ImageData` takes. */
export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export type DdsFormat = "dxt1" | "dxt3" | "dxt5" | "bc7" | "bgra32" | "rgba32";

/** DXGI's numbers for BC7, plain and sRGB. The sRGB flag changes nothing here. */
const DXGI_BC7 = new Set([98, 99]);
/** The DX10 extended header that follows the classic one. */
const DX10_HEADER_SIZE = 20;

export interface DdsHeader {
  width: number;
  height: number;
  /** Mip levels stored, at least 1. A header that says 0 has just the top level. */
  mipCount: number;
  format: DdsFormat;
  /** Byte offset of the top level's data. */
  dataOffset: number;
}

/** Thrown for a file this decoder will not read. The caller draws that terrain flat. */
export class UnsupportedDdsError extends Error {}

const MAGIC = 0x20534444; // "DDS " read as a little endian u32
const HEADER_SIZE = 4 + 124;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

function fourCC(text: string): number {
  return (
    text.charCodeAt(0) |
    (text.charCodeAt(1) << 8) |
    (text.charCodeAt(2) << 16) |
    (text.charCodeAt(3) << 24)
  );
}

/**
 * Reads the header. A `DataView` rather than a `Uint32Array` over the bytes,
 * because a typed array view needs its offset aligned to its element size and
 * reads in the machine's byte order. A DataView reads any offset and takes the
 * byte order as an argument, which is what parsing a file format wants.
 */
export function parseDdsHeader(bytes: Uint8Array): DdsHeader {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new UnsupportedDdsError("file is shorter than a DDS header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new UnsupportedDdsError("not a DDS file");
  }
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const mipCount = Math.max(1, view.getUint32(28, true));
  const pfFlags = view.getUint32(80, true);
  const code = view.getUint32(84, true);

  let format: DdsFormat;
  let dataOffset = HEADER_SIZE;
  if (pfFlags & DDPF_FOURCC) {
    if (code === fourCC("DXT1")) format = "dxt1";
    else if (code === fourCC("DXT3")) format = "dxt3";
    else if (code === fourCC("DXT5")) format = "dxt5";
    else if (code === fourCC("DX10")) {
      // The extended header names a DXGI format. 98 is BC7, the only one the
      // install uses, and the data starts past this extended header.
      if (bytes.byteLength < HEADER_SIZE + DX10_HEADER_SIZE) {
        throw new UnsupportedDdsError("file is shorter than a DX10 header");
      }
      const dxgi = view.getUint32(HEADER_SIZE, true);
      if (!DXGI_BC7.has(dxgi)) {
        throw new UnsupportedDdsError(`DXGI format ${dxgi} is not decoded`);
      }
      format = "bc7";
      dataOffset = HEADER_SIZE + DX10_HEADER_SIZE;
    } else {
      throw new UnsupportedDdsError("unknown compressed format");
    }
  } else if (pfFlags & DDPF_RGB && view.getUint32(88, true) === 32) {
    // Uncompressed. The red mask says which byte order the texels use.
    const redMask = view.getUint32(92, true);
    if (redMask === 0x00ff0000) format = "bgra32";
    else if (redMask === 0x000000ff) format = "rgba32";
    else throw new UnsupportedDdsError("unknown 32 bit channel layout");
  } else {
    throw new UnsupportedDdsError("unknown pixel format");
  }
  return { width, height, mipCount, format, dataOffset };
}

/** Bytes one level of the given size takes in the file. */
export function levelByteLength(
  format: DdsFormat,
  width: number,
  height: number,
): number {
  if (format === "bgra32" || format === "rgba32") return width * height * 4;
  const blocks =
    Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4));
  return blocks * (format === "dxt1" ? 8 : 16);
}

/** BC7 shares nothing with the DXT formats but the 4 by 4 block grid. */
function decodeBc7(
  data: Uint8Array,
  width: number,
  height: number,
): DecodedImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const block = new Uint8Array(64);
  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      decodeBc7Block(data, (by * blocksWide + bx) * 16, block);
      for (let ty = 0; ty < 4; ty++) {
        const y = by * 4 + ty;
        if (y >= height) break;
        for (let tx = 0; tx < 4; tx++) {
          const x = bx * 4 + tx;
          if (x >= width) continue;
          pixels.set(
            block.subarray((ty * 4 + tx) * 4, (ty * 4 + tx) * 4 + 4),
            (y * width + x) * 4,
          );
        }
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Which stored level to decode so the result is no wider than `maxSize`.
 * The first level that fits, or the smallest stored one when none does
 * (the caller then halves it, see `halveUntil`).
 */
export function chooseLevel(header: DdsHeader, maxSize: number): number {
  for (let level = 0; level < header.mipCount; level++) {
    if (Math.max(header.width >> level, 1) <= maxSize) return level;
  }
  return header.mipCount - 1;
}

/** Decodes one stored level of a DDS file to RGBA. */
export function decodeDdsLevel(bytes: Uint8Array, level: number): DecodedImage {
  const header = parseDdsHeader(bytes);
  if (level < 0 || level >= header.mipCount) {
    throw new UnsupportedDdsError(`level ${level} is not stored`);
  }
  let offset = header.dataOffset;
  for (let l = 0; l < level; l++) {
    offset += levelByteLength(
      header.format,
      Math.max(1, header.width >> l),
      Math.max(1, header.height >> l),
    );
  }
  const width = Math.max(1, header.width >> level);
  const height = Math.max(1, header.height >> level);
  const length = levelByteLength(header.format, width, height);
  if (offset + length > bytes.byteLength) {
    throw new UnsupportedDdsError("file is shorter than its header says");
  }
  const data = bytes.subarray(offset, offset + length);
  switch (header.format) {
    case "bgra32":
    case "rgba32":
      return decodeUncompressed(
        data,
        width,
        height,
        header.format === "bgra32",
      );
    case "bc7":
      return decodeBc7(data, width, height);
    default:
      return decodeBlocks(data, width, height, header.format);
  }
}

function decodeUncompressed(
  data: Uint8Array,
  width: number,
  height: number,
  swapRedBlue: boolean,
): DecodedImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = data[swapRedBlue ? i + 2 : i];
    pixels[i + 1] = data[i + 1];
    pixels[i + 2] = data[swapRedBlue ? i : i + 2];
    pixels[i + 3] = data[i + 3];
  }
  return { width, height, pixels };
}

/**
 * The three block formats share their colour half. Each 4 by 4 block stores
 * two RGB565 end colours and a 2 bit index per texel into a palette of four
 * built from them. DXT3 and DXT5 put an alpha half of 8 bytes in front.
 */
function decodeBlocks(
  data: Uint8Array,
  width: number,
  height: number,
  format: "dxt1" | "dxt3" | "dxt5",
): DecodedImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const blockBytes = format === "dxt1" ? 8 : 16;
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  // Reused per block rather than allocated per block, since a 1024 texture
  // has 65,536 of them.
  const palette = new Uint8Array(16);
  const alphas = new Uint8Array(16);

  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const block = (by * blocksWide + bx) * blockBytes;
      const colourAt = format === "dxt1" ? block : block + 8;
      if (format === "dxt3") readExplicitAlpha(data, block, alphas);
      else if (format === "dxt5") readInterpolatedAlpha(data, block, alphas);
      const opaqueOnly = format !== "dxt1";
      buildColourPalette(data, colourAt, palette, opaqueOnly);
      const indices =
        data[colourAt + 4] |
        (data[colourAt + 5] << 8) |
        (data[colourAt + 6] << 16) |
        // `>>> 0` keeps the top byte from turning the number negative, since
        // JavaScript's bit operators work on signed 32 bit integers.
        ((data[colourAt + 7] << 24) >>> 0);

      for (let ty = 0; ty < 4; ty++) {
        const y = by * 4 + ty;
        if (y >= height) break;
        for (let tx = 0; tx < 4; tx++) {
          const x = bx * 4 + tx;
          if (x >= width) continue;
          const texel = ty * 4 + tx;
          const index = (indices >>> (texel * 2)) & 3;
          const p = (y * width + x) * 4;
          pixels[p] = palette[index * 4];
          pixels[p + 1] = palette[index * 4 + 1];
          pixels[p + 2] = palette[index * 4 + 2];
          pixels[p + 3] =
            format === "dxt1" ? palette[index * 4 + 3] : alphas[texel];
        }
      }
    }
  }
  return { width, height, pixels };
}

function expand565(value: number, out: Uint8Array, at: number): void {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  // Copying the high bits into the empty low ones maps 31 to 255 exactly,
  // where a plain shift would top out at 248.
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
  out[at + 3] = 255;
}

/**
 * One DXT1 (BC1) block at `at` into `out`, 16 RGBA texels row major. Shared
 * with sld.ts, whose sprites store their colour in the same blocks. Index 3
 * of a three colour block is transparent, which is how a sprite's edges are
 * cut out.
 */
export function decodeBc1Block(
  data: Uint8Array,
  at: number,
  out: Uint8Array,
): void {
  const palette = new Uint8Array(16);
  buildColourPalette(data, at, palette, false);
  const indices =
    (data[at + 4] |
      (data[at + 5] << 8) |
      (data[at + 6] << 16) |
      (data[at + 7] << 24)) >>>
    0;
  for (let texel = 0; texel < 16; texel++) {
    const index = (indices >>> (texel * 2)) & 3;
    out.set(palette.subarray(index * 4, index * 4 + 4), texel * 4);
  }
}

/**
 * One BC4 block at `at` into `out`, 16 single channel texels. BC4 is DXT5's
 * alpha half on its own, which SLD uses for its shadow and player colour
 * layers.
 */
export function decodeBc4Block(
  data: Uint8Array,
  at: number,
  out: Uint8Array,
): void {
  readInterpolatedAlpha(data, at, out);
}

function buildColourPalette(
  data: Uint8Array,
  at: number,
  palette: Uint8Array,
  opaqueOnly: boolean,
): void {
  const c0 = data[at] | (data[at + 1] << 8);
  const c1 = data[at + 2] | (data[at + 3] << 8);
  expand565(c0, palette, 0);
  expand565(c1, palette, 4);
  // DXT1's one trick. When the first end colour is not the larger one, the
  // block uses three colours and index 3 is transparent black. DXT3 and DXT5
  // always use four, since their alpha lives elsewhere.
  const fourColours = opaqueOnly || c0 > c1;
  for (let ch = 0; ch < 3; ch++) {
    const a = palette[ch];
    const b = palette[4 + ch];
    if (fourColours) {
      palette[8 + ch] = Math.round((2 * a + b) / 3);
      palette[12 + ch] = Math.round((a + 2 * b) / 3);
    } else {
      palette[8 + ch] = Math.round((a + b) / 2);
      palette[12 + ch] = 0;
    }
  }
  palette[11] = 255;
  palette[15] = fourColours ? 255 : 0;
}

function readExplicitAlpha(
  data: Uint8Array,
  at: number,
  out: Uint8Array,
): void {
  for (let i = 0; i < 8; i++) {
    const byte = data[at + i];
    out[i * 2] = (byte & 15) * 17;
    out[i * 2 + 1] = (byte >> 4) * 17;
  }
}

function readInterpolatedAlpha(
  data: Uint8Array,
  at: number,
  out: Uint8Array,
): void {
  const a0 = data[at];
  const a1 = data[at + 1];
  const table = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++)
      table[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
  } else {
    for (let i = 1; i < 5; i++)
      table[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
    table[6] = 0;
    table[7] = 255;
  }
  // Sixteen 3 bit indices packed into 6 bytes, 48 bits, more than one 32 bit
  // integer holds. Two halves of 24 bits each, 8 texels apiece.
  for (let half = 0; half < 2; half++) {
    const base = at + 2 + half * 3;
    const bits = data[base] | (data[base + 1] << 8) | (data[base + 2] << 16);
    for (let i = 0; i < 8; i++)
      out[half * 8 + i] = table[(bits >> (i * 3)) & 7];
  }
}

/** Box filters an image to half size in each direction. */
export function halve(image: DecodedImage): DecodedImage {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 4; ch++) {
        const sx = Math.min(x * 2, image.width - 1);
        const sy = Math.min(y * 2, image.height - 1);
        const sx1 = Math.min(sx + 1, image.width - 1);
        const sy1 = Math.min(sy + 1, image.height - 1);
        const at = (px: number, py: number) =>
          image.pixels[(py * image.width + px) * 4 + ch];
        pixels[(y * width + x) * 4 + ch] =
          (at(sx, sy) + at(sx1, sy) + at(sx, sy1) + at(sx1, sy1) + 2) >> 2;
      }
    }
  }
  return { width, height, pixels };
}

/**
 * Enlarges an image to `size` a side by repeating texels. Only whole ratios
 * occur (512 and 1024 up to 1024), so nearest neighbour loses nothing a
 * smoother filter would keep, and the GPU's own filtering smooths it on screen.
 */
export function enlarge(image: DecodedImage, size: number): DecodedImage {
  if (image.width === size && image.height === size) return image;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * image.height) / size);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * image.width) / size);
      const from = (sy * image.width + sx) * 4;
      const to = (y * size + x) * 4;
      pixels[to] = image.pixels[from];
      pixels[to + 1] = image.pixels[from + 1];
      pixels[to + 2] = image.pixels[from + 2];
      pixels[to + 3] = image.pixels[from + 3];
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * The decoded texture no wider than `maxSize`, from the best stored level.
 * Halving covers a file that stores no small enough level, such as the
 * install's two DXT5 textures with no mips.
 */
export function decodeDdsAtMost(
  bytes: Uint8Array,
  maxSize: number,
): DecodedImage {
  const header = parseDdsHeader(bytes);
  let image = decodeDdsLevel(bytes, chooseLevel(header, maxSize));
  while (image.width > maxSize) image = halve(image);
  return image;
}
