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
import { DEFAULT_HELP_MODE, HELP_MODE_KEY, HELP_STORE_FILE, isHelpMode, type HelpMode } from "./helpConstants";

interface HelpSettingsValue {
  mode: HelpMode;
  setMode: (mode: HelpMode) => void;
  /** Global ALT-key-held state, tracked once here and shared by every HelpTip instead of each attaching its own window listener. */
  altHeld: boolean;
}

const HelpSettingsContext = createContext<HelpSettingsValue | null>(null);

export function HelpSettingsProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<HelpMode>(DEFAULT_HELP_MODE);
  const [altHeld, setAltHeld] = useState(false);
  const [store, setStore] = useState<Store | null>(null);

  // Load the persisted setting once on mount. `load()` reuses an
  // already-open store for the same path rather than re-reading from
  // disk, so this is cheap even though HelpTip/Monaco's hover provider
  // also call it independently elsewhere.
  useEffect(() => {
    let cancelled = false;
    load(HELP_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const saved = await loadedStore.get<HelpMode>(HELP_MODE_KEY);
      if (!cancelled && isHelpMode(saved)) {
        setModeState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(
    (next: HelpMode) => {
      setModeState(next);
      void store?.set(HELP_MODE_KEY, next);
    },
    [store],
  );

  // Global ALT tracking. Also clears on window blur — otherwise
  // alt-tabbing away from the app leaves altHeld stuck true, since the
  // keyup never reaches this window.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Alt") setAltHeld(true);
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Alt") setAltHeld(false);
    }
    function handleBlur() {
      setAltHeld(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const value = useMemo<HelpSettingsValue>(
    () => ({ mode, setMode, altHeld }),
    [mode, setMode, altHeld],
  );

  return <HelpSettingsContext.Provider value={value}>{children}</HelpSettingsContext.Provider>;
}

export function useHelpSettings(): HelpSettingsValue {
  const ctx = useContext(HelpSettingsContext);
  if (!ctx) {
    throw new Error("useHelpSettings must be used within a HelpSettingsProvider");
  }
  return ctx;
}
