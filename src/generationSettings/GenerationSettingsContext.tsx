// Phase 2.5 — mirrors src/help/HelpSettingsContext.tsx's pattern exactly:
// load the persisted store once on mount, read initial values, and every
// setter both updates local state AND writes back to the store.

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
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_COUNT,
  GENERATION_SETTINGS_STORE_FILE,
  isMapSize,
  isPlayerCount,
  MAP_SIZE_KEY,
  PLAYER_COUNT_KEY,
  type MapSize,
} from "./generationSettingsConstants";

interface GenerationSettingsValue {
  playerCount: number;
  setPlayerCount: (count: number) => void;
  mapSize: MapSize;
  setMapSize: (size: MapSize) => void;
}

const GenerationSettingsContext = createContext<GenerationSettingsValue | null>(null);

export function GenerationSettingsProvider({ children }: { children: ReactNode }) {
  const [playerCount, setPlayerCountState] = useState<number>(DEFAULT_PLAYER_COUNT);
  const [mapSize, setMapSizeState] = useState<MapSize>(DEFAULT_MAP_SIZE);
  const [store, setStore] = useState<Store | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(GENERATION_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const savedPlayerCount = await loadedStore.get<number>(PLAYER_COUNT_KEY);
      if (!cancelled && isPlayerCount(savedPlayerCount)) {
        setPlayerCountState(savedPlayerCount);
      }
      const savedMapSize = await loadedStore.get<string>(MAP_SIZE_KEY);
      if (!cancelled && isMapSize(savedMapSize)) {
        setMapSizeState(savedMapSize);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPlayerCount = useCallback(
    (next: number) => {
      setPlayerCountState(next);
      void store?.set(PLAYER_COUNT_KEY, next);
    },
    [store],
  );

  const setMapSize = useCallback(
    (next: MapSize) => {
      setMapSizeState(next);
      void store?.set(MAP_SIZE_KEY, next);
    },
    [store],
  );

  const value = useMemo<GenerationSettingsValue>(
    () => ({ playerCount, setPlayerCount, mapSize, setMapSize }),
    [playerCount, setPlayerCount, mapSize, setMapSize],
  );

  return <GenerationSettingsContext.Provider value={value}>{children}</GenerationSettingsContext.Provider>;
}

export function useGenerationSettings(): GenerationSettingsValue {
  const ctx = useContext(GenerationSettingsContext);
  if (!ctx) {
    throw new Error("useGenerationSettings must be used within a GenerationSettingsProvider");
  }
  return ctx;
}
