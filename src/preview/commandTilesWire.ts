import type { CommandTileKind, CommandTiles } from "./generator/commandTiles";

// The per command tile sets across the preview worker's postMessage. A big
// land is tens of thousands of tile indices, so as objects the structured clone
// would cost real time on every debounced update (the same reasoning as
// deObjectsWire.ts). Packed, it is one Uint32Array the worker transfers for
// free plus a small list that says where each set starts and ends.

export interface CommandTilesMeta {
  offset: number;
  kind: CommandTileKind;
  firstLength: number;
  /** -1 when the command has no second set, so an empty second set stays distinct. */
  secondLength: number;
  zone?: { zone: number; lands: number };
}

export interface PackedCommandTiles {
  meta: CommandTilesMeta[];
  /** Every set's tile indices end to end, first set then second set, in `meta`'s order. */
  tiles: Uint32Array;
}

export function packCommandTiles(
  sets: readonly CommandTiles[],
): PackedCommandTiles {
  let total = 0;
  for (const s of sets) total += s.first.length + (s.second?.length ?? 0);
  const tiles = new Uint32Array(total);
  const meta: CommandTilesMeta[] = [];
  let at = 0;
  for (const s of sets) {
    tiles.set(s.first, at);
    at += s.first.length;
    if (s.second !== undefined) {
      tiles.set(s.second, at);
      at += s.second.length;
    }
    meta.push({
      offset: s.offset,
      kind: s.kind,
      firstLength: s.first.length,
      secondLength: s.second?.length ?? -1,
      zone: s.zone,
    });
  }
  return { meta, tiles };
}

export function unpackCommandTiles(packed: PackedCommandTiles): CommandTiles[] {
  const out: CommandTiles[] = [];
  let at = 0;
  for (const m of packed.meta) {
    // `subarray` views share the one buffer, so unpacking copies nothing.
    const first = packed.tiles.subarray(at, at + m.firstLength);
    at += m.firstLength;
    let second: Uint32Array | undefined;
    if (m.secondLength >= 0) {
      second = packed.tiles.subarray(at, at + m.secondLength);
      at += m.secondLength;
    }
    out.push({ offset: m.offset, kind: m.kind, first, second, zone: m.zone });
  }
  return out;
}
