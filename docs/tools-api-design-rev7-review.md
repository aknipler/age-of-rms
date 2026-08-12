# Review: tools-api-design.md — the rev 7 round

**What this file is.** The critique round that produces **rev 7** of `age-of-rms/docs/tools-api-design.md`. The doc is at rev 6 (2026-08-10, spec only, no code). It sits next to `tools-api-design-rev4-review.md` and `tools-api-design-rev5-review.md`; the rev-6 round left no file behind in either `docs/` directory, so rev 6's own reasoning survives only inside the doc.

Every repo claim below was re-derived from the working tree on **2026-08-11**, with file:line. The appendix carries the exact probes for the four measurements, so nothing here has to be taken on trust. Where this note and the source disagree, re-check the source.

**Verdict.** Rev 6 is the strongest revision of this document so far and I could not break its two headline decisions. I re-derived every numeric claim in Sec.2, Sec.4.2 and Sec.10.1 and **all of them reproduce exactly** — 220 constants entries, 85 null `rmsConstant`, 100 `verified`, 8 `resourceAmounts`, 101 `ui-help.json` entries with 16 `preview.*`, 4,599 explicitly-`undefined` keys, 13.15 MB for Vanguard, 25 of 32 maps over 1 MB. That is the first round in this series where the numbers survived contact with a re-measurement, and it is a direct result of rev 6's own Sec.10.2 discipline.

But **the fix rev 6 shipped for its own B3 reintroduces, one field over, exactly the defect its B1 removed** — a published type that lies about what the wire carries — and the rule it wrote strips **two of the four `def`-bearing node types**, delivering 16% of a payload reduction the same section measures at 41%. That is B1 below and it is blocking.

Second blocking finding is the N7 pattern recurring on schedule: **the Current/Final cut point landed 2026-08-10**, the same day rev 6 was written, and it produces a `ParseResult` that passes every one of Sec.4.3's staleness guards while its `script` is not the parse of its `source`. It is sitting in the context a 5.1 implementer will reach for first. Sec.9 item 2's test — the mechanism rev 6 built specifically to stop this class — does not catch it, and cannot.

Four standard findings, eight minor. One of the standard ones is that **the mutation test Sec.9 item 1 prescribes for the sentinel cannot go red**: there is not one `inf`, `-inf` or long-digit-run number in any of the 32 tracked maps.

---

## Part 1 — Blocking

### B1. The wire form drops `def`, the published type still declares it, and the strip rule names two of the four places it lives

Two halves. Both are consequences of rev 6's B3, both are cheap, and the second is measurable to the byte.

**Half one: the strip rule is narrower than the measurement that justifies it.** Sec.4.2 item 3 says:

> Both `CommandNode.def` and `ArgNode.def` are already optional (`parser/types.ts:89`, `:95`), so dropping them is type-legal rather than a widening.

Those two citations are correct. They are also **two of four**. `AttributeNode.def` (`src/parser/types.ts:110`) and `DirectiveNode.def` (`:117`) are the same field on the same optionality, and attribute nodes are by a wide margin the most numerous item in an RMS AST. The table's "without `def`" column was computed by dropping all four; the rule an implementer will follow drops two. Measured 2026-08-11 (appendix, probe 1 — the full column reproduces the doc's own figures exactly, which is what makes the third column comparable):

| map | source | JSON | rev 6's rule (cmd+arg) | all four `def` sites |
|---|---|---|---|---|
| `AK_Vanguard_v1.2.rms` | 358 KB | 13.15 MB | **10.99 MB** (−16.4%) | 7.76 MB (−41.0%) |
| `24hr_A Heart Map.rms` | 210 KB | 8.90 MB | 6.74 MB | 4.89 MB |
| `13_Rings_v1.2.rms` | 184 KB | 5.90 MB | 4.85 MB | 3.25 MB |
| corpus total (32 maps) | — | 82.34 MB | 66.18 MB (−19.6%) | 43.51 MB (−47.2%) |

So the rule as written recovers a sixth of what the section claims, and **the shortfall is silent**: 10.99 MB is under the 32 MB outbound cap, so nothing goes red and nobody finds out. Fix is four words — name all four node types, or say "every `def` field in the AST, of which there are four (`types.ts:89`, `:95`, `:110`, `:117`)".

**Half two, and this is the important one: the published type must not carry `def` at all.** Sec.4's third bullet states the property the whole transport split rests on:

> A tool written against the published `.d.ts` therefore compiles and runs correctly in-process **and** over the wire, without knowing which it got.

That property holds for `Infinity` precisely because the type *forces* the tool to notice: `number | { inf: 1 | -1 }` cannot be used as a number, so the decode is a compile error away. It does **not** hold for `def`. `SerializedParseResult` is `ParseResult<number | { inf: 1|-1 }>` with `def?: CommandDef` intact, so a portable tool writing `node.def?.name` compiles cleanly, works in-process, and silently returns `undefined` for every node over the wire. That is the same failure shape as rev 6's own B1 — "fails in the direction of *your map is fine*" — reintroduced by rev 6's own B3, in the section arguing that the type system is what keeps the contract honest. Sec.4's fourth bullet even concedes the general point ("what the compiler enforces is the tool's decode, not the host's encode"), and then leaves the one field the compiler *could* enforce unenforced.

**Fix, and there is a trap in the obvious version.** The wire node types must **omit `def` entirely**, not declare it `def?: never`. Verified against this repo's own `tsc --strict` (appendix, probe 4):

- `def` omitted: `ParseResult` is still assignable to the published type (extra properties are fine outside fresh object literals), and `w.args[0].def` on the published type is a compile error. Both halves of what rev 6 wants.
- `def?: never`: **breaks assignability** — `Type 'ArgumentDef | undefined' is not assignable to type 'undefined'` — which would take out `ToolContext<ParseResult>` → `ToolContext`, the exact property B1 was fixed to obtain.

Worth stating in the doc as a pinned decision rather than left to the 5.1 session, because `never` is the first thing anyone reaches for and it fails a long way from where it is written. Note also what this means structurally: the two type parameters **vary in opposite directions** — the published form is *wider* for numbers and *narrower* for defs — so "the published type is the wider one" is a rule with one exception and rev 7 should say so out loud.

**Third, smaller half: PROTOCOL.md's re-derivation recipe is one sentence short.** Sec.4.2 says "the def is one `Map.get` away". True for `CommandNode` and `AttributeNode` (name → index). Not true for `ArgNode`: an external tool must go name → `CommandDef` → `arguments[i]` positionally, and **that positional identity is not guaranteed** — `consumeArgs` (`src/parser/parser.ts:924`) emits several `ArgNode`s sharing one `ArgumentDef` when `argDef.variadic` is set. Zero argument defs in `language.json` are variadic today (probe 3), so this is latent rather than live, but the parser and schema both support it and PROTOCOL.md is a published document. One clause: give the recipe, and say it is positional only while no variadic argument exists.

---

### B2. `truncateAst` produces a `ParseResult` that passes every Sec.4.3 guard and is not the parse of its own source

CREATION_PLAN 4.6 landed **2026-08-10** — the same day rev 6 was written, and the doc contains no occurrence of "truncate", "cut point", or "pin". Three facts:

1. `truncateAst(parse, cutOffset)` returns `{ ...parse, script: { preamble, sections } }` (`src/preview/generator/truncateAst.ts:287`). **`source`, `tokens`, `lineOffsets`, `symbols`, `includes` and `diagnostics` are all carried through unchanged** — the file says so at `:268`. Only `script` is truncated.
2. `PreviewResultContext.tsx:79` memoises exactly that value and feeds it to `generatePreview` for the Current view.
3. Sec.4.3's guards are: `ctx.source === ctx.parseResult.source` (pin 1), and Run gated on `model.getValue() === ctx.parseResult.source` (pin 2).

**Every guard passes on the truncated parse.** The corruption Sec.4.3 exists to catch is an AST that does not describe the text; this is an AST that does not describe the text, wearing the text's own `source` string as proof that it does. And it is not hypothetical reachability — a 5.1 session wiring "the parse the preview runs on" into the tool context has two providers to choose between (`ParsedDocumentContext` and `PreviewResultContext`, both mounted in `App.tsx:70` and `:76`), and the one named after the preview holds the truncated one.

There is a second, user-facing half. The cut is view state with a user-visible control, exactly like the seed — and rev 6 made an explicit, well-argued decision about the seed (Sec.2: not in the context; a tool that wants one declares an `integer` param; anything more is a `read-preview-view` escalation). The cut point needs the same paragraph and does not have it. Concretely: with a pin set, the preview pane shows half a map while the checker reports on the whole script, and Sec.5's settings-echo header ("run at 8 players, Normal / 200×200, 2v2v2v2") says nothing about it — the exact "stale result labelled with nothing" failure that header was added (rev-4 L2) to prevent.

**Fix.** Three sentences in Sec.2 and one in Sec.4.3. (a) The context builder takes the parse from `ParsedDocumentContext`, never the truncated one, and Sec.4.3 gains a pin saying `ctx.parseResult.script` must be the parse of `ctx.parseResult.source` — because `source` equality alone no longer proves it, and `truncateAst` is the counterexample to point at. (b) Tools always see the whole script; say it, since "the preview pane and the checker disagree" is otherwise a bug report. (c) Follow the seed's own decision shape for the pin: out of the context, in the output header if anywhere, escalation if 5.2 needs it.

**And the part that matters beyond this finding:** this is the fourth consecutive revision broken by the same dependency, and rev 6 built Sec.9 item 2 to end that. Item 2 cannot catch it — it type-checks `ToolContext` against `PreviewSettings`, and the cut is a *caller* concern that `generatePreview` deliberately knows nothing about (`index.ts`'s own 4.3 header pins this). Sec.9 item 2's stated limits are honest and this is a fifth one worth adding to the list: it watches one seam, and the app keeps growing concepts at other seams. Rev 6 already says this test does not retire Sec.10.2's standing instruction. Rev 7 should say what it is that a reader must actually check, and the answer this round is concrete: **diff `src/*Context.tsx` since the last revision**, because that directory is where the app's cross-cutting concepts land, and it is where `teams`, the seed chip and now the cut point all came from.

---

## Part 2 — Standard

### S1. `rnd` bounds are an `ArgValue` numeric position, and neither the parameterization nor the fixture covers them

`ArgValue` has two numeric positions, not one: the bare `number`, and `{ rnd: [number, number] }` (`src/parser/types.ts:81-85`). `parseRndValue` (`src/parser/parser.ts:1511-1514`) is `Number(m[1])` over `/^rnd\((-?\d+),(-?\d+)\)$/` — an unbounded digit run, which is the *exact* mechanism Sec.4 already accepts as a second source of `Infinity` ("`Number("9".repeat(400))` reaches `ArgValue` as `Infinity` through an ordinary number token"). Verified 2026-08-11 (appendix, probe 2): parsing `land_percent rnd(999…9,1)` yields `{ rnd: [Infinity, 1] }`, and `JSON.stringify` of that node is `{"rnd":[null,1]}`.

So an infinite bound is silently corrupted on the wire today, by the same route the sentinel exists to close. Two things follow, and they pull against each other unless the doc pins one:

- Sec.4 says the serializer "deep-converts `±Infinity` → `{inf:1}` as it builds the NDJSON line". A deep converter will convert the rnd bound too — and then the published type is wrong, because it says `[number, number]`.
- If instead the converter only walks the positions the type parameterizes, the bound becomes `null` and the corruption stands.

**Fix.** One clause: `ArgValue<N = number> = N | { rnd: [N, N] } | { expr: { tokens: number[] } } | string`, said explicitly, because Sec.4's list of fifteen types names which types take the parameter and never says where inside `ArgValue` it lands. Then Sec.9 item 1(a)'s "must round-trip" fixture gains an `rnd` with an infinite bound alongside the `inf` argument it already has. Note the contrast the doc already draws is what makes this right: `expr.tokens` are token indices and must stay `number[]`, which is precisely why a blanket deep mapped type was rejected — and rnd bounds are on the other side of that same line.

### S2. Sec.9 item 1's prescribed mutation test for the sentinel cannot go red

Sec.9 item 1 ends:

> Mutation-test both halves per CLAUDE.md — put a `[undefined]` into the fixture and confirm (a) goes red, **drop the sentinel encode and confirm (b)'s scanner goes red**.

(b) is "a real `parseRms` result over a corpus map". Measured 2026-08-11 over all 32 tracked maps: **zero occurrences of `inf` or `-inf` as a word, and zero numeric literals of 20+ digits.** There is no non-finite value anywhere in the corpus, so dropping the sentinel encode changes nothing (b) can observe, and the scanner stays green. The mutant is unkillable.

This is the repo's own hard rule turned on the document that cites it: *a check that has only ever passed proves nothing — mutation-test it against the defect it exists to catch.* And it matters more than a normal wording slip, because Sec.9 item 1 explicitly claims this is "the only enforcement that the external serializer encodes at all" (the types cannot see it, per Sec.4). The one gate on the one behaviour the type system cannot check is a gate that cannot fail.

**Fix.** Aim the sentinel mutant at (a), which does carry an `inf` argument, and say so. If a corpus-scale exercise of the encoder is wanted — and it is worth having, since (a)'s fixtures are hand-built and small — the cheap version is a fixture map: take a tracked map and append four lines using `inf`, `-inf`, an `rnd` with an infinite bound and a 400-digit literal, and park it in `test-maps/broken/` (which already exists for exactly this "deliberately degenerate, not corpus-gated" tier, per CLAUDE.md). Then the mutant kills.

### S3. "Write Sec.9 item 2 FIRST" is blocked on an edit the same document says to escalate

The status row in `age-of-rms/CLAUDE.md` and Sec.9 item 2 both instruct the 5.1 session to write the `ToolContext` → `PreviewSettings` → `generatePreview` test before anything else. That test is typed `ToolContext<ParseResult>`, which requires `ToolContext`'s type parameter, whose constraint is `SerializedParseResult`, which is `ParseResult<number | {inf:1|-1}>` — and Sec.4 says of that last step:

> Fifteen types take the parameter … in `src/parser/types.ts`, which `parser-design.md` owns, on behalf of a downstream consumer. … **escalate it to the parser spec rather than landing it in the 5.1 session**, per CLAUDE.md's do-not-improvise rule.

Both instructions are right and they are in the wrong order. `parser-design.md` is at rev 6 and does not carry the amendment, so as written the 5.1 session's first act is blocked on another spec's next revision.

**Fix.** State the ordering in Sec.9 item 2 and in Sec.8: the parser-design amendment (a rev-7 item there: thread `ArgValue<N = number>` up through fifteen types, all defaulted, no call site edited) lands first, or the 5.1 session writes item 2 against the in-process types only and adds the `ToolContext<ParseResult>` annotation when the amendment lands. Naming which is a two-line decision; leaving it unnamed is how a session improvises an edit into `src/parser/types.ts` and violates a hard rule while following an instruction.

### S4. Two host-side failures are specified with no terminal to carry them

`ErrorReason` has five members and every one describes something the *tool* did: `tool-error`, `cancelled`, `killed`, `unresponsive`, `protocol`. Rev 6 added two host-side failure paths and neither has a reason:

- Sec.4.2 item 2: the outbound `run` message exceeding 32 MB is "a host-side error naming the script, not a silent truncation".
- Sec.9 item 1(a): the serializer must **reject** an array containing `undefined`, a `Map`, a `Set`, a `NaN`, "each asserted as a thrown/reported error rather than as a silent shape change".

Both surface in the pane as a terminal, and the only ones available blame the tool. `protocol` is defined as "the tool emitted something that is not a valid `ToolMessage`" — wrong direction. `tool-error` on a host serialization failure is a false accusation, and rev 6's own Sec.4 note says `killed`/`unresponsive` "should be read as *this tool did not behave*", which is the same category error one step over.

**Fix.** Add `host-error` ("the host could not build or send this run's context") and pin that it is never counted against a tool. One member, and it makes the failure legible in the one case where the user's script — not the tool — is the thing to name.

---

## Part 3 — Minor

- **M1. The `tsconfig` claim is overstated; the prescription still stands.** Sec.8 says `tsc --noEmit` "would never see a root-level `tools-api/index.ts`". `include: ["src"]` (`tsconfig.json:23`, verified) sets the *root* file set; TypeScript still adds and checks any file reached by an import, so the moment `src/tools/registry.ts` imports the contract it is typechecked. What genuinely escapes is a `tools-api/` file nothing under `src/` imports — `generated/PublishedGameConstants` is exactly that if the flagship tool does not yet consume it — plus the ESLint purity gate, whose globs name three `src/` directories explicitly (`eslint.config.js:34-39`, verified). Keep the fix; fix the sentence, or the next reader checks it, finds it false, and discounts the item.
- **M2. Seven help ids, but the section requires eight.** Sec.5 names `tools.select`, `tools.run`, `tools.cancel`, `tools.progress`, `tools.apply`, `tools.log`, `tools.output` — and its own closing open question resolves with "`ui-help.json`'s **`tools.params`** entry documents the *form*". That id is missing from the list the 5.1 session will copy. Eight. (Re-measured: `ui-help.json` is 101 entries with 16 `preview.*` and the same two tools-adjacent ids — rev 6's figures hold exactly.)
- **M3. `table.rowSpans` delegates its length check to a section that does not accept the delegation.** Sec.2 line 178: "Length-checked by the inbound validator (Sec.4.2); a mismatched length is a protocol error." Sec.4.2 lists four caps and one validator rule and never mentions `rowSpans`; Sec.9 item 5's malformed-message list does not test it. One bullet in each, or the only new field rev 6 added to `OutputBlock` ships unvalidated.
- **M4. `multiSelect` defaults are validated at run time but not at registration.** Sec.2 pins that a `select` default must be one of the options, "host validates at registration". Sec.5 adds run-time `minSelected`/`maxSelected` enforcement. Nothing checks a *manifest* whose `default: []` violates its own `minSelected: 1` — which ships a form that cannot be submitted as authored, from a stranger's manifest, in v1.1. Same check, one line, at the same place the `select` default is checked.
- **M5. Sec.10.1's five counts are the thing Sec.10.2 tells you not to write, and one has already drifted.** Measured 2026-08-11: `language.json` attributes are **39** of 94 verified, not the doc's 38 — inside a day, again, and by the same mechanism (a parallel session). The other four hold. The house answer already exists and the repo is full of it: a `*.measure.test.ts` reporter that re-derives the numbers on every run (`rms0201.measure.test.ts`, `rms0304.measure.test.ts`, `rms0315.measure.test.ts`). Prescribe one — `src/tools/__tests__/dataReadiness.measure.test.ts` — and replace Sec.10.1's five numbers with a pointer to it. Carry the caveat CLAUDE.md records about the existing four: **they print nothing without `--disableConsoleIntercept` and still exit 0**, which is indistinguishable from a check that found nothing.
- **M6. The run watchdog detects silence, not non-termination.** Sec.4.1 presents the 60 s watchdog as the answer to rev 5's N5 ("nothing kills a run that is never cancelled"). It answers half: a tool stuck in a loop that *does* chunk and emit progress runs forever, holding the app-wide single run slot. That is survivable — Sec.5's tool-switch and document-replace rules both cancel, so the pane is not bricked — and it is the right trade, since 5.2's own budget item estimates legitimate runs at 8–30 minutes. Say it, in one sentence, so nobody reads a liveness guarantee into a silence timer.
- **M7. The `override_map_size 480` residual names an expensive fix and skips a cheap one.** Sec.4.1's accepted residual says deriving the deadline from `dim` "needs `instantiateScript` on the host side before the run". The host is already holding the AST it is about to serialize; scanning `script.sections` for an `override_map_size` command before the first land command is O(items) and reuses the rule PROTOCOL.md must state anyway. It only fails when the argument is a `#const` or an expression, which is a fall-back-to-the-lobby-size case, not a blocker. The residual can stay accepted — but name the cheap option, or the next reader prices the fix at `instantiateScript` and drops it.
- **M8. The two prior rounds' review files live in `RMS/docs/`, the doc lives in `age-of-rms/docs/`, and every other design doc's review file lives beside its doc.** This file follows its own series rather than the general convention. Worth one deliberate decision — moving all three next to the doc is the consistent answer, and `parser-design-rev5-review.md` / `preview-design-rev6-review.md` are the precedent.

---

## What is right and should survive rev 7

Not a formality this round — several of these were argued against in earlier rounds and won.

- **Every number in Sec.2, Sec.4.2 and Sec.10.1 reproduces exactly.** 220 entries / 85 null `rmsConstant` / 100 verified / 8 `resourceAmounts` / 116 of 131 terrain rows unverified; schema `required` is exactly the four named and its 23rd property `isTree` still has no data row; 4,599 `undefined`-valued keys and **zero** `undefined` array elements; 13.15/8.90/5.90/4.34 MB and 25-of-32-over-1 MB. Rev 6 is the first round in this series whose measurements survived a re-measurement, and it is the direct payoff of Sec.10.2.
- **Scoping the sentinel to the wire (B1) is correct** and I could not construct a case against it. `instantiate.ts:168` is the `typeof raw === "number"` branch rev 6 names, and a `{inf:1}` there falls through `"rnd" in raw` and `expr` to unresolved — silently, exactly as claimed.
- **The `undefined` split is correct and the asymmetric matcher choice is right.** `toEqual` for the corpus half is not a weakening: 4,599 keys and zero array elements is precisely the shape that makes it a real gate.
- **The `rowSpans` addition (S1) is right and is confirmed by the neighbouring spec, not just by CREATION_PLAN.** `preview-design.md` Sec.7 makes `commandSpan: Span` a required field on every `PlacementFailure`, coalesced by bucket per command — so the checker's report is literally a list of records each carrying one span. `severity`+`codeRef` pairs would have been the wrong shape for the data that actually arrives.
- **`collectSnapshots` as the only cost knob is confirmed at the source.** preview-design Sec.7 withdrew `collectReports` and made reports unconditional, so Sec.4.1's and Sec.10's framing is current, not inherited.
- **The habit of recording what was rejected and why** is what let this round be short. Rev 6's `def?: never` trap (B1 above) is the one place that habit was not applied, and it is the one place I had to run a compiler to find out which of two obvious options was correct.

---

## Process note

**The doc is now more archaeology than spec, and its own preamble is the argument against that.** 86 of 354 non-empty lines carry a "rev N" back-reference; 128 references across ~12,000 words. Rev 6 moved the changelogs to the build log citing preview-design rev 7's reason — *under a do-not-deviate banner, historical self-litigation competes with the spec for the implementer's attention* — and then left the body itself organised as a running diff, in which nearly every normative sentence arrives attached to a defence of why the previous revision's sentence was wrong.

That was defensible while the document existed only to be reviewed. **5.1 is an implementation session**, and the next reader is Sonnet with a do-not-deviate instruction, reading for what to build. Rev 7 should finish the job the preamble started: keep the rationale wherever it changes a decision at the keyboard (the `def?: never` trap, the watchdog derivation, why `rebaseEdit` is not for tool edits), and move the rest — "rev 5 said X, rev 6 withdraws it" — to the build log. My rough count is that the doc loses a quarter of its length and none of its content.

**One thing worth keeping in exactly its current form:** the derivations. Sec.4.1's deadline arithmetic (3.8 s × 1.41 Giant × 3.7 load ≈ 20 s → 30 s grace, ×3 → 60 s watchdog) reads as archaeology and is not — it is the only thing that lets the next person re-derive the constants instead of arguing about them, and Sec.9 item 3 already tests against the derivation rather than the literal. Same for the measured tables. The distinction rev 7 needs is between *how a number was reached* (keep) and *what a previous revision believed* (move).

**And the standing instruction earned a sharper version this round.** Sec.10.2 says re-derive rather than transcribe, and prefer the artefact to the count — both correct, both vindicated. What it does not say is *where to look*, and B2 is the answer: three of the four cross-doc breaks in this series (`teams`, the seed chip, the Current/Final pin) entered the app as a new root-level React context, and the fourth (`mapSize.tiles`) as a new pure module next to the generator. **Before the next revision, list `src/*Context.tsx` and `git`-free diff the generator directory against what this doc names.** That is a mechanical five-minute check with a four-for-four hit rate, which is better than any rule asking a reader to notice an absence.

---

## Appendix — how the numbers were obtained

All run 2026-08-11 against the working tree at `age-of-rms/`. Probes were built with the repo's own `esbuild` and run in Node; scratch files are outside the repo.

1. **Payload sizes and the `def` split.** `esbuild` bundle exporting `parseRms` + `language.json`; for each of the 32 tracked maps, `JSON.stringify(parseRms(src, languageData))` measured three ways — unmodified, with a replacer dropping `def` where the containing node's `kind` is `command` or absent (an `ArgNode` has no `kind`), and with a replacer dropping `def` on all four node kinds. The first column reproduces rev 6's table exactly, which is what establishes that its "without `def`" column was measured over all four.
2. **`rnd` with an infinite bound.** `parseRms("… create_land { land_percent rnd(<400 nines>,1) }")` → the `ArgNode.value` is `{ rnd: [Infinity, 1] }`; `JSON.stringify` of that node is `{"rnd":[null,1]}`.
3. **Corpus `inf` census and variadic census.** `grep -rniE "\binf\b" test-maps/*.rms` → 0 files; `grep -rEo "[0-9]{20,}"` → no matches. `language.json` walked for `arguments[].variadic` across commands/attributes/directives → 0.
4. **The `def?: never` trap.** A 20-line `.ts` file with three shapes — full (`def?: ArgumentDef`), wire-A (`def` omitted), wire-B (`def?: never`) — checked with the repo's own `node_modules/.bin/tsc --noEmit --strict`. Wire-A accepts the full type and rejects a `.def` read; wire-B fails with `Type 'ArgumentDef | undefined' is not assignable to type 'undefined'`.
5. **Data counts.** `reference/data/game-constants.json` and `reference/data/ui-help.json` read directly in Node; `reference/schemas/game-constants.schema.json` walked through its `$defs.constant` (`required` and `properties` live behind a `$ref`, so a naive `properties.constants.items.required` read returns `undefined`).
