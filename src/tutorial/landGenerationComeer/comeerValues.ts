// docs/tutorial-islands-design.md. The numbers the Comeer tutorial teaches,
// and the script text every check and the tutorial's own fixtures are built
// from. One module on purpose: the seed finder, the regression test and the
// tutorial copy must all agree on what "Comeer's values" are, and three
// hand-typed copies is how they stop agreeing.
//
// Every value in COMEER is the one in Comeer v1.5 (Captain Kniples), the
// map the tutorial simplifies. A range here is the span the tutorial's
// spoilers call "works", and the regression test proves every value in it.

export const COMEER = {
  player: {
    landPercent: 25,
    circleRadius: "16 1",
    /**
     * Comeer v1.5 writes 9 (v1.4 wrote 10), so the channel between the player
     * islands is never less than 2 tiles of water and a dock cannot block it.
     */
    baseSize: 9,
    /** What Comeer writes, what the learner types and what the seed check proves. */
    otherZoneAvoidanceDistance: 3,
    /** Comeer's `#const BORDERS_PL 12` (v1.5, `PL_BORDERS` before), a percentage of the map, so about 14 tiles on Tiny. */
    border: 12,
    /**
     * Comeer never writes `border_fuzziness`, so its value is the engine
     * default (guide, border_fuzziness: default 20). The tutorial still writes
     * it out, because the learner is told to find it.
     */
    borderFuzziness: 20,
  },
  neutral: {
    landPercent: 6,
    /** Comeer writes `rnd(7,9)`. */
    baseSize: { min: 7, max: 9 },
    /** The value the tutorial's spoiler picks inside that span, and its test stages type. */
    baseSizePick: 8,
    /** Comeer writes `rnd(13,24)`. */
    clumpingFactor: { min: 13, max: 24 },
    /** The value the tutorial's spoiler picks inside that span, and its test stages type. */
    clumpingFactorPick: 18,
    otherZoneAvoidanceDistance: 10,
    landId: 100,
    corners: [
      [9, 9],
      [9, 91],
      [91, 9],
      [91, 91],
    ] as const,
  },
} as const;

/**
 * The spans the spoilers state. The owner's rule for border adherence is
 * Comeer's value minus 10 and plus 20. The others are the span the
 * regression test has shown to hold on the pinned seed, around Comeer's pick.
 */
export const RANGES = {
  borderFuzziness: { min: 10, max: 40 },
  border: { min: 10, max: 14 },
  /**
   * `base_size` values that keep the two player islands DE's full avoidance
   * gap apart on a diagonal (seedCheck.ts, `DIAGONAL_AVOIDANCE_GAP`). The
   * owner set 7 to 9 with the pinned seed 217 (2026-10-14). There the players
   * start 21 to 22 tiles apart, 9 is the biggest value that keeps the gap and
   * 10 leaves 1 tile, so the step's "biggest one that still leaves a clear
   * channel" is the pick.
   */
  safeBaseSize: { min: 7, max: 9 },
  /**
   * The `land_position` numbers that put a neutral island in a corner, one
   * span near the 0 edge and one near the far edge. Comeer writes 9 and 91.
   * The far span stops at 99 because that is `land_position`'s documented
   * maximum, and 100 draws RMS0203.
   */
  cornerNear: { min: 0, max: 10 },
  cornerFar: { min: 90, max: 99 },
  /**
   * `right_border` and `bottom_border` kept on the neutral island at its 0 0
   * corner, at land_percent 6 and `NEUTRAL_BORDER_FUZZINESS` (step
   * "neutral-island-borders"). The owner's rule (2026-10-16), a border that
   * stops the really wild growth and does not make the island smaller.
   * Measured that day against the same runs with no borders. Unbordered,
   * the farthest island reaches 57 tiles from its corner, and at 70 none
   * gets past 38. With the tutorial's base_size 8 and clumping_factor 18,
   * over 62 seeds at positions 0, 5, 9 and 10, the mean island at its worst
   * position is 0.988 of its unbordered size at 74, 0.980 at 75, 0.969 at
   * 76 and 0.939 at 77, so the owner chose 70 to 74 over a first pick of 71
   * to 77. A single run can still come out a few percent smaller at any
   * value that touches it, since growth takes a different path, which a
   * border at 50 that touches almost nothing shows too. seedCheck.ts proves
   * both ends.
   */
  neutralBorder: { min: 70, max: 74 },
} as const;

/** The neutral border the step's spoiler picks, the owner's pick. */
export const NEUTRAL_BORDER_PICK = 73;

/**
 * The `border_fuzziness` a learner keeps the borders at, the player lands'
 * `COMEER.player.borderFuzziness`, and the value `RANGES.neutralBorder` is
 * measured at.
 */
export const NEUTRAL_BORDER_FUZZINESS = 20;

/**
 * The highest `top_border` that moves the corner cut fully off the map for
 * every value in `RANGES.neutralBorder`. The cut is a quarter of the box's
 * width (preview-design Sec.6.1 growth rule 7), 9 tiles at 70, 8 at
 * 71 to 73 and 7 at 74. -7 is round(-8.4), 8 tiles, which leaves a one tile
 * notch in row 0 at 70, and -8 is 10 tiles. The hint ladder steps down by 1,
 * so the learner meets the notch on the way. Proven in seedCheck.ts.
 */
export const NEUTRAL_TOP_BORDER_FIX = -8;

/** The deliberately oversized `base_size` the learner is asked to try first. */
export const OVERSIZED_BASE_SIZE = 13;

/**
 * The `land_percent` the learner raises to while finding the borders. With
 * that much land to place the growth runs into every border, so the preview
 * shows where each one sits. The ragged-edges step puts it back to
 * `COMEER.player.landPercent`.
 */
export const BORDER_TEST_LAND_PERCENT = 100;

/**
 * The border value the learner raises all four borders to at "Borders cut the
 * corners". Big enough that the cut at each corner is plain in the preview,
 * and outside the 10 to 14 span the next step asks for.
 */
export const BORDER_CORNER_TEST = 20;

/** The `#const` the learner names all four player borders with, the name Comeer v1.5 uses. */
export const BORDER_CONSTANT = "BORDERS_PL";

/** The border value the tutorial uses as its example of one that is visibly too small. */
export const WRONG_BORDER = 4;

/** Tiles along one side of the Tiny map the tutorial is for. */
export const TINY_MAP_WIDTH = 120;

/** Tiles in the square a land starts as, `base_size` being its radius. */
export function startingSquareTiles(baseSize: number): number {
  return (2 * baseSize + 1) ** 2;
}

/**
 * Tiles each player island aims for at `landPercent`, with `behavior_version
 * 1` and two players sharing it (landTarget in lands.ts). An island whose
 * starting square is already bigger than this does not grow.
 */
export function playerIslandTarget(landPercent: number): number {
  return Math.round((TINY_MAP_WIDTH ** 2 * landPercent) / (2 * 100));
}

/**
 * The biggest whole `land_percent` whose island target still fits inside the
 * starting square, so nothing grows. One more than this and the island grows.
 * "Player land growth" asks the learner to predict either side of it, and it
 * moves whenever `OVERSIZED_BASE_SIZE` does (10 at base_size 13, 15 at 16).
 */
export function largestPercentWithoutGrowth(baseSize: number): number {
  let percent = 0;
  while (playerIslandTarget(percent + 1) <= startingSquareTiles(baseSize)) {
    percent++;
  }
  return percent;
}

/** The map the tutorial is for, and what the preview must be set to. */
export const COMEER_MAP_SIZE = "Tiny" as const;
export const COMEER_TEAM_PRESET = "1v1" as const;

/**
 * The seed the discovery step is written around, found by `findComeerSeed`
 * and re-proved by `seedCheck.test.ts`. If the engine changes and the test
 * goes red, the runtime check replaces this value in the background and the
 * test failure says which property broke, so update this number from the
 * finder's output and not by hand.
 *
 * 217 is the owner's pick (2026-10-14), a seed the finder accepts. It puts the
 * players closer than most diagonal seeds, which is what makes 9 the top of
 * the safe `base_size` range.
 */
export const PINNED_COMEER_SEED = 217;

/**
 * The seed the preview opens on, and the one every step keeps until "Spot the
 * problem" swaps in `PINNED_COMEER_SEED`. The players sit 35 tiles apart
 * across and 13 down, so the oversized starting squares do not overlap and the
 * avoidance step ends with two clean islands. The 35 clears a square 33 tiles
 * wide (base_size 16) as well as the current 27. If the opening seed were a
 * diagonal one, that step's result would already be the planted problem, which
 * the tutorial wants the learner to find later.
 *
 * A plain number and not part of the self-repair in seedCheck.ts, because
 * "not diagonal" is a property the generator's ring placement keeps, and
 * `seedCheck.test.ts` proves it and every other claim the early steps make.
 */
export const START_COMEER_SEED = 50;

export interface LandScriptOptions {
  /**
   * Written as `behavior_version` under `random_placement` when 1. Default 1,
   * which is what Comeer writes and what the learner adds at the step
   * "Does the square count?". 0 leaves the line out, the engine default,
   * which the seed check uses to show the step's islands shrink.
   */
  behaviorVersion?: 0 | 1;
  baseSize?: number;
  /** All four borders, as one number like the tutorial's `BORDERS_PL`. */
  border?: number;
  borderFuzziness?: number;
  /** Add Comeer's four corner islands. */
  neutrals?: boolean;
  /** The `land_position` of each neutral island. Default is Comeer's `COMEER.neutral.corners`. */
  neutralCorners?: readonly (readonly [number, number])[];
  /** A number, or text such as `rnd(7,9)`, which is what the finished map writes. */
  neutralBaseSize?: number | string;
  neutralClumpingFactor?: number | string;
  /** Default `COMEER.neutral.landPercent`. The bordered-island step has the learner raise it to 100 while they look. */
  neutralLandPercent?: number;
  /**
   * Borders on every neutral island, as the learner has them during
   * "neutral-island-borders". `fuzziness` defaults to 100, the hard wall
   * they look at the cut with. Only sensible with a single island in the
   * 0 0 corner, which is the only one at that step.
   */
  neutralBorders?: {
    right: number;
    bottom: number;
    top?: number;
    fuzziness?: number;
  };
  /** The four neutral islands each get their own zone. Default is one shared zone, which is what duplicating the first island gives a learner. */
  separateNeutralZones?: boolean;
  /** Write `#const BORDERS_PL` and use it for all four borders, as the learner does after the naming step. */
  namedBorder?: boolean;
}

/**
 * The script as the learner has it at "One island per player" and at "Does
 * the square count?", before any border or avoidance. The seed check measures
 * the second step's claim (the islands shrink) on exactly this text, and
 * tutorial.test.ts holds its own stages to it.
 */
export function playerLandsStepScript(behaviorVersion: 0 | 1): string {
  return [
    "<PLAYER_SETUP>",
    "random_placement",
    ...(behaviorVersion === 1 ? ["behavior_version 1"] : []),
    "",
    "<LAND_GENERATION>",
    "base_terrain WATER",
    "create_player_lands {",
    "  terrain_type SNOW_SOFT",
    `  land_percent ${COMEER.player.landPercent}`,
    `  circle_radius ${COMEER.player.circleRadius}`,
    `  base_size ${OVERSIZED_BASE_SIZE}`,
    "}",
    "",
  ].join("\n");
}

/**
 * The land section as the learner has it after each stage, with Comeer's
 * values unless an option overrides one. Plain text, so it goes through the
 * real parser and the real generator exactly as a learner's file does (a stage
 * tested on input it built itself cannot catch the stage before it failing,
 * CLAUDE.md, 2026-08-07).
 */
export function comeerScript(options: LandScriptOptions = {}): string {
  const p = COMEER.player;
  const n = COMEER.neutral;
  const baseSize = options.baseSize ?? p.baseSize;
  const border = options.border ?? p.border;
  const fuzz = options.borderFuzziness ?? p.borderFuzziness;
  const edge = options.namedBorder ? BORDER_CONSTANT : String(border);
  const lines = [
    "<PLAYER_SETUP>",
    "random_placement",
    ...((options.behaviorVersion ?? 1) === 1 ? ["behavior_version 1"] : []),
    "",
    "<LAND_GENERATION>",
    "base_terrain WATER",
    ...(options.namedBorder ? [`#const ${BORDER_CONSTANT} ${border}`] : []),
    "create_player_lands {",
    "  terrain_type SNOW_SOFT",
    `  land_percent ${p.landPercent}`,
    `  circle_radius ${p.circleRadius}`,
    `  other_zone_avoidance_distance ${p.otherZoneAvoidanceDistance}`,
    `  base_size ${baseSize}`,
    `  border_fuzziness ${fuzz}`,
    `  left_border ${edge}`,
    `  right_border ${edge}`,
    `  top_border ${edge}`,
    `  bottom_border ${edge}`,
    "}",
  ];
  if (options.neutrals) {
    const borders = options.neutralBorders;
    (options.neutralCorners ?? n.corners).forEach(([x, y], index) => {
      lines.push(
        "create_land {",
        "  terrain_type SNOW",
        `  land_percent ${options.neutralLandPercent ?? n.landPercent}`,
        `  land_position ${x} ${y}`,
        `  zone ${options.separateNeutralZones ? index + 1 : 1}`,
        `  other_zone_avoidance_distance ${n.otherZoneAvoidanceDistance}`,
        `  land_id ${n.landId}`,
        `  base_size ${options.neutralBaseSize ?? n.baseSize.min}`,
        `  clumping_factor ${options.neutralClumpingFactor ?? n.clumpingFactor.min}`,
        ...(borders === undefined
          ? []
          : [
              `  border_fuzziness ${borders.fuzziness ?? 100}`,
              `  right_border ${borders.right}`,
              `  bottom_border ${borders.bottom}`,
              ...(borders.top === undefined
                ? []
                : [`  top_border ${borders.top}`]),
            ]),
        "}",
      );
    });
  }
  return lines.join("\n") + "\n";
}
