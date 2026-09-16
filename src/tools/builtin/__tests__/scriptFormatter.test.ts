// Coverage for scriptFormatter.ts's own output-building logic
// (docs/known-issues.md BUG-018), which had none: format.test.ts and
// corpus.test.ts exercise `formatScript` in `formatter/`, but nothing called
// `buildFormatterOutput` itself before this file.
//
// The case this exists to pin: a script whose only edits fall on BLANK lines
// (a run longer than `maxBlankLines` collapsing). `collectChanges` (formatter/
// index.ts) compares line TEXT and blank lines have none, so `result.changes`
// is empty while `result.edits` is not, and without the branch this test
// guards, `buildFormatterOutput` renders an empty preview block and a table
// with no rows, directly under a header claiming there ARE edits to apply.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { validateManifest } from "../../protocol";
import { buildFormatterOutput, scriptFormatter } from "../scriptFormatter";
import { formatScript } from "../formatter/index";

const lang = loadLanguage();

function parse(source: string) {
  return parseRms(source, lang);
}

describe("scriptFormatter manifest", () => {
  it("registers cleanly", () => {
    expect(validateManifest(scriptFormatter.manifest)).toEqual([]);
  });
});

describe("buildFormatterOutput", () => {
  it("reports nothing to change when there are no edits at all", () => {
    const source = "<LAND_GENERATION>\ncreate_land { land_percent 20 }\n";
    const p = parse(source);
    const result = formatScript(p, { indentStyle: "2 spaces" });
    expect(result.edits).toHaveLength(0);

    const blocks = buildFormatterOutput(p, result);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "keyValue", "text"]);
    expect(blocks[2]).toMatchObject({
      text: "Nothing to change. This script already matches these settings.",
    });
  });

  it("shows a line preview and a change table when a real line changes", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land\n{\nterrain_type GRASS\nland_percent 20\n}\n";
    const p = parse(source);
    const result = formatScript(p, { indentStyle: "2 spaces" });
    expect(result.edits.length).toBeGreaterThan(0);
    expect(result.changes.length).toBeGreaterThan(0);

    const blocks = buildFormatterOutput(p, result);
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "keyValue",
      "text",
      "table",
    ]);
    const table = blocks[3];
    if (table.kind !== "table") throw new Error("expected a table block");
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.rows.every((row) => row[1].length > 0)).toBe(true);
  });

  it("collapses to one sentence, with no preview and no table, when every edit only touches blank lines", () => {
    // The exact shape format.test.ts's "caps runs of blank lines" case uses:
    // four blank lines between two otherwise-untouched commands, collapsed to
    // the default maxBlankLines of 1. Neither command's own line of text
    // changes, so this is edits-without-changes by construction, not by luck.
    const source =
      "<LAND_GENERATION>\nland_percent 5\n\n\n\n\nland_percent 9\n";
    const p = parse(source);
    const result = formatScript(p, { indentStyle: "2 spaces" });
    expect(result.edits.length).toBeGreaterThan(0);
    expect(result.changes).toHaveLength(0);

    const blocks = buildFormatterOutput(p, result);

    // The defect this guards against: rendering the two blocks that assume a
    // non-empty `changes` array (the preview text, then the table) when there
    // is nothing in it.
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "keyValue", "text"]);

    const summary = blocks[2];
    if (summary.kind !== "text") throw new Error("expected a text block");
    expect(summary.text).toContain("No line's text changes.");
    expect(summary.text).toContain("adjust blank lines only.");
    expect(summary.text).not.toBe("");
  });
});
