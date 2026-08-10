import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  clampSidePanelWidth,
  DEFAULT_SIDE_PANEL_WIDTH,
  isSidePanelWidth,
} from "./sidePanelLayout";

// Same store file as the help (1.7) and generation (2.5) settings, different
// keys — one settings.json for everything that is "how you want the app to
// behave", per generationSettingsConstants.ts's own note.
const SIDE_PANEL_STORE_FILE = "settings.json";
const SIDE_PANEL_WIDTH_KEY = "sidePanelWidth";
const SIDE_PANEL_COLLAPSED_KEY = "sidePanelCollapsed";

/**
 * The map preview + reference column's width and collapsed state
 * (CREATION_PLAN 4.4).
 *
 * Two separate reasons this is a context above the tab switch rather than
 * state inside `MapSidePanel`, and they are worth telling apart:
 *
 *  1. Breakdown and Code each render their OWN `MapSidePanel` element, and
 *     the inactive tab is unmounted, not hidden. Local state would therefore
 *     be two independent widths that reset on every switch — the same trap
 *     `PreviewViewContext.tsx` exists to document, and CREATION_PLAN 4.4
 *     points at by name.
 *  2. The width is shared BETWEEN the tabs by design. Dragging on Code and
 *     finding Breakdown unchanged would read as a bug, not as per-tab
 *     configuration.
 *
 * Unlike `PreviewViewValue` this IS persisted. The distinction that context
 * draws is the right one and lands on the other side here: a seed is where
 * you happen to be looking right now, a panel width is how you want the app
 * laid out, and layout is exactly what a user expects to still be there
 * tomorrow.
 */
export interface SidePanelLayoutValue {
  /** Current width in CSS pixels. Meaningful even while collapsed — that is what expanding restores. */
  width: number;
  collapsed: boolean;
  /**
   * Updates the live width WITHOUT touching the store. Called once per
   * pointermove during a drag, which is up to 60 times a second: every write
   * to the Tauri store is an IPC hop into the Rust host, so persisting per
   * frame would put a disk-backed round trip in the middle of a drag loop for
   * a value that only matters once the user lets go.
   */
  setWidth: (width: number) => void;
  /** Writes the current width to the store. Call once, when a drag ends. */
  commitWidth: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

const SidePanelLayoutContext = createContext<SidePanelLayoutValue | null>(null);

export function SidePanelLayoutProvider({ children }: { children: ReactNode }) {
  const [width, setWidthState] = useState(DEFAULT_SIDE_PANEL_WIDTH);
  const [collapsed, setCollapsedState] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  // `commitWidth` takes no argument, so it has to read the width at the
  // moment it is called. Reading the `width` state variable would capture
  // whatever it was when the callback was created — a stale closure, and the
  // one frame that matters is the last one before pointerup. A ref is always
  // current by construction, which is the whole reason to reach for one.
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    let cancelled = false;
    load(SIDE_PANEL_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const savedWidth = await loadedStore.get<unknown>(SIDE_PANEL_WIDTH_KEY);
      if (!cancelled && isSidePanelWidth(savedWidth)) setWidthState(savedWidth);
      const savedCollapsed = await loadedStore.get<unknown>(SIDE_PANEL_COLLAPSED_KEY);
      if (!cancelled && typeof savedCollapsed === "boolean") setCollapsedState(savedCollapsed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setWidth = useCallback((next: number) => {
    setWidthState(clampSidePanelWidth(next));
  }, []);

  const commitWidth = useCallback(() => {
    void store?.set(SIDE_PANEL_WIDTH_KEY, widthRef.current);
  }, [store]);

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      void store?.set(SIDE_PANEL_COLLAPSED_KEY, next);
    },
    [store],
  );

  // Memoised for the same reason PreviewViewProvider's value is: App
  // re-renders on every keystroke (the parse result lives up there), and an
  // unmemoised object would hand every consumer a new identity each time.
  const value = useMemo<SidePanelLayoutValue>(
    () => ({ width, collapsed, setWidth, commitWidth, setCollapsed }),
    [width, collapsed, setWidth, commitWidth, setCollapsed],
  );

  return <SidePanelLayoutContext.Provider value={value}>{children}</SidePanelLayoutContext.Provider>;
}

export function useSidePanelLayout(): SidePanelLayoutValue {
  const ctx = useContext(SidePanelLayoutContext);
  if (!ctx) throw new Error("useSidePanelLayout must be used within a SidePanelLayoutProvider");
  return ctx;
}
