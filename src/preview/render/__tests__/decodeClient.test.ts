// The decode client (decodeClient.ts) where no worker can be made, as in
// Node: it decodes inline with the same functions the worker runs, so a
// caller gets the same answer either way.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDdsAtMost, enlarge } from "../dds";
import { decodeDds, openSprite } from "../decodeClient";
import { SldFile } from "../sld";

const ROOT =
  "C:/Program Files (x86)/Steam/steamapps/common/AoE2DE/resources/_common";

describe.skipIf(!existsSync(ROOT))("decodeClient without a worker", () => {
  it("decodes a texture exactly as the direct decode does", async () => {
    const folder = `${ROOT}/terrain/textures/2x`;
    const name = readdirSync(folder).find((n) => n.endsWith(".dds"))!;
    const bytes = new Uint8Array(readFileSync(`${folder}/${name}`));
    const direct = enlarge(decodeDdsAtMost(bytes.slice(), 256), 256);
    const viaClient = await decodeDds(bytes, 256);
    expect([viaClient.width, viaClient.height]).toEqual([256, 256]);
    expect(
      Buffer.from(viaClient.pixels).equals(Buffer.from(direct.pixels)),
    ).toBe(true);
  });

  it("opens a sprite file and reports its frame count", async () => {
    const bytes = new Uint8Array(
      readFileSync(`${ROOT}/drs/graphics/n_tree_acacia_x1.sld`),
    );
    const frames = new SldFile(bytes.slice()).frameCount;
    expect(await openSprite("n_tree_acacia_x1", bytes)).toBe(frames);
  });
});
