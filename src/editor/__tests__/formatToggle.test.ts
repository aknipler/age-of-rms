import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { toggleCommandLayoutInRange } from "../formatToggle";
import type { SourceEdit } from "../../tools/builtin/formatter/index";

const lang = loadLanguage();

/** Applies edits the same way `useDocument.ts`'s `applyTextEdits` does. Order doesn't matter to the caller, so apply descending to keep untouched offsets valid. */
function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
  }
  return text;
}

function toggle(source: string, start: number, end = start) {
  const parse = parseRms(source, lang);
  return toggleCommandLayoutInRange(parse, { start, end });
}

describe("toggleCommandLayoutInRange", () => {
  it("expands a one-line command at the cursor", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    const text = applyEdits(source, result.edits);
    expect(text).toContain("create_land\n");
    expect(text).toMatch(/terrain_type GRASS\s*\n\s*land_percent 20/);
    expect(text).not.toContain("create_land { terrain_type");
  });

  it("round-trips: expanding then collapsing the same command returns to one line", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
    const cursor = source.indexOf("create_land") + 3;
    const expanded = applyEdits(source, toggle(source, cursor).edits);
    const backAgain = toggle(expanded, expanded.indexOf("create_land") + 3);
    expect(backAgain.toggledCount).toBe(1);
    const collapsed = applyEdits(expanded, backAgain.edits);
    expect(collapsed).toBe(source);
  });

  it("collapses a multi-line command at the cursor", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land\n{\nterrain_type GRASS\nland_percent 20\n}\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(1);
    const text = applyEdits(source, result.edits);
    expect(text).toContain(
      "create_land { terrain_type GRASS land_percent 20 }",
    );
  });

  it("a selection spanning two commands toggles each to the OPPOSITE of its own current shape", () => {
    // Node 2's existing indentation matches what the file's own (tab)
    // convention would compute, so expanding node 1 doesn't also have to
    // touch node 2. See the dedicated test below for what happens when it
    // would.
    const source =
      "<LAND_GENERATION>\n" +
      "create_land { terrain_type GRASS land_percent 20 }\n" +
      "create_land\n{\n\tterrain_type WATER\n\tland_percent 10\n}\n";
    const parse = parseRms(source, lang);
    const result = toggleCommandLayoutInRange(parse, {
      start: 0,
      end: source.length,
    });
    expect(result.toggledCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    const text = applyEdits(source, result.edits);
    // First command (was inline) is now expanded.
    expect(text).toMatch(/create_land\s*\n\s*\{\s*\n\s*terrain_type GRASS/);
    // Second command (was expanded) is now inline.
    expect(text).toContain(
      "create_land { terrain_type WATER land_percent 10 }",
    );
  });

  it("toggles a command in a script the formatter would also normalise elsewhere, touching only that command", () => {
    // Before 2026-11-14 this ran the formatter over the whole document, so
    // anything it would tidy elsewhere (the missing blank line before the
    // second section, the flush left attributes of the second command) made
    // the edit reach outside the command and the toggle did nothing at all.
    const source =
      "<LAND_GENERATION>\n" +
      "create_land { terrain_type GRASS land_percent 20 }\n" +
      "create_land\n{\nterrain_type WATER\nland_percent 10\n}\n" +
      "<ELEVATION_GENERATION>\n" +
      "create_elevation 4 { base_terrain GRASS }\n";
    const parse = parseRms(source, lang);
    const cursor = source.indexOf("create_land") + 3;
    const result = toggleCommandLayoutInRange(parse, {
      start: cursor,
      end: cursor,
    });
    expect(result.toggledCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    const text = applyEdits(source, result.edits);
    expect(text).toMatch(/create_land\s*\n\s*\{\s*\n\s*terrain_type GRASS/);
    // Everything after the toggled command is byte for byte what it was.
    expect(text.endsWith(source.slice(source.indexOf("create_land\n{")))).toBe(
      true,
    );
  });

  it("toggles each of two commands independently on a selection", () => {
    const source =
      "<LAND_GENERATION>\n" +
      "create_land { terrain_type GRASS land_percent 20 }\n" +
      "create_land\n{\nterrain_type WATER\nland_percent 10\n}\n";
    const parse = parseRms(source, lang);
    const result = toggleCommandLayoutInRange(parse, {
      start: 0,
      end: source.length,
    });
    expect(result.toggledCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    const text = applyEdits(source, result.edits);
    expect(text).toContain(
      "create_land { terrain_type WATER land_percent 10 }",
    );
  });

  it("keeps the indentation of a command that sits inside an indented section", () => {
    const source =
      "<LAND_GENERATION>\n" +
      "  create_land { terrain_type GRASS land_percent 20 }\n" +
      "  create_land\n  {\n    terrain_type WATER\n  }\n";
    const parse = parseRms(source, lang);
    const cursor = source.indexOf("create_land") + 3;
    const result = toggleCommandLayoutInRange(parse, {
      start: cursor,
      end: cursor,
    });
    expect(result.toggledCount).toBe(1);
    const text = applyEdits(source, result.edits);
    expect(text).toContain("  create_land\n");
    expect(text).toContain("    terrain_type GRASS");
  });

  it("skips collapsing a block that holds a nested if — expand direction has no such limit", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land\n{\nif TINY_MAP\nland_percent 20\nendif\n}\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.edits).toEqual([]);
  });

  it("a cursor touching nothing toggles nothing", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
    const result = toggle(source, 0); // inside the section header, not a command
    expect(result.toggledCount).toBe(0);
    expect(result.edits).toEqual([]);
  });

  it("finds a command nested inside an if branch", () => {
    const source =
      "<LAND_GENERATION>\nif TINY_MAP\ncreate_land { terrain_type GRASS land_percent 20 }\nendif\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(1);
    const text = applyEdits(source, result.edits);
    expect(text).not.toContain("create_land { terrain_type");
  });
});
