// Phase 2.3 parser unit suite — one test per docs/parser-design.md §5
// production / §10 recovery path, plus the §12 micro-fixtures that don't
// need corpus files. Corpus + fuzz live in their own files.

import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import type { LanguageData } from "../language";
import type { CommandNode, IfNode, OrphanBlockNode, ParseResult, RandomNode, RawNode } from "../types";
import { checkProperties, loadLanguage } from "./testUtils";

const lang = loadLanguage();

function parse(source: string, l: LanguageData = lang): ParseResult {
  const result = parseRms(source, l);
  // Every unit test also enforces the §12 properties for free.
  expect(checkProperties(result)).toEqual([]);
  return result;
}

function codes(result: ParseResult): string[] {
  return result.diagnostics.map((d) => d.code);
}

function errorCodes(result: ParseResult): string[] {
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

describe("sections and preamble", () => {
  it("parses preamble directives before the first section", () => {
    const r = parse("#const NUM 2\n<PLAYER_SETUP>\nrandom_placement");
    expect(r.script.preamble).toHaveLength(1);
    expect(r.script.sections).toHaveLength(1);
    expect(r.script.sections[0].name).toBe("PLAYER_SETUP");
    expect(r.script.sections[0].known).toBe(true);
    expect(r.script.sections[0].items).toHaveLength(1);
  });

  it("flags unknown sections (RMS0100) but keeps them", () => {
    const r = parse("<FUTURE_SECTION_2>\n");
    expect(codes(r)).toContain("RMS0100");
    expect(r.script.sections[0].known).toBe(false);
    expect(r.script.sections[0].name).toBe("FUTURE_SECTION_2");
  });

  it("duplicate same-type sections are legal — no diagnostic (guide line 148)", () => {
    const r = parse("<ELEVATION_GENERATION>\ncreate_elevation 3 { base_size 4 }\n<ELEVATION_GENERATION>\ncreate_elevation 5 { base_size 2 }");
    expect(codes(r).filter((c) => c.startsWith("RMS01"))).toEqual([]);
    expect(r.script.sections).toHaveLength(2);
  });
});

describe("commands, attributes, args (§5.1 item 4, §6)", () => {
  it("parses a block command with attributes", () => {
    const r = parse("<OBJECTS_GENERATION>\ncreate_object GOLD\n{\n  number_of_objects 4\n  set_gaia_object_only\n}");
    const cmd = r.script.sections[0].items[0] as CommandNode;
    expect(cmd.kind).toBe("command");
    expect(cmd.def?.name).toBe("create_object");
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0].value).toBe("GOLD");
    expect(cmd.block?.items).toHaveLength(2);
    expect(cmd.block?.close).toBeDefined();
  });

  it("dual-use base_terrain: command at section level, attribute in a block — no RMS0207", () => {
    const r = parse("<LAND_GENERATION>\nbase_terrain WATER\ncreate_land { base_terrain GRASS land_percent 10 }");
    expect(codes(r)).not.toContain("RMS0207");
  });

  it("RMS0207: attribute at statement level parses as attribute with a warning", () => {
    const r = parse("<LAND_GENERATION>\nnumber_of_tiles 200");
    expect(codes(r)).toContain("RMS0207");
    expect(r.script.sections[0].items[0].kind).toBe("attribute");
  });

  it("bare numeric IDs are legal in constant slots — no type diagnostic (§2.1)", () => {
    const r = parse("<OBJECTS_GENERATION>\ncreate_object 32 { number_of_objects 4 }");
    expect(codes(r)).not.toContain("RMS0202");
  });

  it("float into an integer slot draws NO diagnostic (engine rounds)", () => {
    const r = parse("#const MAPSCALE_MODIFIER 0.9592");
    expect(codes(r)).toEqual([]);
    expect(r.symbols[0]).toMatchObject({ name: "MAPSCALE_MODIFIER", directiveKind: "const" });
  });

  it("RMS0212 fires in numeric slots only", () => {
    const bad = parse("<LAND_GENERATION>\ncreate_land { land_percent 50% }");
    expect(codes(bad)).toContain("RMS0212");
    const label = parse("#define 2V1\nif 2V1 #define X endif");
    expect(codes(label)).not.toContain("RMS0212");
  });

  it("RMS0214: rnd split by a space gets the specific message, not a generic mismatch", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles rnd(1, 5) }");
    expect(codes(r)).toContain("RMS0214");
  });

  it("inf/-inf are numeric values, no diagnostic", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles inf }");
    expect(codes(r)).not.toContain("RMS0202");
  });

  it("unknown-name runs collapse to ONE diagnostic (OWWC 'number of clumps' fixture)", () => {
    const r = parse("<ELEVATION_GENERATION>\ncreate_elevation 5 { number of clumps 10000 base_size 4 }");
    const unknowns = r.diagnostics.filter((d) => d.code === "RMS0200" || d.code === "RMS0215");
    expect(unknowns).toHaveLength(1);
  });

  it("did-you-mean: edit distance (elavation-style typo)", () => {
    const r = parse("<ELEVATION_GENERATION>\ncreate_elevation 5 { base_sixe 4 }");
    const diag = r.diagnostics.find((d) => d.code === "RMS0200");
    expect(diag?.message).toContain("base_size");
  });

  it("did-you-mean: suffix match (avoidance_distance fixture)", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { avoidance_distance 5 }");
    const diag = r.diagnostics.find((d) => d.code === "RMS0200");
    expect(diag?.message).toContain("other_zone_avoidance_distance");
  });

  it("RMS0217: negative border value is valid (no RMS0203) but draws a caution, worded as valid", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { left_border -5 }");
    expect(codes(r)).not.toContain("RMS0203");
    expect(codes(r)).toContain("RMS0217");
    const diag = r.diagnostics.find((d) => d.code === "RMS0217");
    expect(diag?.severity).toBe("warning");
    expect(diag?.message).toContain("valid RMS");
    expect(diag?.message.toLowerCase()).toContain("land_position");
  });

  it("RMS0217 does not fire for non-negative border values", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { left_border 5 }");
    expect(codes(r)).not.toContain("RMS0217");
  });
});

describe("the data-quality firewall (§6 stop set)", () => {
  const miniLang: LanguageData = {
    sections: ["TEST"],
    commands: [
      {
        name: "overstated",
        section: "TEST",
        kind: "standalone",
        // Unverified data claims 3 args; real usage supplies 1.
        arguments: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
          { name: "c", type: "integer" },
        ],
        verified: false,
      },
      { name: "next_command", section: "TEST", kind: "standalone", arguments: [{ name: "n", type: "integer" }], verified: true },
    ],
    attributes: [],
    directives: [],
    controlKeywords: lang.controlKeywords,
  };

  it("overstated unverified arity must NOT eat the next statement's name", () => {
    const r = parse("<TEST>\noverstated 1\nnext_command 2", miniLang);
    const items = r.script.sections[0].items;
    expect(items).toHaveLength(2);
    expect((items[1] as CommandNode).def?.name).toBe("next_command");
    // The too-few-args diagnostic exists but is capped at info (unverified).
    const tooFew = r.diagnostics.find((d) => d.code === "RMS0201");
    expect(tooFew?.severity).toBe("info");
  });
});

describe("if / random (§5.1 item 3)", () => {
  it("parses if/elseif/else/endif with items per branch", () => {
    const r = parse("if HUGE_MAP #define BIG\nelseif TINY_MAP #define SMALL\nelse #define MID\nendif");
    const node = r.script.preamble[0] as IfNode;
    expect(node.kind).toBe("if");
    expect(node.branches).toHaveLength(3);
    expect(node.branches[0].items).toHaveLength(1);
    expect(node.endif).toBeDefined();
    expect(r.symbols.map((s) => s.conditionalDepth)).toEqual([1, 1, 1]);
  });

  it("random with preamble junk draws RMS0106; branches parse", () => {
    const r = parse("start_random junk_token percent_chance 50 #define A percent_chance 50 #define B end_random");
    const node = r.script.preamble[0] as RandomNode;
    expect(node.preamble.length).toBeGreaterThan(0);
    expect(node.branches).toHaveLength(2);
    expect(codes(r)).toContain("RMS0106");
  });

  it("QS fixture: percent_chance 50 #define 7_RELICS — depth counts random branches, no RMS0212", () => {
    const r = parse("start_random percent_chance 50 #define 7_RELICS percent_chance 50 end_random");
    expect(r.symbols[0]).toMatchObject({ name: "7_RELICS", conditionalDepth: 1 });
    expect(codes(r)).not.toContain("RMS0212");
  });

  it("nested start_random parses structurally with RMS0213", () => {
    const r = parse("start_random percent_chance 100 start_random percent_chance 100 #define X end_random end_random");
    expect(codes(r)).toContain("RMS0213");
    expect(errorCodes(r)).toEqual([]);
  });

  it("ForeDaut fixture: a stray extra endif → RMS0106 only, absorbed, no unknown-name noise", () => {
    const r = parse("if A #define X endif\nendif");
    const relevant = r.diagnostics.filter((d) => d.code !== "RMS0106");
    expect(codes(r)).toContain("RMS0106");
    expect(relevant).toHaveLength(0);
    expect(r.script.preamble.some((i) => i.kind === "raw")).toBe(true);
  });

  it("percent_chance accepts an expression operand", () => {
    const r = parse("#const X 30\nstart_random percent_chance (X + 20) #define A end_random");
    expect(codes(r).filter((c) => c === "RMS0208" || c === "RMS0202")).toEqual([]);
  });
});

describe("§5.4: orphan, upgrade, shared blocks", () => {
  it("unknown command followed by { upgrades to a block-shaped CommandNode", () => {
    const r = parse("<LAND_GENERATION>\ncraete_land { terrain_type GRASS }");
    const cmd = r.script.sections[0].items[0] as CommandNode;
    expect(cmd.kind).toBe("command");
    expect(cmd.def).toBeUndefined();
    expect(cmd.block?.items).toHaveLength(1);
    const diag = r.diagnostics.find((d) => d.code === "RMS0200");
    expect(diag?.message).toContain("create_land");
  });

  it("plain orphan block: RMS0102, contents parsed", () => {
    const r = parse("<LAND_GENERATION>\n{ terrain_type GRASS }");
    expect(codes(r)).toContain("RMS0102");
    const orphan = r.script.sections[0].items[0] as OrphanBlockNode;
    expect(orphan.kind).toBe("orphanBlock");
    expect(orphan.block.items).toHaveLength(1);
  });

  it("guide Example2 verbatim: shared block gets RMS0110 INFO, never RMS0102", () => {
    const r = parse(
      "<OBJECTS_GENERATION>\nif REGICIDE create_object KING else create_object SCOUT endif\n{ max_distance_to_players 8 }",
    );
    expect(codes(r)).toContain("RMS0110");
    expect(codes(r)).not.toContain("RMS0102");
    const infos = r.diagnostics.filter((d) => d.code === "RMS0110");
    expect(infos.every((d) => d.severity === "info")).toBe(true);
    expect(errorCodes(r)).toEqual([]);
    // Structure survives: the if node AND a parsed shared block.
    const items = r.script.sections[0].items;
    expect(items[0].kind).toBe("if");
    expect(items[1].kind).toBe("orphanBlock");
    expect((items[1] as OrphanBlockNode).block.items).toHaveLength(1);
  });
});

describe("§5.3 degradation", () => {
  it("endif with a { open inside: ONE RMS0110, forward extension absorbs the trailing }", () => {
    const r = parse("<LAND_GENERATION>\nif A create_land { terrain_type GRASS endif land_percent 10 }\nbase_terrain WATER");
    expect(codes(r).filter((c) => c === "RMS0110")).toHaveLength(1);
    expect(codes(r)).not.toContain("RMS0104");
    expect(codes(r)).not.toContain("RMS0106");
    const raw = r.script.sections[0].items.find((i) => i.kind === "raw") as RawNode;
    expect(raw).toBeDefined();
    // Parsing resumes cleanly after the degraded range.
    const after = r.script.sections[0].items[r.script.sections[0].items.length - 1];
    expect(after.kind).toBe("command");
  });

  it("mirror: } with an if open inside the block: ONE RMS0110, trailing endif absorbed", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { terrain_type GRASS if A } endif\nbase_terrain WATER");
    expect(codes(r).filter((c) => c === "RMS0110")).toHaveLength(1);
    expect(codes(r)).not.toContain("RMS0104");
    expect(codes(r)).not.toContain("RMS0106");
  });

  it("conditional spanning a section header: RMS0110 info, header absorbed, no error", () => {
    const r = parse("if REGICIDE <PLAYER_SETUP> endif\n<LAND_GENERATION>\nbase_terrain WATER");
    expect(codes(r)).toContain("RMS0110");
    expect(errorCodes(r)).toEqual([]);
    // The absorbed header did not create a section; the later real one did.
    expect(r.script.sections.map((s) => s.name)).toEqual(["LAND_GENERATION"]);
  });

  it("interleaved if/random overlap degrades to one RawNode", () => {
    const r = parse("if A start_random percent_chance 100 endif end_random");
    expect(codes(r).filter((c) => c === "RMS0110")).toHaveLength(1);
    expect(errorCodes(r)).toEqual([]);
  });
});

describe("unclosed constructs at EOF (§5.2)", () => {
  it("unclosed { at EOF → RMS0101 error", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { terrain_type GRASS");
    expect(errorCodes(r)).toContain("RMS0101");
  });

  it("unclosed if at EOF → RMS0105 warning (not error)", () => {
    const r = parse("if HUGE_MAP #define BIG");
    expect(codes(r)).toContain("RMS0105");
    expect(errorCodes(r)).toEqual([]);
  });

  it("section header while { open → RMS0103 error, block force-closed", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { terrain_type GRASS\n<TERRAIN_GENERATION>\ncreate_terrain DESERT { number_of_clumps 3 }");
    expect(errorCodes(r)).toContain("RMS0103");
    expect(r.script.sections).toHaveLength(2);
  });
});

describe("math expressions (§2.2)", () => {
  it("Vanguard fixture: attribute-arg expression, three tokens, no lints", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { set_avoid_player_start_areas (PL_FOREST_MAX_DIST + 1) }");
    expect(codes(r).filter((c) => c.startsWith("RMS02"))).toEqual([]);
    const cmd = r.script.sections[0].items[0] as CommandNode;
    const attr = cmd.block?.items[0];
    expect(attr?.kind).toBe("attribute");
  });

  it("AD4 fixture: #const value expression (directive-arg assembly path)", () => {
    const r = parse("#const MAPSIZE 100\n#const MAPAREA (MAPSIZE * MAPSIZE)");
    expect(codes(r)).toEqual([]);
    expect(r.symbols).toHaveLength(2);
    expect(r.symbols[1].name).toBe("MAPAREA");
  });

  it("numeric-first operand (Pa_Site lines 721-722 shape)", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (24 * SCALE) }");
    expect(codes(r).filter((c) => c === "RMS0208" || c === "RMS0210")).toEqual([]);
  });

  it("unglued operands: ( A + 1 ) draws RMS0210", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles ( A + 1 ) }");
    expect(codes(r)).toContain("RMS0210");
  });

  it("glued operator: single-token (A+1) draws RMS0210", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (A+1) }");
    expect(codes(r)).toContain("RMS0210");
  });

  it("rnd inside an expression draws RMS0210", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (A + rnd(1,5) + 2) }");
    expect(codes(r)).toContain("RMS0210");
  });

  it("nested paren operand draws RMS0210 (engine drops it silently)", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (GOLD_COUNT + (5 + 2)) }");
    expect(codes(r)).toContain("RMS0210");
  });

  it("comment inside an expression draws RMS0210 (guide line 3362)", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (A + /* why */ 1) }");
    const lints = r.diagnostics.filter((d) => d.code === "RMS0210");
    expect(lints.some((d) => d.message.includes("Comments"))).toBe(true);
  });

  it("unclosed expression: RMS0208 + degraded to raw, block still closes", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { number_of_tiles (A + }\nbase_terrain WATER");
    expect(codes(r)).toContain("RMS0208");
    expect(errorCodes(r)).toEqual([]);
  });
});

describe("directives, quotes, includes, symbols (§5.2, §7)", () => {
  it("quoted #include_drs path assembles across tokens", () => {
    const r = parse('#include_drs "my maps/some file.rms"');
    expect(r.includes).toHaveLength(1);
    expect(r.includes[0]).toMatchObject({ path: "my maps/some file.rms", quoted: true });
    expect(codes(r)).toEqual([]);
  });

  it("quoted #includeXS draws RMS0211 (documented engine bug)", () => {
    const r = parse('#includeXS "a b.xs"');
    expect(codes(r)).toContain("RMS0211");
  });

  it("unclosed quote → RMS0209, degraded, parse continues", () => {
    const r = parse('#include_drs "never closed\n<PLAYER_SETUP>\nrandom_placement');
    expect(codes(r)).toContain("RMS0209");
    expect(r.script.sections).toHaveLength(1);
  });

  it("unknown directive → RMS0206, kept as a node", () => {
    const r = parse("#notreal 5");
    expect(codes(r)).toContain("RMS0206");
    expect(r.script.preamble[0].kind).toBe("directive");
  });

  it("#undefine records the attempt but the symbol stays (non-functional in DE)", () => {
    const r = parse("#define FLAG\n#undefine FLAG");
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0].undefineAttempted).toBe(true);
  });
});

describe("cascade suppression (§5.1, BCC2 shape)", () => {
  it("one glued brace produces ONE RMS0207 plus a summary, not one per command", () => {
    const r = parse(
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 4 }8050 create_object STONE { number_of_objects 3 } create_object BOAR { number_of_objects 2 } create_object DEER { number_of_objects 1 }",
    );
    expect(codes(r)).toContain("RMS0003");
    expect(errorCodes(r)).toContain("RMS0101"); // outer block never closes
    const wrongContext = r.diagnostics.filter((d) => d.code === "RMS0207");
    expect(wrongContext.length).toBeLessThanOrEqual(2); // first + summary
  });
});
