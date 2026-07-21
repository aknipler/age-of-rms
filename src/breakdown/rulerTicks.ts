// §3.10 — the diagnostics overview ruler. Split per this codebase's
// "pure logic first, DOM glue after" convention (ephemeralAnchors.ts,
// selectionResolve.ts, comments.ts): deciding WHICH top-level items get a
// tick and what severity each shows is a pure function of the AST +
// diagnostics, fully testable without touching the DOM. The actual pixel
// positions require real layout measurement (card heights are variable
// and change at runtime) and live in DiagnosticsRuler.tsx instead — see
// that file's own doc comment for why this had to be split this way.
import type { Diagnostic, DiagnosticSeverity, Item } from "../parser/types";
import { maxSeverityWithin } from "./diagnosticsForSpan";

export interface RulerTick {
  /** The top-level item's own span.start — doubles as its `data-anchor` DOM lookup key (ItemCard.tsx) and as a selection anchor. */
  anchor: number;
  severity: DiagnosticSeverity;
}

/**
 * One tick per top-level item that carries at least one diagnostic
 * anywhere within its span — including inside a collapsed container's
 * hidden contents (`maxSeverityWithin` reads the whole span regardless of
 * expand state, which is exactly what makes "ticks for cards inside
 * collapsed containers still appear, positioned at the collapsed
 * container's tick" (§3.10) fall out for free, with no separate
 * expand-state check needed here).
 */
export function ticksForItems(items: readonly Item[], diagnostics: readonly Diagnostic[]): RulerTick[] {
  const ticks: RulerTick[] = [];
  for (const item of items) {
    const severity = maxSeverityWithin(diagnostics, item.span);
    if (severity) ticks.push({ anchor: item.span.start, severity });
  }
  return ticks;
}
