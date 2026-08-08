// S1: land origin placement — docs/preview-design.md Sec.6.1. PURE (CLAUDE.md
// hard rule / preview-design Sec.2).
//
// SCOPE OF THIS FILE, STATED UP FRONT: origin placement and zone assignment
// only. It places every land's origin (and stamps its base square/circle
// onto the grid), but does NOT grow lands to their size targets or apply
// `base_elevation` — both are explicitly post-growth steps in Sec.6.1
// ("after growth, set elevation = H"), and growth's frontier-weight-bucket
// machinery (Sec.11) is a large enough piece of work to be its own file
// addition. `LandOrigin.declaredTargetTiles`/`behaviorVersion` carry what
// growth will need without this file guessing at the additive-vs-included
// adjustment it doesn't yet have a grower to apply.
//
// `assign_to`/`assign_to_player` ARE modelled (Sec.6.1's own sanctioned
// scope: AT_PLAYER/AT_COLOR/AT_TEAM with Mode, everything but Flags). A
// `create_land` carrying either takes a ring slot "like a player land"
// (guide:1016) rather than the neutral-land origin rule — which means
// origin placement needs the FULL ring membership (every create_player_lands
// occurrence's implicit N players, plus every successfully-resolved
// assign_to'd land) known before any of them can be placed, since they all
// share one ring. `placeLandOrigins` is therefore two passes: a single scan
// that resolves assignments, places neutral lands immediately (they don't
// depend on ring membership), and collects everything ring-eligible; then
// one ring-placement pass over the combined membership.
//
// NOT modelled: `Flags` (guide:1008-1012's "reset"/"don't remember"
// modifiers to the default remembering behaviour — the default itself IS
// modelled: an assign_to'd player is excluded from later AT_TEAM candidate
// pools). `AT_COLOR` resolves identically to `AT_PLAYER` (no colour
// assignment exists in the preview). Both get one `notSimulated` note each
// when they'd matter, per Sec.6.1's own text.

import type {
  BorderBounds,
  CommandReport,
  FailureBucket,
  InstantiatedArg,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  PlacementOutcome,
  SimulationNote,
  TileGrid,
} from "./types";
import type { CanonicalTeams } from "../../generationSettings/teamModel";
import { createSubstream, nextFloat01, nextInt, sinAt, cosAt, type Rng } from "./rng";
import { SINE_SCALE } from "./sineTable";
import { borderBounds, isWaterTerrain, resolveTerrainId, tileIndex, WATER_NAME_PATTERN, type TerrainConstantForMasks } from "./grid";
import { ok, fail, pushFailure } from "./placement";

// ---------------------------------------------------------------------------
// [tune] constants — each cites the measurement or the open question behind it.
// ---------------------------------------------------------------------------

/** No `circle_radius` at all (or `circle_radius 0`, which falls back here wholesale): MEASURED RMSTEST_24. */
const DEFAULT_RING_RADIUS_PCT = 40;
const DEFAULT_RING_VARIANCE_PCT = 10;
const DEFAULT_RING_JITTER_DEG = 7;

/** Sec.6.1: "reject candidates where both |x-center| and |y-center| exceed 0.35*(dim/2)" — MEASURED RMSTEST_25. */
const CROSS_SHAPE_COEFFICIENT = 0.35;

/** Sec.6.1: "K = 100 [tune] attempts" before falling back to map center. */
const ORIGIN_ATTEMPTS = 100;

/**
 * Negative `circle_radius`: MEASURED mean radius 0.276*dim, CV 0.44
 * (RMSTEST_27) — "neither obvious draw matches... start with a mixture,
 * weight [tune] fitted to CV 0.44." Both components share the SAME mean
 * (0.276*dim), so the mixture hits the mean for any weight; solving
 * `p*Var(disc) + (1-p)*Var(uniform) = (0.44*0.276*dim)^2` for the two
 * components' known variances gives p ~= 0.671 (worked in the build log —
 * this is exactly the "[tune], approximate" territory the spec itself
 * flags, not a second measurement).
 */
const SCATTERED_DISC_WEIGHT = 0.671;
const SCATTERED_DISC_RADIUS_PCT = 41.4; // uniform point IN this disc
const SCATTERED_UNIFORM_MAX_RADIUS_PCT = 55.2; // uniform RADIUS on [0, this]

/**
 * `grouped_by_team`'s intra-group member spacing: MEASURED 10-12 tiles at
 * 4v4 (base_size 3), "roughly 3.5-4*base_size" against guide:356's un-grown
 * 2*base_size. Sec.6.1 flags the caveat that this is centroid-of-grown-land
 * spacing, not origin spacing, and treats 3.5x as the working figure.
 */
const GROUP_MEMBER_SPACING_FACTOR = 3.5;

const DEFAULT_BASE_SIZE = 3;
const DEFAULT_BORDER_FUZZINESS = 20;
const DEFAULT_CLUMPING_FACTOR = 8;
const DEFAULT_OTHER_ZONE_AVOIDANCE = 0;

// ---------------------------------------------------------------------------
// Attribute reading — InstantiatedCommand.attributes is always folded to
// InstantiatedAttribute[] (Sec.3 rule 10); none of Sec.6.1's attributes are
// repeatable, so index [0] is always the one that survived folding.
// ---------------------------------------------------------------------------

function argValue(cmd: InstantiatedCommand, name: string, argIndex = 0): InstantiatedValue {
  const arg: InstantiatedArg | undefined = cmd.attributes.get(name)?.[0]?.args[argIndex];
  return arg?.value;
}

function numAttr(cmd: InstantiatedCommand, name: string, argIndex: number, fallback: number): number {
  const v = argValue(cmd, name, argIndex);
  return typeof v === "number" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Ring geometry
// ---------------------------------------------------------------------------

interface RingParams {
  /** "borderShifted" per the DEFAULT ring only; any explicit circle_radius (incl. negative) ignores borders for origin placement (Sec.6.1). */
  centerMode: "borderShifted" | "mapCenter";
  scattered: boolean;
  radiusPct: number;
  variancePct: number;
  jitterDeg: number;
}

function resolveRingParams(cmd: InstantiatedCommand): RingParams {
  const circleRadius = cmd.attributes.get("circle_radius")?.[0];
  if (!circleRadius) {
    return {
      centerMode: "borderShifted",
      scattered: false,
      radiusPct: DEFAULT_RING_RADIUS_PCT,
      variancePct: DEFAULT_RING_VARIANCE_PCT,
      jitterDeg: DEFAULT_RING_JITTER_DEG,
    };
  }
  const radiusPct = typeof circleRadius.args[0]?.value === "number" ? circleRadius.args[0].value : 0;
  if (radiusPct === 0) {
    // "0 disables circular positioning entirely... behaves EXACTLY as if the
    // attribute were absent" (guide:844, confirmed RMSTEST_2/5) — including
    // the border-shifted center, not just radius/variance/jitter.
    return {
      centerMode: "borderShifted",
      scattered: false,
      radiusPct: DEFAULT_RING_RADIUS_PCT,
      variancePct: DEFAULT_RING_VARIANCE_PCT,
      jitterDeg: DEFAULT_RING_JITTER_DEG,
    };
  }
  if (radiusPct < 0) {
    return { centerMode: "mapCenter", scattered: true, radiusPct: 0, variancePct: 0, jitterDeg: 0 };
  }
  // Explicit positive circle_radius: NO angular jitter — "three corpus maps
  // write a bare circle_radius with no variance and mean a perfect circle."
  const variancePct = typeof circleRadius.args[1]?.value === "number" ? circleRadius.args[1].value : 0;
  return { centerMode: "mapCenter", scattered: false, radiusPct, variancePct, jitterDeg: 0 };
}

function ringCenter(cmd: InstantiatedCommand, params: RingParams, dim: number): { x: number; y: number } {
  if (params.centerMode === "mapCenter") return { x: dim / 2, y: dim / 2 };
  const bounds = borderBounds(
    {
      left: numAttr(cmd, "left_border", 0, 0),
      right: numAttr(cmd, "right_border", 0, 0),
      top: numAttr(cmd, "top_border", 0, 0),
      bottom: numAttr(cmd, "bottom_border", 0, 0),
    },
    dim,
  );
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Angle in whole degrees -> a fixed-point unit vector via rng.ts's precomputed sine table (Sec.8: never Math.sin/cos). */
function angleUnit(deg: number): { cos: number; sin: number } {
  const d = ((Math.trunc(deg) % 360) + 360) % 360;
  return { cos: cosAt(d, 360) / SINE_SCALE, sin: sinAt(d, 360) / SINE_SCALE };
}

function pointOnRing(center: { x: number; y: number }, radiusTiles: number, deg: number): { x: number; y: number } {
  const { cos, sin } = angleUnit(deg);
  return { x: Math.round(center.x + radiusTiles * cos), y: Math.round(center.y + radiusTiles * sin) };
}

/**
 * Sec.6.1's scattered draw for negative `circle_radius`: a mixture of a
 * uniform point in a disc (no sqrt — sampled by Cartesian rejection, since
 * this module may not call Math.sqrt/pow, Sec.8) and a uniform radius at a
 * uniformly random angle. See the `SCATTERED_*` constants' comment for the
 * derivation.
 */
function scatteredPoint(rng: Rng, center: { x: number; y: number }, dim: number): { x: number; y: number } {
  if (nextFloat01(rng) < SCATTERED_DISC_WEIGHT) {
    const r = (SCATTERED_DISC_RADIUS_PCT / 100) * dim;
    for (let attempt = 0; attempt < 20; attempt++) {
      const dx = (nextFloat01(rng) * 2 - 1) * r;
      const dy = (nextFloat01(rng) * 2 - 1) * r;
      if (dx * dx + dy * dy <= r * r) return { x: Math.round(center.x + dx), y: Math.round(center.y + dy) };
    }
    return { x: Math.round(center.x), y: Math.round(center.y) }; // 20 rejections in a row: near enough to the center anyway
  }
  const radiusTiles = nextFloat01(rng) * (SCATTERED_UNIFORM_MAX_RADIUS_PCT / 100) * dim;
  const deg = nextInt(rng, 0, 359);
  return pointOnRing(center, radiusTiles, deg);
}

// ---------------------------------------------------------------------------
// Player-lands ring (create_player_lands, expanded to one origin per player)
// ---------------------------------------------------------------------------

interface RingSlot {
  player: number; // 1-based
  angleDeg: number;
}

/**
 * Evenly-spaced ring, OR (Sec.6.1, MEASURED RMSTEST_36) `grouped_by_team`'s
 * by-GROUP ring, where every un-teamed player is its own group of one.
 * Groups sit at evenly-spaced ring slots; members within a group cluster
 * around their slot at `GROUP_MEMBER_SPACING_FACTOR * baseSize` tiles apart
 * (converted from a tile spacing to an angle using the ring's own nominal
 * radius — arc length = radius x angle) rather than each taking a full ring
 * slot. Angular jitter is NOT applied within a group ("it would fight the
 * spacing the attribute exists to set").
 *
 * `referenceRadiusTiles` is the ring's NOMINAL radius (before per-player
 * variance), not each member's own jittered radius — variance still applies
 * per player afterward, but the group's own spacing is measured against one
 * stable reference length rather than one that moves per member.
 */
function ringSlots(
  playerCount: number,
  groupedByTeam: boolean,
  teams: CanonicalTeams,
  referenceRadiusTiles: number,
  baseSize: number,
): RingSlot[] {
  if (!groupedByTeam) {
    const slots: RingSlot[] = [];
    for (let p = 1; p <= playerCount; p++) slots.push({ player: p, angleDeg: (360 * (p - 1)) / playerCount });
    return slots;
  }

  const groups: number[][] = []; // each: 1-based player numbers
  const byTeam = new Map<number, number[]>();
  for (let p = 1; p <= playerCount; p++) {
    const team = teams.canonical[p - 1] ?? 0;
    if (team === 0) {
      groups.push([p]); // every un-teamed player is a group of one
    } else {
      const existing = byTeam.get(team);
      if (existing) existing.push(p);
      else byTeam.set(team, [p]);
    }
  }
  for (const members of byTeam.values()) groups.push(members);
  // Stable order: by each group's lowest player number, so the ring layout
  // doesn't depend on Map iteration order for the un-teamed singletons vs
  // team groups.
  groups.sort((a, b) => a[0] - b[0]);

  const memberSpacingTiles = GROUP_MEMBER_SPACING_FACTOR * baseSize;
  const spacingDeg = referenceRadiusTiles > 0 ? (memberSpacingTiles / referenceRadiusTiles) * (180 / Math.PI) : 0;

  const slots: RingSlot[] = [];
  const groupSlotDeg = 360 / groups.length;
  groups.forEach((members, groupIndex) => {
    const centerDeg = groupSlotDeg * groupIndex;
    members.forEach((player, i) => {
      const offset = (i - (members.length - 1) / 2) * spacingDeg;
      slots.push({ player, angleDeg: centerDeg + offset });
    });
  });
  return slots;
}

// ---------------------------------------------------------------------------
// Zone assignment (Sec.6.1)
// ---------------------------------------------------------------------------

function computeZone(
  cmd: InstantiatedCommand,
  defaultZone: number,
  teams: CanonicalTeams,
  playerCount: number,
  rng: Rng,
): number {
  if (cmd.attributes.has("zone")) return numAttr(cmd, "zone", 0, defaultZone);
  if (cmd.attributes.has("set_zone_by_team")) {
    // guide:1055's footgun, deliberately emulated: this ALWAYS reads player
    // 1's canonical team, regardless of whose land it is.
    const player1Team = teams.canonical[0] ?? 0;
    return player1Team - 9;
  }
  if (cmd.attributes.has("set_zone_randomly")) {
    return nextInt(rng, -8, playerCount - 9); // guide:1071's stated range
  }
  return defaultZone;
}

// ---------------------------------------------------------------------------
// Origin stamp: square (or inscribed circle) of radius base_size, written
// onto the grid. Later stamps overwrite earlier ones by processing origins
// in placement order and simply writing over whatever is there — "the land
// placed last will be the one visible" (guide).
// ---------------------------------------------------------------------------

function stampOrigin(grid: TileGrid, originIndex: number, origin: LandOrigin): void {
  const { dim } = grid;
  const r = origin.baseSize;
  const minX = Math.max(0, Math.floor(origin.x - r));
  const maxX = Math.min(dim - 1, Math.ceil(origin.x + r));
  const minY = Math.max(0, Math.floor(origin.y - r));
  const maxY = Math.min(dim - 1, Math.ceil(origin.y + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (origin.circularBase) {
        const dx = x - origin.x;
        const dy = y - origin.y;
        if (dx * dx + dy * dy > r * r) continue;
      }
      const i = tileIndex(grid, x, y);
      grid.landId[i] = originIndex;
      grid.zone[i] = origin.zone;
    }
  }
}

// ---------------------------------------------------------------------------
// Neutral (unassigned) create_land origin
// ---------------------------------------------------------------------------

function neutralOrigin(
  cmd: InstantiatedCommand,
  grid: TileGrid,
  priorOrigins: readonly LandOrigin[],
  rng: Rng,
): PlacementOutcome<{ x: number; y: number }> {
  const { dim } = grid;
  const landPositionAttr = cmd.attributes.get("land_position")?.[0];
  if (landPositionAttr) {
    const px = typeof landPositionAttr.args[0]?.value === "number" ? landPositionAttr.args[0].value : 50;
    const py = typeof landPositionAttr.args[1]?.value === "number" ? landPositionAttr.args[1].value : 50;
    // Sec.4: round, THEN clamp to [0, dim-1] — the Michi.rms land_position 100 100 fix.
    const x = Math.max(0, Math.min(dim - 1, Math.round((px / 100) * dim)));
    const y = Math.max(0, Math.min(dim - 1, Math.round((py / 100) * dim)));
    return ok({ x, y });
  }

  const bounds = borderBounds(
    {
      left: numAttr(cmd, "left_border", 0, 0),
      right: numAttr(cmd, "right_border", 0, 0),
      top: numAttr(cmd, "top_border", 0, 0),
      bottom: numAttr(cmd, "bottom_border", 0, 0),
    },
    dim,
  );
  const minX = Math.max(0, bounds.minX);
  const maxX = Math.min(dim - 1, bounds.maxX - 1);
  const minY = Math.max(0, bounds.minY);
  const maxY = Math.min(dim - 1, bounds.maxY - 1);
  if (minX > maxX || minY > maxY) {
    return fail({
      bucket: "originFallbackCenter",
      commandSpan: cmd.span,
      stage: "S1",
      entity: "land",
      detail: "The border settings leave no valid area to place this land's origin, so it was placed at the map center instead.",
    });
  }

  const baseSize = numAttr(cmd, "base_size", 0, DEFAULT_BASE_SIZE);
  const generateMode = numAttr(cmd, "generate_mode", 0, 0);
  const crossHalf = CROSS_SHAPE_COEFFICIENT * (dim / 2);
  const centerX = dim / 2;
  const centerY = dim / 2;
  const minPlacementDistance = numAttr(
    cmd,
    "min_placement_distance",
    0,
    numAttr(cmd, "other_zone_avoidance_distance", 0, DEFAULT_OTHER_ZONE_AVOIDANCE),
  );

  for (let attempt = 0; attempt < ORIGIN_ATTEMPTS; attempt++) {
    const x = nextInt(rng, minX, maxX);
    const y = nextInt(rng, minY, maxY);
    if (generateMode !== 1 && Math.abs(x - centerX) > crossHalf && Math.abs(y - centerY) > crossHalf) continue; // corner, rejected
    if (x < baseSize || x > dim - 1 - baseSize || y < baseSize || y > dim - 1 - baseSize) continue; // too close to the true map edge
    let tooClose = false;
    for (const prior of priorOrigins) {
      const dx = x - prior.x;
      const dy = y - prior.y;
      if (dx * dx + dy * dy < minPlacementDistance * minPlacementDistance) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    return ok({ x, y });
  }

  return fail({
    bucket: "originFallbackCenter",
    commandSpan: cmd.span,
    stage: "S1",
    entity: "land",
    detail: `Could not find a valid spot for this land after ${ORIGIN_ATTEMPTS} attempts, so it was placed at the map center, overlapping whatever is there.`,
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface LandPlacementResult {
  origins: LandOrigin[];
  reports: CommandReport[];
  notes: SimulationNote[];
}

function commonFields(
  cmd: InstantiatedCommand,
  dim: number,
  constants: readonly TerrainConstantForMasks[],
  symbols: ReadonlyMap<string, number>,
): {
  baseSize: number;
  circularBase: boolean;
  terrainType?: string | number;
  terrainId?: number;
  baseElevation?: number;
  clumpingFactor: number;
  borderFuzziness: number;
  otherZoneAvoidanceDistance: number;
  minPlacementDistance: number;
  declaredLandId?: number;
  borderBounds: BorderBounds;
  generateMode: number;
} {
  const terrainTypeValue = argValue(cmd, "terrain_type", 0);
  const baseElevationValue = argValue(cmd, "base_elevation", 0);
  const declaredLandIdValue = argValue(cmd, "land_id", 0);
  const otherZoneAvoidance = numAttr(cmd, "other_zone_avoidance_distance", 0, DEFAULT_OTHER_ZONE_AVOIDANCE);
  return {
    baseSize: numAttr(cmd, "base_size", 0, DEFAULT_BASE_SIZE),
    circularBase: cmd.attributes.has("set_circular_base"),
    terrainType: typeof terrainTypeValue === "string" || typeof terrainTypeValue === "number" ? terrainTypeValue : undefined,
    terrainId: resolveTerrainId(constants, terrainTypeValue, symbols),
    baseElevation: typeof baseElevationValue === "number" ? baseElevationValue : undefined,
    clumpingFactor: numAttr(cmd, "clumping_factor", 0, DEFAULT_CLUMPING_FACTOR),
    borderFuzziness: numAttr(cmd, "border_fuzziness", 0, DEFAULT_BORDER_FUZZINESS),
    otherZoneAvoidanceDistance: otherZoneAvoidance,
    minPlacementDistance: numAttr(cmd, "min_placement_distance", 0, otherZoneAvoidance),
    declaredLandId: typeof declaredLandIdValue === "number" ? declaredLandIdValue : undefined,
    borderBounds: borderBounds(
      {
        left: numAttr(cmd, "left_border", 0, 0),
        right: numAttr(cmd, "right_border", 0, 0),
        top: numAttr(cmd, "top_border", 0, 0),
        bottom: numAttr(cmd, "bottom_border", 0, 0),
      },
      dim,
    ),
    generateMode: numAttr(cmd, "generate_mode", 0, 0),
  };
}

/** Sec.6.1's size-target rule, before the (not-yet-built) growth phase's additive/included adjustment. */
function declaredTargetTiles(cmd: InstantiatedCommand, dim: number, perPlayerDivisor: number): number {
  const explicitTiles = argValue(cmd, "number_of_tiles", 0);
  if (typeof explicitTiles === "number") return explicitTiles / perPlayerDivisor;
  const percent = numAttr(cmd, "land_percent", 0, 100); // default 100 (Sec.6.1)
  return ((percent / 100) * dim * dim) / perPlayerDivisor;
}

// ---------------------------------------------------------------------------
// assign_to / assign_to_player (Sec.6.1)
// ---------------------------------------------------------------------------

/** A `create_land` whose `assign_to`/`assign_to_player` resolved to a real, currently-playing player — awaiting a ring slot alongside `create_player_lands`'s implicit ones. */
interface RingExtra {
  cmd: InstantiatedCommand;
  player: number;
}

interface AssignmentResolution {
  /** undefined = "not created" (guide:1015: non-playing target, or an AT_TEAM domain with no eligible player left). */
  player: number | undefined;
  colorNoted: boolean;
  flagsNoted: boolean;
}

/**
 * Resolves one `assign_to`/`assign_to_player` command to a player number.
 * `assignedPlayers` is the running "already given a land via assign_to"
 * set (guide:1008's default remembering behaviour, which Flags can override
 * but this doesn't model) — AT_TEAM's candidate pool excludes it, and a
 * successful resolution here is the caller's job to add to it, not this
 * function's, since a caller that ends up NOT creating the land (e.g. it
 * turned out to belong to a ring that can't take it) should not have
 * consumed the player.
 */
function resolveAssignment(
  cmd: InstantiatedCommand,
  playerCount: number,
  teams: CanonicalTeams,
  assignedPlayers: ReadonlySet<number>,
  rng: Rng,
): AssignmentResolution {
  const assignTo = cmd.attributes.get("assign_to")?.[0];
  if (assignTo) {
    const target = assignTo.args[0]?.value;
    const number = assignTo.args[1]?.value;
    const mode = assignTo.args[2]?.value;
    const flags = assignTo.args[3]?.value;
    const flagsNoted = typeof flags === "number" && flags !== 0;

    if (target === "AT_PLAYER" || target === "AT_COLOR") {
      const n = typeof number === "number" ? number : undefined;
      const player = n !== undefined && n >= 1 && n <= playerCount ? n : undefined;
      return { player, colorNoted: target === "AT_COLOR", flagsNoted };
    }
    if (target === "AT_TEAM") {
      const n = typeof number === "number" ? number : undefined;
      if (n === undefined) return { player: undefined, colorNoted: false, flagsNoted };
      const candidates: number[] = [];
      for (let p = 1; p <= playerCount; p++) {
        if (assignedPlayers.has(p)) continue;
        const team = teams.canonical[p - 1] ?? 0;
        // guide:1002-1003: n>0 -> that team; 0 -> un-teamed; negative
        // (except -10) -> NOT team |n|; -10 -> any player.
        const matches = n === -10 ? true : n === 0 ? team === 0 : n > 0 ? team === n : team !== -n;
        if (matches) candidates.push(p);
      }
      if (candidates.length === 0) return { player: undefined, colorNoted: false, flagsNoted };
      const modeNum = typeof mode === "number" ? mode : -1;
      // candidates is already built in ascending player order, so [0] IS lobby order.
      const player = modeNum === 0 ? candidates[nextInt(rng, 0, candidates.length - 1)] : candidates[0];
      return { player, colorNoted: false, flagsNoted };
    }
    return { player: undefined, colorNoted: false, flagsNoted }; // unrecognized AssignTarget word
  }

  const assignToPlayer = cmd.attributes.get("assign_to_player")?.[0];
  if (assignToPlayer) {
    const n = assignToPlayer.args[0]?.value;
    const player = typeof n === "number" && n >= 1 && n <= playerCount ? n : undefined;
    return { player, colorNoted: false, flagsNoted: false };
  }

  return { player: undefined, colorNoted: false, flagsNoted: false }; // not actually an assigned command
}

interface CombinedRingSlot {
  /** Which command's attributes govern this land's non-geometric fields (zone, base_size, clumping_factor, ...). */
  cmd: InstantiatedCommand;
  player: number;
  angleDeg: number;
  /** guide:857's engine bug: extra player-land positions under grouped_by_team "do not generate properly" — placed degenerately rather than a working position the real engine doesn't have. */
  buggy: boolean;
}

/**
 * The full ring membership: every `create_player_lands` occurrence's
 * implicit `playerCount` players, plus every successfully-resolved
 * `assign_to`'d extra — Sec.6.1: an assigned land "takes a ring slot, like
 * a player land." Non-grouped: everyone gets a real, evenly-spaced slot on
 * ONE shared ring (implicit slots first, then extras in file order).
 * Grouped: the implicit slots keep the existing by-team clustering
 * unchanged, and every extra hits guide:857's bug instead of a ring slot.
 */
function combinedRingSlots(
  playerCount: number,
  playerLandsCommands: readonly InstantiatedCommand[],
  extras: readonly RingExtra[],
  groupedByTeam: boolean,
  teams: CanonicalTeams,
  referenceRadiusTiles: number,
  baseSize: number,
): CombinedRingSlot[] {
  const base = playerCount > 0 ? ringSlots(playerCount, groupedByTeam, teams, referenceRadiusTiles, baseSize) : [];

  if (groupedByTeam) {
    const implicit: CombinedRingSlot[] = [];
    for (const cmd of playerLandsCommands) {
      for (const slot of base) implicit.push({ cmd, player: slot.player, angleDeg: slot.angleDeg, buggy: false });
    }
    const buggyExtras: CombinedRingSlot[] = extras.map((m) => ({ cmd: m.cmd, player: m.player, angleDeg: 0, buggy: true }));
    return [...implicit, ...buggyExtras];
  }

  const implicitCount = playerLandsCommands.length * playerCount;
  const total = implicitCount + extras.length;
  if (total === 0) return [];
  const slots: CombinedRingSlot[] = [];
  let i = 0;
  for (const cmd of playerLandsCommands) {
    for (const slot of base) {
      slots.push({ cmd, player: slot.player, angleDeg: (360 * i) / total, buggy: false });
      i++;
    }
  }
  for (const extra of extras) {
    slots.push({ cmd: extra.cmd, player: extra.player, angleDeg: (360 * i) / total, buggy: false });
    i++;
  }
  return slots;
}

/**
 * Sec.6.1: AST -> placed land origins. Mutates `grid` (writes origin stamps
 * to `landId`/`zone`); returns the per-land records growth will extend and
 * one `CommandReport` per instantiated `create_land`/`create_player_lands`
 * (Sec.7: unconditional, one per generative command).
 */
export function placeLandOrigins(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  masterSeed: number,
): LandPlacementResult {
  const commands = instantiated.sections.get("LAND_GENERATION") ?? [];
  const origins: LandOrigin[] = [];
  const reports: CommandReport[] = [];
  const notes: SimulationNote[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S1", ordinal++);

  const { teams, playerSetup } = instantiated;
  // CanonicalTeams.canonical is length playerCount exactly (teamModel.ts),
  // so this is the count without threading a second parameter through.
  const playerCount = teams.canonical.length;

  function pushOrigin(
    cmd: InstantiatedCommand,
    x: number,
    y: number,
    zone: number,
    player: number | undefined,
    perPlayerDivisor: number,
    fromFallback: boolean,
  ): number {
    const fields = commonFields(cmd, grid.dim, constants, instantiated.symbols);
    const origin: LandOrigin = {
      commandSpan: cmd.span,
      x,
      y,
      zone,
      declaredLandId: fields.declaredLandId,
      player,
      baseSize: fields.baseSize,
      circularBase: fields.circularBase,
      terrainType: fields.terrainType,
      terrainId: fields.terrainId,
      baseElevation: fields.baseElevation,
      clumpingFactor: fields.clumpingFactor,
      borderFuzziness: fields.borderFuzziness,
      otherZoneAvoidanceDistance: fields.otherZoneAvoidanceDistance,
      minPlacementDistance: fields.minPlacementDistance,
      behaviorVersion: cmd.behaviorVersion,
      declaredTargetTiles: declaredTargetTiles(cmd, grid.dim, perPlayerDivisor),
      fromOriginFallback: fromFallback,
      borderBounds: fields.borderBounds,
      generateMode: fields.generateMode,
    };
    const index = origins.length;
    origins.push(origin);
    stampOrigin(grid, index, origin);
    return index;
  }

  // Pass 1: one scan. Neutral lands are placed immediately (they don't
  // depend on ring membership); create_player_lands occurrences and
  // resolved assign_to'd extras are only COLLECTED here, since every
  // ring-eligible land has to be known before any of them can be placed
  // (they all share one ring).
  const playerLandsCommands: InstantiatedCommand[] = [];
  const ringExtras: RingExtra[] = [];
  const assignedPlayers = new Set<number>();
  const reportByCmd = new Map<InstantiatedCommand, { attempted: number; placed: number; failures: PlacementFailure[] }>();

  function reportFor(cmd: InstantiatedCommand): { attempted: number; placed: number; failures: PlacementFailure[] } {
    let entry = reportByCmd.get(cmd);
    if (!entry) {
      entry = { attempted: 0, placed: 0, failures: [] };
      reportByCmd.set(cmd, entry);
    }
    return entry;
  }

  for (const cmd of commands) {
    if (cmd.name === "create_player_lands") {
      playerLandsCommands.push(cmd);
      reportFor(cmd).attempted += playerCount;
      continue;
    }

    if (cmd.name !== "create_land") continue;

    const isAssigned = cmd.attributes.has("assign_to") || cmd.attributes.has("assign_to_player");
    if (isAssigned) {
      const rng = nextSubstream();
      const resolution = resolveAssignment(cmd, playerCount, teams, assignedPlayers, rng);
      if (resolution.colorNoted) {
        notes.push({
          key: `atColor:${cmd.span.start}`,
          prominence: "drawer",
          stage: "S1",
          span: cmd.span,
          text: "AT_COLOR is treated the same as AT_PLAYER — the preview doesn't model colour assignment separately, so this may differ from a real lobby.",
        });
      }
      if (resolution.flagsNoted) {
        notes.push({
          key: `assignFlags:${cmd.span.start}`,
          prominence: "drawer",
          stage: "S1",
          span: cmd.span,
          text: "assign_to's Flags argument isn't modelled — a later assign_to command may pick a different player than in a real game.",
        });
      }
      const report = reportFor(cmd);
      report.attempted += 1;
      if (resolution.player === undefined) {
        notes.push({
          key: `landNotCreated:${cmd.span.start}`,
          prominence: "drawer",
          stage: "S1",
          span: cmd.span,
          text: "This land targets a player who isn't in the current lobby size (or no eligible team-mate is left to assign), so the engine doesn't create it.",
        });
        continue; // guide:1015: not created — no origin, placed stays 0
      }
      assignedPlayers.add(resolution.player);
      ringExtras.push({ cmd, player: resolution.player });
      continue;
    }

    // Neutral land: unaffected by ring membership, placed immediately.
    const rng = nextSubstream();
    const result = neutralOrigin(cmd, grid, origins, rng);
    const report = reportFor(cmd);
    report.attempted += 1;
    let point: { x: number; y: number };
    if (result.ok) {
      point = result.value;
    } else {
      point = { x: Math.round(grid.dim / 2), y: Math.round(grid.dim / 2) };
      pushFailure(report.failures, result.failure);
    }
    const zone = computeZone(cmd, -10, teams, playerCount, rng);
    pushOrigin(cmd, point.x, point.y, zone, undefined, 1, !result.ok);
    report.placed += 1;
  }

  // Pass 2: place the combined ring (every create_player_lands occurrence's
  // implicit playerCount slots, plus every resolved assign_to'd extra).
  if (playerLandsCommands.length > 0 || ringExtras.length > 0) {
    // Ring geometry comes from the LAST create_player_lands occurrence
    // (existing "only the final radius applies" precedent, guide:856) — an
    // assign_to'd extra never redefines the shared ring, it only takes a
    // slot on it. With no create_player_lands at all (only standalone
    // assign_to'd lands), fall back to the same defaults the no-attribute
    // ring branch uses.
    const ringGoverningCmd = playerLandsCommands[playerLandsCommands.length - 1];
    const ringParams: RingParams = ringGoverningCmd
      ? resolveRingParams(ringGoverningCmd)
      : {
          centerMode: "mapCenter",
          scattered: false,
          radiusPct: DEFAULT_RING_RADIUS_PCT,
          variancePct: DEFAULT_RING_VARIANCE_PCT,
          jitterDeg: DEFAULT_RING_JITTER_DEG,
        };
    const center = ringGoverningCmd
      ? ringCenter(ringGoverningCmd, ringParams, grid.dim)
      : { x: grid.dim / 2, y: grid.dim / 2 };
    const rotationOffset = nextInt(nextSubstream(), 0, 359);
    const nominalRadiusTiles = (ringParams.radiusPct / 100) * grid.dim;
    const baseSizeForSpacing = ringGoverningCmd ? numAttr(ringGoverningCmd, "base_size", 0, DEFAULT_BASE_SIZE) : DEFAULT_BASE_SIZE;
    const slots = combinedRingSlots(
      playerCount,
      playerLandsCommands,
      ringExtras,
      playerSetup.groupedByTeam,
      teams,
      nominalRadiusTiles,
      baseSizeForSpacing,
    );

    for (const slot of slots) {
      const rng = nextSubstream();
      let point: { x: number; y: number };
      if (playerSetup.directPlacement && slot.cmd.attributes.has("land_position")) {
        // guide:367: direct_placement disables the ring (and, with it,
        // guide:857's grouped_by_team bug) entirely — checked first.
        const px = numAttr(slot.cmd, "land_position", 0, 50);
        const py = numAttr(slot.cmd, "land_position", 1, 50);
        point = { x: Math.round((px / 100) * grid.dim), y: Math.round((py / 100) * grid.dim) };
      } else if (slot.buggy) {
        point = { x: Math.round(grid.dim / 2), y: Math.round(grid.dim / 2) };
      } else if (ringParams.scattered) {
        point = scatteredPoint(rng, center, grid.dim);
      } else {
        const radiusPct = ringParams.radiusPct + (ringParams.variancePct === 0 ? 0 : nextInt(rng, -ringParams.variancePct, ringParams.variancePct));
        const radiusTiles = (radiusPct / 100) * grid.dim;
        const jitter = ringParams.jitterDeg === 0 ? 0 : nextInt(rng, -ringParams.jitterDeg, ringParams.jitterDeg);
        point = pointOnRing(center, radiusTiles, slot.angleDeg + rotationOffset + jitter);
      }
      const x = Math.max(0, Math.min(grid.dim - 1, point.x));
      const y = Math.max(0, Math.min(grid.dim - 1, point.y));
      const zone = computeZone(slot.cmd, slot.player - 10, teams, playerCount, rng);
      const perPlayerDivisor = playerLandsCommands.includes(slot.cmd) ? playerCount : 1;
      pushOrigin(slot.cmd, x, y, zone, slot.player, perPlayerDivisor, slot.buggy);
      const report = reportFor(slot.cmd);
      report.placed += 1;
      if (slot.buggy) {
        pushFailure(report.failures, {
          bucket: "notSimulated",
          commandSpan: slot.cmd.span,
          stage: "S1",
          entity: `player ${slot.player}'s land`,
          detail: "grouped_by_team doesn't correctly place a player's additional land (guide:857's documented engine bug) — this preview places it at the map center rather than inventing a working position the real engine doesn't produce.",
        });
      }
    }
  }

  for (const [cmd, entry] of reportByCmd) {
    reports.push({ commandSpan: cmd.span, stage: "S1", attempted: entry.attempted, placed: entry.placed, failures: entry.failures });
  }

  return { origins, reports, notes };
}

// ---------------------------------------------------------------------------
// Growth (Sec.6.1's "Growth — synchronized frontier expansion").
//
// All lands grow in round-robin turns, one tile per unfinished land per
// round (approximates "growth happens all at once"). Per turn a land either
// draws from its detached-seed reservoir (cf-dependent fragmentation, MEASURED
// RMSTEST_38) or samples its frontier by weight (guide:927's clumping
// regimes, MEASURED RMSTEST_21). Every drawn candidate is then checked
// against Sec.6.1's three rejection rules — border, zone avoidance, already
// owned — and a rejected candidate is simply gone (never re-offered): all
// three rejection reasons are static with respect to a fixed grid state, so
// a candidate rejected once can never become acceptable later, and dropping
// it permanently is the O(1)-friendly reading of "no sorting, no
// re-weighting" (Sec.11), not a shortcut around it.
//
// PERFORMANCE NOTE, flagged rather than silently accepted: Sec.11 asks for
// the frontier as Int32Array buckets with membership tracked in a
// Uint8Array. This implementation uses plain arrays and a Set instead —
// behaviourally identical (same draws, same distribution), but without
// Sec.11's O(1)-guaranteed-by-construction data structures. No benchmark
// gate exists yet to measure against (Sec.11's own gate isn't built), so
// this session prioritised the algorithm's correctness over its constant
// factor; revisit once a benchmark exists to justify the rewrite.
// ---------------------------------------------------------------------------

/** Sec.11: "growth rounds capped at 4*dim^2 total steps per command [tune]". */
const STEP_CAP_FACTOR = 4;

/**
 * cf >= 0: weight(k) = 1 + steepness*(k-1) for neighborsOwned k in [1,4],
 * steepness ramping 0..MAX_STEEPNESS as cf ramps 0..15 then flat (Sec.6.1:
 * "steepness ramping with cf and saturating by cf ~ 15"). At cf=0 every
 * bucket is weight 1 (uniform draw -> "more irregular"); as cf rises,
 * higher-neighborsOwned candidates (infill) are increasingly favoured over
 * frontier-edge ones -> rounder lands. [tune]: no measurement pins the
 * magnitude, only the qualitative shape (Sec.6.1's own table), so this
 * picks a value giving real differentiation without being extreme.
 */
const MAX_STEEPNESS = 3;

/** cf < 0: "strongly favour neighborsOwned == 1" (snakey growth). Not literally 0 so a land isn't stuck if bucket 1 empties first. */
const NEGATIVE_REGIME_WEIGHTS: readonly [number, number, number, number] = [1, 0.05, 0.05, 0.05];

/**
 * Detached-seed reservoir size, MEASURED RMSTEST_38's piece-count column:
 * 6-10 pieces at cf -20, 1-5 at cf 0, 1-2 at cf 8 (default), a hard 1 by
 * cf >= 20. Piece count is 1 (the origin) + however many reservoir seeds
 * actually get drawn before the reservoir empties — and since a land's
 * turn count (its tile target) is normally far larger than a small
 * reservoir, virtually every reservoir tile DOES eventually get drawn as
 * long as the per-turn draw probability isn't tiny. That makes R(cf), not
 * w(cf), the dominant knob for final piece count; RESERVOIR_DRAW_PROBABILITY
 * below is a fixed "how eagerly is the reservoir spent" constant instead.
 * Sec.6.1 licenses this explicitly: "what is measured is the piece-count
 * column, and any mechanism reproducing it is admissible."
 */
/** Exported for direct unit testing — see the build log for why: reservoir effects and weight-bucket effects are entangled at every `clumpingFactor < 20` through the full growth pipeline, since reservoirSize is also non-zero there. */
export function reservoirSize(clumpingFactor: number): number {
  if (clumpingFactor >= 20) return 0;
  return Math.round(clampNum((7 * (20 - clumpingFactor)) / 40, 0, 7));
}

/** [tune], see reservoirSize's comment: fixed, since R(cf) carries the cf-dependence the spec asks for. */
const RESERVOIR_DRAW_PROBABILITY = 0.15;

/**
 * How far a detached seed may land from its land's origin — `[tune]`, and see
 * `sampleReservoir` for why it is bounded at all. A fraction of `dim` so it
 * scales with the map; the floor keeps it meaningful on a Tiny map.
 */
const RESERVOIR_RADIUS_OF_DIM = 0.12;
const RESERVOIR_MIN_RADIUS = 12;

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Exported for direct unit testing — see reservoirSize's comment just above. */
export function bucketWeights(clumpingFactor: number): readonly [number, number, number, number] {
  if (clumpingFactor < 0) return NEGATIVE_REGIME_WEIGHTS;
  const steepness = (Math.min(clumpingFactor, 15) / 15) * MAX_STEEPNESS;
  return [1, 1 + steepness, 1 + 2 * steepness, 1 + 3 * steepness];
}

function fourNeighbors(grid: TileGrid, tile: number): number[] {
  const { dim } = grid;
  const x = tile % dim;
  const y = (tile - x) / dim;
  const out: number[] = [];
  if (x > 0) out.push(tile - 1);
  if (x < dim - 1) out.push(tile + 1);
  if (y > 0) out.push(tile - dim);
  if (y < dim - 1) out.push(tile + dim);
  return out;
}

function xyOf(grid: TileGrid, tile: number): { x: number; y: number } {
  const x = tile % grid.dim;
  return { x, y: (tile - x) / grid.dim };
}

interface GrowthLand {
  index: number;
  origin: LandOrigin;
  weights: readonly [number, number, number, number];
  reservoir: number[];
  buckets: [number[], number[], number[], number[]];
  inFrontier: Set<number>;
  owned: number;
  target: number;
}

function addToFrontier(state: GrowthLand, grid: TileGrid, tile: number): void {
  if (state.inFrontier.has(tile)) return;
  if (grid.landId[tile] !== -1) return;
  state.inFrontier.add(tile);
  const neighbors = fourNeighbors(grid, tile);
  let neighborsOwned = 0;
  for (const n of neighbors) if (grid.landId[n] === state.index) neighborsOwned++;
  const bucketIndex = clampNum(neighborsOwned, 1, 4) - 1;
  state.buckets[bucketIndex].push(tile);
}

/** Sec.6.1: reservoir seeds use "the same origin rules the land's own origin used (inside borders, inside the cross unless generate_mode 1, not owned)" — deliberately NOT the origin's min_placement_distance check, which the spec's list omits here. */
function sampleReservoir(state: GrowthLand, grid: TileGrid, count: number, rng: Rng): void {
  if (count <= 0) return;
  const { dim } = grid;
  const bounds = state.origin.borderBounds;
  // Detached seeds are drawn from a NEIGHBOURHOOD of the land's own origin,
  // not from the whole map. Sec.6.1's own text says "rejection-sampled by the
  // same origin rules the land's own origin used", which reads as map-wide —
  // and map-wide is what this did, with a consequence the spec did not
  // anticipate. A detached seed is meant to model a land FRAGMENTING; drawn
  // from anywhere, it instead teleports.
  //
  // `AK_Six_Points_v1.4.rms` is the case that exposed it. The map draws a
  // closed ellipse out of 120 zero-tile land stamps and floods the inside
  // with one `create_land { land_percent 100 }`. The ring is a genuine wall
  // (verified: a 4-connected flood from the origin over non-ring tiles never
  // reaches the map edge), and the interior is 14,201 tiles. But the flood's
  // target is 40,000, which it can never reach, so it keeps taking turns
  // forever — and its two map-wide detached seeds landed OUTSIDE the ring and
  // grew without limit, putting DIRT across the open water. Across seeds the
  // land came out at 8,463, 13,777 and 16,703 tiles against an interior of
  // 14,201: sometimes short, sometimes spilling past a wall it cannot cross.
  //
  // Sec.6.1 licenses this: R and the FORM are both `[tune]`, and "what is
  // measured is the piece-count column, and any mechanism reproducing it is
  // admissible" (RMSTEST_38). A local neighbourhood reproduces that column
  // exactly as well — the measurement counted PIECES, and a piece 40 tiles
  // away counts the same as one 150 tiles away — while making a detached seed
  // mean "this land broke apart" rather than "this land also appeared over
  // there". Tracked for confirmation as Sec.15 item 27.
  const radius = Math.max(RESERVOIR_MIN_RADIUS, Math.round(dim * RESERVOIR_RADIUS_OF_DIM));
  const minX = Math.max(0, bounds.minX, state.origin.x - radius);
  const maxX = Math.min(dim - 1, bounds.maxX - 1, state.origin.x + radius);
  const minY = Math.max(0, bounds.minY, state.origin.y - radius);
  const maxY = Math.min(dim - 1, bounds.maxY - 1, state.origin.y + radius);
  if (minX > maxX || minY > maxY) return;
  const center = dim / 2;
  const crossHalf = CROSS_SHAPE_COEFFICIENT * (dim / 2);
  const seen = new Set<number>();
  const maxAttempts = count * 20;
  for (let attempt = 0; attempt < maxAttempts && state.reservoir.length < count; attempt++) {
    const x = nextInt(rng, minX, maxX);
    const y = nextInt(rng, minY, maxY);
    if (state.origin.generateMode !== 1 && Math.abs(x - center) > crossHalf && Math.abs(y - center) > crossHalf) continue;
    const idx = tileIndex(grid, x, y);
    if (grid.landId[idx] !== -1 || seen.has(idx)) continue;
    seen.add(idx);
    state.reservoir.push(idx);
  }
}

function drawFromFrontier(state: GrowthLand, rng: Rng): number | undefined {
  const sizes = state.buckets.map((b) => b.length);
  const totalWeight = sizes.reduce((sum, size, i) => sum + size * state.weights[i], 0);
  if (totalWeight <= 0) return undefined;
  let roll = nextFloat01(rng) * totalWeight;
  let bucketIndex = 0;
  for (; bucketIndex < 3; bucketIndex++) {
    const contribution = sizes[bucketIndex] * state.weights[bucketIndex];
    if (roll < contribution) break;
    roll -= contribution;
  }
  const bucket = state.buckets[bucketIndex];
  const pickIndex = nextInt(rng, 0, bucket.length - 1);
  const tile = bucket[pickIndex];
  bucket[pickIndex] = bucket[bucket.length - 1]; // swap-remove, O(1)
  bucket.pop();
  state.inFrontier.delete(tile);
  return tile;
}

function popReservoir(state: GrowthLand, rng: Rng): number | undefined {
  if (state.reservoir.length === 0) return undefined;
  const pickIndex = nextInt(rng, 0, state.reservoir.length - 1);
  const tile = state.reservoir[pickIndex];
  state.reservoir[pickIndex] = state.reservoir[state.reservoir.length - 1];
  state.reservoir.pop();
  return tile;
}

/**
 * `border_fuzziness` (Sec.6.1, MEASURED RMSTEST_23): `f=0` disables the
 * border entirely; `f>0` is a hard stop except a single fringe tile
 * (`depth===1`) accepted with probability `(100-f)/100`; `f=100` or negative
 * makes even the fringe tile unreachable.
 */
function borderAccepted(depth: number, f: number, rng: Rng): boolean {
  if (f === 0) return true;
  if (depth <= 0) return true;
  if (depth === 1) {
    const prob = f < 0 ? 0 : clampNum((100 - f) / 100, 0, 1);
    return nextFloat01(rng) < prob;
  }
  return false;
}

function borderDepth(x: number, y: number, bounds: BorderBounds): number {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX - 1 ? x - (bounds.maxX - 1) : 0;
  const dy = y < bounds.minY ? bounds.minY - y : y > bounds.maxY - 1 ? y - (bounds.maxY - 1) : 0;
  return Math.max(dx, dy);
}

/**
 * Sec.6.1: "within other_zone_avoidance_distance (the SMALLER of the two
 * lands' values) of a tile owned by a different zone (zone -12 exempt)."
 * The pairwise radius depends on which specific neighbouring land a nearby
 * tile belongs to, so the window scan uses THIS land's own radius as the
 * outer bound (the pairwise minimum can never exceed it) and re-checks the
 * true pairwise minimum per candidate tile found inside that window.
 */
function violatesZoneAvoidance(
  state: GrowthLand,
  states: readonly GrowthLand[],
  grid: TileGrid,
  x: number,
  y: number,
): boolean {
  if (state.origin.zone === -12) return false;
  const radius = state.origin.otherZoneAvoidanceDistance;
  if (radius <= 0) return false;
  const { dim } = grid;
  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(dim - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius));
  const maxY = Math.min(dim - 1, Math.ceil(y + radius));
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const otherLandIndex = grid.landId[tileIndex(grid, xx, yy)];
      if (otherLandIndex === -1 || otherLandIndex === state.index) continue;
      const otherZone = grid.zone[tileIndex(grid, xx, yy)];
      if (otherZone === state.origin.zone || otherZone === -12) continue;
      const otherRadius = states[otherLandIndex]?.origin.otherZoneAvoidanceDistance ?? radius;
      const pairRadius = Math.min(radius, otherRadius);
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= pairRadius * pairRadius) return true;
    }
  }
  return false;
}

function acceptCandidate(state: GrowthLand, states: readonly GrowthLand[], grid: TileGrid, tile: number, rng: Rng): boolean {
  if (grid.landId[tile] !== -1) return false; // "already owned" — includes staleness from a rival land claiming it since it entered the frontier/reservoir
  const { x, y } = xyOf(grid, tile);
  if (!borderAccepted(borderDepth(x, y, state.origin.borderBounds), state.origin.borderFuzziness, rng)) return false;
  if (violatesZoneAvoidance(state, states, grid, x, y)) return false;
  return true;
}

function claimTile(state: GrowthLand, grid: TileGrid, tile: number): void {
  grid.landId[tile] = state.index;
  grid.zone[tile] = state.origin.zone;
  for (const n of fourNeighbors(grid, tile)) addToFrontier(state, grid, n);
}

function hasCandidates(state: GrowthLand): boolean {
  return state.reservoir.length > 0 || state.buckets.some((b) => b.length > 0);
}

// Ordinals for growLands' own substreams start far away from
// placeLandOrigins' range so the two functions — called separately, each
// starting its own `ordinal` counter at 0 — never derive the same
// (masterSeed, "S1", ordinal) substream. Origin placement's ordinal count is
// bounded by the number of lands/players in a script, which never
// approaches this offset in practice.
const GROWTH_ORDINAL_OFFSET = 1_000_000;

/**
 * Sec.6.1: grows every placed `LandOrigin` from its origin stamp to its
 * target tile count (or until its frontier and reservoir are both
 * exhausted). Mutates `grid`'s `landId`/`zone`; appends `growthShortfall`/
 * `iterationCapped` `PlacementFailure`s to the matching entry in `reports`
 * (matched by `commandSpan`, so every player-land from one
 * `create_player_lands` command shares that command's single report, per
 * Sec.7's "one per instantiated command").
 */
export function growLands(
  origins: readonly LandOrigin[],
  grid: TileGrid,
  reports: readonly CommandReport[],
  masterSeed: number,
): void {
  const { dim } = grid;
  const reportBySpan = new Map<string, CommandReport>();
  for (const report of reports) reportBySpan.set(`${report.commandSpan.start}-${report.commandSpan.end}`, report);

  function recordFailure(state: GrowthLand, bucket: FailureBucket, detail: string, data?: Record<string, number>): void {
    const report = reportBySpan.get(`${state.origin.commandSpan.start}-${state.origin.commandSpan.end}`);
    if (report === undefined) return;
    pushFailure(report.failures, {
      bucket,
      commandSpan: state.origin.commandSpan,
      stage: "S1",
      entity: state.origin.player !== undefined ? `player ${state.origin.player}'s land` : "land",
      detail,
      data,
    });
  }

  const states: GrowthLand[] = origins.map((origin, index) => ({
    index,
    origin,
    weights: bucketWeights(origin.clumpingFactor),
    reservoir: [],
    buckets: [[], [], [], []],
    inFrontier: new Set<number>(),
    owned: 0,
    target: 0,
  }));

  // One pass to count current ownership (post-overwrite: an earlier origin
  // may have lost tiles to a later one's stamp), one pass to seed frontiers
  // from it — both O(dim^2), not O(numLands * dim^2).
  for (let i = 0; i < dim * dim; i++) {
    const landIndex = grid.landId[i];
    if (landIndex >= 0) states[landIndex].owned++;
  }
  for (let i = 0; i < dim * dim; i++) {
    const landIndex = grid.landId[i];
    if (landIndex < 0) continue;
    const state = states[landIndex];
    for (const n of fourNeighbors(grid, i)) {
      if (grid.landId[n] === -1) addToFrontier(state, grid, n);
    }
  }

  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S1", GROWTH_ORDINAL_OFFSET + ordinal++);
  // One substream per land, reused across every round it grows — Sec.8's
  // "best-effort stability": editing one land's target doesn't reshuffle
  // another's draws.
  const landRngs = states.map(() => nextSubstream());

  for (const state of states) {
    const totalTarget =
      state.origin.behaviorVersion === 0
        ? state.origin.declaredTargetTiles + state.owned
        : state.origin.declaredTargetTiles;
    state.target = Math.max(state.owned, Math.round(totalTarget));
    sampleReservoir(state, grid, reservoirSize(state.origin.clumpingFactor), landRngs[state.index]);
  }

  let active: GrowthLand[] = [];
  for (const state of states) {
    if (state.owned >= state.target) continue;
    if (hasCandidates(state)) {
      active.push(state);
    } else {
      recordFailure(
        state,
        "growthShortfall",
        `This land grew to ${state.owned} of its ${state.target}-tile target before running out of places to grow.`,
        { owned: state.owned, target: state.target },
      );
    }
  }

  const maxStepsPerLand = STEP_CAP_FACTOR * dim * dim;
  const stepsByLand = new Map<number, number>();

  while (active.length > 0) {
    const stillActive: GrowthLand[] = [];
    for (const state of active) {
      const rng = landRngs[state.index];
      const steps = (stepsByLand.get(state.index) ?? 0) + 1;
      stepsByLand.set(state.index, steps);
      if (steps > maxStepsPerLand) {
        recordFailure(
          state,
          "iterationCapped",
          `Growth for this land was truncated after ${maxStepsPerLand} steps to keep the preview from hanging.`,
          { owned: state.owned, target: state.target },
        );
        continue;
      }

      const useReservoir = state.reservoir.length > 0 && nextFloat01(rng) < RESERVOIR_DRAW_PROBABILITY;
      const drawn = useReservoir ? popReservoir(state, rng) : drawFromFrontier(state, rng);
      if (drawn !== undefined && acceptCandidate(state, states, grid, drawn, rng)) {
        claimTile(state, grid, drawn);
        state.owned++;
      }

      if (state.owned >= state.target) continue;
      if (hasCandidates(state)) {
        stillActive.push(state);
      } else {
        recordFailure(
          state,
          "growthShortfall",
          `This land grew to ${state.owned} of its ${state.target}-tile target before running out of places to grow.`,
          { owned: state.owned, target: state.target },
        );
      }
    }
    active = stillActive;
  }
}

// ---------------------------------------------------------------------------
// terrain_type (Sec.6.1) — like base_elevation below, strictly AFTER growth,
// and for the same reason: a land's terrain covers its FINAL footprint, not
// the origin stamp it started from.
// ---------------------------------------------------------------------------

/**
 * Writes each land's `terrain_type` onto every tile that land ended up
 * owning. Mutates `grid.terrain`.
 *
 * This was missing outright until 2026-08-07, and it is worth saying what
 * that cost, because the shape of the bug is more instructive than the fix.
 * `stampOrigin` and `claimTile` both wrote `landId` and `zone` and neither
 * ever wrote `terrain` — so every stage from S1 on saw a grid that was 100%
 * `base_terrain`, and the renderer drew one. Nothing failed loudly. Instead
 * the damage surfaced two stages downstream as an avalanche of *correct*
 * diagnostics: `create_terrain { base_terrain DIRT2 }` really did have no
 * DIRT2 to paint on, water objects really did have no water to sit in, and a
 * single corpus map reported 19,608 placement failures that were all one
 * missing loop. A stage that silently produces a plausible grid is much
 * harder to spot than one that throws.
 *
 * Ordering against the two things that also write terrain: this runs before
 * S4 (`create_terrain` paints patches ON TOP of land terrain, which is the
 * whole point of `base_terrain` matching) and before S5's connection
 * painting, both of which are later stages anyway. Within S1, later lands
 * overwrite earlier ones for free — `grid.landId` already resolved every
 * overlap, so a tile is painted exactly once here, by whichever land holds
 * it.
 *
 * A land whose `terrain_type` is absent or unresolvable paints nothing and
 * leaves the base fill showing, which is what the engine does with an
 * attribute it cannot read.
 */
export function paintLandTerrain(origins: readonly LandOrigin[], grid: TileGrid): void {
  // Indexed by the same land index `grid.landId` stores, so the grid scan
  // below is one array read per tile rather than a lookup per tile.
  // -1 = this land paints nothing.
  const terrainByLand = new Int32Array(origins.length).fill(-1);
  let anyPainted = false;
  origins.forEach((origin, index) => {
    if (origin.terrainId === undefined) return;
    terrainByLand[index] = origin.terrainId;
    anyPainted = true;
  });
  if (!anyPainted) return; // skip the grid scan entirely, matching applyBaseElevation

  for (let i = 0; i < grid.landId.length; i++) {
    const landIndex = grid.landId[i];
    if (landIndex < 0) continue;
    const terrainId = terrainByLand[landIndex];
    if (terrainId >= 0) grid.terrain[i] = terrainId;
  }
}

// ---------------------------------------------------------------------------
// base_elevation (Sec.6.1) — the last of this file's steps, deliberately
// AFTER growth: "after growth, set elevation = H on the land's tiles."
// ---------------------------------------------------------------------------

/**
 * Sec.6.1: negative H maximally elevates (-> 16, CONFIRMED in-game — a -1
 * patch matched a 16 patch exactly), H above 16 clamps to 16. `elevation` is
 * a `Uint8Array` (Sec.4), so skipping this clamp isn't cosmetic: an
 * unclamped -1 stores 255 and paints the land blinding white under the
 * renderer's brightness shading.
 */
function clampElevation(h: number): number {
  if (h < 0) return 16;
  if (h > 16) return 16;
  return h;
}

/**
 * Sec.6.1: `base_elevation H` sets every tile of a land's final footprint to
 * elevation `H`, with two conditions that skip it entirely (guide:952,
 * guide:959):
 *
 * - `H` is 0 or absent ("default 0 = not elevated") — a real no-op, not
 *   worth a grid write.
 * - The land's terrain_type is water ("doesn't work in HD/DE") — reuses
 *   grid.ts's water-name heuristic against the DECLARED terrain_type name
 *   rather than a second `/WATER/` literal.
 * - No `<ELEVATION_GENERATION>` section exists anywhere in the script (even
 *   an empty one satisfies the engine) — base-elevation slopes silently
 *   fail without it, and the game crashes when the map is PLAYED. That
 *   crash is `validate()` territory (tracked in CLAUDE.md, not yet built);
 *   this function's job is only to match the silent-failure half so the
 *   preview doesn't show a slope the engine wouldn't actually render.
 *
 * Mutates `grid.elevation`; returns the notes for whichever lands hit the
 * missing-section case (one per land, since each names its own command span).
 */
export function applyBaseElevation(
  instantiated: InstantiatedScript,
  origins: readonly LandOrigin[],
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
): SimulationNote[] {
  const notes: SimulationNote[] = [];
  const hasElevationSection = instantiated.sections.has("ELEVATION_GENERATION");
  const targetByLand = new Int16Array(origins.length).fill(-1); // -1 = no elevation change for this land

  origins.forEach((origin, index) => {
    if (origin.baseElevation === undefined || origin.baseElevation === 0) return;
    // Prefer the reference data's own water flag over the name heuristic:
    // the heuristic never saw DEEP_WATER or MED_WATER (absent from the data
    // until 2026-08-07), and it still cannot see a land written as a bare id.
    // The name test survives only for a terrain_type that resolves to nothing
    // at all, where a name is the only evidence there is.
    const isWater =
      origin.terrainId !== undefined
        ? isWaterTerrain(constants, origin.terrainId)
        : typeof origin.terrainType === "string" && WATER_NAME_PATTERN.test(origin.terrainType);
    if (isWater) return;
    if (!hasElevationSection) {
      notes.push({
        key: `baseElevationNoSection:${origin.commandSpan.start}`,
        prominence: "drawer",
        stage: "S1",
        span: origin.commandSpan,
        text: "base_elevation has no effect without an <ELEVATION_GENERATION> section present in the script (even an empty one) — the game also crashes when the map is played without it.",
      });
      return;
    }
    targetByLand[index] = clampElevation(origin.baseElevation);
  });

  if (targetByLand.every((v) => v === -1)) return notes; // nothing to write — skip the grid scan entirely

  for (let i = 0; i < grid.landId.length; i++) {
    const landIndex = grid.landId[i];
    if (landIndex < 0) continue;
    const target = targetByLand[landIndex];
    if (target !== -1) grid.elevation[i] = target;
  }

  return notes;
}
