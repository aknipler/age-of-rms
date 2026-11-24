// DE's object stage, entry point, docs/preview-design.md Sec.6.6 (rev 12).
// PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// Three jobs, in the order the game does them:
//   1. read the script's effect lines, from any section, into the object
//      data before anything is generated (write-up Section 1);
//   2. read `<OBJECTS_GENERATION>` into one descriptor per `create_object`,
//      with the parser rules DE applies there (write-up Section 3);
//   3. after the terrain objects' own pass, run the scripted commands
//      (`deObjectStage.ts`) and gather every object the saved map would hold.
//
// `index.ts` owns the world of terrain objects, because the land and cliff
// stages make them long before this file runs.

import { objectEntry, objectCategory, type ObjectConstant } from "./objects";
import { resolveTerrainId } from "./grid";
import { zoneByte } from "./lands";
import {
  CLASS_CLIFF_ZONE,
  CLASS_FOREST_ZONE,
  ObjectCatalog,
  type EffectScope,
  type ObjectOverride,
} from "./deObjectData";
import {
  ObjectStage,
  emptyDesc,
  roundHalfAway,
  type ObjectDesc,
  type ObjectGroups,
  type StageLand,
  type StagePlayer,
} from "./deObjectStage";
import type { DeStream } from "./deRandom";
import type { TerrainObjectWorld } from "./terrainObjects";
import type {
  CliffPiece,
  CommandReport,
  DeObjectRecord,
  InstantiatedAttribute,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacedObject,
  PlayerMarker,
  TerrainObjectKind,
  TerrainObjectLayer,
} from "./types";

/** One object of the saved map, as the scenario file records it (write-up 2.3). */
export type DeObject = DeObjectRecord;

const EFFECT_ATTRIBUTES = new Set([0, 3, 4, 53, 71]);
const SET_ATTRIBUTE = 0;
const GAIA_SET_ATTRIBUTE = -1;
const UPGRADE_UNIT = 3;
const GAIA_UPGRADE_UNIT = -4;

/**
 * An argument's value. A name S0 could not evaluate, such as a name-to-name
 * `#const TERRAIN_PLAYER DIRT3`, comes back as the name written, for the
 * resolvers here to follow (Venn's `layer_to_place_on TERRAIN_PLAYER`).
 */
function valueOf(
  arg: InstantiatedCommand["args"][number] | undefined,
): InstantiatedValue {
  if (arg === undefined) return undefined;
  const v = arg.exact ?? arg.value;
  if (v !== undefined) return v;
  return typeof arg.source.value === "string" ? arg.source.value : undefined;
}

/** A constant of `category`, by name, or a number as written. */
function constantId(
  v: InstantiatedValue,
  category: string,
  constants: readonly ObjectConstant[],
  symbols: ReadonlyMap<string, number>,
): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const fromScript = symbols.get(v);
  if (fromScript !== undefined) return fromScript;
  const row = constants.find(
    (c) => c.category === category && c.rmsConstant === v,
  );
  return row?.constId ?? undefined;
}

function objectIdOf(
  v: InstantiatedValue,
  constants: readonly ObjectConstant[],
  script: InstantiatedScript,
): number | undefined {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v !== "string") return undefined;
  const id = objectEntry(v, constants, script.symbols, script.aliases)?.constId;
  if (id !== null && id !== undefined) return id;
  // A row our data names without an id (DOLPHIN) proves nothing, so the
  // script's own `#const DOLPHIN 61` still decides (Rekawa).
  const own = script.symbols.get(v);
  return own === undefined ? undefined : Math.trunc(own);
}

/**
 * Section 1: every `effect_amount` and `effect_percent` line, wherever it
 * stands, as overrides of the five attributes generation reads. Later lines
 * win. `effect_percent` sets number / 100, it does not scale.
 */
export function collectEffects(
  script: InstantiatedScript,
  constants: readonly ObjectConstant[],
  catalog: ObjectCatalog,
): Record<EffectScope, Map<number, ObjectOverride>> {
  const out: Record<EffectScope, Map<number, ObjectOverride>> = {
    gaia: new Map(),
    player: new Map(),
  };
  const at = (scope: EffectScope, id: number): ObjectOverride => {
    let o = out[scope].get(id);
    if (!o) out[scope].set(id, (o = {}));
    return o;
  };
  const effects: InstantiatedCommand[] = [];
  for (const commands of script.sections.values())
    for (const cmd of commands)
      if (cmd.name === "effect_amount" || cmd.name === "effect_percent")
        effects.push(cmd);
  effects.sort((a, b) => a.span.start - b.span.start);
  for (const cmd of effects) {
    const [actionArg, targetArg, attrArg, valueArg] = cmd.args;
    const kind = constantId(
      valueOf(actionArg),
      "effectAction",
      constants,
      script.symbols,
    );
    const target = objectIdOf(valueOf(targetArg), constants, script);
    if (kind === undefined || target === undefined) continue;
    if (kind === UPGRADE_UNIT || kind === GAIA_UPGRADE_UNIT) {
      const to = objectIdOf(valueOf(attrArg), constants, script);
      if (to === undefined) continue;
      at(kind === GAIA_UPGRADE_UNIT ? "gaia" : "player", target).upgrade = to;
      continue;
    }
    if (kind !== SET_ATTRIBUTE && kind !== GAIA_SET_ATTRIBUTE) continue;
    const attr = constantId(
      valueOf(attrArg),
      "attribute",
      constants,
      script.symbols,
    );
    const raw = valueOf(valueArg);
    if (
      attr === undefined ||
      !EFFECT_ATTRIBUTES.has(attr) ||
      typeof raw !== "number"
    )
      continue;
    const value = cmd.name === "effect_percent" ? raw / 100 : raw;
    const scopes: EffectScope[] =
      kind === GAIA_SET_ATTRIBUTE ? ["gaia"] : ["player", "gaia"];
    const ids =
      target >= 900 && target < 1000
        ? catalog.idsOfClass(target - 900)
        : [target];
    for (const scope of scopes)
      for (const id of ids) {
        const o = at(scope, id);
        if (attr === 0) o.hp = value;
        else if (attr === 3) o.chx = value;
        else if (attr === 4) o.chy = value;
        else if (attr === 53) o.restriction = Math.trunc(value);
        else if (attr === 71) o.graphic = Math.trunc(value);
      }
  }
  return out;
}

function attributesInOrder(cmd: InstantiatedCommand): InstantiatedAttribute[] {
  return [...cmd.attributes.values()]
    .flat()
    .sort((a, b) => a.span.start - b.span.start);
}

/** Section 3, plus de-connections-objects.md 5. */
export function readObjectCommands(
  script: InstantiatedScript,
  constants: readonly ObjectConstant[],
): { descs: ObjectDesc[]; groups: ObjectGroups } {
  const commands = script.sections.get("OBJECTS_GENERATION") ?? [];
  const groups = new Map<string, [number, number][]>();
  const descs: ObjectDesc[] = [];
  let last:
    | {
        index: number;
        name: string;
        objectRef: InstantiatedValue;
        attrs: InstantiatedAttribute[];
      }
    | undefined;

  const terrainOf = (v: InstantiatedValue): number | undefined =>
    resolveTerrainId(constants, v, script.symbols, script.aliases);
  const knownObject = (name: InstantiatedValue): number | undefined =>
    objectIdOf(name, constants, script);

  const build = (
    index: number,
    span: InstantiatedCommand["span"],
    ref: InstantiatedValue,
    attrs: InstantiatedAttribute[],
  ): ObjectDesc => {
    const name = String(ref);
    const d = emptyDesc(index, span, name);
    const id = knownObject(ref);
    // An object's name wins over a group of the same name.
    if (id !== undefined) d.objectId = id;
    else d.groupName = name;
    for (const a of attrs) applyAttribute(d, a, terrainOf, knownObject, groups);
    return d;
  };

  for (const cmd of commands) {
    if (cmd.name === "create_object_group") {
      const name = cmd.args[0]?.value;
      if (typeof name !== "string") continue;
      const entries: [number, number][] = [];
      for (const a of cmd.attributes.get("add_object") ?? []) {
        // 3.1: `add_object 293 50`, a bare number, is ignored.
        if (typeof a.args[0]?.source.value === "number") continue;
        const id = knownObject(a.args[0]?.value);
        if (id === undefined) continue;
        const w = valueOf(a.args[1]);
        entries.push([id, typeof w === "number" ? roundHalfAway(w) : 0]);
      }
      groups.set(name, entries);
      continue;
    }
    if (cmd.name === "create_actor_area") {
      const vals = cmd.args.map((a) => valueOf(a));
      if (vals.slice(0, 4).every((v) => typeof v === "number")) {
        const d = emptyDesc(descs.length, cmd.span, "create_actor_area");
        d.area = [
          roundHalfAway(vals[0] as number),
          roundHalfAway(vals[1] as number),
          roundHalfAway(vals[2] as number),
          roundHalfAway(vals[3] as number),
        ];
        descs.push(d);
      }
      continue;
    }
    if (cmd.name !== "create_object") continue;
    const arg = cmd.args[0];
    if (arg === undefined) continue;
    const ref = arg.value;
    const bare = typeof arg.source.value === "number";
    const known =
      !bare &&
      (knownObject(ref) !== undefined ||
        (typeof ref === "string" && groups.has(ref)));
    const attrs = attributesInOrder(cmd);
    if (!known) {
      // 3.1 and 3.2: a bare number, or a name DE does not know, is not a
      // command. Its block joins the previous create_object, later values
      // winning, and is dropped when there is none.
      if (last !== undefined) {
        last.attrs = [...last.attrs, ...attrs];
        descs[last.index] = build(
          last.index,
          descs[last.index].span,
          last.objectRef,
          last.attrs,
        );
      }
      continue;
    }
    const d = build(descs.length, cmd.span, ref, attrs);
    descs.push(d);
    last = { index: d.index, name: d.name, objectRef: ref, attrs };
  }
  return { descs, groups };
}

function applyAttribute(
  d: ObjectDesc,
  a: InstantiatedAttribute,
  terrainOf: (v: InstantiatedValue) => number | undefined,
  knownObject: (v: InstantiatedValue) => number | undefined,
  groups: ReadonlyMap<string, unknown>,
): void {
  const v0 = valueOf(a.args[0]);
  const has = a.args.length > 0 && v0 !== undefined;
  const n = (): number => (typeof v0 === "number" ? roundHalfAway(v0) : 0);
  switch (a.name) {
    case "number_of_objects":
      d.nObjects = Math.max(n(), 0);
      break;
    case "number_of_groups":
      d.nGroups = Math.max(n(), 0);
      break;
    case "group_variance":
      d.variance = Math.max(n(), 0);
      break;
    case "group_placement_radius":
      d.radius = n();
      break;
    case "set_tight_grouping":
      d.groupingStated = "tight";
      break;
    case "set_loose_grouping":
      d.groupingStated = "loose";
      break;
    case "set_scaling_to_map_size":
      d.scaling = "map";
      break;
    case "set_scaling_to_player_number":
      d.scaling = "players";
      break;
    case "set_place_for_every_player":
      d.everyPlayer = true;
      break;
    case "set_gaia_object_only":
      d.gaiaOnly = true;
      break;
    case "set_facet":
      d.facet = n();
      break;
    case "second_object": {
      // An undefined name here drops the attribute.
      const id = knownObject(v0);
      if (id !== undefined) {
        d.second = String(v0);
        d.secondObjectId = id;
      } else if (typeof v0 === "string" && groups.has(v0)) {
        d.second = v0;
        d.secondObjectId = undefined;
      }
      break;
    }
    case "terrain_to_place_on": {
      const t = terrainOf(v0);
      if (t !== undefined) d.terrainToPlaceOn = t;
      break;
    }
    case "layer_to_place_on": {
      const t = terrainOf(v0);
      if (t !== undefined) d.layerToPlaceOn = t;
      break;
    }
    case "ignore_terrain_restrictions":
      d.ignore = true;
      break;
    case "min_distance_to_players":
      d.minP = n();
      break;
    case "max_distance_to_players":
      d.maxP = n();
      break;
    case "min_distance_to_map_edge":
      d.minEdge = n();
      break;
    case "max_distance_to_other_zones":
      d.otherZones = n();
      break;
    case "min_distance_group_placement":
      d.minGroup = n();
      break;
    case "temp_min_distance_group_placement":
      d.tempGroup = n();
      break;
    case "avoid_other_land_zones":
      d.alz = true;
      d.alzD = has ? n() : 0;
      break;
    case "find_closest":
      d.closest = ["origin", "near"];
      break;
    case "find_closest_to_map_center":
      d.closest = ["center", has && n() === 1 ? "far" : "near"];
      break;
    case "find_closest_to_map_edge":
      d.closest = ["edge", has && n() === 1 ? "far" : "near"];
      break;
    case "set_circular_placement":
      d.circular = true;
      break;
    case "enable_tile_shuffling":
      d.tileShuffle = true;
      break;
    case "actor_area":
      d.aa = n();
      break;
    case "actor_area_radius":
      d.aaR = n();
      break;
    case "actor_area_to_place_in":
      d.aaIn = n();
      break;
    case "avoid_actor_area":
      if (has) d.avoidAa.push(n());
      break;
    case "avoid_all_actor_areas":
      d.avoidAll = true;
      break;
    case "avoid_forest_zone":
    case "place_on_forest_zone":
    case "avoid_cliff_zone":
      // 6.4: the kind of test is the last such attribute's, for all entries.
      d.zoneKind = a.name === "place_on_forest_zone" ? "require" : "avoid";
      d.zones.push([
        a.name === "avoid_cliff_zone" ? CLASS_CLIFF_ZONE : CLASS_FOREST_ZONE,
        has ? Math.max(n(), 1) : 1,
      ]);
      break;
    case "place_on_specific_land_id":
      d.landId = n();
      break;
    case "generate_for_first_land_only":
      d.firstLand = true;
      break;
    case "force_placement":
      d.force = true;
      break;
    case "min_connected_tiles":
      d.minConn = n();
      break;
    case "require_path":
      d.path = has ? n() : 0;
      break;
    // 2.6: `set_scale_by_groups` inside create_object is ignored, and so is
    // every attribute generation does not read.
  }
}

export interface DeObjectStageInput {
  script: InstantiatedScript;
  constants: readonly ObjectConstant[];
  catalog: ObjectCatalog;
  world: TerrainObjectWorld;
  stream: DeStream;
  anim: DeStream;
  dim: number;
  terrain: Uint16Array;
  layer: Uint16Array;
  elevation: Uint8Array;
  landZone: Int16Array;
  origins: readonly LandOrigin[];
  playerCount: number;
  teams: readonly number[];
  civilizations: readonly number[];
  pieces: readonly CliffPiece[];
  paint: (tile: number, terrain: number) => void;
  trace?: (line: string) => void;
}

export interface DeObjectStageResult {
  objects: DeObject[];
  placed: PlacedObject[];
  players: PlayerMarker[];
  reports: CommandReport[];
}

/** Runs the scripted commands and gathers every object the saved map holds. */
export function runDeObjectStage(
  input: DeObjectStageInput,
): DeObjectStageResult {
  const { script, constants, catalog, world } = input;
  const { descs, groups } = readObjectCommands(script, constants);
  const lands: StageLand[] = input.origins.map((o) => ({
    slot: o.player ?? 0,
    x: o.x,
    y: o.y,
    // In the game's one-byte form, as the land zone grid holds it.
    zone: zoneByte(o.zone),
    landId: o.declaredLandId,
  }));
  const players: StagePlayer[] = [];
  for (let slot = 1; slot <= input.playerCount; slot++)
    players.push({
      slot,
      team: input.teams[slot - 1] ?? 0,
      civ: input.civilizations[slot - 1] ?? 1,
    });
  const stage = new ObjectStage({
    catalog,
    st: input.stream,
    aux: world.facings,
    anim: input.anim,
    dim: input.dim,
    terrain: input.terrain,
    layer: input.layer,
    elevation: input.elevation,
    landZone: input.landZone,
    lands,
    players,
    world,
    pieces: input.pieces,
    paint: input.paint,
    trace: input.trace,
  });
  stage.run(descs, groups);

  const objects: DeObject[] = [];
  for (const o of world.objects)
    if (o.alive)
      objects.push({
        id: o.id,
        owner: 0,
        x: o.x,
        y: o.y,
        rotation: o.facet,
        frame: o.frame,
        status: o.status,
        kind: "terrain",
      });
  for (const p of input.pieces)
    objects.push({
      id: p.objectId,
      owner: 0,
      x: p.x,
      y: p.y,
      rotation: p.facing,
      frame: p.facing,
      status: 2,
      kind: "cliff",
    });
  const placed: PlacedObject[] = [];
  const names = new Map<number, string>();
  for (const c of constants)
    if (
      c.category === "object" &&
      c.constId !== null &&
      c.rmsConstant &&
      !names.has(c.constId)
    )
      names.set(c.constId, c.rmsConstant);
  for (const b of stage.scripted()) {
    const status =
      b.def.hp <= 0 && b.def.positionFamily === "building" && b.def.hidden
        ? 0
        : 2;
    const facet = b.facet ?? 0;
    objects.push({
      id: b.id,
      owner: b.owner,
      x: b.x,
      y: b.y,
      rotation: b.angle ?? facet,
      frame: facet,
      status,
      kind: "script",
    });
    // The name the script wrote ("MY_GOLD" from a `#const`) beats the table's
    // name for the same id, so the readout shows what the author typed. Only
    // when the command named this very object: a group names its members by
    // table name, and a bare number has no name to keep.
    const desc = b.cmd === undefined ? undefined : descs[b.cmd];
    const written =
      desc !== undefined &&
      desc.objectId === b.id &&
      !/^-?\d+(\.\d+)?$/.test(desc.name)
        ? desc.name
        : undefined;
    const name = written ?? names.get(b.id) ?? String(b.id);
    placed.push({
      objectRef: name,
      // The tile the object stands on. `PlacedObject` is in tile indices
      // for every reader (the canvas adds the half tile to reach a centre,
      // and the tile readout keys on `y * dim + x`), and DE's positions are
      // continuous, 10.5 being the middle of tile 10. Passing them through
      // drew every object half a tile off and left the readout empty. The
      // exact position stays in `deObjects`.
      x: Math.floor(b.x),
      y: Math.floor(b.y),
      player: b.owner || undefined,
      category: objectCategory(name, constants, script.symbols, script.aliases),
    });
  }

  const reports: CommandReport[] = [];
  for (const d of descs) {
    if (d.area !== undefined) continue;
    const out = stage.outcomes.get(d.index);
    if (!out) continue;
    const short = out.requested - out.placed;
    reports.push({
      commandSpan: d.span,
      stage: "S6",
      attempted: out.requested,
      placed: out.placed,
      failures:
        short > 0
          ? [
              {
                bucket: "noValidTiles",
                commandSpan: d.span,
                stage: "S6",
                entity: d.name,
                detail: `${out.placed} of ${out.requested} ${out.requested === 1 ? "placement" : "placements"} found room.`,
                occurrences: short,
              },
            ]
          : [],
    });
  }
  const playerMarkers: PlayerMarker[] = input.origins
    .filter((o) => o.player !== undefined)
    .map((o) => ({ player: o.player!, x: o.x, y: o.y }));
  return { objects, placed, players: playerMarkers, reports };
}

/**
 * The live terrain objects of a finished stage as the canvas draws them
 * (`PreviewResult.terrainObjects`). Status 2 only, since a terrain object the
 * object stage retired (status 7) is saved in the file but is not on the map.
 *
 * The colour comes from `objectCategory`, which reads trees as wood. Anything
 * else a terrain spawns (grass, rocks, flowers) is a decoration, never the
 * near white of an unknown category, which would cover a grassy map in dots.
 */
export function terrainObjectLayer(
  objects: readonly DeObjectRecord[],
  constants: readonly ObjectConstant[],
): TerrainObjectLayer {
  // The constant where there is one, which is how a script and the Obj.
  // List name the object. Thirteen of the 39 objects terrains spawn have
  // none (the green grass, 1358, among them), and their row's readable name
  // ("Grass, Green") beats a bare id.
  const names = new Map<number, string>();
  for (const c of constants)
    if (c.category === "object" && c.constId !== null && c.rmsConstant)
      if (!names.has(c.constId)) names.set(c.constId, c.rmsConstant);
  for (const c of constants)
    if (c.category === "object" && c.constId !== null && c.descriptiveName)
      if (!names.has(c.constId)) names.set(c.constId, c.descriptiveName);
  const live = objects.filter((o) => o.kind === "terrain" && o.status === 2);
  const kind = new Uint16Array(live.length);
  const x = new Float32Array(live.length);
  const y = new Float32Array(live.length);
  const kinds: TerrainObjectKind[] = [];
  const kindOf = new Map<number, number>();
  live.forEach((o, i) => {
    let k = kindOf.get(o.id);
    if (k === undefined) {
      const objectRef = names.get(o.id) ?? `object ${o.id}`;
      const category = objectCategory(objectRef, constants);
      k = kinds.length;
      kinds.push({
        id: o.id,
        objectRef,
        category: category.startsWith("resource") ? category : "decoration",
      });
      kindOf.set(o.id, k);
    }
    kind[i] = k;
    x[i] = o.x;
    y[i] = o.y;
  });
  return { kind, x, y, kinds };
}
