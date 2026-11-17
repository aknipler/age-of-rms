// DE's scripted objects, docs/preview-design.md Sec.6.6 (rev 12). PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// Every `create_object` in script order, as DE runs it: the candidate list
// and its shuffle, the closest-first orders, the tests a candidate takes, the
// groups, actor areas, forest and cliff zones, `require_path`, walls and
// `force_placement`, and the record each object leaves in the saved file.
// The rules are the DE study's write-ups, `de-connections-objects.md`
// Sections 5 to 8 and `de-objects-cg-dz.md`, which overrides the first where
// they differ. Section numbers in the comments below are the second one's
// unless they name the first.
//
// The structure follows the study's own re-implementation of those write-ups
// from their text, which reproduced every one of its 30 corpus maps and 65
// probe maps object for object. A rule's ORDER is what makes the draws line
// up with the game's, so the methods below keep that order even where a
// reader would group the tests differently. Every draw is commented where it
// is spent.
//
// Two streams run through here. The shared stream (`st`) decides where
// things go. Stream 6 (`aux`) gives facings and stream 3 (`anim`) animation
// start frames, each advanced only when an object is built.

import type { DeStream } from "./deRandom";
import {
  CLASS_CLIFF_ZONE,
  CLASS_FARM,
  CLASS_FOREST_ZONE,
  CLASS_TREE,
  CLASS_WALL,
  storedFrame,
  type EffectScope,
  type ObjectCatalog,
  type ObjectDef,
} from "./deObjectData";
import { Hierarchy, routeAllows } from "./pathSearch";
import { f32Sqrt } from "./float32";
import type { TerrainObject, TerrainObjectWorld } from "./terrainObjects";
import { STAGE_OBJECT } from "./terrainObjects";
import type { Span } from "../../parser/types";
import type { CliffPiece } from "./types";

const F = Math.fround;
/** A square, without `**`, which the determinism lint forbids (Sec.8). */
const square = (v: number): number => v * v;
const TWO_PI = F(2 * Math.PI);
const VILLAGER = 83;
const STARTING_VILLAGERS = 3;
/** The pathing actions that block a route (Section 7). */
const BLOCKING_ACTIONS = new Set([1, 2, 10, 11, 13]);
/** The town centres a wall ring is centred on, in the order they are looked for (Section 8). */
const WALL_CENTRES = [109, 444];

/** Half away from zero (write-up 2.6). */
export function roundHalfAway(v: number): number {
  return v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5);
}

/** One object group: its entries and their weights, in written order. */
export type ObjectGroups = ReadonlyMap<
  string,
  readonly (readonly [number, number])[]
>;

export type ClosestKind = "origin" | "center" | "edge";

/** One `create_object` (or `create_actor_area`) as the stage reads it. */
export interface ObjectDesc {
  index: number;
  span: Span;
  /** Written name, for reports. */
  name: string;
  /** The object, or undefined when the command names a group. */
  objectId?: number;
  groupName?: string;
  /** `create_actor_area x y id r`. */
  area?: readonly [number, number, number, number];
  nObjects: number;
  nGroups?: number;
  variance: number;
  radius: number;
  groupingStated?: "tight" | "loose";
  scaling?: "map" | "players";
  everyPlayer: boolean;
  gaiaOnly: boolean;
  facet?: number;
  /** A name: an object or a group. */
  second?: string;
  secondObjectId?: number;
  terrainToPlaceOn?: number;
  layerToPlaceOn?: number;
  ignore: boolean;
  minP?: number;
  maxP?: number;
  minEdge: number;
  otherZones?: number;
  minGroup: number;
  tempGroup: number;
  alz: boolean;
  alzD: number;
  closest?: readonly [ClosestKind, "near" | "far"];
  circular: boolean;
  tileShuffle: boolean;
  aa?: number;
  aaR: number;
  aaIn?: number;
  avoidAa: number[];
  avoidAll: boolean;
  zones: (readonly [number, number])[];
  zoneKind?: "require" | "avoid";
  landId?: number;
  firstLand: boolean;
  force: boolean;
  minConn: number;
  path?: number;
}

export function emptyDesc(index: number, span: Span, name: string): ObjectDesc {
  return {
    index,
    span,
    name,
    nObjects: 1,
    variance: 0,
    radius: 3,
    everyPlayer: false,
    gaiaOnly: false,
    ignore: false,
    minEdge: 0,
    minGroup: 0,
    tempGroup: 0,
    alz: false,
    alzD: 0,
    circular: false,
    tileShuffle: false,
    aaR: 1,
    avoidAa: [],
    avoidAll: false,
    zones: [],
    firstLand: false,
    force: false,
    minConn: 0,
  };
}

function grouping(d: ObjectDesc): "tight" | "loose" | undefined {
  if (d.groupingStated) return d.groupingStated;
  return d.nGroups !== undefined ? "loose" : undefined;
}

/** A land, as the stage reads it: its player slot (0 for none), origin, zone and declared `land_id`. */
export interface StageLand {
  slot: number;
  x: number;
  y: number;
  zone: number;
  landId?: number;
}

export interface StagePlayer {
  slot: number;
  team: number;
  civ: number;
}

/** One object the stage built. */
export interface Built {
  id: number;
  owner: number;
  x: number;
  y: number;
  def: ObjectDef;
  facet: number | undefined;
  angle: number | undefined;
  depth: number;
  dropped: boolean;
  /** The command that built it, undefined for cliff pieces. */
  cmd?: number;
  wallPiece: boolean;
}

/** A frame: a land a command runs for (de-connections-objects.md 5.1). */
interface Frame {
  slot: number;
  x: number;
  y: number;
  zone: number;
}

interface AreaRecord {
  id: number;
  ctx: number | undefined;
  r: number;
  tiles: [number, number][];
  ix: Map<number, number>;
  total: number;
}

interface PlacedArea {
  id: number;
  x: number;
  y: number;
  r: number;
  slot: number | undefined;
}

/** What each command did, for the preview's reports. */
export interface CommandOutcome {
  requested: number;
  placed: number;
}

export interface StageInput {
  catalog: ObjectCatalog;
  st: DeStream;
  aux: DeStream;
  anim: DeStream;
  dim: number;
  /** The terrain the stage sees: composite tiles as painted (6.5). */
  terrain: Uint16Array;
  /** Layers as before the beach-layer cleanup (6.5), 0xFFFF for none. */
  layer: Uint16Array;
  elevation: Uint8Array;
  /** Each tile's land zone from the land stage. */
  landZone: Int16Array;
  lands: readonly StageLand[];
  players: readonly StagePlayer[];
  world: TerrainObjectWorld;
  pieces: readonly CliffPiece[];
  /** The tile the real grid paints a farm's field on (Section 12). */
  paint?: (tile: number, terrain: number) => void;
  /** Diagnostics only: one line per frame of each command, its draws and the objects it built. */
  trace?: (line: string) => void;
}

export class ObjectStage {
  private readonly c: ObjectCatalog;
  private readonly st: DeStream;
  private readonly aux: DeStream;
  private readonly anim: DeStream;
  private readonly w: number;
  private readonly h: number;
  private readonly T: Uint16Array;
  private readonly layer: Uint16Array;
  private readonly E: Uint8Array;
  private readonly landZone: Int16Array;
  private readonly lands: readonly StageLand[];
  private readonly players: readonly StagePlayer[];
  private readonly civ = new Map<number, number>();
  private readonly team = new Map<number, number>();
  private readonly paint?: (tile: number, terrain: number) => void;
  private readonly trace?: (line: string) => void;
  private scope: EffectScope = "gaia";
  private readonly available: Uint8Array;
  readonly objects: Built[] = [];
  private readonly grid: Built[][];
  private readonly first: number;
  private readonly tby: TerrainObject[][];
  private readonly tobj: TerrainObject[];
  private readonly areas: PlacedArea[] = [];
  private readonly records: AreaRecord[] = [];
  private ctx: number | undefined;
  private centreLand: readonly [number, number] | undefined;
  private groups: ObjectGroups = new Map();
  private groupIds = new Set<Built>();
  private wallRoutes: [string, Map<string, [number, number][][]>] | undefined;
  private nextClump = 0;
  private readonly cache = new Map<string, unknown>();
  private walkGridCache: Uint8Array | undefined;
  private hierCache:
    { key: string; h: Hierarchy; answers: Map<string, boolean> } | undefined;
  readonly outcomes = new Map<number, CommandOutcome>();
  /** The last player-zone labelling asked for (6.2 step 1). */
  private pzLast:
    | { rid: number; oi: number; t: number; lv: number; lab: Int32Array }
    | undefined;
  /** The last actor-area mask built (6.2 step 2.2). */
  private amLast:
    | { d: ObjectDesc; slot: number; n: number; place: boolean; m: Uint8Array }
    | undefined;
  /** Groups placed so far, for the reports. */
  private placedGroups = 0;

  constructor(input: StageInput) {
    this.c = input.catalog;
    this.st = input.st;
    this.aux = input.aux;
    this.anim = input.anim;
    this.w = input.dim;
    this.h = input.dim;
    this.T = input.terrain;
    this.layer = input.layer;
    this.E = input.elevation;
    this.landZone = input.landZone;
    this.lands = input.lands;
    this.players = input.players;
    for (const p of input.players) {
      this.civ.set(p.slot, p.civ);
      this.team.set(p.slot, p.team);
    }
    this.paint = input.paint;
    this.trace = input.trace;
    this.available = new Uint8Array(this.w * this.h).fill(1);
    this.grid = Array.from({ length: this.w * this.h }, () => []);
    for (const p of input.pieces) {
      const def = this.c.def(p.objectId, "gaia");
      if (!def) continue;
      this.add({
        id: p.objectId,
        owner: 0,
        x: F(p.x),
        y: F(p.y),
        def,
        facet: p.facing,
        angle: undefined,
        depth: 0,
        dropped: false,
        wallPiece: false,
      });
    }
    this.first = this.objects.length;
    this.tobj = input.world.live();
    this.tby = Array.from({ length: this.w * this.h }, () => []);
    for (const o of this.tobj) this.tby[o.tile].push(o);
  }

  // ---- helpers

  private draw(n: number): number {
    return this.st.bounded(n >>> 0);
  }

  private def(id: number, scope: EffectScope = this.scope): ObjectDef {
    return this.c.def(id, scope)!;
  }

  private add(b: Built): void {
    this.objects.push(b);
    const gx = Math.floor(b.x);
    const gy = Math.floor(b.y);
    if (gx >= 0 && gy >= 0 && gx < this.w && gy < this.h)
      this.grid[gy * this.w + gx].push(b);
    this.walkGridCache = undefined;
  }

  private near(x: number, y: number, r: number): Built[] {
    const out: Built[] = [];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++) {
        if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) continue;
        out.push(...this.grid[gy * this.w + gx]);
      }
    return out;
  }

  /** de-connections-objects.md 5.3: whether the owner's civilization has the object. */
  private availTo(id: number, owner: number): boolean {
    if (!this.c.has(id)) return false;
    return this.c.availableTo(id, owner === 0 ? 0 : (this.civ.get(owner) ?? 0));
  }

  /** 5.3: one `draw(100)` per resolution under a replacement rule. */
  private replace(id: number, owner: number): number {
    const civ = owner === 0 ? 0 : (this.civ.get(owner) ?? 0);
    if (id === 83 || id === 293) {
      const roll = this.draw(100);
      const target = id === 83 ? 293 : 83;
      return this.availTo(target, owner) && roll <= 50 ? target : id;
    }
    if (id === 448) {
      // The civilization's scout. The roll is spent, and the editor saves
      // Scout Cavalry for every civilization (de-connections-objects.md 5.3).
      this.draw(100);
      return id;
    }
    if (id === 109) {
      const value =
        civ < this.c.townCentreAttribute.length
          ? this.c.townCentreAttribute[civ]
          : 0;
      if (value <= 0) return id;
      this.draw(100);
      return this.availTo(444, owner) ? 444 : id;
    }
    // 45, 68, 562 and 584 wait for technologies no start has: no roll.
    return id;
  }

  private hasRule(id: number): boolean {
    return id === 83 || id === 293 || id === 448 || id === 109;
  }

  /** 5.4: one roll R; keep the entries whose weight is at least R; pick R mod kept. */
  private groupRoll(name: string): number {
    const entries = this.groups.get(name) ?? [];
    const R = this.draw(100);
    const kept = entries.filter((e) => e[1] >= R);
    if (kept.length) return kept[R % kept.length][0];
    return entries[0]?.[0] ?? -1;
  }

  /** 4.1: a group pick is never replaced. */
  private resolve(d: ObjectDesc, owner: number): number {
    if (d.objectId === undefined) return this.groupRoll(d.groupName!);
    return this.replace(d.objectId, owner);
  }

  private needsResolution(d: ObjectDesc): boolean {
    return d.objectId === undefined || this.hasRule(d.objectId);
  }

  /** 4.1's exception: the zone filter's resolutions pass the pick through its rule, as for gaia. */
  private zoneResolve(d: ObjectDesc): number {
    if (d.objectId === undefined)
      return this.replace(this.groupRoll(d.groupName!), 0);
    return this.replace(d.objectId, 0);
  }

  private rep(d: ObjectDesc): number {
    return d.objectId !== undefined
      ? d.objectId
      : (this.groups.get(d.groupName!)?.[0]?.[0] ?? -1);
  }

  private secondObj(d: ObjectDesc, owner: number): number | undefined {
    if (d.second === undefined) return undefined;
    if (d.secondObjectId !== undefined)
      return this.replace(d.secondObjectId, owner);
    if (this.groups.has(d.second)) return this.groupRoll(d.second);
    return undefined;
  }

  private lay(i: number): number {
    const v = this.layer[i];
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  // ---- 5.3 actor areas

  private recordArea(
    id: number,
    x: number,
    y: number,
    r0: number,
    slot: number | undefined,
  ): void {
    let rec = this.records.find((q) => q.id === id && q.ctx === this.ctx);
    if (!rec) {
      rec = { id, ctx: this.ctx, r: r0, tiles: [], ix: new Map(), total: 0 };
      this.records.push(rec);
    }
    const r = rec.r;
    for (let xx = Math.max(x - r, 0); xx <= Math.min(x + r, this.w - 1); xx++)
      for (
        let yy = Math.max(y - r, 0);
        yy <= Math.min(y + r, this.h - 1);
        yy++
      ) {
        const t = yy * this.w + xx;
        rec.total++;
        const k = rec.ix.get(t);
        if (k !== undefined) rec.tiles[k][1]++;
        else {
          rec.ix.set(t, rec.tiles.length);
          rec.tiles.push([t, 1]);
        }
      }
    this.areas.push({ id, x, y, r, slot });
    this.amLast = undefined;
  }

  private lookup(id: number, dispatched: boolean): AreaRecord | undefined {
    let rec = this.records.find((q) => q.id === id && q.ctx === this.ctx);
    if (!rec && dispatched && this.ctx !== undefined)
      rec = this.records.find((q) => q.id === id && q.ctx === undefined);
    return rec;
  }

  /** 6.2 step 2.2 for every tile at once: 1 where the tile passes. */
  private areaMask(
    d: ObjectDesc,
    frame: Frame | undefined,
    n: number,
    place: boolean,
  ): Uint8Array {
    const slot = frame ? frame.slot : -1;
    const hit = this.amLast;
    if (
      hit &&
      hit.d === d &&
      hit.slot === slot &&
      hit.n === n &&
      hit.place === place
    )
      return hit.m;
    const A = this.areas.slice(0, n);
    const { w, h } = this;
    const usePlace = place && d.aaIn !== undefined;
    const m = new Uint8Array(w * h).fill(usePlace ? 0 : 1);
    const paint: [PlacedArea, number][] = [];
    if (usePlace)
      for (const a of A)
        if (
          a.id === d.aaIn &&
          (frame === undefined || a.slot === undefined || a.slot === frame.slot)
        )
          paint.push([a, 1]);
    if (d.avoidAa.length || d.avoidAll)
      for (const a of A)
        if (d.avoidAll || d.avoidAa.includes(a.id)) paint.push([a, 0]);
    for (const [a, v] of paint) {
      const x0 = Math.max(a.x - a.r, 0);
      const x1 = Math.min(a.x + a.r, w - 1);
      const y0 = Math.max(a.y - a.r, 0);
      const y1 = Math.min(a.y + a.r, h - 1);
      if (x0 > x1) continue;
      for (let yy = y0; yy <= y1; yy++) m.fill(v, yy * w + x0, yy * w + x1 + 1);
    }
    this.amLast = { d, slot, n, place, m };
    return m;
  }

  private areaRule(
    d: ObjectDesc,
    frame: Frame | undefined,
    x: number,
    y: number,
    nAreas: number | undefined,
  ): boolean {
    if (d.aaIn === undefined && !d.avoidAa.length && !d.avoidAll) return true;
    const n = nAreas ?? this.areas.length;
    return this.areaMask(d, frame, n, true)[y * this.w + x] === 1;
  }

  private noAvoided(d: ObjectDesc, x: number, y: number): boolean {
    if (!d.avoidAa.length && !d.avoidAll) return true;
    return (
      this.areaMask(d, undefined, this.areas.length, false)[y * this.w + x] ===
      1
    );
  }

  // ---- 6.4 zones

  private inZone(
    d: ObjectDesc,
    x: number,
    y: number,
    odef: ObjectDef,
    member: boolean,
  ): boolean {
    if (!d.zones.length) return true;
    const hx = odef.ch[0];
    const w = Math.trunc(hx);
    const f = hx > w ? 1 : 0;
    let hit = false;
    for (const [cls, r] of d.zones) {
      const near = r + w;
      const far = Math.max(r, w) + w * f;
      const ok = (a: number, b: number): boolean =>
        ((a <= x && x - a <= near) || (a > x && a - x <= far)) &&
        ((b <= y && y - b <= near) || (b > y && b - y <= far));
      for (
        let ty = Math.max(y - near, 0);
        ty <= Math.min(y + far, this.h - 1) && !hit;
        ty++
      )
        for (
          let tx = Math.max(x - near, 0);
          tx <= Math.min(x + far, this.w - 1) && !hit;
          tx++
        )
          for (const o of this.tby[ty * this.w + tx])
            if (
              o.alive &&
              o.status !== 7 &&
              this.c.def(o.id, "gaia")!.classId === cls &&
              ok(tx, ty)
            ) {
              hit = true;
              break;
            }
      if (!hit)
        for (const b of this.near(x, y, Math.max(near, far) + 1)) {
          if (b.dropped) continue;
          if (member && this.groupIds.has(b)) continue;
          if (b.def.classId === cls && ok(Math.floor(b.x), Math.floor(b.y))) {
            hit = true;
            break;
          }
        }
      if (hit) break;
    }
    return d.zoneKind === "require" ? hit : !hit;
  }

  /**
   * `inZone` for every tile at once, for one object and no group exclusion:
   * 1 where the tile passes. Each object of a zone class stamps the tiles
   * whose zone rectangle reaches it, `near` tiles to its right and below and
   * `far` tiles to its left and above, the mirror of the test in `inZone`.
   */
  private zoneMask(d: ObjectDesc, odef: ObjectDef): Uint8Array {
    const { w, h } = this;
    const hit = new Uint8Array(w * h);
    const hx = odef.ch[0];
    const wd = Math.trunc(hx);
    const f = hx > wd ? 1 : 0;
    for (const [cls, r] of d.zones) {
      const near = r + wd;
      const far = Math.max(r, wd) + wd * f;
      const stamp = (a: number, b: number): void => {
        const x0 = Math.max(a - far, 0);
        const x1 = Math.min(a + near, w - 1);
        for (let y = Math.max(b - far, 0); y <= Math.min(b + near, h - 1); y++)
          hit.fill(1, y * w + x0, y * w + x1 + 1);
      };
      for (const o of this.tobj)
        if (
          o.alive &&
          o.status !== 7 &&
          this.c.def(o.id, "gaia")!.classId === cls
        )
          stamp(o.tile % w, Math.floor(o.tile / w));
      for (const b of this.objects)
        if (!b.dropped && b.def.classId === cls) {
          const bx = Math.floor(b.x);
          const by = Math.floor(b.y);
          if (bx >= 0 && by >= 0 && bx < w && by < h) stamp(bx, by);
        }
    }
    if (d.zoneKind === "require") return hit;
    for (let i = 0; i < hit.length; i++) hit[i] ^= 1;
    return hit;
  }

  // ---- 18.2 to 18.5

  private centreOf(dd: ObjectDef, x: number, y: number): [number, number] {
    return [
      F(F(x) + (dd.ch[0] !== Math.trunc(dd.ch[0]) ? 0.5 : 0)),
      F(F(y) + (dd.ch[1] !== Math.trunc(dd.ch[1]) ? 0.5 : 0)),
    ];
  }

  private rect(
    dd: ObjectDef,
    c: readonly [number, number],
  ): [number, number, number, number] {
    return [
      F(c[0] - dd.ph[0]),
      F(c[1] - dd.ph[1]),
      F(F(c[0] + dd.ph[0]) - F(0.001)),
      F(F(c[1] + dd.ph[1]) - F(0.001)),
    ];
  }

  private shape(x: number, y: number): number {
    const { w, h, E } = this;
    const z = E[y * w + x];
    const nb = (dx: number, dy: number): number =>
      x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h
        ? z
        : E[(y + dy) * w + x + dx];
    const up = z + 1;
    const dn = z - 1;
    const N = nb(0, -1);
    const Ea = nb(1, 0);
    const S = nb(0, 1);
    const W = nb(-1, 0);
    const NE = nb(1, -1);
    const SE = nb(1, 1);
    const SW = nb(-1, 1);
    const NW = nb(-1, -1);
    if (N === up && Ea === up) return 14;
    if (W === up && S === up) return 13;
    if (N === up && W === up) return 16;
    if (Ea === up && S === up) return 15;
    if (N === up) return 6;
    if (Ea === up) return 8;
    if (W === up) return 5;
    if (S === up) return 7;
    if (NE === up) return W === dn && S === dn ? 2 : 10;
    if (SW === up) return N === dn && Ea === dn ? 1 : 9;
    if (NW === up) return Ea === dn && S === dn ? 3 : 11;
    if (SE === up) return N === dn && W === dn ? 4 : 12;
    return 0;
  }

  private fit(
    dd: ObjectDef,
    c: readonly [number, number],
    ignore: boolean,
    owner: number,
    checkOverlap = true,
  ): boolean {
    const [lx, ly, ux, uy] = this.rect(dd, c);
    if (lx < 0 || ly < 0 || ux >= this.w || uy >= this.h) return false;
    const cen = dd.centreTerrains;
    const side = dd.sideTerrains;
    if (
      cen.length &&
      !this.c.matches(
        cen,
        this.T[Math.trunc(c[1]) * this.w + Math.trunc(c[0])],
        0x04,
        0x08,
      )
    )
      return false;
    if (side.length) {
      let x0: number, y0: number, x1: number, y1: number;
      if (cen.length) {
        x0 = x1 = Math.trunc(c[0]);
        y0 = y1 = Math.trunc(c[1]);
      } else {
        x0 = Math.trunc(lx);
        y0 = Math.trunc(ly);
        x1 = Math.trunc(ux);
        y1 = Math.trunc(uy);
      }
      const m = (xx: number, yy: number): boolean =>
        xx >= 0 &&
        xx < this.w &&
        yy >= 0 &&
        yy < this.h &&
        this.c.matches(side, this.T[yy * this.w + xx], 0x40, 0x10);
      let any = false;
      for (let xx = x0; xx <= x1 && !any; xx++)
        any = m(xx, y0 - 1) || m(xx, y1 + 1);
      for (let yy = y0; yy <= y1 && !any; yy++)
        any = m(x1 + 1, yy) || m(x0 - 1, yy);
      if (!any) return false;
    }
    if (!ignore)
      for (let yy = Math.trunc(ly); yy <= Math.trunc(uy); yy++)
        for (let xx = Math.trunc(lx); xx <= Math.trunc(ux); xx++)
          if (this.c.refuses(dd.restriction, this.T[yy * this.w + xx]))
            return false;
    if (dd.slope) {
      const x0 = Math.trunc(lx);
      const y0 = Math.trunc(ly);
      const x1 = Math.trunc(ux);
      const y1 = Math.trunc(uy);
      const ref = this.E[y1 * this.w + x0];
      for (let xx = x0; xx <= x1; xx++)
        for (let yy = y0; yy <= y1; yy++) {
          if (dd.slope === 1 || dd.slope === 2) {
            const s = this.shape(xx, yy);
            if (s !== 0 && (dd.slope === 2 || !(s >= 5 && s <= 8)))
              return false;
          } else if (dd.slope === 3 && (xx === x0 || yy === y1)) {
            if (Math.abs(this.E[yy * this.w + xx] - ref) > 1) return false;
          }
        }
    }
    return !checkOverlap || this.noOverlap(dd, c, owner);
  }

  private blocks(
    N: ObjectDef,
    c: readonly [number, number],
    owner: number,
    Ed: ObjectDef,
    ex: number,
    ey: number,
    eowner: number,
  ): boolean {
    if (Ed.canBuildOn || Ed.ch[0] <= 0 || Ed.ch[1] <= 0) return false;
    if (!(
      Math.abs(F(ex - c[0])) < F(N.ph[0] + Ed.ch[0]) &&
      Math.abs(F(ey - c[1])) < F(N.ph[1] + Ed.ch[1])
    ))
      return false;
    const coll = !N.pcNone && N.vertical > 0 && (N.ph[0] > 0 || N.ph[1] > 0);
    const eVert = Ed.vertical > 0;
    if (
      coll &&
      !Ed.pcNone &&
      (eVert || (N.classId === CLASS_TREE && Ed.classId === CLASS_FARM))
    )
      return true;
    if (N.family !== "occupancy") return false;
    const [rt, q] = Ed.resource;
    if (!(
      eVert ||
      Ed.positionFamily === "building" ||
      ([0, 1, 2, 3, 15, 16, 17].includes(rt) && q > 0)
    ))
      return false;
    const moving = Ed.usesSpeed && Ed.speed > 0;
    if (
      moving &&
      (N.action === 0 || N.action === 12 || eowner === 0 || eowner === owner)
    )
      return false;
    return true;
  }

  private noOverlap(
    N: ObjectDef,
    c: readonly [number, number],
    owner: number,
  ): boolean {
    const coll = !N.pcNone && N.vertical > 0 && (N.ph[0] > 0 || N.ph[1] > 0);
    if (!coll && N.family !== "occupancy") return true;
    for (const b of this.near(c[0], c[1], 6))
      if (!b.dropped && this.blocks(N, c, owner, b.def, b.x, b.y, b.owner))
        return false;
    const cy = Math.trunc(c[1]);
    const cx = Math.trunc(c[0]);
    for (let ty = Math.max(cy - 3, 0); ty < Math.min(cy + 4, this.h); ty++)
      for (let tx = Math.max(cx - 3, 0); tx < Math.min(cx + 4, this.w); tx++)
        for (const o of this.tby[ty * this.w + tx]) {
          if (!o.alive) continue;
          if (
            this.T[o.tile] !== o.source &&
            (o.status === 7 || o.stage === STAGE_OBJECT)
          )
            continue;
          const Ed = this.c.def(o.id, "gaia")!;
          const [ex, ey] = this.centreOf(Ed, tx, ty);
          if (this.blocks(N, c, owner, Ed, ex, ey, 0)) return false;
        }
    return true;
  }

  private ownOk(
    dd: ObjectDef,
    x: number,
    y: number,
    owner: number,
    ignore: boolean,
  ): boolean {
    return this.fit(dd, this.centreOf(dd, x, y), ignore, owner);
  }

  // ---- building (2.1 to 2.5, Section 9)

  private build(
    id: number,
    pos: readonly [number, number],
    owner: number,
    d: ObjectDesc | undefined,
    depth = 0,
  ): Built {
    this.scope = owner ? "player" : "gaia";
    const dd = this.def(id);
    let [x, y] = pos;
    if (dd.speed > 0) {
      for (const ax of [0, 1]) {
        const r = dd.ch[ax];
        const m = F(r + F(0.01));
        let v = ax === 0 ? x : y;
        const lim = ax === 0 ? this.w : this.h;
        if (v < m) v = m;
        else if (v > F(F(lim) - m)) v = F(F(F(lim) - r) - F(0.01));
        if (ax === 0) x = v;
        else y = v;
      }
    }
    x = Math.min(Math.max(x, 0), F(F(this.w) - F(0.001)));
    y = Math.min(Math.max(y, 0), F(F(this.h) - F(0.001)));
    const cr = dd.creation;
    let facet = 0;
    let angle: number | undefined;
    // Stream 6: random facet, random angle, combat seed, one raw each.
    if (cr.randomFacet) {
      const s = this.aux.raw() & 0x7fff;
      facet = Math.min(Math.floor((cr.facets * s) / 0x7fff), cr.facets - 1);
    }
    if (cr.randomAngle) {
      const s = this.aux.raw() & 0x7fff;
      const sector = Math.floor((cr.facets * s) / 0x7fff);
      angle = F(F(TWO_PI / F(cr.facets)) * F(sector));
      if (angle > TWO_PI) angle = F(angle - TWO_PI);
    }
    if (cr.combatSeed) this.aux.raw();
    // Stream 3: two raws for an animated object, its start frame from the second (2.2).
    let startFrame: number | undefined;
    if (dd.animated) {
      this.anim.raw();
      const s3 = this.anim.raw() & 0x7fff;
      if (dd.frames !== undefined && dd.frames > 0)
        startFrame = Math.min(
          Math.floor((dd.frames * s3) / 0x7fff),
          dd.frames - 1,
        );
    }
    const b: Built = {
      id,
      owner,
      x,
      y,
      def: dd,
      facet: undefined,
      angle: undefined,
      depth,
      dropped: false,
      cmd: d?.index,
      wallPiece: false,
    };
    // 2.3, what the file stores.
    if (angle !== undefined && dd.ctype !== 80) b.angle = angle;
    else if (angle !== undefined) b.facet = 0;
    else b.facet = storedFrame(dd, facet, undefined);
    // A fixed facet whose stored value is known for the constructor type
    // (5 for type 30, 0 for 70 and 80) wins over the start frame. A house or a
    // fish spends its two stream-3 raws and still stores the fixed value.
    const fixedKnown =
      cr.fixedFacet !== undefined &&
      (dd.ctype === 30 || dd.ctype === 70 || dd.ctype === 80);
    // An object that drew a random angle keeps the rotation rules above too,
    // a building's frame field holding 0 (2.3, Caverns' 1870 under graphic 12800).
    if (startFrame !== undefined && angle === undefined && !fixedKnown)
      b.facet = startFrame;
    if (depth === 0 && d?.facet !== undefined && d.facet >= 1)
      b.facet = d.facet;
    this.deleteUnder(b);
    this.add(b);
    for (const [cid, ox, oy] of dd.annexes)
      if (this.availTo(cid, owner))
        this.build(cid, [F(pos[0] + ox), F(pos[1] + oy)], owner, d, depth + 1);
    return b;
  }

  /** Section 9: what a new object deletes under itself. */
  private deleteUnder(b: Built): void {
    const N = b.def;
    const X = b.x;
    const Y = b.y;
    if (!N.canBuildOn)
      for (const e of this.near(X, Y, 6)) {
        if (e === b || e.depth || e.dropped || !e.def.canBuildOn) continue;
        if (!(N.hp === 0 || e.def.hp === 0)) continue;
        if (
          (e.x === X && e.y === Y) ||
          (Math.abs(F(e.x - X)) < F(e.def.ch[0] + N.ch[0]) &&
            Math.abs(F(e.y - Y)) < F(e.def.ch[1] + N.ch[1]))
        )
          e.dropped = true;
      }
    if (N.ch[0] === 0 && N.ch[1] === 0) return;
    for (
      let ty = Math.max(Math.trunc(Y - 4), 0);
      ty <= Math.min(Math.trunc(Y + 4), this.h - 1);
      ty++
    )
      for (
        let tx = Math.max(Math.trunc(X - 4), 0);
        tx <= Math.min(Math.trunc(X + 4), this.w - 1);
        tx++
      )
        for (const o of this.tby[ty * this.w + tx]) {
          if (!o.alive) continue;
          const Ed = this.c.def(o.id, "gaia")!;
          if (
            (Ed.canBuildOn || o.status === 7) &&
            Math.abs(F(o.x - X)) < F(Ed.ch[0] + N.ch[0]) &&
            Math.abs(F(o.y - Y)) < F(Ed.ch[1] + N.ch[1])
          ) {
            o.alive = false;
            this.walkGridCache = undefined;
          }
        }
  }

  /** 2.5: the tile corner on an axis whose collision half-size is whole, the centre on one with a fraction. */
  private placeAtTile(
    id: number,
    x: number,
    y: number,
    owner: number,
    d: ObjectDesc | undefined,
  ): Built {
    this.scope = owner ? "player" : "gaia";
    const dd = this.def(id);
    const pos: number[] = [];
    for (const [ax, t, lim] of [
      [0, x, this.w],
      [1, y, this.h],
    ] as const) {
      const half = dd.ch[ax];
      let v = t * 256 + (half !== Math.trunc(half) ? 128 : 0);
      if (half > 0) {
        const lo = Math.ceil(half * 256) + dd.edgeMargin;
        const hi = Math.max(lim * 256 - lo, 0);
        v = Math.min(Math.max(v, Math.min(lo, hi)), Math.max(hi, lo));
      }
      pos.push(F(v / 256));
    }
    return this.build(id, [pos[0], pos[1]], owner, d);
  }

  // ---- Section 7

  private walkGrid(): Uint8Array {
    if (this.walkGridCache) return this.walkGridCache;
    const { w, h } = this;
    const walk = new Uint8Array(w * h).fill(1);
    const occ = (px: number, py: number, dd: ObjectDef): void => {
      if (!BLOCKING_ACTIONS.has(dd.action)) return;
      const [rx, ry] = dd.action === 11 ? dd.outline : dd.ch;
      const x0 = Math.min(Math.max(Math.trunc(F(F(px) - F(rx))), 0), w - 1);
      const y0 = Math.min(Math.max(Math.trunc(F(F(py) - F(ry))), 0), h - 1);
      const x1 = Math.min(
        Math.max(Math.trunc(F(F(F(px) + F(rx)) - F(0.001))), 0),
        w - 1,
      );
      const y1 = Math.min(
        Math.max(Math.trunc(F(F(F(py) + F(ry)) - F(0.001))), 0),
        h - 1,
      );
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) walk[yy * w + xx] = 0;
    };
    for (const b of this.objects) if (!b.dropped) occ(b.x, b.y, b.def);
    for (const o of this.tobj)
      if (o.alive && o.status !== 7 && this.T[o.tile] === o.source)
        occ(o.x, o.y, this.c.def(o.id, "gaia")!);
    this.walkGridCache = walk;
    return walk;
  }

  private routeOk(d: ObjectDesc, frame: Frame, x: number, y: number): boolean {
    const dropped = this.objects.reduce((n, b) => n + (b.dropped ? 1 : 0), 0);
    // Built objects only change when one is added or dropped, and a terrain
    // object only dies when an object is built on it, so these two counts
    // name the grid.
    const key = `${this.objects.length}|${dropped}`;
    if (!this.hierCache || this.hierCache.key !== key)
      this.hierCache = {
        key,
        h: new Hierarchy(this.w, this.h, this.walkGrid()),
        answers: new Map(),
      };
    // A search reads only the grid and leaves it as it found it, so on an
    // unchanged grid the same question has the same answer. Late commands of
    // a map that has run out of room ask the same failing questions again
    // and again (650 STONE commands in round CL), and the cache answers them.
    const ask = `${x},${y},${frame.x},${frame.y},${d.path}`;
    const known = this.hierCache.answers.get(ask);
    if (known !== undefined) return known;
    const answer = routeAllows(
      this.hierCache.h,
      this.c.def(VILLAGER, "gaia")!.ch[0],
      d.path! + 1,
      [x, y],
      [frame.x, frame.y],
    );
    this.hierCache.answers.set(ask, answer);
    return answer;
  }

  // ---- 6.1 candidates

  private window(
    d: ObjectDesc,
    frame: Frame | undefined,
  ): [number, number, number, number] {
    const e = d.minEdge;
    let mnx = Math.min(e, this.w - 1);
    let mxx = Math.max(this.w - 1 - e, 0);
    let mny = Math.min(e, this.h - 1);
    let mxy = Math.max(this.h - 1 - e, 0);
    if (d.maxP !== undefined && frame !== undefined) {
      const m = d.maxP;
      mnx = Math.max(frame.x - m, mnx);
      mxx = Math.min(frame.x + m, mxx);
      mny = Math.max(frame.y - m, mny);
      mxy = Math.min(frame.y + m, mxy);
    }
    return [mnx, mxx, mny, mxy];
  }

  private inCircle(
    d: ObjectDesc,
    frame: Frame | undefined,
    x: number,
    y: number,
  ): boolean {
    if (d.circular && frame !== undefined && d.maxP !== undefined)
      return square(x - frame.x) + square(y - frame.y) <= d.maxP * d.maxP;
    return true;
  }

  private candidates(
    d: ObjectDesc,
    frame: Frame | undefined,
    nAreas: number,
  ): number[] {
    const [mnx, mxx, mny, mxy] = this.window(d, frame);
    const dyn = d.zones.length > 0 && this.needsResolution(d);
    const stat = d.zones.length
      ? this.c.def(this.rep(d), this.scope)
      : undefined;
    const hasArea = d.aaIn !== undefined || d.avoidAa.length > 0 || d.avoidAll;
    // With an object that needs no resolution the zone test is the same
    // object at every tile, so one mask answers it (write-up 6.4).
    const zones =
      !dyn && stat !== undefined ? this.zoneMask(d, stat) : undefined;
    const test = (x: number, y: number): boolean => {
      const i = y * this.w + x;
      if (!this.available[i] || !this.inCircle(d, frame, x, y)) return false;
      const obj = dyn ? this.c.def(this.zoneResolve(d), this.scope) : stat;
      if (hasArea && !this.areaRule(d, frame, x, y, nAreas)) return false;
      if (zones !== undefined) return zones[i] === 1;
      return obj === undefined || this.inZone(d, x, y, obj, false);
    };
    const lst: number[] = [];
    for (let y = mny; y <= mxy; y++)
      for (let x = mnx; x <= mxx; x++) if (test(x, y)) lst.push(y * this.w + x);
    return this.shuffle(lst, [mnx, mxx, mny, mxy], dyn ? test : undefined);
  }

  /** de-connections-objects.md 6.1 step 3: picks move to the front; the window's last two rows and columns are never picked. */
  private shuffle(
    lst: number[],
    win: readonly number[],
    retest: ((x: number, y: number) => boolean) | undefined,
  ): number[] {
    const [mnx, mxx, mny, mxy] = win;
    const xr = mxx - mnx - 1;
    const yr = mxy - mny - 1;
    if (!(xr > 1 && yr > 1 && this.w >= 3 && this.h >= 3)) return lst;
    const present = new Uint8Array(this.w * this.h);
    for (const i of lst) present[i] = 1;
    const lastPick = new Int32Array(this.w * this.h).fill(-1);
    const picked: number[] = [];
    const picks = Math.floor((xr * yr) / 4);
    for (let k = 0; k < picks; k++) {
      const x = mnx + this.draw(xr);
      const y = mny + this.draw(yr);
      const i = y * this.w + x;
      const ok = retest !== undefined ? retest(x, y) : present[i] === 1;
      if (ok) {
        if (lastPick[i] < 0) picked.push(i);
        lastPick[i] = k;
      }
    }
    return movedToFront(lst, picked, lastPick);
  }

  /** de-connections-objects.md 6.2 and write-up 6.6. */
  private order(
    lst: number[],
    d: ObjectDesc,
    frame: Frame | undefined,
  ): number[] {
    if (frame === undefined || d.closest === undefined) return lst;
    const [kind, pref] = d.closest;
    const root = (s: number): number => Math.trunc(f32Sqrt(s));
    const circ = d.circular && kind !== "edge";
    const mn = d.minP ?? -1;
    const out: [number, number, number][] = [];
    for (const i of lst) {
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      const sq = square(x - frame.x) + square(y - frame.y);
      if ((circ ? root(sq) : sq) < (circ ? mn : mn * mn)) continue;
      let dist: number;
      if (kind === "origin") dist = circ ? root(sq) : sq;
      else if (kind === "center") {
        const m = Math.floor(this.w / 2);
        const s2 = square(x - m) + square(y - m);
        dist = d.circular ? root(s2) : s2;
      } else dist = Math.min(x, this.w - 1 - x, y, this.h - 1 - y);
      out.push([pref === "near" ? dist : -dist, out.length, i]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    let res = out;
    if (d.tileShuffle) {
      res = [];
      let s = 0;
      while (s < out.length) {
        let e = s + 1;
        while (e < out.length && out[e][0] === out[s][0]) e++;
        const seg = out.slice(s, e);
        for (let k = 1; k < seg.length; k++) {
          const j = this.st.index(k + 1);
          const t = seg[k];
          seg[k] = seg[j];
          seg[j] = t;
        }
        res.push(...seg);
        s = e;
      }
    }
    return res.reverse().map((e) => e[2]);
  }

  // ---- 5.4 the walk

  private walk(d: ObjectDesc, nGroups: number, dispatched: boolean): number[] {
    const rec = this.lookup(d.aaIn!, dispatched);
    if (!rec) return [];
    const iters = Math.max(rec.total, nGroups);
    const weights = rec.tiles.map((t) => t[1]);
    const restores = new Array<number>(weights.length).fill(0);
    let remaining = rec.total;
    const last = new Map<number, number>();
    const need = d.zones.length > 0 && this.needsResolution(d);
    const stat = d.zones.length
      ? this.c.def(this.rep(d), this.scope)
      : undefined;
    const cen = this.centreLand;
    const e = d.minEdge;
    // A Fenwick tree over the running weights.
    const n = weights.length;
    const tree = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      tree[i] += weights[i - 1];
      const j = i + (i & -i);
      if (j <= n) tree[j] += tree[i];
    }
    let top = 1;
    while (top <= n) top <<= 1;
    for (let it = 0; it < iters; it++) {
      if (remaining <= 0) break;
      const r = this.draw(remaining);
      let pos = 0;
      let rest = r;
      for (let step = top; step; step >>= 1)
        if (pos + step <= n && tree[pos + step] <= rest) {
          pos += step;
          rest -= tree[pos];
        }
      const k = pos;
      restores[k]++;
      const t = rec.tiles[k][0];
      if (!this.available[t]) continue;
      weights[k]--;
      for (let i = k + 1; i <= n; i += i & -i) tree[i]--;
      remaining--;
      const x = t % this.w;
      const y = Math.floor(t / this.w);
      if (
        d.maxP &&
        cen !== undefined &&
        (Math.abs(x - cen[0]) >= d.maxP || Math.abs(y - cen[1]) >= d.maxP)
      )
        continue;
      if (!this.noAvoided(d, x, y)) continue;
      if (x < e || y < e || x >= this.w - e || y >= this.h - e) continue;
      let obj = stat;
      if (need) obj = this.c.def(this.zoneResolve(d), this.scope);
      if (obj !== undefined && !this.inZone(d, x, y, obj, false)) continue;
      last.set(t, it);
    }
    for (let k = 0; k < weights.length; k++)
      rec.tiles[k][1] = weights[k] + restores[k];
    rec.total = rec.tiles.reduce((s, t) => s + t[1], 0);
    return [...last.entries()].sort((a, b) => b[1] - a[1]).map((e2) => e2[0]);
  }

  // ---- 6.2, 6.3

  private playerZoneOk(
    rid: number,
    origin: Frame,
    x: number,
    y: number,
  ): boolean {
    const { w, h } = this;
    const oi = origin.y * w + origin.x;
    // The same origin and restriction as the last call, the usual case
    // inside one command: no key to build.
    const last = this.pzLast;
    if (
      last &&
      last.rid === rid &&
      last.oi === oi &&
      last.t === this.T[oi] &&
      last.lv === this.layer[oi]
    )
      return last.lab[y * w + x] === (last.lab[oi] & 0xff);
    const extra = new Set([this.T[oi]]);
    const lv = this.layer[oi];
    if (lv !== 0xffff) extra.add(lv & 0xff);
    const key = `pz|${rid}|${[...extra].sort().join(",")}`;
    let lab = this.cache.get(key) as Int32Array | undefined;
    if (!lab) {
      const ok = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++)
        ok[i] = this.c.accepts(rid, this.T[i]) || extra.has(this.T[i]) ? 1 : 0;
      lab = new Int32Array(w * h).fill(-1);
      let num = 0;
      const stack: number[] = [];
      for (let i = 0; i < w * h; i++) {
        if (lab[i] >= 0) continue;
        const p = ok[i];
        lab[i] = num;
        stack.push(i);
        while (stack.length) {
          const j = stack.pop()!;
          const jx = j % w;
          for (const k of [
            jx > 0 ? j - 1 : -1,
            jx < w - 1 ? j + 1 : -1,
            j - w,
            j + w,
          ])
            if (k >= 0 && k < w * h && lab[k] < 0 && ok[k] === p) {
              lab[k] = num;
              stack.push(k);
            }
        }
        num = (num + 1) % 512;
      }
      this.cache.set(key, lab);
    }
    this.pzLast = { rid, oi, t: this.T[oi], lv: this.layer[oi], lab };
    return lab[y * w + x] === (lab[oi] & 0xff);
  }

  private zonesOf(rid: number): Int32Array {
    const key = `z|${rid}`;
    const hit = this.cache.get(key) as Int32Array | undefined;
    if (hit) return hit;
    const { w, h } = this;
    const lab = new Int32Array(w * h);
    let num = 0;
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (lab[i] || !this.c.accepts(rid, this.T[i])) continue;
      num++;
      lab[i] = num;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % w;
        for (const k of [
          jx > 0 ? j - 1 : -1,
          jx < w - 1 ? j + 1 : -1,
          j - w,
          j + w,
        ])
          if (
            k >= 0 &&
            k < w * h &&
            !lab[k] &&
            this.c.accepts(rid, this.T[k])
          ) {
            lab[k] = num;
            stack.push(k);
          }
      }
    }
    this.cache.set(key, lab);
    return lab;
  }

  private otherZonesOk(
    d: ObjectDesc,
    frame: Frame | undefined,
    x: number,
    y: number,
    rid: number,
  ): boolean {
    if (!d.otherZones) return true;
    const lab = this.zonesOf(rid);
    const at = (xx: number, yy: number): number =>
      lab[
        Math.min(Math.max(yy, 0), this.h - 1) * this.w +
          Math.min(Math.max(xx, 0), this.w - 1)
      ] & 0xff;
    const dist = d.otherZones;
    const dg = Math.floor((dist * 10) / 14);
    const c = at(x, y);
    if (
      frame !== undefined &&
      at(frame.x, frame.y) !== 0 &&
      c !== at(frame.x, frame.y)
    )
      return false;
    const pts = [
      [0, -dist],
      [dg, -dg],
      [dist, 0],
      [dg, dg],
      [0, dist],
      [-dg, dg],
      [-dist, 0],
      [-dg, -dg],
    ];
    return pts.every(([dx, dy]) => at(x + dx, y + dy) === c);
  }

  /** 6.2 step 2. */
  private commandTests(
    d: ObjectDesc,
    frame: Frame | undefined,
    x: number,
    y: number,
    first: number,
    nAreas: number | undefined,
    onWalk: boolean,
  ): boolean {
    const i = y * this.w + x;
    const t = this.T[i];
    if (frame !== undefined && !onWalk && !this.inCircle(d, frame, x, y))
      return false;
    if (!this.areaRule(d, frame, x, y, nAreas)) return false;
    if (d.terrainToPlaceOn !== undefined && d.terrainToPlaceOn !== t)
      return false;
    if (d.layerToPlaceOn !== undefined && this.lay(i) !== d.layerToPlaceOn)
      return false;
    if (
      frame !== undefined &&
      !d.ignore &&
      d.maxP !== 0 &&
      !(d.otherZones && d.aaIn === undefined)
    ) {
      const rid = this.def(first).restriction;
      const oi = frame.y * this.w + frame.x;
      const lv = this.layer[oi];
      if (!(
        this.c.accepts(rid, t) ||
        t === this.T[oi] ||
        (lv !== 0xffff && (lv & 0xff) === t)
      ))
        return false;
    }
    if (Math.min(x, y, this.w - 1 - x, this.h - 1 - y) < d.minEdge)
      return false;
    if (d.minP)
      for (const land of this.lands) {
        if (!land.slot) continue;
        const dx = Math.abs(x - land.x);
        const dy = Math.abs(y - land.y);
        if (
          d.circular
            ? dx * dx + dy * dy < d.minP * d.minP
            : Math.max(dx, dy) < d.minP
        )
          return false;
      }
    if (frame !== undefined && !onWalk && d.maxP !== undefined) {
      const dx = Math.abs(x - frame.x);
      const dy = Math.abs(y - frame.y);
      if (
        !(d.circular
          ? dx * dx + dy * dy <= d.maxP * d.maxP
          : Math.max(dx, dy) <= d.maxP)
      )
        return false;
    }
    const rid =
      frame !== undefined
        ? this.def(first).restriction
        : this.def(this.rep(d)).restriction;
    return this.otherZonesOk(d, frame, x, y, rid);
  }

  /** 6.2 step 3. */
  private landZoneOk(
    d: ObjectDesc,
    frame: Frame | undefined,
    x: number,
    y: number,
  ): boolean {
    if (!d.alz || frame === undefined) return true;
    const at = (xx: number, yy: number): number =>
      this.landZone[
        Math.min(Math.max(yy, 0), this.h - 1) * this.w +
          Math.min(Math.max(xx, 0), this.w - 1)
      ] & 0xff;
    const own = frame.zone & 0xff;
    if (at(x, y) !== own) return false;
    if (d.alzD === 0) return true;
    const s = d.alzD + 1;
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].every(([dx, dy]) => at(x + dx * s, y + dy * s) === own);
  }

  // ---- the commands

  run(descs: readonly ObjectDesc[], groups: ObjectGroups): void {
    this.groups = groups;
    for (const d of descs)
      if (d.area !== undefined) {
        const [x, y, id, r] = d.area;
        this.ctx = undefined;
        this.recordArea(id, x, y, r, undefined);
      }
    for (const d of descs) {
      if (d.area !== undefined) continue;
      const before = this.placedGroups;
      const [frames, last] = this.dispatch(d);
      const dispatched =
        d.everyPlayer || (d.landId !== undefined && d.landId >= 0);
      let requested = 0;
      for (const fr of frames) {
        if (dispatched && fr !== undefined) {
          this.ctx = fr.slot || undefined;
          this.centreLand = [fr.x, fr.y];
        }
        const drawsBefore = this.st.state().count;
        const builtBefore = this.objects.length;
        requested += this.command(d, fr, dispatched);
        if (this.trace)
          this.trace(
            `${d.index} ${d.name} ${fr ? fr.slot : "-"} draws ${this.st.state().count - drawsBefore} built ${this.objects
              .slice(builtBefore)
              .map(
                (b) =>
                  `${b.id}@${Math.round(b.x * 256)},${Math.round(b.y * 256)}`,
              )
              .join(" ")}`,
          );
      }
      if (dispatched && last !== undefined) {
        this.ctx = last.slot || undefined;
        this.centreLand = [last.x, last.y];
      }
      const placed = this.placedGroups - before;
      const prev = this.outcomes.get(d.index);
      this.outcomes.set(d.index, {
        requested: (prev?.requested ?? 0) + requested,
        placed: (prev?.placed ?? 0) + placed,
      });
    }
    this.wallJoints();
    this.foundations();
  }

  /** 5.1. */
  private dispatch(d: ObjectDesc): [(Frame | undefined)[], Frame | undefined] {
    const specific = d.landId !== undefined && d.landId >= 0;
    if (!d.everyPlayer && !specific) return [[undefined], undefined];
    const out: Frame[] = [];
    const served = new Set<number>();
    let last: Frame | undefined;
    for (const land of this.lands) {
      if (specific) {
        if (land.landId !== d.landId) continue;
      } else if (!(land.slot && land.landId === undefined)) continue;
      last = { slot: land.slot || 0, x: land.x, y: land.y, zone: land.zone };
      if (d.firstLand) {
        const who = d.gaiaOnly ? 0 : land.slot;
        if (served.has(who)) break;
        served.add(who);
      }
      out.push({ slot: land.slot || 0, x: land.x, y: land.y, zone: land.zone });
    }
    if (this.lands.length && (last === undefined || !d.firstLand)) {
      const L = this.lands[this.lands.length - 1];
      last = { slot: L.slot || 0, x: L.x, y: L.y, zone: L.zone };
    }
    return [out, last];
  }

  /** de-connections-objects.md 5.2. */
  private nGroups(d: ObjectDesc): number {
    const g = grouping(d) !== undefined ? (d.nGroups ?? 1) : d.nObjects;
    if (g === 0) return 0;
    if (d.scaling === "map")
      return Math.max(Math.floor((g * this.w * this.h) / 10000), 1);
    if (d.scaling === "players") return g * this.players.length;
    return g;
  }

  private members(d: ObjectDesc): number {
    if (d.variance === 0) return Math.max(d.nObjects, 1);
    return Math.max(d.nObjects - d.variance + this.draw(2 * d.variance), 1);
  }

  /** One frame of one command. Returns the groups it asked for. */
  private command(
    d: ObjectDesc,
    frame: Frame | undefined,
    dispatched: boolean,
  ): number {
    const owner = d.gaiaOnly || frame === undefined ? 0 : frame.slot;
    this.scope = owner ? "player" : "gaia";
    const nAreas = this.areas.length;
    let ng = this.nGroups(d);
    const repId = this.rep(d);
    const rep = this.c.def(repId, this.scope);
    if (rep === undefined) return ng;
    // 2.5: an object of size 0 at maximum distance 0 goes on the origin.
    if (ng && d.maxP === 0 && rep.zero) {
      if (frame === undefined) return ng;
      if (
        this.commandTests(d, frame, frame.x, frame.y, repId, undefined, false)
      ) {
        this.placeGroup(
          d,
          [frame.x, frame.y],
          undefined,
          frame,
          owner,
          undefined,
        );
        this.placedGroups++;
      }
      return Math.min(ng, 1);
    }
    // Starting villagers (de-connections-objects.md 5.2).
    if (
      frame !== undefined &&
      d.objectId === VILLAGER &&
      grouping(d) === undefined &&
      d.nObjects === 1 &&
      d.variance === 0 &&
      ng === 1
    )
      ng = STARTING_VILLAGERS;
    const walking =
      d.aaIn !== undefined &&
      (d.aaIn !== 0 || this.lookup(0, dispatched) !== undefined);
    let lst = walking
      ? this.walk(d, ng, dispatched)
      : this.candidates(d, frame, nAreas);
    lst = this.order(lst, d, frame);
    const first = this.resolve(d, owner);
    if (!this.availTo(first, owner)) return ng;
    if (frame !== undefined && d.everyPlayer && rep.classId === CLASS_WALL) {
      this.walls(d, frame, owner);
      // A ring has no group count to fall short of.
      this.placedGroups += ng;
      return ng;
    }
    if (d.objectId !== undefined) this.replace(d.objectId, owner);
    if (ng === 0 || (!lst.length && !(d.force && frame !== undefined)))
      return ng;
    const queue = new TileQueue(lst, this.w * this.h);
    const fdef = this.def(first);
    const ignore = frame !== undefined && d.ignore;
    const pool: [readonly [number, number], number][] | undefined =
      grouping(d) !== undefined && d.minConn > 1 ? [] : undefined;
    const forced: [number, number][] | undefined =
      d.force && frame !== undefined ? [] : undefined;
    let g = 0;
    while (g < ng && queue.size) {
      const i = queue.next();
      let x = i % this.w;
      let y = Math.floor(i / this.w);
      if (
        frame !== undefined &&
        !d.ignore &&
        !this.playerZoneOk(fdef.restriction, frame, x, y)
      )
        continue;
      if (!this.commandTests(d, frame, x, y, first, nAreas, walking)) continue;
      if (!this.landZoneOk(d, frame, x, y)) {
        this.knockOut(d, frame!, x, y, queue);
        continue;
      }
      const ok = this.ownOk(fdef, x, y, owner, ignore);
      const lastResort =
        !ok &&
        frame !== undefined &&
        !queue.size &&
        grouping(d) === undefined &&
        forced === undefined &&
        fdef.classId !== CLASS_FARM;
      if (!ok && !lastResort) continue;
      if (ok && pool !== undefined) {
        const sel = this.connected(
          pool,
          [x, y],
          d.minConn,
          d.closest !== undefined && d.closest[0] === "origin",
        );
        if (sel === undefined) continue;
        [x, y] = sel;
      }
      if (forced !== undefined) forced.push([x, y]);
      if (lastResort) {
        // 6.2 step 4: the object alone, one resolution, the minimum square only.
        this.knockSquare(queue, x, y, d.minGroup);
        const id = this.resolve(d, owner);
        this.placeAtTile(id, x, y, owner, d);
        if (d.aa !== undefined && d.aa > 0)
          this.recordArea(
            d.aa,
            x,
            y,
            d.aaR,
            d.everyPlayer && frame !== undefined ? frame.slot : undefined,
          );
        const inv = this.resolve(d, owner);
        this.unavailable(x, y, d.minGroup, inv);
        g++;
        this.placedGroups++;
        continue;
      }
      for (const r of [d.minGroup, d.tempGroup])
        this.knockSquare(queue, x, y, r);
      if (pool !== undefined) {
        const keep = pool.filter(
          (p) =>
            Math.max(Math.abs(p[0][0] - x), Math.abs(p[0][1] - y)) > d.radius,
        );
        pool.length = 0;
        pool.push(...keep);
      }
      if (
        d.path !== undefined &&
        frame !== undefined &&
        !this.routeOk(d, frame, x, y)
      )
        continue;
      // placeGroup may take tiles out of the queue.
      this.placeGroup(d, [x, y], first, frame, owner, queue);
      const inv = this.resolve(d, owner);
      this.unavailable(x, y, d.minGroup, inv);
      g++;
      this.placedGroups++;
    }
    if (forced && forced.length && g < ng)
      this.forcePlace(d, owner, forced, fdef, g, ng, ignore);
    return ng;
  }

  private knockOut(
    d: ObjectDesc,
    frame: Frame,
    x: number,
    y: number,
    queue: TileQueue,
  ): void {
    const dd = d.alzD;
    if (dd <= 0) return;
    const s = square(frame.x - x) + square(frame.y - y);
    if (s <= dd * dd) return;
    if (d.minP !== undefined && s < d.minP * d.minP) return;
    if (d.maxP !== undefined && s > d.maxP * d.maxP) return;
    const rx = frame.x > x ? x + dd : x - dd;
    const ry = frame.y > y ? y + dd : y - dd;
    if (rx >= 0 && rx < this.w && ry >= 0 && ry < this.h) {
      queue.remove(ry * this.w + rx);
    }
  }

  /** Removes the tiles within `r` of (x, y) from the queue. */
  private knockSquare(queue: TileQueue, x: number, y: number, r: number): void {
    if (r < 0) return;
    for (let yy = Math.max(y - r, 0); yy <= Math.min(y + r, this.h - 1); yy++)
      for (let xx = Math.max(x - r, 0); xx <= Math.min(x + r, this.w - 1); xx++)
        queue.remove(yy * this.w + xx);
  }

  private unavailable(
    x: number,
    y: number,
    r: number,
    id: number | undefined,
  ): void {
    if (!r || id === undefined || id < 0) return;
    const def = this.c.def(id, this.scope);
    if (!def) return;
    for (let yy = Math.max(y - r, 0); yy <= Math.min(y + r, this.h - 1); yy++)
      for (let xx = Math.max(x - r, 0); xx <= Math.min(x + r, this.w - 1); xx++)
        if (this.c.accepts(def.restriction, this.T[yy * this.w + xx]))
          this.available[yy * this.w + xx] = 0;
  }

  /** 18.6. */
  private connected(
    pool: [readonly [number, number], number][],
    c: readonly [number, number],
    n: number,
    closest: boolean,
  ): readonly [number, number] | undefined {
    const comps = [
      ...new Set(
        pool
          .filter(
            (p) => Math.abs(p[0][0] - c[0]) + Math.abs(p[0][1] - c[1]) === 1,
          )
          .map((p) => p[1]),
      ),
    ].sort((a, b) => a - b);
    if (!comps.length) {
      this.nextClump++;
      pool.push([c, this.nextClump]);
      return undefined;
    }
    const low = comps[0];
    let k = 1;
    for (const p of pool)
      if (comps.includes(p[1])) {
        p[1] = low;
        k++;
      }
    if (k < n) {
      pool.push([c, low]);
      return undefined;
    }
    const i = closest ? 0 : this.draw(k);
    let m = 0;
    for (let idx = 0; idx < pool.length; idx++) {
      if (pool[idx][1] !== low) continue;
      if (m === i) return pool.splice(idx, 1)[0][0];
      m++;
    }
    return c;
  }

  // ---- groups (de-connections-objects.md 7, write-up 4, 5.4, 6.4, 10)

  private placeGroup(
    d: ObjectDesc,
    anchor: readonly [number, number],
    _first: number | undefined,
    frame: Frame | undefined,
    owner: number,
    parent: TileQueue | undefined,
  ): void {
    this.groupIds = new Set();
    const single = d.nObjects === 1 && d.variance === 0;
    const grp = single ? undefined : grouping(d);
    const ignore = frame !== undefined && d.ignore;
    if (grp === "tight") {
      const check = this.resolve(d, owner);
      if (d.objectId !== undefined) this.replace(d.objectId, owner);
      const cdef = this.c.def(check, this.scope);
      const count = this.members(d);
      const r = d.radius;
      const bounds = [
        Math.max(anchor[0] - r, 0),
        Math.min(anchor[0] + r, this.w - 1),
        Math.max(anchor[1] - r, 0),
        Math.min(anchor[1] + r, this.h - 1),
      ];
      let q: [[number, number], number][] = [[[anchor[0], anchor[1]], 0]];
      let placed = 0;
      while (q.length && placed < count) {
        const [x, y] = q.shift()![0];
        if (!this.landZoneOk(d, frame, x, y)) continue;
        const id = this.resolve(d, owner);
        this.put(d, id, x, y, owner, frame);
        this.available[y * this.w + x] = 0;
        for (const nb of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as [number, number][]) {
          if (!(
            bounds[0] <= nb[0] &&
            nb[0] <= bounds[1] &&
            bounds[2] <= nb[1] &&
            nb[1] <= bounds[3]
          ))
            continue;
          if (
            cdef === undefined ||
            !this.ownOk(cdef, nb[0], nb[1], owner, ignore)
          )
            continue;
          parent?.remove(nb[1] * this.w + nb[0]);
          const score = this.st.raw() & 0x7fff;
          q = q.filter((e) => e[0][0] !== nb[0] || e[0][1] !== nb[1]);
          let k = q.findIndex((e) => e[1] >= score);
          if (k < 0) k = q.length;
          q.splice(k, 0, [nb, score]);
        }
        placed++;
      }
      return;
    }
    if (grp === "loose") {
      const dispatched =
        d.everyPlayer || (d.landId !== undefined && d.landId >= 0);
      const cands =
        d.aaIn !== undefined &&
        (d.aaIn !== 0 || this.lookup(0, dispatched) !== undefined)
          ? this.walk(d, this.nGroups(d), dispatched)
          : this.localWindow(d, anchor, frame);
      let master: number;
      if (d.objectId === undefined) master = this.groupRoll(d.groupName!);
      else {
        master = this.replace(d.objectId, owner);
        this.replace(d.objectId, owner);
      }
      const count = this.members(d);
      if (parent !== undefined) for (const t of cands) parent.remove(t);
      if (!this.availTo(master, owner)) return;
      const cdef = this.c.def(master, this.scope);
      if (cdef === undefined) return;
      let placed = 0;
      for (const t of cands) {
        if (placed >= count) break;
        const x = t % this.w;
        const y = Math.floor(t / this.w);
        if (
          d.terrainToPlaceOn !== undefined &&
          this.T[t] !== d.terrainToPlaceOn
        )
          continue;
        if (d.layerToPlaceOn !== undefined && this.lay(t) !== d.layerToPlaceOn)
          continue;
        if (!this.ownOk(cdef, x, y, owner, ignore)) continue;
        if (d.zones.length && !this.inZone(d, x, y, cdef, true)) continue;
        const id = this.resolve(d, owner);
        this.put(d, id, x, y, owner, frame);
        placed++;
      }
      return;
    }
    // Single objects, also each of n ungrouped objects.
    let id: number;
    if (d.objectId === undefined) {
      if (frame !== undefined) this.groupRoll(d.groupName!);
      id = this.groupRoll(d.groupName!);
    } else {
      if (frame !== undefined) this.replace(d.objectId, owner);
      id = this.replace(d.objectId, owner);
    }
    this.put(d, id, anchor[0], anchor[1], owner, frame);
  }

  private put(
    d: ObjectDesc,
    id: number,
    x: number,
    y: number,
    owner: number,
    frame: Frame | undefined,
  ): Built | undefined {
    if (!this.c.has(id)) return undefined;
    const b = this.placeAtTile(id, x, y, owner, d);
    this.groupIds.add(b);
    if (d.aa !== undefined && d.aa > 0)
      this.recordArea(
        d.aa,
        x,
        y,
        d.aaR,
        d.everyPlayer && frame !== undefined ? frame.slot : undefined,
      );
    const s2 = this.secondObj(d, owner);
    if (s2 !== undefined && this.c.has(s2)) {
      const b2 = this.build(s2, [b.x, b.y], owner, undefined);
      this.groupIds.add(b2);
    }
    return b;
  }

  /** de-connections-objects.md 7.3 with write-up 6.1. */
  private localWindow(
    d: ObjectDesc,
    anchor: readonly [number, number],
    frame: Frame | undefined,
  ): number[] {
    const e = d.minEdge;
    const win = [
      Math.max(anchor[0] - d.radius, e),
      Math.min(anchor[0] + d.radius, Math.max(this.w - (e + 1), 0)),
      Math.max(anchor[1] - d.radius, e),
      Math.min(anchor[1] + d.radius, Math.max(this.h - (e + 1), 0)),
    ];
    const r2 = d.radius * d.radius;
    const dyn = d.zones.length > 0 && this.needsResolution(d);
    const stat = d.zones.length
      ? this.c.def(this.rep(d), this.scope)
      : undefined;
    const ok = (x: number, y: number): boolean => {
      if (!this.available[y * this.w + x]) return false;
      if (d.circular && square(x - anchor[0]) + square(y - anchor[1]) > r2)
        return false;
      const obj = dyn ? this.c.def(this.zoneResolve(d), this.scope) : stat;
      if (!this.areaRule(d, frame, x, y, undefined)) return false;
      return obj === undefined || this.inZone(d, x, y, obj, true);
    };
    const lst: number[] = [];
    for (let y = win[2]; y <= win[3]; y++)
      for (let x = win[0]; x <= win[1]; x++)
        if (ok(x, y)) lst.push(y * this.w + x);
    const [mnx, mxx, mny, mxy] = win;
    const xr = mxx - mnx - 1;
    const yr = mxy - mny - 1;
    if (!(xr > 1 && yr > 1)) return lst;
    const lastPick = new Int32Array(this.w * this.h).fill(-1);
    const picked: number[] = [];
    const picks = Math.floor((xr * yr) / 4);
    for (let k = 0; k < picks; k++) {
      const x = mnx + this.draw(xr);
      const y = mny + this.draw(yr);
      const i = y * this.w + x;
      if (ok(x, y)) {
        if (lastPick[i] < 0) picked.push(i);
        lastPick[i] = k;
      }
    }
    return movedToFront(lst, picked, lastPick);
  }

  // ---- Section 10 force_placement

  private forcePlace(
    d: ObjectDesc,
    owner: number,
    anchors: [number, number][],
    fdef: ObjectDef,
    g: number,
    ng: number,
    ignore: boolean,
  ): void {
    for (let pass = 1; pass < 1000; pass++)
      for (let k = anchors.length - 1; k >= 0; k--) {
        if (g >= ng) return;
        const [cx, cy] = anchors[k];
        let pos: [number, number];
        if (pass >= 10 && this.st.raw() % 5 === 0)
          pos = [F(cx + 0.5), F(cy + 0.5)];
        else {
          const a = this.st.raw();
          const b = this.st.raw();
          pos = [F(cx + (a & 1)), F(cy + (b & 1))];
        }
        if (!this.fit(fdef, pos, ignore, owner, pass < 10)) continue;
        const id = this.resolve(d, owner);
        if (!this.c.has(id)) continue;
        const b1 = this.build(id, pos, owner, d);
        const s2 = this.secondObj(d, owner);
        if (s2 !== undefined && this.c.has(s2))
          this.build(s2, [b1.x, b1.y], owner, undefined);
        g++;
        this.placedGroups++;
      }
  }

  // ---- Section 8 walls

  private gateFor(wall: number, axis: number): number | undefined {
    const rows =
      this.c.wallGates.byWallObject[String(wall)] ??
      this.c.wallGates.default ??
      undefined;
    return rows?.[axis]?.[0];
  }

  private walls(d: ObjectDesc, frame: Frame, owner: number): void {
    const inner = d.minP ?? 0;
    const outer = d.maxP ?? d.minP ?? 0;
    const key = `${inner}|${outer}`;
    if (!this.wallRoutes || this.wallRoutes[0] !== key)
      this.wallRoutes = [key, this.wallRouteSet(inner, outer)];
    if (owner === 0) return;
    const segs =
      this.wallRoutes[1].get(`${frame.slot}|${frame.x}|${frame.y}`) ?? [];
    const built = new Set<string>();
    for (const s of segs)
      for (let k = 0; k <= span(s); k++) built.add(along(s, k).join(","));
    const wallId = d.objectId ?? this.rep(d);
    for (const s of segs) {
      const n = span(s);
      const ax = axis(s);
      const [[sx, sy], [ex, ey]] = s;
      const step = [Math.sign(ex - sx), Math.sign(ey - sy)];
      const openEnd = new Map<number, boolean>(
        n === 0
          ? [[0, true]]
          : [
              [0, !built.has(`${sx - step[0]},${sy - step[1]}`)],
              [n, !built.has(`${ex + step[0]},${ey + step[1]}`)],
            ],
      );
      const g0 = Math.floor(n / 2) - 2;
      if (n >= 4) {
        const gate = this.gateFor(wallId, ax);
        if (gate !== undefined && this.c.has(gate)) {
          const gid = this.replace(gate, owner);
          const [gx, gy] =
            ax === AXIS_NE
              ? [sx + Math.floor(n / 2), sy - 1]
              : along(s, Math.floor(n / 2));
          const gdef = this.c.def(gid, this.scope);
          if (
            gdef &&
            gx >= 0 &&
            gy >= 0 &&
            gx < this.w &&
            gy < this.h &&
            this.c.accepts(gdef.restriction, this.T[gy * this.w + gx])
          )
            this.placeAtTile(gid, gx, gy, owner, d);
        }
        if (d.aa !== undefined && d.aa > 0)
          this.recordArea(d.aa, sx, sy, d.aaR, frame.slot);
      }
      for (let k = 0; k <= n; k++) {
        if (n >= 4 && g0 <= k && k < g0 + 4) continue;
        const [x, y] = along(s, k);
        const wdef = this.c.def(wallId, this.scope);
        if (!wdef || !this.c.accepts(wdef.restriction, this.T[y * this.w + x]))
          continue;
        const id = this.resolve(d, owner);
        if (!this.c.has(id)) continue;
        const b = this.placeAtTile(id, x, y, owner, d);
        b.facet =
          (k === 0 || k === n) && (openEnd.get(k) ?? true) ? 2 : AXIS_SHAPE[ax];
        b.angle = undefined;
        b.wallPiece = true;
        if (d.aa !== undefined && d.aa > 0)
          this.recordArea(d.aa, x, y, d.aaR, frame.slot);
      }
    }
  }

  private wallRouteSet(
    inner: number,
    outer: number,
  ): Map<string, [number, number][][]> {
    const { w, h } = this;
    const walk = this.walkGrid();
    const conn = new Uint8Array(w * h);
    for (let t = 0; t < w * h; t++)
      conn[t] =
        walk[t] &&
        ((t % w > 0 && walk[t - 1]) ||
          (t % w < w - 1 && walk[t + 1]) ||
          (t >= w && walk[t - w]) ||
          (t + w < w * h && walk[t + w]))
          ? 1
          : 0;
    const villager = this.c.def(VILLAGER, "gaia")!;
    const land = new Uint8Array(w * h);
    for (let t = 0; t < w * h; t++)
      land[t] = this.c.accepts(villager.restriction, this.T[t]) ? 1 : 0;
    const res = new Set<string>();
    for (const b of this.objects)
      if (!b.dropped && [8, 32, 63].includes(b.def.classId))
        res.add(`${Math.floor(b.x)},${Math.floor(b.y)}`);
    const hasRes = (x: number, y: number): boolean =>
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ].some(([dx, dy]) => res.has(`${x + dx},${y + dy}`));
    const frames: [number, [number, number], [number, number]][] = [];
    for (const L of this.lands)
      if (L.slot && L.landId === undefined) {
        let c: [number, number] | undefined;
        for (const id of WALL_CENTRES) {
          const b = this.objects.find(
            (o) =>
              o.owner === L.slot && o.id === id && !o.dropped && o.depth === 0,
          );
          if (b) {
            c = [Math.floor(b.x), Math.floor(b.y)];
            break;
          }
        }
        frames.push([L.slot, [L.x, L.y], c ?? [L.x, L.y]]);
      }
    let masks = new Int32Array(w * h);
    const painted = new Map<string, Set<number>>();
    for (const [slot, , c] of [...frames].sort((a, b) => a[0] - b[0])) {
      const bit = 1 << (slot - 1);
      const pk = `${slot}|${c[0]}|${c[1]}`;
      if (!painted.has(pk)) painted.set(pk, new Set());
      const ps = painted.get(pk)!;
      const [X, Y] = c;
      const bands: [number, number, number, number][] = [
        [X - outer, Y - outer, X - inner, Y + outer],
        [X + inner, Y - outer, X + outer, Y + outer],
        [X - outer, Y - outer, X + outer, Y - inner],
        [X - outer, Y + inner, X + outer, Y + outer],
      ];
      bands.forEach(([x0, y0, x1, y1], band) => {
        if (x0 >= w || x1 < 0 || y0 >= h || y1 <= 0) return;
        const lx = Math.max(x0, 0);
        const ly = Math.max(y0, 0);
        const hx = Math.min(x1, w - 1);
        const hy = Math.min(y1, w - 1, h - 1);
        const down = band === 0 || band === 1;
        const start: [number, number] =
          band === 0 ? [hx, ly] : band === 2 ? [lx, hy] : [lx, ly];
        const sLine = down ? ly : lx;
        const goal = down ? hy : hx;
        const cost = (x: number, y: number, diag: boolean): number => {
          const t = y * w + x;
          if (masks[t]) return 2000;
          const tr = this.T[t];
          if ([26, 35, 37, 127].includes(tr)) return 600;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return 10;
          if (conn[t])
            return (
              ([
                4, 26, 54, 55, 59, 63, 64, 65, 66, 67, 90, 93, 94, 111, 115,
              ].includes(tr)
                ? 300
                : 100) + (diag ? 10 : 0)
            );
          if (hasRes(x, y)) return 300;
          return (
            10 +
            (band === 2
              ? y - ly
              : band === 0
                ? x - lx
                : band === 1
                  ? hx - x
                  : hy - y)
          );
        };
        const nodes: [number, number, number, number | undefined][] = [
          [start[0], start[1], 0, undefined],
        ];
        const seen = new Set([start[1] * w + start[0]]);
        const heap = new MinHeap();
        heap.push(0, 0);
        let found: number | undefined;
        for (;;) {
          const top = heap.pop();
          if (top === undefined) break;
          const cur = -top[1];
          const [x0n, y0n, c0] = nodes[cur];
          if ((down ? y0n : x0n) === goal) {
            found = cur;
            break;
          }
          for (const [dx, dy, dg] of WALL_STEPS) {
            const x = x0n + dx;
            const y = y0n + dy;
            if (
              !(lx <= x && x <= hx && ly <= y && y <= hy) ||
              seen.has(y * w + x)
            )
              continue;
            const a = down ? y : x;
            const cc =
              a === goal ? c0 - 100 : a === sLine ? c0 : c0 + cost(x, y, dg);
            heap.push(cc + (goal - a), -nodes.length);
            nodes.push([x, y, cc, cur]);
            seen.add(y * w + x);
          }
        }
        while (found !== undefined) {
          const [x, y, , prev] = nodes[found];
          masks[y * w + x] |= bit;
          ps.add(y * w + x);
          found = prev;
        }
      });
    }
    const flood = (
      c: [number, number],
      stop: (i: number) => boolean,
    ): Set<number> => {
      const s = c[1] * w + c[0];
      const reached = new Set([s]);
      const todo = [s];
      while (todo.length) {
        const t = todo.pop()!;
        const x = t % w;
        const y = Math.floor(t / w);
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ])
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const i = ny * w + nx;
            if (!reached.has(i) && land[i]) {
              reached.add(i);
              if (!stop(i)) todo.push(i);
            }
          }
      }
      return reached;
    };
    const cents = [
      ...new Map(
        frames.map(([s, , c]) => [
          `${s}|${c[0]}|${c[1]}`,
          [s, c] as [number, [number, number]],
        ]),
      ).values(),
    ].sort((a, b) => a[0] - b[0] || a[1][0] - b[1][0] || a[1][1] - b[1][1]);
    const inside = new Int32Array(w * h);
    for (const [s, c] of cents) {
      const bit = 1 << (s - 1);
      for (const t of flood(c, (i) => (masks[i] & bit) !== 0)) inside[t] |= bit;
    }
    masks = masks.map((m, i) => m & inside[i]);
    const outside = new Int32Array(w * h);
    for (const [s, c] of cents) {
      let en = 0;
      for (const p of this.players) {
        const ts = this.team.get(s) ?? 0;
        if (!(p.slot === s || (ts !== 0 && ts === p.team)))
          en |= 1 << (p.slot - 1);
      }
      for (const t of flood(c, (i) => (masks[i] & en) !== 0)) outside[t] |= en;
    }
    masks = masks.map((m, i) => m & outside[i]);
    // Runs (8 step 3).
    const used = new Uint8Array(w * h);
    const runs = new Map<number, [[number, number][], number][]>();
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const m = masks[y * w + x];
        if (used[y * w + x] || !m) continue;
        for (let b = 0; b < 8; b++) {
          const bit = 1 << b;
          if (!(m & bit)) continue;
          const wk = conn[y * w + x];
          const same = (nx: number, ny: number): boolean =>
            masks[ny * w + nx] === bit && conn[ny * w + nx] === wk;
          let dx = 0;
          let dy = 0;
          if (x < w - 1 && same(x + 1, y)) [dx, dy] = [1, 0];
          else if (x < w - 1 && y < h - 1 && same(x + 1, y + 1))
            [dx, dy] = [1, 1];
          else if (y < h - 1 && same(x, y + 1)) [dx, dy] = [0, 1];
          else if (y > 0 && x < w - 1 && same(x + 1, y - 1)) [dx, dy] = [1, -1];
          let px = x;
          let py = y;
          let end: [number, number] = [x, y];
          for (;;) {
            if (conn[py * w + px] !== wk) break;
            used[py * w + px] = 1;
            end = [px, py];
            if (dx === 0 && dy === 0) break;
            const nx = px + dx;
            const ny = py + dy;
            if (
              !(nx >= 0 && nx < w && ny >= 0 && ny < h) ||
              !(masks[ny * w + nx] & bit)
            )
              break;
            px = nx;
            py = ny;
          }
          if (!runs.has(b)) runs.set(b, []);
          runs.get(b)!.push([[[x, y], end], wk]);
        }
      }
    const out = new Map<string, [number, number][][]>();
    for (const [slot, pos, c] of frames) {
      const ps = painted.get(`${slot}|${c[0]}|${c[1]}`) ?? new Set<number>();
      const list = [...(runs.get(slot - 1) ?? [])]
        .reverse()
        .filter(([s, wk]) => wk && ps.has(s[0][1] * w + s[0][0]))
        .map(([s]) => s);
      out.set(`${slot}|${pos[0]}|${pos[1]}`, list);
    }
    return out;
  }

  /** 2.3: wall pieces of ordinary commands store a joint shape from their final neighbours. */
  private wallJoints(): void {
    const all = this.objects
      .slice(this.first)
      .filter(
        (b) =>
          b.depth === 0 &&
          !b.dropped &&
          b.def.classId === CLASS_WALL &&
          b.def.creation.randomAngle,
      );
    const at = new Set(
      all.map((b) => `${b.owner}|${Math.floor(b.x)}|${Math.floor(b.y)}`),
    );
    for (const b of all) {
      if (b.wallPiece) continue;
      const o = b.owner;
      const x = Math.floor(b.x);
      const y = Math.floor(b.y);
      const has = (dx: number, dy: number): boolean =>
        at.has(`${o}|${x + dx}|${y + dy}`);
      b.facet =
        has(0, 1) && has(0, -1)
          ? 1
          : has(1, 0) && has(-1, 0)
            ? 0
            : has(1, -1) && has(-1, 1)
              ? 4
              : has(1, 1) && has(-1, -1)
                ? 3
                : 2;
      b.angle = undefined;
    }
  }

  /** Section 12: farms only. */
  private foundations(): void {
    const compatible = FOUNDATION_SOURCES;
    for (const b of this.objects.slice(this.first)) {
      const f = b.def.foundation;
      if (f === undefined || b.def.classId !== CLASS_FARM || b.dropped)
        continue;
      const fw = Math.round(b.def.ch[0] * 2);
      const fh = Math.round(b.def.ch[1] * 2);
      const x0 = Math.trunc(b.x - fw / 2);
      const y0 = Math.trunc(b.y - fh / 2);
      for (let dy = 0; dy < fh; dy++)
        for (let dx = 0; dx < fw; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (
            x >= 0 &&
            x < this.w &&
            y >= 0 &&
            y < this.h &&
            compatible.has(this.T[y * this.w + x])
          ) {
            this.T[y * this.w + x] = f;
            this.paint?.(y * this.w + x, f);
          }
        }
    }
  }

  /** The objects the commands built and kept, children and deleted ones left out, as the file holds them. */
  scripted(): Built[] {
    return this.objects
      .slice(this.first)
      .filter((b) => !b.dropped && b.depth === 0);
  }

  /** Children too: everything that takes part in the map (for the renderer's footprints). */
  allBuilt(): Built[] {
    return this.objects.slice(this.first).filter((b) => !b.dropped);
  }
}

/** The terrains the ordinary foundation paints over (the dat's foundation rule for terrain 27). */
const FOUNDATION_SOURCES = new Set([
  0, 3, 7, 8, 9, 12, 29, 30, 31, 32, 34, 63, 64, 65, 66, 67, 117, 118, 119, 120,
  121,
]);

const AXIS_NE = 0;
const AXIS_SE = 1;
const AXIS_HORIZ = 2;
const AXIS_VERT = 3;
/** The stored shape of a run's inner pieces, by run direction (8 step 5). */
const AXIS_SHAPE = [4, 3, 0, 1];

const WALL_STEPS: [number, number, boolean][] = [
  [1, 1, true],
  [-1, 1, true],
  [1, -1, true],
  [-1, -1, true],
  [1, 0, false],
  [-1, 0, false],
  [0, 1, false],
  [0, -1, false],
];

/**
 * A command's candidate list (de-connections-objects.md 6.3). Groups take
 * tiles from the front, and the spacing squares take tiles out anywhere. A
 * flag per tile makes a removal constant time, where filtering the array cost
 * a pass over the whole list for every group placed.
 */
class TileQueue {
  private pos = 0;
  size: number;
  private readonly live: Uint8Array;

  constructor(
    private readonly order: readonly number[],
    tiles: number,
  ) {
    this.live = new Uint8Array(tiles);
    for (const t of order) this.live[t] = 1;
    this.size = order.length;
  }

  /** The front tile, taken off. Only call while `size` is above 0. */
  next(): number {
    while (!this.live[this.order[this.pos]]) this.pos++;
    const t = this.order[this.pos++];
    this.live[t] = 0;
    this.size--;
    return t;
  }

  remove(t: number): void {
    if (this.live[t]) {
      this.live[t] = 0;
      this.size--;
    }
  }
}

/**
 * The shuffle's result (de-connections-objects.md 6.1 step 3). Each pick
 * moves its tile to the front, so the tiles picked come first, the most
 * recently picked first, and the rest keep their order. Computed from each
 * tile's last pick rather than by moving entries one pick at a time, which
 * cost a quadratic splice on a map of 650 commands.
 */
function movedToFront(
  lst: readonly number[],
  picked: number[],
  lastPick: Int32Array,
): number[] {
  picked.sort((a, b) => lastPick[b] - lastPick[a]);
  return picked.concat(lst.filter((i) => lastPick[i] < 0));
}

function span(s: [number, number][]): number {
  const [[sx, sy], [ex, ey]] = s;
  return Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
}

function along(s: [number, number][], k: number): [number, number] {
  const [[sx, sy], [ex, ey]] = s;
  const st = (a: number, b: number): number =>
    a < b ? a + k : a > b ? a - k : a;
  return [st(sx, ex), st(sy, ey)];
}

function axis(s: [number, number][]): number {
  const [[sx, sy], [ex, ey]] = s;
  if (sy > ey) return AXIS_NE;
  if (sx < ex && sy < ey) return AXIS_SE;
  if (sx >= ex) return AXIS_VERT;
  return AXIS_HORIZ;
}

/**
 * Python's heapq over (priority, -node) pairs: smallest priority first, and
 * among equals the larger node index (the newest) first, which is the wall
 * search's tie rule (8 step 1).
 */
class MinHeap {
  private readonly a: [number, number][] = [];

  private less(i: number, j: number): boolean {
    const x = this.a[i];
    const y = this.a[j];
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }

  push(p: number, n: number): void {
    const a = this.a;
    a.push([p, n]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export { AXIS_HORIZ, AXIS_SE, AXIS_VERT, CLASS_CLIFF_ZONE, CLASS_FOREST_ZONE };
