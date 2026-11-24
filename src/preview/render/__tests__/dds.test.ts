// The DDS decoder against blocks built by hand, where the right answer is
// known texel by texel, and against the install's own textures when one is on
// this disk, where the right answer is the average colour tools/extract-constants
// measured with Pillow's decoder (docs/preview-de-textures-design.md Sec.5).

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import gameConstants from "../../../../reference/data/game-constants.json";
import {
  UnsupportedDdsError,
  chooseLevel,
  decodeDdsAtMost,
  decodeDdsLevel,
  halve,
  parseDdsHeader,
} from "../dds";
import { decodeBc7Block } from "../bc7";
import bc7Blocks from "./bc7Blocks.json";

/** A DDS file around `data`, with the header fields the decoder reads. */
function ddsFile(options: {
  width: number;
  height: number;
  mips?: number;
  fourCC?: string;
  rgbMask?: number;
  data: number[];
}): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(12, options.height, true);
  view.setUint32(16, options.width, true);
  view.setUint32(28, options.mips ?? 1, true);
  if (options.fourCC !== undefined) {
    view.setUint32(80, 0x4, true);
    for (let i = 0; i < 4; i++) header[84 + i] = options.fourCC.charCodeAt(i);
  } else {
    view.setUint32(80, 0x40 | 0x1, true);
    view.setUint32(88, 32, true);
    view.setUint32(92, options.rgbMask ?? 0x00ff0000, true);
  }
  const out = new Uint8Array(128 + options.data.length);
  out.set(header);
  out.set(options.data, 128);
  return out;
}

const RED_565 = 0xf800;
const BLUE_565 = 0x001f;

describe("DXT1", () => {
  it("decodes four colours when the first end colour is larger", () => {
    // Indices 0,1,2,3 along the first row, 0 everywhere else.
    const bytes = ddsFile({
      width: 4,
      height: 4,
      fourCC: "DXT1",
      data: [
        RED_565 & 255,
        RED_565 >> 8,
        BLUE_565 & 255,
        BLUE_565 >> 8,
        0b11100100,
        0,
        0,
        0,
      ],
    });
    const image = decodeDdsLevel(bytes, 0);
    const texel = (i: number) =>
      Array.from(image.pixels.slice(i * 4, i * 4 + 4));
    expect(texel(0)).toEqual([255, 0, 0, 255]);
    expect(texel(1)).toEqual([0, 0, 255, 255]);
    expect(texel(2)).toEqual([170, 0, 85, 255]);
    expect(texel(3)).toEqual([85, 0, 170, 255]);
    expect(texel(4)).toEqual([255, 0, 0, 255]);
  });

  it("uses three colours and transparent black when the first is not larger", () => {
    const bytes = ddsFile({
      width: 4,
      height: 4,
      fourCC: "DXT1",
      data: [
        BLUE_565 & 255,
        BLUE_565 >> 8,
        RED_565 & 255,
        RED_565 >> 8,
        0b11100100,
        0,
        0,
        0,
      ],
    });
    const image = decodeDdsLevel(bytes, 0);
    expect(Array.from(image.pixels.slice(8, 12))).toEqual([128, 0, 128, 255]);
    expect(Array.from(image.pixels.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it("reads the second level after the first", () => {
    // An 8 by 8 top level is four blocks of 8 bytes, the 4 by 4 level one more.
    const red = [RED_565 & 255, RED_565 >> 8, 0, 0, 0, 0, 0, 0];
    const blue = [BLUE_565 & 255, BLUE_565 >> 8, 0, 0, 0, 0, 0, 0];
    const bytes = ddsFile({
      width: 8,
      height: 8,
      mips: 2,
      fourCC: "DXT1",
      data: [...red, ...red, ...red, ...red, ...blue],
    });
    const image = decodeDdsLevel(bytes, 1);
    expect(image.width).toBe(4);
    expect(Array.from(image.pixels.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });
});

describe("DXT5", () => {
  it("interpolates alpha from the eight value table", () => {
    // a0 255 > a1 0, so index 2 is (6*255 + 0) / 7. Texel 0 takes index 2,
    // the rest index 0.
    const bytes = ddsFile({
      width: 4,
      height: 4,
      fourCC: "DXT5",
      data: [
        255,
        0,
        2,
        0,
        0,
        0,
        0,
        0,
        RED_565 & 255,
        RED_565 >> 8,
        0,
        0,
        0,
        0,
        0,
        0,
      ],
    });
    const image = decodeDdsLevel(bytes, 0);
    expect(image.pixels[3]).toBe(Math.round((6 * 255) / 7));
    expect(image.pixels[7]).toBe(255);
    expect(image.pixels[0]).toBe(255);
  });
});

describe("uncompressed", () => {
  it("swaps a BGRA file into RGBA", () => {
    const bytes = ddsFile({ width: 1, height: 1, data: [10, 20, 30, 40] });
    expect(Array.from(decodeDdsLevel(bytes, 0).pixels)).toEqual([
      30, 20, 10, 40,
    ]);
  });
});

// 64 blocks, eight of each mode, random apart from the mode bits, with the
// texels Pillow's BC7 decoder gave for each. A reference decoder rather than
// hand worked blocks, since a block's bit layout is the part most likely to
// be wrong and a hand worked block repeats whatever the author misread.
// docs/preview-de-textures-design.md Sec.10 says how they were made.
describe("BC7", () => {
  const blocks = bc7Blocks as [string, string][];
  const hex = (text: string) =>
    Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));

  it("matches the reference decoder on every mode", () => {
    const out = new Uint8Array(64);
    const modesSeen = new Set<number>();
    for (const [block, expected] of blocks) {
      const bytes = hex(block);
      modesSeen.add(Math.log2(bytes[0] & -bytes[0]));
      decodeBc7Block(bytes, 0, out);
      expect(Array.from(out)).toEqual(Array.from(hex(expected)));
    }
    expect([...modesSeen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reads a BC7 file through its DX10 header", () => {
    const dx10 = [98, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    const [block, expected] = blocks[blocks.length - 1];
    const bytes = ddsFile({
      width: 4,
      height: 4,
      fourCC: "DX10",
      data: [...dx10, ...hex(block)],
    });
    expect(parseDdsHeader(bytes).format).toBe("bc7");
    const image = decodeDdsLevel(bytes, 0);
    expect(Array.from(image.pixels)).toEqual(Array.from(hex(expected)));
  });

  it("decodes a block naming no mode as transparent black", () => {
    const out = new Uint8Array(64).fill(9);
    decodeBc7Block(new Uint8Array(16), 0, out);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe("refusals", () => {
  it("reports a DX10 format other than BC7 as unsupported", () => {
    // 71 is BC1 stored behind a DX10 header, which the install never does.
    const bytes = ddsFile({
      width: 4,
      height: 4,
      fourCC: "DX10",
      data: [71, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(() => parseDdsHeader(bytes)).toThrow(UnsupportedDdsError);
  });

  it("reports a file shorter than its header says", () => {
    const bytes = ddsFile({
      width: 8,
      height: 8,
      fourCC: "DXT1",
      data: [0, 0],
    });
    expect(() => decodeDdsLevel(bytes, 0)).toThrow(UnsupportedDdsError);
  });
});

describe("sizes", () => {
  it("chooses the first level no wider than the limit", () => {
    const header = {
      width: 2048,
      height: 2048,
      mipCount: 3,
      format: "dxt1" as const,
      dataOffset: 128,
    };
    expect(chooseLevel(header, 1024)).toBe(1);
    expect(chooseLevel({ ...header, width: 512 }, 1024)).toBe(0);
    expect(chooseLevel({ ...header, mipCount: 1 }, 1024)).toBe(0);
  });

  it("halves by averaging each 2 by 2 square", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0, 100, 100, 100, 100, 200, 200, 200, 200, 100, 100, 100, 100,
    ]);
    const half = halve({ width: 2, height: 2, pixels });
    expect(Array.from(half.pixels)).toEqual([100, 100, 100, 100]);
  });
});

// The real files. Skipped on a machine without DE, as the include gate is.
const TEXTURES =
  "C:/Program Files (x86)/Steam/steamapps/common/AoE2DE/resources/_common/terrain/textures";

interface TerrainRow {
  category: string;
  deTextureFile?: string | null;
  previewColor?: number[];
}

describe.skipIf(!existsSync(TEXTURES))("the install's textures", () => {
  const rows = (gameConstants as { constants: TerrainRow[] }).constants;
  // g_pm1 is BC7.
  const names = [
    "g_grs",
    "g_des",
    "g_sno",
    "g_wtr",
    "g_wt_yellow",
    "g_kf1",
    "g_pm1",
  ];
  for (const name of names) {
    it(`${name} averages to the extractor's colour`, () => {
      const row = rows.find(
        (r) => r.category === "terrain" && r.deTextureFile === name,
      );
      expect(row?.previewColor).toBeDefined();
      const path = existsSync(`${TEXTURES}/2x/${name}.dds`)
        ? `${TEXTURES}/2x/${name}.dds`
        : `${TEXTURES}/${name}.dds`;
      const image = decodeDdsAtMost(new Uint8Array(readFileSync(path)), 1024);
      expect(image.width).toBeLessThanOrEqual(1024);
      const sum = [0, 0, 0];
      let count = 0;
      for (let i = 0; i < image.pixels.length; i += 4) {
        if (image.pixels[i + 3] < 128) continue;
        for (let ch = 0; ch < 3; ch++) sum[ch] += image.pixels[i + ch];
        count++;
      }
      const mean = sum.map((s) => s / count);
      // A different mip level and decoder, so a few units of slack.
      mean.forEach((m, ch) =>
        expect(Math.abs(m - row!.previewColor![ch])).toBeLessThan(6),
      );
    });
  }
});
