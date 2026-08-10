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
  APP_SETTINGS_STORE_FILE,
  DEFAULT_SHORTEN_LONG_NAMES,
  SHORTEN_LONG_NAMES_KEY,
} from "./nameDisplay";

/**
 * App-wide display preferences that don't belong to one subsystem.
 *
 * A THIRD settings context rather than a field on HelpSettingsContext, which
 * already loads the same settings.json file. The split is by what the setting
 * is about, not by where it is stored: HelpSettingsContext is read by every
 * HelpTip and by the imperative Monaco hover provider, and widening it would
 * make an unrelated preference re-render all of that. Adding a tab to the
 * Settings dialog should not mean editing the help system.
 *
 * Persisted, unlike PreviewViewContext — this is how you want the app to
 * behave rather than where you happen to be looking, which is the same line
 * SidePanelLayoutContext draws.
 */
export interface AppSettingsValue {
  /** Display `#const`/`#define` names longer than six characters as a three-letter prefix (see nameDisplay.ts). */
  shortenLongNames: boolean;
  setShortenLongNames: (shorten: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [shortenLongNames, setShortenState] = useState(DEFAULT_SHORTEN_LONG_NAMES);
  const [store, setStore] = useState<Store | null>(null);

  // `cancelled` guards the async settle against an unmount between the load
  // starting and finishing. Without it StrictMode's double-invoke in
  // development sets state on a component that is already gone.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const saved = await loadedStore.get<unknown>(SHORTEN_LONG_NAMES_KEY);
      if (!cancelled && typeof saved === "boolean") setShortenState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setShortenLongNames = useCallback(
    (next: boolean) => {
      setShortenState(next);
      void store?.set(SHORTEN_LONG_NAMES_KEY, next);
    },
    [store],
  );

  const value = useMemo<AppSettingsValue>(
    () => ({ shortenLongNames, setShortenLongNames }),
    [shortenLongNames, setShortenLongNames],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within an AppSettingsProvider");
  return ctx;
}
