import type { PreviewWireResult, StageSnapshot } from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";
import type { TilePoint } from "../../preview/render/projection";
import { usePreviewViewport } from "./PreviewViewContext";
import { OverlayCanvas } from "./OverlayCanvas";

interface PreviewCanvasProps {
  result: PreviewWireResult;
  snapshot: StageSnapshot;
  palette: TerrainPalette;
  /**
   * The tile under the pointer, as COORDINATES. The canvas deliberately does
   * not describe the tile. See tileInfo.ts for why the pane derives that
   * instead.
   */
  onHoverTile: (tile: TilePoint | null) => void;
  /** The currently selected tile, drawn with its own outline. */
  selected: TilePoint | null;
  /** A click that wasn't a pan. The parent decides whether that selects or deselects. */
  onTileClick: (tile: TilePoint) => void;
  /**
   * Object names to leave undrawn. A prop rather than another
   * `usePreviewView()` call here: the pane already reads that context, and
   * subscribing the canvas to it as well would re-render the canvas on every
   * seed keystroke and colour-mode click for a value it does not use.
   */
  hiddenObjects: ReadonlySet<string>;
}

/**
 * `PreviewPane`'s own canvas, the shared `OverlayCanvas` (slice-4b item 2)
 * with the app's viewport context wired in and no `mapOverlay` shapes of its
 * own, so it stays pixel-identical to what this file used to draw directly
 * (R2's whole acceptance). The Land Placement panel renders `OverlayCanvas`
 * itself with its own viewport and its own overlay shapes. See
 * `src/tools/builtin/landPlacement/panel/`.
 */
export function PreviewCanvas({
  result,
  snapshot,
  palette,
  onHoverTile,
  selected,
  onTileClick,
  hiddenObjects,
}: PreviewCanvasProps) {
  // Held above the tab switch (PreviewViewContext.tsx) so zoom/pan survive
  // Breakdown <-> Code instead of resetting to "fit" on every remount.
  const { viewport, setViewport, userFramed, setUserFramed } = usePreviewViewport();

  return (
    <OverlayCanvas
      dim={snapshot.dim}
      viewport={viewport}
      setViewport={setViewport}
      userFramed={userFramed}
      setUserFramed={setUserFramed}
      onHoverTile={onHoverTile}
      selected={selected}
      onTileClick={onTileClick}
      base={{ result, snapshot, palette, hiddenObjects }}
      helpTipId="preview.canvas"
      showApproximateBadge
    />
  );
}
