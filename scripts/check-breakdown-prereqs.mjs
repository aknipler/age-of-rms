#!/usr/bin/env node
// Grep-based refresher for docs/breakdown-design.md §0.1's reference-data
// prerequisites table. The table pins occurrence counts as of a given spec
// revision, and rev 4 found four of eight rows had drifted from what the
// repo actually contained — this script is rev 4's fix: re-derive the
// counts from the source of truth (language.json, types.ts, sectionLabels.ts,
// CodePane.tsx) instead of trusting hand-verified prose. Run before starting
// or resuming any Breakdown work (3.2/3.3/3.4) to catch drift early.
//
// This is a report, not a gate — it prints current counts next to what the
// spec's rev-4 table claims and flags mismatches. It does not fail CI.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const results = [];
function row(field, actual, expected, note, { informational = false } = {}) {
  const ok = informational || String(actual) === String(expected);
  results.push({ field, actual, expected, ok, note, informational });
}

const language = readJson("reference/data/language.json");

// repeatable — rev 4 table: 4, named replace_terrain/terrain_cost/terrain_size/spacing_to_specific_terrain
const repeatableAttrs = language.attributes.filter((a) => a.repeatable === true).map((a) => a.name).sort();
row(
  "repeatable",
  `${repeatableAttrs.length} (${repeatableAttrs.join(", ") || "none"})`,
  "4 (replace_terrain, spacing_to_specific_terrain, terrain_cost, terrain_size)",
  "§3.3 ground-truth rule renders duplicates as a list regardless of this flag — it only governs whether \"add another\" is offered.",
);

// nonFunctional — rev 4 table: 2, #undefine/#include
const nonFunctionalDirectives = language.directives.filter((d) => d.nonFunctional === true).map((d) => d.name).sort();
row(
  "nonFunctional",
  `${nonFunctionalDirectives.length} (${nonFunctionalDirectives.join(", ") || "none"})`,
  "2 (#include, #undefine)",
  "Drives §3.6's \"has no effect in DE\" badge.",
);

// #ifdef family removed from directives[]
const ifdefFamily = ["#ifdef", "#ifndef", "#else", "#endif"];
const stillPresent = language.directives.filter((d) => ifdefFamily.includes(d.name)).map((d) => d.name);
row(
  "#ifdef family in directives[]",
  stillPresent.length === 0 ? "removed" : `still present: ${stillPresent.join(", ")}`,
  "removed",
  "parser-design §13 item 2 — these don't exist in DE.",
);

// sectionLabels.ts exists with 7 entries
const sectionLabelsPath = "src/breakdown/sectionLabels.ts";
let sectionLabelsStatus = "missing";
let sectionLabelsKeyCount = null;
if (existsSync(path.join(repoRoot, sectionLabelsPath))) {
  const src = read(sectionLabelsPath);
  // Scoped to the SECTION_LABELS object specifically — the file also
  // exports SECTION_NUMBERS (added alongside absolute tab numbering),
  // which reuses the same canonical-name keys and would double-count if
  // matched file-wide.
  const objectMatch = src.match(/SECTION_LABELS[^{]*\{([\s\S]*?)\}/);
  const keyMatches = objectMatch ? (objectMatch[1].match(/^\s*[A-Z_]+\s*:/gm) ?? []) : [];
  sectionLabelsKeyCount = keyMatches.length;
  sectionLabelsStatus = `exists (${sectionLabelsKeyCount} keys)`;
}
results.push({
  field: "sectionLabels",
  actual: sectionLabelsStatus,
  expected: "exists (7 keys)",
  ok: sectionLabelsKeyCount === 7,
  note: "§7 item 3 — display labels for the section sub-tabs.",
});

// argument default coverage — rev 4 table: 34/130
let totalArgs = 0;
let withDefault = 0;
function scanArgs(arr) {
  for (const item of arr ?? []) {
    for (const arg of item.arguments ?? []) {
      totalArgs++;
      if (arg.default !== undefined) withDefault++;
    }
  }
}
scanArgs(language.commands);
scanArgs(language.attributes);
scanArgs(language.directives);
row("argument default coverage", `${withDefault}/${totalArgs}`, "34/130", "Not blocking (§3.3's no-default absent-row path is the common case) — shapes the pitch, not correctness.");

// Diagnostic.suggestion field on types.ts
const typesSrc = read("src/parser/types.ts");
row(
  "Diagnostic.suggestion field",
  typesSrc.includes("suggestion") && /interface Diagnostic[\s\S]*?suggestion\??:/.test(typesSrc) ? "exists" : "missing",
  "exists",
  "§7 item 10 — populated by unknownName() in diagnostics.ts, consumed by the raw-card quick-fix / applySuggestion intent.",
);

// applySuggestion intent — 3.3 scope, expected NOT yet built as of 3.2.
// Informational: absence here is correct pre-3.3, so it's never a "mismatch".
const hasPatchDir = existsSync(path.join(repoRoot, "src/breakdown/patch"));
results.push({
  field: "applySuggestion intent (§4.1, 3.3 scope)",
  actual: hasPatchDir ? "src/breakdown/patch/ exists — check intents.ts" : "not built (src/breakdown/patch/ absent)",
  expected: "not built until 3.3",
  ok: true,
  note: "Expected absent through 3.2; do not treat as a regression.",
});

// useParsedDocument hook exists (§6.2)
const hasUseParsedDocument = existsSync(path.join(repoRoot, "src/useParsedDocument.ts"));
row("useParsedDocument.ts (§6.2)", hasUseParsedDocument ? "exists" : "missing", "exists", "Lifts the single worker parse to app level.");

// CodePane staleness guard — just report the line it's on so the spec's
// "line drifts, grep for it" note has a live answer.
const codePaneSrc = read("src/components/CodePane.tsx");
const lines = codePaneSrc.split("\n");
const guardLineIndex = lines.findIndex((l) => l.includes("getValue()") && /source/i.test(l));
results.push({
  field: "CodePane staleness guard location",
  actual: guardLineIndex >= 0 ? `line ${guardLineIndex + 1}` : "not found — check CodePane.tsx by hand",
  expected: "present somewhere in CodePane.tsx",
  ok: guardLineIndex >= 0,
  note: "Guards against applying markers for a stale parse; §6.2 depends on useParsedDocument still exposing `source`. Line number drifts — this is just a pointer, not a spec claim.",
});

// ---- report ----
const nameWidth = Math.max(...results.map((r) => r.field.length));
console.log("docs/breakdown-design.md §0.1 prerequisite refresh\n");
for (const r of results) {
  const mark = r.ok ? "✓" : "?";
  console.log(`${mark} ${r.field.padEnd(nameWidth)}  actual: ${r.actual}`);
  if (!r.ok) console.log(`  ${"".padEnd(nameWidth)}  spec says: ${r.expected}`);
  if (r.note) console.log(`  ${"".padEnd(nameWidth)}  ${r.note}`);
}

const mismatches = results.filter((r) => !r.ok);
console.log(
  mismatches.length === 0
    ? "\nAll rows match the rev-4 table — no drift detected."
    : `\n${mismatches.length} row(s) differ from the rev-4 table (see "spec says" above). This is a report, not a failure — update docs/breakdown-design.md §0.1 if the repo is now correct, or fix the repo if it's not.`,
);
