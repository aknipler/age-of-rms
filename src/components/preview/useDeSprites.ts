import { useEffect, useMemo, useState } from "react";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import { unpackDeObjects } from "../../preview/generator/deObjectsWire";
import type { PreviewWireResult } from "../../preview/generator/types";
import { loadSpriteImages } from "../../preview/render/deSpriteSource";
import type { SpriteLayer } from "../../preview/render/drawPreview";
import {
  planSprites,
  sortSprites,
  spriteKey,
  type SpriteImage,
  type SpriteRow,
  type SpriteTables,
} from "../../preview/render/objectSprites";

// The textured view's object sprites for one canvas
// (docs/preview-de-textures-design.md Sec.12). A custom hook rather than more
// state in OverlayCanvas, since it owns its own loading, the same shape as
// the textures' loading there, and OverlayCanvas only needs its result.

/** The dat's class for trees. Small Trees shrinks only these. */
const TREE_CLASS = 15;

/**
 * How big a tree draws with DE's Small Trees option on, measured against the
 * game (Sec.12.4).
 */
export const SMALL_TREE_SCALE = 0.5;

interface Tables extends SpriteTables {
  classOf: ReadonlyMap<number, number>;
}

/**
 * Loaded once per session on first use. A dynamic import, so the two tables
 * (some megabytes between them) are a chunk of their own that the flat view
 * never downloads. A module level promise, like the textures' cache, since
 * both canvases share it.
 */
let tablesPromise: Promise<Tables> | undefined;
function loadTables(): Promise<Tables> {
  tablesPromise ??= Promise.all([
    import("../../../reference/data/object-sprites.json"),
    import("../../../reference/data/object-data.json"),
  ]).then(([spritesModule, objectsModule]) => {
    const spriteRows = (
      spritesModule.default as unknown as { sprites: Record<string, SpriteRow> }
    ).sprites;
    const objectRows = (
      objectsModule.default as unknown as {
        objects: {
          id: number;
          g?: number;
          cls: number;
          ann?: [number, number, number][];
        }[];
      }
    ).objects;
    const sprites = new Map<number, SpriteRow>();
    for (const [id, row] of Object.entries(spriteRows))
      sprites.set(Number(id), row);
    const standing = new Map<number, number>();
    const classOf = new Map<number, number>();
    const annexes = new Map<number, [number, number, number][]>();
    for (const o of objectRows) {
      if (o.g !== undefined) standing.set(o.id, o.g);
      classOf.set(o.id, o.cls);
      if (o.ann !== undefined) annexes.set(o.id, o.ann);
    }
    return { sprites, standing, classOf, annexes };
  });
  return tablesPromise;
}

/** Object ids by every name the hidden set may use for them. */
const IDS_BY_NAME = (() => {
  const rows = (
    gameConstantsRaw as unknown as {
      constants: {
        category: string;
        constId: number | null;
        rmsConstant?: string | null;
      }[];
    }
  ).constants;
  const byName = new Map<string, number[]>();
  for (const r of rows) {
    if (r.category !== "object" || r.constId === null || !r.rmsConstant)
      continue;
    const list = byName.get(r.rmsConstant) ?? [];
    list.push(r.constId);
    byName.set(r.rmsConstant, list);
  }
  return byName;
})();

export function useDeSprites(
  enabled: boolean,
  result: PreviewWireResult | undefined,
  hiddenObjects: ReadonlySet<string> | undefined,
  smallTrees: boolean,
): SpriteLayer | undefined {
  const [tables, setTables] = useState<Tables | null>(null);
  useEffect(() => {
    if (!enabled || tables !== null) return;
    let cancelled = false;
    void loadTables().then((loaded) => {
      if (!cancelled) setTables(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, tables]);

  // Unpacked once per map, and only with sprites on. The worker sends them
  // packed (deObjectsWire.ts), so the flat view never pays for them.
  const packed = result?.deObjectsPacked;
  const deObjects = useMemo(
    () =>
      enabled && packed !== undefined ? unpackDeObjects(packed) : undefined,
    [enabled, packed],
  );
  // The script's own standing graphics, as maps, once per result.
  const standingGraphics = result?.standingGraphics;
  const graphicOverrides = useMemo(
    () =>
      standingGraphics === undefined
        ? undefined
        : {
            gaia: new Map(standingGraphics.gaia),
            player: new Map(standingGraphics.player),
          },
    [standingGraphics],
  );
  // Planned and sorted once per map, never per frame.
  const plannedSprites = useMemo(() => {
    if (!enabled || !tables || !deObjects) return null;
    const unknown = new Set<number>();
    const parts = sortSprites(
      planSprites(deObjects, { ...tables, graphicOverrides }, unknown),
    );
    return { parts, unknown };
  }, [enabled, tables, deObjects, graphicOverrides]);
  const parts = plannedSprites?.parts ?? null;

  // A string key, for the reason OverlayCanvas's texture key gives.
  const wantedKey = useMemo(() => {
    if (parts === null) return "";
    const keys = new Set<string>();
    for (const p of parts) keys.add(spriteKey(p.file, p.frame, p.owner));
    return [...keys].sort().join("\n");
  }, [parts]);

  const [images, setImages] = useState<{
    key: string;
    images: Map<string, SpriteImage>;
  } | null>(null);
  useEffect(() => {
    if (!enabled || wantedKey === "") return;
    let cancelled = false;
    const wanted = wantedKey.split("\n").map((key) => {
      const [file, frame, owner] = key.split("#");
      return { file, frame: Number(frame), owner: Number(owner) };
    });
    void loadSpriteImages(wanted).then((loaded) => {
      if (!cancelled) setImages({ key: wantedKey, images: loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, wantedKey]);

  const hiddenIds = useMemo(() => {
    if (hiddenObjects === undefined || hiddenObjects.size === 0)
      return undefined;
    const ids = new Set<number>();
    for (const name of hiddenObjects)
      for (const id of IDS_BY_NAME.get(name) ?? []) ids.add(id);
    for (const kind of result?.terrainObjects?.kinds ?? [])
      if (hiddenObjects.has(kind.objectRef)) ids.add(kind.id);
    return ids;
  }, [hiddenObjects, result]);

  return useMemo(() => {
    if (
      !enabled ||
      parts === null ||
      tables === null ||
      deObjects === undefined
    )
      return undefined;
    if (images === null || images.key !== wantedKey) return undefined;
    // An object with a picture that did not load keeps its glyph, so a
    // missing install file never hides an object silently. An object the
    // dat gives no picture at all, such as an invisible marker, draws
    // nothing, as in game.
    const planned = new Set<number>();
    const drawn = new Set<number>();
    const unknownGraphic = plannedSprites?.unknown ?? new Set<number>();
    for (const p of parts) {
      planned.add(p.objectId);
      if (images.images.has(spriteKey(p.file, p.frame, p.owner)))
        drawn.add(p.objectId);
    }
    const categoryOf = new Map<number, string>();
    for (const kind of result?.terrainObjects?.kinds ?? [])
      categoryOf.set(kind.id, kind.category);
    const glyphs = deObjects
      .filter(
        (o) =>
          o.status !== 0 &&
          ((planned.has(o.id) && !drawn.has(o.id)) ||
            unknownGraphic.has(o.id)) &&
          !(hiddenIds?.has(o.id) ?? false),
      )
      .map((o) => ({
        x: o.x,
        y: o.y,
        category: categoryOf.get(o.id) ?? "unit",
      }));
    const classOf = tables.classOf;
    return {
      parts,
      images: images.images,
      hiddenIds,
      scaleOf: smallTrees
        ? (id: number) =>
            classOf.get(id) === TREE_CLASS ? SMALL_TREE_SCALE : 1
        : undefined,
      glyphs,
    };
  }, [
    enabled,
    parts,
    tables,
    deObjects,
    images,
    wantedKey,
    hiddenIds,
    smallTrees,
    plannedSprites,
    result,
  ]);
}
