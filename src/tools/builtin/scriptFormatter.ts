/**
 * Script Formatter — CREATION_PLAN 5.2b's "script formatter / pretty-printer".
 * Design: docs/formatter-design.md. Section numbers below are that doc's.
 *
 * The first tool in the registry to declare `edit-source`, so it is also the
 * first real exercise of the Apply path (tools-api-design.md Sec.4.5) and of
 * `multiSelect` outside the consistency checker's player-count matrix.
 *
 * Everything interesting lives in `formatter/`, which is pure and imports only
 * `src/parser`. This file is the adapter: manifest, params, output blocks. Keep
 * it that way — the engine has to stay drivable from a test and from a future
 * settings page, neither of which has a `ToolContext`.
 */

import type { LanguageData } from "../../parser/language";
import type { ParseResult } from "../../parser/types";
import languageDataRaw from "../../../reference/data/language.json";
import type {
  OutputBlock,
  ParamOption,
  ParamValue,
  ToolContext,
  ToolImplementation,
  ToolManifest,
  ToolMessage,
  ToolRunHandle,
} from "../../../tools-api/index";
import { TOOLS_API_VERSION } from "../../../tools-api/index";
import { formatScript, type FormatChange, type FormatOptions, type FormatResult } from "./formatter/index";

// Same double-cast reasoning as ToolsPane.tsx and src/preview/worker.ts for the
// same file: resolveJsonModule infers a literal type that does not structurally
// overlap the hand-written interface closely enough for one step, and
// `npm run validate:reference` (ajv) is the real guarantee about this data.
const lang = languageDataRaw as unknown as LanguageData;

/**
 * The commands that take a `{ … }` block, read out of language.json rather
 * than written down here — CLAUDE.md's "vocabulary is data-driven, hardcode no
 * RMS vocabulary". Twelve today.
 *
 * Read at MODULE LOAD, not from `ctx.referenceData`, because a manifest is
 * static metadata the host renders before any run exists. That is not a
 * capability dodge: at run time this tool reads no reference data at all — the
 * parser has already resolved each command's `def`, which is where the name
 * used for matching comes from.
 */
const BLOCK_COMMAND_OPTIONS: ParamOption[] = lang.commands
  .filter((command) => command.kind === "block")
  .map((command) => ({ value: command.name, label: command.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const scriptFormatterManifest: ToolManifest = {
  id: "script-formatter",
  name: "Script Formatter",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description:
    "Re-lays out the open script: indentation, line breaks and blank lines. Preserves each command's existing one-line-or-expanded shape by default, and never changes a single token.",
  capabilities: ["read-ast", "read-source", "edit-source"],
  params: [
    {
      key: "blockLayout",
      type: "select",
      label: "Command blocks",
      help: "Preserve keeps each block the shape you wrote it: a command already on one line stays on one line, anything else gets one attribute per indented line. Expanded and Inline impose one shape everywhere. Compact puts a block on one line when it fits the width below.",
      default: "preserve",
      options: [
        { value: "preserve", label: "Preserve what the script does" },
        { value: "expanded", label: "One attribute per line" },
        { value: "inline", label: "Whole command on one line" },
        { value: "compact", label: "One line when it fits" },
      ],
    },
    {
      key: "inlineMaxWidth",
      type: "integer",
      label: "Width for Compact",
      help: "Only used by the Compact block layout. Counted in columns, with a tab counting as four.",
      default: 100,
      min: 40,
      max: 400,
    },
    {
      key: "indentStyle",
      type: "select",
      label: "Indent with",
      help: "Preserve detects what the open script already uses. The report says which unit it picked.",
      default: "preserve",
      options: [
        { value: "preserve", label: "Whatever the script uses" },
        { value: "tab", label: "Tab" },
        { value: "2 spaces", label: "2 spaces" },
        { value: "4 spaces", label: "4 spaces" },
      ],
    },
    {
      key: "sectionIndent",
      type: "select",
      label: "Section bodies",
      help: "Whether everything under a <SECTION> header is stepped in one level. Preserve decides it per section from what you already wrote, which is what keeps a script that indents its sections from being flattened.",
      default: "preserve",
      options: [
        { value: "preserve", label: "As the script has them" },
        { value: "flat", label: "Flush with the header" },
        { value: "indented", label: "One level in" },
      ],
    },
    {
      key: "braceStyle",
      type: "select",
      label: "Opening brace",
      help: "Where the { of an expanded block goes. Blocks kept on one line are unaffected.",
      default: "preserve",
      options: [
        { value: "preserve", label: "Where the script puts it" },
        { value: "ownLine", label: "On its own line" },
        { value: "sameLine", label: "At the end of the command line" },
      ],
    },
    {
      key: "indentConditionals",
      type: "boolean",
      label: "Indent if and start_random bodies",
      help: "Puts the contents of each if / elseif / else branch and each percent_chance branch one level in. Off leaves them level with their keyword.",
      default: true,
    },
    {
      key: "commentGroups",
      type: "boolean",
      label: "Keep comment-headed groups",
      help: "When a comment is followed by commands you indented under it, keep that extra level. Turn this off to indent purely by structure.",
      default: true,
    },
    {
      key: "intraLineSpacing",
      type: "select",
      label: "Spacing inside a line",
      help: "Preserve keeps the gaps you typed between words on a line, so columns you lined up by hand stay lined up. Collapse reduces every run to one space.",
      default: "preserve",
      options: [
        { value: "preserve", label: "Leave it alone" },
        { value: "collapse", label: "Collapse to one space" },
      ],
    },
    {
      key: "maxBlankLines",
      type: "integer",
      label: "Blank lines kept",
      help: "Runs of blank lines longer than this are shortened. 0 removes them all.",
      default: 1,
      min: 0,
      max: 5,
    },
    {
      key: "alwaysExpand",
      type: "multiSelect",
      label: "Always expand these commands",
      help: "Overrides the block layout above for the commands you tick. A command ticked in both lists is expanded.",
      default: [],
      options: BLOCK_COMMAND_OPTIONS,
    },
    {
      key: "alwaysInline",
      type: "multiSelect",
      label: "Always put these commands on one line",
      help: "Overrides the block layout above for the commands you tick. Ignored where one line is impossible, for instance when the block holds a comment spanning several lines.",
      default: [],
      options: BLOCK_COMMAND_OPTIONS,
    },
  ],
};

// ---------------------------------------------------------------------------
// Params -> FormatOptions
// ---------------------------------------------------------------------------

/**
 * The host validates and clamps against the manifest before `run` (protocol.ts
 * `resolveParams`), so these readers narrow rather than re-validate. They still
 * fall back to the default on the wrong runtime type, because `ParamValue` is a
 * union and TypeScript cannot know which arm arrived — this is a narrowing
 * problem, not a trust problem.
 */
function pickString<T extends string>(params: Record<string, ParamValue>, key: string, allowed: readonly T[], fallback: T): T {
  const value = params[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickBoolean(params: Record<string, ParamValue>, key: string, fallback: boolean): boolean {
  const value = params[key];
  return typeof value === "boolean" ? value : fallback;
}

function pickInteger(params: Record<string, ParamValue>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickStrings(params: Record<string, ParamValue>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function optionsFromParams(params: Record<string, ParamValue>): Partial<FormatOptions> {
  return {
    blockLayout: pickString(params, "blockLayout", ["preserve", "expanded", "inline", "compact"] as const, "preserve"),
    inlineMaxWidth: pickInteger(params, "inlineMaxWidth", 100),
    indentStyle: pickString(params, "indentStyle", ["preserve", "tab", "2 spaces", "4 spaces"] as const, "preserve"),
    sectionIndent: pickString(params, "sectionIndent", ["preserve", "flat", "indented"] as const, "preserve"),
    braceStyle: pickString(params, "braceStyle", ["preserve", "ownLine", "sameLine"] as const, "preserve"),
    indentConditionals: pickBoolean(params, "indentConditionals", true),
    commentGroups: pickBoolean(params, "commentGroups", true),
    intraLineSpacing: pickString(params, "intraLineSpacing", ["preserve", "collapse"] as const, "preserve"),
    maxBlankLines: pickInteger(params, "maxBlankLines", 1),
    alwaysExpand: pickStrings(params, "alwaysExpand"),
    alwaysInline: pickStrings(params, "alwaysInline"),
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const PREVIEW_CHANGES = 25;
const TABLE_ROWS = 200;

function describeIndent(unit: string): string {
  if (unit === "\t") return "one tab";
  return `${unit.length} space${unit.length === 1 ? "" : "s"}`;
}

/** What happened to one line, in the fewest words that are still true. */
function describeChange(change: FormatChange): string {
  if (change.after.length > 1) return `split over ${change.after.length} lines`;
  if (change.after.length === 0) return "joined onto another line";
  if (change.before.trim() === change.after[0].trim()) return "re-indented";
  return "re-laid out";
}

function previewText(changes: readonly FormatChange[], total: number): string {
  const shown = changes.slice(0, PREVIEW_CHANGES);
  const lines: string[] = [];
  for (const change of shown) {
    lines.push(`line ${change.line}`);
    lines.push(`- ${change.before}`);
    for (const after of change.after) lines.push(`+ ${after}`);
    lines.push("");
  }
  if (total > shown.length) lines.push(`… and ${total - shown.length} more changed lines.`);
  return lines.join("\n").trimEnd();
}

export function buildFormatterOutput(parse: ParseResult, result: FormatResult): OutputBlock[] {
  const blocks: OutputBlock[] = [{ kind: "heading", text: "Script formatter" }];
  const stats = result.stats;

  if (!result.verified) {
    // The one branch that proposes nothing. A formatter that cannot prove it
    // preserved every token does not get to modify the file (design Sec.8).
    blocks.push({
      kind: "severity",
      level: "error",
      text:
        `The formatter could not prove its output preserves the script, so it has proposed no changes. ` +
        `Please report this with the script attached. Detail: ${result.verifyProblem}`,
    });
    return blocks;
  }

  blocks.push({
    kind: "keyValue",
    rows: [
      ["Indent", describeIndent(stats.indentUnit)],
      ["Line endings", stats.lineEnding === "\r\n" ? "CRLF (kept)" : "LF (kept)"],
      ["Blocks left on one line", String(stats.inlineKept)],
      ["Blocks left expanded", String(stats.expandedKept)],
      ["Blocks put on one line", String(stats.madeInline)],
      ["Blocks expanded", String(stats.madeExpanded)],
      ["Lines changed", String(stats.changedLines)],
      [
        "Line count",
        stats.sourceLines === stats.formattedLines
          ? String(stats.sourceLines)
          : `${stats.sourceLines} → ${stats.formattedLines}`,
      ],
      ["Edits proposed", String(result.edits.length)],
    ],
  });

  const parseErrors = parse.diagnostics.filter((d) => d.severity === "error").length;
  if (parseErrors > 0) {
    blocks.push({
      kind: "severity",
      level: "warning",
      text:
        `The parser reported ${parseErrors} error${parseErrors === 1 ? "" : "s"} in this script. ` +
        `Formatting still ran, and any region the parser could not read is reproduced exactly as you wrote it. ` +
        `The formatter never adds a missing brace or endif.`,
    });
  }

  if (stats.strayTokens > 0) {
    blocks.push({
      kind: "severity",
      level: "warning",
      text: `${stats.strayTokens} token${stats.strayTokens === 1 ? " belongs" : "s belong"} to no part of the parsed script. Each was kept, on a line of its own.`,
    });
  }

  if (result.edits.length === 0) {
    blocks.push({ kind: "text", text: "Nothing to change. This script already matches these settings." });
    return blocks;
  }

  if (result.changes.length === 0) {
    // Edits with no changed line means the edits fall ENTIRELY on blank lines:
    // `changedLines` compares line text, and a removed empty line has no text
    // and no token, so the token-keyed diff cannot see it. Eight corpus scripts
    // land here at the defaults. Without this branch they get a preview block
    // holding the empty string and a table with no rows, immediately after
    // being told there are edits to apply.
    const delta = stats.sourceLines - stats.formattedLines;
    const movement =
      delta > 0
        ? ` The script loses ${delta} line${delta === 1 ? "" : "s"}.`
        : delta < 0
          ? ` The script gains ${-delta} line${delta === -1 ? "" : "s"}.`
          : "";
    blocks.push({
      kind: "text",
      text: `No line's text changes. All ${result.edits.length} edit${result.edits.length === 1 ? "" : "s"} adjust blank lines only.${movement}`,
    });
    return blocks;
  }

  blocks.push({ kind: "text", text: previewText(result.changes, stats.changedLines) });

  const rows = result.changes.slice(0, TABLE_ROWS);
  blocks.push({
    kind: "table",
    columns: ["Line", "Change"],
    // A LINE NUMBER in the cell, because a person reads it and then goes and
    // looks; the clickable offset rides alongside in rowSpans.
    rows: rows.map((change) => [String(change.line), describeChange(change)]),
    rowSpans: rows.map((change) => change.span),
  });

  if (stats.changedLines > rows.length) {
    blocks.push({
      kind: "text",
      text: `Listing the first ${rows.length} of ${stats.changedLines} changed lines. Apply changes them all.`,
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export const scriptFormatter: ToolImplementation = {
  manifest: scriptFormatterManifest,
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      const parse = ctx.parseResult;
      if (!parse) {
        emit({ type: "error", message: "This tool needs the parsed script, which the host did not provide.", reason: "host-error" });
        return;
      }
      emit({ type: "progress", fraction: 1, note: "Formatting" });

      const result = formatScript(parse, { ...optionsFromParams(ctx.params), maxChanges: TABLE_ROWS });
      const output = { blocks: buildFormatterOutput(parse, result) };
      // No `edits` key at all when there is nothing to apply: an empty array
      // would light up an Apply button that does nothing.
      if (result.edits.length === 0) emit({ type: "result", output });
      else emit({ type: "result", output, edits: result.edits });
    });

    return {
      cancel() {
        cancelled = true;
      },
    };
  },
};
