// Core lexer/parser types shared across src/parser/*. Per
// docs/parser-design.md §14: no imports from React, Monaco, or Tauri
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
}

export interface LexOptions {
  /**
   * Whether RMS's block comments (its only comment syntax) nest inside
   * each other. Defaults to true — DE-confirmed behavior per
   * docs/parser-design.md §2 "Comment handling" (rev 2 had this
   * defaulting false, which was wrong).
   */
  nestedComments?: boolean;
}

export interface LexResult {
  tokens: Token[]; // ALL tokens, including trivia, in source order
  lineOffsets: number[]; // lineOffsets[i] = char offset where line i (0-indexed) begins
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Phase 2.3: AST types, per docs/parser-design.md §3/§4.
//
// One deliberate representation choice, documented here because the spec's
// own §4 sketches show `Token` objects while its §3 says "AST nodes reference
// tokens by index" and rev 5's ArgNode uses indices: nodes store TOKEN
// INDICES (into ParseResult.tokens) everywhere, never Token objects. Indices
// are what the §12 coverage/ownership properties and the Phase-3.3 patch
// engine actually need; the Token object is always one array lookup away.
// ---------------------------------------------------------------------------

import type { ArgumentDef, CommandDef, AttributeDef, DirectiveDef } from "./language";

export interface NodeBase {
  firstToken: number; // index into ParseResult.tokens, inclusive
  lastToken: number; // inclusive; single-token nodes have firstToken === lastToken
  span: Span; // derived: tokens[firstToken].start .. tokens[lastToken].end
}

export type ArgValue =
  | number // includes floats; Infinity/-Infinity for inf/-inf words in numeric slots
  | { rnd: [number, number] }
  | { expr: { tokens: number[] } } // §2.2 — token indices, unevaluated
  | string; // constant/label reference; quoted paths: assembled, quotes stripped

export interface ArgNode extends NodeBase {
  value: ArgValue;
  def?: ArgumentDef;
}

export interface CommandNode extends NodeBase {
  kind: "command";
  name: number; // token index of the command name
  def?: CommandDef; // undefined = unknown command
  args: ArgNode[];
  block?: BlockNode;
}

export interface BlockNode extends NodeBase {
  kind: "block";
  open: number; // token index of "{"
  close?: number; // token index of "}"; undefined = unclosed
  items: Item[];
}

export interface AttributeNode extends NodeBase {
  kind: "attribute";
  name: number;
  def?: AttributeDef;
  args: ArgNode[];
}

export interface DirectiveNode extends NodeBase {
  kind: "directive";
  hash: number; // token index of the "#..." token; its text is the directive name
  def?: DirectiveDef; // undefined = unknown directive (RMS0206)
  args: ArgNode[];
}

export interface IfBranch {
  keyword: number; // token index of if | elseif | else
  condition?: number; // token index; undefined for else / missing condition
  items: Item[];
}

export interface IfNode extends NodeBase {
  kind: "if";
  branches: IfBranch[];
  endif?: number; // undefined = unclosed (RMS0105)
}

export interface RandomBranch {
  chanceKeyword: number; // token index of percent_chance
  chance?: ArgNode;
  items: Item[];
}

export interface RandomNode extends NodeBase {
  kind: "random";
  start: number; // token index of start_random
  preamble: Item[]; // items between start_random and the first percent_chance (RMS0106)
  branches: RandomBranch[];
  end?: number; // undefined = unclosed (RMS0105)
}

export interface OrphanBlockNode extends NodeBase {
  kind: "orphanBlock";
  block: BlockNode;
}

export interface RawNode extends NodeBase {
  kind: "raw";
  reason: string;
}

export type Item = CommandNode | AttributeNode | DirectiveNode | IfNode | RandomNode | OrphanBlockNode | RawNode;

export interface SectionNode extends NodeBase {
  kind: "section";
  header: number; // token index of the <SECTION_NAME> token
  name: string; // without the angle brackets
  known: boolean; // name ∈ language.json sections[]
  items: Item[];
}

export interface ScriptNode {
  preamble: Item[]; // items before the first <SECTION>
  sections: SectionNode[];
}

export interface SymbolInfo {
  name: string;
  directiveKind: "define" | "const";
  nameToken: number;
  valueToken?: number; // #const only (may reference an expression's first token)
  // 0 = unconditionally defined. Counts BOTH if-branches AND start_random
  // branches (pinned, docs/parser-design.md §3).
  conditionalDepth: number;
  // A later #undefine names this symbol — which does NOTHING in-engine
  // (docs/parser-design.md §7). validate() must NOT treat it as removed.
  undefineAttempted?: boolean;
}

export interface IncludeInfo {
  directiveToken: number; // the #include_drs / #includeXS token
  path: string; // assembled, quotes stripped if quoted
  quoted: boolean;
}

export interface ParseOptions {
  nestedComments?: boolean; // default TRUE (docs/parser-design.md §2)
  aliasTable?: ReadonlyMap<string, TokenKind>; // default empty (§2.1) — lexer-level classification override
  maxNestingDepth?: number; // default 200 (§5.0)
}

export interface ParseResult {
  source: string;
  tokens: Token[]; // ALL tokens including trivia, in order
  lineOffsets: number[];
  script: ScriptNode;
  symbols: SymbolInfo[];
  includes: IncludeInfo[];
  diagnostics: Diagnostic[]; // lexer + parser; validate() adds semantic ones separately
}
