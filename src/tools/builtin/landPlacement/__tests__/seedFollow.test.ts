// The seed follow gate (land-placement-seed-follow-brief.md item 3). The
// canvas draws from the emission, and the map under it is a real generation.
// With following on, the two must agree at every seed.
//
// How a placement is paired with its origin. A land's `create_land` carries
// `land_position ALP_X_<name> ALP_Y_<name>`, and the emission names the same
// X constant for the placement (`quantities`). The origin's `commandSpan`
// slices that text out of the script, so the pair is found by the X name and
// never by position in a list.
//
// Great_Bite is a local map, not tracked, so the gate skips where it is absent.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../parser/language";
import { parseRms } from "../../../../parser/parser";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import { createTileGrid } from "../../../../preview/generator/grid";
import { placeLandOrigins } from "../../../../preview/generator/lands";
import type { ObjectConstant } from "../../../../preview/generator/objects";
import { reservedNamesForApply } from "../applyEdits";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import { readFenceModel } from "../fence";
import { percentToTile } from "../panel/viewModel";

const MAP = join(
  REPO_ROOT,
  "test-maps",
  "Great_Bite_check_ARMS_matches_DE.rms",
);
const lang = loadLanguage();

describe.skipIf(!existsSync(MAP))(
  "shapes follow the seed on Great_Bite",
  () => {
    const source = existsSync(MAP) ? readFileSync(MAP, "utf8") : "";
    const parse = parseRms(source, lang);
    const constants = (
      JSON.parse(
        readFileSync(
          join(REPO_ROOT, "reference", "data", "game-constants.json"),
          "utf8",
        ),
      ) as { constants: ObjectConstant[] }
    ).constants;
    const refDb = buildLanguageIndex(lang);

    for (const seed of [1, 2, 3, 17, 999]) {
      it(`every land sits within one tile of its drawn position at seed ${seed}`, () => {
        const fenceModel = readFenceModel(parse);
        expect(fenceModel).not.toBeNull();
        const playerCount = 8;
        const instantiated = instantiateScript(
          parse,
          refDb,
          { playerCount, mapSize: "Normal", teams: [] },
          seed,
        );
        const emission = emitAlpModel(
          fenceModel!,
          new NameAllocator({ reserved: reservedNamesForApply(parse, lang) }),
          instantiated.symbols,
          playerCount,
          { followSeed: true, fenceModel },
        );
        expect(emission.ok).toBe(true);
        if (!emission.ok) return;
        expect(emission.paramsHeld).toBe(0);
        expect(emission.paramsRolled).toBeGreaterThan(0);

        const dim = instantiated.dim;
        const { origins } = placeLandOrigins(
          instantiated,
          createTileGrid(dim, 0),
          constants,
        );
        const byXName = new Map(
          fenceModel!.placements.map((p) => [
            emission.quantities.get(p.id)?.xName,
            p,
          ]),
        );
        let paired = 0;
        for (const origin of origins) {
          const text = source.slice(
            origin.commandSpan.start,
            origin.commandSpan.end,
          );
          const m = /land_position\s+(ALP_X_\S+)\s+(ALP_Y_\S+)/.exec(text);
          if (!m) continue;
          const placement = byXName.get(m[1]);
          expect(placement).toBeDefined();
          const q = emission.quantities.get(placement!.id)!;
          const drawn = {
            x: percentToTile(emission.resolved.get(q.xName)!, dim),
            y: percentToTile(emission.resolved.get(q.yName)!, dim),
          };
          expect(Math.abs(origin.x - drawn.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(origin.y - drawn.y)).toBeLessThanOrEqual(1);
          paired++;
        }
        expect(paired).toBeGreaterThan(0);
      });
    }
  },
);
