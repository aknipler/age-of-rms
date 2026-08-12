// Core lexer/parser types shared across src/parser/*. Per
// docs/parser-design.md Sec.14: no imports from React, Monaco, or Tauri
// anywhere under src/parser/ — it must run unchanged in plain Node
// (Vitest) and, later, in a bare web worker (CREATION_PLAN 2.4).

export type TokenKind =
  | "word" // default: commands, attributes, constants, labels, operators, paren-glued operands
  | "number" // /^-?\d+(\.\d+)?$/
  | "rnd" // /^rnd\(-?\d+,-?\d+\)$/ — DE inline random, a single token
  | "openBrace" // exactly "{"
  | "closeBrace" // exactly "}"
  | "commentOpen" // exactly "/*"
  | "commentClose" // exactly "*/"
  | "sectionHeader" // /^<[A-Z0-9_]+>$/
  | "directive"; // starts with "#" — not automatically a *real* directive; that's a parser-level judgment

export interface Token {
  text: string;
  start: number; // char offset, inclusive
  end: number; // char offset, exclusive — source.slice(start, end) === text
  kind: TokenKind;
  isTrivia: boolean; // set by the comment-span pass, except the leading-BOM token, which the lexer itself emits as trivia
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Span {
  start: number;
  end: number;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string; // beginner-first: what's wrong and what to do
  span: Span;
  /**
   * Optional beginner-facing fix suggestion (e.g. the nearest known name for
   * an unknown identifier). Populated for RMS0200 ("unknown name") today —
   * see unknownName() in diagnostics.ts. Consumed by the Breakdown raw-card
   * quick-fix (docs/breakdown-design.md Sec.3.7 / Appendix rev-2 changelog).
   */
  suggestion?: string;
}

export interface LexOptions {
  /**
   * Whether RMS's block comments (its only comment syntax) nest inside
   * each other. Defaults to true — DE-confirmed behavior per
   * docs/parser-design.md Sec.2 "Comment handling" (rev 2 had this
   * defaulting false, which was wrong).
   */
  nestedComments?: boolean;

  /**
   * Words the engine reads as `/*` **when they appear inside a comment**.
   *
   * The engine resolves every word to an internal token id and `/*` is 69, so
   * a word whose constant value is 69 opens a NESTED comment. Comments nest,
   * so the author's own closing marker shuts only the inner one and the rest of
   * the file is invisible to the engine. (Naming that marker here would end this
   * very comment, and the zero-width space that used to hold it apart was an
   * ESLint `no-irregular-whitespace` ERROR, so the lint gate was red on a
   * committed file. Describe the token, do not spell it.) Measured
   * 2026-08-11/12, parser-design Sec.2.1
   * amendment: `SHORE_FISH` (object 69) and `ATTR_PROJECTILE_ARC` (attribute
   * 69) both do it, the bare literal `69` does not.
   *
   * **Scoped to inside a comment, and that scoping is the whole safety of it.**
   * These words are ordinary constants in ordinary positions — real maps place
   * shore fish every day — so classifying them as `commentOpen` globally (the
   * `aliasTable` route) would truncate every map that names one. The engine
   * only reads a word as a comment marker while it is scanning for the end of
   * a comment.
   *
   * Empty by default: the lexer is a pure splitter and holds no RMS
   * vocabulary, so the caller supplies the set from reference data.
   */
  commentOpenAliases?: ReadonlySet<string>;
}

export interface LexResult {
  tokens: Token[]; // ALL tokens, including trivia, in source order
  lineOffsets: number[]; // lineOffsets[i] = char offset where line i (0-indexed) begins
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Phase 2.3: AST types, per docs/parser-design.md Sec.3/Sec.4.
//
// One deliberate representation choice, documented here because the spec's
// own Sec.4 sketches show `Token` objects while its Sec.3 says "AST nodes reference
// tokens by index" and rev 5's ArgNode uses indices: nodes store TOKEN
// INDICES (into ParseResult.tokens) everywhere, never Token objects. Indices
// are what the Sec.12 coverage/ownership properties and the Phase-3.3 patch
// engine actually need; the Token object is always one array lookup away.
// ---------------------------------------------------------------------------

import type { ArgumentDef, CommandDef, AttributeDef, DirectiveDef } from "./language";

// ---------------------------------------------------------------------------
// Two DEFAULTED TYPE PARAMETERS, per docs/parser-design.md Sec.4's amendment
// (accepted from tools-api-design rev 7). They exist so the Phase-5 tools
// contract can name the EXTERNAL WIRE form of a ParseResult as an
// instantiation of this tree rather than a hand-maintained copy of it:
//
//   SerializedParseResult = ParseResult<number | { inf: 1 | -1 }, NoDefs>
//
// N — the numeric form. JSON cannot carry Infinity (`JSON.stringify(Infinity)`
//     is `null`), and ArgValue legitimately holds it, so the wire encodes a
//     sentinel object. N marks every position where a PARSED NUMBER lands and
//     no other: token indices, offsets and `expr.tokens` stay `number`, which
//     is why a blanket deep mapped type was rejected — it would publish a type
//     claiming a token index might be infinite.
// D — the def slots. The wire strips `def` (JSON has no back-references, so a
//     shared CommandDef re-expands at every node — 41% of a 13 MB payload), and
//     the strip has to be VISIBLE to the compiler or a portable tool reads
//     `node.def?.name`, compiles, and silently gets undefined over the wire.
//
// Both parameters default, so every existing call site is untouched: bare
// `ParseResult` still means `ParseResult<number, DefSlots>`.
//
// Two mechanisms that look right and are not, both measured against
// `tsc --strict` rather than reasoned about:
//   - `def?: never` breaks assignability outright (`CommandDef | undefined` is
//     not assignable to `undefined`), which takes out the property the whole
//     scheme rests on: a real ParseResult must flow into the wire type.
//   - A `D extends "real" | "wire"` mode parameter with a CONDITIONAL property
//     type makes D unmeasurable for variance, and the two instantiations stop
//     being assignable on the type argument alone. INDEXED ACCESS
//     (`def?: D["command"]`) keeps variance measurement working.
// `unknown` is the one def type satisfying both halves — anything is assignable
// TO it (so ParseResult flows into the wire form) and nothing can be read OFF
// it without a cast (so a portable tool gets a compile error, not undefined).
// The property tests live in __tests__/wireTypes.test-d.ts.
// ---------------------------------------------------------------------------

/** In-process def slots: nodes carry their resolved language.json definition. */
export interface DefSlots {
  arg: ArgumentDef;
  command: CommandDef;
  attribute: AttributeDef;
  directive: DirectiveDef;
}

/** Wire def slots: present but unreadable. See the note above on `unknown`. */
export interface NoDefs {
  arg: unknown;
  command: unknown;
  attribute: unknown;
  directive: unknown;
}

export interface NodeBase {
  firstToken: number; // index into ParseResult.tokens, inclusive
  lastToken: number; // inclusive; single-token nodes have firstToken === lastToken
  span: Span; // derived: tokens[firstToken].start .. tokens[lastToken].end
}

// N lands in exactly two positions: the bare number, and the `rnd` bounds.
// The bounds are NOT an oversight-free freebie — parseRndValue() is Number()
// over an unbounded digit run, so `rnd(1,999…9)` reaches Infinity by the same
// route a bare number token does. `expr.tokens` stays number[]: those are token
// indices, and that distinction is the whole reason for a parameter rather than
// a deep mapped type.
export type ArgValue<N = number> =
  | N // includes floats; Infinity/-Infinity for inf/-inf words in numeric slots
  | { rnd: [N, N] }
  | { expr: { tokens: number[] } } // Sec.2.2 — token indices, unevaluated
  | string; // constant/label reference; quoted paths: assembled, quotes stripped

export interface ArgNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  value: ArgValue<N>;
  def?: D["arg"];
}

export interface CommandNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "command";
  name: number; // token index of the command name
  def?: D["command"]; // undefined = unknown command
  args: ArgNode<N, D>[];
  block?: BlockNode<N, D>;
}

export interface BlockNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "block";
  open: number; // token index of "{"
  close?: number; // token index of "}"; undefined = unclosed
  items: Item<N, D>[];
}

export interface AttributeNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "attribute";
  name: number;
  def?: D["attribute"];
  args: ArgNode<N, D>[];
}

export interface DirectiveNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "directive";
  hash: number; // token index of the "#..." token; its text is the directive name
  def?: D["directive"]; // undefined = unknown directive (RMS0206)
  args: ArgNode<N, D>[];
}

export interface IfBranch<N = number, D extends NoDefs = DefSlots> {
  keyword: number; // token index of if | elseif | else
  condition?: number; // token index; undefined for else / missing condition
  items: Item<N, D>[];
}

export interface IfNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "if";
  branches: IfBranch<N, D>[];
  endif?: number; // undefined = unclosed (RMS0105)
}

export interface RandomBranch<N = number, D extends NoDefs = DefSlots> {
  chanceKeyword: number; // token index of percent_chance
  chance?: ArgNode<N, D>;
  items: Item<N, D>[];
}

export interface RandomNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "random";
  start: number; // token index of start_random
  preamble: Item<N, D>[]; // items between start_random and the first percent_chance (RMS0106)
  branches: RandomBranch<N, D>[];
  end?: number; // undefined = unclosed (RMS0105)
}

export interface OrphanBlockNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "orphanBlock";
  block: BlockNode<N, D>;
}

export interface RawNode extends NodeBase {
  kind: "raw";
  reason: string;
}

// RawNode takes neither parameter on purpose: it has no children, no args and
// no def — an opaque, exactly-spanned token range.
export type Item<N = number, D extends NoDefs = DefSlots> =
  | CommandNode<N, D>
  | AttributeNode<N, D>
  | DirectiveNode<N, D>
  | IfNode<N, D>
  | RandomNode<N, D>
  | OrphanBlockNode<N, D>
  | RawNode;

export interface SectionNode<N = number, D extends NoDefs = DefSlots> extends NodeBase {
  kind: "section";
  header: number; // token index of the <SECTION_NAME> token
  name: string; // without the angle brackets
  known: boolean; // name ∈ language.json sections[]
  items: Item<N, D>[];
}

export interface ScriptNode<N = number, D extends NoDefs = DefSlots> {
  preamble: Item<N, D>[]; // items before the first <SECTION>
  sections: SectionNode<N, D>[];
}

export interface SymbolInfo {
  name: string;
  directiveKind: "define" | "const";
  nameToken: number;
  valueToken?: number; // #const only (may reference an expression's first token)
  // 0 = unconditionally defined. Counts BOTH if-branches AND start_random
  // branches (pinned, docs/parser-design.md Sec.3).
  conditionalDepth: number;
  // A later #undefine names this symbol — which does NOTHING in-engine
  // (docs/parser-design.md Sec.7). validate() must NOT treat it as removed.
  undefineAttempted?: boolean;
}

export interface IncludeInfo {
  directiveToken: number; // the #include_drs / #includeXS token
  path: string; // assembled, quotes stripped if quoted
  quoted: boolean;
}

export interface ParseOptions {
  nestedComments?: boolean; // default TRUE (docs/parser-design.md Sec.2)
  aliasTable?: ReadonlyMap<string, TokenKind>; // default empty (Sec.2.1) — lexer-level classification override
  commentOpenAliases?: ReadonlySet<string>; // default empty — words the engine reads as `/*` INSIDE a comment; see LexOptions
  maxNestingDepth?: number; // default 200 (Sec.5.0)
}

export interface ParseResult<N = number, D extends NoDefs = DefSlots> {
  source: string;
  tokens: Token[]; // ALL tokens including trivia, in order
  lineOffsets: number[]; // char offsets, never infinite — deliberately NOT parameterized
  script: ScriptNode<N, D>;
  symbols: SymbolInfo[];
  includes: IncludeInfo[];
  diagnostics: Diagnostic[]; // lexer + parser; validate() adds semantic ones separately
}
