// consistency-checker-design.md Sec.5.1 (the finding table's three-state
// worst-count rule, the S3 command-label rule, the {0,0} backstop, the S5
// reason discriminator, the suppression rule) and Sec.5.4 (notes blocks).

import { describe, expect, it } from "vitest";
import type { CommandReport } from "../../../../preview/generator/types";
import { MonteCarloAggregate } from "../aggregate";
import {
  buildFindingTables,
  buildNotesBlocks,
  buildStaticFindingBlocks,
  suppressedActorAreaSpans,
  type StageReasonContext,
} from "../report";
import type { StaticFinding } from "../staticChecks";

const SOURCE = "0123456789create_object DEER\nnumber_of_objects 5\n0123456789";
const SPAN = { start: 10, end: 30 }; // "create_object DEER"
/**
 * Offsets of each line's first character in SOURCE, the shape
 * `ParseResult.lineOffsets` carries. A location named in PROSE is a 1-based
 * LINE NUMBER; the clickable `span` stays a character offset.
 */
const LINE_OFFSETS = [
  0,
  SOURCE.indexOf("\n") + 1,
  SOURCE.lastIndexOf("\n") + 1,
];

function report(overrides: Partial<CommandReport> = {}): CommandReport {
  return {
    commandSpan: SPAN,
    stage: "S6",
    attempted: 4,
    placed: 4,
    failures: [],
    ...overrides,
  };
}

const emptyCtx: StageReasonContext = {
  instByCount: new Map(),
  cliffsContradiction: false,
  connectionBlockedSpans: new Set(),
};

function tableRows(blocks: ReturnType<typeof buildFindingTables>) {
  const table = blocks.find((b) => b.kind === "table");
  return table && table.kind === "table" ? table.rows : [];
}

describe("Sec.5.1 worst-player-count ranking", () => {
  it("ties break toward the LOWEST player count when every rate is equal", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(2, [report({ attempted: 1, placed: 1 })], []);
    agg.addGeneration(4, [report({ attempted: 1, placed: 1 })], []);
    agg.addGeneration(8, [report({ attempted: 1, placed: 1 })], []);
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [2, 4, 8],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][2]).toBe("2"); // Worst player count
    expect(rows[0][1]).toBe("100.0%");
  });

  it("a ZERO-ATTEMPT count ranks BELOW every rate — never excluded, never beaten by a real percentage", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(2, [report({ attempted: 0, placed: 0 })], []);
    agg.addGeneration(4, [report({ attempted: 10, placed: 1 })], []); // a bad but real rate
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [2, 4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][2]).toBe("2"); // the zero-attempt count, not the 10% one
    expect(rows[0][1]).toBe("—"); // non-numeric marker, never "0%"
  });

  it("an ABSENT count is never ranked and never named as worst, even when every present count is healthy", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(2, [report({ attempted: 1, placed: 1 })], []);
    agg.addGeneration(4, [], []); // ran, but this row never appeared, ABSENT, not zero
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [2, 4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][2]).toBe("2"); // the only present count
    expect(rows[0][1]).toBe("100.0%"); // its real rate, not a marker
  });

  it("never prints NaN%: a row whose only present count is zero-attempt still renders a marker", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(4, [report({ attempted: 0, placed: 0 })], []);
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][1]).not.toContain("NaN");
    expect(rows[0][1]).toBe("—");
  });
});

describe("Sec.5.1 S3: no report has a command of its own", () => {
  it("always takes the STAGE label, never a source slice, and rowSpans is null", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(
      4,
      [
        {
          commandSpan: { start: 0, end: 0 },
          stage: "S3",
          attempted: 4,
          placed: 4,
          failures: [],
        },
      ],
      [],
    );
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][0]).toBe("Cliff generation (whole section)");
    const table = blocks.find((b) => b.kind === "table");
    expect(
      table && table.kind === "table" ? table.rowSpans?.[0] : "missing",
    ).toBeNull();
  });

  it("takes the stage label even when the borrowed span is real (non-{0,0}) — the borrow SUCCEEDING is what makes it invisible otherwise", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(
      4,
      [
        {
          commandSpan: { start: 5, end: 9 },
          stage: "S3",
          attempted: 4,
          placed: 4,
          failures: [],
        },
      ],
      [],
    );
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][0]).toBe("Cliff generation (whole section)");
    const table = blocks.find((b) => b.kind === "table");
    // the borrow succeeded (non-zero span) so the link is KEPT, not nulled
    expect(
      table && table.kind === "table" ? table.rowSpans?.[0] : null,
    ).toEqual({ start: 5, end: 9 });
  });
});

describe("Sec.5.1 S5 reason discriminator", () => {
  it("names the empty-pairing reason when no connectionBlockedByBug note exists for this span", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(
      4,
      [
        {
          commandSpan: SPAN,
          stage: "S5",
          attempted: 0,
          placed: 0,
          failures: [],
        },
      ],
      [],
    );
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][3]).toContain("one side of the pairing is empty");
  });

  it("names the bug-neutralised reason when a connectionBlockedByBug note is anchored at this exact span", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(
      4,
      [
        {
          commandSpan: SPAN,
          stage: "S5",
          attempted: 0,
          placed: 0,
          failures: [],
        },
      ],
      [],
    );
    const ctx: StageReasonContext = {
      instByCount: new Map(),
      cliffsContradiction: false,
      connectionBlockedSpans: new Set([SPAN.start]),
    };
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: ctx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][3]).toContain("neutralised");
    expect(rows[0][3]).not.toContain("pairing came back empty");
  });
});

describe("Sec.5.1 suppression rule", () => {
  it("replaces the actorAreaMissing bucket cell for a commandSpan Sec.3.2 already reported statically", () => {
    const agg = new MonteCarloAggregate();
    agg.addGeneration(
      4,
      [
        {
          commandSpan: SPAN,
          stage: "S6",
          attempted: 0,
          placed: 0,
          failures: [
            {
              bucket: "actorAreaMissing",
              commandSpan: SPAN,
              stage: "S6",
              entity: "DEER",
              detail: "d",
            },
          ],
        },
      ],
      [],
    );
    const finding: StaticFinding = {
      kind: "actorAreaUndeclaredToPlaceIn",
      severity: "error",
      text: "t",
      commandSpan: SPAN,
      playerCount: 4,
    };
    const suppressed = suppressedActorAreaSpans([finding]);
    const blocks = buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: suppressed,
      hideHealthy: false,
    });
    const rows = tableRows(blocks);
    expect(rows[0][3]).toContain("already reported statically");
  });

  it("does NOT suppress on a bare avoid_actor_area finding for the same span", () => {
    const finding: StaticFinding = {
      kind: "actorAreaUndeclaredAvoid",
      severity: "info",
      text: "t",
      commandSpan: SPAN,
      playerCount: 4,
    };
    expect(suppressedActorAreaSpans([finding]).size).toBe(0);
  });
});

describe("static findings render as their own severity blocks", () => {
  it("one severity block per FAMILY, never folded into the Monte Carlo table", () => {
    const findings: StaticFinding[] = [
      {
        kind: "landOverAllocation",
        severity: "info",
        text: "over-allocated",
        playerCount: 4,
      },
      {
        kind: "minExceedsMaxObjects",
        severity: "error",
        text: "contradiction",
        span: SPAN,
        commandSpan: SPAN,
        playerCount: 4,
      },
    ];
    const blocks = buildStaticFindingBlocks(findings, [4], LINE_OFFSETS);
    const severities = blocks.filter((b) => b.kind === "severity");
    expect(severities).toHaveLength(2);
    // Two families of one finding each, so both render as bare severity
    // blocks with their own span and no table.
    expect(blocks.filter((b) => b.kind === "table")).toHaveLength(0);
  });

  it("renders nothing when there are no findings", () => {
    expect(buildStaticFindingBlocks([], [4], LINE_OFFSETS)).toEqual([]);
  });

  it("collapses a finding IDENTICAL at every selected count into ONE block", () => {
    // Sec.3.0 rule 1 runs the static layer once per count; on this corpus
    // every finding is identical at all four, so rendered per pass the
    // output is the same block four times. `Pa_Site_v1.1.rms` reached 1026
    // blocks that way, over LIMITS.maxBlocksPerOutput (1000), and the host
    // rejected the whole output.
    const findings: StaticFinding[] = [2, 4, 6, 8].map((pc) => ({
      kind: "landOverAllocation" as const,
      severity: "info" as const,
      text: "the same sentence",
      playerCount: pc,
    }));
    const blocks = buildStaticFindingBlocks(
      findings,
      [2, 4, 6, 8],
      LINE_OFFSETS,
    );
    expect(blocks.filter((b) => b.kind === "severity")).toHaveLength(1);
    const only = blocks.find((b) => b.kind === "severity");
    expect(only && only.kind === "severity" && only.text).toBe(
      "the same sentence",
    );
  });

  it("says the counts when a finding does NOT hold at every selected count", () => {
    const findings: StaticFinding[] = [2, 4].map((pc) => ({
      kind: "landOverAllocation" as const,
      severity: "info" as const,
      text: "only at the low counts",
      playerCount: pc,
    }));
    const blocks = buildStaticFindingBlocks(
      findings,
      [2, 4, 6, 8],
      LINE_OFFSETS,
    );
    const only = blocks.find((b) => b.kind === "severity");
    expect(only && only.kind === "severity" && only.text).toBe(
      "At 2, 4 players: only at the low counts",
    );
  });

  it("a family of many findings is ONE severity plus ONE table, whatever the occurrence count", () => {
    // The block unit is the family; the occurrence is the ROW unit, bounded
    // by maxTableRowsRendered (10,000) rather than maxBlocksPerOutput (1000).
    const findings: StaticFinding[] = Array.from({ length: 253 }, (_, i) => ({
      kind: "actorAreaUndeclaredAvoid" as const,
      severity: "info" as const,
      text: `This command avoids actor area ${i}, which nothing in the script creates, so the line has no effect.`,
      span: { start: i * 10, end: i * 10 + 5 },
      playerCount: 4,
    }));
    const blocks = buildStaticFindingBlocks(findings, [4], LINE_OFFSETS);
    expect(blocks.filter((b) => b.kind === "severity")).toHaveLength(1);
    const tables = blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(1);
    const table = tables[0];
    if (table.kind !== "table") throw new Error("not a table");
    expect(table.rows).toHaveLength(253);
    expect(table.rowSpans).toHaveLength(253);
    // heading + severity + table
    expect(blocks).toHaveLength(3);
  });

  it("splits one kind into two families when its severity differs, since a severity block carries one level", () => {
    const findings: StaticFinding[] = [
      {
        kind: "actorAreaUndeclaredSharedBlockReference",
        severity: "error",
        text: "a",
        span: SPAN,
        playerCount: 4,
      },
      {
        kind: "actorAreaUndeclaredSharedBlockReference",
        severity: "error",
        text: "b",
        span: SPAN,
        playerCount: 4,
      },
      {
        kind: "actorAreaUndeclaredSharedBlockReference",
        severity: "info",
        text: "c",
        span: SPAN,
        playerCount: 4,
      },
    ];
    const blocks = buildStaticFindingBlocks(findings, [4], LINE_OFFSETS);
    const levels = blocks
      .filter((b) => b.kind === "severity")
      .map((b) => (b.kind === "severity" ? b.level : ""));
    expect(levels).toEqual(["error", "info"]);
  });
});

describe("the renderer does not invent punctuation on text it passes through", () => {
  it("a note text that already ends in a full stop does not get a second one", () => {
    // Shipped as "…with beach_terrain..". A spanless group renders its bare
    // text (no "(N places)" clause), and the period was appended regardless.
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "includes",
          prominence: "drawer",
          stage: "S0",
          text: "This map depends on include files the preview cannot see.",
        },
      ],
    );
    const blocks = buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS);
    const sev = blocks.find((b) => b.kind === "severity");
    if (sev?.kind !== "severity") throw new Error("no severity block");
    expect(sev.text).toBe(
      "This map depends on include files the preview cannot see.",
    );
    expect(sev.text).not.toContain("..");
  });

  it("a note text with no terminator still gets one", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "teams",
          prominence: "drawer",
          stage: "S5",
          text: "no teams in this lobby",
        },
      ],
    );
    const blocks = buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS);
    const sev = blocks.find((b) => b.kind === "severity");
    if (sev?.kind !== "severity") throw new Error("no severity block");
    expect(sev.text).toBe("no teams in this lobby.");
  });
});

describe("the checker does not pass through notes that are not about what it could not check", () => {
  it("drops automaticBeach, which describes engine behaviour the preview models correctly", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "automaticBeach",
          prominence: "drawer",
          stage: "S1",
          text: "The engine lays a beach wherever the ground meets deeper ground \u2014 565 tiles here.",
        },
        {
          key: "includes",
          prominence: "drawer",
          stage: "S0",
          text: "This map depends on include files the preview cannot see.",
        },
      ],
    );
    const groups = agg.noteGroups();
    expect(groups.map((g) => g.text)).toEqual([
      "This map depends on include files the preview cannot see.",
    ]);
  });

  it("a script whose ONLY note was the beach one produces no passthrough section at all", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "automaticBeach",
          prominence: "drawer",
          stage: "S1",
          text: "beach",
        },
      ],
    );
    expect(buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS)).toEqual([]);
  });

  it("keeps the low-consequence limitations, which are still limitations", () => {
    // The bar is "not a statement about what the preview could not check",
    // not "low value". So behavior_version and AT_COLOR stay.
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "behaviorVersion2:1",
          prominence: "drawer",
          stage: "S0",
          text: "behavior_version 2 is simulated the same as version 1.",
        },
        {
          key: "atColor:2",
          prominence: "drawer",
          stage: "S1",
          text: "AT_COLOR is treated the same as AT_PLAYER.",
        },
      ],
    );
    expect(agg.noteGroups()).toHaveLength(2);
  });
});

describe("locations named in prose are LINE NUMBERS, not character offsets", () => {
  it("the static family table's Location column reads a line, and the clickable span stays an offset", () => {
    const findings: StaticFinding[] = [
      {
        kind: "actorAreaUndeclaredAvoid",
        severity: "info",
        text: "a",
        span: { start: 12, end: 14 },
        playerCount: 4,
      },
      {
        kind: "actorAreaUndeclaredAvoid",
        severity: "info",
        text: "b",
        span: { start: 40, end: 42 },
        playerCount: 4,
      },
      {
        kind: "actorAreaUndeclaredAvoid",
        severity: "info",
        text: "c",
        span: { start: 52, end: 54 },
        playerCount: 4,
      },
    ];
    const blocks = buildStaticFindingBlocks(findings, [4], LINE_OFFSETS);
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") throw new Error("no table");
    // SOURCE's newlines sit at 28 and 48, so lines start at 0 / 29 / 49.
    expect(table.rows.map((r) => r[0])).toEqual(["line 1", "line 2", "line 3"]);
    // The two are different numbers, which is the whole point: the prose says
    // "line 3", the click-through still carries offset 52.
    expect(table.rowSpans?.[2]).toEqual({ start: 52, end: 54 });
  });

  it("the notes table's Location column reads a line too", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(SOURCE.length);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "unsimulated:52-54",
          prominence: "drawer",
          stage: "S0",
          span: { start: 52, end: 54 },
          text: "not simulated",
        },
      ],
    );
    const blocks = buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS);
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") throw new Error("no table");
    expect(table.rows[0][0]).toBe("line 3");
    expect(table.rowSpans?.[0]).toEqual({ start: 52, end: 54 });
  });
});

describe("Sec.5.1 hideHealthy \u2014 the noise filter", () => {
  function tablesFor(
    rows: {
      span: { start: number; end: number };
      attempted: number;
      placed: number;
      failures?: CommandReport["failures"];
    }[],
    hideHealthy: boolean,
  ) {
    const agg = new MonteCarloAggregate();
    // ONE generation carrying every row. Folding one row per generation would
    // make each of them present in 1 of N runs, and Sec.5.1's denominator
    // clause would then decorate every rate, a fixture measuring the wrong
    // rule.
    agg.addGeneration(
      4,
      rows.map((r) => ({
        commandSpan: r.span,
        stage: "S6" as const,
        attempted: r.attempted,
        placed: r.placed,
        failures: r.failures ?? [],
      })),
      [],
    );
    return buildFindingTables(agg, {
      source: SOURCE,
      selectedCounts: [4],
      reasonCtx: emptyCtx,
      suppressedActorAreaMissing: new Set(),
      hideHealthy,
    });
  }

  it("drops a row that placed everything with no buckets, and keeps the one that did not", () => {
    const rows = [
      { span: SPAN, attempted: 4, placed: 4 },
      {
        span: { start: 31, end: 50 },
        attempted: 4,
        placed: 1,
        failures: [
          {
            bucket: "occupancyFull" as const,
            commandSpan: { start: 31, end: 50 },
            stage: "S6" as const,
            entity: "DEER",
            detail: "d",
          },
        ],
      },
    ];
    expect(tableRows(tablesFor(rows, false))).toHaveLength(2);
    const kept = tableRows(tablesFor(rows, true));
    expect(kept).toHaveLength(1);
    expect(kept[0][1]).toBe("25.0%");
  });

  it("a row at 100% that carries a failure bucket is NOT healthy \u2014 it missed on the way", () => {
    // The intermittent case is the one this tool exists to surface: every
    // object eventually placed, having failed and retried. A filter keyed on
    // the rate alone would hide exactly that.
    const rows = [
      {
        span: SPAN,
        attempted: 4,
        placed: 4,
        failures: [
          {
            bucket: "occupancyFull" as const,
            commandSpan: SPAN,
            stage: "S6" as const,
            entity: "DEER",
            detail: "d",
          },
        ],
      },
    ];
    expect(tableRows(tablesFor(rows, true))).toHaveLength(1);
  });

  it("a zero-attempt row survives the filter \u2014 it has no rate at all, which is the worst outcome the matrix holds", () => {
    expect(
      tableRows(tablesFor([{ span: SPAN, attempted: 0, placed: 0 }], true)),
    ).toHaveLength(1);
  });

  it("says how many it hid, always, and at 0 as well \u2014 a filtered table and an empty one are different claims", () => {
    const hiddenLine = (blocks: ReturnType<typeof buildFindingTables>) => {
      const t = blocks.find((b) => b.kind === "text");
      return t?.kind === "text" ? t.text : undefined;
    };
    expect(
      hiddenLine(tablesFor([{ span: SPAN, attempted: 4, placed: 4 }], true)),
    ).toBe(
      "1 command placed everything it attempted at every player count and is hidden.",
    );
    expect(
      hiddenLine(tablesFor([{ span: SPAN, attempted: 0, placed: 0 }], true)),
    ).toBe(
      "0 commands placed everything they attempted at every player count and are hidden.",
    );
    // Off: no claim either way, rather than a claim of zero.
    expect(
      hiddenLine(tablesFor([{ span: SPAN, attempted: 4, placed: 4 }], false)),
    ).toBeUndefined();
  });
});

describe("Sec.5.4 notes passthrough", () => {
  it("a spanless group renders its severity with no table", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(
      4,
      [],
      [{ key: "teams", prominence: "drawer", stage: "S5", text: "no teams" }],
    );
    const blocks = buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS);
    expect(blocks.filter((b) => b.kind === "table")).toHaveLength(0);
    expect(blocks.some((b) => b.kind === "severity")).toBe(true);
  });

  it("a spanned group renders a severity plus a table with one row per distinct span", () => {
    const agg = new MonteCarloAggregate();
    agg.setSourceLength(1000);
    agg.addGeneration(
      4,
      [],
      [
        {
          key: "unsimulated:0-10",
          prominence: "drawer",
          stage: "S0",
          span: { start: 0, end: 10 },
          text: "not simulated",
        },
        {
          key: "unsimulated:20-30",
          prominence: "drawer",
          stage: "S0",
          span: { start: 20, end: 30 },
          text: "not simulated",
        },
      ],
    );
    const blocks = buildNotesBlocks(agg.noteGroups(), LINE_OFFSETS);
    const table = blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" ? table.rows : []).toHaveLength(2);
  });
});
