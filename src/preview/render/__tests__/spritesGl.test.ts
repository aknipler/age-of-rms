// The pure halves of the GPU sprite renderer (spritesGl.ts). The drawing
// itself needs WebGL2, which Node lacks. It was checked in the browser
// against drawSprites' own picture (docs/preview-de-textures-design.md
// Sec.14.2).

import { describe, expect, it } from "vitest";
import type { SpriteLayer } from "../drawPreview";
import { spriteKey, type SpriteImage } from "../objectSprites";
import type { GroundHeights } from "../projection";
import {
  INSTANCE_FLOATS,
  buildSpriteInstances,
  packAtlas,
  type AtlasSlot,
} from "../spritesGl";

describe("packAtlas", () => {
  it("keeps every picture apart by the gutter and inside its page", () => {
    const sizes = Array.from({ length: 300 }, (_, i) => ({
      width: 60 + (i % 7) * 20,
      height: 40 + (i % 5) * 30,
    }));
    const slots = packAtlas(sizes, 1024, 16);
    const placed = slots.filter((s): s is AtlasSlot => s !== null);
    expect(placed).toHaveLength(300);
    expect(Math.max(...placed.map((s) => s.page))).toBeGreaterThan(0);
    for (const s of placed) {
      expect(s.x).toBeGreaterThanOrEqual(8);
      expect(s.y).toBeGreaterThanOrEqual(8);
      expect(s.x + s.width + 8).toBeLessThanOrEqual(1024);
      expect(s.y + s.height + 8).toBeLessThanOrEqual(1024);
    }
    // No two pictures on one page come within the gutter of each other.
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.page !== b.page) continue;
        const apart =
          a.x + a.width + 16 <= b.x ||
          b.x + b.width + 16 <= a.x ||
          a.y + a.height + 16 <= b.y ||
          b.y + b.height + 16 <= a.y;
        expect(apart).toBe(true);
      }
  });

  it("gives no slot to a picture larger than a page", () => {
    expect(packAtlas([{ width: 2000, height: 10 }], 1024, 16)).toEqual([null]);
  });
});

describe("buildSpriteInstances", () => {
  // Stand-ins for ImageBitmaps, which Node lacks. Only their identity is read.
  const picture = { width: 40, height: 30 } as unknown as ImageBitmap;
  const shadow = { width: 50, height: 20 } as unknown as ImageBitmap;
  const image: SpriteImage = {
    image: picture,
    x: -20,
    y: -28,
    shadow,
    shadowX: -40,
    shadowY: -10,
  };
  const slots = new Map<ImageBitmap, AtlasSlot>([
    [picture, { page: 0, x: 8, y: 8, width: 40, height: 30 }],
    [shadow, { page: 1, x: 100, y: 8, width: 50, height: 20 }],
  ]);
  const layer = (mirrored: boolean): SpriteLayer => ({
    parts: [
      {
        file: "t",
        frame: 0,
        mirrored,
        x: 3,
        y: 5,
        dx: 2,
        dy: 4,
        layer: 20,
        owner: 0,
        objectId: 7,
      },
    ],
    images: new Map([[spriteKey("t", 0, 0), image]]),
    glyphs: [],
    scaleOf: () => 0.5,
  });

  it("places a sprite as drawSprites does, scaled, in each pass", () => {
    const { shadows, images } = buildSpriteInstances(
      layer(false),
      (b) => slots.get(b) ?? null,
      undefined,
    );
    expect(images).toHaveLength(INSTANCE_FLOATS);
    expect(Array.from(images)).toEqual([
      8,
      2,
      0,
      (2 - 20) * 0.5,
      (4 - 28) * 0.5,
      20,
      15,
      8,
      8,
      48,
      38,
      0,
    ]);
    expect(Array.from(shadows.slice(3, 7))).toEqual([
      (2 - 40) * 0.5,
      (4 - 10) * 0.5,
      25,
      10,
    ]);
    expect(shadows[11]).toBe(1);
  });

  it("mirrors about the hotspot, offsets included, by flipping the texels", () => {
    const { images } = buildSpriteInstances(
      layer(true),
      (b) => slots.get(b) ?? null,
      undefined,
    );
    // drawSprites draws local x from -(dx + x + width) to -(dx + x).
    expect(images[3]).toBe(-(2 - 20 + 40) * 0.5);
    expect([images[7], images[9]]).toEqual([48, 8]);
  });

  it("lifts a sprite by the ground under it and leaves out hidden objects", () => {
    const ground: GroundHeights = {
      dim: 8,
      corners: new Float32Array(81).fill(2),
      maxLevel: 2,
    };
    expect(
      buildSpriteInstances(layer(false), (b) => slots.get(b) ?? null, ground)
        .images[2],
    ).toBe(2);
    const hidden = { ...layer(false), hiddenIds: new Set([7]) };
    expect(
      buildSpriteInstances(hidden, (b) => slots.get(b) ?? null, undefined)
        .images,
    ).toHaveLength(0);
  });
});
