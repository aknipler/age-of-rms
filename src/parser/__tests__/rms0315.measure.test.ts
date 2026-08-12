// Scratch measurement, not a gate. Same shape and rationale as
// rms0200/rms0201/rms0304.measure.test.ts: CLAUDE.md's standing rule is that a
// new check's scope is judged by a corpus count, not by intuition.
//
// Run with:
//   npx vitest run src/parser/__tests__/rms0315.measure.test.ts --disableConsoleIntercept
//
// **The flag is not optional.** Vitest 4 intercepts console output in this
// repo's configuration and none of these reporters print a single line without
// it, which is easy to read as "the check found nothing" — every one of them
// still exits 0. Measured 2026-08-10 while adding this file.
//
// What to look at in the output: RMS0315 is a warning about an ABSENCE, so the
// question a count answers is whether the absence is really a mistake or a form
// authors write on purpose. Every site printed here is a command carrying a
// line that does nothing — **not**, as this file said until 2026-08-12, a
// command that places nothing. RMSTEST_42 measured the attribute as inert and
// the command as untouched, so the count is a count of dead lines, and the
// build log's "47 commands place nothing" figure is withdrawn.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { validate, type GameConstantsForValidate, type ValidateReferenceDb } from "../validate";
import { loadLanguage, REPO_ROOT } from "./testUtils";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".rms") || entry.endsWith(".rms2")) out.push(p);
  }
  return out;
}

describe("RMS0315 corpus census", () => {
  it("reports every site, per map", () => {
    const lang = loadLanguage();
    const gameConstants = JSON.parse(
      readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
    ) as GameConstantsForValidate;
    const refDb: ValidateReferenceDb = { language: lang, gameConstants };
    const files = walk(join(REPO_ROOT, "test-maps"));

    const byMap = new Map<string, number>();
    const sites: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const result = parseRms(source, lang);
      const label = relative(REPO_ROOT, file).replace(/\\/g, "/");
      for (const diagnostic of validate(result, refDb)) {
        if (diagnostic.code !== "RMS0315") continue;
        byMap.set(label, (byMap.get(label) ?? 0) + 1);
        let line = 0;
        for (let i = 0; i < result.lineOffsets.length; i++) {
          if (result.lineOffsets[i] <= diagnostic.span.start) line = i;
          else break;
        }
        sites.push(`  ${label}:${line + 1}`);
      }
    }

    const total = [...byMap.values()].reduce((a, b) => a + b, 0);
    const lines = [`\n===== RMS0315 across ${files.length} corpus files: ${total} =====`];
    for (const [map, count] of [...byMap].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(3)}  ${map}`);
    }
    lines.push("", ...sites);
    console.log(lines.join("\n"));

    expect(total).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
