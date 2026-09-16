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
import { APP_SETTINGS_STORE_FILE } from "./nameDisplay";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_STORE_KEYS,
  isHotkey,
  type Hotkey,
  type HotkeyId,
} from "./hotkeys";

/**
 * The app's rebindable keyboard shortcuts. Its own context rather than a
 * field on AppSettingsContext, same reasoning as that context's own split
 * from HelpSettingsContext: what a setting is ABOUT decides which context
 * holds it, not which file loads the same settings.json.
 *
 * One `hotkeys` record rather than a field per binding (which is how this
 * context looked when Save was the only one): every consumer that fires an
 * action reads `hotkeys[id]` and every consumer that lists bindings (the
 * Settings tab) iterates `Object.keys(DEFAULT_HOTKEYS)`. Adding a binding
 * is now a `hotkeys.ts` edit plus one new listener, not a second copy of
 * this whole context.
 */
export interface HotkeySettingsValue {
  hotkeys: Record<HotkeyId, Hotkey>;
  setHotkey: (id: HotkeyId, hotkey: Hotkey) => void;
  resetHotkey: (id: HotkeyId) => void;
  /**
   * The id of the binding currently being recorded in the Hotkeys settings
   * tab, or null. Every global keydown listener in the app (App.tsx's
   * combined one, plus BreakdownPane/SectionView's scoped ones) checks this
   * before matching a press, so pressing the app's CURRENT binding for
   * something while choosing a new one for it doesn't ALSO fire the old
   * action. A bare "add a second listener" approach can't express that
   * ordering, since every listener lives on `window` and the one that fires
   * first wins. Scoped to at most one recording binding at a time (a
   * single id, not a set) because the Settings UI only ever lets one row
   * record at once.
   */
  recordingId: HotkeyId | null;
  setRecordingId: (id: HotkeyId | null) => void;
}

const HotkeySettingsContext = createContext<HotkeySettingsValue | null>(null);

export function HotkeySettingsProvider({ children }: { children: ReactNode }) {
  const [hotkeys, setHotkeysState] =
    useState<Record<HotkeyId, Hotkey>>(DEFAULT_HOTKEYS);
  const [store, setStore] = useState<Store | null>(null);
  // Ephemeral, never persisted, reset to null on every launch.
  const [recordingId, setRecordingId] = useState<HotkeyId | null>(null);

  // `cancelled` guards against an unmount between the load starting and
  // finishing; see AppSettingsContext.tsx for why StrictMode's
  // double-invoke in dev makes this necessary rather than defensive. One
  // store load, then one get() per binding, the store itself is a flat
  // key/value file, so there's no benefit to loading them any other way.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const entries = await Promise.all(
          (Object.keys(DEFAULT_HOTKEYS) as HotkeyId[]).map(async (id) => {
            const saved = await loadedStore.get<unknown>(HOTKEY_STORE_KEYS[id]);
            return [id, isHotkey(saved) ? saved : DEFAULT_HOTKEYS[id]] as const;
          }),
        );
        if (!cancelled)
          setHotkeysState(
            Object.fromEntries(entries) as Record<HotkeyId, Hotkey>,
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setHotkey = useCallback(
    (id: HotkeyId, next: Hotkey) => {
      setHotkeysState((current) => ({ ...current, [id]: next }));
      void store?.set(HOTKEY_STORE_KEYS[id], next);
    },
    [store],
  );

  const resetHotkey = useCallback(
    (id: HotkeyId) => setHotkey(id, DEFAULT_HOTKEYS[id]),
    [setHotkey],
  );

  const value = useMemo<HotkeySettingsValue>(
    () => ({ hotkeys, setHotkey, resetHotkey, recordingId, setRecordingId }),
    [hotkeys, setHotkey, resetHotkey, recordingId],
  );

  return (
    <HotkeySettingsContext.Provider value={value}>
      {children}
    </HotkeySettingsContext.Provider>
  );
}

export function useHotkeySettings(): HotkeySettingsValue {
  const ctx = useContext(HotkeySettingsContext);
  if (!ctx)
    throw new Error(
      "useHotkeySettings must be used within a HotkeySettingsProvider",
    );
  return ctx;
}
