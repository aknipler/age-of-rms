import { describe, expect, it } from "vitest";
import type { CommandTiles } from "../generator/commandTiles";
import { packCommandTiles, unpackCommandTiles } from "../commandTilesWire";

describe("command tiles wire", () => {
  it("round trips zero, one and two sets and an empty set", () => {
    const sets: CommandTiles[] = [
      { offset: 5, kind: "object", first: Uint32Array.from([1, 2, 3]) },
      {
        offset: 9,
        kind: "terrain",
        first: Uint32Array.from([4, 5]),
        second: Uint32Array.from([5]),
      },
      {
        offset: 12,
        kind: "land",
        first: new Uint32Array(0),
        second: new Uint32Array(0),
        zone: { zone: -10, lands: 3 },
      },
      { offset: -1, kind: "cliff", first: new Uint32Array(0) },
    ];
    const packed = packCommandTiles(sets);
    expect(packed.tiles).toHaveLength(3 + 2 + 1);
    const back = unpackCommandTiles(packed);
    expect(back).toHaveLength(4);
    back.forEach((b, i) => {
      expect(b.offset).toBe(sets[i].offset);
      expect(b.kind).toBe(sets[i].kind);
      expect([...b.first]).toEqual([...sets[i].first]);
      // An empty second set must stay present, and an absent one absent.
      expect(b.second === undefined).toBe(sets[i].second === undefined);
      expect([...(b.second ?? [])]).toEqual([...(sets[i].second ?? [])]);
      expect(b.zone).toEqual(sets[i].zone);
    });
  });

  it("round trips no sets at all", () => {
    expect(unpackCommandTiles(packCommandTiles([]))).toEqual([]);
  });
});
