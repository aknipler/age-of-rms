// S2: elevation clumps — docs/preview-design.md Sec.6.2. PURE (CLAUDE.md hard
// rule / preview-design Sec.2).
//
// Per `create_elevation MaxHeight { ... }`: pick `number_of_clumps` seed
// tiles (terrain-matched, kept away from player-land origins, diagonally
// biased per the measured seed study), grow each like a land region, then
// stamp a concentric-ring height profile onto it.
//
// `MaxHeight` IS AN ABSOLUTE CEILING, NOT AN INCREMENT. A command raises a
// tile toward MaxHeight and never past it, and never lowers one already
// higher. Two lands under the same `create_elevation 6`, one at
// `base_elevation 2` and one at 5, therefore BOTH top out at 6 — the first
// gets tall-looking hills (2 -> 6), the second shallow ones (5 -> 6). Nothing
// adds: not clumps within a command, not commands within a section, and not
// `base_elevation` underneath. Corrected 2026-08-07; Sec.6.2's "heights add
// on top of base_elevation" is withdrawn, and Sec.15 item 25 has the run that
// confirms it.
//
// DELIBERATELY NOT IMPLEMENTED, both cited at the point they'd apply:
// growth's measured ~3% overshoot (Sec.6.2 itself calls implementing it
// "optional and low priority" — a plain stop-at-target is defensible) and
// the density-amplification constant `A`'s exact fit (Sec.6.2: "the fit
// targets the OUTPUT... run the generator, count elevated tiles, compare" —
// this file ships a first-pass value from one calibration run against its
// own five-point table, not the iterated fit the spec describes as ideal;
// see the build log for the run and where it landed against the table).

import type {
  CommandReport,
  InstantiatedArg,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  TileGrid,
} from "./types";
import { createSubstream, nextFloat01, nextInt, type Rng } from "./rng";
import { resolveTerrainId, scaleToMapArea } from "./grid";
import { createSpacingIndex, type SpacingIndex } from "./spacingIndex";
import { intersectCandidates, ok, fail, pushFailure, type AttributedPredicate } from "./placement";
import type { PlacementOutcome } from "./types";
import { bucketWeights } from "./lands";

// ---------------------------------------------------------------------------
// [tune] constants
// ---------------------------------------------------------------------------

/** RMSTEST_14: default tile budget is `dim`, NOT area-scaled — "about 120 on tiny maps" scales with side length. */
function defaultTileBudget(dim: number): number {
  return dim;
}

/** RMSTEST_22a: overshoot grows sharply as a clump's share shrinks — "model it as max(6, share) before growth." */
const MIN_TILES_PER_CLUMP = 6;

/** guide:2857-adjacent measurement (RMSTEST_39): the direct SEED bias is 1.31:1, favouring y > x. */
const SEED_BASE_RATIO = 1.3;

/** Sec.6.2's density-amplification formula: seedRatio = clamp(BASE + A*max(0, density-d0), BASE, RMAX). */
const DENSITY_KNEE = 250 / 40000; // ~250 clumps on a 200 map
/**
 * [tune], NOT rigorously fitted — Sec.6.2 asks for this to be tuned by
 * running the generator and comparing its own tile ratio against the
 * five-point table (50/100/250/500/1000 clumps on a 200 map -> 1.45/1.88/
 * 3.74/7.01/14.88). One calibration pass against exactly that table (see the
 * build log) landed this value; it is a first-pass fit, not an iterated one.
 */
const DENSITY_AMPLIFICATION = 900;
const SEED_RATIO_MAX = 20; // Sec.6.2: "a real clamp and is not optional"

/** guide: "elevation avoids the origins of player lands by about 9 tiles." */
const PLAYER_ORIGIN_MIN_DISTANCE = 9;

/** Sec.6.2: "Grow each clump like a land region (clumping weight fixed moderate [tune])" — reuses lands.ts's cf=8 (the default/moderate regime) rather than inventing a second weight-shape formula. */
const CLUMP_GROWTH_CF = 8;

/** Bounded retries for a spacing-compliant seed draw, mirroring lands.ts's ORIGIN_ATTEMPTS convention. */
const SEED_SPACING_ATTEMPTS = 100;

// ---------------------------------------------------------------------------
// Attribute reading (duplicated from lands.ts rather than imported — small,
// stage-agnostic, and importing S1-named internals into an S2 file the other
// direction reads oddly; see lands.ts's own copy for the same shape).
// ---------------------------------------------------------------------------

function argValue(cmd: InstantiatedCommand, name: string, argIndex = 0): InstantiatedValue {
  const arg: InstantiatedArg | undefined = cmd.attributes.get(name)?.[0]?.args[argIndex];
  return arg?.value;
}

function numAttr(cmd: InstantiatedCommand, name: string, argIndex: number, fallback: number): number {
  const v = argValue(cmd, name, argIndex);
  return typeof v === "number" ? v : fallback;
}

/** guide:1257/1274: "only the LAST scale attribute applies" when a script writes both — resolved by source position, since Sec.3's attribute folding only dedupes repeats of the SAME name. */
function lastScaleAttribute(cmd: InstantiatedCommand): "size" | "groups" | undefined {
  const sizeAttr = cmd.attributes.get("set_scale_by_size")?.[0];
  const groupsAttr = cmd.attributes.get("set_scale_by_groups")?.[0];
  if (sizeAttr && groupsAttr) return sizeAttr.span.start > groupsAttr.span.start ? "size" : "groups";
  if (sizeAttr) return "size";
  if (groupsAttr) return "groups";
  return undefined;
}

/**
 * RMSTEST_14: the DEFAULT (`number_of_tiles` absent) is `dim`, measured
 * directly and NOT area-scaled — so an absent value skips the scaling
 * formula entirely, even if `set_scale_by_size` is present. Only an
 * EXPLICIT `number_of_tiles` goes through Sec.4's scaling.
 */
export function resolveTileBudget(cmd: InstantiatedCommand, dim: number): number {
  const explicit = argValue(cmd, "number_of_tiles", 0);
  if (typeof explicit !== "number") return defaultTileBudget(dim);
  return lastScaleAttribute(cmd) === "size" ? scaleToMapArea(explicit, dim) : explicit;
}

/** `number_of_clumps` has no RMSTEST_14-style special default (it is plain `1`, guide-declared), so `set_scale_by_groups` applies to it whether declared or defaulted. */
export function resolveClumpCount(cmd: InstantiatedCommand, dim: number): number {
  const declared = numAttr(cmd, "number_of_clumps", 0, 1);
  const scaled = lastScaleAttribute(cmd) === "groups" ? scaleToMapArea(declared, dim) : declared;
  return Math.max(1, scaled);
}

/**
 * Sec.6.2's density-amplification formula. Below the knee (sparse clumps)
 * the ratio is the flat measured seed bias; above it, rises linearly with
 * clump density, clamped — "a real clamp... otherwise computes an unbounded
 * weight and empties the disfavoured half."
 */
export function seedRatio(clumpCount: number, mapArea: number): number {
  const density = clumpCount / mapArea;
  const excess = Math.max(0, density - DENSITY_KNEE);
  return Math.min(SEED_RATIO_MAX, SEED_BASE_RATIO + DENSITY_AMPLIFICATION * excess);
}

/** RMSTEST_22a: "model it as max(6, share) before growth" — the overshoot floor for a clump's own tile share. */
export function perClumpTarget(tileBudget: number, clumpCount: number): number {
  return Math.max(MIN_TILES_PER_CLUMP, Math.floor(tileBudget / clumpCount));
}

// ---------------------------------------------------------------------------
// Terrain constants — the narrow local shape, matching grid.ts/palette.ts's
// own precedent (each consumer states what it needs from game-constants.json).
// ---------------------------------------------------------------------------

export interface TerrainConstantForElevation {
  constId: number | null;
  rmsConstant: string | null;
  category: string;
}

// ---------------------------------------------------------------------------
// Clump growth and the ring-height profile
// ---------------------------------------------------------------------------

function fourNeighbors(dim: number, tile: number): number[] {
  const x = tile % dim;
  const y = (tile - x) / dim;
  const out: number[] = [];
  if (x > 0) out.push(tile - 1);
  if (x < dim - 1) out.push(tile + 1);
  if (y > 0) out.push(tile - dim);
  if (y < dim - 1) out.push(tile + dim);
  return out;
}

/**
 * Frontier-weighted growth from one seed to `target` tiles — the same
 * bucket-by-neighborsOwned shape lands.ts's growth uses (`bucketWeights`,
 * imported rather than re-derived), at the fixed "moderate" regime Sec.6.2
 * specifies (no clumping_factor attribute exists on `create_elevation`, so
 * there is nothing per-command to read). No border/zone rejection: nothing
 * in Sec.6.2 or `create_elevation`'s attribute list gates growth candidates
 * beyond "still on the grid," unlike lands.ts's borders/zones.
 */
export function growClump(dim: number, seed: number, target: number, rng: Rng): Set<number> {
  const owned = new Set<number>([seed]);
  if (target <= 1) return owned;
  const weights = bucketWeights(CLUMP_GROWTH_CF);
  const buckets: [number[], number[], number[], number[]] = [[], [], [], []];
  const inFrontier = new Set<number>();

  function addFrontier(tile: number): void {
    if (inFrontier.has(tile) || owned.has(tile)) return;
    inFrontier.add(tile);
    let neighborsOwned = 0;
    for (const n of fourNeighbors(dim, tile)) if (owned.has(n)) neighborsOwned++;
    const bucketIndex = Math.max(1, Math.min(4, neighborsOwned)) - 1;
    buckets[bucketIndex].push(tile);
  }

  for (const n of fourNeighbors(dim, seed)) addFrontier(n);

  while (owned.size < target) {
    const sizes = buckets.map((b) => b.length);
    const totalWeight = sizes.reduce((sum, size, i) => sum + size * weights[i], 0);
    if (totalWeight <= 0) break; // frontier exhausted (e.g. a tiny map) — take what growth reached
    let roll = nextFloat01(rng) * totalWeight;
    let bucketIndex = 0;
    for (; bucketIndex < 3; bucketIndex++) {
      const contribution = sizes[bucketIndex] * weights[bucketIndex];
      if (roll < contribution) break;
      roll -= contribution;
    }
    const bucket = buckets[bucketIndex];
    const pickIndex = nextInt(rng, 0, bucket.length - 1);
    const tile = bucket[pickIndex];
    bucket[pickIndex] = bucket[bucket.length - 1];
    bucket.pop();
    inFrontier.delete(tile);
    owned.add(tile);
    for (const n of fourNeighbors(dim, tile)) addFrontier(n);
  }

  return owned;
}

/**
 * Sec.6.2: "tile height = min(h, floor(distanceFromClumpEdge / spacing))" —
 * concentric rings from the boundary inward. Multi-source BFS seeded from
 * every clump tile touching a non-clump tile OR the map edge (both count as
 * "the edge" — there is no clump tile beyond either).
 */
export function clumpEdgeDistances(dim: number, clumpTiles: ReadonlySet<number>): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const tile of clumpTiles) {
    const neighbors = fourNeighbors(dim, tile);
    const isBoundary = neighbors.length < 4 || neighbors.some((n) => !clumpTiles.has(n));
    if (isBoundary) {
      dist.set(tile, 0);
      queue.push(tile);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const tile = queue[head++];
    const d = dist.get(tile)!;
    for (const n of fourNeighbors(dim, tile)) {
      if (clumpTiles.has(n) && !dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Seed selection
// ---------------------------------------------------------------------------

function xyOf(dim: number, tile: number): { x: number; y: number } {
  const x = tile % dim;
  return { x, y: (tile - x) / dim };
}

/** One command's static candidate set: Sec.7's two-predicate attribution (terrain match, then player-origin distance), reused directly from placement.ts rather than a hand-rolled filter. */
export function eligibleSeedCandidates(
  grid: TileGrid,
  terrainId: number,
  layerId: number | undefined,
  playerOrigins: readonly LandOrigin[],
): PlacementOutcome<Int32Array> {
  const { dim } = grid;
  const n = dim * dim;
  const scratch = new Int32Array(n);
  for (let i = 0; i < n; i++) scratch[i] = i;

  const predicates: AttributedPredicate[] = [
    {
      bucket: "terrainAbsent",
      test: (i) => grid.terrain[i] === terrainId && (layerId === undefined || grid.layer[i] === layerId),
    },
    {
      bucket: "playerOriginAvoidance",
      test: (i) => {
        if (playerOrigins.length === 0) return true;
        const { x, y } = xyOf(dim, i);
        for (const origin of playerOrigins) {
          const dx = x - origin.x;
          const dy = y - origin.y;
          if (dx * dx + dy * dy < PLAYER_ORIGIN_MIN_DISTANCE * PLAYER_ORIGIN_MIN_DISTANCE) return false;
        }
        return true;
      },
    },
  ];

  const result = intersectCandidates(scratch, n, predicates);
  if (result.count === 0) {
    return fail({
      bucket: result.failedBucket ?? "noValidTiles",
      commandSpan: { start: 0, end: 0 }, // filled in by the caller, which has the real span
      stage: "S2",
      entity: "elevation clump",
      detail: "",
    });
  }
  return ok(Int32Array.from(result.survivors));
}

/**
 * The candidate pool, split once by diagonal side — Sec.6.2's "weight ratio
 * favouring y > x, uniform with respect to distance from the map edge".
 *
 * Built ONCE PER COMMAND. `drawSeed` used to do this split itself, on every
 * call, which made each seed draw O(candidates) — and a `create_elevation`
 * command asks for one draw per clump, so a command with thousands of clumps
 * over a 40,000-tile candidate set cost hundreds of millions of operations.
 * `AK_Namatjira.rms` spent 3.1 s in S2 alone on this before the split moved
 * out (measured 2026-08-07). The function's own doc comment already said
 * "split the pool by diagonal side once"; the implementation just did not.
 */
export interface SeedPool {
  favored: number[];
  disfavored: number[];
}

export function buildSeedPool(dim: number, candidates: Int32Array): SeedPool {
  const favored: number[] = [];
  const disfavored: number[] = [];
  for (const tile of candidates) {
    const { x, y } = xyOf(dim, tile);
    (y > x ? favored : disfavored).push(tile);
  }
  return { favored, disfavored };
}

/**
 * One diagonally-biased, spacing-respecting seed draw from a prebuilt pool.
 * `placedSeeds` is the running index of seeds this command has already
 * accepted — a uniform grid rather than a list, for the same reason
 * `spacingIndex.ts` exists at all: the scan it replaces was quadratic in the
 * clump count.
 */
export function drawSeed(
  dim: number,
  pool: SeedPool,
  ratio: number,
  placedSeeds: SpacingIndex,
  rng: Rng,
): number | undefined {
  const pFavored = ratio / (ratio + 1);

  for (let attempt = 0; attempt < SEED_SPACING_ATTEMPTS; attempt++) {
    let side = nextFloat01(rng) < pFavored ? pool.favored : pool.disfavored;
    if (side.length === 0) side = pool.favored.length > 0 ? pool.favored : pool.disfavored;
    if (side.length === 0) return undefined;
    const tile = side[nextInt(rng, 0, side.length - 1)];
    const { x, y } = xyOf(dim, tile);
    if (!placedSeeds.tooClose(x, y)) return tile;
  }
  return undefined; // spacing kept rejecting every draw — reported as spacingConflict by the caller
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ElevationResult {
  reports: CommandReport[];
}

/**
 * Sec.6.2: AST -> elevation clumps. Mutates `grid.elevation` (ADDING onto
 * whatever base_elevation already wrote, per "heights add on top of
 * base_elevation — DE-relative behaviour"); returns one `CommandReport` per
 * `create_elevation` command (Sec.7).
 */
export function applyElevation(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForElevation[],
  origins: readonly LandOrigin[],
  masterSeed: number,
): ElevationResult {
  const commands = instantiated.sections.get("ELEVATION_GENERATION") ?? [];
  const { dim } = grid;
  const mapArea = dim * dim;
  const playerOrigins = origins.filter((o) => o.player !== undefined);
  const reports: CommandReport[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S2", ordinal++);

  for (const cmd of commands) {
    if (cmd.name !== "create_elevation") continue;
    // MaxHeight is create_elevation's own positional argument, not an attribute.
    const maxHeight = typeof cmd.args[0]?.value === "number" ? cmd.args[0].value : 0;
    if (maxHeight <= 0) {
      reports.push({ commandSpan: cmd.span, stage: "S2", attempted: 0, placed: 0, failures: [] });
      continue;
    }

    const terrainRef = argValue(cmd, "base_terrain", 0) ?? "GRASS";
    const layerRef = argValue(cmd, "base_layer", 0);
    const terrainId = resolveTerrainId(constants, terrainRef, instantiated.symbols);
    const layerId = layerRef !== undefined ? resolveTerrainId(constants, layerRef, instantiated.symbols) : undefined;

    const clumpCount = resolveClumpCount(cmd, dim);
    const tileBudget = resolveTileBudget(cmd, dim);
    const tilesPerClump = perClumpTarget(tileBudget, clumpCount);
    const spacing = numAttr(cmd, "spacing", 0, 1);
    const ratio = seedRatio(clumpCount, mapArea);

    const failures: PlacementFailure[] = [];
    let placed = 0;

    if (terrainId === undefined) {
      pushFailure(failures, {
        bucket: "terrainAbsent",
        commandSpan: cmd.span,
        stage: "S2",
        entity: "elevation clump",
        detail: `This map's reference data doesn't know the terrain "${String(terrainRef)}", so no seed tile could be matched to it.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S2", attempted: clumpCount, placed: 0, failures });
      continue;
    }

    const candidateResult = eligibleSeedCandidates(grid, terrainId, layerId, playerOrigins);
    if (!candidateResult.ok) {
      pushFailure(failures, {
        ...candidateResult.failure,
        commandSpan: cmd.span,
        detail:
          candidateResult.failure.bucket === "terrainAbsent"
            ? `No tile on the map currently has this clump's base_terrain ("${String(terrainRef)}"), so no seed could be placed.`
            : `Every tile matching this clump's base_terrain sits within ${PLAYER_ORIGIN_MIN_DISTANCE} tiles of a player land's origin, so no seed could be placed.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S2", attempted: clumpCount, placed: 0, failures });
      continue;
    }
    const pool = buildSeedPool(dim, candidateResult.value);

    // Euclidean, matching the `dx*dx + dy*dy < spacing*spacing` this replaced
    // (S6's own spacing rule is Chebyshev — the two attributes genuinely
    // differ, which is why the index takes the metric as a parameter).
    const placedSeeds = createSpacingIndex(dim, spacing, "euclidean");
    for (let c = 0; c < clumpCount; c++) {
      const rng = nextSubstream();
      const seed = drawSeed(dim, pool, ratio, placedSeeds, rng);
      if (seed === undefined) {
        pushFailure(failures, {
          bucket: "spacingConflict",
          commandSpan: cmd.span,
          stage: "S2",
          entity: `elevation clump ${c + 1}`,
          detail: `Could not find a seed at least ${spacing} tiles from every other clump in this command after ${SEED_SPACING_ATTEMPTS} attempts.`,
        });
        continue;
      }
      placedSeeds.add(seed % dim, (seed - (seed % dim)) / dim);

      const heightRng = nextSubstream();
      const h = clumpCount === 1 ? maxHeight : nextInt(heightRng, 1, maxHeight);
      const growthRng = nextSubstream();
      const clumpTiles = growClump(dim, seed, tilesPerClump, growthRng);
      const edgeDistances = clumpEdgeDistances(dim, clumpTiles);
      for (const tile of clumpTiles) {
        const ring = Math.min(h, Math.floor((edgeDistances.get(tile) ?? 0) / spacing));
        // `MaxHeight` is an ABSOLUTE CEILING, not an increment. A command
        // raises a tile toward `MaxHeight` and never past it, and never
        // lowers one that is already higher.
        //
        // The consequence worth stating, because it is what makes this the
        // right model rather than just a safe one: two lands under the SAME
        // `create_elevation 6`, one sitting at `base_elevation 2` and one at
        // 5, both end up topping out at 6. The hills on the first read as
        // tall (2 -> 6) and on the second as shallow (5 -> 6). A land already
        // above the ceiling is left alone.
        //
        // Two earlier readings were both wrong. `grid.elevation[tile] + ring`
        // (summing) meant repeated commands stacked: `AD4 - Pag - v1.2.rms`
        // writes `create_elevation 7 { number_of_tiles 230400 }` FIVE TIMES
        // over one region -- 230,400 tiles on a 40,000-tile map, so each
        // floods all of it -- plus a 180-clump `create_elevation 2`, summing
        // to 37 and clamping: 36,877 of 40,000 tiles at elevation 16 on a map
        // whose author asked for 7. Repeating a command is the coverage idiom
        // every script uses for `create_terrain`, not a height multiplier.
        // `baseElevation[tile] + ring` fixed the stacking but kept an
        // increment, which would put a `base_elevation 5` land under a
        // `create_elevation 6` at 11.
        if (ring > grid.elevation[tile]) grid.elevation[tile] = ring;
      }
      placed++;
    }

    reports.push({ commandSpan: cmd.span, stage: "S2", attempted: clumpCount, placed, failures });
  }

  return { reports };
}
