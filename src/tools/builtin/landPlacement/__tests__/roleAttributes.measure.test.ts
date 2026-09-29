// Scratch measurement, not a gate: re-derives role-attributes-escalation.md
// Sec.2.1's table (which `create_land` attributes appear on positioned lands,
// per block and per map) and Sec.4.2's `assign_to` target split, so the
// figures in that document can be re-run rather than quoted. On the
// rms0200.measure.test.ts precedent.
// Run with: npx vitest run src/tools/builtin/landPlacement/__tests__/roleAttributes.measure.test.ts
//
// POPULATION, stated because the escalation's first draft quoted a split
// nobody could reproduce: every `.rms` under test-maps/ EXCEPT
// test-maps/rms-check/ (58 files on a maintainer's disk, fewer on a clone,
// see CLAUDE.md's repo map), every `create_land` / `create_player_lands`
// command node the PARSER produces (so a block on one line and a block whose
// attributes sit inside `if` branches both count once), and an attribute
// counts for a block when any attribute node of that name sits anywhere
// inside the block, branches included. "Positioned" means the block carries
// a `land_position`. The `assign_to` split counts attribute NODES, not
// blocks, so a block with an `if`/`else` pair counts twice, which is what
// the corpus mostly is (AK_Vanguard's `assign_to AT_COLOR … else assign_to
// AT_TEAM …` idiom).
//
// The one assertion is that the walk saw blocks at all, so a broken walk
// cannot print an empty table and pass.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseRms } from "../../../../parser/parser";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import type { CommandNode, Item, ParseResult } from "../../../../parser/types";

const ATTRIBUTES = [
  "land_id",
  "number_of_tiles",
  "bottom_border",
  "left_border",
  "top_border",
  "right_border",
  "clumping_factor",
  "other_zone_avoidance_distance",
  "border_fuzziness",
  "set_circular_base",
  "land_conformity",
  "min_placement_distance",
  "generate_mode",
  "circle_radius",
  "set_zone_randomly",
  "set_zone_by_team",
  "land_percent",
  "assign_to",
  "assign_to_player",
  "zone",
] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "rms-check") continue;
      out.push(...walk(p));
    } else if (entry.endsWith(".rms")) out.push(p);
  }
  return out;
}

function* allItems(items: readonly Item[]): Generator<Item> {
  for (const item of items) {
    yield item;
    switch (item.kind) {
      case "command":
        if (item.block) yield* allItems(item.block.items);
        break;
      case "orphanBlock":
        yield* allItems(item.block.items);
        break;
      case "if":
        for (const b of item.branches) yield* allItems(b.items);
        break;
      case "random":
        yield* allItems(item.preamble);
        for (const b of item.branches) yield* allItems(b.items);
        break;
    }
  }
}

function* scriptItems(parse: ParseResult): Generator<Item> {
  yield* allItems(parse.script.preamble);
  for (const s of parse.script.sections) yield* allItems(s.items);
}

interface Row {
  positionedBlocks: number;
  positionedMaps: Set<string>;
  otherBlocks: number;
  otherMaps: Set<string>;
}

describe("role-attributes-escalation.md Sec.2.1 corpus table (reporter)", () => {
  it("prints the positioned / unpositioned split per attribute, and the assign_to target split", () => {
    const lang = loadLanguage();
    const files = walk(join(REPO_ROOT, "test-maps"));
    const rows = new Map<string, Row>(
      ATTRIBUTES.map((a) => [
        a,
        {
          positionedBlocks: 0,
          positionedMaps: new Set(),
          otherBlocks: 0,
          otherMaps: new Set(),
        },
      ]),
    );
    const targets = new Map<string, number>();
    const targetsPerMap = new Map<string, number>();
    let blocks = 0;
    let mapsWithLandSection = 0;
    const positionedMaps = new Set<string>();

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const parse = parseRms(source, lang);
      const map = basename(file);
      if (parse.script.sections.some((s) => s.name === "LAND_GENERATION"))
        mapsWithLandSection++;
      for (const item of scriptItems(parse)) {
        if (item.kind !== "command") continue;
        const name = parse.tokens[item.name].text;
        if (name !== "create_land" && name !== "create_player_lands") continue;
        const cmd = item as CommandNode;
        blocks++;
        const attrs = new Set<string>();
        for (const inner of allItems(cmd.block?.items ?? [])) {
          if (inner.kind !== "attribute") continue;
          const attr = parse.tokens[inner.name].text;
          attrs.add(attr);
          if (attr === "assign_to") {
            const target = inner.args[0];
            const t =
              target === undefined
                ? "(none)"
                : typeof target.value === "string"
                  ? target.value
                  : parse.tokens[target.firstToken].text;
            targets.set(t, (targets.get(t) ?? 0) + 1);
            targetsPerMap.set(map, (targetsPerMap.get(map) ?? 0) + 1);
          }
        }
        const positioned = attrs.has("land_position");
        if (positioned) positionedMaps.add(map);
        for (const a of ATTRIBUTES) {
          if (!attrs.has(a)) continue;
          const row = rows.get(a)!;
          if (positioned) {
            row.positionedBlocks++;
            row.positionedMaps.add(map);
          } else {
            row.otherBlocks++;
            row.otherMaps.add(map);
          }
        }
      }
    }

    const lines: string[] = [
      `files ${files.length}, with <LAND_GENERATION> ${mapsWithLandSection}, land blocks ${blocks}, maps with a positioned land ${positionedMaps.size}`,
      "",
      `${"attribute".padEnd(32)} ${"pos blocks".padStart(10)} ${"maps".padStart(5)} ${"other blocks".padStart(12)} ${"maps".padStart(5)}`,
    ];
    const sorted = [...rows.entries()].sort(
      (a, b) => b[1].positionedMaps.size - a[1].positionedMaps.size,
    );
    for (const [a, r] of sorted) {
      lines.push(
        `${a.padEnd(32)} ${String(r.positionedBlocks).padStart(10)} ${String(r.positionedMaps.size).padStart(5)} ${String(r.otherBlocks).padStart(12)} ${String(r.otherMaps.size).padStart(5)}`,
      );
    }
    const totalTargets = [...targets.values()].reduce((x, y) => x + y, 0);
    const topMap = [...targetsPerMap.entries()].sort((a, b) => b[1] - a[1])[0];
    lines.push(
      "",
      `assign_to attribute nodes ${totalTargets}: ${[...targets.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")}`,
      topMap
        ? `largest single map: ${topMap[0]} ${topMap[1]} (${((100 * topMap[1]) / totalTargets).toFixed(0)}%)`
        : "",
    );
    console.log(lines.join("\n"));

    expect(blocks).toBeGreaterThan(0);
  }, 60_000); // a full-corpus parse: 2s alone, over 10s under a parallel run
});
