# RMS Parser Design (Phase 2.1, rev 5)

Spec for the error-tolerant AoE2:DE RMS parser in `src/parser/`. Rev 2 resolved the first critique; rev 3 folded in the corpus/patch-notes/full-guide critique (`docs/REVISION_3.md`); rev 4 the independent corpus re-derivation. Rev 5 folds in the fifth critique (`docs/REVISION_5.md`): the flagship guide idiom re-routed off its false-warning path, ArgNode given a token span (patch-engine blocker), §5.3 degradation extended forward, modulo semantics de-contradicted, six implementation ambiguities pinned. **Corpus note:** all corpus statistics in this spec describe the 12-file snapshot verified by REVISION_5 §1; the corpus has since grown to ~52 files and claims must be re-derived before being cited for the new set. Implementation follows in 2.2 (lexer) and 2.3 (parser). **Implementation sessions: do not deviate from this spec — if something here seems wrong or ambiguous, stop and escalate rather than improvising.**

## 1. Goals and non-goals

Goals, in priority order:

1. **Never throws.** Any input (including empty, binary garbage, half-typed code, or pathologically nested constructs) produces a `ParseResult` with a best-effort AST + diagnostics. See §5.0 for the recursion-safety mandate this implies.
2. **Exact source fidelity.** Every node records precise character offsets; the source text itself is retained. Downstream tooling (Breakdown's text-patch engine, 3.3) computes minimal text edits from spans — the parser never re-prints code, so untouched text is byte-identical by construction.
3. **Graceful degradation.** Anything unparseable becomes an explicit `RawNode` covering its exact span, never silently dropped (per CLAUDE.md convention).
4. **Data-driven.** Command, attribute, directive, control-keyword, section, and predefined-label knowledge comes exclusively from `reference/data/language.json` — nothing hardcoded. Unverified entries (`"verified": false`) must degrade safely (§6).
5. **No false errors — or false warnings — on legal maps.** Error severity is reserved for constructs we are confident the engine rejects or mangles; warnings must be grounded in guide-verified or corpus-verified engine behavior. The corpus (11 real maps, ~123k tokens) is the regression suite for this goal: it contains live math expressions, float constants, 43-file include chains, and legal duplicate sections that rev 2 would have flagged spuriously.
6. **Fast enough for per-keystroke reparse**: full parse of `Vanguard_v1.2.rms` (366 KB, ~49.7k tokens — the corpus's largest file and the named benchmark; note line count does not predict token count) in low single-digit milliseconds (§9).

Non-goals: incremental parsing (full reparse is fast enough; the API is a pure function so incremental can be added later); evaluating conditionals, randoms, or math expressions (that's the preview generator's job — but see §2.2 for the semantics it must implement); resolving include-file contents (v1 records includes and softens symbol diagnostics, §7); semantic validation beyond structure (separate `validate()` pass, §8).

## 2. The RMS lexical model — the insight everything rests on

The game engine does not have a grammar in the usual sense. It reads the file as a **whitespace-separated token stream** and processes it linearly. Consequences that shape this whole design:

1. **Tokens are maximal runs of non-whitespace.** `{`, `}`, `/*`, `*/` are ordinary tokens and are only recognized when whitespace-delimited. `create_land{` is a *single unknown token*, not a command plus a brace. `/*comment*/` is one token, **not a comment** (guide-confirmed, with fixture strings: `/*this is NOT a comment*/`, `/*** ***/`, `/* this comment never ends */*`, `#this is NOT a comment`).
2. **Comments are a token-stream construct**: everything between a `/*` token and its matching `*/` token — **and they nest** (guide-confirmed: "the sub comment will not prematurely terminate the main comment"). An unclosed `/*` comments out the rest of the file.
3. **`if`/`start_random` are token-stream filters, not grammar.** The engine evaluates them *before* interpreting commands: inactive branches' tokens are simply deleted from the stream. Conditionals can legally split *anything* — guide Example2 (line 3244) is literally `if REGICIDE create_object KING else create_object SCOUT endif { … }`, which routes through §5.4's shared-block rule (info severity, never a warning). Our grammar-shaped AST is an *approximation* that holds for well-behaved scripts, with a defined fallback (§5.3). Corpus note (12-file snapshot): zero conditional/structure *interleavings* and zero conditional-wrapped section headers in ~123k tokens; exactly one mismatched closer — ForeDaut line 642 has a live stray extra `endif` in a working map, corpus proof that the engine tolerates it harmlessly (grounds RMS0106's warning severity; §12 fixture). The split-command idiom is guide-endorsed, so it is **first in line for structured handling in v1.x**.
4. **Two documented constructs span multiple tokens** and must be *assembled* during argument consumption, not lexing: math expressions (§2.2) and quoted include paths (§5.2). The lexer stays a pure splitter.

**Whitespace is pinned as the C `isspace` set: space, `\t`, `\n`, `\v`, `\f`, `\r` — nothing else.** Unicode space-lookalikes are NOT whitespace; a token containing any of this exact set gets warning `RMS0004`: U+00A0 (NBSP), U+1680, U+2000–U+200B, U+202F, U+205F, U+3000, U+FEFF (non-leading). A leading U+FEFF (BOM) becomes its own token (`kind: "word"`, `isTrivia: true` — it must be a token, or the §12 coverage property fails) with info `RMS0005`. (Corpus: zero occurrences of either — the lint is for pasted-from-web beginner files.)

**Case sensitivity:** all name lookups are case-sensitive exact matches. See §10 for the did-you-mean rules (`RMS0200`).

**Engine numeric truncation:** the engine reads a numeric argument's leading digits and ignores everything from the first non-numeric character (`1,5` → 1, `50%` → 50; guide-confirmed). Caveat: that guide text pre-dates the float updates — post-153015, `.` is consumed wherever floats parse (per-attribute, verify #13/#14); the truncation rule still holds for `,`, `%`, and other non-numeric characters. See RMS0212 in §6.

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

The lexer is a whitespace splitter plus this classification — **nothing more**. It does not know what a command or expression is. It never fails. `inf`/`-inf` remain `word` tokens; argument consumption gives them numeric meaning (§6). Predefined labels may start with digits (`1_PLAYER_GAME`) or be arbitrary `#define`d text — no lexer heuristic may treat digit-prefixed words as malformed numbers (that judgment happens in §6 with a predefined-label exemption).

Suspicious-token lint: **any non-trivia token of any kind** whose text *contains* (but does not equal) `{`, `}`, `/*`, or `*/` gets warning `RMS0003`, with both message variants: trailing glue (`create_land{` → "did you mean `create_land {`?") and leading glue (`}8050` → "did you mean `} 8050`?" — a live corpus specimen whose glued brace silently shifts every subsequent block boundary).

### §2.1 Token-ID aliasing quirks

Community-confirmed (the "RMS Equivalencies" spreadsheet, aok.heavengames thread fn=26&tn=42304): the engine resolves every word to an internal integer token ID, and **constants, raw numbers, and structural tokens share one ID space**:

1. **Terrain/object constants are just integers.** `create_object 32` ≡ `create_object SNOW` (→ Imperial-Age Monastery, ID collision). Bare numbers in constant positions are legitimate, working RMS.
2. **ID collisions across categories are silent** — our type diagnostics (§6) are *style* warnings about probable mistakes, never correctness claims.
3. **Words and numbers can alias structural tokens** (`MILL` can close a block). Out of scope for structural emulation in v1: such maps misparse into diagnostics + RawNodes, never crashes or dropped text. `ParseOptions.aliasTable` is the upgrade hook — import the Equivalencies data later as `reference/data/token-aliases.json` (fetch failed in-session: JS-rendered; import manually, spot-verify against DE — ⚠ verify #7).

### §2.2 Math expressions (Update 141935, April 2025) — NEW in rev 3

DE added in-script math. Guide-verified rules (the preview generator must implement these exactly; the parser only *assembles and lints*):

- An expression is delimited by parentheses **glued to its boundary operands**: `(A + 1)` is tokens `(A`, `+`, `1)`. Operators `+ - * / %` must be whitespace-separated tokens; an operator glued to an operand (`(A+1)`) is **not math** — it's one unknown word token.
- Evaluation is **strictly left-to-right — no precedence, no nested parentheses**. A nested `(` operand is silently not-a-number: the guide's own example `(GOLD_COUNT + (5 + 2))` yields 8, dropping `(5`. **The preview generator must NOT implement standard precedence out of habit.**
- Constants inside expressions resolve to their numeric values. `rnd(a,b)` is **invalid inside** an expression (a `#const` holding an rnd is fine). `inf`/`-inf` are native values (idiomatic flooring: `(5.9 % -inf)` → 5).
- Floats flow through expressions (since Update 153015); rounding to integer happens only where a float reaches an integer-only attribute, 0.5 rounds up. Values above 2²⁴ lose precision. Divide by 0 → 0. **`x % 0` → left operand truncated toward zero** (Summer 2025 Update, guide line 4550 — the guide's main math text "modulo 0 gives 0" pre-dates this and is stale). `%` semantics generally are truncation-toward-zero, not floor — the guide's own idiom `(-5.9 % -inf + 10)` → 5 only works with truncation (⚠ verify #18: negative-float modulo).
- Expressions work "almost anywhere a numeric input is accepted", including `#const` values. Float *acceptance* (as opposed to expression acceptance) is per-attribute reference data, not grammar (⚠ verify #14) — Update 153015 explicitly float-enabled `land_position`, `land_percent`, the four `*_border`s, and `circle_radius`.

Parser handling — assembly in argument consumption (§6), keeping the lexer pure:

- When the next candidate argument token's text **starts with `(`**, collect tokens until the terminator, producing one `ArgNode` with an expression value (operand/operator token-index list, unevaluated). **Terminator rule (pinned):** the first token whose text ends with `)` — *regardless of kind*, **except** canonical `rnd`-kind tokens, which never terminate (they are collected and draw the rnd-inside lint). A single token both starting `(` and ending `)` (e.g. `(5)`) is a one-token expression when it opens collection; when encountered *inside* collection it terminates (and draws the nested-paren lint). Multi-close tokens like `2))` terminate normally. The engine's own close-detection rule is unknown and is the real arbiter — ⚠ verify #15 covers these exact shapes.
- During collection the stop set is suspended, **except**: structural tokens (`{`, `}`, section headers, directive-kind tokens), control keywords, EOF, and a collection cap of 64 tokens. Hitting any of these means the expression is unclosed/degenerate: the collected tokens become a normal unknown-run (RawNode) with warning `RMS0208`, and the argument list terminates with `RMS0201`. (Conditionals *inside* an expression are engine-legal via token filtering but degrade to raw here — consistent with §5.3's philosophy.)
- Guide-verified expression lints, all warning severity, code `RMS0210` with specific messages: nested `(` operand ("the engine silently drops this operand"); operator glued to an operand inside an assembled expression; `rnd(…)` inside an expression; operand not glued to a bounding paren (`( A + 1 )` — the `(` alone is not a valid opener); **a trivia (comment) token inside the expression's token-index range** ("comments break math expressions — move the comment outside the parentheses"; guide line 3362 — without this check the comment pass runs first and assembly would silently accept `(A + /* x */ 1)`, which the engine rejects).
- Type checking: an expression satisfies any numeric slot. **A float satisfies an integer slot with no diagnostic** (the engine rounds — flagging it would be a false warning; corpus: Pa_Site's seven float `#const`s are working RMS).
- `#const`'s value slot accepts numbers (including floats), `rnd` tokens, and expressions. (`language.json`'s `value:integer` needs the §6.5 float-capable schema change.)

A word token starting with `rnd(` that fails the canonical regex (e.g. `rnd(1,` from `rnd(1, 5)` split by an interior space) gets a specific did-you-mean, warning `RMS0214` ("rnd() must contain no spaces") — without it, the split form yields only a baffling generic type mismatch.

Corpus reality check (recounted in the rev-4 critique): **45 live expressions across three files** — Pa_Site 35 (attribute arguments), Vanguard 7 (incl. the three identical `set_avoid_player_start_areas (PL_FOREST_MAX_DIST + 1)` lines), AD4 3 (**in `#const` value position** — a distinct assembly path that must be fixtured, §12) — plus Pa_Site's 7 float `#const`s. v1 needs *correct* handling, not *deep* handling, but expressions are not rare in advanced maps.

### Comment handling

After lexing, a **comment-span pass** walks the token array matching `commentOpen`/`commentClose` **with a nesting depth counter** and sets `isTrivia: true` on enclosed tokens and markers. `ParseOptions.nestedComments` defaults **`true`** (guide-confirmed DE behavior; rev 2 had this wrong). Comment text is not re-lexed. Unclosed `/*` (depth never returns to 0) → all remaining tokens become trivia + `RMS0001` at the outermost opener. Stray `*/` → `RMS0002`, treated as trivia. The guide's broken-comments strings are lexer test fixtures verbatim (§12).

Trivia ownership rule (for the patch engine): a comment belongs to the *next* non-trivia token (leading trivia); trailing comments at EOF attach to a virtual EOF position.

## 3. Parse result and API

```ts
// Pure function. No I/O, no globals, no exceptions.
function parseRms(source: string, lang: LanguageData, opts?: ParseOptions): ParseResult;

interface ParseOptions {
  nestedComments?: boolean;                        // default TRUE (guide-confirmed)
  aliasTable?: ReadonlyMap<string, TokenKind>;     // default empty (§2.1)
  maxNestingDepth?: number;                        // default 200 (§5.0)
}

interface ParseResult {
  source: string;
  tokens: Token[];           // ALL tokens including trivia, in order
  lineOffsets: number[];
  script: ScriptNode;
  symbols: SymbolInfo[];     // §7
  includes: IncludeInfo[];   // §7 — presence softens unknown-symbol diagnostics
  diagnostics: Diagnostic[]; // syntax-level only; validate() adds semantic ones
}

interface SymbolInfo {
  name: string;
  directiveKind: "define" | "const";
  nameToken: number;         // token index
  valueToken?: number;       // #const only (may reference an expression's first token)
  conditionalDepth: number;  // 0 = unconditionally defined; counts BOTH if-branches AND start_random
                             // branches (pinned — corpus-live: QS_Three_Bays `percent_chance 50 #define 7_RELICS`)
  undefineAttempted?: boolean; // a later #undefine names it — which does NOTHING in-engine (§7)
}

interface IncludeInfo {
  directiveToken: number;    // the #include_drs / #includeXS token
  path: string;              // assembled, quotes stripped if quoted
  quoted: boolean;
}

interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;              // §10
  message: string;           // beginner-first phrasing
  span: Span;
}

interface Span { start: number; end: number }
```

AST nodes reference tokens by index (`firstToken`/`lastToken`) and carry a derived `span`. Invariant: a node's span is exactly the range from its first to last token, including interior trivia, excluding exterior trivia.

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
  block?: BlockNode;         // for def.kind === "block", and for unknown commands followed by `{` (§5.4)
}

interface BlockNode { open: Token; close?: Token /* undefined = unclosed */; items: Item[] }

interface AttributeNode { kind: "attribute"; name: Token; def?: AttributeDef; args: ArgNode[] }

interface ArgNode {
  firstToken: number;        // like every other node — REQUIRED for multi-token args
  lastToken: number;         // (quoted paths, expressions); single-token args have first === last
  value: number              // includes floats; Infinity/-Infinity for inf/-inf words in numeric slots
       | { rnd: [number, number] }
       | { expr: { tokens: number[] } }   // §2.2 — token indices, unevaluated
       | string;             // constant/label reference (quoted paths: assembled, quotes stripped)
  def?: ArgumentDef;
}
// Rev 5: ArgNode previously had a single `token` field — a quote-assembled include path's interior
// tokens were then reachable from no AST field, breaking both the §12 coverage property and the
// Phase-3.3 patch engine (which needs the span to replace when Breakdown edits any argument).

interface DirectiveNode {
  kind: "directive";
  hash: Token;               // the "#..." token; its text is the directive name
  def?: DirectiveDef;        // from language.json directives[]; undefined = unknown (RMS0206)
  args: ArgNode[];           // per def.arguments (§5.2); may be short at EOF (RMS0201)
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

interface OrphanBlockNode { kind: "orphanBlock"; block: BlockNode }  // §5.4

interface RawNode { kind: "raw"; reason: string; /* + firstToken/lastToken/span like all nodes */ }
// RawNode has NO children — an opaque, exactly-spanned token range.
```

**Name lookup order (pinned):** inside a `BlockNode` → attribute lookup first, then command; at statement level → command first, then attribute. A cross-category hit parses normally as its actual category and gets warning `RMS0207` with a beginner-first message ("`number_of_tiles` is an attribute — it belongs inside a `{ }` block"). Dual-use names (`base_terrain`, `base_layer`) resolve to the context-native category silently — no RMS0207.

Directive surface (matching the guide's Non-Functional Syntax appendix and 100% of corpus usage): the *functional* directives are exactly `#define`, `#const`, `#include_drs`, `#includeXS`. `#undefine` and `#include` exist as engine strings but **do nothing** — they parse as known DirectiveNodes whose defs are flagged non-functional (§6.5), with an info diagnostic ("#undefine has no effect in DE — the flag stays defined"). The `#ifdef` family does not exist in DE (not in the guide, not in the exe string dump) — **remove those entries from language.json** (§6.5); after removal they naturally hit RMS0206 like any unknown directive.

## 5. Parsing strategy

### 5.0 Recursion safety (goal #1 enforcement)

Single pass over the non-trivia token stream with a context stack. **Implementation must not be able to blow the JS call stack**: either iterate with an explicit stack (preferred), or enforce `opts.maxNestingDepth` (default 200) — on exceeding it, the innermost construct degrades via §5.3 with warning `RMS0107`. The fuzz suite includes a 20k-token `if if if …` case that must complete without throwing. (Corpus note: 8-way `elseif` chains *inside* `create_land` blocks are normal real style — nesting is not exotic, only unbounded nesting is.)

### 5.1 Dispatch

Per non-trivia token, in order of precedence:

1. `sectionHeader` →
   - If a `{` block is open: force-close it with error `RMS0103` (⚠ verify #9), then start the new section.
   - If an `if`/`random` is open: **legal RMS** (token-filter model) — route to §5.3 degradation (info `RMS0110`), never an error. Section headers *inside* the degraded span do not create SectionNodes; the RawNode lives in the section where it began. (⚠ verify #8; corpus: zero occurrences.) Referenced elsewhere as "§5.1 dispatch item 1".
   - Otherwise: new SectionNode; `known` from `sections[]`; unknown names kept with warning `RMS0100`.
2. `directive` → resolve against `directives[]` (exact match, full token text). Known: consume args per §6 (directive defs carry `verified` flags; §6 severity capping applies), with **quote assembly** for filename-typed args: a token starting with `"` joins subsequent tokens until the first token ending with `"` (one IncludeInfo, `quoted: true`), **capped at 64 tokens** like expression assembly; unclosed quote or cap hit → collected tokens degrade to unknown-run + warning `RMS0209`. Quoted path on `#includeXS` → warning `RMS0211` (guide-documented engine bug: it rejects quotes). Truncation at EOF → `RMS0201`, node kept. Unknown directive → warning `RMS0206`, zero args consumed.
3. `if` / `start_random` (matched against `controlKeywords[]`) → push structured node; `elseif`/`else`/`percent_chance` switch branches; `endif`/`end_random` pop. Tokens before the first `percent_chance` → `RandomNode.preamble` + warning `RMS0106`. Mismatched keywords → warning `RMS0106`, absorbed into the pending unknown-run (see the coverage rule below; corpus-real fixture: ForeDaut's stray fourth `endif`, line 642). **Nested `start_random` inside `start_random`**: parse structurally (lossless) + warning `RMS0213`, message borrowing the guide's own fix (line 3009): "use a first random block to #define which additional random block to run".
   **Control-keyword operand consumption (pinned):** `if`/`elseif` consume exactly one token as the condition, of any non-structural kind (labels are arbitrary text, incl. digit-leading — no RMS0212); if the next token is structural (brace/section header/directive/control keyword), the condition is left undefined + warning `RMS0106` variant ("if without a condition"). `percent_chance` consumes one numeric operand; **expression and rnd assembly are active in that slot** (engine accepts math "almost anywhere a numeric input is accepted"; ⚠ verify #4 covers both). Data-drivenness (goal #4): add `arguments[]` to the controlKeywords schema (§13) so these arities live in language.json like everything else — until then this paragraph is the pinned exception.
4. `word` → command or attribute per §4's pinned lookup order: resolve, consume arguments (§6), then attach a BlockNode if next token is `openBrace` and def is block-kind or unknown (§5.4). Cross-category hit → `RMS0207`.
5. `openBrace` with no attachable predecessor → §5.4.
6. `closeBrace` at top level → warning `RMS0104`, absorbed into the pending unknown-run.
7. `number` / `rnd` where a statement was expected → pending unknown-run, diagnostic `RMS0215` ("unexpected value — a statement was expected here"; RMS0200's "unknown command" wording doesn't fit `10000`).

**Unknown-token runs:** consecutive tokens that can't start a statement collapse into a *single* RawNode with *one* diagnostic. (Corpus validation: OWWC's mangled `number of clumps 10000` and two files' un-commented trailing prose produce exactly one useful diagnostic each — these warnings catch *real silent map bugs*.)

**Coverage rule — no token is ever dropped:** "skipped" is not an AST outcome. Every rejected token (stray `}`, mismatched control keyword, etc.) joins the pending unknown-run RawNode (opening one if none is pending); its diagnostic attaches to the token's own span. This is what makes §12's coverage property ("every non-trivia token reachable from exactly one AST node") satisfiable by construction.

**Cascade suppression:** when a block contains a token already flagged `RMS0003` involving a glued `{`/`}` (or is unclosed at its section/EOF boundary), wrong-context diagnostics (`RMS0207`) for items inside it collapse into a single summary diagnostic ("N more commands appear inside this block — likely caused by the missing space in `}8050` above"). Rationale: BCC2's one glued brace would otherwise draw dozens of RMS0207s; one typo must not produce fifty warnings in a beginner-facing editor. The items still parse normally — only the *diagnostics* are collapsed.

### 5.2 Unclosed constructs at EOF

Unclosed `{` at EOF → error `RMS0101` — **⚠ verify #6 is now the single highest-priority in-game check**: corpus file `BCC2-Rekawa_Capt_Knip_edit.rms` reaches EOF at brace depth 1 (via the `}8050` glued token) and reportedly generates; if DE confirms, RMS0101 downgrades to warning. Unclosed `if`/`start_random` at EOF → warning `RMS0105` (⚠ verify #12).

### 5.3 Degradation: when conditionals cut across structure

Trigger cases: a closer arrives while a structurally deeper construct is still open (`endif` with an open `{` inside the branch); the mirror (`}` while an `if` opened inside the block is open); interleaved non-nested overlap; conditionals spanning section headers (§5.1 dispatch item 1); nesting-depth cap (§5.0).

Mechanism, uniform: compute the **minimal token range covering every construct involved in the imbalance** — and this range extends **forward as well as backward**: after detecting the imbalance, continue consuming until every involved construct's closer has arrived (`}` and/or `endif`/`end_random`), bounded by section header / EOF (at which point RMS0101/0103/0105 apply as usual). Then discard partial nodes for the whole range and emit one `RawNode` with **one** info `RMS0110` ("this code mixes if/random with command structure in a way that must be shown as raw code — it is valid RMS"). Resume normally after the range. Without the forward extension, the construct's trailing closer would arrive orphaned and fire a spurious RMS0104/0106 warning — breaking the one-diagnostic promise on legal RMS (both trailing-closer shapes are §12 fixtures). Wrap-and-discard over a bounded range: each token still reprocessed at most once — amortized linear, no grammar backtracking.

**Symbols and includes survive degradation.** `SymbolInfo` and `IncludeInfo` collection is a token-stream concern (mirroring the engine, which processes directives regardless of surrounding structure), NOT an AST concern: a `#const` or `#include_drs` inside a range later wrapped into a RawNode keeps its entry in `ParseResult.symbols`/`includes` (its `conditionalDepth` reflecting where it sat). Without this rule, every later reference to such a symbol would draw a false unknown-symbol warning from `validate()` — a goal-#5 leak through the back door.

v1.x follow-up, in priority order (do not implement in 2.3): (1) the guide-endorsed "conditional selects the command, shared block follows" idiom (`if REGICIDE create_object KING else create_object SCOUT endif { … }`) — structured handling; (2) whole-section conditional wrapping — only if corpus triage ever shows it in the wild (currently zero occurrences).

### 5.4 Orphan, unknown-command, and shared blocks

- Unknown word(s) followed by `{`: upgrade the *first* word of the pending unknown-run to a `CommandNode` (def undefined, `RMS0200`), remaining run tokens become def-less `args`, block attaches. (`craete_land { … }` renders block-shaped with a typo'd name, not raw soup.)
- **Shared-block rule (rev 5 — the flagship idiom's real path):** `{` arriving immediately after a *just-completed* `IfNode`/`RandomNode` in which at least one branch's last item is a block-capable `CommandNode` without a block (def block-kind or unknown) → `OrphanBlockNode` + **info `RMS0110`** with the variant message "this block is shared by the command(s) chosen in the if/random above — shown as a separate block". This is guide Example2 (`if REGICIDE create_object KING else create_object SCOUT endif { … }`, line 3244): tracing plain dispatch, the `endif` pops cleanly (no imbalance, §5.3 never triggers) and the `{` would otherwise land on the next rule's warning — a false warning on the exact construct this spec cites as guide-endorsed idiom. The contents still parse as block items; only severity and message differ from the plain orphan case. Example2 verbatim is a required §12 fixture.
- `{` with no pending run, no block-capable predecessor, and no shared-block lookbehind match: `OrphanBlockNode` + warning `RMS0102`; contents ARE parsed as block-context items.

## 6. Argument consumption — the data-quality firewall

**Stop set** (never consumed as an argument; encountering one mid-list stops consumption with `RMS0201` too-few-arguments): `openBrace`, `closeBrace`, `sectionHeader`, any `directive`-kind token, the seven `controlKeywords[]` names, EOF, and **any `word` resolving to a known command OR attribute name — in either context** (symmetric on purpose: an overstated-arity attribute must not silently eat a following wrong-context command any more than the reverse). This rule is what makes overstated arity in unverified data self-limiting. (Known limitation: a `#define`'d constant sharing a command/attribute name stops consumption early — spurious `RMS0201`, no cascade; constants are conventionally ALL_CAPS so real collisions are negligible.) The stop set is suspended inside expression/quote assembly per §2.2/§5.2, except structural tokens, control keywords, and the caps.

Rules:

1. **Known + verified def:** consume up to `def.arguments.length` non-stop-set tokens (honoring `optional`/`variadic` flags once the schema supports them, §6.5). Type checks: `integer`/`percent`/`flag` accept `number` (including floats — **no diagnostic for float-into-integer**, the engine rounds), `rnd`, expressions, `inf`/`-inf` words, **and any word naming a symbol already defined above the use (amendment, below)**; `terrainConstant`/`objectConstant`/`otherConstant`/`string` accept `word` **or `number`** (bare numeric IDs are legitimate per §2.1). Mismatches → warning `RMS0202`/`RMS0203` on that ArgNode; token still consumed.
2. **Known + unverified def:** same mechanics; arity/type/range diagnostics capped at *info*, worded "…according to unverified reference data". (This category shrinks substantially once the §6.5 language.json cleanup lands — the full guide is now archived locally.)
3. **Unknown name:** consume zero arguments; `RMS0200`; following tokens → unknown-run / §5.4.

**Digit-prefixed word lint (`RMS0212`, warning):** a `word` token starting with digits, **only in an argument slot whose declared type is numeric (`integer`/`percent`/`flag`)** — exactly and only where the engine's leading-digits truncation applies (e.g. `50%`, `1,5` → "the engine reads this as 50 and ignores the rest"). **Never in name slots, constant slots, or condition positions**: digit-leading user labels are legal, working, and common — 8 of 11 corpus maps `#define` names like `2V1` (`if TEAM1_SIZE2 #define 2V1 endif`, ForeDaut; also Hourglass, Six_Points, BCC2, Menindee, OWWC `2_CROSSINGS`, QS_Three_Bays `7_RELICS`, TC2 `3_VILL_START` — rev 5 corrected the count from an earlier "5 of 11"). Rev 3 scoped this lint by exemption lists (predefined labels, if-conditions); that was the wrong shape — it missed `#define`'s name slot and would have false-warned on the spec's own corpus. Scoping by declared argument type needs no exemption list at all.

**Amendment (post-3.4, live-testing feedback from Ash) — user constants satisfy numeric slots.** The rule above originally admitted only numbers/rnd/expressions/`inf` into `integer`/`percent`/`flag` slots. That warned on the single most common RMS idiom there is:

```
#const PL_LANDS_CLUMPING_FAC 15
create_land { clumping_factor PL_LANDS_CLUMPING_FAC land_position 74 26 }
```

— a goal-#5 violation (false warnings on legal maps). Resolution is **symbol-table-aware, not type-aware**: at the point of consumption, if the word names a `#const`/`#define` **already seen in this parse**, no diagnostic is emitted at all.

- **"Already seen" is the engine's rule, not a single-pass limitation.** The guide (line 148) states a definition "will only be true if [it is] defined higher up in the file … regardless of the section header", so a constant used *above* its `#const` genuinely does not resolve in-engine, and warning there is correct. A symbol-collecting pre-pass would make us *less* accurate.
- **Permissive about kind:** `#define` (a bare flag) counts as well as `#const`. Flagging a flag-in-a-numeric-slot risks a false warning, and §2.1 pins that our type diagnostics are style warnings, never correctness claims. If it is worth reporting, it belongs in `validate()` (§8), which sees the whole symbol table at once.
- **Unresolvable names** keep `RMS0202`, but with a message naming the real problem (the name is undefined, suggest `#const`) rather than "wrong type" — and **softened to info when the file has any `#include_drs`** (§7's rule: the name may be defined in an include we cannot read; Pa_Site's 40 such warnings all become info).
- Implementation: `Parser.isDefinedSymbol()`, consulted in `consumeOneArg`. Once `predefinedLabels` lands (§13 item 3), engine-provided names must count as defined here too.

**Related data fix — `#const`'s value slot is `otherConstant`, not `integer`.** Guide L3295/L3353/L3306: everything in the game *is* a number internally, constants are read as numbers "where numeric inputs are expected", and one item may carry several constants — so `#const PREDATOR_A WOLF` is exactly `#const PREDATOR_A 3`. Typing the slot `integer` rejected that idiom (155 false warnings in `Rage Forest 2026.rms` alone). `otherConstant` accepts word or number, and expression/`rnd`/number handling is ungated by argument type (`consumeOneArg` dispatches expressions on a leading `(` before any type check), so `#const X (A * B)` and `#const X rnd(1,5)` are unaffected — asserted by fixtures.

**Known remaining RMS0202 noise** (corpus-measured: **61 warnings + 45 info across 52 files**, in only 3 files; tracked in `docs/known-issues.md` BUG-002): undefined words used deliberately as opaque identifiers (`actor_area ACT_AREA_TEAM_RES_TERRAIN` ×26 in a shipped map — legal via §2.1's token-ID model, and evidence that `integer` wrongly conflates "a magnitude" with "an identifier"); and unmodeled `$`-prefixed names (×35, in both a DE-official and a community map, so it is supported syntax we don't yet model).

**The fuller rule, not yet implemented.** L3353 licenses *any* known constant — user-defined **or predefined** — to satisfy *any* numeric slot. The amendment above covers user-defined symbols only, because the parser cannot currently see `game-constants.json` (`parseRms(source, lang)` takes language data alone). Closing that gap means either passing constants into the parser or landing `predefinedLabels` (§13 item 3); until then, a *predefined* constant in a numeric slot outside `#const` would still warn. The corpus shows no such case today.

**ID-resolution message gating (RMS0204/RMS0205):** resolved-ID wording ("32 = SNOW…", "SNOW in an object slot = Monastery. Intended?") only when the game-constants entry carries verified provenance (`idSource: "extracted"` or patch-note-sourced); generic wording otherwise. Current constants are all placeholders.

## 7. Symbol table and includes

Collected during the parse: every `#define`/`#const` with token index and *conditional depth* (0 = unconditional). `#undefine` sets `undefineAttempted` on the matching symbol **but the symbol remains defined** — `#undefine` is non-functional in DE (guide's exe-dump appendix); `validate()` must not treat undefined-later symbols as removed, and the DirectiveNode gets an info diagnostic saying so.

`ParseResult.includes` records every `#include_drs`/`#includeXS` (path, quoted flag). **When any include is present, `validate()`'s unknown-symbol diagnostics degrade to info** ("may be defined in an include file — Age of RMS cannot see inside includes yet"): corpus file Pa_Site pulls 43 includes and references dozens of their constants; without this rule it drowns in false warnings. Also record in corpus triage that include-dependent maps cannot generate standalone. Future hook: `ValidateOptions.resolvedIncludes` for supplying include sources — out of scope v1. Note: `random_map.def` is implicitly included in every map and defines all predefined constants — it is the authoritative source for `predefinedLabels` and for hover docs on names like `GOLD`/`RELIC`.

Predefined engine labels come from a `predefinedLabels` array in `language.json` — **action item (§6.5), now fully sourceable** from the guide's Conditionals section: game modes, legacy sizes (TINY_MAP…LUDIKRIS_MAP), modern sizes (MAPSIZE_MINI…MAPSIZE_LUDICROUS), resource levels, starting ages, lobby settings (FIXED_POSITIONS, …, ANTIQUITY_MODE), player/team counts (1_PLAYER_GAME…, TEAMx_SIZEy, PLAYERx_TEAMy), and version detection (DE_AVAILABLE, …). Schema note: labels may start with digits. The guide's Map Sizes table (dimensions + area ratios, MINI 80×80/0.6 … LUDICROUS 480×480/23.0) feeds both this and the generation-settings pane.

## 8. validate() — separate semantic pass

`validate(result: ParseResult, refDb, opts?): Diagnostic[]`, run after parse. Checks:

- Unknown constants vs symbol table + game-constants DB + `predefinedLabels` — softened to info when includes are present (§7); conditionally-defined symbols get info-level notes (idiomatic). Message wording borrows the guide: the engine "ignores it or substitutes the most recent valid identifier and keeps going" — which is why such maps still generate.
- Duplicate `#const` definition: **first definition wins in-engine** (guide-confirmed — this answers old verify #5). Warning when both definitions are unconditional; info when either is inside a conditional (exclusive-branch redefinition, as in Pa_Site's if/elseif chains, is legitimate runtime behavior — only one branch's tokens survive).
- Cross-category constant use (`RMS0205`) and bare-ID style notes (`RMS0204`), gated per §6.
- Wrong-section placement (command's `def.section` vs enclosing section — warning). Missing `<PLAYER_SETUP>` — info. Duplicate sections: **no diagnostic** (legal, §4).
- Duplicate attribute within one command block — **split by repeatability** (guide-documented: `spacing_to_specific_terrain`, `replace_terrain` ["can, and should, be used multiple times"], `terrain_cost`, and connection radius attributes are *cumulative*; every corpus connection block repeats them legally): attributes flagged `repeatable` in language.json get NO last-wins note; non-repeatable attributes get the info note ("the engine uses the last one"). **The rev-4 `maxRepeats: 4` claim for spacing_to_specific_terrain is withdrawn** — the guide (lines 1553–1573) documents no cap (its example merely has four lines); REVISION_3 attributed a 4-use cap to Update 153015's notes, so re-check that patch note before ever setting `maxRepeats`; shipping an unsourced cap would itself be a goal-#5 violation. **Breakdown consequence (pinned): repeatable attributes are a list in the block UI — an edit must never collapse them to one.** Rev 3's blanket last-wins rule would have made Breakdown corrupt every connection block it touched.
- Shadowing a predefined name: `#const GOLD 123` is a **silent no-op in-engine** (first-definition-wins, and `random_map.def` defined it first) — warning, high-value for beginners. Data arrives with `predefinedLabels` + the constants DB; check every user `#define`/`#const` name against it.
- **Use-before-definition** (guide line 148: definitions "will only be true if they are defined higher up in the file … regardless of the section header"): flag references whose token index precedes the definition's — warning (the engine silently ignores-or-substitutes per line 173, i.e. a silent map bug); include-softened to info as usual.
- **Mutual exclusion**: attributes/commands whose defs carry `mutexWith` (already live in language.json: `place_on_forest_zone`/`avoid_forest_zone`) both present in the same block/section — warning. (Rev 5: this data existed but nothing consumed it.)
- **Wrong-section suppression after degraded headers**: after a §5.3 RawNode whose token range contains a `sectionHeader` token, suppress wrong-section diagnostics until the next real SectionNode — parsing resumes in the *old* section while the engine would be in the *new* one, and every downstream item would otherwise false-warn.
- `percent_chance` lints (guide-sourced): branches after the cumulative 99% are unreachable (warning); total <100 leaves a no-branch chance (info — often intentional); `percent_chance 0` on the first branch (warning — engine bug); `rnd(max ≤ min)` (warning).
- `effect_percent` deprecation (obsolete per Update 141935) — info.
- Non-functional syntax: uses of `#undefine`/`#include` (info, "has no effect in DE").

## 9. Performance

Lexing one linear scan; parsing one linear pass, amortized linear including §5.3 reprocessing. **Benchmark file: `Vanguard_v1.2.rms`** (366 KB, ~49.7k tokens). Budget: low single-digit ms; Vitest benchmark threshold set **10× the observed local time** (flake-resistant on shared CI runners) — it exists to catch complexity regressions, not to measure. No regex in the hot loop except precompiled classifiers; tokens as plain monomorphic objects. Run in a web worker per CREATION_PLAN 2.4. (Engine trivia for author-facing docs: DE itself stalls seconds on >1 MB maps.)

## 10. Diagnostic codes

| Code | Sev | Meaning |
|---|---|---|
| RMS0001 | warning | Unclosed `/*` (nesting-aware) — rest of file is a comment |
| RMS0002 | warning | `*/` without matching `/*` |
| RMS0003 | warning | Token contains embedded `{ } /* */` — missing whitespace (leading- and trailing-glue message variants) |
| RMS0004 | warning | Non-standard space character (NBSP etc.) inside a token |
| RMS0005 | info | Leading byte-order mark (emitted as a trivia token; has no effect) |
| RMS0100 | warning | Unknown section header |
| RMS0101 | error | Unclosed `{` at EOF (⚠ verify #6 — live corpus specimen suggests downgrade) |
| RMS0102 | warning | `{` with nothing to attach to (OrphanBlockNode) |
| RMS0103 | error | Section header while `{` open — block force-closed (⚠ verify #9) |
| RMS0104 | warning | Stray `}` |
| RMS0105 | warning | Unclosed `if` / `start_random` at EOF (⚠ verify #12) |
| RMS0106 | warning | Control keyword in wrong context / tokens before first `percent_chance` |
| RMS0107 | warning | Nesting deeper than maxNestingDepth — shown as raw code |
| RMS0110 | info | Conditional interleaves with command/block/section structure — shown as raw code (valid RMS) |
| RMS0200 | warning | Unknown command/attribute name, with did-you-mean (below) |
| RMS0201 | warning/info† | Too few arguments (incl. stop-set/assembly early termination) |
| RMS0202 | warning/info† | Argument type mismatch |
| RMS0203 | warning/info† | Argument out of documented range |
| RMS0204 | info | Bare numeric ID where a named constant exists (ID wording gated, §6) |
| RMS0205 | warning | Cross-category constant use (ID wording gated, §6) |
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
| RMS0217 | warning | Value is valid RMS but reference data flags a caution for it (e.g. a negative border risking a land-origin-off-map crash) — distinct from RMS0203: NOT a min/max violation, message must say the value is valid |

† info when the underlying language.json entry is `"verified": false` (§6.2).

**RMS0217, added post-spec (2.4 bug-fix session, live-testing feedback from Ash):** not part of the original numbered list above it — logged here as an amendment rather than folded silently into the table. Driven by two new optional `ArgumentDef` fields, `cautionBelow`/`cautionMessage` (schema in `reference/schemas/language.schema.json`), checked in `consumeOneArg` only once the existing min/max check has passed (so it never double-fires with RMS0203). Currently used by the four border attributes (`left_border`/`right_border`/`top_border`/`bottom_border`, `cautionBelow: 0`) to flag that a negative border, while valid RMS, can crash the game if it pushes the land origin off-map. `cautionMessage` also renders in the Monaco hover popup (`src/editor/aoe2RmsHover.ts`) so the warning is visible before a risky value is even typed — hover does NOT render the generic `notes` field (too much internal/maintainer-facing text lives there); `cautionMessage` is the deliberate user-facing channel.

**Did-you-mean (RMS0200):** two heuristics against known names of the context's category — (1) edit distance ≤ 2 (catches corpus-real `enable_balanced_elavation` → `elevation`, and case-only mismatches like `Create_Land`); (2) suffix/substring match (catches corpus-real `avoidance_distance` → `other_zone_avoidance_distance`, edit distance 11). Both are cheap at these vocabulary sizes.

Messages must be beginner-first: what's wrong *and what to do*. Error severity is a strong claim (goal #5): only RMS0101 and RMS0103 carry it, both pinned to verify items.

## 11. Verify-in-game checklist

Five of rev 2's twelve items were answered by the full guide (recorded below); the in-game session is now short. Test each open item with a trivial map; record answers here.

**Answered (guide-confirmed, no game session needed):**

1. ~~Comment nesting~~ — **DE comments NEST** (`nestedComments` defaults true; spot-check if paranoid).
2. ~~Glued markers~~ — confirmed not comments; guide's broken-comments strings are fixtures.
3. ~~Conditional splitting command from block~~ — **legal AND idiomatic** (guide Example2); RMS0110 info confirmed; first in the v1.x structuring queue.
5. ~~`#const` redefinition~~ — first definition wins; predefined names can't be re-defined; exclusive-branch redefinition fine → validate() rule in §8.
11. ~~`#ifdef` family~~ — does not exist in DE; remove from language.json. `#undefine`/`#include` exist as strings but do nothing.

**Open:**

4. `rnd(a,b)` in every numeric slot — narrowed: `percent_chance rnd(…)` is the case worth testing (guide doesn't enumerate).
6. **Unclosed `{` at EOF — TOP PRIORITY**: does BCC2 (live specimen, brace depth 1 at EOF via `}8050`) actually generate? If yes, RMS0101 → warning.
7. §2.1 aliasing in DE (`create_object 32` → Monastery? MILL closes a block?) — gates `token-aliases.json` import.
8. Conditionals spanning section headers — engine accepts? (Grounds §5.1 dispatch item 1; zero corpus occurrences.)
9. `{` block left open across a section header — engine behavior? (Grounds RMS0103's error severity.)
10. NBSP/unicode spaces and BOM — engine tokenization?
12. Unclosed `if`/`start_random` at EOF — silently fine? (Grounds RMS0105 warning.)
13. Float literal forms — `.5` without leading zero? Scientific notation? (Pins the number-token regex.)
14. Where exactly are floats *rejected*? (Float acceptance is per-attribute reference data — calibrate with one or two rejection cases, e.g. `create_elevation` height, `percent_chance`.)
15. Expression edges: unclosed `(A +` at EOF; spaced operands `( A + 1 )`; glued operator `(A+1)`; **the engine's own close-detection rule** — interior `rnd(1,5)`, interior `(5)`, multi-close `2))`, comment inside parens. (Grounds RMS0208/0210 severities and §2.2's terminator pin.)
16. Quoted `#include_drs` path with spaces works? `#includeXS` genuinely rejects quotes? (Grounds RMS0209/0211.)
17. Does `rnd(0.5,1.5)` (float bounds) work post-141935? (Pins the rnd token regex; if yes, widen it — currently float bounds lex as `word` and would draw a false RMS0202/0214.)
18. Negative-float modulo: is `%` truncation-toward-zero for all operand signs? (Grounds §2.2's semantics pin — the guide's floor-vs-truncate wording is internally inconsistent; the preview generator implements whatever this test shows.)

## 12. Test plan

**Lexer (2.2):** every TokenKind incl. float numbers; offset exactness (`source.slice(start,end) === text` — property assert over corpus); rnd classification incl. negatives; RMS0003 both glue variants (incl. the corpus-real `}8050`); RMS0004 NBSP; BOM; **nested comments** (depth 2+, unclosed-at-depth, and the guide's full fixture-string set verbatim, lines 2936–2943: `/*this is NOT a comment*/`, `/*** ***/`, `/* never ends */*`, `/* this comment never ends*/`, `#this is NOT a comment`, `// this is NOT a comment` [→ RMS0216], the triple-backtick string); CRLF vs LF; empty file; one-giant-token file.

**Parser (2.3), unit:** every §5 production; one test per §10 code asserting diagnostic + recovery shape; dual-use `base_terrain` by context; §4 lookup-order/RMS0207 cases (attribute at top level, block command in block); if/random nesting incl. corpus-style 8-way elseif chains inside blocks; nested `start_random` → RMS0213 + lossless structure; §5.3 degradation set (split block, mirror case, interleave, conditional-wrapped section header → info not error); §5.4 orphan/upgrade; stop-set early termination (overstated unverified arity must not eat a following attribute); unknown-run collapsing; unverified severity capping; RMS0204/0205 gating; directives: truncated `#const`, unknown directive, **quoted `#include_drs` path** (multi-token, `../`, all four extensions), unclosed quote → RMS0209, quoted `#includeXS` → RMS0211; **expressions**: the three Vanguard `set_avoid_player_start_areas` lines verbatim, AD4's `#const MAPAREA (MAPSIZE * MAPSIZE)` verbatim (**directive-value expression assembly — distinct code path**), a Pa_Site attribute-arg expression, Pa_Site float `#const`s verbatim, `(5)` single-token, nested-paren lint, glued-operator lint, `rnd`-inside lint, unglued-operand lint, unclosed `(A +` at EOF → RMS0208, expression terminated by `{`/keyword; `inf`/`-inf` args; malformed rnd → RMS0214 (`rnd(1,` + `5)`); **RMS0212 scope regression tests**: `#define 2V1` and `if 2V1` must produce NO diagnostic (live in 5 corpus maps), `land_percent 50%` must warn; repeatable attributes: a corpus connection block with repeated `replace_terrain`/`terrain_cost` must produce NO duplicate-attribute note; cascade suppression: reduced BCC2 fixture asserting ONE summary RMS0207, not dozens; **guide Example2 verbatim** (`if REGICIDE create_object KING else create_object SCOUT endif { … }` → shared-block RMS0110 info, NOT RMS0102); both §5.3 trailing-closer shapes (`endif`-with-open-brace and the mirror — exactly one RMS0110, no trailing RMS0104/0106); comment-inside-expression → RMS0210 variant; `percent_chance (X + 1)` and `percent_chance rnd(1,3)`; numeric-first-operand expressions (Pa_Site lines 721–722, `(24 …`/`(12 …`); corpus-derived micro-fixtures: `number of clumps` unknown-run (RMS0215), ForeDaut's stray fourth `endif` (line 642 → RMS0106, absorbed, working map), QS_Three_Bays `percent_chance 50 #define 7_RELICS` (conditionalDepth counts random branches; no RMS0212), `min_distance_cliffs 6 minimum distance…` trailing prose, `elavation` edit-distance did-you-mean, `avoidance_distance` suffix-match did-you-mean, AK_Six_Points' live stray `*/` (line 1893 — RMS0002 on a real working map; the corpus is NOT comment-clean).

**Corpus (2.3):** `test-maps/*.rms` must parse with **zero error-severity diagnostics** and satisfy two properties, with **ownership defined** (rev 5 — "reachable" was previously undefined): a token's *owner* is the deepest AST node whose `[firstToken, lastToken]` range contains its index. (a) **coverage** — every non-whitespace char inside exactly one token; every non-trivia token has an owner, and node ranges are well-nested (children within parents, sibling ranges disjoint); (b) **span fidelity** — every node's span starts/ends with its first/last token's text. Non-negotiable CI gates (patch-engine foundation). **Escape hatch:** `test-maps/broken/` is excluded from the zero-error gate but included in coverage/fidelity/no-throw — for real maps with real defects kept as regression fixtures. BCC2 (now `BCC2-Rekawa.rms` — the spec's earlier `_Capt_Knip_edit` filename is stale) goes there unless Ash fixes `}8050` in the map (fixing is fine, but keep a reduced glued-brace-cascade fixture either way). Optional refinement: per-file expected-diagnostics annotations (`.expected.json`) if broken/ grows. **Corpus growth note (rev 5):** the corpus is now ~52 files including DE-official base maps — those stay in gitignored `test-maps/local/` until redistribution is resolved; all snapshot statistics in this spec describe the 12-file set REVISION_5 verified, and the gate simply applies to whatever is present (triage protocol per map still applies before a file counts).

**Fuzz-lite:** ~1k iterations of random token soup (words/braces/keywords/numbers/directives/paren-glued fragments) + the 20k-nested-`if` case → no throw; coverage, span fidelity, and node-span non-overlap (siblings never overlap; children strictly within parents).

**Corpus triage protocol** (per map, before it counts toward the gate): confirm it generates in current DE; parse; triage every diagnostic as real-map-issue or parser/data bug. Record: include-dependent maps that can't generate standalone (Pa_Site); any conditional-wrapped section headers (feeds §5.3 v1.x priority).

## 13. Reference-data and schema action items (consolidated)

1. **language.json `"verified": false` cleanup is UNBLOCKED** — the complete guide is archived at `reference-docs/definitive-rms-guide-2026-07-16.txt` (the Phase 1.5 fetch had truncated at ~2,464/5,898 lines). Fill argument shapes for TERRAIN/CONNECTION/OBJECTS_GENERATION from it.
2. **Remove the `#ifdef`/`#ifndef`/`#else`/`#endif` directive entries** (don't exist in DE). **Flag `#undefine` and `#include` non-functional** (schema flag or notes) — hover docs should say so.
3. **Add `predefinedLabels`** per §7 (guide Conditionals section + Map Sizes table; include `ANTIQUITY_MODE`; labels may start with digits; `random_map.def` is the authoritative in-engine source).
4. Schema: float-capable numeric type (or `"float": true` per-argument — float acceptance is per-attribute data per verify #14); `optional`/`variadic` flags (rev 2); **`repeatable: true` on cumulative attributes** (`spacing_to_specific_terrain`, `replace_terrain`, `terrain_cost`, connection radius attrs — source from the guide) with `maxRepeats` **only if re-checking Update 153015's notes confirms the 4-use cap REVISION_3 reported** (the guide has no cap; an unsourced cap would false-warn) — wired to §8's duplicate-attribute rule and Breakdown's list rendering; **`arguments[]` on controlKeywords entries** (percent_chance's numeric operand, if/elseif's label — replaces §5.1's pinned exception per goal #4); `mutexWith` is now consumed by §8's mutual-exclusion check (was dead data); `idSource` provenance on game-constants (rev 2).
5. Do **NOT** add `avoidance_distance` — resolved as a Pa_Site author bug for `other_zone_avoidance_distance` (full-guide check: absent from both the reference and the exe string dump).
6. `land_conformity` notes should carry the guide's warning that it misbehaves and may change.
7. Game-constants cross-check sources for Phase 4.0: patch notes 141935/153015/169123 carry dated real IDs (terrains 113–130, cliff types 4–5, water definitions 0–20, new objects) — candidates for `idSource: "patch-notes"` provenance. Also note `objreplacement.json` (civ-specific object replacement, Update 169123) as a Phase 4+ preview-fidelity concern.
8. Doc-strings, eventually: the F_seasons include's shared constants (MELKARYBA, KERICEK, VODA, WOODIES, …) — heavily used by standard-derived maps and invisible to the symbol table (include-defined).
9. Preview-generator inputs to model in Phase 4/5 (parser-neutral, recording so they aren't lost): `behavior_version` (0–2) gates land-generation semantics; `override_map_size` (36–480, clamps, repeatable, mid-script); duplicate attribute → last wins; map seed now visible in DE's Objectives screen (useful for eventual preview-vs-game verification).

## 14. File layout

```
src/parser/
  lexer.ts        tokenize(source, opts) → { tokens, lineOffsets, diagnostics }
  parser.ts       parseRms(source, lang, opts) → ParseResult
  validate.ts     validate(result, refDb, opts) → Diagnostic[]   (Phase 2.4/2.5)
  types.ts        every interface in this doc
  diagnostics.ts  code table + message builders
  __tests__/      unit suites + corpus.test.ts + fuzz.test.ts + parse.bench.ts
test-maps/        corpus (zero-error gate) — see §12
test-maps/broken/ real maps with real defects (gate-exempt, fidelity-checked)
```

No imports from React, Monaco, or Tauri anywhere under `src/parser/` — it must run in a bare worker and in Node (Vitest) unchanged.

---

## Appendix A: rev 3 changelog

From `docs/REVISION_3.md` (corpus + patch notes + full guide): math expressions modeled (§2.2 — assembly in consumption, unevaluated, guide-verified lints RMS0208/0210; floats first-class, float-into-integer silent); comments nest (default flipped, depth counter, guide fixtures); quoted `#include_drs` paths assembled (RMS0209/0211); `#undefine`/`#include` non-functional (SymbolInfo.undefineAttempted; validate() ignores undefines); `#ifdef` family removed from the model; `ParseResult.includes` + include-softened symbol diagnostics (Pa_Site's 43 includes); RMS0207 wrong-context code + pinned two-way lookup; RMS0212 digit-prefix lint with predefined-label exemption; RMS0213 nested-random warning; percent_chance/duplicate-#const/effect_percent validate() rules; did-you-mean extended (edit-distance ≤2 + suffix match — both corpus-justified); `test-maps/broken/` gate escape hatch (BCC2); Vanguard named benchmark; duplicate sections confirmed legal (no diagnostic); verify list: 5 items answered by the guide, 4 new items (#13–16), #6 promoted to top priority. Consolidated data/schema actions in §13.

## Appendix B: rev 5 changelog

From `docs/REVISION_5.md` (token-level re-derivation + guide-citation verification): shared-block rule added to §5.4 — guide Example2 traced through dispatch never reached §5.3 and would have drawn a *warning* (RMS0102) on the spec's own flagship idiom; now OrphanBlockNode + RMS0110-info via lookbehind, fixture added. ArgNode given `firstToken`/`lastToken` (quoted-path interior tokens were unreachable — coverage gate ill-defined, patch engine blocked); coverage "reachable" formally defined via deepest-owner + well-nestedness. §5.3 wrap extended *forward* until involved constructs close (trailing closers previously fired spurious RMS0104/0106 — one-diagnostic promise restored, both shapes fixtured). Modulo semantics de-contradicted (`x % 0` → left operand truncated toward zero per Summer 2025 patch; stale guide text noted; % is truncation not floor; verify #18). Comment-inside-expression RMS0210 variant (guide 3362 — engine rejects what assembly would silently accept). spacing_to_specific_terrain `maxRepeats: 4` withdrawn pending patch-note re-check (guide has no cap; unsourced cap = goal-#5 violation). Corpus claim corrected: ForeDaut line 642 has a live stray `endif` (RMS0106 corpus grounding + fixture). Six ambiguities pinned: expression terminator (rnd-kind never terminates; interior `(5)` terminates + lints; engine rule → verify #15), quote cap 64, control-keyword operand consumption (+ `arguments[]` schema action; expression/rnd active in percent_chance slot), RMS0215 for value-initiated unknown-runs, wrong-section suppression after degraded headers, conditionalDepth counts random branches (QS fixture). validate() additions: use-before-definition (guide 148/173), mutexWith consumption. Errata: RMS0005 wording (BOM is a token, not skipped), isTrivia comment reconciled, digit-defines corpus count 8-of-11, three more not-a-comment fixtures + new RMS0216 `//` beginner lint, numeric-truncation float caveat, numeric-first-operand fixtures. Corpus-growth note added (§12, header): stats are the 12-file snapshot; ~52 files now present incl. DE-official maps pending redistribution decision.

## Appendix C: rev 4 changelog

From the fourth critique (independent re-derivation of corpus claims): RMS0212 re-scoped to numeric-typed argument slots only — the rev-3 exemption-list shape missed `#define`'s name slot and would have false-warned on digit-leading user labels live in 5 corpus maps (`#define 2V1`); §8 duplicate-attribute rule split by a new `repeatable` schema flag (guide documents cumulative repetition for spacing_to_specific_terrain/replace_terrain/terrain_cost/connection radii — blanket last-wins would have made Breakdown corrupt connection blocks; repeatable attributes are pinned as lists in Breakdown); "skip" eliminated as an AST outcome — every rejected token joins the pending unknown-run, making §12's coverage property satisfiable by construction; symbols/includes pinned to survive §5.3 degradation (token-stream concern, not AST concern); new validate() check for shadowing predefined names (silent no-op in-engine); RMS0207 cascade suppression (one glued brace ≠ fifty warnings); RMS0214 malformed-rnd did-you-mean + verify #17 (float rnd bounds); BOM given a concrete token representation; RMS0004 char set enumerated; sectionHeader regex admits digits; stop set made context-symmetric; errata fixed (13 ELEVATION headers are corpus-wide with OWWC's 2 being the only duplicate — legality now cited to guide line 148; expression count corrected to 45 across three files incl. AD4's #const-value expressions, now fixtured; AK_Six_Points' live stray `*/` recorded).

## Appendix D: rev 2 changelog (condensed)

Conditional-wrapped section headers → §5.3/RMS0110-info (was an error-severity contradiction); argument stop-set enumerated incl. known names (unverified-arity cascade closed); recursion-safety mandate; RMS0204/0205 provenance gating; Token.isTrivia; ParseResult.symbols; RMS0101/0103 disambiguated; OrphanBlockNode; §5.3 mirror case + amortized linearity; data-driven directives; RandomNode.preamble; whitespace pinned + NBSP/BOM lints; case-sensitivity; goal "no false errors on legal maps" made explicit.
