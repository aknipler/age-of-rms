// The object data DE's object stage reads, docs/preview-design.md Sec.6.6
// (rev 12). PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// `reference/data/object-data.json` holds the dat's raw fields, written by
// `tools/extract-constants --object-data`. This file turns a raw row into the
// `ObjectDef` the stage tests against, with the script's effects applied.
// The rules that turn raw fields into the stage's terms come from the DE
// study's write-ups, and the object gate (`deObjectMaps.test.ts`) holds them
// to every object of 339 maps DE saved:
//
//   - placement family: "terrain" below constructor type 70, "collision" at
//     70, "occupancy" at 80;
//   - position family: "base" below 30, "moving" at 30, "combat" at 60 and
//     70, "building" at 80;
//   - an object of type 30 and up checks occupancy by its movement speed;
//   - it has no placement collision when its vertical extent is 0 and it is
//     not a building;
//   - it obstructs when its pathing action is not 0 and its collision
//     half-width is not 0;
//   - its creation draws follow from its constructor type and its standing
//     graphic (`creationOf`, write-up 2.1).
//
// Every number that the game holds as a 32-bit float is kept as the double
// `Math.fround` gives, so a comparison here is the comparison the game makes.
// This is a project choice that `float32.ts` already makes for the land
// stage. The obvious alternative, plain doubles, moves a position by one
// 1/256 tile often enough to break the gate.

import type { TerrainClassTable } from "./terrainClass";

/** The file `tools/extract-constants --object-data` writes. Field names are its short keys. */
export interface ObjectDataFile {
  civilizationCount: number;
  objects: readonly RawObjectRow[];
  graphics: Readonly<Record<string, readonly number[]>>;
  restrictions: readonly (readonly number[])[];
  townCentreAttribute: readonly number[];
  wallGates: {
    rows: readonly string[];
    byWallObject: Readonly<Record<string, readonly (readonly number[])[]>>;
    default?: readonly (readonly number[])[] | null;
  };
}

export interface RawObjectRow {
  id: number;
  cls: number;
  type: number;
  g?: number;
  hp: number;
  r: number;
  c: readonly number[];
  p: readonly number[];
  z: number;
  o: readonly number[];
  spd?: number;
  cbo?: 1;
  slope?: number;
  act?: number;
  kind?: number;
  ctr?: readonly number[];
  side?: readonly number[];
  res?: readonly number[];
  fnd?: number;
  ann?: readonly (readonly number[])[];
  civs?: readonly number[];
  hid?: 1;
}

/** How an object takes part in another object's overlap test (write-up 18.5). */
export type PlacementFamily = "terrain" | "collision" | "occupancy";
export type PositionFamily = "base" | "moving" | "combat" | "building";

/** The draws an object is built with on stream 6, and what its file record holds (write-up 2.1, 2.3). */
export interface CreationDraws {
  facets: number;
  randomFacet: boolean;
  randomAngle: boolean;
  combatSeed: boolean;
  /** Present when the object has a fixed facet, which only decides what the file stores. */
  fixedFacet?: number;
}

export interface ObjectDef {
  id: number;
  classId: number;
  /** The constructor type: 10 for a plain object up to 80 for a building. */
  ctype: number;
  hp: number;
  /** Terrain restriction, -1 for none. */
  restriction: number;
  /** Collision half-size, after effects. */
  ch: readonly [number, number];
  /** Placement half-size. */
  ph: readonly [number, number];
  vertical: number;
  outline: readonly [number, number];
  speed: number;
  usesSpeed: boolean;
  canBuildOn: boolean;
  /** Placement collision "none" (write-up 18.5). */
  pcNone: boolean;
  /** Obstruction "circle" rather than "none". */
  obstructs: boolean;
  /** A footprint that is not 0 on both axes. The land stage's overlaps only count these. */
  footprint: boolean;
  family: PlacementFamily;
  positionFamily: PositionFamily;
  slope: number;
  action: number;
  centreTerrains: readonly number[];
  sideTerrains: readonly number[];
  resource: readonly [number, number];
  foundation?: number;
  annexes: readonly (readonly [number, number, number])[];
  /** Civilizations whose unit table holds it; undefined for all. */
  civs?: ReadonlySet<number>;
  hidden: boolean;
  /** No footprint, no obstruction and no foundation (write-up 2.5). */
  zero: boolean;
  creation: CreationDraws;
  /** Spends two stream-3 raws when built (write-up 2.2). */
  animated: boolean;
  /** The current standing graphic's frame count, for the stored start frame. */
  frames?: number;
  /** In 1/256 tile, how much further than its half-size a moving unit keeps from the map's edges. */
  edgeMargin: number;
}

/** What the script's effects set for one object in one scope (write-up Section 1). */
export interface ObjectOverride {
  hp?: number;
  chx?: number;
  chy?: number;
  restriction?: number;
  graphic?: number;
  /** `(GAIA_)UPGRADE_UNIT A B`: A is built with B's creation draws (write-up 2.4). */
  upgrade?: number;
}

export type EffectScope = "gaia" | "player";

const F = Math.fround;
const FOREST_CLASS = 15;
const CLIFF_CLASS = 34;

export const CLASS_FOREST_ZONE = FOREST_CLASS;
export const CLASS_CLIFF_ZONE = CLIFF_CLASS;
export const CLASS_WALL = 27;
export const CLASS_GATE = 39;
export const CLASS_FARM = 49;
export const CLASS_TREE = 15;

/** The graphics table: angle count, flags (0x02 random angle, 0x04 random facet), frames. */
interface GraphicRow {
  angles: number;
  randomAngle: boolean;
  randomFacet: boolean;
  frames: number;
}

/**
 * The derived creation draws (write-up 2.1). The fixed facet only decides
 * what the file stores.
 */
export function deriveCreation(
  ctype: number,
  graphic: GraphicRow | undefined,
): CreationDraws {
  const n = graphic !== undefined && graphic.angles > 0 ? graphic.angles : 1;
  const hasGraphic = graphic !== undefined && graphic.angles > 0;
  const angled = ctype === 30 || ctype === 60 || ctype === 70 || ctype === 80;
  const randomAngle = hasGraphic && n > 1 && graphic!.randomAngle && angled;
  const randomFacet =
    hasGraphic && n > 1 && graphic!.randomFacet && graphic!.randomAngle;
  const out: CreationDraws = {
    facets: n,
    randomFacet,
    randomAngle,
    combatSeed: ctype === 70 || ctype === 80,
  };
  if (angled && !randomAngle && hasGraphic) out.fixedFacet = 7;
  else if (ctype === 20 && randomFacet) out.fixedFacet = 0;
  return out;
}

function sameDraws(a: CreationDraws, b: CreationDraws): boolean {
  if (
    a.randomFacet !== b.randomFacet ||
    a.randomAngle !== b.randomAngle ||
    a.combatSeed !== b.combatSeed
  )
    return false;
  return !(a.randomFacet || a.randomAngle) || a.facets === b.facets;
}

/** One map's object data with its effects, built once per generation. */
export class ObjectCatalog {
  readonly raw: ReadonlyMap<number, RawObjectRow>;
  private readonly graphicRows = new Map<number, GraphicRow>();
  // One map per scope keyed by the bare id. The object stage asks for a def
  // millions of times per map, and a string key would be built and hashed on
  // every one of those calls.
  private readonly defs: Record<EffectScope, Map<number, ObjectDef>> = {
    gaia: new Map(),
    player: new Map(),
  };
  private overrides: Record<EffectScope, Map<number, ObjectOverride>> = {
    gaia: new Map(),
    player: new Map(),
  };
  readonly restrictionCosts: readonly (readonly number[])[];
  readonly civilizationCount: number;
  readonly townCentreAttribute: readonly number[];
  readonly wallGates: ObjectDataFile["wallGates"];
  readonly placementClass: Uint8Array;

  constructor(file: ObjectDataFile, terrainClasses: TerrainClassTable) {
    this.raw = new Map(file.objects.map((r) => [r.id, r]));
    for (const [id, row] of Object.entries(file.graphics))
      this.graphicRows.set(Number(id), {
        angles: row[0],
        randomAngle: (row[1] & 2) !== 0,
        randomFacet: (row[1] & 4) !== 0,
        frames: row[2],
      });
    this.restrictionCosts = file.restrictions.map((r) => r.map(F));
    this.civilizationCount = file.civilizationCount;
    this.townCentreAttribute = file.townCentreAttribute;
    this.wallGates = file.wallGates;
    this.placementClass = terrainClasses.placementClass;
  }

  /** Every object id of class `classId`. */
  idsOfClass(classId: number): number[] {
    const out: number[] = [];
    for (const r of this.raw.values()) if (r.cls === classId) out.push(r.id);
    return out;
  }

  has(id: number): boolean {
    return this.raw.has(id);
  }

  /** A graphic absent from the file has one angle and no flags. */
  graphic(id: number | undefined): GraphicRow | undefined {
    if (id === undefined || id < 0) return undefined;
    return (
      this.graphicRows.get(id) ?? {
        angles: 1,
        randomAngle: false,
        randomFacet: false,
        frames: 1,
      }
    );
  }

  /** Replaces the effects. Called once, before any object is built (write-up 1.1). */
  setOverrides(
    overrides: Record<EffectScope, Map<number, ObjectOverride>>,
  ): void {
    this.overrides = overrides;
    this.defs.gaia.clear();
    this.defs.player.clear();
  }

  override(id: number, scope: EffectScope): ObjectOverride | undefined {
    return this.overrides[scope].get(id);
  }

  /** The object as `scope`'s objects see it. Terrain objects always take "gaia" (write-up 1.5). Undefined for an id the dat lacks. */
  def(id: number, scope: EffectScope = "gaia"): ObjectDef | undefined {
    const cached = this.defs[scope].get(id);
    if (cached) return cached;
    const r = this.raw.get(id);
    if (r === undefined) return undefined;
    const eff = this.overrides[scope].get(id) ?? {};
    const cx = F(eff.chx ?? r.c[0]);
    const cy = F(eff.chy ?? r.c[1]);
    const speed = r.spd ?? 0;
    const ctype = r.type;

    // 2.1 and 2.4: the draws come from the upgrade target, else from the
    // object's own graphic, re-derived when an effect changed that graphic.
    const own = deriveCreation(ctype, this.graphic(r.g));
    let creation = own;
    if (eff.upgrade !== undefined && this.raw.has(eff.upgrade)) {
      const target = this.raw.get(eff.upgrade)!;
      creation = deriveCreation(target.type, this.graphic(target.g));
    } else if (eff.graphic !== undefined) {
      const derived = deriveCreation(ctype, this.graphic(eff.graphic));
      creation = sameDraws(derived, own) ? own : derived;
    }
    const graphicNow = this.graphic(eff.graphic ?? r.g);

    const fw = Math.round(F(r.c[0]) * 512);
    const fh = Math.round(F(r.c[1]) * 512);
    const def: ObjectDef = {
      id,
      classId: r.cls,
      ctype,
      hp: eff.hp ?? r.hp,
      restriction: eff.restriction ?? r.r,
      ch: [cx, cy],
      ph: [F(r.p[0]), F(r.p[1])],
      vertical: F(r.z),
      outline: [F(r.o[0]), F(r.o[1])],
      speed: F(speed),
      usesSpeed: ctype >= 30,
      canBuildOn: r.cbo === 1,
      pcNone: r.z === 0 && ctype !== 80,
      obstructs: (r.act ?? 0) !== 0 && r.c[0] !== 0,
      footprint: fw !== 0 && fh !== 0,
      family: ctype < 70 ? "terrain" : ctype === 70 ? "collision" : "occupancy",
      positionFamily:
        ctype < 30
          ? "base"
          : ctype === 30
            ? "moving"
            : ctype === 80
              ? "building"
              : "combat",
      slope: r.slope ?? 0,
      action: r.act ?? 0,
      centreTerrains: r.ctr ?? [],
      sideTerrains: r.side ?? [],
      resource: [r.res?.[0] ?? -1, F(r.res?.[1] ?? 0)],
      foundation: r.fnd,
      annexes: (r.ann ?? []).map((a) => [a[0], F(a[1]), F(a[2])] as const),
      civs: r.civs ? new Set(r.civs) : undefined,
      hidden: r.hid === 1,
      zero:
        fw === 0 &&
        fh === 0 &&
        !((r.act ?? 0) !== 0 && r.c[0] !== 0) &&
        r.fnd === undefined,
      creation,
      animated:
        ctype >= 20 && graphicNow !== undefined && graphicNow.randomFacet,
      frames: graphicNow?.frames,
      // Not a dat field. The study's content pack gives 3 to every moving
      // unit of types 30, 60 and 70, and 2 to the 14 whose collision
      // half-size is 0.4 or 0.15. Kept as that table, since no dat field or
      // rule over the size reproduced it. It only moves a unit standing at
      // the map's very edge.
      edgeMargin:
        speed > 0 && (ctype === 30 || ctype === 60 || ctype === 70)
          ? F(r.c[0]) === F(0.4) || F(r.c[0]) === F(0.15)
            ? 2
            : 3
          : 0,
    };
    this.defs[scope].set(id, def);
    return def;
  }

  /** The restriction lets the object stand on terrain `t` (write-up 18.1, "accepts"). */
  accepts(restriction: number, t: number): boolean {
    const costs = this.restrictionCosts[restriction];
    if (costs === undefined) return false;
    return t < costs.length && costs[t] > 0;
  }

  /** The restriction's cost for `t` is 0.05 or less (write-up 18.1, "refuses"). */
  refuses(restriction: number, t: number): boolean {
    const costs = this.restrictionCosts[restriction];
    if (costs === undefined || t >= costs.length) return false;
    return costs[t] <= F(0.05);
  }

  /** Terrain `t` matches a list with class bits b1 and b2 (write-up 18.4). */
  matches(list: readonly number[], t: number, b1: number, b2: number): boolean {
    if (list.includes(t)) return true;
    const ct = this.placementClass[t] ?? 0;
    for (const s of list) {
      const cs = this.placementClass[s] ?? 0;
      if ((cs & b1 && ct & b1) || (cs & b2 && ct & b2)) return true;
    }
    return false;
  }

  /** A civilization other than 0 or a RANDOM one (65537 and up) has the object when its unit table does (write-up 5.3). */
  availableTo(id: number, civ: number | undefined): boolean {
    const r = this.raw.get(id);
    if (r === undefined) return false;
    if (r.civs === undefined) return true;
    if (civ === 0) return r.civs.includes(0);
    if (civ === undefined || civ >= this.civilizationCount)
      return r.civs.some((c) => c !== 0);
    return r.civs.includes(civ);
  }
}

/**
 * What the file stores in the frame field for an object built with these
 * draws (write-up 2.3): the start frame of an animated object, else the drawn
 * facet, else the fixed value of its constructor type.
 */
export function storedFrame(
  def: ObjectDef,
  facet: number,
  startFrame: number | undefined,
): number {
  if (startFrame !== undefined) return startFrame;
  // A fixed facet wins over a drawn one: a HOUSE draws a random facet and
  // its file record still holds 0 (k5, ob9).
  if (def.creation.fixedFacet !== undefined) {
    if (def.ctype === 30) return 5;
    if (def.ctype === 70 || def.ctype === 80) return 0;
    return def.creation.fixedFacet;
  }
  return facet;
}
