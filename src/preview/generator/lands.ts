// S1, the land stage, docs/preview-design.md Sec.6.1 (rev 10). PURE (CLAUDE.md
// hard rule / preview-design Sec.2).
//
// THIS FILE REPRODUCES THE GAME TILE FOR TILE. Every rule in it was measured
// against saved DE maps (preview-design Sec.6.1 holds the rules), and `landStageDeMaps.test.ts` holds it to 111 of
// those maps at their own seeds, `deElevationCliffMaps.test.ts` to 51 more
// that go on through elevation and cliffs. So the order of every draw matters as
// much as the rule it serves. One stream runs from the script's first rnd()
// (instantiate.ts) through player setup, origins and growth, and a draw
// added, dropped or moved anywhere here shifts every land after it.
//
// THE STEPS, in the order `index.ts` calls them. `placeLandOrigins` runs
// player setup, places the remaining origins, takes the one draw nobody has
// explained yet and stamps every land. `growLands` grows the lands, writes
// their heights and runs the leftover fill. `finishLandStage` paints them and
// runs the cleanup pass, whose restored tiles spend draws too, and hands the
// stream on to the elevation stage.
//
// Measured on Tiny maps only, and only through <LAND_GENERATION>. The rules
// are written for any size, and Sec.15 lists what no map has exercised.

import type {
  BorderTiles,
  CommandReport,
  InstantiatedArg,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  SimulationNote,
  TileGrid,
} from "./types";
import type { CanonicalTeams } from "../../generationSettings/teamModel";
import {
  mulHigh32,
  resumeDeStream,
  type DeStream,
  type DeStreamState,
} from "./deRandom";
import {
  f32Add,
  f32Cos,
  f32Div,
  f32Mul,
  f32Sin,
  f32Sqrt,
  f32Sub,
  percentTile,
  roundHalfAway,
} from "./float32";
import { cosAt, sinAt } from "./rng";
import { SINE_SCALE } from "./sineTable";
import {
  NO_LAYER,
  resolveTerrainId,
  WATER_NAME_PATTERN,
  type TerrainConstantForMasks,
} from "./grid";
import {
  CLASS_FLAT_LAND,
  classOf,
  decorationDrawsOf,
  terrainClassTable,
} from "./terrainClass";
import { pushFailure } from "./placement";

const DEFAULT_BASE_SIZE = 3;
const DEFAULT_BORDER_FUZZINESS = 20;
const DEFAULT_CLUMPING_FACTOR = 8;
const DEFAULT_OTHER_ZONE_AVOIDANCE = 0;

/** Sec.6.1 origins: after this many conflicts a land goes to the map centre. Measured, `d1-neutral`. */
const ORIGIN_CONFLICT_LIMIT = 990;

/**
 * Negative `circle_radius`: MEASURED mean radius 0.276*dim, CV 0.44
 * (RMSTEST_27), drawn as a mixture of a uniform point in a disc and a uniform
 * radius. No DE map in the fixture uses a negative radius, so this is the one
 * player placement that is still a fitted approximation (Sec.6.1, rev 9).
 */
const SCATTERED_DISC_WEIGHT = 0.671;
const SCATTERED_DISC_RADIUS_PCT = 41.4;
const SCATTERED_UNIFORM_MAX_RADIUS_PCT = 55.2;

// ---------------------------------------------------------------------------
// Attribute reading, InstantiatedCommand.attributes is always folded to
// InstantiatedAttribute[] (Sec.3 rule 10); none of Sec.6.1's attributes are
// repeatable, so index [0] is always the one that survived folding.
// ---------------------------------------------------------------------------

function argValue(
  cmd: InstantiatedCommand,
  name: string,
  argIndex = 0,
): InstantiatedValue {
  const arg: InstantiatedArg | undefined =
    cmd.attributes.get(name)?.[0]?.args[argIndex];
  return arg?.value;
}

// BUG-021 / RMSTEST_69: `fallback` is for the argument being ABSENT, not for
// a known symbol (a #define with no #const) that resolves to JS `undefined`
// — that reads as 0, measured. See objects.ts's own copy for the full note.
function numAttr(
  cmd: InstantiatedCommand,
  name: string,
  argIndex: number,
  fallback: number,
): number {
  const arg = cmd.attributes.get(name)?.[0]?.args[argIndex];
  if (arg === undefined) return fallback;
  if (typeof arg.value === "number") return arg.value;
  return arg.value === undefined ? 0 : fallback;
}

/**
 * A percentage as the game holds it, a float. S0 rounds every `percent` slot
 * for the stages that want an integer, and keeps the exact value beside it,
 * which is what this reads. Measured for `land_percent`. The borders,
 * `land_position` and `circle_radius` go through the same single-precision
 * arithmetic, so they read it too, untested with a fraction.
 */
function percentAttr(
  cmd: InstantiatedCommand,
  name: string,
  argIndex: number,
  fallback: number,
): number {
  const arg = cmd.attributes.get(name)?.[0]?.args[argIndex];
  if (arg?.exact !== undefined) return arg.exact;
  return numAttr(cmd, name, argIndex, fallback);
}

// ---------------------------------------------------------------------------
// Shared details (Sec.6.1, "Tiles from percentages")
// ---------------------------------------------------------------------------

/** A land's border box. `right` and `bottom` count from the far edge, so no borders gives `0..dim`. */
function borderTilesOf(cmd: InstantiatedCommand, dim: number): BorderTiles {
  const near = (p: number): number => percentTile(dim, p);
  const far = (p: number): number =>
    roundHalfAway(f32Sub(dim, f32Div(f32Mul(dim, p), 100)));
  return {
    left: near(percentAttr(cmd, "left_border", 0, 0)),
    right: far(percentAttr(cmd, "right_border", 0, 0)),
    top: near(percentAttr(cmd, "top_border", 0, 0)),
    bottom: far(percentAttr(cmd, "bottom_border", 0, 0)),
  };
}

/**
 * `land_position` as a tile, `round(dim * p / 100)` in single precision. The
 * clamp to the map is ours (Sec.6.1's out-of-range rule, for Michi.rms's
 * `land_position 100 100`), and no DE map has tested what the game does there.
 */
function landPositionTile(percent: number, dim: number): number {
  return Math.max(0, Math.min(dim - 1, percentTile(dim, percent)));
}

/**
 * The size as declared, before the game's rounding. Exported for
 * consistency-checker-design.md Sec.7.0 item 2, which sums it. Growth reads
 * `landTarget` instead.
 */
export function declaredTargetTiles(
  cmd: InstantiatedCommand,
  dim: number,
  perPlayerDivisor: number,
): number {
  const explicitTiles = argValue(cmd, "number_of_tiles", 0);
  if (typeof explicitTiles === "number")
    return explicitTiles / perPlayerDivisor;
  const percent = numAttr(cmd, "land_percent", 0, 100); // default 100 (Sec.6.1)
  return ((percent / 100) * dim * dim) / perPlayerDivisor;
}

/**
 * The tile count growth stops at (Sec.6.1 Size targets, rev 9).
 *
 * - `number_of_tiles N` is `N`, per player on `create_player_lands`.
 * - `land_percent P` on a `create_land` is `round(dim² * min(P, 100) / 100)`.
 * - `land_percent P` on `create_player_lands` divides the map equally below
 *   100, and at 100 or more gives EVERY player land the whole map. That is
 *   measured at 4, 60, 97, 99 and 100, and a budget the lands share was ruled
 *   out at 60, 97 and 99.
 *
 * The products and quotients are single precision, as the game's are.
 */
function landTarget(
  cmd: InstantiatedCommand,
  dim: number,
  playerLandCount: number | undefined,
): number {
  const explicitTiles = argValue(cmd, "number_of_tiles", 0);
  if (typeof explicitTiles === "number") return Math.round(explicitTiles);
  const percent = percentAttr(cmd, "land_percent", 0, 100);
  const area = dim * dim;
  if (playerLandCount === undefined)
    return roundHalfAway(f32Div(f32Mul(area, Math.min(percent, 100)), 100));
  if (percent >= 100) return area;
  return roundHalfAway(f32Div(f32Mul(area, percent), playerLandCount * 100));
}

/**
 * The conformity radius `rho` (Sec.6.1 rule on `land_conformity`). With target
 * `t`, `a` is the truncated square root of `t` (of `t / pi` for a circular
 * base) in single precision, and `rho` is half the median of `t`, `a` and the
 * base size, rounded down.
 */
function conformityRadius(land: LandOrigin): number {
  const t = land.target;
  if (t === 0) return Math.floor(land.baseSize / 2);
  const a = Math.trunc(
    land.circularBase ? f32Sqrt(f32Div(t, Math.PI)) : f32Sqrt(t),
  );
  const sorted = [t, a, land.baseSize].sort((p, q) => p - q);
  return Math.floor(sorted[1] / 2);
}

/** The stamp's half size, the base size, or the conformity radius for a land that does not grow. */
function stampHalfSize(land: LandOrigin): number {
  return land.landConformity >= 100 ? conformityRadius(land) : land.baseSize;
}

/** The stamp's square, clipped to the map. May be empty for an origin far off the map. */
function stampBounds(
  land: LandOrigin,
  dim: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const h = stampHalfSize(land);
  return {
    minX: Math.max(0, land.x - h),
    maxX: Math.min(dim - 1, land.x + h),
    minY: Math.max(0, land.y - h),
    maxY: Math.min(dim - 1, land.y + h),
  };
}

function inCircularStamp(
  land: LandOrigin,
  h: number,
  x: number,
  y: number,
): boolean {
  const dx = x - land.x;
  const dy = y - land.y;
  return dx * dx + dy * dy <= h * h;
}

/** Writes one land's stamp to `grid.landId` and `grid.zone`. A later stamp overwrites an earlier one. */
function stampOrigin(grid: TileGrid, index: number, land: LandOrigin): void {
  const { minX, maxX, minY, maxY } = stampBounds(land, grid.dim);
  const h = stampHalfSize(land);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (land.circularBase && !inCircularStamp(land, h, x, y)) continue;
      const i = y * grid.dim + x;
      grid.landId[i] = index;
      grid.zone[i] = land.zone;
    }
  }
}

// ---------------------------------------------------------------------------
// Zones (Sec.6.1)
// ---------------------------------------------------------------------------

/**
 * A land's zone. A player land, from `create_player_lands` or a `create_land`
 * assigned to a player, defaults to the player's zone `k - 10`. On a
 * `create_player_lands` land `set_zone_by_team` reads that player's own team,
 * and on any `create_land` it reads player 1's team, which is guide:1055's
 * footgun. An un-teamed player counts as team `k` (RMSTEST_37), so player
 * `k`'s team zone is `k - 9` then.
 *
 * `set_zone_randomly` uses the draw S0 took for it, reduced to
 * `bounded(players) - 8` (measured, `b3-zonerand`).
 */
function computeZone(
  cmd: InstantiatedCommand,
  player: number | undefined,
  teams: CanonicalTeams,
  playerCount: number,
): number {
  const defaultZone = player !== undefined ? player - 10 : -10;
  if (cmd.attributes.has("zone")) return numAttr(cmd, "zone", 0, defaultZone);
  if (cmd.attributes.has("set_zone_by_team")) {
    const p = cmd.name === "create_player_lands" ? (player ?? 1) : 1;
    const team = teams.canonical[p - 1] ?? 0;
    return (team > 0 ? team : p) - 9;
  }
  const random = cmd.attributes.get("set_zone_randomly")?.[0];
  if (random?.draw !== undefined)
    return mulHigh32(playerCount, random.draw) - 8;
  return defaultZone;
}

/** The game's one-byte zone, `(zone + 10) & 0xFF`. 0xFE is "free" and 0xFF is "dead", so zones -12 and -11 alias them (Sec.6.1, untested). */
function zoneByte(zone: number): number {
  return (((Math.trunc(zone) + 10) % 256) + 256) % 256;
}

// ---------------------------------------------------------------------------
// assign_to / assign_to_player (Sec.6.1)
// ---------------------------------------------------------------------------

interface AssignmentResolution {
  /** undefined = "not created" (guide:1015: non-playing target, or an AT_TEAM domain with no eligible player left). */
  player: number | undefined;
  colorNoted: boolean;
  flagsNoted: boolean;
}

/**
 * Resolves one `assign_to`/`assign_to_player` to a player number.
 * `assignedPlayers` is the running "already given a land via assign_to" set
 * (guide:1008's default remembering behaviour), which AT_TEAM's candidate pool
 * excludes. Random mode picks with the draw S0 took for the attribute, as
 * `bounded(candidates)`. Which candidate the game's draw picks is untested
 * (Sec.15 item 50), and the draw itself is what keeps every later land in
 * step.
 */
function resolveAssignment(
  cmd: InstantiatedCommand,
  playerCount: number,
  teams: CanonicalTeams,
  assignedPlayers: ReadonlySet<number>,
): AssignmentResolution {
  const assignTo = cmd.attributes.get("assign_to")?.[0];
  if (assignTo) {
    const target = assignTo.args[0]?.value;
    const number = assignTo.args[1]?.value;
    const flags = assignTo.args[3]?.value;
    const flagsNoted = typeof flags === "number" && flags !== 0;

    if (target === "AT_PLAYER" || target === "AT_COLOR") {
      const n = typeof number === "number" ? number : undefined;
      const player =
        n !== undefined && n >= 1 && n <= playerCount ? n : undefined;
      return { player, colorNoted: target === "AT_COLOR", flagsNoted };
    }
    if (target === "AT_TEAM") {
      const n = typeof number === "number" ? number : undefined;
      if (n === undefined)
        return { player: undefined, colorNoted: false, flagsNoted };
      const candidates: number[] = [];
      for (let p = 1; p <= playerCount; p++) {
        if (assignedPlayers.has(p)) continue;
        const team = teams.canonical[p - 1] ?? 0;
        // guide:1002-1003: n>0 -> that team; 0 -> un-teamed; negative
        // (except -10) -> NOT team |n|; -10 -> any player.
        const matches =
          n === -10
            ? true
            : n === 0
              ? team === 0
              : n > 0
                ? team === n
                : team !== -n;
        if (matches) candidates.push(p);
      }
      if (candidates.length === 0)
        return { player: undefined, colorNoted: false, flagsNoted };
      // candidates is already in ascending player order, so [0] IS lobby order.
      const player =
        assignTo.draw !== undefined
          ? candidates[mulHigh32(candidates.length, assignTo.draw)]
          : candidates[0];
      return { player, colorNoted: false, flagsNoted };
    }
    return { player: undefined, colorNoted: false, flagsNoted }; // unrecognized AssignTarget word
  }

  const assignToPlayer = cmd.attributes.get("assign_to_player")?.[0];
  if (assignToPlayer) {
    const n = assignToPlayer.args[0]?.value;
    const player =
      typeof n === "number" && n >= 1 && n <= playerCount ? n : undefined;
    return { player, colorNoted: false, flagsNoted: false };
  }

  return { player: undefined, colorNoted: false, flagsNoted: false };
}

// ---------------------------------------------------------------------------
// Player setup (Sec.6.1 "Player setup", rev 9)
// ---------------------------------------------------------------------------

/** One land being placed. `placed` stays false until something gives it a position. */
interface Pending {
  origin: LandOrigin;
  cmd: InstantiatedCommand;
  placed: boolean;
}

/**
 * The slot shuffle (seven draws), then with Team Positions on the three team
 * draws, which reorder each team's members inside the slots they hold.
 * Returns the order players are placed in, all eight slots included.
 */
function playerOrder(
  stream: DeStream,
  playerCount: number,
  teamOf: (player: number) => number,
  teamPositions: boolean,
): number[] {
  const order = [1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 1; k < 8; k++) {
    const j = stream.index(k + 1);
    [order[k], order[j]] = [order[j], order[k]];
  }
  if (!teamPositions) return order;

  // d1 below 50 makes the game "descending". With more than one player, d2
  // below 50 selects a player with d3, where 0 means nobody.
  const d1 = stream.low15(100);
  let selected = 0;
  if (playerCount > 1 && stream.low15(100) < 50)
    selected = stream.low15(playerCount + 1);
  const selectedTeam = selected > 0 ? teamOf(selected) : 0;

  const teamNumbers = new Set<number>();
  for (let p = 1; p <= playerCount; p++)
    if (teamOf(p) > 0) teamNumbers.add(teamOf(p));
  for (const team of teamNumbers) {
    const members: number[] = [];
    for (let p = 1; p <= playerCount; p++)
      if (teamOf(p) === team) members.push(p);
    const positions: number[] = [];
    order.forEach((p, i) => {
      if (p <= playerCount && teamOf(p) === team) positions.push(i);
    });
    const ascending =
      (team === selectedTeam && d1 >= 50) || (team !== selectedTeam && d1 < 50);
    const values = ascending ? members : [...members].reverse();
    positions.forEach((position, i) => {
      order[position] = values[i];
    });
  }
  return order;
}

/** The rectangle players travel round (Sec.6.1, rev 9), from the player lands' border boxes and base sizes. */
interface Rectangle {
  minX: number;
  minY: number;
  sx: number;
  sy: number;
  tw: number;
  half: number;
}

function playerRectangle(players: readonly Pending[], dim: number): Rectangle {
  let aw = dim;
  let ah = dim;
  let minX = 0;
  let minY = 0;
  for (const { origin } of players) {
    const b = origin.borderTiles;
    const base = origin.baseSize;
    aw = Math.min(aw, b.right - b.left - 2 * base);
    ah = Math.min(ah, b.bottom - b.top - 2 * base);
    minX = Math.max(minX, b.left + base);
    minY = Math.max(minY, b.top + base);
  }
  const tw = Math.floor((2 * aw) / 10);
  return {
    minX,
    minY,
    sx: Math.floor((6 * aw) / 10),
    sy: Math.floor((6 * ah) / 10),
    tw,
    half: Math.floor(tw / 2),
  };
}

/** `circle_radius R V` on the last `create_player_lands`, when R is positive. 0 means none (guide:844). */
interface Circle {
  radius: number;
  variance: number;
  perimeter: number;
}

/** C's `%`, whose result takes the sign of the left operand, as `grouped_by_team`'s cursor needs. */
function cMod(a: number, m: number): number {
  return m === 0 ? a : a % m;
}

/**
 * Perimeter values for every player land, by the default pass (`random`) or
 * by `grouped_by_team`. A land that never gets one keeps 0.
 */
function perimeterValues(
  stream: DeStream,
  players: readonly Pending[],
  order: readonly number[],
  playerCount: number,
  together: (a: number, b: number) => boolean,
  perimeter: number,
  grouped: boolean,
): Map<Pending, number> {
  const values = new Map<Pending, number>();
  for (const land of players) values.set(land, 0);
  const landsOf = (p: number): Pending[] =>
    players.filter((land) => land.origin.player === p);

  if (!grouped) {
    // Teams sit together, in the order their first member appears in
    // `order`, members in `order`'s order. Empty slots cost nothing.
    const count = Math.max(players.length, 1);
    const step = Math.trunc(perimeter / count);
    const jit = Math.trunc(step / count);
    let current = stream.bounded(perimeter);
    const placed = new Set<number>();
    for (const outer of order) {
      for (const inner of order) {
        if (placed.has(inner) || !together(outer, inner)) continue;
        const own = landsOf(inner);
        if (own.length === 0) continue;
        for (const land of own) {
          let p = stream.bounded(jit) + current - Math.floor(jit / 2);
          if (p < 0) p += perimeter;
          if (p > perimeter) p -= perimeter;
          values.set(land, p);
          current += step;
          if (current >= perimeter) current -= perimeter;
        }
        placed.add(inner);
      }
    }
    return values;
  }

  // grouped_by_team: groups are teams and lone players, P/G apart, and
  // consecutive teammates are `base_a + 5 + base_b` apart along the
  // perimeter. Only a player's first land is placed.
  const inGame = (p: number): boolean => p >= 1 && p <= playerCount;
  const groupLeaders: number[] = [];
  for (let p = 1; p <= playerCount; p++)
    if (!groupLeaders.some((g) => together(g, p))) groupLeaders.push(p);
  const step = Math.trunc(perimeter / Math.max(groupLeaders.length, 1));
  let current = stream.bounded(perimeter);
  const placed = new Set<number>();
  for (const outer of order) {
    if (placed.has(outer) || !inGame(outer)) continue;
    const members = order.filter((q) => inGame(q) && together(outer, q));
    const firstLand = (q: number): Pending | undefined => landsOf(q)[0];
    let span = -5;
    for (const q of members) {
      const land = firstLand(q);
      if (land) span += 2 * land.origin.baseSize + 5;
    }
    let cursor = current - Math.trunc(span / 2);
    members.forEach((q, k) => {
      const land = firstLand(q);
      const base = land ? land.origin.baseSize : 0;
      if (k > 0) cursor = cMod(cursor + 5 + base, perimeter);
      if (land) values.set(land, cursor);
      placed.add(q);
      cursor = cMod(cursor + base, perimeter);
    });
    current = cMod(current + step, perimeter);
  }
  return values;
}

/** Rectangle coordinates for a perimeter value, with this land's one edge draw `j`. */
function rectanglePoint(
  r: Rectangle,
  p: number,
  j: number,
): { x: number; y: number } {
  const b1 = r.sx;
  const b2 = r.sx + r.sy;
  const b3 = 2 * r.sx + r.sy;
  if (p < b1) return { x: r.minX + r.tw + p, y: r.minY + r.half + j };
  if (p < b2)
    return {
      x: r.minX + r.sx + r.tw + r.half + j,
      y: r.minY + r.tw + (p - r.sx),
    };
  if (p < b3)
    return {
      x: r.minX + r.tw + r.sx + (b2 - p),
      y: r.minY + r.sy + r.tw + r.half + j,
    };
  return { x: r.minX + r.half + j, y: r.minY + r.tw + r.sy + (b3 - p) };
}

/** `circle_radius` coordinates, single precision throughout, then the variance draws and the clamp to `[base, dim - base]`. */
function circlePoint(
  stream: DeStream,
  circle: Circle,
  p: number,
  base: number,
  dim: number,
): { x: number; y: number } {
  const angle = f32Mul(f32Div(2 * Math.PI, circle.perimeter), p);
  const c = Math.floor(dim / 2);
  let x = Math.trunc(f32Add(f32Mul(f32Cos(angle), circle.radius), c));
  let y = Math.trunc(f32Add(f32Mul(f32Sin(angle), circle.radius), c));
  if (circle.variance > 0) {
    x += stream.bounded(2 * circle.variance) - circle.variance;
    y += stream.bounded(2 * circle.variance) - circle.variance;
  }
  return {
    x: Math.min(Math.max(x, base), dim - base),
    y: Math.min(Math.max(y, base), dim - base),
  };
}

/** Negative `circle_radius`, the fitted scatter (see the constants above). Draws from the game's stream, but no DE map pins how many. */
function scatteredPoint(
  stream: DeStream,
  dim: number,
): { x: number; y: number } {
  const unit = (): number => stream.raw() / 4294967296;
  const center = dim / 2;
  if (unit() < SCATTERED_DISC_WEIGHT) {
    const r = (SCATTERED_DISC_RADIUS_PCT / 100) * dim;
    for (let attempt = 0; attempt < 20; attempt++) {
      const dx = (unit() * 2 - 1) * r;
      const dy = (unit() * 2 - 1) * r;
      if (dx * dx + dy * dy <= r * r)
        return { x: Math.round(center + dx), y: Math.round(center + dy) };
    }
    return { x: Math.round(center), y: Math.round(center) };
  }
  const radius = unit() * (SCATTERED_UNIFORM_MAX_RADIUS_PCT / 100) * dim;
  const deg = stream.bounded(360);
  return {
    x: Math.round(center + (radius * cosAt(deg, 360)) / SINE_SCALE),
    y: Math.round(center + (radius * sinAt(deg, 360)) / SINE_SCALE),
  };
}

/**
 * Player setup, Sec.6.1 rev 9. Runs whether or not the script has player
 * lands, since its draws are spent either way. Sets the position of every
 * player land it can, and leaves a `direct_placement` land without
 * `land_position` for the origin rule.
 */
function runPlayerSetup(
  stream: DeStream,
  instantiated: InstantiatedScript,
  lands: readonly Pending[],
  dim: number,
  notes: SimulationNote[],
): void {
  const { teams, playerSetup, teamPositions } = instantiated;
  const playerCount = teams.canonical.length;
  const players = lands.filter((land) => land.origin.player !== undefined);
  const teamOf = (p: number): number =>
    teamPositions && p >= 1 && p <= playerCount
      ? (teams.canonical[p - 1] ?? 0)
      : 0;
  const together = (a: number, b: number): boolean =>
    a === b || (teamOf(a) !== 0 && teamOf(a) === teamOf(b));

  const order = playerOrder(stream, playerCount, teamOf, teamPositions);

  if (playerSetup.directPlacement) {
    // One draw nobody has explained, then one per player land. No
    // coordinate draws. A land without land_position waits for the origin
    // rule.
    stream.raw();
    for (const land of players) {
      stream.raw();
      const position = land.cmd.attributes.get("land_position")?.[0];
      if (!position) continue;
      land.origin.x = landPositionTile(
        percentAttr(land.cmd, "land_position", 0, 50),
        dim,
      );
      land.origin.y = landPositionTile(
        percentAttr(land.cmd, "land_position", 1, 50),
        dim,
      );
      land.placed = true;
    }
    return;
  }

  const rectangle = playerRectangle(players, dim);
  // Only the final circle_radius applies (guide:856).
  const lastPlayerLands = [...lands]
    .reverse()
    .find((land) => land.cmd.name === "create_player_lands")?.cmd;
  const radiusPct = lastPlayerLands
    ? percentAttr(lastPlayerLands, "circle_radius", 0, 0)
    : 0;
  let circle: Circle | undefined;
  if (radiusPct > 0) {
    const radius = roundHalfAway(f32Div(f32Mul(dim, radiusPct), 100));
    circle = {
      radius,
      variance: lastPlayerLands
        ? Math.trunc(numAttr(lastPlayerLands, "circle_radius", 1, 0))
        : 0,
      perimeter: Math.trunc(f32Mul(radius, 2 * Math.PI)),
    };
  }
  const scattered = radiusPct < 0;
  if (scattered)
    notes.push({
      key: "negativeCircleRadius",
      prominence: "drawer",
      stage: "S1",
      span: lastPlayerLands?.span,
      text: "A negative circle_radius scatters the players, and the preview draws that scatter from a fit to measured games. Player lands, and every land after them, will not match the game tile for tile at this seed.",
    });
  const perimeter = circle
    ? circle.perimeter
    : 2 * (rectangle.sx + rectangle.sy);

  const values = perimeterValues(
    stream,
    players,
    order,
    playerCount,
    together,
    perimeter,
    playerSetup.groupedByTeam,
  );

  // Coordinates come after every perimeter value is known, one land at a
  // time in land order.
  for (const land of players) {
    const p = values.get(land) ?? 0;
    let point: { x: number; y: number };
    if (scattered) point = scatteredPoint(stream, dim);
    else if (circle)
      point = circlePoint(stream, circle, p, land.origin.baseSize, dim);
    else
      point = rectanglePoint(
        rectangle,
        p,
        stream.bounded(rectangle.tw) - rectangle.half,
      );
    land.origin.x = Math.max(0, Math.min(dim - 1, point.x));
    land.origin.y = Math.max(0, Math.min(dim - 1, point.y));
    land.placed = true;
  }
}

// ---------------------------------------------------------------------------
// Origins of the remaining lands (Sec.6.1, rev 9)
// ---------------------------------------------------------------------------

/**
 * The origin rule for a land without a position. Draws an offset in the
 * land's own box, redraws (without counting it) when both offsets fall in a
 * corner third, and redraws on a conflict, a square test against every land
 * that already has a position. After 990 conflicts the land goes to the map
 * centre. Returns false in that case.
 */
function placeRemaining(
  stream: DeStream,
  land: Pending,
  lands: readonly Pending[],
  dim: number,
): boolean {
  const o = land.origin;
  const b = o.borderTiles;
  const aw = Math.max(0, b.right - b.left - 2 * o.baseSize);
  const ah = Math.max(0, b.bottom - b.top - 2 * o.baseSize);
  const all = o.generateMode === 1;
  const lowX = all ? 0 : Math.floor(aw / 3);
  const highX = all ? aw : aw - Math.floor(aw / 3);
  const lowY = all ? 0 : Math.floor(ah / 3);
  const highY = all ? ah : ah - Math.floor(ah / 3);

  let conflicts = 0;
  // Each pass draws, and a corner redraw has at most a 4 in 9 chance, so the
  // loop ends. The cap only guards against a stream that never leaves the
  // corners, which a real one does not do.
  for (let pass = 0; pass < 1_000_000; pass++) {
    const cx = stream.bounded(aw);
    const cy = stream.bounded(ah);
    if ((cx < lowX || cx > highX) && (cy < lowY || cy > highY)) continue;
    const x = b.left + o.baseSize + cx;
    const y = b.top + o.baseSize + cy;
    let conflict = false;
    for (const other of lands) {
      if (other === land || !other.placed) continue;
      const d =
        o.minPlacementDistance !== undefined && o.minPlacementDistance >= 0
          ? o.minPlacementDistance
          : Math.max(
              o.otherZoneAvoidanceDistance,
              other.origin.otherZoneAvoidanceDistance,
            ) +
            o.baseSize +
            other.origin.baseSize;
      if (
        Math.abs(x - other.origin.x) < d &&
        Math.abs(y - other.origin.y) < d
      ) {
        conflict = true;
        break;
      }
    }
    if (!conflict) {
      o.x = x;
      o.y = y;
      land.placed = true;
      return true;
    }
    if (++conflicts >= ORIGIN_CONFLICT_LIMIT) break;
  }
  o.x = Math.floor(dim / 2);
  o.y = Math.floor(dim / 2);
  o.fromOriginFallback = true;
  land.placed = true;
  return false;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface LandPlacementResult {
  origins: LandOrigin[];
  reports: CommandReport[];
  notes: SimulationNote[];
  /** The game's stream after origin placement, which growth resumes (`growLands`). */
  stream: DeStreamState;
}

/**
 * The height a land writes (Sec.6.1, rev 10). A land whose terrain is
 * water-like by the dat's placement class writes 0 whatever its
 * `base_elevation` (lh1, a WATER land at 4 stayed at 0). For a terrain that
 * resolves to nothing, the written name is the only evidence there is, so
 * the water-name test decides.
 */
function landHeight(
  constants: readonly TerrainConstantForMasks[],
  terrainId: number | undefined,
  terrainType: InstantiatedValue,
  baseElevation: number | undefined,
): number {
  const water =
    terrainId !== undefined
      ? (classOf(terrainClassTable(constants), terrainId) & CLASS_FLAT_LAND) !==
        0
      : typeof terrainType === "string" && WATER_NAME_PATTERN.test(terrainType);
  if (water || baseElevation === undefined) return 0;
  return clampElevation(baseElevation);
}

function newOrigin(
  cmd: InstantiatedCommand,
  dim: number,
  constants: readonly TerrainConstantForMasks[],
  instantiated: InstantiatedScript,
  player: number | undefined,
  playerLandCount: number | undefined,
): LandOrigin {
  const terrainTypeValue = argValue(cmd, "terrain_type", 0);
  const baseElevationValue = argValue(cmd, "base_elevation", 0);
  const terrainId = resolveTerrainId(
    constants,
    terrainTypeValue,
    instantiated.symbols,
    instantiated.aliases,
  );
  const baseElevation =
    typeof baseElevationValue === "number" ? baseElevationValue : undefined;
  const declaredLandIdValue = argValue(cmd, "land_id", 0);
  const minPlacement = argValue(cmd, "min_placement_distance", 0);
  const playerCount = instantiated.teams.canonical.length;
  return {
    commandSpan: cmd.span,
    x: 0,
    y: 0,
    zone: computeZone(cmd, player, instantiated.teams, playerCount),
    declaredLandId:
      typeof declaredLandIdValue === "number" ? declaredLandIdValue : undefined,
    player,
    baseSize: numAttr(cmd, "base_size", 0, DEFAULT_BASE_SIZE),
    circularBase: cmd.attributes.has("set_circular_base"),
    terrainType:
      typeof terrainTypeValue === "string" ||
      typeof terrainTypeValue === "number"
        ? terrainTypeValue
        : undefined,
    terrainId,
    baseElevation,
    height: landHeight(constants, terrainId, terrainTypeValue, baseElevation),
    clumpingFactor: numAttr(cmd, "clumping_factor", 0, DEFAULT_CLUMPING_FACTOR),
    borderFuzziness: numAttr(
      cmd,
      "border_fuzziness",
      0,
      DEFAULT_BORDER_FUZZINESS,
    ),
    otherZoneAvoidanceDistance: numAttr(
      cmd,
      "other_zone_avoidance_distance",
      0,
      DEFAULT_OTHER_ZONE_AVOIDANCE,
    ),
    minPlacementDistance:
      typeof minPlacement === "number" ? minPlacement : undefined,
    landConformity: numAttr(cmd, "land_conformity", 0, 0),
    behaviorVersion: cmd.behaviorVersion,
    declaredTargetTiles: declaredTargetTiles(cmd, dim, playerLandCount ?? 1),
    target: landTarget(cmd, dim, playerLandCount),
    fromOriginFallback: false,
    borderTiles: borderTilesOf(cmd, dim),
    generateMode: numAttr(cmd, "generate_mode", 0, 0),
  };
}

/**
 * Sec.6.1 rev 9, everything up to growth. Builds every land in script order
 * (`create_player_lands` expands in place to one land per player in the
 * game), runs player setup, gives every land still without a position its
 * origin, takes the unexplained draw that sits between origins and growth on
 * every map tested, and stamps the lands onto `grid.landId`/`grid.zone`.
 * Returns one `CommandReport` per land command (Sec.7) and the stream for
 * `growLands`.
 */
export function placeLandOrigins(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
): LandPlacementResult {
  const { dim } = grid;
  const commands = instantiated.sections.get("LAND_GENERATION") ?? [];
  const notes: SimulationNote[] = [];
  const { teams } = instantiated;
  // CanonicalTeams.canonical is length playerCount exactly (teamModel.ts).
  const playerCount = teams.canonical.length;
  const stream = resumeDeStream(instantiated.landStream);

  const reportByCmd = new Map<
    InstantiatedCommand,
    { attempted: number; placed: number; failures: PlacementFailure[] }
  >();
  const reportFor = (
    cmd: InstantiatedCommand,
  ): { attempted: number; placed: number; failures: PlacementFailure[] } => {
    let entry = reportByCmd.get(cmd);
    if (!entry) {
      entry = { attempted: 0, placed: 0, failures: [] };
      reportByCmd.set(cmd, entry);
    }
    return entry;
  };

  // The land list, in script order. Assigned lands for players not in the
  // game are not created (guide:1015).
  const lands: Pending[] = [];
  const assignedPlayers = new Set<number>();
  for (const cmd of commands) {
    if (cmd.name === "create_player_lands") {
      reportFor(cmd).attempted += playerCount;
      for (let p = 1; p <= playerCount; p++)
        lands.push({
          cmd,
          placed: false,
          origin: newOrigin(cmd, dim, constants, instantiated, p, playerCount),
        });
      continue;
    }
    if (cmd.name !== "create_land") continue;
    const report = reportFor(cmd);
    report.attempted += 1;

    const isAssigned =
      cmd.attributes.has("assign_to") || cmd.attributes.has("assign_to_player");
    if (!isAssigned) {
      const origin = newOrigin(
        cmd,
        dim,
        constants,
        instantiated,
        undefined,
        undefined,
      );
      const pending: Pending = { cmd, placed: false, origin };
      // A neutral land_position holds from the start, so earlier lands'
      // origins already avoid it.
      if (cmd.attributes.has("land_position")) {
        origin.x = landPositionTile(
          percentAttr(cmd, "land_position", 0, 50),
          dim,
        );
        origin.y = landPositionTile(
          percentAttr(cmd, "land_position", 1, 50),
          dim,
        );
        pending.placed = true;
      }
      lands.push(pending);
      continue;
    }

    const resolution = resolveAssignment(
      cmd,
      playerCount,
      teams,
      assignedPlayers,
    );
    if (resolution.colorNoted)
      notes.push({
        key: `atColor:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S1",
        span: cmd.span,
        text: "AT_COLOR is treated the same as AT_PLAYER, since the preview doesn't model colour assignment separately, so this may differ from a real lobby.",
      });
    if (resolution.flagsNoted)
      notes.push({
        key: `assignFlags:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S1",
        span: cmd.span,
        text: "assign_to's Flags argument isn't modelled, so a later assign_to command may pick a different player than in a real game.",
      });
    if (resolution.player === undefined) {
      notes.push({
        key: `landNotCreated:${cmd.span.start}`,
        prominence: "drawer",
        stage: "S1",
        span: cmd.span,
        text: "This land targets a player who isn't in the current lobby size (or no eligible team-mate is left to assign), so the engine doesn't create it.",
      });
      continue;
    }
    assignedPlayers.add(resolution.player);
    lands.push({
      cmd,
      placed: false,
      origin: newOrigin(
        cmd,
        dim,
        constants,
        instantiated,
        resolution.player,
        undefined,
      ),
    });
  }

  runPlayerSetup(stream, instantiated, lands, dim, notes);

  for (const land of lands) {
    if (land.placed) continue;
    if (!placeRemaining(stream, land, lands, dim))
      pushFailure(reportFor(land.cmd).failures, {
        bucket: "originFallbackCenter",
        commandSpan: land.cmd.span,
        stage: "S1",
        entity:
          land.origin.player !== undefined
            ? `player ${land.origin.player}'s land`
            : "land",
        detail: `Every spot tried for this land was too close to another land, ${ORIGIN_CONFLICT_LIMIT} times over, so it was placed at the map center, overlapping whatever is there.`,
      });
  }

  // On every map tested one draw sits here, between the origins and growth,
  // and nothing visible depends on it. Its purpose is unknown (Sec.15 item 51).
  stream.raw();

  const origins = lands.map((land) => land.origin);
  origins.forEach((origin, index) => {
    stampOrigin(grid, index, origin);
    reportFor(lands[index].cmd).placed += 1;
  });

  const reports: CommandReport[] = [];
  for (const [cmd, entry] of reportByCmd)
    reports.push({
      commandSpan: cmd.span,
      stage: "S1",
      attempted: entry.attempted,
      placed: entry.placed,
      failures: entry.failures,
    });

  return { origins, reports, notes, stream: stream.state() };
}

// ---------------------------------------------------------------------------
// Growth, Sec.6.1 rev 9.
//
// Based on genie-rms (https://github.com/genie-js/genie-rms) by Renée Kooi,
// licensed under the GNU General Public License version 3. The growth loop's
// structure, the seed order and the cleanup pass (`cleanTerrainAgainst`)
// began as a modified TypeScript port of `baseLandGenerate` and
// `checkTerrainAndZone` in its `src/LandGenerator.js` and `cleanTerrain` in
// its `src/Map.js`. It was changed on 2026-09-30 and again on 2026-10-14 to
// follow preview-design.md Sec.6.1, whose rev 9 rules come from DE maps
// measured tile for tile. This notice is the one GPL-3.0 section 5 asks for.
// NOTICE and the Credits tab carry the same credit.
//
// THE SHAPE. Every land keeps a queue of candidate tiles ordered by cost.
// Lands take turns popping one tile each, and a claimed tile pushes its four
// neighbours at a cost that falls as more of the land's own zone surrounds
// it, so a high clumping_factor makes a land fill in around itself before it
// reaches outward. Tile state is the game's one byte per tile, a zone, free
// or dead, and zones rather than lands are what the checks read.
// ---------------------------------------------------------------------------

const FREE = 0xfe;
const DEAD = 0xff;

/** A claimed tile's 5x5 window holds at most 25 tiles. Only a zone -12 land, whose zone byte is the free byte, can count the tile itself. */
const MAX_WINDOW_COUNT = 25;

/** The avoidance window's trim factor, the double with bits 0x3FE55553EF6B5D46, just under 2/3. Measured to matter only from distance 6 up, which no map has tested. */
const AVOID_TRIM = ((): number => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0x3fe55553);
  view.setUint32(4, 0xef6b5d46);
  return view.getFloat64(0);
})();

/**
 * Costs are `bounded(100) - cf*n + 250` with `n` in 0..25, and seeds cost 0,
 * so a land can only push 2601 distinct costs, whatever its clumping_factor.
 * The queue indexes by RANK among those, so every land needs the same number
 * of buckets, and two pairs that give an equal cost share a rank, which the
 * tie rule needs (newest first among equal costs).
 */
interface CostRanks {
  seedRank: number;
  /** Rank of `r - cf*n + 250`, at index `n * 100 + r`. */
  claimRank: Int32Array;
  rankCount: number;
}

function buildCostRanks(clumpingFactor: number): CostRanks {
  const costs: number[] = [0];
  for (let n = 0; n <= MAX_WINDOW_COUNT; n++)
    for (let r = 0; r < 100; r++) costs.push(r - clumpingFactor * n + 250);
  const distinct = Array.from(new Set(costs)).sort((a, b) => a - b);
  const rankOf = new Map<number, number>();
  distinct.forEach((cost, rank) => rankOf.set(cost, rank));
  const claimRank = new Int32Array((MAX_WINDOW_COUNT + 1) * 100);
  for (let n = 0; n <= MAX_WINDOW_COUNT; n++)
    for (let r = 0; r < 100; r++)
      claimRank[n * 100 + r] = rankOf.get(r - clumpingFactor * n + 250)!;
  return { seedRank: rankOf.get(0)!, claimRank, rankCount: distinct.length };
}

/** One land's queue, a stack of `(tile, version)` pairs per cost rank, so the newest push at a cost pops first. */
interface LandQueue {
  buckets: (Int32Array | undefined)[];
  /** Entries in each bucket, not array slots, since each entry is two slots. */
  lengths: Int32Array;
  min: number;
}

function createQueue(rankCount: number): LandQueue {
  return {
    buckets: new Array<Int32Array | undefined>(rankCount),
    lengths: new Int32Array(rankCount),
    min: rankCount,
  };
}

/**
 * A tile sits in at most one queue, so pushing it moves it there from
 * wherever it was, another land's queue included. Each tile records which
 * land's queue holds it and a version every push bumps, and an entry left
 * behind in the old queue is skipped when it surfaces. This is lazy
 * deletion, the trick a binary heap without decrease-key uses.
 */
interface QueueIndex {
  queuedBy: Int32Array;
  version: Int32Array;
}

function pushTile(
  index: QueueIndex,
  queue: LandQueue,
  land: number,
  tile: number,
  rank: number,
): void {
  index.queuedBy[tile] = land;
  const version = ++index.version[tile];
  let bucket = queue.buckets[rank];
  const length = queue.lengths[rank];
  if (bucket === undefined) {
    bucket = new Int32Array(8);
    queue.buckets[rank] = bucket;
  } else if (length * 2 + 2 > bucket.length) {
    const grown = new Int32Array(bucket.length * 2);
    grown.set(bucket);
    bucket = grown;
    queue.buckets[rank] = bucket;
  }
  bucket[length * 2] = tile;
  bucket[length * 2 + 1] = version;
  queue.lengths[rank] = length + 1;
  if (rank < queue.min) queue.min = rank;
}

/** Lowest cost first, newest first among equal costs. Returns -1 once nothing live is left. */
function popTile(index: QueueIndex, queue: LandQueue, land: number): number {
  const rankCount = queue.lengths.length;
  while (queue.min < rankCount) {
    const rank = queue.min;
    const length = queue.lengths[rank];
    if (length === 0) {
      queue.min++;
      continue;
    }
    const bucket = queue.buckets[rank]!;
    const tile = bucket[length * 2 - 2];
    const version = bucket[length * 2 - 1];
    queue.lengths[rank] = length - 1;
    if (index.queuedBy[tile] === land && index.version[tile] === version) {
      index.queuedBy[tile] = -1;
      return tile;
    }
  }
  return -1;
}

/**
 * The border chance in percent (Sec.6.1, rev 9). The horizontal excess counts
 * as is. Near a left or right border inset from the map edge, the vertical
 * borders move inward by up to a third of the box's height, which rounds the
 * box's corners. A chance of 100 or more becomes 101, which always refuses.
 */
function borderChance(
  land: LandOrigin,
  x: number,
  y: number,
  dim: number,
): number {
  const f = land.borderFuzziness;
  if (f === 0) return 0;
  const { left, right, top, bottom } = land.borderTiles;
  const hx = Math.max(0, left - x, x - right);
  const q = Math.floor((right - left) / 4);
  const e = Math.max(
    Math.min(q, dim - right) + (x - right),
    Math.min(q, left) + (left - x),
  );
  const s = e > 0 ? Math.min(e, Math.floor((bottom - top) / 3)) : 0;
  const vy = Math.max(0, top - y + s, y - bottom + s);
  const chance = f * (hx + vy);
  return chance >= 100 ? 101 : chance;
}

/**
 * Sec.6.1 rev 9, growth and the leftover fill. Grows every land from its
 * stamp, on the game's stream as `placeLandOrigins` left it, then empties
 * each land's queue through the leftover fill. Mutates `grid.landId` and
 * `grid.zone`, and appends a `growthShortfall` to the land's command report
 * when it ends below its target.
 *
 * Expects `grid` exactly as `placeLandOrigins` left it. Also writes each
 * land's `height` into `grid.elevation` where the game does (Sec.6.1, rev
 * 10), on its stamp, on its claims and on every leftover cell whose roll
 * passes, later writes winning. Returns the stream where growth left it,
 * which the cleanup and the elevation and cliff stages continue.
 *
 * NO STEP CAP, and that is a fact about the work rather than an omission.
 * Every pop removes a queue entry, entries only come from seeding and from
 * claims, and each claim adds at most four, so growth ends on its own.
 */
export function growLands(
  origins: readonly LandOrigin[],
  grid: TileGrid,
  reports: readonly CommandReport[],
  streamState: DeStreamState,
): DeStreamState {
  const { dim } = grid;
  const tileCount = dim * dim;
  const stream = resumeDeStream(streamState);
  const reportBySpan = new Map<string, CommandReport>();
  for (const report of reports)
    reportBySpan.set(
      `${report.commandSpan.start}-${report.commandSpan.end}`,
      report,
    );

  const zones = new Uint8Array(tileCount).fill(FREE);
  const bytes = origins.map((origin) => zoneByte(origin.zone));
  const index: QueueIndex = {
    queuedBy: new Int32Array(tileCount).fill(-1),
    version: new Int32Array(tileCount),
  };
  const ranksByCf = new Map<number, CostRanks>();
  const ranks = origins.map((origin) => {
    let table = ranksByCf.get(origin.clumpingFactor);
    if (table === undefined) {
      table = buildCostRanks(origin.clumpingFactor);
      ranksByCf.set(origin.clumpingFactor, table);
    }
    return table;
  });
  const queues = ranks.map((table) => createQueue(table.rankCount));
  const radii = origins.map(conformityRadius);

  // Stamps, counters and seeds, land by land in script order. Seeding never
  // reads a zone, so replaying the stamps here gives the state the game has.
  const counters = new Int32Array(Math.max(256, origins.length));
  origins.forEach((origin, land) => {
    const { minX, maxX, minY, maxY } = stampBounds(origin, dim);
    if (minX > maxX || minY > maxY) return;
    const h = stampHalfSize(origin);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++)
        if (!origin.circularBase || inCircularStamp(origin, h, x, y)) {
          zones[y * dim + x] = bytes[land];
          grid.elevation[y * dim + x] = origin.height;
        }

    // The counter is the clipped square, even for a circular stamp. Under
    // behavior_version 0 it is not this land's counter that is set but the
    // counter of land number `zone byte`, when that is not past this land,
    // the 1.0c quirk (measured, `land4-grow`).
    const tiles = (maxX - minX + 1) * (maxY - minY + 1);
    if (origin.behaviorVersion >= 1) counters[land] = tiles;
    else if (bytes[land] <= land) counters[bytes[land]] = tiles;

    // The cells just outside the square, in the game's order. A circular
    // stamp seeds like a square one.
    const { seedRank } = ranks[land];
    const queue = queues[land];
    if (minX > 0)
      for (let y = minY; y <= maxY; y++)
        pushTile(index, queue, land, y * dim + minX - 1, seedRank);
    if (minY > 0)
      for (let x = minX; x <= maxX; x++)
        pushTile(index, queue, land, (minY - 1) * dim + x, seedRank);
    if (maxX < dim - 1)
      for (let y = minY; y <= maxY; y++)
        pushTile(index, queue, land, y * dim + maxX + 1, seedRank);
    if (maxY < dim - 1)
      for (let x = minX; x <= maxX; x++)
        pushTile(index, queue, land, (maxY + 1) * dim + x, seedRank);
  });

  /** A conformity roll, one draw whatever the land's `land_conformity`. */
  const conforms = (land: number, x: number, y: number): boolean => {
    const origin = origins[land];
    if (stream.bounded(100) > origin.landConformity) return true;
    const rho = radii[land];
    if (origin.circularBase) {
      const dx = x - origin.x;
      const dy = y - origin.y;
      return dx * dx + dy * dy <= rho * rho;
    }
    return (
      x >= Math.max(origin.x - rho, 0) &&
      x <= Math.min(origin.x + rho, dim - 1) &&
      y >= Math.max(origin.y - rho, 0) &&
      y <= Math.min(origin.y + rho, dim - 1)
    );
  };

  // Round robin in script order, one pop per land below its target, until a
  // whole round pops nothing.
  let popped = true;
  while (popped) {
    popped = false;
    for (let land = 0; land < origins.length; land++) {
      const origin = origins[land];
      if (origin.landConformity >= 100 || counters[land] >= origin.target)
        continue;
      const tile = popTile(index, queues[land], land);
      if (tile < 0) continue;
      popped = true;
      const x = tile % dim;
      const y = (tile - x) / dim;
      const own = bytes[land];

      // 1. The count n and the verdict, on the state as it is now, no draw.
      // A cell that is not free counts 0 and is refused.
      let n = 0;
      let refuse = zones[tile] !== FREE;
      if (!refuse) {
        for (let ny = Math.max(0, y - 2); ny <= Math.min(dim - 1, y + 2); ny++)
          for (
            let nx = Math.max(0, x - 2);
            nx <= Math.min(dim - 1, x + 2);
            nx++
          )
            if (zones[ny * dim + nx] === own) n++;
        // Avoidance reads only this land's own distance, and the two top-row
        // corners of its square are trimmed.
        const a = Math.trunc(origin.otherZoneAvoidanceDistance);
        const o = Math.max(Math.trunc(a * AVOID_TRIM), 2);
        for (let dy = -a; dy <= a && !refuse; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= dim) continue;
          const reach = dy >= -o ? a : o + a - Math.abs(dy);
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= dim) continue;
            const z = zones[ny * dim + nx];
            if (z !== own && z !== FREE && z !== DEAD) {
              refuse = true;
              break;
            }
          }
        }
        // A cell with none of this land's zone around it is refused too,
        // which is how a buried land is lost (RMSTEST_53).
        if (n === 0) refuse = true;
      }

      // 2. The border roll, always drawn. It kills the cell even when
      // another land holds it.
      const r = stream.bounded(100);
      if (origin.landConformity <= 0 && borderChance(origin, x, y, dim) > r) {
        zones[tile] = DEAD;
        continue;
      }
      // 3. The conformity roll. A failure leaves the cell as it is.
      if (!conforms(land, x, y)) continue;
      // 4. The verdict from step 1.
      if (refuse) continue;

      // 5. Claim.
      zones[tile] = own;
      grid.landId[tile] = land;
      grid.zone[tile] = origin.zone;
      grid.elevation[tile] = origin.height;
      counters[land]++;

      // 6. Neighbours, left, right, up, down. A conformity roll for each,
      // drawn whatever the neighbour is, then a cost draw for each one free.
      const { claimRank } = ranks[land];
      const queue = queues[land];
      const row = Math.min(n, MAX_WINDOW_COUNT) * 100;
      const neighbours: [number, number][] = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (!conforms(land, nx, ny)) continue;
        if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue;
        const neighbour = ny * dim + nx;
        if (zones[neighbour] !== FREE) continue;
        pushTile(
          index,
          queue,
          land,
          neighbour,
          claimRank[row + stream.bounded(100)],
        );
      }
    }
  }

  origins.forEach((origin, land) => {
    if (origin.landConformity >= 100 || counters[land] >= origin.target) return;
    const report = reportBySpan.get(
      `${origin.commandSpan.start}-${origin.commandSpan.end}`,
    );
    if (report === undefined) return;
    pushFailure(report.failures, {
      bucket: "growthShortfall",
      commandSpan: origin.commandSpan,
      stage: "S1",
      entity:
        origin.player !== undefined ? `player ${origin.player}'s land` : "land",
      detail: `This land grew to ${counters[land]} of its ${origin.target}-tile target before running out of places to grow.`,
      data: { owned: counters[land], target: origin.target },
    });
  });

  // The leftover fill. Each land in script order empties its queue, one
  // conformity draw per cell, and a cell between two of the land's own
  // cells, across or down, takes the land's terrain. The game changes only
  // the terrain here, not the zone and not the counter, and reads the zones
  // as growth left them, so one fill never enables another. Writing
  // `grid.landId` as well keeps it meaning "painted by this land in S1",
  // which `paintLandTerrain` and every later stage read [modelling choice].
  //
  // The height goes on every cell whose roll passes, terrain or not (lh2).
  // That is why a raised land stands on a rim of raised base terrain.
  origins.forEach((origin, land) => {
    const own = bytes[land];
    const queue = queues[land];
    for (
      let tile = popTile(index, queue, land);
      tile >= 0;
      tile = popTile(index, queue, land)
    ) {
      const x = tile % dim;
      const y = (tile - x) / dim;
      if (!conforms(land, x, y)) continue;
      grid.elevation[tile] = origin.height;
      const across =
        x >= 1 &&
        x < dim - 1 &&
        zones[tile - 1] === own &&
        zones[tile + 1] === own;
      const down =
        y >= 1 &&
        y < dim - 1 &&
        zones[tile - dim] === own &&
        zones[tile + dim] === own;
      if (!across && !down) continue;
      grid.landId[tile] = land;
      grid.zone[tile] = origin.zone;
    }
  });
  return stream.state();
}

/**
 * The cleanup pass, `cleanTerrain` from genie-rms run over the whole map
 * against one reference terrain. Returns how many tiles it changed.
 *
 * Sweeps repeat until one changes nothing. A sweep is two row-major passes,
 * and a change takes effect at once, so a later tile in the same pass sees
 * it. Pass 0 turns a tile whose upper and lower neighbours are both the
 * reference, or whose left and right ones are, into the reference. Pass 1
 * does the same by the port's diagonal patterns, transcribed exactly from
 * `Map.js` with its asymmetries kept. Both passes match DE on every map in
 * the land-stage fixture (Sec.15 item 46 closed, rev 9).
 *
 * A neighbour off the map never counts as the reference. So a tile on the
 * map's edge needs the reference on the side still inside the map and the
 * pinch along the edge, and a corner tile is pinched by neither pair. DE does
 * the same, since reading off-map neighbours as the reference puts 8 of the
 * fixture's 111 maps out by 1 to 5 tiles (2026-10-20). This is why a
 * one-tile land at `land_position 99 0` survives on Tiny, where 99% rounds
 * to the last column, and vanishes from Medium up, where it rounds one
 * column in and has the reference on both sides.
 *
 * `onChange` runs for each changed tile with the terrain it had, for the
 * caller's bookkeeping.
 */
export function cleanTerrainAgainst(
  grid: TileGrid,
  reference: number,
  onChange?: (tile: number, formerTerrain: number) => void,
): number {
  const { dim, terrain } = grid;
  const base = reference;
  const last = dim - 1;
  let changedCount = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          const i = y * dim + x;
          if (terrain[i] === base) continue;
          const top = y > 0 && terrain[i - dim] === base;
          const bottom = y < last && terrain[i + dim] === base;
          const left = x > 0 && terrain[i - 1] === base;
          const right = x < last && terrain[i + 1] === base;

          let revert: boolean;
          if (pass === 0) {
            revert = (top && bottom) || (left && right);
          } else {
            const topLeft = y > 0 && x > 0 && terrain[i - dim - 1] === base;
            const topRight = y > 0 && x < last && terrain[i - dim + 1] === base;
            const bottomLeft =
              y < last && x > 0 && terrain[i + dim - 1] === base;
            const bottomRight =
              y < last && x < last && terrain[i + dim + 1] === base;
            let should =
              topLeft &&
              ((topRight && !top) ||
                (right && !topRight) ||
                (bottomLeft && !left) ||
                (bottom && !bottomLeft) ||
                (bottomRight && !bottom && !right));
            should ||=
              topRight &&
              ((topLeft && !top) ||
                (left && !topLeft) ||
                (bottomRight && !right) ||
                (bottom && !bottomRight) ||
                (bottomLeft && !left && !bottom));
            should ||=
              bottomRight &&
              ((topRight && !right) ||
                (top && !topRight) ||
                (bottomLeft && !bottom) ||
                (left && !bottomLeft) ||
                (topLeft && !left && !top));
            revert = !bottomLeft
              ? should
              : should ||
                (topLeft && !left) ||
                (top && !topLeft) ||
                (bottomRight && !bottom) ||
                (right && !bottomRight) ||
                (topRight && !right && !top);
          }
          if (!revert) continue;
          const former = terrain[i];
          terrain[i] = base;
          onChange?.(i, former);
          changedCount++;
          changed = true;
        }
      }
    }
  }
  return changedCount;
}

/**
 * The cleanup against `base_terrain`, after painting. A reverted tile takes
 * the base terrain back and leaves its land. A land painted in the base
 * terrain, or one that paints nothing, is invisible to this pass, which is
 * what the engine does. The tile keeps its height and gets no layer back
 * (Sec.6.1, rev 10).
 *
 * `restore` is the game's stream with the base terrain's decoration draws.
 * Each restored tile spends them at once, 3 for GRASS and none for DESERT
 * (gr1, four vanished 4-tile lands moved every hill and cliff on the map).
 * Only the count of draws matters, since nothing reads them, so they are
 * taken as raw draws in the cleanup's own order. Without `restore` no draw is
 * taken, which is right for a test that stops at the land stage.
 *
 * `onRevert` hears each reverted tile with its terrain and land from before,
 * since the tile has lost both by the time the pass returns.
 */
export function cleanLandTerrain(
  grid: TileGrid,
  baseTerrainId: number,
  restore?: { stream: DeStream; draws: number },
  onRevert?: CleanupListener,
): number {
  return cleanTerrainAgainst(grid, baseTerrainId, (i, formerTerrain) => {
    const formerLand = grid.landId[i];
    grid.landId[i] = -1;
    grid.zone[i] = 0;
    if (restore) for (let d = 0; d < restore.draws; d++) restore.stream.raw();
    onRevert?.(i, formerTerrain, formerLand);
  });
}

/** One tile a cleanup pass changed, with the terrain and land index (-1 for none) it had. */
export type CleanupListener = (
  tile: number,
  formerTerrain: number,
  formerLand: number,
) => void;

/**
 * The land stage's last steps as the game runs them (Sec.6.1, rev 10).
 * Paints the lands, clears the layer on every painted tile and runs the
 * cleanup against the base terrain, whose restored tiles spend the base
 * terrain's decoration draws. Returns the stream after those draws, where
 * the elevation stage starts.
 *
 * One function rather than three calls in `index.ts`, because the three only
 * reproduce the game in this order and with the stream threaded through, and
 * every test helper that runs the land stage needs exactly the same.
 */
export function finishLandStage(
  origins: readonly LandOrigin[],
  grid: TileGrid,
  baseTerrainId: number,
  constants: readonly TerrainConstantForMasks[],
  streamState: DeStreamState,
  onRevert?: CleanupListener,
): DeStreamState {
  paintLandTerrain(origins, grid);
  const stream = resumeDeStream(streamState);
  cleanLandTerrain(
    grid,
    baseTerrainId,
    {
      stream,
      draws: decorationDrawsOf(terrainClassTable(constants), baseTerrainId),
    },
    onRevert,
  );
  return stream.state();
}

/**
 * The same cleanup against WATER (Sec.6.4, rev 9). A tile that is not water
 * with water on both sides, or in the diagonal patterns, becomes water, base
 * terrain included. The original game runs it as the terrain stage's last
 * step, and DE does too on every water map measured. Only the terrain
 * changes. The tile keeps its land, as the game keeps its zone.
 */
export function cleanWaterTerrain(grid: TileGrid, waterId: number): number {
  return cleanTerrainAgainst(grid, waterId);
}

// ---------------------------------------------------------------------------
// terrain_type (Sec.6.1), like base_elevation below, strictly AFTER growth,
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
 * ever wrote `terrain`. So every stage from S1 on saw a grid that was 100%
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
 * overwrite earlier ones for free. `grid.landId` already resolved every
 * overlap, so a tile is painted exactly once here, by whichever land holds
 * it.
 *
 * A land whose `terrain_type` is absent or unresolvable paints nothing and
 * leaves the base fill showing, which is what the engine does with an
 * attribute it cannot read.
 */
/**
 * How many tiles each land actually ended up owning, indexed the same way as
 * `origins` and `grid.landId`. A later land overwrites an earlier one's
 * tiles, so this is the only place "how many tiles does land N have" can be
 * answered correctly. Growth's own running figure of the same quantity
 * cannot see a later land's overwrite. Shared by `index.ts`'s
 * `collectLandOutcomes` (Sec.15 item 5's failure marks) and by
 * `runPreview.ts`'s `PreviewSummary.landOrigins[].tiles`
 * (land-placement-design.md Sec.3.4 layer 1). One O(dim²) definition rather
 * than two that could drift.
 */
export function countOwnedTiles(
  origins: readonly LandOrigin[],
  grid: TileGrid,
): Int32Array {
  const owned = new Int32Array(origins.length);
  for (let index = 0; index < grid.landId.length; index++) {
    const landId = grid.landId[index];
    // -1 is base terrain (grid.ts), and a defensive upper bound because
    // landId is an Int16Array whose values are written by one function.
    if (landId >= 0 && landId < origins.length) owned[landId]++;
  }
  return owned;
}

export function paintLandTerrain(
  origins: readonly LandOrigin[],
  grid: TileGrid,
): void {
  // Indexed by the same land index `grid.landId` stores, so the grid scan
  // below is one array read per tile rather than a lookup per tile.
  // -1 = this land paints nothing.
  const terrainByLand = new Int32Array(origins.length).fill(-1);
  origins.forEach((origin, index) => {
    if (origin.terrainId !== undefined) terrainByLand[index] = origin.terrainId;
  });
  // Every tile a land painted loses the base layer, which then marks only
  // the tiles no land reached (ly1, DE's saved layers match tile for tile).
  for (let i = 0; i < grid.landId.length; i++) {
    const landIndex = grid.landId[i];
    if (landIndex < 0) continue;
    grid.layer[i] = NO_LAYER;
    const terrainId = terrainByLand[landIndex];
    if (terrainId >= 0) grid.terrain[i] = terrainId;
  }
}

// ---------------------------------------------------------------------------
// base_elevation (Sec.6.1, rev 10). Growth writes the heights as it goes
// (`LandOrigin.height`), so all that is left here is what to tell the author.
// ---------------------------------------------------------------------------

/**
 * Sec.6.1: negative H maximally elevates (-> 16, CONFIRMED in-game, a -1
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
 * One note per raised land in a script with no `<ELEVATION_GENERATION>`
 * section. The heights still stand (lh2, DE saved them as written), but with
 * no section nothing smooths them, so the land rises from the base in a sheer
 * step. The guide also says the game crashes when such a map is played,
 * which the scenario editor cannot show, so the note passes that on as the
 * guide's claim.
 */
export function baseElevationNotes(
  instantiated: InstantiatedScript,
  origins: readonly LandOrigin[],
): SimulationNote[] {
  if (instantiated.sections.has("ELEVATION_GENERATION")) return [];
  return origins
    .filter((origin) => origin.height > 0)
    .map((origin) => ({
      key: `baseElevationNoSection:${origin.commandSpan.start}`,
      prominence: "drawer" as const,
      stage: "S1" as const,
      span: origin.commandSpan,
      text: "This land is raised with base_elevation, but the script has no <ELEVATION_GENERATION> section, so nothing smooths the slope and the land rises from the ground in one sheer step. The guide also warns that the game crashes when a map like this is played, and its fix is an <ELEVATION_GENERATION> section, which may be empty.",
    }));
}
