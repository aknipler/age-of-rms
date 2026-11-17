// The part of the Diagnostic to Monaco marker mapping that needs no Monaco
// import, so a plain Vitest run can test it. monaco-editor cannot be loaded
// there (its package.json has no resolvable entry for Node), which is why
// diagnosticsToMarkers.ts itself stays untested and keeps to the enum lookup.
import type { Diagnostic } from "../parser/types";

/** The two things of a Monaco model that the mapping reads. `Uri` is Monaco's own type in the app and anything in a test. */
export interface PositionModel<Uri> {
  uri: Uri;
  getPositionAt(offset: number): { lineNumber: number; column: number };
}

/**
 * Monaco's `relatedInformation` for a diagnostic: each other place the message
 * refers to, drawn as a link under the message. Their resource is the model's
 * own uri, since a place that is in the same file is in the same model.
 * Returns undefined, not an empty list, when there is nothing to show.
 */
export function relatedInformationOf<Uri>(
  model: PositionModel<Uri>,
  diagnostic: Diagnostic,
) {
  return diagnostic.related?.map((place) => {
    const from = model.getPositionAt(place.span.start);
    const to = model.getPositionAt(place.span.end);
    return {
      resource: model.uri,
      message: place.message,
      startLineNumber: from.lineNumber,
      startColumn: from.column,
      endLineNumber: to.lineNumber,
      endColumn: to.column,
    };
  });
}
