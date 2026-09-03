// tutorial-design.md Sec.10, Tutorial B's one gate. Every other step is
// `manual` (nothing to check, per Sec.10's own copy constraint), so this file
// is small: it exists to prove "open-a-file" actually blocks, not just that
// it exists (registry.test.ts already covers title length / anchor
// existence / unique ids for every tutorial, including this one).

import { describe, expect, it } from "vitest";
import type { StepContext } from "../types";
import { appTourTutorial } from "../content/appTour";

function stepById(id: string) {
  const step = appTourTutorial.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no app-tour step with id "${id}"`);
  return step;
}

function ctxFor(hasFile: boolean): StepContext {
  return {
    parseResult: null,
    source: "",
    activeTab: "breakdown",
    activeSectionId: null,
    hasFile,
  };
}

describe("app-tour — the one check step", () => {
  it("is the first step, so nothing past it can run against a file-less app", () => {
    expect(appTourTutorial.steps[0].id).toBe("open-a-file");
  });

  it("is false with nothing open and true once a file exists", () => {
    const step = stepById("open-a-file");
    if (step.completion.kind !== "check") throw new Error('"open-a-file" is not a check step');
    expect(step.completion.test(ctxFor(false))).toBe(false);
    expect(step.completion.test(ctxFor(true))).toBe(true);
  });

  it("every step after the gate is manual — a tour, not an exercise", () => {
    for (const step of appTourTutorial.steps.slice(1)) {
      expect(step.completion.kind, `"${step.id}" should be manual`).toBe("manual");
    }
  });
});
