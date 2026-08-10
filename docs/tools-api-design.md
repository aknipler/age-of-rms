# Advanced Tools API Design (Phase 5.1, rev 5)

Contract for tools hosted in the Advanced Tools tab. Designed per PLAN.md: **v1 ships built-in (in-process) tools; v1.1 loads external process+manifest tools over stdin/stdout — both implement THIS same contract.** The API is therefore JSON-first: everything crossing the boundary must survive `JSON.stringify` round-trips, because for external tools it literally will.

**Three independent critique rounds have now been folded in (rev 3, rev 4, rev 5).** The rev-2/3/4 changelogs have moved to `docs/build-log.md`, following `preview-design.md` rev 7's precedent and for its stated reason: under a do-not-deviate banner, historical self-litigation competes with the spec for the implementer's attention. Read the body as normative.

**Every repo claim in this document is dated.** The rev-5 round measured the half-life of an undated claim in this repo at about a week — four of the rev-4 review's twelve findings had decayed in eleven days, one of them inverted. If a claim here is older than a few weeks and you are about to act on it, re-derive it. Where this document and the source disagree, the source wins and this document is the bug.

## 1. Goals

1. **One contract, two transports.** A tool is defined by the message protocol (Sec.4), not by where it runs. Built-in tools implement `ToolImplementation` in-process; external tools speak the identical messages as NDJSON over stdin/stdout. The host cannot tell them apart above the transport layer.
2. **Tools are documents the app displays, not extensions of the app** (PLAN.md's model #1). A tool cannot add menus, hook events, or touch the DOM. It receives context, emits progress, and returns output blocks and/or code edits. This is what makes the v1.1 trust model tractable.
3. **Code is source of truth, still.** Tool edits are `TextEdit`s applied through the same shared-model path Breakdown uses (breakdown-design Sec.6.4) — one undo entry, same staleness guard, never a bypass.
4. **Long-running work is first-class.** The flagship tool (Generation Consistency Checker, 5.2) runs thousands of generations: the protocol has progress and cancellation from day one, not bolted on.
5. **Serializable by construction, and the prohibited set is named rather than implied (rev 5).** `ParseResult` is already plain data (token indices, no cycles — a deliberate 2.3 property); the rest of the context is designed to match. Concretely, **nothing crossing the boundary in either direction may be a `Map`, `Set`, `Date`, `RegExp`, class instance, function, `NaN`, or `±Infinity` except through the Sec.4 sentinel, and no property may be `undefined`** — omit the key instead. "Serializable" as an adjective is what let `Infinity` survive two revisions; the list is what a test can assert.

   Two of those are live, not hypothetical, and both were found by rev 5:
   - **`undefined` is already in the payload.** `InstantiatedValue` (`preview/generator/types.ts:82`, verified 2026-08-10) carries `undefined` as a load-bearing value — "could not resolve" is not the same as absent — and `JSON.stringify` drops it from objects while turning it into **`null` inside arrays**. Structured clone preserves it. The two transports therefore disagree today.
   - **`LanguageIndex` is Maps and Sets** (`parser/language.ts:164`), and it serialises to `{}`. `referenceData.language` is deliberately plain `LanguageData`, so **every tool must build its own index** — built-ins import `buildLanguageIndex`, external tools reimplement it. Say so in PROTOCOL.md; it is one sentence that saves a session.

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
// so nobody mistakes the capability matrix for a data-flow proof.
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
  | (ParamBase & { type: "multiSelect"; default: string[]; options: { value: string; label: string }[] });

export interface ToolContext {
  apiVersion: number;
  source?: string;                      // iff "read-source"
  parseResult?: SerializedParseResult;  // iff "read-ast" — see Sec.4; NOT `ParseResult`
  settings?: ToolGenerationSettings;    // iff "read-generation-settings"
  referenceData?: {                     // iff "read-reference"
    language: LanguageData;             // plain data — build your own LanguageIndex (Sec.1)
    gameConstants: GameConstantsData;   // generated from the schema — see below
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

**`tiles` is the LOBBY dimension, and a script can change it (rev 5, blocking finding N2).** `override_map_size` (`preview/generator/instantiate.ts:288-302`, verified 2026-08-10) replaces it — clamped to `[36, 480]`, honoured only before the first land command, ignored with a note after — and **`InstantiatedScript.dim` (`generator/types.ts:127-133`) is the value every stage actually generates against**, with its own comment saying it can differ from the lobby size's. A static check keyed on map area (`land_percent` over-allocation, impossible count×spacing — both named in CREATION_PLAN 5.2's brief) computes against the wrong grid on every script that overrides, and fails *quietly*, in the direction of "your map is fine". A tool that needs the generated dimension resolves `override_map_size` itself or calls `instantiateScript`. This is impossible to guess and cheap to state.

**The preview pane's seed is deliberately NOT in the context (rev 5, deciding N1's open half).** The app has a user-visible seed chip (`ui-help.json`: `preview.seedChip`, `preview.reroll`) whose value lives in `PreviewViewContext` — view state, defaulting to 1, not persisted, describing where you happen to be looking. Three reasons it stays out. The Monte Carlo layer varies the seed by construction, so the pane's current seed is the one value it specifically does not want. `read-generation-settings` is scoped to the generation family in `settings.json` and the seed is not in it, so carrying it would reopen exactly the scope gap the rename above closes. And a tool that *does* want a fixed seed already has the right mechanism: declare an `integer` param, which the host validates, which the user can set, and which L2's settings echo puts in the output header so the run is self-describing. **If 5.2 finds a case where a tool must reproduce the pane exactly, that is a new `read-preview-view` capability and an escalation, not a silent widening of this one.**

**`selection` is an offset anchor, not a range (rev 5, finding N3 — sharpening rev-4 S2).** PLAN.md:56 and CREATION_PLAN 5.1 both name selection as context this doc was briefed to design, and rev 4 dropped it in a parenthetical, which the rev-4 review correctly called an unescalated deviation. It is added here, but **not as the `Span` that review prescribed, because that is not implementable**: the Monaco *editor instance* exists only while CodePane is mounted, i.e. while the Code tab is active (`useDocument.ts:255-267` documents this — it is why Ctrl+Z needs a window-level listener at all). A tool runs from the Tools tab, so at run time there is no mounted editor and no live selection range. What survives a tab switch is `src/hooks/useSharedSelection.ts`'s single nullable **offset anchor**, lifted to app level precisely so it outlives the panes (verified 2026-08-10). So `selection.offset` is that anchor, and `selection.item` is the span of the `Item` the hook already resolves through `findItemAtOffsetInScript` — free, and the only thing resembling a range that exists. Absent entirely when the anchor is null. Say this in PROTOCOL.md, or the 5.1 session goes looking for `editor.getSelection()` and finds nothing.

**`GameConstantsData` is generated from the schema, not hand-written (rev 5, revising rev-4 B3).** The rev-4 review said to promote `src/editor/aoe2RmsHover.ts`'s interface, which was right when it was written and is now wrong. Measured 2026-08-10: `reference/data/game-constants.json` is **164 entries with 17 distinct keys** (31 and 7 when that review ran). The fields added since — `habitat`, `isWater`, `isForest`, `isHybrid`, `isBeach`, `isTree`, `beachTerrain`, `previewColor`, `minimapColor`, `idSource` — appear in **none** of the five TypeScript views (`aoe2RmsHover.ts:64`, `breakdown/gameConstants.ts:5`, `parser/resourceTotals.ts:55`, `parser/validate.ts:61`, and the structural `ObjectConstant` the preview worker casts to). Promoting any of them publishes a type that is missing ten fields.

Worse for a *published* contract: the schema types `rmsConstant` as `["string", "null"]` and **53 of the 164 rows are null** — the DE terrains with no callable constant. All four hand-written views declare `rmsConstant: string`. An external tool written against a `.d.ts` that says `string`, doing `entry.rmsConstant.startsWith(…)`, crashes on a third of the file.

So the action item is neither "define one" nor "promote one": **derive the published type from `reference/schemas/game-constants.schema.json`, which is the artefact CI already validates.** Generate it into `tools-api/generated/` as part of the build (`npm install -D json-schema-to-typescript` — say the install in the same breath, per house rule). The four narrow in-repo views stay narrow projections and are explicitly allowed to; what is forbidden is a fifth hand-written *published* copy. Whichever route is taken, **the check must go red the day the schema gains a field** — that is the whole requirement, and a generated file satisfies it for free. Field-level notes to carry into whatever consumes it: `resourceAmounts` is optional and per-resource-partial (8 of 164 rows, 2026-08-10), `constId` is nullable (2 rows), `rmsConstant` is nullable (53 rows), `category` is the 2-member enum `"terrain" | "object"`, and `constId`/`deTextureFile` are **not** in the schema's `required` list — decide their optionality against the schema rather than publishing a divergence.

**`LanguageData.predefinedLabels` stays optional, and this is settled — do not re-litigate it (rev 5).** The rev-4 review prescribed making it non-optional on the grounds that the schema marks it required. `src/parser/language.ts:148-160` deliberately went the other way, with a comment giving the reason: nothing checks the shape at runtime (`parserWorker.ts` reaches `LanguageData` through a double cast, which asserts rather than verifies), and preview-design mandates a `refDb.predefinedLabels ?? []` guard that a non-optional type would render dead code. Same collision the review identified, resolved the opposite way with reasons on the record. The rest of that finding is discharged: `PredefinedLabel` is fully typed at `language.ts:126` with its 10-member `category` union at `:107`, both against the schema.

```ts
export interface TextEdit { start: number; end: number; newText: string } // same shape as breakdown Sec.4.1

export interface ToolOutput {
  blocks: OutputBlock[];       // declarative display — the pane renders these, tools render nothing
}

export type OutputBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }                    // plain text w/ \n; NO markdown/HTML in v1
  | { kind: "keyValue"; rows: [string, string][] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "severity"; level: "info" | "warning" | "error"; text: string }
  | { kind: "codeRef"; text: string; span: Span };    // clickable — jumps the Code tab to span.start
```

**`codeRef` carries a span, not a bare offset (rev 5).** `Diagnostic` (`parser/types.ts:32-44`) carries a `Span`, the diagnostics ruler and Monaco markers both consume ranges, and a checker reporting "this `create_object` never places" wants the command highlighted rather than a caret at its first character. Widening is free now and is a breaking wire change once external manifests exist — the same argument that lands `params`' union widening in this revision, taken for the same reason. The jump writes `useSharedSelection`'s anchor rather than inventing a Code-tab-specific path; that hook is already the app's cross-tab answer.

Spans are relative to the **run's document snapshot** (Sec.4's staleness rules define that snapshot precisely). If the document changed since the run, the jump still fires, clamped to document length, with a "the code changed since this ran" notice — consistent with, but softer than, the Apply staleness guard. If the document was *replaced* (File → Open) the wording is "this ran against a different document", not the softer one.

## 3. Tool implementation (in-process form)

```ts
export interface ToolRunHandle { cancel(): void }

export interface ToolImplementation {
  manifest: ToolManifest;
  run(ctx: ToolContext, emit: (msg: ToolMessage) => void): ToolRunHandle;
}
```

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

**Infinity survives the boundary via sentinel encoding (rev 3; typed honestly rev 4):** `ArgValue` legitimately holds `Infinity`/`-Infinity` (`inf`/`-inf` words, parser Sec.2.2), and `JSON.stringify(Infinity)` → `null` — silent AST corruption for any script using `inf`. Rule: the **context builder** deep-converts `±Infinity` → `{ "inf": 1 } | { "inf": -1 }` when constructing `ToolContext`, for **both** transports, so built-in and external tools see byte-identical data.

- **The wire form is its own type (rev 4):** `ToolContext.parseResult` is typed **`SerializedParseResult`** — structurally `ParseResult` with every `ArgValue` `number` position widened to `number | { inf: 1 | -1 }`. The compiler then *forces* tools through the decoder; rev 3's `numeric()`-by-convention would have compiled `value * 2` and broken at runtime. **Sec.2's type block was still saying `ParseResult` through rev 4 — an internal contradiction, since the code block is what an implementer copies. Fixed in rev 5.**
- **Derive it by parameterizing, not by hand-cloning (rev-4 S5).** `SerializedParseResult` is `ParseResult<number | { inf: 1 | -1 }>`, reached by threading `ArgValue<N = number>` up through `ParseResult<N>` in `src/parser/types.ts`. The default keeps every existing call site compiling. A hand-maintained parallel tree (a dozen node interfaces with no compiler link to the originals) silently diverges the first time an AST node gains a field, and a blanket deep mapped type is worse than either: it cannot tell an `ArgValue` numeric position from `lineOffsets`, token offsets, or `expr.tokens` — which hold **token indices** — so it would publish a type claiming a token index might be infinite.
- **The context builder MUST deep-clone before converting (rev-4 S4, and this is the load-bearing half).** The `ParseResult` the host holds is the same object the UI renders from. An in-place convert corrupts Breakdown mid-flight: `renderValue.ts:8-10` and `patch/formatStyle.ts:81-83` both test `value === Infinity` to print `inf`. A live corruption bug in an unwritten implementation, easy to write while chasing "byte-identical".
- **Sentinel decoding is a PROTOCOL rule, not a shipped runtime (rev 4):** PROTOCOL.md documents the encoding and each language reimplements the 3-line decode. In-repo, `tools-api/index.ts` exports a `numeric()` helper for built-ins' convenience — that's app code, not part of the published `.d.ts`. The checker decodes at its numeric read sites via that helper rather than doing an eager whole-tree pass.
- **NaN cannot occur; the dev assert should still say "finite or sentinel" (rev 4, sharpened by the rev-4 review's Minor).** v1 never evaluates expressions, and `ArgValue` numbers come only from `Number(text)` over the lexer's `/^-?\d+(\.\d+)?$/` and rnd-bounds regexes, which cannot produce NaN. But `Number("9".repeat(400))` **is** `Infinity`, so a plain number token or an rnd bound can produce it too — the `inf`/`-inf` words are not the only source. Harmless (it round-trips), but assert the right invariant.
- **`undefined` is the sentinel family's second member and has no encoding (rev 5, N6).** Omit the key. Sec.1 names the full prohibited set; the round-trip test in Sec.9 is what enforces it, and **it must use `toStrictEqual`** — Vitest's `toEqual` ignores undefined-valued keys by design, so the test as specified through rev 4 was blind to the exact class it exists to guard.

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
  | "protocol";       // the tool emitted something that is not a valid ToolMessage
```

**The two kill terminals are distinct, and collapsing them was a defect (rev 5, part of N4).** Rev 4 synthesized `error: "cancelled"` for both an orderly cancel and a hard kill, which throws away the only signal that a tool is misbehaving — the user sees the same thing whether their Cancel worked or the host had to SIGKILL. `reason` is a required field on `error` for exactly this. The pane renders every reason as `severity: error`; only `killed` and `unresponsive` are worth surfacing as "this tool did not behave", and only they should be counted anywhere.

Rules: messages after a terminal are discarded with a console warning; a tool that exits (external) or returns-without-terminal (worker crash) yields a synthesized `error`. `partial` exists so the checker can stream findings while running; it must be a full self-contained `ToolOutput`, not a delta.

**Progress throttling (rev 2):** tools should emit ≤10 `progress`/s; the host coalesces renders (latest wins, ~100ms cadence) regardless, so a flooding tool degrades its own log, not the UI.

### 4.1 Cancellation, chunking, and the two watchdogs

**Tools MUST structure long work as awaitable chunks**, yielding to their event loop between units (`await new Promise(r => setTimeout(r, 0))` suffices). This is not a style preference: the host cannot set a flag in the worker's memory, and a tool in a tight synchronous loop never services the worker's event loop, so a posted cancel message would never arrive. Chunking is also what makes `progress` emission possible at all.

**The checker's chunk unit is ONE generation, not a batch (rev 5, correcting rev 4).** `generatePreview` is synchronous and cannot yield inside itself, so one generation is the smallest unit the generator offers. Rev 4 named "one batch of generations", which is a unit the tool chooses and can make arbitrarily large — the deadline below would then be measuring the tool's batch size rather than its cooperativeness.

**A run that intends to exceed one chunk MUST emit at least one message per chunk boundary.** This is what makes the run watchdog implementable, and it costs a chunked tool nothing since it wants to emit progress anyway.

**Cancel grace: 15s, derived from a measurement (rev 5, correcting rev 4's 5s).** Rev 4's 5s hard-kill is shorter than one unit of the flagship tool's own work. Measured over the 32 tracked maps on 2026-08-07 (`usePreviewResult.ts:22-30`), **one** generation costs a median of ~460 ms and up to **3.8 s** — and this machine's own measured load factor reaches **3.7×** (CLAUDE.md's tracked-debt table records the same suite at 81 s and 307 s on unchanged code). So a correctly implemented, perfectly cooperative checker cancelled one millisecond into a `24hr_Caverns.rms` generation misses a 5s deadline under any load at all and is killed as if it had wedged. 3.8 s × 3.7 ≈ 14 s, rounded to **15 s** with the derivation stated so the next person can re-derive it against a re-measured worst case rather than re-guessing.

The repo has already paid for this exact mistake once in the other direction, and it is a CLAUDE.md hard rule: the preview watchdog was set to 1000 ms from a 40 ms-per-stage *budget*, killed and infinitely re-posted every generation slower than it (about a third of the corpus), and is now `WATCHDOG_MS = 12_000` chosen against the measured worst case with `MAX_WATCHDOG_RETRIES = 2`. **A watchdog set below the real cost is a denial of service on your own feature.** Derive from the measurement, never from a round number or a budget.

**Run watchdog: 30s of silence (rev 5, finding N5 — rev 4 had no kill path at all outside cancel).** Rev 4's only kill was post-cancel, so a built-in that wedges — an unterminated loop, a stage that never yields — produced an indeterminate progress bar forever, and since Sec.5 pins one run app-wide, the pane was bricked until app restart. **If no message of any kind arrives for 30s, the host kills the run and synthesizes `error` with `reason: "unresponsive"`.** Derivation, same discipline: the longest legitimate gap between messages is one chunk, worst 3.8 s × 3.7 load ≈ 14 s, so 30 s is roughly 2× the legitimate worst gap. No retry cap is needed — unlike the preview watchdog there is nothing to recover and nothing to re-post; one worker per run means the kill is the whole recovery. A tool that trips this has violated the chunking rule, and the watchdog is that rule's only enforcement.

Both deadlines get a test that exercises the kill (Sec.9), not an assumption that it works.

### 4.2 Inbound validation and size caps (rev-4 B6)

Rev 4 validated host→tool (`params`) and edit bounds, and left the direction that feeds the UI unguarded. `ToolMessage` is a TypeScript type, which is a compile-time fiction for an external process: a v1.1 tool can emit malformed JSON, well-formed JSON that is not a `ToolMessage`, a `severity` with `level: "catastrophe"`, or a `table` whose `rows` are numbers. Rev 4's own reasoning for edit-bounds validation — "a buggy external tool can emit anything" — applies verbatim.

**Specify runtime shape validation at the transport boundary**: one narrow validator per message kind, never trusting the discriminant, discard-with-visible-error (`reason: "protocol"`) on failure. Plus explicit caps, all `[tune]` and all stated so an implementer does not have to invent them: max NDJSON line **8 MB**; max blocks per `ToolOutput` **1000**; max rows rendered per table **10,000** with a "showing first N of M" affordance; max text length per block **100,000** characters. A single 500 MB NDJSON line OOMs the host before any render-side cap can help. This is the v1.1 trust boundary's largest surface, larger than `params`.

### 4.3 Staleness, and the guard that actually matters (rev-4 B4)

**The version-based guard does not catch a stale *parse*, which is the corruption path that exists.** The worker's parse lags the model by design: `useParsedDocument.ts` debounces keystrokes (150 ms) and drops out-of-order responses by `requestId` (verified 2026-08-10). So at Run time `parseResult.source` can already differ from `model.getValue()`. The tool computes offsets against text that is not in the model, nothing changes the model during the run, a version comparison passes, and Apply lands N edits at wrong offsets. Same-version garbage, silently — the class BUG-001 was.

Pin four things:

1. **`ctx.source` and `ctx.parseResult.source` are the same string, always.** That string is "the run's document snapshot" everywhere this document uses the phrase, including `codeRef` spans.
2. **Run is gated on `model.getValue() === ctx.parseResult.source`**, and Apply re-checks the same equality — not a bare version comparison. `ParseResult.source` exists precisely for this and CodePane already uses it that way.
3. If a version id is kept at all, use **`getAlternativeVersionId()`** (matching `useDocument.ts:52`), so edit-then-undo back to the snapshot re-enables Apply instead of disabling it forever.
4. **Run is disabled for `read-ast` tools until the first parse lands** — `parseResult` is `ParseResult | null` until then.

### 4.4 Stale-run message rejection (rev-4 B5)

Neither message type carries a run id, and the discard rule is "messages after a terminal are discarded" — but a cancelled run never sends a terminal, it has up to 15 s of grace. If the host spawns run B without waiting, run A's late `partial` replaces B's output area, because `partial` is a full redraw. For external tools it is worse: a SIGKILLed process can be writing to stdout for the whole grace window.

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

**Param validation at run time, not just registration (rev 4):** the host validates and clamps submitted values against each `ToolParamDef` — min/max, options-membership, and for `multiSelect` that every selected value is an option — before they enter `ctx.params`. Implicit while the host owns the form; stated because v1.1 makes `params` part of the trust boundary and manifests arrive from strangers.

**Concurrency (rev 3 — pinned): one run at a time, app-wide.** Not per-tool: a single active run means one run-state in `host.ts`, one document snapshot for the staleness guard, and one progress surface. Switching tools or re-running while a run is active cancels the current run after a confirm.

**A run is pinned to a document, and the document can be replaced (rev-4 L1).** `useDocument.ts` holds **one module-level Monaco model** for the app's whole lifetime (`:22`) and File → Open calls `setValue(text)` (`:162`) rather than creating a new model. So "the document" can become an entirely different script mid-run. **Cancel the run when the open document is replaced** (File → Open / New), next to the tool-switch rule. Without this the run keeps burning CPU against a closed script, and `codeRef` jumps still fire against it with the soft "code changed" notice — which badly understates "you are looking at a different file" (Sec.2's `codeRef` wording handles that half).

**Echo the run's settings into the output header (rev-4 L2).** `playerCount`, `mapSize`, teams and any params are live app state snapshotted at `run`, and the flagship tool's entire output is conditioned on them. Change the player count mid-run and the pane shows results computed for the old value, labelled with nothing. This needs no guard — a header line ("run at 8 players, Normal / 200×200, 2v2v2v2") makes a stale result self-describing instead of silently wrong, and it is where a tool's seed param belongs too.

**`ui-help.json` entries the pane owes (rev-4 Minor, re-measured 2026-08-10).** CLAUDE.md's hard rule is a HelpTip plus a matching `ui-help.json` entry for every interactive element, as it is built. The file has **97 entries** and exactly two tools-adjacent ids — `tabBar.advancedTools` and `settings.tab.advancedTools` — neither inside the pane. Name these now so the 5.1 session cannot skip them: `tools.select`, `tools.run`, `tools.cancel`, `tools.progress`, `tools.apply`, `tools.log`, `tools.output`. For scale, `preview.*` carries 12 ids for a pane of comparable complexity; that is the bar.

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
  generated/        GameConstantsData, generated from reference/schemas/*.schema.json (Sec.2)
  PROTOCOL.md       prose spec of Sec.4 for non-TS tool authors (v1.1; stub now).
                    Must carry: the sentinel encode/decode, the prohibited value set
                    (Sec.1), "build your own LanguageIndex", the selection-is-an-anchor
                    note, and the per-language cancel-delivery recipe (Sec.10).
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

**`tools-api/` at the repo root is outside the typecheck gate — fix this in the session that creates the directory (rev 5).** `tsconfig.json:23` is `"include": ["src"]`, so `npm run typecheck` (`tsc --noEmit`) would never see a root-level `tools-api/index.ts`, which is the one file in this repo destined to be a *published* artefact. ESLint would still cover it (`eslint.config.js:11` globs `**/*.{ts,tsx}`) but the purity gate at `:35-39` would not, since its globs name the three `src/` directories explicitly. **Either add `tools-api` to `include` and to the purity globs, or put the contract under `src/`.** Verified 2026-08-10. Decide it in the same session as `mkdir`, or the contract ships untypechecked and nobody finds out.

## 9. Test plan

The rev-4 preamble called this "no critique pass — read this hardest". Three independent rounds have since happened; the tests below are the surviving obligations, not a substitute for review.

1. **Serialization round-trip.** Every `ToolContext`/`ToolMessage` fixture survives `JSON.parse(JSON.stringify(x))` under **`toStrictEqual`** (not `toEqual` — see Sec.4), including a real `parseRms` result over a corpus map (the external transport in miniature). Fixtures must include: an explicit `inf`/`-inf` case asserting the sentinel round-trips, **an object with an `undefined`-valued optional field, and an array containing one** (rev 5 — the two cases where the transports disagree, and the ones `toEqual` was blind to).
2. **The neighbouring spec's input type is constructed from this one (rev 5, finding N7 — the highest-value item in this revision).** A test that builds a `PreviewSettings` out of a `ToolContext` and calls `generatePreview` with it. Four lines, and it is the flagship tool's actual first step.

   Why this one earns its place: **three consecutive revisions were broken by the same dependency.** Rev 3 typed `settings.mapSize` as `number` when the app had a string union. Rev 4 had `mapSize.tiles` with no source of truth while the data had one, in a directory the search did not cover. Rev 5 found `settings` missing `teams`, added to the app three weeks earlier. Each was caught by a human reading two documents side by side, and each was filed as "a cross-doc data dependency same-author review structurally misses" — a rule that has now failed three times, because it asks a reader to notice an absence. This test **stops compiling the day `PreviewSettings` grows a required field**, which is precisely the event all three findings are instances of. Prefer the compile error to the rule, for the same reason this project prefers an observable to an argument.

   State its limit honestly rather than overselling it: it catches added *required* fields and changed types. It does not catch a new optional field, or a field whose meaning changes under a stable type. Those still need a reader.
3. **Lifecycle.** progress→result ordering; message-after-terminal discarded; cancel synthesizes `reason: "cancelled"`; worker-crash synthesizes error; synchronous throw from `run` synthesizes error; **cancel against a deliberately non-chunked busy-loop tool hard-kills at the 15s deadline with `reason: "killed"`**; **a tool that emits nothing at all is killed by the run watchdog at 30s with `reason: "unresponsive"`** (rev 5 — the path that did not exist through rev 4). The kill paths are exercised, never assumed.
4. **Stale-run message rejection** (Sec.4.4): cancel A, start B, A emits `partial`, assert B's output survives.
5. **Malformed inbound messages** (Sec.4.2): invalid JSON, valid JSON that is not a `ToolMessage`, an out-of-enum `severity.level`, a table with non-string rows, and an over-cap line — each discarded with `reason: "protocol"` and a visible error, never rendered.
6. **Capability enforcement, both directions.** A tool without `read-source` gets no `source` (the context path — untested through rev 4, only the edits direction was covered); a tool without `edit-source` has its edits dropped with a warning.
7. **Edit application.** N edits as a **single undo entry**; overlap rejection; malformed-bounds rejection of the whole set; the Sec.4.3 source-equality gate blocking Apply after a model change; **Apply re-enabled after undo back to the snapshot**; `reparseNow` fired after apply.
8. **Document replace** (Sec.5): start a run, open a different file, assert the run is terminated and Apply is gone.
9. **scriptStats end-to-end** through the real pane.

## 10. Known risks and open questions

- **`partial`-as-full-redraw may be slow for huge tables.** Mitigated by Sec.4.2's row cap plus a "show all" affordance; not measured.
- **`ParseResult` serialization cost for external tools** is per-run (fine), but the v1.1 process spawn should send context *after* the consent gate, not before.
- **The 15s cancel grace and SIGKILL need Windows-specific testing** under Tauri's shell plugin.
- **`OutputBlock` deliberately has no markdown** — resist adding it until a sanitization story exists.
- **`apiVersion` checking must reject, not warn**, or v1.1 tools will depend on leniency.
- **The chunked-cancel recipe is JS-shaped (rev 4).** A single-threaded Python tool blocking on `stdin.readline()` while working never sees `cancel`. PROTOCOL.md needs a per-language delivery recipe (non-blocking stdin poll between chunks, or a dedicated reader thread setting a flag) before v1.1 ships. Note this interacts with the run watchdog: a tool that cannot see `cancel` also cannot emit between chunks, so it will be killed as `unresponsive` — which is the correct outcome and should be documented as such rather than discovered.
- **5.2 will find the Monte Carlo budget does not close (rev 5).** PLAN.md and CREATION_PLAN 5.2 both assume "1000 runs … should be seconds, not minutes". At the measured median of ~460 ms per generation that is roughly **8 minutes for one player count and ~30 for the 2/4/6/8 matrix**. `collectSnapshots: false` is the only cost knob the generator offers (`generator/types.ts:59`) and its effect has never been measured. This is a 5.2 problem, not a 5.1 one, but **the protocol's progress/cancel/`partial` design is sized by it** — which is most of why those three exist.

### 10.1 The 5.2 data-readiness warning, re-pointed (rev 5)

Rev 3's warning said the checker's static layer keys on `resourceAmounts`/`constId`, which are "all placeholders until Phase 4.0 lands". **That is no longer true and will be ignored the first time someone checks the file.** Measured 2026-08-10: 164 entries, **2** null `constId`, **44** `verified: true`.

What is still soft, and this is what the warning should say instead:

- **`resourceAmounts` exists on 8 of 164 entries** (33 of which are objects) — still exactly the hand-written placeholders: GOLD, STONE, FORAGE, DEER, BOAR, SHEEP, FISH, SHORE_FISH.
- **116 of 131 terrain rows are `verified: false`** (community-sourced), against 29 of 33 objects verified.
- `language.json` is 28/41 commands and 38/94 attributes verified.
- `src/parser/resourceTotals.ts` does not model script-level resource modifiers at all (CLAUDE.md tracked debt), so a resource-based finding is computed against base values regardless of what the script does to them.

Build the checker's *structure* against this freely; do not present its static-analysis output as trustworthy until those gaps close. Monte Carlo findings additionally wait on nothing — the generator is complete as of 2026-08-06 — but see the budget item above.

### 10.2 A standing instruction for the next review round

**Re-derive; do not transcribe.** Rev 5 folded in a review that was eleven days old and accurate the day it was written, and four of its twelve findings had decayed: one already implemented, one solved in code by a different route, one whose prescribed fix would now do harm, one factually inverted in a way that would have "corrected" two documents that were already right. **The half-life of an undated repo claim here is on the order of a week**, and neither a spec nor a review gets an exemption. A critique is a repo snapshot too.

The mechanical version of that advice is Sec.9's item 2, and it generalises: where a finding is about a dependency on another spec's types, prefer a test that stops compiling to a note telling the next reader to be careful.
