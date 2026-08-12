// Phase 2.3 parser unit suite — one test per docs/parser-design.md Sec.5
// production / Sec.10 recovery path, plus the Sec.12 micro-fixtures that don't
// need corpus files. Corpus + fuzz live in their own files.

import { describe, expect, it } from "vitest";

import { parseRms } from "../parser";
import type { LanguageData } from "../language";
import type { CommandNode, IfNode, OrphanBlockNode, ParseResult, RandomNode, RawNode } from "../types";
import { checkProperties, loadLanguage } from "./testUtils";

const lang = loadLanguage();

function parse(source: string, l: LanguageData = lang): ParseResult {
  const result = parseRms(source, l);
  // Every unit test also enforces the Sec.12 properties for free.
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

describe("commands, attributes, args (Sec.5.1 item 4, Sec.6)", () => {
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

  it("bare numeric IDs are legal in constant slots — no type diagnostic (Sec.2.1)", () => {
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

  // Sec.6 amendment: a #const used as an attribute value is standard RMS idiom
  // and must not warn. Noticed from live testing; the original rule
  // ("numeric slots accept number/rnd/expression/inf") warned on every one,
  // a goal-#5 violation. Resolution is symbol-table-aware, not type-aware.
  describe("constants in numeric slots (Sec.6 amendment)", () => {
    it("a #const defined above the use draws NO diagnostic", () => {
      const r = parse(
        "#const PL_LANDS_CLUMPING_FAC 15\n<LAND_GENERATION>\n" +
          "create_land { clumping_factor PL_LANDS_CLUMPING_FAC land_position 74 26 }",
      );
      expect(codes(r)).not.toContain("RMS0202");
    });

    it("a #define'd name also counts as defined (permissive by design)", () => {
      const r = parse("#define FLAGGY\n<LAND_GENERATION>\ncreate_land { clumping_factor FLAGGY }");
      expect(codes(r)).not.toContain("RMS0202");
    });

    it("a conditionally-defined #const counts as defined", () => {
      const r = parse(
        "if TINY_MAP\n#const C 5\nelse\n#const C 9\nendif\n<LAND_GENERATION>\ncreate_land { clumping_factor C }",
      );
      expect(codes(r)).not.toContain("RMS0202");
    });

    it("a name never defined anywhere still warns", () => {
      const r = parse("<LAND_GENERATION>\ncreate_land { clumping_factor NEVER_DEFINED }");
      expect(codes(r)).toContain("RMS0202");
      expect(r.diagnostics.find((d) => d.code === "RMS0202")?.severity).toBe("warning");
    });

    it("use BEFORE the #const still warns — the engine requires definition higher up (guide L148)", () => {
      const r = parse("<LAND_GENERATION>\ncreate_land { clumping_factor LATER }\n#const LATER 15");
      expect(codes(r)).toContain("RMS0202");
    });

    it("softens to info when an include is present — the name may live in there (Sec.7)", () => {
      const r = parse(
        "#include_drs foo.rms\n<LAND_GENERATION>\ncreate_land { clumping_factor FROM_INCLUDE }",
      );
      const d = r.diagnostics.find((x) => x.code === "RMS0202");
      expect(d?.severity).toBe("info");
    });
  });

  // #const's value slot is typed otherConstant, not integer. Guide L3295
  // ("everything ... is represented internally by a numeric identifier"),
  // L3353 (constants are read as numbers where numeric input is expected)
  // and L3306 ("items can have multiple constants assigned to them") make
  // constant-to-constant aliasing legal: `#const PREDATOR_A WOLF` is
  // identical to `#const PREDATOR_A 3` when WOLF is 3. Rage Forest 2026
  // alone had 155 false warnings from this before the data fix.
  describe("#const value forms (all must parse clean)", () => {
    it("aliases another constant", () => {
      const r = parse("#const PREDATOR_A WOLF");
      expect(codes(r)).not.toContain("RMS0202");
    });

    it("still takes a plain number", () => {
      const r = parse("#const NUM 10");
      expect(codes(r)).not.toContain("RMS0202");
    });

    // The regression that made this change risky: expression assembly keys
    // off a leading "(" and is NOT gated on argument type, so retyping the
    // slot must not disturb it. AD4 - Pag's line is a required Sec.12 fixture.
    it("still assembles a math expression (AD4 fixture)", () => {
      const r = parse("#const MAPAREA (MAPSIZE * MAPSIZE)");
      expect(codes(r)).not.toContain("RMS0208");
      expect(codes(r)).not.toContain("RMS0202");
      const node = r.script.preamble[0];
      expect(node.kind).toBe("directive");
      const value = node.kind === "directive" ? node.args[1]?.value : undefined;
      expect(value && typeof value === "object" && "expr" in value).toBe(true);
    });

    it("still takes an rnd() (guide: rnd works with #const)", () => {
      const r = parse("#const R rnd(1,5)");
      const node = r.script.preamble[0];
      const value = node.kind === "directive" ? node.args[1]?.value : undefined;
      expect(value).toEqual({ rnd: [1, 5] });
    });

    it("still takes a float, and the inf flooring idiom (guide L3361)", () => {
      expect(codes(parse("#const F 1.5"))).not.toContain("RMS0202");
      expect(codes(parse("#const VAL (5.9 % -inf)"))).not.toContain("RMS0208");
    });
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

  // BUG-005 piece 1. The two RMS0200 branches make different claims because
  // they rest on different evidence, and the whole point of the fix is that the
  // no-suggestion branch says nothing about the engine. That is a property of a
  // string, so it regresses silently unless something pins it — the message had
  // no test at all before this, which is how "the engine will silently ignore
  // it" survived the positive-resolver rule by four months.
  describe("RMS0200 asserts engine behaviour only where a did-you-mean earns it", () => {
    const ENGINE_CLAIM = /the engine will/i;

    it("no suggestion: reports the observation, makes no behavioural claim", () => {
      // A name far enough from every known one that no suggestion fires.
      const r = parse("<LAND_GENERATION>\ncreate_land { qqzzxx 5 }");
      const diag = r.diagnostics.find((d) => d.code === "RMS0200");
      expect(diag).toBeDefined();
      expect(diag?.suggestion).toBeUndefined();
      expect(diag?.message).not.toMatch(ENGINE_CLAIM);
      expect(diag?.message).toContain("qqzzxx");
    });

    it("with a suggestion: keeps the confident wording, since a near-miss is evidence", () => {
      const r = parse("<ELEVATION_GENERATION>\ncreate_elevation 5 { base_sixe 4 }");
      const diag = r.diagnostics.find((d) => d.code === "RMS0200");
      expect(diag?.suggestion).toBe("base_size");
      expect(diag?.message).toMatch(ENGINE_CLAIM);
    });
  });

  // BUG-005 piece 2. Sec.2.1: the engine resolves every word to one integer, so
  // `#const L 32` makes `L` the same word as the command holding tokenId 32.
  // 581 corpus warnings were this one idiom in two maps, and all 581 were on a
  // construct that works — 24hr_Petra.rms has no create_land and no
  // create_player_lands, and its lands generate.
  describe("RMS0200: a #const aliased to a command's token id resolves (BUG-005 piece 2)", () => {
    const aliased = "#const L 32\n<LAND_GENERATION>\nL { terrain_type SNOW land_percent 15 }";

    it("resolves to the real command and stops warning", () => {
      const r = parse(aliased);
      expect(codes(r)).not.toContain("RMS0200");
      const node = r.script.sections[0].items[0] as CommandNode;
      expect(node.def?.name).toBe("create_land");
    });

    it("keeps the author's own token, so nothing re-prints the code", () => {
      const r = parse(aliased);
      const node = r.script.sections[0].items[0] as CommandNode;
      // The def says create_land; the SOURCE still says L. Breakdown renders a
      // real editable card off the def while every span still points at what
      // the author wrote (CLAUDE.md: code is the only source of truth).
      //
      // Both halves are asserted together on purpose. An unknown command ALSO
      // keeps its token and ALSO gets its block, so the token check alone
      // passes whether or not the resolver exists — it was vacuous when first
      // written and a mutant that deleted the resolver left it green.
      expect(node.def?.name).toBe("create_land");
      expect(r.tokens[node.name].text).toBe("L");
      expect(node.block?.items).toHaveLength(2);
    });

    it("does not resolve an id no command claims", () => {
      // 33 was the other arm of RMSTEST_61/62 and made no land in either.
      const r = parse("#const AX 33\n<LAND_GENERATION>\nAX { terrain_type SNOW }");
      expect(codes(r)).toContain("RMS0200");
      expect((r.script.sections[0].items[0] as CommandNode).def).toBeUndefined();
    });

    it("cannot shadow a real command name, because no such alias is recordable", () => {
      // Two mutants were spent finding out that the `??` order in
      // parseNamedOrRun is NOT what protects this, and a test asserting it
      // could not be made to fail. The real guard sits one slot earlier:
      // `#const`'s NAME operand keeps the known-name stop, so `#const
      // create_elevation 32` consumes nothing and records no symbol at all.
      // With no symbol there is no alias, and the lookup order is unobservable.
      //
      // This asserts the reachability property instead, which is the thing that
      // actually holds. Give the name slot `acceptsKnownName` and this goes red
      // — which is the moment the lookup order starts mattering and someone has
      // to think about it.
      const r = parse("#const create_elevation 32\n<ELEVATION_GENERATION>\ncreate_elevation 5 { }");
      expect(r.symbols).toHaveLength(0);
      expect(codes(r)).toContain("RMS0201");
      expect((r.script.sections[0].items[0] as CommandNode).def?.name).toBe("create_elevation");
    });

    it("does not reach backwards: a #const below a use cannot reinterpret it", () => {
      // Single-pass, like the engine. A later definition changing what an
      // earlier line meant would also make the parse order-dependent.
      const r = parse("<LAND_GENERATION>\nL { terrain_type SNOW }\n#const L 32");
      expect(codes(r)).toContain("RMS0200");
    });

    it("declines an expression value rather than evaluating one", () => {
      // SymbolInfo carries the value's TOKEN, and evaluating it here would be
      // inventing engine behaviour nobody has measured. Same call validate.ts
      // makes for RMS0111's id 69.
      const r = parse("#const L (30 + 2)\n<LAND_GENERATION>\nL { terrain_type SNOW }");
      expect(codes(r)).toContain("RMS0200");
    });

    it("declines anything that is not a plain decimal integer", () => {
      // This pins the /^\d+$/ specifically, and the expression case above
      // cannot: `Number("(30")` is NaN, so that test stays green however loose
      // the check gets. `Number` is the trap here — it accepts hex, a leading
      // `+`, surrounding whitespace, and turns "" into 0 — so a laxer guard
      // would read 0x20 as 32 and silently render this as create_land.
      const r = parse("#const L 0x20\n<LAND_GENERATION>\nL { terrain_type SNOW }");
      expect(codes(r)).toContain("RMS0200");
    });
  });

  // The other half of the same Sec.2.1 ruling: a #const may alias a name, not
  // only an id. `24hr_Battle Lines 1.0.rms:93` writes exactly this under its own
  // `/* parameter renames */` comment, and we reported the author's correct line
  // twice — once for too-few-arguments, once for the orphaned attribute left
  // behind. Parked on BUG-005 from BUG-003's triage.
  describe("#const may take a known name as its value (BUG-003's two parked sites)", () => {
    it("consumes the known name as the value and says nothing", () => {
      const r = parse("#const restricted_terrain_distance max_distance_to_other_zones\n<LAND_GENERATION>\n");
      expect(r.diagnostics.filter((d) => d.code === "RMS0201")).toHaveLength(0);
      expect(codes(r)).not.toContain("RMS0207");
      expect(r.symbols[0].name).toBe("restricted_terrain_distance");
      expect(r.tokens[r.symbols[0].valueToken as number].text).toBe("max_distance_to_other_zones");
    });

    it("still stops on structure, so a valueless #const cannot eat the file", () => {
      // Only the known-name half of the stop set yields. If the structural half
      // ever followed it, this #const would swallow the section header and the
      // rest of the script would parse as the preamble of a directive.
      const r = parse("#const SIZE\n<LAND_GENERATION>\ncreate_land { land_percent 5 }");
      expect(codes(r)).toContain("RMS0201");
      expect(r.script.sections).toHaveLength(1);
      expect(r.script.sections[0].items).toHaveLength(1);
    });

    it("leaves the known-name stop in place for every other slot", () => {
      // assign_to.target is an otherConstant too, and there a known name really
      // is a mangled line. Deriving the exception from `type` would have taken
      // this with it.
      const r = parse("<LAND_GENERATION>\ncreate_land { assign_to land_percent 5 }");
      expect(codes(r)).toContain("RMS0201");
    });
  });

  it("did-you-mean: prefix match on a truncated name", () => {
    // A half-typed name is unreachable by edit distance once the missing tail
    // runs past two characters, which is most of RMS's longer attributes.
    // (The four dead engine strings that motivated this rule now have their
    // own language.json entries and draw RMS0310 instead — see validate's
    // suite. This exercises the heuristic on names the data does not carry.)
    const suggestionFor = (source: string): string | undefined =>
      parse(source).diagnostics.find((d) => d.code === "RMS0200")?.suggestion;

    expect(suggestionFor("<OBJECTS_GENERATION>\ncreate_object GOLD { max_distance_to 5 }")).toBe(
      "max_distance_to_players",
    );
  });

  it("did-you-mean: ranks by what the enclosing command accepts, not by length", () => {
    // min_distance_ is a prefix of four real attributes. The SHORTEST is
    // min_distance_cliffs (19 chars), which create_object cannot take;
    // min_distance_to_players (23) is the one that belongs here. Length alone
    // would hand over the impossible one.
    const diag = parse("<OBJECTS_GENERATION>\ncreate_object GOLD { min_distance_ 5 }").diagnostics.find(
      (d) => d.code === "RMS0200",
    );
    expect(diag?.suggestion).toBe("min_distance_to_players");
  });

  it("did-you-mean: never suggests a name that is itself non-functional", () => {
    // min_distance now HAS an entry (nonFunctional, replacedBy
    // min_distance_to_players), so it is a known name. It must still never be
    // offered as a fix — a did-you-mean has to point at something that works,
    // or the author is sent to a second dead end.
    const diag = parse("<OBJECTS_GENERATION>\ncreate_object GOLD { min_distanc 5 }").diagnostics.find(
      (d) => d.code === "RMS0200",
    );
    expect(diag?.suggestion).not.toBe("min_distance");
  });

  it("RMS0217: negative border value is valid (no RMS0203) but draws a caution, worded as valid", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { left_border -5 }");
    expect(codes(r)).not.toContain("RMS0203");
    expect(codes(r)).toContain("RMS0217");
    const diag = r.diagnostics.find((d) => d.code === "RMS0217");
    // INFO, not warning. cautionBelow is a per-argument scalar, so this check
    // cannot see the mitigation it recommends: 135 of the 135 attributable
    // corpus sites sit in a block that already carries land_position or
    // base_size, and 0 in a block with neither. Warning severity would fire
    // hardest on authors who did the documented thing.
    expect(diag?.severity).toBe("info");
    expect(diag?.message).toContain("valid RMS");
    expect(diag?.message.toLowerCase()).toContain("land_position");
  });

  it("RMS0217's border message claims no engine behaviour the guide does not state", () => {
    // guide:887-890 says only "Negative values can be used, as long as the land
    // origin stays inside the map", and names two ways to ensure that. It names
    // no consequence at all. The shipped message used to say a negative border
    // "can crash the game", which is the failure CLAUDE.md's reference-data
    // rule exists to catch — a behavioural claim with no observation behind it.
    const message =
      parse("<LAND_GENERATION>\ncreate_land { left_border -5 }").diagnostics.find(
        (d) => d.code === "RMS0217",
      )?.message ?? "";
    expect(message.toLowerCase()).not.toContain("crash");
    expect(message.toLowerCase()).toContain("base_size");
  });

  it("RMS0217 does not fire for non-negative border values", () => {
    const r = parse("<LAND_GENERATION>\ncreate_land { left_border 5 }");
    expect(codes(r)).not.toContain("RMS0217");
  });

  it("RMS0210: one unglued-operand diagnostic, not one per bare paren", () => {
    // `( 5 + 1 )` has a bare opener AND a bare terminator. Both used to report,
    // with the same code, message and span — a duplicate, not a second finding.
    const r = parse("<LAND_GENERATION>\n#const A ( 5 + 1 )");
    expect(codes(r).filter((c) => c === "RMS0210")).toHaveLength(1);
  });
});

describe("the data-quality firewall (Sec.6 stop set)", () => {
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

  // BUG-003. RMS0201 is only ever as good as language.json's arity table, so
  // the two halves of the bug need pinning in opposite directions: a legal
  // omission must stay silent, and a real omission must keep warning. Pinning
  // only the first would let a future "sweep everything with a default" turn
  // the check off wholesale, which is the failure mode the entry's own
  // terrain_state note warns about.
  describe("RMS0201 optional-argument triage (BUG-003)", () => {
    const rms0201 = (source: string) =>
      parse(source).diagnostics.filter((d) => d.code === "RMS0201");

    it("the optional flag works, on a case the guide states outright", () => {
      // require_path is one of the five fixed on 2026-07-31, each carrying
      // explicit guide prose: "No argument, or a value of 0 imposes no further
      // restrictions" (guide:2719). That sentence is what licenses the flag —
      // not the presence of a `default`, and not how often shipped maps use it.
      expect(rms0201("<CONNECTION_GENERATION>\ncreate_connect_all_players_land { require_path }")).toEqual([]);
    });

    it("ai_info_map_type: the three-argument form is legal — SETTLED by a game measurement", () => {
      // `RMSTEST_54a` put the three-token form immediately before
      // `<LAND_GENERATION>`: an engine expecting a fourth argument would have
      // swallowed the section header and left the map blank. It came back
      // fully snow, as did `54b` without the line, so the arity is three.
      //
      // This is the same conclusion a 2026-08-05 attempt reached and had
      // reverted, and the difference is the evidence, not the answer: that
      // attempt counted 52 independent three-argument shipped uses, and
      // guide:475 lists showType NOT FUNCTIONAL on DE, so no shipped script
      // could ever have distinguished the two forms in play. **Change this
      // test only from a game measurement, never from a recount of shipped
      // maps** — the rule that killed the first attempt is untouched.
      expect(rms0201("<PLAYER_SETUP>\nai_info_map_type ARABIA 0 0")).toEqual([]);
    });

    it("ai_info_map_type: the full four-argument form is fine", () => {
      expect(rms0201("<PLAYER_SETUP>\nai_info_map_type CUSTOM 1 0 0")).toEqual([]);
    });

    it("terrain_cost: a missing TerrainType still warns", () => {
      // The counter-case. `Cost` carries a documented default (guide:1929) so a
      // mechanical "has a default ⇒ optional" sweep would reach this command —
      // but the argument being omitted here is the LEADING `TerrainType`, which
      // guide:1925's signature makes required and gives no default at all.
      const hits = rms0201("<CONNECTION_GENERATION>\ncreate_connect_all_players_land { terrain_cost 10 }");
      expect(hits).toHaveLength(1);
    });

    it("create_terrain: a missing TerrainType still warns", () => {
      // guide:1437's signature is `create_terrain TerrainType { Attributes }`.
      // This one caught our own sample.rms, which had never been read by the
      // parser it predates.
      expect(rms0201("<TERRAIN_GENERATION>\ncreate_terrain { base_terrain GRASS }")).toHaveLength(1);
    });
  });
});

describe("if / random (Sec.5.1 item 3)", () => {
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

describe("Sec.5.4: orphan, upgrade, shared blocks", () => {
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

describe("Sec.5.3 degradation", () => {
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

  // Sec.5.3 pins that symbols and includes survive degradation, and says why:
  // otherwise every later reference draws a false unknown-symbol warning. The
  // BACKWARD half of the range got that for free (those tokens had already been
  // through parseDirective). The forward extension added in rev 5 never parses
  // at all, so a directive in it was absorbed into the RawNode and recorded
  // nowhere — the pinned rule's own failure mode, produced by the mechanism
  // written to prevent it.
  describe("symbols and includes survive the FORWARD half of the range", () => {
    const degraded = (tail: string): string =>
      `<LAND_GENERATION>\nif REGICIDE\ncreate_land {\nland_percent 20\nendif\n${tail}\n}\ncreate_land { clumping_factor FOO }\n`;

    it("a #const past the trigger point is still a defined symbol", () => {
      const r = parse(degraded("#const FOO 5"));
      expect(codes(r).filter((c) => c === "RMS0110")).toHaveLength(1);
      expect(r.symbols.map((s) => s.name)).toContain("FOO");
      // The whole point: the later use resolves, so no false RMS0202.
      expect(codes(r)).not.toContain("RMS0202");
    });

    it("records the kind and the value token, not just the name", () => {
      const symbol = parse(degraded("#const FOO 5")).symbols.find((s) => s.name === "FOO");
      expect(symbol?.directiveKind).toBe("const");
      expect(symbol?.valueToken).toBeDefined();
      // Depth 0, and that is the engine's reading, not a shortcut: the `endif`
      // that triggered the degradation has already closed the `if`, so a
      // directive after it is unconditional however the region is rendered.
      expect(symbol?.conditionalDepth).toBe(0);
    });

    it("records the depth a directive still nested inside a conditional sat at", () => {
      // The mirror trigger: `}` arrives while an `if` opened inside the block
      // is still open, so the forward scan crosses a directive that IS under a
      // live conditional.
      const r = parse(
        "<LAND_GENERATION>\ncreate_land {\nif A\nland_percent 20\n}\n#const FOO 5\nendif\n",
      );
      expect(r.symbols.find((s) => s.name === "FOO")?.conditionalDepth).toBe(1);
    });

    it("an #include_drs past the trigger point still softens later diagnostics", () => {
      const r = parse(degraded('#include_drs "some dir/lands.inc"'));
      expect(r.includes.map((i) => i.path)).toEqual(["some dir/lands.inc"]);
      expect(r.includes[0].quoted).toBe(true);
    });

    it("uses the same stop set as parseDirective, so a control keyword is never swallowed", () => {
      // `#define endif` records nothing and leaves the `endif` to close the
      // range, exactly as it behaves outside a degraded region. The two paths
      // agreeing is the property worth pinning — a raw scan with its own idea
      // of where a directive's operands end would desynchronise the range.
      const r = parse(degraded("#define endif"));
      expect(r.symbols.map((s) => s.name)).not.toContain("endif");
      expect(parse("<LAND_GENERATION>\n#define endif\n").symbols).toEqual([]);
    });

    it("adds no second diagnostic inside the degraded range", () => {
      // Sec.5.3's one-diagnostic promise: the region is already one RMS0110.
      const r = parse(degraded('#includeXS "quoted.xs"'));
      expect(codes(r).filter((c) => c === "RMS0110")).toHaveLength(1);
      expect(codes(r)).not.toContain("RMS0211");
    });
  });
});

describe("unclosed constructs at EOF (Sec.5.2)", () => {
  it("unclosed { at EOF → RMS0101 WARNING, not error", () => {
    // Downgraded 2026-08-11 (BUG-006): `BCC2-Rekawa.rms` reaches EOF at brace
    // depth 1 and DE generates it with no visible problem, which refutes the
    // "the engine rejects or mangles this" half of goal 5's error bar. The
    // severity is asserted in both directions here, because the check has only
    // ever fired at error and a downgrade nothing pins can drift back.
    const r = parse("<LAND_GENERATION>\ncreate_land { terrain_type GRASS");
    expect(codes(r)).toContain("RMS0101");
    expect(errorCodes(r)).toEqual([]);
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

describe("math expressions (Sec.2.2)", () => {
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

describe("directives, quotes, includes, symbols (Sec.5.2, Sec.7)", () => {
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

describe("cascade suppression (Sec.5.1, BCC2 shape)", () => {
  it("one glued brace produces ONE RMS0207 plus a summary, not one per command", () => {
    const r = parse(
      "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 4 }8050 create_object STONE { number_of_objects 3 } create_object BOAR { number_of_objects 2 } create_object DEER { number_of_objects 1 }",
    );
    expect(codes(r)).toContain("RMS0003");
    expect(codes(r)).toContain("RMS0101"); // outer block never closes (a warning since BUG-006)
    const wrongContext = r.diagnostics.filter((d) => d.code === "RMS0207");
    expect(wrongContext.length).toBeLessThanOrEqual(2); // first + summary
  });
});
