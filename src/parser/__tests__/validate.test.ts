// Semantic-pass unit suite — one describe per docs/parser-design.md Sec.8
// check, plus the scoping decisions that came out of the corpus measurement
// (recorded in docs/build-log.md). The negative tests matter as much as the
// positive ones here: most of this pass's design is about what it refuses to
// claim, and a regression that starts warning on legal RMS is exactly the
// goal-#5 failure the corpus run existed to catch.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { validate, type GameConstantsForValidate, type ValidateReferenceDb } from "../validate";
import type { Diagnostic } from "../types";
import { loadLanguage, REPO_ROOT } from "./testUtils";

const lang = loadLanguage();
const gameConstants = JSON.parse(
  readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
) as GameConstantsForValidate;
const refDb: ValidateReferenceDb = { language: lang, gameConstants };

function check(source: string): Diagnostic[] {
  return validate(parseRms(source, lang), refDb);
}

function codes(source: string): string[] {
  return check(source).map((d) => d.code);
}

/** Diagnostics of one code, so a test can assert about a check in isolation. */
function only(source: string, code: string): Diagnostic[] {
  return check(source).filter((d) => d.code === code);
}

describe("RMS0300 — undefined condition labels", () => {
  it("flags a label that is one character off a defined one", () => {
    const found = only("#define BIG_MAP\n<PLAYER_SETUP>\nif BIG_MAPP\nrandom_placement\nendif\n", "RMS0300");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].suggestion).toBe("BIG_MAP");
  });

  it("treats a wrong-case label as a typo — RMS is case-sensitive", () => {
    const found = only("<PLAYER_SETUP>\nif Death_Match\nrandom_placement\nendif\n", "RMS0300");
    expect(found).toHaveLength(1);
    expect(found[0].suggestion).toBe("DEATH_MATCH");
  });

  it("says nothing about an unknown label with no near neighbour", () => {
    // The corpus rule: our 138 predefinedLabels came from a guide that
    // predates labels DE-official maps already branch on (THEME_AFRICAN,
    // MAPSIZE_ABOVE_GIANT). Absence from our data is not evidence.
    expect(codes("<PLAYER_SETUP>\nif THEME_MANGROVE\nrandom_placement\nendif\n")).not.toContain("RMS0300");
  });

  it("accepts predefined labels, game constants, and user defines", () => {
    const source = "#define MY_FLAG\n<PLAYER_SETUP>\nif DEATH_MATCH\nelseif MY_FLAG\nelseif SNOW\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0300");
  });

  it("stays quiet when the definition is present but commented out", () => {
    // Toggling a feature by commenting its #define is idiomatic; the dead
    // branch is deliberate, not a misspelling.
    const source = "/* #define DEBUG_MODE */\n#define DEBUG_MOD\n<PLAYER_SETUP>\nif DEBUG_MODE\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0300");
  });

  it("softens to info when the file has an include", () => {
    const source = '#include_drs "shared.rms"\n#define BIG_MAP\n<PLAYER_SETUP>\nif BIG_MAPP\nrandom_placement\nendif\n';
    const found = only(source, "RMS0300");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });
});

describe("RMS0301 — redefinition on the same execution path", () => {
  it("flags a second unconditional #const", () => {
    const found = only("#const TREES 10\n#const TREES 20\n", "RMS0301");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("FIRST");
  });

  it("flags two #consts inside one branch — both run, so the second is dead", () => {
    // The case `conditionalDepth` could not express: depth 1 for both, but
    // the same branch rather than two exclusive ones. Corpus-real, 30 sites.
    const source = "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 10\n#const TREES 20\nendif\n";
    const found = only(source, "RMS0301");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("distinguishes one percent_chance branch from two", () => {
    // Same branch: both run together whenever it is picked, second is dead.
    const sameBranch = "<LAND_GENERATION>\nstart_random\npercent_chance 100 #const TREES 10 #const TREES 20\nend_random\n";
    expect(only(sameBranch, "RMS0301")).toHaveLength(1);

    // Different branches of one start_random are mutually exclusive, exactly
    // like if/else — no claim to make.
    const twoBranches =
      "<LAND_GENERATION>\nstart_random\npercent_chance 50 #const TREES 10\npercent_chance 50 #const TREES 20\nend_random\n";
    expect(codes(twoBranches)).not.toContain("RMS0301");
  });

  it("ignores redefinition across exclusive conditional branches", () => {
    // Sec.8: only one branch's tokens ever survive, so this is legitimate.
    const source = "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 10\nelse\n#const TREES 20\nendif\n";
    expect(codes(source)).not.toContain("RMS0301");
  });

  it("ignores a definition nested one level deeper than the first", () => {
    // The inner one is conditional RELATIVE to the outer, so it can run in a
    // world where the outer one didn't. Not a total claim, not reported.
    const source = "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 10\nif REGICIDE\n#const TREES 20\nendif\nendif\n";
    expect(codes(source)).not.toContain("RMS0301");
  });

  it("ignores separate ifs over exclusive flags plus a trailing fallback", () => {
    // The idiom RMS forces: because the FIRST definition wins, the default
    // has to come last. Inverted from the C/Python habit, and correct here.
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 2\nendif\nif REGICIDE\n#const TREES 3\nendif\n#const TREES 1\n";
    expect(codes(source)).not.toContain("RMS0301");
  });

  it("ignores a repeated #define — setting a flag twice loses nothing", () => {
    expect(codes("#define ALPHA\n#define ALPHA\n")).not.toContain("RMS0301");
  });

  it("treats two separate ifs on one condition as one path", () => {
    // Different blocks, same guard stack: both run whenever the condition
    // holds, so the second assignment is just as dead as if they were adjacent.
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 2\nendif\nif DEATH_MATCH\n#const TREES 3\nendif\n";
    expect(only(source, "RMS0301")).toHaveLength(1);
  });

  it("respects monotonicity across those two ifs", () => {
    // Same shape, but the condition only becomes true between them — so the
    // first block never ran and the second definition is the live one.
    const source =
      "<PLAYER_SETUP>\nif LATE_FLAG\n#const TREES 2\nendif\n#define LATE_FLAG\nif LATE_FLAG\n#const TREES 3\nendif\n";
    expect(codes(source)).not.toContain("RMS0301");
  });
});

describe("RMS0314 — shadowed by an earlier definition on a containing path", () => {
  it("flags a default written above the conditional versions", () => {
    // The habit that transfers from C and Python and is backwards in RMS:
    // first definition wins, so a default has to come LAST.
    const source = "#const TREES 1\n<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 2\nendif\n";
    const found = only(source, "RMS0314");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("AFTER");
  });

  it("stays silent when the default is correctly written last", () => {
    const source = "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 2\nendif\n#const TREES 1\n";
    expect(codes(source)).not.toContain("RMS0314");
  });

  it("flags a nested assignment killed by an outer one under the same condition", () => {
    // if A / #const T 2 ... then later if B / if A / #const T 14 — the inner
    // one requires A, which the outer one already had, so it never applies.
    const source = [
      "<PLAYER_SETUP>",
      "if DEATH_MATCH",
      "#const TREES 2",
      "endif",
      "if REGICIDE",
      "if DEATH_MATCH",
      "#const TREES 14",
      "endif",
      "endif",
    ].join("\n");
    const found = only(source, "RMS0314");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("DEATH_MATCH");
  });

  it("says nothing when the two conditions are merely different", () => {
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\n#const TREES 2\nendif\nif REGICIDE\n#const TREES 3\nendif\n#const TREES 1\n";
    expect(codes(source)).not.toContain("RMS0314");
  });

  it("respects monotonicity — a #define in between makes the claim unsound", () => {
    // The earlier guard was FALSE where it was written and only becomes true
    // below, so the later definition is genuinely the live one. Reporting it
    // would be the one way this analysis can produce a false positive.
    const source = [
      "<PLAYER_SETUP>",
      "if LATE_FLAG",
      "#const TREES 2",
      "endif",
      "#define LATE_FLAG",
      "if LATE_FLAG",
      "if DEATH_MATCH",
      "#const TREES 3",
      "endif",
      "endif",
    ].join("\n");
    expect(codes(source)).not.toContain("RMS0314");
  });

  it("still fires when the intervening #define is of an unrelated name", () => {
    const source = [
      "<PLAYER_SETUP>",
      "if EARLY_FLAG",
      "#const TREES 2",
      "endif",
      "#define SOMETHING_ELSE",
      "if EARLY_FLAG",
      "if DEATH_MATCH",
      "#const TREES 3",
      "endif",
      "endif",
    ].join("\n");
    expect(only(source, "RMS0314")).toHaveLength(1);
  });

  it("defers to RMS0301 when both apply, so a line draws one diagnostic", () => {
    const source = [
      "#const TREES 1",
      "<PLAYER_SETUP>",
      "if DEATH_MATCH",
      "#const TREES 2",
      "#const TREES 3",
      "endif",
    ].join("\n");
    // TREES 2 is subsumed by the unconditional one; TREES 3 has both a
    // same-path predecessor and a subsuming one, and must report only once.
    expect(only(source, "RMS0314")).toHaveLength(1);
    expect(only(source, "RMS0301")).toHaveLength(1);
  });

  it("says nothing inside a branch that cannot run — RMS0313 owns that", () => {
    const source = [
      "<PLAYER_SETUP>",
      "if DEATH_MATCH",
      "#const TREES 2",
      "elseif REGICIDE",
      "#const TREES 3",
      "elseif DEATH_MATCH",
      "#const TREES 4",
      "endif",
    ].join("\n");
    expect(codes(source)).not.toContain("RMS0314");
    expect(only(source, "RMS0313")).toHaveLength(1);
  });
});

describe("RMS0313 — unreachable elseif branch", () => {
  it("flags a condition already tested earlier in the same chain", () => {
    // Corpus-real: DE's own nomad.rms tests INDOMALAYAN_TROPICAL at branch 6
    // and again at branch 11, 130 lines apart.
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\nrandom_placement\nelseif REGICIDE\nrandom_placement\nelseif DEATH_MATCH\nrandom_placement\nendif\n";
    const found = only(source, "RMS0313");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("never be reached");
  });

  it("says nothing when every branch tests something different", () => {
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\nrandom_placement\nelseif REGICIDE\nrandom_placement\nelse\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0313");
  });

  it("treats separate chains separately — the same test twice is fine", () => {
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\nrandom_placement\nendif\nif DEATH_MATCH\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0313");
  });

  it("is case-sensitive, because RMS conditions are", () => {
    const source = "<PLAYER_SETUP>\nif DEATH_MATCH\nrandom_placement\nelseif Death_Match\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0313");
  });
});

describe("RMS0302 — redefining a built-in game constant", () => {
  it("warns when the value differs from the engine's — the silent bug", () => {
    // SNOW is 32 in the extracted DB. Writing 11 does not make it 11; every
    // SNOW below this line still means 32.
    const found = only("#const SNOW 11\n", "RMS0302");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("32");
  });

  it("drops to info when the value matches — the documentation-header idiom", () => {
    // 73 of the corpus's 73 constant redefinitions are this: a copied
    // `if TERRAIN_CONSTANTS` block writing each engine ID down. The line does
    // nothing, which is worth saying quietly and not worth a warning.
    const found = only("#const SNOW 32\n", "RMS0302");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("stays at info when the value can't be compared", () => {
    // No integer literal to compare, so there is no positive evidence of a
    // mismatch — the claim narrows to "the engine keeps its own definition".
    const found = only("#const OTHER 5\n#const SNOW OTHER\n", "RMS0302");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("reports the definition that actually differs, not just the first", () => {
    const found = only("<PLAYER_SETUP>\n#const SNOW 32\nif DEATH_MATCH\n#const SNOW 11\nendif\n", "RMS0302");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("says it once across an if/elseif/else chain, not once per branch", () => {
    // Exclusive branches, so only one runs — but the engine keeps 32 whichever
    // one that is, making all three equally futile. One misunderstanding, one
    // report. Contrast RMS0301, which stays silent on the same shape for a
    // USER constant, where the branches really are doing different things.
    const source =
      "<PLAYER_SETUP>\nif DEATH_MATCH\n#const SNOW 12\nelseif REGICIDE\n#const SNOW 13\nelse\n#const SNOW 14\nendif\n";
    const found = only(source, "RMS0302");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    // The same chain over a name the engine does not own says nothing at all.
    expect(check(source.replace(/SNOW/g, "TEST_CONST"))).toEqual([]);
  });

  it("leaves ordinary user names alone", () => {
    expect(codes("#const MY_TREES 10\n")).not.toContain("RMS0302");
  });
});

describe("RMS0312 — defining an engine condition label", () => {
  it("notes a #define of a predefined label without calling it a no-op", () => {
    // The engine defines DEATH_MATCH only in a death match, so this #define
    // is a working force-on switch in every other game — not shadowing.
    const found = only("#define DEATH_MATCH\n", "RMS0312");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
    expect(codes("#define DEATH_MATCH\n")).not.toContain("RMS0302");
  });

  it("covers the guarded testing idiom three DE-official maps use", () => {
    const source = "#define EW_TESTING\n<PLAYER_SETUP>\nif EW_TESTING\n#define EMPIRE_WARS\nendif\nif EMPIRE_WARS\nrandom_placement\nendif\n";
    const found = only(source, "RMS0312");
    expect(found).toHaveLength(1);
    // And the branch it enables must not then be reported as undefined.
    expect(codes(source)).not.toContain("RMS0300");
  });

  it("says nothing about an ordinary user flag", () => {
    expect(codes("#define MY_FLAG\n")).not.toContain("RMS0312");
  });
});

describe("RMS0303 — use before definition", () => {
  it("flags a condition label used above its #define", () => {
    const found = only("<PLAYER_SETUP>\nif LATER\nrandom_placement\nendif\n#define LATER\n", "RMS0303");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("flags a constant used above its #const in a constant slot", () => {
    const source = "<TERRAIN_GENERATION>\ncreate_terrain MY_TERRAIN\n{\nnumber_of_clumps 4\n}\n#const MY_TERRAIN 10\n";
    expect(codes(source)).toContain("RMS0303");
  });

  it("accepts the normal order", () => {
    expect(codes("#define EARLY\n<PLAYER_SETUP>\nif EARLY\nrandom_placement\nendif\n")).not.toContain("RMS0303");
  });
});

/**
 * The corpus reports ZERO of these (see rms0304.measure.test.ts), so this suite
 * is the only evidence the check works at all — the RMS0314 situation, and the
 * reason the negative cases below are written out one by one rather than
 * summarised. Every `expect(...).not.toContain` here is a specific false
 * positive this check has already produced once, or one it would produce if
 * driven by `CommandDef.section`.
 */
describe("RMS0304 — a command in a section the engine will not run it from", () => {
  it("flags create_terrain in <OBJECTS_GENERATION> (RMSTEST_33a)", () => {
    const found = only("<OBJECTS_GENERATION>\ncreate_terrain SNOW { number_of_clumps 4 }\n", "RMS0304");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("flags create_object in <TERRAIN_GENERATION> (RMSTEST_33b)", () => {
    const found = only("<TERRAIN_GENERATION>\ncreate_object GOLD { number_of_objects 4 }\n", "RMS0304");
    expect(found).toHaveLength(1);
  });

  it("names both the section it needs and the section it is in", () => {
    const found = only("<OBJECTS_GENERATION>\ncreate_terrain SNOW { number_of_clumps 4 }\n", "RMS0304");
    expect(found[0].message).toContain("<TERRAIN_GENERATION>");
    expect(found[0].message).toContain("<OBJECTS_GENERATION>");
  });

  it("says nothing when the command is where it belongs", () => {
    expect(codes("<TERRAIN_GENERATION>\ncreate_terrain SNOW { number_of_clumps 4 }\n")).not.toContain("RMS0304");
  });

  it("says nothing about effect_amount outside <PLAYER_SETUP>", () => {
    // The counter-example the whole design exists for: 52 of the 53 hits a
    // section-driven check produces on this corpus are this line, in shipped
    // maps that work. effect_amount carries no sectionLocked flag, so nothing
    // is claimed about it in either direction.
    const source = "<OBJECTS_GENERATION>\neffect_amount SET_ATTRIBUTE GOLD ATTR_TERRAIN_ID 1\n";
    expect(codes(source)).not.toContain("RMS0304");
  });

  it("says nothing about a command whose lock has never been measured", () => {
    // create_player_lands in <PLAYER_SETUP> is the 53rd corpus hit, in our own
    // test-maps/sample.rms. Unmeasured means silent, not "probably fine".
    expect(codes("<PLAYER_SETUP>\ncreate_player_lands { base_size 5 }\n")).not.toContain("RMS0304");
  });

  it("flags a locked command nested inside a conditional", () => {
    // A command inside `if X` still belongs to the enclosing section, so the
    // check has to see through branches rather than only scan direct items.
    const source = "<OBJECTS_GENERATION>\nif DEATH_MATCH\ncreate_terrain SNOW { number_of_clumps 4 }\nendif\n";
    expect(codes(source)).toContain("RMS0304");
  });

  it("says nothing in the preamble, where nothing has been measured", () => {
    expect(codes("create_terrain SNOW { number_of_clumps 4 }\n<TERRAIN_GENERATION>\n")).not.toContain("RMS0304");
  });

  it("says nothing inside a section header it does not recognise", () => {
    expect(codes("<SOME_FUTURE_SECTION>\ncreate_terrain SNOW { number_of_clumps 4 }\n")).not.toContain("RMS0304");
  });

  it("stays silent after a degraded region, which may have swallowed a header", () => {
    // Sec.8's suppression rule. The gibberish parses to a RawNode, and the
    // parser's recovery scan absorbs a section header outright when only
    // conditionals are open — so a command after one cannot be trusted to be
    // in the section it appears to be in, and warning would report the
    // recovery as the author's mistake.
    const source = "<OBJECTS_GENERATION>\n!!! ??? %%%\ncreate_terrain SNOW { number_of_clumps 4 }\n";
    expect(codes(source)).not.toContain("RMS0304");
  });

  it("resumes at the next real header, which cannot have been swallowed", () => {
    const source =
      "<LAND_GENERATION>\n!!! ??? %%%\n<OBJECTS_GENERATION>\ncreate_terrain SNOW { number_of_clumps 4 }\n";
    expect(codes(source)).toContain("RMS0304");
  });
});

describe("RMS0305 — missing <PLAYER_SETUP>", () => {
  it("notes a sectioned script with no PLAYER_SETUP", () => {
    const found = only("<LAND_GENERATION>\ncreate_land { base_size 5 }\n", "RMS0305");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("says nothing when it is present, or when there are no sections at all", () => {
    expect(codes("<PLAYER_SETUP>\nrandom_placement\n")).not.toContain("RMS0305");
    expect(codes("#const TREES 10\n")).not.toContain("RMS0305");
  });
});

describe("RMS0306 — repeated non-repeatable attributes", () => {
  it("notes a second use of a non-cumulative attribute in one block", () => {
    const found = only("<LAND_GENERATION>\ncreate_land { base_size 5 base_size 7 }\n", "RMS0306");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("leaves cumulative attributes alone", () => {
    // replace_terrain carries repeatable:true and every corpus connection
    // block repeats it legally. Read the flag, never a name list.
    const source =
      "<CONNECTION_GENERATION>\ncreate_connect_all_players_land { replace_terrain GRASS DIRT replace_terrain DIRT SNOW }\n";
    expect(codes(source)).not.toContain("RMS0306");
  });

  it("does not count across exclusive conditional branches inside a block", () => {
    const source =
      "<LAND_GENERATION>\ncreate_land {\nif DEATH_MATCH\nbase_size 5\nelse\nbase_size 7\nendif\n}\n";
    expect(codes(source)).not.toContain("RMS0306");
  });
});

describe("messages that point at a second place in the file name a LINE", () => {
  // Reported from a real script: `"max_distance_to_players" is already set at
  // offset 86970`. A character offset is not a position any editor shows, so
  // the one actionable fact in the message — go look at the other one — was
  // unreachable. Spans stay offsets (Monaco and the ruler consume those); only
  // the prose converts.
  //
  // Every fixture here puts the referenced occurrence on a line whose number
  // differs from both its char offset and its 0-based index, so an offset
  // leaking back through, or a dropped `+ 1`, fails rather than coincidentally
  // matching.

  it("RMS0306 names the line of the earlier attribute, and says which value survives", () => {
    const source = [
      "<OBJECTS_GENERATION>", // 1
      "create_object SHEEP {", // 2
      "  number_of_objects 4", // 3
      "  max_distance_to_players 5", // 4
      "  min_distance_to_players 2", // 5
      "  max_distance_to_players 30", // 6
      "}",
      "",
    ].join("\n");
    const found = only(source, "RMS0306");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("already set on line 4");
    expect(found[0].message).toContain("the value here (the last one)");
    expect(found[0].message).not.toContain("offset");
    // Raised on the LATER use — the one the engine keeps — so the reader is
    // looking at the surviving value while the message names the dead one.
    expect(source.slice(found[0].span.start, found[0].span.end)).toBe("max_distance_to_players");
    expect(source.slice(0, found[0].span.start).split("\n")).toHaveLength(6);
  });

  it("RMS0301 names the line of the definition the engine keeps", () => {
    const source = ["/* header */", "", "#const TREE_COUNT 10", "#const TREE_COUNT 40", ""].join("\n");
    const found = only(source, "RMS0301");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("already defined on line 3");
    expect(found[0].message).not.toContain("offset");
  });

  it("RMS0303 names the line the definition finally arrives on", () => {
    const source = [
      "<TERRAIN_GENERATION>", // 1
      "create_terrain MY_TERRAIN", // 2
      "{", // 3
      "number_of_clumps 4", // 4
      "}", // 5
      "#const MY_TERRAIN 10", // 6
      "",
    ].join("\n");
    const found = only(source, "RMS0303");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("isn't defined until line 6");
    expect(found[0].message).not.toContain("offset");
  });

  it("RMS0313 names the line of the branch that already tested the label", () => {
    const source = [
      "#define ISLANDS", // 1
      "<PLAYER_SETUP>", // 2
      "if ISLANDS", // 3
      "random_placement", // 4
      "elseif DEATH_MATCH", // 5
      "random_placement", // 6
      "elseif ISLANDS", // 7
      "random_placement", // 8
      "endif",
      "",
    ].join("\n");
    const found = only(source, "RMS0313");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("already tested on line 3");
    expect(found[0].message).not.toContain("offset");
  });
});

describe("RMS0307 — mutually exclusive attributes", () => {
  it("flags a mutex pair in one block, exactly once", () => {
    const found = only("<LAND_GENERATION>\ncreate_land { land_percent 5 number_of_tiles 100 }\n", "RMS0307");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("accepts either one on its own", () => {
    expect(codes("<LAND_GENERATION>\ncreate_land { land_percent 5 }\n")).not.toContain("RMS0307");
  });

  it("claims no shared purpose the guide does not state", () => {
    // The old wording said a mutex pair "set the same thing two different
    // ways". False for the pair that produces most of this check's corpus
    // output: set_scale_by_size scales the tile count, set_scale_by_groups
    // scales the clump count. The guide says only that they are exclusive.
    const found = only("<LAND_GENERATION>\ncreate_land { land_percent 5 number_of_tiles 100 }\n", "RMS0307");
    expect(found[0].message).not.toContain("same thing");
    expect(found[0].message).toContain("mutually exclusive");
  });

  it("carries the guide's own consequence and fix where the data has one", () => {
    // guide:1662/1679 state what happens outright, which is what closed
    // parser-design Sec.11 verify item 21. It reaches the user via the
    // entry's mutexNote rather than a hardcoded string (vocabulary is data).
    const found = only(
      "<TERRAIN_GENERATION>\ncreate_terrain WATER { base_terrain GRASS set_scale_by_size set_scale_by_groups }\n",
      "RMS0307",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("Only the last of the two applies");
  });
});

describe("RMS0315 — an attribute whose guide 'Requires:' partner is absent", () => {
  // guide:2509 carries the Requires line, and what an unmet requirement DOES
  // was measured by RMSTEST_42 (2026-08-11, four runs): the attribute is inert
  // and the command places in full. The check keeps its trigger and lost its
  // consequence clause — it warned that the command placed nothing at all,
  // which was inferred from `AK_Namatjira.rms` spawning no shore fish, on a
  // command that also names a shallow its fish cannot occupy and so predicts
  // zero under either model.
  it("flags ignore_terrain_restrictions written on its own", () => {
    const found = only("<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { number_of_objects 10 ignore_terrain_restrictions }\n", "RMS0315");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("this line does nothing");
    // The consequence clause the measurement removed: the objects still place.
    expect(found[0].message).not.toContain("places nothing at all");
  });

  it("stays quiet with set_place_for_every_player", () => {
    expect(
      codes("<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { set_place_for_every_player number_of_objects 10 ignore_terrain_restrictions }\n"),
    ).not.toContain("RMS0315");
  });

  it("stays quiet with place_on_specific_land_id, the other half of the either/or", () => {
    expect(
      codes("<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { place_on_specific_land_id 3 number_of_objects 10 ignore_terrain_restrictions }\n"),
    ).not.toContain("RMS0315");
  });

  it("counts a partner written inside a conditional branch, unlike RMS0306/RMS0307", () => {
    // The scope difference is the whole correctness argument and it runs the
    // opposite way to the two checks next door. They ask "was this set twice",
    // where descending into branches false-warns on an ordinary if/else. This
    // asks "is the partner anywhere at all", and a partner in a branch is a
    // partner. Reporting it would rebuild the false-positive class BUG-002 and
    // BUG-005 each cost three rounds.
    const source =
      "<OBJECTS_GENERATION>\ncreate_object SHORE_FISH {\nignore_terrain_restrictions\nif DEATH_MATCH\nset_place_for_every_player\nendif\n}\n";
    expect(codes(source)).not.toContain("RMS0315");
  });

  it("names both partners, from the data rather than from the message", () => {
    const found = only("<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { ignore_terrain_restrictions }\n", "RMS0315");
    expect(found[0].message).toContain("set_place_for_every_player");
    expect(found[0].message).toContain("place_on_specific_land_id");
  });
});

describe("RMS0308 — percent_chance and rnd ranges", () => {
  // Both cumulative thresholds are 99, not 100 — guide:3006-3007 plus
  // guide:3010's "the 100th percent is never chosen". This shipped as 100
  // because Sec.8 used both numbers in one sentence.
  it("flags branches after the running total reaches 99", () => {
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 60 create_land { base_size 5 }\npercent_chance 40 create_land { base_size 6 }\npercent_chance 10 create_land { base_size 7 }\nend_random\n";
    const found = only(source, "RMS0308");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("never be picked");
  });

  it("flags a branch that starts at exactly 99 — the corpus has a live one", () => {
    // `TL Cape of Storms.rms` writes 45/54/1: the third branch begins at
    // cumulative 99 and can never run. At a threshold of 100 this was silent.
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 45 create_land { base_size 5 }\npercent_chance 54 create_land { base_size 6 }\npercent_chance 1 create_land { base_size 7 }\nend_random\n";
    const found = only(source, "RMS0308");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("never be picked");
  });

  it("says nothing about a total of exactly 99 — that is full coverage", () => {
    // `24hr_Mont Saint Michel.rms` has a 33/33/33 block. At a threshold of 100
    // it drew a false "there's a chance none of them runs".
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 33 create_land { base_size 5 }\npercent_chance 33 create_land { base_size 6 }\npercent_chance 33 create_land { base_size 7 }\nend_random\n";
    expect(only(source, "RMS0308")).toEqual([]);
  });

  it("notes a total under 99 as info, not a warning", () => {
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 30 create_land { base_size 5 }\nend_random\n";
    const found = only(source, "RMS0308");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("flags percent_chance 0 on the first branch", () => {
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance 0 create_land { base_size 5 }\npercent_chance 100 create_land { base_size 6 }\nend_random\n";
    expect(only(source, "RMS0308").some((d) => d.message.includes("runs it anyway"))).toBe(true);
  });

  it("makes no cumulative claim when a chance is not a literal", () => {
    const source = "<LAND_GENERATION>\nstart_random\npercent_chance rnd(1,50) create_land { base_size 5 }\npercent_chance 40 create_land { base_size 6 }\nend_random\n";
    expect(only(source, "RMS0308").some((d) => d.message.includes("never be picked"))).toBe(false);
  });

  it("separates a reversed rnd from a merely constant one", () => {
    const reversed = only("<LAND_GENERATION>\ncreate_land { base_size rnd(9,2) }\n", "RMS0308");
    expect(reversed).toHaveLength(1);
    expect(reversed[0].severity).toBe("warning");

    const constant = only("<LAND_GENERATION>\ncreate_land { base_size rnd(5,5) }\n", "RMS0308");
    expect(constant).toHaveLength(1);
    expect(constant[0].severity).toBe("info");
  });
});

describe("RMS0309 / RMS0310 — obsolete and non-functional syntax", () => {
  it("notes a deprecated command using the guidance from the data", () => {
    const found = only("<PLAYER_SETUP>\neffect_percent MOD_RESOURCE AMOUNT_STARTING_FOOD ATTR_ADD 50\n", "RMS0309");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
    expect(found[0].message).toContain("effect_amount");
  });

  it("names the working attribute behind a dead engine string", () => {
    // min_distance is in the exe's string table with nothing behind it
    // (guide, Non-Functional Syntax). Before it had an entry it drew a bare
    // "unknown attribute" — wrong, since the engine does carry the word, and
    // useless, since it named nothing to use instead.
    const source = "<OBJECTS_GENERATION>\ncreate_object GOLD { min_distance 5 }\n";
    const found = only(source, "RMS0310");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
    expect(found[0].suggestion).toBe("min_distance_to_players");
    // And it must no longer be reported as an unknown name.
    expect(parseRms(source, lang).diagnostics.map((d) => d.code)).not.toContain("RMS0200");
  });

  it("covers all four dead strings, each naming its own replacement", () => {
    const cases: [string, string][] = [
      ["<OBJECTS_GENERATION>\ncreate_object GOLD { max_distance 5 }\n", "max_distance_to_players"],
      ["<LAND_GENERATION>\ncreate_land { set_position 50 50 }\n", "land_position"],
      ["<LAND_GENERATION>\ncreate_land { percent_of_land 20 }\n", "land_percent"],
    ];
    for (const [source, replacement] of cases) {
      const found = only(source, "RMS0310");
      expect(found, source).toHaveLength(1);
      expect(found[0].suggestion, source).toBe(replacement);
    }
  });

  it("notes #undefine, which the engine accepts and ignores", () => {
    const found = only("#define ALPHA\n#undefine ALPHA\n", "RMS0310");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
  });

  it("keeps the #undefine'd symbol defined — it is a no-op in DE", () => {
    const source = "#define ALPHA\n#undefine ALPHA\n<PLAYER_SETUP>\nif ALPHA\nrandom_placement\nendif\n";
    expect(codes(source)).not.toContain("RMS0300");
  });
});

describe("RMS0311 — base_elevation without <ELEVATION_GENERATION>", () => {
  it("is an error, and the only one this pass raises", () => {
    const found = only("<LAND_GENERATION>\ncreate_land { base_elevation 4 }\n", "RMS0311");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
  });

  it("reports once per file, not once per use", () => {
    const source = "<LAND_GENERATION>\ncreate_land { base_elevation 4 }\ncreate_land { base_elevation 6 }\n";
    expect(only(source, "RMS0311")).toHaveLength(1);
  });

  it("is satisfied by an empty section — presence is the whole requirement", () => {
    const source = "<LAND_GENERATION>\ncreate_land { base_elevation 4 }\n<ELEVATION_GENERATION>\n";
    expect(codes(source)).not.toContain("RMS0311");
  });
});

describe("RMS0204 / RMS0205 — constant IDs and categories", () => {
  it("names the constant behind a bare ID", () => {
    const found = only("<TERRAIN_GENERATION>\ncreate_terrain 10 { number_of_clumps 4 }\n", "RMS0204");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("info");
    expect(found[0].suggestion).toBe("FOREST");
  });

  it("says nothing about an ID it cannot resolve", () => {
    // The constants DB holds 31 of the game's several hundred; "use a named
    // constant" is useless advice when we can't supply the name.
    expect(codes("<TERRAIN_GENERATION>\ncreate_terrain 987 { number_of_clumps 4 }\n")).not.toContain("RMS0204");
  });

  it("flags an object constant in a terrain slot", () => {
    const found = only("<TERRAIN_GENERATION>\ncreate_terrain GOLD { number_of_clumps 4 }\n", "RMS0205");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });

  it("accepts a terrain constant in a terrain slot", () => {
    expect(codes("<TERRAIN_GENERATION>\ncreate_terrain SNOW { number_of_clumps 4 }\n")).not.toContain("RMS0205");
  });
});

describe("pass-level guarantees", () => {
  it("returns diagnostics sorted by source position", () => {
    const source = "#const TREES 10\n#const TREES 20\n<LAND_GENERATION>\ncreate_land { land_percent 5 number_of_tiles 9 }\n";
    const found = check(source);
    expect(found.length).toBeGreaterThan(1);
    const starts = found.map((d) => d.span.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("never throws on degenerate input", () => {
    for (const source of ["", "   ", "}}}", "<PLAYER_SETUP>", "if\nendif", "#const", "start_random"]) {
      expect(() => check(source)).not.toThrow();
    }
  });

  it("reports nothing at all for a clean script", () => {
    const source = [
      "#const TREE_COUNT 40",
      "<PLAYER_SETUP>",
      "random_placement",
      "<LAND_GENERATION>",
      "base_terrain GRASS",
      "create_player_lands { terrain_type GRASS land_percent 60 }",
      "<ELEVATION_GENERATION>",
      "<CLIFF_GENERATION>",
      "<TERRAIN_GENERATION>",
      "create_terrain FOREST { base_terrain GRASS land_percent 10 number_of_clumps TREE_COUNT }",
      "<CONNECTION_GENERATION>",
      "<OBJECTS_GENERATION>",
      "create_object GOLD { number_of_objects 5 }",
      "",
    ].join("\n");
    expect(check(source)).toEqual([]);
  });
});

describe("RMS0111 — a word inside a comment that the engine reads as an opening comment marker", () => {
  // Measured by RMSTEST_55/56a/57/60 (parser-design Sec.2.1 amendment): a
  // leading comment containing a word valued 69 blanks the map, while the bare
  // literal 69 does not. Reported rather than modelled — decided 2026-08-11.
  it("flags an object constant valued 69", () => {
    const found = only("/* place SHORE_FISH here */\n<PLAYER_SETUP>\nrandom_placement\n", "RMS0111");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("SHORE_FISH");
    expect(found[0].message).toContain("invisible to the game");
  });

  it("flags an ATTRIBUTE constant valued 69 too — the namespace is irrelevant, the VALUE is the rule", () => {
    const found = only("/* tweak ATTR_PROJECTILE_ARC later */\n<PLAYER_SETUP>\nrandom_placement\n", "RMS0111");
    expect(found).toHaveLength(1);
  });

  it("stays silent on the bare literal 69 — RMSTEST_57 generated a normal map", () => {
    // Numeric literals are lexed as numbers and never reach the symbol table.
    expect(codes("/* about 69 tiles */\n<PLAYER_SETUP>\nrandom_placement\n")).not.toContain("RMS0111");
  });

  it("stays silent when the same word is real code rather than a comment", () => {
    expect(codes("<OBJECTS_GENERATION>\ncreate_object SHORE_FISH { number_of_objects 5 }\n")).not.toContain("RMS0111");
  });

  it("flags the script's own #const valued 69", () => {
    const found = only("#const MY_FISH 69\n/* MY_FISH goes in the bay */\n<PLAYER_SETUP>\nrandom_placement\n", "RMS0111");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("this script defines it as 69");
  });

  it("reports only the FIRST hit — everything after it is inside the engine's nested comment", () => {
    const source = "/* SHORE_FISH here */\n/* and ATTR_PROJECTILE_ARC there */\n<PLAYER_SETUP>\nrandom_placement\n";
    expect(only(source, "RMS0111")).toHaveLength(1);
  });
});
