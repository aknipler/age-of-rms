# Advanced Tools API Design (Phase 5.1, rev 7)

Contract for tools hosted in the Advanced Tools tab. Designed per PLAN.md: **v1 ships built-in (in-process) tools; v1.1 loads external process+manifest tools over stdin/stdout — both implement THIS same contract.** The API is therefore JSON-first: everything crossing the boundary must survive `JSON.stringify` round-trips, because for external tools it literally will.

**Five independent critique rounds have now been folded in (rev 3, rev 4, rev 5, rev 6, rev 7).** The changelogs live in `docs/build-log.md`, following `preview-design.md` rev 7's precedent and for its stated reason: under a do-not-deviate banner, historical self-litigation competes with the spec for the implementer's attention. Read the body as normative. The review files for the rev-4, rev-5 and rev-7 rounds sit beside this doc in `age-of-rms/docs/`, matching every other design doc in the repo; they were in the parent folder's `docs/` through rev 6, which is why `preview-design.md:132` cites a path that did not resolve.

**Every repo claim in this document is dated, and dating it is not enough.** The rev-5 round measured the half-life of an undated claim here at about a week; the rev-6 round found a *dated* claim that had decayed within its own date, by 34%, because a parallel session was writing to the same data file the same afternoon (Sec.2, `game-constants.json`). The rev-7 round re-derived every count in this document on 2026-08-11 and reported that all of them reproduced exactly; re-measured later the same day, `game-constants.json` is **372 entries with a FOURTH `category` member**, and two of `language.json`'s verified counts have moved as well. So a verification decays as fast as the claim it verifies, and the answer is not a fresher number — it is Sec.10.1's reporter test. So: re-derive before acting on any count, prefer the resolver or the generated artefact to the number wherever one exists, and treat a citation's line number as staler than the fact it points at. Where this document and the source disagree, the source wins and this document is the bug. Sec.10.2 carries the standing version of this for the next round.

## 1. Goals

1. **One contract, two transports.** A tool is defined by the message protocol (Sec.4), not by where it runs. Built-in tools implement `ToolImplementation` in-process; external tools speak the identical messages as NDJSON over stdin/stdout. The host cannot tell them apart above the transport layer.

   **What that does NOT mean, since rev 3 through rev 5 read it as more than it is (rev 6, B1): identical bytes.** The two transports carry the same *types* and the same *messages*; the wire form additionally encodes `±Infinity` as a sentinel and drops `def`, because JSON cannot represent one and re-expands the other 38-fold (Sec.4, Sec.4.2). Portability is preserved by **the published type differing from the in-process one in whichever direction makes the difference a compile error**: wider for numbers (a sentinel cannot be used as a number), unreadable for defs (Sec.4). "The published type is the wider one" was rev 6's phrasing and it is wrong in the `def` direction — see Sec.4, where getting it wrong reintroduces the exact defect rev 6's B1 removed. Byte-identity was pursued for a revision and a half, had no consumer, and cost the flagship tool its first line.
2. **Tools are documents the app displays, not extensions of the app** (PLAN.md's model #1). A tool cannot add menus, hook events, or touch the DOM. It receives context, emits progress, and returns output blocks and/or code edits. This is what makes the v1.1 trust model tractable.
3. **Code is source of truth, still.** Tool edits are `TextEdit`s applied through the same shared-model path Breakdown uses (breakdown-design Sec.6.4) — one undo entry, same staleness guard, never a bypass.
4. **Long-running work is first-class.** The flagship tool (Generation Consistency Checker, 5.2) runs thousands of generations: the protocol has progress and cancellation from day one, not bolted on.
5. **Serializable by construction, and the prohibited set is named rather than implied (rev 5, corrected rev 6).** `ParseResult` is already plain data (token indices, no cycles — a deliberate 2.3 property); the rest of the context is designed to match. Concretely, **nothing crossing the boundary in either direction may be a `Map`, `Set`, `Date`, `RegExp`, class instance, function, `NaN`, or `±Infinity` except through the Sec.4 sentinel, and no ARRAY ELEMENT may be `undefined`.** "Serializable" as an adjective is what let `Infinity` survive two revisions; the list is what a test can assert.

   **Rev 5 said "and no property may be `undefined` — omit the key instead", and rev 6 withdraws that clause**, because measurement says it is a rule the payload cannot satisfy and does not need to. Measured 2026-08-10 over the 32 tracked `test-maps/*.rms` (probe: `parseRms` bundled from `src/` with esbuild, run in Node): a real `ParseResult` carries **4,599 explicitly-`undefined`-valued keys**, 2,304 of them in `AK_Vanguard_v1.2.rms` and 763 in `13_Rings_v1.2.rms`. They are not exotic — `parser.ts:771` writes `def: undefined` on the unknown-command path, and `:1017`, `:1142`, `:1180` write `def: argDef` where `argDef` is `ArgumentDef | undefined` by signature. A rule that the whole corpus violates on line one is not a contract, and the only ways to satisfy it are to change the parser on a downstream consumer's behalf or to add a 4,599-key stripping pass per run.

   **Neither is needed, because the two cases are not the same case.** `def` is declared `def?: ArgumentDef`, so a consumer reading `node.def` gets `undefined` whether the key was dropped in transit or never present — the value does not change, only `"def" in node` does, and nothing in this contract licenses a tool to enumerate AST keys. An `undefined` **inside an array** is different in kind: `JSON.stringify` turns it into `null`, which is a value the consumer can read and be wrong about. So the prohibition is on array elements, the tolerance on optional keys is explicit, and the rule tools must follow is **read optional keys, never enumerate them**. Sec.9 item 1 tests exactly that split.

   One item on the list is live rather than hypothetical: **`LanguageIndex` is Maps and Sets** (`parser/language.ts:191`, verified 2026-08-10), and it serialises to `{}`. `referenceData.language` is deliberately plain `LanguageData`, so **every tool must build its own index** — built-ins import `buildLanguageIndex` (`language.ts:202`), external tools reimplement it. Say so in PROTOCOL.md; it is one sentence that saves a session.

   **`InstantiatedValue` is NOT the live example, and rev 5 citing it as one was a category error worth naming.** It is real (`preview/generator/types.ts:82`) and it does carry `undefined` load-bearingly, but it is not in the payload: `ToolContext` carries `source`, `parseResult`, `settings`, `referenceData`, `selection` and `params`, and a tool reaches `InstantiatedScript` only by calling `instantiateScript` itself, in-process, with nothing crossing a boundary (Sec.2's transport split). The live example is `ParseResult`, which is both the largest thing in the context and the thing the round-trip test names.

Non-goals v1: tool-defined interactive UI (output is declarative blocks; no HTML/JS from tools — that's the future webview tier, PLAN.md model #2); tool-to-tool communication; tools mutating files other than the open document; hot-reload of built-in tools.

## 2. Core types (`tools-api/` — shared, no React/Monaco/Tauri runtime imports)

```ts
export const TOOLS_API_VERSION = 1; // bump on breaking protocol change; host rejects mismatches

export interface ToolManifest {
  id: string;                  // stable, kebab-case: "consistency-checker"
  name: string;                // display name
  version: string;             // tool's own semver
  apiVersion: number;          // must equal TOOLS_API_VERSION
  description: string;         // one-liner for the Select Tool dropdown
  capabilities: Capability[];  // Sec.6 — everything not declared is denied
  params?: ToolParamDef[];     // run-configuration form, rendered by the host (Sec.5)
  // v1.1 external tools add: entry (executable + args), language, author, homepage.
}

export type Capability =
  | "read-source"
  | "read-ast"
  | "read-generation-settings"   // renamed rev 5 — see below
  | "read-reference"
  | "read-selection"             // rev 5 — see `selection`
  | "edit-source";

// read-reference (rev 2): language.json + game-constants.json in full. The AST embeds defs
// only for names actually used; the checker's static layer needs complete reference data
// (per-object resource amounts, all commands). Without this capability the flagship tool
// could not run on the declared context at all.
//
// read-ast IMPLIES read-source (rev 3 — pinned, and why stripping is wrong): ParseResult
// inherently contains the document (`source`, and even without it, `tokens[].text` holds
// every non-whitespace character — stripping the field would be security theater). The
// host auto-grants read-source when read-ast is declared, and the v1.1 consent dialog
// shows a single "can read your script" line for either. Embedded `def` slices are
// reference data (public, shipped with the app), not user data — no gate needed; noted
// so nobody mistakes the capability matrix for a data-flow proof. (rev 6: the WIRE form
// drops `def` for size — Sec.4.2 — so an external tool resolves it through its own
// LanguageIndex. That is a payload decision, not a capability one; read-reference is
// still what gates the vocabulary itself.)
//
// read-generation-settings was `read-settings` through rev 4, and the rename is not a
// naming quibble: it is a consent-dialog string in v1.1. As of 2026-08-10 `settings.json`
// holds FOUR unrelated families — help (1.7, helpConstants.ts), generation (2.5,
// generationSettingsConstants.ts), side-panel layout (4.4, SidePanelLayoutContext.tsx)
// and app display (src/settings/nameDisplay.ts) — and this capability carries only the
// generation ones. "This tool can read your settings" would have been a false statement
// about a trust surface.

// Discriminated union (rev 3): `type:"integer", default:"foo"` is now unrepresentable,
// and select defaults must be one of the options (host validates at registration).
interface ParamBase { key: string; label: string; help?: string }
export type ToolParamDef =
  | (ParamBase & { type: "integer"; default: number; min?: number; max?: number })
  | (ParamBase & { type: "boolean"; default: boolean })
  | (ParamBase & { type: "text"; default: string })
  | (ParamBase & { type: "select"; default: string; options: { value: string; label: string }[] })
  // rev 5 (rev-4 review S1): CREATION_PLAN 5.2 specifies the checker runs "across a
  // player-count matrix (2/4/6/8)", which none of the four above can express. The
  // workarounds are four booleans or a text field every tool re-parses itself, which
  // throws away the host-side validation this doc just added.
  | (ParamBase & { type: "multiSelect"; default: string[]; options: { value: string; label: string }[];
                   minSelected?: number; maxSelected?: number });  // rev 6 — see Sec.5

// rev 6 (blocking finding B1): the parse-result form is a TYPE PARAMETER, because it
// differs by transport. The default is the wire form, so a tool authored against the
// published `.d.ts` writes `ToolContext` and gets the widened, sentinel-carrying type.
// A built-in receives `ToolContext<ParseResult>` — real numbers, real `Infinity` — and
// `ParseResult` is assignable to `SerializedParseResult` (arrays are covariant and
// `number` is a subtype of the union), so `ToolContext<ParseResult>` is assignable to
// `ToolContext` and a portable tool compiles unchanged in both. See Sec.4.
//
// rev 7 (B1): the wire form ALSO differs by not carrying `def`, and the published type
// has to say so or the compiler blesses a silent `undefined`. `SerializedParseResult`
// types every `def` slot as `unknown`, which keeps `ParseResult` assignable to it and
// makes `node.def?.name` a compile error on the published type. Sec.4 has the
// mechanism and the two mechanisms that look right and are not.
export interface ToolContext<P extends SerializedParseResult = SerializedParseResult> {
  apiVersion: number;
  source?: string;                      // iff "read-source"
  parseResult?: P;                      // iff "read-ast" — see Sec.4
  settings?: ToolGenerationSettings;    // iff "read-generation-settings"
  referenceData?: {                     // iff "read-reference"
    language: LanguageData;             // plain data — build your own LanguageIndex (Sec.1)
    gameConstants: PublishedGameConstants;  // generated from the schema — see below
  };
  selection?: { offset: number; item?: Span };  // iff "read-selection" — see below
  // rev 5: the value union includes string[] for multiSelect. This widening is the
  // expensive-later half of rev-4 S1 and is why it lands now even though multiSelect
  // itself could have slipped: `params` is the type an external tool deserializes its
  // own run config into, so widening it after v1.1 manifests exist hands every
  // already-written tool a runtime surprise its compiler promised was impossible.
  params: Record<string, number | boolean | string | string[]>;
  // Deliberately absent: file paths, fs access, the preview pane's seed (see below).
}

export interface ToolGenerationSettings {
  playerCount: number;
  // BOTH the display name and the resolved dimension. `name` is a plain string, not the
  // app's MapSize union, so external tools need no import; a built-in re-narrows with
  // generationSettingsConstants.ts's own `isMapSize` guard rather than casting.
  mapSize: { name: string; tiles: number };
  // rev 5 (blocking finding N1). Always length 8, indexed player - 1, INDEPENDENT of
  // playerCount — entries at index >= playerCount describe people who are NOT in the
  // game and must be ignored, team sizes included. 0 means un-teamed and is the engine's
  // own value for it (guide:1001), not a UI placeholder. These are NOT the numbers that
  // appear in TEAMn_SIZEm / PLAYERx_TEAMy: those are lobby order, derived by
  // src/generationSettings/teamModel.ts's canonicalisation, which the generator imports
  // rather than re-implementing. Plain number[] at the JSON boundary; a built-in
  // re-narrows with `isTeams`.
  teams: number[];
}
```

**`mapSize.tiles`: where it comes from, and what it is not.**

*Verified 2026-08-10.* The context builder calls **`resolveMapDim(mapSize, predefinedLabels)`** from `src/preview/generator/mapDimensions.ts`, and surfaces its `null` rather than defaulting it away — a size that does not resolve is a data regression worth reporting, and the whole label environment is built from the same array. Rev 4's instruction to create a `MAP_SIZE_TILES` constant is **withdrawn**: that function now exists, its docstring already pins the `.find()`-not-uniqueness detail (six of seven sizes match two entries, the legacy and modern label for one grid), `mapDimensions.test.ts` covers all seven sizes including Giant 252, and `npm run validate:reference` asserts that every size resolves and that the legacy and modern labels agree. Writing a second resolver is the same mistake one level down. The Giant/Huge ordering cross-reference is withdrawn too — fixed 2026-08-01, `generationSettingsConstants.ts:46-55` orders Giant last and the validator enforces it.

**Cite `preview-design.md` by content, never by section number.** That document reorganises every revision and is now on its third numbering of this material; rev 4 cited its Sec.4, the rev-4 review corrected that to Sec.12 item 1, and both citations are dead as of rev 7.

**`tiles` is the LOBBY dimension, and a script can change it (rev 5, blocking finding N2).** `override_map_size` (`preview/generator/instantiate.ts:288-302`, verified 2026-08-10) replaces it — clamped to `[36, 480]`, honoured only before the first land command, ignored with a note after — and **`InstantiatedScript.dim` (`generator/types.ts:127-133`) is the value every stage actually generates against**, with its own comment saying it can differ from the lobby size's. A static check keyed on map area (`land_percent` over-allocation, impossible count×spacing — both named in CREATION_PLAN 5.2's brief) computes against the wrong grid on every script that overrides, and fails *quietly*, in the direction of "your map is fine". This is impossible to guess and cheap to state.

**How a tool gets the real dimension differs by transport, and rev 5 gave one answer to two audiences (rev 6, S5).** "Resolve it yourself or call `instantiateScript`" sat in the section an external tool author reads, and half of it is in-process-only advice — Sec.3 has already established that a tool linking app modules is not expressible externally. Split it:

- **External tools resolve `override_map_size` themselves**, and PROTOCOL.md must carry the rule since they cannot read `instantiate.ts`: take the last occurrence appearing **before the first land command**, clamp to `[36, 480]`, ignore any later one. It is the same class of one-sentence saving as "build your own `LanguageIndex`".
- **Built-ins call `instantiateScript`** — and must not let its result escape. `InstantiatedScript` is `ReadonlyMap` throughout (`sections`, `objectGroups`, `actorAreas`, and `InstantiatedCommand.attributes`, `generator/types.ts`), which is the whole of Sec.1's prohibited set. Harmless in-process, and precisely the thing someone will try to hand back across the boundary or stash in a `partial`.

**The preview pane's seed is deliberately NOT in the context (rev 5, deciding N1's open half).** The app has a user-visible seed chip (`ui-help.json`: `preview.seedChip`, `preview.reroll`) whose value lives in `PreviewViewContext` — view state, defaulting to 1, not persisted, describing where you happen to be looking. Three reasons it stays out. The Monte Carlo layer varies the seed by construction, so the pane's current seed is the one value it specifically does not want. `read-generation-settings` is scoped to the generation family in `settings.json` and the seed is not in it, so carrying it would reopen exactly the scope gap the rename above closes. And a tool that *does* want a fixed seed already has the right mechanism: declare an `integer` param, which the host validates, which the user can set, and which L2's settings echo puts in the output header so the run is self-describing. **If 5.2 finds a case where a tool must reproduce the pane exactly, that is a new `read-preview-view` capability and an escalation, not a silent widening of this one.**

**The context builder takes its parse from `ParsedDocumentContext`, NEVER from `PreviewResultContext`, and tools always see the WHOLE script (rev 7, blocking finding B2).** CREATION_PLAN 4.6 landed a Current/Final cut point on 2026-08-10: `truncateAst(parse, cutOffset)` (`src/preview/generator/truncateAst.ts:287`, verified 2026-08-11) returns `{ ...parse, script: { preamble, sections } }` — **`source`, `tokens`, `lineOffsets`, `symbols`, `includes` and `diagnostics` all come through unchanged**, by design and with the file's own comment saying so. `PreviewResultContext.tsx:79` memoises exactly that value. So the app now holds a `ParseResult` whose `script` is not the parse of its own `source`, and it **passes every one of Sec.4.3's guards**, because those guards compare strings and this object wears the real document's `source` as proof of a claim it does not support. Both providers are mounted a line apart (`App.tsx:70`, `:76`), and the one named after the preview is the one holding the truncated parse — which is also the one a session wiring up "the parse the preview runs on" reaches for first.

The user-facing half is the same shape as the seed and gets the same answer. The cut is view state with a visible control; with a pin set, the preview pane shows half a map while a checker reports on the whole script, and Sec.5's settings-echo header says nothing about it. So: **the cut point is not in the context**, it belongs in the output header if anywhere, and a tool that must reproduce the pane exactly is a `read-preview-view` escalation — the same three-part decision the seed gets above, for the same reasons.

**`selection` is an offset anchor, not a range (rev 5, finding N3 — sharpening rev-4 S2).** PLAN.md:56 and CREATION_PLAN 5.1 both name selection as context this doc was briefed to design, and rev 4 dropped it in a parenthetical, which the rev-4 review correctly called an unescalated deviation. It is added here, but **not as the `Span` that review prescribed, because that is not implementable**: the Monaco *editor instance* exists only while CodePane is mounted, i.e. while the Code tab is active (`useDocument.ts:255-267` documents this — it is why Ctrl+Z needs a window-level listener at all). A tool runs from the Tools tab, so at run time there is no mounted editor and no live selection range. What survives a tab switch is `src/hooks/useSharedSelection.ts`'s single nullable **offset anchor**, lifted to app level precisely so it outlives the panes (verified 2026-08-10). So `selection.offset` is that anchor, and `selection.item` is the span of the `Item` the hook already resolves through `findItemAtOffsetInScript` — free, and the only thing resembling a range that exists. Absent entirely when the anchor is null. Say this in PROTOCOL.md, or the 5.1 session goes looking for `editor.getSelection()` and finds nothing.

**The published game-constants type is GENERATED from the schema, not hand-written, and it is called `PublishedGameConstants` (rev 5, revising rev-4 B3; renamed rev 6, S6).** The rev-4 review said to promote `src/editor/aoe2RmsHover.ts`'s interface, which was right when it was written and is now wrong. The name matters because `GameConstantsData` **is already taken** — `src/breakdown/gameConstants.ts:22` exports one (a narrow view over the same file) and `aoe2RmsHover.ts:74` declares a second, file-local. Publishing a third under the same name, in the section whose entire finding is that narrow views keep being mistaken for the shape, is how the next reader imports the wrong one.

**The measurement, and why re-counting it is the wrong instinct.** Rev 5 said "164 entries with 17 distinct keys", dated 2026-08-10. Rev 6 corrected that to 220 entries hours later the same day, and marked the correction as the argument for generating the type. Re-measured **2026-08-11: 372 entries, 24 properties in the schema**, the 152 new rows being `category: "attribute"` (the `effect_amount` selector constants, read out of `random_map.def` by `tools/extract-constants --attributes`). **Three revisions in a row have now written a fresher number into this paragraph and been wrong within the day.** Do not write a fourth. Every count in this section is an illustration of the shape; the machine-readable answers are `reference/schemas/game-constants.schema.json` and the reporter test Sec.10.1 prescribes.

Two facts about the data that a hand-written type gets wrong, both live:

- **`rmsConstant` is nullable and 85 rows are null** (the DE terrains with no callable constant; the count has held across three re-measurements while the file's size has not). All the hand-written views except one declare `rmsConstant: string`. An external tool written against a `.d.ts` that says `string`, doing `entry.rmsConstant.startsWith(…)`, crashes on a fifth of the file. **`ObjectConstant` (`preview/generator/objects.ts:217-227`) already declares `rmsConstant: string | null` with a comment giving the reason** — one of the in-repo views got this right on its own, which is the precedent this section is arguing from rather than against.
- **`category` gains members faster than a spec can track them, and this bullet has now been wrong twice.** Rev 5 named two. Rev 6 corrected it to three (`terrain | object | objectClass`) and explained that hand-narrowing to two would have compiled against a schema that already carried the third with zero rows. As of 2026-08-11 the schema's enum has **four**, `attribute` included, with 152 rows behind it — so rev 6's corrected sentence broke the same way inside a day. **Read the enum out of the schema; do not transcribe it.** That is the whole argument of this section, demonstrated twice on its own text.

So the action item is neither "define one" nor "promote one": **derive the published type from `reference/schemas/game-constants.schema.json`, which is the artefact CI already validates.** Generate it into `tools-api/generated/` as part of the build (`npm install -D json-schema-to-typescript` — say the install in the same breath, per house rule). The in-repo narrow views stay narrow projections and are explicitly allowed to; what is forbidden is a further hand-written *published* copy. Whichever route is taken, **the check must go red the day the schema gains a field** — that is the whole requirement, and a generated file satisfies it for free. Field-level notes to carry into whatever consumes it: `resourceAmounts` is optional and per-resource-partial (8 rows at rev 6, 23 on 2026-08-11 — see Sec.10.1, where that number is load-bearing and is now a reporter rather than a literal), `constId` is nullable, the schema's `required` list is exactly `["rmsConstant", "descriptiveName", "category", "verified"]` so `constId`/`deTextureFile` are optional there, and `isTree` exists in the schema with no data row yet — expect the generated type to carry fields no consumer has heard of, and do not prune them.

**`LanguageData.predefinedLabels` stays optional, and this is settled — do not re-litigate it (rev 5).** The rev-4 review prescribed making it non-optional on the grounds that the schema marks it required. `src/parser/language.ts:187` (comment `:180-186`) deliberately went the other way, with a comment giving the reason: nothing checks the shape at runtime (`parserWorker.ts` reaches `LanguageData` through a double cast, which asserts rather than verifies), and preview-design mandates a `refDb.predefinedLabels ?? []` guard that a non-optional type would render dead code. Same collision the review identified, resolved the opposite way with reasons on the record. The rest of that finding is discharged: `PredefinedLabel` is fully typed at `language.ts:153` with its 10-member `category` union at `:134-145`, both against the schema. (Line numbers re-resolved 2026-08-10; the rev-5 citations for this file were all ~27 lines stale while every claim they carried was correct — a reminder that a citation decays faster than the fact it points at.)

```ts
export interface TextEdit { start: number; end: number; newText: string } // same shape as breakdown Sec.4.1

export interface ToolOutput {
  blocks: OutputBlock[];       // declarative display — the pane renders these, tools render nothing
}

export type OutputBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }                    // plain text w/ \n; NO markdown/HTML in v1
  | { kind: "keyValue"; rows: [string, string][] }
  // rev 6 (S1): rowSpans is one entry per row, null where a row has no code to jump to.
  // Length-checked by the inbound validator (Sec.4.2); a mismatched length is a protocol error.
  | { kind: "table"; columns: string[]; rows: string[][]; rowSpans?: (Span | null)[] }
  | { kind: "severity"; level: "info" | "warning" | "error"; text: string; span?: Span }
  | { kind: "codeRef"; text: string; span: Span };    // clickable — jumps the Code tab to span.start
```

**`severity` and `table` carry optional spans, because without them the flagship tool cannot express its own prescribed output (rev 6, S1).** CREATION_PLAN.md:279 item 3 specifies the checker's report as "per object/land/connection: spawn rate, failure buckets, worst player count" — a table whose every row is about one `create_object`, and the first thing a user does with such a row is click it. With `rows: string[][]` there is nowhere to hang a `Span`, so every clickable finding needs a `severity` block plus a sibling `codeRef` that the pane renders as two unrelated things, and a 200-row table becomes 200 unlinked pairs or a table nobody can click. The repo already models this correctly one layer down: `Diagnostic` (`parser/types.ts:32-44`) keeps severity, message and span in one record, and both the diagnostics ruler and the Monaco markers consume it that way. Structurally the same finding as rev-4's S1 (the player-count matrix no `ToolParamDef` could express), and it lands now for rev 5's own stated reason for landing `multiSelect` now: widening `OutputBlock` is free before external manifests exist and is a breaking wire change after. Check the vocabulary against CREATION_PLAN 5.2's four named static checks before implementing — `land_percent` over-allocation and impossible count×spacing are both per-command findings that want exactly this.

**`codeRef` carries a span, not a bare offset (rev 5).** `Diagnostic` (`parser/types.ts:32-44`) carries a `Span`, the diagnostics ruler and Monaco markers both consume ranges, and a checker reporting "this `create_object` never places" wants the command highlighted rather than a caret at its first character. Widening is free now and is a breaking wire change once external manifests exist — the same argument that lands `params`' union widening in this revision, taken for the same reason. The jump writes `useSharedSelection`'s anchor rather than inventing a Code-tab-specific path; that hook is already the app's cross-tab answer.

Spans are relative to the **run's document snapshot** (Sec.4's staleness rules define that snapshot precisely). If the document changed since the run, the jump still fires, clamped to document length, with a "the code changed since this ran" notice — consistent with, but softer than, the Apply staleness guard. If the document was *replaced* (File → Open) the wording is "this ran against a different document", not the softer one.

## 3. Tool implementation (in-process form)

```ts
export interface ToolRunHandle { cancel(): void }

export interface ToolImplementation {
  manifest: ToolManifest;
  // rev 6: a built-in receives the in-process context — real `ParseResult`, real
  // `Infinity`, no sentinels (Sec.4). A tool that wants to stay portable to v1.1
  // declares `run(ctx: ToolContext, …)` instead and reads numbers through `numeric()`;
  // `ToolContext<ParseResult>` is assignable to `ToolContext`, so both compile.
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle;
}
```

**The context is read-only, and in the worker case it is a copy for free.** `postMessage` to the tool worker structured-clones the context, so a worker-hosted built-in physically cannot corrupt the AST the UI renders from — which is most of why rev 4's deep-clone mandate exists, and why scoping the sentinel to the wire (Sec.4) does not reintroduce the hazard. A main-thread built-in holds the live object and **must treat every field as frozen**; nothing in this contract licenses a tool to mutate its context.

`run` returns immediately; all results flow through `emit`. Built-in tools that do heavy CPU work (the checker's Monte Carlo) run inside a **tool worker** (not the parser worker — a stuck tool must not stall diagnostics), where `emit` is `postMessage`. A synchronous throw from `run` is caught by the host and synthesized into an `error` terminal, same as a crash (rev 2).

**Worker lifecycle (rev 4 — pinned): one worker per run.** The host spawns a fresh tool worker at `run`, and terminates it after the terminal message (or a kill). Consequences, both deliberate: `worker.terminate()` needs no recovery logic (the next run spawns anew), and **tool module state cannot persist across runs** — a tool that wants persistence must put it in its output, not in globals. Spawn cost is irrelevant at one-run-at-a-time frequency (Sec.5), and per-run spawn is a one-liner with Vite's `?worker` import, as used at `useParsedDocument.ts:2`. This pin is also what makes Sec.4's run watchdog nearly free: there is nothing to recover, so the kill path has no state to reconcile.

**Who calls what (rev 3 — the handle/message relationship, stated instead of presumed):** `ToolRunHandle.cancel()` is the *in-process binding* of the `cancel` message; `HostMessage` is the *transport encoding*. Concretely: the host's Cancel button → host posts `{type:"cancel"}` to the tool worker (or writes it to the external tool's stdin) → the **worker shim's message handler** (host-authored plumbing, always responsive once the tool's chunk yields) invokes the in-worker `handle.cancel()` → which sets a flag in the tool's closure, observed at the next chunk boundary. For a hypothetical main-thread tool the host would call `handle.cancel()` directly — same binding, no transport.

**Built-ins may import app modules** (rev 2, stated plainly): the contract governs host↔tool *communication*, not what code a tool links against. The checker imports the Phase-4 preview generator directly — which means it is **not expressible as an external tool** until the generator is extracted into a standalone library; that's accepted, and it is the honest boundary of "one contract, two transports": the contract is portable, a given tool's dependencies may not be.

**The generator's real signature, which the context must be able to feed (rev 5).** Verified 2026-08-10:

```
generatePreview(parse, refDb, settings: PreviewSettings, opts: PreviewOptions)  // preview/generator/index.ts:232
PreviewSettings  = { playerCount, mapSize: MapSize, teams: readonly TeamNumber[] } // generator/types.ts:37-54
PreviewOptions   = { seed, collectSnapshots }                                      // generator/types.ts:57-61
```

Two shape mismatches a built-in must bridge, both deliberate and both cheap: `mapSize.name` is a plain `string` while `PreviewSettings.mapSize` is the `MapSize` union, and `settings.teams` is `number[]` while `PreviewSettings.teams` is `readonly TeamNumber[]`. Narrow with the existing `isMapSize` / `isTeams` guards in `generationSettingsConstants.ts` — do not cast. And note that `PreviewOptions.collectSnapshots` is documented at `types.ts:59` as "false in 5.2 batch mode — the only cost knob": the preview spec has already made that decision *for* this tool, and 5.2 should acknowledge it rather than rediscover it.

## 4. The message protocol (the actual contract)

One request, a stream of responses, one terminal message. For external tools each message is one NDJSON line (UTF-8, `\n`-delimited) — host→tool on stdin, tool→host on stdout; stderr is captured into a collapsible "tool log" block, **capped as a ring buffer (last 64KB; rev 4)**, since a chatty external tool must not balloon memory.

**Infinity survives the boundary via sentinel encoding (rev 3; typed honestly rev 4):** `ArgValue` legitimately holds `Infinity`/`-Infinity` (`inf`/`-inf` words, parser Sec.2.2), and `JSON.stringify(Infinity)` → `null` — silent AST corruption for any script using `inf`. Reproduced 2026-08-10 on both paths: `JSON.stringify({v: Infinity})` is `{"v":null}`, and `Number("9".repeat(400))` reaches `ArgValue` as `Infinity` through an ordinary number token, so the `inf`/`-inf` words are not the only source.

**The encoding is scoped to the EXTERNAL WIRE, not to both transports (rev 6, blocking finding B1 — this reverses rev 3's "for both transports, so built-in and external tools see byte-identical data").** Rev 5 pinned three statements that cannot all hold: byte-identical data across transports, no eager whole-tree decode, and the checker calling `generatePreview`. `generatePreview(parse: ParseResult, …)` (`preview/generator/index.ts:232`, verified 2026-08-10) wants a real `ParseResult`; `SerializedParseResult` is its supertype, so `ctx.parseResult` cannot be passed to it, ever, by construction. The runtime half is worse than the type half and fails in the direction of "your map is fine": every numeric read in the generator is `typeof v === "number"` (`instantiate.ts:168`, `:182`, `:290`, `:324`, `:437`), so a `{ inf: 1 }` object in any of those slots takes the unresolved branch and the value disappears — the same failure shape as the `override_map_size` finding in Sec.2. And decoding at read sites cannot rescue it, because a tool that feeds the generator has no read sites; it hands the whole tree to somebody else.

Byte-identity was adopted as a goal with no consumer. The flagship tool compiling is not. So:

- **Built-ins receive the real thing.** `ToolContext<ParseResult>`, real `Infinity`, no conversion, no clone, no decode. This is what makes Sec.3's "the checker imports the Phase-4 preview generator directly" implementable, and it is the transport the only two v1 tools use.
- **The external transport encodes on the way out and PROTOCOL.md owns the rule.** The serializer deep-converts `±Infinity` → `{ "inf": 1 } | { "inf": -1 }` as it builds the NDJSON line; the tool decodes at its numeric read sites. Nothing in-process ever sees a sentinel.

  **"Deep" includes `rnd` bounds, which are the second numeric position in `ArgValue` and were not covered by either half of rev 6 (rev 7, S1).** `parseRndValue` (`parser.ts:1511-1514`) is `Number(m[1])` over `/^rnd\((-?\d+),(-?\d+)\)$/` — an unbounded digit run, so an `rnd` bound reaches `Infinity` by the same route Sec.4 already accepts for a bare number token, and `JSON.stringify({ rnd: [Infinity, 1] })` is `{"rnd":[null,1]}` (confirmed 2026-08-11). Pinning `ArgValue<N> = N | { rnd: [N, N] } | …` above is what makes the deep conversion type-honest instead of a lie about `[number, number]`; a converter that walked only the bare-number position would leave the corruption in place.
- **The published type differs from the in-process one in whichever direction makes the difference a compile error, and that is not always "wider" (rev 7, blocking finding B1).** `ToolContext` defaults to `SerializedParseResult`, `ParseResult` is assignable to it, and `numeric()` is the identity on a plain number, so a tool written against the published `.d.ts` compiles and runs correctly in-process **and** over the wire without knowing which it got. That property holds for `Infinity` *because the type forces the tool to notice*: `number | { inf: 1 | -1 }` cannot be used as a number, so the decode is a compile error away.

  **It does not come for free, and rev 6 lost it one field over.** Rev 6 stripped `def` from the wire (Sec.4.2) and left `def?: CommandDef` standing in the published type, so a portable tool writing `node.def?.name` compiles cleanly, works in-process, and returns `undefined` for every node over the wire — *fails in the direction of "your map is fine"*, which is the exact defect rev 6's own B1 removed, reintroduced in the section arguing that the type system is what keeps the contract honest.

  **Pinned: every `def` slot in `SerializedParseResult` is typed `unknown`.** `unknown` is the one type that satisfies both halves — `CommandDef` is assignable to it (so `ParseResult` stays assignable to `SerializedParseResult`, which is what `ToolContext<ParseResult>` → `ToolContext` rests on) and nothing can be read off it without a cast (so `node.def?.name` is a compile error). It also documents itself: the slot is visible in the published `.d.ts` with a comment saying "absent on the wire — resolve it through your own `LanguageIndex`", which an omitted property cannot say.

  **Two mechanisms look right and are not.** Both were checked against this repo's own `tsc --noEmit --strict` on 2026-08-11 rather than reasoned about, and the reasoning would have got one of them wrong:
  - `def?: never` **breaks assignability** — `Type 'ArgumentDef | undefined' is not assignable to type 'undefined'` — which takes out `ToolContext<ParseResult>` → `ToolContext`, the property B1 was fixed to obtain. It is the first thing anyone reaches for and it fails a long way from where it is written.
  - Omitting `def` from the wire node types is *correct in isolation* (the full type stays assignable, and reading `.def` is an error) and **cannot be reached by instantiating a type parameter**, because a parameter can change a property's type and not its existence. Attempting it with a `D extends "real" | "wire"` mode parameter and a conditional property type fails differently and worse: TypeScript compares generic interfaces by *variance*, the conditional makes `D` unmeasurable, and the two instantiations stop being assignable on the type argument alone — `Type '"real"' is not assignable to type '"wire"'`, with nothing in the message about `def`. Genuine omission needs either a hand-cloned wire tree (rejected — see below) or type aliases intersected with `D extends … ? { def?: … } : object`, which trades every named interface in the published `.d.ts` for an intersection. `unknown` buys the enforcement without either cost.
- **The type is derived by parameterizing, not by hand-cloning (rev-4 S5), and it takes TWO parameters, not one (rev 7, B1).** `SerializedParseResult` is `ParseResult<number | { inf: 1 | -1 }, NoDefs>`, reached by threading two defaulted parameters up through `src/parser/types.ts`:

  ```ts
  // N — the numeric form. Say where inside ArgValue it lands, because "fifteen types take
  // the parameter" does not (rev 7, S1): `rnd` bounds are a numeric position too.
  export type ArgValue<N = number> = N | { rnd: [N, N] } | { expr: { tokens: number[] } } | string;
  // `expr.tokens` stays number[] — token indices, never infinite. That distinction is
  // exactly why a blanket deep mapped type was rejected, and rnd bounds fall on its
  // other side.

  // D — the def slots, one interface rather than four parameters. Indexed access
  // (`def?: D["command"]`) keeps TypeScript's variance measurement working, which a
  // conditional type does not.
  export interface DefSlots { arg: ArgumentDef; command: CommandDef; attribute: AttributeDef; directive: DirectiveDef }
  export interface NoDefs   { arg: unknown; command: unknown; attribute: unknown; directive: unknown }
  ```

  Both defaults keep every existing call site compiling. A hand-maintained parallel tree silently diverges the first time an AST node gains a field, and a blanket deep mapped type is worse than either: it cannot tell an `ArgValue` numeric position from `lineOffsets`, token offsets, or `expr.tokens` — which hold **token indices** — so it would publish a type claiming a token index might be infinite.

  **LANDED 2026-08-11 in `src/parser/types.ts`, as a parser-design Sec.4 amendment.** The escalation below was the right call and the answer came back yes; what follows is kept as the record of why it was escalated rather than improvised. Verified on landing rather than assumed: zero call sites edited (whole-repo `tsc --noEmit` clean), lint clean, suite unchanged at 44/1391, four mutants red. `src/parser/__tests__/wireTypes.test-d.ts` now pins the assignability property in both directions.

  **This is a bigger edit than it reads, and it is not this document's file to change quietly (rev 6, S4).** Fifteen types take the parameters — `ArgValue`, `ArgNode`, `CommandNode`, `BlockNode`, `AttributeNode`, `DirectiveNode`, `IfBranch`, `IfNode`, `RandomBranch`, `RandomNode`, `OrphanBlockNode`, `Item`, `SectionNode`, `ScriptNode`, `ParseResult` — in `src/parser/types.ts`, which `parser-design.md` owns, on behalf of a downstream consumer. No call site needs editing (that is what the defaults are for), but **escalate it to the parser spec rather than landing it in the 5.1 session**, per CLAUDE.md's do-not-improvise rule.

  **And say WHEN, because as written the 5.1 session's first instruction was blocked on this one (rev 7, S3) — RESOLVED by landing the amendment first.** Sec.9 item 2 and `age-of-rms/CLAUDE.md`'s status row both say to write the `ToolContext` → `PreviewSettings` → `generatePreview` test *first*; that test is typed `ToolContext<ParseResult>`, whose constraint is `SerializedParseResult`, which did not exist until the parameters landed. Both instructions were right and in the wrong order. The fork is now closed in the first direction: the parameters are in `src/parser/types.ts` and 5.1 starts by writing item 2 fully typed. Recorded because the finding generalises past its own resolution — **an instruction to do X first and an instruction to do Y first are compatible right up until one of them names the other's output**, and neither document could see it alone.

  One boundary held deliberately while landing it: **the parser owns the parameters, not the sentinel.** `src/parser/types.ts` gained `DefSlots`/`NoDefs` and the `<N, D>` threading, and nothing else — no `InfSentinel`, no `SerializedParseResult`. Those are wire concepts this document owns, and putting them in the parser would have made a pure lexing/parsing module carry a transport's vocabulary. The type test declares its own local copy of the sentinel for exactly this reason, and says so in a comment.
- **The external serializer MUST NOT convert in place (rev-4 S4, still load-bearing).** The `ParseResult` the host holds is the same object the UI renders from, and three places in Breakdown speak `Infinity` directly: `renderValue.ts:9-10` and `patch/formatStyle.ts:82-83` test `value === Infinity` to print `inf` (read direction), and `cards/ValueEditor.tsx:18-19` maps the words back to `±Infinity` (write direction — verified 2026-08-10, and missing from this list through rev 5, which matters because the list is what a reader checks against). Encode during the walk that produces the JSON string; never mutate the tree the app is rendering from. Scoping the sentinel to one transport shrinks this hazard to one code path but does not remove it.
- **Sentinel decoding is a PROTOCOL rule, not a shipped runtime (rev 4):** PROTOCOL.md documents the encoding and each language reimplements the 3-line decode. In-repo, `tools-api/index.ts` exports a `numeric()` helper for built-ins' convenience — that's app code, not part of the published `.d.ts`.
- **What the compiler enforces is the tool's decode, not the host's encode (rev 6, S4).** `ParseResult` is assignable to `SerializedParseResult`, so a serializer that forgets to convert typechecks cleanly. Rev 4's claim that the type "forces tools through the decoder" is true and worth keeping; the other half rests entirely on Sec.9 item 1. Say so, because the in-place-convert bug above is one the type system cannot see.
- **NaN cannot occur; the dev assert should still say "finite or sentinel" (rev 4).** v1 never evaluates expressions, and `ArgValue` numbers come only from `Number(text)` over the lexer's `/^-?\d+(\.\d+)?$/` and rnd-bounds regexes, which cannot produce NaN. `Infinity` can arrive from a long digit run as well as from the words. Harmless (it round-trips), but assert the right invariant.
- **`undefined` needs no encoding and gets no stripping pass (rev 6, correcting rev 5's N6).** Sec.1 has the measurement and the reasoning: an `undefined`-valued key on an optional property survives the boundary as an absent key, which reads identically; an `undefined` array element becomes `null`, which does not, and is prohibited. Sec.9 item 1 is what enforces the split, and it uses **`toStrictEqual` for the hand-built fixtures and `toEqual` for the corpus `ParseResult`** — deliberately, and see there for why that is a real gate rather than a weakened one.

```ts
// host → tool (exactly one)
export type HostMessage = { type: "run"; context: ToolContext } | { type: "cancel" };

// tool → host (zero+ progress/partial, then exactly one terminal)
export type ToolMessage =
  | { type: "progress"; fraction?: number; note?: string }   // fraction ∈ [0,1]; omit for indeterminate
  | { type: "partial"; output: ToolOutput }                  // replaces the pane's output area (idempotent redraw)
  | { type: "result"; output: ToolOutput; edits?: TextEdit[] } // terminal — success
  | { type: "error"; message: string; reason: ErrorReason };   // terminal — failure

export type ErrorReason =
  | "tool-error"      // the tool said so, or threw, or crashed
  | "cancelled"       // the user cancelled and the tool honoured it
  | "killed"          // the tool did not honour a cancel and was killed
  | "unresponsive"    // no message for the watchdog interval; the tool never chunked
  | "protocol"        // the tool emitted something that is not a valid ToolMessage
  // rev 7 (S4): every member above blames the TOOL, and rev 6 added two failure paths
  // that are the host's — the outbound `run` message exceeding 32 MB (Sec.4.2) and the
  // serializer refusing a prohibited value (Sec.9 item 1a). Both surface in the pane as
  // a terminal, and reporting either as `tool-error` is a false accusation while
  // `protocol` points the wrong way down the wire. Never counted against a tool.
  | "host-error";     // the host could not build or send this run's context
```

**The two kill terminals are distinct, and collapsing them was a defect (rev 5, part of N4).** Rev 4 synthesized `error: "cancelled"` for both an orderly cancel and a hard kill, which throws away the only signal that a tool is misbehaving — the user sees the same thing whether their Cancel worked or the host had to SIGKILL. `reason` is a required field on `error` for exactly this. The pane renders every reason as `severity: error`; only `killed` and `unresponsive` are worth surfacing as "this tool did not behave", and only they should be counted anywhere.

Rules: messages after a terminal are discarded with a console warning; a tool that exits (external) or returns-without-terminal (worker crash) yields a synthesized `error`. `partial` exists so the checker can stream findings while running; it must be a full self-contained `ToolOutput`, not a delta.

**Progress throttling (rev 2):** tools should emit ≤10 `progress`/s; the host coalesces renders (latest wins, ~100ms cadence) regardless, so a flooding tool degrades its own log, not the UI.

### 4.1 Cancellation, chunking, and the two watchdogs

**Tools MUST structure long work as awaitable chunks**, yielding to their event loop between units (`await new Promise(r => setTimeout(r, 0))` suffices). This is not a style preference: the host cannot set a flag in the worker's memory, and a tool in a tight synchronous loop never services the worker's event loop, so a posted cancel message would never arrive. Chunking is also what makes `progress` emission possible at all.

**The checker's chunk unit is ONE generation, not a batch (rev 5, correcting rev 4).** `generatePreview` is synchronous and cannot yield inside itself, so one generation is the smallest unit the generator offers. Rev 4 named "one batch of generations", which is a unit the tool chooses and can make arbitrarily large — the deadline below would then be measuring the tool's batch size rather than its cooperativeness.

**A run that intends to exceed one chunk MUST emit at least one message per chunk boundary.** This is what makes the run watchdog implementable, and it costs a chunked tool nothing since it wants to emit progress anyway.

**Cancel grace: 30s (rev 6, correcting rev 5's 15s, which corrected rev 4's 5s).** Rev 4's 5 s hard-kill is shorter than one unit of the flagship tool's own work. Measured over the 32 tracked maps on 2026-08-07 (`usePreviewResult.ts:22-30`), **one** generation costs a median of ~460 ms and up to **3.8 s**, and this machine's own measured load factor reaches **3.7×** (CLAUDE.md's tracked-debt table records the same suite at 81 s and 307 s on unchanged code). So a correctly implemented, perfectly cooperative checker cancelled one millisecond into a `24hr_Caverns.rms` generation misses a 5 s deadline under any load at all and is killed as if it had wedged.

**Rev 5 then derived 15 s from that worst case and missed that the worst case is measured at ONE map size (rev 6, blocking finding B4).** The 3.8 s figure comes from the preview pane's own corpus pass, which runs at the live generation settings, and `DEFAULT_MAP_SIZE` is `"Normal"` — 200×200 (`generationSettingsConstants.ts:58`). Neither `usePreviewResult.ts` nor rev 5 said so. `ToolContext.settings.mapSize` reaches **Giant, 252** (`generationSettingsConstants.ts:46-55`), and Sec.2's own `override_map_size` finding establishes that `InstantiatedScript.dim` reaches **480**. The same revision that discovered `dim` is not the lobby size derived both deadlines from a fixed lobby size.

Re-measured 2026-08-10 (`generatePreview` called directly, `collectSnapshots: false`, seed 7, 8 players, two runs, esbuild bundle in Node):

| map | Normal (200) | Giant (252) | ratio |
|---|---|---|---|
| `24hr_Caverns.rms` | 2864 / 2735 ms | 4110 / 3855 ms | **1.41×** |
| `AD4 - Pag - v1.2.rms` | 2184 ms | 2929 ms | 1.34× |
| `AK_Vanguard_v1.2.rms` | 614 ms | 671 ms | 1.09× |

So the Giant penalty is real, map-dependent, and **smaller than area scaling** (`(252/200)²` = 1.59) — the stages that dominate are not all quadratic in `dim`. Applying the same method to the 2026-08-07 reference rather than to this machine's absolutes: 3.8 s × 1.41 ≈ 5.4 s for one generation at the largest size the settings pane offers, × 3.7 load ≈ **20 s**. That is over the 15 s grace, so rev 5's number fails on its own derivation. **30 s** is the next round number above it and is what this revision pins.

**Erring long here is nearly free, and that is the real argument for the round-up.** The cancel grace is a *diagnosis* threshold, not a safety deadline: the user has already asked for the run to stop, and the kill happens either way. All a too-short grace buys is the wrong terminal — `reason: "killed"`, which this document says should be read as "this tool did not behave", printed against a tool that behaved perfectly. A too-long grace costs a cooperative tool nothing (it terminates at its next chunk boundary, typically in milliseconds) and costs a wedged one a longer spinner. Asymmetric, so round up.

The repo has already paid for this exact mistake once in the other direction, and it is a CLAUDE.md hard rule: the preview watchdog was set to 1000 ms from a 40 ms-per-stage *budget*, killed and infinitely re-posted every generation slower than it (about a third of the corpus), and is now `WATCHDOG_MS = 12_000` chosen against the measured worst case with `MAX_WATCHDOG_RETRIES = 2`. **A watchdog set below the real cost is a denial of service on your own feature.** Derive from the measurement, never from a round number or a budget.

**Run watchdog: 60s of silence (rev 6, correcting rev 5's 30s; the mechanism is rev 5's finding N5 — rev 4 had no kill path at all outside cancel).** Rev 4's only kill was post-cancel, so a built-in that wedges — an unterminated loop, a stage that never yields — produced an indeterminate progress bar forever, and since Sec.5 pins one run app-wide, the pane was bricked until app restart. **If no message of any kind arrives for 60s, the host kills the run and synthesizes `error` with `reason: "unresponsive"`.** Derivation, same discipline and the same correction: the longest legitimate gap between messages is one chunk, worst ≈ 20 s at Giant under load per the table above, and 60 s is roughly 3× that. No retry cap is needed — unlike the preview watchdog there is nothing to recover and nothing to re-post; one worker per run means the kill is the whole recovery. A tool that trips this has violated the chunking rule, and the watchdog is that rule's only enforcement.

**What it detects is silence, not non-termination — do not read a liveness guarantee into it (rev 7, M6).** A tool stuck in a loop that *does* chunk and emit progress runs forever and holds the app-wide single run slot. That is the right trade rather than an oversight: Sec.5's tool-switch and document-replace rules both cancel, so the pane is never bricked, and Sec.10's own budget item puts a legitimate checker run at 8–30 minutes, which no wall-clock ceiling can distinguish from a hang.

**Why the deadlines are not replaced by a bounded progress interval, which is the obvious-looking fix.** "Require a message every N seconds and stop sizing deadlines against chunk cost" is unimplementable for the tool this protocol exists for: `generatePreview` is synchronous and cannot be interrupted, so a tool whose atomic unit takes 20 s physically cannot emit inside it. Any wall-clock interval short enough to be useful is one the flagship tool cannot honour, and a rule the flagship tool violates by construction is a rule that gets deleted. **Both deadlines therefore bound ONE generation at the largest reachable size, under load, and that is the quantity to re-derive when either number is next questioned.**

**Accepted residual, stated rather than papered over: `override_map_size 480` is outside both numbers.** A script that overrides to 480 generates against ~3.6× Giant's area, and the host cannot see the override when it arms the timer — it holds the lobby size, and the override lives in the script (Sec.2). Such a run may be killed as `unresponsive` while working correctly. The residual stays accepted, but **name the cheap fix as well as the expensive one, or the next reader prices it at `instantiateScript` and drops it (rev 7, M7)**: the host is already holding the AST it is about to serialize, so scanning `script.sections` for an `override_map_size` before the first land command is O(items) and reuses the resolution rule PROTOCOL.md has to state anyway (Sec.2). It fails only when the argument is a `#const` or an expression, which is a fall-back-to-the-lobby-size case rather than a blocker. Full `instantiateScript` on the host side is the exact version and is a real cost for a case no tracked map exhibits. Do not "fix" it by inflating the constants — that is the budget-not-measurement mistake CLAUDE.md names.

Both deadlines get a test that exercises the kill (Sec.9), and the test asserts against the derivation rather than the literal constants, so a re-measurement does not silently invalidate it.

### 4.2 Inbound validation and size caps (rev-4 B6)

Rev 4 validated host→tool (`params`) and edit bounds, and left the direction that feeds the UI unguarded. `ToolMessage` is a TypeScript type, which is a compile-time fiction for an external process: a v1.1 tool can emit malformed JSON, well-formed JSON that is not a `ToolMessage`, a `severity` with `level: "catastrophe"`, or a `table` whose `rows` are numbers. Rev 4's own reasoning for edit-bounds validation — "a buggy external tool can emit anything" — applies verbatim.

**Specify runtime shape validation at the transport boundary**: one narrow validator per message kind, never trusting the discriminant, discard-with-visible-error (`reason: "protocol"`) on failure. One rule is named here rather than left implied, because Sec.2 delegates it to this section and this section did not accept the delegation through rev 6 (rev 7, M3): **`table.rowSpans`, when present, must have exactly `rows.length` entries**, each a `Span` or `null`; a mismatch is a protocol error. It is the only field rev 6 added to `OutputBlock` and it would otherwise ship unvalidated. Plus explicit caps, all `[tune]` and all stated so an implementer does not have to invent them: max **inbound** NDJSON line **8 MB**; max blocks per `ToolOutput` **1000**; max rows rendered per table **10,000** with a "showing first N of M" affordance; max text length per block **100,000** characters. A single 500 MB NDJSON line OOMs the host before any render-side cap can help. This is the v1.1 trust boundary's largest surface, larger than `params`.

**The cap governs tool→host only, and the outbound direction is the bigger number (rev 6, blocking finding B3).** Rev 5 stated 8 MB in a section titled "Inbound validation" and left the direction unwritten, which left the payload that actually blows up with no bound at all. Measured 2026-08-10, `JSON.stringify(parseRms(source, language)).length` over the 32 tracked maps:

| map | source | JSON | without `def` | ratio to source |
|---|---|---|---|---|
| `AK_Vanguard_v1.2.rms` | 358 KB | **13.15 MB** | 7.76 MB | 38× |
| `24hr_A Heart Map.rms` | 210 KB | **8.90 MB** | 4.89 MB | 43× |
| `13_Rings_v1.2.rms` | 184 KB | 5.90 MB | 3.25 MB | 33× |
| `AK_Namatjira.rms` | 192 KB | 4.34 MB | 2.39 MB | 23× |

**25 of 32 tracked maps exceed 1 MB and 2 exceed 8 MB**, so under the natural reading of rev 5's cap the contract could not run the flagship tool on two corpus maps.

Three rules follow, and none of them is a bigger number.

1. **The 8 MB cap is inbound (tool→host) and stays.** No legitimate `ToolMessage` approaches it; it exists to stop a hostile or broken child process.
2. **The outbound `run` message is bounded by the payload, not by a constant.** Its size is a fact about the open script, and the biggest tracked map is the requirement rather than an outlier. Cap it at **32 MB** — comfortably above the measured worst case with room for `def` and for scripts larger than anything tracked — and treat exceeding it as a host-side error naming the script, not a silent truncation.
3. **Strip `def` from the wire form, unconditionally.** Roughly 41% of the payload is `def` re-expansion: the AST holds one shared `CommandDef`/`ArgumentDef` per vocabulary entry and `JSON.stringify` has no back-references, so each is re-emitted at every node pointing at it. Sec.1 already requires every tool to build its own `LanguageIndex` from `referenceData.language`, so the def is one `Map.get` away for a named node.

   **Name all FOUR `def` sites, because rev 6 named two and the shortfall is silent (rev 7, blocking finding B1).** `def` lives on `ArgNode` (`parser/types.ts:89`), `CommandNode` (`:95`), `AttributeNode` (`:110`) and `DirectiveNode` (`:117`) — all four already optional, so dropping them is type-legal rather than a widening. The 41% figure above was measured by dropping all four; **attribute nodes are by a wide margin the most numerous item in an RMS AST**, so a rule naming only `CommandNode` and `ArgNode` recovers a small fraction of it and nothing goes red, because the result is still under the 32 MB outbound cap. The rule is: **every `def` field in the AST, of which there are exactly four.**

   **And the re-derivation recipe is one clause short for `ArgNode`.** An external tool resolves a `CommandNode`, `AttributeNode` or `DirectiveNode` def by name — one index lookup. An `ArgNode` has no name: the route is name → `CommandDef` → `arguments[i]`, positionally, and **that positional identity is not guaranteed** — `consumeArgs` (`src/parser/parser.ts:924-930`) emits several `ArgNode`s sharing one `ArgumentDef` when `argDef.variadic` is set. Zero argument defs in `language.json` are variadic today (verified 2026-08-11), so this is latent rather than live, but the parser and the schema both support it and PROTOCOL.md is a published document. Give the recipe, and say it is positional only while no variadic argument exists. **The consequence is a capability rule and must be stated in PROTOCOL.md: an external tool that needs defs declares `read-reference` and looks them up.** In-process tools are untouched — structured clone preserves the sharing, so the defs cost them one pointer each.

**None of this touches the in-process transport, and the reason is worth knowing:** `postMessage` to the tool worker uses structured clone, which preserves shared references within one clone operation. The 38× blow-up is an artefact of JSON having no back-references, so it is an external-transport cost specifically — which is also why Sec.10's "per-run (fine)" was too breezy: a 13 MB write into a child process's stdin is a different sentence from "fine".

### 4.3 Staleness, and the guard that actually matters (rev-4 B4)

**The version-based guard does not catch a stale *parse*, which is the corruption path that exists.** The worker's parse lags the model by design: `useParsedDocument.ts` debounces keystrokes (150 ms) and drops out-of-order responses by `requestId` (verified 2026-08-10). So at Run time `parseResult.source` can already differ from `model.getValue()`. The tool computes offsets against text that is not in the model, nothing changes the model during the run, a version comparison passes, and Apply lands N edits at wrong offsets. Same-version garbage, silently — the class BUG-001 was.

Pin these:

1. **`ctx.source` and `ctx.parseResult.source` are the same string, always.** That string is "the run's document snapshot" everywhere this document uses the phrase, including `codeRef` spans.
2. **Run is gated on `model.getValue() === ctx.parseResult.source`**, and Apply re-checks the same equality — not a bare version comparison. `ParseResult.source` exists precisely for this and CodePane already uses it that way.
3. If a version id is kept at all, use **`getAlternativeVersionId()`** (matching `useDocument.ts:52`), so edit-then-undo back to the snapshot re-enables Apply instead of disabling it forever.
4. **Run is disabled for `read-ast` tools until the first parse lands** — `parseResult` is `ParseResult | null` until then.
5. **Run calls `reparseNow(model.getValue())` and starts when the matching parse lands (rev 6, S2).** The gate in item 2 is *false* for the whole 150 ms debounce window after every keystroke plus the parse itself (`useParsedDocument.ts:15` is `DEBOUNCE_MS = 150`, `:95` drops out-of-order responses by id) — so a Run pressed just after typing would do nothing, with no affordance, which is the shape of bug users report as "the button is broken". Rev 5's item 4 covered only the cold-start case. The mechanism already exists and this document already prescribes it for Apply: `reparseNow` (`useParsedDocument.ts:123`, the BUG-001 Part B fix) bypasses the typing debounce for a programmatic event, and pressing Run is the same shape. Show a brief "parsing…" state rather than a disabled button.
6. **`ctx.parseResult.script` must be the parse of `ctx.parseResult.source` — string equality no longer proves it (rev 7, blocking finding B2).** Pins 1 and 2 were written when the only way to hold a `ParseResult` was to parse something. `truncateAst` (Sec.2) now produces one whose `script` is a prefix and whose `source`, `tokens`, `symbols` and `diagnostics` are the whole document's, and it satisfies every guard above. So the guard is on **provenance, not equality**: the context builder reads `ParsedDocumentContext`, which holds the parse of the model's text and nothing else, and `truncateAst`'s output is the counterexample to point at when someone asks why the rule is not just `===`.

### 4.4 Stale-run message rejection (rev-4 B5)

Neither message type carries a run id, and the discard rule is "messages after a terminal are discarded" — but a cancelled run never sends a terminal, it has up to the full cancel grace (30 s, Sec.4.1). If the host spawns run B without waiting, run A's late `partial` replaces B's output area, because `partial` is a full redraw. For external tools it is worse: a SIGKILLed process can be writing to stdout for the whole grace window.

**Close it host-side: drop any message whose worker/child-process handle is not `currentRun.handle`.** One worker per run means every run already *has* a unique identity; the host holds it and its `onmessage`/stdout reader compares. Costs nothing, requires nothing of tool authors, and closes the grace window and the SIGKILL-flush window completely.

**Do not add `runId` to the wire contract.** It makes correctness depend on every external author echoing a field, and a tool that echoes it wrong has *all* its output silently dropped — a new failure mode, in the direction Sec.4.2 establishes we cannot trust. The one thing it buys is disambiguating a shared transport, and there isn't one.

### 4.5 Edits are proposals

A terminal `result` with `edits` does NOT auto-apply: the pane shows an "Apply N changes" button (plus per-edit `codeRef`s if the tool listed them in output).

**Undeclared-capability edits are rejected (rev 2):** a `result` carrying `edits` from a tool whose manifest lacks `edit-source` has its edits **dropped** with a visible warning block — never applied. Capability enforcement runs on both directions of the contract.

**On Apply**, in order:

1. **Validate**: overlap, and malformed bounds — `start > end`, negative offsets, `end` beyond the snapshot length. **ANY violation rejects the whole set** with an error block. A buggy external tool can emit anything and the staleness guard alone does not catch same-version garbage.
2. **Re-check the Sec.4.3 source equality.** If it fails, Apply is disabled with "the code changed while the tool ran — re-run". **Never rebase tool edits; re-run.**
3. **Apply all N as one `pushEditOperations` batch = one undo entry.** This function does not exist yet: `useDocument.ts:244`'s `applyTextEdit` takes exactly **one** edit and converts offsets to a `monaco.Range` via `getPositionAt` (verified 2026-08-10), so calling it N times produces N undo entries and breaks this document's central promise. **Name the work: `applyTextEdits(edits: TextEdit[])`**, converting all N and passing one array.
4. **Then call `reparseNow(source)`** (rev 5). The doc stopped at `pushEditOperations` through rev 4. Breakdown's discrete-edit path already does this (`useParsedDocument.ts:123`, the BUG-001 Part B fix) to skip the 150 ms typing debounce, because a programmatic edit is one event with nothing to coalesce. A tool's Apply is the same shape.

**Two clarifications that stop an implementer fixing the wrong thing:**

- **The descending sort is not the mechanism.** Rev 4 presented "sorted descending by `start`" as load-bearing; it is not. Descending order is what manual string splicing needs, whereas `pushEditOperations` takes ranges in original coordinates and handles ordering itself. Harmless to sort, but stating it as the mechanism invites a later "fix" of the wrong thing. What Monaco does require is non-overlap, which step 1 already validates.
- **`rebaseEdit` (`breakdown/ephemeralAnchors.ts:76`) is NOT for tool edits (rev 5).** It exists for Breakdown's in-flight anchors during rapid consecutive edits. The "never rebase, re-run" rule above will read as contradicting a function sitting right there in the codebase unless this is said.

**Undo reachability.** "One undo entry" is only useful if Ctrl+Z reaches it, and Monaco's binding needs a mounted editor, which the Tools tab does not have. It works only because of the window-level listener at `useDocument.ts:255-267`. Worth a test.

## 5. The pane (host UI, 5.1 implementation scope)

`Select Tool` dropdown (from registered manifests) → params form (from `manifest.params`, typed like Sec.3.4 breakdown editors, HelpTips per convention) → Run/Cancel button → progress bar (`progress` messages) → output area (rendered `OutputBlock`s) → Apply-edits button when present. "Waiting for tool selection…" empty state per the mockup.

**Param validation at run time, not just registration (rev 4):** the host validates and clamps submitted values against each `ToolParamDef` — min/max, options-membership, and for `multiSelect` that every selected value is an option **and that the selection count is within `minSelected`/`maxSelected`** (rev 6, M6: all three of rev 5's checks pass an empty selection, and the parameter that motivated `multiSelect` — the 2/4/6/8 player-count matrix — is meaningless empty; both bounds are optional and absent means unbounded, including empty) — before they enter `ctx.params`. Implicit while the host owns the form; stated because v1.1 makes `params` part of the trust boundary and manifests arrive from strangers.

**The same bounds are checked at REGISTRATION, against the manifest's own `default` (rev 7, M4).** Sec.2 already pins that a `select` default must be one of its options and that the host validates it at registration; a `multiSelect` declaring `default: []` alongside `minSelected: 1` passes every check above and every check below, and ships a form that cannot be submitted as authored. One line, in the same place the `select` default is checked: **a declared default must satisfy its own declared constraints** — which is the rule `npm run validate:reference` already enforces on `language.json` arguments, for a defect that reached the corpus 461 times.

**Concurrency (rev 3 — pinned): one run at a time, app-wide.** Not per-tool: a single active run means one run-state in `host.ts`, one document snapshot for the staleness guard, and one progress surface. Switching tools or re-running while a run is active cancels the current run after a confirm.

**A run is pinned to a document, and the document can be replaced (rev-4 L1).** `useDocument.ts` holds **one module-level Monaco model** for the app's whole lifetime (`:22`) and File → Open calls `setValue(text)` (`:162`) rather than creating a new model. So "the document" can become an entirely different script mid-run. **Cancel the run when the open document is replaced** (File → Open / New), next to the tool-switch rule. Without this the run keeps burning CPU against a closed script, and `codeRef` jumps still fire against it with the soft "code changed" notice — which badly understates "you are looking at a different file" (Sec.2's `codeRef` wording handles that half).

**Echo the run's settings into the output header (rev-4 L2).** `playerCount`, `mapSize`, teams and any params are live app state snapshotted at `run`, and the flagship tool's entire output is conditioned on them. Change the player count mid-run and the pane shows results computed for the old value, labelled with nothing. This needs no guard — a header line ("run at 8 players, Normal / 200×200, 2v2v2v2") makes a stale result self-describing instead of silently wrong, and it is where a tool's seed param belongs too.

**`ui-help.json` entries the pane owes (rev-4 Minor, re-measured 2026-08-10).** CLAUDE.md's hard rule is a HelpTip plus a matching `ui-help.json` entry for every interactive element, as it is built. The file has **101 entries** and exactly two tools-adjacent ids — `tabBar.advancedTools` and `settings.tab.advancedTools` — neither inside the pane. Name these now so the 5.1 session cannot skip them: `tools.select`, `tools.run`, `tools.cancel`, `tools.progress`, `tools.apply`, `tools.log`, `tools.output`, and **`tools.params`** — eight, not the seven rev 6 listed, because this section's own closing open question resolves by making `tools.params` document the param form (rev 7, M2). For scale, `preview.*` carries **16** ids for a pane of comparable complexity; that is the bar, and eight against sixteen is a floor rather than a target.

**The Settings tab this pane already has (rev 6, M5).** `src/components/settings/AdvancedToolsSettings.tsx` ships today, is wired into the Settings dialog, and reads "The Advanced Tools pane itself hasn't been built yet, so it has nothing to configure" — which stops being true in 5.1. It owns the second of the two tools-adjacent help ids above. Decide in 5.1 what it acquires (tool enable/disable is the obvious candidate; default params and the v1.1 registry URL are not v1) and rewrite that copy in the same session, or the app ships a settings tab telling the user a feature does not exist while they are using it.

**Open question, deliberately left open: who owns help text for a host-rendered, tool-authored param row?** They are generated from `manifest.params`, so their text comes from `ToolParamDef.help`, not `ui-help.json` — "every interactive element gets an entry" and "external manifests supply their own strings" collide here, and v1.1 makes the collision a trust question (a manifest from a stranger writing UI copy). v1 resolution: `ToolParamDef.help` renders inside the row, and `ui-help.json`'s `tools.params` entry documents the *form* rather than any individual row. Revisit before v1.1.

## 6. Capabilities and trust

v1 built-ins are trusted code; capabilities still gate what the host puts in `ToolContext` (least privilege keeps the contract honest). **The checker declares `read-source`, `read-ast`, `read-generation-settings`, `read-reference`** — rev 4's Sec.6 list omitted `read-reference` while Sec.2 said the tool "could not run on the declared context at all" without it, and Sec.6's list is the one an implementer copies into the exemplar manifest.

v1.1 external tools: the manifest's declared capabilities are shown in the install/run consent dialog ("This tool can read your script and propose edits"); `edit-source` never auto-applies (Sec.4.5 already guarantees this); undeclared context fields are simply absent. The process-level risks (arbitrary code execution) are handled by the v1.1 trust flow per PLAN.md (unvetted warning + curated registry) — out of scope here, but the contract deliberately gives external tools no ambient authority beyond their stdin.

**Naming note:** PLAN.md:56 says the external manifest carries "permissions". `capabilities` is the better name and supersedes it; noted before v1.1 manifests exist in the wild.

## 7. Built-in registry (v1)

`src/tools/registry.ts` exports `TOOLS: ToolImplementation[]`. 5.2's checker is the flagship; a second cheap tool ("Script Statistics": counts of commands/attributes/constants, token count, expression count — pure read-ast, finishes instantly) ships alongside as the protocol's trivial exemplar and smoke test. The formatter and constants auditor (CREATION_PLAN 5.2b) slot in later without API changes.

## 8. File layout

```
tools-api/
  index.ts          every type in Sec.2 + Sec.4; the contract. Type-only imports from
                    src/parser (ParseResult, Span, LanguageData) are allowed and real — "no app
                    imports" was false as written through rev 2. The rule is: NO RUNTIME
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
                    index" PLUS the re-derivation recipe and its one caveat (name
                    lookup for command/attribute/directive, positional for ArgNode,
                    and positional only while no argument def is variadic — Sec.4.2),
                    the override_map_size resolution rule (Sec.2), the
                    selection-is-an-anchor note, and the per-language cancel-delivery
                    recipe (Sec.10).
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

**`tools-api/` at the repo root is partly outside the typecheck gate — fix this in the session that creates the directory (rev 5; the claim corrected rev 7, M1).** `tsconfig.json:23` is `"include": ["src"]`, and rev 5 read that as "`tsc --noEmit` would never see a root-level `tools-api/index.ts`". That is false and the next reader will check it: `include` sets the *root* file set, and TypeScript still adds and checks every file reached by an import, so the contract is typechecked from the moment `src/tools/registry.ts` imports it. What genuinely escapes is **a `tools-api/` file that nothing under `src/` imports** — `generated/PublishedGameConstants` is exactly that until the flagship tool consumes it — plus the ESLint purity gate, whose globs name three `src/` directories explicitly (`eslint.config.js:35-39`). The prescription is unchanged: **either add `tools-api` to `include` and to the purity globs, or put the contract under `src/`.** Verified 2026-08-11. Decide it in the same session as `mkdir`, or the contract ships untypechecked and nobody finds out.

## 9. Test plan

The rev-4 preamble called this "no critique pass — read this hardest". Five independent rounds have since happened; the tests below are the surviving obligations, not a substitute for review.

1. **Serialization round-trip, in two halves with two different matchers (rev 6, correcting rev 5).**

   (a) **Hand-built fixtures under `toStrictEqual`**, in two groups. *Must round-trip*: every `ToolMessage` kind, and a `ToolContext` whose AST contains an `inf`/`-inf` argument **and an `rnd` with an infinite bound** (rev 7, S1 — the second numeric position in `ArgValue`, which `JSON.stringify` turns into `{"rnd":[null,1]}` today), asserting the sentinel survives intact in both. *Must be rejected by the serializer before it ever reaches the wire*, each asserted as a thrown/reported error rather than as a silent shape change: an array containing `undefined` (JSON would make it `null`), a `Map`, a `Set`, and a `NaN`. `toStrictEqual` is right for the first group because the fixtures are ours and carry no incidental `undefined`-valued keys.

   (b) **A real `parseRms` result over a corpus map under `toEqual`**, plus a scanner asserting the prohibited set directly (no array element `undefined`, no `Map`/`Set`/`Date`/`RegExp`/function, no non-finite number outside a sentinel). `toEqual` here is deliberate and is not the weakening rev 5 thought it was: Sec.1 tolerates `undefined`-valued keys on optional properties precisely because they read identically on both sides, and `toEqual`'s one documented blind spot is exactly that tolerance. It still catches `undefined` vs `null`, so the array case — the one that changes a value — goes red. **Rev 5's blanket `toStrictEqual` would fail on its first run against real input** (4,599 such keys across the tracked corpus, measured 2026-08-10), and the only readings of that red are "the fixture is wrong" or "strip 4,599 keys per run"; the rule was wrong, not the corpus.

   Mutation-test both halves per CLAUDE.md — put a `[undefined]` into the fixture and confirm (a) goes red. **Aim the sentinel mutant at (a), not at (b) (rev 7, S2): against (b) it cannot go red.** (b) runs over a real corpus map, and measured 2026-08-11 across all 32 tracked maps there are **zero occurrences of `inf` or `-inf` as a word and zero numeric literals of 20+ digits** — there is no non-finite value anywhere in the corpus, so dropping the sentinel encode changes nothing (b) can observe and the scanner stays green. That matters more than a wording slip, because this is the only enforcement that the external serializer encodes at all (the types cannot see it, Sec.4), and rev 6 aimed the one gate on that behaviour at the half that cannot fail. (a) carries an `inf` argument by construction, so it kills the mutant. If a corpus-scale exercise of the encoder is wanted as well — and it is worth having, since (a)'s fixtures are small and hand-built — the cheap version is a fixture map: take a tracked map, append lines using `inf`, `-inf`, an `rnd` with an infinite bound and a 400-digit literal, and park it in `test-maps/broken/`, which exists for exactly this deliberately-degenerate, not-corpus-gated tier.
2. **The neighbouring spec's input type is constructed from this one (rev 5, finding N7; rev 6 makes it B1's acceptance criterion).** A test that builds a `PreviewSettings` out of a `ToolContext` and calls `generatePreview` with it.

   **Rev 5 called this four lines. Writing them is what found B1** — under rev 5's rules it does not compile, because `ctx.parseResult` was `SerializedParseResult` and `generatePreview` takes a `ParseResult`. So write it against the rev-6 rule and it becomes the thing that keeps that rule honest: the test takes a `ToolContext<ParseResult>` (the in-process form), passes `ctx.parseResult` straight to `generatePreview`, and narrows `settings` through `isMapSize`/`isTeams`. It stops compiling if the sentinel is ever re-scoped to both transports, which is precisely the change that would silently break the flagship tool again.

   Why this one earns its place: **three consecutive revisions were broken by the same dependency.** Rev 3 typed `settings.mapSize` as `number` when the app had a string union. Rev 4 had `mapSize.tiles` with no source of truth while the data had one, in a directory the search did not cover. Rev 5 found `settings` missing `teams`, added to the app three weeks earlier. Each was caught by a human reading two documents side by side, and each was filed as "a cross-doc data dependency same-author review structurally misses" — a rule that has now failed three times, because it asks a reader to notice an absence. This test **stops compiling the day `PreviewSettings` grows a required field**, which is precisely the event all three findings are instances of. Prefer the compile error to the rule, for the same reason this project prefers an observable to an argument.

   State its limit honestly rather than overselling it: it catches added *required* fields and changed types. It does not catch a new optional field, or a field whose meaning changes under a stable type. Nor does it catch the *reverse* dependency, which is the one that produced rev 5's own headline finding: `PreviewSettings` gaining a field is caught, `ToolContext` gaining a field that `PreviewSettings` should have consumed is not. That was `teams` — the app grew a concept and two documents disagreed about who owned it. Those still need a reader, so this test does not retire Sec.10.2's standing instruction.

   **A fifth limit, and rev 7's B2 is the instance: it watches ONE seam.** The Current/Final cut point broke this document four days after this test was designed to end that class, and item 2 cannot see it — the test type-checks `ToolContext` against `PreviewSettings`, while the cut is a *caller* concern that `generatePreview` deliberately knows nothing about (`index.ts`'s own 4.3 header pins that). A compile error beats a rule only where the two types actually meet; the app keeps growing concepts at seams where they do not. Sec.10.2 now names where to look.

   **Ordering: UNBLOCKED. The parser-design amendment landed 2026-08-11**, so item 2 can be written first as intended, typed `ToolContext<ParseResult>` from the outset. `src/parser/types.ts` carries the two defaulted parameters; `src/parser/__tests__/wireTypes.test-d.ts` is the standing gate on the assignability property `ToolContext<ParseResult>` → `ToolContext` rests on. What is still 5.1's to write is `SerializedParseResult` itself — the parser owns the parameters, this document owns the instantiation `ParseResult<number | { inf: 1 | -1 }, NoDefs>` and the sentinel it names.

   One friction point to expect when it is written (rev 6, M7): `generatePreview` wants `PreviewReferenceData = { language: LanguageIndex; constants: readonly ObjectConstant[] }` (`index.ts:70-73`), and `ObjectConstant.resourceAmounts` is `Readonly<Record<string, number>>`. A schema-generated `resourceAmounts` is an interface with four optional number properties, and an interface gets no implicit index signature, so it is not assignable to `Record<string, number>` under `strict`. Today's direct JSON import dodges this because inference gives each row its literal shape. **If the test fails there, the fix belongs in `ObjectConstant`, not in the generated type** — nobody should "fix" the generator to match a consumer's convenience projection.
3. **Lifecycle.** progress→result ordering; message-after-terminal discarded; cancel synthesizes `reason: "cancelled"`; worker-crash synthesizes error; synchronous throw from `run` synthesizes error; **cancel against a deliberately non-chunked busy-loop tool hard-kills at the cancel-grace deadline with `reason: "killed"`**; **a tool that emits nothing at all is killed by the run watchdog with `reason: "unresponsive"`** (rev 5 — the path that did not exist through rev 4). Assert against the constants the host actually holds, not against literal `30_000`/`60_000` in the test body, or the next re-derivation (Sec.4.1 has now moved both twice) silently invalidates them. The kill paths are exercised, never assumed.
4. **Stale-run message rejection** (Sec.4.4): cancel A, start B, A emits `partial`, assert B's output survives.
5. **Malformed inbound messages** (Sec.4.2): invalid JSON, valid JSON that is not a `ToolMessage`, an out-of-enum `severity.level`, a table with non-string rows, **a `table` whose `rowSpans` length does not match `rows` length** (rev 7, M3), and an over-cap line — each discarded with `reason: "protocol"` and a visible error, never rendered.
6. **Capability enforcement, both directions.** A tool without `read-source` gets no `source` (the context path — untested through rev 4, only the edits direction was covered); a tool without `edit-source` has its edits dropped with a warning.
7. **Edit application.** N edits as a **single undo entry**; overlap rejection; malformed-bounds rejection of the whole set; the Sec.4.3 source-equality gate blocking Apply after a model change; **Apply re-enabled after undo back to the snapshot**; `reparseNow` fired after apply.
8. **Document replace** (Sec.5): start a run, open a different file, assert the run is terminated and Apply is gone.
9. **scriptStats end-to-end** through the real pane.
10. **Data readiness, as a reporter rather than a gate** (Sec.10.1): `src/tools/__tests__/dataReadiness.measure.test.ts`, re-deriving the 5.2 readiness figures from the data files on every run. It asserts nothing about the counts — it exists so the numbers in a spec can be a pointer instead of a liability (rev 7, M5).

## 10. Known risks and open questions

- **`partial`-as-full-redraw may be slow for huge tables.** Mitigated by Sec.4.2's row cap plus a "show all" affordance; not measured.
- **`ParseResult` serialization cost for external tools is per-run and it is 13 MB on the worst tracked map** (Sec.4.2 has the table and the `def`-stripping decision). Rev 5 called it "fine" with no number attached; a 13 MB write into a child process's stdin deserves the number. The v1.1 process spawn must send context *after* the consent gate, not before.
- **The 30s cancel grace and SIGKILL need Windows-specific testing** under Tauri's shell plugin.
- **`OutputBlock` deliberately has no markdown** — resist adding it until a sanitization story exists.
- **`apiVersion` checking must reject, not warn**, or v1.1 tools will depend on leniency.
- **The chunked-cancel recipe is JS-shaped (rev 4).** A single-threaded Python tool blocking on `stdin.readline()` while working never sees `cancel`. PROTOCOL.md needs a per-language delivery recipe (non-blocking stdin poll between chunks, or a dedicated reader thread setting a flag) before v1.1 ships. Note this interacts with the run watchdog: a tool that cannot see `cancel` also cannot emit between chunks, so it will be killed as `unresponsive` — which is the correct outcome and should be documented as such rather than discovered.
- **5.2 will find the Monte Carlo budget does not close (rev 5, sourced correctly rev 6).** The assumption is **`CREATION_PLAN.md:285`** — "1000 runs of a heuristic generator should be seconds, not minutes". Rev 5 attributed it to PLAN.md as well; PLAN.md contains no run count and no timing claim, and a finding that names two documents invites the reader to check the wrong one. At the measured median of ~460 ms per generation, 1000 runs is roughly **8 minutes for one player count and ~30 for the 2/4/6/8 matrix**, and Sec.4.1's re-measurement makes the tail worse than the median implies: the heavy corpus maps cost 2–4 s per generation at Normal on an ordinary machine, before any load factor. `collectSnapshots: false` is the only cost knob the generator offers (`generator/types.ts:59`) and its effect has never been measured. This is a 5.2 problem, not a 5.1 one, but **the protocol's progress/cancel/`partial` design is sized by it** — which is most of why those three exist.

### 10.1 The 5.2 data-readiness warning, re-pointed (rev 5)

Rev 3's warning said the checker's static layer keys on `resourceAmounts`/`constId`, which are "all placeholders until Phase 4.0 lands". **That is no longer true and will be ignored the first time someone checks the file.**

**Rev 5 replaced it with five counts, rev 6 refreshed them, rev 7 refreshed them again, and three of the five had moved inside a day each time. Do not refresh them a fourth time — build the reporter (rev 7, M5).** Prescribed: **`src/tools/__tests__/dataReadiness.measure.test.ts`**, re-deriving each figure below from `game-constants.json`, `language.json` and the schema on every run, in the shape `rms0201.measure.test.ts` / `rms0304.measure.test.ts` / `rms0315.measure.test.ts` already established. Carry the caveat CLAUDE.md records about those four: **they print nothing without `--disableConsoleIntercept` and still exit 0**, which is indistinguishable from a check that found nothing.

What the reporter must report, and what was true on 2026-08-11 — read as shape, not as input to code:

- **`resourceAmounts` coverage, and whether the rows behind it are `verified`.** Rev 6 said 8 rows, "still exactly the hand-written placeholders". It is **23** now, the 15 new ones extracted from the dat and `verified: true` (the great fish, oysters, the `FISH_*` family, DLC_BOXTURTLE). So the warning has genuinely weakened here, and the remaining soft spot is specific rather than general: **FISH and SHORE_FISH are still `verified: false`**, the pair CLAUDE.md's Phase-4 row flags as suspect (the dat reports no resource storage while the entries claim 200 food).
- **Terrain verification.** 116 of 131 terrain rows are `verified: false` (community-sourced) — the one figure in this section that has held across every re-measurement.
- **`language.json` verification, both halves.** Rev 6 wrote "28/41 commands and 38/94 attributes"; measured 2026-08-11 it is **40/41 and 40/94**, so the commands figure was out by twelve and the review round that re-derived every number in this document missed it, because it re-derived the `game-constants.json` five and not this line.
- `src/parser/resourceTotals.ts` does not model script-level resource modifiers at all (CLAUDE.md tracked debt), so a resource-based finding is computed against base values regardless of what the script does to them. This one is a code gap, not a data count, and the reporter cannot see it.

Build the checker's *structure* against this freely; do not present its static-analysis output as trustworthy until those gaps close. Monte Carlo findings additionally wait on nothing — the generator is complete as of 2026-08-06 — but see the budget item above.

### 10.2 A standing instruction for the next review round

**Re-derive; do not transcribe.** Rev 5 folded in a review that was eleven days old and accurate the day it was written, and four of its twelve findings had decayed: one already implemented, one solved in code by a different route, one whose prescribed fix would now do harm, one factually inverted in a way that would have "corrected" two documents that were already right. **The half-life of an undated repo claim here is on the order of a week**, and neither a spec nor a review gets an exemption. A critique is a repo snapshot too.

**Rev 6 shortened that half-life to a day and sharpened the rule twice over.** The round that produced this revision re-counted `game-constants.json` at 164 entries and corrected rev 5's figure with it; re-measured hours later the same day, it is 220, because a parallel session landed 56 `objectClass` rows in between. A number in a spec is a liability whether or not it is dated — **prefer the generated artefact, the resolver, or the test to the count**, which is exactly what Sec.2 now says about that file.

And the harder half: **verify a review's prescriptions, not just its findings.** Rev 6's round was right about all four of its blocking findings and wrong about two of the fixes it prescribed for them — one would have added a per-run pass over 4,599 keys to satisfy a rule the corpus disproves (Sec.1), and one proposed a bounded progress interval that the flagship tool cannot honour because `generatePreview` is synchronous (Sec.4.1). A correct diagnosis and a wrong prescription look identical at the point where you fold it in, and only the prescription reaches the code.

**And the standing instruction now says WHERE to look, because "notice an absence" has failed four times and a directory listing has not (rev 7).** Every cross-doc break in this series entered the app the same way: `teams`, the preview pane's seed chip and the Current/Final cut point all arrived as a new **root-level React context**, and `mapSize.tiles` as a new pure module beside the generator. So before the next revision, do two mechanical things and then read: **list `src/*Context.tsx` and diff `src/preview/generator/` against the modules this document names.** Five minutes, four for four so far, and it does not depend on a reader noticing that something is missing.

The mechanical version of all of this is Sec.9's item 2, and it generalises: where a finding is about a dependency on another spec's types, prefer a test that stops compiling to a note telling the next reader to be careful. Rev 6 is its first payment — writing those "four lines" is what surfaced B1.
