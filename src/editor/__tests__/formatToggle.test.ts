import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { toggleCommandLayoutInRange } from "../formatToggle";
import type { SourceEdit } from "../../tools/builtin/formatter/index";

const lang = loadLanguage();

/** Applies edits the same way `useDocument.ts`'s `applyTextEdits` does — order doesn't matter to the caller, so apply descending to keep untouched offsets valid. */
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
    const source = "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
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
    const source = "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
    const cursor = source.indexOf("create_land") + 3;
    const expanded = applyEdits(source, toggle(source, cursor).edits);
    const backAgain = toggle(expanded, expanded.indexOf("create_land") + 3);
    expect(backAgain.toggledCount).toBe(1);
    const collapsed = applyEdits(expanded, backAgain.edits);
    expect(collapsed).toBe(source);
  });

  it("collapses a multi-line command at the cursor", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nterrain_type GRASS\nland_percent 20\n}\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(1);
    const text = applyEdits(source, result.edits);
    expect(text).toContain("create_land { terrain_type GRASS land_percent 20 }");
  });

  it("a selection spanning two commands toggles each to the OPPOSITE of its own current shape", () => {
    // Node 2's existing indentation matches what the file's own (tab)
    // convention would compute, so expanding node 1 doesn't also have to
    // touch node 2 — see the dedicated test below for what happens when it
    // would.
    const source =
      "<LAND_GENERATION>\n" +
      "create_land { terrain_type GRASS land_percent 20 }\n" +
      "create_land\n{\n\tterrain_type WATER\n\tland_percent 10\n}\n";
    const parse = parseRms(source, lang);
    const result = toggleCommandLayoutInRange(parse, { start: 0, end: source.length });
    expect(result.toggledCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    const text = applyEdits(source, result.edits);
    // First command (was inline) is now expanded.
    expect(text).toMatch(/create_land\s*\n\s*\{\s*\n\s*terrain_type GRASS/);
    // Second command (was expanded) is now inline.
    expect(text).toContain("create_land { terrain_type WATER land_percent 10 }");
  });

  it("declines to expand a command when doing so would also re-indent an unrelated sibling", () => {
    // Node 2 is already expanded but with NO indentation at all, and it is
    // the only indentation evidence in the file — so picking an indent unit
    // to expand node 1 with also normalizes node 2's flush-left attributes,
    // which is exactly the kind of collateral edit this hotkey must refuse
    // to make. Node 2's own toggle (expanded -> inline) has no indentation
    // decision to make, so it succeeds independently.
    const source =
      "<LAND_GENERATION>\n" +
      "create_land { terrain_type GRASS land_percent 20 }\n" +
      "create_land\n{\nterrain_type WATER\nland_percent 10\n}\n";
    const parse = parseRms(source, lang);
    const result = toggleCommandLayoutInRange(parse, { start: 0, end: source.length });
    expect(result.toggledCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    const text = applyEdits(source, result.edits);
    // Node 1 (the one that would have collided) is untouched.
    expect(text).toContain("create_land { terrain_type GRASS land_percent 20 }");
    // Node 2 still collapsed cleanly on its own.
    expect(text).toContain("create_land { terrain_type WATER land_percent 10 }");
  });

  it("skips collapsing a block that holds a nested if — expand direction has no such limit", () => {
    const source = "<LAND_GENERATION>\ncreate_land\n{\nif TINY_MAP\nland_percent 20\nendif\n}\n";
    const cursor = source.indexOf("create_land") + 3;
    const result = toggle(source, cursor);
    expect(result.toggledCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.edits).toEqual([]);
  });

  it("a cursor touching nothing toggles nothing", () => {
    const source = "<LAND_GENERATION>\ncreate_land { terrain_type GRASS land_percent 20 }\n";
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
