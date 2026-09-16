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
  applyThemeTokens,
  applyUiFontScale,
  DEFAULT_ACTIVE_THEME_ID,
  DEFAULT_UI_FONT_SCALE,
  generateThemeId,
  isBuiltInThemeId,
  resolveThemeTokens,
  sanitizeCustomThemes,
  sanitizeUiFontScale,
  themeTokensEqual,
  THEME_STORE_KEYS,
  type CustomTheme,
  type ThemeTokenId,
  type ThemeTokens,
} from "./theme";

/**
 * Its own context rather than a field on AppSettingsContext, same split as
 * HotkeySettingsContext, what a setting is ABOUT decides which context
 * holds it. Also the one context that reaches outside React entirely: every
 * change here writes CSS custom properties straight onto `documentElement`
 * (theme.ts's `applyThemeTokens`), because that is what every component
 * stylesheet reads through `var(--token-name)`, including ones with no React
 * subscriber to this context at all.
 *
 * `draftTokens` is what's LIVE, the Theme settings tab edits it directly
 * (`setDraftToken`) so a colour change previews instantly, app-wide, before
 * it is saved anywhere. Switching `activeThemeId` resets the draft to that
 * theme's saved tokens, so unsaved edits are abandoned on switch rather than
 * silently carried onto a different theme's name.
 */
export interface ThemeSettingsValue {
  activeThemeId: string;
  customThemes: readonly CustomTheme[];
  draftTokens: ThemeTokens;
  /** Whether `draftTokens` differs from the active theme's last-saved tokens. */
  isDirty: boolean;
  /** Whether the active theme is one the user can update/rename/delete in place. */
  isActiveThemeCustom: boolean;
  selectTheme: (id: string) => void;
  setDraftToken: (id: ThemeTokenId, value: string) => void;
  /** Discards unsaved edits, reverting the draft to the active theme's saved tokens. */
  resetDraft: () => void;
  /** Persists the current draft as a brand new custom theme and makes it active. */
  saveAsNewTheme: (name: string) => void;
  /** Persists the current draft into the active theme, only meaningful when `isActiveThemeCustom`. */
  updateActiveTheme: () => void;
  renameCustomTheme: (id: string, name: string) => void;
  deleteCustomTheme: (id: string) => void;
  /** Global UI scale, applied to the HTML root's font-size (theme.ts's own comment explains why that scales the whole app). Not per-theme — one value regardless of which palette is active. */
  uiFontScale: number;
  setUiFontScale: (scale: number) => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsValue | null>(null);

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [activeThemeId, setActiveThemeIdState] = useState(
    DEFAULT_ACTIVE_THEME_ID,
  );
  const [customThemes, setCustomThemesState] = useState<CustomTheme[]>([]);
  const [draftTokens, setDraftTokens] = useState<ThemeTokens>(() =>
    resolveThemeTokens(DEFAULT_ACTIVE_THEME_ID, []),
  );
  const [store, setStore] = useState<Store | null>(null);
  const [uiFontScale, setUiFontScaleState] = useState(DEFAULT_UI_FONT_SCALE);

  // Guards the async settle against an unmount between load starting and
  // finishing; see AppSettingsContext.tsx for why StrictMode's dev
  // double-invoke makes this necessary rather than defensive.
  useEffect(() => {
    let cancelled = false;
    load(APP_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const savedThemesRaw = await loadedStore.get<unknown>(
          THEME_STORE_KEYS.customThemes,
        );
        const savedThemes = sanitizeCustomThemes(savedThemesRaw);
        const savedActiveRaw = await loadedStore.get<unknown>(
          THEME_STORE_KEYS.activeThemeId,
        );
        const savedActive =
          typeof savedActiveRaw === "string" &&
          (isBuiltInThemeId(savedActiveRaw) ||
            savedThemes.some((t) => t.id === savedActiveRaw))
            ? savedActiveRaw
            : DEFAULT_ACTIVE_THEME_ID;
        const savedScaleRaw = await loadedStore.get<unknown>(
          THEME_STORE_KEYS.uiFontScale,
        );
        if (cancelled) return;
        setCustomThemesState(savedThemes);
        setActiveThemeIdState(savedActive);
        setDraftTokens(resolveThemeTokens(savedActive, savedThemes));
        if (savedScaleRaw !== undefined)
          setUiFontScaleState(sanitizeUiFontScale(savedScaleRaw));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The one effect that touches the DOM, every render of `draftTokens`
  // (from a theme switch, a live edit, or the initial load above) re-applies
  // it. Cheap: it's 26 `style.setProperty` calls, not a re-render of
  // anything React owns.
  useEffect(() => {
    applyThemeTokens(draftTokens);
  }, [draftTokens]);

  useEffect(() => {
    applyUiFontScale(uiFontScale);
  }, [uiFontScale]);

  const setUiFontScale = useCallback(
    (scale: number) => {
      const next = sanitizeUiFontScale(scale);
      setUiFontScaleState(next);
      void store?.set(THEME_STORE_KEYS.uiFontScale, next);
    },
    [store],
  );

  const selectTheme = useCallback(
    (id: string) => {
      setActiveThemeIdState(id);
      void store?.set(THEME_STORE_KEYS.activeThemeId, id);
      setDraftTokens(resolveThemeTokens(id, customThemes));
    },
    [store, customThemes],
  );

  const setDraftToken = useCallback((id: ThemeTokenId, value: string) => {
    setDraftTokens((current) => ({ ...current, [id]: value }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraftTokens(resolveThemeTokens(activeThemeId, customThemes));
  }, [activeThemeId, customThemes]);

  const saveAsNewTheme = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      const next: CustomTheme = {
        id: generateThemeId(),
        name: trimmed,
        tokens: draftTokens,
      };
      const nextThemes = [...customThemes, next];
      setCustomThemesState(nextThemes);
      void store?.set(THEME_STORE_KEYS.customThemes, nextThemes);
      setActiveThemeIdState(next.id);
      void store?.set(THEME_STORE_KEYS.activeThemeId, next.id);
      // draftTokens already IS next.tokens, no reset needed, the new theme opens showing exactly what was just saved.
    },
    [customThemes, draftTokens, store],
  );

  const updateActiveTheme = useCallback(() => {
    if (isBuiltInThemeId(activeThemeId)) return;
    const nextThemes = customThemes.map((t) =>
      t.id === activeThemeId ? { ...t, tokens: draftTokens } : t,
    );
    setCustomThemesState(nextThemes);
    void store?.set(THEME_STORE_KEYS.customThemes, nextThemes);
  }, [activeThemeId, customThemes, draftTokens, store]);

  const renameCustomTheme = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      const nextThemes = customThemes.map((t) =>
        t.id === id ? { ...t, name: trimmed } : t,
      );
      setCustomThemesState(nextThemes);
      void store?.set(THEME_STORE_KEYS.customThemes, nextThemes);
    },
    [customThemes, store],
  );

  const deleteCustomTheme = useCallback(
    (id: string) => {
      const nextThemes = customThemes.filter((t) => t.id !== id);
      setCustomThemesState(nextThemes);
      void store?.set(THEME_STORE_KEYS.customThemes, nextThemes);
      // Deleting the active theme falls back to Light rather than leaving
      // draftTokens pointed at a theme that no longer exists in the list.
      if (id === activeThemeId) {
        setActiveThemeIdState(DEFAULT_ACTIVE_THEME_ID);
        void store?.set(
          THEME_STORE_KEYS.activeThemeId,
          DEFAULT_ACTIVE_THEME_ID,
        );
        setDraftTokens(resolveThemeTokens(DEFAULT_ACTIVE_THEME_ID, nextThemes));
      }
    },
    [activeThemeId, customThemes, store],
  );

  const isDirty = useMemo(
    () =>
      !themeTokensEqual(
        draftTokens,
        resolveThemeTokens(activeThemeId, customThemes),
      ),
    [draftTokens, activeThemeId, customThemes],
  );

  const value = useMemo<ThemeSettingsValue>(
    () => ({
      activeThemeId,
      customThemes,
      draftTokens,
      isDirty,
      isActiveThemeCustom: !isBuiltInThemeId(activeThemeId),
      selectTheme,
      setDraftToken,
      resetDraft,
      saveAsNewTheme,
      updateActiveTheme,
      renameCustomTheme,
      deleteCustomTheme,
      uiFontScale,
      setUiFontScale,
    }),
    [
      activeThemeId,
      customThemes,
      draftTokens,
      isDirty,
      selectTheme,
      setDraftToken,
      resetDraft,
      saveAsNewTheme,
      updateActiveTheme,
      renameCustomTheme,
      deleteCustomTheme,
      uiFontScale,
      setUiFontScale,
    ],
  );

  return (
    <ThemeSettingsContext.Provider value={value}>
      {children}
    </ThemeSettingsContext.Provider>
  );
}

export function useThemeSettings(): ThemeSettingsValue {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx)
    throw new Error(
      "useThemeSettings must be used within a ThemeSettingsProvider",
    );
  return ctx;
}
