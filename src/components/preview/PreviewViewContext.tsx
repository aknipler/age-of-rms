import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  DEFAULT_TERRAIN_COLOR_MODE,
  type TerrainColorMode,
} from "../../preview/render/palette";
import type { Viewport } from "../../preview/render/projection";

/**
 * Current vs Final (preview-design Sec.5). Used to live in `fixture.ts` as
 * `FixtureView` — moved here when the fixture was deleted (CREATION_PLAN
 * 4.3's "swaps the fixture for the worker"), since it was never actually a
 * fixture concept, just borrowed that file because nowhere else existed yet.
 *
 * Sec.5's real semantics — Current is a SECOND generatePreview run over the
 * script truncated at a pinned line, not a stage snapshot — need
 * `truncateAst()` and a pin-line UI control, neither of which exist yet (no
 * CREATION_PLAN step currently owns building them). Until then both toggle
 * positions drive the identical real result; see PreviewPane.tsx.
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
}

const PreviewViewCtx = createContext<PreviewViewValue | null>(null);

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<PreviewViewMode>("final");
  const [seed, setSeed] = useState(1);
  const [colorMode, setColorMode] = useState<TerrainColorMode>(DEFAULT_TERRAIN_COLOR_MODE);

  // Memoised so the object identity only changes when a value does. Without
  // it every App re-render — every keystroke, since the parse result lives up
  // there — would hand a fresh object to every consumer and re-render the
  // whole preview column for nothing.
  const value = useMemo(
    () => ({ view, setView, seed, setSeed, colorMode, setColorMode }),
    [view, seed, colorMode],
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
  const value: PreviewViewportValue = { viewport, setViewport, userFramed, setUserFramed };

  return <PreviewViewportCtx.Provider value={value}>{children}</PreviewViewportCtx.Provider>;
}

export function usePreviewViewport(): PreviewViewportValue {
  const ctx = useContext(PreviewViewportCtx);
  if (!ctx) throw new Error("usePreviewViewport must be used within PreviewViewportProvider");
  return ctx;
}
