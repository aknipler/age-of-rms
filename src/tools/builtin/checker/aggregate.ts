/**
 * Sec.4.2's aggregation key and three-state cell model
 * (consistency-checker-design.md). Groups `CommandReport`s by `(commandSpan,
 * playerCount)`, summing `attempted`/`placed` and coalescing `failures` by
 * bucket — the same shape `pushFailure` already uses within one run, applied
 * again here across N runs.
 *
 * **The record needs a THIRD field or the report cannot tell "attempted
 * nothing" from "was not in the script here".** `runsContaining` is how many
 * of the batch's runs actually produced a report for this span at all —
 * `runsContaining === 0` is ABSENT (no entry, see below), between 0 and
 * `runs` is PARTIALLY PRESENT, and `runs` itself is FULLY PRESENT.
 */

import type { Span } from "../../../parser/types";
import type { CommandReport, FailureBucket, PlacementFailure, SimulationNote, StageId } from "../../../preview/generator/types";

// ---------------------------------------------------------------------------
// CommandReport aggregation
// ---------------------------------------------------------------------------

export interface AggregateCell {
  /** Of the runs in this player count's batch, how many contained this commandSpan at all. 0 is never stored — see `MonteCarloAggregate.rows`'s own doc. */
  runsContaining: number;
  attempted: number;
  placed: number;
  /** Coalesced by bucket, matching `pushFailure`'s own within-run shape, carried across every run that contributed. */
  failures: Map<FailureBucket, PlacementFailure>;
}

export interface AggregateRow {
  commandSpan: Span;
  stage: StageId;
  /**
   * Present ONLY for player counts where `runsContaining > 0` — Sec.4.2's own
   * point: "`runsContaining === 0` is ABSENT" is stated as a domain fact
   * about the record, and the natural implementation is a map with no entry
   * rather than an entry reading zero (Sec.4.5 names this exact distinction
   * as the primary form, with an explicit `runs === 0` test as the backstop
   * for an implementation that pre-seeds empty cells instead).
   */
  cells: Map<number, AggregateCell>;
}

function spanKey(span: Span): string {
  return `${span.start}-${span.end}`;
}

/**
 * Accumulates `CommandReport`s and `SimulationNote`s across every generation
 * the Monte Carlo loop runs, across every selected player count. One
 * instance per tool run.
 */
export class MonteCarloAggregate {
  private readonly rows = new Map<string, AggregateRow>();
  private readonly runsPerCount = new Map<number, number>();
  private readonly notes = new NoteAggregate();
  private sourceLength = 0;

  setSourceLength(length: number): void {
    this.sourceLength = length;
  }

  /** Called once per completed generation, BEFORE folding in its reports — a count's `runs` tracks how many generations were attempted at it, independent of which commandSpans any one of them produced. */
  addGeneration(playerCount: number, reports: readonly CommandReport[], notes: readonly SimulationNote[]): void {
    this.runsPerCount.set(playerCount, (this.runsPerCount.get(playerCount) ?? 0) + 1);
    for (const report of reports) {
      const key = spanKey(report.commandSpan);
      let row = this.rows.get(key);
      if (!row) {
        row = { commandSpan: report.commandSpan, stage: report.stage, cells: new Map() };
        this.rows.set(key, row);
      }
      let cell = row.cells.get(playerCount);
      if (!cell) {
        cell = { runsContaining: 0, attempted: 0, placed: 0, failures: new Map() };
        row.cells.set(playerCount, cell);
      }
      cell.runsContaining++;
      cell.attempted += report.attempted;
      cell.placed += report.placed;
      for (const f of report.failures) {
        const existing = cell.failures.get(f.bucket);
        if (existing) existing.occurrences = (existing.occurrences ?? 1) + (f.occurrences ?? 1);
        else cell.failures.set(f.bucket, { ...f, occurrences: f.occurrences ?? 1 });
      }
    }
    this.notes.addGeneration(notes);
  }

  /** Generations attempted so far at `playerCount` — the batch's own `runs`, not a per-row figure. */
  runsAt(playerCount: number): number {
    return this.runsPerCount.get(playerCount) ?? 0;
  }

  /** Every row accumulated SO FAR. A `partial` built from this ranges only over `runsAt(pc) > 0` counts — Sec.4.5's own rule; the caller enforces that domain, this method just returns what exists. */
  allRows(): readonly AggregateRow[] {
    return [...this.rows.values()];
  }

  countsRun(): readonly number[] {
    return [...this.runsPerCount.keys()];
  }

  noteGroups(): readonly NoteGroup[] {
    return this.notes.groups(this.sourceLength);
  }
}

export type CellState = "absent" | "zeroAttempt" | "rated";

export function cellStateOf(cell: AggregateCell | undefined): CellState {
  if (!cell || cell.runsContaining === 0) return "absent";
  return cell.attempted === 0 ? "zeroAttempt" : "rated";
}

// ---------------------------------------------------------------------------
// Sec.5.4: notes passthrough — an ORDERED pipeline, and every step is load-
// bearing at the DEFAULTS (60 generations), not at one generation:
//   1. group by KEY, collapsing same-key/different-text into a range;
//   2. group the result by TEXT;
//   3. dedupe spans WITHIN the group (steps 1 and 2 both concatenate);
//   4. overlap-merge, for the covered fraction ONLY — the table renders the
//      deduped-but-unmerged spans, one row each.
// Step 3 was the step this file's own comment enumerated and did not
// implement, at a cost of `count = 58` for one place on `AK_Namatjira`.
// ---------------------------------------------------------------------------

export interface NoteGroup {
  text: string;
  /** Distinct spans, deduped across runs AND across the keys/texts the group merged (the SAME span reported by two runs, or by two texts under one key, counts once) — NOT overlap-merged, since this is what the table renders one row per. */
  spans: Span[];
  /**
   * Sec.5.4: the group's DISTINCT OCCURRENCES, which is `spans.length` only
   * when every note in it carried a span. A spanless `(key, text)` pair
   * contributes 1 — it happened, at a place the note does not name — so the
   * spanless branch reports a real number instead of the `0` a span-derived
   * count gives it.
   */
  count: number;
  /** `undefined` for a spanless group (no table, no fraction — Sec.5.4's own rule). Computed from the OVERLAP-MERGED union of spans, never the naive sum (Sec.4.5's 1418% defect). */
  coveredFraction?: number;
}

/**
 * Sec.5.4's "a note whose interpolated text differs across two runs at one
 * key... one group carrying a RANGE rather than two groups". `String.split`
 * on a capturing digit-run regex gives alternating [literal, digits,
 * literal, digits, ..., literal] segments with no placeholder character
 * needed — comparing the literal segments for equality across texts decides
 * collapsibility, and only the digit segments get ranged.
 *
 * Returns `undefined` when the texts are not merely a numeric difference —
 * the caller must then keep each text as its OWN entry rather than silently
 * dropping the ones that lost a collapse (a first version of this function
 * fell back to `texts[0]`, which discarded every OTHER text's spans under a
 * genuinely-different-text key).
 */
function tryRangeCollapse(texts: readonly string[]): string | undefined {
  if (texts.length === 1) return texts[0];
  const parts = texts.map((t) => t.split(/(\d+)/));
  const shape = parts[0];
  for (const p of parts) {
    if (p.length !== shape.length) return undefined;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] !== shape[i]) return undefined; // even indices are the literal segments between digit runs
    }
  }
  const out = [...shape];
  for (let i = 1; i < out.length; i += 2) {
    // odd indices are the captured digit runs
    const values = parts.map((p) => Number(p[i]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    out[i] = min === max ? String(min) : `${min}-${max}`;
  }
  return out.join("");
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

interface TextBucket {
  spans: Map<string, Span>;
  /** This `(key, text)` pair was reported at least once with NO span — one distinct occurrence with nowhere to point. Deduped the same way a span is, so it does not multiply by the run count either. */
  spanless: boolean;
}

/** A step-1 entry: one key's collapsed text, its spans, and how many spanless `(key, text)` pairs folded into it. */
interface CollapsedEntry {
  text: string;
  spans: Span[];
  spanlessCount: number;
}

/**
 * Note keys this TOOL does not pass through, and the category is narrow on
 * purpose.
 *
 * Sec.5.4's passthrough exists so the checker does not re-derive its own
 * opinion about what the preview could not check — so the bar for excluding a
 * note is not "low value", it is **"this is not a statement about what the
 * preview could not check at all"**. `automaticBeach` describes engine
 * behaviour the preview models CORRECTLY and completely: beach appears where
 * ground meets deeper ground. It is a true sentence in the wrong section, it
 * fires on most of the corpus, and in the Advanced Tools pane it pushes real
 * findings down the page — which is the one cost this report cannot afford,
 * since a report nobody scrolls to the bottom of has hidden the thing it was
 * run to find.
 *
 * It stays in the PREVIEW PANE's own drawer, where a reader who does not yet
 * know the rule is the audience. This set is the checker's alone.
 *
 * Everything that is genuinely "we approximated / skipped / could not see
 * this" stays, including the cheap-sounding ones (`behaviorVersion2`,
 * `atColor`) — those are real limitations, and a limitation with low
 * consequence is still a limitation.
 */
export const NOTE_KEYS_NOT_PASSED_THROUGH: ReadonlySet<string> = new Set(["automaticBeach"]);

class NoteAggregate {
  /** key -> text -> the spans seen under that `(key, text)` pair (deduped by span string) plus whether it was ever reported with no span at all. */
  private readonly byKeyText = new Map<string, Map<string, TextBucket>>();

  addGeneration(notes: readonly SimulationNote[]): void {
    for (const note of notes) {
      // Dropped at INGESTION rather than at render, so the group counts and
      // the covered fraction describe exactly what the report shows. A note
      // filtered on the way out would leave both quietly measuring a
      // population the reader never sees.
      if (NOTE_KEYS_NOT_PASSED_THROUGH.has(note.key)) continue;
      let byText = this.byKeyText.get(note.key);
      if (!byText) {
        byText = new Map();
        this.byKeyText.set(note.key, byText);
      }
      let bucket = byText.get(note.text);
      if (!bucket) {
        bucket = { spans: new Map(), spanless: false };
        byText.set(note.text, bucket);
      }
      if (note.span) bucket.spans.set(spanKey(note.span), note.span);
      else bucket.spanless = true;
    }
  }

  groups(sourceLength: number): NoteGroup[] {
    // Step 1: per key, collapse to ONE ranged entry when every text under it
    // differs only numerically; otherwise keep each text as its own entry —
    // never merge spans into a text that was not theirs.
    const collapsed: CollapsedEntry[] = [];
    for (const byText of this.byKeyText.values()) {
      const texts = [...byText.keys()];
      const ranged = tryRangeCollapse(texts);
      if (ranged !== undefined) {
        const spans: Span[] = [];
        let anySpanless = false;
        for (const t of texts) {
          const bucket = byText.get(t)!;
          spans.push(...bucket.spans.values());
          if (bucket.spanless) anySpanless = true;
        }
        // ONE occurrence for the whole collapsed key, not one per text it
        // interpolated. `sample.rms`'s `automaticBeach` note is one spanless
        // note whose text carries a per-run tile count, so across the 60
        // default generations it produces 14 distinct texts under one key —
        // counting the buckets reports 14 occurrences of a thing that
        // happened once per run and is being reported once. This is the same
        // "the count must not track the run count" rule the span dedupe below
        // enforces, on the branch where there is no span to dedupe by.
        collapsed.push({ text: ranged, spans, spanlessCount: anySpanless ? 1 : 0 });
      } else {
        for (const t of texts) {
          const bucket = byText.get(t)!;
          collapsed.push({ text: t, spans: [...bucket.spans.values()], spanlessCount: bucket.spanless ? 1 : 0 });
        }
      }
    }

    // Step 2: group by TEXT — multiple KEYS sharing one literal sentence
    // (S0's per-span `unsimulated:<span>` notes are the dominant case) merge here.
    const byText = new Map<string, { spans: Span[]; spanlessCount: number }>();
    for (const { text, spans, spanlessCount } of collapsed) {
      const existing = byText.get(text);
      if (existing) {
        existing.spans.push(...spans);
        existing.spanlessCount += spanlessCount;
      } else {
        byText.set(text, { spans: [...spans], spanlessCount });
      }
    }

    const groups: NoteGroup[] = [];
    for (const [text, { spans: rawSpans, spanlessCount }] of byText) {
      // Step 3 (Sec.5.4's fourth pipeline step): dedupe spans WITHIN the
      // group. The `(key, text)` bucket above deduped only within one text
      // under one key, so a key whose text interpolates a per-run number
      // re-contributes the same span once per distinct text, and step 2
      // re-contributes it once per key sharing the sentence. Without this the
      // rendered table's row count is a function of `runsPerPlayerCount`.
      const distinct = new Map<string, Span>();
      for (const s of rawSpans) distinct.set(spanKey(s), s);
      const spans = [...distinct.values()];

      if (spans.length === 0) {
        groups.push({ text, spans: [], count: spanlessCount });
        continue;
      }
      const merged = mergeSpans(spans);
      const coveredChars = merged.reduce((sum, s) => sum + (s.end - s.start), 0);
      groups.push({
        text,
        spans,
        count: spans.length + spanlessCount,
        coveredFraction: sourceLength > 0 ? coveredChars / sourceLength : 0,
      });
    }
    return groups;
  }
}
