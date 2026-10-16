// tutorial-islands-design.md Sec.7. Every `check` step is asserted false on
// the previous stage's script and true on its own, the finished script goes
// through the real generator, and the copy is checked for answers leaking out
// of their spoilers. Same pattern as rmsBasics.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import type { ObjectConstant } from "../../../preview/generator/objects";
import { getTutorial } from "../../registry";
import type { BodyBlock, StepContext, StepTextEdit } from "../../types";
import {
  COMEER,
  NEUTRAL_BORDER_FUZZINESS,
  NEUTRAL_BORDER_PICK,
  NEUTRAL_TOP_BORDER_FIX,
  OVERSIZED_BASE_SIZE,
  PINNED_COMEER_SEED,
  playerIslandTarget,
  playerLandsStepScript,
  largestPercentWithoutGrowth,
  RANGES,
  START_COMEER_SEED,
  startingSquareTiles,
} from "../comeerValues";
import { finishedComeerScript } from "../finishedScript";
import { appendRestOfScript } from "../restOfScript";
import { createSeedCheckDeps } from "../seedCheckGenerate";
import { landGenerationComeerTutorial as tutorial } from "../tutorial";
import { describeEditorTracks } from "../../__tests__/editorTracks";

const lang = loadLanguage();
const constants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;

function ctxFor(source: string, hasFile = true): StepContext {
  return {
    parseResult: parseRms(source, lang),
    source,
    activeTab: "breakdown",
    activeSectionId: null,
    hasFile,
  };
}

function check(stepId: string, source: string, hasFile = true): boolean {
  const step = tutorial.steps.find((s) => s.id === stepId);
  if (step === undefined) throw new Error(`no step ${stepId}`);
  if (step.completion.kind !== "check") throw new Error(`${stepId} is manual`);
  return step.completion.test(ctxFor(source, hasFile));
}

// ---------------------------------------------------------------------------
// The script at the end of each step
// ---------------------------------------------------------------------------

interface Land {
  fuzz?: number;
  border?: string;
  constLine?: boolean;
  baseSize?: number;
  avoid?: number;
  percent?: number;
  /** `behavior_version 1` in Player Setup, added at "Does the square count?". */
  versioned?: boolean;
}

function playerCommand(land: Land): string {
  const lines = [
    "create_player_lands {",
    "  terrain_type SNOW_SOFT",
    `  land_percent ${land.percent ?? 25}`,
    "  circle_radius 16 1",
  ];
  if (land.avoid !== undefined)
    lines.push(`  other_zone_avoidance_distance ${land.avoid}`);
  if (land.baseSize !== undefined) lines.push(`  base_size ${land.baseSize}`);
  if (land.fuzz !== undefined) lines.push(`  border_fuzziness ${land.fuzz}`);
  if (land.border !== undefined) {
    for (const side of ["left", "right", "top", "bottom"]) {
      lines.push(`  ${side}_border ${land.border}`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

function neutral(zone: number, position: string, extra: string[] = []): string {
  return [
    "create_land {",
    "  terrain_type SNOW",
    "  land_percent 6",
    `  land_position ${position}`,
    `  zone ${zone}`,
    "  other_zone_avoidance_distance 10",
    "  land_id 100",
    ...extra.map((e) => `  ${e}`),
    "}",
  ].join("\n");
}

function script(land: Land, neutrals: string[] = []): string {
  return [
    "<PLAYER_SETUP>",
    "random_placement",
    ...(land.versioned ? ["behavior_version 1"] : []),
    "",
    "<LAND_GENERATION>",
    "base_terrain WATER",
    ...(land.constLine ? ["#const BORDERS_PL 12"] : []),
    playerCommand(land),
    ...neutrals,
    "",
  ].join("\n");
}

const CORNERS = ["9 9", "9 91", "91 9", "91 91"];
const four = (extra: string[]): string[] =>
  CORNERS.map((p) => neutral(1, p, extra));
const SHAPED = [
  `base_size ${COMEER.neutral.baseSizePick}`,
  `clumping_factor ${COMEER.neutral.clumpingFactorPick}`,
];
const NAMED = { border: "BORDERS_PL", constLine: true } as const;
/** From "One island per player" on, base_size is the oversized one, and from "Does the square count?" on, the script runs on version 1. */
const BIG = { baseSize: OVERSIZED_BASE_SIZE } as const;
const V1 = { ...BIG, versioned: true } as const;

const stages = {
  empty: "",
  players: "<PLAYER_SETUP>\nrandom_placement\n",
  water:
    "<PLAYER_SETUP>\nrandom_placement\n\n<LAND_GENERATION>\nbase_terrain WATER\n",
  playerLands: script(BIG),
  versioned: script(V1),
  avoided: script({ ...V1, avoid: 3 }),
  border4: script({ ...V1, avoid: 3, border: "4", fuzz: 100, percent: 100 }),
  named: script({ ...V1, ...NAMED, avoid: 3, fuzz: 100, percent: 100 }),
  ragged: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20 }),
  // The script at "Player land growth" and "Spot the problem". The first is
  // manual and the second is where the oversized islands are shown, so the
  // only check that starts from here is "Fixing the island-joining problem".
  bigger: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20 }),
  apart: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 }),
  neutral1: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 }, [
    neutral(1, "9 9"),
  ]),
  shaped: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 }, [
    neutral(1, "9 9", SHAPED),
  ]),
  /** The borders kept, at the end of "Box in the neutral island". Optional, so "Four corners" still starts from `shaped`. */
  boxed: script({ ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 }, [
    neutral(1, "9 9", [
      ...SHAPED,
      `border_fuzziness ${NEUTRAL_BORDER_FUZZINESS}`,
      `right_border ${NEUTRAL_BORDER_PICK}`,
      `bottom_border ${NEUTRAL_BORDER_PICK}`,
      `top_border ${NEUTRAL_TOP_BORDER_FIX}`,
    ]),
  ]),
  fourCorners: script(
    { ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 },
    four(SHAPED),
  ),
  random: script(
    { ...V1, ...NAMED, avoid: 3, fuzz: 20, baseSize: 9 },
    four([
      "base_size rnd(7,9)",
      `clumping_factor ${COMEER.neutral.clumpingFactorPick}`,
    ]),
  ),
};

function applyEdit(source: string, edit: StepTextEdit): string {
  return source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
}

const finished = applyEdit(
  stages.random,
  appendRestOfScript(parseRms(stages.random, lang))!,
);

describe("the stages the seed check reads", () => {
  // seedCheck.ts proves "the islands got smaller" on playerLandsStepScript.
  // If these stages drift from it, the gate proves a different script from
  // the one the learner has.
  it("are the scripts at the two player land steps", () => {
    expect(stages.playerLands).toBe(playerLandsStepScript(0));
    expect(stages.versioned).toBe(playerLandsStepScript(1));
  });
});

describe("each step's check, false before and true after", () => {
  const cases: [string, string, string][] = [
    ["start-new-file", stages.players, stages.empty],
    ["player-placement", stages.empty, stages.players],
    ["water-first", stages.players, stages.water],
    ["player-lands", stages.water, stages.playerLands],
    ["does-the-square-count", stages.playerLands, stages.versioned],
    ["player-land-avoidance", stages.versioned, stages.avoided],
    ["name-the-border", stages.border4, stages.named],
    ["ragged-edges", stages.named, stages.ragged],
    ["keep-them-apart", stages.bigger, stages.apart],
    ["first-neutral-island", stages.apart, stages.neutral1],
    ["shape-the-island", stages.neutral1, stages.shaped],
    ["neutral-island-borders", stages.shaped, stages.boxed],
    ["four-corners", stages.shaped, stages.fourCorners],
    ["one-random-number", stages.fourCorners, stages.random],
    ["the-rest", stages.random, finished],
  ];
  for (const [id, before, after] of cases) {
    it(`${id}`, () => {
      expect(check(id, before)).toBe(false);
      expect(check(id, after)).toBe(true);
    });
  }

  it("a constant written below its use does not count as named", () => {
    const wrongOrder = stages.named
      .replace("#const BORDERS_PL 12\n", "")
      .concat("#const BORDERS_PL 12\n");
    expect(check("name-the-border", wrongOrder)).toBe(false);
  });

  it("naming the border needs border_fuzziness left at 100", () => {
    expect(
      check(
        "name-the-border",
        stages.named.replace(/fuzziness 100/, "fuzziness 20"),
      ),
    ).toBe(false);
  });

  it("ragged-edges needs land_percent put back to 25", () => {
    const stillTesting = stages.ragged.replace(
      "land_percent 25",
      "land_percent 100",
    );
    expect(check("ragged-edges", stillTesting)).toBe(false);
  });

  // "Player land growth" is manual, since a check on values the learner
  // arrives with would tick on arrival and advance the moment base_size came
  // back, before the land_percent experiments. The step still has to ask for
  // the restore in its copy, which the next step relies on.
  it("player-land-growth is manual and asks for base_size and land_percent back", () => {
    const step = tutorial.steps.find((s) => s.id === "player-land-growth")!;
    expect(step.completion.kind).toBe("manual");
    const plain = step.body.flatMap((b) => (typeof b === "string" ? [b] : []));
    expect(
      plain.some(
        (t) =>
          t.includes(`base_size back to ${OVERSIZED_BASE_SIZE}`) &&
          t.includes(`land_percent back to ${COMEER.player.landPercent}`),
      ),
    ).toBe(true);
  });

  // The prediction answer says the last value that fits the starting square
  // changes nothing and the next one starts to grow the island. That is
  // arithmetic on the starting square, so it is pinned here and not left to
  // the copy.
  it("the prediction answer's land_percent values sit either side of the starting square", () => {
    const square = startingSquareTiles(OVERSIZED_BASE_SIZE);
    const last = largestPercentWithoutGrowth(OVERSIZED_BASE_SIZE);
    expect(playerIslandTarget(0)).toBeLessThanOrEqual(square);
    expect(playerIslandTarget(last)).toBeLessThanOrEqual(square);
    expect(playerIslandTarget(last + 1)).toBeGreaterThan(square);
    expect(playerIslandTarget(20)).toBeGreaterThan(
      playerIslandTarget(last + 2),
    );
    // The values the copy names are the ones the arithmetic picked.
    const growth = tutorial.steps.find((s) => s.id === "player-land-growth")!;
    expect(growth.body[0]).toContain(
      `${last}, ${last + 1}, ${last + 2} and 20`,
    );
  });

  // The learner is still reading "What happened" after typing the line, so
  // auto-advance would carry them on mid-sentence. Both tracks tick and wait.
  it("does-the-square-count ticks but waits for Next on both tracks", () => {
    for (const id of ["does-the-square-count", "does-the-square-count-code"]) {
      const step = tutorial.steps.find((s) => s.id === id)!;
      if (step.completion.kind !== "check") throw new Error(`${id} is manual`);
      expect(step.completion.autoAdvance, id).toBe(false);
    }
  });

  it("does-the-square-count needs version 1, not the placeholder 0 a Breakdown add writes", () => {
    const placeholder = stages.versioned.replace(
      "behavior_version 1",
      "behavior_version 0",
    );
    expect(check("does-the-square-count", placeholder)).toBe(false);
  });

  // The corner step reuses the state "Use borders to constrain lands" leaves
  // (fuzziness 100, land_percent 100), so it has to sit between that step and
  // the one that replaces the border values with a #const.
  it("border-corners is a manual step between show-the-border and name-the-border", () => {
    // The Code twins sit between their Breakdown steps in the array.
    const steps = tutorial.steps.filter((s) => !s.id.endsWith("-code"));
    const ids = steps.map((s) => s.id);
    const at = ids.indexOf("border-corners");
    expect(at).toBeGreaterThan(-1);
    expect(ids.indexOf("show-the-border")).toBe(at - 1);
    expect(ids.indexOf("name-the-border")).toBe(at + 1);
    expect(steps[at].completion.kind).toBe("manual");
  });

  it("keep-them-apart needs land_percent back at 25, which Spot the problem has the learner set to 0", () => {
    const stillZero = stages.apart.replace("land_percent 25", "land_percent 0");
    expect(stillZero).not.toBe(stages.apart);
    expect(check("keep-them-apart", stillZero)).toBe(false);
  });

  it("four-corners needs the same land_id on all four, since the gold finds them by it", () => {
    const odd = stages.fourCorners.replace("land_id 100", "land_id 7");
    expect(odd).not.toBe(stages.fourCorners);
    expect(check("four-corners", odd)).toBe(false);
  });

  // Keeping the borders is optional and the last paragraph is still being
  // read when it ticks, so both tracks tick and wait.
  it("neutral-island-borders ticks but waits for Next on both tracks", () => {
    for (const id of [
      "neutral-island-borders",
      "neutral-island-borders-code",
    ]) {
      const step = tutorial.steps.find((s) => s.id === id)!;
      if (step.completion.kind !== "check") throw new Error(`${id} is manual`);
      expect(step.completion.autoAdvance, id).toBe(false);
    }
  });

  it("neutral-island-borders needs every part the copy asks for", () => {
    const misses: [string, string][] = [
      // One past the top of the range.
      [
        `right_border ${NEUTRAL_BORDER_PICK}`,
        `right_border ${RANGES.neutralBorder.max + 1}`,
      ],
      [
        `bottom_border ${NEUTRAL_BORDER_PICK}`,
        `bottom_border ${RANGES.neutralBorder.min - 1}`,
      ],
      // One above the fix leaves the notch at the map edge.
      [
        `top_border ${NEUTRAL_TOP_BORDER_FIX}`,
        `top_border ${NEUTRAL_TOP_BORDER_FIX + 1}`,
      ],
      // Left at the values the learner looked with.
      [`border_fuzziness ${NEUTRAL_BORDER_FUZZINESS}`, "border_fuzziness 100"],
      ["land_percent 6", "land_percent 100"],
    ];
    // Only inside the neutral island, the last command. The player lands
    // carry border_fuzziness 20 too, and a plain replace would edit theirs.
    const island = stages.boxed.lastIndexOf("create_land {");
    for (const [from, to] of misses) {
      const source =
        stages.boxed.slice(0, island) +
        stages.boxed.slice(island).replace(`  ${from}\n`, `  ${to}\n`);
      expect(source, from).not.toBe(stages.boxed);
      expect(check("neutral-island-borders", source), to).toBe(false);
    }
    const lower = stages.boxed.replace(
      `top_border ${NEUTRAL_TOP_BORDER_FIX}\n`,
      "top_border -20\n",
    );
    expect(check("neutral-island-borders", lower)).toBe(true);
  });

  it("four-corners needs land_percent back at 6 on all four, after the border step raised it to 100", () => {
    const left = stages.fourCorners.replace(
      "land_percent 6",
      "land_percent 100",
    );
    expect(left).not.toBe(stages.fourCorners);
    expect(check("four-corners", left)).toBe(false);
  });

  it("a border value outside the range does not satisfy the naming step", () => {
    for (const v of [5, 40]) {
      const source = stages.named.replace("BORDERS_PL 12", `BORDERS_PL ${v}`);
      expect(check("name-the-border", source)).toBe(false);
    }
  });

  it("the whole stated range satisfies its step, ends included", () => {
    for (const v of [
      RANGES.border.min,
      COMEER.player.border,
      RANGES.border.max,
    ]) {
      const source = stages.named.replace("BORDERS_PL 12", `BORDERS_PL ${v}`);
      expect(check("name-the-border", source)).toBe(true);
    }
    for (const v of [RANGES.borderFuzziness.min, RANGES.borderFuzziness.max]) {
      const source = stages.ragged.replace(
        "border_fuzziness 20",
        `border_fuzziness ${v}`,
      );
      expect(check("ragged-edges", source)).toBe(true);
    }
    for (const v of [RANGES.safeBaseSize.min, RANGES.safeBaseSize.max]) {
      const source = stages.apart.replace("base_size 9", `base_size ${v}`);
      expect(check("keep-them-apart", source)).toBe(true);
    }
  });

  it("one outside the range does not", () => {
    for (const v of [9, 41]) {
      const source = stages.ragged.replace(
        "border_fuzziness 20",
        `border_fuzziness ${v}`,
      );
      expect(check("ragged-edges", source)).toBe(false);
    }
    for (const v of [6, 10, 11]) {
      const source = stages.apart.replace("base_size 9", `base_size ${v}`);
      expect(check("keep-them-apart", source)).toBe(false);
    }
  });

  it("an rnd() range wider than the safe one does not satisfy the random step", () => {
    const source = stages.random.replace(/rnd\(7,9\)/g, "rnd(1,30)");
    expect(check("one-random-number", source)).toBe(false);
  });

  // The Code track tells the learner a space inside rnd() breaks it
  // (guide line 172), so the check has to refuse one.
  it("an rnd() with a space inside does not satisfy the random step", () => {
    const source = stages.random.replace(/rnd\(7,9\)/g, "rnd(7, 9)");
    expect(source).not.toBe(stages.random);
    expect(check("one-random-number", source)).toBe(false);
  });

  it("four neutral islands may share a zone or have one each", () => {
    expect(check("four-corners", stages.fourCorners)).toBe(true);
    const own = stages.fourCorners
      .replace(/zone 1/g, "zone @")
      .replace(/zone @/, "zone 1")
      .replace(/zone @/, "zone 2")
      .replace(/zone @/, "zone 3")
      .replace(/zone @/, "zone 4");
    expect(check("four-corners", own)).toBe(true);
  });

  it("any position within 0 to 10 or 90 to 99 puts an island in a corner", () => {
    // The first island moves to 0 0 and three more follow, one per other corner.
    const wide =
      stages.shaped.replace("land_position 9 9", "land_position 0 0") +
      ["10 90", "99 0", "95 99"].map((p) => neutral(1, p, SHAPED)).join("\n");
    expect(check("four-corners", wide)).toBe(true);
    expect(
      check("first-neutral-island", stages.apart + neutral(1, "10 10")),
    ).toBe(true);
    expect(
      check("first-neutral-island", stages.apart + neutral(1, "0 0")),
    ).toBe(true);
  });

  it("the first island must be in the left corner the step names, not another one", () => {
    for (const other of ["90 99", "9 91", "91 9"]) {
      expect(
        check("first-neutral-island", stages.apart + neutral(1, other)),
        other,
      ).toBe(false);
    }
  });

  it("a position of 100, or one in the middle, is not a corner", () => {
    for (const bad of ["100 100", "11 9", "9 89", "50 50", "9 100"]) {
      expect(
        check("first-neutral-island", stages.apart + neutral(1, bad)),
        bad,
      ).toBe(false);
    }
    const hundred = stages.fourCorners.replace(
      "land_position 91 91",
      "land_position 100 100",
    );
    expect(hundred).not.toBe(stages.fourCorners);
    expect(check("four-corners", hundred)).toBe(false);
  });

  it("two islands in the same corner leave another corner empty", () => {
    const doubled = stages.fourCorners
      .replace("land_position 91 91", "land_position 95 95")
      .replace("land_position 91 9\n", "land_position 92 92\n");
    expect(check("four-corners", doubled)).toBe(false);
  });

  it("a neutral island in a player zone does not satisfy the corners step", () => {
    for (const zone of ["-9", "-2"]) {
      const source = stages.fourCorners.replace(/zone 1/, `zone ${zone}`);
      expect(check("four-corners", source)).toBe(false);
    }
    const noZone = stages.fourCorners.replace("  zone 1\n", "");
    expect(check("four-corners", noZone)).toBe(false);
  });
});

describe("the finished script", () => {
  const deps = createSeedCheckDeps(lang, constants);

  it("is the one the first step's picture is drawn from", () => {
    // finishedScript.ts is what renderImage.ts draws. If the steps' own
    // stage scripts drift from it, the picture shows a map the tutorial does
    // not teach.
    expect(finished).toBe(finishedComeerScript(lang));
  });

  it("parses with no errors", () => {
    const errors = parseRms(finished, lang).diagnostics.filter(
      (d) => d.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  // `reports` carries every command's placement failures. `failureMarks` is
  // only the subset that has a tile to point at (land failures), so a gold
  // pile that found no room never appears there. A first version of this test
  // read `failureMarks` and could not have failed on the case it names.
  const failuresOf = (source: string): string[] =>
    deps
      .generate(source, PINNED_COMEER_SEED, true)
      .reports.flatMap((r) =>
        r.failures.map((f) => `${f.entity}: ${f.detail}`),
      );

  // Captain Kniples' script reports failures by design. It asks for 4056
  // terrain clumps to mean "every eligible tile" and over-asks the same way
  // for objects, so a clean list is not the goal here. The list is pinned, so
  // a new failure (an object with no room, a land that vanished) or a missing
  // one after an engine change goes red and is read before it is accepted.
  // Refresh with `vitest -u` on this file after reading the diff.
  it("generates at the pinned seed with exactly the failures Comeer is known to report", () => {
    expect(failuresOf(finished).sort()).toMatchSnapshot();
  });

  it("made every land, since land failures are the ones with a tile to mark", () => {
    const result = deps.generate(finished, PINNED_COMEER_SEED, true);
    expect(result.failureMarks).toEqual([]);
    // Six lands, the two players and four neutral islands.
    expect(result.landOrigins.length).toBe(6);
  });

  it("would notice a failure, shown by sending an object on the neutral islands to a land id that does not exist", () => {
    // The first place_on_specific_land_id 100 in the file is the forage.
    const broken = finished.replace(
      "place_on_specific_land_id 100",
      "place_on_specific_land_id 999",
    );
    expect(broken).not.toBe(finished);
    // The finished map reports failures by design, so the broken one has to
    // name the missing land. This used to compare counts, and on the version 1
    // map (2026-10-14) the count stayed at 44, since moving the forage off the
    // islands freed the tiles another failure had been short of.
    const missing = (list: string[]) =>
      list.filter((f) => f.includes("land_id 999"));
    expect(missing(failuresOf(finished))).toEqual([]);
    expect(missing(failuresOf(broken)).length).toBe(1);
  });
});

describe("the fill-in button", () => {
  it("adds the three missing sections to a script that has none of them", () => {
    const edit = appendRestOfScript(parseRms(stages.random, lang));
    expect(edit).not.toBeNull();
    const out = applyEdit(stages.random, edit!);
    for (const header of [
      "<ELEVATION_GENERATION>",
      "<TERRAIN_GENERATION>",
      "<OBJECTS_GENERATION>",
    ]) {
      expect(out.split(header).length - 1).toBe(1);
    }
  });

  it("does nothing on a finished script", () => {
    expect(appendRestOfScript(parseRms(finished, lang))).toBeNull();
  });

  it("adds only the sections that are missing", () => {
    const withForest =
      stages.random +
      "\n<TERRAIN_GENERATION>\ncreate_terrain FOREST {\n  base_terrain GRASS\n  land_percent 5\n}\n";
    const out = applyEdit(
      withForest,
      appendRestOfScript(parseRms(withForest, lang))!,
    );
    expect(out.split("<TERRAIN_GENERATION>").length - 1).toBe(1);
    expect(out).toContain("<ELEVATION_GENERATION>");
    expect(out).toContain("<OBJECTS_GENERATION>");
  });

  it("is what the final step's autoFill produces", () => {
    const step = tutorial.steps.find((s) => s.id === "the-rest")!;
    const edit = step.autoFill!.buildEdit(ctxFor(stages.random));
    expect(applyEdit(stages.random, edit!)).toBe(finished);
  });
});

describe("the copy", () => {
  interface Piece {
    text: string;
    spoiler: boolean;
  }

  function pieces(block: BodyBlock): Piece[] {
    if (typeof block === "string") return [{ text: block, spoiler: false }];
    if (Array.isArray(block)) {
      return block.map((p) =>
        typeof p === "string"
          ? { text: p, spoiler: false }
          : { text: p.spoiler, spoiler: true },
      );
    }
    if (block.kind === "spoiler") {
      // Every word inside a dropdown is hidden until it opens, its plain
      // paragraphs included, so all of them count as spoiler text.
      const hidden =
        "paragraphs" in block
          ? block.paragraphs.flatMap(pieces).map((p) => p.text)
          : [block.text];
      return [
        { text: block.label, spoiler: false },
        ...hidden.map((text) => ({ text, spoiler: true })),
      ];
    }
    // Script text, not prose, so the punctuation rules below do not apply.
    if (block.kind === "code") return [];
    if (block.kind === "text") return [{ text: block.text, spoiler: false }];
    return [{ text: block.alt, spoiler: false }];
  }

  const allText = (): string[] =>
    tutorial.steps.flatMap((s) => [
      s.title,
      s.hint ?? "",
      s.bypass?.label ?? "",
      s.autoFill?.label ?? "",
      ...s.body.flatMap((b) => pieces(b).map((p) => p.text)),
    ]);

  it("uses none of the punctuation CLAUDE.md rules out in user-facing text", () => {
    for (const text of allText()) {
      // A colon ends a heading or a label. One inside a sentence is ruled out.
      expect(text.trimEnd()).not.toMatch(/[—–;]|:[\s\S]/);
      expect(text).not.toMatch(/ - /);
    }
  });

  it("has unique step ids and a registered definition", () => {
    const ids = tutorial.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getTutorial("land-generation-comeer")).toBe(tutorial);
    expect(tutorial.title).toBe("Land Generation (Comeer)");
  });

  it("hides every number of a range and its pick, as three separate spoilers", () => {
    const border = tutorial.steps.find((s) => s.id === "name-the-border")!;
    const hidden = border.body
      .flatMap(pieces)
      // Numbers only, since the step also has a dropdown spoiler of prose.
      .filter((p) => p.spoiler && /^\d+$/.test(p.text))
      .map((p) => p.text);
    expect(hidden).toEqual([
      String(RANGES.border.min),
      String(RANGES.border.max),
      String(COMEER.player.border),
    ]);
  });

  it("never prints a hidden answer in the plain text of its own step", () => {
    for (const step of tutorial.steps) {
      const all = step.body.flatMap(pieces);
      // Script text in a code block is on screen as well, though the
      // punctuation rules skip it.
      const shownScript = step.body.flatMap((b) =>
        typeof b === "object" && !Array.isArray(b) && b.kind === "code"
          ? [b.text]
          : [],
      );
      const plain = [
        ...all.filter((p) => !p.spoiler).map((p) => p.text),
        ...shownScript,
      ].join(" ");
      const hiddenNumbers = all
        .filter((p) => p.spoiler && /^\d+$/.test(p.text))
        .map((p) => p.text);
      for (const n of hiddenNumbers) {
        const leaked = new RegExp(`(^|[^\\d])${n}([^\\d]|$)`).test(plain);
        expect(leaked, `step ${step.id} prints ${n} outside its spoiler`).toBe(
          false,
        );
      }
    }
  });

  it("pins the 1v1 preset, Tiny and the non-diagonal start seed on the first step", () => {
    const first = tutorial.steps[0];
    expect(first.preview?.teamPreset).toBe("1v1");
    expect(first.preview?.mapSize).toBe("Tiny");
    expect(first.preview?.seed).toBe(START_COMEER_SEED);
    expect(START_COMEER_SEED).not.toBe(PINNED_COMEER_SEED);
  });

  it("changes the seed only at Spot the problem, never on the steps in between", () => {
    const spot = tutorial.steps.findIndex((s) => s.id === "something-is-wrong");
    expect(spot).toBeGreaterThan(1);
    // Every step before it, both tracks, leaves the learner's seed alone.
    const pinning = tutorial.steps
      .slice(1, spot)
      .filter((s) => s.preview?.seed !== undefined)
      .map((s) => s.id);
    expect(pinning).toEqual([]);
    // And the swap to the diagonal seed happens right there.
    expect(tutorial.steps[spot].preview?.seed).toBe(PINNED_COMEER_SEED);
  });
});

// tutorial-design.md Sec.9.2. The tests every Breakdown and Code tutorial
// shares. Each Code Answer is typed into the stage script before its step.
describeEditorTracks(tutorial, {
  breakdownIds: [
    "what-we-build",
    "start-new-file",
    "breakdown-or-code",
    "player-placement",
    "water-first",
    "player-lands",
    "does-the-square-count",
    "player-land-avoidance",
    "show-the-border",
    "border-corners",
    "name-the-border",
    "ragged-edges",
    "player-land-growth",
    "something-is-wrong",
    "keep-them-apart",
    "first-neutral-island",
    "shape-the-island",
    "neutral-island-borders",
    "four-corners",
    "one-random-number",
    "the-rest",
    "you-made-comeer",
  ],
  ctxFor: (source) => ctxFor(source),
  typedInto: {
    "player-placement-code": (typed) => `${stages.empty}${typed}\n`,
    "water-first-code": (typed) => `${stages.players}\n${typed}\n`,
    "player-lands-code": (typed) => `${stages.water}${typed}\n`,
    // The Answer is the whole Player Setup section, typed over the one the
    // player land step left behind.
    "does-the-square-count-code": (typed) =>
      `${typed}\n${stages.playerLands.slice(stages.players.length)}`,
    // The Answer is the whole land section, typed over the one the border
    // step left behind.
    "name-the-border-code": (typed) =>
      `${stages.border4.slice(0, stages.border4.indexOf("<LAND_GENERATION>"))}${typed}\n`,
    "first-neutral-island-code": (typed) => `${stages.apart}${typed}\n`,
  },
});
