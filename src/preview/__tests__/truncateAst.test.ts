// Tests for truncateAst() — docs/preview-design.md Sec.5's Current cut point.
//
// Every cut position is looked up by SEARCHING THE SOURCE for the text it
// sits after, never written as a literal offset. Hand-counted positions in a
// fixture are how this repo has already shipped an off-by-one path length and
// a wall that ended up on the wrong side of two lands (connections.test.ts),
// and an offset off by one here would silently test the neighbouring token.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { lineOfOffset, resolveCutOffset, truncateAst } from "../generator/truncateAst";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import type { CommandNode, IfNode, Item, ParseResult, SectionNode } from "../../parser/types";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const language: LanguageIndex = buildLanguageIndex(lang);
const constants = (
  JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as {
    constants: ObjectConstant[];
  }
).constants;
const refDb: PreviewReferenceData = { language, constants };

const SCRIPT = `/* a script with a block, a conditional and a random */
#const MY_LAND_PERCENT 20

<PLAYER_SETUP>
random_placement

/* base_elevation is a no-op without this section, empty or not (lands.ts).
   It sits ABOVE the lands on purpose: sections run in the engine's canonical
   order regardless of file order, and putting it below would leave every cut
   inside a land dropping this section too — so a test meaning to prove that
   ONE ATTRIBUTE was cut would pass just as well if nothing were cut inside
   the block at all. A mutation test caught exactly that. */
<ELEVATION_GENERATION>

<LAND_GENERATION>
base_terrain GRASS
create_land {
  terrain_type DIRT
  land_percent MY_LAND_PERCENT
  base_elevation 3
}
if TINY_MAP
  create_land {
    terrain_type WATER
    land_percent 5
  }
else
  create_land {
    terrain_type WATER
    land_percent 12
  }
endif
start_random
percent_chance 50
  base_terrain DESERT
percent_chance 50
  base_terrain SNOW
end_random

<OBJECTS_GENERATION>
create_object GOLD {
  number_of_objects 5
}
`;

function parse(source = SCRIPT): ParseResult {
  return parseRms(source, lang);
}

/** The offset just AFTER `needle` — "the caret sits at the end of this text". Throws rather than returning -1, so a fixture edit that moves the text fails loudly. */
function after(needle: string, source = SCRIPT): number {
  const index = source.indexOf(needle);
  if (index === -1) throw new Error(`the fixture does not contain ${JSON.stringify(needle)}`);
  return index + needle.length;
}

/** The offset just BEFORE `needle` — "the caret sits at the very start of this text". */
function before(needle: string, source = SCRIPT): number {
  const index = source.indexOf(needle);
  if (index === -1) throw new Error(`the fixture does not contain ${JSON.stringify(needle)}`);
  return index;
}

function section(result: ParseResult, name: string): SectionNode | undefined {
  return result.script.sections.find((s) => s.name === name);
}

function sectionNames(result: ParseResult): string[] {
  return result.script.sections.map((s) => s.name);
}

/** Item names as written, so an assertion reads like the script does. */
function names(items: readonly Item[], result: ParseResult): string[] {
  return items.map((item) => {
    switch (item.kind) {
      case "command":
      case "attribute":
        return result.tokens[item.name].text;
      case "directive":
        return result.tokens[item.hash].text;
      case "if":
        return "if";
      case "random":
        return "start_random";
      default:
        return item.kind;
    }
  });
}

function landItems(result: ParseResult): Item[] {
  return section(result, "LAND_GENERATION")?.items ?? [];
}

/** The `create_land` with the three attributes — always index 1, after `base_terrain`. */
function firstLand(result: ParseResult): CommandNode {
  const item = landItems(result)[1];
  if (item.kind !== "command") throw new Error(`expected a command, got ${item.kind}`);
  return item;
}

function conditional(result: ParseResult): IfNode {
  const item = landItems(result).find((i) => i.kind === "if");
  if (item === undefined || item.kind !== "if") throw new Error("the fixture's `if` is missing");
  return item;
}

describe("lineOfOffset", () => {
  const offsets = [0, 10, 10, 25]; // an empty line 1 makes two entries share an offset

  it("puts offset 0 on line 0", () => {
    expect(lineOfOffset(offsets, 0)).toBe(0);
  });

  it("puts an offset inside a line on that line", () => {
    expect(lineOfOffset(offsets, 5)).toBe(0);
    expect(lineOfOffset(offsets, 30)).toBe(3);
  });

  it("puts an offset exactly on a line start on that line, not the one before", () => {
    expect(lineOfOffset(offsets, 25)).toBe(3);
  });

  it("resolves ties to the LAST line sharing the offset, which is where an empty line's own content sits", () => {
    expect(lineOfOffset(offsets, 10)).toBe(2);
  });

  it("clamps below zero and past the end rather than returning -1 or undefined", () => {
    expect(lineOfOffset(offsets, -5)).toBe(0);
    expect(lineOfOffset(offsets, 9_999)).toBe(3);
  });

  it("handles a single-line document", () => {
    expect(lineOfOffset([0], 42)).toBe(0);
  });

  it("agrees with the parser's own lineOffsets on every line start of a real parse", () => {
    const result = parse();
    for (let line = 0; line < result.lineOffsets.length; line++) {
      expect(lineOfOffset(result.lineOffsets, result.lineOffsets[line])).toBe(line);
    }
  });
});

describe("resolveCutOffset", () => {
  it("follows the caret while nothing is pinned", () => {
    expect(resolveCutOffset(null, 120, 400)).toBe(120);
  });

  it("cuts nowhere with no pin and no caret, so Current draws the whole script", () => {
    expect(resolveCutOffset(null, null, 400)).toBeNull();
  });

  it("lets the pin beat the caret", () => {
    expect(resolveCutOffset(70, 300, 400)).toBe(70);
  });

  it("honours a pin at offset 0, which is a real position and a falsy one", () => {
    // The `||`-instead-of-`??` bug in one assertion: under `||` this returns
    // the caret, and the top of the file is the one place that cannot be
    // pinned.
    expect(resolveCutOffset(0, 300, 400)).toBe(0);
  });

  it("clamps a pin that the document has since shrunk past", () => {
    expect(resolveCutOffset(9_999, 30, 400)).toBe(400);
  });

  it("leaves the pin alone when the length is unknown (no parse yet)", () => {
    expect(resolveCutOffset(9_999, null, null)).toBe(9_999);
  });
});

describe("truncateAst", () => {
  it("drops an item that starts at or after the caret", () => {
    const result = parse();
    // Caret at the very start of `create_land` — the insertion point is
    // before it, so it has not been written yet.
    const cut = truncateAst(result, before("create_land {"));
    expect(names(landItems(cut), cut)).toEqual(["base_terrain"]);
  });

  it("keeps an item the caret sits one character inside", () => {
    const result = parse();
    const cut = truncateAst(result, before("create_land {") + 1);
    expect(names(landItems(cut), cut)).toEqual(["base_terrain", "create_land"]);
  });

  it("CUTS INTO a block the caret is inside, keeping the attributes above it", () => {
    const result = parse();
    expect(names(firstLand(result).block!.items, result)).toEqual([
      "terrain_type",
      "land_percent",
      "base_elevation",
    ]);

    const cut = truncateAst(result, after("terrain_type DIRT"));
    const land = firstLand(cut);
    expect(names(land.block!.items, cut)).toEqual(["terrain_type"]);
    // Still a well-formed block: the braces are the source's own, so what
    // reaches the generator is a script, not a fragment. This is the whole
    // reason the tree is cut instead of the text.
    expect(land.block!.close).toBeDefined();
  });

  it("keeps an attribute the caret is in the MIDDLE of, since a leaf cannot be half-written", () => {
    const result = parse();
    const cut = truncateAst(result, after("land_perc"));
    expect(names(firstLand(cut).block!.items, cut)).toEqual(["terrain_type", "land_percent"]);
  });

  it("cuts inside a conditional branch without touching the branches above it", () => {
    const result = parse();
    const cut = truncateAst(result, after("land_percent 12"));
    const node = conditional(cut);
    expect(node.branches).toHaveLength(2); // if + else, both reached
    // The else branch's own create_land is kept, cut to its first two
    // attributes.
    const elseLand = node.branches[1].items[0];
    expect(elseLand.kind).toBe("command");
    expect(names((elseLand as CommandNode).block!.items, cut)).toEqual([
      "terrain_type",
      "land_percent",
    ]);
  });

  it("drops a branch whose keyword is below the caret", () => {
    const result = parse();
    const cut = truncateAst(result, after("land_percent 5"));
    expect(conditional(cut).branches).toHaveLength(1); // the `else` is not written yet
  });

  it("cuts a start_random the same way, branch by branch", () => {
    const result = parse();
    const cut = truncateAst(result, after("base_terrain DESERT"));
    const random = landItems(cut).find((item) => item.kind === "random");
    if (random === undefined || random.kind !== "random") throw new Error("the fixture's start_random is missing");
    expect(random.branches).toHaveLength(1);
  });

  it("drops a section whose header is below the caret", () => {
    const result = parse();
    expect(sectionNames(result)).toEqual([
      "PLAYER_SETUP",
      "ELEVATION_GENERATION",
      "LAND_GENERATION",
      "OBJECTS_GENERATION",
    ]);
    const cut = truncateAst(result, after("base_terrain GRASS"));
    expect(sectionNames(cut)).toEqual(["PLAYER_SETUP", "ELEVATION_GENERATION", "LAND_GENERATION"]);
  });

  it("keeps a section header the caret is inside, with none of its items", () => {
    const result = parse();
    const cut = truncateAst(result, after("<OBJECTS_GENERATION"));
    expect(sectionNames(cut)).toContain("OBJECTS_GENERATION");
    expect(section(cut, "OBJECTS_GENERATION")?.items).toHaveLength(0);
  });

  it("truncates the preamble above the first section", () => {
    const result = parse();
    expect(result.script.preamble).toHaveLength(1); // the #const
    const cut = truncateAst(result, before("#const"));
    expect(cut.script.preamble).toHaveLength(0);
    expect(cut.script.sections).toHaveLength(0);
  });

  it("returns the SAME object when the cut drops nothing", () => {
    const result = parse();
    // Identity, not deep equality: usePreviewResult keys its effect on the
    // parse's reference, so this is what stops a cut at the end of the script
    // costing a second full generation.
    expect(truncateAst(result, SCRIPT.length)).toBe(result);
    expect(truncateAst(result, after("number_of_objects 5"))).toBe(result);
  });

  it("shares untouched subtrees with the original rather than rebuilding them", () => {
    const result = parse();
    const cut = truncateAst(result, after("land_percent 12"));
    // The PLAYER_SETUP section is wholly above the cut, so it is the very
    // same node — the recursion returns its input whenever nothing changed,
    // which is what keeps a cut cheap on a large script.
    expect(section(cut, "PLAYER_SETUP")).toBe(section(result, "PLAYER_SETUP"));
    expect(landItems(cut)[0]).toBe(landItems(result)[0]);
  });

  it("does not mutate the parse it was given", () => {
    const result = parse();
    const beforeSections = result.script.sections.length;
    const beforeLandItems = landItems(result).length;
    const beforeBlockItems = firstLand(result).block!.items.length;
    truncateAst(result, after("terrain_type DIRT"));
    expect(result.script.sections).toHaveLength(beforeSections);
    expect(landItems(result)).toHaveLength(beforeLandItems);
    expect(firstLand(result).block!.items).toHaveLength(beforeBlockItems);
  });

  it("leaves source, tokens and lineOffsets whole, so every retained span still points at real text", () => {
    const result = parse();
    const cut = truncateAst(result, after("base_terrain GRASS"));
    expect(cut.source).toBe(result.source);
    expect(cut.tokens).toBe(result.tokens);
    expect(cut.lineOffsets).toBe(result.lineOffsets);
    const land = section(cut, "LAND_GENERATION")!;
    expect(cut.source.slice(land.span.start, land.span.start + "<LAND_GENERATION>".length)).toBe(
      "<LAND_GENERATION>",
    );
  });

  it("changes what generatePreview produces — the objects below the cut are not placed", () => {
    const result = parse();
    const settings = { playerCount: 2, mapSize: "Tiny" as const, teams: DEFAULT_TEAMS };
    const opts = { seed: 7, collectSnapshots: false };

    const final = generatePreview(result, refDb, settings, opts);
    expect(final.objects.filter((o) => o.objectRef === "GOLD").length).toBeGreaterThan(0);

    const current = generatePreview(
      truncateAst(result, after("land_percent 12")),
      refDb,
      settings,
      opts,
    );
    expect(current.objects).toHaveLength(0);
    // The lands above the cut still generated, so this is a truncation rather
    // than an empty run: a preview that drew nothing would pass the assertion
    // above for the wrong reason.
    expect(current.reports.length).toBeGreaterThan(0);
  });

  it("an attribute below the caret does not reach the generator", () => {
    const result = parse();
    const settings = { playerCount: 2, mapSize: "Tiny" as const, teams: DEFAULT_TEAMS };
    const opts = { seed: 7, collectSnapshots: true };

    // `base_elevation 3` is the last attribute of the first land. Cutting
    // above it must flatten that land — the case the old line-granular rule
    // could not express, since the caret is inside the block either way.
    const withElevation = generatePreview(result, refDb, settings, opts);
    const withoutElevation = generatePreview(
      truncateAst(result, after("land_percent MY_LAND_PERCENT")),
      refDb,
      settings,
      opts,
    );

    const raised = (r: { snapshots?: { elevation: Uint8Array }[] }): number =>
      [...(r.snapshots?.at(-1)?.elevation ?? [])].filter((e) => e > 0).length;
    expect(raised(withElevation)).toBeGreaterThan(0);
    expect(raised(withoutElevation)).toBe(0);
  });
});
