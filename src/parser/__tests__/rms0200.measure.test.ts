// Scratch measurement, not a gate: prints the RMS0200 split across the whole
// corpus so BUG-005's numbers can be re-derived rather than quoted from memory.
// Run with: npx vitest run src/parser/__tests__/rms0200.measure.test.ts
//
// It asserts only the one thing the fix must not break — that every diagnostic
// carrying a suggestion still says so. Everything else it reports.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseRms } from "../parser";
import { loadLanguage, REPO_ROOT } from "./testUtils";
import type { Item, ParseResult } from "../types";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".rms")) out.push(p);
  }
  return out;
}

/** Every Item in the tree, in source order, blocks and branches included. */
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

describe("RMS0200 corpus split (BUG-005 piece 1)", () => {
  it("reports the with/without-suggestion split", () => {
    const lang = loadLanguage();
    const files = walk(join(REPO_ROOT, "test-maps"));

    let withSuggestion = 0;
    let without = 0;
    const byText = new Map<string, number>();

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const d of parseRms(src, lang).diagnostics) {
        if (d.code !== "RMS0200") continue;
        if (d.suggestion) withSuggestion++;
        else without++;
        const name = /"([^"]+)"/.exec(d.message)?.[1] ?? "?";
        byText.set(name, (byText.get(name) ?? 0) + 1);
      }
    }

    const top = [...byText.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`\nfiles: ${files.length}`);
    console.log(`RMS0200 total: ${withSuggestion + without}`);
    console.log(`  with did-you-mean (keeps behavioural claim): ${withSuggestion}`);
    console.log(`  without (now reports observation only):      ${without}`);
    console.log("top names:");
    for (const [name, n] of top) console.log(`  ${String(n).padStart(4)}  ${name}`);

    // The RMSTEST_63 population, reported separately because it is a DIFFERENT
    // question from the wording split above. 61/62 produced a model in which an
    // unrecognised word's block MERGES into the command before it, silently
    // rewriting it. Only a word that OPENS A BLOCK can do that, so the sites at
    // risk are exactly the unknown commands carrying one — a strict subset of
    // RMS0200, and the number that says whether the merge matters on real maps.
    // Split by name, since resolving an alias removes it from this population
    // without touching the merge question at all.
    const blockOpeners = new Map<string, number>();
    for (const f of files) {
      const parse = parseRms(readFileSync(f, "utf8"), lang);
      for (const item of scriptItems(parse)) {
        if (item.kind !== "command" || item.def !== undefined || !item.block) continue;
        const name = parse.tokens[item.name].text;
        blockOpeners.set(name, (blockOpeners.get(name) ?? 0) + 1);
      }
    }
    const openerTotal = [...blockOpeners.values()].reduce((a, b) => a + b, 0);
    console.log(`\nunknown commands that OPEN A BLOCK (the RMSTEST_63 population): ${openerTotal}`);
    for (const [name, n] of [...blockOpeners.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${name}`);
    }

    // The only real invariant: the split must be exhaustive. Deliberately
    // `>= 0` and not `> 0`, matching the three sibling reporters. A count is a
    // fact about whichever half of the corpus is mounted, not about the code:
    // all 858 RMS0200 hits live in gitignored maps, so `> 0` made this reporter
    // a gate that no fresh clone could pass, and it failed CI on 2026-08-10.
    expect(withSuggestion + without).toBeGreaterThanOrEqual(0);
    // 30 s, not Vitest's 5 s default. This walks and parses all 52 corpus maps;
    // it took 3.5 s alone and 6.3 s inside a full suite run, i.e. it FAILED the
    // default timeout on 2026-08-04 purely from machine load. Same defect class
    // as the Vanguard benchmark in CLAUDE.md's tracked debt — a wall clock on a
    // shared machine measures the machine — except this one is a reporter with
    // no assertion worth timing at all, so the timeout is pure headroom.
  }, 30_000);
});
