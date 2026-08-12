# RMS Parser Design (rev 6)

Spec for the error-tolerant AoE2:DE RMS parser in `src/parser/`. Rev 2 resolved the first critique; rev 3 folded in the corpus/patch-notes/full-guide critique (`docs/REVISION_3.md`); rev 4 the independent corpus re-derivation; rev 5 the fifth critique (`docs/REVISION_5.md`). **Rev 6 folds in `docs/parser-design-rev5-review.md` and is the first revision written after the whole pass shipped** — lexer, parser, `validate()` and Phase 3 are all built, so its job is mostly the reverse of its predecessors': bringing the spec back level with the code, and correcting three checks that disagreed with their own sources. **Implementation sessions: do not deviate from this spec — if something here seems wrong or ambiguous, stop and escalate rather than improvising.**

**Corpus vintages — three sets are live in this document, and each statistic says which.** Tag every new one the same way.

| Tag | Set | Where it comes from |
|---|---|---|
| *(12-file)* | The snapshot REVISION_5 Sec.1 verified | Rev 3–5 statistics. Historical; do not re-derive against it. |
| *(52 `.rms`)* | Every `.rms` under `test-maps/`, `test-maps/local/` and `test-maps/broken/` | The current default. `corpus.test.ts` and both `*.measure.test.ts` harnesses walk exactly this set. |
| *(57 incl. `.rms2`)* | The 52 plus the five `.rms2` files | The `validate()` scoping measurements of 2026-07-31. `.rms2` is excluded from every gate (Sec.12). |

A 2026-08-05 re-derivation confirmed the rev-5 numbers that survive here — RMS0200 858, RMS0201 32, RMS0202 61+45, RMS0301 38, RMS0302 73 — all against the 52-file set.

## 1. Goals and non-goals

Goals, in priority order:

1. **Never throws.** Any input (including empty, binary garbage, half-typed code, or pathologically nested constructs) produces a `ParseResult` with a best-effort AST + diagnostics. See Sec.5.0 for the recursion-safety mandate this implies.
2. **Exact source fidelity.** Every node records precise character offsets; the source text itself is retained. Downstream tooling (Breakdown's text-patch engine, 3.3) computes minimal text edits from spans — the parser never re-prints code, so untouched text is byte-identical by construction.
3. **Graceful degradation.** Anything unparseable becomes an explicit `RawNode` covering its exact span, never silently dropped (per CLAUDE.md convention).
4. **Data-driven.** Command, attribute, directive, control-keyword, section, and predefined-label knowledge comes exclusively from `reference/data/language.json` — nothing hardcoded. Unverified entries (`"verified": false`) must degrade safely (Sec.6).
5. **No false errors — or false warnings — on legal maps.** Error severity is reserved for constructs we are confident the engine rejects or mangles; warnings must be grounded in guide-verified or corpus-verified engine behavior. The corpus *(12-file, 11 maps + `sample.rms`, ~123k tokens)* is the regression suite for this goal: it contains live math expressions, float constants, 43-file include chains, and legal duplicate sections that rev 2 would have flagged spuriously.
6. **Fast enough for per-keystroke reparse**: full parse of `AK_Vanguard_v1.2.rms` (366 KB, ~49.7k tokens — the corpus's largest file and the named benchmark; note line count does not predict token count) in low single-digit milliseconds (Sec.9). The file was called `Vanguard_v1.2.rms` through rev 5 and the stale name silently dropped it from a gate (`corpus.test.ts:52`) — the same failure mode rev 5 caught for the BCC2 filename in Sec.12.

**Two rules bind every pass in this document, not only the one that established them.** Both are CLAUDE.md hard rules; they are restated here because the syntactic pass predates them and violated both.

- **Reference data is a positive resolver, never a negative authority.** Finding a name in `language.json` / `game-constants.json` / `predefinedLabels` proves something; *not* finding one proves nothing. No diagnostic in either pass may take absence from our own data as evidence. This was written while building `validate()` (Sec.10, RMS03xx scoping rule 1), applied thoroughly there, and never carried back — `RMS0200` went on asserting "the engine will silently ignore it" on 858 corpus sites *(52 `.rms`)* with nothing behind it but a missing entry (`known-issues.md` BUG-005). **A rule established in one pass is not established in the passes that predate it: when a rule lands, grep for the older code it now governs.**
- **A reference-data hit says what a name *is*, never what the engine has already done with it.** The harder half. Every one of the 138 `predefinedLabels` is a runtime condition, so a hit proves the engine *may* define the name, not that it *has*. Before any diagnostic asserts engine behaviour, name the observation behind the claim. RMS0217 shipped a crash the guide never describes (Sec.10) on exactly this failure.

Non-goals: incremental parsing (full reparse is fast enough; the API is a pure function so incremental can be added later); evaluating conditionals, randoms, or math expressions (that's the preview generator's job — but see Sec.2.2 for the semantics it must implement); resolving include-file contents (v1 records includes and softens symbol diagnostics, Sec.7); semantic validation beyond structure (separate `validate()` pass, Sec.8).

## 2. The RMS lexical model — the insight everything rests on

The game engine does not have a grammar in the usual sense. It reads the file as a **whitespace-separated token stream** and processes it linearly. Consequences that shape this whole design:

1. **Tokens are maximal runs of non-whitespace.** `{`, `}`, `/*`, `*/` are ordinary tokens and are only recognized when whitespace-delimited. `create_land{` is a *single unknown token*, not a command plus a brace. `/*comment*/` is one token, **not a comment** (guide-confirmed, with fixture strings: `/*this is NOT a comment*/`, `/*** ***/`, `/* this comment never ends */*`, `#this is NOT a comment`).
2. **Comments are a token-stream construct**: everything between a `/*` token and its matching `*/` token — **and they nest** (guide-confirmed: "the sub comment will not prematurely terminate the main comment"). An unclosed `/*` comments out the rest of the file.
3. **`if`/`start_random` are token-stream filters, not grammar.** The engine evaluates them *before* interpreting commands: inactive branches' tokens are simply deleted from the stream. Conditionals can legally split *anything* — guide Example2 (line 3244) is literally `if REGICIDE create_object KING else create_object SCOUT endif { … }`, which routes through Sec.5.4's shared-block rule (info severity, never a warning). Our grammar-shaped AST is an *approximation* that holds for well-behaved scripts, with a defined fallback (Sec.5.3). Corpus note (12-file snapshot): zero conditional/structure *interleavings* and zero conditional-wrapped section headers in ~123k tokens; exactly one mismatched closer — ForeDaut line 642 has a live stray extra `endif` in a working map, corpus proof that the engine tolerates it harmlessly (grounds RMS0106's warning severity; Sec.12 fixture). The split-command idiom is guide-endorsed, so it is **first in line for structured handling in v1.x**.
4. **Two documented constructs span multiple tokens** and must be *assembled* during argument consumption, not lexing: math expressions (Sec.2.2) and quoted include paths (Sec.5.2). The lexer stays a pure splitter.

**Whitespace is pinned as the C `isspace` set: space, `\t`, `\n`, `\v`, `\f`, `\r` — nothing else.** Unicode space-lookalikes are NOT whitespace; a token containing any of this exact set gets warning `RMS0004`: U+00A0 (NBSP), U+1680, U+2000–U+200B, U+202F, U+205F, U+3000, U+FEFF (non-leading). A leading U+FEFF (BOM) becomes its own token (`kind: "word"`, `isTrivia: true` — it must be a token, or the Sec.12 coverage property fails) with info `RMS0005`. (Corpus: zero occurrences of either — the lint is for pasted-from-web beginner files.)

**Case sensitivity:** all name lookups are case-sensitive exact matches. See Sec.10 for the did-you-mean rules (`RMS0200`).

**Engine numeric truncation:** the engine reads a numeric argument's leading digits and ignores everything from the first non-numeric character (`1,5` → 1, `50%` → 50; guide-confirmed). Caveat: that guide text pre-dates the float updates — post-153015, `.` is consumed wherever floats parse (per-attribute, verify #13/#14); the truncation rule still holds for `,`, `%`, and other non-numeric characters. See RMS0212 in Sec.6.

### Token types

```ts
interface Token {
  text: string;
  start: number;      // char offset, inclusive
  end: number;        // char offset, exclusive — source.slice(start, end) === text
  kind: TokenKind;
  isTrivia: boolean;  // set by the comment pass — except the leading-BOM token, which the lexer itself emits with isTrivia: true
}

type TokenKind =
  | "word"            // default: commands, attributes, constants, labels, operators, paren-glued operands
  | "number"          // /^-?\d+(\.\d+)?$/ — floats are first-class since Update 141935 (⚠ verify #13: `.5`, scientific notation)
  | "rnd"             // /^rnd\(-?\d+,-?\d+\)$/ — DE inline random, a single token (float bounds: ⚠ verify #17)
  | "openBrace"       // exactly "{"
  | "closeBrace"      // exactly "}"
  | "commentOpen"     // exactly "/*"
  | "commentClose"    // exactly "*/"
  | "sectionHeader"   // /^<[A-Z0-9_]+>$/ — digits included so unknown headers like <FOO2> take the RMS0100 path, not word degradation
  | "directive";      // starts with "#" — note: NOT automatically a real directive (guide: "#this is NOT a comment")
```

The lexer is a whitespace splitter plus this classification — **nothing more**. It does not know what a command or expression is. It never fails. `inf`/`-inf` remain `word` tokens; argument consumption gives them numeric meaning (Sec.6). Predefined labels may start with digits (`1_PLAYER_GAME`) or be arbitrary `#define`d text — no lexer heuristic may treat digit-prefixed words as malformed numbers (that judgment happens in Sec.6 with a predefined-label exemption).

Suspicious-token lint: **any non-trivia token of any kind** whose text *contains* (but does not equal) `{`, `}`, `/*`, or `*/` gets warning `RMS0003`, with both message variants: trailing glue (`create_land{` → "did you mean `create_land {`?") and leading glue (`}8050` → "did you mean `} 8050`?" — a live corpus specimen whose glued brace silently shifts every subsequent block boundary).

### Sec.2.1 Token-ID aliasing quirks

Community-confirmed (the "RMS Equivalencies" spreadsheet, aok.heavengames thread fn=26&tn=42304): the engine resolves every word to an internal integer token ID, and **constants, raw numbers, and structural tokens share one ID space**:

1. **Terrain/object constants are just integers.** `create_object 32` ≡ `create_object SNOW` (→ Imperial-Age Monastery, ID collision). Bare numbers in constant positions are legitimate, working RMS.
2. **ID collisions across categories are silent** — our type diagnostics (Sec.6) are *style* warnings about probable mistakes, never correctness claims.
3. **Words and numbers can alias structural tokens** (`MILL` can close a block). Out of scope for structural emulation in v1: such maps misparse into diagnostics + RawNodes, never crashes or dropped text. `ParseOptions.aliasTable` is the upgrade hook — import the Equivalencies data later as `reference/data/token-aliases.json` (fetch failed in-session: JS-rendered; import manually, spot-verify against DE — ⚠ verify #7).

   **`aliasTable`'s declared type cannot express the case that now motivates it.** It is `ReadonlyMap<string, TokenKind>`, which covers a word aliasing a *structural* token — the `MILL` shape above. The live corpus case is a word aliasing a **command**: `24hr_Petra.rms:6` writes `#const L 32` and then uses `L { … }` 384 times, `24hr_Holler.rms` 197 more, and those 581 sites are **68% of RMS0200's entire corpus output** *(52 `.rms`)*. So the tier-2 fix is not a drop-in for this type and the option is not the upgrade hook it reads as (`known-issues.md` BUG-005 piece 2, which also records the decision to wait for the token-ID table rather than ship a severity-only tier 1). Also unverified: that `create_land`'s token ID is 32 at all — the only source is the map author's own comment.

### Sec.2.2 Math expressions (Update 141935, April 2025) — NEW in rev 3

DE added in-script math. Guide-verified rules (the preview generator must implement these exactly; the parser only *assembles and lints*):

- An expression is delimited by parentheses **glued to its boundary operands**: `(A + 1)` is tokens `(A`, `+`, `1)`. Operators `+ - * / %` must be whitespace-separated tokens; an operator glued to an operand (`(A+1)`) is **not math** — it's one unknown word token.
- Evaluation is **strictly left-to-right — no precedence, no nested parentheses**. A nested `(` operand is silently not-a-number: the guide's own example `(GOLD_COUNT + (5 + 2))` yields 8, dropping `(5`. **The preview generator must NOT implement standard precedence out of habit.**
- Constants inside expressions resolve to their numeric values. `rnd(a,b)` is **invalid inside** an expression (a `#const` holding an rnd is fine). `inf`/`-inf` are native values (idiomatic flooring: `(5.9 % -inf)` → 5).
- Floats flow through expressions (since Update 153015); rounding to integer happens only where a float reaches an integer-only attribute, 0.5 rounds up. Values above 2²⁴ lose precision. Divide by 0 → 0. **`x % 0` → left operand truncated toward zero** (Summer 2025 Update, guide line 4550 — the guide's main math text "modulo 0 gives 0" pre-dates this and is stale). `%` semantics generally are truncation-toward-zero, not floor — the guide's own idiom `(-5.9 % -inf + 10)` → 5 only works with truncation (⚠ verify #18: negative-float modulo).
- Expressions work "almost anywhere a numeric input is accepted", including `#const` values. Float *acceptance* (as opposed to expression acceptance) is per-attribute reference data, not grammar (⚠ verify #14) — Update 153015 explicitly float-enabled `land_position`, `land_percent`, the four `*_border`s, and `circle_radius`.

Parser handling — assembly in argument consumption (Sec.6), keeping the lexer pure:

- When the next candidate argument token's text **starts with `(`**, collect tokens until the terminator, producing one `ArgNode` with an expression value (operand/operator token-index list, unevaluated). **Terminator rule (pinned):** the first token whose text ends with `)` — *regardless of kind*, **except** canonical `rnd`-kind tokens, which never terminate (they are collected and draw the rnd-inside lint). A single token both starting `(` and ending `)` (e.g. `(5)`) is a one-token expression when it opens collection; when encountered *inside* collection it terminates (and draws the nested-paren lint). Multi-close tokens like `2))` terminate normally. The engine's own close-detection rule is unknown and is the real arbiter — ⚠ verify #15 covers these exact shapes.
- During collection the stop set is suspended, **except**: structural tokens (`{`, `}`, section headers, directive-kind tokens), control keywords, EOF, and a collection cap of 64 tokens. Hitting any of these means the expression is unclosed/degenerate: the collected tokens become a normal unknown-run (RawNode) with warning `RMS0208`, and the argument list terminates with `RMS0201`. (Conditionals *inside* an expression are engine-legal via token filtering but degrade to raw here — consistent with Sec.5.3's philosophy.)
- Guide-verified expression lints, all warning severity, code `RMS0210` with specific messages: nested `(` operand ("the engine silently drops this operand"); operator glued to an operand inside an assembled expression; `rnd(…)` inside an expression; operand not glued to a bounding paren (`( A + 1 )` — the `(` alone is not a valid opener); **a trivia (comment) token inside the expression's token-index range** ("comments break math expressions — move the comment outside the parentheses"; guide line 3362 — without this check the comment pass runs first and assembly would silently accept `(A + /* x */ 1)`, which the engine rejects).
  - **The unglued-operand lint fires once per expression, not once per bare paren.** `( 5 + 1 )` has an unglued opener *and* an unglued terminator; reporting both gave two diagnostics with the same code, message and (whole-expression) span. One problem, one diagnostic, per Sec.5.1's convention.
  - **The glued-operator character class deliberately excludes `-`** — pinned here rather than left in the code, because it looks like an omission. A negative literal is one token by construction (`-5`, `-inf`, `(A + -1)`), so treating an interior `-` as glue would flag every negative operand as malformed. The cost is that a genuinely glued minus (`(A-1)`) is not reported at all: it lexes as one unknown word and reaches the normal type diagnostics instead. That is the safe direction under goal #5, and discriminating the two needs the engine's own rule (⚠ verify #15).
- Type checking: an expression satisfies any numeric slot. **A float satisfies an integer slot with no diagnostic** (the engine rounds — flagging it would be a false warning; corpus: Pa_Site's seven float `#const`s are working RMS).
- `#const`'s value slot accepts numbers (including floats), `rnd` tokens, and expressions. (`language.json`'s `value:integer` needs the Sec.13 item 4 float-capable schema change.)

A word token starting with `rnd(` that fails the canonical regex (e.g. `rnd(1,` from `rnd(1, 5)` split by an interior space) gets a specific did-you-mean, warning `RMS0214` ("rnd() must contain no spaces") — without it, the split form yields only a baffling generic type mismatch.

Corpus reality check (recounted in the rev-4 critique): **45 live expressions across three files** — Pa_Site 35 (attribute arguments), Vanguard 7 (incl. the three identical `set_avoid_player_start_areas (PL_FOREST_MAX_DIST + 1)` lines), AD4 3 (**in `#const` value position** — a distinct assembly path that must be fixtured, Sec.12) — plus Pa_Site's 7 float `#const`s. v1 needs *correct* handling, not *deep* handling, but expressions are not rare in advanced maps.

### Comment handling

After lexing, a **comment-span pass** walks the token array matching `commentOpen`/`commentClose` **with a nesting depth counter** and sets `isTrivia: true` on enclosed tokens and markers. `ParseOptions.nestedComments` defaults **`true`** (guide-confirmed DE behavior; rev 2 had this wrong). Comment text is not re-lexed. Unclosed `/*` (depth never returns to 0) → all remaining tokens become trivia + `RMS0001` at the outermost opener. Stray `*/` → `RMS0002`, treated as trivia. The guide's broken-comments strings are lexer test fixtures verbatim (Sec.12).

Trivia ownership rule (for the patch engine): a comment belongs to the *next* non-trivia token (leading trivia); trailing comments at EOF attach to a virtual EOF position.

## 3. Parse result and API

```ts
// Pure function. No I/O, no globals, no exceptions.
function parseRms(source: string, lang: LanguageData, opts?: ParseOptions): ParseResult;

interface ParseOptions {
  nestedComments?: boolean;                        // default TRUE (guide-confirmed)
  aliasTable?: ReadonlyMap<string, TokenKind>;     // default empty (Sec.2.1)
  maxNestingDepth?: number;                        // default 200 (Sec.5.0)
}

interface ParseResult {
  source: string;
  tokens: Token[];           // ALL tokens including trivia, in order
  lineOffsets: number[];
  script: ScriptNode;
  symbols: SymbolInfo[];     // Sec.7
  includes: IncludeInfo[];   // Sec.7 — presence softens unknown-symbol diagnostics
  diagnostics: Diagnostic[]; // syntax-level only; validate() adds semantic ones
}

interface SymbolInfo {
  name: string;
  directiveKind: "define" | "const";
  nameToken: number;         // token index
  valueToken?: number;       // #const only (may reference an expression's first token)
  conditionalDepth: number;  // 0 = unconditionally defined; counts BOTH if-branches AND start_random
                             // branches (pinned — corpus-live: QS_Three_Bays `percent_chance 50 #define 7_RELICS`)
  undefineAttempted?: boolean; // a later #undefine names it — which does NOTHING in-engine (Sec.7)
}

interface IncludeInfo {
  directiveToken: number;    // the #include_drs / #includeXS token
  path: string;              // assembled, quotes stripped if quoted
  quoted: boolean;
}

interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;              // Sec.10
  message: string;           // beginner-first phrasing
  span: Span;
}

interface Span { start: number; end: number }
```

AST nodes reference tokens by index (`firstToken`/`lastToken`) and carry a derived `span`. Invariant: a node's span is exactly the range from its first to last token, including interior trivia, excluding exterior trivia.

**Rev 6 — read this before Sec.4's sketches.** Sec.4 below is a *shape* sketch and disagrees with the shipped types in five ways, all deliberate and all recorded in `src/parser/types.ts`. Under "do not deviate from this spec" the sketches would otherwise read as instructions to undo shipped work.

1. **Every token reference is an index, never a `Token` object.** Sec.4 writes `name: Token`, `header: Token`, `open: Token`, `close?: Token`, `keyword`, `condition`, `endif`, `start`, `end`, `hash` — all of them are `number` in the code. Indices are what Sec.12's ownership property and the Phase-3.3 patch engine need, the sentence directly above already said "reference tokens by index", and rev 5's own `ArgNode` uses them. The `Token` is one array lookup away.
2. **Every node extends a `NodeBase`** carrying `firstToken`/`lastToken`/`span`, rather than `ArgNode` and `RawNode` declaring them individually.
3. **`BlockNode` and `SectionNode` carry `kind` discriminants** like every other node, so the union stays uniformly discriminable.
4. **`Diagnostic` has gained `suggestion?: string`** (`types.ts:37-43`), populated by RMS0200's did-you-mean and consumed by the Breakdown raw-card quick-fix (`breakdown-design.md` Sec.3.7).
5. **Fifteen of the types below take two defaulted type parameters** (`<N = number, D extends NoDefs = DefSlots>`), landed 2026-08-11 — see the amendment at the end of this section. The sketches show the *default* instantiation, which is what every existing call site means when it writes a bare `ParseResult`. Nothing in `src/` outside the parser names either parameter.

## 4. AST shape

```ts
interface ScriptNode { preamble: Item[]; sections: SectionNode[] }   // preamble = items before first <SECTION>
interface SectionNode { header: Token; name: string; known: boolean; items: Item[] }
// known = name ∈ language.json sections[]. Duplicate same-type sections are LEGAL — the guide
// (line 148) states multiple same-type sections function identically to one; the engine merges
// them. (Corpus: OWWC has 2 <ELEVATION_GENERATION> headers.) No diagnostic.

type Item = CommandNode | AttributeNode | DirectiveNode | IfNode | RandomNode | OrphanBlockNode | RawNode;

interface CommandNode {
  kind: "command";
  name: Token;
  def?: CommandDef;          // resolved from language.json; undefined = unknown command
  args: ArgNode[];
  block?: BlockNode;         // for def.kind === "block", and for unknown commands followed by `{` (Sec.5.4)
}

interface BlockNode { open: Token; close?: Token /* undefined = unclosed */; items: Item[] }

interface AttributeNode { kind: "attribute"; name: Token; def?: AttributeDef; args: ArgNode[] }

interface ArgNode {
  firstToken: number;        // like every other node — REQUIRED for multi-token args
  lastToken: number;         // (quoted paths, expressions); single-token args have first === last
  value: number              // includes floats; Infinity/-Infinity for inf/-inf words in numeric slots
       | { rnd: [number, number] }
       | { expr: { tokens: number[] } }   // Sec.2.2 — token indices, unevaluated
       | string;             // constant/label reference (quoted paths: assembled, quotes stripped)
  def?: ArgumentDef;
}
// Rev 5: ArgNode previously had a single `token` field — a quote-assembled include path's interior
// tokens were then reachable from no AST field, breaking both the Sec.12 coverage property and the
// Phase-3.3 patch engine (which needs the span to replace when Breakdown edits any argument).

interface DirectiveNode {
  kind: "directive";
  hash: Token;               // the "#..." token; its text is the directive name
  def?: DirectiveDef;        // from language.json directives[]; undefined = unknown (RMS0206)
  args: ArgNode[];           // per def.arguments (Sec.5.2); may be short at EOF (RMS0201)
}

interface IfNode {
  kind: "if";
  branches: { keyword: Token /* if|elseif|else */; condition?: Token; items: Item[] }[];
  endif?: Token;             // undefined = unclosed (RMS0105)
}

interface RandomNode {
  kind: "random";
  start: Token;
  preamble: Item[];          // tokens between start_random and first percent_chance (RMS0106)
  branches: { chanceKeyword: Token; chance?: ArgNode; items: Item[] }[];
  end?: Token;               // undefined = unclosed (RMS0105)
}

interface OrphanBlockNode { kind: "orphanBlock"; block: BlockNode }  // Sec.5.4

interface RawNode { kind: "raw"; reason: string; /* + firstToken/lastToken/span like all nodes */ }
// RawNode has NO children — an opaque, exactly-spanned token range.
```

**Name lookup order (pinned):** inside a `BlockNode` → attribute lookup first, then command; at statement level → command first, then attribute. A cross-category hit parses normally as its actual category and gets warning `RMS0207` with a beginner-first message ("`number_of_tiles` is an attribute — it belongs inside a `{ }` block"). Dual-use names (`base_terrain`, `base_layer`) resolve to the context-native category silently — no RMS0207.

Directive surface (matching the guide's Non-Functional Syntax appendix and 100% of corpus usage): the *functional* directives are exactly `#define`, `#const`, `#include_drs`, `#includeXS`. `#undefine` and `#include` exist as engine strings but **do nothing** — they parse as known DirectiveNodes whose defs are flagged non-functional (Sec.13 item 2), with an info diagnostic ("#undefine has no effect in DE — the flag stays defined"). The `#ifdef` family does not exist in DE (not in the guide, not in the exe string dump) — **remove those entries from language.json** (Sec.13 item 2); after removal they naturally hit RMS0206 like any unknown directive.

**Amendment — the AST tree takes two defaulted type parameters. ACCEPTED AND LANDED 2026-08-11**, on request from `tools-api-design.md` rev 7; it was that document's to ask and this one's to decide. The tools contract publishes a `.d.ts` that must describe the *external wire* form of a `ParseResult`, which differs from the in-process one in two ways: `±Infinity` is sentinel-encoded (JSON cannot carry it) and `def` is stripped (JSON has no back-references, so a shared `CommandDef` is re-emitted at every node pointing at it — 41% of a 13 MB payload). Both differences have to be visible to the compiler, or a portable tool silently reads `undefined`. The edit is two defaulted type parameters threaded through the fifteen types that carry them — `ArgValue`, `ArgNode`, `CommandNode`, `BlockNode`, `AttributeNode`, `DirectiveNode`, `IfBranch`, `IfNode`, `RandomBranch`, `RandomNode`, `OrphanBlockNode`, `Item`, `SectionNode`, `ScriptNode`, `ParseResult`:

```ts
export type ArgValue<N = number> = N | { rnd: [N, N] } | { expr: { tokens: number[] } } | string;
// `expr.tokens` are token INDICES and stay number[]; rnd bounds are a numeric position
// and do take the parameter (parseRndValue is Number() over an unbounded digit run).
export interface DefSlots { arg: ArgumentDef; command: CommandDef; attribute: AttributeDef; directive: DirectiveDef }
export interface NoDefs   { arg: unknown; command: unknown; attribute: unknown; directive: unknown }
// each def site becomes `def?: D["command"]` etc., with `D extends NoDefs = DefSlots`.
```

**No call site is edited — that is what the defaults are for** — and the wire form is then `ParseResult<number | { inf: 1 | -1 }, NoDefs>`. Indexed access is load-bearing: a conditional property type on a mode parameter makes TypeScript's variance measurement give up and the two instantiations stop being assignable on the type argument alone, and `def?: never` breaks assignability outright. Both were checked against `tsc --strict` on 2026-08-11; tools-api-design Sec.4 carries the write-up.

**What landing it measured, rather than argued (2026-08-11).** The "no call site is edited" claim is the one that decided acceptance and it was verified rather than trusted: `npm run typecheck` passes over the whole repo with zero edits outside `src/parser/types.ts`. So does `npm run lint`, and the suite is unchanged at 44 files / 1391 tests, which is what a type-only edit should produce.

`src/parser/__tests__/wireTypes.test-d.ts` is the standing gate. It is **not a Vitest suite** — the `.test-d.ts` extension does not match Vitest's default include, so it never enters the test floor; `npm run typecheck` checks it, and CI runs that. Half its assertions are `@ts-expect-error`, and TypeScript reports an *unused* `@ts-expect-error` as an error of its own, so **every negative claim in it fails in both directions** and cannot decay into a vacuous pass — the usual objection to a check that has only ever been green, and one this project has been bitten by. It pins: a real `ParseResult` flows into the wire form (including one level down, where the `BlockNode → Item → CommandNode → BlockNode` cycle makes variance measurement fall back to a structural walk); the wire form does not flow back; `node.def?.name` is an error on the wire and fine in-process; both numeric positions force a decode while `expr.tokens` stays a plain `number`; and the two rejected mechanisms, kept executable so the reason for the chosen one cannot decay into folklore.

Four mutants, all confirmed red then reverted. Two are worth recording because of *where* they went red rather than that they did: narrowing `NoDefs`' slots to `never` fails at the **constraint** (`DefSlots` no longer satisfies `D extends NoDefs`) rather than at the assignability claim it was aimed at — the design fails fast, but that mutant does not exercise what it looks like it exercises. And flipping `ParseResult`'s `D` default from `DefSlots` to `NoDefs` goes red across **real app code** (`truncateAst.ts`, `instantiate.ts`), not only in the type test: the default direction is load-bearing enough that the application enforces it on its own.

## 5. Parsing strategy

### 5.0 Recursion safety (goal #1 enforcement)

Single pass over the non-trivia token stream with a context stack. **Implementation must not be able to blow the JS call stack**: either iterate with an explicit stack (preferred), or enforce `opts.maxNestingDepth` (default 200) — on exceeding it, the innermost construct degrades via Sec.5.3 with warning `RMS0107`. The fuzz suite includes a 20k-token `if if if …` case that must complete without throwing. (Corpus note: 8-way `elseif` chains *inside* `create_land` blocks are normal real style — nesting is not exotic, only unbounded nesting is.)

### 5.1 Dispatch

Per non-trivia token, in order of precedence:

1. `sectionHeader` →
   - If a `{` block is open: force-close it with error `RMS0103` (⚠ verify #9), then start the new section.
   - If an `if`/`random` is open: **legal RMS** (token-filter model) — route to Sec.5.3 degradation (info `RMS0110`), never an error. Section headers *inside* the degraded span do not create SectionNodes; the RawNode lives in the section where it began. (⚠ verify #8; corpus: zero occurrences.) Referenced elsewhere as "Sec.5.1 dispatch item 1".
   - Otherwise: new SectionNode; `known` from `sections[]`; unknown names kept with warning `RMS0100`.
2. `directive` → resolve against `directives[]` (exact match, full token text). Known: consume args per Sec.6 (directive defs carry `verified` flags; Sec.6 severity capping applies), with **quote assembly** for filename-typed args: a token starting with `"` joins subsequent tokens until the first token ending with `"` (one IncludeInfo, `quoted: true`), **capped at 64 tokens** like expression assembly; unclosed quote or cap hit → collected tokens degrade to unknown-run + warning `RMS0209`. Quoted path on `#includeXS` → warning `RMS0211` (guide-documented engine bug: it rejects quotes). Truncation at EOF → `RMS0201`, node kept. Unknown directive → warning `RMS0206`, zero args consumed.
3. `if` / `start_random` (matched against `controlKeywords[]`) → push structured node; `elseif`/`else`/`percent_chance` switch branches; `endif`/`end_random` pop. Tokens before the first `percent_chance` → `RandomNode.preamble` + warning `RMS0106`. Mismatched keywords → warning `RMS0106`, absorbed into the pending unknown-run (see the coverage rule below; corpus-real fixture: ForeDaut's stray fourth `endif`, line 642). **Nested `start_random` inside `start_random`**: parse structurally (lossless) + warning `RMS0213`, message borrowing the guide's own fix (line 3009): "use a first random block to #define which additional random block to run".
   **Control-keyword operand consumption (pinned):** `if`/`elseif` consume exactly one token as the condition, of any non-structural kind (labels are arbitrary text, incl. digit-leading — no RMS0212); if the next token is structural (brace/section header/directive/control keyword), the condition is left undefined + warning `RMS0106` variant ("if without a condition"). `percent_chance` consumes one numeric operand; **expression and rnd assembly are active in that slot** (engine accepts math "almost anywhere a numeric input is accepted"; ⚠ verify #4 covers both). Data-drivenness (goal #4): add `arguments[]` to the controlKeywords schema (Sec.13) so these arities live in language.json like everything else — until then this paragraph is the pinned exception.
4. `word` → command or attribute per Sec.4's pinned lookup order: resolve, consume arguments (Sec.6), then attach a BlockNode if next token is `openBrace` and def is block-kind or unknown (Sec.5.4). Cross-category hit → `RMS0207`.
5. `openBrace` with no attachable predecessor → Sec.5.4.
6. `closeBrace` at top level → warning `RMS0104`, absorbed into the pending unknown-run.
7. `number` / `rnd` where a statement was expected → pending unknown-run, diagnostic `RMS0215` ("unexpected value — a statement was expected here"; RMS0200's "unknown command" wording doesn't fit `10000`).

**Unknown-token runs:** consecutive tokens that can't start a statement collapse into a *single* RawNode with *one* diagnostic. (Corpus validation: OWWC's mangled `number of clumps 10000` and two files' un-commented trailing prose produce exactly one useful diagnostic each — these warnings catch *real silent map bugs*.)

**Coverage rule — no token is ever dropped:** "skipped" is not an AST outcome. Every rejected token (stray `}`, mismatched control keyword, etc.) joins the pending unknown-run RawNode (opening one if none is pending); its diagnostic attaches to the token's own span. This is what makes Sec.12's coverage property ("every non-trivia token reachable from exactly one AST node") satisfiable by construction.

**Cascade suppression:** when a block contains a token already flagged `RMS0003` involving a glued `{`/`}` (or is unclosed at its section/EOF boundary), wrong-context diagnostics (`RMS0207`) for items inside it collapse into a single summary diagnostic ("N more commands appear inside this block — likely caused by the missing space in `}8050` above"). Rationale: BCC2's one glued brace would otherwise draw dozens of RMS0207s; one typo must not produce fifty warnings in a beginner-facing editor. The items still parse normally — only the *diagnostics* are collapsed.

### 5.2 Unclosed constructs at EOF

Unclosed `{` at EOF → error `RMS0101` — **⚠ verify #6 is now the single highest-priority in-game check**: corpus file `BCC2-Rekawa_Capt_Knip_edit.rms` reaches EOF at brace depth 1 (via the `}8050` glued token) and reportedly generates; if DE confirms, RMS0101 downgrades to warning. Unclosed `if`/`start_random` at EOF → warning `RMS0105` (⚠ verify #12).

### 5.3 Degradation: when conditionals cut across structure

Trigger cases: a closer arrives while a structurally deeper construct is still open (`endif` with an open `{` inside the branch); the mirror (`}` while an `if` opened inside the block is open); interleaved non-nested overlap; conditionals spanning section headers (Sec.5.1 dispatch item 1); nesting-depth cap (Sec.5.0).

Mechanism, uniform: compute the **minimal token range covering every construct involved in the imbalance** — and this range extends **forward as well as backward**: after detecting the imbalance, continue consuming until every involved construct's closer has arrived (`}` and/or `endif`/`end_random`), bounded by section header / EOF (at which point RMS0101/0103/0105 apply as usual). Then discard partial nodes for the whole range and emit one `RawNode` with **one** info `RMS0110` ("this code mixes if/random with command structure in a way that must be shown as raw code — it is valid RMS"). Resume normally after the range. Without the forward extension, the construct's trailing closer would arrive orphaned and fire a spurious RMS0104/0106 warning — breaking the one-diagnostic promise on legal RMS (both trailing-closer shapes are Sec.12 fixtures). Wrap-and-discard over a bounded range: each token still reprocessed at most once — amortized linear, no grammar backtracking.

**Symbols and includes survive degradation.** `SymbolInfo` and `IncludeInfo` collection is a token-stream concern (mirroring the engine, which processes directives regardless of surrounding structure), NOT an AST concern: a `#const` or `#include_drs` inside a range later wrapped into a RawNode keeps its entry in `ParseResult.symbols`/`includes` (its `conditionalDepth` reflecting where it sat). Without this rule, every later reference to such a symbol would draw a false unknown-symbol warning from `validate()` — a goal-#5 leak through the back door.

**The rule binds both halves of the range, and the forward half needs code to satisfy it (rev 6).** The backward half gets it for free: those tokens went through `parseDirective` before the imbalance was detected, so their entries are already recorded when `degrade()` discards the nodes. The forward extension rev 5 added never parses at all — it is a raw token scan — so until rev 6 a directive down there was absorbed into the RawNode and recorded nowhere, producing exactly the false warning the paragraph above was written to prevent:

```
<LAND_GENERATION>
if REGICIDE
create_land {
land_percent 20
endif
#const FOO 5
}
create_land { clumping_factor FOO }
```

→ `symbols: []` and an RMS0202 on `FOO`, against a control (same `#const`, no degradation) that gives `symbols: ["FOO"]` and silence. So the forward scan records `#define`/`#const`/`#include_drs`/`#includeXS` as it consumes, in both `degrade()` and `degradeTooDeep()`. Three constraints on that scan, all pinned:

- **It mirrors `parseDirective`'s bookkeeping and nothing else** — no AST node, and **no diagnostics**. The region is already covered by one RMS0110 and a second diagnostic inside it would break the one-diagnostic promise. A quoted `#includeXS` in there draws no RMS0211.
- **It uses the same Sec.6 stop set**, so a control keyword or brace can never be swallowed as an operand and the scan's own brace/conditional counting stays in step with `parseDirective`'s. `#define endif` records nothing and lets the `endif` close the range, inside a degraded region and outside one alike.
- **Sec.5.2 quote assembly runs**, or `#include_drs "my maps/x.inc"` records its path as `"my`.

`conditionalDepth` is the depth of the surviving frames plus however many of the involved conditionals are still open at that point in the scan — so a directive *after* the `endif` that triggered the degradation records 0, which is the engine's reading and not a shortcut.

Corpus volume for this is zero *(52 `.rms`)*: both degradations contain no directive. The rule is pinned, the failure was silent, and the fix is small — that combination is why it was worth closing on a constructed case rather than waiting for a corpus specimen.

**One goal-#4 exception, recorded rather than fixed.** The forward scan tests `tok.text === "if" | "start_random" | "endif" | "end_random"` against hardcoded strings instead of consulting `controlKeywords[]`. Defensible — the scan needs each keyword's *structural* role (opener vs. closer), which the data does not carry — but it is a hardcoded vocabulary and a reader is entitled to know it was a decision. Adding `arguments[]` to `controlKeywords` (Sec.13 item 4) does not fix it; an opener/closer flag would.

v1.x follow-up, in priority order (do not implement in 2.3): (1) the guide-endorsed "conditional selects the command, shared block follows" idiom (`if REGICIDE create_object KING else create_object SCOUT endif { … }`) — structured handling; (2) whole-section conditional wrapping — only if corpus triage ever shows it in the wild (currently zero occurrences).

### 5.4 Orphan, unknown-command, and shared blocks

- Unknown word(s) followed by `{`: upgrade the *first* word of the pending unknown-run to a `CommandNode` (def undefined, `RMS0200`), remaining run tokens become def-less `args`, block attaches. (`craete_land { … }` renders block-shaped with a typo'd name, not raw soup.)
- **Shared-block rule (rev 5 — the flagship idiom's real path):** `{` arriving immediately after a *just-completed* `IfNode`/`RandomNode` in which at least one branch's last item is a block-capable `CommandNode` without a block (def block-kind or unknown) → `OrphanBlockNode` + **info `RMS0110`** with the variant message "this block is shared by the command(s) chosen in the if/random above — shown as a separate block". This is guide Example2 (`if REGICIDE create_object KING else create_object SCOUT endif { … }`, line 3244): tracing plain dispatch, the `endif` pops cleanly (no imbalance, Sec.5.3 never triggers) and the `{` would otherwise land on the next rule's warning — a false warning on the exact construct this spec cites as guide-endorsed idiom. The contents still parse as block items; only severity and message differ from the plain orphan case. Example2 verbatim is a required Sec.12 fixture.
- `{` with no pending run, no block-capable predecessor, and no shared-block lookbehind match: `OrphanBlockNode` + warning `RMS0102`; contents ARE parsed as block-context items.

## 6. Argument consumption — the data-quality firewall

**Stop set** (never consumed as an argument; encountering one mid-list stops consumption with `RMS0201` too-few-arguments): `openBrace`, `closeBrace`, `sectionHeader`, any `directive`-kind token, the seven `controlKeywords[]` names, EOF, and **any `word` resolving to a known command OR attribute name — in either context** (symmetric on purpose: an overstated-arity attribute must not silently eat a following wrong-context command any more than the reverse). This rule is what makes overstated arity in unverified data self-limiting. (Known limitation: a `#define`'d constant sharing a command/attribute name stops consumption early — spurious `RMS0201`, no cascade; constants are conventionally ALL_CAPS so real collisions are negligible.) The stop set is suspended inside expression/quote assembly per Sec.2.2/Sec.5.2, except structural tokens, control keywords, and the caps.

Rules:

1. **Known + verified def:** consume up to `def.arguments.length` non-stop-set tokens (honoring `optional`/`variadic` flags once the schema supports them, Sec.13 item 4). Type checks: `integer`/`percent`/`flag` accept `number` (including floats — **no diagnostic for float-into-integer**, the engine rounds), `rnd`, expressions, `inf`/`-inf` words, **and any word naming a symbol already defined above the use (amendment, below)**; `terrainConstant`/`objectConstant`/`otherConstant`/`string` accept `word` **or `number`** (bare numeric IDs are legitimate per Sec.2.1). Mismatches → warning `RMS0202`/`RMS0203` on that ArgNode; token still consumed.
2. **Known + unverified def:** same mechanics; arity/type/range diagnostics capped at *info*, worded "…according to unverified reference data". (This category shrinks substantially once the Sec.13 item 1 language.json cleanup lands — the full guide is now archived locally.)
3. **Unknown name:** consume zero arguments; `RMS0200`; following tokens → unknown-run / Sec.5.4.

**Digit-prefixed word lint (`RMS0212`, warning):** a `word` token starting with digits, **only in an argument slot whose declared type is numeric (`integer`/`percent`/`flag`)** — exactly and only where the engine's leading-digits truncation applies (e.g. `50%`, `1,5` → "the engine reads this as 50 and ignores the rest"). **Never in name slots, constant slots, or condition positions**: digit-leading user labels are legal, working, and common — 8 of 11 corpus maps `#define` names like `2V1` (`if TEAM1_SIZE2 #define 2V1 endif`, ForeDaut; also Hourglass, Six_Points, BCC2, Menindee, OWWC `2_CROSSINGS`, QS_Three_Bays `7_RELICS`, TC2 `3_VILL_START` — rev 5 corrected the count from an earlier "5 of 11"). Rev 3 scoped this lint by exemption lists (predefined labels, if-conditions); that was the wrong shape — it missed `#define`'s name slot and would have false-warned on the spec's own corpus. Scoping by declared argument type needs no exemption list at all.

**Amendment — user constants satisfy numeric slots.** The rule above originally admitted only numbers/rnd/expressions/`inf` into `integer`/`percent`/`flag` slots. That warned on the single most common RMS idiom there is:

```
#const PL_LANDS_CLUMPING_FAC 15
create_land { clumping_factor PL_LANDS_CLUMPING_FAC land_position 74 26 }
```

— a goal-#5 violation (false warnings on legal maps). Resolution is **symbol-table-aware, not type-aware**: at the point of consumption, if the word names a `#const`/`#define` **already seen in this parse**, no diagnostic is emitted at all.

- **"Already seen" is the engine's rule, not a single-pass limitation.** The guide (line 148) states a definition "will only be true if [it is] defined higher up in the file … regardless of the section header", so a constant used *above* its `#const` genuinely does not resolve in-engine, and warning there is correct. A symbol-collecting pre-pass would make us *less* accurate.
- **Permissive about kind:** `#define` (a bare flag) counts as well as `#const`. Flagging a flag-in-a-numeric-slot risks a false warning, and Sec.2.1 pins that our type diagnostics are style warnings, never correctness claims. If it is worth reporting, it belongs in `validate()` (Sec.8), which sees the whole symbol table at once.
- **Unresolvable names** keep `RMS0202`, but with a message naming the real problem (the name is undefined, suggest `#const`) rather than "wrong type" — and **softened to info when the file has any `#include_drs`** (Sec.7's rule: the name may be defined in an include we cannot read; Pa_Site's 40 such warnings all become info).
- Implementation: `Parser.isDefinedSymbol()`, consulted in `consumeOneArg`. Once `predefinedLabels` lands (Sec.13 item 3), engine-provided names must count as defined here too. **The data landed 2026-07-31 and the wiring is still a TODO** (`parser.ts`), so `clumping_factor MAPSIZE_TINY` draws RMS0202 today. Note before building it: **the corpus contains no instance that would change** — RMS0202's 61+45 are fully accounted for by BUG-002's triage — so this cannot be validated by re-measuring, and needs a constructed test in both directions under the project's "a check that has only ever passed proves nothing" rule.

**Related data fix — `#const`'s value slot is `otherConstant`, not `integer`.** Guide L3295/L3353/L3306: everything in the game *is* a number internally, constants are read as numbers "where numeric inputs are expected", and one item may carry several constants — so `#const PREDATOR_A WOLF` is exactly `#const PREDATOR_A 3`. Typing the slot `integer` rejected that idiom (155 false warnings in `Rage Forest 2026.rms` alone). `otherConstant` accepts word or number, and expression/`rnd`/number handling is ungated by argument type (`consumeOneArg` dispatches expressions on a leading `(` before any type check), so `#const X (A * B)` and `#const X rnd(1,5)` are unaffected — asserted by fixtures.

**RMS0202's remaining output is a regression baseline, not noise (rewritten in rev 6 — the previous wording was inverted).** Measured **61 warnings + 45 info** *(52 `.rms`)*, in only 3 files. Rev 5 called this "noise" and explained it two ways, and `known-issues.md` BUG-002 closed **both in the opposite direction on 2026-08-02**:

- The 26 `actor_area ACT_AREA_TEAM_RES_TERRAIN` uses were read as opaque identifiers legal via Sec.2.1, "evidence that `integer` wrongly conflates a magnitude with an identifier". They are **one author's accidentally deleted `#const`** — their own recollection, corroborated by a three-constant block missing its fourth member. The `identifier` argument type designed on that reading was reverted from `language.ts`, `language.schema.json`, `formatStyle.ts` and `validate.ts` the same day. **Do not rebuild it.** What would count as real evidence, if it ever reopens: a bare-word actor-area identifier in a map with no includes, from an author who did not lose a `#const`.
- The 35 `$`-prefixed names were read as "supported syntax we don't yet model" on the strength of appearing in a DE-official *and* a community map. They are **unexpanded variables from a preprocessor both authors build with**, so those files ship broken at those lines and the warnings are **true positives**. The two maps were never two independent observations: one is modified by the guide's own author and both share a `#define` template vocabulary.

**So 61 is a floor, not a target.** All 61 must survive; a change that drives corpus RMS0202 below it has started suppressing real findings. The counts above were exact in rev 5 and re-derived exact in rev 6 — only the interpretation was wrong, and the wrong interpretation named a schema change to make, which is the most dangerous shape a stale paragraph can take in a document headed "do not deviate".

**The generalisable error, worth more than the verdict:** each half was filed on evidence that was one observation wearing a plural (35 occurrences = 3 copy-pasted sites; 26 occurrences = one name in one file), and each then attracted a mechanism plausible enough to survive review, because a mechanism that explains the data feels like evidence for it. Neither was ever checked for independence.

**The fuller rule, not yet implemented.** L3353 licenses *any* known constant — user-defined **or predefined** — to satisfy *any* numeric slot. The amendment above covers user-defined symbols only, because the parser cannot currently see `game-constants.json` (`parseRms(source, lang)` takes language data alone). Closing that gap means either passing constants into the parser or landing `predefinedLabels` (Sec.13 item 3); until then, a *predefined* constant in a numeric slot outside `#const` would still warn. The corpus shows no such case today.

**ID-resolution message gating (RMS0204/RMS0205):** resolved-ID wording ("32 = SNOW…", "SNOW in an object slot = Monastery. Intended?") only when the game-constants entry carries verified provenance (`idSource: "extracted"` or patch-note-sourced); generic wording otherwise. Current constants are all placeholders.

## 7. Symbol table and includes

Collected during the parse: every `#define`/`#const` with token index and *conditional depth* (0 = unconditional). `#undefine` sets `undefineAttempted` on the matching symbol **but the symbol remains defined** — `#undefine` is non-functional in DE (guide's exe-dump appendix); `validate()` must not treat undefined-later symbols as removed, and the DirectiveNode gets an info diagnostic saying so.

`ParseResult.includes` records every `#include_drs`/`#includeXS` (path, quoted flag). **When any include is present, `validate()`'s unknown-symbol diagnostics degrade to info** ("may be defined in an include file — Age of RMS cannot see inside includes yet"): corpus file Pa_Site pulls 43 includes and references dozens of their constants; without this rule it drowns in false warnings. Also record in corpus triage that include-dependent maps cannot generate standalone. Future hook: `ValidateOptions.resolvedIncludes` for supplying include sources — out of scope v1. Note: `random_map.def` is implicitly included in every map and defines all predefined constants — it is the authoritative source for `predefinedLabels` and for hover docs on names like `GOLD`/`RELIC`.

Predefined engine labels come from a `predefinedLabels` array in `language.json` — **action item (Sec.13 item 3), now fully sourceable** from the guide's Conditionals section: game modes, legacy sizes (TINY_MAP…LUDIKRIS_MAP), modern sizes (MAPSIZE_MINI…MAPSIZE_LUDICROUS), resource levels, starting ages, lobby settings (FIXED_POSITIONS, …, ANTIQUITY_MODE), player/team counts (1_PLAYER_GAME…, TEAMx_SIZEy, PLAYERx_TEAMy), and version detection (DE_AVAILABLE, …). Schema note: labels may start with digits. The guide's Map Sizes table (dimensions + area ratios, MINI 80×80/0.6 … LUDICROUS 480×480/23.0) feeds both this and the generation-settings pane.

## 8. validate() — separate semantic pass

`validate(result: ParseResult, refDb): Diagnostic[]`, run after parse. **Two parameters, not three:** `opts`'s only documented member, `ValidateOptions.resolvedIncludes` (Sec.7), is explicitly out of scope for v1, and a parameter that silently does nothing is worse than one that isn't there yet. Add it back with its first real member.

**Rev 6 — the bullets below were written before the pass was built, and the scoping rules that took the naive implementation from 11,623 corpus diagnostics to 313 live two sections away in Sec.10.** Sec.8 is where an implementer starts reading, so the two bullets that shipped differently now say so in place rather than only in Sec.10. Everything Sec.10's RMS03xx block records still governs; it is not repeated here.

Checks:

- ~~Unknown constants vs symbol table + game-constants DB + `predefinedLabels`~~ — **as written this is the check the positive-resolver rule forbids**, and implemented that way it was most of the 11,623. What shipped (**RMS0300**) fires only on a **near-miss of a name that does resolve**, at edit distance 1, and never on absence; it is scoped to `if`/`elseif` condition labels, where user `#define`s plus `predefinedLabels` really are a closed vocabulary, and never to terrain/object slots. It stays silent when the `#define` exists but is commented out, which is a real feature-toggle idiom. Softened to info when includes are present (Sec.7); conditionally-defined symbols were measured as pure noise and get nothing. Message wording borrows the guide: the engine "ignores it or substitutes the most recent valid identifier and keeps going" — which is why such maps still generate. Full reasoning and the open residue: Sec.10 rules 1–2.
- Duplicate `#const` definition: **first definition wins in-engine** (guide-confirmed — this answers old verify #5). ~~Warning when both definitions are unconditional; info when either is inside a conditional~~ **Amended 2026-07-31, second corpus review: warning when both definitions sit on the same *execution path*, silent otherwise.** The exclusive-branch exemption is right and is preserved — only one branch's tokens survive, so a value per branch is correct RMS — but "unconditional" was the wrong test for it. `SymbolInfo.conditionalDepth` is a *count*: depth 1 describes both `if A / else` (two paths, legitimate) and two definitions inside one `if A` (one path, the second provably dead), and the old rule discarded both. The path test is a guard stack — an `if`/`elseif` condition contributes a positive literal to its own branch and a negation to every later branch of that chain, each `start_random` branch contributes an opaque literal — and two definitions are on one path when their stacks are equal. Strictly broader than the old rule (verified: it reports every hit the old rule did) and strictly narrower where Sec.8 wanted narrowness. Corpus 3 hits to 38, the 35 new ones triaged as real; the largest cluster is a shared template writing `#const PREDATOR_A` twice per branch where its neighbours write `_A` and `_B`. **Guard *subsumption* (`RMS0314`) extends the same claim across paths — see below.**
- **Shadowed by a containing path (`RMS0314`, CREATION_PLAN 2.6, built 2026-07-31).** If an earlier definition's guards are a **subset** of a later one's, the earlier already ran whenever the later can, so the later value never applies. The empty guard set is a subset of everything, which makes the beginner case fall out for free: a default written *above* the conditional versions rather than below them, the habit that transfers from every brace language and is backwards here. **Soundness precondition, and the reason this was nearly not built:** guards are evaluated where they are *written*. A positive literal true at the later site need not have been true at the earlier one, so any `#define` of a guard name landing between the two sites silences the claim. Negated literals need no check — definitions only accumulate (`#undefine` is non-functional, Sec.7), so a name undefined later was undefined earlier too — and neither do the opaque `start_random` literals, which have no name to redefine. The precondition gates `RMS0301` as well: two separate `if A` blocks produce identical guard stacks, so a `#define A` between them makes the first block's definition never happen and the second genuinely live.
- **Zero corpus hits, and that is the expected result.** All 15 proper-subset candidates over the 57 maps are inside `nomad.rms`'s unreachable branch and belong to `RMS0313`, which reports them once instead of fifteen times; none were removed by the monotonicity precondition and none survived. The corpus is expert-written and DE-official maps, where nobody writes a default first. The check exists for the audience the app is actually for, and it should be expected to stay at zero here — **a corpus count of zero is not the same as a check that cannot fire**, which is why its unit tests carry the worked examples in both directions.
- **Unreachable `elseif` branch (`RMS0313`, added by the same review).** A condition already tested earlier in the same chain can never be reached, because every branch of one chain is tested against the same set of defines at the same point in the token stream. No guard algebra and no soundness precondition — unlike the deferred subsumption work, nothing can be `#define`d "in between" two branches of one chain. Scoped to a single chain deliberately: a nested `if X` inside a branch that already excluded `X` is also dead, but only if no `#define X` ran in between, which is 2.6's problem. One corpus hit, and it is a real defect in a DE-official map — `nomad.rms` tests `INDOMALAYAN_TROPICAL` at branch 6 and again at branch 11 of one ladder, 130 lines apart, leaving 23 lines of biome configuration that never run.
- Cross-category constant use (`RMS0205`) and bare-ID style notes (`RMS0204`), gated per Sec.6.
- ~~Wrong-section placement (command's `def.section` vs enclosing section — warning).~~ **Do not build it from `def.section`** — Sec.10's RMS0304 entry forbids it and says why: that field records where the guide *documents* a command, and enforcing it naively warned 53 times on the corpus, 52 of them on working maps. The engine does enforce sections (measured 2026-08-04), so the check is worth building, but only off a **measured per-command `sectionLocked` flag**. **BUILT 2026-08-10 exactly that way** — `sectionLocked` is set on `create_terrain` and `create_object` and nothing else, the corpus reports **0**, and the naive count is re-measured alongside it by `rms0304.measure.test.ts` (still 53: 52 `effect_amount`, 1 `create_player_lands`) so the rejected design stays visible rather than becoming folklore. Sec.8's wrong-section suppression rule is revived with it. Missing `<PLAYER_SETUP>` — info. Duplicate sections: **no diagnostic** (legal, Sec.4).
- **Scope for the two block-level checks that follow (`RMS0306` duplicate attribute, `RMS0307` mutex): a block's DIRECT items only, never descending into `if`/`start_random` branches inside it.** That is the whole correctness argument, and it is pinned here because it is the kind of reasoning a later session "fixes". Branches are mutually exclusive at runtime, so `if A number_of_objects 5 else number_of_objects 3 endif` sets the attribute exactly once however it is read; counting across branches would false-warn on the most ordinary conditional in RMS. Section-level mutex, which the bullet below once implied ("same block/section"), is deliberately not implemented for the same reason.
- Duplicate attribute within one command block — **split by repeatability** (guide-documented: `spacing_to_specific_terrain`, `replace_terrain` ["can, and should, be used multiple times"], `terrain_cost`, and connection radius attributes are *cumulative*; every corpus connection block repeats them legally): attributes flagged `repeatable` in language.json get NO last-wins note; non-repeatable attributes get the info note ("the engine uses the last one"). **Read the flag, never a name list.** Six attributes carry it today: `spacing_to_specific_terrain`, `replace_terrain`, `terrain_cost`, `terrain_size`, `avoid_actor_area` and `add_object`. `add_object` was flagged during the `validate()` build (2026-07-31) on corpus evidence rather than a guide line, since the OBJECTS_GENERATION docs weren't reached in the source fetch: stacking `add_object` is the entire mechanism of `create_object_group` (one line per member type, percentages summing across them) and 43 blocks across the 57-map corpus repeat it, so without the flag RMS0306 false-warned on every object group. Rationale is recorded on the entry's own `notes` field. Note also that "connection radius attributes" above was imprecise — the repeating one is `terrain_size` (per-terrain width along the connection path); actual radius attributes set a width once. `avoid_actor_area` was flagged later than the rest (guide: "the same object can avoid multiple actor areas", and its own example stacks six); without it this check false-warned on all 32 corpus maps. **The rev-4 `maxRepeats: 4` claim for spacing_to_specific_terrain is withdrawn** — the guide (lines 1553–1573) documents no cap (its example merely has four lines); REVISION_3 attributed a 4-use cap to Update 153015's notes, so re-check that patch note before ever setting `maxRepeats`; shipping an unsourced cap would itself be a goal-#5 violation. **Breakdown consequence (pinned): repeatable attributes are a list in the block UI — an edit must never collapse them to one.** Rev 3's blanket last-wins rule would have made Breakdown corrupt every connection block it touched.
- ~~Shadowing a predefined name: `#const GOLD 123` is a **silent no-op in-engine** (first-definition-wins, and `random_map.def` defined it first) — warning, high-value for beginners. Data arrives with `predefinedLabels` + the constants DB; check every user `#define`/`#const` name against it.~~ **Amended 2026-07-31, corpus review — this bullet's rationale covers game constants only, and applying it to `predefinedLabels` as written produced a false claim.** The two halves are now separate checks:
  - **Game constants (RMS0302).** The bullet holds: `random_map.def` really does define `GOLD` before the script runs, so a user `#const` of it never takes effect. But *inert* is not the same as *wrong* — the value the author wrote is what decides. Warning only when a verified `constId` and an integer literal disagree (the silent value bug the check exists for); info when they agree, which is 73 of 73 corpus instances, all copied `if TERRAIN_CONSTANTS` documentation headers pinning the engine's own IDs. The rev-5 wording ("this line does nothing at all — pick a different name") was both louder than the evidence and wrong advice for that idiom.
  - **Predefined labels (RMS0312, new).** Not shadowing at all. Every one of the 138 `predefinedLabels` is a *runtime condition* — the ten categories are game mode, map size, starting resources, starting age, lobby setting, player count, team count, team size, player-in-team, game version — and the engine defines each only when it holds. `MAPSIZE_TINY` exists on a tiny map and nowhere else, or `if MAPSIZE_TINY` could not work. So `#define EMPIRE_WARS` is overridden by nothing; it switches the condition on, which is why `Acclivity`, `Enclosed` and `Haboob` all ship `if EW_TESTING / #define EMPIRE_WARS / #define FEUDAL_AGE_START`. Info, phrased as what it is (a hand-set condition) plus the one real hazard (an unguarded one ships enabled). **Generalised rule: `predefinedLabels` records names the engine *may* define, never names it *has* defined.**
- **Use-before-definition** (guide line 148: definitions "will only be true if they are defined higher up in the file … regardless of the section header"): flag references whose token index precedes the definition's — warning (the engine silently ignores-or-substitutes per line 173, i.e. a silent map bug); include-softened to info as usual.
- **Mutual exclusion (`RMS0307`)**: attributes whose defs carry `mutexWith` both present in the same block — warning. The data now has **19 entries covering 10 pairs**, not the one pair rev 5 named, and measures **62 corpus warnings** *(52 `.rms`)* split 51 `set_scale_by_groups`/`set_scale_by_size` and 11 `land_percent`/`number_of_tiles`.

  **Rev 6 fixed the message, and declined to gate the check.** Two things were wrong. First, the message said a mutex pair "set the same thing two different ways", which is false for the pair producing 51 of the 62: `set_scale_by_size` scales the tile count and `set_scale_by_groups` scales the clump count. Second, this spec's own verify item 21 called the check "almost certainly a false-positive source" on the strength of 194 co-occurrences in official scripts — **a frequency argument, which is exactly the reasoning BUG-003 discredited.** The right question was never how often the two appear together but what an author could have *observed* if one silently won, and the guide answers it outright at 1662/1679: **"If you see a script scaling by both size and groups, only the final attribute will apply!"** So 194 shipped co-occurrences are 194 lines whose earlier half does nothing, in maps nobody could have noticed it in — which is the case for the check, not against it. Item 21 is closed on the guide; no game session needed.

  Mutex pairs are therefore **not** gated by severity, but they *are* unequally documented, and the message says only what the data supports: the base wording claims exclusion and nothing more, and an optional per-entry **`mutexNote`** carries the consequence and the fix for pairs where the guide states them. Only the `set_scale_by_*` pair carries one today; `land_percent`/`number_of_tiles` (guide:733/750) is declared exclusive with no consequence named, so it gets the base message.
- **Wrong-section suppression after degraded headers**: after a Sec.5.3 RawNode whose token range contains a `sectionHeader` token, suppress wrong-section diagnostics until the next real SectionNode — parsing resumes in the *old* section while the engine would be in the *new* one, and every downstream item would otherwise false-warn.
- **`percent_chance` lints (`RMS0308`, guide-sourced). Both cumulative thresholds are 99. Rev 5 used both numbers in one sentence and the implementation resolved the contradiction by using 100 twice; both halves were wrong against the guide, in opposite directions.** Guide:3006-3007 is unambiguous — "If the total percentages add up to less than 99%, there is a chance that none of them get chosen. If the total exceeds 99%, only the first 99% will have a chance of occurring" — and guide:3010 adds that "the 100th percent is never chosen". So a block totalling exactly 99 has full coverage, and a branch beginning at cumulative 99 is already past the reachable range.

  | input | shipped through rev 5 | rev 6 |
  |---|---|---|
  | `33 / 33 / 33` (total 99) | info, "add up to less than 100" | silent — no gap exists |
  | `45 / 54 / 1` (cumulative 99 before the last branch) | silent | warning — the third branch can never run |

  Corpus effect is one of each and both are live *(52 `.rms`)*: `24hr_Mont Saint Michel.rms` loses a false info, `TL Cape of Storms.rms` gains a genuinely dead branch it was not reporting. 412 of 454 random blocks total exactly 100 and are unaffected either way. Also: branches after the cumulative threshold are unreachable (warning); a total under 99 leaves a no-branch chance (info — often intentional); `percent_chance 0` on the first branch (warning — engine bug); `rnd(max ≤ min)` (warning). The guide's documented `0-99` range for the operand itself (guide:3003) is **still unenforceable**, because `controlKeywords` entries carry no `arguments[]` — see Sec.13 item 4.
- `effect_percent` deprecation (obsolete per Update 141935) — info.
- Non-functional syntax: uses of `#undefine`/`#include` (info, "has no effect in DE").

## 9. Performance

Lexing one linear scan; parsing one linear pass, amortized linear including Sec.5.3 reprocessing. **Benchmark file: `AK_Vanguard_v1.2.rms`** (366 KB, ~49.7k tokens). Budget: low single-digit ms. No regex in the hot loop except precompiled classifiers; tokens as plain monomorphic objects. Run in a web worker per CREATION_PLAN 2.4. (Engine trivia for author-facing docs: DE itself stalls seconds on >1 MB maps.)

**The threshold is a relative per-token cost, not a multiple of an observed absolute time (amended 2026-08-05).** Rev 5 specified "10× the observed local time". That form went red twice on code that does not touch the hot loop — 672 ms once, and once inside a suite run that took 279 s against a normal 84 s — because **a wall clock on a shared machine measures the machine**: agent sessions have seen the same suite take 48 s and 307 s on identical code. What runs instead prices one token on today's hardware (a 20 KB slice parsed 20 times), then requires the full file's per-token cost to stay within 8× of it. Super-linear behaviour still trips it; a loaded machine scales both sides. Mutation-tested (ratio 8 → 0.3 turns it red). This is a spec that lost a race with its own stated intent — Sec.9 always said the benchmark exists "to catch complexity regressions, not to measure", and the relative form is what that sentence describes.

## 10. Diagnostic codes

| Code | Sev | Meaning |
|---|---|---|
| RMS0001 | warning | Unclosed `/*` (nesting-aware) — rest of file is a comment |
| RMS0002 | warning | `*/` without matching `/*` |
| RMS0003 | warning | Token contains embedded `{ } /* */` — missing whitespace (leading- and trailing-glue message variants) |
| RMS0004 | warning | Non-standard space character (NBSP etc.) inside a token |
| RMS0005 | info | Leading byte-order mark (emitted as a trivia token; has no effect) |
| RMS0100 | warning | Unknown section header |
| RMS0101 | warning | Unclosed `{` at EOF — **downgraded from error 2026-08-12** (BUG-006, verify #6 answered: DE generates `BCC2-Rekawa.rms`, which ends at brace depth 1, with no visible problem) |
| RMS0102 | warning | `{` with nothing to attach to (OrphanBlockNode) |
| RMS0103 | error | Section header while `{` open — block force-closed (⚠ verify #9) |
| RMS0104 | warning | Stray `}` |
| RMS0105 | warning | Unclosed `if` / `start_random` at EOF (⚠ verify #12) |
| RMS0106 | warning | Control keyword in wrong context / tokens before first `percent_chance` |
| RMS0107 | warning | Nesting deeper than maxNestingDepth — shown as raw code |
| RMS0110 | info | Conditional interleaves with command/block/section structure — shown as raw code (valid RMS) |
| RMS0111 | **error** | A word inside a comment resolves to 69, which the engine reads as `/*`. It opens a nested comment and **everything after it is invisible to the engine** (Sec.2.1 amendment, 2026-08-11; BUILT 2026-08-12 in `validate.ts`, which is where the game constants and the script's own `#const`s both are — only the FIRST hit is reported, since everything below it is inside the engine's nested comment) |
| RMS0200 | warning | Unknown command/attribute name, with did-you-mean (below) |
| RMS0201 | warning/info† | Too few arguments (incl. stop-set/assembly early termination) |
| RMS0202 | warning/info† | Argument type mismatch |
| RMS0203 | warning/info† | Argument out of documented range |
| RMS0204 | info | Bare numeric ID where a named constant exists (ID wording gated, Sec.6) |
| RMS0205 | warning | Cross-category constant use (ID wording gated, Sec.6) |
| RMS0206 | warning | Unknown `#` directive (a `#` token is not automatically a directive — guide-confirmed) |
| RMS0207 | warning | Known name in wrong context ("this attribute belongs inside a `{ }` block") |
| RMS0208 | warning | Unclosed/degenerate math expression (degraded to raw) |
| RMS0209 | warning | Unclosed quoted filename (degraded to raw) |
| RMS0210 | warning | Malformed math expression (nested paren / glued operator / rnd inside / unglued operand — specific messages) |
| RMS0211 | warning | Quoted path on `#includeXS` (engine rejects quotes — documented bug) |
| RMS0212 | warning | Digit-prefixed word in a *numeric-typed* argument slot only ("engine reads `50%` as `50`") — never in name/constant/condition slots |
| RMS0213 | warning | Nested `start_random` (engine does not support nesting randoms) |
| RMS0214 | warning | rnd-like token failing the canonical form ("rnd() must contain no spaces") |
| RMS0215 | warning | Unexpected value where a statement was expected (number/rnd-initiated unknown-run) |
| RMS0216 | warning | `//`-leading token ("`//` is not a comment in RMS — use `/* */`") — the most predictable C-style beginner mistake |
| RMS0217 | info | Value is valid RMS but reference data flags a caution for it (e.g. a negative border, which the guide allows subject to a condition this check cannot see) — distinct from RMS0203: NOT a min/max violation, message must say the value is valid |

† info when the underlying language.json entry is `"verified": false` (Sec.6 rule 2).

**RMS0217, added post-spec:** not part of the original numbered list above it — logged here as an amendment rather than folded silently into the table. Driven by two new optional `ArgumentDef` fields, `cautionBelow`/`cautionMessage` (schema in `reference/schemas/language.schema.json`), checked in `consumeOneArg` only once the existing min/max check has passed (so it never double-fires with RMS0203). Its whole current use is the four border attributes (`left_border`/`right_border`/`top_border`/`bottom_border`, `cautionBelow: 0`). `cautionMessage` also renders in the Monaco hover popup (`src/editor/aoe2RmsHover.ts`) so the caution is visible before a risky value is even typed — hover does NOT render the generic `notes` field (too much internal/maintainer-facing text lives there); `cautionMessage` is the deliberate user-facing channel.

**Rev 6 — the message asserted a crash the guide does not describe, and the severity was wrong. Both are fixed; the reasoning matters more than either.** The shipped text read "Negative border values are valid RMS, but **can crash the game** if they push the land origin outside the map — pair a negative border with an explicit `land_position` to keep the origin on-map." What guide:887-890 actually says:

> Negative values can be used, as long as the land origin stays inside the map. To ensure this, do one of the following: Specify a land_position within the map / Specify a sufficiently large base size

No crash, and no consequence named at all. The escalation from "as long as" to "can crash the game" had no observation behind it — the failure the hard rule at Sec.1 exists to catch — and it was, at 169 hits *(52 `.rms`)*, the largest warning source in the whole tool after RMS0200's 858, larger than everything `validate()` emitted combined. It is now worded to the guide, naming **both** documented mitigations rather than the one.

**Severity is info, and the corpus is what decides it.** `cautionBelow` is a per-argument scalar, so the check sees the value and can never see the condition that makes it risky — which lives elsewhere in the block. Measured: of the 169 sites, the **135 attributable to an enclosing block sit in a block that already carries `land_position` or `base_size`, and 0 sit in a block with neither.** `local/Enclosed.rms` writes `land_position 99 1` and `top_border -10` in one block — the guide's first prescribed remedy, in the same block — and still drew the caution. A warning that fires hardest on authors who did the documented thing is goal #5 exactly backwards.

**Upgrading it back to warning means making it conditional, and that belongs in `validate()`**, not `consumeOneArg`: "this block contains neither `land_position` nor an explicit `base_size`" is a real condition over a block, not a scalar over an argument. Note before building it that the corpus would then emit **zero**, so it needs a constructed test in both directions rather than a re-measurement.

**RMS03xx, the semantic block (added with `validate()`, 2026-07-31):** Sec.8 enumerates eleven checks and assigns codes to only two of them (RMS0204/RMS0205), so the rest got their own block, continuing the existing grouping (00xx lexical, 01xx structural, 02xx names/arguments). Logged here as an amendment, same convention as RMS0217. The table lives in `src/parser/diagnostics.ts`. **RMS0312 was added later the same day by the corpus review**, splitting the Sec.8 shadowing bullet into the two checks it always contained; codes are cheaper than an overloaded one, and a code whose `summary` has to cover two different engine behaviours can't state either.

| Code | Sev | Meaning |
|---|---|---|
| RMS0300 | warning | Condition label is undefined **and** within edit distance 1 of a defined name |
| RMS0301 | warning | Second `#const` of a name **on the same execution path** — the first definition wins |
| RMS0302 | warning/info | User `#const` of a built-in game constant — warning when the value contradicts a verified `constId`, info when it matches or can't be compared |
| RMS0303 | warning | Name used above the line that defines it |
| RMS0304 | warning | Wrong-section placement — **built 2026-08-10**, driven by the per-command `sectionLocked` flag and never by `CommandDef.section`; see below |
| RMS0305 | info | No `<PLAYER_SETUP>` section |
| RMS0306 | info | Non-`repeatable` attribute given twice in one block — the engine uses the last |
| RMS0307 | warning | `mutexWith` attributes both present in one block |
| RMS0308 | warning/info | `percent_chance` cumulative lints; `rnd()` reversed (warning) or constant (info) bounds |
| RMS0309 | info | Command carries `deprecated` in language.json |
| RMS0310 | info | Entry carries `nonFunctional` — two directives (`#undefine`, `#include`) and, since 2026-08-02, four attributes (`min_distance`, `max_distance`, `percent_of_land`, `set_position`) |
| RMS0311 | error | Attribute's `requiresSection` is absent from the script |
| RMS0312 | info | User `#define` of a predefined condition label — switches the condition on by hand |
| RMS0313 | warning | `elseif` repeats a condition from earlier in the same chain — the branch is unreachable |
| RMS0314 | warning | `#const` shadowed by an earlier one whose conditions this line also requires |
| RMS0315 | warning | Attribute's `requiresOneOf` partner is nowhere in the block — **added 2026-08-10**, see below |

Three scoping rules govern the block, all forced by measurement over the 57-map corpus (full numbers in `docs/build-log.md`; the naive implementation emitted 11,623 diagnostics, the shipped one 313, of which 106 are warnings).

1. **Reference data is a positive resolver, never a negative authority.** `game-constants.json` holds 31 of several hundred constants, so a hit proves something and a miss proves nothing. This also applies to `predefinedLabels`, which was expected to be a closed vocabulary and is not: DE-official maps branch on `MAPSIZE_ABOVE_GIANT`, `THEME_AFRICAN`, `NOMAD_START` and others absent from the archived guide the 138 entries came from. RMS0300 therefore fires only on a **near-miss of a name that does resolve** — never on mere absence — and stays silent when the `#define` exists but is commented out (a deliberate feature toggle).
2. **Edit distance 1, not 2, for condition labels.** RMS0200's distance-2 heuristic suits command names, a fixed well-spaced vocabulary. Condition labels are invented per file and come in dense families, where distance 2 always finds a neighbour that means nothing (`CONFIG_RIVER_D1` → `CONFIG_RIVER_A4` is a different river). Distance 1 caught the corpus's one real find: `hamburger.rms2`'s `0_TEAMGAME` for `0_TEAM_GAME`, three permanently dead branches in a shipping map. **Residue, open:** distance 1 narrowed the family problem without closing it. `AK_Namatjira` defines `CONFIG_RIVER_{A4,A6,A9,M4,M6,M9}` and branches on twelve members of the family, so `elseif CONFIG_RIVER_A8` is reported ("did you mean `CONFIG_RIVER_A4`?") while the four undefined siblings at distance 2 are not — an arbitrary 2-of-6 split on a deliberate config ladder. Same shape in `Rage Forest 2026`'s `PREDATOR_A_*` chain. A candidate discriminator, unmeasured: in `hamburger` *every* condition in the if/elseif chain is undefined (the typo signature), while both suspects sit in chains that mix defined and undefined members (the config-switch signature).
3. **A reference-data hit says what a name *is*, not what the engine has already done with it.** Rule 1 governs whether a lookup may be trusted; this one governs what may be concluded from a trusted hit. Finding `EMPIRE_WARS` in `predefinedLabels` proves the engine *can* define it, not that it *has* — which is what made the old RMS0302 assert a no-op about the exact line that was doing the work (see Sec.8). The same distinction sets RMS0302's own severity: `game-constants.json` proves the engine owns `SNOW`, and only the author's value decides whether owning it costs them anything. **Every RMS03xx check must be able to name the observation behind its claim.** Post-split the corpus mix was 70 warnings and 207 info, against 149/128 before; the two reachability checks added later the same day took it to 106/207 of 313.

**RMS0304 — the verify item is ANSWERED (2026-08-04); the check is now buildable, with one caveat that decides its shape.** `CommandDef.section` records where the guide *documents* a command, not where the engine accepts one, and enforcing it naively warned 53 times on the corpus — 52 of them `effect_amount` in `<OBJECTS_GENERATION>`/`<LAND_GENERATION>` in shipped, working maps. So the question was whether the engine enforces sections at all.

**It does, for the two commands measured.** RMSTEST_33a put `create_terrain SNOW` in `<OBJECTS_GENERATION>` and RMSTEST_33b put `create_object GOLD` in `<TERRAIN_GENERATION>`, three runs each on a 200 map. **Neither produced anything**: zero SNOW (the map came back 40000/40000 base terrain) and zero GOLD. Both scripts' `base_terrain GRASS` applied normally, so the scripts parsed and ran — this is one command being discarded, not a failed generation. A misplaced command is therefore a **real defect in the author's map**, not a style preference, and RMS0304 is worth building as a warning.

**The caveat is what it must be built from.** Two commands both being locked is consistent with a blanket rule, but it does not establish one — and the 52 corpus `effect_amount` hits are a standing counter-example from working maps, which means at least one command is *not* locked the way its `section` field implies. So RMS0304 must be driven by a **measured per-command list**, not by `CommandDef.section` alone. That also happens to be the only form of the check that satisfies CLAUDE.md's data-driven-vocabulary rule: add an explicit `sectionLocked` flag to `language.json`, set it only where measured, and report nothing for commands where it is unset. Building it off `section` would re-create the 53-warning false-positive class that BUG-002 and BUG-005 have already cost this project three rounds of work.

Sec.8's wrong-section suppression rule (skip everything between a Sec.5.3 degraded region that swallowed a header and the next real header) exists only to serve this check and is absent with it — revive both together.

**BUILT 2026-08-10, and both were revived together.** `sectionLocked` is a new optional field on `CommandDef`, set on `create_terrain` and `create_object` and on nothing else, each carrying the RMSTEST run that measured it in its own `notes`. The check reads that flag and never `section`.

**The measurement CREATION_PLAN 2.7 asked for is a permanent test rather than a one-off number.** `src/parser/__tests__/rms0304.measure.test.ts` prints both columns per command name: the naive `section`-driven count, recomputed rather than quoted, and the shipped count. Today that is **53 → 0** — 52 `effect_amount` and 1 `create_player_lands` (in our own `test-maps/sample.rms`) against nothing at all. Keeping the rejected design executable next to the shipped one is what stops "52 of 53 were false positives" decaying into folklore that a later session re-derives or disbelieves.

**A corpus count of 0 is the expected result and is not evidence the check works.** This corpus is expert-written and DE-official; nobody ships a `create_object` in `<TERRAIN_GENERATION>`. Same situation as RMS0314, and the same response: `validate.test.ts` carries eleven worked examples in both directions, and six mutants were confirmed red — including deleting `sectionLocked` from `language.json`, which turns four tests red and is the proof the check is data-driven rather than name-driven.

**Three silences, each a refusal to claim past the measurement.** The preamble (what was measured is a command in the *wrong* section, never one in *no* section); an unrecognised section header (what the engine does with a header it does not know is unmeasured); and everything after a degraded region in the same section. That last is the revived suppression rule, and it is deliberately triggered by **any** `RawNode` rather than only the recovery reasons that can absorb a header — the two directions are not symmetric, since over-suppressing loses a true positive in an already-broken file while under-suppressing invents warnings out of the parser's own recovery.

**RMS0315 — a guide "Requires:" line is a rule, and this is the first one enforced (added 2026-08-10, consequence corrected 2026-08-12).** `ignore_terrain_restrictions` carries `Requires: set_place_for_every_player or place_on_specific_land_id` at guide:2509. Unmet, **the attribute does nothing and the command places in full** — MEASURED, `RMSTEST_42`, four runs, 2026-08-11: 60 salmon across a flagged and an unflagged command, all 60 in water, plus 30 flagged olive trees on grass. So the check flags a **dead line**, not a dead command.

Three things about its shape are deliberate.

**It is data-driven, via a new `requiresOneOf` (plus `requiresNote`) on `AttributeDef`.** One entry today. A second needs no code change, and the bar for adding one is `requiresSection`'s: the guide must state the requirement AND the consequence must be known, which here means measured.

**Its search is block-WIDE while RMS0306/RMS0307 are direct-items-only, and the two scopes are answering opposite questions.** Those ask "did the author set this twice", where descending into branches false-warns on the most ordinary conditional in RMS. This asks "is the partner anywhere at all", and a partner written inside an `if` is a partner. It also matches on token text rather than on a resolved `def`, so an attribute the language data has never heard of still counts as present — the positive-resolver rule pointed at its own consequence, since this answer is used to *suppress* a warning.

**It errs toward the false negative and says so.** A partner supplied only inside one branch is still a bug on every other path, and this check stays quiet about it.

**Corpus: 56 sites across 12 maps** (`src/parser/__tests__/rms0315.measure.test.ts`, a permanent reporter in the RMS0200/0201/0304 family). Unlike RMS0304's expected zero, this one has plenty to say, and the largest clusters are real: `Chaotic_Straitv0.99` 16, `QS_Three_Bays_v1.1` 15, `Menindee_AUS_v2.3` 12. The clearest single find is `AK_Vanguard_v1.2.rms:1508-1510`, three identical `create_object STONE` lines carrying the flag with no partner, sitting directly above four `create_object GOLD` lines of the same shape without it. The author believed the flag was doing something; it does nothing, the two groups of commands behave identically, and nothing in game would ever have told them.

**The consequence clause was wrong for two days, and the flag saying so is what made it cheap to fix.** The original message said the whole command places nothing, inferred from `AK_Namatjira.rms` spawning no shore fish. That map cannot discriminate — its command also names a shallow a shore-habitat fish cannot occupy, so "inert" predicts zero there too, and **a map that produces zero is consistent with every model that produces zero**. The counter-evidence was already written into `RMSTEST_42`'s own header before it was run (`find_closest` carries the identical `Requires:` line and appears 71 times frameless in working maps) and was not weighed against the gate. The check kept its trigger and lost its consequence clause, exactly as this paragraph predicted it would have to. Nothing about `requiresOneOf` should be extended to the other six attributes carrying that guide line until each is measured on its own.

**Reporter caveat, and it applies to all four measure files.** Vitest 4 intercepts console output under this repo's config, so every one of these reporters prints nothing and still exits 0 — which reads exactly like a check that found nothing. Run them with `--disableConsoleIntercept`.

**Did-you-mean (RMS0200):** two heuristics against known names of the context's category — (1) edit distance ≤ 2 (catches corpus-real `enable_balanced_elavation` → `elevation`, and case-only mismatches like `Create_Land`); (2) containment, the typed name being a prefix **or** suffix of a real one. Both are cheap at these vocabulary sizes.

**Amended 2026-07-31: containment was suffix-only, and the prefix half is the more useful one.** Suffix catches corpus-real `avoidance_distance` → `other_zone_avoidance_distance` (edit distance 11). Prefix catches the short forms the engine itself carries as dead strings: the guide's Non-Functional Syntax appendix lists `min_distance`, `max_distance`, `set_position` and `percent_of_land`, found by searching the game's own non-localized-key-value-strings file, and three of the four are truncations of names that work (`min_distance_to_players`, `max_distance_to_players`, `land_position`; `percent_of_land` corresponds to `land_percent`). They are what a beginner guesses, the missing tails run to eleven characters so edit distance cannot reach them, and suffix-only matching gave all four a bare "unknown attribute" with no suggestion at all. `set_position` still gets none, correctly — it is not a prefix of any working name, and silence beats an invented neighbour.

**Rev 6 — the amendment's worked example no longer describes what happens, though the prefix half still earns its keep.** Two things changed underneath it. The four non-functional engine strings are now real `language.json` entries carrying `nonFunctional` + `replacedBy`, so `min_distance` **resolves as a known attribute** and reports RMS0310 rather than reaching the containment path at all. And `didYouMean` now excludes non-functional names from the suggestion pool entirely: **a did-you-mean must always point at something that works**, or it sends the author to a second dead end. The example to read the paragraph with today is an unknown name that is a genuine prefix of a working one, not `min_distance`.

**Candidate ranking (same amendment).** Containment matches are ranked by *whether the enclosing block's command accepts the attribute* first and by length second. Length alone fails the case that motivated the change: inside `create_object`, `min_distance` matches both `min_distance_cliffs` (19 chars, a terrain attribute that cannot appear there) and `min_distance_to_players` (23), and shortest-wins returns the impossible one. `CommandDef.attributes` is used to RANK only, never to reject — an attribute missing from a command's list is a reference-data gap, not evidence about the author (the positive-resolver rule).

Messages must be beginner-first: what's wrong *and what to do*. Error severity is a strong claim (goal #5): RMS0103 carries it (pinned to a verify item), RMS0111 carries it (measured), RMS0101 carried it and was downgraded to warning on 2026-08-12 when verify #6 refuted the rejection half, and RMS0311 — whose condition (elevation silently does nothing without the section) is engine-verified even though the reported crash is second-hand.

## 11. Verify-in-game checklist

Five of rev 2's twelve items were answered by the full guide (recorded below); the in-game session is now short. Test each open item with a trivial map; record answers here.

**Rev 6 — this list has never been connected to the instrument that exists, and that is the largest single gap in the document.** Since 2026-08-01 the project has had a working in-game measurement loop: 44 `RMSTEST_*.rms` scripts across four batches, roughly seventy generations, a scenario probe with four reading modes, and a documented run sheet in `tools/scenario-probe/rmstest/README.md`. It closed every question `preview-design.md` Sec.15 asked. **Exactly one item below has ever been run through it — #11**, which closed cleanly in two runs and is the model for the rest. At least eleven of the open items are the same shape as #11 (one degenerate map, one read): #6, #7, #9, #10, #12, #13, #15, #16, #17, #19, #20, #24. A batch 5 covering them is the obvious next move; it is not written, and nothing below should be read as claiming it is. Ordering suggestion, by leverage rather than by number: **#6, #7, #8, #24, then #13/#17** (the two lexer-regex pins).

Two items carry unusual leverage and are worth naming here rather than leaving them at their position in the list. **#7 (aliasing)** is the stated blocker for `known-issues.md` BUG-005 piece 2, which is **581 of the 858 RMS0200 warnings** — 68% of the tool's largest diagnostic source, deferred explicitly pending this one answer. **#8** has a binary observable needing no instrument at all and a DE-official specimen.

**Answered (guide-confirmed, no game session needed):**

1. ~~Comment nesting~~ — **DE comments NEST** (`nestedComments` defaults true; spot-check if paranoid).
2. ~~Glued markers~~ — confirmed not comments; guide's broken-comments strings are fixtures.
3. ~~Conditional splitting command from block~~ — **legal AND idiomatic** (guide Example2); RMS0110 info confirmed; first in the v1.x structuring queue.
5. ~~`#const` redefinition~~ — first definition wins; predefined names can't be re-defined; exclusive-branch redefinition fine → validate() rule in Sec.8.
11. ~~`#ifdef` family~~ — does not exist in DE; remove from language.json. `#undefine`/`#include` exist as strings but do nothing. **`#undefine` upgraded from guide-sourced to ENGINE-VERIFIED, 2026-08-01** (`RMSTEST_19_undefine.rms`, two runs agreeing). It was worth re-testing because the guide's claim is a hedged negative from a string dump, and `validate()` had come to depend on it: `subsumes()` skips the monotonicity check for negated guards precisely because definitions in RMS are irreversible. Both halves confirmed. (a) A flag `#define`d then `#undefine`d still takes its branch — 7 of 7 objects placed, against a control of 5 proving the conditional fires at all. (b) `#undefine` does **not** consume the following token: `#undefine base_terrain` followed by `SNOW` produced a 98% snow map, so `base_terrain` survived and ran. The engine reads `#undefine FOO` as two independent statements. `language.json` keeps its one-argument entry anyway, deliberately and measured — deleting it makes the operand a separate statement to our parser too, which then reports RMS0200 unknown-command on the flag name of every real `#undefine`, `test-maps/sample.rms:16` included. The array groups the line into the unit the author wrote so RMS0310 covers all of it; it is a tooling convenience, not a claim about the engine, and the entry's `notes` say so.

**Open:**

~~4.~~ **ANSWERED 2026-08-11 — `percent_chance rnd(a,b)` is evaluated normally.** `RMSTEST_55` ran two mirrored random blocks, one with `rnd(100,100)` against a literal 0 and one with `rnd(0,0)` against a literal 100, so an unevaluated percentage that always fires and one that never fires give different, recognisable outcomes. Result: the `rnd(100,100)` branch fired and the `rnd(0,0)` branch did not, which is correct evaluation and neither failure mode. The slot's numeric type in `language.json` is confirmed and the parser needs no change.
~~6.~~ **ANSWERED 2026-08-11 — BCC2 GENERATES. RMS0101 must drop from error to warning.** The question carried across three revisions as TOP PRIORITY and was settled by loading the map: `BCC2-Rekawa.rms`, the live specimen that reaches EOF at brace depth 1 via its glued `}8050`, generates successfully with no visible problem. Sec.1 goal 5 reserves **error** severity for constructs "we are confident the engine rejects or mangles", and rejection is now refuted, so the severity is unsupported as it stands.

    **One residual, and it is the difference between the two verbs.** "Generates" refutes *rejects*; it does not refute *mangles*. An unclosed block swallows everything after it as attributes, so the commands following BCC2's glued brace may be silently inert in a map that still looks fine — which is precisely the failure mode CLAUDE.md's "a shipped map is not a specification" rule describes, and it is not visible by eye. The downgrade to warning is correct either way (a warning is what "this probably does not do what you meant" is for), but **do not record this as "the construct is harmless"** — record it as "the engine does not reject it", which is what was observed. Whether the tail is inert is a separate run: put a distinguishable object command after the glued brace and count.

    Also note what this does NOT license. `test-maps/broken/`'s README states that the glue is real, which was never in question and is still true; the file stays where it is and remains the RMS0101 fixture.
~~7.~~ **THE DESTRUCTIVE HALF IS CLOSED 2026-08-11. A WORD resolving to 69 opens a nested comment and hides the rest of the file from the engine.** Three runs settled it:

    | run | leading comment contains | map |
    |---|---|---|
    | `RMSTEST_56b` | nothing (control) | **snow** — the script ran |
    | `RMSTEST_56a` | `SHORE_FISH` (object 69) | **blank grass** |
    | `RMSTEST_57` | the bare literal `69` | **snow** — literals do not participate |
    | `RMSTEST_60` | `ATTR_PROJECTILE_ARC` (attribute 69) | **blank grass** |

    So it is the **value**, carried by a **word**. Numeric literals are lexed as numbers and never reach the symbol table; the namespace the constant belongs to is irrelevant, which `60` establishes by using an attribute constant against `56a`'s object one. Comments nest, so the closing `*/` shuts only the inner comment and everything after it is invisible to the engine.

    **The complete engine-defined set is two names.** `random_map.def` — loose in the install at `resources/_common/drs/gamedata_x2/`, no DRS extraction — has exactly two constants valued 69: `SHORE_FISH` (line 263) and `ATTR_PROJECTILE_ARC` (line 1117). Add any script-level `#const NAME 69`, which the parser already tracks. **This is a two-entry lookup plus a symbol-table check, not the Equivalencies sheet import this item has been blocked on for several revisions.**

    **What is still open is the other marker.** Nothing in `random_map.def` defines `/*` or `*/` — they appear there only as ordinary comments — so the comment-marker IDs live in the engine's internal token table. `/*` is now known to be 69 by inference from these four runs. **The `*/` ID is unknown, so the words that would *close* a comment early are unenumerated.** That failure is less destructive (the file still runs, with prose parsed as commands) and it is the only part of this item that still wants the sheet.

    **The parser is wrong about this today and it is filed as BUG-012.** It treats comments as a token-stream construct and resolves no constants inside them, so it reports a comment where the engine reports the end of the file — a silent wrong answer about how much of the file exists. It has already cost one run in this repo, and an author writing `/* place SHORE_FISH here */` loses the rest of their map with no error anywhere.

    **DECIDED 2026-08-12: MODEL IT, AND DIAGNOSE IT. This reverses the previous day's decision, and the reversal is right.** A word resolving to 69 inside a comment opens a nested comment in our lexer exactly as `/*` does, so the remainder of the file becomes trivia and the AST matches what the engine sees. **RMS0111** fires at the offending token, error severity.

    **What changed the call is the corpus.** Two tracked maps already contain this, and both are the same idiom — a commented-out `create_object SHORE_FISH { … }` block, which is simply what an author writes when disabling a command:

    | map | offending line | the engine loses |
    |---|---|---|
    | `Chaotic_Straitv0.99.rms` | 547 of 1110 | 563 lines, 51% |
    | `test-maps/broken/BCC2-Rekawa.rms` | 933 of 1993 | 1060 lines, 53% |

    Half of each map is dead in game. **Not modelling means the preview draws a map neither DE nor the author will ever see, on real files, today** — and the preview's whole purpose is to show what the engine will do. A diagnostic alone leaves every downstream stage computing against a script the engine discarded.

    **The argument previously made against modelling was overstated and should not be revived.** It said the author would "lose their entire outline". Source fidelity is preserved and the parser never re-prints, so the Code tab shows every line exactly as written; only Breakdown thins to fewer cards, which is the correct depiction of a file the engine has truncated. The cost is real and much smaller than claimed.

    Two consequences that follow from the decision and should not be re-litigated in implementation. **The AST below the offending comment is now empty by construction, and that is the point** — a downstream stage seeing nothing there is seeing what the engine sees. And `unclosedComment` will fire alongside RMS0111 on these files, since depth never returns to zero; that is a true statement, but **RMS0111 must be the one that reads first**, because "unclosed comment" describes the symptom and names nothing an author can act on.

    **This raises the priority of the import and lowers its cost.** The blocker has been that the Equivalencies sheet is JS-rendered; the whole sheet is not needed for this. **The set of constants equal to the `/*` and `*/` IDs is a handful of names and is enough for a real diagnostic** — which the parser currently cannot produce at all, since it treats comments as a token-stream construct and resolves no constants inside them, and so reports a comment where the engine reports the end of the file. That is a silent wrong answer about how much of the file exists, which is the worst shape a parser bug can take.
~~8.~~ **ANSWERED 2026-08-11 — CONDITIONAL STATE DOES NOT RESET AT A SECTION HEADER, and a shipped official map loses most of itself because of it.** `Continental.rms` has 9 `if` against 8 `endif`; `if INFINITE_RESOURCES` at line 280 opens an `else` at 281 that is never closed, and that `else` runs to EOF across `<ELEVATION_GENERATION>` (363), `<CLIFF_GENERATION>` (371) and `<CONNECTION_GENERATION>` (386). Played with Infinite Resources selected — so the `if` branch is live and the unterminated `else` is the branch being deleted — the map came back with **no cliffs and almost no resources: forests, a few whales, a few relics, and essentially nothing else.**

    **Both halves of that reading matter.** The missing cliffs are the predicted observable and they confirm the mechanism: the token stream really does carry conditional state straight through a section header, so everything from line 281 to EOF was deleted. The missing *resources* are the part nobody predicted, and they locate the `if` — it sits inside `<OBJECTS_GENERATION>`, which in that file precedes the three sections named above, so the deleted range takes most of the object commands with it as well. What survives is what the deletion could not reach: forest terrain (painted in `<TERRAIN_GENERATION>`, which runs earlier and auto-places its own trees), and the handful of object commands written above line 281.

    **This grounds Sec.5.1 dispatch item 1 and it is now a measurement rather than an assumption.** It also means the split-command idiom's tolerance is broader than the grammar-shaped AST models: an unterminated conditional is not a local defect, it is a truncation of the rest of the file, and our parser currently reports it as a warning (RMS0105) with no statement about scope.

    **The durable lesson is about the observable, not the engine.** The run was set up to look for cliffs, because cliffs were what the reasoning predicted. The resources are what actually showed how far the deletion reached, and they were noticed only because the whole map was looked at rather than the one thing the prediction named. Same shape as the `mean x` finding already in CLAUDE.md — record the reading you did not ask for.

    Follow-on, not yet scheduled: this is a genuine defect in a shipped official map under one lobby setting, and it belongs in `de-official-map-issues.md` rather than only in a parser design note.
9. `{` block left open across a section header — engine behavior? (Grounds RMS0103's error severity.)
10. NBSP/unicode spaces and BOM — engine tokenization?
12. Unclosed `if`/`start_random` at EOF — silently fine? (Grounds RMS0105 warning.)
13. Float literal forms — `.5` without leading zero? Scientific notation? (Pins the number-token regex.)
14. Where exactly are floats *rejected*? (Float acceptance is per-attribute reference data — calibrate with one or two rejection cases, e.g. `create_elevation` height, `percent_chance`.)
15. Expression edges: unclosed `(A +` at EOF; spaced operands `( A + 1 )`; glued operator `(A+1)`; **the engine's own close-detection rule** — interior `rnd(1,5)`, interior `(5)`, multi-close `2))`, comment inside parens. (Grounds RMS0208/0210 severities and Sec.2.2's terminator pin.)
16. Quoted `#include_drs` path with spaces works? `#includeXS` genuinely rejects quotes? (Grounds RMS0209/0211.)
17. Does `rnd(0.5,1.5)` (float bounds) work post-141935? (Pins the rnd token regex; if yes, widen it — currently float bounds lex as `word` and would draw a false RMS0202/0214.)
~~18.~~ **ANSWERED 2026-08-11 — truncation toward zero for all operand signs.** `RMSTEST_47` computed `-7 % 2`, `7 % -2` and `-7 % -2` into three object counts and returned 90 / 110 / 90 against predictions of 90 / 110 / 90, reproduced on a second run. The third arm exists to separate a genuine sign rule from an always-positive remainder, which predicts 110 there and did not occur. Sec.2.2's pin is now a measurement, `mathEval.ts` needs no change, and the guide's `(-5.9 % -inf + 10)` → 5 idiom is explained rather than merely consistent. This item had been phrased as an open question across several revisions with no answer anywhere in the build log.

**Items 19–24 were raised by the 2026-08-01 scan of the installed DE script set** (276 files under `resources/_common/drs/gamedata_x2`, write-up in `../../de-official-map-issues.md`). Each one blocks a claim that scan wanted to make, and each has a live official specimen rather than a constructed one — which is what makes them cheap to test and expensive to keep guessing at.

19. **Do `#define` and `#const` share one symbol table?** Two sub-questions: does an earlier `#define FOO` block a later `#const FOO` under first-definition-wins, and what does a `#define`d name resolve to in a *numeric* slot? (Grounds RMS0301/RMS0314 scoping — both currently walk `#const` only — and decides the severity of the `Capricious.rms:880-883` finding, where `#define HERDABLE_COUNT n` sits above an `#include_drs includes/herdable.inc` that both `#const`s the same name and reads it as `number_of_objects HERDABLE_COUNT`. Every sibling map writes `#const`.) Answerable with one map: `#define N 4`, then `#const N 2`, then `number_of_objects N`, and count.
20. **What does a nested `start_random` actually do?** The guide says randoms cannot be nested and offers the `#define`-a-second-block workaround, but does not say what happens if you nest anyway. The suspicion is that the inner `end_random` closes the *outer* block, which would make everything after it unconditional and orphan the outer block's remaining branches — but that is inference, not observation. (Grounds RMS0213's message, which currently states the prohibition without stating the consequence.) **Live specimen: `F_seasons.inc`, ten sites (1841, 1868, 1895, 1922, 1950, 2713, 2729, 2745, 2761, 2777), included by 43 shipped scripts** — so if the guess is right this is the highest-blast-radius defect the scan found.
21. ~~**Are `set_scale_by_size` and `set_scale_by_groups` really mutually exclusive, and if so which wins?**~~ — **CLOSED 2026-08-05, by the guide, with no game session.** Both questions are answered in both entries: `Mutually exclusive with:` declares the pair, and "**If you see a script scaling by both size and groups, only the final attribute will apply!**" (guide:1662 terrain, 1679 elevation) says which wins. The guide even gives the workaround — for terrain use `set_scale_by_groups` alone, since it scales the tile count as well; for elevation there is no combined form and you must do it by hand with conditionals. Both sentences are now the pair's `mutexNote` in `language.json` and reach the user through RMS0307's message (Sec.8).

    **The framing this item shipped with was the mistake, and it is worth keeping visible.** It read: the two "appear together in one block 194 times across the official scripts, which is far past the point where 'every one of these is a bug' is the likely reading", concluding RMS0307's output was "almost certainly a false-positive source". That is a **frequency argument** — the exact reasoning BUG-003 discredited when `showType` was flagged optional on 52 independent shipped uses and reverted the same day. The question to put to a construct is never how often it appears but **what an author could have observed if it were wrong**; here the answer is nothing, because a silently-ignored scaling attribute changes a clump count on a map nobody diffed. 194 co-occurrences are 194 lines whose earlier half does nothing. **A shipped map is not a specification, and a large count of unobservable uses is worth exactly as much as a small one.**
22. **Where do the documented argument ranges disagree with the accepted ones?** Official scripts exceed three of them: `land_percent 1024` (`Crownwood.rms:173`) and `128` (`fortified_clearing.rms`, ×4) against a documented 0–100; `min_length_of_cliff` at 1 or 2 against a documented minimum of 3, in six maps (`Fortress.rms:748`, `Mediterranean.rms:266`, `Cliffbound.rms:2348`, `Sandrift.rms:2361`, `Shrubland.rms:2384`, `lombardia.rms2:355`); `land_position 100 100` against a documented 0–99, three sites in `Michi.rms`. These read as saturating idioms. (Grounds RMS0203's `min`/`max` data — the same failure mode as the `base_elevation 0` transcription that false-warned 461 times, so widen the data rather than the check.)
23. **Is the predefined condition-label table complete as published?** The guide lists `TEAM0_SIZE1` but no `TEAM<n>_SIZE1` for n ≥ 1, no `TEAM2_SIZE7`/`SIZE8`, and stops player counts at 8. `Michi.rms` branches on `TEAM1_SIZE1` (167), `TEAM2_SIZE1` (580) and `TEAM2_SIZE7` (889), and two Battle Royale maps branch on `9_PLAYER_GAME` through `16_PLAYER_GAME`. If the omissions are real, three `create_land` blocks on Michi never run; if the table is merely incomplete, `predefinedLabels` is missing entries and any check reading it needs the positive-resolver caveat. (Grounds RMS0300 and the `predefinedLabels` data.) Note this cannot be settled by re-reading the guide — it is the guide that is in question.
24. **What does the engine do with an unexpected bare value inside a block?** RMS0215 fires 60 times on official scripts, and the dominant shape is a trailing numeric on a no-argument attribute — `place_on_forest_zone 0` in six maps plus `GeneratingObjects.inc`, and `#define NAME 1` in several more. Is the token skipped, consumed by the next attribute, or does it terminate the block? A related sub-case: a stray `endif` with no open `if` — ignored, or does it close an enclosing construct? (Live specimens `Gold_Rush.rms:650`, whose matching `if` at 623 sits inside the comment spanning 622–648, and `Karsts.rms:9219`.) (Grounds RMS0215's severity and RMS0106's "it's ignored" wording, which is currently an unevidenced behavioural claim of exactly the kind BUG-005 is about.) **Rev 6: `RMS0104` carries the identical clause** — "This `}` has no matching `{` — it's ignored." — alongside RMS0106's four variants, so this item covers three codes, not two. One sentence, one missing observation, and one test settles all three.

## 12. Test plan

**Lexer (2.2):** every TokenKind incl. float numbers; offset exactness (`source.slice(start,end) === text` — property assert over corpus); rnd classification incl. negatives; RMS0003 both glue variants (incl. the corpus-real `}8050`); RMS0004 NBSP; BOM; **nested comments** (depth 2+, unclosed-at-depth, and the guide's full fixture-string set verbatim, lines 2936–2943: `/*this is NOT a comment*/`, `/*** ***/`, `/* never ends */*`, `/* this comment never ends*/`, `#this is NOT a comment`, `// this is NOT a comment` [→ RMS0216], the triple-backtick string); CRLF vs LF; empty file; one-giant-token file.

**Parser (2.3), unit:** every Sec.5 production; one test per Sec.10 code asserting diagnostic + recovery shape; dual-use `base_terrain` by context; Sec.4 lookup-order/RMS0207 cases (attribute at top level, block command in block); if/random nesting incl. corpus-style 8-way elseif chains inside blocks; nested `start_random` → RMS0213 + lossless structure; Sec.5.3 degradation set (split block, mirror case, interleave, conditional-wrapped section header → info not error); Sec.5.4 orphan/upgrade; stop-set early termination (overstated unverified arity must not eat a following attribute); unknown-run collapsing; unverified severity capping; RMS0204/0205 gating; directives: truncated `#const`, unknown directive, **quoted `#include_drs` path** (multi-token, `../`, all four extensions), unclosed quote → RMS0209, quoted `#includeXS` → RMS0211; **expressions**: the three Vanguard `set_avoid_player_start_areas` lines verbatim, AD4's `#const MAPAREA (MAPSIZE * MAPSIZE)` verbatim (**directive-value expression assembly — distinct code path**), a Pa_Site attribute-arg expression, Pa_Site float `#const`s verbatim, `(5)` single-token, nested-paren lint, glued-operator lint, `rnd`-inside lint, unglued-operand lint, unclosed `(A +` at EOF → RMS0208, expression terminated by `{`/keyword; `inf`/`-inf` args; malformed rnd → RMS0214 (`rnd(1,` + `5)`); **RMS0212 scope regression tests**: `#define 2V1` and `if 2V1` must produce NO diagnostic (live in 5 corpus maps), `land_percent 50%` must warn; repeatable attributes: a corpus connection block with repeated `replace_terrain`/`terrain_cost` must produce NO duplicate-attribute note; cascade suppression: reduced BCC2 fixture asserting ONE summary RMS0207, not dozens; **guide Example2 verbatim** (`if REGICIDE create_object KING else create_object SCOUT endif { … }` → shared-block RMS0110 info, NOT RMS0102); both Sec.5.3 trailing-closer shapes (`endif`-with-open-brace and the mirror — exactly one RMS0110, no trailing RMS0104/0106); comment-inside-expression → RMS0210 variant; `percent_chance (X + 1)` and `percent_chance rnd(1,3)`; numeric-first-operand expressions (Pa_Site lines 721–722, `(24 …`/`(12 …`); corpus-derived micro-fixtures: `number of clumps` unknown-run (RMS0215), ForeDaut's stray fourth `endif` (line 642 → RMS0106, absorbed, working map), QS_Three_Bays `percent_chance 50 #define 7_RELICS` (conditionalDepth counts random branches; no RMS0212), `min_distance_cliffs 6 minimum distance…` trailing prose, `elavation` edit-distance did-you-mean, `avoidance_distance` suffix-match did-you-mean, AK_Six_Points' live stray `*/` (line 1893 — RMS0002 on a real working map; the corpus is NOT comment-clean).

**Corpus (2.3) — two tiers, not one (rev 6 corrects this paragraph).** As written below, the zero-error gate reads as universal over `test-maps/*.rms`. What runs is:

| Tier | Applies to | Asserts |
|---|---|---|
| 1 | **every** `.rms` under `test-maps/`, `test-maps/local/` and `test-maps/broken/` | `parseRms` does not throw; coverage; span fidelity. Also `validate()` does not throw. |
| 2 | a **triaged allowlist of 11 files** (`corpus.test.ts`) | additionally, zero error-severity diagnostics from `parseRms` **and** from `validate()` |

The allowlist is the right design, not a shortfall — it is the per-map triage protocol below, enforced. But the spec should say so, because as written it claims a gate over 41 untriaged files that no test applies. A file joins tier 2 only after triage. Three further gate facts belong here:

- **`.rms2` is excluded from every corpus gate, deliberately.** DE ships some official maps under that extension and they parse, but they carry XS-script companions and DE-only syntax the corpus has not been read for, so admitting them to a non-negotiable gate would be admitting untriaged files through the front door. They still carry real diagnostics — `known-issues.md` quotes three true positives in `local/lombardia.rms2:166-168`.
- **`validate()` has corpus gates of its own** (no-throw over every file, zero-error over the allowlist). Sec.12 predates the pass and mentioned neither. RMS0311 is the only error it can raise, which makes that gate a live check on `requiresSection` data rather than a formality.
- **A total-diagnostic-volume cap is deliberately NOT asserted**, and this is pinned because it is the obvious thing a later session adds. Half the corpus is gitignored (`test-maps/local/`), so any fixed number means something different on CI than it does locally. Re-running the measurement in `docs/build-log.md` is how to re-check noise; a magic constant here is not.

The original requirement, which still governs tier 2: `test-maps/*.rms` must parse with **zero error-severity diagnostics** and satisfy two properties, with **ownership defined** (rev 5 — "reachable" was previously undefined): a token's *owner* is the deepest AST node whose `[firstToken, lastToken]` range contains its index. (a) **coverage** — every non-whitespace char inside exactly one token; every non-trivia token has an owner, and node ranges are well-nested (children within parents, sibling ranges disjoint); (b) **span fidelity** — every node's span starts/ends with its first/last token's text. Non-negotiable CI gates (patch-engine foundation). **Escape hatch:** `test-maps/broken/` is excluded from the zero-error gate but included in coverage/fidelity/no-throw — for real maps with real defects kept as regression fixtures. BCC2 (now `BCC2-Rekawa.rms` — the spec's earlier `_Capt_Knip_edit` filename is stale) goes there `}8050` in the map (fixing is fine, but keep a reduced glued-brace-cascade fixture either way). Optional refinement: per-file expected-diagnostics annotations (`.expected.json`) if broken/ grows. **Corpus growth note:** the 52 `.rms` include DE-official base maps, which stay in gitignored `test-maps/local/` until redistribution is resolved, so both tiers simply apply to whatever is present on the machine running them — CI sees the tracked half. Vintage tags for statistics are defined in the header.

**Fuzz-lite:** ~1k iterations of random token soup (words/braces/keywords/numbers/directives/paren-glued fragments) + the 20k-nested-`if` case → no throw; coverage, span fidelity, and node-span non-overlap (siblings never overlap; children strictly within parents).

**Corpus triage protocol** (per map, before it counts toward the gate): confirm it generates in current DE; parse; triage every diagnostic as real-map-issue or parser/data bug. Record: include-dependent maps that can't generate standalone (Pa_Site); any conditional-wrapped section headers (feeds Sec.5.3 v1.x priority).

## 13. Reference-data and schema action items (consolidated)

**Status table, re-derived 2026-08-05.** Half of this section was done and still listed as open, which reads as work outstanding and invites a session to redo it.

| Item | Status |
|---|---|
| 1 (`verified: false` cleanup) | **Substantially open.** 56 of 94 attributes and 13 of 41 commands are still unverified, so Sec.6 rule 2 caps most of the attribute vocabulary's diagnostics at info. |
| 2 (remove `#ifdef` family; flag `#undefine`/`#include`) | **DONE.** Six directives in the data — the four functional ones plus `#undefine`/`#include` flagged `nonFunctional`. |
| 3 (`predefinedLabels`) | **DONE**, both representations. See the item's own note; `isDefinedSymbol` wiring is the outstanding piece (Sec.6). |
| 4 — `repeatable` | **DONE, with six attributes, not the five item 4 lists.** `add_object` was flagged later. Sec.8 already says six and names them; item 4's list is the stale one. |
| 4 — `optional`/`variadic` | **DONE and consumed** (`parser.ts`), gated by five assertions in `parser.test.ts` per BUG-003. |
| 4 — `mutexWith` consumed | **DONE** — 19 entries, 10 pairs, plus the `mutexNote` field rev 6 added (Sec.8). |
| 4 — float-capable numeric type | **NOT DONE.** No `float` flag in the schema; the argument-type enum is unchanged. See the note below. |
| 4 — `arguments[]` on `controlKeywords` | **NOT DONE.** All seven entries carry none, and this one has a live consequence — see below. |
| 5 (`avoidance_distance`) | **Decided: do not add.** Kept in full below because the reasoning is the point. |
| 6 (`land_conformity` notes) | **DONE.** |

**The two unfinished halves of item 4 both have consequences worth stating.** Because `controlKeywords` carries no `arguments[]`, Sec.5.1's "pinned exception" paragraph is still the *only* definition of `percent_chance`'s operand — so the guide's documented `0-99` range for it cannot be enforced at all, which is half of what Sec.8's RMS0308 entry could otherwise check. And because there is no float flag, "float acceptance is per-attribute reference data" (Sec.2.2, verify #14) has nowhere to land, and **the shipped behaviour is the blanket rule instead: a float satisfies every numeric slot silently.** That blanket rule is defensible for v1 and matches Sec.2.2's "no diagnostic for float-into-integer" — but it is the v1 rule, stated here as such, rather than per-attribute data that nothing can hold.

1. **language.json `"verified": false` cleanup is UNBLOCKED** — the complete guide is archived at `reference-docs/definitive-rms-guide-2026-07-16.txt` (the Phase 1.5 fetch had truncated at ~2,464/5,898 lines). Fill argument shapes for TERRAIN/CONNECTION/OBJECTS_GENERATION from it.
2. ~~**Remove the `#ifdef`/`#ifndef`/`#else`/`#endif` directive entries** (don't exist in DE). **Flag `#undefine` and `#include` non-functional** (schema flag or notes) — hover docs should say so.~~ **DONE.**
3. ~~**Add `predefinedLabels`** per Sec.7~~ — **DONE.** 138 entries transcribed from the guide's Conditionals section and Map Sizes table, including `ANTIQUITY_MODE` and the digit-leading `N_PLAYER_GAME`/`N_TEAM_GAME` names (the schema pattern admits a leading digit). Each entry carries a `category`; `mapSize` entries also carry `dimensions` and, where the app offers that size, the matching `MAP_SIZES` value. `random_map.def` remains the authoritative in-engine source if a discrepancy turns up. This was the last blocking prerequisite for `validate()`'s unknown-constant check. **The TypeScript side landed later**: `LanguageData.predefinedLabels` was still typed `string[] // absent today` after the data shipped, so consumers could not read `entry.category` at all. Now `PredefinedLabel` / `PredefinedLabelCategory` in `src/parser/language.ts`, mirroring the schema's `$defs/predefinedLabel`, field kept optional so preview-design Sec.3.1's mandated `?? []` guard stays live. Sec.6's `isDefinedSymbol` still needs wiring to it — the TODO there is now work-outstanding, not blocked.
4. Schema: **float-capable numeric type (or `"float": true` per-argument — NOT DONE, see the status table)**; ~~`optional`/`variadic` flags (rev 2)~~ — **DONE and consumed**; ~~**`repeatable: true` on cumulative attributes**~~ — **DONE**, six flagged (the list below says five and is stale; `add_object` joined later — Sec.8 has the current six) (`spacing_to_specific_terrain`, `replace_terrain`, `terrain_cost`, `terrain_size`, `avoid_actor_area`; "connection radius attrs" resolved to `terrain_size`) with `maxRepeats` **only if re-checking Update 153015's notes confirms the 4-use cap REVISION_3 reported** (the guide has no cap; an unsourced cap would false-warn) — wired to Sec.8's duplicate-attribute rule and Breakdown's list rendering; **`arguments[]` on controlKeywords entries — NOT DONE** (percent_chance's numeric operand, if/elseif's label — replaces Sec.5.1's pinned exception per goal #4, and is what would let RMS0203 enforce the guide's `0-99` on `percent_chance`); ~~`mutexWith` is now consumed by Sec.8's mutual-exclusion check (was dead data)~~ — **DONE**, plus the `mutexNote` companion field rev 6 added; `idSource` provenance on game-constants (rev 2).
5. **Do NOT add `avoidance_distance`. The original conclusion stands; the 2026-08-01 overturn was wrong and is withdrawn (re-measured against the install, 2026-08-01).**

   This bullet has now been written three times and the middle version was the mistaken one, so the reasoning matters more than the verdict. The overturn argued: 320 uses across three shipped official scripts (`Shipwreck.rms` 128, `fortified_clearing.rms` 128, `Kilimanjaro.rms` 64), two by Forgotten Empires, therefore supported syntax the guide fails to document. **The count is accurate — it reproduces exactly — and the inference from it does not hold.** Two things were never checked:

   - **All 320 uses are one copy-pasted template.** The three scripts share an identical `CIRCLE_*` constant block (`CIRCLE_TERRAIN 48 / VARIATION 48 / EDGE 89`, then `56/17/89`, then `18/113`), and `Pa_Site_v1.1.rms` — the community map that started this — is a derivative of the same block. So 320 uses are **one** observation repeated, not 320 independent ones, and "two of those are Forgotten Empires maps" is one FE circle-generator copied twice.
   - **Every one of the 320 passes `CIRCLE_AVOIDANCE`, and `#const CIRCLE_AVOIDANCE 0` at all three definition sites.** Install-wide there is no literal, no other constant, and no non-zero value. **An argument of 0 is a no-op whether or not the engine implements the attribute**, so no observation of any shipped script can distinguish a real attribute set to zero from a token the engine discards. The developers never once exercised it.

   That is exactly the fingerprint of a dead token propagated by copy-paste, and it is consistent with the original "author bug for `other_zone_avoidance_distance`" reading. Note `fortified_clearing.rms` and `Shipwreck.rms` never use the long form at all; `Kilimanjaro.rms` and `Pa_Site` use it once each. The "Pa_Site uses both, mild evidence they differ" line in BUG-004 rested on that single occurrence.

   **What would reopen this** (stated so the next reader does not re-derive the question a fourth time): one observation of a **non-zero** `avoidance_distance` having an effect in game, or a patch note naming the attribute. Neither exists today. A test map is cheap if anyone wants certainty — two lands with `avoidance_distance 20` against two with `other_zone_avoidance_distance 20`, read with `--patches`. Absent that, the 256 corpus warnings stand as *undetermined* rather than false (`known-issues.md` BUG-005's table).

   **The generalisable error: a count is not a conclusion.** Frequency measures how often a line was copied, not how often anyone decided. Before a usage count becomes evidence, check that the uses are independent and that at least one of them could have been observed to matter.

   **`building_architecture` is NOT the same shape and must not be lumped in with it** — the previous version of this bullet said "same shape, same fix needed", which is wrong. 72 uses across `BR_BattleontheIce.rms` and `BR_FallofRome.rms`, and the argument **varies meaningfully: 52 uses of `2`, 20 uses of `1`**. An author drawing a distinction between two values is using something they believe does work, which is the evidence `avoidance_distance` conspicuously lacks. Still absent from the guide; still needs its argument researched before an entry is written, but it is a genuine candidate where the other is not.

   **`temp_min_distance_to_players`** — one use at `real_world_world.rms:498`. A single occurrence makes an author typo for `min_distance_to_players` at least as likely as a real name; needs deciding rather than adding.
6. `land_conformity` notes should carry the guide's warning that it misbehaves and may change.
7. Game-constants cross-check sources for Phase 4.0: patch notes 141935/153015/169123 carry dated real IDs (terrains 113–130, cliff types 4–5, water definitions 0–20, new objects) — candidates for `idSource: "patch-notes"` provenance. Also note `objreplacement.json` (civ-specific object replacement, Update 169123) as a Phase 4+ preview-fidelity concern.
8. Doc-strings, eventually: the F_seasons include's shared constants (MELKARYBA, KERICEK, VODA, WOODIES, …) — heavily used by standard-derived maps and invisible to the symbol table (include-defined).
9. Preview-generator inputs to model in Phase 4/5 (parser-neutral, recording so they aren't lost): `behavior_version` (0–2) gates land-generation semantics; `override_map_size` (36–480, clamps, repeatable, mid-script); duplicate attribute → last wins; map seed now visible in DE's Objectives screen (useful for eventual preview-vs-game verification).

## 14. File layout

```
src/parser/
  lexer.ts        tokenize(source, opts) → { tokens, lineOffsets, diagnostics }
  parser.ts       parseRms(source, lang, opts) → ParseResult
  validate.ts     validate(result, refDb) → Diagnostic[]
  language.ts     LanguageData + the def types the JSON is read into
  types.ts        every interface in this doc
  diagnostics.ts  code table + message builders
  resourceTotals.ts  computeResourceTotals (Phase 2.5)
  __tests__/
    lexer.test.ts parser.test.ts validate.test.ts resourceTotals.test.ts
    corpus.test.ts    the Sec.12 gates AND the benchmark (a describe inside it,
                      not the parse.bench.ts rev 5 named — that file does not exist)
    fuzz.test.ts      Sec.12 fuzz-lite
    circleRadius.test.ts
    rms0200.measure.test.ts / rms0201.measure.test.ts
                      REPORTERS, not gates — the instruments of record for
                      known-issues.md BUG-005 and BUG-003. Excluded from
                      npm test's floor deliberately. Re-run them rather than
                      quoting either bug's numbers.
    testUtils.ts
test-maps/        corpus (see Sec.12 for the two tiers)
test-maps/broken/ real maps with real defects (exempt from the zero-error tier only; still fidelity-checked). CREATED 2026-08-05, holds BCC2-Rekawa.rms
```

No imports from React, Monaco, or Tauri anywhere under `src/parser/` — it must run in a bare worker and in Node (Vitest) unchanged.

---

## Appendix E: rev 6 changelog

From `docs/parser-design-rev5-review.md`, plus the corrections that review's own claims needed. **This is the first revision written after the pass shipped**, so most of it is the spec catching up to code rather than the reverse — but three checks disagreed with their own sources and those are code changes.

**Checks corrected (code + data).**

- **Sec.5.3's "symbols and includes survive degradation" was false for the forward half of the range.** Rev 5 extended the wrap forward; that extension is a raw token scan, so a `#const` past the trigger point was recorded nowhere and every later use of the name drew the false unknown-symbol warning the pinned rule exists to prevent. Both forward scans now record directives, using `parseDirective`'s stop set and Sec.5.2 quote assembly, and emitting no second diagnostic. Corpus volume zero; closed on a constructed case, with five assertions.
- **RMS0308's two cumulative thresholds were both 100 and are both 99** (guide:3006-3007 + 3010). Rev 5 used both numbers in one sentence, so the implementation picked one and was wrong in both directions: a 99-total block drew a false info, and a branch beginning at cumulative 99 was silent. One of each is live on the corpus.
- **RMS0217 asserted a crash the guide does not describe**, was the largest warning source after RMS0200, and fired on the guide's own mitigation. Reworded to the guide and downgraded to **info**, on a measurement: of its 169 hits the 135 attributable to a block sit in a block already carrying `land_position` or `base_size`, and 0 in a block with neither. Making it a real condition needs `validate()`, and is specced in Sec.10.
- **RMS0307's message claimed a shared purpose the guide does not state** ("they set the same thing two different ways" — false for the pair producing 51 of its 62 corpus hits). Rebased on what `mutexWith` actually records, with a new per-entry `mutexNote` carrying the consequence where the guide states one.
- **RMS0210's unglued-operand lint double-fired** on `( 5 + 1 )` — same code, message and span twice.

All five were mutation-tested: each defect was reintroduced deliberately, its own assertion seen to go red with a readable message, then restored.

**Verify item closed without a game session.** Item 21 (`set_scale_by_size` vs `set_scale_by_groups`) is answered outright at guide:1662/1679, including which one wins. The item had argued from 194 shipped co-occurrences that the check was "almost certainly a false-positive source" — a frequency argument of exactly the kind BUG-003 discredited, and the answer was two lines away in the entry the mutex was transcribed from.

**Spec brought level with code.** Corpus-vintage tags defined and applied (three sets were live under a header claiming one); the positive-resolver rule and its corollary hoisted to Sec.1 to bind both passes; Sec.4's AST sketches reconciled with the shipped token-index representation; Sec.6's RMS0202 paragraph rewritten — it carried two readings BUG-002 closed in the *opposite* direction and named a schema change that had already been reverted, the most dangerous staleness in the document; Sec.8's unknown-constant and wrong-section bullets rewritten to what shipped; `validate()`'s signature corrected to two parameters; Sec.9's absolute benchmark threshold replaced by the relative per-token one that runs; Sec.12's zero-error gate documented as the two tiers it is, plus the `.rms2` exclusion, `validate()`'s own gates, and the deliberately-absent volume cap; Sec.13 given a status table (half the items were done and still listed open); Sec.14's layout corrected; the benchmark file's real name (`AK_Vanguard_v1.2.rms`) fixed in Sec.1 and Sec.9.

**Smaller pins.** Seven cross-references to a non-existent `Sec.6.5`/`Sec.6.2` repointed at Sec.13 and Sec.6. The glued-operator lint's deliberate exclusion of `-` documented. The forward scan's hardcoded control-keyword strings recorded as a goal-#4 exception. `aliasTable`'s inability to express the `L` case (68% of RMS0200's output) noted at both mentions. `isDefinedSymbol`'s `predefinedLabels` TODO flagged as unvalidatable by re-measurement. RMS0310's table row corrected (four attributes now carry `nonFunctional`, not just directives). The did-you-mean amendment's worked example noted as superseded. Sec.8's direct-items-only scope for RMS0306/RMS0307 pinned — it existed only as a code comment and is the whole correctness argument. Verify item 24 extended to RMS0104, which carries the same unevidenced "it's ignored" clause.

**Recorded, not done.** The verify checklist still has no batch-5 run sheet: nineteen items open, one ever run, and Sec.11 now says so in its own header along with the leverage of #6 and #7. Writing those RMSTEST scripts is a separate job in `tools/scenario-probe/rmstest/`.

## Appendix A: rev 3 changelog

From `docs/REVISION_3.md` (corpus + patch notes + full guide): math expressions modeled (Sec.2.2 — assembly in consumption, unevaluated, guide-verified lints RMS0208/0210; floats first-class, float-into-integer silent); comments nest (default flipped, depth counter, guide fixtures); quoted `#include_drs` paths assembled (RMS0209/0211); `#undefine`/`#include` non-functional (SymbolInfo.undefineAttempted; validate() ignores undefines); `#ifdef` family removed from the model; `ParseResult.includes` + include-softened symbol diagnostics (Pa_Site's 43 includes); RMS0207 wrong-context code + pinned two-way lookup; RMS0212 digit-prefix lint with predefined-label exemption; RMS0213 nested-random warning; percent_chance/duplicate-#const/effect_percent validate() rules; did-you-mean extended (edit-distance ≤2 + suffix match — both corpus-justified); `test-maps/broken/` gate escape hatch (BCC2); Vanguard named benchmark; duplicate sections confirmed legal (no diagnostic); verify list: 5 items answered by the guide, 4 new items (#13–16), #6 promoted to top priority. Consolidated data/schema actions in Sec.13.

## Appendix B: rev 5 changelog

From `docs/REVISION_5.md` (token-level re-derivation + guide-citation verification): shared-block rule added to Sec.5.4 — guide Example2 traced through dispatch never reached Sec.5.3 and would have drawn a *warning* (RMS0102) on the spec's own flagship idiom; now OrphanBlockNode + RMS0110-info via lookbehind, fixture added. ArgNode given `firstToken`/`lastToken` (quoted-path interior tokens were unreachable — coverage gate ill-defined, patch engine blocked); coverage "reachable" formally defined via deepest-owner + well-nestedness. Sec.5.3 wrap extended *forward* until involved constructs close (trailing closers previously fired spurious RMS0104/0106 — one-diagnostic promise restored, both shapes fixtured). Modulo semantics de-contradicted (`x % 0` → left operand truncated toward zero per Summer 2025 patch; stale guide text noted; % is truncation not floor; verify #18). Comment-inside-expression RMS0210 variant (guide 3362 — engine rejects what assembly would silently accept). spacing_to_specific_terrain `maxRepeats: 4` withdrawn pending patch-note re-check (guide has no cap; unsourced cap = goal-#5 violation). Corpus claim corrected: ForeDaut line 642 has a live stray `endif` (RMS0106 corpus grounding + fixture). Six ambiguities pinned: expression terminator (rnd-kind never terminates; interior `(5)` terminates + lints; engine rule → verify #15), quote cap 64, control-keyword operand consumption (+ `arguments[]` schema action; expression/rnd active in percent_chance slot), RMS0215 for value-initiated unknown-runs, wrong-section suppression after degraded headers, conditionalDepth counts random branches (QS fixture). validate() additions: use-before-definition (guide 148/173), mutexWith consumption. Errata: RMS0005 wording (BOM is a token, not skipped), isTrivia comment reconciled, digit-defines corpus count 8-of-11, three more not-a-comment fixtures + new RMS0216 `//` beginner lint, numeric-truncation float caveat, numeric-first-operand fixtures. Corpus-growth note added (Sec.12, header): stats are the 12-file snapshot; ~52 files now present incl. DE-official maps pending redistribution decision.

## Appendix C: rev 4 changelog

From the fourth critique (independent re-derivation of corpus claims): RMS0212 re-scoped to numeric-typed argument slots only — the rev-3 exemption-list shape missed `#define`'s name slot and would have false-warned on digit-leading user labels live in 5 corpus maps (`#define 2V1`); Sec.8 duplicate-attribute rule split by a new `repeatable` schema flag (guide documents cumulative repetition for spacing_to_specific_terrain/replace_terrain/terrain_cost/connection radii — blanket last-wins would have made Breakdown corrupt connection blocks; repeatable attributes are pinned as lists in Breakdown); "skip" eliminated as an AST outcome — every rejected token joins the pending unknown-run, making Sec.12's coverage property satisfiable by construction; symbols/includes pinned to survive Sec.5.3 degradation (token-stream concern, not AST concern); new validate() check for shadowing predefined names (silent no-op in-engine); RMS0207 cascade suppression (one glued brace ≠ fifty warnings); RMS0214 malformed-rnd did-you-mean + verify #17 (float rnd bounds); BOM given a concrete token representation; RMS0004 char set enumerated; sectionHeader regex admits digits; stop set made context-symmetric; errata fixed (13 ELEVATION headers are corpus-wide with OWWC's 2 being the only duplicate — legality now cited to guide line 148; expression count corrected to 45 across three files incl. AD4's #const-value expressions, now fixtured; AK_Six_Points' live stray `*/` recorded).

## Appendix D: rev 2 changelog (condensed)

Conditional-wrapped section headers → Sec.5.3/RMS0110-info (was an error-severity contradiction); argument stop-set enumerated incl. known names (unverified-arity cascade closed); recursion-safety mandate; RMS0204/0205 provenance gating; Token.isTrivia; ParseResult.symbols; RMS0101/0103 disambiguated; OrphanBlockNode; Sec.5.3 mirror case + amortized linearity; data-driven directives; RandomNode.preamble; whitespace pinned + NBSP/BOM lints; case-sensitivity; goal "no false errors on legal maps" made explicit.
