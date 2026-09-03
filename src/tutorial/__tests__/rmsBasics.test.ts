// tutorial-design.md Sec.13 item 3, every `completion.test` in Tutorial A
// returns true against the finished Golden Hill fixture, and step n's test
// returns false against a fixture truncated right before step n's own edit.
// The second half is what makes the first half meaningful: a check that is
// always true would pass the first assertion for free.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { validate, type GameConstantsForValidate, type ValidateReferenceDb } from "../../parser/validate";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import type { ParseResult } from "../../parser/types";
import type { StepContext } from "../types";
import { rmsBasicsTutorial } from "../content/rmsBasics";

const lang = loadLanguage();
const gameConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as GameConstantsForValidate;
const refDb: ValidateReferenceDb = { language: lang, gameConstants };

const goldenHillSource = readFileSync(join(__dirname, "fixtures", "goldenHill.rms"), "utf8");
const goldenHillParse = parseRms(goldenHillSource, lang);

function ctxFor(parseResult: ParseResult | null, hasFile = true): StepContext {
  return {
    parseResult,
    source: parseResult?.source ?? "",
    activeTab: "breakdown",
    activeSectionId: null,
    hasFile,
  };
}

function sourceBefore(marker: string): string {
  const index = goldenHillSource.indexOf(marker);
  if (index === -1) throw new Error(`marker not found in goldenHill.rms: "${marker}"`);
  return goldenHillSource.slice(0, index);
}

function parseBefore(marker: string): ParseResult {
  return parseRms(sourceBefore(marker), lang);
}

function stepById(id: string) {
  const step = rmsBasicsTutorial.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no rms-basics step with id "${id}"`);
  return step;
}

/** Narrows a step's completion to "check" and returns its test function, throws if the step isn't a check step, which would mean this test file and the content have drifted apart. */
function checkOf(id: string): (ctx: StepContext) => boolean {
  const step = stepById(id);
  if (step.completion.kind !== "check") throw new Error(`step "${id}" is not a check step`);
  return step.completion.test;
}

describe("rms-basics — every check step is satisfied by the finished Golden Hill script", () => {
  it("goldenHill.rms itself parses with zero errors", () => {
    const errors = goldenHillParse.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("and validate() adds no errors either (Sec.16's zero-error acceptance criterion)", () => {
    const errors = validate(goldenHillParse, refDb).filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  // start-new-file is excluded: its check is keyed on EMPTINESS, so it is
  // by design the one check that's false against the finished script, see
  // the next describe block.
  it.each(
    rmsBasicsTutorial.steps.filter((s) => s.completion.kind === "check" && s.id !== "start-new-file").map((s) => s.id),
  )('step "%s" is satisfied', (id) => {
    expect(checkOf(id)(ctxFor(goldenHillParse))).toBe(true);
  });
});

describe("rms-basics — step 0 (start-new-file) is the one check keyed on emptiness, not addition", () => {
  const test = checkOf("start-new-file");

  it("is false with no file open at all", () => {
    expect(test(ctxFor(null, false))).toBe(false);
  });

  it("is true for a fresh, empty, saved file", () => {
    expect(test(ctxFor(parseRms("", lang), true))).toBe(true);
  });

  it("is false once the file has real content", () => {
    expect(test(ctxFor(goldenHillParse, true))).toBe(false);
  });
});

describe("rms-basics — every other check step is false before its own edit", () => {
  it("random-or-direct is false before random_placement is added", () => {
    expect(checkOf("random-or-direct")(ctxFor(parseBefore("random_placement")))).toBe(false);
  });

  it("player-lands is false before create_player_lands is added", () => {
    expect(checkOf("player-lands")(ctxFor(parseBefore("create_player_lands {")))).toBe(false);
  });

  it("hill-in-the-middle is false before create_land is added", () => {
    expect(checkOf("hill-in-the-middle")(ctxFor(parseBefore("create_land {")))).toBe(false);
  });

  it("hills is false before create_elevation is added", () => {
    expect(checkOf("hills")(ctxFor(parseBefore("create_elevation 4 {")))).toBe(false);
  });

  it("cliffs is false before the cliff settings are added", () => {
    expect(checkOf("cliffs")(ctxFor(parseBefore("min_number_of_cliffs 3")))).toBe(false);
  });

  it("trees is false before create_terrain is added", () => {
    expect(checkOf("trees")(ctxFor(parseBefore("create_terrain FOREST {")))).toBe(false);
  });

  it("road-to-hill is false before create_connect_to_nonplayer_land is added", () => {
    expect(checkOf("road-to-hill")(ctxFor(parseBefore("create_connect_to_nonplayer_land {")))).toBe(false);
  });

  it("starting-units is false before TOWN_CENTER/VILLAGER/SCOUT are added", () => {
    expect(checkOf("starting-units")(ctxFor(parseBefore("create_object TOWN_CENTER {")))).toBe(false);
  });

  it("gold-on-the-hill is false before the first GOLD placement is added", () => {
    expect(checkOf("gold-on-the-hill")(ctxFor(parseBefore("create_object GOLD {")))).toBe(false);
  });

  it("everyone-elses-resources is false before FORAGE_BUSH/STONE are added", () => {
    expect(checkOf("everyone-elses-resources")(ctxFor(parseBefore("create_object FORAGE_BUSH {")))).toBe(false);
  });
});
