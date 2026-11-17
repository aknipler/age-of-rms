// Where the main thread merges the liveness marks into a diagnostics list
// (docs/name-liveness-slice-b-brief.md B6). Pure, so the rule is testable
// without rendering App.
import type { Diagnostic } from "../parser/types";
import type { ParsedDocumentState } from "../useParsedDocument";

const NONE: readonly Diagnostic[] = [];

/**
 * The marks that belong beside a list computed for `source`, or an empty list.
 * A mark is a character offset into the text it was computed for. Beside a list
 * for newer text it would sit on the wrong line, so a source that differs
 * drops them. The same empty array comes back every time, so a React prop
 * built from it keeps its identity between renders.
 */
export function livenessMarksFor(
  liveness: ParsedDocumentState["liveness"],
  source: string,
): readonly Diagnostic[] {
  return liveness !== null && liveness.source === source
    ? liveness.diagnostics
    : NONE;
}

/** `diagnostics` with the marks for `source` appended, or `diagnostics` itself when there are none. */
export function withLivenessMarks(
  diagnostics: Diagnostic[],
  source: string,
  liveness: ParsedDocumentState["liveness"],
): Diagnostic[] {
  const marks = livenessMarksFor(liveness, source);
  return marks.length === 0 ? diagnostics : [...diagnostics, ...marks];
}
