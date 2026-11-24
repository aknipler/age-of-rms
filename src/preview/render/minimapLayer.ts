import type { DeObjectRecord, StageSnapshot } from "../generator/types";
import { categoryColor, cssColor, playerColor } from "./palette";
import { latticeToScreen, type Viewport } from "./projection";

// The minimap view (the minimap colour button). The map as the game's own
// minimap shows it: terrain in the minimap colours, cliffs in one dark brown,
// trees filling their whole tile, and only the objects a player reads a
// minimap for, as squares. Resources, relics and players' objects. Everything
// else (decorations, Gaia objects that are not resources) is left out. Pure
// apart from the drawing at the end, so the choice of what shows is tested
// in Node.

/** The colours the owner set for this view, 2026-11-25. */
export const MINIMAP_COLOURS = {
  cliff: "#7E3F32",
  food: "#9FD994",
  stone: "#776363",
  fish: "#75B7AA",
  relic: "#FFFFFF",
  // Not given. The preview's own gold and wood colours, so the view still
  // tells them apart from stone and grass.
  gold: cssColor(categoryColor("resource-gold")),
  tree: cssColor(categoryColor("resource-wood")),
} as const;

/** The dat fields the choice reads, from object-data.json. */
export interface MinimapObjectRow {
  /** The dat's class. */
  cls: number;
  /** First resource slot, type and amount. */
  res?: readonly [number, number];
  /** Collision half size in tiles, x and y. */
  c?: readonly [number, number];
}

/** The dat's resource types the first slot holds. */
const FOOD = 0;
const WOOD = 1;
const STONE = 2;
const GOLD = 3;
const FISH_FOOD = 17;
/** The dat's class for trees, for relics, and for deep water fish. */
const TREE_CLASS = 15;
const RELIC_CLASS = 42;
const OCEAN_FISH_CLASS = 5;

/**
 * How many times its footprint a square is drawn across, on the owner's
 * request (2026-11-25), so lone objects read at a glance. Deep water fish
 * come in schools and would merge into a block at the full size, so they
 * take half as much again. Shore fish (their own class) keep the full size.
 */
export const SQUARE_SCALE = 3;
export const OCEAN_FISH_SCALE = 1.5;

export type MinimapKind =
  "tree" | "gold" | "stone" | "food" | "fish" | "relic" | "player";

/**
 * What an object shows as, or null for nothing. A resource shows as its
 * resource whoever owns it, so a player's starting sheep reads as food, as in
 * game. A resource slot holding nothing (a wolf's 0 food) is not a resource.
 */
export function minimapKind(
  row: MinimapObjectRow | undefined,
  owner: number,
): MinimapKind | null {
  if (row !== undefined) {
    if (row.cls === RELIC_CLASS) return "relic";
    const [type, amount] = row.res ?? [-1, 0];
    if (amount > 0) {
      if (type === WOOD && row.cls === TREE_CLASS) return "tree";
      if (type === GOLD) return "gold";
      if (type === STONE) return "stone";
      if (type === FISH_FOOD) return "fish";
      if (type === FOOD) return "food";
    }
  }
  return owner > 0 ? "player" : null;
}

/**
 * Draw order of the squares, lowest first, so a higher one lands on top
 * where two overlap: players' objects over gold over stone over the rest.
 */
const PRIORITY: Record<Exclude<MinimapKind, "tree">, number> = {
  food: 0,
  fish: 0,
  relic: 0,
  stone: 1,
  gold: 2,
  player: 3,
};

/** What the view draws, grouped by colour so each colour fills once. */
export interface MinimapLayer {
  /** Whole tiles by colour, as tile x, y pairs. Trees and cliffs. */
  tiles: Map<string, number[]>;
  /**
   * Squares by colour, as centre x, centre y (tiles) and side (tile half
   * widths) triples, the side already scaled. In draw order: a Map iterates
   * in the order its keys were first set, which buildMinimapLayer uses to
   * put the higher priorities last.
   */
  squares: Map<string, number[]>;
}

export function buildMinimapLayer(
  objects: readonly DeObjectRecord[],
  rows: ReadonlyMap<number, MinimapObjectRow>,
  snapshot: Pick<StageSnapshot, "dim" | "cliff">,
): MinimapLayer {
  const tiles = new Map<string, number[]>();
  // One map per priority, merged in order at the end.
  const byPriority = [0, 1, 2, 3].map(() => new Map<string, number[]>());
  const push = (map: Map<string, number[]>, colour: string, ...v: number[]) => {
    let list = map.get(colour);
    if (list === undefined) map.set(colour, (list = []));
    list.push(...v);
  };
  const { dim, cliff } = snapshot;
  for (let i = 0; i < dim * dim; i++)
    if (cliff[i] !== 0)
      push(tiles, MINIMAP_COLOURS.cliff, i % dim, Math.floor(i / dim));
  for (const o of objects) {
    if (o.status === 0) continue;
    const row = rows.get(o.id);
    const kind = minimapKind(row, o.owner);
    if (kind === null) continue;
    if (kind === "tree") {
      push(tiles, MINIMAP_COLOURS.tree, Math.floor(o.x), Math.floor(o.y));
      continue;
    }
    const colour =
      kind === "player"
        ? cssColor(playerColor(o.owner))
        : MINIMAP_COLOURS[kind];
    // A building's footprint, anything smaller one tile, then scaled.
    const footprint = Math.max(
      1,
      2 * Math.max(row?.c?.[0] ?? 0, row?.c?.[1] ?? 0),
    );
    const scale =
      kind === "fish" && row?.cls === OCEAN_FISH_CLASS
        ? OCEAN_FISH_SCALE
        : SQUARE_SCALE;
    push(byPriority[PRIORITY[kind]], colour, o.x, o.y, footprint * scale);
  }
  const squares = new Map<string, number[]>();
  for (const group of byPriority)
    for (const [colour, list] of group) squares.set(colour, list);
  return { tiles, squares };
}

/**
 * Draws the layer. Tiles as their diamonds, squares upright on the screen
 * with the side the layer gives (its footprint times `SQUARE_SCALE`, in tile
 * half widths), at least 4 pixels so a lone deer still shows zoomed out, in
 * the layer's priority order. One path and one fill per
 * colour, as drawTerrainObjects does, since a forest is thousands of tiles.
 */
export function drawMinimapLayer(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  layer: MinimapLayer,
): void {
  for (const [colour, list] of layer.tiles) {
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 2) {
      const x = list[i];
      const y = list[i + 1];
      const a = latticeToScreen(viewport, x, y);
      const b = latticeToScreen(viewport, x + 1, y);
      const c = latticeToScreen(viewport, x + 1, y + 1);
      const d = latticeToScreen(viewport, x, y + 1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }
  for (const [colour, list] of layer.squares) {
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 3) {
      const p = latticeToScreen(viewport, list[i], list[i + 1]);
      const side = Math.max(4, list[i + 2] * viewport.halfWidth);
      ctx.rect(p.x - side / 2, p.y - side / 2, side, side);
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }
}
