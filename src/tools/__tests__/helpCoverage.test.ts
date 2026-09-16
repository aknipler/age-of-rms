// CLAUDE.md's hard rule: every interactive element wraps in <HelpTip id="...">
// with a MATCHING entry in reference/data/ui-help.json, as it is built.
//
// A HelpTip whose id has no entry renders an empty popup, which is worse than
// no tip at all. It looks broken rather than absent. Nothing enforced the
// pairing before; this test does it for the pane, by reading the source rather
// than by trusting a list maintained by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../parser/__tests__/testUtils";

const uiHelp = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "ui-help.json"), "utf8"),
) as {
  entries: { id: string; text: string }[];
};
const ids = new Set(uiHelp.entries.map((e) => e.id));

function helpTipIdsIn(relPath: string): string[] {
  const source = readFileSync(join(REPO_ROOT, relPath), "utf8");
  return [...source.matchAll(/<HelpTip\s+id="([^"]+)"/g)].map((m) => m[1]);
}

describe("Advanced Tools help coverage", () => {
  it("every HelpTip in the pane has a ui-help.json entry", () => {
    const used = helpTipIdsIn("src/tools/ToolsPane.tsx");
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("every HelpTip in the settings tab has one too", () => {
    const used = helpTipIdsIn(
      "src/components/settings/AdvancedToolsSettings.tsx",
    );
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  // Slice-4b item 5: the Land Placement panel, new files, so the gate needs
  // their paths added or it silently covers nothing built this slice.
  it("every HelpTip in the Land Placement panel has a ui-help.json entry", () => {
    const used = helpTipIdsIn(
      "src/tools/builtin/landPlacement/panel/LandPlacementPanel.tsx",
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  // The panel's Tool Explanation dialog is its own file, so the scan above
  // cannot see it. A HelpTip living one import away from a gated file is
  // exactly the gap this suite exists to close, so the new file is named
  // here rather than left to the next reader to notice.
  it("every HelpTip in the Land Placement explanation dialog has one too", () => {
    const used = helpTipIdsIn(
      "src/tools/builtin/landPlacement/panel/LandPlacementHelpDialog.tsx",
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  // `landPlacement.canvas` is threaded through OverlayCanvas as a PROP
  // (`helpTipId="landPlacement.canvas"`), not a literal `<HelpTip id="...">`
  // in either file. The regex scan above cannot discover it by pattern, so
  // it is named explicitly here, the same way the eight `tools.*` ids are
  // pinned below.
  it("carries the landPlacement.* ids threaded through OverlayCanvas as a prop rather than a literal HelpTip", () => {
    expect(
      ids.has("landPlacement.canvas"),
      "missing ui-help entry landPlacement.canvas",
    ).toBe(true);
  });

  // The spec names these eight so the 5.1 session cannot skip them. Naming them
  // in a test rather than in prose is the difference between an obligation and a
  // reminder.
  it("carries all eight ids the pane owes", () => {
    for (const id of [
      "tools.select",
      "tools.run",
      "tools.cancel",
      "tools.progress",
      "tools.apply",
      "tools.log",
      "tools.output",
      "tools.params",
    ]) {
      expect(ids.has(id), `missing ui-help entry ${id}`).toBe(true);
    }
  });

  it("has no empty help text", () => {
    const empty = uiHelp.entries
      .filter((e) => e.text.trim().length === 0)
      .map((e) => e.id);
    expect(empty).toEqual([]);
  });

  // The settings tab told the user the pane did not exist. It does now, and a
  // stale placeholder is the kind of thing that survives for months because
  // nothing reads it.
  it("the settings tab no longer claims the pane is unbuilt", () => {
    const source = readFileSync(
      join(REPO_ROOT, "src/components/settings/AdvancedToolsSettings.tsx"),
      "utf8",
    );
    expect(source).not.toContain("hasn't been built yet");
    expect(source).not.toContain("SettingsPlaceholder");
  });
});
