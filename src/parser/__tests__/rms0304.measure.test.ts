// Scratch measurement, not a gate. CREATION_PLAN 2.7 asks for the corpus
// counted BEFORE and AFTER RMS0304, per command name, and this is that report.
// Same shape and rationale as rms0200.measure.test.ts / rms0201.measure.test.ts.
//
// The two columns are the whole point of the design, so they are printed side
// by side rather than described:
//
//   "if driven by CommandDef.section"  — the naive check the spec forbids,
//       recomputed here rather than quoted from 2026-07-31, so the number
//       ages with the corpus instead of becoming folklore.
//   "as shipped (sectionLocked)"       — what validate() actually reports.
//
// Run with: npx vitest run src/parser/__tests__/rms0304.measure.test.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { validate, type GameConstantsForValidate, type ValidateReferenceDb } from "../validate";
import type { Item, SectionNode } from "../types";
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

/**
 * The counterfactual: every command whose `def.section` differs from the
 * section it is written in, with no `sectionLocked` gate and no suppression.
 *
 * Written out longhand instead of by flipping a flag in validate.ts, because
 * the point is to keep the rejected design visible next to the shipped one.
 * It walks into conditionals for the same reason validate() does — a command
 * inside `if X` still belongs to the enclosing section.
 */
function naiveSectionHits(sections: SectionNode[]): { name: string; belongsIn: string; foundIn: string }[] {
  const hits: { name: string; belongsIn: string; foundIn: string }[] = [];

  function visit(items: Item[], section: SectionNode): void {
    for (const item of items) {
      switch (item.kind) {
        case "command":
          if (item.def && item.def.section !== section.name) {
            hits.push({ name: item.def.name, belongsIn: item.def.section, foundIn: section.name });
          }
          if (item.block) visit(item.block.items, section);
          break;
        case "if":
          for (const branch of item.branches) visit(branch.items, section);
          break;
        case "random":
          visit(item.preamble, section);
          for (const branch of item.branches) visit(branch.items, section);
          break;
        case "orphanBlock":
          visit(item.block.items, section);
          break;
        default:
          break;
      }
    }
  }

  for (const section of sections) {
    if (!section.known) continue;
    visit(section.items, section);
  }
  return hits;
}

describe("RMS0304 corpus census (CREATION_PLAN 2.7)", () => {
  it("reports the section-driven count and the shipped count, per command name", () => {
    const lang = loadLanguage();
    const gameConstants = JSON.parse(
      readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
    ) as GameConstantsForValidate;
    const refDb: ValidateReferenceDb = { language: lang, gameConstants };
    const files = walk(join(REPO_ROOT, "test-maps"));

    const naiveByName = new Map<string, number>();
    const naiveSites: string[] = [];
    const shippedByName = new Map<string, number>();
    const shippedSites: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const result = parseRms(source, lang);
      const label = relative(REPO_ROOT, file).replace(/\\/g, "/");

      for (const hit of naiveSectionHits(result.script.sections)) {
        naiveByName.set(hit.name, (naiveByName.get(hit.name) ?? 0) + 1);
        naiveSites.push(`  ${label}  ${hit.name} (documented <${hit.belongsIn}>, written in <${hit.foundIn}>)`);
      }

      for (const diagnostic of validate(result, refDb)) {
        if (diagnostic.code !== "RMS0304") continue;
        const name = /"([^"]+)"/.exec(diagnostic.message)?.[1] ?? "?";
        shippedByName.set(name, (shippedByName.get(name) ?? 0) + 1);
        let line = 0;
        for (let i = 0; i < result.lineOffsets.length; i++) {
          if (result.lineOffsets[i] <= diagnostic.span.start) line = i;
          else break;
        }
        shippedSites.push(`  ${label}:${line + 1}  ${diagnostic.message}`);
      }
    }

    const total = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
    const lines: string[] = [];

    lines.push(`\n===== if driven by CommandDef.section (the rejected design): ${total(naiveByName)} =====`);
    for (const [name, count] of [...naiveByName].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(3)}  ${name}`);
    }
    lines.push(...naiveSites.slice(0, 60));
    if (naiveSites.length > 60) lines.push(`  ... and ${naiveSites.length - 60} more`);

    lines.push(`\n===== as shipped, driven by sectionLocked: ${total(shippedByName)} =====`);
    for (const [name, count] of [...shippedByName].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(3)}  ${name}`);
    }
    lines.push(...shippedSites);

    const locked = lang.commands.filter((c) => c.sectionLocked).map((c) => `${c.name} → <${c.section}>`);
    lines.push(`\nsectionLocked commands (${locked.length}): ${locked.join(", ")}`);
    lines.push(`files walked: ${files.length}`);
    console.log(lines.join("\n"));

    expect(total(shippedByName)).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
