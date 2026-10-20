import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SIDE_PANEL_TAB,
  isSidePanelTab,
  type SidePanelTab,
} from "./sidePanelTabs";

// Same store file as the side panel's own width/collapsed keys, and the help
// (1.7) and generation (2.5) settings before it, different keys, one
// settings.json for everything that is "how you want the app to behave".
const STORE_FILE = "settings.json";
const TAB_KEY = "sidePanelTab";

/**
 * Which tab of the map side panel is showing.
 *
 * Replaces `PreviewReferenceSplitContext`, which held the draggable split
 * between the preview and the reference table. They share the panel as tabs
 * now (beta feedback), so what is left to remember is the selected tab.
 *
 * A context above the tab switch, for the reason `SidePanelLayoutContext`
 * gives: Breakdown and Code each render their own `MapSidePanel`, the
 * inactive one is unmounted, and the choice is shared BETWEEN them by design.
 * Picking Reference on one and finding the other still on Preview would read
 * as a bug.
 */
export interface SidePanelTabValue {
  tab: SidePanelTab;
  /** Persists immediately: a tab click is a complete gesture, unlike a drag. */
  setTab: (tab: SidePanelTab) => void;
}

const SidePanelTabContext = createContext<SidePanelTabValue | null>(null);

export function SidePanelTabProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<SidePanelTab>(DEFAULT_SIDE_PANEL_TAB);
  const [store, setStore] = useState<Store | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const savedTab = await loadedStore.get<unknown>(TAB_KEY);
        if (!cancelled && isSidePanelTab(savedTab)) setTabState(savedTab);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setTab = useCallback(
    (next: SidePanelTab) => {
      setTabState(next);
      void store?.set(TAB_KEY, next);
    },
    [store],
  );

  // Memoised for the same reason SidePanelLayoutContext's own value is: App
  // re-renders on every keystroke, and an unmemoised object would hand every
  // consumer a new identity each time.
  const value = useMemo<SidePanelTabValue>(
    () => ({ tab, setTab }),
    [tab, setTab],
  );

  return (
    <SidePanelTabContext.Provider value={value}>
      {children}
    </SidePanelTabContext.Provider>
  );
}

export function useSidePanelTab(): SidePanelTabValue {
  const ctx = useContext(SidePanelTabContext);
  if (!ctx)
    throw new Error(
      "useSidePanelTab must be used within a SidePanelTabProvider",
    );
  return ctx;
}
