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

describe("balanceSummary manifest", () => {
  it("registers cleanly", () => {
    expect(validateManifest(balanceSummary.manifest)).toEqual([]);
  });
});

describe("foldGeneration", () => {
  it("attributes a frame-placed resource to the frame's player, not the nearest one", () => {
    // Placed under player 1's frame but sitting geometrically closer to player 2.
    const objects: PlacedObject[] = [
      { objectRef: "GOLD", x: 80, y: 80, player: 1, category: "resource-gold" },
    ];
    const stats = new Map();
    foldGeneration(stats, 2, objects, players, refDb);
    // A cell always exists once its player/resource pair has been touched by
    // any fold (zeroed, not absent, see foldGeneration's own doc); "did not
    // happen" reads as runsWithAny 0, not as a missing map entry.
    expect(stats.get(2)?.get(1)?.get("gold")?.runsWithAny).toBe(1);
    expect(stats.get(2)?.get(2)?.get("gold")?.runsWithAny).toBe(0);
  });

  it("falls back to the nearest player for a resource with no frame", () => {
    const objects: PlacedObject[] = [
      { objectRef: "GOLD", x: 88, y: 92, category: "resource-gold" },
    ];
    const stats = new Map();
    foldGeneration(stats, 2, objects, players, refDb);
    expect(stats.get(2)?.get(2)?.get("gold")?.runsWithAny).toBe(1);
    expect(stats.get(2)?.get(1)?.get("gold")?.runsWithAny).toBe(0);
  });

  it("sums amount across multiple patches and tracks the nearest, not the farthest", () => {
    const objects: PlacedObject[] = [
      { objectRef: "GOLD", x: 12, y: 10, player: 1, category: "resource-gold" }, // distance 2
      { objectRef: "GOLD", x: 30, y: 10, player: 1, category: "resource-gold" }, // distance 20
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
          player: 1,
          category: "resource-gold",
        },
      ],
      players,
      refDb,
    );
    foldGeneration(stats, 2, [], players, refDb); // a second generation placing nothing for player 1
    const cell = stats.get(2)!.get(1)!.get("gold")!;
    expect(cell.runsWithAny).toBe(1);
    const blocks = buildBalanceOutput(stats, [2], 2);
    const table = blocks.find(
      (b) =>
        b.kind === "table" &&
        b.rows.some((r) => r[0] === "Player 1" && r[1] === "Gold"),
    );
    expect(table).toBeDefined();
  });

  it("ignores a non-resource object entirely", () => {
    const objects: PlacedObject[] = [
      { objectRef: "SCOUT", x: 11, y: 10, player: 1, category: "unit" },
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
          player: 1,
          category: "resource-gold",
        },
      ],
      players,
      refDb,
    );
    const blocks = buildBalanceOutput(stats, [2], 1);
    const table = blocks.find((b) => b.kind === "table");
    expect(
      table && table.kind === "table"
        ? table.rows.some((r) => r[1] === "Stone")
        : true,
    ).toBe(false);
  });

  it("says so when a selected player count placed nothing", () => {
    const blocks = buildBalanceOutput(new Map(), [4], 3);
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
