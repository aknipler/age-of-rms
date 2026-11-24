// deObjects across the preview worker (deObjectsWire.ts). The textured view's
// sprites read them on the window's side, and the worker once left them out
// entirely, so every object drew as its glyph while every test passed.

import { describe, expect, it } from "vitest";
import { packDeObjects, unpackDeObjects } from "../generator/deObjectsWire";
import type { DeObjectRecord } from "../generator/types";

describe("deObjects on the wire", () => {
  it("unpacks exactly what was packed, every kind and fraction kept", () => {
    const objects: DeObjectRecord[] = [
      {
        id: 411,
        owner: 0,
        x: 12.5,
        y: 3.25,
        rotation: 1.5707963,
        frame: 7,
        status: 2,
        kind: "terrain",
      },
      {
        id: 264,
        owner: 0,
        x: 40.5,
        y: 41.5,
        rotation: 0,
        frame: 13,
        status: 2,
        kind: "cliff",
      },
      {
        id: 109,
        owner: 3,
        x: 60,
        y: 60,
        rotation: 0.785,
        frame: 0,
        status: 0,
        kind: "script",
      },
    ];
    expect(unpackDeObjects(packDeObjects(objects))).toEqual(objects);
  });

  it("packs into one buffer the worker can transfer", () => {
    const packed = packDeObjects([]);
    expect(packed).toBeInstanceOf(Float64Array);
    expect(unpackDeObjects(packed)).toEqual([]);
  });
});
