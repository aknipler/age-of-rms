// Builds the `generate` function seedCheck.ts takes, from reference data the
// caller already has. The worker passes the JSON it imports and the test passes
// what it read from disk, so both run the same parse and the same pipeline with
// no second copy of the wiring to drift.

import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageData } from "../../parser/language";
import { generatePreview } from "../../preview/generator/index";
import type { ObjectConstant } from "../../preview/generator/objects";
import { findTeamPreset } from "../../generationSettings/generationSettingsConstants";
import { COMEER_MAP_SIZE, COMEER_TEAM_PRESET } from "./comeerValues";
import type { SeedCheckGenerate, SeedCheckDeps } from "./seedCheck";

export function createSeedCheckDeps(
  languageData: LanguageData,
  constants: readonly ObjectConstant[],
): SeedCheckDeps {
  const preset = findTeamPreset(COMEER_TEAM_PRESET);
  if (preset === undefined) {
    // A renamed preset id would otherwise surface as 2 players on the wrong
    // teams and a quietly different map. Fail loudly instead.
    throw new Error(`no team preset "${COMEER_TEAM_PRESET}"`);
  }
  const refDb = {
    language: buildLanguageIndex(languageData),
    constants,
  };
  const generate: SeedCheckGenerate = (source, seed, snapshots) =>
    generatePreview(
      parseRms(source, languageData),
      refDb,
      {
        playerCount: preset.playerCount ?? 2,
        mapSize: COMEER_MAP_SIZE,
        teams: preset.teams,
      },
      { seed, collectSnapshots: snapshots },
    );

  const water = constants.find(
    (c) => c.category === "terrain" && c.rmsConstant === "WATER",
  );
  if (water?.constId == null) throw new Error("no WATER terrain constant");
  return { generate, waterId: water.constId };
}
