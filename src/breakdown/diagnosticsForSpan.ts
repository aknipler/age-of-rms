import type { Diagnostic, DiagnosticSeverity, Span } from "../parser/types";

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { info: 0, warning: 1, error: 2 };

/** Diagnostics whose span is contained within `span` — the §5 rule: row/card badges reuse the parser's own diagnostics, mapped by span containment, never Breakdown-invented validation. */
export function diagnosticsWithin(diagnostics: readonly Diagnostic[], span: Span): Diagnostic[] {
  return diagnostics.filter((d) => d.span.start >= span.start && d.span.end <= span.end);
}

export function maxSeverityWithin(
  diagnostics: readonly Diagnostic[],
  span: Span,
): DiagnosticSeverity | undefined {
  const found = diagnosticsWithin(diagnostics, span);
  if (found.length === 0) return undefined;
  return found.reduce<DiagnosticSeverity>(
    (best, d) => (SEVERITY_RANK[d.severity] > SEVERITY_RANK[best] ? d.severity : best),
    found[0].severity,
  );
}
