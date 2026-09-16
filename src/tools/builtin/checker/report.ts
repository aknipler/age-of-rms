/**
 * Sec.5's report builder (consistency-checker-design.md). Turns a
 * `MonteCarloAggregate` plus Sec.3's static findings into the `OutputBlock[]`
 * the pane renders: one finding table per stage-scoped entity kind (Sec.5.1),
 * a static-finding `severity` block per Sec.3 finding, a summary header
 * (Sec.5.2) and a notes passthrough (Sec.5.4).
 */

import { lineNumberOfOffset } from "../../../parser/lineIndex";
import type { Span } from "../../../parser/types";
import type { InstantiatedScript } from "../../../preview/generator/types";
import type { OutputBlock } from "../../../../tools-api/index";
import type { AggregateCell, AggregateRow, MonteCarloAggregate, NoteGroup } from "./aggregate";
import { cellStateOf } from "./aggregate";
import type { StaticFinding } from "./staticChecks";

// ---------------------------------------------------------------------------
// Sec.5.1: the finding table
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  S1: "Land",
  S2: "Elevation",
  S3: "Cliff",
  S4: "Terrain",
  S5: "Connection",
  S6: "Object",
};

const ZERO_SPAN_MARKER = "0-0";
const NON_NUMERIC = "—";

interface WorstCountResult {
  playerCount: number;
  state: "rated" | "zeroAttempt";
}

/**
 * Sec.5.1's three-state ranking. ABSENT counts are excluded entirely, not
 * ranked as a rate, not as a zero. A ZERO-ATTEMPT count ranks BELOW every
 * rate (the worst outcome the matrix contains), never merely excluded. Ties
 * among rated counts break toward the LOWEST player count, which falls out
 * for free from iterating `selectedCounts` ascending and only updating on a
 * STRICT rate improvement.
 */
function findWorstCount(cells: ReadonlyMap<number, AggregateCell>, selectedCounts: readonly number[]): WorstCountResult | undefined {
  const ascending = [...selectedCounts].sort((a, b) => a - b);
  const present = ascending.filter((pc) => cellStateOf(cells.get(pc)) !== "absent");
  if (present.length === 0) return undefined;

  const zeroAttempt = present.filter((pc) => cellStateOf(cells.get(pc)) === "zeroAttempt");
  if (zeroAttempt.length > 0) return { playerCount: zeroAttempt[0], state: "zeroAttempt" };

  let best: { pc: number; rate: number } | undefined;
  for (const pc of present) {
    const cell = cells.get(pc)!;
    const rate = cell.placed / cell.attempted;
    if (!best || rate < best.rate) best = { pc, rate };
  }
  return { playerCount: best!.pc, state: "rated" };
}

function formatBuckets(cell: AggregateCell | undefined): string {
  if (!cell || cell.failures.size === 0) return "";
  return [...cell.failures.entries()].map(([bucket, f]) => `${bucket} ×${f.occurrences ?? 1}`).join(", ");
}

function playerCountList(counts: readonly number[]): string {
  return counts.map((c) => String(c)).join(", ");
}

/**
 * The per-count annotation Sec.5.1 requires for a row that is absent or
 * zero-attempt at SOME but not all selected counts, stated as part of the
 * row's reason, never implied by a bare rate. The three populations are not
 * disjoint; a row in more than one says so in one sentence, per clause.
 */
function buildAnnotation(cells: ReadonlyMap<number, AggregateCell>, selectedCounts: readonly number[]): string | undefined {
  const ascending = [...selectedCounts].sort((a, b) => a - b);
  const present = ascending.filter((pc) => cellStateOf(cells.get(pc)) !== "absent");
  const absent = ascending.filter((pc) => cellStateOf(cells.get(pc)) === "absent");
  const zeroAttempt = ascending.filter((pc) => cellStateOf(cells.get(pc)) === "zeroAttempt");

  const clauses: string[] = [];
  if (absent.length > 0 && present.length > 0) {
    clauses.push(`this command is only generated at ${playerCountList(present)} player${present.length === 1 ? "" : "s"}`);
  }
  if (zeroAttempt.length > 0 && zeroAttempt.length < present.length) {
    clauses.push(`attempted nothing at ${playerCountList(zeroAttempt)}`);
  }
  return clauses.length > 0 ? clauses.join("; ") : undefined;
}

export interface StageReasonContext {
  /** One `InstantiatedScript` per selected player count, Sec.3.0 rule 1 already builds these for the static layer. */
  instByCount: ReadonlyMap<number, InstantiatedScript>;
  /** Sec.3.4's own comparison, so the S3 zero-attempt reason and the static finding agree on the SAME script. */
  cliffsContradiction: boolean;
  /** Span starts of `connectionBlockedByBug:<span>` notes actually observed. */
  connectionBlockedSpans: ReadonlySet<number>;
}

/**
 * Sec.5.1: "every such row still says why, in words, from the failure
 * buckets where it has them, and where it has none, from what the stage
 * resolved." The seven zero-attempt paths with no bucket at all (S2's
 * `MaxHeight <= 0`, S3's min>max contradiction, S5's empty pairing / bug-
 * neutralised) need this; every other stage's reason already lives in its
 * bucket cell.
 */
function stageReason(row: AggregateRow, worst: WorstCountResult, ctx: StageReasonContext): string | undefined {
  if (row.stage === "S2" && worst.state === "zeroAttempt") {
    const inst = ctx.instByCount.get(worst.playerCount);
    const cmd = inst && findCommandBySpan(inst, row.commandSpan);
    if (cmd?.name === "create_elevation") {
      return "this command's MaxHeight is 0, so it raises nothing";
    }
  }
  if (row.stage === "S3" && worst.state === "zeroAttempt" && ctx.cliffsContradiction) {
    return "this section asks for more cliffs at its minimum than it allows at its maximum, so no cliffs are generated";
  }
  if (row.stage === "S5" && worst.state === "zeroAttempt") {
    if (ctx.connectionBlockedSpans.has(row.commandSpan.start)) {
      return "this connection was neutralised by the create_connect_to_nonplayer_land command above it, a documented engine bug the preview reproduces";
    }
    return "this command connects nothing, because one side of the pairing is empty";
  }
  return undefined;
}

function findCommandBySpan(inst: InstantiatedScript, span: Span) {
  for (const [, commands] of inst.sections) {
    for (const cmd of commands) {
      if (cmd.span.start === span.start && cmd.span.end === span.end) return cmd;
    }
  }
  return undefined;
}

/** Sec.5.1's Command column: the source slice at `commandSpan`, first line trimmed, EXCEPT S3, which always takes the stage label, because no S3 report has a command of its own by construction. */
function commandLabel(row: AggregateRow, source: string): string {
  if (row.stage === "S3") return "Cliff generation (whole section)";
  const slice = source.slice(row.commandSpan.start, row.commandSpan.end);
  return slice.split("\n")[0].trim();
}

/**
 * Sec.5.1's `{0,0}` backstop applies UNIFORMLY across every stage, S3
 * included: `{0,0}` is what a FAILED borrow looks like, not what a borrowed
 * span looks like. `cliffs.ts` emits one report for the whole section
 * whether or not the borrow found something to take, so a real, non-zero
 * borrowed span is a genuine clickable offset and stays linked even though
 * the COMMAND LABEL (above) always reads the stage name regardless.
 */
function rowSpanFor(row: AggregateRow): Span | null {
  if (spanKeyString(row.commandSpan) === ZERO_SPAN_MARKER) return null;
  return row.commandSpan;
}

/**
 * A location named in PROSE is a 1-BASED LINE NUMBER; a `span` stays a
 * character OFFSET, because Monaco and `useSharedSelection` consume it.
 * This repo shipped seven diagnostics reading "already set at offset 86970",
 * a position no editor displays, so the one actionable fact in each message
 * was unreachable. `scriptStats.ts` is the standing exemplar; the clickable
 * offset always rides alongside in `rowSpans`.
 */
function lineLabel(lineOffsets: readonly number[], span: Span | undefined): string {
  return span ? `line ${lineNumberOfOffset(lineOffsets, span.start)}` : "\u2014";
}

function spanKeyString(span: Span): string {
  return `${span.start}-${span.end}`;
}

export interface FindingTableOptions {
  source: string;
  selectedCounts: readonly number[];
  reasonCtx: StageReasonContext;
  /** commandSpans of Sec.3.2's `actor_area_to_place_in` findings, Sec.5.1's suppression rule, keyed by `start-end`. */
  suppressedActorAreaMissing: ReadonlySet<string>;
  /** Sec.5.1's noise filter: drop rows with nothing to report. The count of dropped rows is always printed (see `buildFindingTables`). */
  hideHealthy: boolean;
}

/**
 * A row is HEALTHY only when there is nothing whatsoever to say about it:
 * every player count where the command exists is rated, placed everything it
 * attempted, and carries no failure bucket, no stage reason and no per-count
 * annotation.
 *
 * Deliberately strict on all four, because each of the other states is a
 * finding in its own right and hiding one would defeat the filter's purpose:
 * a ZERO-ATTEMPT count has no rate at all and is the worst outcome the matrix
 * contains (Sec.5.1); a failure bucket is the report's primary evidence; a
 * stage reason is one of the seven bucketless zero-attempt paths; and an
 * annotation says the command is absent at some counts, which is a fact about
 * the script the spawn rate cannot express. **A row at 100% with a bucket is
 * not healthy**, it placed everything eventually, having missed on the way,
 * and that is exactly the intermittent case this tool exists to surface.
 */
function isHealthyRow(row: AggregateRow, opts: { selectedCounts: readonly number[]; reasonCtx: StageReasonContext; worst: WorstCountResult }): boolean {
  if (opts.worst.state !== "rated") return false;
  for (const pc of opts.selectedCounts) {
    const cell = row.cells.get(pc);
    if (cellStateOf(cell) === "absent") continue;
    if (cellStateOf(cell) === "zeroAttempt") return false;
    if (cell!.placed !== cell!.attempted) return false;
    if (cell!.failures.size > 0) return false;
  }
  if (buildAnnotation(row.cells, opts.selectedCounts) !== undefined) return false;
  if (stageReason(row, opts.worst, opts.reasonCtx) !== undefined) return false;
  return true;
}

/** One `OutputBlock` per stage that produced at least one row. */
export function buildFindingTables(aggregate: MonteCarloAggregate, opts: FindingTableOptions): OutputBlock[] {
  const byStage = new Map<string, AggregateRow[]>();
  for (const row of aggregate.allRows()) {
    const list = byStage.get(row.stage);
    if (list) list.push(row);
    else byStage.set(row.stage, [row]);
  }

  const blocks: OutputBlock[] = [];
  let hidden = 0;
  for (const stage of ["S1", "S2", "S3", "S4", "S5", "S6"]) {
    const rows = byStage.get(stage);
    if (!rows || rows.length === 0) continue;

    const tableRows: string[][] = [];
    const rowSpans: (Span | null)[] = [];

    for (const row of rows) {
      const worst = findWorstCount(row.cells, opts.selectedCounts);
      if (!worst) continue; // defensive: a row with no present count cannot happen, since it was only created from a real report

      if (opts.hideHealthy && isHealthyRow(row, { selectedCounts: opts.selectedCounts, reasonCtx: opts.reasonCtx, worst })) {
        hidden++;
        continue;
      }

      const cell = row.cells.get(worst.playerCount);
      // Sec.5.1: a row whose `runsContaining` is below the batch size SAYS ITS
      // DENOMINATOR. A rate summed over 1 of 15 runs is ranked against one
      // summed over 15 of 15 by `findWorstCount` above, so the bare
      // percentage is the one number in the table a reader cannot weigh.
      const runsInBatch = aggregate.runsAt(worst.playerCount);
      const denominator = cell !== undefined && runsInBatch > 0 && cell.runsContaining < runsInBatch ? ` (generated in ${cell.runsContaining} of ${runsInBatch} runs)` : "";
      const spawnRate = worst.state === "rated" ? `${((cell!.placed / cell!.attempted) * 100).toFixed(1)}%${denominator}` : `${NON_NUMERIC}${denominator}`;

      let buckets = formatBuckets(cell);
      const suppressed = row.stage === "S6" && opts.suppressedActorAreaMissing.has(spanKeyString(row.commandSpan));
      if (suppressed) buckets = "already reported statically (undeclared actor area)";

      const annotation = buildAnnotation(row.cells, opts.selectedCounts);
      const reason = stageReason(row, worst, opts.reasonCtx);
      const reasonCell = [reason, annotation].filter((c): c is string => c !== undefined).join("; ");
      if (buckets === "" && reasonCell !== "") buckets = reasonCell;
      else if (reasonCell !== "" && buckets !== reasonCell) buckets = `${buckets} (${reasonCell})`;

      tableRows.push([commandLabel(row, opts.source), spawnRate, String(worst.playerCount), buckets, "simulated"]);
      rowSpans.push(rowSpanFor(row));
    }

    if (tableRows.length === 0) continue;
    blocks.push({ kind: "heading", text: `${STAGE_LABELS[stage]} generation` });
    blocks.push({
      kind: "table",
      columns: ["Command", "Spawn rate", "Worst player count", "Failure buckets", "Provenance"],
      rows: tableRows,
      rowSpans,
    });
  }

  // NEVER silently. A filtered table and an empty one are different claims,
  // and a reader who cannot tell them apart has been told the script is clean
  // when it was only quiet. Printed even at 0, so the sentence's absence is
  // never what carries the information.
  if (opts.hideHealthy) {
    blocks.push({
      kind: "text",
      text:
        hidden === 1
          ? "1 command placed everything it attempted at every player count and is hidden."
          : `${hidden} commands placed everything they attempted at every player count and are hidden.`,
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Sec.3's static findings, rendered as their own severity blocks
// ---------------------------------------------------------------------------

/**
 * Sec.5.1: THREE units live here and conflating them is what put 1026 blocks
 * on `Pa_Site_v1.1.rms`, over `LIMITS.maxBlocksPerOutput` (1000), so the tool
 * emitted nothing at all on that map.
 *
 *   - The **occurrence** is what a check emits: one per referencing attribute
 *     (253 `avoid_actor_area` occurrences on `Pa_Site` at one player count).
 *     It is the TABLE ROW unit, bounded by `maxTableRowsRendered` (10,000).
 *   - The **census** unit is Sec.3.2's distinct `(map, id)` pair (134 on
 *     `Pa_Site`), which is what the reporter counts and what the design
 *     document's own figures mean. It is not a rendering unit at all.
 *   - The **block** unit is the FAMILY: one `(kind, severity)` pair renders as
 *     at most one `severity` plus one `table`, whatever the occurrence count.
 *     Seven kinds gives a hard ceiling of 15 blocks including the heading,
 *     which is the term Sec.4.5's cap arithmetic was missing.
 */
const FAMILY_HEADLINE: Record<StaticFinding["kind"], (n: number) => string> = {
  landOverAllocation: (n) => `${n} findings about lands declaring more of the map than there is.`,
  actorAreaUndeclaredToPlaceIn: (n) => `${n} commands name an actor_area_to_place_in that nothing in the script creates, so each of them places nothing.`,
  actorAreaUndeclaredAvoid: (n) => `${n} avoid_actor_area lines name an actor area that nothing in the script creates, so the lines have no effect.`,
  actorAreaUndeclaredSharedBlockReference: (n) => `${n} lines inside shared blocks reference an actor area that nothing in the script creates.`,
  terrainImpossible: (n) => `${n} objects cannot be placed on the terrain they ask for.`,
  minExceedsMaxObjects: (n) => `${n} commands set a minimum greater than their maximum, so they place nothing.`,
  cliffsMinExceedsMax: (n) => `${n} cliff sections ask for more cliffs at their minimum than they allow at their maximum.`,
};

interface CollapsedFinding {
  finding: StaticFinding;
  /** Every selected player count whose pass produced this exact finding, ascending. */
  counts: number[];
}

function findingIdentity(f: StaticFinding): string {
  return [f.kind, f.severity, f.text, f.span ? spanKeyString(f.span) : "-", f.commandSpan ? spanKeyString(f.commandSpan) : "-"].join("\u0000");
}

/**
 * Sec.3.0 rule 1 runs the whole static layer once per selected player count,
 * and on this corpus every finding it produces is identical at all four, so
 * rendered per pass, the output is the same block four times over. Collapse
 * on identity, and say the counts ONLY when a finding does not hold at every
 * selected count (which is the case Sec.3.0 rule 1 exists for; the corpus has
 * none of it today, and the clause is what makes the collapse honest rather
 * than lossy).
 */
export function collapseStaticFindings(findings: readonly StaticFinding[]): CollapsedFinding[] {
  const byIdentity = new Map<string, CollapsedFinding>();
  for (const f of findings) {
    const id = findingIdentity(f);
    const existing = byIdentity.get(id);
    if (existing) {
      if (!existing.counts.includes(f.playerCount)) existing.counts.push(f.playerCount);
    } else {
      byIdentity.set(id, { finding: f, counts: [f.playerCount] });
    }
  }
  for (const c of byIdentity.values()) c.counts.sort((a, b) => a - b);
  return [...byIdentity.values()];
}

/** The count prefix, present only when the finding did NOT hold at every selected count. */
function countPrefix(collapsed: CollapsedFinding, selectedCounts: readonly number[]): string {
  if (collapsed.counts.length >= selectedCounts.length) return "";
  return `At ${playerCountList(collapsed.counts)} player${collapsed.counts.length === 1 ? "" : "s"}: `;
}

export function buildStaticFindingBlocks(findings: readonly StaticFinding[], selectedCounts: readonly number[], lineOffsets: readonly number[]): OutputBlock[] {
  if (findings.length === 0) return [];
  const collapsed = collapseStaticFindings(findings);

  // Group into families by `(kind, severity)`, severity is part of the key
  // because `actorAreaUndeclaredSharedBlockReference` files at `error` or
  // `info` depending on which attribute carried the reference, and one
  // `severity` block carries exactly one level.
  const families = new Map<string, { kind: StaticFinding["kind"]; level: StaticFinding["severity"]; items: CollapsedFinding[] }>();
  for (const c of collapsed) {
    const key = `${c.finding.kind}|${c.finding.severity}`;
    const family = families.get(key);
    if (family) family.items.push(c);
    else families.set(key, { kind: c.finding.kind, level: c.finding.severity, items: [c] });
  }

  const blocks: OutputBlock[] = [{ kind: "heading", text: "Static checks" }];
  for (const family of families.values()) {
    if (family.items.length === 1) {
      const only = family.items[0];
      blocks.push({
        kind: "severity",
        level: family.level,
        text: `${countPrefix(only, selectedCounts)}${only.finding.text}`,
        span: only.finding.span,
      });
      continue;
    }
    // Sec.5.4's own shape, for the same reason: `severity` holds one span and
    // `table.rowSpans` holds many, so a family of N findings is one headline
    // plus one clickable row each, bounded by the ROW cap, not the block cap.
    blocks.push({ kind: "severity", level: family.level, text: FAMILY_HEADLINE[family.kind](family.items.length) });
    blocks.push({
      kind: "table",
      columns: ["Location", "Finding"],
      rows: family.items.map((c) => [lineLabel(lineOffsets, c.finding.span), `${countPrefix(c, selectedCounts)}${c.finding.text}`]),
      rowSpans: family.items.map((c) => c.finding.span ?? null),
    });
  }
  return blocks;
}

/** Sec.5.1's suppression rule: an `actor_area_to_place_in` finding subsumes the Monte Carlo layer's `actorAreaMissing` bucket for the SAME commandSpan, never for a bare `avoid_actor_area` finding, and never for a script Sec.3.2 merely abstained on. */
export function suppressedActorAreaSpans(findings: readonly StaticFinding[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const f of findings) {
    if (f.kind === "actorAreaUndeclaredToPlaceIn" && f.commandSpan) out.add(spanKeyString(f.commandSpan));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sec.5.2: summary header
// ---------------------------------------------------------------------------

export interface SummaryHeaderOptions {
  playerCounts: readonly number[];
  mapSizeName: string;
  runsPerPlayerCount: number;
  baseSeed: number;
  totalGenerations: number;
  elapsedMs: number;
}

export function buildSummaryHeader(opts: SummaryHeaderOptions): OutputBlock {
  return {
    kind: "keyValue",
    rows: [
      ["Player counts run", playerCountList([...opts.playerCounts].sort((a, b) => a - b))],
      ["Map size", opts.mapSizeName],
      ["Runs per player count", String(opts.runsPerPlayerCount)],
      ["Base seed", String(opts.baseSeed)],
      ["Total generations", String(opts.totalGenerations)],
      ["Elapsed", `${(opts.elapsedMs / 1000).toFixed(1)}s`],
      [
        "About this report",
        "The Monte Carlo table's rates are estimates from a limited number of samples, not exact probabilities. A command showing 100% is unobserved-to-fail, not proven reliable. The static checks above them are the tool's only guaranteed findings.",
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Sec.5.4: notes passthrough
// ---------------------------------------------------------------------------

export function buildNotesBlocks(groups: readonly NoteGroup[], lineOffsets: readonly number[]): OutputBlock[] {
  if (groups.length === 0) return [];
  const blocks: OutputBlock[] = [{ kind: "heading", text: "What the preview could not check" }];
  for (const group of groups) {
    const fractionClause =
      group.coveredFraction !== undefined && group.coveredFraction > 0.01
        ? ` This covers ${(group.coveredFraction * 100).toFixed(1)}% of the script.`
        : "";
    // Sec.5.4: "places" is a claim about SPANS, so a spanless group does not
    // make it. Its count is its distinct occurrences, which is 1 for the
    // ordinary run-level note, and a note that occurred is reported as
    // having occurred, never as having occurred in "0 places".
    // "Places" is only honest when every occurrence in the group HAS a place.
    // Sec.5.4 measures no mixed group on this corpus, so the third branch is
    // insurance, but a mixed group counted in "places" would over-claim by
    // exactly its spanless occurrences, which is the defect one unit over.
    const allPlaced = group.spans.length > 0 && group.spans.length === group.count;
    const countClause = allPlaced
      ? ` (${group.count} place${group.count === 1 ? "" : "s"})`
      : group.count > 1
        ? ` (${group.count} times)`
        : "";
    // The generator's note texts are authored sentences and most already end
    // in a full stop, so appending one unconditionally printed "…with
    // beach_terrain..", punctuation invented by the renderer, on text it is
    // supposed to be passing through verbatim.
    const terminator = /[.!?]$/.test(group.text) && countClause === "" ? "" : ".";
    blocks.push({
      kind: "severity",
      level: "info",
      text: `${group.text}${countClause}${terminator}${fractionClause}`,
    });
    if (group.spans.length > 0) {
      blocks.push({
        kind: "table",
        columns: ["Location"],
        rows: group.spans.map((s) => [lineLabel(lineOffsets, s)]),
        rowSpans: group.spans.map((s) => s),
      });
    }
  }
  return blocks;
}
