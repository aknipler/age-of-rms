import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { OverlayShape } from "../../../tools-api/index";
import type { PreviewWireResult, StageSnapshot } from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";
import { createBitmapCanvas, drawPreview } from "../../preview/render/drawPreview";
import { buildTerrainBitmap } from "../../preview/render/terrainBitmap";
import {
  clampToCanvas,
  fitViewport,
  isOnMap,
  panBy,
  screenToTile,
  tileToPercent,
  zoomAt,
  type TilePoint,
  type Viewport,
} from "../../preview/render/projection";
import { HelpTip } from "../HelpTip";
import styles from "./PreviewCanvas.module.css";

const ZOOM_STEP = 1.18;

/**
 * How far the pointer may travel between press and release and still count as
 * a click rather than a pan. Zero would make selection nearly impossible,
 * since a mouse almost always moves a pixel or two during a click, and a
 * large value would select a tile at the end of a deliberate short drag.
 */
const CLICK_SLOP_PX = 4;

/**
 * The projection/viewport/hit-test core shared by both the app's map preview
 * (`PreviewCanvas`, now a thin wrapper) and any panel that draws on this same
 * surface (Land Placement's canvas, slice-4b item 4). Extracted per
 * land-placement-design.md Sec.3.4/§1.1's answer (option (a), "one shared
 * overlay canvas") and slice-4-brief §4 item 2.
 *
 * Rev 1 of that brief priced this extraction at "untangle 352 coupled
 * lines" and was wrong: read `PreviewCanvas.tsx` before this change existed
 * and the coupling to a real generation was two call sites (the terrain
 * bitmap memo, and `drawPreview`'s own scene). Everything else (pan, zoom,
 * the click-vs-pan slop, hover, `screenToTile`) touches the snapshot only
 * through its `dim`. So this component is parameterised on `dim` directly,
 * never on a `StageSnapshot`, and the full generation (terrain, objects,
 * players, failure marks) is the OPTIONAL `base` prop `drawPreview` now
 * calls its own `PreviewBaseLayer`. A caller with no generation to show (a
 * report tool's own `mapOverlay` block, or the Land Placement panel before
 * its first draw) omits `base` and still gets a working canvas: background,
 * pan, zoom, hover, click, and whatever `overlayShapes` it supplied.
 */
/**
 * What this component needs to draw the full-fidelity layer, a `palette`
 * rather than an already-built terrain canvas, since building that bitmap
 * (the expensive, memoised step) is this component's own job now, not each
 * caller's. `drawPreview`'s own `PreviewBaseLayer` is the post-build shape
 * this component hands it internally.
 */
export interface OverlayCanvasBaseLayer {
  result: PreviewWireResult;
  snapshot: StageSnapshot;
  palette: TerrainPalette;
  hiddenObjects?: ReadonlySet<string>;
}

/** Sec.3.4 layer 3's own vocabulary (`OverlayEvent.modifiers`), reused here for the built-in panel's direct-call path rather than inventing a second shape for the same four keys. */
export interface OverlayDragModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export interface OverlayCanvasProps {
  /** The map's side length, the one thing every interaction below needs. */
  dim: number;
  /**
   * Viewport state as PROPS, not read from `usePreviewViewport()` internally.
   * That context is the app-level singleton `PreviewCanvas` shares between
   * Breakdown and Code, and a panel's canvas needs its OWN viewport for the
   * same reason it needs its own seed (Sec.3.4 item 2's own note). The
   * document-facing wrapper (`PreviewCanvas` below) still reads that context
   * and passes it down; a panel wrapper holds a local `useState` instead.
   */
  viewport: Viewport | null;
  setViewport: Dispatch<SetStateAction<Viewport | null>>;
  userFramed: boolean;
  setUserFramed: (framed: boolean) => void;
  /**
   * The tile under the pointer, as COORDINATES. This component deliberately
   * does not describe the tile. See tileInfo.ts for why a consumer derives
   * that instead.
   */
  onHoverTile: (tile: TilePoint | null) => void;
  /** The currently selected tile, drawn with its own outline. */
  selected: TilePoint | null;
  /** A click that wasn't a pan. The caller decides whether that selects or deselects. */
  onTileClick: (tile: TilePoint) => void;
  /**
   * land-placement-design.md Sec.7.3 brief, item 1: a THIRD pointer mode,
   * added behind an optional prop pair rather than a wrapper, because this
   * component already owns pointer capture for pan — a second owner layered
   * on top would fight it for capture. With neither prop supplied,
   * `onPointerDown` does exactly what it does today; Breakdown and Code
   * never pass them and are unaffected.
   *
   * `hitTestDragStart` answers "does a drag start on this tile, and on
   * which shape" — the panel supplies its own `hitTestCircles`-style lookup,
   * opaque to this component. A non-null result switches the gesture from
   * pan to shape-drag once the pointer travels past the same click/pan slop
   * that already separates a click from a pan.
   *
   * `onDrag` then receives the shape id and the drop point on every move
   * and once more on release, as PERCENT-of-map coordinates (0-100), not a
   * floored tile: `readTile` FLOORS its result, and flooring a drag's drop
   * point before converting to percent double-rounds and biases the drag
   * toward the map origin by up to half a tile (the brief's own "one piece
   * of arithmetic that must not end up in the component"). `applyDefaultSnapping`
   * (the caller's own job) does all the rounding a drag actually wants.
   */
  hitTestDragStart?: (tile: TilePoint) => string | null;
  onDrag?: (shapeId: string, phase: "move" | "end", percent: { x: number; y: number }, modifiers: OverlayDragModifiers) => void;
  /** The full-fidelity terrain/objects/players/failure-marks layer. Absent draws background + `overlayShapes` only. */
  base?: OverlayCanvasBaseLayer;
  /** Sec.3.4 layer 2, declarative shapes any tool can draw on this canvas. */
  overlayShapes?: readonly OverlayShape[];
  /** Which `HelpTip` id names this canvas, since two surfaces render this component under two different ids. */
  helpTipId: string;
  /** The "≈ Approximate preview" badge and banner notes. Meaningful only alongside `base`, since a caller with no generation has nothing for the banner to report on. */
  showApproximateBadge?: boolean;
}

export function OverlayCanvas({
  dim,
  viewport,
  setViewport,
  userFramed: persistedUserFramed,
  setUserFramed: setPersistedUserFramed,
  onHoverTile,
  selected,
  onTileClick,
  hitTestDragStart,
  onDrag,
  base,
  overlayShapes,
  helpTipId,
  showApproximateBadge,
}: OverlayCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [highlight, setHighlight] = useState<TilePoint | null>(null);

  // True once the user has zoomed or panned. Until then the view refits
  // itself on resize and on a new result, which is what you want while the
  // pane is settling; afterwards refitting would throw away their framing on
  // every re-roll. A ref rather than state because nothing renders from it.
  // Writing it must not schedule a render, and the ResizeObserver/
  // snapshot-change effects below read it from inside closures that don't
  // list it as a dependency, so they need an always-current value rather than
  // one captured at effect-creation time.
  //
  // Seeded from the persisted flag (so a remount after a tab switch starts
  // already-framed instead of re-fitting), and every write goes through
  // markUserFramed so the NEXT remount seeds correctly too. The ref is the
  // fast synchronous copy, the caller's own state is what survives.
  const userFramedRef = useRef(persistedUserFramed);

  const markUserFramed = useCallback(() => {
    userFramedRef.current = true;
    setPersistedUserFramed(true);
  }, [setPersistedUserFramed]);

  // The terrain bitmap is the expensive part (one pass over dim^2 tiles), so
  // it is rebuilt only when the snapshot or the palette changes, NOT per
  // frame and not on zoom. Panning and zooming re-draw the same bitmap under
  // a different transform, which is the whole reason drawPreview works this
  // way. `null` when there is no base layer at all.
  const terrain = useMemo(
    () => (base ? createBitmapCanvas(buildTerrainBitmap(base.snapshot, base.palette)) : null),
    [base],
  );

  // --- Sizing -------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      setViewport((previous) => {
        if (previous === null || !userFramedRef.current) {
          return fitViewport(dim, clientWidth, clientHeight);
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
  }, [dim, setViewport]);

  // A new map (re-roll, or a different size) refits unless the user has
  // framed the view themselves.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || userFramedRef.current) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    setViewport(fitViewport(dim, container.clientWidth, container.clientHeight));
    // Depends on `base` too: a fresh generation (same dim, new terrain) should
    // still refit while the user hasn't framed anything yet, matching
    // PreviewCanvas's original dependency on the whole `snapshot` object.
  }, [dim, base, setViewport]);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    userFramedRef.current = false;
    setPersistedUserFramed(false);
    setViewport(fitViewport(dim, container.clientWidth, container.clientHeight));
  }, [dim, setPersistedUserFramed, setViewport]);

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
    drawPreview(ctx, viewport, {
      base: base && terrain ? { result: base.result, snapshot: base.snapshot, terrain, hiddenObjects: base.hiddenObjects } : undefined,
      overlayShapes,
      highlight,
      selection: selected,
    });
  }, [viewport, base, terrain, overlayShapes, highlight, selected]);

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

  // `travel` accumulates the ABSOLUTE distance moved since the press, which is
  // what separates a click from a pan. Distance from the press point would not
  // do: a drag that wanders out and comes back would register as a click.
  //
  // A THIRD state, "shapeCandidate"/"shapeDrag", is item 1's own addition: a
  // press that starts on a `hitTestDragStart` hit is a candidate for a shape
  // drag rather than a pan, and stays a candidate (tracked exactly like a
  // pan's own travel) until it crosses the SAME click/pan slop — at which
  // point it becomes a real shape drag and pan is never engaged for this
  // gesture at all. A press that never crosses the slop falls through to the
  // existing click path unchanged, so a click on a draggable shape still
  // selects it the same way it always has.
  const dragRef = useRef<
    | { mode: "pan"; pointerId: number; x: number; y: number; travel: number }
    | { mode: "shapeCandidate"; pointerId: number; x: number; y: number; travel: number; shapeId: string }
    | { mode: "shapeDrag"; pointerId: number; shapeId: string }
    | null
  >(null);

  const readTile = useCallback(
    (clientX: number, clientY: number): TilePoint | null => {
      const canvas = canvasRef.current;
      if (canvas === null || viewport === null) return null;
      const rect = canvas.getBoundingClientRect();
      const point = screenToTile(viewport, clientX - rect.left, clientY - rect.top);
      if (!isOnMap(point, dim)) return null;
      return { x: Math.floor(point.x), y: Math.floor(point.y) };
    },
    [viewport, dim],
  );

  // The un-floored twin of readTile, for a shape drag's own drop point.
  // Off-map is still reported (a drag can validly be dropped past the map
  // edge, unlike a click, which selects nothing there): only a missing
  // canvas/viewport declines.
  const readPercent = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (canvas === null || viewport === null || dim <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      const point = screenToTile(viewport, clientX - rect.left, clientY - rect.top);
      return tileToPercent(point, dim);
    },
    [viewport, dim],
  );

  const modifiersOf = (event: React.PointerEvent<HTMLCanvasElement>): OverlayDragModifiers => ({
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  });

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const tile = readTile(event.clientX, event.clientY);
    const shapeId = tile !== null && hitTestDragStart ? hitTestDragStart(tile) : null;
    dragRef.current =
      shapeId !== null
        ? { mode: "shapeCandidate", pointerId: event.pointerId, x: event.clientX, y: event.clientY, travel: 0, shapeId }
        : { mode: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId === event.pointerId) {
      if (drag.mode === "pan") {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        dragRef.current = { ...drag, x: event.clientX, y: event.clientY, travel: drag.travel + Math.abs(dx) + Math.abs(dy) };
        markUserFramed();
        setViewport((previous) => (previous === null ? previous : clampToCanvas(panBy(previous, dx, dy), dim)));
        return;
      }
      if (drag.mode === "shapeCandidate") {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const travel = drag.travel + Math.abs(dx) + Math.abs(dy);
        if (travel <= CLICK_SLOP_PX) {
          dragRef.current = { ...drag, x: event.clientX, y: event.clientY, travel };
          return; // still might resolve to a click
        }
        // Crossed the slop: this gesture is now a shape drag, never a pan.
        dragRef.current = { mode: "shapeDrag", pointerId: event.pointerId, shapeId: drag.shapeId };
      }
      // mode === "shapeDrag" (either already, or just switched into above).
      const current = dragRef.current;
      const shapeId = current?.mode === "shapeDrag" ? current.shapeId : null;
      const percent = readPercent(event.clientX, event.clientY);
      if (shapeId !== null && percent !== null && onDrag) onDrag(shapeId, "move", percent, modifiersOf(event));
      return;
    }
    const point = readTile(event.clientX, event.clientY);
    setHighlight(point);
    onHoverTile(point);
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>, clicked: boolean) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (drag.mode === "shapeDrag") {
      // A real shape drag was in progress: deliver the final drop and never
      // fall through to a click-select, the drag itself is the completed
      // gesture.
      const percent = clicked ? readPercent(event.clientX, event.clientY) : null;
      if (percent !== null && onDrag) onDrag(drag.shapeId, "end", percent, modifiersOf(event));
      return;
    }
    // A press-and-release that never really moved is a click, whether it
    // started as a pan candidate or a shape-drag candidate that never
    // crossed the slop. Handled here rather than with a separate onClick
    // because the pan handler already owns the pointer via
    // setPointerCapture, and an onClick would fire at the end of a drag
    // too. `clicked` is false on pointercancel, where the gesture was taken
    // away from us rather than completed by the user.
    if (!clicked || drag.travel > CLICK_SLOP_PX) return;
    const point = readTile(event.clientX, event.clientY);
    if (point !== null) onTileClick(point);
  };

  const onPointerLeave = () => {
    setHighlight(null);
    onHoverTile(null);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {/* dismissOnInteract because this anchor is the whole map: the tip opens
          off the canvas's bottom edge, straight onto the tile readout, and the
          pointer lives inside the anchor for as long as you are reading it.
          See the prop's own comment in HelpTip.tsx. */}
      <HelpTip id={helpTipId} dismissOnInteract>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: "100%", height: "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endDrag(event, true)}
          onPointerCancel={(event) => endDrag(event, false)}
          onPointerLeave={onPointerLeave}
          onDoubleClick={resetView}
        />
      </HelpTip>
      {showApproximateBadge && (
        <div className={styles.overlay}>
          <HelpTip id="preview.approximateBadge">
            <span className={styles.badge}>≈ Approximate preview</span>
          </HelpTip>
          {base?.result.notes
            .filter((note) => note.prominence === "banner")
            .map((note) => (
              <span key={note.key} className={styles.banner}>
                {note.text}
              </span>
            ))}
        </div>
      )}
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
