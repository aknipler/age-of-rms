import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import { APP_SETTINGS_STORE_FILE } from "./nameDisplay";
import type { AttributeOrderMode } from "../breakdown/attributeModel";

const ATTRIBUTE_ORDER_MODE_KEY = "breakdownAttributeOrderMode";
const CUSTOM_ATTRIBUTE_ORDER_KEY = "breakdownCustomAttributeOrder";
const DENSITY_KEY = "breakdownDensity";

export const DEFAULT_ATTRIBUTE_ORDER_MODE: AttributeOrderMode = "required";

const ATTRIBUTE_ORDER_MODES: readonly AttributeOrderMode[] = ["required", "alphabetical", "fileOrder", "custom"];

function isAttributeOrderMode(value: unknown): value is AttributeOrderMode {
  return typeof value === "string" && (ATTRIBUTE_ORDER_MODES as readonly string[]).includes(value);
}

export type BreakdownDensity = "comfortable" | "compact";

export const DEFAULT_BREAKDOWN_DENSITY: BreakdownDensity = "comfortable";

function isBreakdownDensity(value: unknown): value is BreakdownDensity {
  return value === "comfortable" || value === "compact";
}

/**
 * A command's saved custom attribute arrangement (attributeOrderMode
 * "custom" only), set via CommandCard's "Set as default" button.
 */
export interface CustomAttributeOrder {
  /** Flat top-to-bottom order. Used directly for single-column rendering, and as sortKnownSlots' own customOrder. */
  order: string[];
  /**
   * Names pinned to the right (normally the boolean) column of the compact
   * two-column layout, when there's room to actually show two columns.
   * Absent means every slot's own isFlag decides its column (the default
   * split); present once the user has dragged an attribute across columns
   * for this command, which the drag is free to do in custom mode — see
   * CommandCard.tsx.
   */
  rightColumn?: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isCustomAttributeOrder(value: unknown): value is CustomAttributeOrder {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isStringArray(v.order)) return false;
  return v.rightColumn === undefined || isStringArray(v.rightColumn);
}

/** Corrupted or pre-feature settings.json must not crash startup, same reasoning as hotkeys.ts's isHotkey. */
function isCustomAttributeOrderMap(value: unknown): value is Record<string, CustomAttributeOrder> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(isCustomAttributeOrder);
}

/**
 * Breakdown-editor-only settings. Its own context rather than a field on
 * AppSettingsContext, same reasoning as HotkeySettingsContext's own split:
 * what a setting is ABOUT decides which context holds it.
 */
export interface BreakdownSettingsValue {
  attributeOrderMode: AttributeOrderMode;
  setAttributeOrderMode: (mode: AttributeOrderMode) => void;
  /** commandName -> that command's saved attribute arrangement. */
  customAttributeOrder: Record<string, CustomAttributeOrder>;
  setCustomAttributeOrderFor: (commandName: string, value: CustomAttributeOrder) => void;
  density: BreakdownDensity;
  setDensity: (density: BreakdownDensity) => void;
}

const BreakdownSettingsContext = createContext<BreakdownSettingsValue | null>(null);

export function BreakdownSettingsProvider({ children }: { children: ReactNode }) {
  const [attributeOrderMode, setAttributeOrderModeState] = useState<AttributeOrderMode>(DEFAULT_ATTRIBUTE_ORDER_MODE);
  const [customAttributeOrder, setCustomAttributeOrderState] = useState<Record<string, CustomAttributeOrder>>({});
  const [density, setDensityState] = useState<BreakdownDensity>(DEFAULT_BREAKDOWN_DENSITY);
  const [store, setStore] = useState<Store | null>(null);

  // `cancelled` guards a load racing an unmount, see HotkeySettingsContext.tsx
  // for why StrictMode's dev double-invoke makes this necessary.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(async (loadedStore) => {
      if (cancelled) return;
      setStore(loadedStore);
      const [savedMode, savedCustom, savedDensity] = await Promise.all([
        loadedStore.get<unknown>(ATTRIBUTE_ORDER_MODE_KEY),
        loadedStore.get<unknown>(CUSTOM_ATTRIBUTE_ORDER_KEY),
        loadedStore.get<unknown>(DENSITY_KEY),
      ]);
      if (cancelled) return;
      if (isAttributeOrderMode(savedMode)) setAttributeOrderModeState(savedMode);
      if (isCustomAttributeOrderMap(savedCustom)) setCustomAttributeOrderState(savedCustom);
      if (isBreakdownDensity(savedDensity)) setDensityState(savedDensity);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAttributeOrderMode = useCallback(
    (mode: AttributeOrderMode) => {
      setAttributeOrderModeState(mode);
      void store?.set(ATTRIBUTE_ORDER_MODE_KEY, mode);
    },
    [store],
  );

  const setCustomAttributeOrderFor = useCallback(
    (commandName: string, value: CustomAttributeOrder) => {
      setCustomAttributeOrderState((current) => {
        const next = { ...current, [commandName]: { order: [...value.order], rightColumn: value.rightColumn ? [...value.rightColumn] : undefined } };
        void store?.set(CUSTOM_ATTRIBUTE_ORDER_KEY, next);
        return next;
      });
    },
    [store],
  );

  const setDensity = useCallback(
    (next: BreakdownDensity) => {
      setDensityState(next);
      void store?.set(DENSITY_KEY, next);
    },
    [store],
  );

  const value = useMemo<BreakdownSettingsValue>(
    () => ({
      attributeOrderMode,
      setAttributeOrderMode,
      customAttributeOrder,
      setCustomAttributeOrderFor,
      density,
      setDensity,
    }),
    [attributeOrderMode, setAttributeOrderMode, customAttributeOrder, setCustomAttributeOrderFor, density, setDensity],
  );

  return <BreakdownSettingsContext.Provider value={value}>{children}</BreakdownSettingsContext.Provider>;
}

export function useBreakdownSettings(): BreakdownSettingsValue {
  const ctx = useContext(BreakdownSettingsContext);
  if (!ctx) throw new Error("useBreakdownSettings must be used within a BreakdownSettingsProvider");
  return ctx;
}
