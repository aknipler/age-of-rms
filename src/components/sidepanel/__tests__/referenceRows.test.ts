import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareConstantRows, matchesQuery } from "../referenceRows";
import type { GameConstantEntry, GameConstantsData } from "../../../breakdown/gameConstants";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const gameConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as GameConstantsData;

function row(partial: Partial<GameConstantEntry>): GameConstantEntry {
  return {
    constId: null,
    rmsConstant: "X",
    descriptiveName: "X",
    category: "object",
    deTextureFile: null,
    verified: true,
    ...partial,
  } as GameConstantEntry;
}

describe("compareConstantRows", () => {
  it("orders by descriptive name first", () => {
    const rows = [row({ descriptiveName: "Wolf" }), row({ descriptiveName: "Deer" })].sort(compareConstantRows);
    expect(rows.map((r) => r.descriptiveName)).toEqual(["Deer", "Wolf"]);
  });

  it("falls to the RMS constant when descriptive names tie, which is the alias case", () => {
    // The real pair: 450 is both MARLIN1 and GREAT_FISH_MARLIN, same name.
    const rows = [
      row({ descriptiveName: "Marlin", rmsConstant: "MARLIN1", constId: 450 }),
      row({ descriptiveName: "Marlin", rmsConstant: "GREAT_FISH_MARLIN", constId: 450 }),
    ].sort(compareConstantRows);
    expect(rows.map((r) => r.rmsConstant)).toEqual(["GREAT_FISH_MARLIN", "MARLIN1"]);
  });

  it("falls to the constant id when name and constant both tie", () => {
    const rows = [
      row({ descriptiveName: "Water", rmsConstant: null, constId: 22 }),
      row({ descriptiveName: "Water", rmsConstant: null, constId: 4 }),
    ].sort(compareConstantRows);
    expect(rows.map((r) => r.constId)).toEqual([4, 22]);
  });

  it("sorts a missing constant id last rather than first", () => {
    const rows = [
      row({ descriptiveName: "Fish", rmsConstant: "F", constId: null }),
      row({ descriptiveName: "Fish", rmsConstant: "F", constId: 53 }),
    ].sort(compareConstantRows);
    expect(rows.map((r) => r.constId)).toEqual([53, null]);
  });

  it("returns 0 rather than NaN when both ids are missing", () => {
    // The bug this guards: `(a ?? Infinity) - (b ?? Infinity)` is NaN here, and
    // a comparator returning NaN corrupts the sort without throwing.
    const a = row({ descriptiveName: "Fish", rmsConstant: "F", constId: null });
    const b = row({ descriptiveName: "Fish", rmsConstant: "F", constId: null });
    expect(compareConstantRows(a, b)).toBe(0);
    expect(Number.isNaN(compareConstantRows(a, b))).toBe(false);
  });

  it("produces a total order over the real terrain and object tables", () => {
    for (const category of ["terrain", "object"]) {
      const rows = gameConstants.constants.filter((c) => c.category === category).sort(compareConstantRows);
      expect(rows.length).toBeGreaterThan(0);
      for (let i = 1; i < rows.length; i++) {
        expect(compareConstantRows(rows[i - 1], rows[i])).toBeLessThanOrEqual(0);
      }
      // Ascending by descriptive name, which is the tier the user asked for.
      const names = rows.map((r) => r.descriptiveName);
      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    }
  });
});

describe("matchesQuery", () => {
  it("matches everything on an empty query", () => {
    expect(matchesQuery("", ["anything"])).toBe(true);
    expect(matchesQuery("", [null, undefined])).toBe(true);
  });

  it("matches a fragment from the middle of a field, case-insensitively", () => {
    expect(matchesQuery("snow", ["SNOW_FOREST"])).toBe(true);
    expect(matchesQuery("FOREST", ["Snow Forest"])).toBe(true);
    expect(matchesQuery("ores", ["Snow Forest"])).toBe(true);
  });

  it("searches numeric fields as text, so a constant id is findable", () => {
    expect(matchesQuery("450", [450, "MARLIN1"])).toBe(true);
  });

  it("skips null and undefined fields instead of matching them", () => {
    expect(matchesQuery("null", [null, undefined, "GOLD"])).toBe(false);
    expect(matchesQuery("gold", [null, "GOLD"])).toBe(true);
  });

  it("returns false when nothing contains the needle", () => {
    expect(matchesQuery("zzz", ["GOLD", 66, "Gold Mine"])).toBe(false);
  });
});
