// Phase 2.5 — status-bar resource totals. Pure function over a parsed
// script + the game-constants reference data: no React/Monaco/Tauri
// imports (docs/parser-design.md §14 discipline extended to this module
// so it can run unchanged inside the parser worker, same as parseRms
// itself, and stay fully Vitest-testable).
//
// Two UX decisions locked with Ash before implementing (CREATION_PLAN 2.5
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
// Player bucket is PER-PLAYER, not summed across players (Ash's
// correction after the first pass, which had multiplied it by
// playerCount and made it read like a second Total). set_place_for_every_
// player places one copy near EACH player, so what a player actually
// sees/gets is the per-instance amount — the same number regardless of
// player count. Total, by contrast, IS multiplied by playerCount, since
// it's the sum of every copy actually placed on the map.
//
// `second_object` (Ash's second bug report): a create_object block can
// place a companion object alongside its primary type at the same spot
// — real maps use this to pair an invisible placeholder type (e.g.
// FISH_PLACEHOLDER, which carries no resourceAmounts of its own) with
// the actual resource object (e.g. FISH). Both the primary type and
// second_object's type are resolved and their per-instance resourceAmounts
// are SUMMED before multiplying by the block's count — they're placed
// together, once per instance, not as independent counts.

import type { ArgNode, CommandNode, IfNode, Item, RandomNode, ScriptNode, Token } from "./types";

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
export interface ResourceObjectConstant {
  rmsConstant: string;
  category: string;
  resourceAmounts?: Partial<ResourceAmounts>;
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

/** Sums two optional per-instance resourceAmounts maps (second_object is placed alongside the primary, not instead of it). */
function mergeResourceAmounts(
  a: Partial<ResourceAmounts> | undefined,
  b: Partial<ResourceAmounts> | undefined,
): Partial<ResourceAmounts> | undefined {
  if (!a && !b) return undefined;
  const out: Partial<ResourceAmounts> = {};
  for (const key of RESOURCE_KEYS) {
    const sum = (a?.[key] ?? 0) + (b?.[key] ?? 0);
    if (sum !== 0) out[key] = sum;
  }
  return out;
}

function multiplyCountRanges(a: CountRange, b: CountRange): CountRange {
  return { min: a.min * b.min, max: a.max * b.max };
}

/** Builds a ResourceRange from a per-instance resourceAmounts map and a count range. */
function rangeFromCount(resourceAmounts: Partial<ResourceAmounts>, countRange: CountRange): ResourceRange {
  const min = zeroAmounts();
  const max = zeroAmounts();
  for (const key of RESOURCE_KEYS) {
    const perInstance = resourceAmounts[key];
    if (perInstance === undefined) continue;
    min[key] = perInstance * countRange.min;
    max[key] = perInstance * countRange.max;
  }
  return { min, max };
}

function computeCreateObjectContribution(
  node: CommandNode,
  tokens: Token[],
  constantsByName: ReadonlyMap<string, ResourceObjectConstant>,
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

  const combinedAmounts = mergeResourceAmounts(primaryConstant?.resourceAmounts, secondConstant?.resourceAmounts);
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

function walkIf(node: IfNode, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, playerCount: number): ResourceTotals {
  const hasElse = node.branches.some((branch) => tokens[branch.keyword].text === "else");
  const branchTotals = node.branches.map((branch) => walkItems(branch.items, tokens, constantsByName, playerCount));
  return combineBranches(branchTotals, /* allowZero */ !hasElse);
}

function walkRandom(node: RandomNode, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, playerCount: number): ResourceTotals {
  // Preamble tokens (before the first percent_chance) are guide-flagged
  // junk (RMS0106) but still parse as real items — best-effort, count
  // them as always-present rather than dropping them silently.
  const preambleTotals = walkItems(node.preamble, tokens, constantsByName, playerCount);
  const branchTotals = node.branches.map((branch) => walkItems(branch.items, tokens, constantsByName, playerCount));
  const randomPart = combineBranches(branchTotals, /* allowZero */ false);
  return addTotals(preambleTotals, randomPart);
}

function walkItem(item: Item, tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, playerCount: number): ResourceTotals {
  switch (item.kind) {
    case "command":
      if (tokens[item.name].text === "create_object") {
        return computeCreateObjectContribution(item, tokens, constantsByName, playerCount);
      }
      return zeroTotals();
    case "if":
      return walkIf(item, tokens, constantsByName, playerCount);
    case "random":
      return walkRandom(item, tokens, constantsByName, playerCount);
    case "orphanBlock":
      // Best-effort: a stray/glued-brace recovery block may still contain
      // legitimate create_object calls (spec §5.4 keeps these lossless).
      return walkItems(item.block.items, tokens, constantsByName, playerCount);
    case "attribute":
    case "directive":
    case "raw":
      return zeroTotals();
  }
}

function walkItems(items: Item[], tokens: Token[], constantsByName: ReadonlyMap<string, ResourceObjectConstant>, playerCount: number): ResourceTotals {
  let acc = zeroTotals();
  for (const item of items) {
    acc = addTotals(acc, walkItem(item, tokens, constantsByName, playerCount));
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
  const constantsByName = new Map<string, ResourceObjectConstant>();
  for (const c of gameConstants.constants) {
    if (c.category === "object") constantsByName.set(c.rmsConstant, c);
  }

  let acc = walkItems(script.preamble, tokens, constantsByName, playerCount);
  for (const section of script.sections) {
    acc = addTotals(acc, walkItems(section.items, tokens, constantsByName, playerCount));
  }
  return acc;
}
