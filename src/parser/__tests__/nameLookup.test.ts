// docs/name-lookup-design.md slice A. Real language.json and
// game-constants.json throughout, never a hand-built table, since the point
// of several tests below is that the lookup agrees with the data the rest of
// the app reads (a stage whose tests build their own input cannot catch the
// previous stage failing to produce it, CLAUDE.md).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArgumentDef } from "../language";
import {
  buildScriptNameIndex,
  buildStaticNameIndex,
  closestBuiltin,
  defaultConstValue,
  moveUpPlan,
  resolveName,
  suggest,
  unknownNameOffer,
  type SlotKind,
} from "../nameLookup";
import { parseRms } from "../parser";
import { validate, type GameConstantsForValidate } from "../validate";
import { loadLanguage, REPO_ROOT } from "./testUtils";

const lang = loadLanguage();
// One parse of the file feeds both the lookup and validate(), typed as
// validate's narrower view. Structural typing lets the same object satisfy
// `LookupConstantRow` too, with no adapter between them.
const gameConstants = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "reference", "data", "game-constants.json"),
    "utf8",
  ),
) as GameConstantsForValidate;
const stat = buildStaticNameIndex(lang, gameConstants.constants);

function argDef(attribute: string, index = 0): ArgumentDef {
  const def = lang.attributes.find((a) => a.name === attribute)?.arguments?.[
    index
  ];
  if (!def) throw new Error(`no argument ${index} on ${attribute}`);
  return def;
}

const terrainSlot: SlotKind = {
  kind: "argument",
  def: argDef("terrain_type"),
};
const objectDef = lang.commands.find((c) => c.name === "create_object")
  ?.arguments?.[0];
if (!objectDef) throw new Error("create_object has no argument");
const objectSlot: SlotKind = { kind: "argument", def: objectDef };
const integerSlot: SlotKind = {
  kind: "argument",
  def: { name: "n", type: "integer" },
};

/** The script index plus the offset of the `nth` occurrence of `word`. */
function scriptAt(source: string, word: string, nth = 0) {
  const script = buildScriptNameIndex(parseRms(source, lang));
  let at = -1;
  for (let i = 0; i <= nth; i++) at = source.indexOf(word, at + 1);
  if (at < 0) throw new Error(`no ${word} in fixture`);
  return { script, at };
}

const USE_ABOVE_DEFINITION = [
  "<LAND_GENERATION>",
  "create_land {",
  "  terrain_type MY_FOREST",
  "}",
  "#const MY_FOREST 10",
].join("\n");

const USE_BELOW_DEFINITION = [
  "<LAND_GENERATION>",
  "#const MY_FOREST 10",
  "create_land {",
  "  terrain_type MY_FOREST",
  "}",
].join("\n");

describe("scope (design Sec.9)", () => {
  // The mutation target the design names. Replacing scope.ts's position
  // test with `definitions.length > 0` turns this red (and eight more,
  // RMS0303's own tests among them), since the only definition is one line
  // below the use. Run 2026-10-22.
  it("a definition one line below its use does not resolve", () => {
    const { script, at } = scriptAt(USE_ABOVE_DEFINITION, "MY_FOREST");
    const r = resolveName(stat, script, "MY_FOREST", at, terrainSlot);
    expect(r.kind).toBe("definedBelow");
  });

  it("the same definition above the use resolves", () => {
    const { script, at } = scriptAt(USE_BELOW_DEFINITION, "MY_FOREST", 1);
    const r = resolveName(stat, script, "MY_FOREST", at, terrainSlot);
    expect(r.kind).toBe("script");
  });

  it("RMS0303 agrees with the lookup on both fixtures", () => {
    const codes = (src: string) =>
      validate(parseRms(src, lang), { language: lang, gameConstants }).map(
        (d) => d.code,
      );
    expect(codes(USE_ABOVE_DEFINITION)).toContain("RMS0303");
    expect(codes(USE_BELOW_DEFINITION)).not.toContain("RMS0303");
  });

  it("marks a definition that only runs inside a branch as conditional", () => {
    const src = [
      "if TINY_MAP",
      "  #const MY_FOREST 10",
      "endif",
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST", 1);
    const r = resolveName(stat, script, "MY_FOREST", at, terrainSlot);
    expect(r).toMatchObject({ kind: "script", conditional: true });
  });

  it("reads a formula's names with no position test", () => {
    const { script } = scriptAt(USE_ABOVE_DEFINITION, "MY_FOREST");
    const r = resolveName(stat, script, "MY_FOREST", 0, { kind: "formula" });
    expect(r.kind).toBe("script");
  });
});

describe("resolveName", () => {
  const { script, at } = scriptAt(USE_BELOW_DEFINITION, "MY_FOREST", 1);

  it("resolves a built-in terrain in a terrain slot", () => {
    const r = resolveName(stat, script, "GRASS", at, terrainSlot);
    expect(r).toMatchObject({ kind: "builtin", row: { category: "terrain" } });
  });

  it("follows a name to name #const once (BUG-015)", () => {
    const src = [
      "#const TERR_CORNER GRASS2",
      "#const PLAIN 5",
      "<LAND_GENERATION>",
      "create_land { terrain_type TERR_CORNER }",
    ].join("\n");
    const s = scriptAt(src, "TERR_CORNER", 1);
    expect(
      resolveName(stat, s.script, "TERR_CORNER", s.at, terrainSlot),
    ).toMatchObject({ kind: "script", aliasOf: { name: "GRASS2" } });
    const plain = resolveName(stat, s.script, "PLAIN", s.at, terrainSlot);
    expect(plain.kind === "script" && plain.aliasOf).toBe(undefined);
  });

  it("calls an object in a terrain slot otherKind, never unknown", () => {
    const r = resolveName(stat, script, "GOLD", at, terrainSlot);
    expect(r.kind).toBe("otherKind");
  });

  it("lets a built-in win over the script's own #const of the same name", () => {
    const src = [
      "#const GRASS 5",
      "<LAND_GENERATION>",
      "create_land { terrain_type GRASS }",
    ].join("\n");
    const s = scriptAt(src, "GRASS", 1);
    expect(resolveName(stat, s.script, "GRASS", s.at, terrainSlot).kind).toBe(
      "builtin",
    );
  });

  it("resolves a constants.inc-only alias, so it never draws a create offer", () => {
    const aliasOnly = [...stat.rowsByName].find(([, rows]) =>
      rows.every((r) => r.category === "objectAlias"),
    );
    if (!aliasOnly) throw new Error("data has no alias-only object name");
    const [name] = aliasOnly;
    expect(resolveName(stat, script, name, at, objectSlot).kind).toBe(
      "builtin",
    );
    expect(unknownNameOffer(stat, script, name, at, objectSlot)).toBeNull();
    // ...and is not suggested, since it may need an #include to work.
    expect(
      suggest(stat, script, name, at, objectSlot).map((s) => s.name),
    ).not.toContain(name);
  });

  it("reads numbers as numbers, inf included", () => {
    for (const n of ["12", "-3", "0.5", "inf", "-inf"])
      expect(resolveName(stat, script, n, at, integerSlot).kind).toBe("number");
  });

  it("resolves a predefined label in a condition slot", () => {
    const label = lang.predefinedLabels?.[0]?.name;
    if (!label) throw new Error("no predefined labels");
    expect(
      resolveName(stat, script, label, at, { kind: "condition" }).kind,
    ).toBe("label");
  });

  it("says unknown for a name nothing defines", () => {
    expect(
      resolveName(stat, script, "NOTHING_DEFINES_THIS", at, terrainSlot).kind,
    ).toBe("unknown");
  });
});

describe("suggest (design Sec.3)", () => {
  const src = [
    "#const MY_FIELD 5",
    "<LAND_GENERATION>",
    "create_land { terrain_type MY_ }",
    "#const MY_LATER 7",
  ].join("\n");
  const { script, at } = scriptAt(src, "MY_ ");

  it("puts the script's own names before built-in ones", () => {
    const rows = suggest(stat, script, "MY_", at, terrainSlot);
    expect(rows[0]).toMatchObject({
      name: "MY_FIELD",
      source: "script",
      line: 1,
    });
  });

  it("lists a name defined below after every other row, tagged", () => {
    const rows = suggest(stat, script, "MY_", at, terrainSlot);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ name: "MY_LATER", definedBelow: true });
    // Even an exact match stays last.
    const exact = suggest(stat, script, "MY_LATER", at, terrainSlot);
    expect(exact[exact.length - 1].name).toBe("MY_LATER");
  });

  it("ranks an exact built-in match first and keeps the slot's category only", () => {
    const rows = suggest(stat, script, "FOREST", at, terrainSlot);
    expect(rows[0].name).toBe("FOREST");
    expect(
      rows.every((r) => r.source !== "builtin" || r.category === "terrain"),
    ).toBe(true);
  });

  it("holds built-in objects back until two characters are typed", () => {
    const one = suggest(stat, script, "G", at, objectSlot);
    expect(one.some((r) => r.category === "object")).toBe(false);
    const two = suggest(stat, script, "GO", at, objectSlot);
    expect(two.some((r) => r.name === "GOLD")).toBe(true);
  });

  it("lists each name once", () => {
    const names = suggest(stat, script, "GOLD", at, objectSlot).map(
      (r) => r.name,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers the enclosing command's attributes at a line start", () => {
    const createLand =
      lang.commands.find((c) => c.name === "create_land") ?? null;
    const rows = suggest(stat, script, "terrain_t", 0, {
      kind: "lineStart",
      enclosing: createLand,
      section: "LAND_GENERATION",
    });
    expect(rows[0]).toMatchObject({
      name: "terrain_type",
      source: "attribute",
    });
    expect(rows.some((r) => r.source === "command")).toBe(false);
  });

  it("offers directives after #", () => {
    const rows = suggest(stat, script, "#co", 0, {
      kind: "lineStart",
      enclosing: null,
      section: null,
    });
    expect(rows[0]).toMatchObject({ name: "#const", source: "directive" });
  });
});

describe("closest built-in name (design Sec.8.1)", () => {
  // The worked examples the owner approved, read against the real data.
  const cases: [string, ArgumentDef, string | undefined, number | undefined][] =
    [
      ["FORREST", argDef("terrain_type"), "FOREST", 1],
      ["MY_FOREST", argDef("terrain_type"), "FOREST", 3],
      ["SNOWY_PINE_FOREST", argDef("terrain_type"), "FOREST", 3],
      ["BIG_GOLD", objectDef, "GOLD", 3],
      ["MUDDY", argDef("terrain_type"), "MUDDY_SHALLOW", 2],
      ["LAKE_EDGE", argDef("terrain_type"), undefined, undefined],
    ];
  for (const [typed, def, name, rule] of cases) {
    it(`${typed} -> ${name ?? "nothing"}`, () => {
      const hit = closestBuiltin(stat, typed, def);
      expect(hit?.row.name).toBe(name);
      expect(hit?.rule).toBe(rule);
    });
  }

  it("fills the numbers the design's table shows", () => {
    const value = (typed: string, slot: SlotKind) =>
      defaultConstValue(stat, typed, slot).value;
    expect(value("MY_FOREST", terrainSlot)).toBe(10);
    expect(value("BIG_GOLD", objectSlot)).toBe(66);
    expect(value("MUDDY", terrainSlot)).toBe(111);
    const fallback = defaultConstValue(stat, "LAKE_EDGE", terrainSlot);
    expect(fallback.value).toBe(0);
    expect(fallback.meaning?.name).toBe("GRASS");
  });
});

describe("default value (design Sec.8)", () => {
  it("takes a numeric slot's declared default, then its min, then 0", () => {
    const withDefault = lang.attributes
      .flatMap((a) => a.arguments ?? [])
      .find((g) => g.type === "integer" && typeof g.default === "number");
    if (!withDefault) throw new Error("no integer argument declares a default");
    expect(
      defaultConstValue(stat, "X", { kind: "argument", def: withDefault })
        .value,
    ).toBe(withDefault.default);
    expect(
      defaultConstValue(stat, "X", {
        kind: "argument",
        def: { name: "n", type: "integer", min: 3 },
      }).value,
    ).toBe(3);
    expect(defaultConstValue(stat, "X", integerSlot).value).toBe(0);
  });
});

describe("unknown const offer (design Sec.7.1)", () => {
  const src = [
    "<LAND_GENERATION>",
    "create_land { terrain_type FORREST }",
  ].join("\n");
  const { script, at } = scriptAt(src, "FORREST");

  it("offers a typo fix first, then a value", () => {
    const offer = unknownNameOffer(stat, script, "FORREST", at, terrainSlot);
    expect(offer).toMatchObject({
      didYouMean: "FOREST",
      defaultValue: { value: 10 },
    });
  });

  it("offers nothing for a number, a known name, a condition or spaces", () => {
    expect(unknownNameOffer(stat, script, "12", at, integerSlot)).toBeNull();
    expect(unknownNameOffer(stat, script, "GRASS", at, terrainSlot)).toBeNull();
    expect(unknownNameOffer(stat, script, "GOLD", at, terrainSlot)).toBeNull();
    expect(
      unknownNameOffer(stat, script, "NOPE", at, { kind: "condition" }),
    ).toBeNull();
    expect(unknownNameOffer(stat, script, "A B", at, terrainSlot)).toBeNull();
  });

  it("offers nothing for a name defined below, that is the move offer's case", () => {
    const s = scriptAt(USE_ABOVE_DEFINITION, "MY_FOREST");
    expect(
      unknownNameOffer(stat, s.script, "MY_FOREST", s.at, terrainSlot),
    ).toBeNull();
  });

  it("offers nothing when the script includes a file", () => {
    const withInclude = ['#include_drs "random_map.def"', src].join("\n");
    const s = scriptAt(withInclude, "FORREST");
    expect(
      unknownNameOffer(stat, s.script, "FORREST", s.at, terrainSlot),
    ).toBeNull();
  });
});

describe("move the #const up here (design Sec.9.1)", () => {
  it("moves the definition above the outermost item holding the use", () => {
    const src = [
      "<LAND_GENERATION>",
      "if TINY_MAP",
      "  create_land { terrain_type MY_FOREST }",
      "endif",
      "#const MY_FOREST 10",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST");
    const plan = moveUpPlan(script, "MY_FOREST", at);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.before.kind).toBe("if");
    expect(
      src.slice(plan.definition.span.start, plan.definition.span.end),
    ).toBe("#const MY_FOREST 10");
  });

  it("refuses a definition inside a branch", () => {
    const src = [
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
      "if TINY_MAP",
      "  #const MY_FOREST 10",
      "endif",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST");
    expect(moveUpPlan(script, "MY_FOREST", at)).toMatchObject({
      ok: false,
      reason: "conditional",
    });
  });

  it("refuses when the value reads a name defined in between", () => {
    const src = [
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
      "#const BASE 10",
      "#const MY_FOREST (BASE + 1)",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST");
    expect(moveUpPlan(script, "MY_FOREST", at)).toMatchObject({
      ok: false,
      reason: "dependsOn",
      dependsOn: "BASE",
    });
  });

  it("finds the name inside an expression written without spaces", () => {
    const src = [
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
      "#const BASE 10",
      "#const MY_FOREST (BASE+1)",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST");
    expect(moveUpPlan(script, "MY_FOREST", at)).toMatchObject({
      reason: "dependsOn",
      dependsOn: "BASE",
    });
  });

  it("allows it when that name is already defined above the new spot", () => {
    const src = [
      "#const BASE 10",
      "<LAND_GENERATION>",
      "create_land { terrain_type MY_FOREST }",
      "#const MY_FOREST (BASE + 1)",
    ].join("\n");
    const { script, at } = scriptAt(src, "MY_FOREST");
    expect(moveUpPlan(script, "MY_FOREST", at).ok).toBe(true);
  });

  it("says notDefinedBelow when the name already resolves", () => {
    const { script, at } = scriptAt(USE_BELOW_DEFINITION, "MY_FOREST", 1);
    expect(moveUpPlan(script, "MY_FOREST", at)).toMatchObject({
      ok: false,
      reason: "notDefinedBelow",
    });
  });
});
