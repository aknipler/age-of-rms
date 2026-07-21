# Advanced Tools API Design (Phase 5.1, rev 4)

Contract for tools hosted in the Advanced Tools tab. Designed per PLAN.md: **v1 ships built-in (in-process) tools; v1.1 loads external process+manifest tools over stdin/stdout — both implement THIS same contract.** The API is therefore JSON-first: everything crossing the boundary must survive `JSON.stringify` round-trips, because for external tools it literally will. Written without a scheduled critique pass (token budget) — implementers should treat ambiguities as escalation points per house rule, and §9 lists the known open risks up front.

## 1. Goals

1. **One contract, two transports.** A tool is defined by the message protocol (§4), not by where it runs. Built-in tools implement `ToolImplementation` in-process; external tools speak the identical messages as NDJSON over stdin/stdout. The host cannot tell them apart above the transport layer.
2. **Tools are documents the app displays, not extensions of the app** (PLAN.md's model #1). A tool cannot add menus, hook events, or touch the DOM. It receives context, emits progress, and returns output blocks and/or code edits. This is what makes the v1.1 trust model tractable.
3. **Code is source of truth, still.** Tool edits are `TextEdit`s applied through the same shared-model path Breakdown uses (breakdown-design §6.4) — one undo entry, same staleness guard, never a bypass.
4. **Long-running work is first-class.** The flagship tool (Generation Consistency Checker, 5.2) runs thousands of generations: the protocol has progress and cancellation from day one, not bolted on.
5. **Serializable by construction.** `ParseResult` is already plain data (token indices, no cycles — a deliberate 2.3 property); the rest of the context is designed to match.

Non-goals v1: tool-defined interactive UI (output is declarative blocks; no HTML/JS from tools — that's the future webview tier, PLAN.md model #2); tool-to-tool communication; tools mutating files other than the open document; hot-reload of built-in tools.

## 2. Core types (`tools-api/` — shared, no React/Monaco/Tauri imports)

```ts
export const TOOLS_API_VERSION = 1; // bump on breaking protocol change; host rejects mismatches

export interface ToolManifest {
  id: string;                  // stable, kebab-case: "consistency-checker"
  name: string;                // display name
  version: string;             // tool's own semver
  apiVersion: number;          // must equal TOOLS_API_VERSION
  description: string;         // one-liner for the Select Tool dropdown
  capabilities: Capability[];  // §6 — everything not declared is denied
  params?: ToolParamDef[];     // run-configuration form, rendered by the host (§5)
  // v1.1 external tools add: entry (executable + args), language, author, homepage.
}

export type Capability = "read-source" | "read-ast" | "read-settings" | "read-reference" | "edit-source";
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

// Discriminated union (rev 3): `type:"integer", default:"foo"` is now unrepresentable,
// and select defaults must be one of the options (host validates at registration).
interface ParamBase { key: string; label: string; help?: string }
export type ToolParamDef =
  | (ParamBase & { type: "integer"; default: number; min?: number; max?: number })
  | (ParamBase & { type: "boolean"; default: boolean })
  | (ParamBase & { type: "text"; default: string })
  | (ParamBase & { type: "select"; default: string; options: { value: string; label: string }[] });

export interface ToolContext {
  apiVersion: number;
  source?: string;             // iff "read-source"
  parseResult?: ParseResult;   // iff "read-ast" — the worker's parse, plain JSON
  // iff "read-settings". mapSize is NOT a number in the app (rev 3 —
  // generationSettingsConstants.ts defines a string union of SEVEN sizes
  // including Giant; rev 3's "Tiny"|…|"Huge" elision was itself a bug);
  // the context carries BOTH the display name (plain string, since external
  // tools can't import the union) and the resolved tile dimension.
  //
  // tiles' SOURCE OF TRUTH (rev 4 — previously unnamed, and the one candidate
  // table is known-broken): no name→tiles mapping exists in src/ today. Create
  // ONE — `MAP_SIZE_TILES` next to MAP_SIZES in generationSettingsConstants.ts,
  // sourced from the guide's Map Sizes table (parser-design §7.4; archived
  // guide) — and make the context builder AND the Phase-4 preview consume that
  // same constant. DO NOT copy preview-design §4's table: it lists 6 sizes,
  // omits Giant, and carries an unreconciled ordering issue (MAP_SIZES orders
  // Giant before Huge while in-game Giant=252 > Huge=240 — flagged there as
  // "reconcile during 4.3"). Building the mapping resolves half of that;
  // cross-reference it when you do.
  settings?: { playerCount: number; mapSize: { name: string; tiles: number } };
  referenceData?: { language: LanguageData; gameConstants: GameConstantsData }; // iff "read-reference"
  // GameConstantsData (rev 3): typed mirror of game-constants.json's schema — define it
  // next to LanguageData in src/parser/language.ts (action item; `unknown` gave external
  // authors no contract for the one payload the flagship tool depends on).
  params: Record<string, number | boolean | string>;   // user's values for manifest.params
  // Deliberately absent: file paths, fs access, selection (v1 — no tool needs it yet; add
  // as a new capability when one does, don't widen silently).
}

export interface TextEdit { start: number; end: number; newText: string } // same shape as breakdown §4.1

export interface ToolOutput {
  blocks: OutputBlock[];       // declarative display — the pane renders these, tools render nothing
}

export type OutputBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }                    // plain text w/ \n; NO markdown/HTML in v1
  | { kind: "keyValue"; rows: [string, string][] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "severity"; level: "info" | "warning" | "error"; text: string }
  | { kind: "codeRef"; text: string; offset: number }; // clickable — jumps Code tab to offset.
    // Offsets are relative to the run-time snapshot: if the document version changed since
    // the run, the jump still fires (clamped to document length) with a "code changed since
    // this ran" notice — consistent with, but softer than, the Apply staleness guard (rev 2).
```

## 3. Tool implementation (in-process form)

```ts
export interface ToolRunHandle { cancel(): void }

export interface ToolImplementation {
  manifest: ToolManifest;
  run(ctx: ToolContext, emit: (msg: ToolMessage) => void): ToolRunHandle;
}
```

`run` returns immediately; all results flow through `emit`. Built-in tools that do heavy CPU work (the checker's Monte Carlo) run inside a **tool worker** (not the parser worker — a stuck tool must not stall diagnostics), where `emit` is `postMessage`. A synchronous throw from `run` is caught by the host and synthesized into an `error` terminal, same as a crash (rev 2).

**Worker lifecycle (rev 4 — pinned): one worker per run.** The host spawns a fresh tool worker at `run`, and terminates it after the terminal message (or the 5s kill). Consequences, both deliberate: `worker.terminate()` needs no recovery logic (the next run spawns anew), and **tool module state cannot persist across runs** — a tool that wants persistence must put it in its output, not in globals. Spawn cost is irrelevant at one-run-at-a-time frequency (§5).

**Who calls what (rev 3 — the handle/message relationship, stated instead of presumed):** `ToolRunHandle.cancel()` is the *in-process binding* of the `cancel` message; `HostMessage` is the *transport encoding*. Concretely: the host's Cancel button → host posts `{type:"cancel"}` to the tool worker (or writes it to the external tool's stdin) → the **worker shim's message handler** (which is host-authored plumbing, always responsive even while the tool's chunk is running… once the chunk yields) invokes the in-worker `handle.cancel()` → which sets a flag in the tool's closure, observed at the next chunk boundary. For a hypothetical main-thread tool the host would call `handle.cancel()` directly — same binding, no transport.

**Cancellation across a worker boundary (rev 2 — rev 1's "cancel() sets a flag the tool polls" was unimplementable: the host cannot set a flag in the worker's memory, and a tool in a tight synchronous loop never services the worker's event loop, so a posted cancel message would never arrive).** The rule, uniform across both transports: **tools MUST structure long work as awaitable chunks**, yielding to their event loop between units (the checker's unit = one batch of generations; `await new Promise(r => setTimeout(r, 0))` suffices). Cancel is delivered as a message (worker `postMessage` / stdin `{type:"cancel"}`); a chunked tool sees it within one unit. If no terminal arrives within **5s** of cancel, the host **hard-kills** — `worker.terminate()` for built-ins, SIGKILL for external processes — and synthesizes `error: "cancelled"`. Chunking is also what makes `progress` emission possible at all, so this constraint costs well-behaved tools nothing.

**Built-ins may import app modules** (rev 2, stated plainly): the contract governs host↔tool *communication*, not what code a tool links against. The checker imports the Phase-4 preview generator directly — which means it is **not expressible as an external tool** until the generator is extracted into a standalone library; that's accepted, and it is the honest boundary of "one contract, two transports": the contract is portable, a given tool's dependencies may not be.

## 4. The message protocol (the actual contract)

One request, a stream of responses, one terminal message. For external tools each message is one NDJSON line (UTF-8, `\n`-delimited) — host→tool on stdin, tool→host on stdout; stderr is captured into a collapsible "tool log" block — **capped as a ring buffer (last 64KB; rev 4)**, since a chatty external tool must not balloon memory.

**Infinity survives the boundary via sentinel encoding (rev 3; typed honestly rev 4):** `ArgValue` legitimately holds `Infinity`/`-Infinity` (`inf`/`-inf` words, parser §2.2), and `JSON.stringify(Infinity)` → `null` — silent AST corruption for any script using `inf`. Rule: the **context builder** deep-converts `±Infinity` → `{ "inf": 1 } | { "inf": -1 }` when constructing `ToolContext`, for **both** transports, so built-in and external tools see byte-identical data.

- **The wire form is its own type (rev 4 — `parseResult: ParseResult` was a lie post-conversion):** `ToolContext.parseResult` is typed **`SerializedParseResult`** — structurally `ParseResult` with every `ArgValue` `number` position widened to `number | { inf: 1 | -1 }`. The compiler then *forces* tools through the decoder; rev 3's `numeric()`-by-convention would have compiled `value * 2` and broken at runtime.
- **Sentinel decoding is a PROTOCOL rule, not a shipped runtime (rev 4 — resolves the contradiction with §8's types-only publishing):** PROTOCOL.md documents the encoding and each language reimplements the 3-line decode. In-repo, `tools-api/index.ts` exports a `numeric()` helper for built-ins' convenience — that's app code, not part of the published `.d.ts`.
- **NaN cannot occur (rev 4, one sentence as requested):** v1 never evaluates expressions, and `ArgValue` numbers come only from `Number(text)` over the lexer's `/^-?\d+(\.\d+)?$/` and rnd-bounds regexes, which cannot produce NaN — no sentinel needed; the context builder asserts this in dev builds.

The §9 round-trip test gains an explicit `inf` fixture — the corpus may not happen to contain one.

```ts
// host → tool (exactly one)
export type HostMessage = { type: "run"; context: ToolContext } | { type: "cancel" };

// tool → host (zero+ progress/partial, then exactly one terminal)
export type ToolMessage =
  | { type: "progress"; fraction?: number; note?: string }   // fraction ∈ [0,1]; omit for indeterminate
  | { type: "partial"; output: ToolOutput }                  // replaces the pane's output area (idempotent redraw)
  | { type: "result"; output: ToolOutput; edits?: TextEdit[] } // terminal — success
  | { type: "error"; message: string };                       // terminal — failure; host renders as severity:error
```

Rules: messages after a terminal are discarded with a console warning; a tool that exits (external) or returns-without-terminal (worker crash) yields a synthesized `error`; `cancel` → tool should terminate promptly, host synthesizes `error: "cancelled"` if it doesn't within 5s (external: then SIGKILL). `partial` exists so the checker can stream findings while running; it must be a full self-contained `ToolOutput`, not a delta.

**Progress throttling (rev 2):** tools should emit ≤10 `progress`/s; the host coalesces renders (latest wins, ~100ms cadence) regardless, so a flooding tool degrades its own log, not the UI.

**Undeclared-capability edits are rejected (rev 2):** a `result` carrying `edits` from a tool whose manifest lacks `edit-source` has its edits **dropped** with a visible warning block — never applied. Capability enforcement runs on both directions of the contract, not just context construction.

**Edits are proposals.** A terminal `result` with `edits` does NOT auto-apply: the pane shows an "Apply N changes" button (plus per-edit `codeRef`s if the tool listed them in output). On apply: edits are validated — **overlap, and (rev 4) malformed bounds: `start > end`, negative offsets, or `end` beyond the snapshot length; ANY violation rejects the whole set** with an error block (a buggy external tool can emit anything; the staleness guard alone doesn't catch same-version garbage) — then sorted descending by `start` and applied to the shared model as **one** `pushEditOperations` batch = one undo entry. **Staleness guard:** the host records the document version at `run` time; if the model changed since, Apply is disabled with "the code changed while the tool ran — re-run". Never rebase tool edits; re-run.

## 5. The pane (host UI, 5.1 implementation scope)

`Select Tool` dropdown (from registered manifests) → params form (from `manifest.params`, typed like §3.4 breakdown editors, HelpTips per convention; **rev 4: the host validates/clamps submitted values against each `ToolParamDef` — min/max, options-membership — before they enter `ctx.params`, at run time, not just defaults at registration.** Implicit while the host owns the form; stated because v1.1 makes `params` part of the trust boundary and manifests arrive from strangers) → Run/Cancel button → progress bar (`progress` messages) → output area (rendered `OutputBlock`s) → Apply-edits button when present. "Waiting for tool selection…" empty state per the mockup. **Concurrency (rev 3 — pinned): one run at a time, app-wide.** Not per-tool: a single active run means one run-state in `host.ts`, one document-version snapshot for the staleness guard, and one progress surface. Switching tools or re-running while a run is active cancels the current run after a confirm. (Concurrent runs are a v1.x question nobody has asked for.)

## 6. Capabilities and trust

v1 built-ins are trusted code; capabilities still gate what the host puts in `ToolContext` (least privilege keeps the contract honest, and the checker needs everything anyway: `read-source, read-ast, read-settings`). v1.1 external tools: the manifest's declared capabilities are shown in the install/run consent dialog ("This tool can read your script and propose edits"); `edit-source` never auto-applies (§4 already guarantees this); undeclared context fields are simply absent. The process-level risks (arbitrary code execution) are handled by the v1.1 trust flow per PLAN.md (unvetted warning + curated registry) — out of scope here, but the contract deliberately gives external tools no ambient authority beyond their stdin.

## 7. Built-in registry (v1)

`src/tools/registry.ts` exports `TOOLS: ToolImplementation[]`. 5.2's checker is the flagship; a second cheap tool ("Script Statistics": counts of commands/attributes/constants, token count, expression count — pure read-ast, finishes instantly) ships alongside as the protocol's trivial exemplar and smoke test. The formatter and constants auditor (CREATION_PLAN 5.2b) slot in later without API changes.

## 8. File layout

```
tools-api/
  index.ts          every type in §2 + §4; the contract. Rev 3, honestly restated: this file
                    HAS type-only imports from src/parser (ParseResult, LanguageData,
                    GameConstantsData) — "no app imports" was false as written. The rule is:
                    NO RUNTIME imports (nothing executable crosses in), and the eventual
                    published artifact is a BUNDLED .d.ts (api-extractor/dts-bundle style)
                    that flattens the parser types in — which is possible precisely because
                    they are plain-data interfaces. Inverting the dependency (parser imports
                    the contract) was considered and rejected: the parser predates and
                    outranks the tools API.
  PROTOCOL.md       prose spec of §4 for non-TS tool authors (v1.1; stub now)
src/tools/
  registry.ts       TOOLS list
  host.ts           run lifecycle, worker plumbing, cancellation, staleness guard (no React)
  ToolsPane.tsx     §5 UI
  toolWorker.ts     worker entry for built-in tools
  builtin/
    scriptStats.ts  §7 exemplar
    consistencyChecker/   (5.2)
  __tests__/
    protocol.test.ts   §9 round-trip + lifecycle tests
```

## 9. Test plan and known risks (no critique pass — read this hardest)

Tests: (1) **serialization round-trip** — every `ToolContext`/`ToolMessage` fixture survives `JSON.parse(JSON.stringify(x))` deep-equal, including a real `parseRms` result over a corpus map (the external transport in miniature) **and an explicit `inf`/`-inf` fixture asserting the sentinel encoding round-trips (rev 3 — plain Infinity would silently become null)**; (2) lifecycle — progress→result ordering, message-after-terminal discarded, cancel synthesizes error, worker-crash synthesizes error, **synchronous throw from `run` synthesizes error, and cancel against a deliberately non-chunked busy-loop tool hard-kills at the 5s deadline (rev 2 — the worker-terminate path must be exercised, not assumed)**; (3) edit application — descending-sort application, overlap rejection, staleness guard blocks Apply after a model change, single undo entry, **undeclared-capability edits dropped with warning**; (4) scriptStats end-to-end through the real pane.

**Rev 2 changelog (self-critique, same author — weight accordingly):** worker cancellation re-specified (rev 1's poll-a-flag was unimplementable across the worker boundary; now mandatory chunked work + message delivery + uniform 5s hard-kill, with the busy-loop kill path tested); `read-reference` capability added (the checker's static layer needs game-constants/full language data — the flagship tool couldn't run on rev 1's context); built-ins-may-import-app-code stated plainly (the checker links the Phase-4 generator, so it is not externalizable until that's a library); undeclared-capability edits rejected on the result path, not just stripped on the context path; codeRef staleness pinned (clamped jump + notice); `text` param type; synchronous-throw handling; progress throttling.

**Rev 3 changelog (independent critique — the useful kind; all 8 findings adopted, one fix redirected):** `settings.mapSize` was typed `number` but is a string union in the app — now `{ name, tiles }` so tools get arithmetic and display without importing anything; Infinity sentinel encoding (`{inf: ±1}`) applied by the context builder on both transports + `inf` round-trip fixture (JSON.stringify(Infinity) → null was silent AST corruption); `read-ast` now *implies* `read-source` — the critique offered stripping `source` as an alternative, rejected here because `tokens[].text` reconstructs the document anyway (stripping would be security theater); tools-api's "no app imports" restated honestly (type-only imports, bundled .d.ts at publish); the handle↔message cancel binding stated explicitly; concurrency pinned to one-run-app-wide; `ToolParamDef` made a discriminated union; `GameConstantsData` typed (action item in language.ts); `HostMessage` exported; 5.2 sequencing warning added below.

**5.2 sequencing dependency (rev 3):** the checker's static layer keys on `resourceAmounts`/`constId` in game-constants.json — which are **all placeholders until the Phase 4.0 extraction lands** (CLAUDE.md), and several language.json sections remain `"verified": false`. The API is ready before the data is: build the checker's *structure* against it freely, but do not present its static-analysis output as trustworthy (or demo it to the Discord) until 4.0 replaces the placeholder data. Monte Carlo findings additionally wait on the Phase 4 generator itself.

**Rev 4 changelog (second independent critique — all 7 adopted):** `mapSize.tiles` given a named single source of truth (`MAP_SIZE_TILES` in generationSettingsConstants.ts, from the guide's Map Sizes table; preview-design §4's 6-row Giant-less table explicitly NOT the source, its Giant/Huge ordering issue cross-referenced; rev 3's own union comment had elided Giant); `SerializedParseResult` wire type so the compiler forces sentinel decoding (`numeric()` by convention would compile and break); sentinel decode = PROTOCOL.md rule per language, in-repo helper is app code, published artifact stays types-only; NaN impossible by construction (regex-sourced numbers, no evaluation) with a dev assert; one-worker-per-run lifecycle (no cross-run module state, terminate needs no recovery); edit bounds validation (malformed = reject whole set, like overlap); run-time param validation named as trust-boundary prep; stderr ring-capped at 64KB. The critique's process note stands: finding #1 was a cross-doc data dependency that same-author §9 self-listing structurally misses — scheduled independent critiques remain the house rule for a reason.

Known risks to watch (would normally be critique fodder): `partial`-as-full-redraw may be slow for huge tables (mitigate: cap table rows rendered, "show all" affordance); `ParseResult` serialization cost for external tools is per-run (fine) but the v1.1 process spawn should send context *after* the consent gate, not before; the 5s cancel grace + SIGKILL needs Windows-specific testing under Tauri's shell plugin; `OutputBlock` deliberately has no markdown — resist adding it until a sanitization story exists; `apiVersion` checking must reject, not warn, or v1.1 tools will depend on leniency; **the chunked-cancel recipe is JS-shaped (rev 4)** — a single-threaded Python tool blocking on `stdin.readline()` while working never sees `cancel`; PROTOCOL.md needs a per-language delivery recipe (non-blocking stdin poll between chunks, or a dedicated reader thread setting a flag) before v1.1 ships.
