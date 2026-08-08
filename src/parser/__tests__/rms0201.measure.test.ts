// Scratch measurement, not a gate: prints every RMS0201 across the corpus with
// file, line and name, so BUG-003's remaining warnings can be triaged by
// evidence rather than by memory. Same shape and same rationale as
// rms0200.measure.test.ts.
// Run with: npx vitest run src/parser/__tests__/rms0201.measure.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseRms } from "../parser";
import { loadLanguage, REPO_ROOT } from "./testUtils";

// corpus.test.ts deliberately excludes `.rms2` (it is a separate triage
// question). This reporter counts both and labels them, because BUG-003's
// headline number was taken over `.rms` only and that needs to be visible
// rather than implicit.
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".rms") || entry.endsWith(".rms2")) out.push(p);
  }
  return out;
}

describe("RMS0201 corpus census (BUG-003)", () => {
  it("reports every too-few-arguments warning by name and site", () => {
    const lang = loadLanguage();
    const files = walk(join(REPO_ROOT, "test-maps"));

    interface Hit {
      file: string;
      line: number;
      name: string;
      text: string;
      severity: string;
    }
    const rms: Hit[] = [];
    const rms2: Hit[] = [];

    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const result = parseRms(src, lang);
      for (const d of result.diagnostics) {
        if (d.code !== "RMS0201") continue;
        // lineOffsets[i] is the offset of line i (0-based); find the last one
        // at or before the diagnostic's start.
        let line = 0;
        for (let i = 0; i < result.lineOffsets.length; i++) {
          if (result.lineOffsets[i] <= d.span.start) line = i;
          else break;
        }
        const name = /"([^"]+)"/.exec(d.message)?.[1] ?? "?";
        const hit: Hit = {
          file: relative(REPO_ROOT, f).replace(/\\/g, "/"),
          line: line + 1,
          name,
          text: src.slice(result.lineOffsets[line], result.lineOffsets[line + 1] ?? src.length).trim(),
          severity: d.severity,
        };
        (f.endsWith(".rms2") ? rms2 : rms).push(hit);
      }
    }

    const lines: string[] = [];
    const report = (label: string, hits: Hit[]) => {
      const byName = new Map<string, number>();
      for (const h of hits) byName.set(h.name, (byName.get(h.name) ?? 0) + 1);
      lines.push(`\n===== ${label}: ${hits.length} RMS0201 =====`);
      for (const [n, c] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${String(c).padStart(3)}  ${n}`);
      }
      lines.push("  --- sites ---");
      for (const h of hits) lines.push(`  ${h.severity.padEnd(7)} ${h.file}:${h.line}  [${h.name}]  ${h.text.slice(0, 110)}`);
    };

    report(".rms (the corpus BUG-003 quotes)", rms);
    report(".rms2 (excluded from corpus.test.ts)", rms2);
    lines.push(`\nfiles walked: ${files.length}`);
    console.log(lines.join("\n"));

    expect(rms.length + rms2.length).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
