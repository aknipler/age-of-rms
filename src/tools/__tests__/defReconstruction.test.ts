// tools-api-design.md Sec.9 item 11, "the gate the whole stripping decision
// was missing." Sec.4.2 strips `def` off the wire and hands external tools a
// recovery recipe stated in prose (this document, PROTOCOL.md); until this
// file, nothing executable checked that the recipe actually recovers what the
// in-process parser resolved. The doc's own measurement: the recipe was
// correct on 2026-08-11 and silently wrong on 2026-08-13 when the parser
// learned to resolve a command through the script's own #const table, and "no
// test this document prescribed could have gone red", because none of them
// asserted that a def is recoverable at all.
//
// Four hand-built fixtures, none corpus-driven (the only two maps carrying any
// of this, 24hr_Petra.rms and 24hr_Holler.rms, do not survive a clone, and (b)/
// (c)/(d) have zero instances even on a maintainer's full disk, measured
// 2026-08-13); a corpus assertion here would be green-by-absence twice over.
// Plus a real corpus parse, for the ordinary (non-aliased) resolution path.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../parser/language";
import { collectScriptDefs, reconstructScriptDefs } from "../defReconstruction";
import { encodeParseResultForWire } from "../wireCodec";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);

/** Parses `source`, then asserts reconstruction-from-the-wire equals the real in-process defs, node for node. */
function assertReconstructs(source: string, matcher: "toStrictEqual" | "toEqual" = "toStrictEqual") {
  const real = parseRms(source, lang);
  const wire = encodeParseResultForWire(real);

  const expected = collectScriptDefs(real.script);
  const actual = reconstructScriptDefs(wire.script, wire.tokens, wire.symbols, language);

  expect(actual.map((d) => d.path)).toEqual(expected.map((d) => d.path));
  expect(actual).toHaveLength(expected.length);
  if (matcher === "toStrictEqual") {
    expect(actual).toStrictEqual(expected);
  } else {
    expect(actual).toEqual(expected);
  }
  return { real, wire, expected, actual };
}

describe("fixture (a): plain alias — #const L 32 + L { ... }", () => {
  const SOURCE = ["<LAND_GENERATION>", "#const L 32", "L {", "  land_percent 20", "}"].join("\n");

  it("reconstructs L's def as create_land — item 1's mutant, restated over the whole tree", () => {
    const { expected } = assertReconstructs(SOURCE);
    const lDef = expected.find((d) => d.path === "section[0][1]");
    expect(lDef?.def).toMatchObject({ name: "create_land" });
  });
});

describe("fixture (b): attribute-name alias at statement level — #const grouping 32 + grouping { ... }", () => {
  // `grouping` is not itself a known name (the real attribute is
  // `set_loose_grouping`/`set_tight_grouping`, BUG-005's corpus typo splits
  // it into two words, one of which is this). That is NOT incidental: `#const`'s
  // own NAME argument stops on ANY known command or attribute name
  // (`stopSetAt`, parser.ts, only the VALUE slot has `acceptsKnownName`), so a
  // `#const` naming an ALREADY-known word records zero args and no symbol at
  // all (verified empirically, `#const land_percent 32` produces "expects 2
  // arguments but only 0 were found" and an empty `symbols` array). So no
  // alias fixture can ever collide its OWN name with a real attribute; the
  // interesting property here is narrower and still real: a correct
  // recipe resolves `asCommand` as `commandsByName.get(name) ??
  // aliasedCommand(name)` UNCONDITIONALLY, never gated on whether `name` is
  // ALSO absent from `attributesByName`, and does so at STATEMENT level
  // (top-level, not inside a block), which is the context this fixture
  // exercises and fixture (a) does not (there `L` sits inside a block already).
  const SOURCE = ["<LAND_GENERATION>", "#const grouping 32", "grouping {", "  land_percent 20", "}"].join("\n");

  it("resolves the statement-level alias as create_land", () => {
    const { real, expected } = assertReconstructs(SOURCE);
    const outer = real.script.sections[0].items[1];
    expect(outer.kind).toBe("command");
    if (outer.kind !== "command") return;
    expect(outer.def?.name).toBe("create_land");

    const outerDef = expected.find((d) => d.path === "section[0][1]");
    expect(outerDef?.def).toMatchObject({ name: "create_land" });
  });
});

describe("fixture (c): #define-shadowed #const — first symbol wins whatever it is", () => {
  // `#define L` is recorded BEFORE `#const L 32` (source order), and
  // `aliasedCommand`/`reconstructAliasedCommand` both stop at the FIRST
  // symbol named "L", which is the #define, not the #const. So the alias
  // must NOT resolve, even though a later #const for the same name exists. A
  // `Map<name, symbol>` built by iterating and overwriting would keep the
  // LAST symbol instead and wrongly resolve L to create_land here.
  const SOURCE = ["<LAND_GENERATION>", "#define L", "#const L 32", "L {", "  land_percent 20", "}"].join("\n");

  it("does NOT resolve L as create_land — the #define shadows the later #const", () => {
    const { real, expected } = assertReconstructs(SOURCE);
    // Unresolved, so the run gets pushed as raw content, not a CommandNode;
    // confirm no command node claims "create_land" anywhere in the tree.
    const anyCreateLand = expected.some((d) => d.def && "name" in (d.def as object) && (d.def as { name: string }).name === "create_land");
    expect(anyCreateLand).toBe(false);
    expect(real.script.sections[0].items.some((i) => i.kind === "command" && i.def?.name === "create_land")).toBe(false);
  });
});

describe("fixture (d): alias closing the override window (same input shape, same mutant — override behaviour itself is covered by src/preview/__tests__/instantiate.test.ts's 'ignored once a land command has run' case)", () => {
  const SOURCE = ["#const L 32", "<LAND_GENERATION>", "L {", "  land_percent 20", "}", "<PLAYER_SETUP>", "override_map_size 300"].join("\n");

  it("still reconstructs L's def as create_land under this input shape", () => {
    const { expected } = assertReconstructs(SOURCE);
    const lDef = expected.find((d) => d.path === "section[0][0]");
    expect(lDef?.def).toMatchObject({ name: "create_land" });
  });
});

describe("a real corpus parse — the ordinary (non-aliased) resolution path", () => {
  const mapNames = readdirSync(join(REPO_ROOT, "test-maps"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".rms"))
    .map((entry) => entry.name)
    .sort();

  it(`finds maps to check (${mapNames.length})`, () => {
    expect(mapNames.length).toBeGreaterThan(0);
  });

  for (const mapName of mapNames) {
    it(`${mapName}: every def reconstructs from tokens+symbols+referenceData.language alone`, () => {
      const source = readFileSync(join(REPO_ROOT, "test-maps", mapName), "utf8");
      assertReconstructs(source, "toEqual");
    });
  }
});
