# Advanced Tools API Design (Phase 5.1, rev 10)

Contract for tools hosted in the Advanced Tools tab. Designed per PLAN.md: **v1 ships built-in (in-process) tools; v1.1 loads external process+manifest tools over stdin/stdout — both implement THIS same contract.** The API is therefore JSON-first: everything crossing the boundary must survive `JSON.stringify` round-trips, because for external tools it literally will.

**Seven independent critique rounds are folded in, and rev 10 is not one of them.** Rev 10 is the de-changelogging pass CREATION_PLAN scheduled before 5.1 writes code: revision narration moved to `docs/build-log.md`, which carries a full entry per round, and **no normative statement changed**. Anyone who read rev 9 has already read every decision here. Where the _history_ of a decision is still the argument for it — a count that decayed, a mechanism that fails, a prescription that was wrong — the back-reference stays, because deleting it deletes the evidence; everything else is now stated as a rule. **Read the body as normative, and where this document and the source disagree, the source wins and this document is the bug.** The rev-4, rev-5, rev-7, rev-8 and rev-9 review files have been deleted now that every finding is folded in here and summarised in `docs/build-log.md`, matching the convention later used for the Generation Consistency Checker's own fourteen rounds.

**Every repo claim here is dated, and dating it is not enough — that is a measurement, not a caution.** An undated claim in this document has a half-life of about a week; a _dated_ one decayed 34% inside its own date, because a parallel session was writing to the same data file the same afternoon. One round re-derived every count on 2026-08-11 and all of them reproduced exactly; two days later `game-constants.json` was **eight times** the figure it had confirmed. The sharpest version came within twelve hours of a fold: **every count in it still reproduced to the unit** — `game-constants.json`, the `language.json` command and attribute counts, `tokenId = create_land 32`, zero variadic argument defs, the 581-node alias census, the nine context files — while **three of its raw `file:line` citations had gone stale in hours**, all three into files a parallel session touched. **The decay constant for a raw line number in an actively-edited file is measurable in hours; for a claim anchored to a symbol, a data file or a generated artefact it has not been observed to be finite.** So: re-derive before acting on any count, prefer the resolver or the generated artefact to the number wherever one exists, and **cite the symbol and let the reader's own grep resolve the line** — the citations that remain as line numbers here are the ones with no symbol to name. Sec.10.2 carries the standing version of this for the next round; Sec.10.1's reporter is the mechanical one.

**"Tracked" means twelve files, not the thirty-two this document measures over.** Every measurement here is taken over **the 32 `test-maps/*.rms` on a maintainer's disk**, which is not what CLAUDE.md means by tracked: `.gitignore:44` ignores `test-maps/*` and whitelists eight patterns, so a clone gets **12 files**. Of the four maps in Sec.4.2's payload table, three survive a clone and `24hr_A Heart Map.rms` does not; of the two maps carrying Sec.4.2's alias construct, **neither does**. The measurements are unaffected — they are illustrations of shape and this document says so. What is affected is any prescribed test that assumes its input ships, and Sec.9 item 1 had one. Where this document reports a measurement it says "on a maintainer's disk"; "tracked" is reserved for CLAUDE.md's meaning.

## 1. Goals

1. **One contract, two transports.** A tool is defined by the message protocol (Sec.4), not by where it runs. Built-in tools implement `ToolImplementation` in-process; external tools speak the identical messages as NDJSON over stdin/stdout. The host cannot tell them apart above the transport layer.

   **What that does NOT mean: identical bytes.** The two transports carry the same _types_ and the same _messages_; the wire form additionally encodes `±Infinity` as a sentinel and drops `def`, because JSON cannot represent one and re-emits the other at every node pointing at it — **41% of the payload, measured** (Sec.4, Sec.4.2). Portability is preserved by **the published type differing from the in-process one in whichever direction makes the difference a compile error**: wider for numbers (a sentinel cannot be used as a number), unreadable for defs (Sec.4). "The published type is the wider one" is the natural shorthand and it is wrong in the `def` direction — see Sec.4, where getting it wrong reintroduces the exact silent-`undefined` defect the sentinel exists to prevent. **Byte-identity was pursued for a revision and a half, had no consumer, and cost the flagship tool its first line**, which is why the goal is stated as the message contract and never as the encoding.

2. **Tools are documents the app displays, not extensions of the app** (PLAN.md's model #1). A tool cannot add menus, hook events, or touch the DOM. It receives context, emits progress, and returns output blocks and/or code edits. This is what makes the v1.1 trust model tractable.
3. **Code is source of truth, still.** Tool edits are `TextEdit`s applied through the same shared-model path Breakdown uses (breakdown-design Sec.6.4) — one undo entry, same staleness guard, never a bypass.
4. **Long-running work is first-class.** The flagship tool (Generation Consistency Checker, 5.2) runs thousands of generations: the protocol has progress and cancellation from day one, not bolted on.
5. **Serializable by construction, and the prohibited set is named rather than implied.** `ParseResult` is already plain data (token indices, no cycles — a deliberate 2.3 property); the rest of the context is designed to match. Concretely, **nothing crossing the boundary in either direction may be a `Map`, `Set`, `Date`, `RegExp`, class instance, function, `NaN`, or `±Infinity` except through the Sec.4 sentinel, and no ARRAY ELEMENT may be `undefined`.** "Serializable" as an adjective is what let `Infinity` survive two revisions; the list is what a test can assert.

   **There is deliberately no "and no property may be `undefined`" clause, and the corpus is why.** Measured over the 32 `test-maps/*.rms` on a maintainer's disk (probe: `parseRms` bundled from `src/` with esbuild, run in Node): a real `ParseResult` carries **4,017 explicitly-`undefined`-valued keys** as of 2026-08-13. They are not exotic — `Parser` writes `def: undefined` on the unknown-command path, and three further sites write `def: argDef` where `argDef` is `ArgumentDef | undefined` by signature. A rule that the whole corpus violates on line one is not a contract, and the only ways to satisfy it are to change the parser on a downstream consumer's behalf or to add a 4,017-key stripping pass per run. **The prohibition on array elements is the half that has never moved**: zero `undefined` array elements across all 32 maps, on a corpus reparsed by a rewritten parser since the rule was written.

   **The count itself moved 4,599 → 4,017 and the drop is not noise — it is the Sec.4.2 alias resolver.** **581 of those 582** are the two alias maps: command nodes that used to write `def: undefined` on the unknown-command path now resolve to a real `CommandDef` through a `#const`, so they stopped writing the key at all. **One key is unattributed and stays that way** — the 4,599 baseline was measured by a parser that no longer exists, so there is nothing left to diff against. Say 581 of 582 and leave the last one open. Worth stating with its cause, because "the corpus disproves the rule" is the sentence this count is load-bearing for, and a reader who sees only the number move will reasonably wonder whether the rule moved with it. It did not.

   **The two cases are not the same case, which is why one is prohibited and the other tolerated.** `def` is declared `def?: ArgumentDef`, so a consumer reading `node.def` gets `undefined` whether the key was dropped in transit or never present — the value does not change, only `"def" in node` does, and nothing in this contract licenses a tool to enumerate AST keys. An `undefined` **inside an array** is different in kind: `JSON.stringify` turns it into `null`, which is a value the consumer can read and be wrong about. So the prohibition is on array elements, the tolerance on optional keys is explicit, and the rule tools must follow is **read optional keys, never enumerate them**. Sec.9 item 1 tests exactly that split.

   One item on the list is live rather than hypothetical: **`LanguageIndex` is Maps and Sets** (`parser/language.ts`, verified 2026-08-13), and it serialises to `{}`. `referenceData.language` is deliberately plain `LanguageData`, so **every tool must build its own index** — built-ins import `buildLanguageIndex`, external tools reimplement it. Say so in PROTOCOL.md; it is one sentence that saves a session. That index also carries `commandsByTokenId`, which Sec.4.2's alias recipe needs, so "build your own index" has a second consumer and a sharper consequence.

   **`InstantiatedValue` is NOT the live example of that, and reading it as one is a category error worth naming.** It is real (`preview/generator/types.ts`) and it does carry `undefined` load-bearingly, but it is not in the payload: `ToolContext` carries `source`, `parseResult`, `settings`, `referenceData`, `selection` and `params`, and a tool reaches `InstantiatedScript` only by calling `instantiateScript` itself, in-process, with nothing crossing a boundary (Sec.2's transport split). The live example is `ParseResult`, which is both the largest thing in the context and the thing the round-trip test names.

Non-goals v1: tool-defined interactive UI (output is declarative blocks; no HTML/JS from tools — that's the future webview tier, PLAN.md model #2); tool-to-tool communication; tools mutating files other than the open document; hot-reload of built-in tools.

## 2. Core types (`tools-api/` — shared, no React/Monaco/Tauri runtime imports)

```ts
export const TOOLS_API_VERSION = 1; // bump on breaking protocol change; host rejects mismatches

export interface ToolManifest {
  id: string; // stable, kebab-case: "consistency-checker"
  name: string; // display name
  version: string; // tool's own semver
  apiVersion: number; // must equal TOOLS_API_VERSION
  description: string; // one-liner for the Select Tool dropdown
  capabilities: Capability[]; // Sec.6 — everything not declared is denied
  params?: ToolParamDef[]; // run-configuration form, rendered by the host (Sec.5)
  // v1.1 external tools add: entry (executable + args), language, author, homepage.
}

export type Capability =
  | "read-source"
  | "read-ast"
  | "read-generation-settings" // NOT "read-settings" — see below
  | "read-reference"
  | "read-selection" // see `selection`
  | "edit-source";

// read-reference: language.json + game-constants.json in full. The AST embeds defs only
// for names actually used; the checker's static layer needs complete reference data
// (per-object resource amounts, all commands). Without this capability the flagship tool
// could not run on the declared context at all.
//
// "In full" is a ~1.37 MB CONSTANT TERM on every run that declares it (game-constants.json
// 3011 entries / 1.25 MB stringified, language.json 0.115 MB) — see Sec.4.2 rule 2, which
// models the parse and not this. It changed meaning by 8x on 2026-08-12 when the gaia
// roster landed. Full-file delivery is still the simplest correct answer and scoping it
// would be a new capability, so this is a number to state rather than a defect to fix.
// Two facts about what is in there: 501 rows are `isCorpse` (carcasses and blood decals,
// which the reference table itself hides behind a toggle) and 2137 have no `rmsConstant`.
//
// read-ast alone is NOT sufficient to know what a COMMAND IS. The wire strips `def`, and
// a command's identity can come from the script's own `#const` table via
// `CommandDef.tokenId`, which lives in language.json. So a tool that resolves commands at
// all needs read-reference — not merely one that "needs defs". Sec.4.2 carries the
// algorithm.
//
// read-ast IMPLIES read-source, and that is why stripping would be wrong: ParseResult
// inherently contains the document (`source`, and even without it, `tokens[].text` holds
// every non-whitespace character — stripping the field would be security theater). The
// host auto-grants read-source when read-ast is declared, and the v1.1 consent dialog
// shows a single "can read your script" line for either. Embedded `def` slices are
// reference data (public, shipped with the app), not user data — no gate needed; noted
// so nobody mistakes the capability matrix for a data-flow proof. The WIRE form drops
// `def` for size (Sec.4.2), so an external tool resolves it through its own
// LanguageIndex. That is a payload decision, not a capability one; read-reference is
// still what gates the vocabulary itself.
//
// read-generation-settings is NOT `read-settings`, and the name is not a quibble: it is a
// consent-dialog string in v1.1. One `settings.json` holds several unrelated families and
// this capability carries only ONE of them — help (1.7, helpConstants.ts), generation
// (2.5, generationSettingsConstants.ts), side-panel layout (4.4,
// SidePanelLayoutContext.tsx), app display (src/settings/nameDisplay.ts), the Open
// dialog's last-used folder (src/settings/scriptFolder.ts) — and whatever lands next.
// "This tool can read your settings" would have been a false statement about a trust
// surface. Deliberately a LIST and not a count: a count has to be re-dated every time the
// store grows, and the argument is "more than one family, one capability", which only
// gets stronger. Prefer the shape that cannot decay to the number that must.

// Discriminated union: `type:"integer", default:"foo"` is unrepresentable, and select
// defaults must be one of the options (host validates at registration).
interface ParamBase {
  key: string;
  label: string;
  help?: string;
}
export type ToolParamDef =
  | (ParamBase & {
      type: "integer";
      default: number;
      min?: number;
      max?: number;
    })
  | (ParamBase & { type: "boolean"; default: boolean })
  | (ParamBase & { type: "text"; default: string })
  | (ParamBase & {
      type: "select";
      default: string;
      options: { value: string; label: string }[];
    })
  // multiSelect exists because CREATION_PLAN 5.2 specifies the checker runs "across a
  // player-count matrix (2/4/6/8)", which none of the four above can express. The
  // workarounds are four booleans or a text field every tool re-parses itself, which
  // throws away the host-side validation. Bounds are checked in Sec.5.
  | (ParamBase & {
      type: "multiSelect";
      default: string[];
      options: { value: string; label: string }[];
      minSelected?: number;
      maxSelected?: number;
    });

// The parse-result form is a TYPE PARAMETER, because it differs by transport. The default
// is the wire form, so a tool authored against the published `.d.ts` writes `ToolContext`
// and gets the widened, sentinel-carrying type. A built-in receives
// `ToolContext<ParseResult>` — real numbers, real `Infinity` — and `ParseResult` is
// assignable to `SerializedParseResult` (arrays are covariant and `number` is a subtype
// of the union), so `ToolContext<ParseResult>` is assignable to `ToolContext` and a
// portable tool compiles unchanged in both. See Sec.4.
//
// The wire form ALSO differs by not carrying `def`, and the published type has to say so
// or the compiler blesses a silent `undefined`. `SerializedParseResult` types every `def`
// slot as `unknown`, which keeps `ParseResult` assignable to it and makes `node.def?.name`
// a compile error on the published type. Sec.4 has the mechanism, and the two mechanisms
// that look right and are not.
export interface ToolContext<
  P extends SerializedParseResult = SerializedParseResult,
> {
  apiVersion: number;
  source?: string; // iff "read-source"
  parseResult?: P; // iff "read-ast" — see Sec.4
  settings?: ToolGenerationSettings; // iff "read-generation-settings"
  referenceData?: {
    // iff "read-reference"
    language: LanguageData; // plain data — build your own LanguageIndex (Sec.1)
    gameConstants: PublishedGameConstants; // generated from the schema — see below
  };
  selection?: { offset: number; item?: Span }; // iff "read-selection" — see below
  // The value union includes string[] for multiSelect, and the widening lands NOW rather
  // than with v1.1: `params` is the type an external tool deserializes its own run config
  // into, so widening it after v1.1 manifests exist hands every already-written tool a
  // runtime surprise its compiler promised was impossible.
  params: Record<string, number | boolean | string | string[]>;
  // Deliberately absent: file paths, fs access, the preview pane's seed (see below).
}

export interface ToolGenerationSettings {
  playerCount: number;
  // BOTH the display name and the resolved dimension. `name` is a plain string, not the
  // app's MapSize union, so external tools need no import; a built-in re-narrows with
  // generationSettingsConstants.ts's own `isMapSize` guard rather than casting.
  mapSize: { name: string; tiles: number };
  // Always length 8, indexed player - 1, INDEPENDENT of playerCount — entries at index
  // >= playerCount describe people who are NOT in the game and must be ignored, team
  // sizes included. 0 means un-teamed and is the engine's own value for it (guide:1001),
  // not a UI placeholder. These are NOT the numbers that
  // appear in TEAMn_SIZEm / PLAYERx_TEAMy: those are lobby order, derived by
  // src/generationSettings/teamModel.ts's canonicalisation, which the generator imports
  // rather than re-implementing. Plain number[] at the JSON boundary; a built-in
  // re-narrows with `isTeams`.
  teams: number[];
}
```

**`mapSize.tiles`: where it comes from, and what it is not.**

_Verified 2026-08-10._ The context builder calls **`resolveMapDim(mapSize, predefinedLabels)`** from `src/preview/generator/mapDimensions.ts`, and surfaces its `null` rather than defaulting it away — a size that does not resolve is a data regression worth reporting, and the whole label environment is built from the same array. **Do not create a `MAP_SIZE_TILES` constant**: that function already exists, its docstring pins the `.find()`-not-uniqueness detail (six of seven sizes match two entries, the legacy and modern label for one grid), `mapDimensions.test.ts` covers all seven sizes including Giant 252, and `npm run validate:reference` asserts that every size resolves and that the legacy and modern labels agree. Writing a second resolver is the same mistake one level down. Giant/Huge ordering needs no cross-reference either — fixed 2026-08-01, `generationSettingsConstants.ts` orders Giant last and the validator enforces it.

**Cite `preview-design.md` by content, never by section number.** That document reorganises every revision and is now on its third numbering of this material; two successive citations of it from here have gone dead.

**`tiles` is the LOBBY dimension, and a script can change it.** `override_map_size` (the `name === "override_map_size"` branch of `instantiate.ts`'s command walk) replaces it — clamped to `[36, 480]`, honoured only before the first land command, ignored with a note after — and **`InstantiatedScript.dim` (`generator/types.ts`) is the value every stage actually generates against**, with its own comment saying it can differ from the lobby size's. A static check keyed on map area (`land_percent` over-allocation, impossible count×spacing — both named in CREATION_PLAN 5.2's brief) computes against the wrong grid on every script that overrides, and fails _quietly_, in the direction of "your map is fine". This is impossible to guess and cheap to state.

**How a tool gets the real dimension differs by transport, so the answer is split by audience** — "resolve it yourself or call `instantiateScript`" is one sentence containing in-process-only advice, and Sec.3 has already established that a tool linking app modules is not expressible externally:

- **External tools resolve `override_map_size` themselves**, and PROTOCOL.md must carry the rule since they cannot read `instantiate.ts`: take the last occurrence appearing **before the first land command**, clamp to `[36, 480]`, ignore any later one. It is the same class of one-sentence saving as "build your own `LanguageIndex`".

  **A land command is identified AFTER the alias resolution of Sec.4.2, and this clause is the whole of the coupling.** `instantiate.ts` computes a command's identity as `node.def?.name ?? tokenText(node.name)` and tests the land-command set against _that_, so an aliased `L { … }` **closes the override window** in the host, because it is a `create_land` to every rule keyed on command identity. A tool implementing the rule by name — which is what the sentence above says — reads `#const L 32` + `L {}` + `override_map_size 300` as an override before the first land command and honours it; the host ignores it. Wrong grid, silent, in the same "computes against the wrong dimension and fails quietly" direction the finding above is about. **Latent, not live**: `override_map_size` appears in 5 maps on a maintainer's disk, the alias in 2, and the intersection is empty (verified 2026-08-13). Stated anyway, for the reason the variadic caveat is: PROTOCOL.md is the normative text an external author transcribes, and a rule that is correct on today's corpus is not a rule.

  **The host-side residual in Sec.4.1 inherits the same clause.** Its cheap scan for "an `override_map_size` before the first land command" must identify land commands post-alias too — free in-process, since the host is holding `def` — or the run-watchdog fix silently disagrees with the generator it exists to protect.

  **Worth recording on the other side of the ledger:** BUG-013's fix is the strongest in-repo evidence _for_ Sec.4.2's position. The preview generator's own by-name resolution was once citable as proof that "resolve by name" is what a competent implementer writes unprompted; the fix inverted it — the app's own consumer now derives command identity from `def` first, which is exactly the reconstruction Sec.9 item 11 asserts is possible. The def-identity stance has a precedent, not only an argument.

- **Built-ins call `instantiateScript`** — and must not let its result escape. `InstantiatedScript` is `ReadonlyMap` throughout (`sections`, `objectGroups`, `actorAreas`, and `InstantiatedCommand.attributes`, `generator/types.ts`), which is the whole of Sec.1's prohibited set. Harmless in-process, and precisely the thing someone will try to hand back across the boundary or stash in a `partial`.

**The preview pane's seed is deliberately NOT in the context.** The app has a user-visible seed chip (`ui-help.json`: `preview.seedChip`, `preview.reroll`) whose value lives in `PreviewViewContext` — view state, defaulting to 1, not persisted, describing where you happen to be looking. Three reasons it stays out. The Monte Carlo layer varies the seed by construction, so the pane's current seed is the one value it specifically does not want. `read-generation-settings` is scoped to the generation family in `settings.json` and the seed is not in it, so carrying it would reopen exactly the scope gap that capability's name closes. And a tool that _does_ want a fixed seed already has the right mechanism: declare an `integer` param, which the host validates, which the user can set, and which Sec.5's settings echo puts in the output header so the run is self-describing. **If 5.2 finds a case where a tool must reproduce the pane exactly, that is a new `read-preview-view` capability and an escalation, not a silent widening of this one.**

**The context builder takes its parse from `ParsedDocumentContext`, NEVER from `PreviewResultContext`, and tools always see the WHOLE script.** CREATION_PLAN 4.6 landed a Current/Final cut point on 2026-08-10: `truncateAst(parse, cutOffset)` (`src/preview/generator/truncateAst.ts`) returns `{ ...parse, script: { preamble, sections } }` — **`source`, `tokens`, `lineOffsets`, `symbols`, `includes` and `diagnostics` all come through unchanged**, by design and with the file's own comment saying so, and `PreviewResultContext` memoises exactly that value. So the app holds a `ParseResult` whose `script` is not the parse of its own `source`, and it **passes every one of Sec.4.3's guards**, because those guards compare strings and this object wears the real document's `source` as proof of a claim it does not support. **The cut offset and the pin live in a third file, `src/PreviewCutContext.tsx`** — named because it is what a `read-preview-view` escalation would have to read. **All THREE providers mount adjacently in `App.tsx` — `ParsedDocumentProvider`, then `PreviewCutProvider`, then `PreviewResultProvider`, in that nesting order.** The one named after the preview is the one holding the truncated parse, which is also the one a session wiring up "the parse the preview runs on" reaches for first, and it has a second confusable neighbour sitting between it and the right answer.

The user-facing half is the same shape as the seed and gets the same answer. The cut is view state with a visible control; with a pin set, the preview pane shows half a map while a checker reports on the whole script, and Sec.5's settings-echo header says nothing about it. So: **the cut point is not in the context**, it belongs in the output header if anywhere, and a tool that must reproduce the pane exactly is a `read-preview-view` escalation — the same three-part decision the seed gets above, for the same reasons.

**`selection` is an offset anchor, not a range.** PLAN.md:56 and CREATION_PLAN 5.1 both name selection as context this doc was briefed to design, so it is here — but **not as a `Span`, because that is not implementable**: the Monaco _editor instance_ exists only while CodePane is mounted, i.e. while the Code tab is active (`useDocument.ts`'s window-level `keydown` effect documents this — it is why Ctrl+Z needs a window listener at all). A tool runs from the Tools tab, so at run time there is no mounted editor and no live selection range. What survives a tab switch is `src/hooks/useSharedSelection.ts`'s single nullable **offset anchor**, lifted to app level precisely so it outlives the panes (verified 2026-08-10). So `selection.offset` is that anchor, and `selection.item` is the span of the `Item` the hook already resolves through `findItemAtOffsetInScript` — free, and the only thing resembling a range that exists. Absent entirely when the anchor is null. Say this in PROTOCOL.md, or the 5.1 session goes looking for `editor.getSelection()` and finds nothing.

**The published game-constants type is GENERATED from the schema, not hand-written, and it is called `PublishedGameConstants`.** Do not promote `src/editor/aoe2RmsHover.ts`'s interface — that was a live option once and is not now. The name matters because `GameConstantsData` **is already taken**: `src/breakdown/gameConstants.ts` exports one (a narrow view over the same file) and `aoe2RmsHover.ts` declares a second, file-local. Publishing a third under the same name, in the section whose entire point is that narrow views keep being mistaken for the shape, is how the next reader imports the wrong one.

**The measurement, and why re-counting it is the wrong instinct.** This paragraph has carried five numbers for one file: 164 entries (2026-08-10), 220 hours later the same day, 372 on 2026-08-11, and **3011 entries with 26 schema properties on 2026-08-13** — CREATION_PLAN 4.10 landed the whole gaia roster, so `category: "object"` alone went 33 → 2672. **Four successive corrections were each written as the fresh one and each was overtaken, the last by a factor of eight.** The fifth is here to show the SHAPE of the decay, not to be read as current: assume it is wrong. Every count in this section is an illustration; the machine-readable answers are `reference/schemas/game-constants.schema.json` and the reporter test Sec.10.1 prescribes. **If you find yourself about to write a sixth, build the reporter instead — that is what it is for, and it is item 10 of the test plan.**

Two facts about the data that a hand-written type gets wrong, both live:

- **`rmsConstant` is nullable and 2137 rows are null.** The nulls used to be "the DE terrains with no callable constant", 85 rows, which is the fact a reader used to decide whether the claim applied to them; since 4.10 they are overwhelmingly **roster objects with no RMS name at all**, so the argument got stronger rather than weaker — a hand-written `rmsConstant: string` crashes a name-based consumer on **71% of the file** rather than a fifth. All the hand-written views except one declare `rmsConstant: string`. An external tool written against a `.d.ts` that says `string`, doing `entry.rmsConstant.startsWith(…)`, is wrong about two rows in three. **`ObjectConstant` (`preview/generator/objects.ts`) already declares `rmsConstant: string | null` with a comment giving the reason** — one of the in-repo views got this right on its own, which is the precedent this section argues from rather than against.
- **`category` gains members faster than a spec can track them, and this bullet has been wrong twice.** It named two members, was corrected to three (`terrain | object | objectClass`) with the note that hand-narrowing to two would have compiled against a schema already carrying the third with zero rows, and the corrected sentence broke the same way inside a day when `attribute` made **four**. **Read the enum out of the schema; do not transcribe it.** That is the whole argument of this section, demonstrated twice on its own text. Re-measured 2026-08-13: still four, while the row counts behind them moved by 2639. **The enum held and the counts did not, which is the distinction this section is really about** — the shape is worth writing down, the counts are worth generating.

So the action item is neither "define one" nor "promote one": **derive the published type from `reference/schemas/game-constants.schema.json`, which is the artefact CI already validates.** Generate it into `tools-api/generated/` as part of the build (`npm install -D json-schema-to-typescript` — say the install in the same breath, per house rule). The in-repo narrow views stay narrow projections and are explicitly allowed to; what is forbidden is a further hand-written _published_ copy. Whichever route is taken, **the check must go red the day the schema gains a field** — that is the whole requirement, and a generated file satisfies it for free. Field-level notes to carry into whatever consumes it: `resourceAmounts` is optional and per-resource-partial (**170 rows on 2026-08-13**, up from 8 and then 23 — see Sec.10.1, where that number is load-bearing and is now a reporter rather than a literal), `constId` is nullable, the schema's `required` list is exactly `["rmsConstant", "descriptiveName", "category", "verified"]` so `constId`/`deTextureFile` are optional there, and `isTree` exists in the schema with no data row yet. **Expect the generated type to carry fields no consumer has heard of, and do not prune them** — `isCorpse`, written only when true, is the same shape.

**`LanguageData.predefinedLabels` stays optional, and this is settled — do not re-litigate it.** The schema marks it required, which is a standing invitation to "fix" the type; `src/parser/language.ts` deliberately went the other way, with a comment giving the reason: nothing checks the shape at runtime (`parserWorker.ts` reaches `LanguageData` through a double cast, which asserts rather than verifies), and preview-design mandates a `refDb.predefinedLabels ?? []` guard that a non-optional type would render dead code. Real collision, resolved with reasons on the record. `PredefinedLabel` is separately fully typed in `language.ts`, against the schema. **Three re-resolutions of this one paragraph have moved only its line numbers** — every claim still correct, every citation stale — which is the argument for citing by symbol name and letting the reader grep.

```ts
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
} // same shape as breakdown Sec.4.1

export interface ToolOutput {
  blocks: OutputBlock[]; // declarative display — the pane renders these, tools render nothing
}

export type OutputBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string } // plain text w/ \n; NO markdown/HTML in v1
  | { kind: "keyValue"; rows: [string, string][] }
  // rowSpans is one entry per row, null where a row has no code to jump to. Length-checked
  // by the inbound validator (Sec.4.2); a mismatched length is a protocol error.
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
      rowSpans?: (Span | null)[];
    }
  | {
      kind: "severity";
      level: "info" | "warning" | "error";
      text: string;
      span?: Span;
    }
  | { kind: "codeRef"; text: string; span: Span }; // clickable — jumps the Code tab to span.start
```

**`severity` and `table` carry optional spans, because without them the flagship tool cannot express its own prescribed output.** CREATION_PLAN.md:279 item 3 specifies the checker's report as "per object/land/connection: spawn rate, failure buckets, worst player count" — a table whose every row is about one `create_object`, and the first thing a user does with such a row is click it. With `rows: string[][]` there is nowhere to hang a `Span`, so every clickable finding needs a `severity` block plus a sibling `codeRef` that the pane renders as two unrelated things, and a 200-row table becomes 200 unlinked pairs or a table nobody can click. The repo already models this correctly one layer down: `Diagnostic` (`parser/types.ts`) keeps severity, message and span in one record, and both the diagnostics ruler and the Monaco markers consume it that way. Structurally the same gap as the player-count matrix no `ToolParamDef` could express, and it lands now for the same reason `multiSelect` did: **widening `OutputBlock` is free before external manifests exist and is a breaking wire change after.** Check the vocabulary against CREATION_PLAN 5.2's four named static checks before implementing — `land_percent` over-allocation and impossible count×spacing are both per-command findings that want exactly this.

**`codeRef` carries a span, not a bare offset.** `Diagnostic` carries a `Span`, the diagnostics ruler and Monaco markers both consume ranges, and a checker reporting "this `create_object` never places" wants the command highlighted rather than a caret at its first character. Same free-now, breaking-later argument as the two widenings above. The jump writes `useSharedSelection`'s anchor rather than inventing a Code-tab-specific path; that hook is already the app's cross-tab answer.

Spans are relative to the **run's document snapshot** (Sec.4's staleness rules define that snapshot precisely). If the document changed since the run, the jump still fires, clamped to document length, with a "the code changed since this ran" notice — consistent with, but softer than, the Apply staleness guard. If the document was _replaced_ (File → Open) the wording is "this ran against a different document", not the softer one.

**A span is an offset; a location named in PROSE is a 1-based LINE NUMBER.** These are two decisions, not one, and it is easy to pin only the machine half. A `span` is consumed by the Code tab jump and by `useSharedSelection`'s anchor and must stay a character offset or it goes stale on the first edit above it. But `severity.text`, `text` and `table.rows` are read by a person who then has to go and look, and **an offset names a position no editor displays**. The repo shipped exactly this defect and made it a CLAUDE.md hard rule on 2026-08-13: seven RMS03xx/RMS0103 messages reached the installed release saying "already set at offset 86970", so the one actionable fact in the message was unreachable. The fix was `lineNumberOfOffset` (`src/parser/lineIndex.ts`), now called from `parser.ts` and `validate.ts`. **A checker writing "conflicts with the `create_object` at offset 41003" reproduces a defect whose fix is sitting in a neighbouring file** — so: a built-in imports `lineNumberOfOffset`; an external tool converts with `parseResult.lineOffsets`, which is on the wire and deliberately not parameterized. Sec.9 item 9's `scriptStats` exemplar is the natural place to demonstrate it, being the one tool whose entire output is prose about locations.

## 3. Tool implementation (in-process form)

```ts
export interface ToolRunHandle {
  cancel(): void;
}

export interface ToolImplementation {
  manifest: ToolManifest;
  // A built-in receives the in-process context — real `ParseResult`, real `Infinity`, no
  // sentinels (Sec.4). A tool that wants to stay portable to v1.1 declares
  // `run(ctx: ToolContext, …)` instead and reads numbers through `numeric()`;
  // `ToolContext<ParseResult>` is assignable to `ToolContext`, so both compile.
  run(
    ctx: ToolContext<ParseResult>,
    emit: (msg: ToolMessage) => void,
  ): ToolRunHandle;
}
```

**The context is read-only, and in the worker case it is a copy for free.** `postMessage` to the tool worker structured-clones the context, so a worker-hosted built-in physically cannot corrupt the AST the UI renders from — which is why no deep-clone mandate is needed, and why scoping the sentinel to the wire (Sec.4) does not reintroduce the hazard. A main-thread built-in holds the live object and **must treat every field as frozen**; nothing in this contract licenses a tool to mutate its context.

`run` returns immediately; all results flow through `emit`. Built-in tools that do heavy CPU work (the checker's Monte Carlo) run inside a **tool worker** (not the parser worker — a stuck tool must not stall diagnostics), where `emit` is `postMessage`. A synchronous throw from `run` is caught by the host and synthesized into an `error` terminal, same as a crash.

**Worker lifecycle — pinned: one worker per run.** The host spawns a fresh tool worker at `run`, and terminates it after the terminal message (or a kill). Consequences, both deliberate: `worker.terminate()` needs no recovery logic (the next run spawns anew), and **tool module state cannot persist across runs** — a tool that wants persistence must put it in its output, not in globals. Spawn cost is irrelevant at one-run-at-a-time frequency (Sec.5), and per-run spawn is a one-liner with Vite's `?worker` import, as `useParsedDocument.ts` already uses. This pin is also what makes Sec.4's run watchdog nearly free: there is nothing to recover, so the kill path has no state to reconcile.

**Who calls what, stated instead of presumed:** `ToolRunHandle.cancel()` is the _in-process binding_ of the `cancel` message; `HostMessage` is the _transport encoding_. Concretely: the host's Cancel button → host posts `{type:"cancel"}` to the tool worker (or writes it to the external tool's stdin) → the **worker shim's message handler** (host-authored plumbing, always responsive once the tool's chunk yields) invokes the in-worker `handle.cancel()` → which sets a flag in the tool's closure, observed at the next chunk boundary. For a hypothetical main-thread tool the host would call `handle.cancel()` directly — same binding, no transport.

**Built-ins may import app modules:** the contract governs host↔tool _communication_, not what code a tool links against. The checker imports the Phase-4 preview generator directly — which means it is **not expressible as an external tool** until the generator is extracted into a standalone library; that's accepted, and it is the honest boundary of "one contract, two transports": the contract is portable, a given tool's dependencies may not be.

**The generator's real signature, which the context must be able to feed.** Verified 2026-08-10:

```
generatePreview(parse, refDb, settings: PreviewSettings, opts: PreviewOptions)  // preview/generator/index.ts:232
PreviewSettings  = { playerCount, mapSize: MapSize, teams: readonly TeamNumber[] } // generator/types.ts:37-54
PreviewOptions   = { seed, collectSnapshots }                                      // generator/types.ts:57-61
```

Two shape mismatches a built-in must bridge, both deliberate and both cheap: `mapSize.name` is a plain `string` while `PreviewSettings.mapSize` is the `MapSize` union, and `settings.teams` is `number[]` while `PreviewSettings.teams` is `readonly TeamNumber[]`. Narrow with the existing `isMapSize` / `isTeams` guards in `generationSettingsConstants.ts` — do not cast. And note that `PreviewOptions.collectSnapshots` is documented in `generator/types.ts` as "false in 5.2 batch mode — the only cost knob": the preview spec has already made that decision _for_ this tool, and 5.2 should acknowledge it rather than rediscover it.

## 4. The message protocol (the actual contract)

One request, a stream of responses, one terminal message. For external tools each message is one NDJSON line (UTF-8, `\n`-delimited) — host→tool on stdin, tool→host on stdout; stderr is captured into a collapsible "tool log" block, **capped as a ring buffer (last 64KB)**, since a chatty external tool must not balloon memory.

**Infinity survives the boundary via sentinel encoding:** `ArgValue` legitimately holds `Infinity`/`-Infinity` (`inf`/`-inf` words, parser Sec.2.2), and `JSON.stringify(Infinity)` → `null` — silent AST corruption for any script using `inf`. Reproduced 2026-08-10 on both paths: `JSON.stringify({v: Infinity})` is `{"v":null}`, and `Number("9".repeat(400))` reaches `ArgValue` as `Infinity` through an ordinary number token, so the `inf`/`-inf` words are not the only source.

**The encoding is scoped to the EXTERNAL WIRE, not to both transports.** Encoding for both is the natural-looking symmetry and it cannot hold alongside two other things this document wants: no eager whole-tree decode, and the checker calling `generatePreview`. `generatePreview(parse: ParseResult, …)` (`preview/generator/index.ts`, verified 2026-08-10) wants a real `ParseResult`; `SerializedParseResult` is its supertype, so `ctx.parseResult` cannot be passed to it, ever, by construction. The runtime half is worse than the type half and fails in the direction of "your map is fine": every numeric read in the generator is guarded by `typeof v === "number"`, so a `{ inf: 1 }` object in any of those slots takes the unresolved branch and the value disappears — the same failure shape as the `override_map_size` finding in Sec.2. And decoding at read sites cannot rescue it, because a tool that feeds the generator has no read sites; it hands the whole tree to somebody else.

**Those guards are given as a count and a grep, never as a list of line numbers.** `instantiate.ts` alone carries **seven**, and the enumeration this paragraph used to hold named five — two that have not moved, three that shifted when a one-line fix landed, and **two it never had** (a `start_random` branch's `chance` percentage, and a `#const`'s resolved value on its way into the symbol table). Both of the missing ones sit downstream of `resolveArg`, so both are reachable by a sentinel, and both fail the same silent way. **An enumeration of line numbers into a file under active edit decays in two directions at once** — the lines move, and the set grows — and the second is the one that reads as complete when it is not. The checkable form is one line: `grep -c 'typeof .* === "number"' src/preview/generator/instantiate.ts`.

Byte-identity was adopted as a goal with no consumer. The flagship tool compiling is not. So:

- **Built-ins receive the real thing.** `ToolContext<ParseResult>`, real `Infinity`, no conversion, no clone, no decode. This is what makes Sec.3's "the checker imports the Phase-4 preview generator directly" implementable, and it is the transport the only two v1 tools use.
- **The external transport encodes on the way out and PROTOCOL.md owns the rule.** The serializer deep-converts `±Infinity` → `{ "inf": 1 } | { "inf": -1 }` as it builds the NDJSON line; the tool decodes at its numeric read sites. Nothing in-process ever sees a sentinel.

  **"Deep" includes `rnd` bounds, which are the second numeric position in `ArgValue`.** `parseRndValue` (`parser.ts`) is `Number(m[1])` over `/^rnd\((-?\d+),(-?\d+)\)$/` — an unbounded digit run, so an `rnd` bound reaches `Infinity` by the same route Sec.4 already accepts for a bare number token, and `JSON.stringify({ rnd: [Infinity, 1] })` is `{"rnd":[null,1]}` (confirmed 2026-08-11). Pinning `ArgValue<N> = N | { rnd: [N, N] } | …` below is what makes the deep conversion type-honest instead of a lie about `[number, number]`; a converter that walked only the bare-number position would leave the corruption in place.

- **The published type differs from the in-process one in whichever direction makes the difference a compile error, and that is not always "wider".** `ToolContext` defaults to `SerializedParseResult`, `ParseResult` is assignable to it, and `numeric()` is the identity on a plain number, so a tool written against the published `.d.ts` compiles and runs correctly in-process **and** over the wire without knowing which it got. That property holds for `Infinity` _because the type forces the tool to notice_: `number | { inf: 1 | -1 }` cannot be used as a number, so the decode is a compile error away.

  **It does not come for free, and it was once lost one field over.** Stripping `def` from the wire (Sec.4.2) while leaving `def?: CommandDef` standing in the published type means a portable tool writing `node.def?.name` compiles cleanly, works in-process, and returns `undefined` for every node over the wire — _fails in the direction of "your map is fine"_, which is the exact defect the sentinel exists to prevent, reintroduced by the half of the design that argues the type system is what keeps the contract honest.

  **Pinned: every `def` slot in `SerializedParseResult` is typed `unknown`.** `unknown` is the one type that satisfies both halves — `CommandDef` is assignable to it (so `ParseResult` stays assignable to `SerializedParseResult`, which is what `ToolContext<ParseResult>` → `ToolContext` rests on) and nothing can be read off it without a cast (so `node.def?.name` is a compile error). It also documents itself: the slot is visible in the published `.d.ts` with a comment saying "absent on the wire — resolve it through your own `LanguageIndex`", which an omitted property cannot say.

  **Two mechanisms look right and are not.** Both were checked against this repo's own `tsc --noEmit --strict` on 2026-08-11 rather than reasoned about, and the reasoning would have got one of them wrong:
  - `def?: never` **breaks assignability** — `Type 'ArgumentDef | undefined' is not assignable to type 'undefined'` — which takes out `ToolContext<ParseResult>` → `ToolContext`, the property B1 was fixed to obtain. It is the first thing anyone reaches for and it fails a long way from where it is written.
  - Omitting `def` from the wire node types is _correct in isolation_ (the full type stays assignable, and reading `.def` is an error) and **cannot be reached by instantiating a type parameter**, because a parameter can change a property's type and not its existence. Attempting it with a `D extends "real" | "wire"` mode parameter and a conditional property type fails differently and worse: TypeScript compares generic interfaces by _variance_, the conditional makes `D` unmeasurable, and the two instantiations stop being assignable on the type argument alone — `Type '"real"' is not assignable to type '"wire"'`, with nothing in the message about `def`. Genuine omission needs either a hand-cloned wire tree (rejected — see below) or type aliases intersected with `D extends … ? { def?: … } : object`, which trades every named interface in the published `.d.ts` for an intersection. `unknown` buys the enforcement without either cost.

- **The type is derived by parameterizing, not by hand-cloning, and it takes TWO parameters, not one.** `SerializedParseResult` is `ParseResult<number | { inf: 1 | -1 }, NoDefs>`, reached by threading two defaulted parameters up through `src/parser/types.ts`:

  ```ts
  // N — the numeric form. Say where inside ArgValue it lands, because "fifteen types take
  // the parameter" does not: `rnd` bounds are a numeric position too.
  export type ArgValue<N = number> =
    N | { rnd: [N, N] } | { expr: { tokens: number[] } } | string;
  // `expr.tokens` stays number[] — token indices, never infinite. That distinction is
  // exactly why a blanket deep mapped type was rejected, and rnd bounds fall on its
  // other side.

  // D — the def slots, one interface rather than four parameters. Indexed access
  // (`def?: D["command"]`) keeps TypeScript's variance measurement working, which a
  // conditional type does not.
  export interface DefSlots {
    arg: ArgumentDef;
    command: CommandDef;
    attribute: AttributeDef;
    directive: DirectiveDef;
  }
  export interface NoDefs {
    arg: unknown;
    command: unknown;
    attribute: unknown;
    directive: unknown;
  }
  ```

  Both defaults keep every existing call site compiling. A hand-maintained parallel tree silently diverges the first time an AST node gains a field, and a blanket deep mapped type is worse than either: it cannot tell an `ArgValue` numeric position from `lineOffsets`, token offsets, or `expr.tokens` — which hold **token indices** — so it would publish a type claiming a token index might be infinite.

  **LANDED 2026-08-11 in `src/parser/types.ts`, as a parser-design Sec.4 amendment.** Verified on landing rather than assumed: zero call sites edited (whole-repo `tsc --noEmit` clean), lint clean, suite unchanged at 44/1391, four mutants red. `src/parser/__tests__/wireTypes.test-d.ts` pins the assignability property in both directions.

  It was a bigger edit than it reads and it was **escalated rather than improvised**, which is the precedent to follow if the wire form ever needs another one. Fifteen types take the parameters — `ArgValue`, `ArgNode`, `CommandNode`, `BlockNode`, `AttributeNode`, `DirectiveNode`, `IfBranch`, `IfNode`, `RandomBranch`, `RandomNode`, `OrphanBlockNode`, `Item`, `SectionNode`, `ScriptNode`, `ParseResult` — in a file `parser-design.md` owns, changed on behalf of a downstream consumer.

  **It also had to land before Sec.9 item 2 could be written, and that ordering is worth keeping in view.** Item 2 is typed `ToolContext<ParseResult>`, whose constraint is `SerializedParseResult`, which did not exist until the parameters did — so "write item 2 first" and "escalate the amendment first" were both right and in the wrong order, and neither document could see it alone. **An instruction to do X first and an instruction to do Y first are compatible right up until one of them names the other's output.** Resolved: the parameters are in `src/parser/types.ts` and 5.1 starts by writing item 2 fully typed.

  One boundary held deliberately while landing it: **the parser owns the parameters, not the sentinel.** `src/parser/types.ts` gained `DefSlots`/`NoDefs` and the `<N, D>` threading, and nothing else — no `InfSentinel`, no `SerializedParseResult`. Those are wire concepts this document owns, and putting them in the parser would have made a pure lexing/parsing module carry a transport's vocabulary. The type test declares its own local copy of the sentinel for exactly this reason, and says so in a comment.

- **The external serializer MUST NOT convert in place.** The `ParseResult` the host holds is the same object the UI renders from, and three places in Breakdown speak `Infinity` directly: `renderValue.ts` and `patch/formatStyle.ts` test `value === Infinity` to print `inf` (read direction), and `cards/ValueEditor.tsx` maps the words back to `±Infinity` (write direction, verified 2026-08-10). **All three, because the list is what a reader checks against** and a two-entry version of it shipped here for two revisions. Encode during the walk that produces the JSON string; never mutate the tree the app is rendering from. Scoping the sentinel to one transport shrinks this hazard to one code path but does not remove it.
- **Sentinel decoding is a PROTOCOL rule, not a shipped runtime:** PROTOCOL.md documents the encoding and each language reimplements the 3-line decode. In-repo, `tools-api/index.ts` exports a `numeric()` helper for built-ins' convenience — that's app code, not part of the published `.d.ts`.
- **What the compiler enforces is the tool's decode, not the host's encode.** `ParseResult` is assignable to `SerializedParseResult`, so a serializer that forgets to convert typechecks cleanly. The type does force _tools_ through the decoder, which is worth keeping; the other half rests entirely on Sec.9 item 1. Say so, because the in-place-convert bug above is one the type system cannot see.
- **NaN cannot occur; the dev assert should still say "finite or sentinel".** v1 never evaluates expressions, and `ArgValue` numbers come only from `Number(text)` over the lexer's `/^-?\d+(\.\d+)?$/` and rnd-bounds regexes, which cannot produce NaN. `Infinity` can arrive from a long digit run as well as from the words. Harmless (it round-trips), but assert the right invariant.
- **`undefined` needs no encoding and gets no stripping pass.** Sec.1 has the measurement and the reasoning: an `undefined`-valued key on an optional property survives the boundary as an absent key, which reads identically; an `undefined` array element becomes `null`, which does not, and is prohibited. Sec.9 item 1 is what enforces the split, and it uses **`toStrictEqual` for the hand-built fixtures and `toEqual` for the corpus `ParseResult`** — deliberately, and see there for why that is a real gate rather than a weakened one.

```ts
// host → tool (exactly one)
export type HostMessage =
  { type: "run"; context: ToolContext } | { type: "cancel" };

// tool → host (zero+ progress/partial, then exactly one terminal)
export type ToolMessage =
  | { type: "progress"; fraction?: number; note?: string } // fraction ∈ [0,1]; omit for indeterminate
  | { type: "partial"; output: ToolOutput } // replaces the pane's output area (idempotent redraw)
  | { type: "result"; output: ToolOutput; edits?: TextEdit[] } // terminal — success
  | { type: "error"; message: string; reason: ErrorReason }; // terminal — failure

export type ErrorReason =
  | "tool-error" // the tool said so, or threw, or crashed
  | "cancelled" // the user cancelled and the tool honoured it
  | "killed" // the tool did not honour a cancel and was killed
  | "unresponsive" // no message for the watchdog interval; the tool never chunked
  | "protocol" // the tool emitted something that is not a valid ToolMessage
  // Every member above blames the TOOL, and two failure paths are the HOST's — the
  // outbound `run` message exceeding 32 MB (Sec.4.2) and the serializer refusing a
  // prohibited value (Sec.9 item 1a). Both surface in the pane as a terminal, and
  // reporting either as `tool-error` is a false accusation while `protocol` points the
  // wrong way down the wire. Never counted against a tool.
  | "host-error"; // the host could not build or send this run's context
```

**The two kill terminals are distinct, and collapsing them is a defect.** Synthesizing `error: "cancelled"` for both an orderly cancel and a hard kill throws away the only signal that a tool is misbehaving — the user sees the same thing whether their Cancel worked or the host had to SIGKILL. `reason` is a required field on `error` for exactly this. The pane renders every reason as `severity: error`; only `killed` and `unresponsive` are worth surfacing as "this tool did not behave", and only they should be counted anywhere.

Rules: messages after a terminal are discarded with a console warning; a tool that exits (external) or returns-without-terminal (worker crash) yields a synthesized `error`. `partial` exists so the checker can stream findings while running; it must be a full self-contained `ToolOutput`, not a delta.

**Progress throttling:** tools should emit ≤10 `progress`/s; the host coalesces renders (latest wins, ~100ms cadence) regardless, so a flooding tool degrades its own log, not the UI.

### 4.1 Cancellation, chunking, and the two watchdogs

**Tools MUST structure long work as awaitable chunks**, yielding to their event loop between units (`await new Promise(r => setTimeout(r, 0))` suffices). This is not a style preference: the host cannot set a flag in the worker's memory, and a tool in a tight synchronous loop never services the worker's event loop, so a posted cancel message would never arrive. Chunking is also what makes `progress` emission possible at all.

**The checker's chunk unit is ONE generation, not a batch.** `generatePreview` is synchronous and cannot yield inside itself, so one generation is the smallest unit the generator offers. "One batch of generations" is a unit the tool chooses and can make arbitrarily large — the deadline below would then be measuring the tool's batch size rather than its cooperativeness.

**A run that intends to exceed one chunk MUST emit at least one message per chunk boundary.** This is what makes the run watchdog implementable, and it costs a chunked tool nothing since it wants to emit progress anyway.

**Cancel grace: 30s.** It has been 5 s and then 15 s, and both were derived wrongly in ways worth keeping, because the same two mistakes are available to whoever re-derives it next.

**Mistake one: a deadline shorter than one unit of the tool's own work.** Measured over the 32 maps on a maintainer's disk on 2026-08-07 and written up in the comment on `WATCHDOG_MS` in `usePreviewResult.ts`, **one** generation costs a median of ~460 ms and up to **3.8 s**, and this machine's own measured load factor reaches **3.7×** (CLAUDE.md's tracked-debt table records the same suite at 81 s and 307 s on unchanged code). So a correctly implemented, perfectly cooperative checker cancelled one millisecond into a `24hr_Caverns.rms` generation misses a 5 s deadline under any load at all and is killed as if it had wedged.

**Mistake two: that worst case is measured at ONE map size.** The 3.8 s figure comes from the preview pane's own corpus pass, which runs at the live generation settings, and `DEFAULT_MAP_SIZE` is `"Normal"` — 200×200 (`generationSettingsConstants.ts`). Nothing at the measurement site said so. `ToolContext.settings.mapSize` reaches **Giant, 252**, and Sec.2's `override_map_size` rule establishes that `InstantiatedScript.dim` reaches **480**. Both deadlines were once derived from a fixed lobby size by the same revision that discovered `dim` is not the lobby size.

Re-measured 2026-08-10 (`generatePreview` called directly, `collectSnapshots: false`, seed 7, 8 players, two runs, esbuild bundle in Node):

| map                    | Normal (200)   | Giant (252)    | ratio     |
| ---------------------- | -------------- | -------------- | --------- |
| `24hr_Caverns.rms`     | 2864 / 2735 ms | 4110 / 3855 ms | **1.41×** |
| `AD4 - Pag - v1.2.rms` | 2184 ms        | 2929 ms        | 1.34×     |
| `AK_Vanguard_v1.2.rms` | 614 ms         | 671 ms         | 1.09×     |

So the Giant penalty is real, map-dependent, and **smaller than area scaling** (`(252/200)²` = 1.59) — the stages that dominate are not all quadratic in `dim`. Applying the same method to the 2026-08-07 reference rather than to this machine's absolutes: 3.8 s × 1.41 ≈ 5.4 s for one generation at the largest size the settings pane offers, × 3.7 load ≈ **20 s**. That is over 15 s, which is how the second number failed on its own derivation. **30 s** is the next round number above it and is what this document pins.

**Erring long here is nearly free, and that is the real argument for the round-up.** The cancel grace is a _diagnosis_ threshold, not a safety deadline: the user has already asked for the run to stop, and the kill happens either way. All a too-short grace buys is the wrong terminal — `reason: "killed"`, which this document says should be read as "this tool did not behave", printed against a tool that behaved perfectly. A too-long grace costs a cooperative tool nothing (it terminates at its next chunk boundary, typically in milliseconds) and costs a wedged one a longer spinner. Asymmetric, so round up.

**Amended 30s → 60s (2026-08-19, `consistency-checker-design.md` Sec.4.4, landed alongside Sec.7.2 item 4c).** The checker is the first tool this deadline was ever priced against directly, and its own worst-generation measurement — 24-32 s under Giant × load, one generation, the same unit this section derives from — sits inside the 30 s grace by a margin this document's own table says to treat as noise (±50%, never a point). Cancel latency and the run watchdog bound the IDENTICAL quantity: cancel is a message, not a flag, serviced only at the macrotask boundary between generations, so cancel latency **is** one generation, the same quantity `runWatchdogMs` bounds. A 30 s grace against a 60 s watchdog for one shared quantity is the exact asymmetry the paragraph above already argues against ("Asymmetric, so round up") — at the top of the measured range the grace expires first and the host prints `killed` against a tool that cancelled exactly as specified. `cancelGraceMs` now equals `runWatchdogMs`: **60 s**. This is the same move this document's own rev 6 made taking both constants from 15 s/30 s to 30 s/60 s for this identical reason — **when a document computes a number for one constant, check every constant that number bounds.** Tests assert against `DEADLINES.cancelGraceMs`, never the literal, so this needed no test edit.

The repo has already paid for this exact mistake once in the other direction, and it is a CLAUDE.md hard rule: the preview watchdog was set to 1000 ms from a 40 ms-per-stage _budget_, killed and infinitely re-posted every generation slower than it (about a third of the corpus), and is now `WATCHDOG_MS = 12_000` chosen against the measured worst case with `MAX_WATCHDOG_RETRIES = 2`. **A watchdog set below the real cost is a denial of service on your own feature.** Derive from the measurement, never from a round number or a budget.

**Run watchdog: 60s of silence.** Without one, the only kill path is post-cancel, so a built-in that wedges — an unterminated loop, a stage that never yields — produces an indeterminate progress bar forever, and since Sec.5 pins one run app-wide, the pane is bricked until app restart. **If no message of any kind arrives for 60s, the host kills the run and synthesizes `error` with `reason: "unresponsive"`.** Derivation, same discipline as the grace above and subject to the same two mistakes: the longest legitimate gap between messages is one chunk, worst ≈ 20 s at Giant under load per the table, and 60 s is roughly 3× that. No retry cap is needed — unlike the preview watchdog there is nothing to recover and nothing to re-post; one worker per run means the kill is the whole recovery. A tool that trips this has violated the chunking rule, and the watchdog is that rule's only enforcement.

**What it detects is silence, not non-termination — do not read a liveness guarantee into it.** A tool stuck in a loop that _does_ chunk and emit progress runs forever and holds the app-wide single run slot. That is the right trade rather than an oversight: Sec.5's tool-switch and document-replace rules both cancel, so the pane is never bricked, and Sec.10's own budget item puts a legitimate checker run at 8–30 minutes, which no wall-clock ceiling can distinguish from a hang.

**Why the deadlines are not replaced by a bounded progress interval, which is the obvious-looking fix.** "Require a message every N seconds and stop sizing deadlines against chunk cost" is unimplementable for the tool this protocol exists for: `generatePreview` is synchronous and cannot be interrupted, so a tool whose atomic unit takes 20 s physically cannot emit inside it. Any wall-clock interval short enough to be useful is one the flagship tool cannot honour, and a rule the flagship tool violates by construction is a rule that gets deleted. **Both deadlines therefore bound ONE generation at the largest reachable size, under load, and that is the quantity to re-derive when either number is next questioned.**

**Accepted residual, stated rather than papered over: `override_map_size 480` is outside both numbers.** A script that overrides to 480 generates against ~3.6× Giant's area, and the host cannot see the override when it arms the timer — it holds the lobby size, and the override lives in the script (Sec.2). Such a run may be killed as `unresponsive` while working correctly. The residual stays accepted, but **name the cheap fix as well as the expensive one, or the next reader prices it at `instantiateScript` and drops it**: the host is already holding the AST it is about to serialize, so scanning `script.sections` for an `override_map_size` before the first land command is O(items) and reuses the resolution rule PROTOCOL.md has to state anyway (Sec.2). **Identify "the first land command" through `def`, not through the token text** (Sec.2's coupling clause) — the host is holding `def` here, so this costs nothing, and disagreeing with `instantiate.ts` about where the window closes would make the timer protect a run the generator sizes differently. It fails only when the argument is a `#const` or an expression, which is a fall-back-to-the-lobby-size case rather than a blocker. Full `instantiateScript` on the host side is the exact version and is a real cost for a case no map on a maintainer's disk exhibits. Do not "fix" it by inflating the constants — that is the budget-not-measurement mistake CLAUDE.md names.

Both deadlines get a test that exercises the kill (Sec.9), and the test asserts against the derivation rather than the literal constants, so a re-measurement does not silently invalidate it.

### 4.2 Inbound validation and size caps

Validating host→tool (`params`) and edit bounds while leaving the direction that feeds the UI unguarded is the natural half-measure here. `ToolMessage` is a TypeScript type, which is a compile-time fiction for an external process: a v1.1 tool can emit malformed JSON, well-formed JSON that is not a `ToolMessage`, a `severity` with `level: "catastrophe"`, or a `table` whose `rows` are numbers. The reasoning behind edit-bounds validation — "a buggy external tool can emit anything" — applies verbatim.

**Specify runtime shape validation at the transport boundary**: one narrow validator per message kind, never trusting the discriminant, discard-with-visible-error (`reason: "protocol"`) on failure. One rule is named here rather than left implied, because Sec.2 delegates it to this section: **`table.rowSpans`, when present, must have exactly `rows.length` entries**, each a `Span` or `null`; a mismatch is a protocol error. It is the newest field on `OutputBlock` and it would otherwise ship unvalidated. Plus explicit caps, all `[tune]` and all stated so an implementer does not have to invent them: max **inbound** NDJSON line **8 MB**; max blocks per `ToolOutput` **1000**; max rows rendered per table **10,000** with a "showing first N of M" affordance; max text length per block **100,000** characters. A single 500 MB NDJSON line OOMs the host before any render-side cap can help. This is the v1.1 trust boundary's largest surface, larger than `params`.

**The cap governs tool→host only, and the outbound direction is the bigger number.** Stating 8 MB in a section titled "Inbound validation" and leaving the direction unwritten is how the payload that actually blows up ends up with no bound at all, which is what happened here for a revision. Measured 2026-08-10, `JSON.stringify(parseRms(source, language)).length` over the 32 maps on a maintainer's disk:

| map                    | source | JSON         | without `def` | ratio to source |
| ---------------------- | ------ | ------------ | ------------- | --------------- |
| `AK_Vanguard_v1.2.rms` | 358 KB | **13.97 MB** | 8.14 MB       | 40×             |
| `24hr_A Heart Map.rms` | 210 KB | **10.27 MB** | 5.13 MB       | 50×             |
| `13_Rings_v1.2.rms`    | 184 KB | 6.24 MB      | 3.41 MB       | 35×             |
| `AK_Namatjira.rms`     | 192 KB | 4.68 MB      | 2.51 MB       | 25×             |

**25 of 32 maps exceed 1 MB and 2 exceed 8 MB**, so under the natural reading of a single 8 MB cap the contract could not run the flagship tool on two of them. Re-measured 2026-08-13: **absolute sizes rose 6–15% since 2026-08-10 as the vocabulary grew, and the ratios did not** — `def` stripping still removes 41.7% of the worst map and ~49% of the corpus, against the 41% this section was written on.

**One honest discrepancy, recorded rather than reconciled away.** Two independent probes run on 2026-08-13 agreed on the _ratio_ to a tenth of a percent (−49.1% corpus-wide) and disagreed on the _absolute_ corpus total by 4.6% (85.4 MB against 89.5 MB), on nominally the same 32 files. Neither was re-run to convergence, because the number this section acts on is the ratio and the ratio is the one that reproduced. Read it as one more instance of the section's own thesis: **the derived quantity survived and the raw count did not.**

Three rules follow, and none of them is a bigger number.

1. **The 8 MB cap is inbound (tool→host) and stays.** No legitimate `ToolMessage` approaches it; it exists to stop a hostile or broken child process.
2. **The outbound `run` message is bounded by the payload, not by a constant.** Its size is a fact about the open script, and the biggest map on a maintainer's disk is the requirement rather than an outlier. Cap it at **32 MB** — comfortably above the measured worst case with room for `def` and for scripts larger than anything measured — and treat exceeding it as a host-side error naming the script, not a silent truncation.

   **`parseResult` is not the only term.** `ToolContext.referenceData` is a **~1.37 MB constant term on every run** that declares `read-reference` — which the flagship tool does — and it grew eightfold on 2026-08-12 without this section noticing (Sec.2). So the worst case is ≈ **9.5 MB**, not 8.14: the `def`-stripped Vanguard parse plus reference data. Nothing breaks, and the cap does not move. It is written down because a section that carefully measures one addend and silently omits a second invites the next reader to re-derive the cap from the wrong quantity — and because the omitted term is the one that grew by 8× in two days while the measured one grew by 6%.

3. **Strip `def` from the wire form, unconditionally.** Roughly 41% of the payload is `def` re-expansion: the AST holds one shared `CommandDef`/`ArgumentDef` per vocabulary entry and `JSON.stringify` has no back-references, so each is re-emitted at every node pointing at it. Sec.1 already requires every tool to build its own `LanguageIndex` from `referenceData.language`, so the def is one `Map.get` away for a named node.

   **The rule is every `def` field in the AST, of which there are exactly FOUR** — `ArgNode`, `CommandNode`, `AttributeNode` and `DirectiveNode`, all four already optional, so dropping them is type-legal rather than a widening. Naming only two is a silent shortfall: the 41% figure above was measured by dropping all four, **attribute nodes are by a wide margin the most numerous item in an RMS AST**, and a rule naming only `CommandNode` and `ArgNode` recovers a small fraction of it while nothing goes red, because the result is still under the 32 MB outbound cap. (These four were cited by line once and the citations were invalidated by this document's own parser amendment, which shifted the node types ~85 lines down **the same day it shipped** — a spec's citations can go stale on a file the spec itself asked to be edited.)

   **And the re-derivation recipe is one clause short for `ArgNode`.** An external tool resolves a `CommandNode`, `AttributeNode` or `DirectiveNode` def by name — one index lookup, with the alias caveat below. An `ArgNode` has no name: the route is name → `CommandDef` → `arguments[i]`, positionally, and **that positional identity is not guaranteed** — `consumeArgs` (`src/parser/parser.ts`) emits several `ArgNode`s sharing one `ArgumentDef` when `argDef.variadic` is set. Zero argument defs in `language.json` are variadic today (verified 2026-08-13), so this is latent rather than live, but the parser and the schema both support it and PROTOCOL.md is a published document. Give the recipe, and say it is positional only while no variadic argument exists. **The consequence is a capability rule and must be stated in PROTOCOL.md: an external tool that needs defs declares `read-reference` and looks them up.** In-process tools are untouched — structured clone preserves the sharing, so the defs cost them one pointer each.

   **"By name" is a token index away, and PROTOCOL.md is where that bites.** `CommandNode.name` and `AttributeNode.name` are **token indices, not strings**, and `DirectiveNode` has no `name` at all — it carries `hash: number` whose token text is the directive name. The lookup key is `tokens[node.name].text`. One clause, and an external author reading "resolve by name" without it writes a lookup against an integer.

   **A command's `def` is NOT a function of its name and the vocabulary — it also depends on the script's own `#const` table, and 581 corpus nodes take that path.** BUG-005 piece 2 landed 2026-08-13: `CommandDef` gained an optional `tokenId` in `language.json`, `LanguageIndex` gained a reverse index `commandsByTokenId`, and `Parser.aliasedCommand` runs for any word resolving as neither command nor attribute — it scans the preceding symbols for a `#const NAME <decimal>` and returns the command holding that token id. So `#const L 32` makes `L { … }` a `create_land`. Measured 2026-08-13 over the 32 maps on a maintainer's disk: **581 command nodes carry a `def` their name cannot recover**, all aliased `L` — 384 in `24hr_Petra.rms`, 197 in `24hr_Holler.rms`, zero elsewhere. An external checker doing `commandsByName.get("L")` gets `undefined` and sees an unknown command where the host sees a land; CREATION_PLAN 5.2's own `land_percent` over-allocation check then sums nothing across Petra's 384 lands and **reports a clean map**. Silent, in the "your map is fine" direction — the same failure shape the sentinel and the `def` typing were each fixed to remove, arriving this time through the recovery recipe rather than through the type.

   **The recipe therefore carries an alias clause, and PROTOCOL.md carries the algorithm** since an external author cannot read `parser.ts`. **The normative wording is the parser's rule stated exactly, because a paraphrase of it shipped here once and diverged from `Parser.aliasedCommand` in two expressible cases:**

   > For a `CommandNode` whose `tokens[node.name].text` misses your `commandsByName` index: among `parseResult.symbols`, take the **first** symbol whose `name` matches and whose `nameToken` precedes `node.name`. If that symbol is a `#const` (`directiveKind === "const"`) with a `valueToken` whose text is a bare decimal (`/^\d+$/`), the node's def is the command holding that `tokenId`. If it is anything else — a `#define`, a valueless `#const`, a non-decimal value — there is **no alias**, and you stop. Single-pass, first-definition-wins: a `#const` below a use does not reach back.

   **Three clauses do the work, and each is where a paraphrase drifts.**

   - **No "resolves as neither command nor attribute" precondition.** That phrasing makes a word that is an attribute name ineligible for aliasing. The parser computes the alias as the fallback of the **command lookup specifically** — `commandsByName.get(name) ?? this.aliasedCommand(name)` — independently of the attribute lookup, and applies Sec.4's context order (block → attribute first; statement → command first) _afterwards_. So at statement level `#const grouping 32` followed by `grouping { … }` is a `create_land` to the host, while a recipe-follower declines to alias it and is left with an unrecovered def on a node the host resolved. **For def reconstruction the precondition is not merely wrong, it is unnecessary**: the host has already committed the node to a `CommandNode`, so there is no context rule left to apply and no attribute to disambiguate against. Reconstruct a command's def as the command lookup with the alias as its fallback, and the divergence cannot arise.
   - **The scan stops at the first symbol bearing the name, whatever kind it is.** "Scan the symbols preceding it _for_ a `#const` of that name" reads as skip-until-match. `aliasedCommand` returns nothing the moment the first same-named symbol fails the test, so a preceding `#define L` **blocks** the alias outright and a recipe-follower seeing `#define L`, then `#const L 32`, then `L {` aliases a command the host refuses to. "First-definition-wins" gestures at this without saying the winning first definition can be a non-`#const` that kills the alias.
   - **"Preceding" is free in-process and is not free on the wire.** The parser's `this.symbols` is built incrementally, so _every_ symbol it can see is already a preceding one; `parseResult.symbols` is the **complete** table. An external tool must filter by `symbol.nameToken` against the node's own name-token index before taking the first match. Derivable — `SymbolInfo` carries `nameToken` — and exactly the kind of thing a recipe that says only "the symbols preceding it" leaves to be guessed.

   Everything it needs is already on the wire — `parseResult.symbols` (each `SymbolInfo` carries `name`, `directiveKind`, `nameToken`, `valueToken`), `parseResult.tokens`, and `CommandDef.tokenId` inside `referenceData.language`. Nothing new crosses the boundary. **Bounds worth stating, because they keep the rule small:** the alias path applies to **commands only** — `Parser.aliasedCommand` has exactly one call site, inside `parseNamedOrRun`'s command lookup, and attributes and directives resolve by name alone — and the value must be a bare decimal, so `#const L 0x20` does not alias.

   **Both divergences are latent, and that is the reason to write them down rather than the reason not to.** All 581 aliased nodes on a maintainer's disk are plain `L`, which is not an attribute name, and no map there shadows a `#const` alias with a `#define` (verified 2026-08-13). Same class as the variadic caveat above: expressible today, absent from an expert corpus, and a silent AST disagreement between host and tool in the "your map is fine" direction if it ever appears. Sec.9 item 11's fixture set gains one case for each — as prescribed it runs "a hand-built alias fixture and a real parse", and neither contains either, so today both would ride straight through the one gate built to catch recipe drift.

   **Do not hardcode the id.** `commandsByTokenId` holds exactly one entry today (`create_land = 32`) and is documented as carrying only the ids an RMSTEST run has measured. A tool that hardcodes `32 → create_land` is wrong the next time one is measured; a tool that reads `tokenId` out of the language data it was handed is not.

   **And do not read a `#const` bound to 32 as evidence of anything on its own.** Measured over the 32 maps on a maintainer's disk: **twelve distinct names are `#const`-bound to 32**, and exactly one of them — `L` — is intended as a command alias. The other eleven are terrain and layer constants (`SNOW`, `BASE_TERRAIN`, `TERRAIN_MASK`, `NEUTRAL_TERRAIN`, `LAYER_D`, `SPAWN_TERRAIN`, `VILLAGER_TERRAIN` and four more), because **32 is a perfectly ordinary terrain id as well as `create_land`'s token id**, and a script that writes `#const SNOW 32` is naming a terrain and has never heard of the alias rule. None of the eleven opens a block, so none of them aliases, and the census stays 581 all-`L`. **The clause that keeps it that way is "opens a block", and it is doing more work than it looks like** — the alias fires on the name's _position_, never on the binding, so a tool that scans for `#const NAME 32` and concludes anything about `NAME` is wrong eleven times out of twelve on this corpus. Reconstruct defs node by node, from nodes the host already made commands; do not go looking for aliases in the symbol table.

   **Re-derivation beats shipping the answer, and the reason is not "it matches the other two rules".** This is the third instruction of the same class as "build your own `LanguageIndex`" and "resolve `override_map_size` yourself", but that is a resemblance, not an argument — and unlike those two, here the host **has already computed the answer and the wire throws it away**, which is a real asymmetry that deserves a real answer. The obvious alternative is to carry a side table of resolved names for the nodes whose lookup fails, and it is nearly free: measured 2026-08-13, that table is **11.8 KB across the whole 32-map corpus** (8,065 B for Petra, 3,982 B for Holler) against a 43.4 MB `def`-stripped payload — **0.027%**. Cost is not what rejects it. **Transport invariance is.** Goal 1 requires that a tool compile and run correctly in-process _and_ over the wire without knowing which it got; a side table is populated only over the wire, so a portable tool reading it gets nothing in-process and needs two code paths — the exact defect this design exists to avoid. The scan-the-symbols algorithm reads `symbols`, `tokens` and `referenceData.language`, all of which are identical on both transports, so **one code path is correct in both**. Recorded rather than merely decided, because the cheap-and-wrong option is the one the next reader will reach for first, and its cheapness is real.

**None of this touches the in-process transport, and the reason is worth knowing:** `postMessage` to the tool worker uses structured clone, which preserves shared references within one clone operation. The re-expansion is an artefact of JSON having no back-references, so it is an external-transport cost specifically — which is also why calling it "per-run (fine)" is too breezy: a 14 MB write into a child process's stdin is a different sentence from "fine".

### 4.3 Staleness, and the guard that actually matters

**The version-based guard does not catch a stale _parse_, which is the corruption path that exists.** The worker's parse lags the model by design: `useParsedDocument.ts` debounces keystrokes (150 ms) and drops out-of-order responses by `requestId` (verified 2026-08-10). So at Run time `parseResult.source` can already differ from `model.getValue()`. The tool computes offsets against text that is not in the model, nothing changes the model during the run, a version comparison passes, and Apply lands N edits at wrong offsets. Same-version garbage, silently — the class BUG-001 was.

Pin these:

1. **`ctx.source` and `ctx.parseResult.source` are the same string, always.** That string is "the run's document snapshot" everywhere this document uses the phrase, including `codeRef` spans.
2. **Run is gated on `model.getValue() === ctx.parseResult.source`**, and Apply re-checks the same equality — not a bare version comparison. `ParseResult.source` exists precisely for this and CodePane already uses it that way.
3. If a version id is kept at all, use **`getAlternativeVersionId()`** (matching `useDocument.ts`'s `savedVersionIdRef`), so edit-then-undo back to the snapshot re-enables Apply instead of disabling it forever.
4. **Run is disabled for `read-ast` tools until the first parse lands** — `parseResult` is `ParseResult | null` until then. That is the cold-start case only; item 5 is the one that bites in normal use.
5. **Run calls `reparseNow(model.getValue())` and starts when the matching parse lands.** The gate in item 2 is _false_ for the whole 150 ms debounce window after every keystroke plus the parse itself (`useParsedDocument.ts` sets `DEBOUNCE_MS = 150` and drops out-of-order responses by id) — so a Run pressed just after typing would do nothing, with no affordance, which is the shape of bug users report as "the button is broken". The mechanism already exists and this document already prescribes it for Apply: `reparseNow` (`useParsedDocument.ts`, the BUG-001 Part B fix) bypasses the typing debounce for a programmatic event, and pressing Run is the same shape. Show a brief "parsing…" state rather than a disabled button.
6. **`ctx.parseResult.script` must be the parse of `ctx.parseResult.source` — string equality does not prove it.** Pins 1 and 2 hold only while the only way to hold a `ParseResult` is to parse something, and that stopped being true: `truncateAst` (Sec.2) produces one whose `script` is a prefix and whose `source`, `tokens`, `symbols` and `diagnostics` are the whole document's, and it satisfies every guard above. So the guard is on **provenance, not equality**: the context builder reads `ParsedDocumentContext`, which holds the parse of the model's text and nothing else, and `truncateAst`'s output is the counterexample to point at when someone asks why the rule is not just `===`.

### 4.4 Stale-run message rejection

Neither message type carries a run id, and the discard rule is "messages after a terminal are discarded" — but a cancelled run never sends a terminal, it has up to the full cancel grace (30 s, Sec.4.1). If the host spawns run B without waiting, run A's late `partial` replaces B's output area, because `partial` is a full redraw. For external tools it is worse: a SIGKILLed process can be writing to stdout for the whole grace window.

**Close it host-side: drop any message whose worker/child-process handle is not `currentRun.handle`.** One worker per run means every run already _has_ a unique identity; the host holds it and its `onmessage`/stdout reader compares. Costs nothing, requires nothing of tool authors, and closes the grace window and the SIGKILL-flush window completely.

**Do not add `runId` to the wire contract.** It makes correctness depend on every external author echoing a field, and a tool that echoes it wrong has _all_ its output silently dropped — a new failure mode, in the direction Sec.4.2 establishes we cannot trust. The one thing it buys is disambiguating a shared transport, and there isn't one.

### 4.5 Edits are proposals

A terminal `result` with `edits` does NOT auto-apply: the pane shows an "Apply N changes" button (plus per-edit `codeRef`s if the tool listed them in output).

**Undeclared-capability edits are rejected:** a `result` carrying `edits` from a tool whose manifest lacks `edit-source` has its edits **dropped** with a visible warning block — never applied. Capability enforcement runs on both directions of the contract.

**On Apply**, in order:

1. **Validate**: overlap, and malformed bounds — `start > end`, negative offsets, `end` beyond the snapshot length. **ANY violation rejects the whole set** with an error block. A buggy external tool can emit anything and the staleness guard alone does not catch same-version garbage.
2. **Re-check the Sec.4.3 source equality.** If it fails, Apply is disabled with "the code changed while the tool ran — re-run". **Never rebase tool edits; re-run.**
3. **Apply all N as one `pushEditOperations` batch = one undo entry.** The function to do it does not exist yet: `useDocument.ts`'s `applyTextEdit` takes exactly **one** edit and converts offsets to a `monaco.Range` via `getPositionAt` (re-verified 2026-08-13 — still single-edit), so calling it N times produces N undo entries and breaks this document's central promise. **Name the work: `applyTextEdits(edits: TextEdit[])`**, converting all N and passing one array.
4. **Then call `reparseNow(source)`** — stopping at `pushEditOperations` is the natural place to stop and it is one step short. Breakdown's discrete-edit path already does this (`useParsedDocument.ts`, the BUG-001 Part B fix) to skip the 150 ms typing debounce, because a programmatic edit is one event with nothing to coalesce. A tool's Apply is the same shape.

**Two clarifications that stop an implementer fixing the wrong thing:**

- **The descending sort is not the mechanism.** "Sorted descending by `start`" reads as load-bearing and is not. Descending order is what manual string splicing needs, whereas `pushEditOperations` takes ranges in original coordinates and handles ordering itself. Harmless to sort, but stating it as the mechanism invites a later "fix" of the wrong thing. What Monaco does require is non-overlap, which step 1 already validates.
- **`rebaseEdit` (`breakdown/ephemeralAnchors.ts`) is NOT for tool edits.** It exists for Breakdown's in-flight anchors during rapid consecutive edits. The "never rebase, re-run" rule above will read as contradicting a function sitting right there in the codebase unless this is said.

**Undo reachability.** "One undo entry" is only useful if Ctrl+Z reaches it, and Monaco's binding needs a mounted editor, which the Tools tab does not have. It works only because of the window-level `keydown` listener in `useDocument.ts`, which steps aside when the event originates inside a mounted Monaco editor. Worth a test.

## 5. The pane (host UI, 5.1 implementation scope)

`Select Tool` dropdown (from registered manifests) → params form (from `manifest.params`, typed like Sec.3.4 breakdown editors, HelpTips per convention) → Run/Cancel button → progress bar (`progress` messages) → output area (rendered `OutputBlock`s) → Apply-edits button when present. "Waiting for tool selection…" empty state per the mockup.

**Param validation at run time, not just registration:** the host validates and clamps submitted values against each `ToolParamDef` — min/max, options-membership, and for `multiSelect` that every selected value is an option **and that the selection count is within `minSelected`/`maxSelected`** — before they enter `ctx.params`. The count bound is the one that gets forgotten: min/max, options-membership and every-value-is-an-option all pass an EMPTY selection, and the parameter that motivated `multiSelect` (the 2/4/6/8 player-count matrix) is meaningless empty. Both bounds are optional and absent means unbounded, including empty. Implicit while the host owns the form; stated because v1.1 makes `params` part of the trust boundary and manifests arrive from strangers.

**The same bounds are checked at REGISTRATION, against the manifest's own `default`.** Sec.2 already pins that a `select` default must be one of its options and that the host validates it at registration; a `multiSelect` declaring `default: []` alongside `minSelected: 1` passes every check above and every check below, and ships a form that cannot be submitted as authored. One line, in the same place the `select` default is checked: **a declared default must satisfy its own declared constraints** — which is the rule `npm run validate:reference` already enforces on `language.json` arguments, for a defect that reached the corpus 461 times.

**Concurrency — pinned: one run at a time, app-wide.** Not per-tool: a single active run means one run-state in `host.ts`, one document snapshot for the staleness guard, and one progress surface. Switching tools or re-running while a run is active cancels the current run after a confirm.

**A run is pinned to a document, and the document can be replaced.** `useDocument.ts` holds **one module-level Monaco model** for the app's whole lifetime (`documentModel`, `monaco.editor.createModel` at module scope) and File → Open calls `documentModel.setValue(text)` rather than creating a new model (both re-verified 2026-08-13). So "the document" can become an entirely different script mid-run. **Cancel the run when the open document is replaced** (File → Open / New), next to the tool-switch rule. Without this the run keeps burning CPU against a closed script, and `codeRef` jumps still fire against it with the soft "code changed" notice — which badly understates "you are looking at a different file" (Sec.2's `codeRef` wording handles that half).

**Echo the run's settings into the output header.** `playerCount`, `mapSize`, teams and any params are live app state snapshotted at `run`, and the flagship tool's entire output is conditioned on them. Change the player count mid-run and the pane shows results computed for the old value, labelled with nothing. This needs no guard — a header line ("run at 8 players, Normal / 200×200, 2v2v2v2") makes a stale result self-describing instead of silently wrong, and it is where a tool's seed param belongs too.

**`ui-help.json` entries the pane owes (re-measured 2026-08-13).** CLAUDE.md's hard rule is a HelpTip plus a matching `ui-help.json` entry for every interactive element, as it is built. The file has **108 entries** and exactly two tools-adjacent ids — `tabBar.advancedTools` and `settings.tab.advancedTools` — neither inside the pane. Name these now so the 5.1 session cannot skip them: `tools.select`, `tools.run`, `tools.cancel`, `tools.progress`, `tools.apply`, `tools.log`, `tools.output`, and **`tools.params`** — eight, the last because this section's closing open question resolves by making `tools.params` document the param form. For scale, `preview.*` carries **16** ids for a pane of comparable complexity; that is the bar, and eight against sixteen is a floor rather than a target. (This entry total sat at 101 against a measured 108 for a whole revision, which is why Sec.9 item 10 now generates it.)

**The Settings tab this pane already has (unchanged and re-verified 2026-08-13, the fourth consecutive round to record it).** `src/components/settings/AdvancedToolsSettings.tsx` ships today, is wired into the Settings dialog, and its `SettingsPlaceholder` still reads "The Advanced Tools pane itself hasn't been built yet, so it has nothing to configure" — which stops being true in 5.1. **5.1 inherits it as an obligation rather than a claim.** It owns the second of the two tools-adjacent help ids above. Decide in 5.1 what it acquires (tool enable/disable is the obvious candidate; default params and the v1.1 registry URL are not v1) and rewrite that copy in the same session, or the app ships a settings tab telling the user a feature does not exist while they are using it.

**Open question, deliberately left open: who owns help text for a host-rendered, tool-authored param row?** They are generated from `manifest.params`, so their text comes from `ToolParamDef.help`, not `ui-help.json` — "every interactive element gets an entry" and "external manifests supply their own strings" collide here, and v1.1 makes the collision a trust question (a manifest from a stranger writing UI copy). v1 resolution: `ToolParamDef.help` renders inside the row, and `ui-help.json`'s `tools.params` entry documents the _form_ rather than any individual row. Revisit before v1.1.

## 6. Capabilities and trust

v1 built-ins are trusted code; capabilities still gate what the host puts in `ToolContext` (least privilege keeps the contract honest). **The checker declares `read-source`, `read-ast`, `read-generation-settings`, `read-reference`** — all four, including `read-reference`, without which Sec.2 says the tool could not run on the declared context at all. This list is the one an implementer copies into the exemplar manifest, so it is the one that has to be complete.

v1.1 external tools: the manifest's declared capabilities are shown in the install/run consent dialog ("This tool can read your script and propose edits"); `edit-source` never auto-applies (Sec.4.5 already guarantees this); undeclared context fields are simply absent. The process-level risks (arbitrary code execution) are handled by the v1.1 trust flow per PLAN.md (unvetted warning + curated registry) — out of scope here, but the contract deliberately gives external tools no ambient authority beyond their stdin.

**Naming note:** PLAN.md:56 says the external manifest carries "permissions". `capabilities` is the better name and supersedes it; noted before v1.1 manifests exist in the wild.

## 7. Built-in registry (v1)

`src/tools/registry.ts` exports `TOOLS: ToolImplementation[]`. 5.2's checker is the flagship; a second cheap tool ("Script Statistics": counts of commands/attributes/constants, token count, expression count — pure read-ast, finishes instantly) ships alongside as the protocol's trivial exemplar and smoke test. The formatter and constants auditor (CREATION_PLAN 5.2b) slot in later without API changes.

## 8. File layout

```
tools-api/
  index.ts          every type in Sec.2 + Sec.4; the contract. Type-only imports from
                    src/parser (ParseResult, Span, LanguageData) are allowed and real —
                    "no app imports" is false as a flat statement. The rule is: NO RUNTIME
                    imports (nothing executable crosses in), and the published artifact is
                    a BUNDLED .d.ts (api-extractor/dts-bundle style) that flattens the
                    parser types in — possible precisely because they are plain-data
                    interfaces. Inverting the dependency (parser imports the contract) was
                    considered and rejected: the parser predates and outranks the tools API.
  generated/        PublishedGameConstants, generated from reference/schemas/*.schema.json
                    (Sec.2 — the name is deliberately not GameConstantsData, which two
                    in-repo narrow views already use)
  PROTOCOL.md       prose spec of Sec.4 for non-TS tool authors (v1.1; stub now).
                    Must carry: the sentinel encode/decode AND that it is external-wire
                    only (Sec.4), the prohibited value set (Sec.1), "build your own
                    LanguageIndex", "the wire form has no `def` — look it up in your
                    index" PLUS the re-derivation recipe and its caveats (name
                    lookup for command/attribute/directive, where the name is
                    `tokens[node.name].text` and a DirectiveNode carries `hash`
                    instead; positional for ArgNode, and positional only while no
                    argument def is variadic — Sec.4.2), THE ALIAS ALGORITHM
                    VERBATIM AS SEC.4.2 STATES IT — a CommandNode whose name misses
                    the command index takes the FIRST preceding same-named symbol,
                    aliases only if that symbol is a `#const` with a bare-decimal
                    value, and stops otherwise; commands only; "preceding" means
                    filtering `symbols` by `nameToken`. **Do NOT paraphrase it** — a
                    paraphrase shipped here once and diverged from the parser in two
                    expressible cases (Sec.4.2). The reason a tool must re-derive the
                    alias rather than be handed it is transport invariance (Sec.4.2),
                    the rule that spans are offsets while any location named in PROSE
                    is a 1-based line number converted through
                    `parseResult.lineOffsets` (Sec.2), the override_map_size
                    resolution rule INCLUDING that a land command is identified AFTER
                    the alias resolution above, since an aliased `L { }` closes the
                    override window (Sec.2), the selection-is-an-anchor note, and the
                    per-language cancel-delivery recipe (Sec.10).
src/tools/
  registry.ts       TOOLS list
  host.ts           run lifecycle, worker plumbing, cancellation, both watchdogs,
                    inbound validation, staleness guard (no React)
  ToolsPane.tsx     Sec.5 UI
  toolWorker.ts     worker entry for built-in tools
  builtin/
    scriptStats.ts  Sec.7 exemplar
    consistencyChecker/   (5.2)
  __tests__/
    protocol.test.ts   Sec.9 round-trip + lifecycle tests
```

**`tools-api/` at the repo root is partly outside the typecheck gate — fix this in the session that creates the directory.** `tsconfig.json` is `"include": ["src"]`, which reads as "`tsc --noEmit` would never see a root-level `tools-api/index.ts`". That reading is false and the next reader will check it: `include` sets the _root_ file set, and TypeScript still adds and checks every file reached by an import, so the contract is typechecked from the moment `src/tools/registry.ts` imports it. What genuinely escapes is **a `tools-api/` file that nothing under `src/` imports** — `generated/PublishedGameConstants` is exactly that until the flagship tool consumes it — plus the ESLint purity gate, whose globs name three `src/` directories explicitly (`eslint.config.js`). The prescription: **either add `tools-api` to `include` and to the purity globs, or put the contract under `src/`.** Re-verified 2026-08-13. Decide it in the same session as `mkdir`, or the contract ships untypechecked and nobody finds out.

## 9. Test plan

These are the surviving obligations of seven review rounds, not a substitute for review.

1. **Serialization round-trip, in two halves with two different matchers.**

   (a) **Hand-built fixtures under `toStrictEqual`**, in two groups. _Must round-trip_: every `ToolMessage` kind, and a `ToolContext` whose AST contains an `inf`/`-inf` argument **and an `rnd` with an infinite bound** (the second numeric position in `ArgValue`, which `JSON.stringify` turns into `{"rnd":[null,1]}` today), asserting the sentinel survives intact in both. _Must be rejected by the serializer before it ever reaches the wire_, each asserted as a thrown/reported error rather than as a silent shape change: an array containing `undefined` (JSON would make it `null`), a `Map`, a `Set`, and a `NaN`. `toStrictEqual` is right for the first group because the fixtures are ours and carry no incidental `undefined`-valued keys.

   **Plus an aliased-command fixture:** `#const L 32` plus an `L { land_percent 20 }` block, asserting that a consumer holding only the wire form still reaches `create_land`. Delete the alias clause from the decode helper and it goes red — that is the mutant. **Hand-built deliberately, not corpus-driven**: the only two maps carrying the construct are `24hr_Petra.rms` and `24hr_Holler.rms` and **neither survives a clone**, so a corpus assertion would be green-by-absence on CI. Same defect as aiming a gate at the half that cannot go red, recurring on new data, which is why it is called out rather than left to be inferred.

   (b) **A real `parseRms` result over a corpus map under `toEqual`**, plus a scanner asserting the prohibited set directly (no array element `undefined`, no `Map`/`Set`/`Date`/`RegExp`/function, no non-finite number outside a sentinel). `toEqual` here is deliberate and is not a weakening: Sec.1 tolerates `undefined`-valued keys on optional properties precisely because they read identically on both sides, and `toEqual`'s one documented blind spot is exactly that tolerance. It still catches `undefined` vs `null`, so the array case — the one that changes a value — goes red. **A blanket `toStrictEqual` here fails on its first run against real input** (4,017 such keys across that corpus, measured 2026-08-13), and the only readings of that red are "the fixture is wrong" or "strip 4,017 keys per run".

   Mutation-test both halves per CLAUDE.md — put a `[undefined]` into the fixture and confirm (a) goes red. **Aim the sentinel mutant at (a), not at (b): against (b) it cannot go red.** (b) runs over a real corpus map, and measured 2026-08-13 across all 32 maps on a maintainer's disk there are **zero occurrences of `inf` or `-inf` as a word and zero numeric literals of 20+ digits** — there is no non-finite value anywhere in the corpus, so dropping the sentinel encode changes nothing (b) can observe and the scanner stays green. That matters more than a wording slip, because this is the only enforcement that the external serializer encodes at all (the types cannot see it, Sec.4), and the one gate on that behaviour was once aimed squarely at the half that cannot fail. (a) carries an `inf` argument by construction, so it kills the mutant. If a corpus-scale exercise of the encoder is wanted as well — and it is worth having, since (a)'s fixtures are small and hand-built — the cheap version is a fixture map: take a map that survives a clone, append lines using `inf`, `-inf`, an `rnd` with an infinite bound and a 400-digit literal, and park it in `test-maps/broken/`, which exists for exactly this deliberately-degenerate, not-corpus-gated tier.

   **Whitelist that fixture in `.gitignore` in the same commit that creates it, or the gate goes back to being green-by-absence.** `test-maps/broken/` is inside `.gitignore`'s `test-maps/*`, and git does not descend into an excluded directory, so a negation naming a file underneath it cannot re-include it — verified 2026-08-13 with `git check-ignore`, which reports a new file there as ignored by `.gitignore:44`. `test-maps/broken/BCC2-Rekawa.rms` is tracked today only because it was force-added: the whitelist line is `!test-maps/BCC2-Rekawa.rms`, which names the **top-level** path, not the one the file actually sits at. So re-including the directory needs its own line. Same rule, same reason, as CLAUDE.md's "new dependency ⇒ say `npm install` in the same breath": the sentinel encoder's only mutation gate is worth exactly as much as its fixture's reachability on a clone.

2. **The neighbouring spec's input type is constructed from this one.** A test that builds a `PreviewSettings` out of a `ToolContext` and calls `generatePreview` with it.

   **It reads like four lines, and writing those four lines is what found the sentinel's scoping bug** — under a both-transports sentinel it does not compile, because `ctx.parseResult` is `SerializedParseResult` and `generatePreview` takes a `ParseResult`. Written against Sec.4's rule it becomes the thing that keeps that rule honest: the test takes a `ToolContext<ParseResult>` (the in-process form), passes `ctx.parseResult` straight to `generatePreview`, and narrows `settings` through `isMapSize`/`isTeams`. It stops compiling if the sentinel is ever re-scoped to both transports, which is precisely the change that would silently break the flagship tool again.

   Why this one earns its place: **three consecutive revisions of this document were broken by the same dependency.** `settings.mapSize` was typed `number` when the app had a string union; `mapSize.tiles` had no source of truth while the data had one, in a directory the search did not cover; `settings` was missing `teams`, which the app had grown three weeks earlier. Each was caught by a human reading two documents side by side, and each was filed as "a cross-doc data dependency same-author review structurally misses" — a rule that failed three times, because it asks a reader to notice an absence. This test **stops compiling the day `PreviewSettings` grows a required field**, which is precisely the event all three are instances of. Prefer the compile error to the rule, for the same reason this project prefers an observable to an argument.

   State its limits honestly rather than overselling it: it catches added _required_ fields and changed types. It does not catch a new optional field, or a field whose meaning changes under a stable type. Nor does it catch the _reverse_ dependency: `PreviewSettings` gaining a field is caught, `ToolContext` gaining a field that `PreviewSettings` should have consumed is not — which is exactly what `teams` was, the app growing a concept while two documents disagreed about who owned it. Those still need a reader, so this test does not retire Sec.10.2's standing instruction.

   **And a fifth limit: it watches ONE seam.** The Current/Final cut point broke this document four days after this test was designed to end that class, and item 2 cannot see it — the test type-checks `ToolContext` against `PreviewSettings`, while the cut is a _caller_ concern that `generatePreview` deliberately knows nothing about (`index.ts`'s own 4.3 header pins that). A compile error beats a rule only where the two types actually meet; the app keeps growing concepts at seams where they do not. Sec.10.2 names where to look.

   **Ordering: UNBLOCKED. The parser-design amendment landed 2026-08-11**, so item 2 can be written first as intended, typed `ToolContext<ParseResult>` from the outset. `src/parser/types.ts` carries the two defaulted parameters; `src/parser/__tests__/wireTypes.test-d.ts` is the standing gate on the assignability property `ToolContext<ParseResult>` → `ToolContext` rests on. What is still 5.1's to write is `SerializedParseResult` itself — the parser owns the parameters, this document owns the instantiation `ParseResult<number | { inf: 1 | -1 }, NoDefs>` and the sentinel it names.

   One friction point to expect when it is written: `generatePreview` wants `PreviewReferenceData = { language: LanguageIndex; constants: readonly ObjectConstant[] }` (`generator/index.ts`), and `ObjectConstant.resourceAmounts` is `Readonly<Record<string, number>>`. A schema-generated `resourceAmounts` is an interface with four optional number properties, and an interface gets no implicit index signature, so it is not assignable to `Record<string, number>` under `strict`. Today's direct JSON import dodges this because inference gives each row its literal shape. **If the test fails there, the fix belongs in `ObjectConstant`, not in the generated type** — nobody should "fix" the generator to match a consumer's convenience projection.

3. **Lifecycle.** progress→result ordering; message-after-terminal discarded; cancel synthesizes `reason: "cancelled"`; worker-crash synthesizes error; synchronous throw from `run` synthesizes error; **cancel against a deliberately non-chunked busy-loop tool hard-kills at the cancel-grace deadline with `reason: "killed"`**; **a tool that emits nothing at all is killed by the run watchdog with `reason: "unresponsive"`**. Assert against the constants the host actually holds, not against literal `30_000`/`60_000` in the test body, or the next re-derivation (Sec.4.1 has moved both twice) silently invalidates them. The kill paths are exercised, never assumed.
4. **Stale-run message rejection** (Sec.4.4): cancel A, start B, A emits `partial`, assert B's output survives.
5. **Malformed inbound messages** (Sec.4.2): invalid JSON, valid JSON that is not a `ToolMessage`, an out-of-enum `severity.level`, a table with non-string rows, **a `table` whose `rowSpans` length does not match `rows` length**, and an over-cap line — each discarded with `reason: "protocol"` and a visible error, never rendered.
6. **Capability enforcement, both directions.** A tool without `read-source` gets no `source` — the context path, which is the half that gets left untested — and a tool without `edit-source` has its edits dropped with a warning.
7. **Edit application.** N edits as a **single undo entry**; overlap rejection; malformed-bounds rejection of the whole set; the Sec.4.3 source-equality gate blocking Apply after a model change; **Apply re-enabled after undo back to the snapshot**; `reparseNow` fired after apply.
8. **Document replace** (Sec.5): start a run, open a different file, assert the run is terminated and Apply is gone.
9. **scriptStats end-to-end** through the real pane.
10. **Data readiness, as a reporter rather than a gate** (Sec.10.1): `src/tools/__tests__/dataReadiness.measure.test.ts`, re-deriving the 5.2 readiness figures from the data files on every run. It asserts nothing about the counts — it exists so the numbers in a spec can be a pointer instead of a liability. **Include `ui-help.json`'s entry total and its `preview.*` / tools-adjacent id counts in the same reporter**: it is a data file in the directory this test already reads, Sec.5 sets the pane's help obligation against those exact numbers, and that is the one count in this document that went stale for a whole revision.
11. **`def` reconstruction from the wire form — the gate the whole stripping decision was missing.** Reconstruct every stripped `def` from `SerializedParseResult` using only what crosses the boundary — `tokens`, `symbols` and `referenceData.language` — and assert it equals the in-process `ParseResult`'s `def`, node for node, over **both** a hand-built alias fixture and a real parse.

    **Four fixtures, not one.** A hand-built-alias-plus-real-parse pair catches neither of the two divergences in Sec.4.2's alias clauses, so three more are named. Each is under ten lines of RMS, and each is the executable form of a clause Sec.4.2 states in prose:

    | Fixture                                     | Shape                                             | What goes red without the clause                                                                                                                             |
    | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | (a) plain alias                             | `#const L 32` + `L { land_percent 20 }`           | the alias clause at all — item 1's mutant                                                                                                                    |
    | (b) attribute-name alias at statement level | `#const grouping 32` + `grouping { … }`           | the "no _neither command nor attribute_ precondition" half: a recipe that gates aliasing on the name missing the attribute index leaves this def unrecovered |
    | (c) `#define`-shadowed `#const`             | `#define L` + `#const L 32` + `L { … }`           | the "first symbol wins whatever it is" half: a skip-until-match reader aliases a command the host refuses to                                                 |
    | (d) alias closing the override window       | `#const L 32` + `L { }` + `override_map_size 300` | Sec.2's coupling clause: a by-name land-command test honours an override the host ignores, and the tool computes against a different grid                    |

    (d) is not a `def` reconstruction test and is listed here anyway, because it is the same input shape and the same one mutant kills it — it belongs wherever the override rule is exercised. **None of the four is corpus-driven**, for the reason item 1 already gives: the only maps carrying any of these constructs are `24hr_Petra.rms` and `24hr_Holler.rms`, neither survives a clone, and (b), (c) and (d) have **zero instances even on a maintainer's disk** (verified 2026-08-13). A corpus assertion here would be green-by-absence twice over.

    **Why this earns its place, stated as the limit rather than the promise.** Sec.4.2 strips `def` and hands external tools a recovery recipe, and that recipe was enforced by prose in two documents and by nothing executable. The cost of that is measured: the recipe was correct on 2026-08-11, silently wrong on 2026-08-13 when the parser learned to resolve a command through the script's own `#const` table, and **no test this document prescribed could have gone red**, because none of them asserts that a def is recoverable at all. This one goes red the day recovery breaks — which is the day the parser learns a new way to resolve a name, an event that has happened once and is scheduled to happen again every time an RMSTEST run measures a `tokenId`.

    It is the same move as item 2 and for the same reason: **prefer the executable check to the standing instruction**, because the instruction asks a reader to notice an absence and this document has watched that fail five times. Its honest limit is that it verifies the recipe _this document publishes_ against the parser's behaviour; it cannot tell you that an external author in another language implemented the recipe correctly. That remains PROTOCOL.md's job and a conformance fixture's, neither of which exists in v1.

## 10. Known risks and open questions

- **`partial`-as-full-redraw may be slow for huge tables.** Mitigated by Sec.4.2's row cap plus a "show all" affordance; not measured.
- **`ParseResult` serialization cost for external tools is per-run and it is 14 MB on the worst map measured** (Sec.4.2 has the table and the `def`-stripping decision). "Fine" with no number attached is the easy thing to write; a 14 MB write into a child process's stdin deserves the number. The v1.1 process spawn must send context _after_ the consent gate, not before. **Add `referenceData` to that write: another ~1.37 MB on every run that declares `read-reference`, constant, and eight times what it was on 2026-08-11** (Sec.4.2 rule 2, Sec.2).
- **The 30s cancel grace and SIGKILL need Windows-specific testing** under Tauri's shell plugin.
- **`OutputBlock` deliberately has no markdown** — resist adding it until a sanitization story exists.
- **`apiVersion` checking must reject, not warn**, or v1.1 tools will depend on leniency.
- **The chunked-cancel recipe is JS-shaped.** A single-threaded Python tool blocking on `stdin.readline()` while working never sees `cancel`. PROTOCOL.md needs a per-language delivery recipe (non-blocking stdin poll between chunks, or a dedicated reader thread setting a flag) before v1.1 ships. Note this interacts with the run watchdog: a tool that cannot see `cancel` also cannot emit between chunks, so it will be killed as `unresponsive` — which is the correct outcome and should be documented as such rather than discovered.
- **5.2 will find the Monte Carlo budget does not close.** The assumption is **`CREATION_PLAN.md:285`** — "1000 runs of a heuristic generator should be seconds, not minutes" — and it is that document alone; PLAN.md contains no run count and no timing claim, so do not go looking there. At the measured median of ~460 ms per generation, 1000 runs is roughly **8 minutes for one player count and ~30 for the 2/4/6/8 matrix**, and Sec.4.1's re-measurement makes the tail worse than the median implies: the heavy corpus maps cost 2–4 s per generation at Normal on an ordinary machine, before any load factor. `collectSnapshots: false` is the only cost knob the generator offers and its effect has never been measured. This is a 5.2 problem, not a 5.1 one, but **the protocol's progress/cancel/`partial` design is sized by it** — which is most of why those three exist.

### 10.1 The 5.2 data-readiness warning

The original warning said the checker's static layer keys on `resourceAmounts`/`constId`, which are "all placeholders until Phase 4.0 lands". **That has not been true since 4.0 and will be ignored the first time someone checks the file.**

**It was replaced with five counts, and those counts were then refreshed twice, with three of the five moving inside a day each time. Do not refresh them a fourth time — build the reporter.** Prescribed: **`src/tools/__tests__/dataReadiness.measure.test.ts`**, re-deriving each figure below from `game-constants.json`, `language.json` and the schema on every run, in the shape `rms0201.measure.test.ts` / `rms0304.measure.test.ts` / `rms0315.measure.test.ts` already established. Carry the caveat CLAUDE.md records about those four: **they print nothing without `--disableConsoleIntercept` and still exit 0**, which is indistinguishable from a check that found nothing.

What the reporter must report, and what was true on 2026-08-11 — read as shape, not as input to code:

- **`resourceAmounts` coverage, and whether the rows behind it are `verified`.** It has read 8 rows, then 23, and is **170** as of 2026-08-13 (168 of them `verified`), because 4.10 brought the roster. So this warning has weakened twice and by an order of magnitude — read it as "largely discharged, verify before relying on it" rather than as a number. The remaining soft spot is specific rather than general: **FISH and SHORE_FISH are still `verified: false`**, the pair CLAUDE.md's Phase-4 row flags as suspect (the dat reports no resource storage while the entries claim 200 food).
- **Terrain verification.** 116 of 131 terrain rows are `verified: false` (community-sourced) — the one figure in this section that has held across every re-measurement, now five in a row.
- **`language.json` verification, both halves.** **40/41 commands and 40/94 attributes**, re-measured 2026-08-13 and reproducing exactly. An earlier "28/41 and 38/94" was wrong in both halves; the correction stuck.

**A deliberate non-change, because the obvious edit here is the wrong one.** A fresh set of counts for every line above has been available and is not folded in. This section's own standing instruction is _do not refresh them a fifth time — build the reporter_, and taking a fresh transcription would be the fifth. What was folded in is the one figure whose **shape** changed (`resourceAmounts`, an order of magnitude, which changes whether a 5.2 session should worry) and the two that **held**, since a claim surviving a re-measurement is worth recording as durable. The rest stay as they are, wrong and dated, until item 10 makes them generated. **A spec that keeps its numbers fresh by hand is a spec that has decided not to build the reporter.**

**And the strongest argument for that reporter is the review round that found nothing here.** On the evening of 2026-08-13 every count in this document reproduced to the unit — the `game-constants.json` set, the `language.json` command and attribute counts, the schema's property and enum shape, `tokenId`, the alias census. The first round in the series where none moved, and it cost a session of hand-derivation to establish. **Item 10 would have produced that result for free, on every run, forever.** The one number a reporter would have caught is in Sec.5, not here: `ui-help.json` sat at 101 against a measured 108 for a revision, and `ui-help.json` is a data file in the same directory item 10 already reads.

- **`src/parser/resourceTotals.ts` DOES model script-level resource modifiers, and the warning that said otherwise was wrong twice over.** `effect_amount <effect> <target> ATTR_STORAGE_VALUE <n>` has been modelled since 2026-08-11 (conditional overrides widen the reported range, unconditional ones replace the base). CLAUDE.md recorded it as built _and inert_, because at the time no `effect_amount` target hit one of the 16 rows carrying a yield. **4.10 ended the inertness on 2026-08-12.** Measured 2026-08-13 by running the real `computeResourceTotals` over each map twice, once as written and once with every `effect_amount` line blanked: **27 of 32 maps contain `effect_amount` and 5 of those now have different totals because of it** — `24hr_Holler.rms` reports 4,100 wood against 1,169,100 with the overrides removed, `24hr_Petra.rms` 5,592,000 against 2,796,000, `AK_Namatjira.rms` 1,909,000 against 954,500. So a resource-based static finding is sensitive to a path that produced identical numbers a week ago. What is _still_ open: `GAIA_SET_ATTRIBUTE` vs `SET_ATTRIBUTE` ownership, `GAIA_UPGRADE_UNIT`, and path correlation — all three named in `resourceTotals.ts`'s own header, and none of them visible to the reporter.

  **This is the only decay in this document that ran the other way, and Sec.10.2 carries the lesson.** Every other one made a claim too optimistic. This one left a capability **under**-sold for two days, and a 5.2 session reading it would have built around a gap that had already closed. A warning is a dated claim like any other.

Build the checker's _structure_ against this freely; do not present its static-analysis output as trustworthy until those gaps close. Monte Carlo findings additionally wait on nothing — the generator is complete as of 2026-08-06 — but see the budget item above.

### 10.2 A standing instruction for the next review round

**Re-derive; do not transcribe.** A review folded in eleven days after it was written, accurate the day it was written, had four of its twelve findings decay: one already implemented, one solved in code by a different route, one whose prescribed fix would by then do harm, one factually inverted in a way that would have "corrected" two documents that were already right. **The half-life of an undated repo claim here is on the order of a week**, and neither a spec nor a review gets an exemption. A critique is a repo snapshot too.

**A later round shortened that half-life to a day.** It re-counted `game-constants.json` at 164 entries and corrected the previous figure with it; re-measured hours later the same day, it was 220, because a parallel session landed 56 `objectClass` rows in between. A number in a spec is a liability whether or not it is dated — **prefer the generated artefact, the resolver, or the test to the count**, which is exactly what Sec.2 says about that file.

**Warnings decay upward too.** Every decay this document tracked made a claim too optimistic — a count too low, a gap already closed, a rule the corpus disproved — until Sec.10.1's `resourceTotals` bullet decayed the other way: it warned about a code gap that had been filled two days earlier, so a 5.2 session reading it would have designed around a limitation that no longer existed. **A warning is a dated claim like any other and gets no exemption for being cautious.** Re-derive the pessimistic lines as well as the optimistic ones; the cautious-sounding half of a spec is the half nobody re-checks.

And the harder half: **verify a review's prescriptions, not just its findings.** One round was right about all four of its blocking findings and wrong about two of the fixes it prescribed for them — one would have added a per-run pass over ~4,000 keys to satisfy a rule the corpus disproves (Sec.1), and one proposed a bounded progress interval that the flagship tool cannot honour because `generatePreview` is synchronous (Sec.4.1). A correct diagnosis and a wrong prescription look identical at the point where you fold it in, and only the prescription reaches the code.

**The standing instruction says WHERE to look, because "notice an absence" has failed four times and a directory listing has not — but the first version of the check was written wrong, and it would have reassured you.** It read: _list `src/*Context.tsx` and diff `src/preview/generator/` against the modules this document names._ That glob is root-level only. It returns **three** files; the repo has **nine**. Of the four cases the instruction was calibrated against, the glob catches one — and **the seed chip, which Sec.2 spends a paragraph deciding, lives in `src/components/preview/PreviewViewContext.tsx`**, not at the root. `teams` arrived through `src/generationSettings/`. So the four-for-four claim was not reproducible as written, and a reader running it literally would have come away satisfied. **A mechanical check is only better than a rule if someone runs it once before shipping it.**

**Corrected: `find src -name "*Context.tsx"`.** Nine files as of 2026-08-13, cheap to eyeball, and it has the hit rate the paragraph claims. The check is a _diff_, so the list is recorded here for the next round to diff against rather than re-derive:

```
src/ParsedDocumentContext.tsx              src/breakdown/BreakdownContext.tsx
src/PreviewCutContext.tsx                  src/components/preview/PreviewViewContext.tsx
src/PreviewResultContext.tsx               src/components/sidepanel/SidePanelLayoutContext.tsx
src/settings/AppSettingsContext.tsx        src/generationSettings/GenerationSettingsContext.tsx
                                           src/help/HelpSettingsContext.tsx
```

`AppSettingsContext.tsx` (the name-display setting, `src/settings/nameDisplay.ts`) is the most recent arrival. Keep the second half of the instruction as written — diff `src/preview/generator/` against the modules this document names — and add a third, since the alias finding came through neither: **diff `src/parser/`'s exported vocabulary against what Sec.4.2's recovery recipe assumes.** That one entered through `language.ts` and `parser.ts`, which no mechanical check in this document was watching.

**Take a finding's corrections as a UNIT, or record the refusal.** One round folded two of its own corrections halfway: it took `resourceAmounts` 170 into Sec.10.1 and left Sec.5's `ui-help.json` count at 101 against a measured 108, and it took two of a four-citation correction in `useDocument.ts` and left the other two. The defect is minor-grade and the process point is not. **A partial fold converts a consistent dated snapshot into a mixed one**, and after it the paragraph's date no longer tells a reader which of its numbers were refreshed — which is strictly worse than a uniformly stale paragraph whose date honestly scopes it. The same round demonstrably knew how to do it right: Sec.10.1's "deliberate non-change" paragraph declines a whole set of fresh counts and says so, in as many words. Decline out loud or take the set.

**Nothing in this document diffs its own rules against EACH OTHER, and that is where the last two standard findings lived.** Every check above compares a _module_ to a claim this document makes. Those two were neither: they are couplings between rules that are each individually correct — the alias algorithm against the context order, and the alias algorithm against the override window — that appeared when the code implementing one of them changed. No module diff would have found either, because no module was wrong. **The cheap version already exists in Sec.9 item 11: when a PROTOCOL.md rule gains a clause, add the fixture that exercises it against the other rules sharing its inputs.** Fixtures (b), (c) and (d) in that item's table are exactly that, each under ten lines of RMS, and they are the form this instruction should take from here — a fixture, not another paragraph telling a reader to think about interactions.

The mechanical version of all of this is Sec.9's items 2 and 11, and it generalises: where a finding is about a dependency on another spec's types or another module's behaviour, prefer a check that goes red to a note telling the next reader to be careful. Item 2 is its first payment — writing those "four lines" is what surfaced the sentinel's scoping bug. Item 11 is the second, and it exists because its finding is the only one in this series that **no prescribed test could have caught**.

**The density problem is closed. This revision is the fix.** It ran as its own session with the build log open, which is what three previous revisions deferred it as. The measurements it was tracking: "rev N" back-references reached **156 of 494 non-empty lines**, up from 108 of 404 and 86 of 354, a ratio of 24% → 27% → 32% while the document grew 39% in two revisions — a spec getting denser against its own stated intent, in a preamble that had cited `preview-design.md`'s reason for moving changelogs out the whole time. The risk that justified three deferrals was real and is the thing to preserve if this is ever done again: **the failure mode is deleting a pinned decision whose reason lives only in the sentence naming the revision that made it.** The rule that makes it survivable is **keep how a number was reached, move what a previous revision believed** — so a count that decayed, a mechanism that fails and a prescription that was wrong all keep their history, while "rev 5 said X and rev 6 corrected it to Y" becomes Y with X's reason attached. The build log holds a full entry per round; nothing was deleted that is not recoverable there.

**What that means for the next round: additions arrive without revision scaffolding.** State the rule and its reason. Reach for a back-reference only when the sequence itself is the evidence, and when you do, name what decayed rather than which revision believed it.
