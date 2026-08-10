// S6: objects — docs/preview-design.md Sec.6.6. PURE (CLAUDE.md hard rule /
// preview-design Sec.2). The last generation stage: S1-S5 shape the grid,
// this one populates it and produces the renderer's object/player layers.
//
// TWO ORTHOGONAL "GROUP" CONCEPTS, easy to conflate because both are called
// "group" in the guide's own vocabulary:
//   1. OBJECT groups (`create_object_group NAME { add_object ... }`), which
//      pick WHICH object gets placed at a site — resolved per placement, %
//      weights ignored (guide:2025 confirms uniform IS engine behaviour, not
//      an approximation of it).
//   2. SPATIAL grouping (`number_of_groups`/`group_placement_radius`/
//      `set_tight_grouping`/`set_loose_grouping`), which decides WHERE
//      placements cluster. `isGrouped` below is this second concept only.
// A `create_object` block whose `type` argument names an object group (found
// in `instantiated.objectGroups`) draws its member per placement via
// `pickGroupMember`; this is completely independent of whether that same
// command is ALSO spatially grouped.
//
// SEC.6.6'S PINNED CANDIDATE-FILTER ORDER (Sec.7: "each stage's attribution
// order is its own constraint list, in the order written in its
// subsection") drives `buildCandidatePredicates` below, top to bottom:
// occupied, (can-overlap — deferred, see below), terrain habitat, implicit
// terrain-separation, distance band, avoid_other_land_zones, forest zone,
// avoid_cliff_zone / min_distance_to_map_edge / max_distance_to_other_zones,
// actor areas, require_path. `min_distance_group_placement` is deliberately
// NOT in that static list — see its own section below for why.
//
// SIX NAMED, DELIBERATE SIMPLIFICATIONS (recorded here rather than left
// implicit, matching terrains.ts's own convention for exactly this reason):
//
// 1. CAN-OVERLAP (multi-tile buildings silently dropped by tight grouping /
//    force_placement, Sec.6.6) is NOT modelled — every object is one tile,
//    same footprint deferral Sec.9 item 11 already makes for
//    override_actor_radius_if_required. A `canOverlap` bit does not exist in
//    game-constants.json (Sec.12 item 3's sibling request), so this is the
//    same data gap wearing a different name, not a new one.
// 2. OWNERSHIP GATE (`gaiaOnlyRequired`, `requiresGaiaOnly` below) falls back
//    to "has any resourceAmounts entry" for "must be gaia-only", since
//    `playerOwnable` (Sec.12 item 3) doesn't exist yet. This mis-handles
//    SHEEP in EXACTLY the direction the spec itself predicts ("Sheep and
//    other herdables are the awkward case the flag exists to settle...a
//    fallback that guesses from category alone will mis-handle herdables in
//    one direction or the other") — SHEEP carries resourceAmounts.food, so
//    this fallback requires set_gaia_object_only for it when the guide says
//    it is permitted but not required. Named, not fixed: fixing it would
//    mean hardcoding "SHEEP" as an RMS-vocabulary exception, which CLAUDE.md
//    forbids; the real fix is the data field.
// 3. HABITAT (`objectHabitat` below) falls back to "land" for any object the
//    reference data does not carry a `habitat` for, and the reference data
//    carries two dozen objects out of several hundred. The fallback is the
//    least-bad of the two available answers, not a good one — see
//    `objectHabitat` for why "any" was worse — and every wrong answer it
//    gives is a fish, a boat or a sea decoration standing on grass. The fix
//    is data, one row at a time: the DE ocean-fish family (TUNA, SNAPPER,
//    SALMON, DORADO, MARLIN1, OYSTERS) got explicit `habitat: "water"` rows
//    on 2026-08-08 for exactly this reason, and the real fix is still the
//    dat's own terrain-restriction table (Sec.15 item 23).
//    Deliberately NOT widened with a name-pattern guess the way grid.ts's
//    WATER_NAME_PATTERN guesses terrain water — that pattern is Sec.12 item
//    6's OWN documented fallback for terrain; item 7 documents no such
//    pattern for objects, and inventing one here would be exactly the
//    "confidently wrong" failure CLAUDE.md warns against. A row naming one
//    object is a claim about that object; a pattern is a claim about every
//    name nobody has looked at yet.
// 4. WALLS place normally (Sec.9: "special placement behavior" — the
//    connected-segment mechanic — is not simulated, not that nothing is
//    placed) plus one SimulationNote per wall-type command, detected by
//    rmsConstant matching /WALL/ — the same class of name-heuristic
//    precedent as grid.ts's WATER_NAME_PATTERN/FOREST_NAME_PATTERN, not a
//    new kind of guess.
// 5. ACTOR AREAS an object adds via its own `actor_area`/`actor_area_radius`
//    attributes are recorded PER COMMAND (one representative point at the
//    command's first successful placement) rather than per placement, which
//    is what guide:2780's "objects sharing an id append areas as they place"
//    literally describes. True per-placement bookkeeping would mean
//    re-running candidate filtering after every single placement, which
//    conflicts with Sec.11's whole architecture (a candidate pool computed
//    ONCE per command/frame and rejection-sampled — the same reason
//    terrains.ts computes its eligible set once per command, not once per
//    clump). A later command referencing the id still sees it; a later
//    PLACEMENT within the SAME command does not shrink around it.
// 6. MIN_DISTANCE_GROUP_PLACEMENT / TEMP_MIN_DISTANCE_GROUP_PLACEMENT is
//    scoped to placements already made BY THIS COMMAND, not the whole S6
//    run. Sec.6.6 says "vs all prior and future placements", which read
//    literally demands cross-command persistent state; scoping it per
//    command keeps every command's candidate pool independent of processing
//    order, which every other stage in this codebase already assumes.
//
// IGNORE_TERRAIN_RESTRICTIONS has TWO engine rules this file read wrong until
// 2026-08-10, both measured in game that day and both stated in the guide the
// whole time:
//
//   a. **It is not a standalone flag.** guide:2509 carries a `Requires:` line
//      — `set_place_for_every_player` or `place_on_specific_land_id` — and the
//      engine's answer when neither is present is that the command places
//      NOTHING. Not "the restrictions apply after all", nothing at all. This
//      is a whole-command gate, in `applyObjects` beside the `set_gaia_object_only`
//      one, and it is why `AK_Namatjira.rms` has no shore fish in game while
//      this preview drew 232.
//
//      **UNSETTLED, and the code claims more than the observation.** Namatjira
//      cannot separate "the command is voided" from "the flag is inert, so the
//      shore habitat re-applies and contradicts the command's own
//      `terrain_to_place_on DLC_MANGROVESHALLOW`" — both give zero fish there.
//      `find_closest` carries the identical `Requires:` line and appears 71
//      times frameless across working corpus maps, which argues the line alone
//      does not void a command. RMSTEST_42 is written and unrun; if it comes
//      back inert, this gate becomes a habitat re-application instead.
//   b. **The shore class is exempt from what it lifts.** Most objects really
//      do go anywhere under the flag (guide:2513 puts SALMON on grass). Shore
//      fish and box turtles do not: they still need a beach beside them and
//      still cannot stand on dry land, and what the flag buys them is the
//      SHALLOWS. Modelled in `shoreMask`'s `relaxed` band rather than at the
//      call site, so "the flag changes which tiles qualify" cannot decay back
//      into "the flag switches the habitat off".
//
// The generalisable half is (a)'s shape, and it is the third time this file
// has paid for it: a guide line that reads like documentation of an attribute
// ("Requires:", "Minimum (NOT maximum)") is a RULE, and an attribute nobody
// has written a test for is where they hide.
//
// REQUIRE_PATH: `docs/preview-design.md` describes a numeric `dev` argument
// ("dev 0 = any path, 1 = path length <= 1.3x straight-line..."), but
// `language.json`'s own entry declares an optional `pathType` (otherConstant)
// argument, not a number — the same class of doc-vs-data drift Sec.12 item 4
// already names for terrain_size. Rather than reading a `dev` that isn't
// there, this file treats `require_path`'s presence as `dev 0` ("any path
// exists") always — the loosest reading, which never over-rejects. The
// per-frame BFS this needs is a genuine `pathBlocked` emitter, which closes
// one of Sec.7's three "declared but never emitted" bucket gaps (the other
// two, `borderBlocked`/`zoneAvoidanceBlocked`, are also this file's job).
//
// PERFORMANCE (Sec.11): the candidate pool for a (frame, command) pair is
// built ONCE via `intersectCandidates` and reused across every placement
// that frame makes; per-placement occupancy and `min_distance_group_placement`
// are enforced by bounded rejection-sampling against the LIVE grid/point list
// rather than rebuilding the pool — `terrains.ts`'s `eligibleMask`/`claimed`
// split, applied here as the cached pool / live occupancy-and-spacing check.
// `MAX_OBJECT_PLACEMENTS_PER_COMMAND` is a flat cap (not dim-scaled, unlike
// terrains.ts's clump-attempt cap) because a pathological object count is a
// single huge literal, not a quadratic blow-up from clump growth.

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacedObject,
  PlacementFailure,
  PlayerMarker,
  SimulationNote,
  TileGrid,
} from "./types";
import { createSubstream, nextInt, type Rng } from "./rng";
import {
  DEPTH_LAND,
  DEPTH_WATER,
  UNREACHABLE,
  distanceTransformFromMask,
  forestZoneMask,
  isBeachTerrain,
  resolveTerrainId,
  waterDepthMask,
  waterMask,
  type DepthMaskResult,
} from "./grid";
import { intersectCandidates, pushFailure, type AttributedPredicate } from "./placement";
import { createSpacingIndex, type SpacingIndex } from "./spacingIndex";

// ---------------------------------------------------------------------------
// [tune] / guide-value constants
// ---------------------------------------------------------------------------

/** guide:2100's own default when `group_placement_radius` is grouped-but-bare. */
const DEFAULT_GROUP_PLACEMENT_RADIUS = 3;
/** guide: bare `avoid_forest_zone`/`avoid_cliff_zone` -> d=1. */
const DEFAULT_ZONE_AVOID_DISTANCE = 1;
/** Flat per-command cap — see file header. */
const MAX_OBJECT_PLACEMENTS_PER_COMMAND = 20000;

// ---------------------------------------------------------------------------
// Attribute reading — duplicated per-file convention (see elevation.ts's header).
// ---------------------------------------------------------------------------

function argValue(cmd: InstantiatedCommand, name: string, argIndex = 0): InstantiatedValue {
  return cmd.attributes.get(name)?.[0]?.args[argIndex]?.value;
}

function numAttr(cmd: InstantiatedCommand, name: string, argIndex: number, fallback: number): number {
  const v = argValue(cmd, name, argIndex);
  return typeof v === "number" ? v : fallback;
}

/** undefined when the attribute is absent; `fallback` when present but bare. */
function optionalNumAttr(cmd: InstantiatedCommand, name: string, fallback: number): number | undefined {
  if (!cmd.attributes.has(name)) return undefined;
  const v = argValue(cmd, name, 0);
  return typeof v === "number" ? v : fallback;
}

/** guide:167/1257/1274: mutually exclusive scale attributes, last (by source position) wins. Object-specific names, NOT terrains.ts's set_scale_by_size/groups. */
function lastObjectScaleAttribute(cmd: InstantiatedCommand): "mapSize" | "playerNumber" | undefined {
  const sizeAttr = cmd.attributes.get("set_scaling_to_map_size")?.[0];
  const playerAttr = cmd.attributes.get("set_scaling_to_player_number")?.[0];
  if (sizeAttr && playerAttr) return sizeAttr.span.start > playerAttr.span.start ? "mapSize" : "playerNumber";
  if (sizeAttr) return "mapSize";
  if (playerAttr) return "playerNumber";
  return undefined;
}

// ---------------------------------------------------------------------------
// Reference-data lookups (Sec.12 items 3/7/8's fallbacks — see file header)
// ---------------------------------------------------------------------------

/** The slice of game-constants.json this file needs — narrower consumers (grid.ts) don't carry resourceAmounts, so this is its own projection, matching that file's own stated convention. */
export interface ObjectConstant {
  constId: number | null;
  /** Null for terrain entries with no callable constant. Object entries always have one; the union is here because this one type is passed to every stage, terrain lookups included. */
  rmsConstant: string | null;
  category: string;
  resourceAmounts?: Readonly<Record<string, number>>;
  isWater?: boolean;
  isForest?: boolean;
  /** Object entries: where this object may stand. Absent means unknown — see `objectHabitat` for the fallback and why it is `land`. */
  habitat?: string;
}

/**
 * An object slot's written value -> its reference-data row. The object-side
 * sibling of `grid.ts`'s `resolveTerrainId`, and it exists for the same
 * reason that one does: **a resolver that only accepts one spelling of a name
 * is a false-negative factory** (CLAUDE.md, established for terrains and not
 * carried across to objects until now).
 *
 * Two forms, in this order, matching `resolveTerrainId`'s and for its reason:
 *
 * 1. **A built-in constant** (`create_object SHORE_FISH`), matched by name.
 * 2. **A script's own `#const`** (`#const ONGRID_PLACEHOLDER_NAVAL 1546` …
 *    `create_object ONGRID_PLACEHOLDER_NAVAL`), resolved through the symbol
 *    table to a unit id and then matched by `constId`. LAST, because the
 *    engine loads `random_map.def` before the script and `#const` is
 *    first-definition-wins, so a script redefining a built-in name does not
 *    take effect in game and must not take effect here.
 *
 * **This is the larger half of the object-habitat gap, not a tidy-up.**
 * Measured over the 56 corpus maps: 397 distinct names reach `create_object`,
 * and 216 of them are script `#const`s rather than DE names. `AD4 - Pag -
 * v1.2.rms`'s naval placeholder is one, and no amount of completeness in
 * `game-constants.json` could ever have resolved it by name — unit 1546 has
 * no `#const` in `random_map.def` at all, so the id is the only handle that
 * exists.
 *
 * It resolves nothing today that the data does not carry a row for, which is
 * the point of separating the two halves: this closes the lookup, and the
 * extraction closes the coverage.
 */
function objectEntry(objectRef: string, constants: readonly ObjectConstant[], symbols?: ReadonlyMap<string, number>): ObjectConstant | undefined {
  const byName = constants.find((c) => c.category === "object" && c.rmsConstant === objectRef);
  if (byName !== undefined) return byName;
  const id = symbols?.get(objectRef);
  if (id === undefined) return undefined;
  return constants.find((c) => c.category === "object" && c.constId === id);
}

/** Sec.12 item 3's fallback: an object carrying any resourceAmounts is treated as a must-be-gaia resource. Mis-handles SHEEP by design — see file header note 2. */
export function requiresGaiaOnly(objectRef: string, constants: readonly ObjectConstant[], symbols?: ReadonlyMap<string, number>): boolean {
  const amounts = objectEntry(objectRef, constants, symbols)?.resourceAmounts;
  return amounts !== undefined && Object.keys(amounts).length > 0;
}

/**
 * The five coarse classes the preview maps the engine's terrain table onto.
 *
 * **`water` and `amphibious` are two classes, not one, and the split is
 * measured** — `empires2_x2_p1.dat`'s restriction 19 (every ordinary fish)
 * permits 15 terrains with NO shallow and NO beach among them, while
 * restrictions 13, 3 and 15 (the great fish, OYSTERS, TRANSPORT_SHIP) permit
 * 38 including every shallow and every beach. A fish genuinely cannot stand on
 * a shallow.
 *
 * The corpus looks like it disagrees and does not. `Menindee_AUS_v2.3.rms`
 * puts fish all over its shallows, and the way it does so is
 * `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW ...
 * second_object FISH }` — the placeholder is unit 647, terrain restriction 0,
 * all 131 terrains permitted, and the fish rides in as the second object.
 * guide:2211 recommends exactly this as the way to "bypass terrain
 * restrictions by using an invisible placeholder object as the main object".
 * **So the maps that appear to place fish on shallows are evidence that they
 * cannot be placed there directly**, which is the opposite of how it reads,
 * and it is why the `second_object` path must never re-check the second
 * object's own habitat. It does not, and a test pins that.
 */
export type Habitat = "land" | "water" | "amphibious" | "shore" | "any";

/**
 * Where an object is allowed to stand — the preview's coarse stand-in for the
 * engine's TERRAIN TABLE, which stores a per-object terrain-restriction id and
 * a per-restriction row of allowed terrains, and which a script can itself
 * rewrite with `effect_amount SET_ATTRIBUTE <object> ATTR_TERRAIN_ID <n>`
 * (`Menindee_AUS_v2.3.rms` does exactly that, ten times).
 *
 * Read from the entry's own `habitat` when the reference data has one.
 *
 * **The fallback for an unknown object is `land`, and it used to be `any`.**
 * That change is the whole fix, so it is worth stating why it is not a guess
 * dressed up as a default. `any` means unrestricted, and `game-constants.json`
 * knows 16 objects out of several hundred, so in practice EVERY tree, animal
 * and decoration a real script places was unrestricted: measured on
 * `AD4 - Pag - v1.2.rms`, 21 of 40 OLIVE_TREEs and 16 of 40 CYPRESS_TREEs
 * stood in open water. A forest floating on the sea is not a cautious
 * approximation, it is a confident lie about the layout, which is the one
 * thing goal 1 rules out.
 *
 * The two defaults are not symmetric, which is what settles it. Land objects
 * are the overwhelming majority of what scripts place; the water ones are a
 * small, well-known family (fish, whales, ships) and a script placing one
 * OFTEN writes `terrain_to_place_on SHALLOW`-or-similar, which takes
 * precedence over habitat in the predicate chain and so is unaffected by this
 * default. `ignore_terrain_restrictions` remains the explicit escape hatch,
 * exactly as in game.
 *
 * **"Often" was written as "almost always" and that overstatement was the
 * whole of the next bug.** A script placing a fish on OPEN water has no reason
 * to name a terrain — the engine's own terrain table already restricts it, so
 * `terrain_to_place_on` is redundant and authors skip it. `QS_Three_Bays_v1.1`
 * writes nine bare `create_object TUNA` commands and `land` sent all 119 of
 * them ashore, 77 onto the beach. The maps that DO name a terrain are the ones
 * placing fish on SHALLOWS, where the author wants a specific water terrain
 * rather than any — which is why `Menindee_AUS_v2.3` looked like the general
 * case and is not. The correct reading of the asymmetry is unchanged and
 * narrower than it was written: `land` is right for the long tail of unknown
 * land decoration, and the water family has to be named in the data one row at
 * a time. Six such rows were added 2026-08-08.
 *
 * Still an approximation, and the real fix is still data: `tools/extract-constants`
 * can read the terrain table out of the dat (see its README), and every entry
 * that gains a real `habitat` stops depending on this fallback.
 */
export function objectHabitat(objectRef: string, constants: readonly ObjectConstant[], symbols?: ReadonlyMap<string, number>): Habitat {
  const declared = objectEntry(objectRef, constants, symbols)?.habitat;
  if (declared === "land" || declared === "water" || declared === "amphibious" || declared === "shore" || declared === "any") return declared;
  return "land";
}

/**
 * Did the habitat above come from the reference DATA, or from the `land`
 * fallback? The distinction decides one thing and it is worth its own
 * function: whether an author's `terrain_to_place_on` can switch the habitat
 * check off (see `buildCandidates` step 3).
 */
export function objectHabitatIsDeclared(objectRef: string, constants: readonly ObjectConstant[], symbols?: ReadonlyMap<string, number>): boolean {
  return objectEntry(objectRef, constants, symbols)?.habitat !== undefined;
}

/** Sec.12 item 8's fallback (no real category data exists yet): resource sub-class from resourceAmounts, else a generic bucket. */
export function objectCategory(objectRef: string, constants: readonly ObjectConstant[], symbols?: ReadonlyMap<string, number>): string {
  const amounts = objectEntry(objectRef, constants, symbols)?.resourceAmounts;
  if (amounts?.gold) return "resource-gold";
  if (amounts?.stone) return "resource-stone";
  if (amounts?.food) return "resource-food";
  if (amounts?.wood) return "resource-wood";
  // Only reached for an object the reference data has no yields for, which
  // today is almost every tree in the corpus -- see TREE_NAME_PATTERN.
  if (TREE_NAME_PATTERN.test(objectRef)) return "resource-wood";
  return "object";
}

const WALL_NAME_PATTERN = /WALL/;

/**
 * Tree and bush objects, for COLOUR ONLY — `objectCategory` maps a match to
 * `resource-wood`, which the palette draws dark green.
 *
 * A name heuristic, and deliberately confined to a cosmetic decision. The
 * same reasoning that keeps `objectHabitat` from guessing applies with full
 * force to placement (a wrong habitat moves an object and lies about the
 * layout) and with none at all to a swatch: the alternative here is not
 * "correct colour" but the near-white unknown-category fallback, which on a
 * forest map covers the terrain in white confetti and hides the very thing
 * the tile is made of. Same precedent as WALL_NAME_PATTERN above.
 *
 * Derived from the object names the 32 tracked maps actually place, not
 * invented: OLIVE_TREE, CYPRESS_TREE, ITALIAN_PINETREE, DLC_DRAGONTREE,
 * SNOW_PINE_TREE, OAK_FOREST_TREE, BUSH_A/B, FORAGE_BUSH, DLC_ORANGEBUSH,
 * PLANT_RAINFOREST, FOREST_STRAGGLERS and the rest all fall out of these
 * four stems. `resourceAmounts.wood` would be the real signal and takes
 * precedence wherever the reference data has it.
 */
const TREE_NAME_PATTERN = /TREE|FOREST|BUSH|PLANT_/;

/** Stands in for the loose-grouping lookup on the commands that never read it — see its build site. Never written to. */
const EMPTY_CANDIDATE_LOOKUP = new Uint8Array(0);

// ---------------------------------------------------------------------------
// Spatial grouping flag (Sec.6.6: "a derived flag, and four different
// attributes set it... compute it once per command and pass it down").
// ---------------------------------------------------------------------------

export function isGrouped(cmd: InstantiatedCommand): boolean {
  return (
    cmd.attributes.has("number_of_groups") ||
    cmd.attributes.has("group_placement_radius") ||
    cmd.attributes.has("set_tight_grouping") ||
    cmd.attributes.has("set_loose_grouping")
  );
}

/**
 * Sec.15 item 17c: OPEN, unverified in-game. Tight is the current best model
 * for "grouped but neither mode stated" per Sec.6.6's own reasoning
 * (group_placement_radius's wording describes a cohesive cluster; loose
 * reads as the opt-in) — implemented as the default rather than left
 * unhandled, but flagged here exactly where the spec flags it.
 */
export function isTightGrouping(cmd: InstantiatedCommand): boolean {
  return !cmd.attributes.has("set_loose_grouping");
}

// ---------------------------------------------------------------------------
// create_object_group member resolution (Sec.6.6 preamble)
// ---------------------------------------------------------------------------

/** Member names of an object group, in declared order. % weights are read from language.json's shape but deliberately never consulted — guide:2025 confirms the engine ignores them too. */
export function objectGroupMembers(groupCmd: InstantiatedCommand): string[] {
  const attrs = groupCmd.attributes.get("add_object") ?? [];
  const out: string[] = [];
  for (const attr of attrs) {
    const name = attr.args[0]?.value;
    if (typeof name === "string") out.push(name);
  }
  return out;
}

function pickGroupMember(members: readonly string[], rng: Rng): string {
  return members[nextInt(rng, 0, members.length - 1)];
}

// ---------------------------------------------------------------------------
// Counts (Sec.6.6 "Counts:")
// ---------------------------------------------------------------------------

export interface ObjectCounts {
  /** Number of spatial groups (meaningful only when `grouped`). */
  groupCount: number;
  /** Per-group member count before variance (grouped) or the total independent placement count (ungrouped). */
  perGroupBase: number;
  /** `group_variance` — 0 when absent. */
  variance: number;
}

export function resolveObjectCounts(cmd: InstantiatedCommand, dim: number, playerCount: number, grouped: boolean): ObjectCounts {
  const declaredObjects = numAttr(cmd, "number_of_objects", 0, 1);
  const declaredGroups = numAttr(cmd, "number_of_groups", 0, 1);
  const variance = numAttr(cmd, "group_variance", 0, 0);
  const scaleAttr = lastObjectScaleAttribute(cmd);

  function scale(value: number): number {
    if (scaleAttr === "mapSize") return Math.max(1, Math.floor((value * (dim * dim)) / 10000));
    if (scaleAttr === "playerNumber") return Math.max(1, Math.floor(value * playerCount));
    return Math.max(1, value);
  }

  if (grouped) {
    return { groupCount: scale(declaredGroups), perGroupBase: Math.max(1, declaredObjects), variance };
  }
  return { groupCount: 1, perGroupBase: scale(declaredObjects), variance: 0 };
}

/** `group_variance v`: count varies within [n-v, n+v-1], floored at 1 (Sec.6.6, "positive range reduced by 1"). */
function variedGroupTarget(base: number, variance: number, rng: Rng): number {
  if (variance <= 0) return Math.max(1, base);
  const min = Math.max(1, base - variance);
  const max = Math.max(min, base + variance - 1);
  return nextInt(rng, min, max);
}

// ---------------------------------------------------------------------------
// Reference frame resolution (Sec.6.6 "Reference frame")
// ---------------------------------------------------------------------------

export interface ObjectFrame {
  /** Index into `origins`/`grid.landId` when this frame is tied to a specific land; absent for the frameless case. */
  originIndex?: number;
  x?: number;
  y?: number;
  reference?: string;
  /** The land's owning player, when it has one — carried directly rather than re-parsed out of `reference`. */
  player?: number;
}

export interface ObjectFrameResolution {
  kind: "everyPlayer" | "specificLand" | "none";
  frames: ObjectFrame[];
  /** Set when place_on_specific_land_id named an id with no matching land (and it wasn't -11). */
  missingLandId?: number;
}

export function resolveObjectFrames(cmd: InstantiatedCommand, origins: readonly LandOrigin[]): ObjectFrameResolution {
  if (cmd.attributes.has("set_place_for_every_player")) {
    // guide:2263: "Only works for player lands or lands assigned to
    // players. Disabled by land_id" -- the fake-player-land idiom.
    let eligible = origins.map((o, i) => ({ o, i })).filter(({ o }) => o.player !== undefined && o.declaredLandId === undefined);
    if (cmd.attributes.has("generate_for_first_land_only")) eligible = eligible.slice(0, 1);
    return {
      kind: "everyPlayer",
      frames: eligible.map(({ o, i }) => ({ originIndex: i, x: o.x, y: o.y, reference: `player ${o.player}`, player: o.player })),
    };
  }

  const landIdAttr = cmd.attributes.get("place_on_specific_land_id")?.[0];
  if (landIdAttr) {
    const id = landIdAttr.args[0]?.value;
    if (typeof id !== "number" || id === -11) {
      // -11 = "random map position" (Sec.6.6): no land to reference, treated
      // as the frameless case rather than a specific land.
      return { kind: "none", frames: [{}] };
    }
    const matches = origins.map((o, i) => ({ o, i })).filter(({ o }) => o.declaredLandId === id);
    if (matches.length === 0) return { kind: "specificLand", frames: [], missingLandId: id };
    return {
      kind: "specificLand",
      frames: matches.map(({ o, i }) => ({ originIndex: i, x: o.x, y: o.y, reference: `land #${id}`, player: o.player })),
    };
  }

  return { kind: "none", frames: [{}] };
}

// ---------------------------------------------------------------------------
// Candidate filter (Sec.6.6's pinned order -> Sec.7 successive intersection)
// ---------------------------------------------------------------------------

function withinSquareRadius(dim: number, tile: number, area: { x: number; y: number; radius: number }): boolean {
  const x = tile % dim;
  const y = (tile - x) / dim;
  return Math.abs(x - area.x) <= area.radius && Math.abs(y - area.y) <= area.radius;
}

function distanceBandOk(dx: number, dy: number, circular: boolean, min: number | undefined, max: number | undefined): boolean {
  if (circular) {
    const d2 = dx * dx + dy * dy;
    if (min !== undefined && d2 < min * min) return false;
    if (max !== undefined && d2 > max * max) return false;
    return true;
  }
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  if (min !== undefined && d < min) return false;
  if (max !== undefined && d > max) return false;
  return true;
}

/**
 * Single-source BFS restricted to a passable mask — distinct from grid.ts's
 * `distanceTransform*` (both of those are multi-source "distance to nearest
 * mask tile", ignoring terrain entirely along the way). This is "can you
 * WALK there without crossing a blocked tile", which is what both the
 * terrain-separation rule and require_path actually ask. Shared by both
 * below rather than duplicated, since they differ only in which mask they
 * pass in.
 */
function reachabilityFromPoint(dim: number, startX: number, startY: number, passable: Uint8Array): Uint16Array {
  const n = dim * dim;
  const dist = new Uint16Array(n).fill(UNREACHABLE);
  const start = startY * dim + startX;
  if (passable[start] === 0) return dist; // origin itself blocked (e.g. sits on water for a land-habitat object) -- nothing reachable
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    const x = i % dim;
    const y = (i - x) / dim;
    relax(x > 0 ? i - 1 : -1, d);
    relax(x < dim - 1 ? i + 1 : -1, d);
    relax(y > 0 ? i - dim : -1, d);
    relax(y < dim - 1 ? i + dim : -1, d);
  }
  function relax(neighbor: number, fromDist: number): void {
    if (neighbor < 0 || passable[neighbor] === 0 || dist[neighbor] !== UNREACHABLE) return;
    dist[neighbor] = fromDist + 1;
    queue[tail++] = neighbor;
  }
  return dist;
}

/**
 * Sec.11: "reachability masks are cached per (land, habitat class) for the
 * whole stage" — and, extending the same reasoning, so are the water mask,
 * the forest-zone mask/distance, the cliff distance transform and the
 * per-land edge-distance transform, none of which depend on anything more
 * specific than the (fixed, S6-final) grid. Building this ONCE per
 * `applyObjects` call rather than once per (command, frame) pair is what
 * keeps a script with hundreds of `create_object` commands referencing the
 * same players' lands from redoing the same O(dim^2) work hundreds of times
 * over — exactly the class of bug terrains.ts's own header describes
 * (per-clump vs per-command eligible-set cost), found here the same way:
 * two real corpus maps (`AK_Namatjira.rms`, `TL Team Acropolis.rms`) timed
 * out under this suite's corpus gate before this cache existed.
 */
interface ObjectStageCaches {
  water: Uint8Array;
  habitatMask(habitat: Habitat, invert: boolean, ignoreRestrictions?: boolean): Uint8Array | undefined;
  forestMask(): Uint8Array;
  forestDistance(): Uint16Array;
  cliffDistance(): Uint16Array;
  restrictedDistance(habitat: Habitat): Uint16Array | undefined;
  landEdgeDistance(originIndex: number): Uint16Array;
  reachability(originIndex: number, x: number, y: number, habitat: Habitat, excludeCliffs: boolean): Uint16Array | undefined;
}

function createObjectStageCaches(grid: TileGrid, constants: readonly ObjectConstant[]): ObjectStageCaches {
  const { dim } = grid;
  const n = dim * dim;
  const water = waterMask(grid, constants).mask;
  const habitatMasks = new Map<string, Uint8Array>();
  const reachabilityCache = new Map<string, Uint16Array>();
  const restrictedCache = new Map<Habitat, Uint16Array | undefined>();
  const landEdgeCache = new Map<number, Uint16Array>();
  let forest: Uint8Array | undefined;
  let forestDist: Uint16Array | undefined;
  let cliffDist: Uint16Array | undefined;

  function habitatMask(habitat: Habitat, invert: boolean, ignoreRestrictions = false): Uint8Array | undefined {
    if (habitat === "any") return undefined; // nothing to restrict
    // `ignore_terrain_restrictions` lifts the terrain table outright for every
    // habitat EXCEPT `shore`, which keeps its beach anchor and only gains the
    // shallows — see `shoreMask`. Returning undefined here rather than at the
    // call sites keeps the one exception in one place.
    if (ignoreRestrictions && habitat !== "shore") return undefined;
    const key = `${habitat}|${invert}|${ignoreRestrictions}`;
    const cached = habitatMasks.get(key);
    if (cached) return cached;
    const out = new Uint8Array(n);
    // "shore" is OPEN WATER TOUCHING A BEACH — see shoreMask.
    const shoreBand = habitat === "shore" ? shoreMask(ignoreRestrictions) : undefined;
    // The other three all read the depth scale, so take it once.
    const { depth } = shoreBand ? { depth: undefined } : depthMask();
    for (let i = 0; i < n; i++) {
      let permitted: boolean;
      if (shoreBand) {
        permitted = shoreBand[i] !== 0;
      } else if (habitat === "water") {
        // Open water ONLY. A shallow is walkable ground and restriction 19
        // excludes it outright — see the Habitat docstring for why the corpus
        // looks like it says otherwise.
        permitted = depth![i] === DEPTH_WATER;
      } else if (habitat === "amphibious") {
        // Water, shallows and the sand between them: anything that is not
        // plain dry land. Restrictions 13/3/15 permit exactly this shape.
        permitted = depth![i] !== DEPTH_LAND || isBeachById(grid.terrain[i]);
      } else {
        // "land" — deliberately still `!isWater` and NOT `depth === LAND`.
        // The two differ on the three shallows the water flag calls dry
        // (DLC_MANGROVESHALLOW, Ice Navigable, DLC_MANGROVEFOREST), and
        // whether a land object may stand on those is unmeasured. Changing it
        // here would be a second, unasked-for behaviour change riding along
        // with the water split.
        permitted = water[i] === 0;
      }
      out[i] = (invert ? !permitted : permitted) ? 1 : 0;
    }
    habitatMasks.set(key, out);
    return out;
  }

  let shore: Uint8Array | undefined;
  let shoreRelaxed: Uint8Array | undefined;
  /**
   * The `shore` habitat: **a tile of OPEN WATER orthogonally adjacent to a
   * beach.** Three exclusions, each of which was wrong in the previous
   * version and each of which someone could reasonably have expected to be
   * included:
   *
   *   - **Not the beach tile itself.** SHORE_FISH and DLC_BOXTURTLE stand in
   *     the water, not on the sand. The old band was symmetric about the
   *     waterline — one tile of water plus one tile of land — so roughly half
   *     of every shore fish and box turtle came out beached.
   *   - **Not a shallow.** `terrainDepth` separates the three, and shallows
   *     are excluded by name: they are walkable ground as far as the game is
   *     concerned, which is the same reason they are not where a fish goes.
   *   - **Not water merely near land.** The anchor is a beach terrain
   *     (`isBeach`, the nine of them), not "any non-water neighbour". Since
   *     the engine lays a beach at every waterline (terrains.ts), the two
   *     coincide on an ordinary coast and diverge exactly where a script has
   *     painted its coastline over — `AD4 - Pag - v1.2.rms` replaces BEACH
   *     with DIRT along its connection paths, and a shore fish will not
   *     place against that stretch. That is a consequence worth stating
   *     rather than papering over: what the engine anchors on is one row of
   *     its terrain table, which is Sec.15 item 23's data and not ours yet.
   *
   * Adjacency is 4-connected, matching the beach rule that put the sand
   * there. A diagonal-only touch is not a shore.
   *
   * **`relaxed` is the shore class under `ignore_terrain_restrictions`, and
   * it widens the water rather than removing the anchor.** Measured in game
   * 2026-08-10: the flag does NOT let a shore fish or a box turtle onto dry
   * land the way it lets a salmon onto grass (guide:2513's own example). They
   * still have to sit beside a beach; what they gain is the shallows. So the
   * relaxed band is "anything that is not dry land, orthogonally adjacent to
   * a beach", which is the strict band plus DEPTH_HYBRID.
   *
   * The beach tile itself stays excluded in BOTH modes — it is dry land, and
   * "not on land" is the half of the rule the flag does not touch. This is
   * why the exception lives inside the mask rather than at the call site: the
   * flag changes which tiles qualify, it does not switch the habitat off, and
   * a caller that skipped the mask entirely would beach the fish again.
   */
  function shoreMask(relaxed: boolean): Uint8Array {
    const cached = relaxed ? shoreRelaxed : shore;
    if (cached) return cached;
    const beach = new Uint8Array(n);
    for (let i = 0; i < n; i++) beach[i] = isBeachById(grid.terrain[i]) ? 1 : 0;
    const { depth } = depthMask();
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // Strict: open water only. Relaxed: open water OR a shallow, never dry
      // land (and a beach is dry land, so it is excluded by this test too).
      if (relaxed ? depth[i] === DEPTH_LAND : depth[i] !== DEPTH_WATER) continue;
      const x = i % dim;
      const y = (i - x) / dim;
      if (
        (x > 0 && beach[i - 1] !== 0) ||
        (x < dim - 1 && beach[i + 1] !== 0) ||
        (y > 0 && beach[i - dim] !== 0) ||
        (y < dim - 1 && beach[i + dim] !== 0)
      ) {
        out[i] = 1;
      }
    }
    if (relaxed) shoreRelaxed = out;
    else shore = out;
    return out;
  }

  // Memoised per DISTINCT terrain id: `isBeachTerrain` scans the constants
  // array and a grid is tens of thousands of tiles over a handful of terrains.
  const beachById = new Map<number, boolean>();
  function isBeachById(id: number): boolean {
    let hit = beachById.get(id);
    if (hit === undefined) {
      hit = isBeachTerrain(constants, id);
      beachById.set(id, hit);
    }
    return hit;
  }

  let depth: DepthMaskResult | undefined;
  function depthMask(): DepthMaskResult {
    if (!depth) depth = waterDepthMask(grid, constants);
    return depth;
  }

  function forestMask(): Uint8Array {
    if (!forest) forest = forestZoneMask(grid, constants).mask;
    return forest;
  }
  function forestDistance(): Uint16Array {
    if (!forestDist) forestDist = distanceTransformFromMask(dim, forestMask());
    return forestDist;
  }
  function cliffDistance(): Uint16Array {
    if (!cliffDist) cliffDist = distanceTransformFromMask(dim, grid.cliff);
    return cliffDist;
  }
  function restrictedDistance(habitat: Habitat): Uint16Array | undefined {
    if (restrictedCache.has(habitat)) return restrictedCache.get(habitat);
    const restricted = habitatMask(habitat, true);
    const result = restricted ? distanceTransformFromMask(dim, restricted) : undefined;
    restrictedCache.set(habitat, result);
    return result;
  }
  function landEdgeDistance(originIndex: number): Uint16Array {
    const cached = landEdgeCache.get(originIndex);
    if (cached) return cached;
    const notThisLand = new Uint8Array(n);
    for (let i = 0; i < n; i++) notThisLand[i] = grid.landId[i] === originIndex ? 0 : 1;
    const result = distanceTransformFromMask(dim, notThisLand);
    landEdgeCache.set(originIndex, result);
    return result;
  }
  function reachability(originIndex: number, x: number, y: number, habitat: Habitat, excludeCliffs: boolean): Uint16Array | undefined {
    const passable = habitatMask(habitat, false);
    if (!passable) return undefined;
    const key = `${originIndex}|${habitat}|${excludeCliffs}`;
    const cached = reachabilityCache.get(key);
    if (cached) return cached;
    let mask = passable;
    if (excludeCliffs) {
      mask = new Uint8Array(passable.length);
      for (let i = 0; i < passable.length; i++) mask[i] = passable[i] !== 0 && grid.cliff[i] === 0 ? 1 : 0;
    }
    const result = reachabilityFromPoint(dim, x, y, mask);
    reachabilityCache.set(key, result);
    return result;
  }

  return { water, habitatMask, forestMask, forestDistance, cliffDistance, restrictedDistance, landEdgeDistance, reachability };
}

interface CandidateContext {
  grid: TileGrid;
  constants: readonly ObjectConstant[];
  cmd: InstantiatedCommand;
  habitat: Habitat;
  /** True when `habitat` came from a reference-data row rather than the `land` fallback. Decides whether `terrain_to_place_on` can switch the habitat check off — see step 3. */
  habitatIsData: boolean;
  frame: ObjectFrame;
  playerOrigins: readonly LandOrigin[];
  forcePlacement: boolean;
  ignoreTerrain: boolean;
  liveActorAreas: ReadonlyMap<number, Array<{ x: number; y: number; radius: number }>>;
  caches: ObjectStageCaches;
  /** The script's own `#const` table, so `terrain_to_place_on WOODIES` resolves like every other terrain slot. */
  symbols: ReadonlyMap<string, number>;
}

/** Returns undefined when `actor_area_to_place_in` names an id with no areas yet (Sec.6.6: "referencing a never-created id -> actorAreaMissing", a command-level miss handled by the caller before this returns predicates). */
function buildCandidatePredicates(ctx: CandidateContext): AttributedPredicate[] | undefined {
  const { grid, constants, cmd, habitat, habitatIsData, frame, playerOrigins, forcePlacement, ignoreTerrain, liveActorAreas, caches, symbols } = ctx;
  const { dim } = grid;
  const predicates: AttributedPredicate[] = [];

  // 1. occupied (free unless force_placement)
  if (!forcePlacement) {
    predicates.push({ bucket: "occupancyFull", test: (i) => grid.occupied[i] === 0 });
  }
  // 2. can-overlap -- deliberately not modelled, see file header note 1.

  // 3. terrain habitat / terrain_to_place_on / layer_to_place_on
  //
  // `ignore_terrain_restrictions` gates ONLY the habitat check at the bottom
  // of this block, not the whole block. guide:2510-2511: it means "objects
  // can be placed on terrains they are normally restricted from" and it
  // explicitly "can be used in combination with terrain_to_place_on" — the
  // author is lifting the engine's terrain table, not withdrawing their own
  // instruction about where to place. Gating everything is what let
  // `AK_Six_Points_v1.4.rms` scatter 11 DLC_ANIMALSKELETONs across open
  // water: that command writes `terrain_to_place_on DIRT` AND
  // `ignore_terrain_restrictions`, and the second was cancelling the first.
  {
    const terrainRef = argValue(cmd, "terrain_to_place_on", 0);
    const layerRef = argValue(cmd, "layer_to_place_on", 0);
    const terrainId = terrainRef !== undefined ? resolveTerrainId(constants, terrainRef, symbols) : undefined;
    const layerId = layerRef !== undefined ? resolveTerrainId(constants, layerRef, symbols) : undefined;
    if (terrainId !== undefined) {
      predicates.push({ bucket: "terrainAbsent", test: (i) => grid.terrain[i] === terrainId });
    }
    // guide:2483: "If used together with terrain_to_place_on, the object(s)
    // will be placed only where BOTH the base terrain and the layer apply" --
    // so these two narrow each other rather than one replacing the other.
    if (layerId !== undefined) {
      predicates.push({ bucket: "terrainAbsent", test: (i) => grid.layer[i] === layerId });
    }
    // The habitat restriction is ADDITIONAL to both, not an alternative to
    // them: in game the terrain table still forbids a tile that
    // `layer_to_place_on` happens to allow. Treating it as an alternative is
    // what put 21 of `AD4 - Pag - v1.2.rms`'s 40 OLIVE_TREEs in open water --
    // they carry `layer_to_place_on GRASS`, the GRASS layer survives under
    // water terrain that a later `terrain_mask 2` command laid down, and the
    // habitat check that would have caught it never ran.
    //
    // **`terrain_to_place_on` was an exception and is not one any more
    // (corrected 2026-08-08). It does NOT lift the engine's terrain table.**
    // The old reading was that it "names the GROUND, which is the same thing
    // habitat is guessing at, so the author saying so outranks our guess",
    // and it left `AK_Hourglass_v2.0.rms`'s
    // `create_object SHORE_FISH { terrain_to_place_on WATER … }` with no
    // shore constraint at all — 200000 shore fish spread over open sea.
    //
    // **What refutes it is the placeholder idiom, from the other side.** If
    // `terrain_to_place_on SHALLOW` were enough to put a fish on a shallow,
    // `Menindee_AUS_v2.3.rms` would write `create_object FISH
    // { terrain_to_place_on SHALLOW }` and be done. It instead pays for
    // `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW …
    // second_object FISH }`, where the placeholder is unit 647 with terrain
    // restriction 0. Nobody buys an unrestricted carrier object if naming the
    // terrain already worked. guide:2510 names the actual override, and it is
    // `ignore_terrain_restrictions`, which is why that one still gates here.
    //
    // **The old carve-out is kept for exactly the case it was written for and
    // no wider: an UNDECLARED habitat, which is a guess rather than data.**
    // The reference data covers a few dozen objects of several hundred, so an
    // unknown water object falls back to `land`, and an author writing
    // `terrain_to_place_on SHALLOW` for one is the only signal there is —
    // narrowing by a guessed `land` would place nothing at all and read as
    // the object failing. Where the habitat came from the dat's own
    // restriction table, there is no guess to defer to and the two narrow
    // each other, exactly as `layer_to_place_on` does above.
    //
    // **`ignoreTerrain` is no longer a gate here, it is an argument.** It used
    // to skip this block outright, which is right for every habitat but one:
    // the shore class keeps its beach anchor under the flag and only gains the
    // shallows (measured in game 2026-08-10 — see `shoreMask`). `habitatMask`
    // returns undefined for the cases the flag really does lift, so the shape
    // of the decision stays in the mask rather than being duplicated here.
    if (terrainId === undefined || habitatIsData) {
      const permitted = caches.habitatMask(habitat, false, ignoreTerrain);
      if (permitted !== undefined) predicates.push({ bucket: "terrainAbsent", test: (i) => permitted[i] !== 0 });
    }
  }

  // 4. implicit terrain-separation (frame-referenced only, default-ON)
  if (!ignoreTerrain && frame.originIndex !== undefined && frame.x !== undefined && frame.y !== undefined) {
    const reach = caches.reachability(frame.originIndex, frame.x, frame.y, habitat, false);
    if (reach) {
      predicates.push({ bucket: "spacingConflict", test: (i) => reach[i] !== UNREACHABLE });
    }
  }

  // 5. distance band min/max_distance_to_players
  const minDist = optionalNumAttr(cmd, "min_distance_to_players", 0);
  const maxDist = optionalNumAttr(cmd, "max_distance_to_players", 0);
  const circular = cmd.attributes.has("set_circular_placement");
  if (frame.x !== undefined && frame.y !== undefined) {
    if (minDist !== undefined || maxDist !== undefined) {
      const fx = frame.x;
      const fy = frame.y;
      predicates.push({
        bucket: "spacingConflict",
        test: (i) => {
          const x = i % dim;
          const y = (i - x) / dim;
          return distanceBandOk(x - fx, y - fy, circular, minDist, maxDist);
        },
      });
    }
  } else if (minDist !== undefined && playerOrigins.length > 0) {
    // frameless: min still applies (Sec.6.6), against EVERY player origin; max is inert.
    predicates.push({
      bucket: "spacingConflict",
      test: (i) => {
        const x = i % dim;
        const y = (i - x) / dim;
        return playerOrigins.every((o) => distanceBandOk(x - o.x, y - o.y, circular, minDist, undefined));
      },
    });
  }

  // 6. avoid_other_land_zones (frame-referenced only; inert frameless per guide's own "Requires:" list)
  if (frame.originIndex !== undefined && cmd.attributes.has("avoid_other_land_zones")) {
    const d = optionalNumAttr(cmd, "avoid_other_land_zones", 0) ?? 0;
    const landIndex = frame.originIndex;
    const edgeDist = caches.landEdgeDistance(landIndex);
    predicates.push({
      bucket: "zoneAvoidanceBlocked",
      test: (i) => grid.landId[i] === landIndex && (edgeDist[i] === UNREACHABLE || edgeDist[i] >= d),
    });
  }

  // 7. forest zone
  if (cmd.attributes.has("place_on_forest_zone") || cmd.attributes.has("avoid_forest_zone")) {
    if (cmd.attributes.has("place_on_forest_zone")) {
      const forest = caches.forestMask();
      predicates.push({ bucket: "spacingConflict", test: (i) => forest[i] !== 0 });
    } else {
      const d = optionalNumAttr(cmd, "avoid_forest_zone", DEFAULT_ZONE_AVOID_DISTANCE) ?? DEFAULT_ZONE_AVOID_DISTANCE;
      const dist = caches.forestDistance();
      predicates.push({ bucket: "spacingConflict", test: (i) => dist[i] === UNREACHABLE || dist[i] >= d });
    }
  }

  // 8. avoid_cliff_zone / min_distance_to_map_edge / max_distance_to_other_zones
  if (cmd.attributes.has("avoid_cliff_zone")) {
    const d = optionalNumAttr(cmd, "avoid_cliff_zone", DEFAULT_ZONE_AVOID_DISTANCE) ?? DEFAULT_ZONE_AVOID_DISTANCE;
    const dist = caches.cliffDistance();
    predicates.push({ bucket: "spacingConflict", test: (i) => dist[i] === UNREACHABLE || dist[i] >= d });
  }
  if (cmd.attributes.has("min_distance_to_map_edge")) {
    const d = numAttr(cmd, "min_distance_to_map_edge", 0, 0);
    predicates.push({
      bucket: "borderBlocked",
      test: (i) => {
        const x = i % dim;
        const y = (i - x) / dim;
        return x >= d && x < dim - d && y >= d && y < dim - d;
      },
    });
  }
  if (cmd.attributes.has("max_distance_to_other_zones") && (habitat === "land" || habitat === "water" || habitat === "amphibious")) {
    // **MINIMUM distance, despite the name — guide:2527 says so in its own
    // capitals: "Minimum (NOT maximum) distance, in tiles, that objects will
    // stay away from terrains that they are restricted from being placed on",
    // and guide:2528's example is "deep fish away from beaches".** This
    // shipped as `dist <= d`, a maximum, which is the reading the attribute's
    // NAME invites and the reason the guide shouts. It confined
    // `QS_Three_Bays_v1.1.rms`'s "tuna everywhere" command
    // (`max_distance_to_other_zones 4`, no terrain_to_place_on) to a 4-tile
    // ribbon along the shoreline instead of pushing it 4 tiles off the shore
    // into open sea — the exact inverse of what the line is for. Both halves
    // were inverted: UNREACHABLE means no restricted terrain exists anywhere,
    // so the constraint is vacuously satisfied and must PASS, not fail.
    //
    // The two sibling predicates immediately above (`avoid_forest_zone`,
    // `avoid_cliff_zone`) already carry the correct shape; this one sat
    // between them reading the other way.
    //
    // Sec.6.6: "inert for objects with no terrain restrictions at all" -- our
    // "any" fallback IS "no restrictions", so this only fires for the three
    // classes that name a real region. "shore" is excluded for a DIFFERENT
    // reason, and it is a judgment call rather than a reading of the guide: a
    // shore tile is adjacent to a beach by construction and a beach is
    // restricted terrain for it, so its distance is always 1 and any `d >= 2`
    // would place nothing at all. Whether the engine resolves that
    // contradiction by placing nothing or by ignoring the attribute is
    // unmeasured; no corpus command combines the two, so this picks the
    // outcome that is not silently empty and flags it here.
    const d = numAttr(cmd, "max_distance_to_other_zones", 0, 0);
    const dist = caches.restrictedDistance(habitat);
    if (dist) {
      predicates.push({ bucket: "spacingConflict", test: (i) => dist[i] === UNREACHABLE || dist[i] >= d });
    }
  }

  // 9. actor areas
  const placeInAttr = cmd.attributes.get("actor_area_to_place_in")?.[0];
  if (placeInAttr) {
    const id = placeInAttr.args[0]?.value;
    const areas = typeof id === "number" ? (liveActorAreas.get(id) ?? []) : [];
    if (areas.length === 0) return undefined; // actorAreaMissing -- command-level, caller handles it
    predicates.push({ bucket: "spacingConflict", test: (i) => areas.some((a) => withinSquareRadius(dim, i, a)) });
  }
  const avoidAttrs = cmd.attributes.get("avoid_actor_area") ?? [];
  if (avoidAttrs.length > 0) {
    const avoidAreas = avoidAttrs
      .map((a) => a.args[0]?.value)
      .filter((id): id is number => typeof id === "number")
      .flatMap((id) => liveActorAreas.get(id) ?? []);
    if (avoidAreas.length > 0) {
      predicates.push({ bucket: "spacingConflict", test: (i) => !avoidAreas.some((a) => withinSquareRadius(dim, i, a)) });
    }
  }

  // 10. require_path (dev always treated as 0 / "any path" -- see file header)
  if (cmd.attributes.has("require_path") && frame.originIndex !== undefined && frame.x !== undefined && frame.y !== undefined) {
    const reach = caches.reachability(frame.originIndex, frame.x, frame.y, habitat, true);
    if (reach) {
      predicates.push({ bucket: "pathBlocked", test: (i) => reach[i] !== UNREACHABLE });
    }
  }

  return predicates;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ObjectsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
  objects: PlacedObject[];
  players: PlayerMarker[];
}

// `min_distance_group_placement` used to be a plain array of accepted points
// re-scanned per candidate — O(placements^2) over a command, and the single
// largest cost in the whole preview on three corpus maps. `spacingIndex.ts`
// has the measurements and the replacement; the distance is fixed per
// command, which is exactly the shape a uniform grid wants.

type SelectionMode = "closest" | "center" | "edge" | "uniform";

function resolveSelectionMode(cmd: InstantiatedCommand): SelectionMode {
  if (cmd.attributes.has("find_closest")) return "closest";
  if (cmd.attributes.has("find_closest_to_map_center")) return "center";
  if (cmd.attributes.has("find_closest_to_map_edge")) return "edge";
  return "uniform";
}

function selectionKey(tile: number, mode: SelectionMode, dim: number, frame: ObjectFrame): number {
  const x = tile % dim;
  const y = (tile - x) / dim;
  if (mode === "edge") return Math.min(x, dim - 1 - x, y, dim - 1 - y);
  const targetX = mode === "closest" && frame.x !== undefined ? frame.x : Math.floor(dim / 2);
  const targetY = mode === "closest" && frame.y !== undefined ? frame.y : Math.floor(dim / 2);
  const dx = x - targetX;
  const dy = y - targetY;
  return dx * dx + dy * dy; // Euclidean, per Sec.6.6's own "unlike every other distance constraint here"
}

/**
 * A per-frame candidate pool, consumed as placements are made.
 *
 * PERFORMANCE (Sec.11): a naive "re-scan the whole pool for the best
 * candidate on every single pick" is O(placements x pool size) — fine for a
 * handful of objects, catastrophic for the corpus's own worst case
 * (`AK_Namatjira.rms` declares `number_of_groups 999999`, `TL Team
 * Acropolis.rms` declares `number_of_objects 65536`, both scripts also lean
 * on `find_closest*`). Two corpus maps timed out under this suite's own
 * corpus gate before this fix existed — found the same way terrains.ts's own
 * iteration-cap bug was found, by the corpus gate itself, not by review.
 *
 * The fix relies on monotonicity: occupancy only grows and spacing points
 * only accumulate during a command's run, so a tile rejected once (occupied
 * or too close to an existing point) can never become valid again later in
 * the SAME frame. That licenses removing it permanently rather than
 * re-testing it on a future pick:
 *   - uniform: swap-remove the tested tile out of `items` regardless of
 *     outcome, so every tile is visited AT MOST ONCE for the whole frame.
 *   - closest/center/edge: `items` is sorted once by the selection key, and
 *     `cursor` only moves forward — same "visited at most once" property,
 *     without needing a fresh best-of-pool scan per pick.
 * Total cost across a whole frame's worth of picks is O(pool log pool) (the
 * one-time sort) instead of O(picks x pool).
 *
 * BUILD COST IS ITS OWN PROBLEM, and it was the next bottleneck once the
 * per-pick cost was gone (measured 2026-08-07: 668 ms of `TL Team
 * Acropolis.rms`'s S6 was spent here, across 267 (command, frame) pairs).
 * A pool starts as up to `dim^2` survivors, so the ordered path's original
 * shape — map to 40,000 `{t, k}` objects, sort with a comparator, map back —
 * allocated three arrays and 40,000 short-lived objects per frame. Both are
 * now `Int32Array`/`Float64Array`, per Sec.11's "typed arrays only, no
 * per-tile objects", and the sort carries its key WITH the tile in one number
 * rather than in a parallel structure (see `buildCandidatePool`).
 */
interface CandidatePool {
  mode: SelectionMode;
  items: Int32Array;
  /** Live length for the uniform path's swap-remove; `items` itself is never resized. */
  count: number;
  cursor: number;
}

function buildCandidatePool(survivors: Int32Array, mode: SelectionMode, dim: number, frame: ObjectFrame): CandidatePool {
  const items = survivors.slice();
  if (mode === "uniform") return { mode, items, count: items.length, cursor: 0 };

  // Pack (key, tile) into one number and sort WITHOUT a comparator: a plain
  // numeric sort on a Float64Array is the engine's fast path, where a
  // comparator is a JS call per comparison. The packing is exact rather than
  // approximate — `key * dim^2 + tile` with `tile < dim^2` is invertible, and
  // the largest value it can reach (a squared distance under 2*dim^2, times
  // dim^2) is about 3.2e9 on a 200 map, comfortably inside a double's exact
  // integer range. Sorting by the packed value sorts by key first and by tile
  // second, so ties break deterministically by tile index — which the
  // comparator version did NOT guarantee (Array.prototype.sort's stability
  // preserved survivor order instead, the same order, so this is a
  // clarification rather than a behaviour change).
  const area = dim * dim;
  const packed = new Float64Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const tile = items[i];
    packed[i] = selectionKey(tile, mode, dim, frame) * area + tile;
  }
  packed.sort();
  for (let i = 0; i < packed.length; i++) items[i] = packed[i] % area;
  return { mode, items, count: items.length, cursor: 0 };
}

/** Consumes and returns the next valid tile from `pool`, or undefined once it is exhausted. See CandidatePool's own header for the amortized-O(1) argument. */
function takeFromPool(
  pool: CandidatePool,
  rng: Rng,
  dim: number,
  grid: TileGrid,
  forcePlacement: boolean,
  spacing: SpacingIndex,
): number | undefined {
  function isValid(tile: number): boolean {
    const x = tile % dim;
    const y = (tile - x) / dim;
    return (forcePlacement || grid.occupied[tile] === 0) && !spacing.tooClose(x, y);
  }

  if (pool.mode === "uniform") {
    while (pool.count > 0) {
      const idx = nextInt(rng, 0, pool.count - 1);
      const candidate = pool.items[idx];
      // Swap-remove by shrinking `count`, not by `pop()` — the backing array
      // is a typed array of fixed length, and the tail past `count` is simply
      // ignored.
      pool.count--;
      pool.items[idx] = pool.items[pool.count];
      if (isValid(candidate)) return candidate;
    }
    return undefined;
  }

  while (pool.cursor < pool.count) {
    const candidate = pool.items[pool.cursor];
    pool.cursor++;
    if (isValid(candidate)) return candidate;
  }
  return undefined;
}

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
 * Sec.6.6's measured grouping-scope rule: tight checks the ANCHOR against
 * every constraint, then flood-fills the rest via OCCUPANCY ALONE, in
 * whatever order the fill visits neighbours -- "a perfect square worth of
 * objects will be filled" is a claim about available tiles, not
 * constraint-valid ones (Test 8, preview-design Sec.6.6). Plain BFS from the
 * anchor naturally fills a diamond/square-ish shape when unconstrained,
 * which is the "arbitrary direction" the guide licenses rather than pins.
 */
function floodFillGroup(
  dim: number,
  anchor: number,
  target: number,
  occupied: Uint8Array,
  permitted: Uint8Array | undefined,
): number[] {
  const owned: number[] = [anchor];
  occupied[anchor] = 1;
  const queue: number[] = [anchor];
  let qi = 0;
  while (owned.length < target && qi < queue.length) {
    const tile = queue[qi++];
    for (const n of fourNeighbors(dim, tile)) {
      if (owned.length >= target) break;
      if (occupied[n] !== 0) continue;
      // `permitted` is the HABITAT mask only, and it is the single exception
      // to "the fill is unchecked". Test 8 measured that a tight group's
      // members skip the command's ATTRIBUTES -- spacing, distance bands,
      // actor areas -- and that stands untouched. The terrain table is not an
      // attribute: it is an engine-level restriction on where the object can
      // exist at all, which is why `ignore_terrain_restrictions` exists as a
      // separate opt-out. Without this a tight group of 7 GOLD anchored on
      // the coast spills into open water, which `AD4 - Pag - v1.2.rms` did
      // 13 times.
      if (permitted !== undefined && permitted[n] === 0) continue;
      occupied[n] = 1;
      owned.push(n);
      queue.push(n);
    }
  }
  return owned;
}

/**
 * Sec.6.6 end to end: `<OBJECTS_GENERATION>` -> PlacedObject[]/PlayerMarker[]
 * plus one CommandReport per `create_object` (Sec.7). Mutates
 * `grid.occupied`; does not otherwise touch the grid (objects sit ON the
 * generated terrain, never repaint it).
 */
export function applyObjects(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly ObjectConstant[],
  origins: readonly LandOrigin[],
  masterSeed: number,
): ObjectsResult {
  const commands = instantiated.sections.get("OBJECTS_GENERATION") ?? [];
  // The script's own `#const`s. Every reference-data lookup in this stage takes
  // them, because 216 of the 397 distinct object names the corpus writes are
  // script constants rather than DE ones — see `objectEntry`.
  const symbols = instantiated.symbols;
  const { dim } = grid;
  const playerOrigins = origins.filter((o) => o.player !== undefined);
  const players: PlayerMarker[] = playerOrigins.map((o) => ({ player: o.player!, x: o.x, y: o.y }));
  const caches = createObjectStageCaches(grid, constants);

  const liveActorAreas = new Map<number, Array<{ x: number; y: number; radius: number }>>();
  for (const [id, cmds] of instantiated.actorAreas) {
    const areas = cmds
      .map((c) => ({ x: c.args[0]?.value, y: c.args[1]?.value, radius: c.args[3]?.value }))
      .filter((a): a is { x: number; y: number; radius: number } => typeof a.x === "number" && typeof a.y === "number")
      .map((a) => ({ x: a.x, y: a.y, radius: typeof a.radius === "number" ? a.radius : 1 }));
    if (areas.length > 0) liveActorAreas.set(id, areas);
  }

  const reports: CommandReport[] = [];
  const notes: SimulationNote[] = [];
  const objects: PlacedObject[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S6", ordinal++);

  for (const cmd of commands) {
    if (cmd.name !== "create_object") continue;

    const typeName = typeof cmd.args[0]?.value === "string" ? cmd.args[0].value : undefined;
    const failures: PlacementFailure[] = [];
    if (typeName === undefined) {
      pushFailure(failures, { bucket: "noValidTiles", commandSpan: cmd.span, stage: "S6", entity: "object", detail: "This create_object command's type could not be resolved." });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    const groupCmd = instantiated.objectGroups.get(typeName);
    const isObjectGroup = groupCmd !== undefined;
    const members = groupCmd ? objectGroupMembers(groupCmd) : [typeName];
    if (members.length === 0) {
      pushFailure(failures, { bucket: "noValidTiles", commandSpan: cmd.span, stage: "S6", entity: typeName, detail: `Object group "${typeName}" has no valid add_object members.` });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    const { frames, kind: frameKind, missingLandId } = resolveObjectFrames(cmd, origins);
    if (missingLandId !== undefined) {
      pushFailure(failures, {
        bucket: "landMissing",
        commandSpan: cmd.span,
        stage: "S6",
        entity: typeName,
        detail: `No land declares land_id ${missingLandId}, so this placement has nowhere to go.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }
    if (frames.length === 0) {
      pushFailure(failures, { bucket: "landMissing", commandSpan: cmd.span, stage: "S6", entity: typeName, detail: "This command's reference frame matches no land." });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    const gaiaOnly = cmd.attributes.has("set_gaia_object_only");
    if (frameKind !== "none" && !isObjectGroup && !gaiaOnly && requiresGaiaOnly(typeName, constants, symbols)) {
      pushFailure(failures, {
        bucket: "gaiaOnlyRequired",
        commandSpan: cmd.span,
        stage: "S6",
        entity: typeName,
        detail: `${typeName} must be marked set_gaia_object_only to be placed for every player/on a specific land — without it the engine places nothing.`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    // guide:2509's own REQUIRES line, and the engine's answer when it is not
    // met is not "the restrictions apply after all" — the command places
    // NOTHING. Confirmed in game 2026-08-10 against `AK_Namatjira.rms`, whose
    // single `create_object SHORE_FISH` carries the flag with neither partner
    // attribute: no shore fish spawn on that map at all, where this preview
    // was drawing 232 of them.
    //
    // Read the ATTRIBUTE NAMES, not `frameKind`. `place_on_specific_land_id
    // -11` is "a random position on the map" (guide:2288) and resolves to the
    // frameless kind, but the author did write the attribute, which is what
    // the requirement is stated in terms of. Testing `frameKind !== "none"`
    // would silently empty those commands too.
    if (
      cmd.attributes.has("ignore_terrain_restrictions") &&
      !cmd.attributes.has("set_place_for_every_player") &&
      !cmd.attributes.has("place_on_specific_land_id")
    ) {
      pushFailure(failures, {
        bucket: "attributePrerequisite",
        commandSpan: cmd.span,
        stage: "S6",
        entity: typeName,
        detail: `ignore_terrain_restrictions requires set_place_for_every_player or place_on_specific_land_id in the same command — without one of them the engine places nothing at all (guide:2509).`,
      });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    const minDist = optionalNumAttr(cmd, "min_distance_to_players", 0);
    const maxDist = optionalNumAttr(cmd, "max_distance_to_players", 0);
    if (minDist !== undefined && maxDist !== undefined && minDist > maxDist) {
      pushFailure(failures, { bucket: "minExceedsMax", commandSpan: cmd.span, stage: "S6", entity: typeName, detail: `min_distance_to_players (${minDist}) exceeds max_distance_to_players (${maxDist}), so no tile can ever satisfy both.` });
      reports.push({ commandSpan: cmd.span, stage: "S6", attempted: 0, placed: 0, failures });
      continue;
    }

    if (WALL_NAME_PATTERN.test(typeName)) {
      notes.push({
        key: `wallNotSimulated:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S6",
        span: cmd.span,
        text: `${typeName} places as an ordinary object here — the engine's connected wall-segment behaviour is not simulated (Sec.9).`,
      });
    }
    // guide:2205: "Specify ANY object to be placed on top of the main object.
    // If you are placing multiple objects, each will get the specified second
    // object." Drawn as its own PlacedObject on the same tile since
    // 2026-08-07 — it used to be dropped with a note, and that note was
    // hiding most of the fish on the corpus's water maps. The placeholder
    // idiom is the reason: guide:2211 recommends `second_object` explicitly
    // as the way to "bypass terrain restrictions by using an invisible
    // placeholder object as the main object", so a script that wants fish in
    // an awkward spot places a PLACEHOLDER and hangs the fish off it. Dropping
    // the second object drops the only thing the author cared about —
    // `AD4 - Pag - v1.2.rms` came out with no fish at all, and
    // `Menindee_AUS_v2.3.rms` lost every pond fish, both of which read as the
    // fish failing to place rather than as a rendering omission.
    const secondObjectRef = typeof argValue(cmd, "second_object", 0) === "string" ? (argValue(cmd, "second_object", 0) as string) : undefined;
    if (secondObjectRef !== undefined) {
      notes.push({
        key: `secondObjectApproximated:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S6",
        span: cmd.span,
        text: `second_object places ${secondObjectRef} on the same tile as ${typeName}; the preview draws both, stacked, with no footprint modelling.`,
      });
    }
    if (frameKind !== "none" && !cmd.attributes.has("enable_tile_shuffling")) {
      notes.push({
        key: `deterministicPlacementLost:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S6",
        span: cmd.span,
        text: "Without enable_tile_shuffling the engine places deterministically (often used for herdables/villagers at a precise spot); this preview always shuffles, so the layout will differ.",
      });
    }
    if (cmd.attributes.has("require_path")) {
      notes.push({
        key: `requirePathApproximated:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S6",
        span: cmd.span,
        text: "require_path is approximated as 'any path exists' — its deviation argument could not be read from this map's reference data.",
      });
    }

    const grouped = isGrouped(cmd);
    const tight = grouped && isTightGrouping(cmd);
    const groupRadius = optionalNumAttr(cmd, "group_placement_radius", DEFAULT_GROUP_PLACEMENT_RADIUS) ?? DEFAULT_GROUP_PLACEMENT_RADIUS;
    const forcePlacement = cmd.attributes.has("force_placement") && !cmd.attributes.has("set_loose_grouping"); // guide:2739
    const ignoreTerrain = cmd.attributes.has("ignore_terrain_restrictions");
    const habitat = isObjectGroup ? "any" : objectHabitat(typeName, constants, symbols); // group commands: candidate filtering can't commit to one member's habitat (see file header)
    // A group's "any" is not data either — there is no single member to have a
    // row — so it takes the same deference `land` does.
    const habitatIsData = !isObjectGroup && objectHabitatIsDeclared(typeName, constants, symbols);
    const selectionMode = resolveSelectionMode(cmd);
    const spacingDistance = optionalNumAttr(cmd, "temp_min_distance_group_placement", 0) ?? optionalNumAttr(cmd, "min_distance_group_placement", 0);

    const { groupCount, perGroupBase, variance } = resolveObjectCounts(cmd, dim, players.length, grouped);
    const declaredTotal = grouped ? groupCount * perGroupBase : perGroupBase;
    let iterationCapped = false;

    const rng = nextSubstream();
    let attempted = 0;
    let placed = 0;
    // One index per command, matching the scope note in the file header
    // (simplification 6: this constraint is per-command, not per-run).
    const spacing = createSpacingIndex(dim, spacingDistance ?? 0, "chebyshev");

    frameLoop: for (const frame of frames) {
      const predicates = buildCandidatePredicates({ grid, constants, cmd, habitat, habitatIsData, frame, playerOrigins, forcePlacement, ignoreTerrain, liveActorAreas, caches, symbols });
      if (predicates === undefined) {
        const areaAttr = cmd.attributes.get("actor_area_to_place_in")?.[0];
        const id = areaAttr?.args[0]?.value;
        pushFailure(failures, {
          bucket: "actorAreaMissing",
          commandSpan: cmd.span,
          stage: "S6",
          entity: typeName,
          reference: frame.reference,
          detail: `actor_area_to_place_in references area ${typeof id === "number" ? id : "?"}, which no create_actor_area (or prior placement) has created.`,
        });
        continue;
      }

      const n = dim * dim;
      const scratch = new Int32Array(n);
      for (let i = 0; i < n; i++) scratch[i] = i;
      const baseResult = intersectCandidates(scratch, n, predicates);
      if (baseResult.count === 0) {
        attempted += declaredTotal;
        pushFailure(failures, {
          bucket: baseResult.failedBucket ?? "noValidTiles",
          commandSpan: cmd.span,
          stage: "S6",
          entity: typeName,
          reference: frame.reference,
          detail: `No tile satisfies every constraint on this placement${frame.reference ? ` for ${frame.reference}` : ""}.`,
        });
        continue;
      }
      const pool = buildCandidatePool(baseResult.survivors, selectionMode, dim, frame);
      // For loose grouping's "within group_placement_radius of the anchor"
      // query below — a fixed lookup built once from the full survivor set
      // (independent of `pool`, which `takeFromPool` consumes) so that query
      // can be a small local scan instead of a pool-wide filter.
      //
      // Built only when loose grouping will actually read it. Every other
      // command was paying a `dim^2` allocation and fill per frame for an
      // array nothing touched, and most commands are not loosely grouped.
      const needsCandidateLookup = grouped && !tight;
      const isCandidate = needsCandidateLookup ? new Uint8Array(n) : EMPTY_CANDIDATE_LOOKUP;
      if (needsCandidateLookup) {
        for (const t of baseResult.survivors) isCandidate[t] = 1;
      }

      function pickFree(): number | undefined {
        return takeFromPool(pool, rng, dim, grid, forcePlacement, spacing);
      }

      /** guide:2205: every placement of the main object gets one. Same tile, same owner. */
      function emitSecondObject(x: number, y: number, player: number | undefined, groupId: number | undefined): void {
        if (secondObjectRef === undefined) return;
        // NO habitat check here, and it is load-bearing rather than an
        // omission: guide:2211's placeholder idiom exists precisely to bypass
        // the second object's own terrain restriction, and since fish cannot
        // stand on a shallow this is the ONLY way they reach one. Adding a
        // check costs `Menindee_AUS_v2.3.rms` every pond fish, silently.
        objects.push({ objectRef: secondObjectRef, x, y, player, category: objectCategory(secondObjectRef, constants, symbols), groupId });
      }

      function commitPlacement(tile: number, groupId: number | undefined): void {
        const x = tile % dim;
        const y = (tile - x) / dim;
        if (!forcePlacement) grid.occupied[tile] = 1;
        spacing.add(x, y);
        const objectRef = members.length > 1 ? pickGroupMember(members, rng) : members[0];
        objects.push({ objectRef, x, y, player: frame.player, category: objectCategory(objectRef, constants, symbols), groupId });
        placed++;
        emitSecondObject(x, y, frame.player, groupId);
      }

      if (attempted + declaredTotal > MAX_OBJECT_PLACEMENTS_PER_COMMAND) {
        iterationCapped = true;
      }

      if (!grouped) {
        for (let k = 0; k < perGroupBase; k++) {
          if (attempted >= MAX_OBJECT_PLACEMENTS_PER_COMMAND) break frameLoop;
          attempted++;
          const tile = pickFree();
          if (tile === undefined) {
            pushFailure(failures, { bucket: "occupancyFull", commandSpan: cmd.span, stage: "S6", entity: typeName, reference: frame.reference, detail: `Ran out of free tiles for this placement.` });
            continue;
          }
          commitPlacement(tile, undefined);
        }
        continue;
      }

      for (let g = 0; g < groupCount; g++) {
        if (attempted >= MAX_OBJECT_PLACEMENTS_PER_COMMAND) break frameLoop;
        const target = variedGroupTarget(perGroupBase, variance, rng);
        attempted += target;
        const groupId = g;

        const anchor = pickFree();
        if (anchor === undefined) {
          pushFailure(failures, { bucket: "occupancyFull", commandSpan: cmd.span, stage: "S6", entity: `${typeName} group ${g + 1}`, reference: frame.reference, detail: `No free tile remains for this group's anchor.` });
          continue;
        }

        if (tight) {
          commitPlacement(anchor, groupId);
          if (target > 1) {
            const filled = floodFillGroup(dim, anchor, target, grid.occupied, caches.habitatMask(habitat, false, ignoreTerrain));
            for (const tile of filled.slice(1)) {
              const x = tile % dim;
              const y = (tile - x) / dim;
              const objectRef = members.length > 1 ? pickGroupMember(members, rng) : members[0];
              objects.push({ objectRef, x, y, player: frame.player, category: objectCategory(objectRef, constants, symbols), groupId });
              placed++;
              emitSecondObject(x, y, frame.player, groupId);
            }
            if (filled.length < target) {
              pushFailure(failures, {
                bucket: "groupPartial",
                commandSpan: cmd.span,
                stage: "S6",
                entity: `${typeName} group ${g + 1}`,
                reference: frame.reference,
                detail: `This group filled ${filled.length} of its ${target}-tile target before running out of adjacent free tiles.`,
                data: { placed: filled.length, requested: target },
              });
            }
          }
        } else {
          // loose: every member independently drawn from candidates within
          // group_placement_radius of the anchor (Chebyshev). Scanned as a
          // bounded LOCAL region against `isCandidate` rather than filtering
          // the whole pool -- group_placement_radius is typically small
          // (default 3) even when the pool or `target` is huge, so this
          // region scan is O(radius^2) per group, not O(pool size) (see
          // CandidatePool's own header for why that distinction is what
          // keeps this file off the corpus gate's timeout).
          commitPlacement(anchor, groupId);
          const anchorX = anchor % dim;
          const anchorY = (anchor - anchorX) / dim;
          const minX = Math.max(0, anchorX - groupRadius);
          const maxX = Math.min(dim - 1, anchorX + groupRadius);
          const minY = Math.max(0, anchorY - groupRadius);
          const maxY = Math.min(dim - 1, anchorY + groupRadius);
          const nearby: number[] = [];
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              const t = y * dim + x;
              if (t !== anchor && isCandidate[t] !== 0) nearby.push(t);
            }
          }
          let filledCount = 1;
          for (let m = 1; m < target && nearby.length > 0; m++) {
            const idx = nextInt(rng, 0, nearby.length - 1);
            const tile = nearby[idx];
            const last = nearby.length - 1;
            nearby[idx] = nearby[last];
            nearby.pop();
            const x = tile % dim;
            const y = (tile - x) / dim;
            if ((grid.occupied[tile] !== 0 && !forcePlacement) || spacing.tooClose(x, y)) continue;
            const objectRef = members.length > 1 ? pickGroupMember(members, rng) : members[0];
            if (!forcePlacement) grid.occupied[tile] = 1;
            spacing.add(x, y);
            objects.push({ objectRef, x, y, player: frame.player, category: objectCategory(objectRef, constants, symbols), groupId });
            placed++;
            filledCount++;
            emitSecondObject(x, y, frame.player, groupId);
          }
          if (filledCount < target) {
            pushFailure(failures, {
              bucket: "groupPartial",
              commandSpan: cmd.span,
              stage: "S6",
              entity: `${typeName} group ${g + 1}`,
              reference: frame.reference,
              detail: `This loose group placed ${filledCount} of its ${target}-member target within group_placement_radius ${groupRadius}.`,
              data: { placed: filledCount, requested: target },
            });
          }
        }
      }

      // Actor-area bookkeeping (file header note 5): one representative point per command, at its first successful placement this frame.
      if (cmd.attributes.has("actor_area") && placed > 0) {
        const idVal = argValue(cmd, "actor_area", 0);
        if (typeof idVal === "number") {
          const last = objects[objects.length - 1];
          const existing = liveActorAreas.get(idVal);
          const radius = optionalNumAttr(cmd, "actor_area_radius", 1) ?? existing?.[0]?.radius ?? 1;
          const area = { x: last.x, y: last.y, radius };
          if (existing) existing.push(area);
          else liveActorAreas.set(idVal, [area]);
        }
      }
    }

    if (iterationCapped) {
      pushFailure(failures, {
        bucket: "iterationCapped",
        commandSpan: cmd.span,
        stage: "S6",
        entity: typeName,
        detail: `This command asked for an extremely large number of placements — generation stopped at ${MAX_OBJECT_PLACEMENTS_PER_COMMAND} to stay inside the per-command work budget.`,
        data: { attempted, limit: MAX_OBJECT_PLACEMENTS_PER_COMMAND },
      });
      notes.push({ key: `objectIterationCapped:${cmd.span.start}`, prominence: "drawer", stage: "S6", span: cmd.span, text: `This create_object command asked for more placements than the preview safely generates at once — it stopped early rather than hang.` });
    }

    reports.push({ commandSpan: cmd.span, stage: "S6", attempted, placed, failures });
  }

  return { reports, notes, objects, players };
}
