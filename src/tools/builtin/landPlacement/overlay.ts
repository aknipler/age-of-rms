// Sec.3.4 layer 2 / Sec.3.7: Model -> OverlayShape[]. One circle per land at
// base_size, one line per chain link, gizmos (handles) on the selection only.
//
// Positions come from item 2's (emitModel.ts) own `resolved` map, the
// name→value table produced by reading the emitted block back exactly as the
// engine will (Sec.5.5 step 2). Not a parallel geometry routine and not a
// standalone `evalExpr` of the user's DAG: the whole point is that the
// overlay CANNOT disagree with what will be emitted. Re-evaluating a whole
// model this way is cheap, Sec.3.4 measured 0.173 ms for Bulls_Eyes' full
// 143-const table, 97 full re-evaluations inside one 16.7 ms frame, so cost
// is not a reason to shortcut this.
//
// Truncation (over `LIMITS.maxOverlayShapesPerBlock`) is the CALLER's job via
// `overlayShapesToRender` (protocol.ts), already built, and this module
// returns the full, unbounded array so that function has something to
// truncate. See its own doc: "over-budget truncates and says so; it never
// rejects... the count is printed unconditionally, including at zero."

import type { OverlayShape } from "../../../../tools-api/index";
import type { PlacementQuantity } from "./frame";
import type { AlpModel } from "./fence";
import type { RoleConstNames } from "./roleEmit";

export interface OverlayInput {
  model: AlpModel;
  /** item 2's own output, see emitModel.ts's `EmissionOk`. */
  quantities: ReadonlyMap<string, PlacementQuantity>;
  resolved: ReadonlyMap<string, number>;
  roleNamesByPlacement: ReadonlyMap<string, RoleConstNames>;
  /** The current map's side length in tiles (Sec.4.3), post-`override_map_size`, so it comes from the caller, never a constant. */
  mapDim: number;
  /** Sec.3.4 layer 2 / Sec.7.3: gizmos draw only for the selected placement(s). */
  selectedIds?: ReadonlySet<string>;
}

/** Percent-of-map -> tiles, clamped and rounded the same way `land_position` itself resolves (grid.ts's own conversion, the Michi.rms fix). Position only; `base_size` is not a percent quantity (language.json: a plain `integer`), so it is drawn at its resolved value directly, unconverted. */
function percentToTile(pct: number, dim: number): number {
  const raw = Math.round((pct / 100) * dim);
  return Math.max(0, Math.min(dim - 1, raw));
}

interface TilePos {
  x: number;
  y: number;
}

function resolveTile(
  quantity: PlacementQuantity | undefined,
  resolved: ReadonlyMap<string, number>,
  dim: number,
): TilePos | null {
  if (!quantity) return null;
  const xPct = resolved.get(quantity.xName);
  const yPct = resolved.get(quantity.yName);
  if (xPct === undefined || yPct === undefined) return null;
  return { x: percentToTile(xPct, dim), y: percentToTile(yPct, dim) };
}

/**
 * Pure: `(AlpModel, quantities, resolved, mapDim) -> OverlayShape[]`. Draws
 * every placement the model knows about, whether or not it carries a role.
 * A chain anchor with no land of its own still gets its chain-edge lines
 * drawn to and from it, and a `point` rather than a circle (there is no
 * `base_size` to draw). The point used to be missing, which left a
 * points-only shape invisible and a shape's origin point unclickable.
 */
export function buildOverlayShapes(input: OverlayInput): OverlayShape[] {
  const {
    model,
    quantities,
    resolved,
    roleNamesByPlacement,
    mapDim,
    selectedIds,
  } = input;
  const shapes: OverlayShape[] = [];
  const byId = new Map(model.placements.map((p) => [p.id, p] as const));

  for (const placement of model.placements) {
    const pos = resolveTile(quantities.get(placement.id), resolved, mapDim);
    if (!pos) continue; // unresolved, nothing this module can draw honestly

    const roleNames = roleNamesByPlacement.get(placement.id);
    if (roleNames) {
      const baseSize = resolved.get(roleNames.baseSizeName);
      if (baseSize !== undefined) {
        shapes.push({
          id: placement.id,
          kind: "circle",
          x: pos.x,
          y: pos.y,
          rTiles: baseSize,
          role: "primary",
        });
      }
    } else {
      shapes.push({
        id: placement.id,
        kind: "point",
        x: pos.x,
        y: pos.y,
        role: "muted",
      });
    }

    if (placement.parent !== "center") {
      const parentPlacement = byId.get(placement.parent);
      const parentPos = parentPlacement
        ? resolveTile(quantities.get(parentPlacement.id), resolved, mapDim)
        : null;
      if (parentPos) {
        shapes.push({ kind: "line", from: parentPos, to: pos, role: "muted" });
      }
    }

    if (selectedIds?.has(placement.id)) {
      shapes.push({
        id: placement.id,
        kind: "handle",
        x: pos.x,
        y: pos.y,
        role: "secondary",
      });
    }
  }

  return shapes;
}
