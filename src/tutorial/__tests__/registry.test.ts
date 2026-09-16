// tutorial-design.md Sec.13 item 2, the test that stops a refactor
// silently breaking a tutorial: every anchor a step names must actually
// exist somewhere in the app. Reads the source tree with fs + a regex, the
// way scripts/check-breakdown-prereqs.mjs already does.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../parser/__tests__/testUtils";
import { TUTORIALS } from "../registry";

const uiHelp = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "ui-help.json"), "utf8"),
) as {
  entries: { id: string; text: string }[];
};
const uiHelpIds = new Set(uiHelp.entries.map((e) => e.id));

const SRC_DIR = join(REPO_ROOT, "src");

function sourceFiles(extension: string): string[] {
  const relPaths = readdirSync(SRC_DIR, { recursive: true }) as string[];
  return relPaths
    .filter((p) => p.endsWith(extension))
    .map((p) => join(SRC_DIR, p));
}

function idsMatching(files: string[], pattern: RegExp): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

// A HelpTip id can also reach the DOM threaded through a prop rather than a
// literal `<HelpTip id="...">` (landPlacement.canvas is the existing
// example, per src/tools/__tests__/helpCoverage.test.ts), this test only
// needs SOME evidence the id resolves, and a ui-help.json entry is exactly
// that evidence regardless of how the id reaches its wrapper.
const helpTipIdsInSource = idsMatching(
  sourceFiles(".tsx"),
  /<HelpTip\s+id="([^"]+)"/g,
);
const regionAnchorIdsInSource = idsMatching(
  sourceFiles(".tsx"),
  /data-tutorial-anchor="([^"]+)"/g,
);

describe("tutorial registry", () => {
  it("has at least one tutorial", () => {
    expect(TUTORIALS.length).toBeGreaterThan(0);
  });

  it("tutorial ids are unique", () => {
    const ids = TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("step ids are unique within each tutorial", () => {
    for (const t of TUTORIALS) {
      const ids = t.steps.map((s) => s.id);
      expect(
        new Set(ids).size,
        `duplicate step id somewhere in "${t.id}"`,
      ).toBe(ids.length);
    }
  });

  it('every kind:"help" anchor id (including extraAnchors) exists as a HelpTip id in source or a ui-help.json entry', () => {
    const missing: string[] = [];
    for (const t of TUTORIALS) {
      for (const step of t.steps) {
        for (const anchor of [step.anchor, ...(step.extraAnchors ?? [])]) {
          if (
            anchor?.kind === "help" &&
            !helpTipIdsInSource.has(anchor.id) &&
            !uiHelpIds.has(anchor.id)
          ) {
            missing.push(`${t.id}/${step.id}: help:${anchor.id}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every kind:"region" anchor id (including extraAnchors) appears in a data-tutorial-anchor attribute somewhere in src/', () => {
    const missing: string[] = [];
    for (const t of TUTORIALS) {
      for (const step of t.steps) {
        for (const anchor of [step.anchor, ...(step.extraAnchors ?? [])]) {
          if (
            anchor?.kind === "region" &&
            !regionAnchorIdsInSource.has(anchor.id)
          ) {
            missing.push(`${t.id}/${step.id}: region:${anchor.id}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no step uses the selector escape hatch (Sec.4.3 — avoid), including in extraAnchors", () => {
    const offenders: string[] = [];
    for (const t of TUTORIALS) {
      for (const step of t.steps) {
        for (const anchor of [step.anchor, ...(step.extraAnchors ?? [])]) {
          if (anchor?.kind === "selector") offenders.push(`${t.id}/${step.id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every title is short enough for a callout heading (<= 6 words)", () => {
    const tooLong: string[] = [];
    for (const t of TUTORIALS) {
      for (const step of t.steps) {
        if (step.title.trim().split(/\s+/).length > 6)
          tooLong.push(`${t.id}/${step.id}: "${step.title}"`);
      }
    }
    expect(tooLong).toEqual([]);
  });

  it("feature tours carry a version and every other kind does not", () => {
    for (const t of TUTORIALS) {
      if (t.kind === "feature") {
        expect(
          t.version,
          `${t.id} is a feature tour with no version`,
        ).toBeTruthy();
      } else {
        expect(
          t.version,
          `${t.id} is kind "${t.kind}" but carries a version`,
        ).toBeUndefined();
      }
    }
  });
});
