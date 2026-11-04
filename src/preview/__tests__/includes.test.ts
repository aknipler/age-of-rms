// `#include_drs` read from the player's install (includes.ts, tokenFilter.ts,
// preview-design Sec.3, amended 2026-11-02). The DE gate holds the Bazi maps to the real
// files when an install is present. These hold the rules on small made-up
// files, so a machine without an install still checks them.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import {
  includeKey,
  includePathsIn,
  includePathsInText,
  loadIncludeFiles,
  mapSpanToSource,
  type IncludeFiles,
} from "../generator/includes";
import type { InstantiatedScript } from "../generator/types";
import { DEFAULT_TEAMS } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);

function run(
  source: string,
  files?: Record<string, string>,
  seed = 1,
): InstantiatedScript {
  const includeFiles: IncludeFiles | undefined =
    files === undefined ? undefined : new Map(Object.entries(files));
  return instantiateScript(
    parseRms(source, lang),
    language,
    { playerCount: 2, mapSize: "Normal", teams: DEFAULT_TEAMS },
    seed,
    includeFiles,
  );
}

const landsOf = (result: InstantiatedScript) =>
  result.sections.get("LAND_GENERATION") ?? [];

describe("includeKey", () => {
  it("keys a path the way Windows finds the file", () => {
    expect(includeKey("includes/scaling.inc")).toBe("includes/scaling.inc");
    expect(includeKey("Includes\\Scaling.INC")).toBe("includes/scaling.inc");
    expect(includeKey('"my maps/x.inc"')).toBe("my maps/x.inc");
    expect(includeKey("./a.inc")).toBe("a.inc");
  });
});

describe("mapSpanToSource", () => {
  // Author's text 0..100, a 30-character include read in at 20 from the
  // directive at 5..20, and a 10-character one at 60 from 50..60.
  const insertions = [
    { at: 20, length: 30, directive: { start: 5, end: 20 } },
    { at: 60, length: 10, directive: { start: 50, end: 60 } },
  ];

  it("leaves text before the first include alone", () => {
    expect(mapSpanToSource({ start: 0, end: 4 }, insertions)).toEqual({
      start: 0,
      end: 4,
    });
  });

  it("maps a span inside an include to its directive", () => {
    expect(mapSpanToSource({ start: 25, end: 40 }, insertions)).toEqual({
      start: 5,
      end: 20,
    });
    expect(mapSpanToSource({ start: 90, end: 95 }, insertions)).toEqual({
      start: 50,
      end: 60,
    });
  });

  it("moves text after an include back by its length", () => {
    // Expanded 55..58 is author 25..28, expanded 100..105 is 60..65.
    expect(mapSpanToSource({ start: 55, end: 58 }, insertions)).toEqual({
      start: 25,
      end: 28,
    });
    expect(mapSpanToSource({ start: 100, end: 105 }, insertions)).toEqual({
      start: 60,
      end: 65,
    });
  });

  it("ends a block that closes inside an include at the directive", () => {
    expect(mapSpanToSource({ start: 2, end: 30 }, insertions)).toEqual({
      start: 2,
      end: 20,
    });
  });

  it("keeps a span that runs across a whole include", () => {
    expect(mapSpanToSource({ start: 2, end: 55 }, insertions)).toEqual({
      start: 2,
      end: 25,
    });
  });
});

describe("loadIncludeFiles", () => {
  it("reads the files an include includes, once each, and skips the missing", async () => {
    const disk: Record<string, string> = {
      "a.inc": "#const A 1\n#include_drs b.inc\n#include_drs gone.inc",
      "b.inc": "#const B 2\n#include_drs A.INC",
    };
    const asked: string[] = [];
    const files = await loadIncludeFiles(["a.inc", "a.inc"], async (key) => {
      asked.push(key);
      return disk[key];
    });
    expect([...files.keys()].sort()).toEqual(["a.inc", "b.inc"]);
    expect(asked).toEqual(["a.inc", "b.inc", "gone.inc"]);
  });

  it("records every key it asked for, the missing ones too", async () => {
    const requested = new Set<string>();
    await loadIncludeFiles(
      ["a.inc"],
      async (key) => (key === "a.inc" ? "#include_drs gone.inc" : undefined),
      requested,
    );
    expect([...requested].sort()).toEqual(["a.inc", "gone.inc"]);
  });

  it("finds the paths a script names, quoted ones whole", () => {
    const text =
      '#include_drs a.inc\n#includeXS x.xs\n#include_drs "my maps/b.inc"\n';
    expect(includePathsIn(parseRms(text, lang))).toEqual([
      "a.inc",
      "my maps/b.inc",
    ]);
    expect(includePathsInText(text)).toEqual(["a.inc", '"my maps/b.inc"']);
  });
});

describe("a live #include_drs reads the file in where it stands", () => {
  it("defines the file's constants for the script", () => {
    const result = run("#include_drs a.inc\n<PLAYER_SETUP>\n", {
      "a.inc": "#const SIDE 144\n#const HALF (SIDE / 2)\n",
    });
    expect(result.symbols.get("SIDE")).toBe(144);
    expect(result.symbols.get("HALF")).toBe(72);
  });

  it("draws an included rnd() exactly where the same line written inline would", () => {
    const inline = run("#const R rnd(1,1000)\n<PLAYER_SETUP>\n");
    const included = run("#include_drs r.inc\n<PLAYER_SETUP>\n", {
      "r.inc": "#const R rnd(1,1000)\n",
    });
    expect(included.symbols.get("R")).toBe(inline.symbols.get("R"));
    expect(included.landStream).toEqual(inline.landStream);
  });

  it("reads nothing and draws nothing in a dead branch", () => {
    const plain = run("<PLAYER_SETUP>\n");
    const dead = run(
      "if NOT_A_LABEL\n#include_drs r.inc\nendif\n<PLAYER_SETUP>\n",
      { "r.inc": "#const R rnd(1,1000)\n" },
    );
    expect(dead.symbols.has("R")).toBe(false);
    expect(dead.landStream).toEqual(plain.landStream);
  });

  it("points an included command at the directive and keeps the author's spans", () => {
    const source =
      "<LAND_GENERATION>\n#include_drs lands.inc\ncreate_land { land_percent 5 }\n";
    const result = run(source, {
      "lands.inc":
        "create_land { land_percent 10 }\ncreate_land { land_percent 20 }\n",
    });
    const lands = landsOf(result);
    expect(lands).toHaveLength(3);
    const directive = {
      start: source.indexOf("#include_drs"),
      end: source.indexOf("lands.inc") + "lands.inc".length,
    };
    expect(lands[0].span).toEqual(directive);
    expect(lands[1].span).toEqual(directive);
    const own = source.indexOf("create_land");
    expect(lands[2].span).toEqual({
      start: own,
      end: source.indexOf("}", own) + 1,
    });
    const percent = lands[2].attributes.get("land_percent")![0];
    expect(source.slice(percent.span.start, percent.span.end)).toBe(
      "land_percent 5",
    );
  });

  it("gives an attribute read in inside a block to that block", () => {
    const result = run(
      "<LAND_GENERATION>\ncreate_land {\n#include_drs body.inc\n}\n",
      { "body.inc": "land_percent 30\nbase_size 9\n" },
    );
    const [land] = landsOf(result);
    expect(land.attributes.get("land_percent")?.[0].args[0].value).toBe(30);
    expect(land.attributes.get("base_size")?.[0].args[0].value).toBe(9);
  });

  it("keeps an attribute's draw after an include moved its offset", () => {
    const tail = "<LAND_GENERATION>\ncreate_land { set_zone_randomly }\n";
    const inline = run("#const A 1\n" + tail);
    const included = run("#include_drs a.inc\n" + tail, {
      "a.inc": "#const A 1\n",
    });
    const drawOf = (r: InstantiatedScript) =>
      landsOf(r)[0].attributes.get("set_zone_randomly")?.[0].draw;
    expect(drawOf(included)).toBeDefined();
    expect(drawOf(included)).toBe(drawOf(inline));
  });

  it("keeps the draw of an attribute read in after an earlier include", () => {
    const inline = run(
      "#const A 1\n<LAND_GENERATION>\ncreate_land {\nset_zone_randomly\n}\n",
    );
    const included = run(
      "#include_drs a.inc\n<LAND_GENERATION>\ncreate_land {\n#include_drs z.inc\n}\n",
      { "a.inc": "#const A 1\n", "z.inc": "set_zone_randomly\n" },
    );
    const drawOf = (r: InstantiatedScript) =>
      landsOf(r)[0].attributes.get("set_zone_randomly")?.[0].draw;
    expect(drawOf(included)).toBeDefined();
    expect(drawOf(included)).toBe(drawOf(inline));
  });

  it("reads a missing file as empty and names it in a note", () => {
    const result = run(
      "#include_drs gone.inc\n#const A 3\n<PLAYER_SETUP>\n",
      {},
    );
    expect(result.symbols.get("A")).toBe(3);
    const note = result.notes.find((n) => n.key === "includes");
    expect(note?.prominence).toBe("banner");
    expect(note?.text).toContain("gone.inc");
  });

  it("reads a file that includes itself once rather than forever", () => {
    const result = run("#include_drs loop.inc\n<PLAYER_SETUP>\n", {
      "loop.inc": "#const L 4\n#include_drs loop.inc\n",
    });
    expect(result.symbols.get("L")).toBe(4);
  });

  it("says the install was not found when there are no files at all", () => {
    const result = run("#include_drs a.inc\n<PLAYER_SETUP>\n");
    const note = result.notes.find((n) => n.key === "includes");
    expect(note?.text).toContain("could not find");
  });
});
