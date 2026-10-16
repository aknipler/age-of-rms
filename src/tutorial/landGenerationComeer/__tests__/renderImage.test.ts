// The picture the Comeer tutorial opens with must show the map the tutorial
// builds, as the preview draws it today. This test renders the finished script
// and compares it with the committed PNG, so a change to the engine, the
// palette or the script that alters the picture goes red here instead of
// leaving a stale image in front of every learner.
//
// To regenerate after an intended change, run this one file with
// UPDATE_COMEER_IMAGE=1 set, then look at public/tutorial/comeer.png.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import type { ObjectConstant } from "../../../preview/generator/objects";
import {
  createTerrainPalette,
  type TerrainConstant,
} from "../../../preview/render/palette";
import { PINNED_COMEER_SEED } from "../comeerValues";
import { finishedComeerScript } from "../finishedScript";
import {
  decodePng,
  encodePng,
  renderComeerImage,
  type RgbaImage,
} from "../renderImage";
import { createSeedCheckDeps } from "../seedCheckGenerate";
import { COMEER_IMAGE_SRC } from "../tutorial";

const lang = loadLanguage();
const constants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;

const IMAGE_PATH = join(REPO_ROOT, "public", COMEER_IMAGE_SRC.slice(1));

function render(): RgbaImage {
  const deps = createSeedCheckDeps(lang, constants);
  const result = deps.generate(
    finishedComeerScript(lang),
    PINNED_COMEER_SEED,
    true,
  );
  const palette = createTerrainPalette(
    constants as unknown as TerrainConstant[],
    "game",
  );
  return renderComeerImage(result, palette);
}

describe("the Comeer picture", () => {
  const fresh = render();

  it("is not blank, and has land, water and both players in it", () => {
    const seen = new Set<string>();
    let opaque = 0;
    for (let i = 0; i < fresh.data.length; i += 4) {
      if (fresh.data[i + 3] === 0) continue;
      opaque++;
      seen.add(`${fresh.data[i]},${fresh.data[i + 1]},${fresh.data[i + 2]}`);
    }
    // A diamond is half the square it sits in.
    expect(opaque).toBeGreaterThan(fresh.width * fresh.height * 0.4);
    // The two player marker colours are in the picture.
    expect(seen.has("43,108,255")).toBe(true);
    expect(seen.has("224,48,48")).toBe(true);
    // More than a flat fill, so the water and the land read differently.
    expect(seen.size).toBeGreaterThan(5);
  });

  it("survives encoding and decoding unchanged", () => {
    const decoded = decodePng(encodePng(fresh));
    expect(decoded.width).toBe(fresh.width);
    expect(decoded.height).toBe(fresh.height);
    expect(
      Buffer.compare(Buffer.from(decoded.data), Buffer.from(fresh.data)),
    ).toBe(0);
  });

  it("matches the committed public/tutorial/comeer.png", () => {
    if (process.env.UPDATE_COMEER_IMAGE === "1") {
      mkdirSync(dirname(IMAGE_PATH), { recursive: true });
      writeFileSync(IMAGE_PATH, encodePng(fresh));
    }
    expect(
      existsSync(IMAGE_PATH),
      "public/tutorial/comeer.png is missing. Run this file with UPDATE_COMEER_IMAGE=1.",
    ).toBe(true);
    const committed = decodePng(new Uint8Array(readFileSync(IMAGE_PATH)));
    expect(committed.width).toBe(fresh.width);
    expect(committed.height).toBe(fresh.height);
    // Compared as pixels and not bytes, because zlib's output for the same
    // input can differ between Node versions and a byte comparison would go
    // red on a machine that changed nothing.
    expect(
      Buffer.compare(Buffer.from(committed.data), Buffer.from(fresh.data)),
      "the committed picture is stale. Regenerate it with UPDATE_COMEER_IMAGE=1.",
    ).toBe(0);
  });
});
