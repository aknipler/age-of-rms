#!/usr/bin/env node
// Writes the engine's token ids from the community "RMS Equivalencies" sheet
// into reference/data/language.json (docs/token-alias-design.md Sec.4).
//
//   node tools/token-ids/import.mjs <path to sheet.csv> [--date YYYY-MM-DD]
//
// The sheet's first column is the id and its second the RMS keyword. Every
// command, attribute, directive and control keyword whose name equals a keyword
// gets `tokenId` and `tokenIdSource: "equivalencies-<date>"`. Section headers
// and the braces and comment markers have no vocabulary entry and go to the
// top-level `structuralTokens`. Run `npx prettier --write
// reference/data/language.json` afterwards.
//
// A number a DE run measured (a `tokenIdSource` starting `RMSTEST_`) is never
// overwritten. The sheet disagreeing with one is an error, since one of the two
// is wrong and a person has to say which. Every id the sheet wrote on an
// earlier run is cleared first, so importing a newer copy of the sheet does not
// leave stale numbers behind.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const languagePath = path.join(repoRoot, "reference/data/language.json");

const SHEET_PREFIX = "equivalencies-";
const RUN_PREFIX = "RMSTEST_";
const KINDS = ["commands", "attributes", "directives", "controlKeywords"];
// The tokens with no vocabulary entry, besides the `<SECTION>` headers.
const MARKERS = new Set(["{", "}", "/*", "*/"]);

/**
 * A CSV reader for the sheet's export. Written out because the sheet's cells
 * hold commas, quotes and line breaks, and the repo has no CSV dependency.
 * Handles quoted fields with `""` escapes and `\r\n` or `\n` row ends.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Returns `entry` with `tokenId` and `tokenIdSource` set. A new pair is placed
 * straight after `name`, so the diff against the old file only adds lines.
 * Appending the keys at the end would turn the last existing line of every
 * entry into a changed line, to gain its trailing comma.
 */
function withTokenId(entry, tokenId, tokenIdSource) {
  if ("tokenId" in entry) {
    entry.tokenId = tokenId;
    entry.tokenIdSource = tokenIdSource;
    return entry;
  }
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    out[key] = value;
    if (key === "name") {
      out.tokenId = tokenId;
      out.tokenIdSource = tokenIdSource;
    }
  }
  return out;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dateFlag = args.indexOf("--date");
let date = new Date().toISOString().slice(0, 10);
if (dateFlag !== -1) {
  date = args[dateFlag + 1] ?? "";
  args.splice(dateFlag, 2);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
  fail(`--date "${date}" is not YYYY-MM-DD`);
const csvPath = args[0];
if (!csvPath) {
  fail(
    "usage: node tools/token-ids/import.mjs <path to sheet.csv> [--date YYYY-MM-DD]",
  );
}
const sheetSource = `${SHEET_PREFIX}${date}`;

const csv = readFileSync(csvPath, "utf-8").replace(/^﻿/, "");
const rows = parseCsv(csv);
if (!rows[0] || rows[0][0] !== "ID" || rows[0][1] !== "rms token") {
  fail(
    `${csvPath} does not start with "ID,rms token,". Is it the sheet's CSV export?`,
  );
}

const sheetRows = [];
for (const [index, row] of rows.slice(1).entries()) {
  const keyword = (row[1] ?? "").trim();
  if (row.every((cell) => cell.trim() === "")) continue;
  const id = Number(row[0]);
  if (!Number.isInteger(id) || id < 0) {
    fail(`row ${index + 2}: "${row[0]}" is not an id`);
  }
  if (keyword === "") fail(`row ${index + 2} (id ${id}) has no keyword`);
  sheetRows.push({ id, keyword });
}
const seenIds = new Set();
const seenKeywords = new Set();
for (const { id, keyword } of sheetRows) {
  if (seenIds.has(id)) fail(`the sheet lists id ${id} twice`);
  if (seenKeywords.has(keyword)) fail(`the sheet lists "${keyword}" twice`);
  seenIds.add(id);
  seenKeywords.add(keyword);
}

const data = JSON.parse(readFileSync(languagePath, "utf-8"));

// Forget what an earlier sheet import wrote. Run-measured ids stay.
for (const kind of KINDS) {
  data[kind] = data[kind].map((entry) => {
    if (!entry.tokenIdSource?.startsWith(SHEET_PREFIX)) return entry;
    const { tokenId, tokenIdSource, ...rest } = entry;
    return rest;
  });
}

// A name can have entries of two kinds, `base_terrain` and `base_layer` are
// each a standalone command and a block attribute. The engine reads one word,
// so every entry of that name gets the one id.
const byName = new Map();
for (const kind of KINDS) {
  for (const [position, entry] of data[kind].entries()) {
    const hits = byName.get(entry.name) ?? [];
    if (hits.some((hit) => hit.kind === kind)) {
      fail(`"${entry.name}" is in language.json twice as ${kind}`);
    }
    hits.push({ kind, position });
    byName.set(entry.name, hits);
  }
}

const structuralTokens = [];
const unmatchedRows = [];
for (const { id, keyword } of sheetRows) {
  const isSectionHeader = /^<[A-Z][A-Z_]*>$/.test(keyword);
  if (isSectionHeader || MARKERS.has(keyword)) {
    structuralTokens.push({
      text: keyword,
      tokenId: id,
      tokenIdSource: sheetSource,
    });
    continue;
  }
  const hits = byName.get(keyword);
  if (!hits) {
    unmatchedRows.push({ id, keyword });
    continue;
  }
  for (const hit of hits) {
    const entry = data[hit.kind][hit.position];
    if (entry.tokenIdSource?.startsWith(RUN_PREFIX)) {
      if (entry.tokenId !== id) {
        fail(
          `"${keyword}" is ${entry.tokenId} from ${entry.tokenIdSource} and ${id} in the sheet`,
        );
      }
      continue;
    }
    data[hit.kind][hit.position] = withTokenId(entry, id, sheetSource);
  }
}
structuralTokens.sort((a, b) => a.tokenId - b.tokenId);

// `structuralTokens` goes straight after `sections` for the same reason the
// per-entry keys go after `name`.
const output = {};
for (const [key, value] of Object.entries(data)) {
  if (key === "structuralTokens") continue;
  output[key] = value;
  if (key === "sections") output.structuralTokens = structuralTokens;
}

const withoutId = [];
for (const kind of KINDS) {
  for (const entry of data[kind]) {
    if (typeof entry.tokenId !== "number")
      withoutId.push(`${entry.name} (${kind})`);
  }
}
const missingHeaders = data.sections.filter(
  (name) => !structuralTokens.some((token) => token.text === `<${name}>`),
);

writeFileSync(languagePath, JSON.stringify(output, null, 2) + "\n");

console.log(`Source tag ${sheetSource}, ${sheetRows.length} sheet rows.`);
console.log(`structuralTokens: ${structuralTokens.length}`);
console.log(
  `\nSheet rows with no entry in language.json (${unmatchedRows.length}), not imported:`,
);
for (const { id, keyword } of unmatchedRows) console.log(`  ${id}  ${keyword}`);
console.log(
  `\nlanguage.json entries left without an id (${withoutId.length}):`,
);
for (const name of withoutId) console.log(`  ${name}`);
if (missingHeaders.length > 0) {
  console.log(
    `\nSections with no header row in the sheet: ${missingHeaders.join(", ")}`,
  );
}
console.log("\nNow run: npx prettier --write reference/data/language.json");
