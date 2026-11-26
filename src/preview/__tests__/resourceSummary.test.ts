import { describe, expect, it } from "vitest";
import { computeResourceSummary } from "../generator/resourceSummary";
import type { ObjectConstant } from "../generator/objects";
import type { PlacedObject, PlayerMarker } from "../generator/types";

const GOLD = 66;
const SHEEP = 700;

const constants: ObjectConstant[] = [
  {
    constId: GOLD,
    rmsConstant: "GOLD",
    category: "object",
    resourceAmounts: { gold: 800 },
  },
  {
    constId: SHEEP,
    rmsConstant: "SHEEP",
    category: "object",
    resourceAmounts: { food: 100 },
  },
];

/** A placement spawned for `forPlayer` (set_place_for_every_player), owned by nobody. */
function placed(objectRef: string, forPlayer?: number): PlacedObject {
  return { objectRef, x: 0, y: 0, forPlayer, category: "resource" };
}

describe("computeResourceSummary", () => {
  it("sums neutral placements into total and neutral, leaving player at zero", () => {
    const result = computeResourceSummary(
      [placed("GOLD"), placed("GOLD")],
      [],
      0,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.total.min.gold).toBe(1600);
    expect(result.neutral.min.gold).toBe(1600);
    expect(result.player.min.gold).toBe(0);
    expect(result.player.max.gold).toBe(0);
  });

  it("attributes a real placement's own player field, no nearest-by-distance fallback", () => {
    const players: PlayerMarker[] = [
      { player: 1, x: 0, y: 0 },
      { player: 2, x: 100, y: 100 },
    ];
    // Both GOLD instances sit at (0,0), nearest to player 1 by distance, but
    // this one was spawned for player 2, and D4 must read that, not distance.
    const objects = [
      { objectRef: "GOLD", x: 0, y: 0, forPlayer: 2, category: "resource" },
    ];
    const result = computeResourceSummary(
      objects,
      players,
      0,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.player.min.gold).toBe(0); // player 1's own total
    expect(result.player.max.gold).toBe(800); // player 2's own total
  });

  it("buckets by forPlayer alone, never by owner", () => {
    // Namatjira's shape: per player 1 owned sheep and 7 gaia sheep, all
    // spawned by set_place_for_every_player. Ownership must not decide it.
    const objects: PlacedObject[] = [];
    for (const p of [1, 2]) {
      objects.push({
        objectRef: "SHEEP",
        x: 0,
        y: 0,
        player: p,
        forPlayer: p,
        category: "resource",
      });
      for (let i = 0; i < 7; i++) objects.push(placed("SHEEP", p));
    }
    // An owner with no forPlayer. The stages never produce this, and the
    // summary must still not fall back to the owner.
    objects.push({
      objectRef: "GOLD",
      x: 0,
      y: 0,
      player: 1,
      category: "resource",
    });
    const result = computeResourceSummary(
      objects,
      [
        { player: 1, x: 0, y: 0 },
        { player: 2, x: 0, y: 0 },
      ],
      0,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.player.min.food).toBe(800);
    expect(result.player.max.food).toBe(800);
    expect(result.player.max.gold).toBe(0);
    expect(result.neutral.min.gold).toBe(800);
    expect(result.neutral.min.food).toBe(0);
  });

  it("reports the real spread across this generation's players, including one who got nothing", () => {
    const players: PlayerMarker[] = [
      { player: 1, x: 0, y: 0 },
      { player: 2, x: 0, y: 0 },
    ];
    const objects = [placed("GOLD", 1)];
    const result = computeResourceSummary(
      objects,
      players,
      0,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.player.min.gold).toBe(0);
    expect(result.player.max.gold).toBe(800);
  });

  it("folds forest wood into total and neutral wood, not player", () => {
    const result = computeResourceSummary(
      [],
      [{ player: 1, x: 0, y: 0 }],
      500,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.total.min.wood).toBe(500);
    expect(result.neutral.min.wood).toBe(500);
    expect(result.player.min.wood).toBe(0);
  });

  it("applies a D10 yield override instead of the base resourceAmounts", () => {
    const overrides = new Map([[GOLD, { key: "gold" as const, amount: 1200 }]]);
    const result = computeResourceSummary(
      [placed("GOLD")],
      [],
      0,
      constants,
      undefined,
      undefined,
      overrides,
    );
    expect(result.total.min.gold).toBe(1200);
  });

  it("resolves an object through symbols/aliases, unlike balanceSummary.ts's own omission", () => {
    const symbols = new Map([["MY_GOLD", GOLD]]);
    const result = computeResourceSummary(
      [placed("MY_GOLD")],
      [],
      0,
      constants,
      symbols,
      undefined,
      new Map(),
    );
    expect(result.total.min.gold).toBe(800);
  });

  it("min === max on total and neutral (an exact figure, not an uncertainty range)", () => {
    const result = computeResourceSummary(
      [placed("SHEEP"), placed("GOLD")],
      [],
      0,
      constants,
      undefined,
      undefined,
      new Map(),
    );
    expect(result.total.min).toEqual(result.total.max);
    expect(result.neutral.min).toEqual(result.neutral.max);
  });
});
