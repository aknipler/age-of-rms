// S5: connections, docs/preview-design.md Sec.6.5 (rev 11). PURE (CLAUDE.md
// hard rule / preview-design Sec.2).
//
// THIS STAGE REPRODUCES THE GAME TILE FOR TILE. It is the connection stage
// the owner's DE study measured (`tools/scenario-probe/de-study/evidence/
// de-connections-objects.md` Sections 2 and 3, rounds CO and CF, and
// `de-findings-cg-cj.md` 5.3), on the same stream as every stage before it.
//
// THE MODEL, in brief.
//   - The section burns one draw. Each `create_connect_*` builds a table of
//     cost, size, variance and replacement per terrain, and a list of
//     endpoints, which are land origins. Every pair of endpoints, in order,
//     gets one path.
//   - A path is a best-first search over 8 neighbours, not a shortest path. A
//     tile is queued once, when first reached, and never improved, so the
//     heuristic's quirks shape the road.
//   - Each tile of the path but the target paints a rectangle whose four
//     sides each reach a random distance, and then every tile of the path's
//     rectangles takes its terrain's replacement.
//   - Between commands the game undoes each command's paint except where the
//     command painted a tile twice, and puts every road back at the end. So
//     commands do not see each other's roads, unless `accumulate_connections`
//     says they should.
//   - `create_connect_teams_lands` and `create_connect_to_nonplayer_land`
//     each turn into several commands. The second one's copies overwrite the
//     commands after it, which is the guide's "blocks the commands after it"
//     seen exactly.
//
// The stage reads terrain as painted. A tile the terrain stage painted with a
// composite terrain still reads as the composite here, though the map shows
// it resolved (`CompositeRecord` in terrains.ts).
//
// This file replaced a multi-goal Dijkstra with disc painting, grouping
// `same_land_zones` by zone, and a frozen snapshot per command. Each was a
// reasonable reading of the guide and each is refuted by a DE map. Its
// history is in docs/build-log.md.

import { timeCommand } from "./generationTiming";
import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  LandOrigin,
  PlacementFailure,
  SimulationNote,
  TileGrid,
} from "./types";
import { resumeDeStream, type DeStream, type DeStreamState } from "./deRandom";
import { f32Add, f32Mul, f32Sqrt, f32Sub } from "./float32";
import {
  NO_LAYER,
  resolveTerrainId,
  type TerrainConstantForMasks,
} from "./grid";
import { pushFailure } from "./placement";
import { COMPOSITE_AS_TERRAIN, type CompositeRecord } from "./terrains";

/** Table entries per command. Terrain ids end below 200 in the dat. */
const TABLE_SIZE = 256;
const NO_REPLACEMENT = -1;
/** The cost factor of a diagonal step. */
const DIAGONAL = 1.36;

const CONNECT_COMMAND_NAMES = new Set([
  "create_connect_all_players_land",
  "create_connect_teams_lands",
  "create_connect_all_lands",
  "create_connect_same_land_zones",
  "create_connect_land_zones",
  "create_connect_to_nonplayer_land",
]);

// ---------------------------------------------------------------------------
// One command's table (2.2)
// ---------------------------------------------------------------------------

interface ConnectionTable {
  cost: Float64Array;
  size: Int32Array;
  variance: Int32Array;
  replacement: Int32Array;
}

function defaultTable(): ConnectionTable {
  return {
    cost: new Float64Array(TABLE_SIZE).fill(1),
    size: new Int32Array(TABLE_SIZE).fill(1),
    variance: new Int32Array(TABLE_SIZE),
    replacement: new Int32Array(TABLE_SIZE).fill(NO_REPLACEMENT),
  };
}

/** What the empty commands of `to_nonplayer_land`'s bug hold, cost 0 everywhere. */
function closedTable(): ConnectionTable {
  const table = defaultTable();
  table.cost.fill(0);
  return table;
}

/**
 * The command's attributes applied in script order, so a
 * `default_terrain_replacement` after a `replace_terrain` overwrites it and
 * one before it does not. The folded attribute map loses the order between
 * different names, so every occurrence is gathered and sorted by position.
 */
function readTable(
  cmd: InstantiatedCommand,
  instantiated: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
): ConnectionTable {
  const table = defaultTable();
  const terrain = (value: unknown): number | undefined => {
    const id = resolveTerrainId(
      constants,
      value as string | number | undefined,
      instantiated.symbols,
      instantiated.aliases,
    );
    return id !== undefined && id >= 0 && id < TABLE_SIZE ? id : undefined;
  };
  const occurrences = [
    "default_terrain_replacement",
    "replace_terrain",
    "terrain_cost",
    "terrain_size",
  ]
    .flatMap((name) => cmd.attributes.get(name) ?? [])
    .sort((a, b) => a.span.start - b.span.start);
  for (const attr of occurrences) {
    const [a, b, c] = attr.args;
    const number = (arg: typeof a): number | undefined =>
      arg?.exact ?? (typeof arg?.value === "number" ? arg.value : undefined);
    switch (attr.name) {
      case "default_terrain_replacement": {
        const to = terrain(a?.value);
        if (to !== undefined) table.replacement.fill(to);
        break;
      }
      case "replace_terrain": {
        const from = terrain(a?.value);
        const to = terrain(b?.value);
        if (from !== undefined && to !== undefined)
          table.replacement[from] = to;
        break;
      }
      case "terrain_cost": {
        // A decimal cost is kept (cn4 crosses a FOREST wall at 2.5).
        const id = terrain(a?.value);
        const cost = number(b);
        if (id !== undefined && cost !== undefined) table.cost[id] = cost;
        break;
      }
      case "terrain_size": {
        const id = terrain(a?.value);
        const size = number(b);
        if (id !== undefined && size !== undefined) {
          table.size[id] = Math.trunc(size);
          table.variance[id] = Math.trunc(number(c) ?? 0);
        }
        break;
      }
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// The command list (2.3)
// ---------------------------------------------------------------------------

/** One command as the stage runs it, after the team and non-player copies. */
interface Connection {
  /** The script's command, for its report. Absent on the empty commands of the non-player bug. */
  cmd?: InstantiatedCommand;
  table: ConnectionTable;
  /** Land indices, in the order their pairs are made. */
  endpoints: number[];
}

function playerLands(
  origins: readonly LandOrigin[],
  player?: number,
): number[] {
  const out: number[] = [];
  origins.forEach((o, i) => {
    if (o.player !== undefined && (player === undefined || o.player === player))
      out.push(i);
  });
  return out;
}

/** The lobby's teams in slot order, each a list of players. A player without a team is a team of one. */
function teamsInSlotOrder(teams: InstantiatedScript["teams"]): number[][] {
  const out: number[][] = [];
  const byTeam = new Map<number, number[]>();
  teams.canonical.forEach((team, index) => {
    const player = index + 1;
    if (team === 0) {
      out.push([player]);
      return;
    }
    const members = byTeam.get(team);
    if (members) members.push(player);
    else {
      const list = [player];
      byTeam.set(team, list);
      out.push(list);
    }
  });
  return out;
}

/**
 * The list the stage runs, the script's commands with the team copies
 * added at the end and `to_nonplayer_land`'s copies written over the
 * commands after it (2.3, cn7a to cn7e and k2).
 */
function buildConnections(
  commands: readonly InstantiatedCommand[],
  instantiated: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
): Connection[] {
  const list: Connection[] = [];
  const pending: { index: number; kind: string; original: Connection }[] = [];
  for (const cmd of commands) {
    const table = readTable(cmd, instantiated, constants);
    let endpoints: number[] = [];
    switch (cmd.name) {
      case "create_connect_all_players_land":
        endpoints = playerLands(origins);
        break;
      // `same_land_zones` is `all_lands`, every land (k10a and k10b give
      // identical maps).
      case "create_connect_all_lands":
      case "create_connect_same_land_zones":
        endpoints = origins.map((_, i) => i);
        break;
      case "create_connect_land_zones": {
        const zoneA = cmd.args[0]?.value;
        const zoneB = cmd.args[1]?.value;
        const inZone = (zone: unknown) =>
          origins.flatMap((o, i) => (o.zone === zone ? [i] : []));
        endpoints = [...inZone(zoneA), ...inZone(zoneB)];
        break;
      }
    }
    const connection: Connection = { cmd, table, endpoints };
    if (
      cmd.name === "create_connect_teams_lands" ||
      cmd.name === "create_connect_to_nonplayer_land"
    )
      pending.push({
        index: list.length,
        kind: cmd.name,
        original: connection,
      });
    list.push(connection);
  }

  // The copies, in list order, once every script command is in the list.
  for (const { index, kind, original } of pending) {
    // A command an earlier non-player copy wrote over never runs, and so
    // never makes copies of its own.
    if (list[index] !== original) continue;
    if (kind === "create_connect_teams_lands") {
      const teams = teamsInSlotOrder(instantiated.teams);
      const lands = (team: number[]) =>
        team.flatMap((player) => playerLands(origins, player));
      original.endpoints = teams.length > 0 ? lands(teams[0]) : [];
      for (const team of teams.slice(1))
        list.push({ ...original, endpoints: lands(team) });
      continue;
    }
    // `to_nonplayer_land`. Each player land adds p + 1 empty commands at the
    // end, then writes a copy over the command p + 1 places after this one.
    const copies: Connection[] = [];
    let p = 0;
    origins.forEach((origin, land) => {
      if (origin.player === undefined) {
        original.endpoints.push(land);
        for (const copy of copies) copy.endpoints.push(land);
        return;
      }
      for (let k = 0; k <= p; k++)
        list.push({ table: closedTable(), endpoints: [] });
      const copy: Connection = {
        cmd: original.cmd,
        table: original.table,
        endpoints: [
          ...original.endpoints.filter((i) => origins[i].player === undefined),
          land,
        ],
      };
      list[index + p + 1] = copy;
      copies.push(copy);
      p++;
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// The path search (3.1)
// ---------------------------------------------------------------------------

/** Down, up, left, up-left, down-left, right, up-right, down-right. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
  [1, 0],
  [1, -1],
  [1, 1],
];

/**
 * A binary heap of tiles by priority where a tie goes to the tile queued
 * LAST, the game's own rule, which a plain heap does not keep. The sequence
 * number breaks the tie.
 */
class PathQueue {
  private tiles: number[] = [];
  private keys: number[] = [];
  private seqs: number[] = [];
  private counter = 0;

  get size(): number {
    return this.tiles.length;
  }

  private before(a: number, b: number): boolean {
    return (
      this.keys[a] < this.keys[b] ||
      (this.keys[a] === this.keys[b] && this.seqs[a] > this.seqs[b])
    );
  }

  private swap(a: number, b: number): void {
    [this.tiles[a], this.tiles[b]] = [this.tiles[b], this.tiles[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.seqs[a], this.seqs[b]] = [this.seqs[b], this.seqs[a]];
  }

  push(tile: number, key: number): void {
    let i = this.tiles.length;
    this.tiles.push(tile);
    this.keys.push(key);
    this.seqs.push(this.counter++);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.tiles[0];
    const last = this.tiles.length - 1;
    this.swap(0, last);
    this.tiles.pop();
    this.keys.pop();
    this.seqs.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (l < this.tiles.length && this.before(l, best)) best = l;
      if (r < this.tiles.length && this.before(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
    return top;
  }
}

/**
 * One pair's path, from `start` to `target`, as tiles from the target back
 * to the start. Undefined when there is none.
 *
 * The cost of a tile at or below 0 closes it. The target's own cost is
 * checked first and the start's never, so a cost-0 origin blocks the paths
 * arriving at it and not the ones leaving it (cn5a and cn5b). The heuristic
 * h comes from the CURRENT tile's distance to the target, adjusted per step,
 * and the arithmetic is in single precision as the game's is.
 */
function findPath(
  view: Uint16Array,
  dim: number,
  table: ConnectionTable,
  start: number,
  target: number,
  parent: Int32Array,
  seen: Uint8Array,
): number[] | undefined {
  const costOf = (i: number): number => {
    const t = view[i];
    return t < TABLE_SIZE ? table.cost[t] : 1;
  };
  if (costOf(target) <= 0) return undefined;
  seen.fill(0);
  const tx = target % dim;
  const ty = (target - tx) / dim;
  const cumulative = new Map<number, number>();
  const queue = new PathQueue();
  let current = start;
  let currentCost = 0;
  seen[start] = 1;
  parent[start] = -1;

  for (;;) {
    const cx = current % dim;
    const cy = (current - cx) / dim;
    const ddx = tx - cx;
    const ddy = ty - cy;
    const d = f32Sqrt(ddx * ddx + ddy * ddy);
    if (d === 0) break;
    let found = false;
    for (const [sx, sy] of STEPS) {
      const nx = cx + sx;
      const ny = cy + sy;
      const next = ny * dim + nx;
      if (next === target && nx >= 0 && ny >= 0 && nx < dim && ny < dim) {
        parent[target] = current;
        found = true;
        break;
      }
      if (nx < 0 || ny < 0 || nx >= dim || ny >= dim || seen[next] !== 0)
        continue;
      const cost = costOf(next);
      if (cost <= 0) {
        seen[next] = 1;
        continue;
      }
      const diagonal = sx !== 0 && sy !== 0;
      // No corner cutting, and the refused diagonal is not marked.
      if (
        diagonal &&
        (costOf(cy * dim + nx) <= 0 || costOf(ny * dim + cx) <= 0)
      )
        continue;
      const step = f32Add(currentCost, f32Mul(cost, diagonal ? DIAGONAL : 1));
      // Minus where the step moves toward the target on that axis.
      const towardX = sx !== 0 && Math.sign(sx) === Math.sign(ddx);
      const towardY = sy !== 0 && Math.sign(sy) === Math.sign(ddy);
      let h: number;
      if (!diagonal)
        h =
          sx !== 0
            ? towardX
              ? f32Sub(d, 1)
              : f32Add(d, 1)
            : towardY
              ? f32Sub(d, 1)
              : f32Add(d, 1);
      else {
        h = towardX ? f32Sub(d, 1) : f32Add(d, 1);
        // The left diagonals use 0.41 and the right ones 0.4.
        const yPart = sx < 0 ? 0.41 : 0.4;
        h = towardY ? f32Sub(h, yPart) : f32Add(h, yPart);
      }
      seen[next] = 1;
      parent[next] = current;
      cumulative.set(next, step);
      queue.push(next, f32Add(step, h));
    }
    if (found) break;
    if (queue.size === 0) return undefined;
    current = queue.pop();
    currentCost = cumulative.get(current) ?? 0;
  }

  const path: number[] = [];
  for (let i = target; i !== -1; i = parent[i]) {
    path.push(i);
    if (i === start) break;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Painting (3.2) and the undo between commands (3.3)
// ---------------------------------------------------------------------------

/** What a command's paint did, for the undo between commands. */
interface PaintLog {
  /** Each tile's terrain just before this command's latest paint of it. */
  beforeLast: Map<number, number>;
}

/**
 * Paints one path. The centres are the path's tiles from the one next to
 * the target back to the start, so the start is painted and the target is
 * not (cn1). Each centre reads the size and variance of the terrain under it
 * NOW, and spends four draws, left, top, right and bottom, even at variance
 * 0 (cn3a). Then every tile of the path's rectangles takes its terrain's
 * replacement, so sizes come from the terrain before this path, and a later
 * path of the same command sees this one's paint (cn6a).
 */
function paintPath(
  view: Uint16Array,
  dim: number,
  table: ConnectionTable,
  path: readonly number[],
  stream: DeStream,
  inSet: Uint8Array,
  log: PaintLog,
  finalPaint: Map<number, number>,
): void {
  const set: number[] = [];
  for (let k = 1; k < path.length; k++) {
    const centre = path[k];
    const x = centre % dim;
    const y = (centre - x) / dim;
    const t = view[centre];
    const s = t < TABLE_SIZE ? table.size[t] : 1;
    const v = t < TABLE_SIZE ? table.variance[t] : 0;
    const left = stream.bounded(2 * v);
    const top = stream.bounded(2 * v);
    const right = stream.bounded(2 * v);
    const bottom = stream.bounded(2 * v);
    const x0 = Math.max(x - (s - v + left), 0);
    const x1 = Math.min(x + (s - v + right), dim - 1);
    const y0 = Math.max(y - (s - v + top), 0);
    const y1 = Math.min(y + (s - v + bottom), dim - 1);
    for (let ny = y0; ny <= y1; ny++)
      for (let nx = x0; nx <= x1; nx++) {
        const i = ny * dim + nx;
        if (inSet[i] === 0) {
          inSet[i] = 1;
          set.push(i);
        }
      }
  }
  for (const i of set) {
    inSet[i] = 0;
    const t = view[i];
    const to = t < TABLE_SIZE ? table.replacement[t] : NO_REPLACEMENT;
    if (to === NO_REPLACEMENT) continue;
    log.beforeLast.set(i, t);
    finalPaint.set(i, to);
    view[i] = to;
  }
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface ConnectionsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
  /** The game's stream after this stage. */
  stream: DeStreamState;
}

function landLabel(origins: readonly LandOrigin[], index: number): string {
  const origin = origins[index];
  return origin.player !== undefined ? `P${origin.player}` : `N${index}`;
}

/**
 * Sec.6.5: `<CONNECTION_GENERATION>`. Mutates `grid.terrain` and
 * `grid.layer`, and `composites` for every tile it repaints. Returns one
 * report per script command and the stream. With no section nothing
 * happens and no draw is spent. The WATER cleanup and beach that end the
 * stage are `index.ts`'s, as at the end of the terrain stage.
 *
 * `composites` is the terrain stage's record of composite terrains as
 * painted (`resolveComposites`). The stage runs on a view of the map with
 * those put back, and a tile whose value it changes takes the new terrain
 * and stops being a composite. A tile any command painted loses its layer,
 * even where the undo gave its terrain back (Pag).
 */
export function applyConnections(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  streamState: DeStreamState,
  composites?: CompositeRecord,
): ConnectionsResult {
  const section = instantiated.sections.get("CONNECTION_GENERATION");
  if (section === undefined)
    return { reports: [], notes: [], stream: streamState };
  const stream = resumeDeStream(streamState);
  stream.raw(); // the burned draw, spent with an empty section too (cn9)

  const { dim } = grid;
  const n = dim * dim;
  const accumulate = section.some((c) => c.name === "accumulate_connections");
  const commands = section.filter((c) => CONNECT_COMMAND_NAMES.has(c.name));
  const list = buildConnections(commands, instantiated, constants, origins);

  const start = grid.terrain.slice();
  if (composites)
    for (let i = 0; i < n; i++)
      if (composites.kind[i] === COMPOSITE_AS_TERRAIN)
        start[i] = composites.terrain[i];
  const view = start.slice();
  const undo = list.length > 1 && !accumulate;
  const finalPaint = new Map<number, number>();
  const painted = new Set<number>();
  const parent = new Int32Array(n);
  const seen = new Uint8Array(n);
  const inSet = new Uint8Array(n);
  const outcome = new Map<
    InstantiatedCommand,
    { attempted: number; placed: number; failures: PlacementFailure[] }
  >();
  for (const cmd of commands)
    outcome.set(cmd, { attempted: 0, placed: 0, failures: [] });

  for (const connection of list) {
    const run = () => {
      const log: PaintLog = { beforeLast: new Map() };
      const report = connection.cmd ? outcome.get(connection.cmd) : undefined;
      const { endpoints, table } = connection;
      for (let a = 0; a < endpoints.length; a++)
        for (let b = a + 1; b < endpoints.length; b++) {
          const from = origins[endpoints[a]];
          const to = origins[endpoints[b]];
          if (report) report.attempted++;
          const path = findPath(
            view,
            dim,
            table,
            from.y * dim + from.x,
            to.y * dim + to.x,
            parent,
            seen,
          );
          if (path === undefined) {
            if (report && connection.cmd)
              pushFailure(report.failures, {
                bucket: "connectionBlocked",
                commandSpan: connection.cmd.span,
                stage: "S5",
                entity: `connection ${landLabel(origins, endpoints[a])}-${landLabel(origins, endpoints[b])}`,
                detail:
                  "No passable route exists between these two lands' origins, so this connection was not produced.",
              });
            continue;
          }
          paintPath(view, dim, table, path, stream, inSet, log, finalPaint);
          if (report) report.placed++;
        }
      for (const i of log.beforeLast.keys()) painted.add(i);
      if (undo) for (const [i, before] of log.beforeLast) view[i] = before;
    };
    // The hourglass's row for this connection's command (generationTiming.ts).
    if (connection.cmd) timeCommand(connection.cmd, run);
    else run();
  }
  if (undo) {
    view.set(start);
    for (const [i, last] of finalPaint) view[i] = last;
  }

  for (let i = 0; i < n; i++)
    if (view[i] !== start[i]) {
      grid.terrain[i] = view[i];
      if (composites) composites.kind[i] = 0;
    }
  for (const i of painted) grid.layer[i] = NO_LAYER;

  const reports: CommandReport[] = commands.map((cmd) => {
    const o = outcome.get(cmd)!;
    return {
      commandSpan: cmd.span,
      stage: "S5",
      attempted: o.attempted,
      placed: o.placed,
      failures: o.failures,
    };
  });
  const notes: SimulationNote[] = [];
  if (
    commands.some((c) => c.name === "create_connect_teams_lands") &&
    instantiated.teams.teamCount === 0
  )
    notes.push({
      key: "teams",
      prominence: "drawer",
      stage: "S5",
      text: "This script connects team lands, but the current lobby has no teams, so every player is a team of one and nothing is connected. Check whether this is the lobby you meant.",
    });
  const nonplayer = commands.findIndex(
    (c) => c.name === "create_connect_to_nonplayer_land",
  );
  const players = origins.filter((o) => o.player !== undefined).length;
  for (const cmd of commands.slice(nonplayer + 1, nonplayer + 1 + players)) {
    if (nonplayer < 0) break;
    notes.push({
      key: `connectionBlockedByBug:${cmd.span.start}`,
      prominence: "drawer",
      stage: "S5",
      span: cmd.span,
      text: "The create_connect_to_nonplayer_land before this command writes one road per player over the commands that follow it, one command per player land, so the game never runs this one.",
    });
  }
  return { reports, notes, stream: stream.state() };
}
