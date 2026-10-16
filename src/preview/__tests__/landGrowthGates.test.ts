// preview-design.md Sec.13's rev 8 land growth gates (2026-09-29). Each one
// runs a tracked RMSTEST fixture through the real `generatePreview` and reads
// the S1 snapshot, so the gates test the whole pipeline rather than a stage
// handed a grid its own test built (CLAUDE.md: a stage whose tests construct
// their own input cannot catch the previous stage failing to produce it).
//
// The numbers are DE's, not the port's. Sec.6.1's table lists what the port
// reproduced in simulation, and these gates hold the implementation to the
// DE side of that table.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { generatePreview, type PreviewReferenceData } from "../generator/index";
import type { ObjectConstant } from "../generator/objects";
import type { StageSnapshot } from "../generator/types";
import {
  DEFAULT_TEAMS,
  type MapSize,
} from "../../generationSettings/generationSettingsConstants";

const lang = loadLanguage();
const constants: readonly ObjectConstant[] = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;
const refDb: PreviewReferenceData = {
  language: buildLanguageIndex(lang),
  constants,
};

function terrain(name: string): number {
  const row = constants.find(
    (c) => c.category === "terrain" && c.rmsConstant === name,
  );
  if (row?.constId == null) throw new Error(`no terrain ${name}`);
  return row.constId;
}

const RMSTEST_DIR = join(REPO_ROOT, "tools", "scenario-probe", "rmstest");

function fixture(fileName: string): string {
  return readFileSync(join(RMSTEST_DIR, fileName), "utf8");
}

function s1(
  source: string,
  seed: number,
  mapSize: MapSize,
  playerCount = 2,
): StageSnapshot {
  const result = generatePreview(
    parseRms(source, lang),
    refDb,
    { playerCount, mapSize, teams: DEFAULT_TEAMS },
    { seed, collectSnapshots: true },
  );
  const snapshot = result.snapshots?.find((s) => s.stage === "S1");
  if (snapshot === undefined) throw new Error("no S1 snapshot");
  return snapshot;
}

/**
 * The smallest Chebyshev distance from any `from` tile to any `to` tile. A
 * multi-source breadth-first search over all eight neighbours measures exactly
 * that distance, so this is one pass over the grid rather than a pairwise scan
 * of two regions thousands of tiles each. Returns Infinity when either terrain
 * is absent.
 */
function minChebyshev(snap: StageSnapshot, from: number, to: number): number {
  const { dim, terrain: t } = snap;
  const dist = new Int32Array(dim * dim).fill(-1);
  const queue = new Int32Array(dim * dim);
  let tail = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== to) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    if (t[i] === from) return dist[i];
    const x = i % dim;
    const y = (i - x) / dim;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= dim || ny >= dim) continue;
        const n = ny * dim + nx;
        if (dist[n] !== -1) continue;
        dist[n] = dist[i] + 1;
        queue[tail++] = n;
      }
    }
  }
  return Infinity;
}

/** 4-connected pieces of one terrain, matching the probe's `--patches` reading. */
function pieces(snap: StageSnapshot, id: number): number {
  const { dim, terrain: t } = snap;
  const seen = new Uint8Array(dim * dim);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== id || seen[start]) continue;
    count++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % dim;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < dim - 1 ? i + 1 : -1,
        i - dim,
        i + dim,
      ];
      for (const n of neighbours) {
        if (n < 0 || n >= t.length || seen[n] || t[n] !== id) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return count;
}

function minX(snap: StageSnapshot, id: number): number {
  let best = Infinity;
  for (let i = 0; i < snap.terrain.length; i++)
    if (snap.terrain[i] === id) best = Math.min(best, i % snap.dim);
  return best;
}

describe("rev 8 land growth gates (preview-design Sec.13)", () => {
  it("RMSTEST_73: each grower stops exactly declared + 1 from a wall that declares no distance (BUG-036)", () => {
    // The walls are ICE lands with no other_zone_avoidance_distance of their
    // own. The shipped rev 7 check took the smaller of the two lands'
    // distances, which is 0 against these walls, so every grower ran flush
    // into them (gap 1 on all three seeds). DE measured 7, 11 and 13.
    const source = fixture(
      "RMSTEST_73_other_zone_avoidance_distance_take_3.rms",
    );
    const ice = terrain("ICE");
    const growers: [string, number][] = [
      ["DIRT", 7],
      ["WATER", 11],
      ["DLC_SAVANNAH", 13],
    ];
    for (const seed of [1, 2, 3]) {
      const snap = s1(source, seed, "Normal");
      const gaps = growers.map(([name]) =>
        minChebyshev(snap, terrain(name), ice),
      );
      expect({ seed, gaps }).toEqual({
        seed,
        gaps: growers.map(([, gap]) => gap),
      });
    }
  }, 60000);

  it("RMSTEST_23: border_fuzziness sets how far a land leaks past a border at tile 80, as DE measured it", () => {
    // Held to DE's own six runs rather than to one exact figure per seed.
    // DE gave min x 80-81 at f 100, 79-80 at f 50 and 78,78,78,78,81,81 at
    // f 20, so even DE's lands did not reach the border line every time. The
    // port behaves the same way. A land is sometimes crowded off the strip by
    // its neighbour and never touches the border at all, which the port did
    // on 4 of 40 seeds at f 100 (83, 81, 82 and 84), and the design session's
    // own simulation on 2 of 40. Sec.13 first worded this as exactly 80 on
    // every seed, and the owner chose DE's figures over that on 2026-09-30.
    //
    // So each arm's MEDIAN over six seeds has to land inside DE's range. On
    // top of that the two arms whose rule is a hard stop get a floor on every
    // seed, since a tile further out than that is refused with chance 100 or
    // more (rule 6a) and seeing one would mean the rule is broken, not that
    // the dice were unkind. The f 20 floor is 76 for the same reason, since
    // five tiles out is 5 x 20 = 100.
    const source = fixture("RMSTEST_23_borderfuzz.rms");
    const arms = [
      { name: "DESERT", f: 100, floor: 80, de: [80, 81] },
      { name: "DIRT3", f: 50, floor: 79, de: [79, 80] },
      { name: "DIRT2", f: 20, floor: 76, de: [78, 81] },
    ];
    const f0 = terrain("DIRT");
    const byArm = arms.map(() => [] as number[]);
    let f0Leaks = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const snap = s1(source, seed, "Normal");
      arms.forEach((arm, k) => byArm[k].push(minX(snap, terrain(arm.name))));
      // DE's f 0 land left the border behind on five of its six runs (min x
      // 63, 57, 66, 66, 81, 60), since border_fuzziness 0 ignores it.
      if (minX(snap, f0) < 75) f0Leaks++;
    }
    arms.forEach((arm, k) => {
      const values = byArm[k];
      const sorted = [...values].sort((a, b) => a - b);
      const median = (sorted[2] + sorted[3]) / 2;
      expect({
        f: arm.f,
        values,
        withinFloor: sorted[0] >= arm.floor,
        medianLikeDe: median >= arm.de[0] && median <= arm.de[1],
      }).toEqual({
        f: arm.f,
        values,
        withinFloor: true,
        medianLikeDe: true,
      });
    });
    expect(f0Leaks).toBeGreaterThanOrEqual(4);
  }, 60000);

  it("RMSTEST_38: lands at clumping_factor 20 and above are one piece, and the cf -20 land breaks into 4 to 12", () => {
    // Giant, since DE ran it at 480 and its lands never met. Giant keeps them
    // apart too, so the fragments are the land's own and not a neighbour's.
    const source = fixture("RMSTEST_38_clumpsweep.rms");
    const snakey = terrain("SNOW");
    const round = [terrain("DIRT2"), terrain("DIRT3"), terrain("GRASS3")];
    const snakeyPieces: number[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const snap = s1(source, seed, "Giant");
      for (const id of round)
        expect({ seed, id, pieces: pieces(snap, id) }).toEqual({
          seed,
          id,
          pieces: 1,
        });
      snakeyPieces.push(pieces(snap, snakey));
    }
    const mean = snakeyPieces.reduce((a, b) => a + b, 0) / snakeyPieces.length;
    expect({ snakeyPieces, ok: mean >= 4 && mean <= 12 }).toEqual({
      snakeyPieces,
      ok: true,
    });
  }, 60000);

  it("the sandwich invariant: the land stage leaves no land tile between two base tiles, on any corpus map", () => {
    // The cleanup pass's prediction, checked in DE on 21 exports that hold
    // zero such tiles, where growth alone leaves 74 to 102 on the RMSTEST_38
    // map. Mutation-tested by skipping the `cleanLandTerrain` call in
    // index.ts, which turns this red on most of the corpus (build log,
    // 2026-09-30).
    //
    // WHAT IS READ, and why it is not the S1 snapshot as Sec.13 first worded
    // it. That snapshot is taken after the automatic beach pass, which
    // repaints tiles on both sides of the question. On a dry base it lays
    // beach on BASE tiles beside a water land, and a beach tile between two
    // base tiles is then correct (TL Tres Leches has 25 to 30 per seed). On a
    // water base it turns a land's own edge tiles into beach, and those edge
    // tiles are exactly where a missed cleanup leaves its sandwiched tiles,
    // so any check that skipped beach tiles would go blind on every island
    // map. So this rebuilds the terrain the land stage itself left, before
    // the beach. No stage after S1 writes `landId`, and after the cleanup a
    // tile is off the base terrain exactly when a land holds it and that land
    // paints something other than the base. The consistency check below
    // guards that reconstruction, since a later S1 step that repainted a
    // tile to the base without clearing its land would break it silently.
    const dir = join(REPO_ROOT, "test-maps");
    const maps = readdirSync(dir).filter((f) => f.endsWith(".rms"));
    expect(maps.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const name of maps) {
      const parse = parseRms(readFileSync(join(dir, name), "utf8"), lang);
      for (const seed of [1, 2, 3]) {
        const result = generatePreview(
          parse,
          refDb,
          { playerCount: 4, mapSize: "Normal", teams: DEFAULT_TEAMS },
          { seed, collectSnapshots: true },
        );
        const snap = result.snapshots!.find((s) => s.stage === "S1")!;
        const { dim, terrain: t } = snap;
        const { landId } = result.grid;
        // The base fill, read as the commonest S1 terrain on tiles no land
        // holds. The beach pass only ever turns some of those into beach.
        const counts = new Map<number, number>();
        for (let i = 0; i < t.length; i++)
          if (landId[i] === -1) counts.set(t[i], (counts.get(t[i]) ?? 0) + 1);
        let base = -1;
        let best = 0;
        for (const [id, n] of counts) if (n > best) [base, best] = [id, n];
        const paintsOffBase = result.landOrigins.map(
          (o) => o.terrainId !== undefined && o.terrainId !== base,
        );
        const offBase = new Uint8Array(t.length);
        let inconsistent = 0;
        for (let i = 0; i < t.length; i++) {
          if (landId[i] < 0 || !paintsOffBase[landId[i]]) continue;
          offBase[i] = 1;
          if (t[i] === base) inconsistent++;
        }
        const isBase = (x: number, y: number) =>
          x >= 0 && y >= 0 && x < dim && y < dim && offBase[y * dim + x] === 0;
        let sandwiched = 0;
        for (let y = 0; y < dim; y++) {
          for (let x = 0; x < dim; x++) {
            if (offBase[y * dim + x] === 0) continue;
            if (
              (isBase(x - 1, y) && isBase(x + 1, y)) ||
              (isBase(x, y - 1) && isBase(x, y + 1))
            )
              sandwiched++;
          }
        }
        if (sandwiched > 0 || inconsistent > 0)
          offenders.push(
            `${name} seed ${seed}: ${sandwiched} sandwiched, ${inconsistent} inconsistent`,
          );
      }
    }
    expect(offenders).toEqual([]);
  }, 600000);

  it("RMSTEST_53: a land whose stamp is buried by a later stamp paints nothing", () => {
    const source = fixture("RMSTEST_53_overwrittenorigin.rms");
    const snow = terrain("SNOW");
    for (const seed of [1, 2, 3]) {
      const snap = s1(source, seed, "Normal");
      expect({
        seed,
        snow: snap.terrain.filter((t) => t === snow).length,
      }).toEqual({ seed, snow: 0 });
    }
  }, 60000);
});
