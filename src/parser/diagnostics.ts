import type { Diagnostic, DiagnosticSeverity, Span, Token } from "./types";

/**
 * Full diagnostic code table from docs/parser-design.md Sec.10. Severities
 * here are the PINNED defaults; a handful of parser-level codes (marked
 * † in the spec — RMS0201/0202/0203) get downgraded to "info" at the
 * call site when the underlying language.json entry is `"verified": false`
 * (spec Sec.6.2) — that's a per-call override, not part of this table.
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
  RMS0200: { severity: "warning", summary: "Unrecognised command/attribute name, with did-you-mean" },
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
  // original Sec.10 table — logged there as an amendment instead of a full
  // rewrite). Distinct from RMS0203: the value is NOT out of the documented
  // range (no min/max violation) — it's a real, valid value that reference
  // data flags as risky. Message must say so explicitly (see cautionMessage
  // on the triggering language.json entry) so it doesn't read as an error.
  //
  // INFO, not warning (changed 2026-08-05). `cautionBelow` is a per-argument
  // scalar, so the check can only see the value — never the condition that
  // makes it risky, which lives elsewhere in the block. The border caution is
  // the whole of its current use and the corpus settles it: of the 135
  // attributable sites, 135 sit in a block that also carries `land_position`
  // or `base_size` — the guide's own two prescribed mitigations — and 0 sit in
  // a block with neither. A warning severity would fire hardest on authors who
  // did the documented thing, which is goal #5 exactly backwards. Upgrading it
  // needs the block-level condition, and that belongs in validate().
  RMS0217: { severity: "info", summary: "Value is valid RMS but reference data flags a caution for it" },

  // ---- Semantic pass (validate(), spec Sec.8) ----
  //
  // Added post-spec, in the same "amendment, not a silent fold-in" style
  // RMS0217 established. Sec.8 enumerates the semantic checks but assigns
  // codes to only two of them (RMS0204/RMS0205, which it names explicitly
  // and which are built here rather than in the parser because both need
  // the whole file at once). The remaining nine checks had no codes, so
  // they get their own RMS03xx block, continuing the existing grouping
  // (RMS00xx lexical, RMS01xx structural, RMS02xx names/arguments).
  //
  // Severity discipline is unchanged from Sec.10: error is a strong claim
  // (goal #5). Exactly one code here carries it — RMS0311, whose condition
  // is engine-verified and whose consequence is a map that ships broken.
  RMS0300: { severity: "warning", summary: "Name is not defined anywhere in this file" },
  RMS0301: { severity: "warning", summary: "Redefinition — the first definition wins in-engine" },
  // Split by what the engine actually does, which is NOT the same for the two
  // kinds of name Sec.8 lumped together (2026-07-31 corpus review, spec Sec.8
  // amended). A game constant really is defined before the script runs, so a
  // user #const of it never takes effect — but only a value that DIFFERS from
  // the engine's is a bug, and the warning tier is reserved for that. A
  // predefined LABEL is not defined unconditionally at all (see RMS0312), so
  // it never belonged under this code.
  RMS0302: { severity: "warning", summary: "User #const of a built-in game constant — the engine keeps its own value" },
  RMS0303: { severity: "warning", summary: "Name is used above the line that defines it" },
  // DELIBERATELY NOT BUILT — listed, like the Phase 2.2 codes above it, so the
  // number stays reserved and nobody re-derives it. Sec.8 asks for a
  // wrong-section warning from `CommandDef.section`, but that field records
  // where the guide DOCUMENTS a command, not where the engine accepts it:
  // implemented as written it fired 53 times across the 57-map corpus, 52 of
  // them on `effect_amount` used in <OBJECTS_GENERATION>/<LAND_GENERATION> by
  // shipped, working maps. Which commands are genuinely section-locked is an
  // in-game question (spec Sec.11), and until it's answered this check can't
  // tell a real mistake from a documentation artifact.
  RMS0304: { severity: "warning", summary: "Command sits in a section the engine will not run it from" },
  RMS0305: { severity: "info", summary: "No <PLAYER_SETUP> section" },
  RMS0306: { severity: "info", summary: "Non-repeatable attribute given more than once — the engine uses the last" },
  RMS0307: { severity: "warning", summary: "Mutually exclusive attributes in the same block" },
  RMS0308: { severity: "warning", summary: "percent_chance / rnd range problem" },
  RMS0309: { severity: "info", summary: "effect_percent is obsolete (Update 141935)" },
  RMS0310: { severity: "info", summary: "Non-functional syntax — parses, but does nothing in DE" },
  RMS0311: { severity: "error", summary: "base_elevation without an <ELEVATION_GENERATION> section" },
  // Added 2026-07-31 by the corpus review, carved out of RMS0302. Every one of
  // language.json's 138 predefinedLabels is a RUNTIME CONDITION — the engine
  // defines EMPIRE_WARS only in an Empire Wars game, MAPSIZE_TINY only on a
  // tiny map — so a user #define of one is not shadowed and not a no-op. It
  // switches the condition on by hand, which is the documented way to test a
  // mode-specific branch. Info, never warning: the corpus's six instances are
  // all guarded by a testing flag and all correct.
  RMS0312: { severity: "info", summary: "User #define of an engine condition label — switches the condition on by hand" },
  // Added 2026-07-31 by the corpus review. The strongest claim in the whole
  // RMS03xx block and the cheapest to make: every branch of one if/elseif
  // chain is tested against the same set of defines at the same point in the
  // token stream, so a condition that already appeared earlier in that chain
  // cannot be reached. No guard algebra, no monotonicity precondition, no
  // reference data. Found DE's own nomad.rms testing INDOMALAYAN_TROPICAL
  // twice in one ladder — 23 lines of biome configuration that never run.
  RMS0313: { severity: "warning", summary: "elseif repeats a condition from earlier in the same chain — the branch is unreachable" },
  // CREATION_PLAN 2.6, built 2026-07-31. RMS0301's claim ("the first
  // definition wins, this value never applies") reached across execution
  // paths rather than along one: an earlier definition guarded by a SUBSET of
  // this one's conditions has already run whenever this one can. Separate
  // code rather than a widened RMS0301 because the fix differs — RMS0301 says
  // delete the line, this usually says move the unconditional default below
  // the conditional ones — and because a shared code makes the two
  // indistinguishable in a corpus measurement.
  RMS0314: { severity: "warning", summary: "#const is shadowed by an earlier one whose conditions this line also requires" },
  // Added 2026-08-10. A guide "Requires:" line, which reads like documentation
  // of an attribute and is a rule about the whole block: without a partner
  // attribute the command places NOTHING, silently, while the rest of the map
  // generates normally. Same argument for reporting it as RMS0304 — an author
  // cannot find this by looking at their map. The only entry today is
  // ignore_terrain_restrictions, confirmed in game rather than reasoned from
  // the guide alone, and the check reads `requiresOneOf` from the data so a
  // second entry needs no code change.
  RMS0315: { severity: "warning", summary: "Attribute needs a partner attribute in the same block, and there is none" },
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
// Message philosophy per docs/parser-design.md Sec.10: beginner-first — say
// what's wrong AND what to do. Severity comes from the pinned table above;
// `capToInfo` implements the spec's † rule (Sec.6.2): arity/type/range
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

/**
 * RMS0200. Two messages, because the two branches rest on different evidence —
 * see docs/known-issues.md BUG-005 for the measurement behind the split.
 *
 * **With a did-you-mean**, a known name sits within edit distance of this one.
 * That is *positive* evidence of a typo (the same distance-based reasoning
 * RMS0300 uses), and it also licenses the behavioural clause: if the author
 * meant `set_loose_grouping` and wrote `set_loose grouping`, the engine
 * demonstrably is not applying loose grouping. Install-wide this branch is
 * where the value is — it found all 563 true positives in the 276-file DE
 * scan, including `set_loose grouping` 457 times and `set_scale_by_group`
 * singular 96 times in `includes/water_blending.inc`, a file that writes the
 * correct plural 47 times alongside.
 *
 * **Without one**, the only evidence is that the name is absent from
 * `language.json`, and CLAUDE.md's positive-resolver rule is explicit that
 * absence from reference data proves nothing. The old text asserted "the
 * engine will silently ignore it" on exactly that, 858 times on the corpus —
 * and was plausibly *false* on its single largest input, since
 * `avoidance_distance` (256 of the 858) is undetermined rather than wrong: no
 * shipped script can distinguish a real attribute from a discarded token when
 * every use passes a constant defined as 0. So this branch now reports the
 * observation we actually made and says nothing about the engine.
 *
 * Deliberately NOT changed here: the `L`-aliasing case (581 corpus hits) and
 * the severity question. Both are BUG-005 pieces 2 and 3, both are spec
 * changes rather than wording, and piece 3 in particular would have buried the
 * include-file findings above.
 */
export function unknownName(token: Token, context: "command" | "attribute", suggestion?: string): Diagnostic {
  const message = suggestion
    ? `Unknown ${context} "${token.text}" — the engine will silently ignore it. Did you mean "${suggestion}"?`
    : `Age of RMS doesn't recognise the ${context} "${token.text}".`;
  const diagnostic = makeDiagnostic("RMS0200", message, toSpan(token));
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
 * Why this exists (docs/parser-design.md Sec.6, amended): using a `#const` as an
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
 * `includesPresent` softens to info, mirroring Sec.7's rule for unknown symbols:
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

// ---- Semantic diagnostic builders (validate(), spec Sec.8) ----
//
// Two rules run through this whole block.
//
// 1. INCLUDE SOFTENING (Sec.7). An `#include_drs` can define constants we
//    cannot read, so once a file has any include we must not claim a name is
//    undefined — every "I can't find this" diagnostic drops to info and says
//    why. Pa_Site pulls 43 includes and would otherwise drown in false
//    warnings. Same rule the parser already applies in
//    unresolvedConstantInNumericSlot; shared here as one helper so the two
//    passes can't drift apart.
// 2. BEGINNER-FIRST WORDING (Sec.10). Every message says what the engine
//    actually does — "ignores it and keeps going", "uses the last one",
//    "the first definition wins" — because the defining property of all of
//    these is that the map still generates. Nothing looks broken, which is
//    exactly why they're worth reporting.

/**
 * Drops a diagnostic to info and appends the "may be in an include" caveat.
 * Applied only to diagnostics that assert a name is missing — never to ones
 * about structure (duplicate definitions, wrong section), which an include
 * file cannot explain away.
 */
function softenForIncludes(diagnostic: Diagnostic, includesPresent: boolean): Diagnostic {
  if (!includesPresent) return diagnostic;
  return {
    ...diagnostic,
    severity: "info",
    message: `${diagnostic.message} It may come from an include file — Age of RMS can't see inside those yet.`,
  };
}

export function bareNumericId(token: Token, argDef: { name: string }, resolvedName?: string): Diagnostic {
  // Sec.6's provenance gate: only name the constant when the game-constants
  // entry it came from carries verified provenance. Without that, saying
  // "32 is SNOW" would be asserting a placeholder ID as fact.
  const message = resolvedName
    ? `${token.text} is the ID for ${resolvedName} — writing ${resolvedName} instead makes this line readable at a glance.`
    : `"${argDef.name}" was given a bare numeric ID. Named constants read better — check the reference panel for the name of this one.`;
  const diagnostic = makeDiagnostic("RMS0204", message, toSpan(token));
  if (resolvedName) diagnostic.suggestion = resolvedName;
  return diagnostic;
}

export function crossCategoryConstant(
  token: Token,
  actualCategory: string,
  expectedCategory: string,
  argDef: { name: string },
): Diagnostic {
  return makeDiagnostic(
    "RMS0205",
    `${token.text} is a ${actualCategory} constant, but "${argDef.name}" expects ${expectedCategory === "object" ? "an" : "a"} ${expectedCategory}. The engine reads every constant as a number, so this still runs — it just probably isn't what you meant.`,
    toSpan(token),
  );
}

/**
 * Only ever raised with a `suggestion` — a name close enough to be a typo of
 * something real. The message leads with the consequence rather than the
 * spelling, because the consequence is the part that isn't visible: the map
 * generates perfectly and this branch simply never runs.
 */
export function undefinedName(token: Token, suggestion: string, includesPresent: boolean): Diagnostic {
  const diagnostic = makeDiagnostic(
    "RMS0300",
    `"${token.text}" is never defined, so this branch never runs — did you mean "${suggestion}"?`,
    toSpan(token),
  );
  diagnostic.suggestion = suggestion;
  return softenForIncludes(diagnostic, includesPresent);
}

export function duplicateDefinition(token: Token, firstDefinition: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0301",
    `"${token.text}" is already defined at offset ${firstDefinition.start}. The engine keeps the FIRST definition and ignores this one — the value here never takes effect.`,
    toSpan(token),
  );
}

/**
 * RMS0314. Two messages, because the two shapes need different advice.
 *
 * `earlierConditions` empty means the shadowing definition is unconditional,
 * which is the beginner case worth teaching: declaring a default and then
 * "overriding" it inside a branch is the habit that transfers from every brace
 * language and is exactly backwards in RMS, where the first definition wins.
 * The message says what to do instead, not only what is wrong.
 *
 * Otherwise both sit under conditions and the earlier one's are a subset, so
 * the message names the shared ones — that is the part the author has to see
 * to believe the claim, since the two lines can be hundreds of lines apart.
 */
export function subsumedDefinition(token: Token, firstDefinition: Token, earlierConditions: string[]): Diagnostic {
  const message =
    earlierConditions.length === 0
      ? `"${token.text}" is already set unconditionally at offset ${firstDefinition.start}, above this line. That one always runs, and the engine keeps the FIRST definition, so this value never applies. In RMS a default has to come AFTER the conditional versions of a constant, not before them.`
      : `"${token.text}" is already set at offset ${firstDefinition.start} under ${earlierConditions.map((c) => `"${c}"`).join(" and ")}, which this line also requires. So whenever this line runs, that one has already run — and the engine keeps the FIRST definition, so this value never applies.`;
  return makeDiagnostic("RMS0314", message, toSpan(token));
}

/**
 * RMS0302, warning tier. The only version of this check with a real bug behind
 * it: the script assigns a value the engine will never adopt, so every use of
 * the name below still means the engine's number. Raised only on POSITIVE
 * evidence of the mismatch — a verified `constId` to compare against and an
 * integer literal to compare it with (spec Sec.6's provenance gate).
 */
export function shadowedConstantValueIgnored(token: Token, engineValue: number, writtenValue: number): Diagnostic {
  return makeDiagnostic(
    "RMS0302",
    `${token.text} is a built-in game constant meaning ${engineValue}. The engine defines it before your script runs and keeps its own definition, so ${writtenValue} never applies — every ${token.text} below this line still means ${engineValue}. Pick a different name for your own constant.`,
    toSpan(token),
  );
}

/**
 * RMS0302, info tier — the dominant real-world case by a wide margin. All 73
 * corpus instances redefine a constant to the value the engine already has,
 * inside an `if TERRAIN_CONSTANTS` documentation header copied between maps.
 * The line genuinely does nothing, which is worth saying once and quietly; it
 * is not worth a warning and it is certainly not worth "pick a different name",
 * since the author's intent is to write the ID down, not to change it.
 *
 * `engineValue` is absent when the constants DB has no verified ID to quote —
 * the claim then narrows to "the engine keeps its own definition", which holds
 * without knowing the number.
 */
export function redundantConstantDefinition(token: Token, engineValue?: number): Diagnostic {
  const message =
    engineValue === undefined
      ? `${token.text} is already a built-in game constant. The engine defines it before your script runs and keeps its own definition, so this line has no effect.`
      : `${token.text} is already a built-in game constant meaning ${engineValue}, and this line sets it to the same thing — so it changes nothing. Harmless as documentation; deleting it is equally harmless.`;
  return { ...makeDiagnostic("RMS0302", message, toSpan(token)), severity: "info" };
}

/**
 * RMS0312. Deliberately NOT phrased as a mistake. The engine sets these from
 * the game being played, so `#define EMPIRE_WARS` is a working override in
 * every game that isn't Empire Wars — the standard way to exercise a
 * mode-specific branch while authoring. The only thing worth saying is what
 * happens if it ships unguarded.
 */
export function overridesEngineCondition(token: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0312",
    `${token.text} is a condition the engine sets for you from the game being played. Defining it yourself switches it on by hand, which is the usual way to test a branch — but if this isn't behind a testing flag, every game will take that branch.`,
    toSpan(token),
  );
}

export function usedBeforeDefinition(token: Token, definedAt: number, includesPresent: boolean): Diagnostic {
  return softenForIncludes(
    makeDiagnostic(
      "RMS0303",
      `"${token.text}" isn't defined until offset ${definedAt}, below this line. Definitions only count higher up in the file, so the engine ignores this one — move the #define/#const above this line.`,
      toSpan(token),
    ),
    includesPresent,
  );
}

export function missingPlayerSetup(at: Span): Diagnostic {
  return makeDiagnostic(
    "RMS0305",
    "This script has no <PLAYER_SETUP> section. Most maps need one to place players — add it above the other sections.",
    at,
  );
}

/**
 * The message leads with the reasoning rather than the rule, because the rule
 * ("first match wins in an if/elseif chain") is one every programmer already
 * knows and would not have violated on purpose. What makes this worth a
 * diagnostic is that the two branches can sit hundreds of lines apart — the
 * corpus specimen has 130 lines between them — so nothing about reading the
 * code locally reveals it.
 */
export function unreachableBranch(token: Token, earlierAt: number): Diagnostic {
  return makeDiagnostic(
    "RMS0313",
    `"${token.text}" is already tested at offset ${earlierAt} in this same if/elseif chain. If it were true, that earlier branch would have run instead — so this branch can never be reached and nothing inside it takes effect.`,
    toSpan(token),
  );
}

export function duplicateAttribute(token: Token, firstUse: Token): Diagnostic {
  return makeDiagnostic(
    "RMS0306",
    `"${token.text}" is already set at offset ${firstUse.start} in this block. This attribute doesn't stack, so the engine uses the last one and ignores the earlier.`,
    toSpan(token),
  );
}

/**
 * RMS0307. The base message claims only what `mutexWith` actually records — the
 * guide lists the two as mutually exclusive — because for most pairs that is
 * all the guide says. It used to add "they set the same thing two different
 * ways", which is false for the pair that dominates this check's output:
 * `set_scale_by_size` scales the tile count and `set_scale_by_groups` scales
 * the clump count, so they set different things.
 *
 * `note` is the entry's own `mutexNote` and carries the consequence and the fix
 * for pairs where the guide states them. Data-driven on purpose: the advice
 * differs per pair and hardcoding it here would put vocabulary in the code.
 */
export function mutuallyExclusive(
  token: Token,
  otherName: string,
  otherAt: number,
  note?: string,
): Diagnostic {
  const base = `"${token.text}" and "${otherName}" (offset ${otherAt}) are documented as mutually exclusive, so using both in one block means at least one of them has no effect.`;
  return makeDiagnostic("RMS0307", note ? `${base} ${note}` : `${base} Keep the one you want.`, toSpan(token));
}

/**
 * RMS0315 — an attribute whose guide "Requires:" partner is nowhere in the block.
 *
 * The message leads with the CONSEQUENCE for the same reason RMS0304's does:
 * "this attribute requires that one" reads as a syntax rule and earns a shrug,
 * while "this command places nothing" is the thing the author would want to
 * know and cannot observe. The engine reports no error, the map generates, and
 * the objects are simply absent.
 *
 * `note` is the entry's own `requiresNote` and carries what unmet actually
 * looks like. Data-driven for `mutuallyExclusive`'s reason: the consequence
 * differs per attribute and hardcoding it here would put vocabulary in code.
 *
 * `options` comes from the data too, so the message names the real partners
 * without this function knowing any of them.
 */
export function missingRequiredPartner(token: Token, options: readonly string[], note?: string): Diagnostic {
  const list = options.length === 1 ? `"${options[0]}"` : options.map((o) => `"${o}"`).join(" or ");
  const base = `"${token.text}" only does anything when ${list} is in the same block, and neither this block nor any branch inside it has one.`;
  return makeDiagnostic("RMS0315", note ? `${base} ${note}` : `${base} Add one of them, or remove this line.`, toSpan(token));
}

export type ChanceLintKind = "unreachable" | "under99" | "zeroFirst" | "reversedRange" | "constantRange";

// Both cumulative thresholds are 99. The guide says only the first 99% of a
// random block is ever reachable and that "the 100th percent is never chosen"
// (guide:3006-3007, 3010), so 99 is a full total and 99 is also where the
// reachable range ends. See Validator.checkChances for the corpus effect.
const CHANCE_LINT_MESSAGES: Record<ChanceLintKind, string> = {
  unreachable:
    "The percent_chance branches above this one already add up to 99 or more, so this branch can never be picked — the engine only ever rolls into the first 99%. Lower the earlier percentages to make room.",
  under99:
    "These percent_chance branches add up to less than 99, so there's a chance none of them runs. That's fine if it's deliberate — raise the total to 99 if it isn't.",
  zeroFirst: "percent_chance 0 on the first branch doesn't skip it — the engine runs it anyway. Remove the branch instead.",
  reversedRange: "This rnd() has its high end below its low end, so it never varies. The two values look swapped.",
  constantRange: "Both ends of this rnd() are the same number, so it always returns that number — the rnd() isn't doing anything.",
};

export function chanceLint(kind: ChanceLintKind, at: Span): Diagnostic {
  const diagnostic = makeDiagnostic("RMS0308", CHANCE_LINT_MESSAGES[kind], at);
  // Two of the five aren't evidence of a mistake. An under-99 total is a real
  // technique (a random block that sometimes does nothing), and an rnd()
  // with equal bounds is usually a templated line someone flattened on
  // purpose — 11 of them in one corpus map, e.g. rnd(96,96). A genuinely
  // REVERSED range is different: nobody writes rnd(5,1) deliberately.
  return kind === "under99" || kind === "constantRange" ? { ...diagnostic, severity: "info" } : diagnostic;
}

/** `guidance` is the def's own `deprecated` string — the data says what to do instead. */
export function deprecatedCommand(token: Token, guidance: string): Diagnostic {
  return makeDiagnostic("RMS0309", `"${token.text}" is obsolete — ${guidance}. It still runs, so this is safe to leave.`, toSpan(token));
}

/**
 * RMS0304 — a `sectionLocked` command sitting where the engine discards it.
 *
 * The message states the CONSEQUENCE rather than the rule, because the rule
 * ("commands belong to sections") reads as a style convention and earns a
 * shrug. What makes this worth a warning is that the line does nothing at all,
 * silently, while the rest of the map generates normally — which is precisely
 * what RMSTEST_33a/33b measured, three runs each. An author cannot find this by
 * looking at their map, and that is the whole argument for reporting it.
 *
 * Deliberately not phrased as "move it to the end of the file": the right home
 * is the named section, which may well already exist further down.
 */
export function wrongSection(token: Token, belongsIn: string, foundIn: string): Diagnostic {
  return makeDiagnostic(
    "RMS0304",
    `"${token.text}" only works inside <${belongsIn}>, but this one is in <${foundIn}> — the engine skips it, and the rest of the map generates as though the line were not there. Move it into <${belongsIn}>.`,
    toSpan(token),
  );
}

/**
 * `replacedBy` is set only for the dead ATTRIBUTE strings, where a working
 * name exists and the whole point of carrying an entry is to say so. The
 * directives have no replacement — `#undefine` and `#include` correspond to
 * nothing you should write instead — so their message ends at "delete it".
 */
export function nonFunctionalSyntax(token: Token, replacedBy?: string): Diagnostic {
  const message = replacedBy
    ? `"${token.text}" parses, but it does nothing in DE — the engine carries the word with no behavior behind it. You probably want "${replacedBy}".`
    : `${token.text} parses, but it does nothing in DE — the engine has the word and no behavior behind it. Deleting the line changes nothing.`;
  const diagnostic = makeDiagnostic("RMS0310", message, toSpan(token));
  if (replacedBy) diagnostic.suggestion = replacedBy;
  return diagnostic;
}

/**
 * The one error-severity semantic check (spec Sec.10: error is a strong
 * claim). Both halves of the wording are deliberate. That the slopes don't
 * generate without the section is verified — in-game, Phase 4.1, by
 * RMSTEST_4_negelev.rms. That the map then crashes when played is a
 * second-hand report from the guide's author and is attributed, not asserted;
 * the check earns its severity from the first half alone.
 */
export function missingRequiredSection(token: Token, requiredSection: string): Diagnostic {
  return makeDiagnostic(
    "RMS0311",
    `"${token.text}" needs a <${requiredSection}> section, and this script has none. The map still generates and looks fine, but the setting never takes effect — and maps in this state have been reported to crash when actually played. The section can be completely empty; adding the header is the whole fix.`,
    toSpan(token),
  );
}
