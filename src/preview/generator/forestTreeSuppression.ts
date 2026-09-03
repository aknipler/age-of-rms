// Detects two things a script can do to an automatic forest spawn at runtime,
// both via `effect_amount (GAIA_)SET_ATTRIBUTE <target> <attribute> <n>` —
// the SAME command shape, which is why one walk serves both (splitting them
// into two passes would be two places to get target resolution wrong):
//
//   1. ATTR_TERRAIN_ID: rewrites which terrains a unit may stand on. Retarget
//      a forest's own auto-spawn tree off that forest's terrain and the
//      spawn is silently suppressed everywhere — Menindee_AUS_v2.3.rms does
//      exactly this to PALMTREE/TREE_AUTUMN, then hand-places its own trees
//      three lines later. A rewrite is not automatically a suppression: it
//      only suppresses when the NEW restriction excludes the terrain in
//      question (restriction 0 permits everything and WIDENS; the corpus
//      does that to GOLD/STONE on purpose).
//   2. ATTR_STORAGE_VALUE (D10): rewrites what a unit's storage slot 0
//      holds, which for a tree is its wood yield. AK_Namatjira.rms doubles
//      PALMTREE's yield this way, and PALMTREE is also PALM_DESERT's and
//      PALM_GRASS_FOREST's auto-spawn tree, so the override has to reach
//      forestTrees.ts's aggregate, not only a scripted create_object total.
//
// PURITY (CLAUDE.md hard rule, preview-design Sec.2): no React/Monaco/Tauri
// imports.

import type { InstantiatedCommand, InstantiatedScript, InstantiatedValue, SimulationNote } from "./types";
import { objectById, objectEntry, type ObjectConstant } from "./objects";
import type { YieldOverride, YieldOverrideMap } from "./resourceSummary";

/** The slice of the top-level `terrainRestrictions` table this scan needs — see reference/schemas/game-constants.schema.json. */
export interface TerrainRestriction {
  restrictionId: number;
  permittedTerrainIds: readonly number[];
}

export interface AutoTreeSuppressionResult {
  /** `${terrainId}:${unitId}` pairs whose automatic spawn is suppressed on that terrain. Per-(terrain, unit), not per-unit: PALMTREE serves both PALM_DESERT and PALM_GRASS_FOREST, and a rewrite that suppresses it on one need not suppress it on the other (their terrains can differ in which restrictions still permit them). */
  suppressed: ReadonlySet<string>;
  /** D10: unit constId -> the resource/amount its storage slot 0 has been rewritten to. */
  yieldOverrides: YieldOverrideMap;
  note?: SimulationNote;
}

function suppressionKey(terrainId: number, unitId: number): string {
  return `${terrainId}:${unitId}`;
}

/** Every (unit, terrain) pair the reference data's `autoTreeUnits` tables declare, inverted for a per-unit lookup. */
function buildAutoTreeIndex(constants: readonly ObjectConstant[]): Map<number, Set<number>> {
  const index = new Map<number, Set<number>>();
  for (const row of constants) {
    if (row.category !== "terrain" || row.constId === null || !row.autoTreeUnits) continue;
    for (const slot of row.autoTreeUnits) {
      let terrains = index.get(slot.objectId);
      if (!terrains) {
        terrains = new Set();
        index.set(slot.objectId, terrains);
      }
      terrains.add(row.constId);
    }
  }
  return index;
}

/** `attribute`/`target` slot resolution shared by both halves of the scan. */
interface AttributeIndex {
  /** name or numeric constId -> the resolved constId, for every category:"attribute" row. */
  byNameOrId: Map<string | number, number>;
  /** attribute constId -> writesStorageSlot, for D10. */
  storageSlotByAttrId: Map<number, number>;
  terrainIdAttrId: number | undefined;
}

function buildAttributeIndex(constants: readonly ObjectConstant[]): AttributeIndex {
  const byNameOrId = new Map<string | number, number>();
  const storageSlotByAttrId = new Map<number, number>();
  let terrainIdAttrId: number | undefined;
  for (const row of constants) {
    if (row.category !== "attribute" || typeof row.constId !== "number") continue;
    if (row.rmsConstant) byNameOrId.set(row.rmsConstant, row.constId);
    byNameOrId.set(row.constId, row.constId);
    if (row.rmsConstant === "ATTR_TERRAIN_ID") terrainIdAttrId = row.constId;
    if (typeof row.writesStorageSlot === "number") storageSlotByAttrId.set(row.constId, row.writesStorageSlot);
  }
  return { byNameOrId, storageSlotByAttrId, terrainIdAttrId };
}

function resolveAttributeId(value: InstantiatedValue, index: AttributeIndex, symbols: ReadonlyMap<string, number>): number | undefined {
  if (typeof value === "number") return index.byNameOrId.get(value) ?? value;
  if (typeof value !== "string") return undefined;
  const direct = index.byNameOrId.get(value);
  if (direct !== undefined) return direct;
  const symbol = symbols.get(value);
  return symbol === undefined ? undefined : (index.byNameOrId.get(symbol) ?? symbol);
}

/**
 * A `target` slot resolves to one or more unit ids: a single object (by name,
 * `#const`-to-name alias, or bare id), or a CLASS (by name or by
 * `classId + 900`), which expands to every member the roster carries — the
 * same target-resolution old `resourceTotals.ts`'s `resolveTargetUnits` did,
 * ported because `ATTR_STORAGE_VALUE` corpus lines mostly target classes
 * (`TREE_CLASS` alone covers 51 unit types).
 */
function resolveTargetUnitIds(
  value: InstantiatedValue,
  constants: readonly ObjectConstant[],
  symbols: ReadonlyMap<string, number>,
  aliases: ReadonlyMap<string, string>,
): readonly number[] {
  if (typeof value === "string") {
    const objectClass = classByName(constants, value);
    if (objectClass?.memberIds) return objectClass.memberIds;
    const object = objectEntry(value, constants, symbols, aliases);
    if (typeof object?.constId === "number") return [object.constId];
    const symbol = symbols.get(value);
    return symbol === undefined ? [] : resolveTargetUnitIds(symbol, constants, symbols, aliases);
  }
  if (typeof value !== "number") return [];
  const objectClass = classById(constants, value);
  return objectClass?.memberIds ?? [value];
}

function classByName(constants: readonly ObjectConstant[], name: string): ObjectConstant | undefined {
  return constants.find((c) => c.category === "objectClass" && c.rmsConstant === name);
}
function classById(constants: readonly ObjectConstant[], id: number): ObjectConstant | undefined {
  return constants.find((c) => c.category === "objectClass" && c.constId === id);
}

function isEffectAmount(cmd: InstantiatedCommand): boolean {
  return cmd.name === "effect_amount";
}

export function scanAutoTreeEffects(
  instantiated: InstantiatedScript,
  constants: readonly ObjectConstant[],
  terrainRestrictions: readonly TerrainRestriction[],
): AutoTreeSuppressionResult {
  const autoTreeIndex = buildAutoTreeIndex(constants);
  const attributeIndex = buildAttributeIndex(constants);
  const permittedByRestriction = new Map(terrainRestrictions.map((r) => [r.restrictionId, new Set(r.permittedTerrainIds)]));

  const suppressed = new Set<string>();
  const yieldOverrides = new Map<number, YieldOverride>();
  let note: SimulationNote | undefined;

  for (const commands of instantiated.sections.values()) {
    for (const cmd of commands) {
      if (!isEffectAmount(cmd)) continue;
      const [, targetArg, attributeArg, amountArg] = cmd.args;
      if (!targetArg || !attributeArg || !amountArg) continue;
      if (typeof amountArg.value !== "number") continue; // an unresolved amount cannot move a total, see D10's header

      const attributeId = resolveAttributeId(attributeArg.value, attributeIndex, instantiated.symbols);
      if (attributeId === undefined) continue;

      if (attributeId === attributeIndex.terrainIdAttrId) {
        const permitted = permittedByRestriction.get(amountArg.value);
        const units = resolveTargetUnitIds(targetArg.value, constants, instantiated.symbols, instantiated.aliases);
        for (const unitId of units) {
          const terrains = autoTreeIndex.get(unitId);
          if (terrains) {
            // Only a KNOWN restriction id can suppress — an id our data
            // never measured proves nothing (CLAUDE.md's positive-resolver
            // rule), so it is left alone rather than guessed suppressed.
            if (!permitted) continue;
            for (const terrainId of terrains) {
              if (!permitted.has(terrainId)) suppressed.add(suppressionKey(terrainId, unitId));
            }
          } else if (!note) {
            const unit = objectById(unitId, constants);
            if (unit?.resourceAmounts?.wood) {
              note = {
                key: "forestTreeRetargeted",
                prominence: "drawer",
                stage: "S4",
                text: `This script rewrites where ${unit.rmsConstant ?? "an object"} may stand, which can suppress its automatic forest spawn — the wood total may not reflect that.`,
              };
            }
          }
        }
        continue;
      }

      const slotIndex = attributeIndex.storageSlotByAttrId.get(attributeId);
      if (slotIndex === undefined) continue;
      const units = resolveTargetUnitIds(targetArg.value, constants, instantiated.symbols, instantiated.aliases);
      for (const unitId of units) {
        const unit = objectById(unitId, constants);
        const slot = unit?.resourceStorages?.[slotIndex];
        // No `resource` means the slot holds population or a decay timer,
        // which no resource total this module computes ever reads.
        if (!slot?.resource) continue;
        yieldOverrides.set(unitId, { key: slot.resource, amount: amountArg.value });
      }
    }
  }

  return { suppressed, yieldOverrides, note };
}
