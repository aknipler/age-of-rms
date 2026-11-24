import { useEffect, useMemo, useState } from "react";
import { unpackDeObjects } from "../../preview/generator/deObjectsWire";
import type {
  PreviewWireResult,
  StageSnapshot,
} from "../../preview/generator/types";
import {
  buildMinimapLayer,
  type MinimapLayer,
  type MinimapObjectRow,
} from "../../preview/render/minimapLayer";

// The minimap view's layer for one canvas (minimapLayer.ts). A hook of its
// own, the same shape as useDeSprites: it loads the dat's object rows on
// first use and builds the layer once per map, never per frame.

/**
 * The object rows, loaded once per session on first use. A dynamic import,
 * so the flat view never downloads them, and the bundler shares the chunk
 * with useDeSprites, which imports the same file.
 */
let rowsPromise: Promise<Map<number, MinimapObjectRow>> | undefined;
function loadRows(): Promise<Map<number, MinimapObjectRow>> {
  rowsPromise ??= import("../../../reference/data/object-data.json").then(
    (module) => {
      const objects = (
        module.default as unknown as {
          objects: ({ id: number } & MinimapObjectRow)[];
        }
      ).objects;
      return new Map(objects.map((o) => [o.id, o]));
    },
  );
  return rowsPromise;
}

export function useMinimapLayer(
  enabled: boolean,
  result: PreviewWireResult | undefined,
  snapshot: StageSnapshot | undefined,
): MinimapLayer | undefined {
  const [rows, setRows] = useState<Map<number, MinimapObjectRow> | null>(null);
  useEffect(() => {
    if (!enabled || rows !== null) return;
    let cancelled = false;
    void loadRows().then((loaded) => {
      if (!cancelled) setRows(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, rows]);

  const packed = result?.deObjectsPacked;
  return useMemo(() => {
    if (!enabled || rows === null || packed === undefined || !snapshot)
      return undefined;
    return buildMinimapLayer(unpackDeObjects(packed), rows, snapshot);
  }, [enabled, rows, packed, snapshot]);
}
