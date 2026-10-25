// 2026-10-23, the colours derived from the theme (derivedPalette.ts).

import { describe, expect, it } from "vitest";
import {
  DARK_SYNTAX,
  LIGHT_SYNTAX,
  derivedPaletteVars,
  relativeLuminance,
} from "../derivedPalette";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../theme";

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

describe("derivedPaletteVars", () => {
  it("gives a light theme the light syntax colours", () => {
    const vars = derivedPaletteVars(DEFAULT_LIGHT_THEME);
    expect(vars["--syntax-comment"]).toBe(LIGHT_SYNTAX.comment);
    expect(vars["--syntax-constant"]).toBe(LIGHT_SYNTAX.constant);
  });

  it("gives a dark theme the dark syntax colours", () => {
    const vars = derivedPaletteVars(DEFAULT_DARK_THEME);
    expect(vars["--syntax-comment"]).toBe(DARK_SYNTAX.comment);
    expect(vars["--syntax-attribute"]).toBe(DARK_SYNTAX.attribute);
  });

  it("keeps comment text readable on the Breakdown's surface", () => {
    // A margin note's text sits straight on the pane, with no card behind
    // it. WCAG AA for body text is 4.5.
    expect(
      contrast(LIGHT_SYNTAX.comment, DEFAULT_LIGHT_THEME.surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(DARK_SYNTAX.comment, DEFAULT_DARK_THEME.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
