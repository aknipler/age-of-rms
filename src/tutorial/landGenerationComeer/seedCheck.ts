// docs/tutorial-islands-design.md Sec.5. Decides whether a seed shows the
// Comeer tutorial what its copy says it shows, and searches for one that does.
//
// PURE on purpose, in the same way src/preview/generator/** is. It never
// imports React, Tauri or a Worker, and it receives the generator as a
// parameter. The reason is that this code runs in two places that cannot share
// an import graph, a background worker at tutorial start (seedWorker.ts) and
// plain-Node Vitest (seedCheck.test.ts). Taking `generate` as an argument is
// dependency injection, the idiom for exactly this, and it also lets the test
// hand in a deliberately broken generator to prove the checks can fail.

import type { PreviewResult } from "../../preview/generator/types";
import {
  COMEER,
  comeerScript,
  NEUTRAL_BORDER_FUZZINESS,
  NEUTRAL_BORDER_PICK,
  NEUTRAL_TOP_BORDER_FIX,
  OVERSIZED_BASE_SIZE,
  playerLandsStepScript,
  RANGES,
  TINY_MAP_WIDTH,
  WRONG_BORDER,
  type LandScriptOptions,
} from "./comeerValues";

/** Runs the real parse and the real generation. `snapshots` false skips the per-stage copies, which the cheap diagonal prefilter does not need. */
export type SeedCheckGenerate = (
  source: string,
  seed: number,
  snapshots: boolean,
) => PreviewResult;

export interface SeedCheckDeps {
  generate: SeedCheckGenerate;
  /** Terrain id of WATER, resolved from the constants table by the caller. */
  waterId: number;
}

export interface SeedProperty {
  /** Stable name, quoted in the test failure so a red run says which claim broke. */
  name: string;
  ok: boolean;
  detail: string;
}

export interface SeedReport {
  seed: number;
  ok: boolean;
  properties: SeedProperty[];
}

// ---------------------------------------------------------------------------
// Reading a generation
// ---------------------------------------------------------------------------

interface S1Reading {
  dim: number;
  /** Connected-component id per tile over every non-water tile, -1 for water. 4-connected, the way terrain is built (CLAUDE.md, scenario-probe note). */
  component: Int32Array;
  /** Distance from the map edge to the nearest land tile, 999 when there is no land. */
  nearestEdge: number;
  origins: { x: number; y: number; player: number | undefined }[];
}

export function readS1(result: PreviewResult, waterId: number): S1Reading {
  const snapshot = result.snapshots?.find((s) => s.stage === "S1");
  if (snapshot === undefined) throw new Error("generation has no S1 snapshot");
  const { dim, terrain } = snapshot;
  const component = new Int32Array(dim * dim).fill(-1);
  const stack: number[] = [];
  let nearestEdge = 999;
  let next = 0;
  for (let i = 0; i < dim * dim; i++) {
    if (terrain[i] === waterId) continue;
    const x = i % dim;
    const y = (i / dim) | 0;
    nearestEdge = Math.min(nearestEdge, x, y, dim - 1 - x, dim - 1 - y);
    if (component[i] !== -1) continue;
    component[i] = next;
    stack.push(i);
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % dim;
      const cy = (c / dim) | 0;
      // Four explicit neighbours, not a [dx, dy] table: this loop runs on
      // every land tile of every generation, and allocating a pair per
      // neighbour is the cost the time-it-first rule warns against.
      if (cx > 0) visit(c - 1);
      if (cx < dim - 1) visit(c + 1);
      if (cy > 0) visit(c - dim);
      if (cy < dim - 1) visit(c + dim);
    }
    next++;
  }
  function visit(j: number): void {
    if (terrain[j] === waterId || component[j] !== -1) return;
    component[j] = next;
    stack.push(j);
  }
  return {
    dim,
    component,
    nearestEdge,
    origins: result.landOrigins.map((o) => ({
      x: o.x,
      y: o.y,
      player: o.player,
    })),
  };
}

/** True when two land origins sit in one connected piece of land. A missing origin tile counts as merged-with-nothing, and is reported separately. */
function sharedComponent(reading: S1Reading): boolean {
  const seen = new Set<number>();
  for (const o of reading.origins) {
    const c = reading.component[o.y * reading.dim + o.x];
    if (c === -1) continue;
    if (seen.has(c)) return true;
    seen.add(c);
  }
  return false;
}

/**
 * The number of water tiles between the two player islands at their closest,
 * counted in Chebyshev steps, or null when they are fused or an origin is not
 * on land. A multi-source breadth first search from the first island that
 * stops at the first tile of the second, through any tile, since the question
 * is how far apart the two pieces of land are and not whether a path of land
 * joins them.
 *
 * Why this and not only `sharedComponent`. Land is joined 4-connected there,
 * which is how terrain is built, but two islands meeting at a corner look
 * joined on screen and are not a gap a ship can use. A check that says "not
 * fused" is true of a one tile channel. The tutorial teaches that
 * `other_zone_avoidance_distance` keeps lands apart, so the check has to be
 * able to tell a channel from a corner touch (measured 2026-10-06, base_size
 * 12 gives a gap of 1 to 2 where 8 to 11 give the full 3).
 */
export function playerWaterGap(reading: S1Reading): number | null {
  const players = reading.origins.filter((o) => o.player !== undefined);
  if (players.length !== 2) return null;
  const { dim, component } = reading;
  const a = component[players[0].y * dim + players[0].x];
  const b = component[players[1].y * dim + players[1].x];
  if (a === -1 || b === -1 || a === b) return null;
  const seen = new Uint8Array(dim * dim);
  let frontier: number[] = [];
  for (let i = 0; i < dim * dim; i++) {
    if (component[i] === a) {
      seen[i] = 1;
      frontier.push(i);
    }
  }
  for (let step = 1; frontier.length > 0; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % dim;
      const y = (c / dim) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= dim || ny >= dim) continue;
          const j = ny * dim + nx;
          if (seen[j] === 1) continue;
          seen[j] = 1;
          if (component[j] === b) return step - 1;
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return null;
}

function landTiles(reading: S1Reading): number {
  let count = 0;
  for (const c of reading.component) if (c !== -1) count++;
  return count;
}

/**
 * How much smaller the islands must get at "Does the square count?" for the
 * copy's "the islands got smaller" to be something a learner sees. Measured
 * 2026-10-14 on seed 217 at 0.62 (2837 tiles an island at version 0, 1754 at
 * version 1), so 0.8 leaves room for another seed and still means a change
 * the eye catches.
 */
const VISIBLE_SHRINK = 0.8;

interface NeutralShape {
  tiles: number;
  /** The furthest column and row the island reaches, read against its right and bottom borders. */
  maxX: number;
  maxY: number;
  /** Island tiles in row 0, the map edge its top corner cut shows against. */
  edgeRow: number;
  /** Island tiles in its widest row. With no cut at the map edge, row 0 is this wide. */
  widestRow: number;
}

/**
 * The one neutral island of a reading made with a single neutral corner, read
 * as the piece of land under its origin. Null when that origin is not on land.
 */
function neutralShape(reading: S1Reading): NeutralShape | null {
  const origin = reading.origins.find((o) => o.player === undefined);
  if (origin === undefined) return null;
  const { dim, component } = reading;
  const id = component[origin.y * dim + origin.x];
  if (id === -1) return null;
  const rows = new Array<number>(dim).fill(0);
  let tiles = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < dim * dim; i++) {
    if (component[i] !== id) continue;
    const x = i % dim;
    const y = (i / dim) | 0;
    tiles++;
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    rows[y]++;
  }
  return { tiles, maxX, maxY, edgeRow: rows[0], widestRow: Math.max(...rows) };
}

function allOriginsOnLand(reading: S1Reading): boolean {
  return reading.origins.every(
    (o) => reading.component[o.y * reading.dim + o.x] !== -1,
  );
}

function playerPair(
  origins: S1Reading["origins"],
): [S1Reading["origins"][number], S1Reading["origins"][number]] | null {
  const players = origins.filter((o) => o.player !== undefined);
  return players.length === 2 ? [players[0], players[1]] : null;
}

// ---------------------------------------------------------------------------
// The cheap prefilter
// ---------------------------------------------------------------------------

/**
 * The offset between the two player origins when they lie on a diagonal, else
 * null. `|dx - dy| <= 1` allows for the ring's one tile of radius variance. With
 * two players on a ring the pair is always opposite each other, so a diagonal
 * offset means both origins lie on one of the map's two diagonals through the
 * centre (docs/tutorial-islands-design.md Sec.5).
 *
 * Needs no snapshots, only `landOrigins`, which every generation carries. That
 * is what keeps the search cheap, about 3 seeds in 100 are diagonal, and a full
 * inspection is run only on those.
 */
export function diagonalOffset(result: PreviewResult): number | null {
  const pair = playerPair(
    result.landOrigins.map((o) => ({ x: o.x, y: o.y, player: o.player })),
  );
  if (pair === null) return null;
  const dx = Math.abs(pair[0].x - pair[1].x);
  const dy = Math.abs(pair[0].y - pair[1].y);
  if (Math.abs(dx - dy) > 1) return null;
  return Math.max(dx, dy);
}

// ---------------------------------------------------------------------------
// The full inspection
// ---------------------------------------------------------------------------

/**
 * The water tiles DE leaves between the two player islands when they meet on
 * a diagonal, one fewer than the avoidance distance. DE's avoidance window is
 * the square of that radius with its two top-row corners trimmed
 * (preview-design.md Sec.6.1, growth rule 6), so diagonal neighbours stop at
 * Chebyshev distance 3, which is 2 water tiles. The copy's "at least three
 * tiles apart" is still true read as a distance (BUG-037, owner's decision
 * 2026-10-14 to match DE and keep the copy). Every seed this check accepts is
 * a diagonal one (`players-on-a-diagonal`), so the diagonal rule is the one
 * that applies.
 */
export const DIAGONAL_AVOIDANCE_GAP =
  COMEER.player.otherZoneAvoidanceDistance - 1;

/**
 * The lane the smallest stated border leaves between land and the map edge.
 * DE's right and bottom borders are inclusive (`R = dim - dim * p / 100` is
 * inside the box), so a border of p percent leaves `dim * p / 100` tiles on
 * the left and top edges and one fewer on the right and bottom (BUG-037).
 * On Tiny, border 10 leaves 12 and 11.
 */
function borderLane(dim: number, border: number): number {
  return Math.floor((dim * border) / 100) - 1;
}

function read(
  deps: SeedCheckDeps,
  seed: number,
  options: LandScriptOptions,
): S1Reading {
  return readS1(deps.generate(comeerScript(options), seed, true), deps.waterId);
}

/**
 * Every claim the tutorial copy makes about this seed, each checked on the
 * real pipeline. A property is a sentence the learner is told, so a failing one
 * names the sentence.
 *
 * Why every value in a spoiler's range is checked and not just the pick: a
 * spoiler that says "8 to 12 works" is a promise about 5 values, and a learner
 * who chose 11 and was told it is fine must not meet the problem it hides.
 */
export function inspectSeed(deps: SeedCheckDeps, seed: number): SeedReport {
  const properties: SeedProperty[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    properties.push({ name, ok, detail });
  };
  const fuzzValues = [
    RANGES.borderFuzziness.min,
    COMEER.player.borderFuzziness,
    RANGES.borderFuzziness.max,
  ];

  // 1. The planted problem. The oversized islands fuse, found by the real
  // pipeline and not only by the geometric rule, and the offset is deep enough
  // that the fusing is certain. An offset of exactly 2 * base_size is a one
  // tile corner touch, which the pipeline does not count as merged (measured
  // 2026-10-06), so the rule needs two tiles of depth.
  const oversizedResult = deps.generate(
    comeerScript({ baseSize: OVERSIZED_BASE_SIZE }),
    seed,
    true,
  );
  const diagonal = diagonalOffset(oversizedResult);
  add(
    "players-on-a-diagonal",
    diagonal !== null,
    diagonal === null
      ? "the two player origins are not on a diagonal"
      : `offset ${diagonal}`,
  );
  const depthOk = diagonal !== null && diagonal <= 2 * OVERSIZED_BASE_SIZE - 2;
  add(
    "overlap-is-two-tiles-deep",
    depthOk,
    `offset ${diagonal ?? "none"} against the limit ${2 * OVERSIZED_BASE_SIZE - 2}`,
  );
  for (const fuzz of fuzzValues) {
    const merged = sharedComponent(
      read(deps, seed, {
        baseSize: OVERSIZED_BASE_SIZE,
        borderFuzziness: fuzz,
      }),
    );
    add(
      `oversized-islands-fuse-at-adherence-${fuzz}`,
      merged,
      merged ? "fused" : "the islands stayed apart",
    );
  }

  // 1b. "Does the square count?" The learner adds behavior_version 1 to the
  // islands they have at that step and is told they got smaller.
  const [classic, versioned] = ([0, 1] as const).map((version) =>
    landTiles(
      readS1(
        deps.generate(playerLandsStepScript(version), seed, true),
        deps.waterId,
      ),
    ),
  );
  add(
    "behavior-version-1-shrinks-the-islands",
    versioned <= classic * VISIBLE_SHRINK,
    `${classic} land tiles at version 0, ${versioned} at version 1`,
  );

  // 2. The fix works, across the whole stated range and the adherence range.
  // A Set, since the pick may be an end of the range (9 is both, 2026-10-14),
  // and the same value checked twice would give two properties one name.
  for (const baseSize of new Set([
    RANGES.safeBaseSize.min,
    COMEER.player.baseSize,
    RANGES.safeBaseSize.max,
  ])) {
    for (const fuzz of fuzzValues) {
      const reading = read(deps, seed, { baseSize, borderFuzziness: fuzz });
      const gap = playerWaterGap(reading);
      // The players' own avoidance distance is the gap the tutorial says the
      // attribute buys, so a value in the stated range has to deliver all of
      // it, as DE measures it on a diagonal, and not merely stay unjoined.
      add(
        `base-size-${baseSize}-keeps-the-avoidance-gap-at-adherence-${fuzz}`,
        gap !== null && gap >= DIAGONAL_AVOIDANCE_GAP,
        gap === null ? "the islands fused" : `${gap} water tiles between them`,
      );
    }
  }

  // 3. The borders. At adherence 100 a border is a wall, so the nearest land
  // tile shows the value directly. The example wrong value must leave land
  // close to the edge, and the stated range must not.
  const wrongEdge = read(deps, seed, {
    border: WRONG_BORDER,
    borderFuzziness: 100,
  }).nearestEdge;
  add(
    `border-${WRONG_BORDER}-is-visibly-too-small`,
    wrongEdge <= 9,
    `nearest land ${wrongEdge} tiles from the edge`,
  );
  for (const border of [
    RANGES.border.min,
    COMEER.player.border,
    RANGES.border.max,
  ]) {
    const reading = read(deps, seed, { border, borderFuzziness: 100 });
    const lane = borderLane(reading.dim, RANGES.border.min);
    add(
      `border-${border}-leaves-a-lane`,
      reading.nearestEdge >= lane,
      `nearest land ${reading.nearestEdge} tiles from the edge against ${lane}`,
    );
  }

  // 4. Reducing adherence for raggedness must not let land reach the edge.
  for (const fuzz of fuzzValues) {
    const edge = read(deps, seed, { borderFuzziness: fuzz }).nearestEdge;
    add(
      `adherence-${fuzz}-stays-off-the-edge`,
      edge >= 5,
      `nearest land ${edge} tiles from the edge`,
    );
  }

  // 5. The finished land section: six lands, none fused with another, at the
  // corners of the neutral range, so the one `rnd()` the learner adds cannot
  // break it whichever end it lands on.
  // The tutorial says the four islands may share a zone or have one each, so
  // both are proven.
  for (const separateNeutralZones of [false, true]) {
    for (const neutralBaseSize of [
      COMEER.neutral.baseSize.min,
      COMEER.neutral.baseSize.max,
    ]) {
      for (const neutralClumpingFactor of [
        COMEER.neutral.clumpingFactor.min,
        COMEER.neutral.clumpingFactor.max,
      ]) {
        const reading = read(deps, seed, {
          neutrals: true,
          neutralBaseSize,
          neutralClumpingFactor,
          separateNeutralZones,
        });
        add(
          `six-separate-islands-${separateNeutralZones ? "own-zones" : "shared-zone"}-at-neutral-size-${neutralBaseSize}-clumping-${neutralClumpingFactor}`,
          allOriginsOnLand(reading) && !sharedComponent(reading),
          allOriginsOnLand(reading)
            ? sharedComponent(reading)
              ? "two islands fused"
              : "separate"
            : "an origin is not on land",
        );
      }
    }
  }

  // 6. The four-corners step says each position may be anything in the near
  // span (0 to 10) or the far span (90 to 99), so the ends of both are proven,
  // and not only Comeer's own 9 and 91 that every property above uses.
  for (const [near, far] of [
    [RANGES.cornerNear.min, RANGES.cornerFar.max],
    [RANGES.cornerNear.max, RANGES.cornerFar.min],
  ]) {
    const reading = read(deps, seed, {
      neutrals: true,
      neutralCorners: [
        [near, near],
        [near, far],
        [far, near],
        [far, far],
      ],
    });
    add(
      `six-separate-islands-with-the-corners-at-${near}-and-${far}`,
      allOriginsOnLand(reading) && !sharedComponent(reading),
      allOriginsOnLand(reading)
        ? sharedComponent(reading)
          ? "two islands fused"
          : "separate"
        : "an origin is not on land",
    );
  }

  // 7. "neutral-island-borders", the corner cut. One neutral island in the
  // 0 0 corner at land_percent 100 and border_fuzziness 100, the state the
  // learner looks at it in, so the outline is the border box itself.
  // "Two of our three corners are chamfered", one against the map edge, and
  // a top_border of NEUTRAL_TOP_BORDER_FIX moves that cut off the map
  // (preview-design Sec.6.1 growth rule 7). One above it does not on
  // the widest box in the range, which is why the fix is that number and
  // the hint ladder steps by 1. The range's size claims hold over a sample
  // of seeds and not one, so they live in `inspectNeutralBorders`.
  const boxedIsland = (border: number, top?: number): NeutralShape | null =>
    neutralShape(
      read(deps, seed, {
        ...NEUTRAL_AT_ZERO,
        neutralLandPercent: 100,
        neutralBorders: { right: border, bottom: border, top },
      }),
    );
  for (const border of new Set([
    RANGES.neutralBorder.min,
    NEUTRAL_BORDER_PICK,
    RANGES.neutralBorder.max,
  ])) {
    const boxed = boxedIsland(border);
    const fixed = boxedIsland(border, NEUTRAL_TOP_BORDER_FIX);
    add(
      `neutral-border-${border}-cuts-the-corner-at-the-map-edge`,
      boxed !== null && boxed.edgeRow < boxed.widestRow,
      `row 0 has ${boxed?.edgeRow ?? "-"} tiles, the widest row ${boxed?.widestRow ?? "-"}`,
    );
    add(
      `top-border-${NEUTRAL_TOP_BORDER_FIX}-moves-the-cut-off-the-map-at-${border}`,
      fixed !== null && fixed.edgeRow === fixed.widestRow,
      `row 0 has ${fixed?.edgeRow ?? "-"} tiles, the widest row ${fixed?.widestRow ?? "-"}`,
    );
  }
  const notch = boxedIsland(
    RANGES.neutralBorder.min,
    NEUTRAL_TOP_BORDER_FIX + 1,
  );
  add(
    `top-border-${NEUTRAL_TOP_BORDER_FIX + 1}-leaves-a-notch-at-${RANGES.neutralBorder.min}`,
    notch !== null && notch.edgeRow < notch.widestRow,
    `row 0 has ${notch?.edgeRow ?? "-"} tiles, the widest row ${notch?.widestRow ?? "-"}`,
  );

  return { seed, ok: properties.every((p) => p.ok), properties };
}

/** The neutral island as the learner has it at "neutral-island-borders", alone in the 0 0 corner. */
const NEUTRAL_AT_ZERO: LandScriptOptions = {
  neutrals: true,
  neutralCorners: [[0, 0]],
  neutralBaseSize: COMEER.neutral.baseSizePick,
  neutralClumpingFactor: COMEER.neutral.clumpingFactorPick,
};

/**
 * How far past its border line a kept border lets the island drift at
 * `NEUTRAL_BORDER_FUZZINESS`. Measured 2026-10-16 at 3 to 4 tiles across the
 * range over 62 seeds at four corner positions, where the unbordered
 * island's wildest run reaches about 20 tiles past the line at 70.
 */
const SOFT_BORDER_DRIFT = 4;

/**
 * How much smaller the mean island may come out with the borders kept, for
 * "without making the island smaller" to hold. A tolerance and not 1.0,
 * since growth takes a different path once a border touches it (at 77 the
 * mean was 0.990 over 378 runs, at 78 it was 0.878).
 */
const NEUTRAL_MEAN_SIZE_FLOOR = 0.98;

/**
 * The step's claims about the range, which hold over many seeds and not on
 * one. Each border in the range, kept at `NEUTRAL_BORDER_FUZZINESS` and
 * land_percent 6, stops the wild growth (no island reaches more than
 * `SOFT_BORDER_DRIFT` past the line, on a sample where the unbordered
 * island's wildest run does), and leaves the island its size on average.
 * Both ends of the near corner span, since the learner may sit anywhere in
 * it.
 */
export function inspectNeutralBorders(
  deps: SeedCheckDeps,
  seeds: readonly number[],
): SeedProperty[] {
  const properties: SeedProperty[] = [];
  const reach = (shape: NeutralShape | null): number =>
    shape === null ? 0 : Math.max(shape.maxX, shape.maxY);
  const runs = seeds.flatMap((seed) =>
    [RANGES.cornerNear.min, RANGES.cornerNear.max].map((corner) => ({
      seed,
      at: {
        ...NEUTRAL_AT_ZERO,
        neutralCorners: [[corner, corner]] as const,
      },
    })),
  );
  const free = runs.map(({ seed, at }) => neutralShape(read(deps, seed, at)));
  const wildest = Math.max(...free.map(reach));
  for (const border of new Set([
    RANGES.neutralBorder.min,
    NEUTRAL_BORDER_PICK,
    RANGES.neutralBorder.max,
  ])) {
    const kept = runs.map(({ seed, at }) =>
      neutralShape(
        read(deps, seed, {
          ...at,
          neutralBorders: {
            right: border,
            bottom: border,
            fuzziness: NEUTRAL_BORDER_FUZZINESS,
          },
        }),
      ),
    );
    // The border line's far tile, inclusive (borderLane's note).
    const line = Math.round(TINY_MAP_WIDTH * (1 - border / 100));
    const farthest = Math.max(...kept.map(reach));
    properties.push({
      name: `neutral-border-${border}-stops-the-wild-growth`,
      ok:
        wildest > line + SOFT_BORDER_DRIFT &&
        farthest <= line + SOFT_BORDER_DRIFT,
      detail: `unbordered islands reach ${wildest}, bordered ${farthest}, against the line at ${line}`,
    });
    const ratios = kept.map((shape, i) =>
      shape === null || free[i] === null ? 0 : shape.tiles / free[i].tiles,
    );
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    properties.push({
      name: `neutral-border-${border}-keeps-the-island-its-size`,
      ok: mean >= NEUTRAL_MEAN_SIZE_FLOOR,
      detail: `mean size ${mean.toFixed(3)} of the unbordered island over ${ratios.length} runs`,
    });
  }
  return properties;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface FindOptions {
  /** First seed to try. */
  from?: number;
  /** How many seeds to try at most. */
  limit?: number;
}

/**
 * The first seed at or after `from` that passes every property, or null.
 *
 * The prefilter generates once per seed without snapshots and keeps only the
 * diagonal ones, so the expensive inspection runs on about 3 percent of the
 * seeds tried.
 */
export function findComeerSeed(
  deps: SeedCheckDeps,
  options: FindOptions = {},
): { seed: number; tried: number } | null {
  const from = options.from ?? 1;
  // 600 is a measurement, not a budget (2026-10-06). A cheap generation is
  // about 23 ms and a full inspection about 700 ms, and about 3 in 100 seeds
  // reach one, so a search that finds nothing costs roughly 14 s plus 18
  // inspections, near 26 s. The runner's 60 s timeout is twice that.
  const limit = options.limit ?? 600;
  const probe = comeerScript({ baseSize: OVERSIZED_BASE_SIZE });
  for (let seed = from; seed < from + limit; seed++) {
    const offset = diagonalOffset(deps.generate(probe, seed, false));
    if (offset === null || offset > 2 * OVERSIZED_BASE_SIZE - 2) continue;
    if (inspectSeed(deps, seed).ok) return { seed, tried: seed - from + 1 };
  }
  return null;
}

export type SeedOutcome =
  /** One of the seeds the check was given passed, the first that did. */
  | { status: "pinned"; seed: number }
  | { status: "found"; seed: number; tried: number }
  | { status: "none"; failed: string[] };

/**
 * What runs in the background when the tutorial starts. Checks the seeds it is
 * given in order first, since each is one inspection and one of them almost
 * always passes, and searches only if the engine has changed under all of
 * them. The candidates are the pinned seed and, after an earlier search, the
 * seed that search found (seedMemory.ts). `none` is a real result the tutorial
 * has to handle, so it carries the failing property names for the console.
 */
export function verifyOrFindSeed(
  deps: SeedCheckDeps,
  candidates: readonly number[],
  options: FindOptions = {},
): SeedOutcome {
  let lastReport: SeedReport | null = null;
  for (const seed of candidates) {
    const report = inspectSeed(deps, seed);
    if (report.ok) return { status: "pinned", seed };
    lastReport = report;
  }
  const found = findComeerSeed(deps, options);
  if (found !== null) {
    return { status: "found", seed: found.seed, tried: found.tried };
  }
  return {
    status: "none",
    failed: (lastReport?.properties ?? [])
      .filter((p) => !p.ok)
      .map((p) => p.name),
  };
}
