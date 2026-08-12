// Phase 2.5 — status-bar resource totals. Pure function over a parsed
// script + the game-constants reference data: no React/Monaco/Tauri
// imports (docs/parser-design.md Sec.14 discipline extended to this module
// so it can run unchanged inside the parser worker, same as parseRms
// itself, and stay fully Vitest-testable).
//
// Two UX decisions locked before implementing (CREATION_PLAN 2.5
// explicitly required asking first):
//   1. if/start_random blocks make the exact count generation-dependent —
//      shown as a min-max RANGE, not a single expected value.
//   2. Player vs Neutral split (v1, simple on purpose): a create_object
//      block containing set_place_for_every_player attribute counts as
//      Player; everything else counts as Neutral. This does NOT try to
//      correlate place_on_specific_land_id against LAND_GENERATION's
//      player-land assignments — that's a real gap (a forage bush
//      deliberately placed next to a player's start via land_id still
//      counts as Neutral here) but was explicitly deferred to a later pass.
//
// Player bucket is PER-PLAYER, not summed across players. set_place_for_every_
// player places one copy near EACH player, so what a player actually
// sees/gets is the per-instance amount — the same number regardless of
// player count. Total, by contrast, IS multiplied by playerCount, since
// it's the sum of every copy actually placed on the map.
//
// SCRIPT-LEVEL OVERRIDES (2026-08-11). What an object yields is not fixed by
// the game's data files — `effect_amount ... ATTR_STORAGE_VALUE` rewrites it,
// and the corpus does that 374 times. Modelled as a third source of range
// alongside the two above, since 353 of those 374 sit inside a conditional. See
// the "Script-level storage overrides" section below for the model and its
// limits.
//
// **It is correct and currently inert, which is worth knowing before anyone
// hunts for a bug.** Measured over all 57 corpus maps: 365 of the 374 lines
// resolve to a target, and NONE of them hits one of the 16 objects
// `game-constants.json` carries a yield for. The maps rewrite trees, ostriches,
// fences and placeholders; the reference data knows gold, stone, forage, deer,
// boar, sheep and the fish. So no corpus map's totals move today, and every one
// of them starts moving when `game-constants.json` grows past its 33 object
// rows, which is CREATION_PLAN 4.10 (not 4.7 — that is the terrain table and is
// done). The machinery is pinned by unit tests rather than by a corpus diff for
// exactly that reason.
//
// `second_object`: a create_object block can
// place a companion object alongside its primary type at the same spot
// — real maps use this to pair an invisible placeholder type (e.g.
// FISH_PLACEHOLDER, which carries no resourceAmounts of its own) with
// the actual resource object (e.g. FISH). Both the primary type and
// second_object's type are resolved and their per-instance resourceAmounts
// are SUMMED before multiplying by the block's count — they're placed
// together, once per instance, not as independent counts.

import type { ArgNode, ArgValue, CommandNode, IfNode, Item, RandomNode, ScriptNode, Token } from "./types";

export type ResourceKey = "food" | "wood" | "gold" | "stone";
export const RESOURCE_KEYS: readonly ResourceKey[] = ["food", "wood", "gold", "stone"];

export type ResourceAmounts = Record<ResourceKey, number>;

export interface ResourceRange {
  min: ResourceAmounts;
  max: ResourceAmounts;
}

export interface ResourceTotals {
  total: ResourceRange;
  player: ResourceRange;
  neutral: ResourceRange;
}

// Minimal shape this module needs from reference/data/game-constants.json —
// deliberately narrower than aoe2RmsHover.ts's local GameConstant type
// (this module doesn't care about constId/deTextureFile/verified/notes).
export interface ResourceStorageSlot {
  type: number;
  amount: number;
  /** Absent when the slot is not one of the four — population, decay time, or an unread type. */
  resource?: ResourceKey;
}
export interface ResourceObjectConstant {
  rmsConstant: string;
  category: string;
  constId?: number | null;
  resourceAmounts?: Partial<ResourceAmounts>;
  /** Object rows: the unit's raw storage slots. `effect_amount ... ATTR_STORAGE_VALUE` writes one of these. */
  resourceStorages?: ResourceStorageSlot[];
  /** objectClass rows: every unit id in the class. */
  memberIds?: number[];
  /** attribute rows: this attribute writes that index of the target's resourceStorages. */
  writesStorageSlot?: number;
}
export interface GameConstantsForTotals {
  constants: ResourceObjectConstant[];
}

// RMS engine default when number_of_objects/number_of_groups is omitted.
// Not independently guide-sourced (language.json has no "default" on
// either attribute yet — both are still "verified": false) — this is a
// documented assumption, not a fact. A bare `create_object GOLD` and a
// blocked one with neither attribute both place exactly one instance per
// group, per widely-observed community script behavior.
const DEFAULT_COUNT = 1;

function zeroAmounts(): ResourceAmounts {
  return { food: 0, wood: 0, gold: 0, stone: 0 };
}

function addAmounts(a: ResourceAmounts, b: ResourceAmounts): ResourceAmounts {
  const out = zeroAmounts();
  for (const key of RESOURCE_KEYS) out[key] = a[key] + b[key];
  return out;
}

function zeroRange(): ResourceRange {
  return { min: zeroAmounts(), max: zeroAmounts() };
}

function addRanges(a: ResourceRange, b: ResourceRange): ResourceRange {
  return { min: addAmounts(a.min, b.min), max: addAmounts(a.max, b.max) };
}

function zeroTotals(): ResourceTotals {
  return { total: zeroRange(), player: zeroRange(), neutral: zeroRange() };
}

function addTotals(a: ResourceTotals, b: ResourceTotals): ResourceTotals {
  return {
    total: addRanges(a.total, b.total),
    player: addRanges(a.player, b.player),
    neutral: addRanges(a.neutral, b.neutral),
  };
}

/**
 * Combine sibling if/random BRANCHES (mutually exclusive — at most one
 * runs) into one range per resource, independently per resource and per
 * bucket (the branch that minimizes Food need not be the same branch
 * that minimizes Gold — this reports each resource's own worst/best
 * case, not one joint what-if scenario; documented in the module header
 * decision log above).
 *
 * `allowZero`: true for if-chains with no unconditional else branch (the
 * condition could evaluate false with nothing to fall back on, so "none
 * of these run" is itself a possible outcome); false for start_random
 * (exactly one percent_chance branch always runs, assuming the script's
 * percentages are well-formed) and for if-chains that DO have an else.
 */
function combineBranches(branchTotals: ResourceTotals[], allowZero: boolean): ResourceTotals {
  if (branchTotals.length === 0) return zeroTotals();
  const buckets: Array<keyof ResourceTotals> = ["total", "player", "neutral"];
  const result = zeroTotals();
  for (const bucket of buckets) {
    for (const key of RESOURCE_KEYS) {
      const mins = branchTotals.map((b) => b[bucket].min[key]);
      const maxes = branchTotals.map((b) => b[bucket].max[key]);
      const minCandidates = allowZero ? [0, ...mins] : mins;
      result[bucket].min[key] = Math.min(...minCandidates);
      result[bucket].max[key] = Math.max(...maxes);
    }
  }
  return result;
}

interface CountRange {
  min: number;
  max: number;
}

/** Reads a numeric-or-rnd(...) attribute value as a count range. */
function readCountRange(node: CommandNode, tokens: Token[], attrName: string): CountRange | undefined {
  for (const item of node.block?.items ?? []) {
    if (item.kind !== "attribute") continue;
    if (tokens[item.name].text !== attrName) continue;
    const arg: ArgNode | undefined = item.args[0];
    if (!arg) return undefined;
    if (typeof arg.value === "number") return { min: arg.value, max: arg.value };
    if (typeof arg.value === "object" && "rnd" in arg.value) {
      const [a, b] = arg.value.rnd;
      return { min: Math.max(0, Math.min(a, b)), max: Math.max(0, Math.max(a, b)) };
    }
    // Expression ({ expr: ... }) or a non-numeric word: can't statically
    // evaluate without symbol resolution — fall back to the caller's
    // default rather than guessing.
    return undefined;
  }
  return undefined;
}

function hasBareAttribute(node: CommandNode, tokens: Token[], attrName: string): boolean {
  return (node.block?.items ?? []).some((item) => item.kind === "attribute" && tokens[item.name].text === attrName);
}

/** Reads a single-constant-argument attribute's value (e.g. second_object TYPE). */
function readAttributeConstant(node: CommandNode, tokens: Token[], attrName: string): string | undefined {
  for (const item of node.block?.items ?? []) {
    if (item.kind !== "attribute") continue;
    if (tokens[item.name].text !== attrName) continue;
    const arg: ArgNode | undefined = item.args[0];
    return arg && typeof arg.value === "string" ? arg.value : undefined;
  }
  return undefined;
}

/** Sums two optional per-instance amount RANGES (second_object is placed alongside the primary, not instead of it). */
function mergeResourceAmounts(a: AmountRange | undefined, b: AmountRange | undefined): AmountRange | undefined {
  if (!a && !b) return undefined;
  const sumEnd = (x: Partial<ResourceAmounts> | undefined, y: Partial<ResourceAmounts> | undefined) => {
    const out: Partial<ResourceAmounts> = {};
    for (const key of RESOURCE_KEYS) {
      const sum = (x?.[key] ?? 0) + (y?.[key] ?? 0);
      if (sum !== 0) out[key] = sum;
    }
    return out;
  };
  // The two objects' ends add independently: the worst case for the pair is
  // both at their worst, and the best case both at their best.
  return { min: sumEnd(a?.min, b?.min), max: sumEnd(a?.max, b?.max) };
}

function multiplyCountRanges(a: CountRange, b: CountRange): CountRange {
  return { min: a.min * b.min, max: a.max * b.max };
}

// ---------------------------------------------------------------------------
// Script-level storage overrides — `effect_amount <effect> <target> <attr> <n>`
// ---------------------------------------------------------------------------
//
// What an object yields is not fixed by the game's data files. A script can
// rewrite it, and 374 lines across 16 corpus maps do:
//
//     effect_amount GAIA_SET_ATTRIBUTE TREE_CLASS ATTR_STORAGE_VALUE 200
//     effect_amount SET_ATTRIBUTE TC_PLACEHOLDER_RUBBLE ATTR_STORAGE_VALUE 0
//
// Until now the status bar reported the base value regardless, so a map that
// zeroes its trees still showed their wood.
//
// THREE THINGS MAKE THIS TRACTABLE, and each is data rather than a rule
// written here (CLAUDE.md: vocabulary is data-driven).
//
//   1. WHICH ATTRIBUTE. The attribute rows carry `writesStorageSlot`, so this
//      file asks "which attribute writes a storage slot" instead of naming
//      ATTR_STORAGE_VALUE. That also makes a script that reaches the attribute
//      by its raw id (21) resolve identically, for free.
//   2. WHICH OBJECTS. A target can be a unit or a CLASS covering dozens of
//      them, and the objectClass rows carry `memberIds` over the whole roster.
//   3. WHICH RESOURCE. Slot 0 holds wood for a tree, population for a house
//      and a decay timer for a corpse, all through this one attribute. The
//      storage slots carry `resource`, absent when the slot is not one of the
//      four — which is how a house's line is correctly counted as changing
//      nothing.
//
// **353 of those 374 lines sit inside a conditional, which decides the model.**
// An `effect_amount` under `if REGICIDE` applies on the paths where that branch
// runs and not otherwise, so a single number would be wrong either way. This
// module already answers generation-dependent questions with a RANGE, so an
// object reachable by an override reports `min`/`max` spanning the base value
// and every value an override could give it. An UNCONDITIONAL override is
// different in kind: it always runs, so it replaces the base rather than
// widening a range around it.
//
// Deliberately NOT modelled, and each would be its own pass:
//   - `GAIA_SET_ATTRIBUTE` vs `SET_ATTRIBUTE` (ownership). Both write the same
//     unit attribute and map resources are gaia-owned, so for this count they
//     agree; where they differ is player-owned copies, which this file does not
//     track anyway.
//   - `GAIA_UPGRADE_UNIT`, which changes a yield by swapping one unit type for
//     another rather than by writing an attribute.
//   - Path correlation. Two overrides in mutually exclusive branches widen the
//     same range as two that could both run, so the reported span is a superset
//     of what any single generation can produce. A superset is the safe
//     direction for a status bar: it never claims a precision it does not have.

/** Per-instance yields as a RANGE, since an override may or may not fire. */
interface AmountRange {
  min: Partial<ResourceAmounts>;
  max: Partial<ResourceAmounts>;
}

interface UnitOverride {
  /** Set by a line that always runs. The base value is then unreachable. */
  unconditional?: number;
  /** Set by lines under an if/start_random. Each is a value the slot MIGHT hold. */
  conditional: number[];
}

interface ConstantIndex {
  objectByName: ReadonlyMap<string, ResourceObjectConstant>;
  classByName: ReadonlyMap<string, ResourceObjectConstant>;
  classById: ReadonlyMap<number, ResourceObjectConstant>;
  /** constIds and names of every attribute whose `writesStorageSlot` is slot 0. */
  storageAttributeNames: ReadonlySet<string>;
  storageAttributeIds: ReadonlySet<number>;
}

function buildConstantIndex(gameConstants: GameConstantsForTotals): ConstantIndex {
  const objectByName = new Map<string, ResourceObjectConstant>();
  const classByName = new Map<string, ResourceObjectConstant>();
  const classById = new Map<number, ResourceObjectConstant>();
  const storageAttributeNames = new Set<string>();
  const storageAttributeIds = new Set<number>();
  for (const c of gameConstants.constants) {
    if (c.category === "object") objectByName.set(c.rmsConstant, c);
    else if (c.category === "objectClass") {
      if (c.rmsConstant) classByName.set(c.rmsConstant, c);
      if (typeof c.constId === "number") classById.set(c.constId, c);
    } else if (c.category === "attribute" && c.writesStorageSlot === 0) {
      if (c.rmsConstant) storageAttributeNames.add(c.rmsConstant);
      if (typeof c.constId === "number") storageAttributeIds.add(c.constId);
    }
  }
  return { objectByName, classByName, classById, storageAttributeNames, storageAttributeIds };
}

/**
 * A script's own `#const NAME <int>` definitions.
 *
 * Collected because an `effect_amount` target is usually an author-invented
 * name — 216 of the 397 object names the corpus writes are `#const`s, and the
 * unit they point at often has no DE constant at all.
 */
function collectSymbols(script: ScriptNode, tokens: Token[]): Map<string, number> {
  const symbols = new Map<string, number>();
  const visit = (items: Item[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "directive": {
          if (tokens[item.hash].text !== "#const") break;
          const [nameArg, valueArg] = item.args;
          if (typeof nameArg?.value === "string" && typeof valueArg?.value === "number") {
            // First definition wins, matching the engine.
            if (!symbols.has(nameArg.value)) symbols.set(nameArg.value, valueArg.value);
          }
          break;
        }
        case "if":
          for (const branch of item.branches) visit(branch.items);
          break;
        case "random":
          visit(item.preamble);
          for (const branch of item.branches) visit(branch.items);
          break;
        case "orphanBlock":
          visit(item.block.items);
          break;
        default:
          break;
      }
    }
  };
  visit(script.preamble);
  for (const section of script.sections) visit(section.items);
  return symbols;
}

/**
 * An `effect_amount` target -> the unit ids it covers.
 *
 * Resolution order is `resolveTerrainId`'s and for its reason: the engine loads
 * `random_map.def` before the script and `#const` is first-definition-wins, so
 * a built-in name beats a script's redefinition of it.
 */
function resolveTargetUnits(
  value: ArgValue,
  index: ConstantIndex,
  symbols: ReadonlyMap<string, number>,
): number[] {
  if (typeof value === "string") {
    const byClass = index.classByName.get(value);
    if (byClass?.memberIds) return byClass.memberIds;
    const byObject = index.objectByName.get(value);
    if (typeof byObject?.constId === "number") return [byObject.constId];
    const symbol = symbols.get(value);
    return symbol === undefined ? [] : resolveTargetUnits(symbol, index, symbols);
  }
  if (typeof value !== "number") return []; // rnd()/expression targets are not statically resolvable
  // A raw number is a class id when a class row claims it (classId + 900) and a
  // unit id otherwise. The two spaces do not overlap in practice: unit ids that
  // high are placeholders nobody targets, and the offset exists precisely so
  // the engine can tell them apart.
  const byId = index.classById.get(value);
  return byId?.memberIds ?? [value];
}

/** Is this command an `effect_amount` that writes storage slot 0? */
function readStorageEffect(
  node: CommandNode,
  tokens: Token[],
  index: ConstantIndex,
  symbols: ReadonlyMap<string, number>,
): { units: number[]; amount: number } | undefined {
  if (tokens[node.name].text !== "effect_amount") return undefined;
  const [, targetArg, attributeArg, amountArg] = node.args;
  if (!targetArg || !attributeArg || !amountArg) return undefined;

  const attribute = attributeArg.value;
  const attributeId =
    typeof attribute === "string"
      ? index.storageAttributeNames.has(attribute)
        ? 0
        : symbols.get(attribute)
      : typeof attribute === "number"
        ? attribute
        : undefined;
  const writesStorage =
    (typeof attribute === "string" && index.storageAttributeNames.has(attribute)) ||
    (attributeId !== undefined && index.storageAttributeIds.has(attributeId));
  if (!writesStorage) return undefined;

  // The amount is the only argument that must be a plain number: an unresolved
  // one means we cannot say what the yield becomes, and a guess here would
  // silently move a total the user is reading.
  if (typeof amountArg.value !== "number") return undefined;

  const units = resolveTargetUnits(targetArg.value, index, symbols);
  return units.length === 0 ? undefined : { units, amount: amountArg.value };
}

/**
 * Pre-pass over the whole script, collecting every storage override.
 *
 * Whole-script rather than woven into the main walk, because `effect_amount`
 * applies at map start to every object the map places, not only to the ones
 * written after it or beside it. Section is not consulted for the same reason:
 * the guide documents it under `<PLAYER_SETUP>` and the corpus writes 52 of
 * them elsewhere in working maps, which is a standing counter-example to
 * treating placement as meaningful here.
 */
function collectStorageOverrides(
  script: ScriptNode,
  tokens: Token[],
  index: ConstantIndex,
  symbols: ReadonlyMap<string, number>,
): Map<number, UnitOverride> {
  const overrides = new Map<number, UnitOverride>();

  const record = (units: number[], amount: number, conditional: boolean): void => {
    for (const unit of units) {
      const entry = overrides.get(unit) ?? { conditional: [] };
      // Last unconditional line wins: they all run, in order.
      if (conditional) entry.conditional.push(amount);
      else entry.unconditional = amount;
      overrides.set(unit, entry);
    }
  };

  const visit = (items: Item[], conditional: boolean): void => {
    for (const item of items) {
      switch (item.kind) {
        case "command": {
          const effect = readStorageEffect(item, tokens, index, symbols);
          if (effect) record(effect.units, effect.amount, conditional);
          break;
        }
        case "if":
          for (const branch of item.branches) visit(branch.items, true);
          break;
        case "random":
          visit(item.preamble, conditional);
          for (const branch of item.branches) visit(branch.items, true);
          break;
        case "orphanBlock":
          visit(item.block.items, conditional);
          break;
        default:
          break;
      }
    }
  };

  visit(script.preamble, false);
  for (const section of script.sections) visit(section.items, false);
  return overrides;
}

/**
 * One object's per-instance yields, as a range once overrides are applied.
 *
 * Returns the declared amounts unchanged when nothing targets this object,
 * which is the overwhelming majority and costs one map lookup.
 */
function perInstanceAmounts(
  constant: ResourceObjectConstant | undefined,
  overrides: ReadonlyMap<number, UnitOverride>,
): AmountRange | undefined {
  if (!constant?.resourceAmounts) return undefined;
  const declared = constant.resourceAmounts;
  const override = typeof constant.constId === "number" ? overrides.get(constant.constId) : undefined;
  const slot = constant.resourceStorages?.[0];
  // No override, or one that cannot move a resource total: a slot holding
  // population or a decay timer has no `resource`, and rewriting it changes
  // nothing this module counts.
  if (!override || !slot?.resource) return { min: declared, max: declared };

  const key = slot.resource;
  const base = override.unconditional ?? slot.amount;
  const candidates = [base, ...override.conditional];
  const low = Math.min(...candidates);
  const high = Math.max(...candidates);
  // Only slot 0 moves. Whatever the other slots contribute stays as declared,
  // which is why this rebuilds from `declared` rather than from the slot list.
  return {
    min: { ...declared, [key]: (declared[key] ?? slot.amount) - slot.amount + low },
    max: { ...declared, [key]: (declared[key] ?? slot.amount) - slot.amount + high },
  };
}

/**
 * Builds a ResourceRange from a per-instance amount RANGE and a count range.
 *
 * Both ends are now ranges: the count varies with `rnd()` and conditionals, and
 * since 2026-08-11 the per-instance amount varies too, when a script rewrites
 * what an object yields. Worst case pairs the two minimums and best case the
 * two maximums, which is the same widest-honest-span this module reports for
 * counts alone.
 */
function rangeFromCount(amounts: AmountRange, countRange: CountRange): ResourceRange {
  const min = zeroAmounts();
  const max = zeroAmounts();
  for (const key of RESOURCE_KEYS) {
    const low = amounts.min[key];
    const high = amounts.max[key];
    if (low === undefined && high === undefined) continue;
    min[key] = (low ?? 0) * countRange.min;
    max[key] = (high ?? 0) * countRange.max;
  }
  return { min, max };
}

function computeCreateObjectContribution(
  node: CommandNode,
  tokens: Token[],
  constantsByName: ReadonlyMap<string, ResourceObjectConstant>,
  overrides: ReadonlyMap<number, UnitOverride>,
  playerCount: number,
): ResourceTotals {
  const firstArg = node.args[0];
  const primaryName = firstArg && typeof firstArg.value === "string" ? firstArg.value : undefined;
  const primaryConstant = primaryName ? constantsByName.get(primaryName) : undefined;

  // second_object: a companion type placed alongside the primary at the
  // same spot (see module header) — resolved and summed in regardless of
  // whether the primary itself resolved to anything with resourceAmounts
  // (real maps pair a resource-less placeholder primary, e.g.
  // FISH_PLACEHOLDER, with the actual resource object as second_object).
  const secondObjectName = readAttributeConstant(node, tokens, "second_object");
  const secondConstant = secondObjectName ? constantsByName.get(secondObjectName) : undefined;

  const combinedAmounts = mergeResourceAmounts(
    perInstanceAmounts(primaryConstant, overrides),
    perInstanceAmounts(secondConstant, overrides),
  );
  if (!combinedAmounts) return zeroTotals();

  const objectsRange = readCountRange(node, tokens, "number_of_objects") ?? { min: DEFAULT_COUNT, max: DEFAULT_COUNT };
  const groupsRange = readCountRange(node, tokens, "number_of_groups") ?? { min: DEFAULT_COUNT, max: DEFAULT_COUNT };
  // Per-instance count (what ONE player's copy places) — the Player
  // bucket always uses this, unmultiplied.
  const perPlayerCountRange = multiplyCountRanges(objectsRange, groupsRange);

  const isPlayerScaled = hasBareAttribute(node, tokens, "set_place_for_every_player");
  if (!isPlayerScaled) {
    // Neutral: placed exactly once, total and neutral agree.
    const range = rangeFromCount(combinedAmounts, perPlayerCountRange);
    return { total: range, player: zeroRange(), neutral: range };
  }

  // Player: placed once per player. Total sums every copy across the
  // map (multiplied by playerCount); Player shows what a single player
  // gets (the unmultiplied per-instance amount).
  const mapWideCountRange = {
    min: perPlayerCountRange.min * playerCount,
    max: perPlayerCountRange.max * playerCount,
  };
  const totalRange = rangeFromCount(combinedAmounts, mapWideCountRange);
  const playerRange = rangeFromCount(combinedAmounts, perPlayerCountRange);
  return { total: totalRange, player: playerRange, neutral: zeroRange() };
}

function walkIf(node: IfNode, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, overrides: ReadonlyMap<number, UnitOverride>, playerCount: number): ResourceTotals {
  const hasElse = node.branches.some((branch) => tokens[branch.keyword].text === "else");
  const branchTotals = node.branches.map((branch) => walkItems(branch.items, tokens, constantsByName, overrides, playerCount));
  return combineBranches(branchTotals, /* allowZero */ !hasElse);
}

function walkRandom(node: RandomNode, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, overrides: ReadonlyMap<number, UnitOverride>, playerCount: number): ResourceTotals {
  // Preamble tokens (before the first percent_chance) are guide-flagged
  // junk (RMS0106) but still parse as real items — best-effort, count
  // them as always-present rather than dropping them silently.
  const preambleTotals = walkItems(node.preamble, tokens, constantsByName, overrides, playerCount);
  const branchTotals = node.branches.map((branch) => walkItems(branch.items, tokens, constantsByName, overrides, playerCount));
  const randomPart = combineBranches(branchTotals, /* allowZero */ false);
  return addTotals(preambleTotals, randomPart);
}

function walkItem(item: Item, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, overrides: ReadonlyMap<number, UnitOverride>, playerCount: number): ResourceTotals {
  switch (item.kind) {
    case "command":
      if (tokens[item.name].text === "create_object") {
        return computeCreateObjectContribution(item, tokens, constantsByName, overrides, playerCount);
      }
      return zeroTotals();
    case "if":
      return walkIf(item, tokens, constantsByName, overrides, playerCount);
    case "random":
      return walkRandom(item, tokens, constantsByName, overrides, playerCount);
    case "orphanBlock":
      // Best-effort: a stray/glued-brace recovery block may still contain
      // legitimate create_object calls (spec Sec.5.4 keeps these lossless).
      return walkItems(item.block.items, tokens, constantsByName, overrides, playerCount);
    case "attribute":
    case "directive":
    case "raw":
      return zeroTotals();
  }
}

function walkItems(items: Item[], tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, overrides: ReadonlyMap<number, UnitOverride>, playerCount: number): ResourceTotals {
  let acc = zeroTotals();
  for (const item of items) {
    acc = addTotals(acc, walkItem(item, tokens, constantsByName, overrides, playerCount));
  }
  return acc;
}

/**
 * Walk a parsed script and sum create_object resource contributions.
 * Known v1 scope limits (see module header): no land-ownership
 * correlation for the Player/Neutral split; create_object_group's
 * add_object percentage composition isn't modeled (contributes 0);
 * counts driven by unresolved #const expressions fall back to the
 * DEFAULT_COUNT rather than being evaluated.
 */
export function computeResourceTotals(
  script: ScriptNode,
  tokens: Token[],
  gameConstants: GameConstantsForTotals,
  playerCount: number,
): ResourceTotals {
  const index = buildConstantIndex(gameConstants);
  const constantsByName = index.objectByName;
  // One pre-pass before the walk. `effect_amount` applies at map start to every
  // object the script places, so it cannot be gathered on the way past.
  const overrides = collectStorageOverrides(script, tokens, index, collectSymbols(script, tokens));

  let acc = walkItems(script.preamble, tokens, constantsByName, overrides, playerCount);
  for (const section of script.sections) {
    acc = addTotals(acc, walkItems(section.items, tokens, constantsByName, overrides, playerCount));
  }
  return acc;
}
