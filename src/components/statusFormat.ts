// Status-bar text formatting — pure, no React, so it can be unit-tested
// directly (same split as src/components/preview/tileInfo.ts, which pulled
// the readout's derivation out of PreviewCanvas for the same reason).
//
// The status bar is the app's most width-constrained surface: it carries
// three resource buckets of four figures each plus a problem count, all on
// one line above a code editor. Everything here exists to make a number
// short enough to fit while staying honest about its magnitude, with the
// exact value one hover away.

import type { Diagnostic } from "../parser/types";

/**
 * Scale suffixes, largest first. The list is walked from the top, so the
 * first entry whose divisor fits is the one used.
 */
const UNITS = [
  { div: 1e9, suffix: "b" },
  { div: 1e6, suffix: "m" },
  { div: 1e3, suffix: "k" },
] as const;

/** Below this many units, one decimal place; at or above it, none. */
const DECIMAL_CEILING = 100;

/**
 * Compact magnitude for a status-bar figure.
 *
 * Under 1000 the number is printed whole. Above that it takes a scale
 * suffix and gets ONE decimal place while it is under 100 of that scale,
 * none at or above it — so the printed figure never runs past four
 * characters plus its suffix ("999", "1.8k", "608k", "42.4m", "425m").
 * The old rule was one decimal at every magnitude, which produced
 * "2008.6k" — six digits, and a scale nobody reads at a glance.
 *
 * Trailing ".0" is stripped, since "60k" and "60.0k" carry the same
 * information and this whole module is about width.
 */
export function formatCompact(n: number): string {
  const rounded = Math.round(n);
  if (Math.abs(rounded) < 1000) return String(rounded);

  for (let i = 0; i < UNITS.length; i++) {
    const unit = UNITS[i];
    if (Math.abs(rounded) < unit.div) continue;

    // Round to the precision that will actually be PRINTED before deciding
    // which rule applies, so 99,960 prints "100k" rather than "100.0k" —
    // choosing on the unrounded 99.96 would pick the one-decimal branch and
    // then round straight past the threshold it was chosen for.
    const scaled = rounded / unit.div;
    const oneDp = Math.round(scaled * 10) / 10;
    if (Math.abs(oneDp) < DECIMAL_CEILING) {
      const fixed = oneDp.toFixed(1);
      return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}${unit.suffix}`;
    }

    const whole = Math.round(scaled);
    // Rounding can push a figure up into the next scale (999,600 → "1000k").
    // Promote rather than print a four-digit mantissa; `i > 0` because the
    // list is largest-first, so a larger unit is the PRECEDING entry.
    if (Math.abs(whole) >= 1000 && i > 0) {
      const bigger = UNITS[i - 1];
      return `${(rounded / bigger.div).toFixed(1).replace(/\.0$/, "")}${bigger.suffix}`;
    }
    return `${whole}${unit.suffix}`;
  }

  return String(rounded);
}

/**
 * The full number with thousands separators, for the hover readout that
 * backs every abbreviated figure. Locale is pinned to en-US rather than
 * left to the host: the compact form above is English-only ("k"/"m"/"b"),
 * so a comma-grouped exact value is the consistent partner, and a pinned
 * locale is what makes this testable at all.
 */
export function formatExact(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Collapses to a single figure when min === max — the common case for a script with no conditional placement. */
export function formatCompactRange(min: number, max: number): string {
  return min === max ? formatCompact(min) : `${formatCompact(min)}-${formatCompact(max)}`;
}

/** Exact-value partner to `formatCompactRange`, for the hover readout. */
export function formatExactRange(min: number, max: number): string {
  return min === max ? formatExact(min) : `${formatExact(min)} to ${formatExact(max)}`;
}

/**
 * Which of the four states the problem indicator is in. This is a plain
 * string union rather than the parser's own `DiagnosticSeverity` because it
 * carries one value that severity does not — "none" — and the indicator's
 * whole job is to distinguish "nothing wrong" from "nothing worse than
 * info". Same shape as a discriminant, but nothing switches on it except
 * the icon's colour.
 */
export type ProblemLevel = "none" | "info" | "warning" | "error";

export interface ProblemSummary {
  /** The WORST severity present, which is what the icon's colour reports. */
  level: ProblemLevel;
  errors: number;
  warnings: number;
  infos: number;
  /** The written breakdown the bar shows ("2 errors, 1 warning"). */
  label: string;
}

export function summariseProblems(diagnostics: readonly Diagnostic[]): ProblemSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors++;
    else if (diagnostic.severity === "warning") warnings++;
    else infos++;
  }

  const level: ProblemLevel =
    errors > 0 ? "error" : warnings > 0 ? "warning" : infos > 0 ? "info" : "none";

  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos > 0) parts.push(`${infos} info`);

  return {
    level,
    errors,
    warnings,
    infos,
    label: parts.length === 0 ? "No problems" : parts.join(", "),
  };
}
