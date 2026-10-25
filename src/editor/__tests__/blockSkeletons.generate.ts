// `npm run generate:skeletons` (docs/name-lookup-design.md Sec.13.4.1).
// Parses every map on this disk with the real parser and writes
// reference/data/block-skeletons.json through Prettier. Run under its own
// Vitest config (vitest.skeletons.config.ts), as `measure:checker` is, so
// the parser and the JSON imports load the way they do in the tests. Named
// `.generate.ts`, not `.test.ts`, so `npm test` never picks it up and
// rewrites a committed file as a side effect of testing.
//
// The output is committed and the app reads only that. Re-run it when the
// corpus grows, the way game-constants.json is re-extracted from an install.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { expect, it } from "vitest";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import { buildSkeletons } from "../blockSkeletons";
import { isAppFixture } from "./predictionMaps";

const OUT = join(REPO_ROOT, "reference", "data", "block-skeletons.json");

function mapsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.rms2?$/i.test(e.name))
    .filter((e) => !isAppFixture(e.name))
    .map((e) => join(dir, e.name));
}

it("writes block-skeletons.json", async () => {
  const lang = loadLanguage();
  const dir = join(REPO_ROOT, "test-maps");
  const files = [...mapsIn(dir), ...mapsIn(join(dir, "local"))];
  const parses = files.map((f) => parseRms(readFileSync(f, "utf8"), lang));
  const data = buildSkeletons(parses);
  const options = (await resolveConfig(OUT)) ?? {};
  const text = await format(JSON.stringify(data), {
    ...options,
    filepath: OUT,
  });
  writeFileSync(OUT, text);
  console.log(
    `block-skeletons.json: ${data.skeletons.length} skeletons from ${data.maps} maps`,
  );
  expect(data.maps).toBeGreaterThan(0);
});
