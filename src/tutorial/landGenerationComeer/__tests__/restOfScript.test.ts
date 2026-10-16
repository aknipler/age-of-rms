// comeerRest.rms is a copy of Captain Kniples' Comeer v1.5 with two edits.
// This test rebuilds it from the original so the copy cannot drift, and checks
// the split the fill-in button relies on.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../parser/__tests__/testUtils";
import comeerRest from "../comeerRest.rms?raw";
import { REST_OF_SCRIPT, splitRest } from "../restOfScript";

const ORIGINAL = join(REPO_ROOT, "test-maps", "Comeer v1.5.rms");

/** Index of the one line that is exactly `text`, throwing when there is none, so an edit to the map fails here and not as a wrong copy. */
function lineOf(src: string[], text: string): number {
  const index = src.findIndex((l) => l.trimEnd() === text);
  if (index === -1) throw new Error(`no line "${text}" in the original`);
  return index;
}

/**
 * The edits the tutorial makes, applied to the original, line for line as the
 * copy was made. The cuts are found by their lines and not by number. The
 * first version cut at line 26, 118 and 150, and an edit to the map's
 * changelog would have moved every one.
 */
function derive(original: string): string {
  const src = original.replace(/\r\n/g, "\n").split("\n");
  const header = src
    .slice(lineOf(src, "#define 3_VILL_START"), lineOf(src, "<PLAYER_SETUP>"))
    .filter((l) => !l.startsWith("#const BORDERS_PL"))
    .map((l) =>
      l.startsWith("#const TERR_PLAYER_TEMP")
        ? "#const TERR_PLAYER_TEMP 124 /* snow soft, the terrain the tutorial gives the player lands */"
        : l,
    );
  while (header.length > 0 && header[header.length - 1].trim() === "")
    header.pop();
  const text = [
    ...src.slice(0, 3),
    "",
    ...header,
    "",
    ...src.slice(lineOf(src, "<ELEVATION_GENERATION>")),
  ]
    .join("\n")
    .replace(/\s+$/, "");
  return (
    text
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n") + "\n"
  );
}

describe("comeerRest.rms", () => {
  // The original is a tracked map (.gitignore whitelists it), so it is on
  // every clone. This used to skip when the file was missing, and when the
  // map was renamed to v1.5 (2026-10-14) it skipped silently and checked
  // nothing. A rename now fails here and names the path.
  it("is the original Comeer with only the two tutorial edits", () => {
    expect(existsSync(ORIGINAL), `${ORIGINAL} is missing`).toBe(true);
    expect(comeerRest).toBe(derive(readFileSync(ORIGINAL, "utf8")));
  });

  it("keeps the credit to Captain Kniples at the top", () => {
    expect(comeerRest.startsWith("/* Created by Captain Kniples")).toBe(true);
  });

  it("leaves out what the learner writes, the land section and the border constant", () => {
    expect(comeerRest).not.toContain("<LAND_GENERATION>");
    expect(comeerRest).not.toContain("<PLAYER_SETUP>");
    expect(comeerRest).not.toContain("#const BORDERS_PL");
    expect(comeerRest).toContain("#const TERR_PLAYER_TEMP 124");
  });

  it("splits into the three sections, and keeps the commented connection block in the terrain section", () => {
    expect(REST_OF_SCRIPT.map((b) => b.name)).toEqual([
      "ELEVATION_GENERATION",
      "TERRAIN_GENERATION",
      "OBJECTS_GENERATION",
    ]);
    const terrain = REST_OF_SCRIPT[1].lines.join("\n");
    expect(terrain).toContain("<CONNECTION_GENERATION>");
    expect(REST_OF_SCRIPT[2].lines.join("\n")).toContain(
      "place_on_specific_land_id 100",
    );
  });

  it("refuses a file that lost a section header", () => {
    expect(() => splitRest("#const A 1\n<ELEVATION_GENERATION>\n")).toThrow();
  });
});
