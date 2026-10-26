import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useGenerationSettings } from "../../generationSettings/GenerationSettingsContext";
import type {
  PreviewWireResult,
  StageSnapshot,
} from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";
import type { TilePoint } from "../../preview/render/projection";
import { usePreviewViewport } from "./PreviewViewContext";
import { OverlayCanvas } from "./OverlayCanvas";
import { GenerationSettingsPanel } from "./GenerationSettingsPanel";
import {
  PreviewObjectList,
  type ObjectListSettings,
} from "./PreviewObjectList";
import {
  PreviewBarControls,
  PreviewCornerControls,
  PreviewPanel,
  summarizePreviewResult,
  type PreviewPanelSection,
} from "./PreviewNotes";

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
  /** The settings' player count for the badge's "200×200, 6 players" line; see `OverlayCanvasProps.playerCount` for why it is not read off `result`. */
  playerCount: number;
  /** Terrain ids actually on the drawn grid, for the Legend box. */
  terrainsInUse: readonly number[];
  /** Drawn in the map's top left corner under any banner notes. The pane puts the hovered or selected tile's details here. */
  topLeft?: ReactNode;
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
  playerCount,
  terrainsInUse,
  topLeft,
}: PreviewCanvasProps) {
  // Held above the tab switch (PreviewViewContext.tsx) so zoom/pan survive
  // Breakdown <-> Code instead of resetting to "fit" on every remount.
  const { viewport, setViewport, userFramed, setUserFramed } =
    usePreviewViewport();

  // Which box is open over the map, if any. Local: it means nothing once the
  // pane is gone, the same reasoning as the hovered tile.
  const [openSection, setOpenSection] = useState<PreviewPanelSection | null>(
    null,
  );
  const summary = useMemo(() => summarizePreviewResult(result), [result]);
  // The settings box and the Help line share the top right slot, so opening
  // one closes the other: Help closes the settings from here, and the
  // settings (opened by the cog or the hotkey, both outside this component)
  // close Help through the effect below.
  const {
    isDialogOpen: settingsOpen,
    closeDialog: closeSettings,
    toggleDialog: toggleSettings,
  } = useGenerationSettings();
  const toggleSection = (section: PreviewPanelSection) => {
    if (section === "help") closeSettings();
    setOpenSection((current) => (current === section ? null : section));
  };
  useEffect(() => {
    if (settingsOpen)
      setOpenSection((current) => (current === "help" ? null : current));
  }, [settingsOpen]);
  // The Obj. List's search and order. Here rather than inside the list,
  // which unmounts whenever its box closes (PreviewObjectList.tsx).
  const [objectListSettings, setObjectListSettings] =
    useState<ObjectListSettings>({
      query: "",
      sortKey: "name",
      direction: "asc",
    });

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
      playerCount={playerCount}
      showExportButton
      showOrientation="full"
      topLeft={topLeft}
      topRightControls={
        <PreviewCornerControls
          open={openSection}
          onToggle={toggleSection}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
        />
      }
      bottomControls={
        <PreviewBarControls
          summary={summary}
          open={openSection}
          onToggle={toggleSection}
          hiddenObjectCount={hiddenObjects.size}
        />
      }
      // Help opens under its own button in the top right corner, the rest
      // over the bottom edge beside the buttons that open them.
      topRightPanel={
        settingsOpen ? (
          <GenerationSettingsPanel onClose={closeSettings} />
        ) : openSection === "help" ? (
          <PreviewPanel
            section="help"
            result={result}
            summary={summary}
            palette={palette}
            terrainsInUse={terrainsInUse}
          />
        ) : null
      }
      topRightPanelWide={settingsOpen}
      bottomPanel={
        openSection === "objects" ? (
          <PreviewObjectList
            settings={objectListSettings}
            onSettingsChange={setObjectListSettings}
          />
        ) : (
          openSection !== null &&
          openSection !== "help" && (
            <PreviewPanel
              section={openSection}
              result={result}
              summary={summary}
              palette={palette}
              terrainsInUse={terrainsInUse}
            />
          )
        )
      }
    />
  );
}
