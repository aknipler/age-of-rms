import type { Diagnostic, DiagnosticSeverity, Span, Token } from "./types";

/**
 * Full diagnostic code table from docs/parser-design.md §10. Severities
 * here are the PINNED defaults; a handful of parser-level codes (marked
 * † in the spec — RMS0201/0202/0203) get downgraded to "info" at the
 * call site when the underlying language.json entry is `"verified": false`
 * (spec §6.2) — that's a per-call override, not part of this table.
 *
 * Only the lexer-level codes (RMS0001-0005, RMS0216) are wired up as of
 * Phase 2.2. The rest are listed now, verbatim from the spec, so the
 * Phase 2.3 parser session doesn't have to re-derive them.
 */
export const DIAGNOSTIC_CODES: Record<string, { severity: DiagnosticSeverity; summary: string }> = {
  RMS0001: { severity: "warning", summary: "Unclosed /* (nesting-aware) — rest of file is a comment" },
  RMS0002: { severity: "warning", summary: "*/ without matching /*" },
  RMS0003: { severity: "warning", summary: "Token contains embedded { } /* */ — missing whitespace" },
  RMS0004: { severity: "warning", summary: "Non-standard space character (NBSP etc.) inside a token" },
  RMS0005: { severity: "info", summary: "Leading byte-order mark (emitted as a trivia token; has no effect)" },
  RMS0100: { severity: "warning", summary: "Unknown section header" },
  RMS0101: { severity: "error", summary: "Unclosed { at EOF" },
  RMS0102: { severity: "warning", summary: "{ with nothing to attach to (OrphanBlockNode)" },
  RMS0103: { severity: "error", summary: "Section header while { open — block force-closed" },
  RMS0104: { severity: "warning", summary: "Stray }" },
  RMS0105: { severity: "warning", summary: "Unclosed if / start_random at EOF" },
  RMS0106: { severity: "warning", summary: "Control keyword in wrong context / tokens before first percent_chance" },
  RMS0107: { severity: "warning", summary: "Nesting deeper than maxNestingDepth — shown as raw code" },
  RMS0110: {
    severity: "info",
    summary: "Conditional interleaves with command/block/section structure — shown as raw code (valid RMS)",
  },
  RMS0200: { severity: "warning", summary: "Unknown command/attribute name, with did-you-mean" },
  RMS0201: { severity: "warning", summary: "Too few arguments (incl. stop-set/assembly early termination)" },
  RMS0202: { severity: "warning", summary: "Argument type mismatch" },
  RMS0203: { severity: "warning", summary: "Argument out of documented range" },
  RMS0204: { severity: "info", summary: "Bare numeric ID where a named constant exists" },
  RMS0205: { severity: "warning", summary: "Cross-category constant use" },
  RMS0206: { severity: "warning", summary: "Unknown # directive" },
  RMS0207: { severity: "warning", summary: "Known name in wrong context" },
  RMS0208: { severity: "warning", summary: "Unclosed/degenerate math expression (degraded to raw)" },
  RMS0209: { severity: "warning", summary: "Unclosed quoted filename (degraded to raw)" },
  RMS0210: { severity: "warning", summary: "Malformed math expression (nested paren / glued operator / rnd inside / unglued operand)" },
  RMS0211: { severity: "warning", summary: "Quoted path on #includeXS (engine rejects quotes — documented bug)" },
  RMS0212: { severity: "warning", summary: "Digit-prefixed word in a numeric-typed argument slot only" },
  RMS0213: { severity: "warning", summary: "Nested start_random (engine does not support nesting randoms)" },
  RMS0214: { severity: "warning", summary: "rnd-like token failing the canonical form" },
  RMS0215: { severity: "warning", summary: "Unexpected value where a statement was expected" },
  RMS0216: { severity: "warning", summary: '"//" is not a comment in RMS — use /* */' },
  // Added post-spec (2.4 bug-fix session, not in docs/parser-design.md's
  // original §10 table — logged there as an amendment instead of a full
  // rewrite). Distinct from RMS0203: the value is NOT out of the documented
  // range (no min/max violation) — it's a real, valid value that reference
  // data flags as risky. Message must say so explicitly (see cautionMessage
  // on the triggering language.json entry) so it doesn't read as an error.
  RMS0217: { severity: "warning", summary: "Value is valid RMS but reference data flags a caution for it" },
};

function toSpan(token: Token): Span {
  return { start: token.start, end: token.end };
}

function makeDiagnostic(code: keyof typeof DIAGNOSTIC_CODES, message: string, at: Span): Diagnostic {
  return { severity: DIAGNOSTIC_CODES[code].severity, code, message, span: at };
}

// ---- Lexer-level diagnostic builders (Phase 2.2) ----

export function unclosedComment(openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0001",
    "This /* is never closed — everything after it to the end of the file is treated as a comment.",
    toSpan(openToken),
  );
}

export function strayCommentClose(token: Token): Diagnostic {
  return makeDiagnostic("RMS0002", "This */ has no matching /* — it's ignored.", toSpan(token));
}

// One of "{", "}", "/*", "*/" is glued to the rest of a token's text
// (present but not the whole token). Message variant depends on where
// the marker sits: leading ("}8050" → "} 8050"), trailing
// ("create_land{" → "create_land {"), or embedded mid-token.
export function embeddedMarker(token: Token, marker: string): Diagnostic {
  const idx = token.text.indexOf(marker);
  let suggestion: string;
  if (token.text.startsWith(marker)) {
    suggestion = `${marker} ${token.text.slice(marker.length)}`;
  } else if (token.text.endsWith(marker)) {
    suggestion = `${token.text.slice(0, token.text.length - marker.length)} ${marker}`;
  } else {
    suggestion = `${token.text.slice(0, idx)} ${marker} ${token.text.slice(idx + marker.length)}`;
  }
  return makeDiagnostic(
    "RMS0003",
    `"${token.text}" has "${marker}" glued to the rest of the token — did you mean "${suggestion}"?`,
    toSpan(token),
  );
}

export function nonStandardSpace(token: Token, char: string): Diagnostic {
  const codePoint = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
  return makeDiagnostic(
    "RMS0004",
    `This token contains a non-standard space character (U+${codePoint}) — RMS only treats space, tab, newline, \\v, \\f, and \\r as whitespace.`,
    toSpan(token),
  );
}

export function leadingByteOrderMark(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0005",
    "This file starts with a byte-order mark (BOM) — it has no effect and is safe to ignore.",
    toSpan(token),
  );
}

export function slashSlashComment(token: Token): Diagnostic {
  return makeDiagnostic("RMS0216", '"//" is not a comment in RMS — use /* */ instead.', toSpan(token));
}

// ---- Parser-level diagnostic builders (Phase 2.3) ----
// Message philosophy per docs/parser-design.md §10: beginner-first — say
// what's wrong AND what to do. Severity comes from the pinned table above;
// `capToInfo` implements the spec's † rule (§6.2): arity/type/range
// diagnostics against `"verified": false` reference entries never rise
// above info, so bad reference data can't produce false alarms.

function capToInfo(d: Diagnostic, cap: boolean): Diagnostic {
  if (cap && d.severity === "warning") {
    return { ...d, severity: "info", message: `${d.message} (According to unverified reference data — take with a grain of salt.)` };
  }
  return d;
}

function spanBetween(first: Token, last: Token): Span {
  return { start: first.start, end: last.end };
}

export function unknownSection(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0100",
    `Unknown section "${token.text}" — not one of the sections this game version documents. Kept as-is in case it's newer than our data.`,
    toSpan(token),
  );
}

export function unclosedBraceAtEof(openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0101",
    "This { is never closed — add a matching } before the end of the file.",
    toSpan(openToken),
  );
}

export function orphanBlock(openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0102",
    "This { doesn't belong to any command — did the command above it get misspelled or deleted?",
    toSpan(openToken),
  );
}

export function sectionHeaderInBlock(headerToken: Token, openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0103",
    `Section header ${headerToken.text} appears while the { at offset ${openToken.start} is still open — close the block with } before starting a new section.`,
    toSpan(headerToken),
  );
}

export function strayCloseBrace(token: Token): Diagnostic {
  return makeDiagnostic("RMS0104", "This } has no matching { — it's ignored.", toSpan(token));
}

export function unclosedConditionalAtEof(openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0105",
    `This ${openToken.text} is never closed — add ${openToken.text === "start_random" ? "end_random" : "endif"} before the end of the file.`,
    toSpan(openToken),
  );
}

export function wrongContextKeyword(token: Token, explanation: string): Diagnostic {
  return makeDiagnostic("RMS0106", `"${token.text}" ${explanation}`, toSpan(token));
}

export function randomPreamble(first: Token, last: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0106",
    "These tokens sit between start_random and the first percent_chance — the engine expects percent_chance branches immediately.",
    spanBetween(first, last),
  );
}

export function nestingTooDeep(token: Token, max: number): Diagnostic {
  return makeDiagnostic(
    "RMS0107",
    `Nesting deeper than ${max} levels — this region is shown as raw code.`,
    toSpan(token),
  );
}

export function degradedToRaw(first: Token, last: Token, unclosedAtEof = false): Diagnostic {
  const message = unclosedAtEof
    ? "This code mixes if/random with command structure in a way that must be shown as raw code — it is valid RMS. This region runs all the way to the end of the file, which usually means the if/start_random it starts with is missing its endif/end_random."
    : "This code mixes if/random with command structure in a way that must be shown as raw code — it is valid RMS.";
  return makeDiagnostic("RMS0110", message, spanBetween(first, last));
}

export function sharedBlock(openToken: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0110",
    "This block is shared by the command(s) chosen in the if/random above — shown as a separate block.",
    toSpan(openToken),
  );
}

export function unknownName(token: Token, context: "command" | "attribute", suggestion?: string): Diagnostic {
  const base = `Unknown ${context} "${token.text}" — the engine will silently ignore it.`;
  const diagnostic = makeDiagnostic("RMS0200", suggestion ? `${base} Did you mean "${suggestion}"?` : base, toSpan(token));
  if (suggestion) {
    diagnostic.suggestion = suggestion;
  }
  return diagnostic;
}

export function tooFewArguments(nameToken: Token, expected: number, got: number, unverified: boolean): Diagnostic {
  return capToInfo(
    makeDiagnostic(
      "RMS0201",
      `"${nameToken.text}" expects ${expected} argument${expected === 1 ? "" : "s"} but only ${got} ${got === 1 ? "was" : "were"} found.`,
      toSpan(nameToken),
    ),
    unverified,
  );
}

export function argTypeMismatch(token: Token, argDef: { name: string; type: string }, unverified: boolean): Diagnostic {
  return capToInfo(
    makeDiagnostic(
      "RMS0202",
      `"${token.text}" doesn't look like a valid ${argDef.type} for "${argDef.name}".`,
      toSpan(token),
    ),
    unverified,
  );
}

/**
 * A bare word sits in a numeric slot and is NOT a symbol this file defines
 * above the use (`#const`/`#define`). Still RMS0202, but the message names
 * the real problem — the name is undefined, not "the wrong type" — and the
 * severity depends on how much of the picture we can actually see.
 *
 * Why this exists (docs/parser-design.md §6, amended): using a `#const` as an
 * attribute value is standard RMS idiom —
 *
 *     #const PL_LANDS_CLUMPING_FAC 15
 *     create_land { clumping_factor PL_LANDS_CLUMPING_FAC }
 *
 * — and the original rule ("numeric slots accept number/rnd/expression/inf")
 * warned on every one of them. That is a goal-#5 violation (no false warnings
 * on legal maps), so a word that resolves to a known symbol now draws nothing
 * at all, and only genuinely-unresolvable names reach this builder.
 *
 * `includesPresent` softens to info, mirroring §7's rule for unknown symbols:
 * an `#include_drs` can define constants we cannot see, so we must not claim
 * the name is undefined — Pa_Site pulls 43 includes and would otherwise drown.
 */
export function unresolvedConstantInNumericSlot(
  token: Token,
  argDef: { name: string; type: string },
  includesPresent: boolean,
): Diagnostic {
  const base = includesPresent
    ? `"${token.text}" isn't defined in this file, so "${argDef.name}" may not get a valid ${argDef.type}. It may come from an include file — Age of RMS can't see inside those yet.`
    : `"${token.text}" isn't defined in this file, so "${argDef.name}" won't get a valid ${argDef.type}. Define it first with #const, e.g. "#const ${token.text} 10".`;
  const diagnostic = makeDiagnostic("RMS0202", base, toSpan(token));
  return includesPresent ? { ...diagnostic, severity: "info" } : diagnostic;
}

export function argOutOfRange(token: Token, argDef: { name: string; min?: number; max?: number }, unverified: boolean): Diagnostic {
  const range =
    argDef.min !== undefined && argDef.max !== undefined
      ? `${argDef.min}-${argDef.max}`
      : argDef.min !== undefined
        ? `at least ${argDef.min}`
        : `at most ${argDef.max}`;
  return capToInfo(
    makeDiagnostic("RMS0203", `"${token.text}" is outside the documented range for "${argDef.name}" (${range}).`, toSpan(token)),
    unverified,
  );
}

export function unknownDirective(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0206",
    `Unknown directive "${token.text}" — a leading # doesn't automatically make something a directive; the engine will ignore this token.`,
    toSpan(token),
  );
}

export function wrongContext(token: Token, is: "command" | "attribute", suppressedCount?: number): Diagnostic {
  const message =
    suppressedCount !== undefined
      ? `${suppressedCount} more command-level lines appear inside this block — likely all caused by the unclosed/glued brace above.`
      : is === "attribute"
        ? `"${token.text}" is an attribute — it belongs inside a { } block.`
        : `"${token.text}" is a command — it belongs outside a { } block. (Is the } above missing or glued to another token?)`;
  return makeDiagnostic("RMS0207", message, toSpan(token));
}

export function unclosedExpression(first: Token, last: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0208",
    "This ( never finds its closing ) — math expressions must be closed, e.g. (A + 1).",
    spanBetween(first, last),
  );
}

export function unclosedQuote(first: Token, last: Token): Diagnostic {
  return makeDiagnostic("RMS0209", 'This " is never closed — quoted filenames need a closing quote.', spanBetween(first, last));
}

export type ExpressionLintKind = "nestedParen" | "gluedOperator" | "rndInside" | "ungluedOperand" | "commentInside";

const EXPRESSION_LINT_MESSAGES: Record<ExpressionLintKind, string> = {
  nestedParen: "Nested parentheses inside a math expression — the engine silently drops this operand.",
  gluedOperator: "Operator glued to an operand — the engine needs spaces around operators: (A + 1), not (A+1).",
  rndInside: "rnd(...) is not allowed inside a math expression — compute it into a #const first.",
  ungluedOperand: "Operands must be glued to the bounding parentheses: (A + 1), not ( A + 1 ).",
  commentInside: "Comments break math expressions — move the comment outside the parentheses.",
};

export function expressionLint(kind: ExpressionLintKind, at: Span): Diagnostic {
  return makeDiagnostic("RMS0210", EXPRESSION_LINT_MESSAGES[kind], at);
}

export function includeXsQuoted(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0211",
    "#includeXS rejects quoted paths (a documented engine bug) — use a path without spaces instead.",
    toSpan(token),
  );
}

export function digitPrefixedWord(token: Token): Diagnostic {
  const digits = token.text.match(/^\d+/)?.[0] ?? token.text;
  return makeDiagnostic(
    "RMS0212",
    `The engine reads "${token.text}" as ${digits} and ignores the rest — remove the extra characters.`,
    toSpan(token),
  );
}

export function nestedRandom(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0213",
    "start_random blocks cannot be nested — use a first random block to #define which additional random block to run.",
    toSpan(token),
  );
}

export function malformedRnd(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0214",
    `"${token.text}" looks like rnd(...) but isn't the exact form rnd(min,max) — rnd() must contain no spaces.`,
    toSpan(token),
  );
}

// Distinct from argOutOfRange (RMS0203, "outside the documented range"):
// this fires for a value that IS within the documented/allowed range but
// that the reference data flags as risky — the message text comes from
// the triggering language.json entry's own cautionMessage, so it can say
// plainly that the value is valid RMS rather than reading as an error.
export function valueCaution(token: Token, message: string): Diagnostic {
  return makeDiagnostic("RMS0217", message, toSpan(token));
}

export function unexpectedValue(first: Token, last: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0215",
    "Unexpected value — a command, attribute, or directive was expected here.",
    spanBetween(first, last),
  );
}
