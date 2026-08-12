import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { DEFAULT_TERRAIN_COLOR_MODE, type TerrainColorMode } from "../../preview/render/palette";
import type { TilePoint, Viewport } from "../../preview/render/projection";

/**
 * Current vs Final (preview-design Sec.5). Used to live in `fixture.ts` as
 * `FixtureView` — moved here when the fixture was deleted (CREATION_PLAN
 * 4.3's "swaps the fixture for the worker"), since it was never actually a
 * fixture concept, just borrowed that file because nowhere else existed yet.
 *
 * Sec.5's real semantics — Current is a SECOND generatePreview run over the
 * script truncated at a pinned line, not a stage snapshot — are live as of
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
 * a trip to Code and back — state loss that looks exactly like a bug and has
 * no clue pointing at the tab switch. Same reasoning that lifted
 * useSharedSelection into App (App.tsx) and that keeps the Monaco model at
 * module scope in useDocument.ts.
 *
 * Deliberately NOT persisted to the Tauri store, unlike the help and
 * generation settings. Those describe how you want the app to behave; this
 * describes where you happen to be looking right now, and a seed restored from
 * three sessions ago would be noise rather than a convenience.
 *
 * Zoom and pan are NOT in this interface — see PreviewViewportProvider below.
 * They used to be argued out of here on the grounds that they are "derived
 * from the canvas's own pixel size, which does not exist until it mounts and
 * measures". That reasoning covers the very first mount, correctly, and does
 * not cover a tab switch: the container is the same shared MapSidePanel on
 * both tabs, so a remount re-measures the same size and there is no reason to
 * throw the user's framing away. Split into a second context, not folded into
 * this one, because viewport changes on every pixel of a drag or wheel tick
 * and this one is read by PreviewPane's whole control row — coupling them
 * would re-render the seed/colour-mode controls on every drag frame.
 */
export interface PreviewViewValue {
  /** Current vs Final (preview-design Sec.5). */
  view: PreviewViewMode;
  setView: (view: PreviewViewMode) => void;
  /** The seed the arrangement is drawn from. */
  seed: number;
  setSeed: (seed: number) => void;
  /** Game (texture) or Minimap (data colour class) terrain colours. */
  colorMode: TerrainColorMode;
  setColorMode: (mode: TerrainColorMode) => void;
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
   * Object names the canvas must not draw, chosen in the reference table's
   * Preview Obj. List.
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
  const [seed, setSeed] = useState(1);
  const [colorMode, setColorMode] = useState<TerrainColorMode>(DEFAULT_TERRAIN_COLOR_MODE);
  const [selectedTile, setSelectedTile] = useState<TilePoint | null>(null);
  const [hiddenObjects, setHiddenObjects] = useState<ReadonlySet<string>>(() => new Set<string>());

  // The updater form rather than reading `selectedTile` from the closure:
  // this callback is memoised with an empty dependency list, so a captured
  // `selectedTile` would be whatever it was on the first render forever — a
  // stale closure, and the classic way a toggle stops toggling after one use.
  const toggleSelectedTile = useCallback((tile: TilePoint) => {
    setSelectedTile((current) =>
      current !== null && current.x === tile.x && current.y === tile.y ? null : tile,
    );
  }, []);

  const clearSelectedTile = useCallback(() => setSelectedTile(null), []);

  // A NEW Set every time rather than mutating the existing one. React compares
  // state by reference, so `current.add(name); return current` would change
  // what the app draws without ever telling anything to re-render — the
  // classic mutable-state-in-a-hook trap, and it bites harder with Set/Map
  // than with arrays because there is no spread-by-habit to fall back on.
  const toggleObjectHidden = useCallback((objectRef: string) => {
    setHiddenObjects((current) => {
      const next = new Set(current);
      if (!next.delete(objectRef)) next.add(objectRef);
      return next;
    });
  }, []);

  const showAllObjects = useCallback(() => setHiddenObjects(new Set<string>()), []);

  // Memoised so the object identity only changes when a value does. Without
  // it every App re-render — every keystroke, since the parse result lives up
  // there — would hand a fresh object to every consumer and re-render the
  // whole preview column for nothing.
  const value = useMemo(
    () => ({
      view,
      setView,
      seed,
      setSeed,
      colorMode,
      setColorMode,
      selectedTile,
      toggleSelectedTile,
      clearSelectedTile,
      hiddenObjects,
      toggleObjectHidden,
      showAllObjects,
    }),
    [
      view,
      seed,
      colorMode,
      selectedTile,
      toggleSelectedTile,
      clearSelectedTile,
      hiddenObjects,
      toggleObjectHidden,
      showAllObjects,
    ],
  );

  return <PreviewViewCtx.Provider value={value}>{children}</PreviewViewCtx.Provider>;
}

export function usePreviewView(): PreviewViewValue {
  const ctx = useContext(PreviewViewCtx);
  if (!ctx) throw new Error("usePreviewView must be used within PreviewViewProvider");
  return ctx;
}

/**
 * The canvas's camera (PreviewCanvas), held above the tab switch for the same
 * reason as PreviewViewValue above: Breakdown and Code unmount PreviewCanvas
 * on every switch, and without this, a user's zoom/pan reset to "fit" every
 * time they looked away and back — reported as a bug (2026-08-06), not a
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
  // fresh reference on nearly every render regardless — the useMemo would buy
  // nothing but a dependency array to keep in sync, and PreviewCanvas is
  // deliberately the only consumer, so there is no sibling to protect from
  // the churn.
  const value: PreviewViewportValue = {
    viewport,
    setViewport,
    userFramed,
    setUserFramed,
  };

  return <PreviewViewportCtx.Provider value={value}>{children}</PreviewViewportCtx.Provider>;
}

export function usePreviewViewport(): PreviewViewportValue {
  const ctx = useContext(PreviewViewportCtx);
  if (!ctx) throw new Error("usePreviewViewport must be used within PreviewViewportProvider");
  return ctx;
}
