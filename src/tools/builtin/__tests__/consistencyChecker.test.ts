// End-to-end smoke tests for the assembled ToolImplementation
// (consistency-checker-design.md Sec.4.1's loop, Sec.6's manifest). Exercises
// the real lifecycle: progress -> partial -> result, cancellation, and a
// staticOnly fast pass — mirroring tools-api-design.md Sec.9's own lifecycle
// list rather than re-deriving it.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import { resolveMapDim } from "../../../preview/generator/mapDimensions";
import { DEFAULT_TEAMS } from "../../../generationSettings/generationSettingsConstants";
import type { ParseResult } from "../../../parser/types";
import { TOOLS_API_VERSION, type PublishedGameConstants, type ToolContext, type ToolMessage } from "../../../../tools-api/index";
import { validateManifest, validateToolMessage } from "../../protocol";
import { checkRegistry } from "../../registry";
import {
  consistencyChecker,
  DEFAULT_PLAYER_COUNTS,
  DEFAULT_RUNS_PER_PLAYER_COUNT,
  MAX_GENERATIONS_CEILING,
  MAX_RUNS_PER_PLAYER_COUNT,
} from "../consistencyChecker";

const lang = loadLanguage();
const gameConstants = (
  JSON.parse(readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8")) as { constants: PublishedGameConstants }
).constants;

const SCRIPT = `
<PLAYER_SETUP>
  random_placement
<LAND_GENERATION>
  base_terrain GRASS
  create_player_lands { terrain_type GRASS land_percent 20 }
<OBJECTS_GENERATION>
  create_object GOLD { number_of_objects 3 min_distance_to_players 5 max_distance_to_players 15 }
  create_object DEER { actor_area_to_place_in 999 }
`;

function context(overrides: Partial<{ playerCount: number; params: Record<string, unknown> }> = {}): ToolContext<ParseResult> {
  const name = "Tiny";
  const tiles = resolveMapDim(name as never, lang.predefinedLabels ?? []) ?? 0;
  return {
    apiVersion: TOOLS_API_VERSION,
    parseResult: parseRms(SCRIPT, lang),
    source: SCRIPT,
    settings: {
      playerCount: overrides.playerCount ?? 4,
      mapSize: { name, tiles },
      teams: [...DEFAULT_TEAMS],
    },
    referenceData: { language: lang, gameConstants },
    params: { playerCounts: ["2", "4"], runsPerPlayerCount: 5, baseSeed: 1, staticOnly: false, ...overrides.params },
  };
}

function collect(ctxOverrides: Partial<{ playerCount: number; params: Record<string, unknown> }> = {}): Promise<ToolMessage[]> {
  return new Promise((resolve) => {
    const messages: ToolMessage[] = [];
    const handle = consistencyChecker.run(context(ctxOverrides), (msg) => {
      messages.push(msg);
      if (msg.type === "result" || msg.type === "error") resolve(messages);
    });
    void handle;
  });
}

describe("consistencyChecker manifest", () => {
  it("passes registration validation on its own", () => {
    expect(validateManifest(consistencyChecker.manifest)).toEqual([]);
  });

  it("declares exactly the four capabilities tools-api-design.md Sec.6 pins by name", () => {
    expect(consistencyChecker.manifest.capabilities.sort()).toEqual(["read-ast", "read-generation-settings", "read-reference", "read-source"].sort());
  });

  it("declares ownsSettingsHeader — Sec.5.2's echo-suppression flag", () => {
    expect(consistencyChecker.manifest.ownsSettingsHeader).toBe(true);
  });
});

describe("consistencyChecker.run — lifecycle", () => {
  it("emits progress, then a result, and the result carries the summary header and the finding tables", async () => {
    const messages = await collect();
    expect(messages.some((m) => m.type === "progress")).toBe(true);
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    if (result?.type !== "result") return;
    expect(result.output.blocks.length).toBeGreaterThan(0);
    expect(result.output.blocks[0]).toMatchObject({ kind: "keyValue" });
  });

  it("emits a partial after the FIRST player count's batch, before the last", async () => {
    const messages = await collect();
    const partials = messages.filter((m) => m.type === "partial");
    // 2 selected counts -> exactly ONE partial (after count 1, none after the last).
    expect(partials).toHaveLength(1);
  });

  it("staticOnly: true skips the Monte Carlo layer entirely — no partials, no generation progress", async () => {
    const messages = await collect({ params: { staticOnly: true } });
    expect(messages.filter((m) => m.type === "partial")).toHaveLength(0);
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    // Static findings still ran: the undeclared actor_area_to_place_in in
    // SCRIPT should surface as a severity block even with no generation.
    if (result?.type !== "result") return;
    expect(result.output.blocks.some((b) => b.kind === "severity" && b.level === "error")).toBe(true);
  });

  it("cancel() stops the run and emits a cancelled error rather than a result", async () => {
    const messages: ToolMessage[] = [];
    await new Promise<void>((resolve) => {
      const handle = consistencyChecker.run(context({ params: { runsPerPlayerCount: 200, playerCounts: ["2", "4", "6", "8"] } }), (msg) => {
        messages.push(msg);
        if (msg.type === "error" || msg.type === "result") resolve();
      });
      // Cancel almost immediately — before the run could plausibly finish 800 generations.
      setTimeout(() => handle.cancel(), 5);
    });
    const last = messages[messages.length - 1];
    expect(last).toMatchObject({ type: "error", reason: "cancelled" });
  });

  it("host-error when the host did not provide what this tool declared it needs", async () => {
    const messages: ToolMessage[] = [];
    const ctx = context();
    delete ctx.referenceData;
    await new Promise<void>((resolve) => {
      consistencyChecker.run(ctx, (msg) => {
        messages.push(msg);
        if (msg.type === "error") resolve();
      });
    });
    expect(messages[0]).toMatchObject({ type: "error", reason: "host-error" });
  });

  it("the fixture's ONE undeclared actor area is ONE finding, not one per player count", async () => {
    // The predecessor assertion was `toBeGreaterThan(0)` and passed on the
    // defect: the fixture runs at 2 and 4 players, Sec.3.0 rule 1 runs the
    // static layer once per count, and the one actor-area error was emitted
    // TWICE. Scaled to `Pa_Site_v1.1.rms` that is 1024 blocks against
    // LIMITS.maxBlocksPerOutput's 1000, and the host rejects the whole run.
    //
    // Assert the FINDING COUNT, not the block count. A family of two
    // renders as one `severity` plus a two-row `table` (Sec.5.1), so a
    // severity-block count of 1 is green in BOTH worlds — which is exactly
    // the "unit" confusion the finding was about, reappearing in its own
    // regression test.
    const messages = await collect({ params: { staticOnly: true } });
    const result = messages.find((m) => m.type === "result");
    if (result?.type !== "result") throw new Error("no result");
    const errorBlocks = result.output.blocks.filter((b) => b.kind === "severity" && b.level === "error");
    expect(errorBlocks).toHaveLength(1);
    // One finding => a family of one => no table beside it.
    expect(result.output.blocks.filter((b) => b.kind === "table")).toHaveLength(0);
    // And the count is not written into the sentence.
    const only = errorBlocks[0];
    if (only.kind !== "severity") throw new Error("not a severity block");
    expect(only.text).not.toMatch(/At \d+/);
  });

  it("every output it emits validates against the host's own protocol, block cap included", async () => {
    // B1 was not a near-miss: `validateToolMessage` REJECTED the result and
    // `host.ts` killed the run, so the user got nothing at all. The tool's
    // own suite must check the thing the host checks.
    const messages = await collect();
    for (const msg of messages) {
      const check = validateToolMessage(msg);
      expect(check.ok, check.ok ? "" : `${msg.type}: ${check.problem}`).toBe(true);
    }
  });

  // Sec.5.1's block-cap gate. The fixture script is far too small to reach
  // `LIMITS.maxBlocksPerOutput`, and the defect that motivated this rule was
  // only ever visible on a real map: `Pa_Site_v1.1.rms` at 1026 blocks. So
  // this walks the corpus ON DISK rather than naming a map — a clone has 11
  // top-level `.rms` files and a maintainer's disk has 32, and neither run
  // ENOENTs (CLAUDE.md's corpus rule). `staticOnly` keeps it to one AST pass
  // per player count per map, which is where every block in the population
  // comes from anyway.
  describe("corpus: the static pass's output stays inside the host's block cap", () => {
    const mapNames = readdirSync(join(REPO_ROOT, "test-maps"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".rms"))
      .map((entry) => entry.name)
      .sort();

    it(`finds maps to check (${mapNames.length})`, () => {
      // A control that cannot come back zero: an empty corpus would make
      // every assertion below vacuous and green.
      expect(mapNames.length).toBeGreaterThan(0);
    });

    for (const mapName of mapNames) {
      it(`${mapName} produces an output the protocol accepts`, async () => {
        const source = readFileSync(join(REPO_ROOT, "test-maps", mapName), "utf8");
        const mapSizeName = "Normal";
        const ctx: ToolContext<ParseResult> = {
          apiVersion: TOOLS_API_VERSION,
          parseResult: parseRms(source, lang),
          source,
          settings: {
            playerCount: 4,
            mapSize: { name: mapSizeName, tiles: resolveMapDim(mapSizeName as never, lang.predefinedLabels ?? []) ?? 0 },
            teams: [...DEFAULT_TEAMS],
          },
          referenceData: { language: lang, gameConstants },
          params: { playerCounts: ["2", "4", "6", "8"], runsPerPlayerCount: 5, baseSeed: 1, staticOnly: true },
        };
        const result = await new Promise<ToolMessage>((resolve) => {
          consistencyChecker.run(ctx, (msg) => {
            if (msg.type === "result" || msg.type === "error") resolve(msg);
          });
        });
        expect(result.type).toBe("result");
        const check = validateToolMessage(result);
        expect(check.ok, check.ok ? "" : check.problem).toBe(true);
      });
    }
  });

  it("a malformed settings block is an error, not a confident empty report over 'Total generations 60'", async () => {
    const ctx = context();
    ctx.settings = { ...ctx.settings!, mapSize: { name: "Enormous Nonsense", tiles: 0 } };
    const messages: ToolMessage[] = [];
    await new Promise<void>((resolve) => {
      consistencyChecker.run(ctx, (msg) => {
        messages.push(msg);
        if (msg.type === "error" || msg.type === "result") resolve();
      });
    });
    expect(messages.some((m) => m.type === "result")).toBe(false);
    expect(messages[messages.length - 1]).toMatchObject({ type: "error", reason: "host-error" });
  });

  it("the budget ceiling Sec.8 item 5 asks for actually bounds the shipped defaults", () => {
    // The constant existed, was exported, carried a comment citing Sec.8
    // item 5, and was asserted nowhere — so it could not go red on the
    // change it names.
    expect(DEFAULT_RUNS_PER_PLAYER_COUNT * DEFAULT_PLAYER_COUNTS.length).toBeLessThanOrEqual(MAX_GENERATIONS_CEILING);
    expect(MAX_RUNS_PER_PLAYER_COUNT * DEFAULT_PLAYER_COUNTS.length).toBeGreaterThan(MAX_GENERATIONS_CEILING);
  });
});

describe("registry", () => {
  it("is registered in TOOLS and passes the real registry check", () => {
    expect(checkRegistry().ok).toBe(true);
  });

  it("is a WORKER_RUNTIME_TOOL_ID — Sec.4.3's heavy-CPU-work rule", async () => {
    const { WORKER_RUNTIME_TOOL_IDS } = await import("../../registry");
    expect(WORKER_RUNTIME_TOOL_IDS.has("consistency-checker")).toBe(true);
  });
});
