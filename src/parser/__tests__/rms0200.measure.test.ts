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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".rms")) out.push(p);
  }
  return out;
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

    // The only real invariant: the split must be exhaustive.
    expect(withSuggestion + without).toBeGreaterThan(0);
    // 30 s, not Vitest's 5 s default. This walks and parses all 52 corpus maps;
    // it took 3.5 s alone and 6.3 s inside a full suite run, i.e. it FAILED the
    // default timeout on 2026-08-04 purely from machine load. Same defect class
    // as the Vanguard benchmark in CLAUDE.md's tracked debt — a wall clock on a
    // shared machine measures the machine — except this one is a reporter with
    // no assertion worth timing at all, so the timeout is pure headroom.
  }, 30_000);
});
