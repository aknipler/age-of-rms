// THROWAWAY, delete after reading. Shipped generator on RMSTEST_73, min Chebyshev gap to the non-declaring ICE walls.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview } from "../generator/index";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

it("rmstest73 probe", () => {
  const lang = loadLanguage();
  const language = buildLanguageIndex(lang);
  const { constants } = JSON.parse(readFileSync(join(REPO_ROOT, "reference/data/game-constants.json"), "utf8"));
  const id = (n: string) => constants.find((c: { rmsConstant?: string }) => c.rmsConstant === n).constId as number;
  const src = readFileSync(join(REPO_ROOT, "tools/scenario-probe/rmstest/RMSTEST_73_other_zone_avoidance_distance_take_3.rms"), "utf8");
  const lines: string[] = [];
  for (const seed of [1, 2, 3]) {
    const r = generatePreview(parseRms(src, lang), { language, constants }, { playerCount: 2, mapSize: "Normal", teams: DEFAULT_TEAMS }, { seed, collectSnapshots: true });
    const s1 = r.snapshots!.find((s) => s.stage === "S1")!;
    const dim = r.grid.dim, ice = id("ICE");
    const iceTiles: number[] = [];
    for (let t = 0; t < dim * dim; t++) if (s1.terrain[t] === ice) iceTiles.push(t);
    const out: string[] = [];
    for (const [name, declared] of [["DIRT", 6], ["WATER", 10], ["DLC_SAVANNAH", 12]] as const) {
      const tid = id(name);
      let best = 1e9, count = 0;
      for (let t = 0; t < dim * dim; t++) {
        if (s1.terrain[t] !== tid) continue;
        count++;
        const x = t % dim, y = (t / dim) | 0;
        for (const u of iceTiles) best = Math.min(best, Math.max(Math.abs((u % dim) - x), Math.abs(((u / dim) | 0) - y)));
      }
      out.push(`${name} declared ${declared} tiles ${count} gap ${best} (DE ${declared + 1})`);
    }
    lines.push(`dim ${dim} seed ${seed}: ${out.join(" | ")}`);
  }
  writeFileSync("C:/Users/assas/AppData/Local/Temp/claude/C--Users-assas-Documents-AOE2-projects-RMS/5d5e7765-46c0-4e50-81b7-e8281095d528/scratchpad/rmstest73_shipped.txt", lines.join("\n") + "\n");
}, 120000);
