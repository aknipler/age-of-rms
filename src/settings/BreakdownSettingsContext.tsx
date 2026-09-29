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
import type { AttributeOrderMode } from "../breakdown/attributeModel";

const ATTRIBUTE_ORDER_MODE_KEY = "breakdownAttributeOrderMode";
const CUSTOM_ATTRIBUTE_ORDER_KEY = "breakdownCustomAttributeOrder";
const DENSITY_KEY = "breakdownDensity";
const SCROLL_TO_ADDED_KEY = "breakdownScrollToAddedCard";
const SUMMARY_CLICK_KEY = "breakdownSummaryClick";
const HIDE_UNUSED_KEY = "breakdownHideUnused";
const HIDE_UNUSED_EXCEPTIONS_KEY = "breakdownHideUnusedExceptions";

export const DEFAULT_ATTRIBUTE_ORDER_MODE: AttributeOrderMode = "required";

const ATTRIBUTE_ORDER_MODES: readonly AttributeOrderMode[] = [
  "required",
  "alphabetical",
  "fileOrder",
  "custom",
];

function isAttributeOrderMode(value: unknown): value is AttributeOrderMode {
  return (
    typeof value === "string" &&
    (ATTRIBUTE_ORDER_MODES as readonly string[]).includes(value)
  );
}

export type BreakdownDensity = "comfortable" | "compact";

export const DEFAULT_BREAKDOWN_DENSITY: BreakdownDensity = "comfortable";

function isBreakdownDensity(value: unknown): value is BreakdownDensity {
  return value === "comfortable" || value === "compact";
}

/**
 * What a click on an attribute in a collapsed card's summary line does
 * (beta feedback 2026-09-17). "open" expands the card and focuses that
 * attribute's editor. "edit" edits it right there in the summary.
 */
export type SummaryClickAction = "open" | "edit";

export const DEFAULT_SUMMARY_CLICK: SummaryClickAction = "open";
export const DEFAULT_SCROLL_TO_ADDED_CARD = true;

function isSummaryClickAction(value: unknown): value is SummaryClickAction {
  return value === "open" || value === "edit";
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
function isCustomAttributeOrderMap(
  value: unknown,
): value is Record<string, CustomAttributeOrder> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    isCustomAttributeOrder,
  );
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
  setCustomAttributeOrderFor: (
    commandName: string,
    value: CustomAttributeOrder,
  ) => void;
  density: BreakdownDensity;
  setDensity: (density: BreakdownDensity) => void;
  /** Add Command, Add Comment and Add Template scroll the list to the new card. Off leaves the viewport where it was. */
  scrollToAddedCard: boolean;
  setScrollToAddedCard: (on: boolean) => void;
  summaryClick: SummaryClickAction;
  setSummaryClick: (action: SummaryClickAction) => void;
  /** Sec.3.3.1 Hide Unused Attributes. Default off. Which rows a card shows is decided when it opens, see hideUnused.ts. */
  hideUnused: boolean;
  setHideUnused: (on: boolean) => void;
  /** Attribute names Hide Unused never hides. */
  hideUnusedExceptions: string[];
  setHideUnusedExceptions: (names: string[]) => void;
}

const BreakdownSettingsContext = createContext<BreakdownSettingsValue | null>(
  null,
);

export function BreakdownSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [attributeOrderMode, setAttributeOrderModeState] =
    useState<AttributeOrderMode>(DEFAULT_ATTRIBUTE_ORDER_MODE);
  const [customAttributeOrder, setCustomAttributeOrderState] = useState<
    Record<string, CustomAttributeOrder>
  >({});
  const [density, setDensityState] = useState<BreakdownDensity>(
    DEFAULT_BREAKDOWN_DENSITY,
  );
  const [scrollToAddedCard, setScrollToAddedCardState] = useState<boolean>(
    DEFAULT_SCROLL_TO_ADDED_CARD,
  );
  const [summaryClick, setSummaryClickState] = useState<SummaryClickAction>(
    DEFAULT_SUMMARY_CLICK,
  );
  const [hideUnused, setHideUnusedState] = useState<boolean>(false);
  const [hideUnusedExceptions, setHideUnusedExceptionsState] = useState<
    string[]
  >([]);
  const [store, setStore] = useState<Store | null>(null);

  // `cancelled` guards a load racing an unmount, see HotkeySettingsContext.tsx
  // for why StrictMode's dev double-invoke makes this necessary.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const [
          savedMode,
          savedCustom,
          savedDensity,
          savedScroll,
          savedClick,
          savedHide,
          savedExceptions,
        ] = await Promise.all([
          loadedStore.get<unknown>(ATTRIBUTE_ORDER_MODE_KEY),
          loadedStore.get<unknown>(CUSTOM_ATTRIBUTE_ORDER_KEY),
          loadedStore.get<unknown>(DENSITY_KEY),
          loadedStore.get<unknown>(SCROLL_TO_ADDED_KEY),
          loadedStore.get<unknown>(SUMMARY_CLICK_KEY),
          loadedStore.get<unknown>(HIDE_UNUSED_KEY),
          loadedStore.get<unknown>(HIDE_UNUSED_EXCEPTIONS_KEY),
        ]);
        if (cancelled) return;
        if (isAttributeOrderMode(savedMode))
          setAttributeOrderModeState(savedMode);
        if (isCustomAttributeOrderMap(savedCustom))
          setCustomAttributeOrderState(savedCustom);
        if (isBreakdownDensity(savedDensity)) setDensityState(savedDensity);
        if (typeof savedScroll === "boolean")
          setScrollToAddedCardState(savedScroll);
        if (isSummaryClickAction(savedClick)) setSummaryClickState(savedClick);
        if (typeof savedHide === "boolean") setHideUnusedState(savedHide);
        if (isStringArray(savedExceptions))
          setHideUnusedExceptionsState(savedExceptions);
      },
    );
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
        const next = {
          ...current,
          [commandName]: {
            order: [...value.order],
            rightColumn: value.rightColumn ? [...value.rightColumn] : undefined,
          },
        };
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

  const setScrollToAddedCard = useCallback(
    (on: boolean) => {
      setScrollToAddedCardState(on);
      void store?.set(SCROLL_TO_ADDED_KEY, on);
    },
    [store],
  );

  const setSummaryClick = useCallback(
    (action: SummaryClickAction) => {
      setSummaryClickState(action);
      void store?.set(SUMMARY_CLICK_KEY, action);
    },
    [store],
  );

  const setHideUnused = useCallback(
    (on: boolean) => {
      setHideUnusedState(on);
      void store?.set(HIDE_UNUSED_KEY, on);
    },
    [store],
  );

  const setHideUnusedExceptions = useCallback(
    (names: string[]) => {
      const next = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      setHideUnusedExceptionsState(next);
      void store?.set(HIDE_UNUSED_EXCEPTIONS_KEY, next);
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
      scrollToAddedCard,
      setScrollToAddedCard,
      summaryClick,
      setSummaryClick,
      hideUnused,
      setHideUnused,
      hideUnusedExceptions,
      setHideUnusedExceptions,
    }),
    [
      attributeOrderMode,
      setAttributeOrderMode,
      customAttributeOrder,
      setCustomAttributeOrderFor,
      density,
      setDensity,
      scrollToAddedCard,
      setScrollToAddedCard,
      summaryClick,
      setSummaryClick,
      hideUnused,
      setHideUnused,
      hideUnusedExceptions,
      setHideUnusedExceptions,
    ],
  );

  return (
    <BreakdownSettingsContext.Provider value={value}>
      {children}
    </BreakdownSettingsContext.Provider>
  );
}

export function useBreakdownSettings(): BreakdownSettingsValue {
  const ctx = useContext(BreakdownSettingsContext);
  if (!ctx)
    throw new Error(
      "useBreakdownSettings must be used within a BreakdownSettingsProvider",
    );
  return ctx;
}
