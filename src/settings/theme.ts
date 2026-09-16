// The app's themeable surface: a fixed set of CSS custom properties every
// stylesheet reads through `var(--token-name)` instead of a literal colour.
// Pure and React/Tauri-free for the same reason hotkeys.ts is, the token
// list, the two built-in palettes and the light/dark <-> custom persistence
// shape are all ordinary data, testable without mounting anything.

/** Every themeable token. Adding one is this list plus one entry in `THEME_TOKEN_GROUPS`. */
export type ThemeTokenId =
  | "bg"
  | "surface"
  | "surfaceRaised"
  | "surfaceHover"
  | "surfaceActive"
  | "border"
  | "borderMuted"
  | "borderSubtle"
  | "text"
  | "textSecondary"
  | "textMuted"
  | "textFaint"
  | "textOnAccent"
  | "accent"
  | "accentBgSubtle"
  | "success"
  | "successBg"
  | "warning"
  | "warningBg"
  | "warningBgSubtle"
  | "danger"
  | "dangerBg"
  | "dangerBgSubtle"
  | "info"
  | "infoBg"
  | "infoBgSubtle"
  | "canvasBg"
  | "canvasText"
  | "fontMono"
  | "scrollbarTrack"
  | "scrollbarThumb";

export type ThemeTokens = Record<ThemeTokenId, string>;

/**
 * UI-only metadata, grouping and labels belong here, not mixed into the
 * palettes below, same split as HotkeysSettings.tsx's `HOTKEY_ROWS` next to
 * hotkeys.ts's `DEFAULT_HOTKEYS`. `kind` picks the input control: a colour
 * swatch or a plain text field (only `fontMono` today).
 */
export const THEME_TOKEN_GROUPS: ReadonlyArray<{
  label: string;
  tokens: ReadonlyArray<{ id: ThemeTokenId; label: string; kind: "color" | "text" }>;
}> = [
  {
    label: "Surfaces",
    tokens: [
      { id: "bg", label: "App background", kind: "color" },
      { id: "surface", label: "Panels & dialogs", kind: "color" },
      { id: "surfaceRaised", label: "Inputs & buttons", kind: "color" },
      { id: "surfaceHover", label: "Hover", kind: "color" },
      { id: "surfaceActive", label: "Active / selected", kind: "color" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { id: "text", label: "Primary text", kind: "color" },
      { id: "textSecondary", label: "Secondary text", kind: "color" },
      { id: "textMuted", label: "Muted text", kind: "color" },
      { id: "textFaint", label: "Faint text (hints, disabled)", kind: "color" },
      { id: "textOnAccent", label: "Text on accent colour", kind: "color" },
    ],
  },
  {
    label: "Borders",
    tokens: [
      { id: "border", label: "Strong border", kind: "color" },
      { id: "borderMuted", label: "Medium border", kind: "color" },
      { id: "borderSubtle", label: "Faint divider", kind: "color" },
    ],
  },
  {
    label: "Accent",
    tokens: [
      { id: "accent", label: "Accent (links, selection, primary actions)", kind: "color" },
      { id: "accentBgSubtle", label: "Accent tint background", kind: "color" },
    ],
  },
  {
    label: "Status colours",
    tokens: [
      { id: "success", label: "Success", kind: "color" },
      { id: "successBg", label: "Success background", kind: "color" },
      { id: "warning", label: "Warning", kind: "color" },
      { id: "warningBg", label: "Warning background", kind: "color" },
      { id: "warningBgSubtle", label: "Warning row tint", kind: "color" },
      { id: "danger", label: "Error", kind: "color" },
      { id: "dangerBg", label: "Error background", kind: "color" },
      { id: "dangerBgSubtle", label: "Error row tint", kind: "color" },
      { id: "info", label: "Info", kind: "color" },
      { id: "infoBg", label: "Info background", kind: "color" },
      { id: "infoBgSubtle", label: "Info row tint", kind: "color" },
    ],
  },
  {
    label: "Map preview canvas",
    tokens: [
      { id: "canvasBg", label: "Canvas background", kind: "color" },
      { id: "canvasText", label: "Canvas overlay text", kind: "color" },
    ],
  },
  {
    label: "Fonts",
    tokens: [{ id: "fontMono", label: "Code / monospace font", kind: "text" }],
  },
  {
    label: "Scrollbars",
    tokens: [
      { id: "scrollbarTrack", label: "Scrollbar background", kind: "color" },
      { id: "scrollbarThumb", label: "Scrollbar handle", kind: "color" },
    ],
  },
];

/** Every token id, derived from the groups so the two can't drift apart. */
export const THEME_TOKEN_IDS: readonly ThemeTokenId[] = THEME_TOKEN_GROUPS.flatMap((g) =>
  g.tokens.map((t) => t.id),
);

/** Matches the app's current hardcoded look, so switching this system on changes nothing by default. */
export const DEFAULT_LIGHT_THEME: ThemeTokens = {
  bg: "#ffffff",
  surface: "#ffffff",
  surfaceRaised: "#f7f7f7",
  surfaceHover: "#f0f0f0",
  surfaceActive: "#b3b3b3",
  border: "#000000",
  borderMuted: "#999999",
  borderSubtle: "#dddddd",
  text: "#000000",
  textSecondary: "#333333",
  textMuted: "#555555",
  textFaint: "#888888",
  textOnAccent: "#ffffff",
  accent: "#2a6df4",
  accentBgSubtle: "#f0f4ff",
  success: "#22863a",
  successBg: "#eafbef",
  warning: "#b8860b",
  warningBg: "#fff3cd",
  warningBgSubtle: "rgba(224, 163, 0, 0.08)",
  danger: "#dc3545",
  dangerBg: "#f8d7da",
  dangerBgSubtle: "rgba(220, 53, 69, 0.06)",
  info: "#17a2b8",
  infoBg: "#d1ecf1",
  infoBgSubtle: "rgba(23, 162, 184, 0.06)",
  canvasBg: "#14161a",
  canvasText: "#ffffff",
  fontMono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
  scrollbarTrack: "#f0f0f0",
  scrollbarThumb: "#b3b3b3",
};

export const DEFAULT_DARK_THEME: ThemeTokens = {
  bg: "#1e1e1e",
  surface: "#252526",
  surfaceRaised: "#2d2d30",
  surfaceHover: "#3a3a3d",
  surfaceActive: "#3f3f46",
  border: "#3c3c3c",
  borderMuted: "#5a5a5a",
  borderSubtle: "#333333",
  text: "#e8e8e8",
  textSecondary: "#cccccc",
  textMuted: "#a0a0a0",
  textFaint: "#787878",
  textOnAccent: "#ffffff",
  accent: "#4d8dff",
  accentBgSubtle: "#1c2b45",
  success: "#4caf6d",
  successBg: "#16301f",
  warning: "#d9a441",
  warningBg: "#3a2e10",
  warningBgSubtle: "rgba(217, 164, 65, 0.14)",
  danger: "#e5636f",
  dangerBg: "#3a1418",
  dangerBgSubtle: "rgba(229, 99, 111, 0.12)",
  info: "#4dc0d6",
  infoBg: "#123238",
  infoBgSubtle: "rgba(77, 192, 214, 0.12)",
  canvasBg: "#14161a",
  canvasText: "#ffffff",
  fontMono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
  // "swap the way they currently are" (item 9, UI pass 2026-09-15): a dark
  // grey TRACK with a lighter grey THUMB, the reverse of this theme's own
  // surfaceHover/surfaceActive pair (where the darker tone is the hover
  // background, not a scrollbar's resting state).
  scrollbarTrack: "#2d2d30",
  scrollbarThumb: "#8a8a8e",
};

export type BuiltInThemeId = "light" | "dark";
export const BUILT_IN_THEMES: Record<BuiltInThemeId, { name: string; tokens: ThemeTokens }> = {
  light: { name: "Light", tokens: DEFAULT_LIGHT_THEME },
  dark: { name: "Dark", tokens: DEFAULT_DARK_THEME },
};

export function isBuiltInThemeId(id: string): id is BuiltInThemeId {
  return id === "light" || id === "dark";
}

/** A user-saved theme, a name plus a full token set, never a diff against a built-in. */
export interface CustomTheme {
  id: string;
  name: string;
  tokens: ThemeTokens;
}

export const THEME_STORE_KEYS = {
  activeThemeId: "activeThemeId",
  customThemes: "customThemes",
  uiFontScale: "uiFontScale",
} as const;

export const DEFAULT_ACTIVE_THEME_ID: string = "light";

// A global UI-scale preference (item 6, UI pass 2026-09-15), not a per-theme
// token: every rem-based size in the app (component stylesheets almost all
// use rem, not px) is relative to the HTML root's own font-size, so scaling
// that one value scales the whole UI together, menus/tabs included, without
// threading a scale prop through every component. It applies on top of
// each component's own base size (TitleBar.module.css/TabBar.module.css
// already ship smaller defaults for the menu/tab rows specifically), not
// instead of it. Clamped narrower than a typical browser zoom range because
// this scales spacing/padding along with text (they're the same rem units),
// so a wide swing risks clipping fixed-height rows rather than just
// reflowing text.
export const UI_FONT_SCALE_MIN = 0.75;
export const UI_FONT_SCALE_MAX = 1.25;
export const DEFAULT_UI_FONT_SCALE = 0.9;

export function sanitizeUiFontScale(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_UI_FONT_SCALE;
  return Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, n));
}

export function applyUiFontScale(scale: number): void {
  document.documentElement.style.setProperty("--ui-font-scale", String(scale));
}

/**
 * Fills in any token missing or non-string from a value read off disk,
 * settings.json is user-editable and a saved theme predating a future token
 * addition must not crash or silently lose the rest of its palette. `fallback`
 * is normally `DEFAULT_LIGHT_THEME`, itself guaranteed complete.
 */
export function sanitizeThemeTokens(value: unknown, fallback: ThemeTokens): ThemeTokens {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const result = {} as ThemeTokens;
  for (const id of THEME_TOKEN_IDS) {
    const v = source[id];
    result[id] = typeof v === "string" && v.length > 0 ? v : fallback[id];
  }
  return result;
}

/** Type guard plus sanitization for the whole `customThemes` array read from the store. */
export function sanitizeCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const result: CustomTheme[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (typeof e.name !== "string" || e.name.length === 0) continue;
    result.push({ id: e.id, name: e.name, tokens: sanitizeThemeTokens(e.tokens, DEFAULT_LIGHT_THEME) });
  }
  return result;
}

/** Resolves an active theme id (built-in or custom) to its saved tokens, falling back to Light for an id that no longer exists (a deleted custom theme, or a corrupted settings.json). */
export function resolveThemeTokens(id: string, customThemes: readonly CustomTheme[]): ThemeTokens {
  if (isBuiltInThemeId(id)) return BUILT_IN_THEMES[id].tokens;
  return customThemes.find((t) => t.id === id)?.tokens ?? DEFAULT_LIGHT_THEME;
}

export function resolveThemeName(id: string, customThemes: readonly CustomTheme[]): string {
  if (isBuiltInThemeId(id)) return BUILT_IN_THEMES[id].name;
  return customThemes.find((t) => t.id === id)?.name ?? BUILT_IN_THEMES.light.name;
}

function camelToKebab(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** The one place that writes theme tokens onto the page, every stylesheet reads them back via `var(--token-name)`. */
export function applyThemeTokens(tokens: ThemeTokens): void {
  const root = document.documentElement.style;
  for (const id of THEME_TOKEN_IDS) {
    root.setProperty(`--${camelToKebab(id)}`, tokens[id]);
  }
}

export function themeTokensEqual(a: ThemeTokens, b: ThemeTokens): boolean {
  return THEME_TOKEN_IDS.every((id) => a[id] === b[id]);
}

/** Not crypto-strength, a local id for a settings.json array entry, not a security token. */
export function generateThemeId(): string {
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
