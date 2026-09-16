// Corpus gates for the script formatter (docs/formatter-design.md Sec.11).
//
// Three properties, over every .rms the machine has, under two option sets,
// the all-preserve default and an aggressive rewrite that touches nearly every
// line. They are separate properties on purpose:
//
//   1. TOKEN PRESERVATION. The formatter's central invariant (Sec.2). If this
//      fails, the tool corrupted a script and everything else is moot.
//   2. IDEMPOTENCE. format(format(x)) === format(x). This is the gate a
//      preserve-heavy design is most exposed to: every "preserve" rule
//      classifies from the source, so a rule that is not stable under its own
//      output makes the file drift on each run.
//   3. NO NEW PARSE ERRORS. The formatter cannot fix a broken script and must
//      not break a working one.
//
// Same enumeration as src/parser/__tests__/corpus.test.ts, and the same
// consequence: on a clone this reduces to the tracked files, because the rest
// are gitignored.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { tokenize } from "../../../../parser/lexer";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import { formatScript, type FormatScriptOptions } from "../index";

const lang = loadLanguage();
const MAPS_DIR = join(REPO_ROOT, "test-maps");

function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => join(dir, e.name));
}

const FILES = [
  ...listRms(MAPS_DIR),
  ...listRms(join(MAPS_DIR, "local")),
  ...listRms(join(MAPS_DIR, "broken")),
];

/**
 * All-preserve (the shipped default) and a rewrite that overrides every
 * preserve rule at once. The second exists because the first, on a
 * well-formatted script, can pass all three properties by barely doing
 * anything. It is the "no changes" case that proves the least.
 */
const OPTION_SETS: { name: string; options: FormatScriptOptions }[] = [
  { name: "defaults", options: {} },
  {
    name: "rewrite",
    options: {
      blockLayout: "expanded",
      indentStyle: "4 spaces",
      sectionIndent: "indented",
      braceStyle: "ownLine",
      intraLineSpacing: "collapse",
      commentGroups: false,
      maxBlankLines: 0,
    },
  },
];

function errorCount(source: string): number {
  return parseRms(source, lang).diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
}

describe.each(OPTION_SETS)("formatter corpus — $name", ({ options }) => {
  for (const path of FILES) {
    const name = path.slice(MAPS_DIR.length + 1);

    // The explicit timeout is not a hint that a file is slow. The worst map
    // formats in ~200 ms alone. `local/Arena.rms` took 8.2 s inside a full
    // suite run on 2026-08-24 and went red against Vitest's 5,000 ms default,
    // which is the wall-clock spread CLAUDE.md's tracked debt records for this
    // machine. A corpus gate that goes red on machine load is a gate people
    // learn to scroll past.
    it(`${name}: preserves every token, is idempotent, and adds no parse error`, () => {
      const source = readFileSync(path, "utf8");
      const parse = parseRms(source, lang);
      const first = formatScript(parse, options);

      // 1. The invariant, checked here independently of the tool's own
      //    verification rather than by trusting `verified`. The check and the
      //    thing it checks must not be the same code path in a gate.
      expect(first.verifyProblem).toBeUndefined();
      const before = parse.tokens.map((t) => t.text);
      const after = tokenize(first.text).tokens.map((t) => t.text);
      expect(after).toEqual(before);

      // 2. Idempotence.
      const second = formatScript(parseRms(first.text, lang), options);
      expect(second.text).toBe(first.text);
      expect(second.edits).toEqual([]);

      // 3. No new errors. Not "zero errors". Most of this corpus is untriaged
      //    and BCC2-Rekawa is a known defect. The formatter is only accountable
      //    for the delta.
      expect(errorCount(first.text)).toBeLessThanOrEqual(errorCount(source));
    }, 120_000);
  }
});
