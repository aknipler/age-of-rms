import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { load, type Store } from "@tauri-apps/plugin-store";

const DE_TEXTURES_STORE_FILE = "settings.json";
const DE_TEXTURES_KEY = "previewDeTextures";
const SMALL_TREES_KEY = "previewSmallTrees";
const TERRAIN_BLENDS_KEY = "previewTerrainBlends";
const HIDE_DECORATIONS_KEY = "previewHideDecorations";
const HIDE_PLAYER_CIRCLES_KEY = "previewHidePlayerCircles";
const RECORD_TIMING_KEY = "previewRecordTiming";
import {
  DEFAULT_TERRAIN_COLOR_MODE,
  type TerrainColorMode,
} from "../../preview/render/palette";
import type { TilePoint, Viewport } from "../../preview/render/projection";

/**
 * Current vs Final (preview-design Sec.5). Used to live in `fixture.ts` as
 * `FixtureView`, moved here when the fixture was deleted (CREATION_PLAN
 * 4.3's "swaps the fixture for the worker"), since it was never actually a
 * fixture concept, just borrowed that file because nowhere else existed yet.
 *
 * Sec.5's real semantics (Current is a SECOND generatePreview run over the
 * script truncated at a pinned line, not a stage snapshot) are live as of
 * CREATION_PLAN 4.6. The cut line itself is NOT here: it lives in
 * `PreviewCutContext`, which has to render below `AppContent` to read the
 * shared selection anchor, while this provider sits above it. This flag
 * decides only WHICH of the two runs is generated (PreviewResultContext).
 */
export type PreviewViewMode = "current" | "final";

/**
 * The preview's view settings, held ABOVE the tab switch.
 *
 * Why this exists rather than plain useState inside PreviewPane: the Breakdown
 * and Code tabs are a conditional render in App, so the inactive tab is
 * genuinely unmounted, not hidden. React discards the state of an unmounted
 * component, so a seed you re-rolled to on Breakdown would be back to 1 after
 * a trip to Code and back, state loss that looks exactly like a bug and has
 * no clue pointing at the tab switch. Same reasoning that lifted
 * useSharedSelection into App (App.tsx) and that keeps the Monaco model at
 * module scope in useDocument.ts.
 *
 * Deliberately NOT persisted to the Tauri store (except `deTextures`, the
 * isometric switch), unlike the help and
 * generation settings. Those describe how you want the app to behave; this
 * describes where you happen to be looking right now, and a seed restored from
 * three sessions ago would be noise rather than a convenience.
 *
 * Zoom and pan are NOT in this interface. See PreviewViewportProvider below.
 * They used to be argued out of here on the grounds that they are "derived
 * from the canvas's own pixel size, which does not exist until it mounts and
 * measures". That reasoning covers the very first mount, correctly, and does
 * not cover a tab switch: the container is the same shared MapSidePanel on
 * both tabs, so a remount re-measures the same size and there is no reason to
 * throw the user's framing away. Split into a second context, not folded into
 * this one, because viewport changes on every pixel of a drag or wheel tick
 * and this one is read by PreviewPane's whole control row, coupling them
 * would re-render the seed/colour-mode controls on every drag frame.
 */
export interface PreviewViewValue {
  /** Current vs Final (preview-design Sec.5). */
  view: PreviewViewMode;
  setView: (view: PreviewViewMode) => void;
  /** Current <-> Final, for the hotkey (App.tsx), same toggle the radio pair drives. */
  toggleView: () => void;
  /** The seed the arrangement is drawn from. */
  seed: number;
  setSeed: (seed: number) => void;
  /** Draws a new random seed, the Re-roll button's action, also bound to a hotkey (App.tsx). */
  reseed: () => void;
  /** Game (texture) or Minimap (data colour class) terrain colours. */
  colorMode: TerrainColorMode;
  setColorMode: (mode: TerrainColorMode) => void;
  /**
   * Draw the map isometrically with the terrain textures from the user's DE
   * install instead of flat colours (docs/preview-de-textures-design.md).
   * Off by default, and both the app's preview and the Land Placement panel
   * follow it, so the two canvases always agree.
   */
  deTextures: boolean;
  setDeTextures: (on: boolean) => void;
  /**
   * Draw trees at half size in the DE textures view, as DE's own Small
   * Trees option does. Remembered like `deTextures`, off by default as in
   * the game.
   */
  smallTrees: boolean;
  setSmallTrees: (on: boolean) => void;
  /**
   * Blend each terrain into its neighbours in the DE textures view, as the
   * game does. On by default. Off, every tile ends at its own edge, so a
   * scripter can read exactly which tile holds which terrain.
   */
  terrainBlends: boolean;
  setTerrainBlends: (on: boolean) => void;
  /**
   * Leave out the circles of decorations terrains spawn (grass, rocks,
   * flowers), so resources and scripted objects stand out. Off by default.
   * Their sprites in the textured view are unaffected.
   */
  hideDecorations: boolean;
  setHideDecorations: (on: boolean) => void;
  /**
   * Leave out the numbered player circles in the flat and textured views.
   * Off by default. The minimap view never draws them, whatever this says.
   */
  hidePlayerCircles: boolean;
  setHidePlayerCircles: (on: boolean) => void;
  /**
   * Time each generation for the hourglass (generationTiming.ts). On by
   * default. Off, the worker records nothing and the hourglass button goes.
   */
  recordTiming: boolean;
  setRecordTiming: (on: boolean) => void;
  /**
   * Regenerate the preview whenever the script is edited. On by default. Off,
   * an edit leaves the map as it is and marks it stale; the seed, the
   * generation settings and the Generate action still redraw it.
   */
  regenOnEdit: boolean;
  setRegenOnEdit: (on: boolean) => void;
  /**
   * Notes the user hid, as `<file path>\0<note id>` so one set serves every
   * script and a hidden note stays hidden in the script it was hidden in.
   */
  hiddenNotes: ReadonlySet<string>;
  hideNote: (filePath: string | null, noteId: string) => void;
  /** Brings back every note hidden in one script. */
  restoreNotes: (filePath: string | null) => void;
  /**
   * The clicked tile, or null when nothing is selected. Its readout replaces
   * the hover readout for as long as it is set, so a tile's details stay
   * legible while the pointer moves away to the notes drawer or the code.
   *
   * COORDINATES, not a captured description: everything shown about the tile
   * is re-derived from the current grid (tileInfo.ts), so a re-roll updates
   * the panel in place instead of pinning last generation's terrain under a
   * tile that no longer has it.
   */
  selectedTile: TilePoint | null;
  /** Selects a tile, or clears the selection when the same tile is passed again. */
  toggleSelectedTile: (tile: TilePoint) => void;
  clearSelectedTile: () => void;
  /**
   * Object names the canvas must not draw, chosen in the preview's Obj. List.
   *
   * A set of HIDDEN names rather than a map of visible ones, because the
   * default is "draw everything": an empty set is the whole default state, and
   * an object that appears for the first time after an edit is visible without
   * anyone having to add it. Storing visibility per object would make a new
   * name's default depend on whether the table had seen it yet.
   */
  hiddenObjects: ReadonlySet<string>;
  /** Ticks/unticks one object's Visualise in Preview box. */
  toggleObjectHidden: (objectRef: string) => void;
  /** Re-ticks everything, so a panel full of unticked boxes has one way back. */
  showAllObjects: () => void;
}

const PreviewViewCtx = createContext<PreviewViewValue | null>(null);

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<PreviewViewMode>("final");
  const toggleView = useCallback(
    () => setView((v) => (v === "current" ? "final" : "current")),
    [],
  );
  const [seed, setSeed] = useState(1);
  // Math.random is fine HERE. Sec.8's ban on it covers
  // src/preview/generator/, where reproducibility is the whole contract.
  // Picking which seed to show a user is not part of that contract;
  // consuming it deterministically is.
  const reseed = useCallback(
    () => setSeed(Math.floor(Math.random() * 1_000_000)),
    [],
  );
  const [colorMode, setColorMode] = useState<TerrainColorMode>(
    DEFAULT_TERRAIN_COLOR_MODE,
  );
  const [regenOnEdit, setRegenOnEdit] = useState(true);
  // The isometric switch is the one view setting that IS remembered across
  // launches: it is a way of looking the user picks and keeps, unlike a seed.
  // Same settings.json and load-then-write pattern as useRememberedTab.ts.
  const [deTextures, setDeTexturesState] = useState(false);
  const [deStore, setDeStore] = useState<Store | null>(null);
  // Set once the user flips the switch before the store answers, so a slow
  // load cannot overwrite their click with the saved value (a ref, since the
  // load callback would otherwise read a stale closure).
  const deChosenRef = useRef(false);
  const [smallTrees, setSmallTreesState] = useState(false);
  const treesChosenRef = useRef(false);
  const [terrainBlends, setTerrainBlendsState] = useState(true);
  const blendsChosenRef = useRef(false);
  const [hideDecorations, setHideDecorationsState] = useState(false);
  const decorationsChosenRef = useRef(false);
  const [hidePlayerCircles, setHidePlayerCirclesState] = useState(false);
  const playerCirclesChosenRef = useRef(false);
  const [recordTiming, setRecordTimingState] = useState(true);
  const timingChosenRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    load(DE_TEXTURES_STORE_FILE, { autoSave: true, defaults: {} })
      .then(async (loaded) => {
        if (cancelled) return;
        const saved = await loaded.get<unknown>(DE_TEXTURES_KEY);
        if (cancelled) return;
        if (!deChosenRef.current && typeof saved === "boolean")
          setDeTexturesState(saved);
        const savedTrees = await loaded.get<unknown>(SMALL_TREES_KEY);
        if (cancelled) return;
        if (!treesChosenRef.current && typeof savedTrees === "boolean")
          setSmallTreesState(savedTrees);
        const savedBlends = await loaded.get<unknown>(TERRAIN_BLENDS_KEY);
        if (cancelled) return;
        if (!blendsChosenRef.current && typeof savedBlends === "boolean")
          setTerrainBlendsState(savedBlends);
        const savedDecorations =
          await loaded.get<unknown>(HIDE_DECORATIONS_KEY);
        if (cancelled) return;
        if (
          !decorationsChosenRef.current &&
          typeof savedDecorations === "boolean"
        )
          setHideDecorationsState(savedDecorations);
        const savedPlayerCircles = await loaded.get<unknown>(
          HIDE_PLAYER_CIRCLES_KEY,
        );
        if (cancelled) return;
        if (
          !playerCirclesChosenRef.current &&
          typeof savedPlayerCircles === "boolean"
        )
          setHidePlayerCirclesState(savedPlayerCircles);
        const savedTiming = await loaded.get<unknown>(RECORD_TIMING_KEY);
        if (cancelled) return;
        if (!timingChosenRef.current && typeof savedTiming === "boolean")
          setRecordTimingState(savedTiming);
        // Only after the read, so the default is never written over it.
        setDeStore(loaded);
      })
      .catch(() => {
        // No store (a test, or a plain browser): the switch just is not
        // remembered.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (deStore !== null) void deStore.set(DE_TEXTURES_KEY, deTextures);
  }, [deStore, deTextures]);
  const setDeTextures = useCallback((on: boolean) => {
    deChosenRef.current = true;
    setDeTexturesState(on);
  }, []);
  useEffect(() => {
    if (deStore !== null) void deStore.set(SMALL_TREES_KEY, smallTrees);
  }, [deStore, smallTrees]);
  const setSmallTrees = useCallback((on: boolean) => {
    treesChosenRef.current = true;
    setSmallTreesState(on);
  }, []);
  useEffect(() => {
    if (deStore !== null) void deStore.set(TERRAIN_BLENDS_KEY, terrainBlends);
  }, [deStore, terrainBlends]);
  const setTerrainBlends = useCallback((on: boolean) => {
    blendsChosenRef.current = true;
    setTerrainBlendsState(on);
  }, []);
  useEffect(() => {
    if (deStore !== null)
      void deStore.set(HIDE_DECORATIONS_KEY, hideDecorations);
  }, [deStore, hideDecorations]);
  const setHideDecorations = useCallback((on: boolean) => {
    decorationsChosenRef.current = true;
    setHideDecorationsState(on);
  }, []);
  useEffect(() => {
    if (deStore !== null)
      void deStore.set(HIDE_PLAYER_CIRCLES_KEY, hidePlayerCircles);
  }, [deStore, hidePlayerCircles]);
  const setHidePlayerCircles = useCallback((on: boolean) => {
    playerCirclesChosenRef.current = true;
    setHidePlayerCirclesState(on);
  }, []);
  useEffect(() => {
    if (deStore !== null) void deStore.set(RECORD_TIMING_KEY, recordTiming);
  }, [deStore, recordTiming]);
  const setRecordTiming = useCallback((on: boolean) => {
    timingChosenRef.current = true;
    setRecordTimingState(on);
  }, []);
  const [hiddenNotes, setHiddenNotes] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const hideNote = useCallback(
    (filePath: string | null, noteId: string) =>
      setHiddenNotes((current) =>
        new Set(current).add(`${filePath ?? ""}\0${noteId}`),
      ),
    [],
  );
  const restoreNotes = useCallback(
    (filePath: string | null) =>
      setHiddenNotes((current) => {
        const prefix = `${filePath ?? ""}\0`;
        return new Set([...current].filter((id) => !id.startsWith(prefix)));
      }),
    [],
  );
  const [selectedTile, setSelectedTile] = useState<TilePoint | null>(null);
  const [hiddenObjects, setHiddenObjects] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // The updater form rather than reading `selectedTile` from the closure:
  // this callback is memoised with an empty dependency list, so a captured
  // `selectedTile` would be whatever it was on the first render forever, a
  // stale closure, and the classic way a toggle stops toggling after one use.
  const toggleSelectedTile = useCallback((tile: TilePoint) => {
    setSelectedTile((current) =>
      current !== null && current.x === tile.x && current.y === tile.y
        ? null
        : tile,
    );
  }, []);

  const clearSelectedTile = useCallback(() => setSelectedTile(null), []);

  // A NEW Set every time rather than mutating the existing one. React compares
  // state by reference, so `current.add(name); return current` would change
  // what the app draws without ever telling anything to re-render, the
  // classic mutable-state-in-a-hook trap, and it bites harder with Set/Map
  // than with arrays because there is no spread-by-habit to fall back on.
  const toggleObjectHidden = useCallback((objectRef: string) => {
    setHiddenObjects((current) => {
      const next = new Set(current);
      if (!next.delete(objectRef)) next.add(objectRef);
      return next;
    });
  }, []);

  const showAllObjects = useCallback(
    () => setHiddenObjects(new Set<string>()),
    [],
  );

  // Memoised so the object identity only changes when a value does. Without
  // it every App re-render (every keystroke, since the parse result lives up
  // there) would hand a fresh object to every consumer and re-render the
  // whole preview column for nothing.
  const value = useMemo(
    () => ({
      view,
      setView,
      toggleView,
      seed,
      setSeed,
      reseed,
      colorMode,
      setColorMode,
      deTextures,
      setDeTextures,
      smallTrees,
      setSmallTrees,
      terrainBlends,
      setTerrainBlends,
      hideDecorations,
      setHideDecorations,
      hidePlayerCircles,
      setHidePlayerCircles,
      recordTiming,
      setRecordTiming,
      regenOnEdit,
      setRegenOnEdit,
      hiddenNotes,
      hideNote,
      restoreNotes,
      selectedTile,
      toggleSelectedTile,
      clearSelectedTile,
      hiddenObjects,
      toggleObjectHidden,
      showAllObjects,
    }),
    [
      view,
      toggleView,
      seed,
      reseed,
      colorMode,
      deTextures,
      setDeTextures,
      smallTrees,
      setSmallTrees,
      terrainBlends,
      setTerrainBlends,
      hideDecorations,
      setHideDecorations,
      hidePlayerCircles,
      setHidePlayerCircles,
      recordTiming,
      setRecordTiming,
      regenOnEdit,
      hiddenNotes,
      hideNote,
      restoreNotes,
      selectedTile,
      toggleSelectedTile,
      clearSelectedTile,
      hiddenObjects,
      toggleObjectHidden,
      showAllObjects,
    ],
  );

  return (
    <PreviewViewCtx.Provider value={value}>{children}</PreviewViewCtx.Provider>
  );
}

export function usePreviewView(): PreviewViewValue {
  const ctx = useContext(PreviewViewCtx);
  if (!ctx)
    throw new Error("usePreviewView must be used within PreviewViewProvider");
  return ctx;
}

/**
 * The DE textures switch alone, off outside the provider. For the Land
 * Placement panel's canvas, which the app always renders inside the provider
 * but its own tests render without one, and which has no use for the rest
 * of this context.
 */
export function useDeTexturesSetting(): boolean {
  return useContext(PreviewViewCtx)?.deTextures ?? false;
}

/** The Small Trees setting alone, off outside the provider, for the same reason. */
export function useSmallTreesSetting(): boolean {
  return useContext(PreviewViewCtx)?.smallTrees ?? false;
}

/** The terrain blends setting alone, on outside the provider, for the same reason. */
export function useTerrainBlendsSetting(): boolean {
  return useContext(PreviewViewCtx)?.terrainBlends ?? true;
}

/** The hide decorations setting alone, off outside the provider, for the same reason. */
export function useHideDecorationsSetting(): boolean {
  return useContext(PreviewViewCtx)?.hideDecorations ?? false;
}

/** The hide player circles setting alone, off outside the provider, for the same reason. */
export function useHidePlayerCirclesSetting(): boolean {
  return useContext(PreviewViewCtx)?.hidePlayerCircles ?? false;
}

/**
 * The canvas's camera (PreviewCanvas), held above the tab switch for the same
 * reason as PreviewViewValue above: Breakdown and Code unmount PreviewCanvas
 * on every switch, and without this, a user's zoom/pan reset to "fit" every
 * time they looked away and back, reported as a bug (2026-08-06), not a
 * feature, which it never was; the original design note undersold how often
 * a user would actually cross the tab boundary mid-inspection.
 *
 * `userFramed` mirrors PreviewCanvas's local ref of the same name: the ref is
 * still what the ResizeObserver/snapshot-change effects read (they need a
 * synchronous, always-current value inside closures that don't depend on it,
 * which is exactly what a ref is for and a bare context value is not), and
 * this is what makes that ref's value survive the unmount that recreates it.
 * PreviewCanvas seeds its ref from this on mount and writes through to this
 * on every change, so there are two copies for one instant each render, never
 * two sources of truth.
 */
export interface PreviewViewportValue {
  viewport: Viewport | null;
  setViewport: Dispatch<SetStateAction<Viewport | null>>;
  userFramed: boolean;
  setUserFramed: (framed: boolean) => void;
}

const PreviewViewportCtx = createContext<PreviewViewportValue | null>(null);

export function PreviewViewportProvider({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [userFramed, setUserFramed] = useState(false);

  // NOT memoised the way PreviewViewValue is above. viewport changes on every
  // pixel of a drag or wheel tick, so a memoised object here would still be a
  // fresh reference on nearly every render regardless, the useMemo would buy
  // nothing but a dependency array to keep in sync, and PreviewCanvas is
  // deliberately the only consumer, so there is no sibling to protect from
  // the churn.
  const value: PreviewViewportValue = {
    viewport,
    setViewport,
    userFramed,
    setUserFramed,
  };

  return (
    <PreviewViewportCtx.Provider value={value}>
      {children}
    </PreviewViewportCtx.Provider>
  );
}

export function usePreviewViewport(): PreviewViewportValue {
  const ctx = useContext(PreviewViewportCtx);
  if (!ctx)
    throw new Error(
      "usePreviewViewport must be used within PreviewViewportProvider",
    );
  return ctx;
}
