// The terrain's own objects, docs/preview-design.md Sec.6.6 (rev 12). PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// Each terrain has a table of objects in the dat, trees for a forest and
// decorations for the rest. The game draws a tile's table at four moments,
// and this file is the one record of every object those draws make, from the
// land stage to the end of the object stage:
//
//   1. the land stage's cleanup, on each tile it restores to the base terrain;
//   2. the cliff stage, on each tile a cliff line refreshes, after taking off
//      the objects the tile's old terrain made or its new terrain refuses;
//   3. at the end of the terrain stage and of the connection stage a changed
//      tile loses the same objects, but nothing is drawn;
//   4. the object stage's pass over every tile, which first RETIRES the
//      objects the tile's current table made in an earlier stage (status 7,
//      kept in the saved map) and then draws the table again.
//
// So a forest tile restored in the land stage holds two trees in DE's file,
// a retired one and a live one. That is the game, not a double count.
//
// The where-draws (positions, acceptance rolls) come from the shared stream,
// which every caller passes in. Facings come from stream 6, which this world
// owns, because nothing else in the generation reads it until the scripted
// objects, and they read it after this world's last draw.

import type { DeStream } from "./deRandom";
import type { CliffPiece } from "./types";
import {
  storedFrame,
  type ObjectCatalog,
  type ObjectDef,
} from "./deObjectData";

const F = Math.fround;
/** 2^-32, the scale from one raw draw to a fraction of a tile. */
const RAW_TO_UNIT = 2.3283064365386963e-10;

/** The beach terrains, whose tiles keep their objects when a pass turns them into beach (de-connections-objects.md 4.3). */
const BEACH_TERRAINS = new Set([2, 51]);

export const STAGE_LAND = 0;
export const STAGE_CLIFF = 1;
export const STAGE_OBJECT = 2;

export interface DecorationSlot {
  objectId: number;
  densityPerMille: number;
  centered: boolean;
}

export interface TerrainObject {
  id: number;
  /** Position in tiles, as a 32-bit float. */
  x: number;
  y: number;
  /** The tile its position lies on. */
  tile: number;
  /** The terrain whose table made it. */
  source: number;
  stage: number;
  facet: number;
  /** What the file's frame field holds. */
  frame: number;
  alive: boolean;
  /** 2 live, 7 retired by the object stage's pass. */
  status: number;
}

/** An object some other object may overlap: a definition and a position. */
interface Blocker {
  def: ObjectDef;
  x: number;
  y: number;
}

export class TerrainObjectWorld {
  readonly objects: TerrainObject[] = [];
  readonly byTile: TerrainObject[][];
  /** Stream 6 of the seed's chain. The scripted objects continue it. */
  readonly facings: DeStream;

  constructor(
    readonly catalog: ObjectCatalog,
    readonly dim: number,
    private readonly tables: ReadonlyMap<number, readonly DecorationSlot[]>,
    facings: DeStream,
  ) {
    this.byTile = Array.from({ length: dim * dim }, () => []);
    this.facings = facings;
  }

  private table(terrain: number): readonly DecorationSlot[] {
    return this.tables.get(terrain) ?? [];
  }

  private def(id: number): ObjectDef | undefined {
    // Terrain objects carry gaia's effects whoever tests them (write-up 1.5).
    return this.catalog.def(id, "gaia");
  }

  private make(
    id: number,
    x: number,
    y: number,
    facet: number,
    source: number,
    stage: number,
  ): TerrainObject {
    const def = this.def(id)!;
    const tile = Math.floor(y) * this.dim + Math.floor(x);
    const o: TerrainObject = {
      id,
      x,
      y,
      tile,
      source,
      stage,
      facet,
      frame: storedFrame(def, facet, undefined),
      alive: true,
      status: 2,
    };
    this.objects.push(o);
    this.byTile[tile].push(o);
    return o;
  }

  private destroy(o: TerrainObject): void {
    o.alive = false;
    const list = this.byTile[o.tile];
    list.splice(list.indexOf(o), 1);
  }

  /** Live objects that are not retired, on the tiles within `r` of `tile`. */
  private near(tile: number, r = 3): TerrainObject[] {
    const tx = tile % this.dim;
    const ty = Math.floor(tile / this.dim);
    const out: TerrainObject[] = [];
    for (let y = Math.max(ty - r, 0); y <= Math.min(ty + r, this.dim - 1); y++)
      for (
        let x = Math.max(tx - r, 0);
        x <= Math.min(tx + r, this.dim - 1);
        x++
      )
        for (const o of this.byTile[y * this.dim + x])
          if (o.status !== 7) out.push(o);
    return out;
  }

  /**
   * One tile's table on the shared stream (de-elevation-cliffs.md 5.4).
   * A randomized slot spends two raws for its position and, below 1000 per
   * mille, a third for its roll. A centred one spends only the roll.
   */
  private consume(
    terrain: number,
    stream: DeStream,
    commit: (
      id: number,
      xs: number | undefined,
      ys: number | undefined,
    ) => void,
  ): void {
    for (const slot of this.table(terrain)) {
      const w = slot.densityPerMille;
      if (w === 0) continue;
      let xs: number | undefined;
      let ys: number | undefined;
      if (!slot.centered) {
        xs = stream.raw();
        ys = stream.raw();
      }
      const ok =
        w === 1000 || Math.floor((stream.raw() * 1000) / 4294967296) < w;
      if (ok && this.catalog.has(slot.objectId)) commit(slot.objectId, xs, ys);
    }
  }

  private position(
    tile: number,
    xs: number | undefined,
    ys: number | undefined,
  ): [number, number] {
    const tx = tile % this.dim;
    const ty = Math.floor(tile / this.dim);
    if (xs === undefined || ys === undefined) return [F(tx + 0.5), F(ty + 0.5)];
    const axis = (t: number, s: number): number => {
      const unit = Math.min(Math.max(F(s * RAW_TO_UNIT), 0), 1);
      return F(t + unit);
    };
    return [axis(tx, xs), axis(ty, ys)];
  }

  private clamp(x: number, y: number): [number, number] {
    const top = F(F(this.dim) - F(0.001));
    return [Math.min(Math.max(x, 0), top), Math.min(Math.max(y, 0), top)];
  }

  private fitsTerrain(
    d: ObjectDef,
    cx: number,
    cy: number,
    terrainAt: (i: number) => number,
  ): boolean {
    const lx = F(cx - d.ph[0]);
    const ly = F(cy - d.ph[1]);
    const ux = F(F(d.ph[0] + cx) - F(0.001));
    const uy = F(F(d.ph[1] + cy) - F(0.001));
    if (lx < 0 || ly < 0 || ux >= this.dim || uy >= this.dim) return false;
    for (let y = Math.floor(ly); y <= Math.floor(uy); y++)
      for (let x = Math.floor(lx); x <= Math.floor(ux); x++)
        if (this.catalog.refuses(d.restriction, terrainAt(y * this.dim + x)))
          return false;
    return true;
  }

  private overlaps(
    d: ObjectDef,
    cx: number,
    cy: number,
    others: Iterable<Blocker>,
  ): boolean {
    for (const e of others) {
      if (!e.def.obstructs || e.def.canBuildOn) continue;
      if (
        e.def.ch[0] > 0 &&
        e.def.ch[1] > 0 &&
        Math.abs(F(e.x - cx)) < F(d.ph[0] + e.def.ch[0]) &&
        Math.abs(F(e.y - cy)) < F(d.ph[1] + e.def.ch[1])
      )
        return true;
    }
    return false;
  }

  private collides(d: ObjectDef): boolean {
    return !d.pcNone && (d.ph[0] > 0 || d.ph[1] > 0);
  }

  private facetFrom(d: ObjectDef, sample: number | undefined): number {
    if (d.creation.fixedFacet !== undefined) return d.creation.fixedFacet;
    if (d.creation.randomFacet && sample !== undefined)
      return Math.min(
        Math.floor((d.creation.facets * (sample & 0x7fff)) / 0x7fff),
        d.creation.facets - 1,
      );
    return 0;
  }

  private pieceBlockers(pieces: Iterable<CliffPiece>): Blocker[] {
    const out: Blocker[] = [];
    for (const p of pieces) {
      const def = this.def(p.objectId);
      if (def) out.push({ def, x: F(p.x), y: F(p.y) });
    }
    return out;
  }

  private blockerOf(o: TerrainObject): Blocker | undefined {
    const def = this.def(o.id);
    return def ? { def, x: o.x, y: o.y } : undefined;
  }

  /**
   * 1. A tile the land stage's cleanup restored to the base terrain. The
   * object must fit on the land stage's terrain and not overlap an earlier
   * land-stage object with a footprint. Each object spends one stream-6 draw.
   */
  landRestore(
    stream: DeStream,
    tile: number,
    baseTerrain: number,
    terrainAt: (i: number) => number,
  ): void {
    this.consume(baseTerrain, stream, (id, xs, ys) => {
      const d = this.def(id)!;
      const [cx, cy] = this.position(tile, xs, ys);
      if (!this.fitsTerrain(d, cx, cy, terrainAt)) return;
      if (this.collides(d)) {
        const others: Blocker[] = [];
        for (const o of this.objects)
          if (o.alive && o.stage === STAGE_LAND) {
            const b = this.blockerOf(o);
            if (b && b.def.footprint) others.push(b);
          }
        if (this.overlaps(d, cx, cy, others)) return;
      }
      const s = this.facings.raw();
      const [x, y] = this.clamp(cx, cy);
      this.make(id, x, y, this.facetFrom(d, s), baseTerrain, STAGE_LAND);
    });
  }

  /**
   * 2. A tile a cliff line refreshes, `previous` being its terrain before.
   * The objects of the old terrain's table, and those the new terrain
   * refuses, go first, then the current terrain's table is drawn against the
   * objects nearby and the cliff pieces placed so far.
   */
  refresh(
    stream: DeStream,
    tile: number,
    previous: number,
    terrain: Uint16Array,
    pieces: () => Iterable<CliffPiece>,
  ): void {
    this.dropChanged(tile, previous, terrain[tile], false);
    const source = terrain[tile];
    this.consume(source, stream, (id, xs, ys) => {
      const d = this.def(id)!;
      const [cx, cy] = this.position(tile, xs, ys);
      if (!this.fitsTerrain(d, cx, cy, (i) => terrain[i])) return;
      if (this.collides(d)) {
        const others: Blocker[] = [];
        for (const o of this.near(tile)) {
          const b = this.blockerOf(o);
          if (b) others.push(b);
        }
        others.push(...this.pieceBlockers(pieces()));
        if (this.overlaps(d, cx, cy, others)) return;
      }
      const s = this.facings.raw();
      const [x, y] = this.clamp(cx, cy);
      this.make(id, x, y, this.facetFrom(d, s), source, STAGE_CLIFF);
    });
  }

  private dropChanged(
    tile: number,
    previous: number,
    now: number,
    keepOnBeach: boolean,
  ): void {
    const beach = keepOnBeach && BEACH_TERRAINS.has(now);
    const ids = new Set<number>();
    if (!beach) for (const slot of this.table(previous)) ids.add(slot.objectId);
    for (const o of [...this.byTile[tile]]) {
      const d = this.def(o.id);
      if (
        ids.has(o.id) ||
        (d !== undefined && this.catalog.refuses(d.restriction, now))
      )
        this.destroy(o);
    }
  }

  /**
   * 3. A tile the end of the terrain stage or the connection stage changed,
   * with no redraw. A tile turned into a beach keeps its objects unless the
   * beach refuses them (de-connections-objects.md 4.3).
   */
  changed(tile: number, previous: number, now: number): void {
    if (previous !== now) this.dropChanged(tile, previous, now, true);
  }

  /**
   * 4. The object stage's pass, after its burned draw, over every tile in
   * index order. `tableOf` names the table a tile draws (a composite tile
   * draws its composite's, write-up 11), `terrain` is what objects must fit
   * on. Returns nothing: the stream and stream 6 move on in place.
   */
  objectStage(
    stream: DeStream,
    terrain: Uint16Array,
    pieces: Iterable<CliffPiece>,
    tableOf: (tile: number) => number,
  ): void {
    stream.raw();
    const pieceList = this.pieceBlockers(pieces);
    // Objects made before this stage on a tile whose terrain has changed
    // since block new ones. Retiring takes an object off this set.
    const blocking = new Set<TerrainObject>();
    for (const o of this.objects)
      if (o.alive && o.source !== terrain[o.tile]) blocking.add(o);
    const n = this.dim * this.dim;
    for (let tile = 0; tile < n; tile++) {
      const tid = tableOf(tile);
      const ids = new Set(this.table(tid).map((s) => s.objectId));
      for (const o of this.byTile[tile])
        if (o.stage !== STAGE_OBJECT && o.status !== 7 && ids.has(o.id)) {
          o.status = 7;
          blocking.delete(o);
        }
      this.consume(tid, stream, (id, xs, ys) => {
        const d = this.def(id)!;
        const [cx, cy] = this.position(tile, xs, ys);
        if (!this.fitsTerrain(d, cx, cy, (i) => terrain[i])) return;
        if (this.collides(d)) {
          if (this.overlaps(d, cx, cy, pieceList)) return;
          const near: Blocker[] = [];
          for (const o of this.near(tile))
            if (o.stage === STAGE_OBJECT || blocking.has(o)) {
              const b = this.blockerOf(o);
              if (b && b.def.footprint) near.push(b);
            }
          if (this.overlaps(d, cx, cy, near)) return;
        }
        // One stream-6 draw per flag the object carries, the facet from the first.
        let s: number | undefined;
        const c = d.creation;
        for (const flag of [c.randomFacet, c.randomAngle, c.combatSeed])
          if (flag) {
            const v = this.facings.raw();
            if (s === undefined) s = v;
          }
        const [x, y] = this.clamp(cx, cy);
        this.make(id, x, y, this.facetFrom(d, s), tid, STAGE_OBJECT);
      });
    }
  }

  /** The objects still on the map, in creation order. */
  live(): TerrainObject[] {
    return this.objects.filter((o) => o.alive);
  }
}

/** Every terrain's decoration table, by terrain id, from game-constants.json's terrain rows. */
export function decorationTables(
  constants: readonly {
    constId: number | null;
    category: string;
    decorations?: readonly DecorationSlot[];
  }[],
): Map<number, readonly DecorationSlot[]> {
  const out = new Map<number, readonly DecorationSlot[]>();
  for (const row of constants)
    if (row.category === "terrain" && row.constId !== null && row.decorations)
      out.set(row.constId, row.decorations);
  return out;
}
