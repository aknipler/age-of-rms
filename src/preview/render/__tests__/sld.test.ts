// The SLD reader against a file built by hand, where every byte's meaning is
// known, and against the install's own sprites when DE is on this disk
// (docs/preview-de-textures-design.md Sec.12).

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SldFile, UnsupportedSldError } from "../sld";

const RED_565 = 0xf800;
const BLUE_565 = 0x001f;

/** A DXT1 block of one solid colour, all indices 0. */
function solidBlock(colour565: number): number[] {
  return [colour565 & 255, colour565 >> 8, 0, 0, 0, 0, 0, 0];
}

/** A BC4 block of one value, both end values equal and all indices 0. */
function bc4Block(value: number): number[] {
  return [value, value, 0, 0, 0, 0, 0, 0];
}

function u16(v: number): number[] {
  return [v & 255, (v >> 8) & 255];
}
function u32(v: number): number[] {
  return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
}

/** A layer with its length prefix, padded to 4 bytes. */
function layer(body: number[]): number[] {
  const bytes = [...u32(body.length + 4), ...body];
  while (bytes.length % 4 !== 0) bytes.push(0);
  return bytes;
}

/**
 * Two frames on an 8 by 4 canvas, two blocks wide. Frame 0 draws both
 * blocks red and has a player layer. Frame 1 sets the reuse flag, skips the
 * first block and draws the second blue, so its first block must come from
 * frame 0.
 */
function handBuiltSld(reuseFlag = 0x80): Uint8Array {
  const header = [..."SLDX"].map((c) => c.charCodeAt(0));
  header.push(...u16(4), ...u16(2), ...u16(0), ...u16(16), ...u32(0));
  const frame0 = [
    ...u16(8),
    ...u16(4),
    ...u16(4),
    ...u16(3),
    0x01 | 0x10,
    0,
    ...u16(0),
    ...layer([
      ...u16(0),
      ...u16(0),
      ...u16(8),
      ...u16(4),
      0,
      0,
      ...u16(1),
      0,
      2,
      ...solidBlock(RED_565),
      ...solidBlock(RED_565),
    ]),
    ...layer([0, 0, ...u16(1), 1, 1, ...bc4Block(200)]),
  ];
  const frame1 = [
    ...u16(8),
    ...u16(4),
    ...u16(4),
    ...u16(3),
    0x01,
    0,
    ...u16(1),
    ...layer([
      ...u16(0),
      ...u16(0),
      ...u16(8),
      ...u16(4),
      reuseFlag,
      0,
      ...u16(1),
      1,
      1,
      ...solidBlock(BLUE_565),
    ]),
  ];
  return Uint8Array.from([...header, ...frame0, ...frame1]);
}

describe("a hand built SLD", () => {
  const sld = new SldFile(handBuiltSld());

  it("reads the frame table, canvas and hotspot", () => {
    expect(sld.frameCount).toBe(2);
    expect(sld.frameInfo(0)).toEqual({
      width: 8,
      height: 4,
      hotspotX: 4,
      hotspotY: 3,
    });
  });

  it("decodes the main layer's blocks into place", () => {
    const main = sld.decodeFrame(0).main!;
    expect([main.width, main.height]).toEqual([8, 4]);
    expect(Array.from(main.pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(main.pixels.slice(7 * 4, 8 * 4))).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("places the player layer on the main layer's rectangle, skipping blocks", () => {
    const player = sld.decodeFrame(0).player!;
    expect([player.x, player.y, player.width]).toEqual([0, 0, 8]);
    // The command skipped the first block and drew the second.
    expect(player.pixels[0]).toBe(0);
    expect(player.pixels[4]).toBe(200);
  });

  it("keeps a skipped block from the frame before when the reuse flag is set", () => {
    const main = sld.decodeFrame(1).main!;
    // Block 0 came from frame 0 (red), block 1 is frame 1's own (blue).
    expect(Array.from(main.pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(main.pixels.slice(4 * 4, 5 * 4))).toEqual([
      0, 0, 255, 255,
    ]);
    expect(sld.decodeFrame(1).player).toBeNull();
  });

  it("keeps nothing when only bit 0 is set, which is not the reuse flag", () => {
    // Nearly every shadow layer in a tree file sets bit 0. Read as reuse it
    // filled each variant's skipped blocks with the variants before it.
    const main = new SldFile(handBuiltSld(0x01)).decodeFrame(1).main!;
    expect(main.pixels[3]).toBe(0);
    expect(Array.from(main.pixels.slice(4 * 4, 5 * 4))).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("refuses a file that is not an SLD", () => {
    expect(() => new SldFile(new Uint8Array(32))).toThrow(UnsupportedSldError);
  });
});

const GRAPHICS =
  "C:/Program Files (x86)/Steam/steamapps/common/AoE2DE/resources/_common/drs/graphics";

describe.skipIf(!existsSync(GRAPHICS))("the install's sprites", () => {
  it("decodes a tree with its shadow and a hotspot at its foot", () => {
    const sld = new SldFile(
      new Uint8Array(readFileSync(`${GRAPHICS}/n_tree_acacia_x1.sld`)),
    );
    expect(sld.frameCount).toBeGreaterThan(1);
    const frame = sld.decodeFrame(0);
    expect(frame.main).not.toBeNull();
    expect(frame.shadow).not.toBeNull();
    // The trunk stands on the hotspot, so the picture is above it.
    expect(frame.main!.y + frame.main!.height).toBeLessThanOrEqual(
      frame.hotspotY + 16,
    );
    // DXT1's transparent index cuts the tree out of its rectangle.
    let clear = 0;
    for (let p = 3; p < frame.main!.pixels.length; p += 4)
      if (frame.main!.pixels[p] === 0) clear++;
    expect(clear).toBeGreaterThan(0);
  });

  it("fills a frame that reuses the one before, as the dragon tree's frame 4 does", () => {
    // Frame 4's main layer sets 0x80 over frame 3's rectangle. Decoded with
    // nothing kept, the tree had square holes in it on Pag.
    const sld = new SldFile(
      new Uint8Array(readFileSync(`${GRAPHICS}/n_tree_dragon_x1.sld`)),
    );
    const opaque = (frame: number) =>
      sld.decodeFrame(frame).main!.pixels.filter((v, i) => i % 4 === 3 && v > 0)
        .length;
    expect(opaque(4)).toBeGreaterThanOrEqual(opaque(3) * 0.9);
  });

  it("decodes a building's player colour layer", () => {
    const sld = new SldFile(
      new Uint8Array(
        readFileSync(`${GRAPHICS}/b_afri_town_center_age2_main_x1.sld`),
      ),
    );
    const frame = sld.decodeFrame(0);
    expect(frame.player).not.toBeNull();
    expect(Math.max(...frame.player!.pixels)).toBeGreaterThan(100);
  });
});
