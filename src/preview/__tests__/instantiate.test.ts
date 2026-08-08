import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex, type LanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { instantiateScript } from "../generator/instantiate";
import { createSubstream, nextInt } from "../generator/rng";
import type { InstantiatedScript } from "../generator/types";
import { DEFAULT_TEAMS, type MapSize, type TeamNumber } from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const refDb: LanguageIndex = buildLanguageIndex(lang);

function settings(overrides: { playerCount?: number; mapSize?: MapSize; teams?: readonly TeamNumber[] } = {}) {
  return {
    playerCount: overrides.playerCount ?? 8,
    mapSize: overrides.mapSize ?? "Normal",
    teams: overrides.teams ?? DEFAULT_TEAMS,
  };
}

function run(
  source: string,
  seed = 1,
  overrides?: Parameters<typeof settings>[0],
  db: LanguageIndex = refDb,
): InstantiatedScript {
  return instantiateScript(parseRms(source, lang), db, settings(overrides), seed);
}

/** Flattened commands across every instantiated section, in canonical order. */
function commandNames(result: InstantiatedScript): string[] {
  const names: string[] = [];
  for (const cmds of result.sections.values()) for (const cmd of cmds) names.push(cmd.name);
  return names;
}

describe("Sec.3 rule 1: environment", () => {
  it("sets both the legacy and modern label for the active map size, and no other size's labels", () => {
    const source = [
      "<PLAYER_SETUP>",
      "if LARGE_MAP",
      "direct_placement",
      "endif",
      "if MAPSIZE_NORMAL",
      "random_placement",
      "endif",
      "if HUGE_MAP",
      "nomad_resources",
      "endif",
    ].join("\n");
    const names = commandNames(run(source, 1, { mapSize: "Normal" }));
    expect(names).toContain("direct_placement");
    expect(names).toContain("random_placement");
    expect(names).not.toContain("nomad_resources");
  });

  it("sets <playerCount>_PLAYER_GAME for the active player count only", () => {
    const source = "<PLAYER_SETUP>\nif 4_PLAYER_GAME\ndirect_placement\nendif\nif 8_PLAYER_GAME\nrandom_placement\nendif\n";
    const names = commandNames(run(source, 1, { playerCount: 4 }));
    expect(names).toContain("direct_placement");
    expect(names).not.toContain("random_placement");
  });

  it("sets RANDOM_MAP, DE_AVAILABLE, DE_GAME_AGE2 — standard-lobby defaults for the rest", () => {
    const source = [
      "<PLAYER_SETUP>",
      "if RANDOM_MAP",
      "direct_placement",
      "endif",
      "if DE_AVAILABLE",
      "random_placement",
      "endif",
      "if DE_GAME_AGE2",
      "grouped_by_team",
      "endif",
      "if REGICIDE",
      "nomad_resources",
      "endif",
      "if DE_GAME_ROME",
      "override_map_size 100",
      "endif",
      "if UP_AVAILABLE",
      "override_map_size 200",
      "endif",
    ].join("\n");
    const names = commandNames(run(source));
    expect(names).toEqual(expect.arrayContaining(["direct_placement", "random_placement", "grouped_by_team"]));
    expect(names).not.toContain("nomad_resources");
    expect(names.filter((n) => n === "override_map_size")).toHaveLength(0);
  });

  it("defines team labels through the canonical model, not the picker's raw numbers", () => {
    // Player 1 picks team 3, player 2 picks team 3 too -> canonical team 1
    // (lowest player number in the surviving group), per teamModel.ts.
    const teams: TeamNumber[] = [3, 3, 0, 0, 0, 0, 0, 0];
    const source = "<PLAYER_SETUP>\nif PLAYER1_TEAM1\ndirect_placement\nendif\nif PLAYER1_TEAM3\nrandom_placement\nendif\n";
    const names = commandNames(run(source, 1, { playerCount: 2, teams }));
    expect(names).toContain("direct_placement");
    expect(names).not.toContain("random_placement");
  });

  it("falls back to a default dim and warns when predefinedLabels is empty", () => {
    const noLabels = buildLanguageIndex({ ...lang, predefinedLabels: [] });
    const result = instantiateScript(parseRms("<PLAYER_SETUP>\n", lang), noLabels, settings(), 1);
    expect(result.dim).toBe(200);
    expect(result.notes.map((n) => n.key)).toContain("labels");
    expect(result.notes.find((n) => n.key === "labels")?.prominence).toBe("banner");
  });

  it("resolves dim from the mapSize/dimensions join, not a hardcoded table", () => {
    expect(run("<PLAYER_SETUP>\n", 1, { mapSize: "Tiny" }).dim).toBe(120);
    expect(run("<PLAYER_SETUP>\n", 1, { mapSize: "Giant" }).dim).toBe(252);
  });
});

describe("Sec.3 rule 2: if/elseif/else", () => {
  it("selects the first branch whose label is defined", () => {
    const source = "<PLAYER_SETUP>\nif NOT_A_REAL_LABEL\ndirect_placement\nelseif RANDOM_MAP\nrandom_placement\nelse\nnomad_resources\nendif\n";
    expect(commandNames(run(source))).toEqual(["random_placement"]);
  });

  it("falls through to else when nothing else matches", () => {
    const source = "<PLAYER_SETUP>\nif NOT_A_REAL_LABEL\ndirect_placement\nelse\nnomad_resources\nendif\n";
    expect(commandNames(run(source))).toEqual(["nomad_resources"]);
  });

  it("takes no branch (and instantiates nothing) when there is no else and nothing matches", () => {
    const source = "<PLAYER_SETUP>\nif NOT_A_REAL_LABEL\ndirect_placement\nendif\nrandom_placement\n";
    expect(commandNames(run(source))).toEqual(["random_placement"]);
  });

  it("a #define'd flag participates in the environment (rule 4 feeding rule 2)", () => {
    const source = "#define MY_FLAG\n<PLAYER_SETUP>\nif MY_FLAG\ndirect_placement\nendif\n";
    expect(commandNames(run(source))).toEqual(["direct_placement"]);
  });
});

describe("Sec.3 rule 3: start_random / percent_chance", () => {
  function expectedRoll(seed: number, ordinal: number): number {
    return nextInt(createSubstream(seed, "S0", ordinal), 1, 100);
  }

  it("is deterministic for a given seed, and matches the same S0/ordinal-0 substream math as rng.ts", () => {
    const source = "<PLAYER_SETUP>\nstart_random\npercent_chance 50\ndirect_placement\npercent_chance 50\nrandom_placement\nend_random\n";
    for (const seed of [1, 2, 3, 42, 999]) {
      const roll = expectedRoll(seed, 0);
      const names = commandNames(run(source, seed));
      if (roll <= 50) expect(names).toEqual(["direct_placement"]);
      else expect(names).toEqual(["random_placement"]);
    }
  });

  it("truncates at 99 — the 100th percent (and beyond) is never chosen even when branches sum past 100", () => {
    // Sweep seeds until we find one whose roll lands on 100 (guaranteed to
    // exist since nextInt is uniform over a 100-wide range).
    let seed = 0;
    while (expectedRoll(seed, 0) !== 100) seed++;
    const source = "<PLAYER_SETUP>\nstart_random\npercent_chance 60\ndirect_placement\npercent_chance 60\nrandom_placement\nend_random\n";
    expect(commandNames(run(source, seed))).toEqual([]);
  });

  it("two start_random nodes in one script draw from independent substreams (ordinal, not shared state)", () => {
    const source = [
      "<PLAYER_SETUP>",
      "start_random",
      "percent_chance 50",
      "direct_placement",
      "percent_chance 50",
      "random_placement",
      "end_random",
      "start_random",
      "percent_chance 50",
      "grouped_by_team",
      "percent_chance 50",
      "nomad_resources",
      "end_random",
    ].join("\n");
    const seed = 1;
    const names = commandNames(run(source, seed));
    const firstPick = expectedRoll(seed, 0) <= 50 ? "direct_placement" : "random_placement";
    const secondPick = expectedRoll(seed, 1) <= 50 ? "grouped_by_team" : "nomad_resources";
    expect(names).toEqual([firstPick, secondPick]);
  });
});

describe("Sec.3 rule 4: #define / #const / #undefine", () => {
  it("#const first-definition-wins: a later #const of the same name is a silent no-op", () => {
    // Both values chosen inside override_map_size's legal 36-480 range and
    // far apart, so a broken "last write wins" implementation is caught
    // rather than coincidentally agreeing after clamping.
    const source = "#const N 60\n#const N 200\n<PLAYER_SETUP>\noverride_map_size N\n";
    expect(run(source).dim).toBe(60);
  });

  it("#const aliasing another constant resolves through the growing symbol table", () => {
    const source = "#const BASE 40\n#const ALIAS BASE\n<PLAYER_SETUP>\noverride_map_size ALIAS\n";
    expect(run(source).dim).toBe(40);
  });

  it("#undefine does nothing — the name stays defined", () => {
    const source = "#define MY_FLAG\n#undefine MY_FLAG\n<PLAYER_SETUP>\nif MY_FLAG\ndirect_placement\nendif\n";
    expect(commandNames(run(source))).toEqual(["direct_placement"]);
  });

  it("an unresolved constant in a numeric slot is passed through as its raw name, not silently dropped", () => {
    const source = "<PLAYER_SETUP>\noverride_map_size TOTALLY_UNDEFINED\n";
    const result = run(source);
    const cmd = result.sections.get("PLAYER_SETUP")?.[0];
    expect(cmd?.args[0]?.value).toBe("TOTALLY_UNDEFINED");
    expect(result.dim).toBe(200); // override never applied since it never resolved to a number
  });
});

describe("Sec.3 rule 5: rnd(a,b)", () => {
  it("evaluates rnd() from its own S0 substream, deterministically", () => {
    const source = "<PLAYER_SETUP>\noverride_map_size rnd(100,200)\n";
    for (const seed of [1, 7, 99]) {
      const expected = nextInt(createSubstream(seed, "S0", 0), 100, 200);
      expect(run(source, seed).dim).toBe(expected);
    }
  });
});

describe("Sec.3 rule 6: math expressions", () => {
  it("evaluates left-to-right per parser-design Sec.2.2", () => {
    const source = "<PLAYER_SETUP>\noverride_map_size (100 + 50)\n";
    expect(run(source).dim).toBe(150);
  });

  it("rounds 0.5 up only when the result lands in a numeric slot (base_size, integer)", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nbase_size (10 / 4)\n}\n";
    const result = run(source);
    const cmd = result.sections.get("LAND_GENERATION")?.[0];
    const baseSize = cmd?.attributes.get("base_size")?.[0]?.args[0]?.value;
    expect(baseSize).toBe(3); // 2.5 -> 3
  });

  it("drops a nested-paren operand exactly like mathEval's own contract", () => {
    const source = "#const GOLD_COUNT 6\n<PLAYER_SETUP>\noverride_map_size (GOLD_COUNT + (5 + 2))\n";
    expect(run(source).dim).toBe(36); // (6+2)=8, clamped up to the 36 floor
  });
});

describe("Sec.3 rule 7: behavior_version stream state", () => {
  it("tags every command instantiated afterward with the current behavior_version", () => {
    const source = "<PLAYER_SETUP>\nbehavior_version 1\ndirect_placement\n<LAND_GENERATION>\ncreate_land {\nbase_size 5\n}\n";
    const result = run(source);
    const land = result.sections.get("LAND_GENERATION")?.[0];
    expect(land?.behaviorVersion).toBe(1);
  });

  it("defaults to 0 before any behavior_version command", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nbase_size 5\n}\n";
    expect(run(source).sections.get("LAND_GENERATION")?.[0]?.behaviorVersion).toBe(0);
  });

  it("treats version 2 as version 1 and notes it", () => {
    const source = "<PLAYER_SETUP>\nbehavior_version 2\n<LAND_GENERATION>\ncreate_land {\nbase_size 5\n}\n";
    const result = run(source);
    expect(result.sections.get("LAND_GENERATION")?.[0]?.behaviorVersion).toBe(1);
    expect(result.notes.some((n) => n.key.startsWith("behaviorVersion2:"))).toBe(true);
  });
});

describe("Sec.3 rule 8: override_map_size", () => {
  it("applies when set before the first land command, and clamps to [36, 480]", () => {
    expect(run("<PLAYER_SETUP>\noverride_map_size 100\n").dim).toBe(100);
    expect(run("<PLAYER_SETUP>\noverride_map_size 10\n").dim).toBe(36);
    expect(run("<PLAYER_SETUP>\noverride_map_size 9000\n").dim).toBe(480);
  });

  it("is ignored, with a note, once a land command has been instantiated", () => {
    const source = [
      "<PLAYER_SETUP>",
      "override_map_size 100",
      "<LAND_GENERATION>",
      "create_land {\nbase_size 3\n}",
      "override_map_size 300",
    ].join("\n");
    const result = run(source);
    expect(result.dim).toBe(100);
    expect(result.notes.some((n) => n.key.startsWith("overrideMapSizeLate:"))).toBe(true);
  });

  it("only the dim from the lobby's mapSize is used when no override is present", () => {
    expect(run("<PLAYER_SETUP>\n", 1, { mapSize: "Small" }).dim).toBe(144);
  });
});

describe("Sec.3 rule 9: unknown commands and includes", () => {
  it("skips an unknown command and notes it, rather than instantiating or crashing on it", () => {
    const source = "<PLAYER_SETUP>\ntotally_not_a_real_command 1 2 3\ndirect_placement\n";
    const result = run(source);
    expect(commandNames(result)).toEqual(["direct_placement"]);
    expect(result.notes.some((n) => n.prominence === "drawer" && n.key.startsWith("unsimulated:"))).toBe(true);
  });

  it("emits one deduplicated banner note for #include_drs, however many times it appears", () => {
    const source = '<PLAYER_SETUP>\n#include_drs "a.inc"\n#include_drs "b.inc"\n';
    const result = run(source);
    const includeNotes = result.notes.filter((n) => n.key === "includes");
    expect(includeNotes).toHaveLength(1);
    expect(includeNotes[0].prominence).toBe("banner");
  });
});

describe("Sec.3 rule 10: duplicate attributes", () => {
  it("last-wins for a non-repeatable attribute", () => {
    const source = "<LAND_GENERATION>\ncreate_land {\nzone 1\nzone 2\n}\n";
    const result = run(source);
    const zone = result.sections.get("LAND_GENERATION")?.[0]?.attributes.get("zone");
    expect(zone).toHaveLength(1);
    expect(zone?.[0]?.args[0]?.value).toBe(2);
  });

  it("accumulates for an attribute language.json flags repeatable (add_object)", () => {
    const source = "<OBJECTS_GENERATION>\ncreate_object_group GOLD {\nadd_object GOLD 50\nadd_object STONE 50\n}\n";
    const result = run(source);
    const group = result.sections.get("OBJECTS_GENERATION")?.[0];
    const addObject = group?.attributes.get("add_object");
    expect(addObject).toHaveLength(2);
    expect(addObject?.map((a) => a.args[0]?.value)).toEqual(["GOLD", "STONE"]);
  });
});

describe("Sec.3 rule 11: section merge + canonical order", () => {
  it("merges two same-named sections into one command list", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\ncreate_land {\nbase_size 3\n}\n<PLAYER_SETUP>\nrandom_placement\n";
    const result = run(source);
    const playerSetup = result.sections.get("PLAYER_SETUP") ?? [];
    expect(playerSetup.map((c) => c.name)).toEqual(["direct_placement", "random_placement"]);
  });

  it("processes sections in canonical engine order regardless of file order", () => {
    const source = "<OBJECTS_GENERATION>\ncreate_actor_area 1 1 1 1\n<PLAYER_SETUP>\ndirect_placement\n";
    const result = run(source);
    const order = Array.from(result.sections.keys());
    expect(order.indexOf("PLAYER_SETUP")).toBeLessThan(order.indexOf("OBJECTS_GENERATION"));
  });

  it("keeps an unrecognized section name, placed after the canonical seven", () => {
    const source = "<TOTALLY_MADE_UP>\ndirect_placement\n<PLAYER_SETUP>\nrandom_placement\n";
    const result = run(source);
    const order = Array.from(result.sections.keys());
    expect(order.indexOf("PLAYER_SETUP")).toBeLessThan(order.indexOf("TOTALLY_MADE_UP"));
    expect(result.sections.get("TOTALLY_MADE_UP")?.map((c) => c.name)).toEqual(["direct_placement"]);
  });
});

describe("Sec.3 rule 12: object groups and actor areas", () => {
  it("collects a create_object_group by its type name", () => {
    const source = "<OBJECTS_GENERATION>\ncreate_object_group FOREST_MIX {\nadd_object OAK_TREE 100\n}\n";
    const result = run(source);
    expect(result.objectGroups.has("FOREST_MIX")).toBe(true);
    expect(result.objectGroups.get("FOREST_MIX")?.attributes.get("add_object")).toHaveLength(1);
  });

  it("collects multiple create_actor_area commands sharing one identifier", () => {
    const source = "<OBJECTS_GENERATION>\ncreate_actor_area 1 1 7 3\ncreate_actor_area 2 2 7 4\n";
    const result = run(source);
    expect(result.actorAreas.get(7)).toHaveLength(2);
  });
});

describe("PLAYER_SETUP stream state (Sec.3 rule 11's parenthetical)", () => {
  it("folds direct_placement/random_placement/grouped_by_team/nomad_resources into playerSetup", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\ngrouped_by_team\nnomad_resources\n";
    const result = run(source);
    expect(result.playerSetup).toEqual({
      directPlacement: true,
      randomPlacement: false,
      groupedByTeam: true,
      nomadResources: true,
    });
  });
});

describe("teams (Sec.3.1)", () => {
  it("exposes the same canonicalisation generationSettings/teamModel.ts computes", () => {
    const teams: TeamNumber[] = [1, 1, 2, 2, 0, 0, 0, 0];
    const result = run("<PLAYER_SETUP>\n", 1, { playerCount: 4, teams });
    expect(result.teams.teamCount).toBe(2);
    expect(result.teams.canonical).toEqual([1, 1, 2, 2]);
  });
});

// Corpus smoke gate, mirroring src/parser/__tests__/corpus.test.ts's
// no-throw tier: "never crash" (CLAUDE.md hard rule) has to hold over real,
// messy, sometimes-invalid maps, not just the hand-written fixtures above.
// This does not assert anything about the RESULT (no reference `.rms` file
// has been triaged against Sec.3's rules by hand) — only that instantiating
// it, at several player counts/map sizes/seeds, never throws.
function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);
}

const MAPS_DIR = join(REPO_ROOT, "test-maps");
const LOCAL_DIR = join(MAPS_DIR, "local");
const corpusMaps = [
  ...listRms(MAPS_DIR).map((name) => ({ name, path: join(MAPS_DIR, name) })),
  ...listRms(LOCAL_DIR).map((name) => ({ name: `local/${name}`, path: join(LOCAL_DIR, name) })),
];

describe("corpus: instantiateScript never throws", () => {
  it("found the corpus", () => {
    expect(corpusMaps.length).toBeGreaterThan(0);
  });

  for (const map of corpusMaps) {
    it(map.name, () => {
      const source = readFileSync(map.path, "utf8");
      const parsed = parseRms(source, lang);
      for (const [playerCount, mapSize] of [
        [2, "Tiny"],
        [8, "Normal"],
        [4, "Giant"],
      ] as const) {
        const result = instantiateScript(parsed, refDb, settings({ playerCount, mapSize }), 12345);
        expect(result.dim).toBeGreaterThan(0);
      }
    });
  }
});
