/**
 * Constants Usage, the first of CREATION_PLAN 5.2b's additional built-ins.
 *
 * Lists every `#const`/`#define` in the script with where it is defined and
 * where it is used again, and flags the two things nothing else in the app
 * currently surfaces in one place:
 *
 *  - a symbol defined and never referenced again (dead weight, or a typo in
 *    the name used at the reference site, either way worth a look), and
 *  - a name referenced in a numeric slot that never got defined (already
 *    live as RMS0202 in the Code editor, one squiggle at a time; this tool
 *    groups the scattered diagnostics by name into one row).
 *
 * Read-ast only, like scriptStats, no generation, no reference data. Pure
 * read-only: it proposes nothing to edit.
 */

import { lineNumberOfOffset } from "../../parser/lineIndex";
import type { ParseResult, Span, Token } from "../../parser/types";
import type { OutputBlock, ToolContext, ToolImplementation, ToolManifest, ToolMessage, ToolRunHandle } from "../../../tools-api/index";
import { TOOLS_API_VERSION } from "../../../tools-api/index";

export const constantsAuditorManifest: ToolManifest = {
  id: "constants-auditor",
  name: "Constants Usage",
  version: "1.0.0",
  apiVersion: TOOLS_API_VERSION,
  description: "Lists every #const and #define in the script, and flags names that are never used again or that are used but never defined.",
  capabilities: ["read-ast", "read-source"],
  params: [
    {
      key: "hideHealthy",
      type: "boolean",
      label: "Hide constants with no problems",
      help: "Leave out rows for constants that are defined once and used at least once, with no #undefine attempt against them. The report always says how many were hidden.",
      // Default ON for the same reason as the consistency checker's own
      // hideHealthy: most scripts define far more constants than they ever
      // misuse, and this tool exists to surface the ones that are not fine.
      default: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Definitions and uses
// ---------------------------------------------------------------------------

export interface ConstantUsage {
  name: string;
  kind: "const" | "define" | "mixed";
  /** One entry per `#const`/`#define` line that defines this name. */
  definitions: { span: Span; conditionalDepth: number }[];
  /**
   * `#undefine NAME` lines targeting this symbol. Counted separately from
   * `useSpans`. #undefine does NOTHING in-engine (parser/types.ts's
   * `SymbolInfo.undefineAttempted` doc), so a name whose only other
   * appearance is inside one would still be practically unused, and folding
   * it into the use count would hide exactly the case this tool exists to
   * catch.
   */
  undefineAttemptSpans: Span[];
  /** Every other appearance of the name as a `word` token in the file. */
  useSpans: Span[];
}

/**
 * Token indices of every `#undefine NAME` target, keyed by index so the
 * caller can exclude them from the plain usage scan below.
 *
 * Scans the raw token stream rather than the AST on purpose: `#undefine` is a
 * directive like any other, and walking tokens means a name referenced
 * inside a construct the parser had to degrade to a RawNode is still found
 * (CLAUDE.md: never silently drop content).
 */
function findUndefineTargets(tokens: readonly Token[]): Map<number, string> {
  const targets = new Map<number, string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.isTrivia || t.kind !== "directive" || t.text !== "#undefine") continue;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].isTrivia) continue;
      if (tokens[j].kind === "word") targets.set(j, tokens[j].text);
      break;
    }
  }
  return targets;
}

function tokenSpan(t: Token): Span {
  return { start: t.start, end: t.end };
}

/** Exported for its own unit test, the definition/undefine/use split is the whole point of this tool. */
export function auditConstants(parse: ParseResult): ConstantUsage[] {
  const byName = new Map<string, ConstantUsage>();
  const definitionTokens = new Set<number>();

  for (const symbol of parse.symbols) {
    definitionTokens.add(symbol.nameToken);
    let entry = byName.get(symbol.name);
    if (!entry) {
      entry = { name: symbol.name, kind: symbol.directiveKind, definitions: [], undefineAttemptSpans: [], useSpans: [] };
      byName.set(symbol.name, entry);
    } else if (entry.kind !== symbol.directiveKind) {
      entry.kind = "mixed";
    }
    entry.definitions.push({ span: tokenSpan(parse.tokens[symbol.nameToken]), conditionalDepth: symbol.conditionalDepth });
  }

  const undefineTargets = findUndefineTargets(parse.tokens);
  for (const [tokenIdx, name] of undefineTargets) {
    byName.get(name)?.undefineAttemptSpans.push(tokenSpan(parse.tokens[tokenIdx]));
  }

  const excluded = new Set<number>([...definitionTokens, ...undefineTargets.keys()]);
  for (let i = 0; i < parse.tokens.length; i++) {
    const tok = parse.tokens[i];
    if (tok.isTrivia || tok.kind !== "word" || excluded.has(i)) continue;
    byName.get(tok.text)?.useSpans.push(tokenSpan(tok));
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Referenced but never defined, RMS0202, grouped by name
// ---------------------------------------------------------------------------

export interface UndefinedReference {
  name: string;
  spans: Span[];
}

/**
 * Groups the parser's own RMS0202 diagnostics (unresolved constant in a
 * numeric slot) by the name at fault, rather than recomputing resolution,
 * that check already exists and already matches the engine's single-pass
 * definedness rule (parser.ts's `isDefinedSymbol` doc); this tool's job is to
 * present it next to the rest of a constant's story, not to re-derive it.
 *
 * Recovers the name from the token AT the diagnostic's span rather than from
 * the message text, so a wording change in diagnostics.ts cannot silently
 * break this tool.
 */
export function findUndefinedReferences(parse: ParseResult): UndefinedReference[] {
  const tokenByStart = new Map<number, Token>();
  for (const t of parse.tokens) {
    if (!t.isTrivia) tokenByStart.set(t.start, t);
  }

  const byName = new Map<string, UndefinedReference>();
  for (const diag of parse.diagnostics) {
    if (diag.code !== "RMS0202") continue;
    const name = tokenByStart.get(diag.span.start)?.text ?? "?";
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, spans: [] };
      byName.set(name, entry);
    }
    entry.spans.push(diag.span);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ConstantUsage["kind"], string> = {
  const: "#const",
  define: "#define",
  mixed: "#const / #define",
};

interface Row {
  cells: string[];
  jumpSpan: Span;
  /** Has something worth a second look, what hideHealthy filters on. */
  flagged: boolean;
}

function buildRow(usage: ConstantUsage, lineOffsets: readonly number[]): Row {
  const notes: string[] = [];
  if (usage.useSpans.length === 0) notes.push("never referenced again");

  // Only unconditional (depth 0) redefinitions are flagged. Two definitions
  // of the same name in sibling if/elseif/else branches, the standard
  // map-size-keyed #const idiom, both read as "conditionalDepth > 0" and
  // are mutually exclusive at run time, not a duplicate (CLAUDE.md:
  // over-declaration is an RMS idiom, not a mistake; a count is not a
  // conclusion without checking what it counts).
  const unconditionalDefs = usage.definitions.filter((d) => d.conditionalDepth === 0).length;
  if (unconditionalDefs > 1) notes.push(`defined unconditionally ${unconditionalDefs} times`);

  if (usage.undefineAttemptSpans.length > 0) {
    notes.push(`#undefine has no effect in-engine (×${usage.undefineAttemptSpans.length})`);
  }
  if (usage.kind === "mixed") notes.push("defined as both #const and #define");

  const definedAt = usage.definitions.map((d) => lineNumberOfOffset(lineOffsets, d.span.start)).join(", ");
  return {
    cells: [usage.name, KIND_LABEL[usage.kind], definedAt, String(usage.useSpans.length), notes.join("; ")],
    jumpSpan: usage.definitions[0].span,
    flagged: notes.length > 0,
  };
}

export function buildConstantsAuditOutput(parse: ParseResult, hideHealthy: boolean): OutputBlock[] {
  const constants = auditConstants(parse);
  const undefinedRefs = findUndefinedReferences(parse);

  const blocks: OutputBlock[] = [{ kind: "heading", text: "Constants usage" }];

  if (constants.length === 0 && undefinedRefs.length === 0) {
    blocks.push({ kind: "text", text: "This script defines no #const or #define symbols, and references no undefined ones." });
    return blocks;
  }

  const unusedCount = constants.filter((c) => c.useSpans.length === 0).length;
  blocks.push({
    kind: "keyValue",
    rows: [
      ["#const / #define symbols", String(constants.length)],
      ["Never referenced again", String(unusedCount)],
      ["Referenced but never defined", String(undefinedRefs.length)],
    ],
  });

  const allRows = constants.map((c) => buildRow(c, parse.lineOffsets));
  const shownRows = hideHealthy ? allRows.filter((r) => r.flagged) : allRows;

  if (shownRows.length > 0) {
    blocks.push({
      kind: "table",
      columns: ["Name", "Kind", "Defined at", "Used", "Notes"],
      rows: shownRows.map((r) => r.cells),
      rowSpans: shownRows.map((r) => r.jumpSpan),
    });
  }
  // Printed unconditionally, including at zero hidden, a filtered table and
  // an empty one are different claims (CLAUDE.md: the sentence's absence
  // must never be what carries the information).
  if (hideHealthy) {
    const hidden = allRows.length - shownRows.length;
    blocks.push({ kind: "text", text: `${hidden} of ${allRows.length} constant${allRows.length === 1 ? "" : "s"} hidden. Defined, used, and never targeted by #undefine.` });
  }

  if (undefinedRefs.length > 0) {
    blocks.push({ kind: "heading", text: "Referenced but never defined" });
    blocks.push({
      kind: "table",
      columns: ["Name", "Referenced at", "Times"],
      rows: undefinedRefs.map((u) => [u.name, u.spans.map((s) => String(lineNumberOfOffset(parse.lineOffsets, s.start))).join(", "), String(u.spans.length)]),
      rowSpans: undefinedRefs.map((u) => u.spans[0]),
    });
  }

  return blocks;
}

export const constantsAuditor: ToolImplementation = {
  manifest: constantsAuditorManifest,
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      const parse = ctx.parseResult;
      if (!parse) {
        emit({ type: "error", message: "This tool needs the parsed script, which the host did not provide.", reason: "host-error" });
        return;
      }
      emit({ type: "progress", fraction: 1, note: "Auditing constants" });
      emit({ type: "result", output: { blocks: buildConstantsAuditOutput(parse, ctx.params.hideHealthy !== false) } });
    });

    return {
      cancel() {
        cancelled = true;
      },
    };
  },
};
