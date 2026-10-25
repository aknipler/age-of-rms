// The replay gate for line and block prediction
// (docs/name-lookup-design.md Sec.13.7). Runs the shipped linePrediction.ts
// and blockTemplate.ts over the tracked maps the way Sec.13.1's probe ran
// over the whole corpus, and pins the two headline rates within one point
// of what they measured the day this was written. A gate built from the
// probe's own code would only test the probe.
//
// The tracked maps only, so CI measures the same maps as this disk. The
// whole-corpus figures (57 maps on the maintainer's disk) are in the design
// doc beside the probe's, and are not pinned.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import {
  replayBlocks,
  replayLines,
  TRACKED_PREDICTION_MAPS,
} from "./predictionMaps";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

/** Measured 2026-10-23 on the 12 tracked maps. 19,898 of 35,146 statements. */
const LINE_EXACT = 0.566;
/** Measured 2026-10-23 on the 12 tracked maps. 3,351 of 4,561 blocks. */
const BLOCK_SAME_NAMES = 0.735;
const TOLERANCE = 0.01;

describe("prediction replay over the tracked maps", () => {
  // About 30 s on this machine, most of it caretContext on AK_Vanguard's
  // 9,138 statements. Timeout set well clear of the load spread CLAUDE.md
  // records for this suite.
  it(
    "holds the line and block rates within a point",
    { timeout: 600_000 },
    () => {
      let statements = 0;
      let lineExact = 0;
      let blocks = 0;
      let sameNames = 0;
      for (const name of TRACKED_PREDICTION_MAPS) {
        const path = join(REPO_ROOT, "test-maps", name);
        expect(existsSync(path), `${name} is tracked and must exist`).toBe(
          true,
        );
        const source = readFileSync(path, "utf8");
        const parse = parseRms(source, langData);
        const l = replayLines(source, parse, lang);
        const b = replayBlocks(source, parse, lang, langData);
        statements += l.statements;
        lineExact += l.exact;
        blocks += b.blocks;
        sameNames += b.sameNames;
      }
      const lineRate = lineExact / statements;
      const blockRate = sameNames / blocks;
      expect(
        Math.abs(lineRate - LINE_EXACT),
        `lines exactly right ${(100 * lineRate).toFixed(1)}%, pinned ${(100 * LINE_EXACT).toFixed(1)}%`,
      ).toBeLessThanOrEqual(TOLERANCE);
      expect(
        Math.abs(blockRate - BLOCK_SAME_NAMES),
        `blocks with the same names in order ${(100 * blockRate).toFixed(1)}%, pinned ${(100 * BLOCK_SAME_NAMES).toFixed(1)}%`,
      ).toBeLessThanOrEqual(TOLERANCE);
    },
  );
});
