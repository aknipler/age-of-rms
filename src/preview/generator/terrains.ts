// S4: terrains — docs/preview-design.md Sec.6.4. PURE (CLAUDE.md hard rule /
// preview-design Sec.2).
//
// Per `create_terrain T { ... }`, sequential in script order (guide:
// "generated sequentially… positions cannot be directly specified"): resolve
// a tile budget, then grow `number_of_clumps` clumps restricted to an
// eligible-tile set (base_terrain/base_layer match, height_limits, two
// flavours of spacing, flatness, player-start avoidance) — using terrain's
// OWN `clumping_factor` regime (Sec.6.4: "do not reuse Sec.6.1's land
// table"). The eligible set is computed ONCE per COMMAND (matching
// elevation.ts's own precedent), not once per clump: what genuinely differs
// clump-to-clump within one command is only "has an earlier clump already
// claimed this tile", tracked separately as a live `claimed` mask rather
// than by rebuilding the whole eligible set — see the ITERATION CAP note
// below for why a naive per-clump rebuild is not just slower but
// unshippable.
//
// ONE DELIBERATE SIMPLIFICATION. `set_avoid_player_start_areas` is modelled
// as a flat `distance >= d` predicate: Sec.6.4 says "with mild variance",
// unquantified, and a per-tile jitter has no home in Sec.7's architecture
// where `AttributedPredicate.test` is a pure, deterministic membership query
// with no RNG access. Threading randomness through it would be a bigger
// change than the feature justifies.
//
// TWO THINGS THAT USED TO BE LISTED HERE AS SIMPLIFICATIONS AND WERE ACTUALLY
// WRONG. Both are worth keeping, because "documented approximation" is a
// comfortable place for a bug to hide.
//
//   `set_flat_terrain_only`'s "also >= spacing from sloped tiles" clause was
//   treated as a flat unconditional "reject any sloped candidate" with the
//   spacing-buffer half dropped -- corrected after review flagged that the
//   combination shows up in real corpus scripts (`24hr_Blind Valley.rms`).
//   See `eligibleTerrainCandidates` for the fix: a sloped tile becomes
//   "foreign" for `spacing_to_other_terrain_types`'s own distance transform
//   exactly when that attribute is set, which is what "only when spacing >= 1"
//   means.
//
//   `terrain_mask 1` vs `2` was collapsed into one behaviour on the reasoning
//   that Sec.9 item 6 already renders masking as a flat tint, so "the
//   over/under distinction would be invisible in the renderer's own contract
//   even if modelled exactly". The distinction is not about rendering at all:
//   guide:1502-1509 says mask 1's new terrain "inherits its properties" from
//   the base while mask 2's "provides new properties", so mask 2 changes
//   WHICH TERRAIN OWNS THE TILE and therefore what every later `base_terrain`,
//   habitat check and automatic-object rule sees. Collapsing them made every
//   mask-2 command a no-op for the rest of the pipeline; `AD4 - Pag - v1.2.rms`
//   uses mask 2 twice in its first three commands. Both layers are now
//   modelled and only the visual BLEND remains a flat tint.
//
// HOW MANY CLUMPS ACTUALLY RUN (Sec.11), and why this is not a [tune]
// constant. The guide's own worked create_terrain example uses
// `number_of_clumps 9320`; real corpus scripts declare it constantly
// (`AD4 - Pag - v1.2.rms` writes it 23 times in one section, `24hr_Blind
// Valley.rms` several times, one of them under `set_scale_by_groups` which
// turns it into tens of thousands) and some declare `999999999`. Sec.11
// names the scenario directly ("9320-clump commands... never hang").
//
// **The bound is the eligible pool, which is exact.** Every clump that runs
// claims at least its own seed tile, so a command can never usefully run
// more clumps than it has eligible tiles — `min(clumpCount, pool.length)` is
// a fact about the work, not a guess about a budget, and it terminates a
// 999999999-clump command after at most `dim^2` iterations on its own. Seed
// draws come from a shrinking pool with swap-remove, so the whole command
// pays O(pool) for removals no matter how many clumps it asks for.
//
// **This replaced a `[tune]` cap of `4 * dim` attempts, and that cap was a
// real correctness bug, not just a conservative setting.** At `dim` 200 it
// stopped every command after 800 clumps — 8.6% of a 9320-clump command.
// `create_terrain DIRT { base_terrain DESERT land_percent 100
// number_of_clumps 9320 }` is how a script converts *all* of one terrain
// into another, and it was converting a twelfth of it, leaving DESERT
// scattered through regions the author had cleared. One Pag generation
// emitted 23 `terrainIterationCapped` notes. The lesson worth keeping: a cap
// chosen so "no non-pathological corpus script hits it" was measured against
// nothing — the corpus hits it constantly, and it fired as a silent visual
// wrong answer rather than as an error.
//
// An EARLIER version computed the eligible set per clump instead of per
// command (reasoning that an earlier clump's painted tiles must stop being
// eligible for the next one); that reasoning is still correct, but
// implementing it as a full rebuild rather than a `claimed` mask took a real
// corpus run from milliseconds to multiple minutes.

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  PlacementOutcome,
  SimulationNote,
  TileGrid,
} from "./types";
import { createSubstream, nextFloat01, nextInt, type Rng } from "./rng";
import {
  DEPTH_WATER,
  NO_LAYER,
  UNREACHABLE,
  beachTerrainFor,
  computeSlopeMask,
  isWaterTerrain,
  distanceTransform,
  distanceTransformFromMask,
  resolveTerrainId,
  scaleToMapArea,
  waterDepthMask,
  type TerrainConstantForMasks,
} from "./grid";
import { intersectCandidates, ok, fail, pushFailure, type AttributedPredicate } from "./placement";

// ---------------------------------------------------------------------------
// [tune] / guide-value constants
// ---------------------------------------------------------------------------

/** RMSTEST_14: "default 122 tiles on a tiny map", side-length scaled like Sec.6.2's elevation default — NOT re-scaled by set_scale_by_*, same policy as elevation.ts's own default. */
const DEFAULT_BUDGET_NUMERATOR = 122;
const DEFAULT_BUDGET_DENOMINATOR = 120;

/** guide:1646: "different than for lands" — lands.ts's own default is 8. */
const TERRAIN_DEFAULT_CF = 20;

/**
 * RMSTEST_20's saturation point, which happens to equal RMSTEST_21's land
 * saturation point (Sec.6.1) — coincidence in the data, not a reason to
 * import lands.ts's `bucketWeights`. Sec.6.4 explicitly says the two tables
 * are separate measurements ("do not reuse Sec.6.1's land table"), and an
 * edit to one must not risk silently changing the other's tested shape —
 * same reasoning grid.ts gives for keeping `distanceTransform` and
 * `distanceTransformFromMask` un-unified.
 */
const TERRAIN_SATURATION_CF = 15;
/** [tune]: no measurement pins the magnitude, only the qualitative shape (Sec.6.4's own table) — same reasoning as lands.ts's MAX_STEEPNESS. */
const TERRAIN_MAX_STEEPNESS = 3;
/** cf < 0: "extremely snakey" (guide:1647). Not literally 0 so a clump isn't stuck if bucket 1 empties first. */
const TERRAIN_NEGATIVE_REGIME_WEIGHTS: readonly [number, number, number, number] = [1, 0.05, 0.05, 0.05];

/** guide, Sec.6.4: "set_avoid_player_start_areas d (default 13 when bare)". */
const AVOID_PLAYER_START_DEFAULT = 13;

const ZERO_SPAN = { start: 0, end: 0 };

// ---------------------------------------------------------------------------
// Attribute reading — duplicated per-file convention (elevation.ts/lands.ts
// each keep their own small copy rather than sharing one; see either file's
// header for why).
// ---------------------------------------------------------------------------

function argValue(cmd: InstantiatedCommand, name: string, argIndex = 0): InstantiatedValue {
  const arg = cmd.attributes.get(name)?.[0]?.args[argIndex];
  return arg?.value;
}

function numAttr(cmd: InstantiatedCommand, name: string, argIndex: number, fallback: number): number {
  const v = argValue(cmd, name, argIndex);
  return typeof v === "number" ? v : fallback;
}

/** guide:1257/1274 (shared with elevation.ts): "only the LAST scale attribute applies" when a script writes both. */
function lastScaleAttribute(cmd: InstantiatedCommand): "size" | "groups" | undefined {
  const sizeAttr = cmd.attributes.get("set_scale_by_size")?.[0];
  const groupsAttr = cmd.attributes.get("set_scale_by_groups")?.[0];
  if (sizeAttr && groupsAttr) return sizeAttr.span.start > groupsAttr.span.start ? "size" : "groups";
  if (sizeAttr) return "size";
  if (groupsAttr) return "groups";
  return undefined;
}

/** The script's own `#const` table, threaded from `InstantiatedScript.symbols` so `resolveTerrainId` can see a `create_terrain WOODIES` this file would otherwise report as an unknown terrain. */
type Symbols = ReadonlyMap<string, number>;

// ---------------------------------------------------------------------------
// Budget / clump count (Sec.6.4) — mirrors elevation.ts's shape, but with
// the terrain-specific scaling rule: EITHER scale attribute scales tiles
// (guide: set_scale_by_groups "scales the total tile count too" for
// terrains — elevation only lets set_scale_by_size touch tiles).
// ---------------------------------------------------------------------------

export function resolveTerrainTileBudget(cmd: InstantiatedCommand, dim: number): number {
  const explicitTiles = argValue(cmd, "number_of_tiles", 0);
  if (typeof explicitTiles === "number") {
    return lastScaleAttribute(cmd) !== undefined ? scaleToMapArea(explicitTiles, dim) : explicitTiles;
  }
  // NOTE: read directly, NOT via numAttr's own fallback -- land_percent's
  // OWN declared default (100) must not leak in here. The terrain-level
  // default when NEITHER attribute is written is the dim-scaled formula
  // below, not "100% of the map" (same trap RMSTEST_14 flagged for
  // elevation.ts's number_of_tiles default).
  const percentValue = argValue(cmd, "land_percent", 0);
  if (typeof percentValue === "number") return (percentValue / 100) * dim * dim;
  return (DEFAULT_BUDGET_NUMERATOR * dim) / DEFAULT_BUDGET_DENOMINATOR;
}

export function resolveClumpCount(cmd: InstantiatedCommand, dim: number): number {
  const declared = numAttr(cmd, "number_of_clumps", 0, 1);
  return lastScaleAttribute(cmd) === "groups" ? Math.max(1, scaleToMapArea(declared, dim)) : Math.max(1, declared);
}

// ---------------------------------------------------------------------------
// Terrain's own clumping_factor regime (Sec.6.4, RMSTEST_20) — see the
// TERRAIN_SATURATION_CF comment above for why this is not lands.ts's
// `bucketWeights` despite the identical shape.
// ---------------------------------------------------------------------------

export function terrainBucketWeights(clumpingFactor: number): readonly [number, number, number, number] {
  if (clumpingFactor < 0) return TERRAIN_NEGATIVE_REGIME_WEIGHTS;
  const steepness = (Math.min(clumpingFactor, TERRAIN_SATURATION_CF) / TERRAIN_SATURATION_CF) * TERRAIN_MAX_STEEPNESS;
  return [1, 1 + steepness, 1 + 2 * steepness, 1 + 3 * steepness];
}

// ---------------------------------------------------------------------------
// Per-command attribute resolution beyond budget/cf
// ---------------------------------------------------------------------------

interface HeightLimits {
  min: number;
  max: number;
}

function readHeightLimits(cmd: InstantiatedCommand): HeightLimits | undefined {
  const attr = cmd.attributes.get("height_limits")?.[0];
  if (!attr) return undefined;
  const min = attr.args[0]?.value;
  const max = attr.args[1]?.value;
  return typeof min === "number" && typeof max === "number" ? { min, max } : undefined;
}

interface SpecificTerrainSpacing {
  terrainId: number;
  distance: number;
}

/** `spacing_to_specific_terrain` is `repeatable: true` (Sec.3 rule 10) — every occurrence accumulates, not just the last. Unresolvable terrain names are skipped (positive-resolver policy: absence from reference data is not itself a reason to fail the whole command). */
function specificTerrainSpacings(
  cmd: InstantiatedCommand,
  constants: readonly TerrainConstantForMasks[],
  symbols: Symbols,
): SpecificTerrainSpacing[] {
  const attrs = cmd.attributes.get("spacing_to_specific_terrain") ?? [];
  const out: SpecificTerrainSpacing[] = [];
  for (const attr of attrs) {
    const distance = attr.args[1]?.value;
    if (typeof distance !== "number") continue;
    const terrainId = resolveTerrainId(constants, attr.args[0]?.value, symbols);
    if (terrainId !== undefined) out.push({ terrainId, distance });
  }
  return out;
}

/** `set_avoid_player_start_areas d` — undefined when the attribute is absent entirely (no constraint); `AVOID_PLAYER_START_DEFAULT` when present but bare. */
function avoidPlayerStartDistance(cmd: InstantiatedCommand): number | undefined {
  const attr = cmd.attributes.get("set_avoid_player_start_areas")?.[0];
  if (!attr) return undefined;
  const v = attr.args[0]?.value;
  return typeof v === "number" ? v : AVOID_PLAYER_START_DEFAULT;
}

// ---------------------------------------------------------------------------
// Eligible-tile candidate set (Sec.7's successive-intersection attribution,
// predicate order matching Sec.6.4's own listed order: base match, height
// limits, other-terrain spacing, specific-terrain spacings, flatness,
// player-start avoidance). Bucket assignment is SPEC-STATED, not a judgment
// call: "Failures: terrainAbsent (no eligible tiles at all...), spacingConflict
// (eligible set emptied by spacing)" — only the base-match predicate uses
// terrainAbsent, every later predicate uses spacingConflict.
// ---------------------------------------------------------------------------

export interface EligibilityContext {
  baseTerrainId: number;
  baseLayerId?: number;
  heightLimits?: HeightLimits;
  /** 0 = no constraint (attribute absent — Sec.6.4 gives no default, unlike cliffs.ts's guide-sourced spacing defaults). */
  otherTerrainSpacing: number;
  specificSpacings: readonly SpecificTerrainSpacing[];
  flatOnly: boolean;
  /** undefined = no constraint (`set_avoid_player_start_areas` absent). */
  avoidPlayerDistance?: number;
}

export function eligibleTerrainCandidates(
  grid: TileGrid,
  ctx: EligibilityContext,
  slope: Uint8Array,
  playerOrigins: readonly LandOrigin[],
): PlacementOutcome<Int32Array> {
  const { dim } = grid;
  const n = dim * dim;
  const scratch = new Int32Array(n);
  for (let i = 0; i < n; i++) scratch[i] = i;

  // guide:1471 on `base_layer` (terrain): "If used together with base_terrain,
  // the new terrain will be placed only where BOTH the base and the layer
  // apply." This was an OR, which made `base_layer` a widening clause instead
  // of a narrowing one -- a command asking for "DESERT layered over GRASS"
  // matched every GRASS tile on the map as well. `base_terrain` itself always
  // applies, defaulting to GRASS (guide:1449); `base_layer` has no default
  // and only narrows when written.
  const predicates: AttributedPredicate[] = [
    {
      bucket: "terrainAbsent",
      test: (i) => grid.terrain[i] === ctx.baseTerrainId && (ctx.baseLayerId === undefined || grid.layer[i] === ctx.baseLayerId),
    },
  ];

  if (ctx.heightLimits) {
    const { min, max } = ctx.heightLimits;
    predicates.push({ bucket: "spacingConflict", test: (i) => grid.elevation[i] >= min && grid.elevation[i] <= max });
  }

  if (ctx.otherTerrainSpacing > 0) {
    // "cliff tiles also count as foreign terrain for this spacing" (Sec.6.4's
    // own pinned approximation, Sec.9 item 7) -- ANY tile that is neither
    // base_terrain/base_layer NOR a cliff tile counts as this command's OWN
    // eligible ground; everything else (other terrain patches, water,
    // cliffs) is foreign. `set_flat_terrain_only` widens "foreign" further,
    // per Sec.6.4's own clause: "also >= spacing from sloped tiles (only
    // when spacing >= 1)" -- the gate this whole block is already inside
    // IS "spacing >= 1" (an integer attribute, so `> 0` and `>= 1` coincide),
    // so a slope becomes foreign under exactly the condition the guide
    // states, and the SAME distance transform enforces the same buffer
    // distance against both. This folds the flag into the spacing check
    // rather than a second separate one: a bare `flatOnly` (no spacing
    // attribute, or spacing 0) still needs its own unconditional "never
    // paint ON a slope" rule below, since this block does not run then.
    const foreign = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const isOwnBase = grid.terrain[i] === ctx.baseTerrainId && (ctx.baseLayerId === undefined || grid.layer[i] === ctx.baseLayerId);
      if (!isOwnBase || grid.cliff[i] !== 0 || (ctx.flatOnly && slope[i] !== 0)) foreign[i] = 1;
    }
    const foreignDistance = distanceTransformFromMask(dim, foreign);
    const minSpacing = ctx.otherTerrainSpacing;
    predicates.push({
      bucket: "spacingConflict",
      test: (i) => foreignDistance[i] === UNREACHABLE || foreignDistance[i] >= minSpacing,
    });
  }

  for (const spacing of ctx.specificSpacings) {
    const dist = distanceTransform(grid, spacing.terrainId);
    const minDistance = spacing.distance;
    predicates.push({ bucket: "spacingConflict", test: (i) => dist[i] === UNREACHABLE || dist[i] >= minDistance });
  }

  if (ctx.flatOnly) {
    // Unconditional half of the flag's own plain description ("only paints
    // this terrain onto flat ground") -- applies even when
    // otherTerrainSpacing is 0/absent, unlike the buffer above. Redundant
    // with the block above whenever BOTH are active (a sloped tile already
    // fails foreignDistance >= minSpacing there), which is harmless: a
    // second pass over an already-filtered survivor set costs nothing
    // Sec.7's attribution rule cares about.
    predicates.push({ bucket: "spacingConflict", test: (i) => slope[i] === 0 });
  }

  if (ctx.avoidPlayerDistance !== undefined) {
    const minDistance2 = ctx.avoidPlayerDistance * ctx.avoidPlayerDistance;
    predicates.push({
      bucket: "spacingConflict",
      test: (i) => {
        if (playerOrigins.length === 0) return true;
        const x = i % dim;
        const y = (i - x) / dim;
        for (const origin of playerOrigins) {
          const dx = x - origin.x;
          const dy = y - origin.y;
          if (dx * dx + dy * dy < minDistance2) return false;
        }
        return true;
      },
    });
  }

  const result = intersectCandidates(scratch, n, predicates);
  if (result.count === 0) {
    return fail({
      bucket: result.failedBucket ?? "noValidTiles",
      commandSpan: ZERO_SPAN, // filled in by the caller, which has the real span
      stage: "S4",
      entity: "terrain clump",
      detail: "",
    });
  }
  return ok(Int32Array.from(result.survivors));
}

// ---------------------------------------------------------------------------
// Restricted clump growth — elevation.ts's `growClump` shape, plus TWO
// per-clump membership checks gating every frontier candidate (Sec.6.4:
// "grow restricted to eligible tiles"): a STATIC `eligible` mask (computed
// ONCE per command — see applyTerrains below for why) and a live `claimed`
// mask marking tiles an EARLIER clump of this same command already grew
// into. Two arrays rather than one combined mask because `eligible` is
// shared read-only across every clump of a command while `claimed` grows
// clump by clump — merging them would mean rebuilding a combined array per
// clump, exactly the O(dim^2)-per-clump cost this split exists to avoid.
// Kept as its OWN copy rather than adding parameters to elevation.ts's
// tested, working `growClump`, for the same reason grid.ts keeps its two
// distance transforms un-unified: an edit to one must not risk silently
// changing the other's already-tested behaviour.
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

export function growTerrainClump(
  dim: number,
  seed: number,
  target: number,
  eligible: Uint8Array,
  claimed: Uint8Array,
  weights: readonly [number, number, number, number],
  rng: Rng,
): Set<number> {
  const owned = new Set<number>([seed]);
  if (target <= 1) return owned;
  const buckets: [number[], number[], number[], number[]] = [[], [], [], []];
  const inFrontier = new Set<number>();

  function addFrontier(tile: number): void {
    if (inFrontier.has(tile) || owned.has(tile) || eligible[tile] === 0 || claimed[tile] !== 0) return;
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
    if (totalWeight <= 0) break; // frontier exhausted (eligibility boundary reached) -- growthShortfall, not an error
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

// ---------------------------------------------------------------------------
// Automatic beaches (engine behaviour, not a command)
// ---------------------------------------------------------------------------

/**
 * Options for one run of the beach pass.
 *
 * Both fields exist because the pass runs at more than one moment and the two
 * moments differ (see `applyAutomaticBeach`): after land generation it dresses
 * the whole map with each terrain's own default, and after a `create_terrain`
 * command it dresses only what that command painted, with that command's
 * `beach_terrain`.
 */
export interface AutomaticBeachOptions {
  /** `create_terrain`'s `beach_terrain`: use this instead of a tile's own `beachTerrain` data, but only within `beachTerrainScope`. */
  beachTerrain?: number;
  /** The tiles `beachTerrain` speaks for (1 = in scope) — the painting command's own. Everything else on the grid still takes its own data default. */
  beachTerrainScope?: Uint8Array;
}

/**
 * Writes each tile's beach terrain onto it where it borders something DEEPER
 * than itself.
 *
 * NOT driven by the script. The community DE terrain table states it on the
 * beach terrains' own rows — id 2 BEACH is "automatically placed when land
 * terrains border water", id 37 ICYSHORE is "created when snowy terrains
 * border water" — and `create_terrain`'s `beach_terrain` attribute exists to
 * OVERRIDE it per command, which is why guide:1483 gives that attribute a
 * default of BEACH. Without this pass a preview shows land meeting open water
 * with no shoreline anywhere, which `AD4 - Pag - v1.2.rms` did on 536 tiles.
 *
 * WHERE IT RUNS, and why REPEATEDLY rather than once at the end. The engine
 * beaches at the end of land generation and again at the end of every
 * `create_terrain` command, so a beach exists for the whole of
 * `<TERRAIN_GENERATION>` rather than appearing after it.
 *
 * **This was first built as a single pass after S5 and that was wrong, in a
 * way the corpus states plainly.** `base_terrain BEACH` is an ordinary idiom —
 * 67 uses across the tracked maps, including five consecutive
 * `create_terrain RIVERBANK_TERRAIN_TEMP { base_terrain BEACH land_percent 100
 * number_of_clumps 99999 }` in `AK_Namatjira.rms` — and a beach that does not
 * exist until after S5 matches NONE of them. The commands ran, found an empty
 * eligible pool and painted nothing, which looks like a quiet map rather than
 * an error. Running late also made the pass the LAST writer, so it undid those
 * conversions; running per command makes it a writer among others, in order.
 *
 * Every run dresses the WHOLE grid; what is scoped is `beach_terrain`, to the
 * tiles of the command that set it (guide:1483: "placed where the CURRENT
 * terrain borders water"). The grid-wide part matters because a command that
 * paints water puts land it never touched onto the coast.
 *
 * **A `create_terrain` reading `base_terrain BEACH` therefore comes out as a
 * no-op wherever the only beach is the waterline, and that is right.** The
 * step re-beaches the strip the command just converted, so nothing changes on
 * an ordinary coast. The idiom pays off on a land made OF beach: the interior
 * converts and only the tiles touching water revert. A version of this file
 * made the per-command step conditional on `beach_terrain` specifically to
 * stop the "undo", which protected the no-op case and broke the real one.
 *
 * THREE DEPTHS, NOT TWO, and this is what the rule is really about. The map
 * has land, shallows (`isHybrid` — terrain both land units and ships cross)
 * and open water, and the engine edges every boundary between two of them, not
 * only the outer one. So a beach appears where land meets shallows, where land
 * meets open water, AND where shallows meet open water — a shallow band
 * running from a coast out to sea comes out sand, shallow, sand, sea rather
 * than as one unbroken strip against the deep. `grid.ts`'s `terrainDepth`
 * defines the ordering and says why it is a separate flag from `isWater`
 * rather than a rereading of it.
 *
 * The beach always lands on the SHALLOWER of the two tiles, which generalises
 * "on the land side only" rather than replacing it: land takes the beach
 * against a shallow, and the shallow takes it against open water. A beach
 * terrain's own row carries `beachTerrain: null`, so the tile it lands on
 * stops there instead of eating another tile inward on the next pass.
 *
 * Depth is read from a mask taken BEFORE any write, so a beach laid on one
 * tile can never make its neighbour think it is shallower than it was.
 * Beaches are one tile wide.
 *
 * `beachTerrain` is `create_terrain`'s own `beach_terrain` attribute, and
 * passing it here rather than letting the command dress its own clump is what
 * keeps the two halves ONE rule: the attribute picks the terrain, this pass
 * picks the tiles. It also makes a `beach_terrain` naming a NON-beach terrain
 * work (guide:1488 warns players then cannot build docks there, so the engine
 * honours it), which a data-default-only pass would overwrite, because a
 * non-beach terrain's own row says it grows a BEACH.
 *
 * TWO THINGS IT DOES NOT DO, named rather than left to be discovered:
 *
 *   - **Adjacency is 4-connected**, matching every other adjacency rule in
 *     this generator. RMSTEST_15 cannot discriminate: its land is a
 *     rectangle, and a rectangle's corner tile has two orthogonal water
 *     neighbours, so 4- and 8-connected produce the identical ring there. A
 *     land with a diagonal staircase edge would tell them apart.
 *   - **`grid.layer` is left alone.** A beach replaces the tile's terrain;
 *     whether it also strips a `terrain_mask` layer painted over that terrain
 *     is unmeasured, and leaving the layer is the reading that changes
 *     nothing else.
 */
export function applyAutomaticBeach(grid: TileGrid, constants: readonly TerrainConstantForMasks[], options: AutomaticBeachOptions = {}): number {
  const { beachTerrain, beachTerrainScope } = options;
  const { dim } = grid;
  const n = dim * dim;
  const { depth } = waterDepthMask(grid, constants);
  // Memoised per terrain id: `beachTerrainFor` scans the constants array, and
  // a coastline is thousands of tiles over a handful of distinct terrains.
  const beachById = new Map<number, number | undefined>();
  let written = 0;

  for (let i = 0; i < n; i++) {
    const own = depth[i];
    // Open water is the floor of the scale — nothing is deeper for it to face.
    if (own === DEPTH_WATER) continue;
    const x = i % dim;
    const y = (i - x) / dim;
    const bordersDeeper =
      (x > 0 && depth[i - 1] > own) ||
      (x < dim - 1 && depth[i + 1] > own) ||
      (y > 0 && depth[i - dim] > own) ||
      (y < dim - 1 && depth[i + dim] > own);
    if (!bordersDeeper) continue;

    const terrainId = grid.terrain[i];
    let beach: number | undefined;
    if (beachTerrain !== undefined && (beachTerrainScope === undefined || beachTerrainScope[i] !== 0)) {
      // The author's own `beach_terrain`, on the tiles their command painted.
      // Takes precedence over the terrain's data default, which is the whole
      // point of the attribute.
      beach = beachTerrain;
    } else {
      beach = beachById.get(terrainId);
      if (beach === undefined && !beachById.has(terrainId)) {
        beach = beachTerrainFor(constants, terrainId);
        beachById.set(terrainId, beach);
      }
    }
    // The `beach === terrainId` half was once removed as unreachable, and a
    // mutation test agreed: on the DATA path a beach terrain's own row carries
    // `beachTerrain: null`, so `beachTerrainFor` returns undefined and the
    // first half already catches it. `beach_terrain` put it back in reach —
    // nothing stops a script writing `create_terrain BEACH { beach_terrain
    // BEACH }`, and without the guard that tile counts as written every run.
    if (beach === undefined || beach === terrainId) continue;
    grid.terrain[i] = beach;
    written++;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface TerrainsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
  /** Tiles this stage turned into beach, across all of its per-command beach passes. Reported, not consumed — index.ts adds it to S1's own count for the drawer note. */
  beached: number;
}

/**
 * Sec.6.4: `<TERRAIN_GENERATION>` -> painted terrain patches. Mutates
 * `grid.terrain`/`grid.layer`; returns one CommandReport per `create_terrain`
 * command (Sec.7) plus any SimulationNotes for the two documented
 * approximations (`terrain_mask`'s over/under collapse; `beach_terrain`'s
 * documented no-op under `<CONNECTION_GENERATION>`).
 */
export function applyTerrains(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  masterSeed: number,
): TerrainsResult {
  const commands = instantiated.sections.get("TERRAIN_GENERATION") ?? [];
  const { dim } = grid;
  const symbols = instantiated.symbols;
  const hasConnectionSection = instantiated.sections.has("CONNECTION_GENERATION");
  const playerOrigins = origins.filter((o) => o.player !== undefined);
  // Computed ONCE per applyTerrains call: elevation is final by S4 (S2
  // already ran), so no command in this loop can change a tile's slope.
  // There is deliberately no stage-start water mask beside it any more --
  // the only thing that wanted one was beach placement, and that now happens
  // after the loop, against the water this stage's own commands left behind.
  const slope = computeSlopeMask(grid);

  let beached = 0;

  const reports: CommandReport[] = [];
  const notes: SimulationNote[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S4", ordinal++);

  for (const cmd of commands) {
    if (cmd.name !== "create_terrain") continue;

    // `terrainRef` is what the script WROTE (a name, or a bare id); the
    // `?? "GRASS"` on base_terrain is the attribute's own documented default,
    // applied to the reference rather than to a resolved id so the failure
    // message below can quote what the author actually typed.
    const terrainRef = cmd.args[0]?.value;
    const terrainId = resolveTerrainId(constants, terrainRef, symbols);

    const baseTerrainRef = argValue(cmd, "base_terrain", 0) ?? "GRASS";
    const baseLayerRef = argValue(cmd, "base_layer", 0);
    const baseTerrainId = resolveTerrainId(constants, baseTerrainRef, symbols);
    const baseLayerId = baseLayerRef !== undefined ? resolveTerrainId(constants, baseLayerRef, symbols) : undefined;

    const clumpCount = resolveClumpCount(cmd, dim);
    const failures: PlacementFailure[] = [];

    if (terrainId === undefined || baseTerrainId === undefined) {
      pushFailure(failures, {
        bucket: "terrainAbsent",
        commandSpan: cmd.span,
        stage: "S4",
        entity: "terrain patch",
        detail: `This map's reference data doesn't know the terrain "${String(terrainId === undefined ? terrainRef : baseTerrainRef)}", so this create_terrain command could not run.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S4", attempted: clumpCount, placed: 0, failures });
      continue;
    }

    const tileBudget = resolveTerrainTileBudget(cmd, dim);
    const tilesPerClump = Math.max(1, Math.floor(tileBudget / clumpCount));
    const cf = numAttr(cmd, "clumping_factor", 0, TERRAIN_DEFAULT_CF);
    const weights = terrainBucketWeights(cf);

    const heightLimits = readHeightLimits(cmd);
    const otherTerrainSpacing = numAttr(cmd, "spacing_to_other_terrain_types", 0, 0);
    const specificSpacings = specificTerrainSpacings(cmd, constants, symbols);
    const flatOnly = cmd.attributes.has("set_flat_terrain_only");
    const avoidPlayerDistance = avoidPlayerStartDistance(cmd);
    // guide:1502-1509 distinguishes the two masking layers, and they differ in
    // WHICH terrain ends up owning the tile's properties:
    //   1 - "new terrain is masked over the base terrain and INHERITS its
    //       properties" -> the base keeps providing properties (placement
    //       restrictions, automatic objects such as forest trees, minimap
    //       colour), and the new terrain is purely a visual layer on top.
    //   2 - "new terrain is masked under the base terrain and PROVIDES new
    //       properties" -> the new terrain becomes the property-bearing
    //       terrain and the old base is what is left showing as the layer.
    // guide:2486 confirms the direction from the object side: `layer_to_place_on`
    // "works for terrain_mask 1, but not when set to 2 ... because the layer
    // has become the main terrain".
    const maskLayer = cmd.attributes.has("terrain_mask") ? numAttr(cmd, "terrain_mask", 0, 1) : 0;
    const masksOver = maskLayer === 1;
    const masksUnder = maskLayer === 2;

    const hasBeachTerrain = cmd.attributes.has("beach_terrain");
    const beachTerrainId = resolveTerrainId(constants, argValue(cmd, "beach_terrain", 0), symbols);
    const applyBeach = hasBeachTerrain && !hasConnectionSection && beachTerrainId !== undefined;
    // guide:1485: "If a water terrain is specified, it will fully replace the
    // terrain specified in create_terrain, so this is NOT recommended." That
    // is the engine cascading — the waterline becomes water, so the next ring
    // in is now a waterline too, and so on until the clump is gone. Modelled
    // as the outcome the guide states outright rather than by iterating the
    // shoreline pass, and it is why that pass can safely be single-pass.
    const beachDrownsClump = applyBeach && isWaterTerrain(constants, beachTerrainId);

    if (maskLayer !== 0) {
      notes.push({
        key: `terrainMaskApproximated:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S4",
        span: cmd.span,
        text: "terrain_mask blends two terrain textures in game; the preview draws the masked terrain as a flat tint over the one that keeps the tile's properties (Sec.9's terrain_mask exclusion).",
      });
    }
    if (hasBeachTerrain && hasConnectionSection) {
      notes.push({
        key: `beachTerrainSkipped:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S4",
        span: cmd.span,
        text: "beach_terrain has no effect on a map with a <CONNECTION_GENERATION> section — a documented engine bug the preview reproduces rather than silently fixing. This coastline still gets the engine's own default beach, which is what the attribute would have been overriding.",
      });
    }
    if (beachDrownsClump) {
      notes.push({
        key: `beachTerrainIsWater:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S4",
        span: cmd.span,
        text: "beach_terrain names a water terrain here, which the guide warns fully replaces the terrain this command creates rather than edging it — the preview reproduces that, so this command paints water.",
      });
    }

    // Computed ONCE for the whole command, not per clump -- see the file
    // header's ITERATION CAP note. `otherTerrainSpacing`/`specificSpacings`
    // therefore reflect the grid as it stood when this command STARTED, not
    // live as earlier clumps of this same command paint: a documented,
    // conservative simplification (a later clump stays at least as spaced
    // from an earlier one as the check demands, never less), required to
    // keep this an O(dim^2)-once cost rather than O(dim^2) per clump, which
    // is what made a real corpus script (`24hr_Blind Valley.rms`,
    // `number_of_clumps 9320` under `set_scale_by_groups`) take minutes.
    const ctx: EligibilityContext = { baseTerrainId, baseLayerId, heightLimits, otherTerrainSpacing, specificSpacings, flatOnly, avoidPlayerDistance };
    const candidateResult = eligibleTerrainCandidates(grid, ctx, slope, playerOrigins);
    if (!candidateResult.ok) {
      pushFailure(failures, {
        ...candidateResult.failure,
        commandSpan: cmd.span,
        entity: "terrain patch",
        detail:
          candidateResult.failure.bucket === "terrainAbsent"
            ? `No tile on the map currently matches this patch's base_terrain ("${String(baseTerrainRef)}")${baseLayerRef !== undefined ? ` or base_layer ("${String(baseLayerRef)}")` : ""}, so no seed could be placed.`
            : `Every candidate tile fails one of this patch's height/spacing/flatness constraints.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S4", attempted: clumpCount, placed: 0, failures });
      continue;
    }

    const eligibleMask = new Uint8Array(dim * dim);
    for (const tile of candidateResult.value) eligibleMask[tile] = 1;
    const claimed = new Uint8Array(dim * dim); // grows clump by clump; kept separate from eligibleMask -- see growTerrainClump's header

    // An EXACT shrinking pool: a tile leaves it the first time a draw finds
    // it claimed, by swap-remove. Every tile is removed at most once, so the
    // whole command pays O(pool) for removals however many clumps it asks
    // for, and a draw from a pool that still has free tiles in it is O(1)
    // amortized. Replaces bounded rejection sampling (100 draws then give
    // up), which was exact while the claimed fraction was low and degenerated
    // into false `occupancyFull` reports and 100 wasted draws per clump as it
    // rose -- the coupon-collector tail, paid once per clump.
    const pool = Int32Array.from(candidateResult.value);
    let poolCount = pool.length;

    let placed = 0;
    // Bounded by the pool, not by a [tune] constant. Every successful clump
    // claims at least its own seed tile, so it removes at least one tile from
    // the pool -- which makes `pool.length` a genuine upper bound on useful
    // clumps rather than a guess, and makes the loop terminate on its own
    // even for `number_of_clumps 999999999`.
    const maxAttempts = Math.min(clumpCount, pool.length);

    for (let c = 0; c < maxAttempts; c++) {
      const pickRng = nextSubstream();
      let seed: number | undefined;
      while (poolCount > 0) {
        const index = nextInt(pickRng, 0, poolCount - 1);
        const candidate = pool[index];
        if (claimed[candidate] === 0) {
          seed = candidate;
          break;
        }
        poolCount--;
        pool[index] = pool[poolCount];
      }
      if (seed === undefined) {
        pushFailure(failures, {
          bucket: "occupancyFull",
          commandSpan: cmd.span,
          stage: "S4",
          entity: `terrain clump ${c + 1}`,
          detail: `Every eligible tile is already claimed by an earlier clump of this command, so no further clumps could be seeded.`,
        });
        break; // exact now, so this is genuine saturation -- no later clump can succeed either
      }

      const growthRng = nextSubstream();
      const clumpTiles = growTerrainClump(dim, seed, tilesPerClump, eligibleMask, claimed, weights, growthRng);

      for (const tile of clumpTiles) {
        claimed[tile] = 1;
        if (masksOver) {
          // Visual only. `grid.terrain` deliberately keeps the base terrain,
          // so a later command's `base_terrain` still matches this tile --
          // which is the guide's "inherits its properties", not an omission.
          grid.layer[tile] = terrainId;
        } else if (masksUnder) {
          // The new terrain takes over the tile's properties and the terrain
          // that was there becomes what is visible on top of it.
          grid.layer[tile] = grid.terrain[tile];
          grid.terrain[tile] = terrainId;
        } else {
          // A plain (unmasked) paint replaces the whole tile, layer included:
          // whatever was layered on the terrain that used to be here was
          // layered on THAT terrain, and it is gone.
          grid.terrain[tile] = terrainId;
          grid.layer[tile] = NO_LAYER;
        }
      }

      if (beachDrownsClump) {
        // The whole clump, not just its edge — see `beachDrownsClump` above.
        for (const tile of clumpTiles) grid.terrain[tile] = beachTerrainId!;
      }

      if (clumpTiles.size < tilesPerClump) {
        pushFailure(failures, {
          bucket: "growthShortfall",
          commandSpan: cmd.span,
          stage: "S4",
          entity: `terrain clump ${c + 1}`,
          detail: `This terrain clump grew to ${clumpTiles.size} of its ${tilesPerClump}-tile target before running out of eligible places to grow.`,
          data: { owned: clumpTiles.size, target: tilesPerClump },
        });
      }
      placed++;
    }

    if (maxAttempts < clumpCount) {
      pushFailure(failures, {
        bucket: "iterationCapped",
        commandSpan: cmd.span,
        stage: "S4",
        entity: "terrain clumps",
        detail: `This command asked for ${clumpCount} clumps, but only ${pool.length} tiles are eligible for it — one clump needs at least one tile, so the extra clumps had nowhere to go.`,
        data: { attempted: maxAttempts, requested: clumpCount },
      });
      notes.push({
        key: `terrainIterationCapped:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S4",
        span: cmd.span,
        text: `This create_terrain command asked for ${clumpCount} clumps but only ${pool.length} tiles match its base_terrain, so the extra clumps could not be placed.`,
      });
    }

    // A beach step at the end of EVERY create_terrain command, unconditionally
    // — not only when the command set `beach_terrain`. Whole grid, because a
    // command that paints WATER leaves land it never touched newly on the
    // coast; `beach_terrain` is what is scoped to the command's own tiles
    // (guide:1483: "where the CURRENT terrain borders water").
    //
    // **`create_terrain X { base_terrain BEACH }` is a no-op on an ordinary
    // map, and that is the correct outcome rather than the objection it looks
    // like.** The step re-beaches X's waterline, so on a map whose only beach
    // IS the waterline nothing changes. What the idiom is actually for is a
    // land made of beach: there the interior converts to X and only the strip
    // touching water reverts. An earlier version made this step conditional to
    // "protect" the idiom, which instead broke the case it exists to serve.
    // Both halves are pinned by tests below.
    //
    // `masksOver` withholds only the SCOPE, not the step: a `terrain_mask 1`
    // command never took ownership of the tile (guide:1502, the base terrain
    // still provides its properties), so its `beach_terrain` has no tiles of
    // its own to speak for, but the coastline still gets its data default.
    // Same for `beachDrownsClump`, whose tiles are water now.
    const scopedBeach = applyBeach && !masksOver && !beachDrownsClump;
    beached += applyAutomaticBeach(grid, constants, {
      beachTerrain: scopedBeach ? beachTerrainId : undefined,
      beachTerrainScope: scopedBeach ? claimed : undefined,
    });

    reports.push({ commandSpan: cmd.span, stage: "S4", attempted: maxAttempts, placed, failures });
  }

  return { reports, notes, beached };
}
