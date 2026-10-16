// tutorial-design.md Sec.9.2, tutorial-islands-design.md. The Code track of
// "Land Generation (Comeer)". The same islands, typed into the Code tab.
// `withCodeTrack` (editorTracks.ts) joins each twin here to the Breakdown
// step it mirrors, and the twin runs on that step's check.
//
// Most of this tutorial is about attributes and the preview, not about where
// to click, so most twins keep their Breakdown step's words. A twin only
// changes the words that name a Breakdown control, and adds the script text
// for the first time a learner writes a new kind of line (a header, a block,
// a #const, a copy of a block, an rnd). Each script Answer is the last rung of
// the step's hint ladder and sits behind a spoiler, so the hints above it
// still come first. tutorial.test.ts types every Answer into the script as it
// stands before its step and requires the step's check to pass.

import { insertAfterBlock, replaceBlock, type CodeTwin } from "../editorTracks";
import type { BodyBlock } from "../types";
import {
  BORDER_CONSTANT,
  BORDER_TEST_LAND_PERCENT,
  COMEER,
  OVERSIZED_BASE_SIZE,
} from "./comeerValues";

const P = COMEER.player;
const N = COMEER.neutral;

/** A block as a learner types it, two space indent, one attribute a line. */
function block(command: string, attributes: readonly string[]): string {
  return [`${command} {`, ...attributes.map((a) => `  ${a}`), "}"].join("\n");
}

function answer(text: string, label = "Answer"): BodyBlock {
  return { kind: "spoiler", label, code: true, text };
}

const PLAYER_LANDS_FIRST = [
  "terrain_type SNOW_SOFT",
  `land_percent ${P.landPercent}`,
  `circle_radius ${P.circleRadius}`,
  `base_size ${OVERSIZED_BASE_SIZE}`,
];

const NAMED_BORDER_SECTION = [
  "<LAND_GENERATION>",
  "base_terrain WATER",
  `#const ${BORDER_CONSTANT} ${P.border}`,
  block("create_player_lands", [
    "terrain_type SNOW_SOFT",
    `land_percent ${BORDER_TEST_LAND_PERCENT}`,
    `circle_radius ${P.circleRadius}`,
    `other_zone_avoidance_distance ${P.otherZoneAvoidanceDistance}`,
    // Typed at "One island per player", and still the oversized value here.
    `base_size ${OVERSIZED_BASE_SIZE}`,
    "border_fuzziness 100",
    ...["left", "right", "top", "bottom"].map(
      (side) => `${side}_border ${BORDER_CONSTANT}`,
    ),
  ]),
].join("\n");

const FIRST_NEUTRAL_ISLAND = block("create_land", [
  "terrain_type SNOW",
  `land_percent ${N.landPercent}`,
  "land_position 0 0",
  "zone 1",
  `other_zone_avoidance_distance ${N.otherZoneAvoidanceDistance}`,
  `land_id ${N.landId}`,
]);

export const COMEER_CODE_TWINS: readonly CodeTwin[] = [
  {
    twinOf: "player-placement",
    id: "player-placement-code",
    body: (twin) =>
      replaceBlock(
        twin,
        "add random_placement to the Player Setup section",
        [
          {
            spoiler:
              "We want the player lands to be placed randomly in a circle, so random_placement is the one.",
          },
        ],
        "Now type it into the editor. A script is split into sections, and each one starts with a header, the section's name in angle brackets on a line of its own. This command belongs in the Player Setup section. Type its header, <PLAYER_SETUP>, then the command on the line under it. Hover over any word you type to see what it does.",
        answer("<PLAYER_SETUP>\nrandom_placement"),
      ),
  },
  {
    twinOf: "water-first",
    id: "water-first-code",
    body: (twin) =>
      replaceBlock(
        twin,
        "Add base_terrain to Land Generation",
        [
          {
            spoiler:
              "The base_terrain should be water, then we can place lands on the water in land generation. Every land you add from here is painted over that water.",
          },
        ],
        "Start the Land Generation section on a new line with its header, <LAND_GENERATION>. Under it, type base_terrain and the terrain you picked, on the same line.",
        answer("<LAND_GENERATION>\nbase_terrain WATER"),
      ),
  },
  {
    twinOf: "player-lands",
    id: "player-lands-code",
    body: (twin) => [
      ...replaceBlock(twin, "clicked Add Command", [
        "Hint 2: ",
        {
          spoiler:
            "You need the create_player_lands command. Type its name, then an opening curly brace. Put each attribute on its own line with its value after it, and close the block with a curly brace on a line of its own. circle_radius is how far from the centre of the map the players sit, as a percent of the map width. The second number lets that distance wobble a little. land_percent is how much of the map the player lands cover between them. You will need a terrain_type too. Comeer is a snow map, so pick a snow terrain for the islands. base_size is how big the land is before growth.",
        },
      ]),
      answer(
        block("create_player_lands", PLAYER_LANDS_FIRST),
        "The answer as script",
      ),
    ],
  },
  {
    twinOf: "does-the-square-count",
    id: "does-the-square-count-code",
    body: (twin) =>
      replaceBlock(
        twin,
        "add behavior_version to Player Setup",
        "Make a guess before you look. Then type behavior_version 1 on its own line under random_placement, in the <PLAYER_SETUP> section at the top, and watch the islands in the preview.",
        answer("<PLAYER_SETUP>\nrandom_placement\nbehavior_version 1"),
      ),
  },
  { twinOf: "player-land-avoidance", id: "player-land-avoidance-code" },
  { twinOf: "show-the-border", id: "show-the-border-code" },
  { twinOf: "border-corners", id: "border-corners-code" },
  {
    twinOf: "name-the-border",
    id: "name-the-border-code",
    body: (twin) => [
      ...replaceBlock(
        replaceBlock(
          twin,
          "Add a #const called",
          `Manually editing the same value in multiple places is a) annoying and b) error-prone. Give it a name instead. A #const line names a number. Type #const, then the name, then the number, all on one line. Call this one ${BORDER_CONSTANT}, then type ${BORDER_CONSTANT} in place of the number after each of the four borders. One constant now moves all four borders together.`,
        ),
        "The Breakdown's picker",
        "The #const has to come before the command that uses it. Put it on its own line above create_player_lands.",
      ),
      answer(NAMED_BORDER_SECTION, "The land section so far"),
    ],
  },
  { twinOf: "ragged-edges", id: "ragged-edges-code" },
  { twinOf: "player-land-growth", id: "player-land-growth-code" },
  { twinOf: "keep-them-apart", id: "keep-them-apart-code" },
  {
    twinOf: "first-neutral-island",
    id: "first-neutral-island-code",
    body: (twin) => [
      ...twin,
      answer(FIRST_NEUTRAL_ISLAND, "The island as script"),
    ],
  },
  { twinOf: "shape-the-island", id: "shape-the-island-code" },
  { twinOf: "neutral-island-borders", id: "neutral-island-borders-code" },
  {
    twinOf: "four-corners",
    id: "four-corners-code",
    body: (twin) =>
      replaceBlock(
        twin,
        "Right-click the neutral island card",
        "Copy the whole create_land block, from create_land down to its closing curly brace. Paste it three times below the first one so there are four neutral islands, then change land_position in each so every island sits in its own corner.",
      ),
  },
  {
    twinOf: "one-random-number",
    id: "one-random-number-code",
    body: (twin) =>
      insertAfterBlock(
        twin,
        "replace its number with rnd(low,high)",
        "Type rnd() with no spaces anywhere inside it. The game splits a line at every space, so a space after the comma breaks the value in two.",
      ),
  },
  { twinOf: "the-rest", id: "the-rest-code" },
];
