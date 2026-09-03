// Corpus reporter for the script formatter, re-derives every figure
// docs/formatter-design.md pins, so a review round does not hand-write a probe
// and a number in the spec cannot quietly rot.
//
// A REPORT, NOT A GATE. It asserts nothing about the numbers; corpus.test.ts
// owns the properties (token preservation, idempotence, no new parse errors).
// The only assertion here is that the run produced output at all, because a
// reporter that silently measures nothing is indistinguishable from one that
// found nothing to say.
//
// Unlike `npm run measure:checker`, this one runs inside the normal suite: the
// whole corpus formats in about a second, so keeping it out would buy nothing
// and would let it decay. Run it on its own to read the tables:
//
//     npx vitest run src/tools/builtin/formatter/__tests__/formatter.measure.test.ts --disableConsoleIntercept
//
// Without `--disableConsoleIntercept` it prints nothing and still exits 0,
// which is the trap the parser's four reporters carry the same warning about.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lineOfOffset } from "../../../../parser/lineIndex";
import { parseRms } from "../../../../parser/parser";
import type { Item, ParseResult, SectionNode } from "../../../../parser/types";
import { loadLanguage, REPO_ROOT } from "../../../../parser/__tests__/testUtils";
import { formatScript } from "../index";

const lang = loadLanguage();
const MAPS_DIR = join(REPO_ROOT, "test-maps");

function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => join(dir, e.name));
}

// `broken/` is deliberately excluded here and deliberately included in the
// corpus GATE. Its one file is malformed on purpose, so it belongs in a
// property check and would distort a census of how authors write.
const FILES = [...listRms(MAPS_DIR), ...listRms(join(MAPS_DIR, "local"))];

// The explicit timeouts below are not a hint that this file is slow. It runs in
// about five seconds on its own; it exceeded Vitest's 5,000 ms default inside a
// full `npm test` on 2026-08-24, which is the wall-clock spread CLAUDE.md's
// tracked debt records for this machine (the same 428 tests have taken 48 s and
// 307 s on unchanged code). A REPORT that can go red under load is worse than
// no report, because the red says nothing about the code.
const REPORT_TIMEOUT_MS = 120_000;

const pad = (value: string | number, width: number) => String(value).padStart(width);
const describeUnit = (unit: string) => (unit === "\t" ? "tab" : `${unit.length}sp`);

/**
 * Whether a section's body is stepped in under its header, by the same rule
 * `Layout.sectionLevel` uses: the minimum column over everything in the section
 * that starts a line, excluding the interior of a multi-line comment.
 *
 * Reimplemented here rather than exported from `layout.ts` on purpose. A
 * reporter that calls the code it measures can only ever confirm that code is
 * self-consistent; this one is meant to be readable against the corpus by hand.
 */
function sectionIsIndented(parse: ParseResult, section: SectionNode, endTok: number): boolean | undefined {
  let sawEvidence = false;
  for (let i = section.header + 1; i < endTok; i++) {
    if (parse.tokens[i].isTrivia && parse.tokens[i - 1].isTrivia) continue;
    const start = parse.tokens[i].start;
    const lineStart = parse.lineOffsets[lineOfOffset(parse.lineOffsets, start)];
    const before = parse.source.slice(lineStart, start);
    if (!/^[ \t]*$/.test(before)) continue;
    if (before.length === 0) return false;
    sawEvidence = true;
  }
  return sawEvidence ? true : undefined;
}

it("formatter corpus census", () => {
  expect(FILES.length).toBeGreaterThan(0);

  const rows: string[] = [];
  let totalLines = 0;
  let totalChanged = 0;
  let totalEdits = 0;
  let untouched = 0;
  let inlineKept = 0;
  let expandedKept = 0;
  let strayTokens = 0;
  let worstMs = 0;
  let worstName = "";
  let totalMs = 0;

  // Sec.5.0's two conventions, counted the way the design states them.
  let flatSections = 0;
  let indentedSections = 0;
  let allFlatFiles = 0;
  let allIndentedFiles = 0;
  let mixedFiles = 0;

  for (const path of FILES) {
    const name = path.slice(MAPS_DIR.length + 1);
    const source = readFileSync(path, "utf8");
    const parse = parseRms(source, lang);

    const started = performance.now();
    const result = formatScript(parse, {});
    const ms = performance.now() - started;
    totalMs += ms;
    if (ms > worstMs) {
      worstMs = ms;
      worstName = name;
    }

    const lines = parse.lineOffsets.length;
    totalLines += lines;
    totalChanged += result.stats.changedLines;
    totalEdits += result.edits.length;
    if (result.edits.length === 0) untouched++;
    inlineKept += result.stats.inlineKept;
    expandedKept += result.stats.expandedKept;
    strayTokens += result.stats.strayTokens;

    let flat = 0;
    let indented = 0;
    for (let k = 0; k < parse.script.sections.length; k++) {
      const endTok = parse.script.sections[k + 1]?.header ?? parse.tokens.length;
      const verdict = sectionIsIndented(parse, parse.script.sections[k], endTok);
      if (verdict === true) indented++;
      else if (verdict === false) flat++;
    }
    flatSections += flat;
    indentedSections += indented;
    if (flat + indented > 0) {
      if (indented === 0) allFlatFiles++;
      else if (flat === 0) allIndentedFiles++;
      else mixedFiles++;
    }

    rows.push(
      `${pad(result.stats.changedLines, 6)}/${pad(lines, 6)} lines  ${pad(result.edits.length, 5)} edits  ` +
        `${pad(Math.round(ms), 4)}ms  ${pad(describeUnit(result.stats.indentUnit), 3)}  ` +
        `${pad(indented, 2)}/${pad(flat + indented, 2)} sections indented  ${name}`,
    );
  }

  const pct = (part: number, whole: number) => (whole === 0 ? "0" : String(Math.round((1000 * part) / whole) / 10));

  console.log(`\nPER FILE, at the shipped defaults (all-preserve):\n${rows.join("\n")}`);
  console.log(`\nFILES ${FILES.length}, of which ${untouched} need no edit at all`);
  console.log(`LINES ${totalLines}, changed ${totalChanged} (${pct(totalChanged, totalLines)}%), edits ${totalEdits}`);
  console.log(
    `BLOCKS (Sec.3.1) inline ${inlineKept}, expanded ${expandedKept} — ` +
      `${pct(inlineKept, inlineKept + expandedKept)}% of blocks are one-liners`,
  );
  console.log(
    `SECTION BODIES (Sec.5.0) flat ${flatSections}, indented ${indentedSections} — ` +
      `files: ${allFlatFiles} never indent one, ${allIndentedFiles} always do, ${mixedFiles} mixed`,
  );
  console.log(`STRAY TOKENS ${strayTokens} (parser-design Sec.12 says this must be 0)`);
  console.log(`TIME ${Math.round(totalMs)}ms total, worst ${Math.round(worstMs)}ms on ${worstName}`);
}, REPORT_TIMEOUT_MS);

/**
 * The rest of the design's pinned figures, the ones that decided a DEFAULT.
 *
 * Separated from the census above because these are properties of the corpus
 * rather than of the formatter: they answer "what do authors already do", which
 * is what every `preserve` default in options.ts rests on. Nothing here runs
 * `formatScript`.
 */
it("formatter corpus conventions", () => {
  expect(FILES.length).toBeGreaterThan(0);

  const column = (parse: ParseResult, tokenIndex: number): number | undefined => {
    const start = parse.tokens[tokenIndex].start;
    const lineStart = parse.lineOffsets[lineOfOffset(parse.lineOffsets, start)];
    const before = parse.source.slice(lineStart, start);
    return /^[ \t]*$/.test(before) ? before.length : undefined;
  };
  const lineOfToken = (parse: ParseResult, tokenIndex: number) =>
    lineOfOffset(parse.lineOffsets, parse.tokens[tokenIndex].start);

  let tabFiles = 0;
  let crlfFiles = 0;
  let noFinalNewlineFiles = 0;
  let trailingWsLines = 0;
  let nonBlankLines = 0;
  let alignedLines = 0;

  let braceOwnLine = 0;
  let braceHeaderLine = 0;
  let inlineWithConditional = 0;
  let inlineTotal = 0;

  let ifBodyIndented = 0;
  let ifBodyLevel = 0;
  let chanceIndented = 0;
  let chanceLevel = 0;

  let ownLineComments = 0;
  let commentGroups = 0;
  const groupFiles = new Set<string>();

  for (const path of FILES) {
    const name = path.slice(MAPS_DIR.length + 1);
    const source = readFileSync(path, "utf8");
    const parse = parseRms(source, lang);

    // --- file-level shape (Sec.5.3) ---------------------------------------
    let crlf = 0;
    let lf = 0;
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== "\n") continue;
      if (i > 0 && source[i - 1] === "\r") crlf++;
      else lf++;
    }
    if (crlf > lf) crlfFiles++;
    if (source.length > 0 && !source.endsWith("\n")) noFinalNewlineFiles++;
    if (formatScript(parse, {}).stats.indentUnit === "\t") tabFiles++;

    for (const raw of source.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.trim() === "") continue;
      nonBlankLines++;
      if (/[ \t]$/.test(line)) trailingWsLines++;
      // Column alignment: a run of two spaces or a tab BETWEEN two words, not
      // the leading indent, which every file has.
      if (/\S(?:  +|\t)\S/.test(line.replace(/^[ \t]+/, ""))) alignedLines++;
    }

    // --- constructs (Sec.3.1, Sec.3.3, Sec.5) ------------------------------
    const visit = (items: readonly Item[]): void => {
      for (const item of items) {
        if (item.kind === "command" || item.kind === "orphanBlock") {
          const block = item.kind === "command" ? item.block : item.block;
          if (block) {
            const oneLine = lineOfToken(parse, item.firstToken) === lineOfToken(parse, item.lastToken);
            if (oneLine) {
              inlineTotal++;
              if (block.items.some((i) => i.kind !== "attribute")) inlineWithConditional++;
            } else if (item.kind === "command") {
              // Where the author put `{` when the block really is multi-line.
              if (lineOfToken(parse, block.open) === lineOfToken(parse, block.open - 1)) braceHeaderLine++;
              else braceOwnLine++;
            }
            visit(block.items);
          }
        } else if (item.kind === "if") {
          for (const branch of item.branches) {
            const keyword = column(parse, branch.keyword);
            for (const child of branch.items) {
              const inner = column(parse, child.firstToken);
              if (keyword === undefined || inner === undefined) continue;
              if (inner > keyword) ifBodyIndented++;
              else ifBodyLevel++;
            }
            visit(branch.items);
          }
        } else if (item.kind === "random") {
          const start = column(parse, item.start);
          for (const branch of item.branches) {
            const chance = column(parse, branch.chanceKeyword);
            if (start !== undefined && chance !== undefined) {
              if (chance > start) chanceIndented++;
              else chanceLevel++;
            }
            visit(branch.items);
          }
          visit(item.preamble);
        }
      }
    };
    visit(parse.script.preamble);
    for (const section of parse.script.sections) visit(section.items);

    // --- comment-headed groups (Sec.4.4) -----------------------------------
    // Comments are not Items, so this runs over TOKENS: a trivia run that
    // starts a line, followed by line-leading tokens at a deeper column. The
    // formatter's own rule is stricter (it scans one SIBLING LIST, so a
    // command's indented block cannot be mistaken for a group); this is the
    // loose upper bound, which is the number worth knowing about a corpus.
    for (let i = 0; i < parse.tokens.length; i++) {
      const token = parse.tokens[i];
      if (!token.isTrivia) continue;
      if (i > 0 && parse.tokens[i - 1].isTrivia) continue;
      const openedAt = column(parse, i);
      if (openedAt === undefined) continue;
      ownLineComments++;
      let members = 0;
      for (let k = i + 1; k < parse.tokens.length; k++) {
        if (parse.tokens[k].isTrivia && parse.tokens[k - 1].isTrivia) continue;
        const col = column(parse, k);
        if (col === undefined) continue;
        if (col > openedAt) members++;
        else break;
      }
      if (members >= 2) {
        commentGroups++;
        groupFiles.add(name);
      }
    }
  }

  const pct = (part: number, whole: number) => (whole === 0 ? "0" : String(Math.round((1000 * part) / whole) / 10));

  console.log(`\nCONVENTIONS over ${FILES.length} scripts:`);
  console.log(`  indent unit (Sec.5.3)   tabs ${tabFiles} files, spaces ${FILES.length - tabFiles}`);
  console.log(`  line endings (Sec.5.3)  CRLF ${crlfFiles} files, LF ${FILES.length - crlfFiles}`);
  console.log(`  final newline (Sec.5.3) absent in ${noFinalNewlineFiles} files`);
  console.log(`  trailing space (Sec.5.3) ${trailingWsLines} of ${nonBlankLines} non-blank lines`);
  console.log(`  column alignment (Sec.5.2) ${alignedLines} of ${nonBlankLines} non-blank lines (${pct(alignedLines, nonBlankLines)}%)`);
  console.log(`  opening brace (Sec.5)   own line ${braceOwnLine}, header line ${braceHeaderLine} (multi-line blocks only)`);
  console.log(`  if bodies (Sec.5)       indented ${ifBodyIndented}, level with the keyword ${ifBodyLevel}`);
  console.log(`  percent_chance (Sec.5)  indented ${chanceIndented}, level with start_random ${chanceLevel}`);
  console.log(`  one-line blocks holding a conditional (Sec.3.3) ${inlineWithConditional} of ${inlineTotal}`);
  console.log(`  comment groups (Sec.4.4) ${commentGroups} of ${ownLineComments} own-line comments, in ${groupFiles.size} files`);
}, REPORT_TIMEOUT_MS);
