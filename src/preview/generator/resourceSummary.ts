// Status-bar resource totals, read off a REAL generation (docs/build-log.md
// entry "Status bar: accurate to the actual generation, and forest-terrain
// wood"). Replaces src/parser/resourceTotals.ts's static AST walk, which
// answered "what could this script produce across every branch" — a
// different question from the one the status bar now answers, "what did
// THIS generation actually produce" (D1, see the plan's own "Menindee" example:
// `number_of_groups 9999` means "fill the map", not "place 9999 trees", and a
// static count reports 9999 while the simulator reports what fits).
//
// PURITY (CLAUDE.md hard rule, preview-design Sec.2): no React/Monaco/Tauri
// imports, so this runs unchanged in the preview worker and in plain Vitest.

import type { PlacedObject, PlayerMarker } from "./types";
import { objectEntry, type ObjectConstant, type ResourceKey } from "./objects";

export type { ResourceKey };

// ---------------------------------------------------------------------------
// Resource vocabulary, moved here from src/parser/resourceTotals.ts (deleted
// once this module and its callers land — see the plan's step 6). Shape
// unchanged: StatusBar.tsx imports ResourceAmounts/ResourceRange directly,
// and formatCompactRange/formatExactRange (statusFormat.ts) already collapse
// a range to one figure when min === max, which Total and Neutral below
// always do now — only Player is a real spread across this generation's
// players (D6), not an uncertainty band.
// ---------------------------------------------------------------------------

export const RESOURCE_KEYS: readonly ResourceKey[] = [
  "food",
  "wood",
  "gold",
  "stone",
];

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

/**
 * D10's per-unit yield override, one entry per unit whose `ATTR_STORAGE_VALUE`
 * (or any future attribute carrying `writesStorageSlot`) a script rewrites.
 * `key` is which of the four resources that unit's slot resolves to (a slot
 * holding population or a decay timer has no `resource` and never produces an
 * entry here — see forestTreeSuppression.ts). Shared between this module and
 * forestTrees.ts's aggregate so the two cannot disagree about what a unit is
 * worth (step 2/step 4 both take the SAME map as a parameter rather than each
 * re-scanning the script).
 */
export interface YieldOverride {
  key: ResourceKey;
  amount: number;
}
export type YieldOverrideMap = ReadonlyMap<number, YieldOverride>;

function zeroAmounts(): ResourceAmounts {
  return { food: 0, wood: 0, gold: 0, stone: 0 };
}

function exactRange(amounts: ResourceAmounts): ResourceRange {
  return { min: amounts, max: amounts };
}

/** The yield a placed instance of this unit actually carries in THIS generation: the override where the script set one, the row's own resourceAmounts otherwise. */
function effectiveAmounts(
  constant: ObjectConstant | undefined,
  overrides: YieldOverrideMap,
): Partial<ResourceAmounts> | undefined {
  if (!constant?.resourceAmounts) return undefined;
  const override =
    typeof constant.constId === "number"
      ? overrides.get(constant.constId)
      : undefined;
  if (!override) return constant.resourceAmounts;
  return { ...constant.resourceAmounts, [override.key]: override.amount };
}

/**
 * One generation's `PlacedObject[]`/`PlayerMarker[]` into a `ResourceTotals`.
 *
 * `forestWood` (step 2's aggregate) folds into `total.wood`/`neutral.wood`
 * (D5: ambient forest trees belong to nobody).
 *
 * `symbols`/`aliases` are passed to `objectEntry` — `balanceSummary.ts:183`
 * omits them, which is a separate, pre-existing defect (D7: out of scope to
 * fix here), not a call site to copy. Passing them resolves e.g. Menindee's
 * `#const TREE_AUTUMN 1248` idiom to a real yield instead of none.
 *
 * D4: player attribution reads the placement's own `obj.player`, set during
 * S6 from `set_place_for_every_player`/`place_on_specific_land_id` — no
 * nearest-player-by-distance fallback (that heuristic is `balanceSummary.ts`'s
 * own, for a different report, and widening scope to add it here was not
 * asked for).
 *
 * D-3 (Ash): the counting pass is shared with what a future Reference Table
 * hookup could reuse — one walk builds a count keyed by (objectRef,
 * owner-bucket), then yield resolution and multiplication happen once PER
 * DISTINCT KEY rather than once per placed object, O(distinct names) instead
 * of O(objects) — up to 20000 per command on a real corpus map.
 */
export function computeResourceSummary(
  objects: readonly PlacedObject[],
  players: readonly PlayerMarker[],
  forestWood: number,
  constants: readonly ObjectConstant[],
  symbols: ReadonlyMap<string, number> | undefined,
  aliases: ReadonlyMap<string, string> | undefined,
  overrides: YieldOverrideMap,
): ResourceTotals {
  // Owner bucket: the player number, or "neutral" for a gaia/unowned placement.
  type OwnerKey = number | "neutral";
  const counts = new Map<
    string,
    { objectRef: string; owner: OwnerKey; count: number }
  >();
  for (const obj of objects) {
    const owner: OwnerKey = obj.player ?? "neutral";
    const key = `${obj.objectRef}::${owner}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { objectRef: obj.objectRef, owner, count: 1 });
  }

  const total = zeroAmounts();
  const neutral = zeroAmounts();
  const perPlayer = new Map<number, ResourceAmounts>();
  const playerOf = (p: number): ResourceAmounts => {
    let amounts = perPlayer.get(p);
    if (!amounts) {
      amounts = zeroAmounts();
      perPlayer.set(p, amounts);
    }
    return amounts;
  };
  // Every player this generation actually placed a land for gets a bucket,
  // even one that ends up at zero — D6's spread has to include a player who
  // got NOTHING, not only players who received something.
  for (const p of players) playerOf(p.player);

  for (const { objectRef, owner, count } of counts.values()) {
    const constant = objectEntry(objectRef, constants, symbols, aliases);
    const amounts = effectiveAmounts(constant, overrides);
    if (!amounts) continue;
    const bucket = owner === "neutral" ? neutral : playerOf(owner);
    for (const key of RESOURCE_KEYS) {
      const value = amounts[key];
      if (!value) continue;
      const contribution = value * count;
      total[key] += contribution;
      bucket[key] += contribution;
    }
  }

  total.wood += forestWood;
  neutral.wood += forestWood;

  const playerAmounts = [...perPlayer.values()];
  const player: ResourceRange =
    playerAmounts.length === 0
      ? exactRange(zeroAmounts())
      : {
          min: RESOURCE_KEYS.reduce(
            (acc, key) => ({
              ...acc,
              [key]: Math.min(...playerAmounts.map((a) => a[key])),
            }),
            zeroAmounts(),
          ),
          max: RESOURCE_KEYS.reduce(
            (acc, key) => ({
              ...acc,
              [key]: Math.max(...playerAmounts.map((a) => a[key])),
            }),
            zeroAmounts(),
          ),
        };

  return { total: exactRange(total), player, neutral: exactRange(neutral) };
}
