import * as monaco from "monaco-editor";
import type { Diagnostic, DiagnosticSeverity } from "../parser/types";

const SEVERITY_MAP: Record<DiagnosticSeverity, monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
};

/**
 * Converts the parser's char-offset diagnostics into Monaco's
 * line/column marker format. Takes the model (not raw text) so it can
 * use Monaco's own `getPositionAt` — the same UTF-16-code-unit counting
 * the parser used when it computed those offsets against this same
 * string, so the two stay consistent.
 */
export function diagnosticsToMarkers(
  model: monaco.editor.ITextModel,
  diagnostics: Diagnostic[],
): monaco.editor.IMarkerData[] {
  return diagnostics.map((diagnostic) => {
    const start = model.getPositionAt(diagnostic.span.start);
    const end = model.getPositionAt(diagnostic.span.end);
    return {
      severity: SEVERITY_MAP[diagnostic.severity],
      code: diagnostic.code,
      message: diagnostic.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
}
