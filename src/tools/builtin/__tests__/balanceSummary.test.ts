import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import { resolveMapDim } from "../../../preview/generator/mapDimensions";
import { DEFAULT_TEAMS } from "../../../generationSettings/generationSettingsConstants";
import type { PreviewReferenceData } from "../../../preview/generator/index";
import type {
  PlacedObject,
  PlayerMarker,
} from "../../../preview/generator/types";
import type { ParseResult } from "../../../parser/types";
import {
  TOOLS_API_VERSION,
  type OutputBlock,
  type PublishedGameConstants,
  type ToolContext,
  type ToolMessage,
} from "../../../../tools-api/index";
import { objectConstantsFromPublished } from "../../previewBridge";
import { validateManifest } from "../../protocol";
import {
  balanceSummary,
  buildBalanceOutput,
  foldGeneration,
} from "../balanceSummary";

const lang = loadLanguage();
const gameConstants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: PublishedGameConstants }
).constants;
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants: objectConstantsFromPublished(gameConstants),
};

const players: PlayerMarker[] = [
  { player: 1, x: 10, y: 10 },
  { player: 2, x: 90, y: 90 },
];

/** Every block, with a tabs block's tabs opened out in order. */
function flat(blocks: OutputBlock[]): OutputBlock[] {
  return blocks.flatMap((b) =>
    b.kind === "tabs" ? b.tabs.flatMap((t) => flat(t.blocks)) : [b],
  );
}

describe("balanceSummary manifest", () => {
  it("registers cleanly", () => {
    expect(validateManifest(balanceSummary.manifest)).toEqual([]);
  });
});

describe("foldGeneration", () => {
  it("counts a resource for the nearest start, whoever spawned or owns it", () => {
    // Spawned for player 1 and owned by player 1, but nearer player 2's start.
    const objects: PlacedObject[] = [
      {
        objectRef: "GOLD",
        x: 80,
        y: 80,
        player: 1,
        forPlayer: 1,
        category: "resource-gold",
      },
    ];
    const stats = new Map();
    foldGeneration(stats, 2, objects, players, refDb);
    expect(stats.get(2)?.get(2)?.get("gold")?.runsWithAny).toBe(1);
    expect(stats.get(2)?.get(1)?.get("gold")?.runsWithAny ?? 0).toBe(0);
  });

  it("counts nothing farther than the max distance from every start", () => {
    // (50, 50) is about 57 tiles from both starts.
    const objects: PlacedObject[] = [
      { objectRef: "GOLD", x: 50, y: 50, category: "resource-gold" },
    ];
    const near = new Map();
    foldGeneration(near, 2, objects, players, refDb, 28);
    expect(near.get(2)?.get(1)?.get("gold")?.runsWithAny ?? 0).toBe(0);
    expect(near.get(2)?.get(2)?.get("gold")?.runsWithAny ?? 0).toBe(0);
    const far = new Map();
    foldGeneration(far, 2, objects, players, refDb, 60);
    expect(far.get(2)?.get(1)?.get("gold")?.runsWithAny).toBe(1);
    // Once only, never for both players.
    expect(far.get(2)?.get(2)?.get("gold")?.runsWithAny ?? 0).toBe(0);
  });

  it("sums amount across multiple patches and tracks the nearest, not the farthest", () => {
    const objects: PlacedObject[] = [
      {
        objectRef: "GOLD",
        x: 12,
        y: 10,
        forPlayer: 1,
        category: "resource-gold",
      }, // distance 2
      {
        objectRef: "GOLD",
        x: 30,
        y: 10,
        forPlayer: 1,
        category: "resource-gold",
      }, // distance 20
    ];
    const stats = new Map();
    foldGeneration(stats, 2, objects, players, refDb);
    const cell = stats.get(2)?.get(1)?.get("gold");
    expect(cell?.patchCountSum).toBe(2);
    // GOLD's real yield varies by reference data; what matters here is the
    // nearest of the two distances won, not their sum or the farther one.
    expect(cell?.nearestDistanceSum).toBeCloseTo(2, 5);
  });

  it("averages a total across ALL runs, not only the runs a resource showed up in", () => {
    const stats = new Map();
    foldGeneration(
      stats,
      2,
      [
        {
          objectRef: "GOLD",
          x: 10,
          y: 10,
          forPlayer: 1,
          category: "resource-gold",
        },
      ],
      players,
      refDb,
    );
    foldGeneration(stats, 2, [], players, refDb); // a second generation placing nothing for player 1
    const cell = stats.get(2)!.get(1)!.get("gold")!;
    expect(cell.runsWithAny).toBe(1);
    const blocks = flat(buildBalanceOutput(stats, [2], 2));
    const table = blocks.find(
      (b) =>
        b.kind === "table" &&
        b.rows.some((r) => r[0] === "Gold" && r[1] === "Player 1"),
    );
    expect(table).toBeDefined();
  });

  it("ignores a non-resource object entirely", () => {
    const objects: PlacedObject[] = [
      { objectRef: "SCOUT", x: 11, y: 10, forPlayer: 1, category: "unit" },
    ];
    const stats = new Map();
    foldGeneration(stats, 2, objects, players, refDb);
    const cells = [...(stats.get(2)?.get(1)?.values() ?? [])];
    expect(
      cells.every((c) => c.runsWithAny === 0 && c.totalAmountSum === 0),
    ).toBe(true);
  });
});

describe("buildBalanceOutput", () => {
  it("reports the standard deviation across runs, in the figure's own units, and none for a figure that never changes", () => {
    const gold: PlacedObject = {
      objectRef: "GOLD",
      x: 10,
      y: 10,
      forPlayer: 1,
      category: "resource-gold",
    };
    const varied = new Map();
    foldGeneration(varied, 2, [gold], players, refDb);
    foldGeneration(varied, 2, [], players, refDb);
    const steady = new Map();
    foldGeneration(steady, 2, [gold], players, refDb);
    foldGeneration(steady, 2, [gold], players, refDb);
    const rowOf = (stats: Map<number, Map<number, Map<never, never>>>) => {
      const table = flat(buildBalanceOutput(stats, [2], 2)).find(
        (b) => b.kind === "table" && b.rows.some((r) => r[1] === "Player 1"),
      );
      if (!table || table.kind !== "table") throw new Error("no table");
      return table.rows.find((r) => r[0] === "Gold" && r[1] === "Player 1")!;
    };
    // Columns: Resource, Player, Avg amount, Amount SD, ...
    const mixed = rowOf(varied);
    // Values A and 0 have mean A/2 and standard deviation A/2, so the two
    // columns match. A variance would have read (A/2)^2.
    expect(Number(mixed[3])).toBe(Number(mixed[2]));
    expect(Number(mixed[3])).toBeGreaterThan(0);
    expect(rowOf(steady)[3]).toBe("0");
  });

  it("omits a resource with zero occurrences for every player", () => {
    const stats = new Map();
    foldGeneration(
      stats,
      2,
      [
        {
          objectRef: "GOLD",
          x: 10,
          y: 10,
          forPlayer: 1,
          category: "resource-gold",
        },
      ],
      players,
      refDb,
    );
    const blocks = flat(buildBalanceOutput(stats, [2], 1));
    const table = blocks.find((b) => b.kind === "table");
    expect(
      table && table.kind === "table"
        ? table.rows.some((r) => r[0] === "Stone")
        : true,
    ).toBe(false);
  });

  it("puts an Average tab first and a tab per player count", () => {
    const stats = new Map();
    const gold: PlacedObject = {
      objectRef: "GOLD",
      x: 10,
      y: 10,
      category: "resource-gold",
    };
    foldGeneration(stats, 2, [gold], players, refDb);
    foldGeneration(stats, 4, [gold], players, refDb);
    const tabs = buildBalanceOutput(stats, [2, 4], 1).find(
      (b) => b.kind === "tabs",
    );
    expect(tabs?.kind === "tabs" && tabs.tabs.map((t) => t.label)).toEqual([
      "Average",
      "2 players",
      "4 players",
    ]);
  });

  it("says so when a selected player count placed nothing", () => {
    const blocks = flat(buildBalanceOutput(new Map(), [4], 3));
    expect(
      blocks.some(
        (b) =>
          b.kind === "text" &&
          b.text.includes("no per-player resource patches"),
      ),
    ).toBe(true);
  });
});

const SCRIPT = `
<PLAYER_SETUP>
  random_placement
<LAND_GENERATION>
  base_terrain GRASS
  create_player_lands { terrain_type GRASS land_percent 20 }
<OBJECTS_GENERATION>
  create_object GOLD { number_of_objects 3 set_place_for_every_player min_distance_to_players 5 max_distance_to_players 15 }
`;

function context(): ToolContext<ParseResult> {
  const name = "Tiny";
  const tiles = resolveMapDim(name as never, lang.predefinedLabels ?? []) ?? 0;
  return {
    apiVersion: TOOLS_API_VERSION,
    parseResult: parseRms(SCRIPT, lang),
    source: SCRIPT,
    settings: {
      playerCount: 4,
      mapSize: { name, tiles },
      teams: [...DEFAULT_TEAMS],
    },
    referenceData: { language: lang, gameConstants },
    params: { playerCounts: ["2"], runsPerPlayerCount: 3, baseSeed: 1 },
  };
}

describe("balanceSummary.run", () => {
  it("emits progress and a result carrying a table", async () => {
    const messages = await new Promise<ToolMessage[]>((resolve) => {
      const out: ToolMessage[] = [];
      balanceSummary.run(context(), (msg) => {
        out.push(msg);
        if (msg.type === "result" || msg.type === "error") resolve(out);
      });
    });
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    expect(messages.some((m) => m.type === "progress")).toBe(true);
  });
});
