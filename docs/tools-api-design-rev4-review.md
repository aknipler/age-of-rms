# Review: tools-api-design.md rev 4

Independent critique of `docs/tools-api-design.md` (Advanced Tools API, Phase 5.1, rev 4). Every repo claim below was checked against the working tree on 2026-07-30, with file:line. Where this note and the source disagree, re-check the source first — that is the failure mode this review is mostly about.

**Verdict:** the contract itself is sound and mostly ready to implement. The message protocol, the two-transport framing, edits-as-proposals, cooperative chunking plus hard-kill, and one-worker-per-run are all good calls and well argued. What needs work is in two clusters: (a) three of rev 4's premises about the repo are wrong — one stale, one never true, one true-but-misleading (see Process note) — and together they tell the implementer to deviate from another authoritative spec; (b) the host-side lifecycle has three silent-corruption holes that the described guards do not catch. Six blocking items, six significant, three late additions, a handful of polish.

**Second-pass verification (2026-07-30, same day, second reader).** Every repo claim below was re-derived from the working tree. All twelve numbered findings survive in substance and the line references are accurate; B4 is the strongest of them. Corrections made in this pass: five claims were imprecise in ways that would mislead whoever implements the fix (B1's description of the `predefinedLabels` shape, B2's optionality prescription, B3's field-level detail, S2's formatter claim, the `ui-help.json` bullet); two Fix sections prescribed the more expensive of two options and now name both (B5, S5); S4's "complete set" of `Infinity` sites was missing one, and its recommendation understated its own cost. Three findings the first pass did not make are under **Late additions**. The stale-claim sweep in the edit list was also incomplete — it named two of four sites.

---

## Blocking

### B1. The `MAP_SIZE_TILES` prescription rests on three bad premises, and orders a deviation from an authoritative spec

*Heading corrected in the second pass: "false" was wrong for one of the three, and the distinction is the point.* Premise 1 is **literally true and still misleading** (the mapping is not in `src/`, it is in `reference/data/`, which is where this project's vocabulary is supposed to live — so the true statement licenses the wrong conclusion). Premise 2 is **stale** (it described rev 4 of another doc that is now at rev 5). Premise 3 is **false and was never true**. Three different failure modes, one wrong instruction.

Doc, Sec.2 (`tools-api-design.md:64-73`): "no name→tiles mapping exists in src/ today. Create ONE — `MAP_SIZE_TILES` next to MAP_SIZES in generationSettingsConstants.ts, sourced from the guide's Map Sizes table … and make the context builder AND the Phase-4 preview consume that same constant. DO NOT copy preview-design Sec.4's table: it lists 6 sizes, omits Giant".

What the repo says:

1. **The mapping already exists as data.** `reference/data/language.json`'s `predefinedLabels` holds 138 entries, `verified: true` on all of them. 21 are `category: "mapSize"` and **all 21 carry `dimensions`** (the side length in tiles). 13 of those additionally carry a `mapSize` field, and *that* field — not `name` — is what holds a `MAP_SIZES` member: `"Tiny"`, `"Small"`, `"Medium"`, `"Normal"`, `"Large"`, `"Huge"`, `"Giant"`. All seven app sizes are covered. `age-of-rms/CLAUDE.md` records the landing. True as literally written ("in src/"), but the search stopped one directory short of the answer.

   *Corrected in the second pass, because the distinction changes the lookup code.* `name` is the engine label (`TINY_MAP`, `MAPSIZE_TINY`); `mapSize` is the app-facing picker value. Two consequences for B1's fix: (a) **six of the seven sizes match two entries**, the legacy and modern label for the same grid (`LARGE_MAP` and `MAPSIZE_NORMAL` both → `"Normal"`, 200), and Giant matches exactly one (`MAPSIZE_GIANT`, 252, no legacy name) — so the resolver is a `.find()`, or a `Map` built with a deliberate "both agree, keep either" comment, never a uniqueness assertion; (b) the other 8 `mapSize` entries have **no** `mapSize` field on purpose (`MAPSIZE_MINI` 80, the MORE_MAP_SIZES tier `MASSIVE` 276 … `LUDICROUS` 480, `LUDIKRIS_MAP` 480) because no picker value selects them, so a resolver keyed on `dimensions` alone would silently accept a size the app cannot be in.
2. **`preview-design.md` is at rev 5 and its Sec.4 table has seven rows including Giant 252×252** (`preview-design.md:68-76`). The "6 rows, omits Giant" reading describes rev 4 of that doc, which has since been superseded.
3. **preview-design rev 5 pins the generator on the data, not on a constant.** Sec.12 item 1: "`mapSize` entries additionally carry `dimensions` plus the matching `MAP_SIZES` value — so **Sec.4's offset table is now data** … **The preview and `validate()` read the same array** — one source, not two hand-rolled lists." Sec.3.1 repeats it and keeps a `refDb.predefinedLabels ?? []` guard as the regression backstop.

So "make the Phase-4 preview consume that same constant" instructs an implementer to deviate from an authoritative spec, which `CLAUDE.md`'s first hard rule forbids without escalation, and to hand-transcribe the guide's table a third time in violation of the data-driven-vocabulary rule.

It has already propagated to **four** sites, not one (second pass — the first pass named two):

- `tools-api-design.md:64-73` — the prescription itself.
- `tools-api-design.md:203` — rev 4's own changelog, repeating "preview-design Sec.4's 6-row Giant-less table".
- `docs/build-log.md:172` — the Next line: "create MAP_SIZE_TILES from the guide table, wiring preview-design Sec.4's future consumer to it".
- `docs/build-log.md:170` — the rev-4 log entry, repeating "6 rows, omits Giant".

The two changelog entries (`:203`, `build-log.md:170`) are history and arguably immune to correction, but they carry a *factual* error about another live doc, and history is exactly what the next reader greps. Append a bracketed correction rather than rewriting them; delete outright only the two forward-looking instructions.

**Fix.** Keep `settings.mapSize: { name, tiles }` in the context — that shape is right and rev 3 earned it. Change only where `tiles` comes from: the context builder resolves it from `predefinedLabels` (`category === "mapSize" && entry.mapSize === name` → `dimensions`), same array the preview and `validate()` read, same `?? []` guard. If the settings pane wants a lookup object for display, derive it from the data at module load, or add a referential-integrity check to `npm run validate:reference` asserting the constant agrees with `predefinedLabels`. Do not hand-type a fourth copy. Drop the "DO NOT copy preview-design Sec.4" instruction and the "6 rows" claim; cite preview-design Sec.12 item 1 instead. Delete the corresponding half of the build-log Next line.

The Giant/Huge issue that survives is narrower than the doc implies: the *dimensions* are already unambiguous in the data (Giant 252 > Huge 240). Only `MAP_SIZES`' display ordering in `generationSettingsConstants.ts:15-23` is unreconciled, and preview-design Sec.15 item 6 already owns it for 4.3. Cross-reference, do not re-adjudicate.

### B2. `LanguageData.predefinedLabels` is typed as a lie, and this doc is what publishes it

`src/parser/language.ts:82` declares `predefinedLabels?: string[]` with the comment "absent today". The data holds 138 *objects* (`name`, `category`, `description`, `dimensions`, `mapSize`, `verified`, `notes`). Nothing catches this: `parserWorker.ts:21` reaches the type through a double cast (`as unknown as LanguageData`), which is exactly what a double cast buys.

This matters more here than anywhere else in the codebase, because `ToolContext.referenceData.language` publishes `LanguageData` as the `read-reference` contract, and rev 4's whole argument for typing `GameConstantsData` was that `unknown` "gave external authors no contract". A type that actively misdescribes the array is worse than an absent one. It is also load-bearing for B1's fix.

**Fix.** Add it to the same action item as B3: type `PredefinedLabel` properly against `reference/schemas/language.schema.json`'s `$defs/predefinedLabel` (`name`, `category` as the 10-member literal union the schema enumerates, `description`, `verified` required; `dimensions`, `mapSize`, `notes` optional), and pin that the published `.d.ts` is validated against the schemas rather than hand-maintained beside them.

*Sharpened in the second pass.* "Non-optional-with-guard **or** keep `?`" was a false choice: `predefinedLabels` is in the schema's top-level `required` array, so `validate:reference` already fails CI if it goes missing and the honest type is **non-optional**. But that collides with a live instruction — preview-design Sec.3.1 and Sec.12 item 1 both mandate keeping the `refDb.predefinedLabels ?? []` guard as a regression backstop. Under a non-optional type that guard reads as dead code and the next cleanup pass deletes it. Resolve it explicitly rather than leaving the next session to guess: declare the field non-optional and keep the guard **with a comment naming what it defends against** — the double cast at `parserWorker.ts:21`, which is what lets a malformed data file reach a consumer with the type system smiling. Same reasoning as the existing double-cast comments; without it the two rules look contradictory.

### B3. `GameConstantsData` already exists — twice — and one copy is already complete

Rev 3's action item (`tools-api-design.md:76-78`): "define it next to LanguageData in src/parser/language.ts". The repo already has:

- `src/editor/aoe2RmsHover.ts:64-76` — `GameConstant` + `GameConstantsData`, **full fidelity including `resourceAmounts`**, but private to that module.
- `src/breakdown/gameConstants.ts:5-17` — `GameConstantEntry` + `GameConstantsData`, exported, **missing `resourceAmounts`** (the one field the checker's static layer keys on).
- `src/parser/resourceTotals.ts:55-62` — `ResourceObjectConstant` + `GameConstantsForTotals`, deliberately narrow, has `resourceAmounts?: Partial<ResourceAmounts>`, no `constId`.

Defining a new one makes four views and a third type named `GameConstantsData`.

**Fix.** Rewrite the action item as a move, not a creation: promote the hover's complete interface to the parser home, export it, and have the other views import or alias it. Note for the checker's benefit that `resourceAmounts` is **optional and per-resource-partial** (present on 8 of 31 entries today) and `constId` is `number | null` — the static layer must handle both, and the doc currently says "keys on `resourceAmounts`/`constId`" as though both were always present.

Two field-level details the second pass adds, because "promote the hover's interface" is not quite a mechanical move:

- **Keep the hover's `category: "terrain" | "object"`**, which matches the schema enum, not the breakdown copy's `category: string`. Promoting the weaker one throws away a check the data already earns, and `src/breakdown/gameConstants.ts` is the one that has to widen, not the other way round.
- **`constId` and `deTextureFile` are NOT in the schema's `required` list**, yet both existing TS copies declare them non-optional as `number | null` / `string | null`. Today every one of the 31 entries has both keys present, so nothing is broken, but the promoted type is about to become a *published contract* for external authors. Decide deliberately: either make them `?`-optional and match the schema, or add them to the schema's `required` array so the type is true by CI. Do not publish a third silent divergence.

### B4. The staleness guard does not catch a stale *parse*, which is the corruption path that actually exists

Doc, Sec.4 (`:153`): "the host records the document version at `run` time; if the model changed since, Apply is disabled". Sec.2 (`:57`): `parseResult` is "the worker's parse".

The worker's parse lags the model by design: `useParsedDocument.ts` debounces keystrokes (150ms) and drops out-of-order responses by `requestId` (`:78`, `:95`). So at Run time, `parseResult.source` can already differ from `model.getValue()`. The tool then computes offsets against text that is not in the model, nothing changes the model during the run, the version-based guard passes, and Apply lands N edits at wrong offsets. Same-version garbage, silently — the class BUG-001 was.

`ParseResult.source` exists precisely to close this, and CodePane already uses it that way (`useParsedDocument.ts:27`: "`model.getValue() !== source` -> skip").

**Fix.** Pin three things: (a) `ctx.source` and `ctx.parseResult.source` are the same string, always; (b) Run is gated on `model.getValue() === ctx.parseResult.source` (or on an explicit parse-generation id) and Apply re-checks the same thing, rather than a bare version comparison; (c) use `getAlternativeVersionId()` if a version id is kept at all, matching `useDocument.ts:52`, so edit-then-undo back to the snapshot restores Apply instead of disabling it forever. Also state what `codeRef.offset` is relative to — "the run-time snapshot" is ambiguous between the model text and the parse's source, and after this fix they are the same string, which is the point.

While here: `parseResult` is `ParseResult | null` until the first parse response arrives (`useParsedDocument.ts:35`). Specify that Run is disabled for `read-ast` tools until it is non-null.

### B5. A cancelled run can paint over the next one, because nothing ties a message to the run that sent it

*(Heading changed in the second pass. The original was "No run identifier", which named one particular fix in the statement of the problem — and it is the fix this pass argues against.)*

`HostMessage` and `ToolMessage` carry no run id, and the discard rule is "messages after a terminal are discarded". A cancelled run never sends a terminal: it has up to 5s of grace before the hard kill. Sec.5 says re-running or switching tools "cancels the current run after a confirm" but not whether the host waits for the terminal-or-kill before spawning the next run. If it does not, run A's late `partial` replaces run B's output area, because `partial` is specified as a full redraw. For external tools this is worse: a SIGKILLed process can be writing to stdout for the whole grace window.

The in-repo precedent is right there: the parse worker solves the identical problem with `requestId` and a "latest wins" check.

**Fix (revised in the second pass — the original preferred the wrong option).** Three ways to close it, in increasing cost:

1. **Transport-handle identity, host-side only.** One-worker-per-run means every run already *has* a unique handle: the `Worker` instance, or the child process. The host holds `currentRun = { handle, … }` and its `onmessage` / stdout reader drops any message whose handle is not `currentRun.handle`. Costs nothing, requires nothing of tool authors, and closes the hole completely — including the 5s-kill window and a SIGKILLed process still flushing stdout. For the doc's hypothetical main-thread tool, bind the same token in the `emit` closure.
2. **Serialize.** Do not spawn B until A has terminated or been killed. Correct, but it makes the user wait up to 5s on a Cancel-then-rerun, which is the exact interaction Sec.5 invites.
3. **`runId` in the protocol.** Add it to `run`/`cancel` and require every `ToolMessage` to echo it.

**Take option 1.** The original Fix said "prefer the id", which is backwards: `runId` makes correctness depend on every external tool author correctly echoing a field, and a tool that echoes it wrong has *all* of its output silently dropped — a new failure mode, in the direction B6 establishes we cannot trust. It also widens the v1.1 wire contract permanently to solve a problem that lives entirely inside `host.ts`. The one thing `runId` buys that option 1 does not is disambiguating a *shared* transport, and there isn't one: one worker per run, one process per run.

Either way, add the lifecycle test: cancel A, start B, A emits `partial`, assert B's output survives.

### B6. Nothing validates inbound tool→host messages, and only stderr is capped

Rev 4 added param validation (host→tool) and edit-bounds validation, both good. The unguarded direction is the one that feeds the UI. `ToolMessage` is a TypeScript type, which is a compile-time fiction for an external process: v1.1 tools can emit malformed JSON, well-formed JSON that is not a `ToolMessage`, a `severity` with `level: "catastrophe"`, or a `table` whose `rows` are numbers. The doc's own reasoning for edit-bounds validation ("a buggy external tool can emit anything") applies verbatim and is not carried over.

Size, likewise: stderr got a 64KB ring buffer (`:125`), stdout got nothing. A single 500MB NDJSON line OOMs the host before "cap table rows rendered" (`:205`) can help, and a chatty `partial` stream has no ceiling.

**Fix.** Specify runtime shape validation at the transport boundary (one narrow validator per message kind, discard-with-visible-error on failure, never trust the discriminant), a max line length, and explicit caps on blocks per output, rows per table, and text length per block. Add a malformed-message fixture to Sec.9. This is the v1.1 trust boundary's largest surface, larger than `params`.

---

## Significant

### S1. The flagship tool's declared run config is not expressible in `ToolParamDef`

CREATION_PLAN 5.2 specifies the checker's Monte Carlo layer runs "across a player-count matrix (2/4/6/8)" with a run config of "(N, player counts)". `ToolParamDef` offers integer, boolean, text, select, and `params` is `Record<string, number | boolean | string>`. There is no multi-select and no array value. The available workarounds are four booleans, or a text field the tool parses itself, which throws away the host-side validation rev 4 just added and puts a parser for user input inside every tool.

**Fix.** Add `{ type: "multiSelect"; default: string[]; options: {value,label}[] }` and widen the value union to include `string[]`.

*Urgency argument corrected in the second pass.* "Breaking change once external manifests exist" is only half true, and the half that is true is the one worth acting on. Adding a new `ToolParamDef` *variant* later breaks nothing — old manifests keep validating, and a v1.1 host that meets an unknown `type` is already covered by `apiVersion` hard-reject. What is genuinely painful later is **widening `params`' value union**, because that is the type an external tool deserializes its own run config into: a tool written against `Record<string, number | boolean | string>` and handed a `string[]` gets a runtime surprise the compiler promised it could not have. So widen the union now even if `multiSelect` itself slips; the two are separable. (The cheap non-fix, for the record: a `select` of preset matrices, `"2/4/6/8"` / `"4/8"` / `"8"`. It works for the checker specifically and is a dead end for everything else — do not ship it as the general answer.)

### S2. `selection` was dropped from the context without escalating

PLAN.md:56 ("code text, AST/map JSON, selection") and CREATION_PLAN 5.1 ("code text, AST as JSON, selection, map metadata") both name selection as part of the context this doc was briefed to design. The doc removes it in a parenthetical (`:80-81`) with "no tool needs it yet". The doc's own preamble says to treat ambiguities as escalation points, and `CLAUDE.md`'s hard rule says specs are authoritative. Supplying it is also nearly free: `src/hooks/useSharedSelection.ts` already exists for the Breakdown⇄Code sync.

**Fix.** Either add `read-selection` + `selection?: Span` now, or record the omission as an explicit escalation with the reasoning, rather than as a settled non-goal.

*Trimmed in the second pass.* The original closed with "a formatter tool ('format selection') is in 5.2b's candidate list and would want it". 5.2b's actual candidate is a whole-script "script formatter/pretty-printer (AST → clean code)"; "format selection" was this review's own extrapolation and should not be cited as a planned consumer. The finding stands on the brief alone — two authoritative documents name `selection` as context input and the doc drops it in a parenthetical — and does not need a hypothetical to prop it up. Worth noting the same brief also names "map metadata" (CREATION_PLAN 5.1), which `settings` does discharge; `selection` is the only item of the four that vanished.

### S3. Sec.2 and Sec.6 disagree about the checker's capabilities

Sec.2 (`:33-36`) says without `read-reference` "the flagship tool could not run on the declared context at all". Sec.6 (`:161`) says "the checker needs everything anyway: `read-source, read-ast, read-settings`" and omits `read-reference`. Sec.6's list is the one an implementer copies into the exemplar manifest. Fix the list.

### S4. Sentinel-on-both-transports charges the flagship tool a full encode/decode round trip, and the encode must clone

Built-in tools reach their worker by `postMessage`, which is structured clone, which carries `Infinity` natively — the app's own parse already crosses a worker boundary this way today (`parserWorker.ts`, `ParseResponseMessage.parseResult`). Only NDJSON needs the sentinel. Applying it uniformly buys byte-identical data (a real benefit, and defensible) at these costs, none of which the doc states:

- The checker links the Phase-4 generator directly (`:121`), and that generator consumes real `ParseResult` numerics (`resourceTotals.ts:144` is the existing shape of that arithmetic). So the checker has to undo, for itself, an encoding its own transport never needed. Say who does this and where. (*Second pass:* the original called this "an O(AST) pass per run", which overstates it — decoding at the numeric read sites via `numeric()` is the obvious alternative to an eager tree walk, and it is what the in-repo helper is for. The cost is real but it is a handful of call sites in the checker, not a mandatory whole-tree pass. Do not let the exaggeration carry the argument.)
- **The context builder must deep-clone before converting.** The `ParseResult` the host holds is the same object the UI renders from. An in-place convert corrupts Breakdown mid-flight: `renderValue.ts:8-10` and `patch/formatStyle.ts:81-83` both test `value === Infinity` to print `inf`. This is not stated anywhere and is an easy mistake to make while chasing "byte-identical". **This is the load-bearing half of S4** — it is a live corruption bug in an unwritten implementation, independent of where the sentinel ends up living.

**Worth considering, but not recommended (revised in the second pass):** hoist the sentinel into the parser. Make `ArgValue`'s numeric case `number | { inf: 1 | -1 }` in `src/parser/types.ts`. `ParseResult` then becomes JSON-safe by construction, `SerializedParseResult` disappears (see S5), no decode pass exists to forget, and there is one representation everywhere.

The site count the first pass gave was wrong, and the direction of the error matters. It listed "the complete set of producers and consumers today" as `parser.ts:938-939`, `renderValue.ts:8-10`, `formatStyle.ts:81-83`, `resourceTotals.ts:144`. It missed a **producer**: `src/breakdown/cards/ValueEditor.tsx:18-19` turns a user typing `inf` into `Infinity`, on the write path into the patch engine. A "complete set" claim in a review whose thesis is stale premises should have been grepped, and `grep -rn Infinity src/` is the whole verification.

More importantly, the cost is understated. `ArgValue` today is discriminated by `typeof value === "number"`, and every numeric consumer — including `parser.ts`'s own `argDef.min`/`max`/`cautionBelow` range checks around `:919-925` — reads it that way. Hoisting means each of those sites grows a narrowing step for a case that is rare in real scripts, and `ArgValue` gains a fourth object shape sitting beside `{rnd}` and `{expr}` for a value that *is* a number semantically. That is a permanent ergonomic tax on the parser, paid so that one transport boundary can skip a conversion. **Recommend keeping the sentinel wire-only** and spending the words on the two things that actually bite: name the decoder and its owner, and pin the clone. Hoisting remains a legitimate escalation against `parser-design.md` if a second consumer ever needs JSON-safe `ParseResult`, and it should be recorded as such rather than done now.

### S5. `SerializedParseResult` has no stated derivation, and hand-cloning it will drift

"Structurally `ParseResult` with every `ArgValue` `number` position widened" (`:129`) is a sentence, not a type. Widening one leaf of a recursive tree requires one of:

1. **A hand-maintained parallel tree** — `ArgNode`, `CommandNode`, `BlockNode`, `AttributeNode`, `DirectiveNode`, `IfNode`/`IfBranch`, `RandomNode`/`RandomBranch`, `OrphanBlockNode`, `Item`, `SectionNode`, `ScriptNode`, `ParseResult`: a dozen duplicates with no compiler link to `src/parser/types.ts`.
2. **Parameterizing the parser's types** — `ArgValue<N = number>` threaded up through `ParseResult<N>`. The default keeps every existing call site compiling, and the wire type is then literally `ParseResult<number | { inf: 1 | -1 }>`, which is one line and cannot drift.
3. ~~A deep mapped type.~~ **Withdrawn in the second pass — as stated this option is wrong**, and shipping it would be a bug. A recursive `DeepWiden<T>` that rewrites `number` cannot tell an `ArgValue` numeric position from any other `number` in the tree, and the tree is full of them: `lineOffsets: number[]`, every `Token`'s offsets, `NodeBase`'s `firstToken`/`lastToken`/`span`, `def.min`/`def.max`, and — worst — `expr: { tokens: number[] }`, which holds **token indices**. Widening those to `number | {inf:±1}` makes the wire type claim a token index might be infinite, and a tool that dutifully runs its decoder over them gets nonsense. Any mapped-type approach has to be *targeted at `ArgValue`*, at which point it is option 2 with extra steps.

**Recommend option 2.** As written the doc gets option 1 by default, and it will silently diverge the first time an AST node gains a field. S4's parser-level hoist deletes this problem outright — S4 and S5 are the same problem seen from two ends — but S4 is no longer recommended, so S5 has to be answered on its own.

### S6. The N-edit single-undo apply does not exist yet, and the descending sort is not why it works

`useDocument.ts:244` `applyTextEdit` takes exactly **one** edit and converts offsets to a `monaco.Range` via `getPositionAt`. Calling it N times produces N undo entries, breaking the doc's central promise. The doc needs to name the new work: an `applyTextEdits(edits)` that converts all N and passes them as a single `pushEditOperations` array.

Separately, "sorted descending by `start`" (`:153`) is stated as load-bearing and is not. Descending order is what manual string splicing needs; `pushEditOperations` takes ranges in original coordinates and handles ordering itself. It is harmless to sort, but presenting it as the mechanism invites an implementer to "fix" the wrong thing later. What Monaco does require is non-overlap, which the doc already validates.

---

## Minor

- **No `ui-help.json` entries planned.** `CLAUDE.md`'s hard rule is a HelpTip plus a matching `ui-help.json` entry for every interactive element, as it is built. Sec.5 says "HelpTips per convention" and neither Sec.5 nor Sec.8's file layout mentions the data side. `ui-help.json` has 73 entries and exactly one `tools`-adjacent id — `tabBar.advancedTools`, the tab button itself, nothing inside the pane (the first pass said "no tools ids", which is not quite right). Name the pane's own ids in Sec.5 (tool dropdown, each param row, Run/Cancel, progress, Apply, the tool-log block) so the 5.1 session cannot skip them. Note the param rows are the awkward case: they are generated from `manifest.params`, so their help text comes from `ToolParamDef.help`, not from `ui-help.json` — say which rule wins for host-rendered-but-tool-authored controls, because "every interactive element" and "external manifests supply their own strings" collide here and v1.1 makes that collision a trust question.
- **`capabilities` vs PLAN.md's `permissions`.** PLAN.md:56 says the external manifest carries "permissions". `capabilities` is the better name; just note that the PLAN wording is superseded, before v1.1 manifests exist in the wild.
- **The NaN claim holds, but the Infinity claim is narrower than the code.** Verified against the lexer, not just the parser: `classify()` gates the `number` kind on `NUMBER_PATTERN = /^-?\d+(\.\d+)?$/` (`lexer.ts:19`, `:60`) and the `rnd` kind on `/^rnd\(-?\d+,-?\d+\)$/` (`:18`), and `Number()` is applied only to those (`parser.ts:775`, `:919`, and `parseRndValue` at `:1311`), so NaN is indeed unreachable. However `Number("9".repeat(400))` is `Infinity`, so a plain number token — **and an rnd bound** — can also produce `Infinity`, not just the `inf`/`-inf` words the doc credits (`:127`). Harmless for the sentinel (it round-trips), but the dev assert should assert "finite or sentinel", not "no NaN", and the wording should not imply `inf` is the only source.
- **Path note for whoever acts on this review.** `useParsedDocument.ts` lives at **`src/useParsedDocument.ts`**, not `src/hooks/` — `useDocument.ts` and `useSharedSelection.ts` are the ones under `src/hooks/`. Every `useParsedDocument.ts:NN` reference above is correct against the src-root file.
- **Cite the worker idiom.** Per-run spawn is a one-liner with Vite's `?worker` import, as used at `useParsedDocument.ts:2` (`import ParserWorker from "./editor/parserWorker?worker"`). Worth one clause in Sec.3, since one-worker-per-run is a rev 4 pin and this is what makes it free.
- **Undo reachability from the Tools tab.** "One undo entry" is only useful if Ctrl+Z reaches it, and Monaco's own binding needs a mounted editor, which the Tools tab will not have. It works only because of the window-level listener at `useDocument.ts:255-267`. Worth a sentence and a test.
- **The 5.2 sequencing warning is right and can be sharper.** `game-constants.json` today is the 31-entry stub with `constId: null` and `deTextureFile: null` and `verified: false` on **every** entry, and `resourceAmounts` on 8 of 31 (`GOLD` 800, `STONE` 350, `FORAGE` 125, `DEER` 140, `BOAR` 340, `SHEEP` 100, `FISH` 200, `SHORE_FISH` 200 — the hand-written placeholders). Both `CLAUDE.md`'s status table ("currently only `constId` is confirmed") and `build-log.md:395` ("`constId` real, `verified: true`, `resourceAmounts` still placeholder") describe a working tree that does not exist. Re-verified in the second pass: all 31 `constId` are `null`, all 31 `verified` are `false`. Do not treat either doc as a green light — read the file. **And fix both docs in the same pass as this review**, or the next session inherits exactly the failure mode the Process note is about; this review has no standing to complain about frozen snapshots and then leave two of them in place.
- **Sec.9 gaps.** Add: capability enforcement on the *context* path (a tool without `read-source` gets no `source` — only the edits direction is tested today); stale-run message rejection (B5); malformed inbound message rejection (B6); N-edit application as a single undo entry (S6); Apply re-enabled after undo back to the snapshot (B4).

---

## Late additions (second pass — findings the first pass did not make)

### L1. Nothing says what happens to a run when the open document is replaced

`useDocument.ts` holds **one module-level Monaco model** for the app's whole lifetime (`:22`), and opening a file calls `documentModel.setValue(text)` (`:158-162`) rather than creating a new model. So "the document" can become an entirely different script mid-run, and the doc never says what that does to the run in flight. Sec.5's one-run-app-wide rule covers switching *tools*; nothing covers switching *documents*.

What follows from the current spec, unstated: the run keeps burning CPU against a script the user has closed; the version-based staleness guard does correctly disable Apply (`setValue` bumps the version id); but `codeRef` jumps still fire, clamped to length, with the soft "code changed since this ran" notice (`:96-99`) — and "the code changed" badly understates "you are looking at a different file". Same class as B4 and B5, and it falls out of the same missing idea: the run is pinned to a *document snapshot*, and nothing in the protocol names that snapshot.

**Fix.** Cancel the run on document replace (File → Open / New), and say so in Sec.5 next to the tool-switch rule. If B4's `ctx.parseResult.source` equality gate lands, `codeRef` clicks get the strong check for free — compare against the snapshot source, and on mismatch say "this ran against a different document" rather than reusing the softer wording. One test: start a run, open a different file, assert the run is terminated and Apply is gone.

### L2. `settings` is snapshotted at run time and nothing flags it going stale

`read-settings` puts `playerCount` and `mapSize` into the context at `run`. Both are live app state (`GenerationSettingsContext`), and the flagship tool's entire output is conditioned on them — the checker's Monte Carlo layer runs a *player-count matrix*. Change the player count while a run is in flight and the pane shows results labeled with nothing, computed for the old value. The document has a staleness story; settings have none.

Cheaper to fix than B4, and it does not need a guard: have the host echo the run's settings into the output header ("run at 8 players, Normal / 200×200"), so a stale result is self-describing rather than silently wrong. Worth one line in Sec.5.

### L3. This review's own dating discipline is thinner than the discipline it prescribes

The Process note tells rev 5 to "date every repo assertion". The review dates them collectively, in one sentence in the preamble, which is the same granularity that let rev 4's premises rot. If the standing rule is per-claim dates plus a re-derivation script, then the rule applies here too: the honest form is a date on each repo claim, or a check script. `scripts/check-breakdown-prereqs.mjs` is the working precedent and it already reads `predefinedLabels`; extending it to assert the four facts B1–B3 depend on (`predefinedLabels` count and `mapSize`-entry coverage, `language.ts`'s `predefinedLabels` type, how many `GameConstantsData` declarations exist, `game-constants.json`'s `constId`/`verified` state) would make this class of finding impossible to relitigate. That is a better rev-5 deliverable than any wording change in this document.

---

## What is right, and worth not losing in a rev 5

The one-contract-two-transports framing, and the honesty about its limit ("the contract is portable, a given tool's dependencies may not be" — the checker linking the Phase-4 generator is not externalizable, said plainly instead of hidden). Tools as documents rather than extensions, which is what makes the v1.1 trust model tractable at all. Edits as proposals with an explicit Apply, plus rev 4's bounds validation. Cooperative chunking with a uniform hard-kill, and the busy-loop kill path in the test plan rather than assumed. `partial` as a full self-contained redraw rather than a delta. One-worker-per-run, with both consequences stated. The Python blocking-stdin risk (`:205`) is the kind of finding that saves a v1.1 release, and `read-ast` implying `read-source` with "stripping would be security theater" is the right call for the right reason. The doc is also unusually good at recording *why* a decision was made and what was rejected, which is most of why this review could be specific.

---

## Process note

Three of rev 4's premises about the repo were wrong in three different ways, and only one of them is the "frozen snapshot" failure this project has already named:

- "preview Sec.4 lists 6 sizes" — **stale**. True of rev 4 of that doc, false since rev 5. The classic frozen snapshot.
- "`GameConstantsData` needs defining" — **never true**. Two declarations already existed. Not staleness; an unrun grep.
- "no name→tiles mapping exists in `src/`" — **true, and that is the problem**. The qualifier `in src/` is doing all the work: the mapping exists in `reference/data/`, which is where this codebase's hard rules say vocabulary belongs, so a correctly-scoped search returned a fact that licensed the wrong conclusion. No amount of re-verification catches this one, because there is nothing to re-verify. What catches it is asking "where *would* this live if it existed?" before concluding it doesn't.

(*Second pass:* the first pass filed all three as "frozen repo snapshots" and tallied them "the first two were stale, the third was never true" — which mismatches its own B1 text and mislabels the most interesting of the three. A review whose thesis is precision about repo claims should get its own taxonomy right.)

This is adjacent to the systemic failure `breakdown-design.md` rev 4 diagnosed and answered with dated verification claims plus `npm run check:breakdown-prereqs` (`build-log.md:171`). The same discipline applies here: date every repo assertion, prefer "read it from the data" over "create constant X" because the data has a CI validator and a hand-typed constant has nothing, and treat a negative existence claim ("no X exists") as needing a *wider* search than a positive one, not a narrower one.

The cross-doc direction is worth noting too. Rev 4's own changelog observes that its best finding was a cross-doc data dependency; rev 4 then landed a cross-doc *instruction* (make the preview consume this constant) into a doc the preview's own authoritative spec had already answered. Reading the other spec's current revision would have caught it, and the reference data would have caught all three.

---

## Suggested rev 5 edit list

1. Sec.2 tiles comment: replace the `MAP_SIZE_TILES` prescription with resolution from `predefinedLabels` (match on `entry.mapSize`, expect two hits for six of seven sizes, one for Giant); drop the preview-design "6 rows" claim; cite preview-design Sec.12 item 1; leave Giant/Huge ordering to preview-design Sec.15 item 6. Sweep **all four** propagation sites: `tools-api-design.md:64-73` and `build-log.md:172` (delete the instruction), `tools-api-design.md:203` and `build-log.md:170` (bracketed correction, they are changelogs). (B1)
2. Rewrite the reference-type action item: `predefinedLabels` mistyped in `language.ts:82` — type it against the schema's `$defs/predefinedLabel` and make it **non-optional** (it is schema-`required`), keeping the `?? []` guard with a comment naming the `parserWorker.ts:21` double cast as what it defends against; promote the hover module's complete `GameConstant`/`GameConstantsData` rather than defining a new one, keeping its `"terrain" | "object"` literal union; `resourceAmounts` optional, `constId` nullable; decide `constId`/`deTextureFile` optionality against the schema instead of publishing a divergence. (B2, B3)
3. Sec.4 staleness guard: pin `ctx.source === ctx.parseResult.source`, gate Run and Apply on source equality, use `getAlternativeVersionId()`, specify the pre-first-parse null case. (B4)
4. Close the stale-run hole **host-side**: drop messages whose worker/process handle is not the current run's. Do not add `runId` to the wire contract. (B5)
5. Add inbound message validation plus stdout size caps to Sec.4. (B6)
6. Widen the `params` value union to include `string[]` (the part that is expensive later) and add a `multiSelect` param type. (S1)
7. Resolve `selection`: add it, or escalate the deviation from PLAN.md and CREATION_PLAN 5.1. (S2)
8. Fix Sec.6's checker capability list to include `read-reference`. (S3)
9. Keep the sentinel wire-only, name the decoder and who owns it, and **state that the context builder deep-clones before converting** — the corruption bug, and the one item in S4/S5 that must not be dropped. Derive `SerializedParseResult` by parameterizing `ArgValue<N>`/`ParseResult<N>`, not by hand-cloning and not by a blanket deep mapped type. (S4, S5)
10. Name the `applyTextEdits(edits[])` work in Sec.4 and demote the descending sort to an implementation detail. (S6)
11. Sec.5/Sec.8: name the `ui-help.json` entries the pane needs, and say whether `ToolParamDef.help` or `ui-help.json` owns generated param rows. (Minor)
12. Extend Sec.9 with the five missing tests listed above, plus L1's document-replace test.
13. Sec.5: cancel the run when the open document is replaced, and echo the run's settings into the output header. (L1, L2)
14. **Outside the doc, same session:** correct `CLAUDE.md`'s Phase-4 status row and `build-log.md:395` — both describe a `game-constants.json` that does not exist (all 31 `constId` are `null`, all 31 `verified` are `false`). Consider extending `scripts/check-breakdown-prereqs.mjs` to re-derive the facts B1–B3 rest on. (Minor, L3)
