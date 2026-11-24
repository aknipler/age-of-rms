import { decodeBc1Block, decodeBc4Block } from "./dds";

// Reads DE's SLD sprites, the format every object, tree and cliff is drawn
// from (docs/preview-de-textures-design.md Sec.12). Pure, like dds.ts, so it
// is tested in Node on the install's own files.
//
// An SLD file is a list of frames. Each frame has a canvas size and a hotspot,
// the canvas point that sits on the object's position, and up to five layers
// in a fixed order. This reads the three the preview draws. The main layer is
// the picture in DXT1 blocks, the shadow layer a darkness in BC4 blocks, and
// the player colour layer a BC4 mask of where the owner's colour shows. A
// layer covers a rectangle of the canvas in 4 by 4 blocks, and a short list
// of (skip, draw) pairs says which blocks are stored. A frame may keep the
// blocks it skips from the frame before it, which is how an animation stores
// only what changes.

const LAYER_MAIN = 0x01;
const LAYER_SHADOW = 0x02;
const LAYER_UNKNOWN = 0x04;
const LAYER_DAMAGE = 0x08;
const LAYER_PLAYER = 0x10;
/**
 * The layer flag that keeps skipped blocks from the previous frame. Bit 0 is
 * something else, set on nearly every shadow layer of a tree file, and
 * reading it as this flag patched each tree's shadow with blocks of the
 * unrelated variants before it (Sec.14).
 */
const REUSE_PREVIOUS = 0x80;

const LAYER_ORDER = [
  LAYER_MAIN,
  LAYER_SHADOW,
  LAYER_UNKNOWN,
  LAYER_DAMAGE,
  LAYER_PLAYER,
] as const;

/** Thrown for a file this reader will not read. The object then draws as its glyph. */
export class UnsupportedSldError extends Error {}

/** Where one layer's data sits, before decoding. */
interface LayerRef {
  /** Byte offset of the block command count. */
  commands: number;
  end: number;
  /** Canvas rectangle in pixels, x1, y1, x2, y2. */
  rect: [number, number, number, number];
  /** `REUSE_PREVIOUS` keeps skipped blocks from the previous frame's same layer. */
  flags: number;
}

interface FrameRef {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  layers: Map<number, LayerRef>;
}

/** One decoded layer, placed on its frame's canvas. */
export interface SldLayer {
  x: number;
  y: number;
  width: number;
  height: number;
  /** RGBA for the main layer, one byte a pixel for the others. */
  pixels: Uint8Array;
}

export interface SldFrame {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  main: SldLayer | null;
  shadow: SldLayer | null;
  player: SldLayer | null;
}

/**
 * A parsed SLD file. The frame table is read up front, cheap, and frames are
 * decoded on request, since a tree's file holds dozens and the preview shows
 * one or two of them.
 */
export class SldFile {
  readonly frameCount: number;
  private readonly frames: FrameRef[] = [];
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.byteLength < 16) throw new UnsupportedSldError("too short");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const signature = String.fromCharCode(...bytes.subarray(0, 4));
    if (signature !== "SLDX") throw new UnsupportedSldError("not an SLD file");
    const version = this.view.getUint16(4, true);
    if (version !== 4)
      throw new UnsupportedSldError(`SLD version ${version} is not read`);
    this.frameCount = this.view.getUint16(6, true);
    // The header's own length, 16 in every file the install holds.
    let at = this.view.getUint16(10, true);
    for (let i = 0; i < this.frameCount; i++) {
      const frame: FrameRef = {
        width: this.view.getUint16(at, true),
        height: this.view.getUint16(at + 2, true),
        hotspotX: this.view.getInt16(at + 4, true),
        hotspotY: this.view.getInt16(at + 6, true),
        layers: new Map(),
      };
      const kinds = bytes[at + 8];
      at += 12;
      let mainRect: LayerRef["rect"] | null = null;
      for (const kind of LAYER_ORDER) {
        if ((kinds & kind) === 0) continue;
        const length = this.view.getUint32(at, true);
        const end = at + length;
        if (length < 4 || end > bytes.byteLength)
          throw new UnsupportedSldError("layer runs past the end of the file");
        // The main and shadow layers carry their own rectangle. The damage
        // and player layers reuse the main layer's.
        const ownRect =
          kind === LAYER_MAIN ||
          kind === LAYER_SHADOW ||
          kind === LAYER_UNKNOWN;
        if (ownRect) {
          const rect: LayerRef["rect"] = [
            this.view.getUint16(at + 4, true),
            this.view.getUint16(at + 6, true),
            this.view.getUint16(at + 8, true),
            this.view.getUint16(at + 10, true),
          ];
          if (kind === LAYER_MAIN) mainRect = rect;
          frame.layers.set(kind, {
            commands: at + 14,
            end,
            rect,
            flags: bytes[at + 12],
          });
        } else if (mainRect !== null) {
          frame.layers.set(kind, {
            commands: at + 6,
            end,
            rect: mainRect,
            flags: bytes[at + 4],
          });
        }
        // Layers start on 4 byte boundaries.
        at = end + ((4 - (length % 4)) % 4);
      }
      this.frames.push(frame);
    }
  }

  /** The frame's size and hotspot without decoding its pixels. */
  frameInfo(index: number): Omit<SldFrame, "main" | "shadow" | "player"> {
    const f = this.frames[index];
    if (f === undefined) throw new UnsupportedSldError(`no frame ${index}`);
    return {
      width: f.width,
      height: f.height,
      hotspotX: f.hotspotX,
      hotspotY: f.hotspotY,
    };
  }

  decodeFrame(index: number): SldFrame {
    const info = this.frameInfo(index);
    return {
      ...info,
      main: this.decodeLayer(index, LAYER_MAIN),
      shadow: this.decodeLayer(index, LAYER_SHADOW),
      player: this.decodeLayer(index, LAYER_PLAYER),
    };
  }

  /**
   * A layer of frame `index`, with any blocks it keeps from earlier frames
   * filled in. The chain back to the last frame that stores everything is
   * decoded oldest first.
   */
  private decodeLayer(index: number, kind: number): SldLayer | null {
    const chain: LayerRef[] = [];
    for (let i = index; i >= 0 && chain.length < 512; i--) {
      const layer = this.frames[i].layers.get(kind);
      if (layer === undefined) break;
      chain.push(layer);
      if ((layer.flags & REUSE_PREVIOUS) === 0) break;
    }
    if (chain.length === 0) return null;
    let previous: SldLayer | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      previous = this.decodeOne(
        chain[i],
        kind,
        (chain[i].flags & REUSE_PREVIOUS) !== 0 ? previous : null,
      );
    }
    return previous !== null && previous.width > 0 && previous.height > 0
      ? previous
      : null;
  }

  private decodeOne(
    layer: LayerRef,
    kind: number,
    reuse: SldLayer | null,
  ): SldLayer {
    const [x1, y1, x2, y2] = layer.rect;
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    const channels = kind === LAYER_MAIN ? 4 : 1;
    const pixels = new Uint8Array(width * height * channels);
    const out: SldLayer = { x: x1, y: y1, width, height, pixels };
    if (width === 0 || height === 0) return out;
    const blocksWide = Math.ceil(width / 4);
    const blockCount = blocksWide * Math.ceil(height / 4);
    const count = this.view.getUint16(layer.commands, true);
    let data = layer.commands + 2 + count * 2;
    let position = 0;
    const block = new Uint8Array(64);
    for (let c = 0; c < count; c++) {
      const skip = this.bytes[layer.commands + 2 + c * 2];
      const draw = this.bytes[layer.commands + 3 + c * 2];
      if (position + skip + draw > blockCount)
        throw new UnsupportedSldError("block commands run past the layer");
      if (reuse !== null)
        for (let b = position; b < position + skip; b++)
          copyReused(out, reuse, b, blocksWide, channels);
      position += skip;
      for (let d = 0; d < draw; d++) {
        if (data + 8 > layer.end)
          throw new UnsupportedSldError("blocks run past the layer");
        if (channels === 4) decodeBc1Block(this.bytes, data, block);
        else decodeBc4Block(this.bytes, data, block);
        blit(out, block, position, blocksWide, channels);
        data += 8;
        position++;
      }
    }
    // Blocks after the last command are skipped too, and kept the same way.
    if (reuse !== null)
      for (let b = position; b < blockCount; b++)
        copyReused(out, reuse, b, blocksWide, channels);
    return out;
  }
}

function blit(
  out: SldLayer,
  block: Uint8Array,
  index: number,
  blocksWide: number,
  channels: number,
): void {
  const bx = (index % blocksWide) * 4;
  const by = Math.floor(index / blocksWide) * 4;
  for (let row = 0; row < 4; row++) {
    const y = by + row;
    if (y >= out.height) break;
    for (let col = 0; col < 4; col++) {
      const x = bx + col;
      if (x >= out.width) break;
      const to = (y * out.width + x) * channels;
      const from = (row * 4 + col) * channels;
      for (let c = 0; c < channels; c++) out.pixels[to + c] = block[from + c];
    }
  }
}

/** Copies block `index` of `out` from the same canvas pixels of `source`. */
function copyReused(
  out: SldLayer,
  source: SldLayer,
  index: number,
  blocksWide: number,
  channels: number,
): void {
  const bx = (index % blocksWide) * 4;
  const by = Math.floor(index / blocksWide) * 4;
  for (let row = 0; row < 4; row++) {
    const y = by + row;
    if (y >= out.height) break;
    const sy = out.y + y - source.y;
    if (sy < 0 || sy >= source.height) continue;
    for (let col = 0; col < 4; col++) {
      const x = bx + col;
      if (x >= out.width) break;
      const sx = out.x + x - source.x;
      if (sx < 0 || sx >= source.width) continue;
      const to = (y * out.width + x) * channels;
      const from = (sy * source.width + sx) * channels;
      for (let c = 0; c < channels; c++)
        out.pixels[to + c] = source.pixels[from + c];
    }
  }
}
