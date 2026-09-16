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

const TAB_SIZE_KEY = "codeTabSize";
const INSERT_SPACES_KEY = "codeInsertSpaces";

export const TAB_SIZE_OPTIONS: readonly number[] = [2, 4, 8];
export const DEFAULT_TAB_SIZE = 4;
export const DEFAULT_INSERT_SPACES = true;

function isTabSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    (TAB_SIZE_OPTIONS as readonly number[]).includes(value)
  );
}

/**
 * Code-tab-only settings. Its own context rather than a field on
 * AppSettingsContext, same split as BreakdownSettingsContext/
 * HotkeySettingsContext: what a setting is ABOUT decides which context
 * holds it. Read by CodePane.tsx to set Monaco's own `tabSize`/
 * `insertSpaces` editor options.
 */
export interface CodeSettingsValue {
  tabSize: number;
  setTabSize: (size: number) => void;
  /** true = spaces, false = tabs, same polarity as Monaco's own `insertSpaces` option. */
  insertSpaces: boolean;
  setInsertSpaces: (value: boolean) => void;
}

const CodeSettingsContext = createContext<CodeSettingsValue | null>(null);

export function CodeSettingsProvider({ children }: { children: ReactNode }) {
  const [tabSize, setTabSizeState] = useState<number>(DEFAULT_TAB_SIZE);
  const [insertSpaces, setInsertSpacesState] = useState<boolean>(
    DEFAULT_INSERT_SPACES,
  );
  const [store, setStore] = useState<Store | null>(null);

  // `cancelled` guards a load racing an unmount, see HotkeySettingsContext.tsx
  // for why StrictMode's dev double-invoke makes this necessary.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const [savedTabSize, savedInsertSpaces] = await Promise.all([
          loadedStore.get<unknown>(TAB_SIZE_KEY),
          loadedStore.get<unknown>(INSERT_SPACES_KEY),
        ]);
        if (cancelled) return;
        if (isTabSize(savedTabSize)) setTabSizeState(savedTabSize);
        if (typeof savedInsertSpaces === "boolean")
          setInsertSpacesState(savedInsertSpaces);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setTabSize = useCallback(
    (next: number) => {
      setTabSizeState(next);
      void store?.set(TAB_SIZE_KEY, next);
    },
    [store],
  );

  const setInsertSpaces = useCallback(
    (next: boolean) => {
      setInsertSpacesState(next);
      void store?.set(INSERT_SPACES_KEY, next);
    },
    [store],
  );

  const value = useMemo<CodeSettingsValue>(
    () => ({ tabSize, setTabSize, insertSpaces, setInsertSpaces }),
    [tabSize, setTabSize, insertSpaces, setInsertSpaces],
  );

  return (
    <CodeSettingsContext.Provider value={value}>
      {children}
    </CodeSettingsContext.Provider>
  );
}

export function useCodeSettings(): CodeSettingsValue {
  const ctx = useContext(CodeSettingsContext);
  if (!ctx)
    throw new Error(
      "useCodeSettings must be used within a CodeSettingsProvider",
    );
  return ctx;
}
