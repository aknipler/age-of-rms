/**
 * Sec.3's static-analysis layer (consistency-checker-design.md). Runs against
 * `InstantiatedScript` (S0's output) plus `ParseResult` (for the checks whose
 * SUPPRESSING half must be generous about branches S0 did not take, Sec.3.0b).
 * No `TileGrid`, no S1-S6: every check here reads resolved attribute values.
 *
 * **Positive-resolver rule throughout (CLAUDE.md hard rule).** A reference the
 * reference data has no row for is UNRESOLVED, not ABSENT-therefore-BROKEN,
 * every check's third outcome is "cannot determine", which reports nothing.
 */

import type { Item, ParseResult, Span } from "../../../parser/types";
import type {
  InstantiatedArg,
  InstantiatedCommand,
  InstantiatedScript,
} from "../../../preview/generator/types";
import {
  argValue,
  numAttr,
  objectEntry,
} from "../../../preview/generator/objects";
import {
  beachTerrainFor,
  isWaterTerrain,
  resolveTerrainId,
  type TerrainConstantForMasks,
} from "../../../preview/generator/grid";
import { declaredTargetTiles } from "../../../preview/generator/lands";
import { resolveCliffSettings } from "../../../preview/generator/cliffs";
import type { PublishedGameConstant } from "../../../../tools-api/index";
import {
  anyRawNodeContains,
  astAttributeName,
  astCommandName,
  collectOccurrences,
  scanAstConsts,
  wasReachedButUnsimulated,
  type AstConstMap,
} from "./astScan";

// ---------------------------------------------------------------------------
// The finding shape every Sec.3 check emits
// ---------------------------------------------------------------------------

export type StaticFindingKind =
  | "landOverAllocation" // Sec.3.1
  | "actorAreaUndeclaredToPlaceIn" // Sec.3.2, suppresses actorAreaMissing (Sec.5.1)
  | "actorAreaUndeclaredAvoid" // Sec.3.2, does NOT suppress
  | "actorAreaUndeclaredSharedBlockReference" // Sec.3.2, no owning command, RMS0110's own ambiguity
  | "terrainImpossible" // Sec.3.3, gated by Sec.3.5
  | "minExceedsMaxObjects" // Sec.3.4 (objects.ts's own comparison, promoted)
  | "cliffsMinExceedsMax"; // Sec.3.4 (cliffs.ts's own comparison, promoted)

export interface StaticFinding {
  kind: StaticFindingKind;
  severity: "info" | "warning" | "error";
  text: string;
  /**
   * Which of Sec.3.0 rule 1's per-player-count passes produced this. Stamped
   * by `runStaticChecks`, never by an individual check, so no check can
   * forget it, and NOT interpolated into `text`, because Sec.5.1's renderer
   * collapses findings that are identical across counts and a count baked
   * into the sentence defeats that by construction (1024 blocks on
   * `Pa_Site_v1.1.rms`, over `LIMITS.maxBlocksPerOutput`).
   */
  playerCount: number;
  /** Click-through span. */
  span?: Span;
  /**
   * The command this finding is ABOUT, for Sec.5.1's suppression rule. Absent
   * when there is no single owning command (Sec.3.1's script-wide claim,
   * Sec.3.2's shared-block reference finding).
   */
  commandSpan?: Span;
}

/**
 * What an individual check returns: everything but the `playerCount`, which
 * `runStaticChecks` stamps on the way out. Structural typing makes this free,
 * the checks already build object literals without the field.
 */
export type UnstampedFinding = Omit<StaticFinding, "playerCount">;

// ---------------------------------------------------------------------------
// Shared context, computed ONCE per script (player-count-independent),
// reused across every selected player count's run of these checks.
// ---------------------------------------------------------------------------

export interface StaticContext {
  astConsts: AstConstMap;
  /** Sec.3.0b/Sec.3.2 rule 4: any RawNode's own text contains "actor_area". */
  actorAreaRawAbstain: boolean;
  /** Sec.3.3's RawNode subsection: any RawNode's own text contains "terrain", "#const" or "<". */
  terrainSurfaceRawAbstain: boolean;
}

export function buildStaticContext(parse: ParseResult): StaticContext {
  const astConsts = scanAstConsts(parse);
  const rawTexts = collectOccurrences(parse, (item) => item.kind === "raw").map(
    ({ item }) => parse.source.slice(item.span.start, item.span.end),
  );
  return {
    astConsts,
    actorAreaRawAbstain: rawTexts.some((t) => t.includes("actor_area")),
    terrainSurfaceRawAbstain: rawTexts.some(
      (t) => t.includes("terrain") || t.includes("#const") || t.includes("<"),
    ),
  };
}

// `anyRawNodeContains` is re-exported for tests that want the single-token
// check without building a whole StaticContext.
export { anyRawNodeContains };

// ---------------------------------------------------------------------------
// Sec.3.1: land_percent/number_of_tiles over-allocation
// ---------------------------------------------------------------------------

const LAND_COMMAND_NAMES = new Set(["create_land", "create_player_lands"]);

function isRndSourced(attr: { args: InstantiatedArg[] } | undefined): boolean {
  const raw = attr?.args[0]?.source.value;
  return typeof raw === "object" && raw !== null && "rnd" in raw;
}

/**
 * Sec.3.1. Reads `InstantiatedScript` only, a land inside a shared block or
 * a `RawNode` is invisible to this check and the sum is understated as a
 * result, which is the tolerable (under-report) direction the section names
 * explicitly.
 *
 * Takes NO player count: Sec.3.1's cancellation argument says the sum is
 * player-count invariant, so the count belonged only to the sentence's old
 * "At N players," prefix, and that prefix was what stopped four identical
 * findings from collapsing into one block.
 */
export function checkLandOverAllocation(
  inst: InstantiatedScript,
): UnstampedFinding[] {
  const commands = inst.sections.get("LAND_GENERATION") ?? [];
  const dim = inst.dim;
  const cap = dim * dim;
  let sum = 0;
  let fillerCount = 0;
  let seedDerived = false;

  for (const cmd of commands) {
    if (!LAND_COMMAND_NAMES.has(cmd.name)) continue;
    // The per-player-count multiplier CANCELS (Sec.3.1: dividing then
    // multiplying a create_player_lands occurrence back up returns the raw
    // declared area), so the raw value with divisor 1 IS both the exclusion
    // test's input and the sum's contribution.
    const raw = declaredTargetTiles(cmd, dim, 1);
    if (raw >= cap) {
      fillerCount++;
      continue;
    }
    sum += raw;
    if (
      isRndSourced(cmd.attributes.get("number_of_tiles")?.[0]) ||
      isRndSourced(cmd.attributes.get("land_percent")?.[0])
    ) {
      seedDerived = true;
    }
  }

  if (sum <= cap) return [];

  const percent = Math.round((sum / cap) * 100);
  const seedClause = seedDerived ? " on this seed" : "";
  const fillerClause =
    fillerCount > 0
      ? ` ${fillerCount} further land${fillerCount === 1 ? " asks" : "s ask"} for the whole map, which is the normal way to fill the remainder.`
      : "";
  return [
    {
      kind: "landOverAllocation",
      severity: "info",
      // NOT "At N players, ..."; the count is carried on the finding
      // (`playerCount`, stamped by `runStaticChecks`) and printed by the
      // renderer ONLY when the finding does not hold at every selected
      // count. Sec.3.1's own cancellation argument is that the sum is
      // player-count invariant, so on a normal script all four passes
      // produce this identical sentence and it renders once.
      text: `The lands that name a size declare ${percent}% of the map between them, so some will grow smaller than requested${seedClause}.${fillerClause}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Sec.3.2: undefined actor areas
// ---------------------------------------------------------------------------

const ACTOR_AREA_REF_ATTRS = [
  "actor_area_to_place_in",
  "avoid_actor_area",
] as const;

function isCreateActorArea(
  parse: ParseResult,
  item: Item,
): item is Extract<Item, { kind: "command" }> {
  return (
    item.kind === "command" &&
    astCommandName(parse, item) === "create_actor_area"
  );
}
function isActorAreaAttr(
  parse: ParseResult,
  item: Item,
): item is Extract<Item, { kind: "attribute" }> {
  return (
    item.kind === "attribute" && astAttributeName(parse, item) === "actor_area"
  );
}

/** Every span S0 actually instantiated a `create_actor_area`/`actor_area` occurrence at, mapped to its resolved numeric id, rule 2's "instantiation's own resolved values", keyed so a specific AST occurrence can be looked up by identity. */
function instantiatedActorAreaValuesBySpan(
  inst: InstantiatedScript,
): Map<number, number> {
  const bySpan = new Map<number, number>();
  for (const [, commands] of inst.sections) {
    for (const cmd of commands) {
      if (cmd.name === "create_actor_area") {
        const id = cmd.args[2]?.value;
        if (typeof id === "number") bySpan.set(cmd.span.start, id);
      }
      for (const attrs of cmd.attributes.values()) {
        for (const attr of attrs) {
          if (attr.name !== "actor_area") continue;
          const id = attr.args[0]?.value;
          if (typeof id === "number") bySpan.set(attr.span.start, id);
        }
      }
    }
  }
  return bySpan;
}

interface DeclarationResolution {
  values: ReadonlySet<number>;
  resolved: boolean;
}

function resolveDeclarationId(
  idArgValue: unknown,
  span: Span,
  astConsts: AstConstMap,
  instValuesBySpan: ReadonlyMap<number, number>,
): DeclarationResolution {
  if (typeof idArgValue === "number")
    return { values: new Set([idArgValue]), resolved: true };
  if (typeof idArgValue === "string") {
    const set = astConsts.all.get(idArgValue);
    if (set && set.size > 0) return { values: new Set(set), resolved: true };
  }
  // Rule 2: a parenthesised expression (or an otherwise-unresolvable name)
  // that S0 DID evaluate, because this exact occurrence sits in a taken
  // branch, S0 buys what rule 1's #const-name scan cannot (24hr_Caverns.rms's
  // `actor_area (AA_TC)`).
  const instValue = instValuesBySpan.get(span.start);
  if (instValue !== undefined)
    return { values: new Set([instValue]), resolved: true };
  return { values: new Set(), resolved: false };
}

/** Every reachable orphan (shared) block's attribute matching `names`, paired with the block's own span, Sec.3.0b's "the reference side takes shared-block references too, but only where S0 reached the block." */
function collectOrphanBlockAttributes(
  parse: ParseResult,
  names: ReadonlySet<string>,
): { attr: Extract<Item, { kind: "attribute" }>; orphanBlockSpan: Span }[] {
  const out: {
    attr: Extract<Item, { kind: "attribute" }>;
    orphanBlockSpan: Span;
  }[] = [];
  function scan(
    items: readonly Item[],
    orphanBlockSpan: Span | undefined,
  ): void {
    for (const item of items) {
      if (item.kind === "attribute") {
        if (orphanBlockSpan && names.has(astAttributeName(parse, item)))
          out.push({ attr: item, orphanBlockSpan });
      } else if (item.kind === "orphanBlock") {
        scan(item.block.items, item.span);
      } else if (item.kind === "if") {
        for (const branch of item.branches) scan(branch.items, orphanBlockSpan);
      } else if (item.kind === "random") {
        scan(item.preamble, orphanBlockSpan);
        for (const branch of item.branches) scan(branch.items, orphanBlockSpan);
      }
      // "command" blocks and "raw"/"directive" leaves: an orphan block is a
      // top-level construct (parser-design Sec.5.4) and cannot sit inside a
      // command's own block, so there is nothing to descend into there.
    }
  }
  scan(parse.script.preamble, undefined);
  for (const section of parse.script.sections) scan(section.items, undefined);
  return out;
}

/**
 * Sec.3.2. Declaration side is generous over the WHOLE AST (every branch,
 * selected or not, descending into shared blocks); reference side stays on
 * the instantiation (strict, a reference in an untaken branch cannot fail on
 * this seed), plus shared-block references where S0 reached the block.
 */
export function checkActorAreas(
  inst: InstantiatedScript,
  parse: ParseResult,
  ctx: StaticContext,
): UnstampedFinding[] {
  const instValuesBySpan = instantiatedActorAreaValuesBySpan(inst);
  const declaredIds = new Set<number>();
  let abstained = ctx.actorAreaRawAbstain;

  // Declaration side, both forms, every branch (walkItems is generous by construction).
  const declOccurrences = collectOccurrences(
    parse,
    (item) => isCreateActorArea(parse, item) || isActorAreaAttr(parse, item),
  );
  for (const { item } of declOccurrences) {
    let idArgValue: unknown;
    if (isCreateActorArea(parse, item)) idArgValue = item.args[2]?.value;
    else if (isActorAreaAttr(parse, item)) idArgValue = item.args[0]?.value;
    else continue;
    const { values, resolved } = resolveDeclarationId(
      idArgValue,
      item.span,
      ctx.astConsts,
      instValuesBySpan,
    );
    if (!resolved) abstained = true;
    for (const v of values) declaredIds.add(v);
  }
  // Rule 2's explicit union, restated (redundant with the per-occurrence fold
  // above in every case the corpus produces, kept because the spec states it
  // as its own clause).
  for (const id of inst.actorAreas.keys()) declaredIds.add(id);
  for (const v of instValuesBySpan.values()) declaredIds.add(v);

  if (abstained) return [];

  const findings: UnstampedFinding[] = [];

  // Reference side: strict, instantiation-scoped. `avoid_actor_area` is
  // REPEATABLE (language.json), a single command can carry several, folded
  // in occurrence order (Sec.3 rule 10), so every entry needs checking, not
  // only the first. `actor_area_to_place_in` is not repeatable and is always
  // length-1 when present, so iterating both the same way is correct for it
  // too.
  for (const [, commands] of inst.sections) {
    for (const cmd of commands) {
      for (const attrName of ACTOR_AREA_REF_ATTRS) {
        for (const attr of cmd.attributes.get(attrName) ?? []) {
          const val = attr.args[0]?.value;
          if (typeof val !== "number" || declaredIds.has(val)) continue;
          findings.push(
            attrName === "actor_area_to_place_in"
              ? {
                  kind: "actorAreaUndeclaredToPlaceIn",
                  severity: "error",
                  span: attr.span,
                  commandSpan: cmd.span,
                  text: `actor_area_to_place_in ${val} references an actor area that nothing in the script creates, so this command places nothing.`,
                }
              : {
                  kind: "actorAreaUndeclaredAvoid",
                  severity: "info",
                  span: attr.span,
                  commandSpan: cmd.span,
                  text: `This command avoids actor area ${val}, which nothing in the script creates, so the line has no effect.`,
                },
          );
        }
      }
    }
  }

  // Reference side, shared blocks S0 actually reached.
  const orphanRefs = collectOrphanBlockAttributes(
    parse,
    new Set(ACTOR_AREA_REF_ATTRS),
  );
  for (const { attr, orphanBlockSpan } of orphanRefs) {
    if (!wasReachedButUnsimulated(inst.notes, orphanBlockSpan)) continue;
    const raw = attr.args[0]?.value;
    let val: number | undefined;
    if (typeof raw === "number") val = raw;
    else if (typeof raw === "string") val = ctx.astConsts.first.get(raw);
    if (val === undefined || declaredIds.has(val)) continue;
    const name = astAttributeName(parse, attr);
    findings.push({
      kind: "actorAreaUndeclaredSharedBlockReference",
      severity: name === "actor_area_to_place_in" ? "error" : "info",
      span: attr.span,
      text:
        name === "actor_area_to_place_in"
          ? `actor area ${val} is referenced here and nothing in the script creates it.`
          : `This line avoids actor area ${val}, which nothing in the script creates, so it has no effect.`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Sec.3.3: placement on terrain that can't exist (+ Sec.3.5's readiness gate)
// ---------------------------------------------------------------------------

const CONNECT_COMMAND_PREFIX = "create_connect_";

/** `PublishedGameConstant` already carries every field `TerrainConstantForMasks` reads, this only fixes the `constId?` (optional) vs `constId` (required) seam, WITHOUT dropping `isHybrid`/`isBeach`/`beachTerrain` the way `objectConstantsFromPublished` (previewBridge.ts, built for the Monte Carlo layer's narrower `ObjectConstant` projection) would. */
function asTerrainConstants(
  constants: readonly PublishedGameConstant[],
): readonly TerrainConstantForMasks[] {
  return constants.map((c) => ({ ...c, constId: c.constId ?? null }));
}

// `base_terrain` parses as a standalone CommandNode at a section's top level
// (index.ts's own `resolveBaseFill` reads it that way) but as an
// AttributeNode wherever it sits inside a block, an orphan block included,
// which the design doc's own producer table measures directly ("1877 as
// AttributeNodes... 1908 over every item kind"). Both forms must count.
function isTerrainProducerItem(parse: ParseResult, item: Item): boolean {
  if (item.kind === "command") {
    const name = astCommandName(parse, item);
    return name === "base_terrain" || name === "create_terrain";
  }
  if (item.kind === "attribute") {
    const name = astAttributeName(parse, item);
    return (
      name === "base_terrain" ||
      name === "terrain_type" ||
      name === "beach_terrain" ||
      name === "replace_terrain" ||
      name === "default_terrain_replacement"
    );
  }
  return false;
}

function terrainProducerValues(parse: ParseResult, item: Item): unknown[] {
  if (item.kind === "command") {
    return item.args[0] ? [item.args[0].value] : [];
  }
  if (item.kind === "attribute") {
    const name = astAttributeName(parse, item);
    if (name === "replace_terrain")
      return item.args[1] ? [item.args[1].value] : [];
    return item.args[0] ? [item.args[0].value] : [];
  }
  return [];
}

/**
 * Sec.3.3's terrain surface: every terrain id the script can put on the
 * ground, plus what the automatic beach pass would grow from each. Base
 * surface comes straight from the instantiation (if-selection already
 * applied); `start_random`'s untaken branches and shared blocks are added by
 * a separate AST walk, Sec.3.3's own asymmetric rule, and the design's own
 * measurement (0/32 tracked maps put a producer at another if-branch outcome)
 * is why this does not attempt full if-branch reachability tracking.
 */
export interface TerrainSurface {
  surface: ReadonlySet<number>;
  /** Terrain-producer occurrences this walk actually tried to resolve (an absent attribute is not a producer). */
  producersTotal: number;
  /** Of those, the ones `resolveTerrainId` could not answer, Sec.3.3 clause 2's numerator. */
  producersUnresolvable: number;
}

/**
 * Sec.3.3 clause 2's INTERIM threshold. A script that loses at least this
 * fraction of its terrain producers to names nothing defines has a surface
 * too incomplete to argue emptiness from, so the surface-half checks abstain
 * (the tier-1 named-terrain half, which reads no surface, keeps running).
 *
 * [tune]: interim, an order of magnitude clear of both anchors in both
 * directions, `24hr_Battle Lines 1.0.rms` at 50 of 67 is what it is for,
 * `Menindee_AUS_v2.3.rms` at 1 of 539 is what it must not fire on. Set on
 * evidence by `npm run measure:checker`'s per-map ratio row, not by argument.
 * The error direction is the safe one: too high abstains on nothing that
 * matters, too low abstains on scripts whose surface checks measure 0
 * findings anyway.
 */
export const UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO = 1 / 3;

export function computeTerrainSurface(
  parse: ParseResult,
  inst: InstantiatedScript,
  constants: readonly TerrainConstantForMasks[],
  astConsts: AstConstMap,
): TerrainSurface {
  const symbols = new Map<string, number>([
    ...astConsts.first,
    ...inst.symbols,
  ]);
  const surface = new Set<number>();
  let producersTotal = 0;
  let producersUnresolvable = 0;
  const add = (value: unknown): void => {
    // An ABSENT attribute is not a producer and must not enter the
    // denominator, otherwise the ratio measures how many optional
    // attributes a script declines to write.
    if (value === undefined || value === null) return;
    producersTotal++;
    const id = resolveTerrainId(constants, value as never, symbols);
    if (id === undefined) {
      producersUnresolvable++;
      return;
    }
    surface.add(id);
    const beach = beachTerrainFor(constants, id);
    if (beach !== undefined) surface.add(beach);
  };

  for (const [, commands] of inst.sections) {
    for (const cmd of commands) {
      if (cmd.name === "base_terrain") add(cmd.args[0]?.value);
      else if (LAND_COMMAND_NAMES.has(cmd.name))
        add(argValue(cmd, "terrain_type", 0));
      else if (cmd.name === "create_terrain") {
        add(cmd.args[0]?.value);
        add(argValue(cmd, "beach_terrain", 0));
      } else if (cmd.name.startsWith(CONNECT_COMMAND_PREFIX)) {
        for (const attr of cmd.attributes.get("replace_terrain") ?? [])
          add(attr.args[1]?.value);
        add(
          cmd.attributes.get("default_terrain_replacement")?.[0]?.args[0]
            ?.value,
        );
      }
    }
  }

  const producers = collectOccurrences(parse, (item) =>
    isTerrainProducerItem(parse, item),
  );
  for (const { item, ctx } of producers) {
    const include = ctx.insideRandom || ctx.sharedBlock;
    if (!include) continue;
    for (const value of terrainProducerValues(parse, item)) add(value);
  }

  return { surface, producersTotal, producersUnresolvable };
}

function ignoreTerrainRestrictionsValid(cmd: InstantiatedCommand): boolean {
  if (!cmd.attributes.has("ignore_terrain_restrictions")) return false;
  return (
    cmd.attributes.has("set_place_for_every_player") ||
    cmd.attributes.has("place_on_specific_land_id")
  );
}

function terrainLabel(
  constants: readonly PublishedGameConstant[],
  id: number,
): string {
  const row = constants.find(
    (c) => c.category === "terrain" && c.constId === id,
  );
  return row?.rmsConstant ?? `terrain ${id}`;
}

function terrainRow(
  constants: readonly PublishedGameConstant[],
  id: number,
): PublishedGameConstant | undefined {
  return constants.find((c) => c.category === "terrain" && c.constId === id);
}

/** Sec.3.5: an unverified row's fields are placeholders, not facts, downgrade to info. */
function gatedSeverity(verified: boolean): "warning" | "info" {
  return verified ? "warning" : "info";
}

export interface TerrainCheckOptions {
  constants: readonly PublishedGameConstant[];
  terrainConstants: readonly TerrainConstantForMasks[];
  surface: ReadonlySet<number>;
  surfaceAbstained: boolean;
  symbols: ReadonlyMap<string, number>;
}

/** Sec.3.3 + Sec.3.5. One command at a time, so a test can drive it without building a whole InstantiatedScript. */
export function checkObjectTerrainPlacement(
  cmd: InstantiatedCommand,
  inst: InstantiatedScript,
  opts: TerrainCheckOptions,
): UnstampedFinding[] {
  if (cmd.name !== "create_object") return [];
  const typeName =
    typeof cmd.args[0]?.value === "string" ? cmd.args[0].value : undefined;
  if (typeName === undefined || inst.objectGroups.has(typeName)) return []; // case 3: unresolvable type / create_object_group

  const row = objectEntry(typeName, opts.constants, inst.symbols);
  if (row === undefined) return []; // case 3: no reference row

  if (ignoreTerrainRestrictionsValid(cmd)) return []; // valid override, the terrain table no longer applies

  const terrainRef = argValue(cmd, "terrain_to_place_on", 0);
  const namedTerrainId =
    terrainRef !== undefined
      ? resolveTerrainId(opts.terrainConstants, terrainRef, opts.symbols)
      : undefined;
  const namedTerrainUnresolved =
    terrainRef !== undefined && namedTerrainId === undefined;
  if (namedTerrainUnresolved) return []; // positive-resolver rule: an unresolvable named terrain reports nothing

  const findings: UnstampedFinding[] = [];

  if (row.allowedTerrains !== undefined) {
    // Tier 1: the exact engine terrain table.
    if (namedTerrainId !== undefined) {
      if (!row.allowedTerrains.includes(namedTerrainId)) {
        const verified = row.verified;
        findings.push({
          kind: "terrainImpossible",
          severity: gatedSeverity(verified),
          span: cmd.span,
          commandSpan: cmd.span,
          text: `${typeName} cannot be placed on ${terrainLabel(opts.constants, namedTerrainId)}. The exact terrain table for this object does not permit it.${verified ? "" : " (This object's terrain data has not been checked against the game's own files.)"}`,
        });
      }
    } else if (!opts.surfaceAbstained) {
      const intersects = [...opts.surface].some((id) =>
        row.allowedTerrains!.includes(id),
      );
      if (!intersects) {
        const verified = row.verified;
        findings.push({
          kind: "terrainImpossible",
          severity: gatedSeverity(verified),
          span: cmd.span,
          commandSpan: cmd.span,
          text: `${typeName} cannot be placed anywhere this map's terrain can produce, according to the exact terrain table for this object.${verified ? "" : " (This object's terrain data has not been checked against the game's own files.)"}`,
        });
      }
    }
  } else if (row.habitat === "land" || row.habitat === "water") {
    // Tier 2: the coarse habitat class. "shore"/"amphibious"/"any"/undeclared are deliberately not checked (Sec.3.3).
    if (namedTerrainId !== undefined) {
      const terrainIsWater = isWaterTerrain(
        opts.terrainConstants,
        namedTerrainId,
      );
      const contradiction =
        (row.habitat === "water" && !terrainIsWater) ||
        (row.habitat === "land" && terrainIsWater);
      if (contradiction) {
        const terrain = terrainRow(opts.constants, namedTerrainId);
        const verified = row.verified && (terrain?.verified ?? false);
        findings.push({
          kind: "terrainImpossible",
          severity: gatedSeverity(verified),
          span: cmd.span,
          commandSpan: cmd.span,
          text: `${typeName} cannot be placed on ${terrainLabel(opts.constants, namedTerrainId)}. This object's terrain category (${row.habitat}) does not match.${verified ? "" : " (This pairing's terrain data has not been checked against the game's own files.)"}`,
        });
      }
    } else if (!opts.surfaceAbstained) {
      const surfaceIds = [...opts.surface];
      const hasWater = surfaceIds.some((id) =>
        isWaterTerrain(opts.terrainConstants, id),
      );
      const hasNonWater = surfaceIds.some(
        (id) => !isWaterTerrain(opts.terrainConstants, id),
      );
      const ok = row.habitat === "water" ? hasWater : hasNonWater;
      if (!ok) {
        const allSurfaceVerified = surfaceIds.every(
          (id) => terrainRow(opts.constants, id)?.verified ?? false,
        );
        const verified = row.verified && allSurfaceVerified;
        findings.push({
          kind: "terrainImpossible",
          severity: gatedSeverity(verified),
          span: cmd.span,
          commandSpan: cmd.span,
          text: `${typeName} cannot be placed anywhere this map's terrain can produce, according to this object's terrain category (${row.habitat}).${verified ? "" : " (This object's terrain data has not been checked against the game's own files.)"}`,
        });
      }
    }
  }

  return findings;
}

export function checkAllObjectTerrainPlacements(
  inst: InstantiatedScript,
  opts: TerrainCheckOptions,
): UnstampedFinding[] {
  const findings: UnstampedFinding[] = [];
  for (const [, commands] of inst.sections) {
    for (const cmd of commands)
      findings.push(...checkObjectTerrainPlacement(cmd, inst, opts));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Sec.3.4: static contradictions (packing bound cut, see the design doc)
// ---------------------------------------------------------------------------

/** `objects.ts`'s own `minExceedsMax` comparison, promoted to the static layer so it fires once rather than being rediscovered identically on every Monte Carlo run. */
export function checkMinExceedsMaxObjects(
  inst: InstantiatedScript,
): UnstampedFinding[] {
  const findings: UnstampedFinding[] = [];
  for (const [, commands] of inst.sections) {
    for (const cmd of commands) {
      if (cmd.name !== "create_object" && cmd.name !== "create_object_group")
        continue;
      const min = numAttr(cmd, "min_distance_to_players", 0, Number.NaN);
      const max = numAttr(cmd, "max_distance_to_players", 0, Number.NaN);
      if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        findings.push({
          kind: "minExceedsMaxObjects",
          severity: "error",
          span: cmd.span,
          commandSpan: cmd.span,
          text: `min_distance_to_players (${min}) is greater than max_distance_to_players (${max}), so no tile can satisfy both and this command places nothing.`,
        });
      }
    }
  }
  return findings;
}

/** `cliffs.ts`'s own `min_number_of_cliffs > max_number_of_cliffs` comparison, promoted the same way, its consequence is worse (the note's own words: "crashes the real game"). */
export function checkCliffsMinExceedsMax(
  inst: InstantiatedScript,
): UnstampedFinding[] {
  const commands = inst.sections.get("CLIFF_GENERATION");
  if (!commands) return [];
  const settings = resolveCliffSettings(commands);
  if (settings.minCliffs <= settings.maxCliffs) return [];
  const span = settings.maxCliffsCmd?.span ?? settings.minCliffsCmd?.span;
  const commandSpan = commands[0]?.span;
  const maxDefaulted = settings.maxCliffsCmd === undefined;
  return [
    {
      kind: "cliffsMinExceedsMax",
      severity: "error",
      span,
      commandSpan,
      text: maxDefaulted
        ? `min_number_of_cliffs (${settings.minCliffs}) is greater than the default maximum of ${settings.maxCliffs}, which this script does not set. The real game crashes when this map is generated.`
        : `min_number_of_cliffs (${settings.minCliffs}) is greater than max_number_of_cliffs (${settings.maxCliffs}). The real game crashes when this map is generated.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// The whole layer, one player count at a time
// ---------------------------------------------------------------------------

export function runStaticChecks(
  inst: InstantiatedScript,
  parse: ParseResult,
  constants: readonly PublishedGameConstant[],
  ctx: StaticContext,
  playerCount: number,
): StaticFinding[] {
  const terrainConstants = asTerrainConstants(constants);
  // Two independent abstentions feed one flag, and they are different
  // claims: rule 4's is "this script has a `RawNode` big enough that the
  // surface is guessing" (a PARSE-level gap), clause 2's is "too many of the
  // producers we did read name terrains nothing defines" (a RESOLUTION-level
  // gap). Either one makes an emptiness argument unsafe.
  const census = ctx.terrainSurfaceRawAbstain
    ? undefined
    : computeTerrainSurface(parse, inst, terrainConstants, ctx.astConsts);
  const unresolvableRatio =
    census && census.producersTotal > 0
      ? census.producersUnresolvable / census.producersTotal
      : 0;
  const surfaceAbstained =
    census === undefined ||
    unresolvableRatio >= UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO;
  const surface = surfaceAbstained ? new Set<number>() : census!.surface;
  const symbols = new Map<string, number>([
    ...ctx.astConsts.first,
    ...inst.symbols,
  ]);

  // Every check below emits findings WITHOUT a `playerCount`; this function
  // stamps it once, so a new check cannot ship without one.
  const findings: UnstampedFinding[] = [
    // No `playerCount` argument: the per-player-count multiplier cancels
    // (see below), so this check's OUTPUT is player-count invariant and the
    // count it ran at is stamped on the way out like every other check's.
    ...checkLandOverAllocation(inst),
    ...checkActorAreas(inst, parse, ctx),
    ...checkAllObjectTerrainPlacements(inst, {
      constants,
      terrainConstants,
      surface,
      surfaceAbstained,
      symbols,
    }),
    ...checkMinExceedsMaxObjects(inst),
    ...checkCliffsMinExceedsMax(inst),
  ];
  return findings.map((f) => ({ ...f, playerCount }));
}
