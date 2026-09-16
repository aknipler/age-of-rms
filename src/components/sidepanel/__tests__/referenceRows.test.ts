import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareConstantRows,
  compareConstantRowsBy,
  matchesQuery,
  matchingCommandRows,
  orphanAttributeRows,
  type ConstantSortKey,
} from "../referenceRows";
import type { GameConstantEntry, GameConstantsData } from "../../../breakdown/gameConstants";
import type { AttributeDef, CommandDef, LanguageData } from "../../../parser/language";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const gameConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as GameConstantsData;
const languageData = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "language.json"), "utf8"),
) as LanguageData;

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

describe("compareConstantRowsBy", () => {
  it("agrees with compareConstantRows for the 'name' key", () => {
    const a = row({ descriptiveName: "Wolf" });
    const b = row({ descriptiveName: "Deer" });
    expect(compareConstantRowsBy("name", a, b)).toBe(compareConstantRows(a, b));
  });

  it("sorts by RMS constant first, ignoring descriptive name", () => {
    const rows = [
      row({ descriptiveName: "Zebra", rmsConstant: "AAA" }),
      row({ descriptiveName: "Aardvark", rmsConstant: "ZZZ" }),
    ].sort((x, y) => compareConstantRowsBy("constant", x, y));
    expect(rows.map((r) => r.rmsConstant)).toEqual(["AAA", "ZZZ"]);
  });

  it("falls back to id then name when two rows share no RMS constant", () => {
    const rows = [
      row({ descriptiveName: "Zebra", rmsConstant: null, constId: 9 }),
      row({ descriptiveName: "Aardvark", rmsConstant: null, constId: 1 }),
    ].sort((x, y) => compareConstantRowsBy("constant", x, y));
    expect(rows.map((r) => r.constId)).toEqual([1, 9]);
  });

  it("sorts by constant id first, ignoring descriptive name and RMS constant", () => {
    const rows = [
      row({ descriptiveName: "Zebra", rmsConstant: "AAA", constId: 20 }),
      row({ descriptiveName: "Aardvark", rmsConstant: "ZZZ", constId: 1 }),
    ].sort((x, y) => compareConstantRowsBy("id", x, y));
    expect(rows.map((r) => r.constId)).toEqual([1, 20]);
  });

  it("produces a total order over the real terrain and object tables under every sort key", () => {
    const keys: ConstantSortKey[] = ["name", "constant", "id"];
    for (const category of ["terrain", "object"]) {
      for (const key of keys) {
        const rows = gameConstants.constants
          .filter((c) => c.category === category)
          .sort((a, b) => compareConstantRowsBy(key, a, b));
        for (let i = 1; i < rows.length; i++) {
          expect(compareConstantRowsBy(key, rows[i - 1], rows[i])).toBeLessThanOrEqual(0);
        }
      }
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

function command(partial: Partial<CommandDef>): CommandDef {
  return { name: "cmd", section: "OBJECTS_GENERATION", kind: "block", verified: true, ...partial };
}

function attribute(partial: Partial<AttributeDef>): AttributeDef {
  return { name: "attr", verified: true, ...partial };
}

describe("matchingCommandRows", () => {
  const foo = attribute({ name: "foo", description: "the foo one" });
  const bar = attribute({ name: "bar", description: "the bar one" });
  const attributesByName = new Map([
    ["foo", foo],
    ["bar", bar],
  ]);
  const commandA = command({ name: "commandA", attributes: ["foo", "bar"] });
  const commandB = command({ name: "commandB" });

  it("returns every command with every one of its attributes on an empty query", () => {
    const rows = matchingCommandRows([commandA, commandB], attributesByName, "");
    expect(rows).toEqual([
      { command: commandA, attributes: [foo, bar] },
      { command: commandB, attributes: [] },
    ]);
  });

  it("keeps a command whose own name matches, with no attributes attached", () => {
    const rows = matchingCommandRows([commandA, commandB], attributesByName, "commandB");
    expect(rows).toEqual([{ command: commandB, attributes: [] }]);
  });

  it("gives a command that matches directly EVERY attribute, not only the ones that also match", () => {
    // "commandA" matches the command's own name but neither foo's nor bar's
    // name/description. If attributes were still being narrowed by the
    // query, this would come back empty instead of carrying both.
    const rows = matchingCommandRows([commandA, commandB], attributesByName, "commandA");
    expect(rows).toEqual([{ command: commandA, attributes: [foo, bar] }]);
  });

  it("keeps a command found only through a matching attribute, carrying just that attribute", () => {
    const rows = matchingCommandRows([commandA, commandB], attributesByName, "foo");
    expect(rows).toEqual([{ command: commandA, attributes: [foo] }]);
  });

  it("drops a command that matches neither by name nor by any attribute", () => {
    const rows = matchingCommandRows([commandA, commandB], attributesByName, "zzz");
    expect(rows).toEqual([]);
  });

  it("skips an attribute name with no entry in the map rather than throwing", () => {
    const dangling = command({ name: "commandC", attributes: ["ghost"] });
    const rows = matchingCommandRows([dangling], attributesByName, "");
    expect(rows).toEqual([{ command: dangling, attributes: [] }]);
  });

  it("drops a non-functional attribute nested under a real command", () => {
    // No command's attributes[] names one of the four non-functional strings
    // today, but the filter has to hold even if one someday does. It is the
    // reference table's own vocabulary, not just orphanAttributeRows'.
    const deadAttr = attribute({ name: "dead", nonFunctional: true, replacedBy: "foo" });
    const attributesWithGhost = new Map([...attributesByName, ["dead", deadAttr]]);
    const commandWithGhost = command({ name: "commandD", attributes: ["foo", "dead"] });
    const rows = matchingCommandRows([commandWithGhost], attributesWithGhost, "");
    expect(rows).toEqual([{ command: commandWithGhost, attributes: [foo] }]);
  });
});

describe("orphanAttributeRows", () => {
  const foo = attribute({ name: "foo", description: "the foo one" });
  const bar = attribute({ name: "bar", description: "the bar one" });
  const commandA = command({ name: "commandA", attributes: ["foo"] });

  it("returns only the attributes no command's attributes[] names", () => {
    expect(orphanAttributeRows([commandA], [foo, bar], "")).toEqual([bar]);
  });

  it("still applies the query to the orphaned set", () => {
    expect(orphanAttributeRows([commandA], [foo, bar], "bar")).toEqual([bar]);
    expect(orphanAttributeRows([commandA], [foo, bar], "foo")).toEqual([]);
  });

  it("pins the real corpus: the four non-functional legacy strings are orphaned but excluded", () => {
    // Same four names as before the nonFunctional filter landed. They are
    // still nameless of a command, just no longer worth showing.
    const names = orphanAttributeRows(languageData.commands, languageData.attributes, "").map((a) => a.name);
    expect(names).toEqual([]);
  });

  it("drops a non-functional attribute even though nothing references it", () => {
    const ghost = attribute({ name: "ghost", nonFunctional: true, replacedBy: "real" });
    expect(orphanAttributeRows([commandA], [foo, bar, ghost], "")).toEqual([bar]);
  });
});
