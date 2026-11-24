import type { DeObjectRecord } from "../generator/types";

// Which sprite, and which frame of it, each object of a map is drawn with in
// the textured view (docs/preview-de-textures-design.md Sec.12). Pure, so the
// choice of frame is tested in Node. The pictures themselves are decoded on
// the main thread by deSpriteSource.ts.
//
// An object stands as a graphic. A graphic is an SLD file holding `angles`
// drawings of `frames` frames each, and may stack other graphics on itself
// (its deltas). The generator already stores what DE saves for each object,
// the facet a tree or a mine was given and the angle and start frame of a
// unit, so the frame drawn is the frame DE draws.

/** A graphic as `reference/data/object-sprites.json` stores it. */
export type SpriteRow = [
  file: string,
  frames: number,
  angles: number,
  mirroring: number,
  layer: number,
  deltas: [graphic: number, x: number, y: number][],
];

export interface SpriteTables {
  /** Object id to the graphic it stands as (object-data.json's `g`). */
  standing: ReadonlyMap<number, number>;
  /** Graphic id to its row. */
  sprites: ReadonlyMap<number, SpriteRow>;
  /**
   * Object id to its annexes (object-data.json's `ann`), each an object id
   * and its offset in tiles. A town centre is four objects in game, its back
   * piece and three annexes the game adds around it, and the saved map holds
   * only the first, as `deObjects` does.
   */
  annexes?: ReadonlyMap<number, readonly (readonly [number, number, number])[]>;
  /**
   * Graphics the script set with `ATTR_STANDING_GRAPHIC`
   * (`PreviewResult.standingGraphics`), by object id, Gaia's apart from the
   * players'. They win over `standing`.
   */
  graphicOverrides?: {
    gaia: ReadonlyMap<number, number>;
    player: ReadonlyMap<number, number>;
  };
}

/** One picture to draw, a whole object or one of its parts. */
export interface SpritePart {
  /** SLD base name in drs/graphics. */
  file: string;
  /** Frame index in the file. */
  frame: number;
  /** Drawn flipped left to right, for an angle stored as its mirror. */
  mirrored: boolean;
  /** The object's position in tiles. */
  x: number;
  y: number;
  /** Offset from the object's position in sprite pixels, from the graphic's deltas. */
  dx: number;
  dy: number;
  /** The graphic's draw layer. Lower layers draw first. */
  layer: number;
  /** Owning player, 0 for Gaia. Picks the player colour. */
  owner: number;
  /** The object, for the hidden set and the readout. */
  objectId: number;
}

/** One frame ready to draw, its pictures placed relative to the hotspot. */
export interface SpriteImage {
  image: ImageBitmap | null;
  /** Top left of `image` from the hotspot, in sprite pixels. */
  x: number;
  y: number;
  shadow: ImageBitmap | null;
  shadowX: number;
  shadowY: number;
}

/** The key a decoded frame is stored under, per file, frame and owner. */
export function spriteKey(file: string, frame: number, owner: number): string {
  return `${file.toLowerCase()}#${frame}#${owner}`;
}

const TWO_PI = Math.PI * 2;

/**
 * The frame of `row` an object shows. An unanimated graphic's angles are its
 * variants, and the object's stored frame names one (a tree's facet, a
 * cliff's face). An animated one turns to the object's rotation, in radians,
 * and starts at its stored frame. Graphics with mirroring store only the
 * first half of their angles plus one, and draw the rest flipped.
 */
export function spriteFrame(
  row: SpriteRow,
  rotation: number,
  frame: number,
): { frame: number; mirrored: boolean } {
  const frames = Math.max(1, row[1]);
  const angles = Math.max(1, row[2]);
  let angle: number;
  let within: number;
  if (frames === 1) {
    angle = ((frame % angles) + angles) % angles;
    within = 0;
  } else {
    // A whole number rotation is a stored facet, not radians. The object
    // turned to no angle, so it faces angle 0.
    angle = Number.isInteger(rotation)
      ? 0
      : Math.round(rotation / (TWO_PI / angles)) % angles;
    within = ((frame % frames) + frames) % frames;
  }
  let mirrored = false;
  if (row[3] !== 0) {
    const stored = Math.floor(angles / 2) + 1;
    if (angle >= stored) {
      angle = angles - angle;
      mirrored = true;
    }
  }
  return { frame: angle * frames + within, mirrored };
}

/** How deep deltas may nest. The dat's go two levels at most. */
const MAX_DELTA_DEPTH = 3;

/** How deep annexes may nest. The dat's annexes have none of their own. */
const MAX_ANNEX_DEPTH = 2;

/**
 * Every sprite part of every object, unsorted. An object whose graphic has
 * no picture, or that the game saves as hidden (status 0), draws nothing.
 * An object the script gave a graphic missing from the table is added to
 * `unknown`, so the caller can mark it instead of drawing nothing.
 */
export function planSprites(
  objects: readonly DeObjectRecord[],
  tables: SpriteTables,
  unknown?: Set<number>,
): SpritePart[] {
  const parts: SpritePart[] = [];
  const addGraphic = (
    o: Pick<DeObjectRecord, "x" | "y" | "rotation" | "frame" | "owner"> & {
      id: number;
    },
    graphic: number,
    dx: number,
    dy: number,
    depth: number,
  ): void => {
    const row = tables.sprites.get(graphic);
    if (row === undefined || depth > MAX_DELTA_DEPTH) return;
    const deltas = row[5];
    const drawSelf = (sx: number, sy: number): void => {
      if (row[0] === "") return;
      const { frame, mirrored } = spriteFrame(row, o.rotation, o.frame);
      parts.push({
        file: row[0],
        frame,
        mirrored,
        x: o.x,
        y: o.y,
        dx: sx,
        dy: sy,
        layer: row[4],
        owner: o.owner,
        objectId: o.id,
      });
    };
    if (deltas.length === 0) {
      drawSelf(dx, dy);
      return;
    }
    for (const [sub, ox, oy] of deltas) {
      if (sub < 0) drawSelf(dx + ox, dy + oy);
      else addGraphic(o, sub, dx + ox, dy + oy, depth + 1);
    }
  };
  // An annex draws as its own object at its own position, so it sorts by
  // its own depth as the game's does, but keeps the parent's id, so hiding a
  // town centre in the Obj. List hides all of it.
  const addObject = (
    o: DeObjectRecord,
    id: number,
    x: number,
    y: number,
    depth: number,
  ): void => {
    const scope = o.owner === 0 ? "gaia" : "player";
    const set = tables.graphicOverrides?.[scope].get(id);
    // A graphic the table lacks would otherwise draw nothing, as if the
    // object had no picture in the dat.
    if (set !== undefined && !tables.sprites.has(set)) unknown?.add(o.id);
    const graphic = set ?? tables.standing.get(id);
    if (graphic !== undefined)
      addGraphic({ ...o, id: o.id, x, y }, graphic, 0, 0, 0);
    if (depth >= MAX_ANNEX_DEPTH) return;
    for (const [annex, ox, oy] of tables.annexes?.get(id) ?? [])
      addObject(o, annex, x + ox, y + oy, depth + 1);
  };
  for (const o of objects) {
    if (o.status === 0) continue;
    addObject(o, o.id, o.x, o.y, 0);
  }
  return parts;
}

/**
 * Draw order. Lower layers first, then from the back of the screen to the
 * front. Screen y grows with tile y - x (projection.ts), so that is the depth,
 * and ties go left to right. Parts of one object keep their delta order.
 */
export function sortSprites(parts: SpritePart[]): SpritePart[] {
  return parts
    .map((part, index) => ({ part, index }))
    .sort(
      (a, b) =>
        a.part.layer - b.part.layer ||
        a.part.y - a.part.x - (b.part.y - b.part.x) ||
        a.part.x + a.part.y - (b.part.x + b.part.y) ||
        a.index - b.index,
    )
    .map(({ part }) => part);
}
