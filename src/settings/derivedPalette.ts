// Colours the app derives from the active theme rather than storing as
// theme tokens. The Code tab's Monaco theme and the Breakdown's comment,
// attribute and constant colouring read the same syntax colours, so a
// colour means the same thing in both tabs.
//
// They are not theme tokens, for the reason monacoTheme.ts gives. A person
// editing a custom theme picks backgrounds and text, and should not need to
// know what "type.identifier" is. Which set applies is read off the theme's
// own background with the same luminance test Monaco uses, so a custom
// theme gets whichever set stays readable on it.
//
// Pure apart from applyDerivedPalette, the one function that writes to the
// page, the same split theme.ts keeps.

import type { ThemeTokens } from "./theme";

/**
 * Relative luminance (WCAG formula) of a `#rrggbb` colour, 0 for black and
 * 1 for white. An unparseable value (a custom theme's draft token while the
 * person is still typing it) reads as light rather than throwing, the same
 * "don't crash on user-editable data" rule as sanitizeThemeTokens.
 */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return 1;
  const channel = (offset: number) =>
    parseInt(match[1].slice(offset, offset + 2), 16) / 255;
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [0, 2, 4].map((offset) => linearize(channel(offset)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkTheme(tokens: ThemeTokens): boolean {
  return relativeLuminance(tokens.bg) < 0.5;
}

/** Syntax colours shared by the Code tab and the Breakdown, as `#rrggbb`. */
export interface SyntaxColors {
  comment: string;
  attribute: string;
  constant: string;
}

/** Tuned to sit on a light background. Monaco's `comment`, `type.identifier` and `constant` rules read these. */
export const LIGHT_SYNTAX: SyntaxColors = {
  comment: "#6A737D",
  attribute: "#E36209",
  constant: "#0B7285",
};

/** Tuned to sit on a dark background. */
export const DARK_SYNTAX: SyntaxColors = {
  comment: "#8B949E",
  attribute: "#FFA657",
  constant: "#56D4DD",
};

/** Every derived colour as the `--syntax-*` CSS custom property it is written to, for the given theme. */
export function derivedPaletteVars(
  tokens: ThemeTokens,
): Record<string, string> {
  const syntax = isDarkTheme(tokens) ? DARK_SYNTAX : LIGHT_SYNTAX;
  return {
    "--syntax-comment": syntax.comment,
    "--syntax-attribute": syntax.attribute,
    "--syntax-constant": syntax.constant,
  };
}

/** Writes derivedPaletteVars onto the page. theme.ts's applyThemeTokens calls it after the tokens. */
export function applyDerivedPalette(tokens: ThemeTokens): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(derivedPaletteVars(tokens)))
    root.setProperty(name, value);
}
