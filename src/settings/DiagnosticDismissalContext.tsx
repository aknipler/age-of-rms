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
import { isDismissible } from "../parser/diagnostics";
import type { Diagnostic } from "../parser/types";

const TURNED_OFF_KEY = "diagnosticsTurnedOff";
const HIDDEN_PER_FILE_KEY = "diagnosticsHiddenPerFile";

/**
 * The warnings a user has hidden, and the two ways they hid them. Only codes
 * the parser marks `dismissible` (diagnostics.ts) can be hidden, so a stale
 * entry for any other code is ignored rather than trusted.
 *
 * - "Don't show me this again" turns a code off everywhere, until the
 *   Diagnostics tab in Settings turns it back on.
 * - "Ok" hides a code in one file, remembered by the file's path. An unsaved
 *   file has no path, so there it lasts until the app closes.
 *
 * A context of its own on the shared settings store, the same split as
 * CodeSettingsContext. It sits above AppContent so the Settings dialog, the
 * Code tab and Breakdown all read one copy.
 */
export interface DiagnosticDismissalValue {
  /** Codes turned off everywhere, in the order they were turned off. */
  turnedOff: readonly string[];
  turnOff: (code: string) => void;
  turnBackOn: (code: string) => void;
  /** Hide `code` in the file at `filePath`, null for an unsaved file. */
  hideForFile: (code: string, filePath: string | null) => void;
  /** How many files have a warning hidden with "Ok". */
  filesWithHidden: number;
  /** Shows every warning hidden with "Ok" again, in every file. */
  clearHiddenForFiles: () => void;
  /** `diagnostics` without the ones hidden for this file or turned off. */
  visible: (
    diagnostics: readonly Diagnostic[],
    filePath: string | null,
  ) => Diagnostic[];
}

const DiagnosticDismissalContext =
  createContext<DiagnosticDismissalValue | null>(null);

/** The in-memory key for an unsaved file, never written to the store. */
const UNSAVED = "";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isHiddenMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(isStringArray)
  );
}

export function DiagnosticDismissalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [turnedOff, setTurnedOff] = useState<string[]>([]);
  const [hiddenPerFile, setHiddenPerFile] = useState<Record<string, string[]>>(
    {},
  );
  const [store, setStore] = useState<Store | null>(null);

  // `cancelled` guards a load racing an unmount, see HotkeySettingsContext.tsx
  // for why StrictMode's dev double-invoke makes this necessary.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        const [savedOff, savedHidden] = await Promise.all([
          loadedStore.get<unknown>(TURNED_OFF_KEY),
          loadedStore.get<unknown>(HIDDEN_PER_FILE_KEY),
        ]);
        if (cancelled) return;
        // The store is set last, in the same batch as the saved values. Set
        // first, the save effects below would run once with the empty
        // defaults and write them over what is on disk.
        if (isStringArray(savedOff)) setTurnedOff(savedOff);
        if (isHiddenMap(savedHidden)) setHiddenPerFile(savedHidden);
        setStore(loadedStore);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The writers below only change state, through the functional
  // `setState(prev => ...)` form, which is what makes two quick clicks both
  // land where reading the list from the closure would let the second
  // overwrite the first. Saving happens in the effects after them. An updater
  // must stay pure, because StrictMode runs it twice in development, and a
  // store write is a side effect.
  const turnOff = useCallback((code: string) => {
    setTurnedOff((prev) => (prev.includes(code) ? prev : [...prev, code]));
  }, []);

  const turnBackOn = useCallback((code: string) => {
    setTurnedOff((prev) => prev.filter((c) => c !== code));
  }, []);

  const hideForFile = useCallback((code: string, filePath: string | null) => {
    const key = filePath ?? UNSAVED;
    setHiddenPerFile((prev) =>
      prev[key]?.includes(code)
        ? prev
        : { ...prev, [key]: [...(prev[key] ?? []), code] },
    );
  }, []);

  const clearHiddenForFiles = useCallback(() => setHiddenPerFile({}), []);

  // Saved only once the store has loaded, so the empty defaults of the first
  // render never overwrite what is on disk. The unsaved file's entry stays in
  // memory, since there is no path to remember it by.
  useEffect(() => {
    void store?.set(TURNED_OFF_KEY, turnedOff);
  }, [store, turnedOff]);

  useEffect(() => {
    if (!store) return;
    const persisted = Object.fromEntries(
      Object.entries(hiddenPerFile).filter(([key]) => key !== UNSAVED),
    );
    void store.set(HIDDEN_PER_FILE_KEY, persisted);
  }, [store, hiddenPerFile]);

  const visible = useCallback(
    (diagnostics: readonly Diagnostic[], filePath: string | null) => {
      const hiddenHere = hiddenPerFile[filePath ?? UNSAVED] ?? [];
      if (turnedOff.length === 0 && hiddenHere.length === 0)
        return diagnostics as Diagnostic[];
      return diagnostics.filter(
        (d) =>
          !isDismissible(d.code) ||
          (!turnedOff.includes(d.code) && !hiddenHere.includes(d.code)),
      );
    },
    [turnedOff, hiddenPerFile],
  );

  const filesWithHidden = Object.keys(hiddenPerFile).filter(
    (key) => hiddenPerFile[key].length > 0,
  ).length;

  const value = useMemo<DiagnosticDismissalValue>(
    () => ({
      turnedOff,
      turnOff,
      turnBackOn,
      hideForFile,
      filesWithHidden,
      clearHiddenForFiles,
      visible,
    }),
    [
      turnedOff,
      turnOff,
      turnBackOn,
      hideForFile,
      filesWithHidden,
      clearHiddenForFiles,
      visible,
    ],
  );

  return (
    <DiagnosticDismissalContext.Provider value={value}>
      {children}
    </DiagnosticDismissalContext.Provider>
  );
}

export function useDiagnosticDismissal(): DiagnosticDismissalValue {
  const ctx = useContext(DiagnosticDismissalContext);
  if (!ctx) {
    throw new Error(
      "useDiagnosticDismissal must be used within a DiagnosticDismissalProvider",
    );
  }
  return ctx;
}

/**
 * The path of the file the user is looking at, so a warning's "Ok" button
 * knows which file to hide it in. Provided by AppContent, which owns the
 * document, and read by Breakdown's popup and the Code tab's hover bridge.
 */
const CurrentFileContext = createContext<string | null>(null);

export function CurrentFileProvider({
  filePath,
  children,
}: {
  filePath: string | null;
  children: ReactNode;
}) {
  return (
    <CurrentFileContext.Provider value={filePath}>
      {children}
    </CurrentFileContext.Provider>
  );
}

export function useCurrentFilePath(): string | null {
  return useContext(CurrentFileContext);
}
