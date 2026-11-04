// S4: terrains, docs/preview-design.md Sec.6.4 (rev 11). PURE (CLAUDE.md hard
// rule / preview-design Sec.2).
//
// THIS STAGE REPRODUCES THE GAME TILE FOR TILE. It is the terrain stage the
// owner's DE study measured (`tools/scenario-probe/de-study/evidence/
// de-terrain-stage.md`, rounds ET and GP), on the same stream as the land,
// elevation and cliff stages. `deWholeScriptMaps.test.ts` holds it to every
// saved terrain map of the study. One draw out of place moves every clump of
// every later pass, so the order of the draws below matters as much as the
// rules they serve.
//
// THE MODEL, in brief.
//   - The stage burns one draw, then runs every `create_terrain` as its own
//     pass, in script order. There is no beach while it runs, not even
//     before the first pass, so `base_terrain BEACH` finds only BEACH that a
//     land or an earlier pass painted.
//   - A pass puts every tile in a main list, shuffles it by moving random
//     tiles to the front, seeds its clumps from the front of the list and
//     grows them round robin from priority lists, the same lists and insert
//     rule as the elevation stage (`TileLists`).
//   - A pass paints a little more than its target, because a drain at the
//     end paints every listed tile that sits between two painted ones.
//   - Painting writes the tile and marks it with the pass's `beach_terrain`.
//     The beach itself waits for the end of the stage (`index.ts`), which
//     reads the mark.
//
// The end of the stage is three more steps that `index.ts` runs in order.
// Composite terrains resolve (`resolveComposites`), the cliff lines get
// their earlier terrain back and WATER is cleaned (`finishTerrainStage` in
// cliffs.ts), and the beach rule runs (`applyAutomaticBeach`).
//
// This file replaced a statistical model (a 122 * dim / 120 budget, a
// circularity table and a beach pass after every command). Each of those
// was fitted to measured counts and each was wrong in kind. Its history is
// in docs/build-log.md.

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  SimulationNote,
  TileGrid,
} from "./types";
import { resumeDeStream, type DeStreamState } from "./deRandom";
import { TileLists } from "./elevation";
import { f32Div, f32Sqrt } from "./float32";
import {
  DEPTH_LAND,
  NO_LAYER,
  beachTerrainFor,
  resolveTerrainId,
  waterDepthMask,
  type TerrainConstantForMasks,
} from "./grid";
import { pushFailure } from "./placement";
import {
  CLASS_SHORE,
  COMPOSITE_TERRAINS,
  classOf,
  terrainClassTable,
} from "./terrainClass";

// ---------------------------------------------------------------------------
// Constants (de-terrain-stage.md Sections 2 to 6)
// ---------------------------------------------------------------------------

/** Terrain ids the rules name directly. Engine facts, as `cliffs.ts`'s BEACH is. */
const GRASS = 0;
const WATER = 1;
/** `number_of_clumps` above this is read as this (gt7, 9999 clumps at 252). */
const MAX_CLUMPS = 999;
/** `clumping_factor` when the pass writes none. */
const DEFAULT_CLUMPING = 20;
/** `set_avoid_player_start_areas` bare or 0. */
const DEFAULT_AVOID = 13;
const AVOID_WEIGHT = 20;
const PENALTY_CAP = 101;
/** `spacing_to_specific_terrain` ignores terrain ids from here up. */
const SPECIFIC_TERRAIN_LIMIT = 200;
/** "No mark", the value a tile's beach mark holds when no pass with `beach_terrain` painted it last. */
export const NO_BEACH_MARK = -1;

const MAIN = 0;
const CLUMP0 = 1;
const LIST_COUNT = CLUMP0 + MAX_CLUMPS;

// ---------------------------------------------------------------------------
// Reading one pass's attributes
// ---------------------------------------------------------------------------

function firstAttr(cmd: InstantiatedCommand, name: string) {
  return cmd.attributes.get(name)?.[0];
}

function argOf(
  cmd: InstantiatedCommand,
  name: string,
  index = 0,
): InstantiatedValue {
  return firstAttr(cmd, name)?.args[index]?.value;
}

/**
 * A number attribute, `fallback` when the attribute is absent. A known
 * symbol with no value reads as 0, as in every other stage (BUG-021).
 */
function numAttr(
  cmd: InstantiatedCommand,
  name: string,
  fallback: number,
  index = 0,
): number {
  const arg = firstAttr(cmd, name)?.args[index];
  if (arg === undefined) return fallback;
  if (typeof arg.value === "number") return Math.trunc(arg.value);
  return arg.value === undefined ? 0 : fallback;
}

/**
 * A terrain slot as the game reads it. A name the script never defined
 * reads as terrain 0 (de-findings-cg-cj.md 2.9, Bazi's placeholders), so an
 * unresolved name still runs the pass and spends its draws.
 */
function terrainOf(
  value: InstantiatedValue,
  instantiated: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
): number {
  return (
    resolveTerrainId(
      constants,
      value,
      instantiated.symbols,
      instantiated.aliases,
    ) ?? 0
  );
}

/** The later of two attributes by source position, or the one present. */
function later(
  cmd: InstantiatedCommand,
  a: string,
  b: string,
): string | undefined {
  const x = firstAttr(cmd, a);
  const y = firstAttr(cmd, b);
  if (x && y) return x.span.start > y.span.start ? a : b;
  if (x) return a;
  if (y) return b;
  return undefined;
}

export interface TerrainAmount {
  /** The pass's target, painted tiles including the seeds. */
  tiles: number;
  clumps: number;
  /** True when the target came from a percentage, `land_percent` or a negative `number_of_tiles`. */
  percentage: boolean;
}

/**
 * The pass's target and clump count (de-terrain-stage.md 2).
 *
 * `number_of_tiles` defaults to the map's side, 120 on Tiny, which explains
 * the measured counts just above it that the guide's 122 was fitted to. A
 * negative count is a percentage, and so is `land_percent`. A scale key
 * scales a count given as a number, and `set_scale_by_groups` scales the
 * clumps too. With both keys the later one counts.
 */
export function terrainAmount(
  cmd: InstantiatedCommand,
  dim: number,
): TerrainAmount {
  const area = dim * dim;
  let tiles = dim;
  let percentage = false;
  const amountKey = later(cmd, "number_of_tiles", "land_percent");
  if (amountKey === "number_of_tiles") {
    const n = numAttr(cmd, "number_of_tiles", dim);
    if (n < 0) {
      tiles = Math.floor((-n * area) / 100);
      percentage = true;
    } else tiles = n;
  } else if (amountKey === "land_percent") {
    const arg = firstAttr(cmd, "land_percent")?.args[0];
    const p =
      arg?.exact ?? (typeof arg?.value === "number" ? arg.value : undefined);
    tiles = p !== undefined && p > 0 ? Math.floor((p * area) / 100) : 0;
    percentage = true;
  }
  let clumps = numAttr(cmd, "number_of_clumps", 1);
  const scale = later(cmd, "set_scale_by_size", "set_scale_by_groups");
  if (scale !== undefined && !percentage && tiles > 0)
    tiles = Math.floor((tiles * area) / 10000);
  if (scale === "set_scale_by_groups")
    clumps = Math.floor((clumps * area) / 10000);
  return {
    tiles,
    clumps: Math.max(0, Math.min(clumps, MAX_CLUMPS)),
    percentage,
  };
}

// ---------------------------------------------------------------------------
// The avoidance penalty and slopes, per map
// ---------------------------------------------------------------------------

/**
 * Every tile's penalty from the player lands' origins (de-terrain-stage.md
 * 5). The elevation stage's weight with `d` in place of 13. Each origin
 * reaches only tiles within `d`, so it touches its own box, not the map.
 */
function avoidancePenalty(
  origins: readonly LandOrigin[],
  dim: number,
  d: number,
): Uint8Array {
  const sum = new Int32Array(dim * dim);
  // Every player land counts, two at one origin twice, as in the game.
  // Caverns sends six of player 1's lands to the map centre.
  for (const origin of origins) {
    if (origin.player === undefined) continue;
    for (
      let y = Math.max(origin.y - d, 0);
      y <= Math.min(origin.y + d, dim - 1);
      y++
    )
      for (
        let x = Math.max(origin.x - d, 0);
        x <= Math.min(origin.x + d, dim - 1);
        x++
      ) {
        const dx = x - origin.x;
        const dy = y - origin.y;
        const r = Math.floor(f32Sqrt(dx * dx + dy * dy));
        if (r < d) sum[y * dim + x] += AVOID_WEIGHT * (d - r);
      }
  }
  const penalty = new Uint8Array(dim * dim);
  for (let i = 0; i < sum.length; i++)
    penalty[i] = Math.min(sum[i], PENALTY_CAP);
  return penalty;
}

/**
 * A tile is sloped when one of its 8 neighbours is exactly one level higher.
 * A neighbour off the map counts as the tile's own height, so a hilltop is
 * flat, and so is a tile beside a two-level step (de-terrain-stage.md 4).
 * Heights are final by this stage, so the mask is built once.
 */
function slopedTiles(grid: TileGrid): Uint8Array {
  const { dim, elevation } = grid;
  const out = new Uint8Array(dim * dim);
  for (let y = 0; y < dim; y++)
    for (let x = 0; x < dim; x++) {
      const h = elevation[y * dim + x];
      search: for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            (dx === 0 && dy === 0) ||
            nx < 0 ||
            ny < 0 ||
            nx >= dim ||
            ny >= dim
          )
            continue;
          if (elevation[ny * dim + nx] === h + 1) {
            out[y * dim + x] = 1;
            break search;
          }
        }
    }
  return out;
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

interface Pass {
  cmd: InstantiatedCommand;
  terrain: number;
  amount: TerrainAmount;
  /** The terrain and layer halves of the base test, each only when it applies. */
  terrainPart: boolean;
  layerPart: boolean;
  baseTerrain: number;
  baseLayer: number;
  mask: number;
  /** What a painted tile holds, which the eligibility count and the drain look for. */
  targetTerrain: number;
  targetLayer: number;
  heightMin: number;
  heightMax: number;
  spacing: number;
  specific: { terrain: number; distance: number }[];
  flatOnly: boolean;
  /** Undefined without `set_avoid_player_start_areas`. */
  avoid?: number;
  clumping: number;
  beachMark: number;
}

function readPass(
  cmd: InstantiatedCommand,
  instantiated: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
  dim: number,
): Pass {
  const terrain = terrainOf(cmd.args[0]?.value, instantiated, constants);
  const hasBaseTerrain = cmd.attributes.has("base_terrain");
  const hasBaseLayer = cmd.attributes.has("base_layer");
  const mask = cmd.attributes.has("terrain_mask")
    ? numAttr(cmd, "terrain_mask", 1)
    : 0;
  // The terrain half applies when `base_terrain` is given or neither line
  // is, the layer half when `base_layer` is given or the pass masks over.
  // With both lines a tile needs both (gt3).
  const terrainPart = hasBaseTerrain || !hasBaseLayer;
  const layerPart = hasBaseLayer || mask === 1;
  const baseTerrain = hasBaseTerrain
    ? terrainOf(argOf(cmd, "base_terrain"), instantiated, constants)
    : GRASS;
  const baseLayer = hasBaseLayer
    ? terrainOf(argOf(cmd, "base_layer"), instantiated, constants)
    : NO_LAYER;
  // de-terrain-stage.md 2's table. A mask without `base_terrain` takes
  // GRASS as its base here, a reading no DE map has tested.
  const [targetTerrain, targetLayer] =
    mask === 1
      ? [baseTerrain, terrain]
      : mask === 2
        ? [terrain, baseTerrain]
        : [terrain, NO_LAYER];

  const limits = firstAttr(cmd, "height_limits");
  const lo = limits?.args[0]?.value;
  const hi = limits?.args[1]?.value;

  const specific: { terrain: number; distance: number }[] = [];
  for (const attr of cmd.attributes.get("spacing_to_specific_terrain") ?? []) {
    const distance = attr.args[1]?.value;
    if (typeof distance !== "number") continue;
    const id = terrainOf(attr.args[0]?.value, instantiated, constants);
    if (id < SPECIFIC_TERRAIN_LIMIT)
      specific.push({ terrain: id, distance: Math.trunc(distance) });
  }

  let avoid: number | undefined;
  if (cmd.attributes.has("set_avoid_player_start_areas")) {
    const d = numAttr(cmd, "set_avoid_player_start_areas", DEFAULT_AVOID);
    avoid = d > 0 ? d : DEFAULT_AVOID;
  }

  return {
    cmd,
    terrain,
    amount: terrainAmount(cmd, dim),
    terrainPart,
    layerPart,
    baseTerrain,
    baseLayer,
    mask,
    targetTerrain,
    targetLayer,
    heightMin: typeof lo === "number" && limits ? lo : -Infinity,
    heightMax: typeof hi === "number" && limits ? hi : Infinity,
    spacing: Math.max(0, numAttr(cmd, "spacing_to_other_terrain_types", 0)),
    specific,
    // Every WATER pass is flat-only by itself (t7), which only matters with
    // a spacing, since flatness is read inside the spacing square (gt2).
    flatOnly: cmd.attributes.has("set_flat_terrain_only") || terrain === WATER,
    avoid,
    clumping: numAttr(cmd, "clumping_factor", DEFAULT_CLUMPING),
    beachMark: cmd.attributes.has("beach_terrain")
      ? terrainOf(argOf(cmd, "beach_terrain"), instantiated, constants)
      : NO_BEACH_MARK,
  };
}

interface PassOutcome {
  seeded: number;
  painted: number;
  /** Whether any tile the seed search popped passed the base test. */
  sawBase: boolean;
}

/**
 * One `create_terrain` (de-terrain-stage.md 3 to 6). Every draw comes off
 * `stream`, in the order the sections give.
 */
function runPass(
  pass: Pass,
  grid: TileGrid,
  sloped: Uint8Array,
  origins: readonly LandOrigin[],
  lists: TileLists,
  beachMark: Int16Array,
  stream: ReturnType<typeof resumeDeStream>,
): PassOutcome {
  const { dim, terrain, layer, elevation } = grid;
  const n = dim * dim;
  const { tiles: target, clumps } = pass.amount;
  const penalty =
    pass.avoid === undefined
      ? undefined
      : avoidancePenalty(origins, dim, pass.avoid);

  const passesBase = (i: number): boolean =>
    (!pass.terrainPart || terrain[i] === pass.baseTerrain) &&
    (!pass.layerPart || layer[i] === pass.baseLayer);
  const holdsTarget = (i: number): boolean =>
    terrain[i] === pass.targetTerrain && layer[i] === pass.targetLayer;

  /** The eligibility m of 4: 0 refuses, otherwise 1 + painted tiles in the 5 x 5 square. */
  const eligibility = (i: number): number => {
    const h = elevation[i];
    if (h < pass.heightMin || h > pass.heightMax) return 0;
    const x = i % dim;
    const y = (i - x) / dim;
    const s = pass.spacing;
    if (s > 0)
      for (let ny = Math.max(y - s, 0); ny <= Math.min(y + s, dim - 1); ny++)
        for (
          let nx = Math.max(x - s, 0);
          nx <= Math.min(x + s, dim - 1);
          nx++
        ) {
          const j = ny * dim + nx;
          if (
            pass.terrainPart &&
            terrain[j] !== pass.baseTerrain &&
            terrain[j] !== pass.targetTerrain
          )
            return 0;
          if (
            pass.layerPart &&
            layer[j] !== pass.baseLayer &&
            layer[j] !== pass.targetLayer
          )
            return 0;
          if (pass.flatOnly && sloped[j] !== 0) return 0;
        }
    if (pass.terrainPart)
      for (const { terrain: other, distance: d } of pass.specific)
        for (let ny = Math.max(y - d, 0); ny <= Math.min(y + d, dim - 1); ny++)
          for (
            let nx = Math.max(x - d, 0);
            nx <= Math.min(x + d, dim - 1);
            nx++
          )
            if (terrain[ny * dim + nx] === other) return 0;
    let m = 1;
    for (let ny = Math.max(y - 2, 0); ny <= Math.min(y + 2, dim - 1); ny++)
      for (let nx = Math.max(x - 2, 0); nx <= Math.min(x + 2, dim - 1); nx++)
        if (holdsTarget(ny * dim + nx)) m++;
    return m;
  };

  const paint = (i: number): void => {
    if (pass.mask === 1) layer[i] = pass.terrain;
    else if (pass.mask === 2) {
      // The old terrain moves under as the layer. Painting a tile's own
      // terrain again leaves its layer as it was (Pag's DIRT under DIRT).
      if (terrain[i] !== pass.terrain) layer[i] = terrain[i];
      terrain[i] = pass.terrain;
    } else {
      terrain[i] = pass.terrain;
      layer[i] = NO_LAYER;
    }
    beachMark[i] = pass.beachMark;
  };

  // 3. The main list, every tile in index order, then the shuffle. The last
  // row and column are never picked, and the draws are spent even when the
  // pass has no clumps.
  lists.reset();
  for (let i = n - 1; i >= 0; i--) lists.pushFront(MAIN, i);
  const moves = Math.floor(n / 8);
  for (let k = 0; k < moves; k++) {
    const x = stream.bounded(dim - 1);
    const y = stream.bounded(dim - 1);
    lists.pushFront(MAIN, y * dim + x);
  }
  if (clumps === 0) return { seeded: 0, painted: 0, sawBase: false };

  // 5. Seeds. A clump that finds none ends the seeding for every later one.
  const r = Math.max(2 * Math.floor(f32Sqrt(f32Div(target, clumps))), 2);
  let seeded = 0;
  let painted = 0;
  let sawBase = false;
  while (seeded < clumps) {
    let seed = -1;
    for (let i = lists.pop(MAIN); i !== -1; i = lists.pop(MAIN)) {
      if (!passesBase(i)) continue;
      sawBase = true;
      if (penalty !== undefined && penalty[i] !== 0) continue;
      if (eligibility(i) === 0) continue;
      seed = i;
      break;
    }
    if (seed === -1) break;
    const x = seed % dim;
    const y = (seed - x) / dim;
    for (let ny = Math.max(y - r, 0); ny <= Math.min(y + r, dim - 1); ny++)
      for (let nx = Math.max(x - r, 0); nx <= Math.min(x + r, dim - 1); nx++)
        lists.remove(ny * dim + nx);
    paint(seed);
    painted++;
    const q = CLUMP0 + seeded;
    // Left, up, right, down, untested until they are popped.
    if (x > 0) lists.insert(q, seed - 1, 0);
    if (y > 0) lists.insert(q, seed - dim, 0);
    if (x + 1 < dim) lists.insert(q, seed + 1, 0);
    if (y + 1 < dim) lists.insert(q, seed + dim, 0);
    seeded++;
  }

  // 6. Growth, round robin over the clumps that found a seed, until the
  // target is met or a whole round pops nothing. A refused tile still
  // counts as a pop.
  const f = pass.clumping;
  grow: for (;;) {
    let popped = false;
    for (let c = 0; c < seeded; c++) {
      if (painted >= target) break grow;
      const q = CLUMP0 + c;
      const i = lists.pop(q);
      if (i === -1) continue;
      popped = true;
      const p = penalty === undefined ? 0 : penalty[i];
      if (penalty !== undefined && p > stream.bounded(100)) continue;
      const m = eligibility(i);
      if (m === 0 || !passesBase(i)) continue;
      paint(i);
      const x = i % dim;
      const y = (i - x) / dim;
      const base = 250 - f * m + p;
      // Left, right, up, down, one draw for each that passes the base test.
      if (x > 0 && passesBase(i - 1))
        lists.insert(q, i - 1, base + stream.bounded(100));
      if (x + 1 < dim && passesBase(i + 1))
        lists.insert(q, i + 1, base + stream.bounded(100));
      if (y > 0 && passesBase(i - dim))
        lists.insert(q, i - dim, base + stream.bounded(100));
      if (y + 1 < dim && passesBase(i + dim))
        lists.insert(q, i + dim, base + stream.bounded(100));
      painted++;
    }
    if (!popped) break;
  }

  // The drain. Every tile still listed that sits between two tiles holding
  // the target, left and right, takes the target too. No tests and no
  // draws. It writes the target rather than painting: under `terrain_mask
  // 1` a seed's untested neighbour that is not the base gets the base
  // terrain under the layer, not its own (Menindee's PALM_DESERT tiles,
  // de-terrain-stage.md 6 as amended 2026-11-02). Under mask 2 that is the
  // study's reading, untested by any map.
  for (let c = 0; c < seeded; c++) {
    const q = CLUMP0 + c;
    for (let i = lists.pop(q); i !== -1; i = lists.pop(q)) {
      const x = i % dim;
      if (x > 0 && x + 1 < dim && holdsTarget(i - 1) && holdsTarget(i + 1)) {
        terrain[i] = pass.targetTerrain;
        layer[i] = pass.targetLayer;
        beachMark[i] = pass.beachMark;
      }
    }
  }
  return { seeded, painted, sawBase };
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface TerrainsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
  /** The game's stream after this stage, where the connections start. */
  stream: DeStreamState;
  /** Each tile's `beach_terrain` mark, `NO_BEACH_MARK` for none. The end of the stage reads it. */
  beachMark: Int16Array;
}

/**
 * Sec.6.4: `<TERRAIN_GENERATION>`. Mutates `grid.terrain` and `grid.layer`
 * and returns one report per `create_terrain`, the stream and the beach
 * marks. The burned draw is spent with no section too (de-terrain-stage.md
 * 1, round CO's Part 0).
 */
export function applyTerrains(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  streamState: DeStreamState,
): TerrainsResult {
  const { dim } = grid;
  const n = dim * dim;
  const stream = resumeDeStream(streamState);
  stream.raw(); // the burned draw
  const beachMark = new Int16Array(n).fill(NO_BEACH_MARK);
  const commands = (
    instantiated.sections.get("TERRAIN_GENERATION") ?? []
  ).filter((cmd) => cmd.name === "create_terrain");
  const reports: CommandReport[] = [];
  if (commands.length === 0)
    return { reports, notes: [], stream: stream.state(), beachMark };

  const sloped = slopedTiles(grid);
  const lists = new TileLists(LIST_COUNT, n);
  for (const cmd of commands) {
    const pass = readPass(cmd, instantiated, constants, dim);
    const { seeded, painted, sawBase } = runPass(
      pass,
      grid,
      sloped,
      origins,
      lists,
      beachMark,
      stream,
    );
    const failures: PlacementFailure[] = [];
    const { tiles, clumps, percentage } = pass.amount;
    // Only what an author would want to hear. A pass that converts all of
    // one terrain (`land_percent 100` and thousands of clumps, a common
    // idiom) always drops clumps and falls short of its percentage, so those
    // two say nothing about a mistake. A pass that placed nothing does, and
    // so does a count the author wrote as a number.
    if (clumps > 0 && seeded === 0)
      pushFailure(failures, {
        bucket: sawBase ? "spacingConflict" : "terrainAbsent",
        commandSpan: cmd.span,
        stage: "S4",
        entity: "terrain patch",
        detail: sawBase
          ? "Every tile on this command's base terrain fails its height, spacing or player-avoidance test, so it placed nothing."
          : "No tile on the map matches this command's base terrain and base layer when it runs, so it placed nothing.",
      });
    else if (!percentage && painted < tiles)
      pushFailure(failures, {
        bucket: "growthShortfall",
        commandSpan: cmd.span,
        stage: "S4",
        entity: "terrain patch",
        detail: `This command painted ${painted} of its ${tiles} tiles before its clumps ran out of tiles they could grow into.`,
        data: { owned: painted, target: tiles },
      });
    reports.push({
      commandSpan: cmd.span,
      stage: "S4",
      attempted: clumps,
      placed: seeded,
      failures,
    });
  }
  return { reports, notes: [], stream: stream.state(), beachMark };
}

// ---------------------------------------------------------------------------
// The end of the stage
// ---------------------------------------------------------------------------

/**
 * Composite terrains, at the end of the terrain stage and before its beach
 * (de-findings-cg-cj.md 5.1). A tile painted with a composite, as its
 * terrain or as its layer, shows the composite's primary terrain with its
 * secondary as the layer.
 *
 * Returns what each resolved tile was painted as. Later stages read that
 * rather than the resolved terrain. The connections read a composite
 * painted as a tile's terrain (5.3), so a `replace_terrain` naming
 * composite 62 still finds Ra's underbrush, and the study found the object
 * stage reading both kinds as painted. Two values per tile, rather than
 * resolving late, because the beach reads the resolved one, and a resolved 77
 * beside water becomes BEACH.
 */
export function resolveComposites(grid: TileGrid): CompositeRecord {
  const { terrain, layer } = grid;
  const record: CompositeRecord = {
    kind: new Uint8Array(terrain.length),
    terrain: terrain.slice(),
    layer: layer.slice(),
  };
  for (let i = 0; i < terrain.length; i++) {
    const asTerrain = COMPOSITE_TERRAINS.get(terrain[i]);
    if (asTerrain !== undefined) {
      record.kind[i] = COMPOSITE_AS_TERRAIN;
      [terrain[i], layer[i]] = asTerrain;
      continue;
    }
    const asLayer = COMPOSITE_TERRAINS.get(layer[i]);
    if (asLayer !== undefined) {
      record.kind[i] = COMPOSITE_AS_LAYER;
      [terrain[i], layer[i]] = asLayer;
    }
  }
  return record;
}

/** `CompositeRecord.kind`, a tile painted with a composite as its terrain. */
export const COMPOSITE_AS_TERRAIN = 1;
/** `CompositeRecord.kind`, a tile painted with a composite as its layer. */
export const COMPOSITE_AS_LAYER = 2;

/**
 * What the terrain stage's end resolved, for the stages that read the map as
 * painted. Plain typed arrays, so it travels like the grid does.
 */
export interface CompositeRecord {
  /** Per tile, `COMPOSITE_AS_TERRAIN`, `COMPOSITE_AS_LAYER` or 0. A stage that repaints the tile sets it back to 0. */
  kind: Uint8Array;
  /** Every tile's terrain and layer as painted, before resolving. Meaningful only where `kind` is set. */
  terrain: Uint16Array;
  layer: Uint16Array;
}

/**
 * The map as painted, for the object stage. A tile still marked in `record`
 * shows its composite, every other tile what `grid` holds. Returns new
 * arrays and leaves `grid` alone.
 */
export function paintedView(
  grid: TileGrid,
  record: CompositeRecord,
): { terrain: Uint16Array; layer: Uint16Array } {
  const terrain = grid.terrain.slice();
  const layer = grid.layer.slice();
  for (let i = 0; i < terrain.length; i++)
    if (record.kind[i] !== 0) {
      terrain[i] = record.terrain[i];
      layer[i] = record.layer[i];
    }
  return { terrain, layer };
}

/**
 * A beach tile has no layer, run after the connections
 * (de-findings-cg-cj.md 5.2, Rekawa, Comeer and Menindee). A beach is a
 * terrain whose placement class has the shore bit. Shallows keep their
 * layers, and so does a layer equal to its own terrain.
 */
export function clearBeachLayers(
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
): void {
  const table = terrainClassTable(constants);
  for (let i = 0; i < grid.terrain.length; i++)
    if (
      grid.layer[i] !== NO_LAYER &&
      (classOf(table, grid.terrain[i]) & CLASS_SHORE) !== 0
    )
      grid.layer[i] = NO_LAYER;
}

/** Options for one run of the beach rule. */
export interface AutomaticBeachOptions {
  /** Each tile's `beach_terrain` mark from the terrain stage, `NO_BEACH_MARK` for none. */
  beachMark?: Int16Array;
}

/**
 * Writes each tile's beach terrain onto it where it borders something DEEPER
 * than itself.
 *
 * NOT driven by the script. DE's terrain table states it on the beach
 * terrains' own rows, id 2 BEACH is "automatically placed when land terrains
 * border water", and `create_terrain`'s `beach_terrain` picks another beach
 * for the tiles a pass painted.
 *
 * WHERE IT RUNS, measured. Once at the end of the terrain stage, after the
 * cliff lines are restored and WATER is cleaned, and again at the end of the
 * connection stage when the script has one. Never at the end of the land
 * stage, never between `create_terrain` passes (t7, 562 and 571 tiles off
 * with a pass after each) and never before the first one (gt1). An earlier
 * version beached after every pass, on the argument that the 67 corpus uses
 * of `base_terrain BEACH` need a beach to match. They find only BEACH a land
 * or an earlier pass painted.
 *
 * THREE DEPTHS ARE READ AND ONLY THE LANDWARD BOUNDARY IS EDGED. The map has
 * land, shallows (`isHybrid`) and open water. A beach appears where land
 * meets shallows and where land meets open water. Where shallows meet open
 * water the engine lays none (RMSTEST_52, BUG-010). `grid.ts`'s
 * `terrainDepth` defines the ordering.
 *
 * Adjacency is 8 connected (RMSTEST_75 and RMSTEST_52, `deBeachMaps.test.ts`),
 * so a coast at 45 degrees is two tiles thick. A neighbour off the map is not
 * deeper. Depth is read from a mask taken before any write, so a beach laid
 * on one tile cannot make its neighbour look inland.
 *
 * `beachMark` is the terrain stage's mark (de-terrain-stage.md 6 and 7). A
 * beached tile whose mark names a terrain takes it instead of its own
 * beach, which is how `beach_terrain DLC_BEACH2` edges new water with
 * terrain 51 (t7). The end of the connection stage passes no marks, and its
 * run leaves such a beach alone because a beach grows no beach of its own
 * (cn8c).
 */
export function applyAutomaticBeach(
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  options: AutomaticBeachOptions = {},
): number {
  const { beachMark } = options;
  const { dim } = grid;
  const n = dim * dim;
  const { depth } = waterDepthMask(grid, constants);
  // Memoised per terrain id, since `beachTerrainFor` scans the constants array and
  // a coastline is thousands of tiles over a handful of distinct terrains.
  const beachById = new Map<number, number | undefined>();
  let written = 0;

  for (let i = 0; i < n; i++) {
    const own = depth[i];
    // Only dry land takes a beach. A shallow facing open water does not
    // (RMSTEST_52: 3 and 2 tiles there, a triple junction, not a boundary).
    if (own !== DEPTH_LAND) continue;
    if (!bordersDeeper(depth, dim, i, own)) continue;

    const terrainId = grid.terrain[i];
    let beach = beachById.get(terrainId);
    if (beach === undefined && !beachById.has(terrainId)) {
      beach = beachTerrainFor(constants, terrainId);
      beachById.set(terrainId, beach);
    }
    // A terrain that grows no beach of its own, a beach among them, keeps
    // its tile whatever its mark says.
    if (beach === undefined) continue;
    const mark = beachMark?.[i] ?? NO_BEACH_MARK;
    if (mark !== NO_BEACH_MARK) beach = mark;
    if (beach === terrainId) continue;
    grid.terrain[i] = beach;
    written++;
  }
  return written;
}

/**
 * Whether tile `i` has a deeper tile among its eight neighbours. A loop over
 * the offsets rather than eight spelled out conditions, because the bounds
 * check is the part that goes wrong when written eight times.
 */
function bordersDeeper(
  depth: Uint8Array,
  dim: number,
  i: number,
  own: number,
): boolean {
  const x = i % dim;
  const y = (i - x) / dim;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= dim) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      if ((dx === 0 && dy === 0) || nx < 0 || nx >= dim) continue;
      if (depth[ny * dim + nx] > own) return true;
    }
  }
  return false;
}
