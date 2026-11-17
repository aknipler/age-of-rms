// The relatedInformation half of the Diagnostic to Monaco marker mapping. It is
// split out of diagnosticsToMarkers.ts because that file imports monaco-editor,
// which Vitest cannot load. The mapping only reads a model's getPositionAt and
// uri, so a stub model is enough.
import { describe, expect, it } from "vitest";
import { relatedInformationOf } from "../relatedInformation";
import type { Diagnostic } from "../../parser/types";

// One character per column and a newline every ten characters, enough to tell
// the start from the end and one line from another.
const uri = { toString: () => "inmemory://model/1" };
const model = {
  uri,
  getPositionAt: (offset: number) => ({
    lineNumber: Math.floor(offset / 10) + 1,
    column: (offset % 10) + 1,
  }),
};

describe("relatedInformationOf", () => {
  it("maps a related place to relatedInformation on the model's own uri", () => {
    const diagnostic: Diagnostic = {
      severity: "info",
      code: "RMS0321",
      message: "A is only defined when TINY_MAP",
      span: { start: 25, end: 28 },
      related: [{ span: { start: 12, end: 14 }, message: "Defined on line 2" }],
    };
    const related = relatedInformationOf(model, diagnostic);
    expect(related).toEqual([
      {
        resource: uri,
        message: "Defined on line 2",
        startLineNumber: 2,
        startColumn: 3,
        endLineNumber: 2,
        endColumn: 5,
      },
    ]);
  });

  it("leaves relatedInformation absent when the diagnostic has no related places", () => {
    const related = relatedInformationOf(model, {
      severity: "warning",
      code: "RMS0201",
      message: "x",
      span: { start: 0, end: 1 },
    });
    expect(related).toBeUndefined();
  });
});
