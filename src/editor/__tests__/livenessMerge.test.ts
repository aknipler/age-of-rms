// Where liveness marks are merged into a diagnostics list (livenessMerge.ts).
import { describe, expect, it } from "vitest";
import { livenessMarksFor, withLivenessMarks } from "../livenessMerge";
import type { Diagnostic } from "../../parser/types";

const parseDiagnostic: Diagnostic = {
  severity: "warning",
  code: "RMS0201",
  message: "from the parse",
  span: { start: 0, end: 1 },
};
const mark: Diagnostic = {
  severity: "info",
  code: "RMS0321",
  message: "a liveness mark",
  span: { start: 2, end: 3 },
};
const liveness = {
  source: "new text",
  status: "complete" as const,
  diagnostics: [mark],
};

describe("liveness marks beside a diagnostics list", () => {
  it("appends the marks when they were computed for the same text", () => {
    expect(withLivenessMarks([parseDiagnostic], "new text", liveness)).toEqual([
      parseDiagnostic,
      mark,
    ]);
  });

  it("drops marks computed for other text, which would sit on the wrong line", () => {
    const list = [parseDiagnostic];
    expect(withLivenessMarks(list, "newer text", liveness)).toBe(list);
    expect(livenessMarksFor(liveness, "newer text")).toEqual([]);
  });

  it("hands back the list itself, not a copy, when there are no marks", () => {
    const list = [parseDiagnostic];
    expect(withLivenessMarks(list, "new text", null)).toBe(list);
  });

  it("returns the same empty array every time, so a prop built from it is stable", () => {
    expect(livenessMarksFor(null, "x")).toBe(livenessMarksFor(null, "y"));
  });
});
