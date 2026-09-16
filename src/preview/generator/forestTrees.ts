// Forest-terrain wood: forest terrains (SNOW_FOREST etc.) auto-spawn real,
// choppable trees the instant the engine paints that terrain — no
// create_object involved (docs/build-log.md entry "Status bar: accurate to
// the actual generation, and forest-terrain wood"). Computed as an
// AGGREGATE over the finished terrain grid, not as one synthetic
// PlacedObject per auto-tree: a forested 480x480 map can carry tens of
// thousands of forest tiles, and materialising one object per tile would
// multiply `PreviewResult.objects` by that much on every one of the many
// generations Advanced Tools' Monte Carlo tools already run, and would
// perturb the large body of corpus-pinned object-count figures this
// project's tests and `measure:checker` depend on. Same shape as
// `applyAutomaticBeach` (terrains.ts) — engine behaviour nobody asked for,
// tallied by tile, reported as one number and one SimulationNote, nothing
// placed.
//
// PURITY (CLAUDE.md hard rule, preview-design Sec.2): no React/Monaco/Tauri
// imports, and no RNG — the finished `TileGrid` is itself already the
// product of the seeded run, so this pass is a deterministic O(dim^2) fold.

import type { TileGrid } from "./types";
import { objectById, type ObjectConstant } from "./objects";
import type { YieldOverrideMap } from "./resourceSummary";

/**
 * The narrow terrain-constant slice this file needs, same
 * `TerrainConstantForMasks`-style local-interface convention grid.ts uses
 * ("each consumer states the narrow shape it depends on"), extended with
 * `autoTreeUnits`. Structurally compatible with `ObjectConstant`, the
 * superset `generatePreview()` actually threads through every stage, so no
 * cast is needed at the call site.
 */
export interface ForestTerrainConstant {
  constId: number | null;
  category: string;
  autoTreeUnits?: readonly { objectId: number; density: number }[];
  /** True for the 24 tree-bearing terrains. Read only as the D9 fallback below, when a forest the extraction has not yet reached carries no `autoTreeUnits` of its own. */
  isForest?: boolean;
}

/** Ash's stated foundational default (D9): "100 wood per tree, with 100% density... not stated anywhere because it is so foundational." Used only when a terrain is `isForest: true` but the dat extraction has not (yet) reached it — every terrain this plan shipped carries real `autoTreeUnits` instead. */
const DEFAULT_FOREST_WOOD_PER_TILE = 100;

/**
 * `terrainId:unitId` pairs whose spawn is suppressed on that terrain
 * (`forestTreeSuppression.ts`'s own key shape — re-declared as a bare
 * `ReadonlySet<string>` here rather than importing that module, so this file
 * has no dependency on the scan that produces its input, only on the shape).
 */
export type SuppressedAutoTreeSet = ReadonlySet<string>;

/**
 * Tallies tile counts per terrain id from the finished grid, then for each
 * wood-bearing terrain walks its `autoTreeUnits` slots as the confirmed
 * sequential first-hit-wins cascade (`RMSTEST_65`, `docs/build-log.md`'s
 * "2026-09-02 (seventh pass)" entry): a tile rolls slot 1 first at its own
 * density, and only the tiles that miss are eligible for slot 2, and so on —
 * never a tile carrying every slot's tree at once. A slot's true occupied
 * FRACTION of the terrain's tiles is therefore `density * remaining`, where
 * `remaining` is the fraction not already claimed by an earlier slot in the
 * list, not the slot's raw `density` on its own. A single-slot terrain is
 * unaffected either way (`remaining` starts at 1), which is why this bug sat
 * unnoticed: it only overcounts a terrain whose slot densities don't already
 * sum to 1 on their own, e.g. `SOUTH_AMERICAN_FOREST`'s six slots (2.97),
 * where the old unconditional sum overcounted wood on that terrain by
 * roughly that same factor (`docs/build-log.md`'s 2026-09-02 entry, "One
 * thing found... and deliberately NOT fixed", now closed). A suppressed slot
 * still consumes its own share of `remaining` (the tile is still rolled for
 * that species by the engine; suppression only zeroes what it yields) — it
 * contributes no wood but does not hand its tiles to the next slot either.
 * Multiplied by the terrain's tile count. Single pass over `grid.terrain`.
 *
 * `isForest: true` with NO `autoTreeUnits` (a forest the extraction has not
 * measured) is read as one implicit slot at density 1.0 and 100 wood — Ash's
 * stated foundational default, D9 — so a terrain the data has not reached yet
 * still contributes something rather than silently zero.
 */
export function computeForestWood(
  grid: TileGrid,
  terrainConstants: readonly ForestTerrainConstant[],
  objectConstants: readonly ObjectConstant[],
  suppressed: SuppressedAutoTreeSet,
  yieldOverrides: YieldOverrideMap,
): number {
  const tileCounts = new Map<number, number>();
  for (let i = 0; i < grid.terrain.length; i++) {
    const terrainId = grid.terrain[i];
    tileCounts.set(terrainId, (tileCounts.get(terrainId) ?? 0) + 1);
  }
  if (tileCounts.size === 0) return 0;

  const terrainsById = new Map<number, ForestTerrainConstant>();
  for (const row of terrainConstants) {
    if (row.category === "terrain" && row.constId !== null)
      terrainsById.set(row.constId, row);
  }

  let totalWood = 0;
  for (const [terrainId, tiles] of tileCounts) {
    const row = terrainsById.get(terrainId);
    if (!row?.autoTreeUnits || row.autoTreeUnits.length === 0) {
      if (row?.isForest) totalWood += DEFAULT_FOREST_WOOD_PER_TILE * tiles;
      continue;
    }
    let woodPerTile = 0;
    let remaining = 1;
    for (const slot of row.autoTreeUnits) {
      const frac = slot.density * remaining;
      remaining *= 1 - slot.density;
      if (suppressed.has(`${terrainId}:${slot.objectId}`)) continue;
      const override = yieldOverrides.get(slot.objectId);
      const wood =
        override?.key === "wood"
          ? override.amount
          : objectById(slot.objectId, objectConstants)?.resourceAmounts?.wood;
      if (!wood) continue;
      woodPerTile += frac * wood;
    }
    totalWood += woodPerTile * tiles;
  }
  return totalWood;
}
