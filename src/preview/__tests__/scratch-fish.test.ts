// SCRATCH — delete before finishing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import { waterDepthMask, isBeachTerrain, DEPTH_WATER, DEPTH_HYBRID, type TerrainConstantForMasks } from "../generator/grid";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);
const raw = JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as {
  constants: ObjectConstant[];
};
const constants = raw.constants;

describe("scratch fish", () => {
  it("reports", () => {
    const src = readFileSync(join(REPO_ROOT, "test-maps", "QS_Three_Bays_v1.1.rms"), "utf8");
    const parse = parseRms(src, lang);
    const OCEAN = new Set(["TUNA", "SNAPPER", "SALMON", "DORADO", "MARLIN1", "OYSTERS"]);
    const stripped = constants.map((c) => (OCEAN.has(c.rmsConstant ?? "") ? { ...c, habitat: undefined } : c));
    const useOld = process.env.OLD_HABITAT === "1";
    const refDb: PreviewReferenceData = { language, constants: useOld ? stripped : constants };
    const r = generatePreview(parse, refDb, { playerCount: 4, mapSize: "Normal", teams: DEFAULT_TEAMS }, { seed: 7, collectSnapshots: true });
    const snap = r.snapshots!.find((s) => s.stage === "S6")!;
    const dim = r.dim;
    const grid = { dim, terrain: snap.terrain } as never;
    const { depth } = waterDepthMask(grid, constants as unknown as TerrainConstantForMasks[]);

    const lines: string[] = [];
    const byName = new Map<string, number[]>();
    for (const o of r.objects) {
      if (!/FISH|TUNA|SNAPPER|OYSTER|TURTLE|MARLIN|DORADO|SALMON/i.test(o.objectRef)) continue;
      const arr = byName.get(o.objectRef) ?? [];
      arr.push(o.y * dim + o.x);
      byName.set(o.objectRef, arr);
    }
    for (const [name, tiles] of [...byName].sort()) {
      let onBeach = 0;
      let onWater = 0;
      let onHybrid = 0;
      let onLand = 0;
      for (const i of tiles) {
        if (isBeachTerrain(constants as unknown as TerrainConstantForMasks[], snap.terrain[i])) onBeach++;
        else if (depth[i] === DEPTH_WATER) onWater++;
        else if (depth[i] === DEPTH_HYBRID) onHybrid++;
        else onLand++;
      }
      lines.push(`${name}: n=${tiles.length} beach=${onBeach} water=${onWater} hybrid=${onHybrid} otherLand=${onLand}`);
    }
    const fails = r.reports.flatMap((rep) => rep.failures ?? []).filter((f) => f.count > 0);
    const bucket = new Map<string, number>();
    for (const f of fails) bucket.set(f.bucket, (bucket.get(f.bucket) ?? 0) + f.count);
    lines.push("failure buckets: " + [...bucket].map(([k, v]) => `${k}=${v}`).join(" "));
    expect(lines.join("\n")).toBe("SHOW ME");
  }, 120000);
});
