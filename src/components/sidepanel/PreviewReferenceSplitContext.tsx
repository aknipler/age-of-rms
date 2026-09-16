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
  clampPreviewFraction,
  DEFAULT_PREVIEW_FRACTION,
  isPreviewFraction,
  isPreviewReferenceCollapsedSide,
  type PreviewReferenceCollapsedSide,
} from "./previewReferenceSplit";

// Same store file as the side panel's own width/collapsed keys, and the help
// (1.7) and generation (2.5) settings before it, different keys, one
// settings.json for everything that is "how you want the app to behave".
const SPLIT_STORE_FILE = "settings.json";
const PREVIEW_FRACTION_KEY = "previewReferenceFraction";
const COLLAPSED_SIDE_KEY = "previewReferenceCollapsedSide";

/**
 * The split between the map preview and the reference table, inside the map
 * side panel (beta feedback: "make it so the horizontal bar that divides the
 * preview generator and the reference table can be adjusted by the user, and
 * fully closed in either direction").
 *
 * A context above the tab switch, one level above `SidePanelLayoutContext`,
 * for the identical two reasons that one is: Breakdown and Code each render
 * their own `MapSidePanel`, with the inactive tab unmounted rather than
 * hidden, and the split is shared BETWEEN the tabs by design, so dragging it
 * on one and finding the other unchanged would read as a bug.
 */
export interface PreviewReferenceSplitValue {
  /** The preview's share of the column, while both panes are shown. Meaningful even while one is collapsed, that is what un-collapsing restores. */
  fraction: number;
  /** Which pane is fully closed, or `null` while both are shown. */
  collapsedSide: PreviewReferenceCollapsedSide;
  /**
   * Updates the live fraction WITHOUT touching the store. Called once per
   * pointermove during a drag, up to 60 times a second; every store write is
   * an IPC hop into the Rust host (SidePanelLayoutContext's own reasoning),
   * so persisting per frame would put a disk-backed round trip in the middle
   * of a drag loop for a value that only matters once the user lets go.
   */
  setFraction: (fraction: number) => void;
  /** Writes the current fraction to the store. Call once, when a drag ends. */
  commitFraction: () => void;
  setCollapsedSide: (side: PreviewReferenceCollapsedSide) => void;
}

const PreviewReferenceSplitContext = createContext<PreviewReferenceSplitValue | null>(null);

export function PreviewReferenceSplitProvider({ children }: { children: ReactNode }) {
  const [fraction, setFractionState] = useState(DEFAULT_PREVIEW_FRACTION);
  const [collapsedSide, setCollapsedSideState] = useState<PreviewReferenceCollapsedSide>(null);
  const [store, setStore] = useState<Store | null>(null);
  // Same stale-closure fix as SidePanelLayoutContext's own widthRef: commitFraction
  // takes no argument, so it has to read the CURRENT fraction at the moment
  // it is called, and a ref is always current where the `fraction` state
  // variable would capture whatever it was when the callback was created.
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;

  useEffect(() => {
    let cancelled = false;
    load(SPLIT_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const savedFraction = await loadedStore.get<unknown>(PREVIEW_FRACTION_KEY);
      if (!cancelled && isPreviewFraction(savedFraction)) setFractionState(savedFraction);
      const savedCollapsedSide = await loadedStore.get<unknown>(COLLAPSED_SIDE_KEY);
      if (!cancelled && isPreviewReferenceCollapsedSide(savedCollapsedSide)) {
        setCollapsedSideState(savedCollapsedSide);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setFraction = useCallback((next: number) => {
    setFractionState(clampPreviewFraction(next));
  }, []);

  const commitFraction = useCallback(() => {
    void store?.set(PREVIEW_FRACTION_KEY, fractionRef.current);
  }, [store]);

  const setCollapsedSide = useCallback(
    (next: PreviewReferenceCollapsedSide) => {
      setCollapsedSideState(next);
      void store?.set(COLLAPSED_SIDE_KEY, next);
    },
    [store],
  );

  // Memoised for the same reason SidePanelLayoutContext's own value is: App
  // re-renders on every keystroke, and an unmemoised object would hand every
  // consumer a new identity each time.
  const value = useMemo<PreviewReferenceSplitValue>(
    () => ({ fraction, collapsedSide, setFraction, commitFraction, setCollapsedSide }),
    [fraction, collapsedSide, setFraction, commitFraction, setCollapsedSide],
  );

  return <PreviewReferenceSplitContext.Provider value={value}>{children}</PreviewReferenceSplitContext.Provider>;
}

export function usePreviewReferenceSplit(): PreviewReferenceSplitValue {
  const ctx = useContext(PreviewReferenceSplitContext);
  if (!ctx) throw new Error("usePreviewReferenceSplit must be used within a PreviewReferenceSplitProvider");
  return ctx;
}
