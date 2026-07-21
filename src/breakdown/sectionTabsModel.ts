// Pure §3.1 logic: ScriptNode -> the section sub-tab list. Kept free of
// React so SectionTabs is a thin renderer over this.
import type { Diagnostic, DiagnosticSeverity, Item, ScriptNode, SectionNode, Span } from "../parser/types";
import { CANONICAL_SECTION_ORDER, sectionLabel, SECTION_NUMBERS } from "./sectionLabels";

export interface SectionTab {
  /** Stable id for React keys / active-tab state. "header" | canonical name | raw unknown name. */
  id: string;
  label: string;
  known: boolean;
  /**
   * Absolute display number (Ash's ask) — fixed by canonical identity
   * (SECTION_NUMBERS: header=0, PLAYER_SETUP=1, ...), NOT by this tab's
   * position in the rendered array, so a missing section never shifts
   * the numbers on the sections after it. Unknown sections (no fixed
   * canonical slot) continue the count after the canonical seven, in
   * first-appearance order — see buildSectionTabs.
   */
  number: number;
  /** True for the canonical 7 and the Header tab; false for unknown sections (RMS0100). */
  isCanonicalOrHeader: boolean;
  items: Item[];
  /**
   * The disjoint source ranges this tab aggregates (a duplicate same-type
   * section tab covers more than one). Problem-badge severity is computed
   * by containment against these, never by min/max offset across them
   * (§3.1 — the ranges may have unrelated code between them).
   */
  ranges: Span[];
  /** The concrete SectionNodes this tab aggregates, in source order (for provenance / future add-command targeting). */
  sections: SectionNode[];
}

export function buildSectionTabs(script: ScriptNode): SectionTab[] {
  const tabs: SectionTab[] = [];

  if (script.preamble.length > 0) {
    tabs.push({
      id: "header",
      label: "Header",
      known: true,
      number: SECTION_NUMBERS.header,
      isCanonicalOrHeader: true,
      items: script.preamble,
      ranges: script.preamble.map((i) => i.span),
      sections: [],
    });
  }

  const byName = new Map<string, SectionNode[]>();
  const order: string[] = [];
  for (const s of script.sections) {
    if (!byName.has(s.name)) {
      byName.set(s.name, []);
      order.push(s.name);
    }
    byName.get(s.name)!.push(s);
  }

  // Canonical seven, always shown (data-driven order), even if absent
  // from this file (empty tab) — the tab set is driven by language.json's
  // sections[], not by what happens to be present.
  for (const name of CANONICAL_SECTION_ORDER) {
    const secs = byName.get(name) ?? [];
    tabs.push({
      id: name,
      label: sectionLabel(name),
      known: true,
      number: SECTION_NUMBERS[name],
      isCanonicalOrHeader: true,
      items: secs.flatMap((s) => s.items),
      ranges: secs.map((s) => s.span),
      sections: secs,
    });
  }

  // Unknown sections (RMS0100), aggregated by raw name, in first-appearance
  // order, after the canonical seven. No fixed canonical slot exists for
  // these (the name is arbitrary, typically a typo), so they continue the
  // absolute count from 8 upward in that same order — still stable per
  // name-and-position within the unknown set, just not tied to a
  // predefined identity the way the canonical seven are.
  let nextUnknownNumber = CANONICAL_SECTION_ORDER.length + 1; // 8
  for (const name of order) {
    if (CANONICAL_SECTION_ORDER.includes(name)) continue;
    const secs = byName.get(name)!;
    if (secs.length === 0 || secs[0].known) continue;
    tabs.push({
      id: `unknown:${name}`,
      label: name,
      known: false,
      number: nextUnknownNumber++,
      isCanonicalOrHeader: false,
      items: secs.flatMap((s) => s.items),
      ranges: secs.map((s) => s.span),
      sections: secs,
    });
  }

  return tabs;
}

function spanContains(ranges: Span[], span: Span): boolean {
  return ranges.some((r) => span.start >= r.start && span.end <= r.end);
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { info: 0, warning: 1, error: 2 };

/** Max diagnostic severity over the union of a tab's (possibly disjoint) ranges, or undefined if none apply. */
export function tabProblemSeverity(tab: SectionTab, diagnostics: Diagnostic[]): DiagnosticSeverity | undefined {
  let best: DiagnosticSeverity | undefined;
  for (const d of diagnostics) {
    if (!spanContains(tab.ranges, d.span)) continue;
    if (!best || SEVERITY_RANK[d.severity] > SEVERITY_RANK[best]) best = d.severity;
  }
  return best;
}
