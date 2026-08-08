import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlacedObject, PreviewResult, StageSnapshot } from "../../preview/generator/types";
import { NO_LAYER } from "../../preview/generator/grid";
import { createBitmapCanvas, drawPreview } from "../../preview/render/drawPreview";
import { buildTerrainBitmap } from "../../preview/render/terrainBitmap";
import type { TerrainPalette } from "../../preview/render/palette";
import {
  clampToCanvas,
  fitViewport,
  isOnMap,
  panBy,
  screenToTile,
  zoomAt,
  type TilePoint,
} from "../../preview/render/projection";
import { HelpTip } from "../HelpTip";
import { usePreviewViewport } from "./PreviewViewContext";
import styles from "./PreviewCanvas.module.css";

const ZOOM_STEP = 1.18;

/** Shared empty array for tiles with nothing on them — a fresh `[]` per hover would make every readout a new object and re-render for no change. */
const EMPTY_OBJECTS: readonly PlacedObject[] = [];

export interface HoveredTile {
  x: number;
  y: number;
  terrain: number;
  terrainName: string | null;
  elevation: number;
  cliff: boolean;
  /** The visual mask on this tile (`base_layer` / `terrain_mask`), or null when nothing is layered. */
  layerName: string | null;
  layer: number | null;
  /** Everything S6 placed on this exact tile, in placement order. Usually empty; more than one only where `force_placement` let objects stack. */
  objects: readonly PlacedObject[];
}

interface PreviewCanvasProps {
  result: PreviewResult;
  snapshot: StageSnapshot;
  palette: TerrainPalette;
  onHoverTile: (tile: HoveredTile | null) => void;
}

export function PreviewCanvas({ result, snapshot, palette, onHoverTile }: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Held above the tab switch (PreviewViewContext.tsx) so zoom/pan survive
  // Breakdown <-> Code instead of resetting to "fit" on every remount.
  const {
    viewport,
    setViewport,
    userFramed: persistedUserFramed,
    setUserFramed: setPersistedUserFramed,
  } = usePreviewViewport();
  const [highlight, setHighlight] = useState<TilePoint | null>(null);

  // True once the user has zoomed or panned. Until then the view refits
  // itself on resize and on a new result, which is what you want while the
  // pane is settling; afterwards refitting would throw away their framing on
  // every re-roll. A ref rather than state because nothing renders from it —
  // writing it must not schedule a render, and the ResizeObserver/
  // snapshot-change effects below read it from inside closures that don't
  // list it as a dependency, so they need an always-current value rather than
  // one captured at effect-creation time.
  //
  // Seeded from the persisted flag (so a remount after a tab switch starts
  // already-framed instead of re-fitting), and every write goes through
  // markUserFramed so the NEXT remount seeds correctly too — the ref is the
  // fast synchronous copy, the context value is the one that survives.
  const userFramedRef = useRef(persistedUserFramed);

  const markUserFramed = useCallback(() => {
    userFramedRef.current = true;
    setPersistedUserFramed(true);
  }, [setPersistedUserFramed]);

  // The terrain bitmap is the expensive part (one pass over dim^2 tiles), so
  // it is rebuilt only when the grid or the palette changes — NOT per frame
  // and not on zoom. Panning and zooming re-draw the same bitmap under a
  // different transform, which is the whole reason drawPreview works this way.
  const terrain = useMemo(
    () => createBitmapCanvas(buildTerrainBitmap(snapshot, palette)),
    [snapshot, palette],
  );

  // Objects indexed by tile, for the hover readout. Built once per result
  // rather than filtering `result.objects` on every pointer move: a map can
  // carry tens of thousands of objects and the pointer fires continuously,
  // so the scan would be O(objects) per mouse event.
  const objectsByTile = useMemo(() => {
    const index = new Map<number, PlacedObject[]>();
    for (const object of result.objects) {
      const key = object.y * snapshot.dim + object.x;
      const bucket = index.get(key);
      if (bucket) bucket.push(object);
      else index.set(key, [object]);
    }
    return index;
  }, [result.objects, snapshot.dim]);

  // --- Sizing -------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      setViewport((previous) => {
        if (previous === null || !userFramedRef.current) {
          return fitViewport(snapshot.dim, clientWidth, clientHeight);
        }
        // Keep the user's zoom, just let the canvas change shape under it.
        return { ...previous, width: clientWidth, height: clientHeight };
      });
    });
    observer.observe(container);
    // Cleanup runs on unmount AND before every re-run of this effect. Without
    // it a StrictMode double-invoke in development leaves two observers alive
    // on the same node.
    return () => observer.disconnect();
    // setViewport is a useState setter reached through usePreviewViewport(),
    // so React's stable-identity guarantee still holds (it's the same
    // function every render) even though the lint rule can't see through the
    // context indirection to know that statically.
  }, [snapshot.dim, setViewport]);

  // A new map (re-roll, or a different size) refits unless the user has
  // framed the view themselves.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || userFramedRef.current) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    setViewport(fitViewport(snapshot.dim, container.clientWidth, container.clientHeight));
  }, [snapshot, setViewport]);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    userFramedRef.current = false;
    setPersistedUserFramed(false);
    setViewport(fitViewport(snapshot.dim, container.clientWidth, container.clientHeight));
  }, [snapshot.dim, setPersistedUserFramed, setViewport]);

  // --- Drawing ------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || viewport === null) return;
    const ratio = window.devicePixelRatio || 1;
    // Two different sizes on one element: the backing store in device pixels
    // (so the drawing is sharp on a high-DPI screen) and the CSS box in
    // layout pixels. Setting only one of them is the classic blurry-canvas
    // bug.
    const backingWidth = Math.max(1, Math.round(viewport.width * ratio));
    const backingHeight = Math.max(1, Math.round(viewport.height * ratio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    // The base transform: everything downstream then works in CSS pixels and
    // drawPreview composes its projection on top with `transform`.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPreview(ctx, viewport, { result, snapshot, terrain, highlight });
  }, [viewport, result, snapshot, terrain, highlight]);

  // --- Zoom ---------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (event: WheelEvent) => {
      // Registered by hand rather than with React's onWheel because the
      // listener has to be non-passive: a passive listener cannot call
      // preventDefault, and without that the wheel scrolls the side panel
      // instead of zooming the map.
      event.preventDefault();
      markUserFramed();
      const rect = canvas.getBoundingClientRect();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setViewport((previous) =>
        previous === null
          ? previous
          : zoomAt(previous, factor, event.clientX - rect.left, event.clientY - rect.top),
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [markUserFramed, setViewport]);

  // --- Pan and hover ------------------------------------------------------

  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const readTile = useCallback(
    (clientX: number, clientY: number): { point: TilePoint; hovered: HoveredTile } | null => {
      const canvas = canvasRef.current;
      if (canvas === null || viewport === null) return null;
      const rect = canvas.getBoundingClientRect();
      const point = screenToTile(viewport, clientX - rect.left, clientY - rect.top);
      if (!isOnMap(point, snapshot.dim)) return null;
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      const index = y * snapshot.dim + x;
      return {
        point: { x, y },
        hovered: {
          x,
          y,
          terrain: snapshot.terrain[index],
          terrainName: palette.nameFor(snapshot.terrain[index]),
          layer: snapshot.layer[index] === NO_LAYER ? null : snapshot.layer[index],
          layerName: snapshot.layer[index] === NO_LAYER ? null : palette.nameFor(snapshot.layer[index]),
          elevation: snapshot.elevation[index],
          cliff: snapshot.cliff[index] !== 0,
          objects: objectsByTile.get(index) ?? EMPTY_OBJECTS,
        },
      };
    },
    [viewport, snapshot, palette, objectsByTile],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      markUserFramed();
      setViewport((previous) =>
        previous === null ? previous : clampToCanvas(panBy(previous, dx, dy), snapshot.dim),
      );
      return;
    }
    const read = readTile(event.clientX, event.clientY);
    setHighlight(read?.point ?? null);
    onHoverTile(read?.hovered ?? null);
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  };

  const onPointerLeave = () => {
    setHighlight(null);
    onHoverTile(null);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <HelpTip id="preview.canvas">
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: "100%", height: "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave}
          onDoubleClick={resetView}
        />
      </HelpTip>
      <div className={styles.overlay}>
        <HelpTip id="preview.approximateBadge">
          <span className={styles.badge}>≈ Approximate preview</span>
        </HelpTip>
        {result.notes
          .filter((note) => note.prominence === "banner")
          .map((note) => (
            <span key={note.key} className={styles.banner}>
              {note.text}
            </span>
          ))}
      </div>
      <div className={styles.zoomControls}>
        <HelpTip id="preview.zoomOut">
          <button
            type="button"
            className={styles.zoomButton}
            aria-label="Zoom out"
            onClick={() => {
              markUserFramed();
              setViewport((previous) =>
                previous === null
                  ? previous
                  : zoomAt(previous, 1 / ZOOM_STEP, previous.width / 2, previous.height / 2),
              );
            }}
          >
            −
          </button>
        </HelpTip>
        <HelpTip id="preview.zoomFit">
          <button type="button" className={styles.zoomButton} aria-label="Fit map" onClick={resetView}>
            ⤢
          </button>
        </HelpTip>
        <HelpTip id="preview.zoomIn">
          <button
            type="button"
            className={styles.zoomButton}
            aria-label="Zoom in"
            onClick={() => {
              markUserFramed();
              setViewport((previous) =>
                previous === null
                  ? previous
                  : zoomAt(previous, ZOOM_STEP, previous.width / 2, previous.height / 2),
              );
            }}
          >
            +
          </button>
        </HelpTip>
      </div>
    </div>
  );
}
