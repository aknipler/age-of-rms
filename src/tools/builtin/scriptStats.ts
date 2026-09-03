/**
 * Script Statistics, the protocol's trivial exemplar and smoke test
 * (tools-api-design.md Sec.7).
 *
 * Pure read-ast, finishes instantly. It exists to be the simplest possible
 * complete implementation of `ToolImplementation`, so the pane, the host and the
 * message plumbing all have something real to exercise before the flagship
 * checker arrives in 5.2.
 *
 * It is also the natural place to demonstrate Sec.2's prose/span split, because
 * it is the one tool whose entire output is prose about locations: a `span` is a
 * character OFFSET (Monaco and useSharedSelection consume it), while any
 * location named in PROSE is a 1-BASED LINE NUMBER. This repo shipped seven
 * diagnostics to a release saying "already set at offset 86970", a position no
 * editor displays, so the one actionable fact in each message was unreachable.
 * `lineNumberOfOffset` is the in-process fix and it lives one directory over.
 */

import { lineNumberOfOffset } from "../../parser/lineIndex";
import type { Item, ParseResult } from "../../parser/types";
import type { OutputBlock, ToolContext, ToolImplementation, ToolManifest, ToolMessage, ToolRunHandle } from "../../../tools-api/index";
import { TOOLS_API_VERSION } from "../../../tools-api/index";

export const scriptStatsManifest: ToolManifest = {
  id: "script-stats",
  name: "Script Statistics",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description: "Counts commands, attributes, constants and sections in the open script.",
  // read-source is implied by read-ast and the host auto-grants it; declared
  // here anyway because this manifest is what an implementer copies.
  capabilities: ["read-ast", "read-source"],
  params: [
    {
      key: "listSections",
      type: "boolean",
      label: "List sections",
      help: "Adds a table of every section in the script with its line number.",
      default: true,
    },
  ],
};

interface Counts {
  commands: number;
  attributes: number;
  directives: number;
  conditionals: number;
  randomBlocks: number;
  raw: number;
}

function emptyCounts(): Counts {
  return { commands: 0, attributes: 0, directives: 0, conditionals: 0, randomBlocks: 0, raw: 0 };
}

/**
 * Walk every item, including the ones nested inside blocks and branches.
 *
 * Exported for its own unit test: counting only top-level items is the obvious
 * bug here and it is invisible in the output, since a script with no
 * conditionals produces identical numbers either way.
 */
export function countItems(items: readonly Item[], into: Counts = emptyCounts()): Counts {
  for (const item of items) {
    switch (item.kind) {
      case "command":
        into.commands++;
        if (item.block) countItems(item.block.items, into);
        break;
      case "attribute":
        into.attributes++;
        break;
      case "directive":
        into.directives++;
        break;
      case "if":
        into.conditionals++;
        for (const branch of item.branches) countItems(branch.items, into);
        break;
      case "random":
        into.randomBlocks++;
        countItems(item.preamble, into);
        for (const branch of item.branches) countItems(branch.items, into);
        break;
      case "orphanBlock":
        countItems(item.block.items, into);
        break;
      case "raw":
        into.raw++;
        break;
    }
  }
  return into;
}

export function buildStatsOutput(parse: ParseResult, listSections: boolean): OutputBlock[] {
  const counts = countItems(parse.script.preamble);
  for (const section of parse.script.sections) countItems(section.items, counts);

  const consts = parse.symbols.filter((s) => s.directiveKind === "const").length;
  const defines = parse.symbols.filter((s) => s.directiveKind === "define").length;
  const errors = parse.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = parse.diagnostics.filter((d) => d.severity === "warning").length;

  const blocks: OutputBlock[] = [
    { kind: "heading", text: "Script statistics" },
    {
      kind: "keyValue",
      rows: [
        ["Lines", String(parse.lineOffsets.length)],
        ["Tokens", String(parse.tokens.length)],
        ["Sections", String(parse.script.sections.length)],
        ["Commands", String(counts.commands)],
        ["Attributes", String(counts.attributes)],
        ["Directives", String(counts.directives)],
        ["Conditionals", String(counts.conditionals)],
        ["start_random blocks", String(counts.randomBlocks)],
        ["#const symbols", String(consts)],
        ["#define symbols", String(defines)],
        ["Unparsed regions", String(counts.raw)],
      ],
    },
  ];

  if (errors > 0 || warnings > 0) {
    blocks.push({
      kind: "severity",
      level: errors > 0 ? "error" : "warning",
      text: `The parser reported ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`,
    });
  }

  if (listSections && parse.script.sections.length > 0) {
    blocks.push({
      kind: "table",
      columns: ["Section", "Line", "Items"],
      rows: parse.script.sections.map((s) => [
        `<${s.name}>`,
        // A LINE NUMBER, because a person reads this cell and then goes and
        // looks. The clickable offset rides alongside in rowSpans.
        String(lineNumberOfOffset(parse.lineOffsets, s.span.start)),
        String(s.items.length),
      ]),
      // One entry per row, which the host validator length-checks. This is what
      // makes every row clickable without splitting the table into unlinked
      // severity/codeRef pairs.
      rowSpans: parse.script.sections.map((s) => s.span),
    });
  }

  return blocks;
}

export const scriptStats: ToolImplementation = {
  manifest: scriptStatsManifest,
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle {
    // Returns immediately; everything flows through `emit`. This tool finishes
    // inside one chunk, so it never has to yield, but it still emits a
    // terminal, which is the only thing the host waits for.
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      const parse = ctx.parseResult;
      if (!parse) {
        emit({ type: "error", message: "This tool needs the parsed script, which the host did not provide.", reason: "host-error" });
        return;
      }
      emit({ type: "progress", fraction: 1, note: "Counting" });
      emit({ type: "result", output: { blocks: buildStatsOutput(parse, ctx.params.listSections !== false) } });
    });

    return {
      cancel() {
        cancelled = true;
      },
    };
  },
};
