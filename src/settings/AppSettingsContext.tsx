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
import { AUTHOR_NAME_KEY, AUTHOR_NAME_MAX_LENGTH, DEFAULT_AUTHOR_NAME } from "./authorName";

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
 * Persisted, unlike PreviewViewContext, this is how you want the app to
 * behave rather than where you happen to be looking, which is the same line
 * SidePanelLayoutContext draws.
 */
export interface AppSettingsValue {
  /** Display `#const`/`#define` names longer than six characters as a three-letter prefix (see nameDisplay.ts). */
  shortenLongNames: boolean;
  setShortenLongNames: (shorten: boolean) => void;
  /** Who the stamped script header names as the author (see hooks/scriptHeader.ts). Empty until someone fills it in. */
  authorName: string;
  setAuthorName: (name: string) => void;
}

const AppSettingsContext = createContext<AppSettingsValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [shortenLongNames, setShortenState] = useState(DEFAULT_SHORTEN_LONG_NAMES);
  const [authorName, setAuthorState] = useState(DEFAULT_AUTHOR_NAME);
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
      // Read as `unknown` and narrowed rather than read as `string`:
      // settings.json is a file on disk that a person can edit, so what comes
      // back is only a claim about the type. Same reason the boolean above is
      // checked rather than trusted.
      const savedAuthor = await loadedStore.get<unknown>(AUTHOR_NAME_KEY);
      if (!cancelled && typeof savedAuthor === "string") {
        setAuthorState(savedAuthor.slice(0, AUTHOR_NAME_MAX_LENGTH));
      }
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

  const setAuthorName = useCallback(
    (next: string) => {
      // Clamped here as well as on the input's maxLength, because the setter
      // is the boundary the store is written through and the attribute is
      // only a hint to the browser about typing.
      const clamped = next.slice(0, AUTHOR_NAME_MAX_LENGTH);
      setAuthorState(clamped);
      void store?.set(AUTHOR_NAME_KEY, clamped);
    },
    [store],
  );

  const value = useMemo<AppSettingsValue>(
    () => ({ shortenLongNames, setShortenLongNames, authorName, setAuthorName }),
    [shortenLongNames, setShortenLongNames, authorName, setAuthorName],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within an AppSettingsProvider");
  return ctx;
}
