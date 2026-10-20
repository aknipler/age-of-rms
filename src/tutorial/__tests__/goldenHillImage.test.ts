// The picture on the "Your first random map" tutorial's first step must show
// the map the tutorial builds, as the preview draws it today. This renders the
// finished script (fixtures/goldenHill.rms) with the preview's own pipeline
// and compares it with the committed PNG, so a change to the engine, the
// palette or the script that alters the picture goes red here instead of
// leaving a stale image in front of every learner.
//
// To regenerate after an intended change, run this one file with
// UPDATE_GOLDEN_HILL_IMAGE=1 set, then look at public/tutorial/golden-hill.png.
//
// Two players on a Tiny map with no teams, written out here and not read from
// the app's defaults, so a later change to those cannot change the picture.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";
import { generatePreview } from "../../preview/generator/index";
import type { ObjectConstant } from "../../preview/generator/objects";
import {
  createTerrainPalette,
  playerColor,
  UNKNOWN_CATEGORY_COLOR,
  type TerrainConstant,
} from "../../preview/render/palette";
import {
  decodePng,
  encodePng,
  renderComeerImage,
  type RgbaImage,
} from "../landGenerationComeer/renderImage";
import {
  GOLDEN_HILL_IMAGE_SEED,
  GOLDEN_HILL_IMAGE_SRC,
} from "../content/rmsBasics";

/** The key the colour set below is built with. */
const rgbKey = (c: { r: number; g: number; b: number }) =>
  `${c.r},${c.g},${c.b}`;

const lang = loadLanguage();
const constants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;

const IMAGE_PATH = join(REPO_ROOT, "public", GOLDEN_HILL_IMAGE_SRC.slice(1));

function render(): RgbaImage {
  const source = readFileSync(
    join(__dirname, "fixtures", "goldenHill.rms"),
    "utf8",
  );
  const result = generatePreview(
    parseRms(source, lang),
    { language: buildLanguageIndex(lang), constants },
    {
      playerCount: 2,
      mapSize: "Tiny",
      teams: DEFAULT_TEAMS,
    },
    { seed: GOLDEN_HILL_IMAGE_SEED, collectSnapshots: true },
  );
  const palette = createTerrainPalette(
    constants as unknown as TerrainConstant[],
    "game",
  );
  return renderComeerImage(result, palette);
}

describe("the Golden Hill picture", () => {
  const fresh = render();

  it("is not blank, and has the terrain and every player in it", () => {
    const seen = new Set<string>();
    let opaque = 0;
    for (let i = 0; i < fresh.data.length; i += 4) {
      if (fresh.data[i + 3] === 0) continue;
      opaque++;
      seen.add(`${fresh.data[i]},${fresh.data[i + 1]},${fresh.data[i + 2]}`);
    }
    // A diamond is half the square it sits in.
    expect(opaque).toBeGreaterThan(fresh.width * fresh.height * 0.4);
    expect(seen.has(rgbKey(playerColor(1)))).toBe(true);
    expect(seen.has(rgbKey(playerColor(2)))).toBe(true);
    // Units and buildings are not drawn. The preview gives them the fallback
    // colour of an object it cannot categorise, a pale grey dot.
    expect(seen.has(rgbKey(UNKNOWN_CATEGORY_COLOR))).toBe(false);
    // Grass, dirt, forest and the road make more than a flat fill.
    expect(seen.size).toBeGreaterThan(8);
  });

  it("matches the committed public/tutorial/golden-hill.png", () => {
    if (process.env.UPDATE_GOLDEN_HILL_IMAGE === "1") {
      mkdirSync(dirname(IMAGE_PATH), { recursive: true });
      writeFileSync(IMAGE_PATH, encodePng(fresh));
    }
    expect(
      existsSync(IMAGE_PATH),
      "public/tutorial/golden-hill.png is missing. Run this file with UPDATE_GOLDEN_HILL_IMAGE=1.",
    ).toBe(true);
    const committed = decodePng(new Uint8Array(readFileSync(IMAGE_PATH)));
    expect(committed.width).toBe(fresh.width);
    expect(committed.height).toBe(fresh.height);
    // Pixels and not bytes, because zlib's output can differ between Node
    // versions for the same input.
    expect(
      Buffer.compare(Buffer.from(committed.data), Buffer.from(fresh.data)),
      "the committed picture is stale. Regenerate it with UPDATE_GOLDEN_HILL_IMAGE=1.",
    ).toBe(0);
  });
});
