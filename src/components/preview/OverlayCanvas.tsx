import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { OverlayShape } from "../../../tools-api/index";
import type {
  PreviewWireResult,
  StageSnapshot,
} from "../../preview/generator/types";
import type { TerrainPalette } from "../../preview/render/palette";
import {
  SPRITE_MIN_HALF_WIDTH,
  createBitmapCanvas,
  drawPreview,
} from "../../preview/render/drawPreview";
import { SpriteRenderer } from "../../preview/render/spritesGl";
import { moodTransform } from "../../preview/render/colourMoods";
import { useMinimapLayer } from "./useMinimapLayer";
import { buildTerrainBitmap } from "../../preview/render/terrainBitmap";
import {
  DE_TILE_ASPECT,
  TILE_ASPECT,
  aspectOf,
  clampToCanvas,
  fitViewport,
  isOnMap,
  panBy,
  screenToTile,
  tileToPercent,
  withAspect,
  zoomAt,
  type GroundHeights,
  type TilePoint,
  type Viewport,
} from "../../preview/render/projection";
import {
  alternatingGlow,
  glowAlpha,
  glowRuns,
  maskRuns,
  traceGlowRuns,
} from "../../preview/render/terrainStats";
import { hexToRgbTriplet } from "../../settings/theme";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import type { DecodedImage } from "../../preview/render/dds";
import {
  loadDeBlendAtlases,
  loadDeMasks,
  loadDeTextures,
  texturesFolderFound,
} from "../../preview/render/deTextureSource";
import { buildBlendBytes } from "../../preview/render/terrainBlends";
import { TexturedTerrainRenderer } from "../../preview/render/texturedTerrainGl";
import {
  buildCornerHeights,
  buildTerrainTable,
  buildTileBytes,
  maskNamesFor,
  visualTerrainsIn,
  type TexturedTerrainRow,
} from "../../preview/render/texturedTiles";
import { HelpTip } from "../HelpTip";
import { renderProse } from "../InlineCode";
import {
  useHideDecorationsSetting,
  useHidePlayerCirclesSetting,
  useGridLinesSetting,
  useSmallTreesSetting,
  useTerrainBlendsSetting,
} from "./PreviewViewContext";
import { useDeSprites } from "./useDeSprites";
import styles from "./PreviewCanvas.module.css";

const ZOOM_STEP = 1.18;

type ExportArea = "visible" | "map";
type ExportQuality = "low" | "standard" | "high" | "max";

/**
 * What Export saves. "visible" is the canvas as framed now, "map" is the whole
 * diamond fitted edge to edge whatever the current zoom and pan.
 */
const EXPORT_AREAS: { id: ExportArea; label: string; helpId: string }[] = [
  { id: "visible", label: "Visible area", helpId: "preview.exportAreaVisible" },
  { id: "map", label: "Entire map", helpId: "preview.exportAreaMap" },
];

/**
 * Visible area: a multiple of the screen's own pixel density, so Standard is
 * what the user sees. Entire map: pixels across one tile's half width, so
 * Standard draws each tile 8 pixels wide.
 */
const EXPORT_QUALITIES: {
  id: ExportQuality;
  label: string;
  visibleScale: number;
  tileHalfWidth: number;
}[] = [
  { id: "low", label: "Low", visibleScale: 0.5, tileHalfWidth: 2 },
  { id: "standard", label: "Standard", visibleScale: 1, tileHalfWidth: 4 },
  { id: "high", label: "High", visibleScale: 2, tileHalfWidth: 8 },
  { id: "max", label: "Maximum", visibleScale: 4, tileHalfWidth: 16 },
];

/** Longest side and total pixels a canvas may have before browsers refuse it. */
const EXPORT_MAX_SIDE = 16384;
const EXPORT_MAX_SIDE_GL = 8192; // WebGL's drawing buffer limit is lower
const EXPORT_MAX_PIXELS = 100_000_000;

interface ExportPlan {
  /** Output size in pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** The viewport to paint with, in CSS pixels, and the pixel ratio over it. */
  viewport: Viewport;
  ratio: number;
  /** True when the size was cut back to stay inside the canvas limits. */
  clamped: boolean;
}

/**
 * Works out the output size and the viewport an export paints with. Pure, so
 * the menu can show the resulting size before anything is drawn.
 */
function planExport(
  area: ExportArea,
  quality: ExportQuality,
  dim: number,
  current: Viewport,
  devicePixelRatio: number,
  aspect: number,
  textured: boolean,
): ExportPlan {
  const q = EXPORT_QUALITIES.find((entry) => entry.id === quality)!;
  const maxSide = textured ? EXPORT_MAX_SIDE_GL : EXPORT_MAX_SIDE;
  let viewport: Viewport;
  let ratio: number;
  if (area === "visible") {
    viewport = current;
    ratio = devicePixelRatio * q.visibleScale;
  } else {
    // The whole diamond, with a margin of two tiles so the edge tiles are not
    // cut by the image border. Drawn at ratio 1, with the zoom itself set to
    // the quality, so the viewport is already in output pixels.
    const halfWidth = q.tileHalfWidth;
    const margin = 2 * halfWidth;
    const width = Math.ceil(2 * dim * halfWidth + 2 * margin);
    const height = Math.ceil(2 * dim * halfWidth * aspect + 2 * margin);
    viewport = {
      width,
      height,
      halfWidth,
      aspect,
      originX: margin,
      originY: height / 2,
    };
    ratio = 1;
  }
  // Shrink to the limits. Scaling the ratio keeps the framing the same.
  const wantW = viewport.width * ratio;
  const wantH = viewport.height * ratio;
  const shrink = Math.min(
    1,
    maxSide / Math.max(wantW, wantH),
    Math.sqrt(EXPORT_MAX_PIXELS / (wantW * wantH)),
  );
  ratio *= shrink;
  return {
    pixelWidth: Math.max(1, Math.round(viewport.width * ratio)),
    pixelHeight: Math.max(1, Math.round(viewport.height * ratio)),
    viewport,
    ratio,
    clamped: shrink < 1,
  };
}

// Same double cast as PreviewPane.tsx. `npm run validate:reference` is the
// real guarantee of the shape.
const TEXTURED_ROWS = (
  gameConstantsRaw as unknown as { constants: TexturedTerrainRow[] }
).constants;

/** The textures one map needs, as lower case file names. */
function textureNamesFor(terrainIds: Iterable<number>): string[] {
  const ids = new Set(terrainIds);
  const names = new Set<string>();
  for (const row of TEXTURED_ROWS) {
    if (row.category !== "terrain" || row.constId === null) continue;
    if (ids.has(row.constId) && row.deTextureFile)
      names.add(row.deTextureFile.toLowerCase());
  }
  return [...names].sort();
}

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
  onDrag?: (
    shapeId: string,
    phase: "move" | "end",
    percent: { x: number; y: number },
    modifiers: OverlayDragModifiers,
  ) => void;
  /** The full-fidelity terrain/objects/players/failure-marks layer. Absent draws background + `overlayShapes` only. */
  base?: OverlayCanvasBaseLayer;
  /**
   * "de" draws the map at the game's 2:1 squash with the terrain textures
   * from the user's DE install (docs/preview-de-textures-design.md). Absent
   * or "flat" is the flat colour view. Every interaction works the same in
   * both, since the viewport carries the squash (projection.ts).
   */
  terrainRender?: "flat" | "de" | "minimap";
  /**
   * A terrain id whose tiles pulse bright and dim over the map (the Terrain
   * Stats box). Drawn on a canvas of its own over the map, so the pulse
   * never repaints the terrain and never reaches an exported PNG.
   */
  glowTerrain?: number | null;
  /**
   * The tiles of the command under the caret (Highlight selected command), as
   * sorted tile indices. One set pulses teal. With a `second` set the two take
   * turns, teal then magenta. Drawn on the glow canvas above the terrain glow,
   * so it never reaches an exported PNG.
   */
  commandHighlight?: { first: Uint32Array; second?: Uint32Array } | null;
  /** Sec.3.4 layer 2, declarative shapes any tool can draw on this canvas. */
  overlayShapes?: readonly OverlayShape[];
  /** Which `HelpTip` id names this canvas, since two surfaces render this component under two different ids. */
  helpTipId: string;
  /** The banner notes, and the map size chip beside the buttons. Meaningful only alongside `base`, since a caller with no generation has nothing for the banner to report on. */
  showApproximateBadge?: boolean;
  /** Drawn right after the map size chip, for a notice about the map as a whole (the preview's stale marker). */
  staleNotice?: ReactNode;
  /**
   * The lobby player count this generation ran with, drawn in the top right
   * corner as "200×200, 6 players". The dim half of that line is this component's
   * own `dim` (post-`override_map_size`, so it is what was actually drawn,
   * not the lobby size). The player half cannot be read off the result:
   * `result.players` is the markers a script managed to PLACE, which is
   * zero for a script with no player lands, so the caller hands in the
   * settings value the generator was given instead. Only drawn with
   * `showApproximateBadge`.
   */
  playerCount?: number;
  /**
   * Adds the small "Export" button in the top right corner, which saves
   * exactly what this canvas is currently showing as a PNG. Optional because
   * this component is also the Land Placement panel's own canvas (no
   * document, nothing meaningful to export), which never passes it.
   */
  showExportButton?: boolean;
  /**
   * Draws the x/y axis arrows at the origin over the map. "full" adds the
   * side names (Left, Bottom, Right, Top) too. Absent draws neither, for a
   * caller that wants the canvas as it was.
   */
  showOrientation?: "axes" | "full";
  /**
   * Content for the top left corner, under any banner notes. The app's
   * preview puts the hovered or selected tile's details here. This component
   * does not know what it is, and its pointer events are the caller's call
   * (the corner column ignores them so the map under it still pans).
   */
  topLeft?: ReactNode;
  /**
   * Extra buttons for the top right corner, after the map size chip and
   * Export. The app's preview puts its Help and generation settings buttons
   * here. This component does not know what they are.
   */
  topRightControls?: ReactNode;
  /**
   * A box that opens on the row under the top right buttons, right-aligned,
   * so it appears just below the button that opened it. Absent draws nothing.
   */
  topRightPanel?: ReactNode;
  /** Lets the top right box grow past its usual width, for one that holds form fields. */
  topRightPanelWide?: boolean;
  /**
   * Extra controls for the left end of the bottom-right button row, before
   * the zoom buttons. The app's preview puts its placement notice and its
   * Obj. List, Notes and Legend buttons here. This component does not know
   * what they are.
   */
  bottomControls?: ReactNode;
  /**
   * A box laid over the bottom of the canvas, just above that button row.
   * Absent draws nothing. The caller owns when it is open, since the buttons
   * that open it are `bottomControls`.
   */
  bottomPanel?: ReactNode;
}

export function OverlayCanvas({
  dim,
  viewport: cameraViewport,
  setViewport,
  userFramed: persistedUserFramed,
  setUserFramed: setPersistedUserFramed,
  onHoverTile,
  selected,
  onTileClick,
  hitTestDragStart,
  onDrag,
  base,
  terrainRender = "flat",
  glowTerrain = null,
  commandHighlight = null,
  overlayShapes,
  helpTipId,
  showApproximateBadge,
  staleNotice,
  playerCount,
  showExportButton,
  showOrientation,
  topLeft,
  topRightControls,
  topRightPanel,
  topRightPanelWide,
  bottomControls,
  bottomPanel,
}: OverlayCanvasProps) {
  // Whether the top right row has anything to hold. Decides both the row and
  // the top left column's extra top padding, so an empty corner costs nothing.
  const hasTopRight =
    (showApproximateBadge && playerCount !== undefined) ||
    showExportButton ||
    (topRightControls !== undefined && topRightControls !== null);
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

  // Both callers build `base` as a fresh object literal on every render, so
  // `base` itself is a new reference each time even when nothing in it
  // changed. React compares dependencies by reference (Object.is), so any
  // hook below keyed on `base` would re-run on every render. The refit
  // effect further down calls setViewport, the caller re-renders and builds
  // another `base`, and the effect runs again, forever. That loop kept the
  // main thread busy enough that Monaco's background tokenizer, which waits
  // for an idle moment, never ran, so typed code in the Code tab stayed
  // uncoloured. So every hook here names the fields it reads. Memoising
  // `base` in each caller would also work, but every future caller would have
  // to remember to, and the Land Placement panel already did not.
  const baseResult = base?.result;
  const baseSnapshot = base?.snapshot;
  const basePalette = base?.palette;
  const baseHiddenObjects = base?.hiddenObjects;

  // The terrain bitmap is the expensive part (one pass over dim^2 tiles), so
  // it is rebuilt only when the snapshot or the palette changes, NOT per
  // frame and not on zoom. Panning and zooming re-draw the same bitmap under
  // a different transform, which is the whole reason drawPreview works this
  // way. `null` when there is no base layer at all.
  const terrain = useMemo(
    () =>
      baseSnapshot && basePalette
        ? createBitmapCanvas(buildTerrainBitmap(baseSnapshot, basePalette))
        : null,
    [baseSnapshot, basePalette],
  );

  // --- The textured view (docs/preview-de-textures-design.md) ------------

  const textured = terrainRender === "de";
  // The minimap view is the flat diamond with its own object layer.
  const minimapView = terrainRender === "minimap";
  // The squash this view draws at. Every viewport this component makes or
  // keeps carries it, which is all hover, click, drag and the overlays need
  // to follow the view (projection.ts's Viewport.aspect).
  const aspect = textured ? DE_TILE_ASPECT : TILE_ASPECT;

  // The tile bytes are rebuilt when the map or the palette changes, never
  // per frame, the same rule as the flat bitmap above.
  const tileBytes = useMemo(
    () =>
      textured && baseSnapshot && basePalette
        ? buildTileBytes(baseSnapshot, basePalette)
        : null,
    [textured, baseSnapshot, basePalette],
  );
  const visualIds = useMemo(
    () => (tileBytes ? visualTerrainsIn(tileBytes) : null),
    [tileBytes],
  );
  // Which neighbours blend into each tile, and the ground's height at each
  // tile corner for the hill light, also once per map (Sec.10).
  const blendBytes = useMemo(
    () =>
      tileBytes && baseSnapshot
        ? buildBlendBytes(tileBytes, baseSnapshot.dim, TEXTURED_ROWS)
        : null,
    [tileBytes, baseSnapshot],
  );
  const cornerHeights = useMemo(
    () => (textured && baseSnapshot ? buildCornerHeights(baseSnapshot) : null),
    [textured, baseSnapshot],
  );
  // A string, not the array, as the effect's key. Two re-rolls that draw the
  // same terrains build two equal arrays, and React compares dependencies by
  // reference, so an array key would reload on every re-roll. A string
  // compares by value. The masks are part of it, since two terrains can share
  // a texture and differ in mask.
  const textureKey = useMemo(
    () =>
      visualIds
        ? [
            ...textureNamesFor(visualIds),
            "|",
            ...maskNamesFor(visualIds, TEXTURED_ROWS),
          ].join("\n")
        : "",
    [visualIds],
  );

  const [loadedTextures, setLoadedTextures] = useState<{
    key: string;
    images: Map<string, DecodedImage>;
    masks: Map<string, Uint8Array>;
    atlases: (Uint8Array | null)[];
  } | null>(null);

  useEffect(() => {
    if (!textured || textureKey === "") return;
    // The cancelled flag guards against a slow load finishing after the map
    // changed. Without it, the older load could land last and set textures
    // for terrains this map does not have, an async race React cannot catch
    // for us, since the effect's cleanup runs but the promise does not stop.
    let cancelled = false;
    const lines = textureKey.split("\n");
    const split = lines.indexOf("|");
    void (async () => {
      const images = await loadDeTextures(lines.slice(0, split));
      const masks = await loadDeMasks(lines.slice(split + 1));
      const atlases = await loadDeBlendAtlases();
      if (!cancelled)
        setLoadedTextures({ key: textureKey, images, masks, atlases });
    })();
    return () => {
      cancelled = true;
    };
  }, [textured, textureKey]);

  const texturesReady =
    loadedTextures !== null && loadedTextures.key === textureKey;
  const terrainTable = useMemo(
    () =>
      texturesReady && visualIds && basePalette
        ? buildTerrainTable(
            visualIds,
            TEXTURED_ROWS,
            basePalette,
            (name) => loadedTextures.images.has(name),
            (name) => loadedTextures.masks.has(name),
          )
        : null,
    [texturesReady, visualIds, basePalette, loadedTextures],
  );

  // Raised ground (Sec.13). The camera the caller holds stays flat, and the
  // viewport this component draws and hit tests with carries the height
  // field in the textured view, so the parent's state never keeps a field
  // from a view that is no longer showing.
  const ground = useMemo<GroundHeights | undefined>(() => {
    if (!textured || cornerHeights === null || baseSnapshot === undefined)
      return undefined;
    let maxLevel = 0;
    for (const h of cornerHeights) if (h > maxLevel) maxLevel = h;
    return { dim: baseSnapshot.dim, corners: cornerHeights, maxLevel };
  }, [textured, cornerHeights, baseSnapshot]);
  const viewport = useMemo<Viewport | null>(() => {
    if (cameraViewport === null) return null;
    if (ground !== undefined) return { ...cameraViewport, ground };
    if (cameraViewport.ground === undefined) return cameraViewport;
    // A copy without the field, rather than setting it to undefined, so the
    // flat viewport compares like one that never had it.
    const flat: Viewport = { ...cameraViewport };
    delete flat.ground;
    return flat;
  }, [cameraViewport, ground]);

  // Objects as the game draws them (Sec.12), only in the textured view.
  const smallTrees = useSmallTreesSetting();
  const terrainBlends = useTerrainBlendsSetting();
  const hideDecorations = useHideDecorationsSetting();
  // The script's colour mood, for the textured view (colourMoods.ts).
  const mood = useMemo(
    () => moodTransform(baseResult?.colorMood),
    [baseResult?.colorMood],
  );
  // The minimap view never shows them, the setting covers the other views.
  // The hook is called first, every render. Written inside the `||` it was
  // skipped whenever the minimap view was on, which breaks React's rule that
  // a component calls the same hooks in the same order each time.
  const hidePlayerCircles = useHidePlayerCirclesSetting();
  const hidePlayers = minimapView || hidePlayerCircles;
  const gridLines = useGridLinesSetting();
  const minimap = useMinimapLayer(minimapView, baseResult, baseSnapshot);
  const sprites = useDeSprites(
    textured,
    baseResult,
    baseHiddenObjects,
    smallTrees,
  );

  // The GPU renderer, made the first time the textured view is shown and
  // kept until this canvas unmounts. A ref, since it is a resource and not
  // something the component renders from. `false` once creating it failed,
  // so the attempt is not repeated every frame.
  const rendererRef = useRef<TexturedTerrainRenderer | null | false>(null);
  // State beside the ref, only so that creating the renderer schedules a
  // redraw. The ref holds the object, this says whether it exists.
  const [glState, setGlState] = useState<"none" | "ready" | "unavailable">(
    "none",
  );
  const glUnavailable = glState === "unavailable";
  // The sprites' own GPU renderer, made the first time sprites draw, for
  // the same reasons as the terrain's. `false` once creating it failed, and
  // then drawPreview draws the sprites on the 2D canvas.
  const spriteRendererRef = useRef<SpriteRenderer | false | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!textured || rendererRef.current !== null) return;
    const renderer = TexturedTerrainRenderer.create();
    rendererRef.current = renderer ?? false;
    setGlState(renderer === null ? "unavailable" : "ready");
  }, [textured]);
  useEffect(
    () => () => {
      if (rendererRef.current) rendererRef.current.dispose();
      rendererRef.current = null;
      if (spriteRendererRef.current) spriteRendererRef.current.dispose();
      spriteRendererRef.current = undefined;
      setGlState("none");
    },
    [],
  );

  // A line over the map whenever the textured view is asked for and cannot
  // be drawn in full, so flat colours never pass for the textured view.
  let deNotice: string | null = null;
  if (textured && base) {
    if (glUnavailable)
      deNotice =
        "DE textures need WebGL2, which this window lacks. Showing flat colours.";
    else if (textureKey !== "" && !texturesReady)
      deNotice = "Loading DE textures…";
    else if (texturesReady && texturesFolderFound() === false)
      deNotice = "No DE install found. Showing flat colours.";
  }

  // --- Sizing -------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      setViewport((previous) => {
        if (previous === null || !userFramedRef.current) {
          return fitViewport(dim, clientWidth, clientHeight, undefined, aspect);
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
  }, [dim, aspect, setViewport]);

  // A new map (re-roll, or a different size) refits unless the user has
  // framed the view themselves. A change of view refits the same way.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || userFramedRef.current) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    setViewport(
      fitViewport(
        dim,
        container.clientWidth,
        container.clientHeight,
        undefined,
        aspect,
      ),
    );
    // Depends on the snapshot too: a fresh generation (same dim, new terrain)
    // should still refit while the user hasn't framed anything yet, matching
    // PreviewCanvas's original dependency on the whole `snapshot` object. The
    // snapshot, not `base`, see the note above `baseSnapshot`.
  }, [dim, baseSnapshot, aspect, setViewport]);

  // A view the user has framed keeps its zoom and centre across a change of
  // squash (withAspect). The updater form, so this never fights the refit
  // above when both run for the same toggle.
  useEffect(() => {
    setViewport((previous) =>
      previous === null || aspectOf(previous) === aspect
        ? previous
        : withAspect(previous, aspect),
    );
  }, [aspect, setViewport]);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return;
    userFramedRef.current = false;
    setPersistedUserFramed(false);
    setViewport(
      fitViewport(
        dim,
        container.clientWidth,
        container.clientHeight,
        undefined,
        aspect,
      ),
    );
  }, [dim, aspect, setPersistedUserFramed, setViewport]);

  // The Export menu: open flag and the two choices. Plain state, since they
  // only matter while this canvas is mounted.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportArea, setExportArea] = useState<ExportArea>("visible");
  const [exportQuality, setExportQuality] = useState<ExportQuality>("standard");
  const exportMenuRef = useRef<HTMLSpanElement>(null);
  const [exporting, setExporting] = useState(false);

  // Close on a press outside the menu or on Escape. Listeners exist only
  // while it is open, and the cleanup removes them, so a closed menu costs
  // nothing.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node))
        setExportOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  // The size the current choices would save, shown in the menu. Computed only
  // while the menu is open.
  const exportSizeText = useMemo(() => {
    if (!exportOpen || viewport === null) return null;
    const plan = planExport(
      exportArea,
      exportQuality,
      dim,
      viewport,
      window.devicePixelRatio || 1,
      aspect,
      textured,
    );
    return `${plan.pixelWidth} × ${plan.pixelHeight} px${
      plan.clamped ? " (reduced to fit)" : ""
    }`;
  }, [exportOpen, exportArea, exportQuality, dim, viewport, aspect, textured]);

  // --- Drawing ------------------------------------------------------------

  // One scene painter for both the on-screen canvas and the exporter, so an
  // exported image can never drift from what the preview draws. It takes the
  // context, viewport and pixel ratio as arguments (idiom: pass what varies,
  // close over what does not), which is what lets Export call it with a
  // different viewport on an offscreen canvas.
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, vp: Viewport, ratio: number) => {
      // The base transform: everything downstream then works in CSS pixels and
      // drawPreview composes its projection on top with `transform`.
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // The textured terrain is drawn by the GPU first, then handed to
      // drawPreview to copy in place of the flat bitmap. Anything missing (no
      // WebGL2, textures still loading) leaves `screenTerrain` unset and the
      // flat bitmap is drawn at the same squash instead.
      let screenTerrain: HTMLCanvasElement | undefined;
      const renderer = rendererRef.current;
      if (
        textured &&
        renderer &&
        tileBytes &&
        blendBytes &&
        cornerHeights &&
        terrainTable &&
        loadedTextures &&
        baseSnapshot
      ) {
        renderer.setTiles(tileBytes, baseSnapshot.dim);
        renderer.setCorners(cornerHeights, baseSnapshot.dim);
        renderer.setBlends(blendBytes, baseSnapshot.dim);
        renderer.setTable(
          terrainTable,
          loadedTextures.images,
          loadedTextures.masks,
        );
        renderer.setAtlases(loadedTextures.atlases);
        renderer.blendsOn = terrainBlends;
        renderer.mood = mood;
        if (renderer.render(vp, ratio)) screenTerrain = renderer.canvas;
      }
      // The sprites on the GPU too, when they draw at this zoom. Without
      // WebGL2 drawPreview draws them one by one on this canvas instead.
      let screenSprites: HTMLCanvasElement | undefined;
      if (
        textured &&
        sprites !== undefined &&
        vp.halfWidth >= SPRITE_MIN_HALF_WIDTH
      ) {
        if (spriteRendererRef.current === undefined)
          spriteRendererRef.current = SpriteRenderer.create() ?? false;
        const spriteRenderer = spriteRendererRef.current;
        if (spriteRenderer) {
          spriteRenderer.setLayer(sprites, vp.ground);
          spriteRenderer.mood = mood;
          if (spriteRenderer.render(vp, ratio))
            screenSprites = spriteRenderer.canvas;
        }
      }
      drawPreview(ctx, vp, {
        base:
          baseResult && baseSnapshot && terrain
            ? {
                result: baseResult,
                snapshot: baseSnapshot,
                terrain,
                screenTerrain,
                hiddenObjects: baseHiddenObjects,
                hideDecorations,
                minimap,
                hidePlayers,
                screenSprites,
                sprites: textured ? sprites : undefined,
              }
            : undefined,
        overlayShapes,
        gridLines: { strength: gridLines },
        orientation: showOrientation
          ? { dim, sideNames: showOrientation === "full" }
          : undefined,
        highlight,
        selection: selected,
      });
    },
    [
      baseResult,
      baseSnapshot,
      baseHiddenObjects,
      terrain,
      textured,
      tileBytes,
      blendBytes,
      cornerHeights,
      terrainTable,
      loadedTextures,
      terrainBlends,
      hideDecorations,
      mood,
      minimap,
      hidePlayers,
      sprites,
      overlayShapes,
      gridLines,
      showOrientation,
      dim,
      highlight,
      selected,
    ],
  );

  // Export. The preview's own picture is drawn into the visible canvas by the
  // effect below; this draws the same scene again onto a throwaway canvas.
  const exportPng = useCallback(async () => {
    if (viewport === null) return;
    // Open the file dialog first, then build the image while it is open.
    // The dialog is a native window run by the Rust side, so it stays
    // responsive while this page is busy; the page only has to send the
    // request. Starting `save()` before any heavy work, and yielding one
    // timer tick so the request is really sent, means the dialog appears at
    // once, and the image is usually done by the time a file is chosen.
    const savePromise = save({
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      defaultPath:
        exportArea === "map" ? "map-preview-entire.png" : "map-preview.png",
    });
    const blobPromise = (async (): Promise<Blob | null> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const plan = planExport(
        exportArea,
        exportQuality,
        dim,
        viewport,
        window.devicePixelRatio || 1,
        aspect,
        textured,
      );
      const out = document.createElement("canvas");
      out.width = plan.pixelWidth;
      out.height = plan.pixelHeight;
      const ctx = out.getContext("2d");
      if (ctx === null) return null;
      paint(ctx, plan.viewport, plan.ratio);
      // `toBlob` is canvas's own async, callback-shaped API (there is no
      // synchronous "give me PNG bytes" method), so it is wrapped in a
      // Promise. The encoding itself runs off the main thread.
      const made = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, "image/png"),
      );
      // Free the big backing store now rather than waiting for the collector.
      out.width = 0;
      out.height = 0;
      return made;
    })();
    // A rejection with no one awaiting it yet (the user still choosing) would
    // be reported as unhandled; the real handling is the await below.
    blobPromise.catch(() => {});
    const target = await savePromise;
    if (target === null) return; // cancelled; the finished image is dropped
    const blob = await blobPromise;
    if (blob === null) return;
    // `writeFile` (not `writeTextFile`) takes raw bytes, hence the
    // `Blob -> ArrayBuffer -> Uint8Array` chain.
    await writeFile(target, new Uint8Array(await blob.arrayBuffer()));
  }, [viewport, exportArea, exportQuality, dim, aspect, textured, paint]);

  // A layout effect, so the redraw for a new size lands before the browser
  // paints that size. A plain effect runs after the paint, a frame late.
  useLayoutEffect(() => {
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
    paint(ctx, viewport, ratio);
  }, [
    viewport,
    paint,
    // The renderer lives in a ref, so its creation reaches `paint` only
    // through this state.
    glState,
  ]);

  // --- Terrain glow (the Terrain Stats box) -------------------------------

  // A second canvas stacked over the map, redrawn every animation frame
  // while a terrain glows. The obvious alternative is one more layer inside
  // `paint`, which would put the whole scene, GPU terrain and sprites
  // included, on a 60 a second loop to change one opacity. Here a frame
  // costs one `fill` of a path that is only rebuilt when the view moves.
  const glowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glowTiles = useMemo(
    () =>
      glowTerrain === null || baseSnapshot === undefined
        ? null
        : glowRuns(baseSnapshot.terrain, baseSnapshot.dim, glowTerrain),
    [glowTerrain, baseSnapshot],
  );
  // `Path2D` is built once per view rather than traced inside the frame
  // callback, since panning moves every point but a pulse frame moves none.
  const glowPath = useMemo(() => {
    if (glowTiles === null || glowTiles.length === 0 || viewport === null)
      return null;
    const path = new Path2D();
    traceGlowRuns(path, viewport, glowTiles);
    return path;
  }, [glowTiles, viewport]);
  // When the current pulse began, in a ref so a pan (which rebuilds the path
  // and restarts the effect below) carries on mid pulse instead of jumping
  // back to bright on every pointer move.
  const glowClock = useRef<{
    tiles: unknown;
    start: number;
  } | null>(null);
  // The command highlight (Highlight selected command) shares this canvas and
  // this animation loop rather than adding a second mechanism. Its sets arrive
  // as sorted tile indices, so `maskRuns` stands where `glowRuns` does.
  const firstRuns = useMemo(
    () =>
      commandHighlight == null || baseSnapshot === undefined
        ? null
        : maskRuns(commandHighlight.first, baseSnapshot.dim),
    [commandHighlight, baseSnapshot],
  );
  const secondRuns = useMemo(
    () =>
      commandHighlight?.second == null || baseSnapshot === undefined
        ? null
        : maskRuns(commandHighlight.second, baseSnapshot.dim),
    [commandHighlight, baseSnapshot],
  );
  const pathOf = useCallback(
    (runs: typeof firstRuns): Path2D | null => {
      if (runs === null || runs.length === 0 || viewport === null) return null;
      const path = new Path2D();
      traceGlowRuns(path, viewport, runs);
      return path;
    },
    [viewport],
  );
  const firstPath = useMemo(() => pathOf(firstRuns), [pathOf, firstRuns]);
  const secondPath = useMemo(() => pathOf(secondRuns), [pathOf, secondRuns]);
  const anyGlow = glowPath !== null || firstPath !== null;
  useLayoutEffect(() => {
    const canvas = glowCanvasRef.current;
    if (
      canvas === null ||
      viewport === null ||
      (glowPath === null && firstPath === null)
    )
      return;
    const ratio = window.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(viewport.width * ratio));
    const backingHeight = Math.max(1, Math.round(viewport.height * ratio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    // One clock per terrain glow and per highlight, restarted when either
    // changes so a newly chosen command begins at 0 and fades in.
    const clockKey = [glowTiles, firstRuns, secondRuns];
    const sameKey =
      Array.isArray(glowClock.current?.tiles) &&
      (glowClock.current.tiles as unknown[]).every((v, i) => v === clockKey[i]);
    if (!sameKey)
      glowClock.current = { tiles: clockKey, start: performance.now() };
    const start = glowClock.current!.start;
    // A steady glow for anyone whose system asks for less motion.
    const still =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    const draw = (now: number) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      // The three colours are theme tokens (Settings > Theme), read off the
      // page's CSS variables each frame so an edit shows without a remount.
      const css = getComputedStyle(document.documentElement);
      const rgb = (name: string, fallback: string) =>
        hexToRgbTriplet(css.getPropertyValue(name), fallback);
      const terrainRgb = rgb("--terrain-glow", "255, 222, 90");
      const firstRgb = rgb("--highlight-first", "80, 220, 255");
      const secondRgb = rgb("--highlight-second", "255, 90, 220");
      // Gold by default rather than white, so the pulse still shows on snow and ice.
      if (glowPath !== null) {
        ctx.fillStyle = `rgba(${terrainRgb}, ${still ? 0.45 : glowAlpha(now - start)})`;
        ctx.fill(glowPath);
      }
      // After the terrain glow, so the highlight draws above it and both can
      // show at once. Teal for the first set and magenta for the second, fixed
      // colours chosen to read on grass, sand, snow and water and to differ
      // from the gold terrain glow.
      if (firstPath !== null) {
        if (secondPath === null) {
          // One set, or two that hold the same tiles, pulses its one colour.
          ctx.fillStyle = `rgba(${firstRgb}, ${still ? 0.45 : glowAlpha(now - start)})`;
          ctx.fill(firstPath);
        } else if (still) {
          ctx.fillStyle = `rgba(${firstRgb}, 0.35)`;
          ctx.fill(firstPath);
          ctx.fillStyle = `rgba(${secondRgb}, 0.35)`;
          ctx.fill(secondPath);
        } else {
          const { set, alpha } = alternatingGlow(now - start);
          ctx.fillStyle =
            set === 0
              ? `rgba(${firstRgb}, ${alpha})`
              : `rgba(${secondRgb}, ${alpha})`;
          ctx.fill(set === 0 ? firstPath : secondPath);
        }
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    // The cleanup is what stops the loop. Without it every pan would start
    // another loop beside the old one, each still filling its own stale path.
    return () => cancelAnimationFrame(frame);
  }, [
    glowPath,
    glowTiles,
    firstPath,
    secondPath,
    firstRuns,
    secondRuns,
    viewport,
  ]);

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
          : zoomAt(
              previous,
              factor,
              event.clientX - rect.left,
              event.clientY - rect.top,
            ),
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
    | {
        mode: "shapeCandidate";
        pointerId: number;
        x: number;
        y: number;
        travel: number;
        shapeId: string;
      }
    | { mode: "shapeDrag"; pointerId: number; shapeId: string }
    | null
  >(null);

  const readTile = useCallback(
    (clientX: number, clientY: number): TilePoint | null => {
      const canvas = canvasRef.current;
      if (canvas === null || viewport === null) return null;
      const rect = canvas.getBoundingClientRect();
      const point = screenToTile(
        viewport,
        clientX - rect.left,
        clientY - rect.top,
      );
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
      const point = screenToTile(
        viewport,
        clientX - rect.left,
        clientY - rect.top,
      );
      return tileToPercent(point, dim);
    },
    [viewport, dim],
  );

  const modifiersOf = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): OverlayDragModifiers => ({
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  });

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const tile = readTile(event.clientX, event.clientY);
    const shapeId =
      tile !== null && hitTestDragStart ? hitTestDragStart(tile) : null;
    dragRef.current =
      shapeId !== null
        ? {
            mode: "shapeCandidate",
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            travel: 0,
            shapeId,
          }
        : {
            mode: "pan",
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            travel: 0,
          };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId === event.pointerId) {
      if (drag.mode === "pan") {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        dragRef.current = {
          ...drag,
          x: event.clientX,
          y: event.clientY,
          travel: drag.travel + Math.abs(dx) + Math.abs(dy),
        };
        markUserFramed();
        setViewport((previous) =>
          previous === null
            ? previous
            : clampToCanvas(panBy(previous, dx, dy), dim),
        );
        return;
      }
      if (drag.mode === "shapeCandidate") {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const travel = drag.travel + Math.abs(dx) + Math.abs(dy);
        if (travel <= CLICK_SLOP_PX) {
          dragRef.current = {
            ...drag,
            x: event.clientX,
            y: event.clientY,
            travel,
          };
          return; // still might resolve to a click
        }
        // Crossed the slop: this gesture is now a shape drag, never a pan.
        dragRef.current = {
          mode: "shapeDrag",
          pointerId: event.pointerId,
          shapeId: drag.shapeId,
        };
      }
      // mode === "shapeDrag" (either already, or just switched into above).
      const current = dragRef.current;
      const shapeId = current?.mode === "shapeDrag" ? current.shapeId : null;
      const percent = readPercent(event.clientX, event.clientY);
      if (shapeId !== null && percent !== null && onDrag)
        onDrag(shapeId, "move", percent, modifiersOf(event));
      return;
    }
    const point = readTile(event.clientX, event.clientY);
    setHighlight(point);
    onHoverTile(point);
  };

  const endDrag = (
    event: React.PointerEvent<HTMLCanvasElement>,
    clicked: boolean,
  ) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (drag.mode === "shapeDrag") {
      // A real shape drag was in progress: deliver the final drop and never
      // fall through to a click-select, the drag itself is the completed
      // gesture.
      const percent = clicked
        ? readPercent(event.clientX, event.clientY)
        : null;
      if (percent !== null && onDrag)
        onDrag(drag.shapeId, "end", percent, modifiersOf(event));
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
          // The box takes the size the picture was drawn for, not 100%. With
          // 100% a drag of the panel divider resized the box at once and the
          // browser stretched the old picture into it until the redraw
          // landed, which showed as warping. The container clips, so a box a
          // frame behind shows a strip of background or a crop instead.
          style={
            viewport === null
              ? { width: "100%", height: "100%" }
              : { width: viewport.width, height: viewport.height }
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endDrag(event, true)}
          onPointerCancel={(event) => endDrag(event, false)}
          onPointerLeave={onPointerLeave}
          onDoubleClick={resetView}
        />
      </HelpTip>
      {anyGlow && viewport !== null && (
        <canvas
          ref={glowCanvasRef}
          className={styles.glow}
          style={{ width: viewport.width, height: viewport.height }}
          aria-hidden="true"
        />
      )}
      {(showApproximateBadge || topLeft || deNotice) && (
        <div
          className={
            hasTopRight
              ? `${styles.overlay} ${styles.overlayBelowTopRight}`
              : styles.overlay
          }
        >
          {deNotice && <span className={styles.banner}>{deNotice}</span>}
          {showApproximateBadge &&
            base?.result.notes
              .filter((note) => note.prominence === "banner")
              .map((note) => (
                <span key={note.key} className={styles.banner}>
                  {renderProse(note.text)}
                </span>
              ))}
          {/* Below any banner, in the same column, so the two never overlap. */}
          {topLeft}
        </div>
      )}
      {/* The top right corner: the map size chip, Export, then the caller's own
          buttons. A wrapping row of flat items, right-aligned, so a narrow
          panel wraps onto a second line instead of running off the map. Its
          pointer events are off so the map under the gaps still pans, and
          each child turns them back on. Drawn after the top left column so it
          stays on top of it, and that column is pushed below it
          (`overlayBelowTopRight`) so the two never overlap. */}
      {hasTopRight && (
        <div className={styles.topRight}>
          {/* The map size, drawn with the badge, so it follows the same
              condition. `dim` is post override_map_size, what was actually
              drawn, and the player half is the settings value (see
              `playerCount`'s own doc). */}
          {showApproximateBadge && playerCount !== undefined && (
            <HelpTip id="preview.mapSummary">
              <span className={styles.badge}>
                {dim}×{dim}, {playerCount}{" "}
                {playerCount === 1 ? "player" : "players"}
              </span>
            </HelpTip>
          )}
          {showApproximateBadge && staleNotice}
          {showExportButton && (
            <span ref={exportMenuRef} className={styles.exportWrap}>
              <HelpTip id="preview.exportPng">
                <button
                  type="button"
                  className={styles.exportButton}
                  aria-expanded={exportOpen}
                  onClick={() => setExportOpen((open) => !open)}
                >
                  Export
                </button>
              </HelpTip>
              {exportOpen && (
                <div className={styles.exportMenu} role="dialog">
                  <div className={styles.exportGroup}>
                    {EXPORT_AREAS.map((option) => (
                      <HelpTip key={option.id} id={option.helpId}>
                        <label className={styles.exportOption}>
                          <input
                            type="radio"
                            name="preview-export-area"
                            checked={exportArea === option.id}
                            onChange={() => setExportArea(option.id)}
                          />
                          {option.label}
                        </label>
                      </HelpTip>
                    ))}
                  </div>
                  <HelpTip id="preview.exportQuality">
                    <label className={styles.exportOption}>
                      Quality
                      <select
                        value={exportQuality}
                        onChange={(event) =>
                          setExportQuality(event.target.value as ExportQuality)
                        }
                      >
                        {EXPORT_QUALITIES.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </HelpTip>
                  {exportSizeText !== null && (
                    <div className={styles.exportSize}>{exportSizeText}</div>
                  )}
                  <HelpTip id="preview.exportSave">
                    <button
                      type="button"
                      className={styles.exportButton}
                      disabled={exporting || viewport === null}
                      onClick={() => {
                        setExporting(true);
                        void exportPng()
                          .then(() => setExportOpen(false))
                          .finally(() => setExporting(false));
                      }}
                    >
                      {exporting ? "Saving…" : "Save PNG…"}
                    </button>
                  </HelpTip>
                </div>
              )}
            </span>
          )}
          {topRightControls}
          {/* A full width item, so it always starts a new line of the
              wrapping row, directly under whatever the buttons wrapped to. */}
          {topRightPanel !== undefined && topRightPanel !== null && (
            <div className={styles.topRightPanelRow}>
              <div
                className={
                  topRightPanelWide
                    ? `${styles.topRightPanel} ${styles.topRightPanelWide}`
                    : styles.topRightPanel
                }
              >
                {topRightPanel}
              </div>
            </div>
          )}
        </div>
      )}
      {/* One column anchored to the canvas's bottom edge: the caller's box on
          top, then the button row. A column rather than two absolutely
          positioned things, so the box always sits directly above the row
          however many lines the row wraps to on a narrow panel. Its own
          pointer events are off so the map under the gaps still pans, and
          each child turns them back on. */}
      <div className={styles.bottomArea}>
        {/* Truthiness, not just null and undefined. A caller's
            `open && <Box />` hands over `false` when closed, and an empty
            panel still drew its border as a line over the buttons. */}
        {bottomPanel !== undefined &&
          bottomPanel !== null &&
          bottomPanel !== false && (
            <div className={styles.panel}>{bottomPanel}</div>
          )}
        <div className={styles.bottomRow}>
          <div className={styles.zoomControls}>
            {bottomControls}
            <div className={styles.zoomGroup}>
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
                        : zoomAt(
                            previous,
                            1 / ZOOM_STEP,
                            previous.width / 2,
                            previous.height / 2,
                          ),
                    );
                  }}
                >
                  −
                </button>
              </HelpTip>
              <HelpTip id="preview.zoomFit">
                <button
                  type="button"
                  className={styles.zoomButton}
                  aria-label="Fit map"
                  onClick={resetView}
                >
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
                        : zoomAt(
                            previous,
                            ZOOM_STEP,
                            previous.width / 2,
                            previous.height / 2,
                          ),
                    );
                  }}
                >
                  +
                </button>
              </HelpTip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
