import type * as monacoNs from "monaco-editor";
import { DEFAULT_LIGHT_THEME, type ThemeTokens } from "../settings/theme";

// Monaco is <canvas>-rendered. It never reads the app's CSS custom
// properties (settings/theme.ts's `var(--token-name)` mechanism), so the
// Theme settings tab's light/dark/custom palettes would otherwise stop at
// the editor's border. This is the bridge: it turns whichever ThemeTokens
// are currently active into a real `monaco.editor.IStandaloneThemeData`
// and (re)registers it under one stable name, so "customisable Monaco
// theme" falls out of the theme system that already exists rather than
// needing a second one.
export const AOE2_RMS_MONACO_THEME = "aoe2-rms-dynamic";

// Relative luminance (WCAG formula) of a token's background decides
// whether Monaco's *built-in* editor chrome (selection, indent guides,
// the find-widget, etc., everything this theme doesn't override
// explicitly) should inherit from "vs" or "vs-dark". Custom themes are
// arbitrary colors a user picked with no obligation to be "light" or
// "dark" in name, so this is read from the color itself rather than from
// which built-in/custom theme it came from.
function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  // An unparseable value (a custom theme's draft token mid-edit, e.g. the
  // user is still typing a hex code) falls back to light rather than
  // throwing, the same "don't crash on user-editable data" reasoning as
  // sanitizeThemeTokens.
  if (!match) return 1;
  const channel = (offset: number) =>
    parseInt(match[1].slice(offset, offset + 2), 16) / 255;
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [0, 2, 4].map((offset) => linearize(channel(offset)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Syntax colors, unlike editor chrome, can't just be read off the app
// theme's tokens. There's no "keyword color" token in theme.ts, and
// there shouldn't be (that's Monaco-specific vocabulary a non-technical
// theme editor shouldn't need to know). Instead two hand-picked palettes
// cover the two cases that matter for legibility: syntax colors tuned to
// sit on a light background, and a second set tuned for a dark one. Which
// one applies is decided by the same background-luminance check as the
// chrome above, so a custom theme gets whichever set actually stays
// readable against the background color the user chose.
const LIGHT_SYNTAX_RULES: monacoNs.editor.ITokenThemeRule[] = [
  { token: "comment", foreground: "6A737D", fontStyle: "italic" },
  { token: "tag", foreground: "22863A", fontStyle: "bold" },
  { token: "keyword.directive", foreground: "6F42C1" },
  { token: "keyword.control", foreground: "005CC5", fontStyle: "bold" },
  { token: "keyword", foreground: "B31D28", fontStyle: "bold" },
  { token: "type.identifier", foreground: "E36209" },
  { token: "constant", foreground: "0B7285" },
  { token: "number", foreground: "24292E", fontStyle: "bold" },
];

const DARK_SYNTAX_RULES: monacoNs.editor.ITokenThemeRule[] = [
  { token: "comment", foreground: "8B949E", fontStyle: "italic" },
  { token: "tag", foreground: "7EE787", fontStyle: "bold" },
  { token: "keyword.directive", foreground: "D2A8FF" },
  { token: "keyword.control", foreground: "79C0FF", fontStyle: "bold" },
  { token: "keyword", foreground: "FF7B72", fontStyle: "bold" },
  { token: "type.identifier", foreground: "FFA657" },
  { token: "constant", foreground: "56D4DD" },
  { token: "number", foreground: "E6EDF3", fontStyle: "bold" },
];

/**
 * (Re)registers `AOE2_RMS_MONACO_THEME` from the app's current theme
 * tokens and switches the editor to it. Cheap enough to call on every
 * `draftTokens` change (theme.ts's own `applyThemeTokens` does the same
 * for CSS custom properties on every keystroke in the color pickers).
 * `defineTheme` on an already-registered name just updates its data, it
 * doesn't recreate anything.
 */
export function defineAoe2RmsMonacoTheme(
  monaco: typeof monacoNs,
  tokens: ThemeTokens,
): void {
  const isDark = relativeLuminance(tokens.bg) < 0.5;
  monaco.editor.defineTheme(AOE2_RMS_MONACO_THEME, {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: isDark ? DARK_SYNTAX_RULES : LIGHT_SYNTAX_RULES,
    colors: {
      "editor.background": tokens.surface,
      "editor.foreground": tokens.text,
      "editor.lineHighlightBackground": tokens.surfaceHover,
      "editorLineNumber.foreground": tokens.textFaint,
      "editorLineNumber.activeForeground": tokens.textSecondary,
      "editorCursor.foreground": tokens.accent,
      "editor.selectionBackground": tokens.accentBgSubtle,
      "editorIndentGuide.background": tokens.borderSubtle,
      "editorWidget.background": tokens.surfaceRaised,
      "editorWidget.border": tokens.border,
      "editorGutter.background": tokens.surface,
    },
  });
  // Redefining the currently active theme's data doesn't repaint on its
  // own. Re-asserting it as the active theme is what makes the new
  // colors actually show up immediately as the user drags a color picker.
  monaco.editor.setTheme(AOE2_RMS_MONACO_THEME);
}

/**
 * Registers the theme once at startup (main.tsx, before any `<Editor>`
 * mounts) using the light theme's tokens as a placeholder. CodePane
 * overwrites this with the real active tokens on its first mount, via the
 * effect below. Needed only so the `theme` prop always names something
 * that exists; the flash between this and the real tokens is imperceptible.
 */
export function registerAoe2RmsMonacoThemePlaceholder(
  monaco: typeof monacoNs,
): void {
  defineAoe2RmsMonacoTheme(monaco, DEFAULT_LIGHT_THEME);
}
