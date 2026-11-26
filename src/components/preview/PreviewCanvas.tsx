import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useGenerationSettings } from "../../generationSettings/GenerationSettingsContext";
import type {
  PreviewWireResult,
  StageSnapshot,
} from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";
import type { TilePoint } from "../../preview/render/projection";
import type { TerrainShare } from "../../preview/render/terrainStats";
import { HelpTip } from "../HelpTip";
import staleStyles from "./PreviewNotes.module.css";
import { useCurrentFilePath } from "../../settings/DiagnosticDismissalContext";
import { usePreviewView, usePreviewViewport } from "./PreviewViewContext";
import { OverlayCanvas } from "./OverlayCanvas";
import { GenerationSettingsPanel } from "./GenerationSettingsPanel";
import { PreviewTimingPanel } from "./PreviewTimingPanel";
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
  /** Each terrain on the drawn grid with its share of the tiles, largest first, for the Legend and Terrain Stats box. */
  terrainShares: readonly TerrainShare[];
  /** Regenerate on Edit is off and the script changed since this map was drawn. */
  stale?: boolean;
  /** Generates from the current script now. Clicking the stale notice calls it. */
  onRegenerate?: () => void;
  /** Drawn in the map's top left corner under any banner notes. The pane puts the hovered or selected tile's details here. */
  topLeft?: ReactNode;
  /** The command under the caret's tiles, lit over the map (Highlight selected command). */
  commandHighlight?: { first: Uint32Array; second?: Uint32Array } | null;
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
  terrainShares,
  stale = false,
  onRegenerate,
  topLeft,
  commandHighlight,
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
  const filePath = useCurrentFilePath();
  const {
    hiddenNotes,
    hideNote,
    restoreNotes,
    deTextures,
    colorMode,
    recordTiming,
  } = usePreviewView();
  const summary = useMemo(
    () =>
      summarizePreviewResult(result, (id) =>
        hiddenNotes.has(`${filePath ?? ""}\0${id}`),
      ),
    [result, hiddenNotes, filePath],
  );
  // The settings box and the Help line share the top right slot, so opening
  // one closes the other: Help closes the settings from here, and the
  // settings (opened by the cog or the hotkey, both outside this component)
  // close Help through the effect below.
  const {
    isDialogOpen: settingsOpen,
    closeDialog: closeSettings,
    toggleDialog: toggleSettings,
  } = useGenerationSettings();
  // The terrain whose tiles glow, picked from the Terrain Stats box. It
  // outlives the box on purpose, so a scripter can close it, open Notes or
  // edit the script and keep the glow as a reference. The chip in the bottom
  // row names what glows and turns it off once the box is gone.
  const [glowPick, setGlowPick] = useState<number | null>(null);
  const toggleSection = (section: PreviewPanelSection) => {
    if (section === "help") closeSettings();
    setOpenSection((current) => (current === section ? null : section));
  };
  // Derived, not synced with an effect. A regeneration that removes the
  // picked terrain needs no cleanup, since this simply reads null until the
  // terrain is back. The effect version (watch the shares, call setGlowPick)
  // would draw one frame with a stale glow and then render again.
  const glowTerrain =
    glowPick !== null && terrainShares.some((share) => share.id === glowPick)
      ? glowPick
      : null;
  const terrainRender =
    colorMode === "minimap" ? "minimap" : deTextures ? "de" : "flat";
  // The textured view draws terrain as its textures, so a box of flat colour
  // swatches no longer says what anything on the map is. It becomes stats
  // alone there. The flat views keep the swatches beside the stats.
  const legendKind = terrainRender === "de" ? "stats" : "both";
  useEffect(() => {
    if (settingsOpen)
      setOpenSection((current) => (current === "help" ? null : current));
  }, [settingsOpen]);
  // Timing turned off while its box is open: close the box, since its greyed
  // out button can no longer close it.
  useEffect(() => {
    if (!recordTiming)
      setOpenSection((current) => (current === "timing" ? null : current));
  }, [recordTiming]);
  // Whether the window was hidden when this result arrived, which slows the
  // worker several times over (a measured WebView2 effect), so the hourglass
  // can say so. Read once per result, not per render.
  const measuredHidden = useMemo(() => {
    void result;
    return typeof document !== "undefined" && document.hidden;
  }, [result]);
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
      // The minimap button wins over DE textures: it asks for the game's
      // minimap look, which is the flat diamond.
      terrainRender={terrainRender}
      glowTerrain={glowTerrain}
      commandHighlight={commandHighlight}
      helpTipId="preview.canvas"
      showApproximateBadge
      playerCount={playerCount}
      showExportButton
      showOrientation="full"
      topLeft={topLeft}
      staleNotice={
        stale && onRegenerate ? (
          <HelpTip id="preview.staleNotice">
            <button
              type="button"
              className={staleStyles.staleNotice}
              onClick={onRegenerate}
            >
              Stale, click to generate
            </button>
          </HelpTip>
        ) : undefined
      }
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
          showTiming={recordTiming}
          legendKind={legendKind}
          glowName={
            glowTerrain === null || openSection === "legend"
              ? undefined
              : (palette.nameFor(glowTerrain) ?? `terrain ${glowTerrain}`)
          }
          onClearGlow={() => setGlowPick(null)}
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
            terrainShares={terrainShares}
          />
        ) : null
      }
      topRightPanelWide={settingsOpen}
      bottomPanel={
        openSection === "timing" ? (
          <PreviewTimingPanel
            timing={result.timing}
            measuredHidden={measuredHidden}
          />
        ) : openSection === "objects" ? (
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
              terrainShares={terrainShares}
              legendKind={legendKind}
              glowTerrain={glowTerrain}
              onGlowTerrain={(id) =>
                setGlowPick((current) => (current === id ? null : id))
              }
              onHideNote={(id) => hideNote(filePath, id)}
              onRestoreNotes={() => restoreNotes(filePath)}
            />
          )
        )
      }
    />
  );
}
