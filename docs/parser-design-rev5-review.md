# Review: parser-design.md rev 5

Independent critique of `docs/parser-design.md`, checked against the working tree, `reference-docs/definitive-rms-guide-2026-07-16.txt`, `docs/known-issues.md` and a fresh corpus measurement on 2026-08-05. Every claim below carries a file:line, a guide line, or the probe that produced it. Where this note and the source disagree, re-check the source first.

**How the corpus numbers here were taken.** A temporary Vitest probe parsed all 52 `.rms` files (`test-maps/`, `test-maps/local/`, `test-maps/broken/`), ran `validate()` over each, and bucketed every diagnostic by code and severity. The probe was deleted after reading; the counts are reproducible by re-adding it, and the two standing harnesses (`rms0200.measure.test.ts`, `rms0201.measure.test.ts`) already reproduce their own slices.

**Verdict:** the spec's core model is holding up well under measurement, and two of rev 5's headline changes are now demonstrably load-bearing rather than theoretical — the shared-block rule accounts for **94 of the 96 RMS0110 diagnostics on the corpus**, i.e. 94 false RMS0102 warnings that rev 4 would have shipped, and `ArgNode.firstToken/lastToken` is what the coverage gate now runs on. The numeric claims I re-derived are all still exact (RMS0202 61+45, RMS0201 32, RMS0200 858, RMS0301 38, RMS0302 73). Nothing in the lexical model (Sec.2) needs revisiting.

The problems are three kinds, and none is in the token model.

First, **three checks disagree with their own sources** — one with a pinned rule in this document, one with the guide, one with a guide line the spec paraphrases more strongly than the guide states. All three are demonstrated below with a run, not an argument.

Second, **the document has been amended in place five times since rev 5 without a rev bump**, and the amendments live in Sec.10 while the sections they overrule (Sec.6, Sec.8) still read as written. An implementation session following CLAUDE.md's "design specs are authoritative, do not improvise" and reading Sec.6 or Sec.8 top-down would rebuild work that has already been reverted.

Third, **the verify-in-game checklist has not been connected to the instrument that exists**. Nineteen items are open, several flagged TOP PRIORITY since rev 3, while forty-four RMSTEST scripts across four batches have answered every question `preview-design.md` asked. Exactly one parser item (#11, `#undefine`) has ever been run.

Three blocking, ten significant, thirteen minor.

---

## What I verified and what holds

- **The lexer is the spec, line for line.** Whitespace pinned to the six C `isspace` characters (`lexer.ts:15`), the three classification regexes verbatim (`lexer.ts:17-19`), leading BOM as its own trivia `word` token (`lexer.ts:91-96`), the comment pass as a depth counter with `nestedComments` defaulting true and the non-nesting mode emulated by not incrementing (`lexer.ts:128-163`), one glued-marker diagnostic per token (`lexer.ts:173-178`). No deviation found.
- **Sec.5.4's shared-block rule is the highest-value fix in rev 5, by an order of magnitude over what its own text implies.** Corpus RMS0110 splits **94 shared-block / 2 degradation**, across 12 of 52 files: `local/Haboob.rms` 20, `local/Enclosed.rms` 19, `local/Acclivity.rms` 15, `TL Cape of Storms.rms` 12, `W4 - Immersion.rms` 7, `Pa_Site_v1.1.rms` 6, `local/fortified_clearing.rms` 6, then five files with 1–2. Rev 5's claim that plain dispatch would have drawn a warning on the guide's flagship idiom is right, and the blast radius is 94 warnings on working maps.
- **Sec.5.3 degradation really is rare, as the spec predicts:** 2 occurrences, in `Rage Forest 2026.rms` and `TL Cape of Storms.rms`. The "zero interleavings" claim is a 12-file claim and is now 2-in-52, which is the direction the header's re-derivation warning anticipated.
- **Sec.6's amendment and the `#const` retype hold exactly.** RMS0202 measures **61 warnings + 45 info**, the number Sec.6:289 states, and the `#const` value slot is `otherConstant` in the data with the guide citation in its own `notes`.
- **RMS0201 measures 32** — BUG-003's declared regression baseline, unchanged.
- **Sec.12's fuzz requirements are implemented as specified:** 1000 random-soup iterations plus the 20k-token nested-`if` adversary, and a nested-brace twin the spec did not ask for (`fuzz.test.ts:74,90,96`).
- **The coverage/span-fidelity gates run over every file including `local/` and `broken/`** (`corpus.test.ts:67-86`), which is stronger than Sec.12 requires.
- **Guide citations I resolved are exact:** guide:3006-3007 (percent_chance totals), guide:868-891 (borders, incl. the negative-value paragraph and the `top_border` bug), guide:733/750 (`land_percent` ↔ `number_of_tiles` mutex), guide:877 (border range 0–99).
- **Sec.13 item 3 is genuinely done in both representations** — 138 `predefinedLabels` in the data, `PredefinedLabel`/`PredefinedLabelCategory` in `language.ts`.

---

## Blocking

### B1. Sec.5.3's "symbols and includes survive degradation" is false for the forward-extended half of the range

Sec.5.3:251 pins the rule and states its purpose: without it, "every later reference to such a symbol would draw a false unknown-symbol warning from `validate()` — a goal-#5 leak through the back door."

The backward half of the range satisfies the rule for free: those tokens were parsed before the imbalance was detected, so their `#const`/`#define` entries are already in `this.symbols` when `degrade()` discards the nodes. The **forward extension added by rev 5** does not parse at all. `parser.ts:1230-1256` consumes raw tokens counting only braces and conditional keywords; a directive in that region is absorbed into the RawNode and never reaches `parseDirective`, so no `SymbolInfo` and no `IncludeInfo` is recorded.

Demonstrated:

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

→ `symbols: []`, and `RMS0202: "FOO" isn't defined in this file, so "value" won't get a valid integer. Define it first with #const…`

The control (same `#const`, no degradation) gives `symbols: ["FOO"]` and no diagnostic. This is precisely the false warning the pinned rule names, produced by the mechanism the pinned rule was written to prevent.

Volume today is low — 2 corpus degradations, neither containing a directive — but the invariant is pinned, the failure is silent, and the fix is small: record `#const`/`#define`/`#include*` from the forward scan as it consumes, or narrow the rule in Sec.5.3 and say why the forward half is exempt. The same hole exists in `degradeTooDeep`'s scan (`parser.ts:1310-1320`).

### B2. RMS0217 asserts a crash the guide does not describe, fires on the guide's own mitigation, and is the second-largest warning source in the tool

Sec.10:368 introduces the check; the shipped message reads "Negative border values are valid RMS, but can crash the game if they push the land origin outside the map — pair a negative border with an explicit `land_position` to keep the origin on-map."

What the guide actually says (guide:887-890):

> Negative values can be used, as long as the land origin stays inside the map. To ensure this, do one of the following: Specify a land_position within the map / Specify a sufficiently large base size

No crash, and no consequence named at all. The escalation from "as long as" to "can crash the game" has no observation behind it, which is the failure CLAUDE.md's third hard rule about reference data exists to catch ("before a diagnostic asserts engine behaviour, name the observation behind the claim").

Measured cost: **169 warnings, all of them this one message** — the largest warning source after RMS0200's 858, and larger than everything `validate()` emits combined. `AK_Namatjira.rms` 76, `local/CoastalForest.rms` **32 (a DE-official map)**, `broken/BCC2-Rekawa.rms` 18, then seven more files.

Worse than the volume: the check has no way to see the mitigation it recommends, because `cautionBelow` is a per-argument scalar. `local/Enclosed.rms` writes `land_position 99 1 top_border -10` in one block — the guide's first prescribed remedy, in the same block, and it still draws the caution. The check therefore fires hardest on authors who did the documented thing.

Three ways out, in order of cost: reword the message to what the guide supports and drop "crash"; make the caution conditional on the block containing neither `land_position` nor an explicit `base_size` (a real condition, not a scalar, which means it belongs in `validate()` rather than `consumeOneArg`); or downgrade to info. The first is required either way — the current wording is a behavioural claim with no source.

### B3. RMS0308's thresholds contradict the guide in both directions, and Sec.8 contradicts itself

Guide:3006-3007, unambiguous:

> * If the total percentages add up to less than 99%, there is a chance that none of them get chosen.
> * If the total exceeds 99%, only the first 99% will have a chance of occurring.

plus guide:3003 giving the argument range as `0-99` and guide:3010 noting "the 100th percent is never chosen".

Sec.8:321 uses **both** numbers in one sentence: "branches after the cumulative 99% are unreachable (warning); total <100 leaves a no-branch chance (info)". The implementation resolved the contradiction by using 100 twice (`validate.ts:874`, `validate.ts:880`).

Both halves are wrong against the guide, and both are demonstrable:

| input | shipped behaviour | guide |
|---|---|---|
| `33 / 33 / 33` (total 99) | RMS0308 info, "add up to less than 100" | total is not less than 99 — no gap exists |
| `45 / 54 / 1` (cumulative 99 before the last branch) | silent | third branch is past the first 99% and can never run |

Corpus impact is small and both cases are live: one 99-total block (`24hr_Mont Saint Michel.rms`) draws the false info, and one block (`TL Cape of Storms.rms`, `45/54/1`) has a genuinely dead branch that goes unreported. 412 of 454 corpus random blocks total exactly 100 and are unaffected either way.

Fix is one character in each comparison plus a decision recorded in Sec.8. While there, note that the guide's `0-99` range for the `percent_chance` operand is currently unenforceable — see S9.

---

## Significant

### S1. Sec.6's RMS0202 paragraph carries two readings that BUG-002 withdrew, and one design conclusion that was built and reverted

Sec.6:289 describes the remaining RMS0202 output as "noise" and explains it two ways:

- the 26 `actor_area ACT_AREA_TEAM_RES_TERRAIN` uses are "legal via Sec.2.1's token-ID model, and evidence that `integer` wrongly conflates 'a magnitude' with 'an identifier'";
- the 35 `$`-prefixed names are "unmodeled … so it is supported syntax we don't yet model".

`known-issues.md` BUG-002 closed both on 2026-08-02, in the opposite direction. (a) is one author's accidentally deleted `#const` — the author's own recollection, corroborated by the three-constant block missing its fourth member — and the `identifier` argument type designed on that reading was reverted from `language.ts`, `language.schema.json`, `formatStyle.ts` and `validate.ts` the same day. (b) are unexpanded preprocessor variables in files that ship broken at those lines, i.e. **true positives**.

The counts in Sec.6 are still exactly right (I re-derived 61+45). Only the interpretation is inverted, and the inverted interpretation names a schema change to make. This is the single highest-risk staleness in the document under "do not deviate from this spec".

### S2. Sec.8's bullet list still specifies the naive checks that measured 11,623 diagnostics

The scoping rules that took that number to 313 live in Sec.10:390-394, two sections later, and Sec.8 was never rewritten to match. Two bullets are actively misleading in reading order, since Sec.8 is where an implementer starts:

- Sec.8:307 — "Unknown constants vs symbol table + game-constants DB + `predefinedLabels`". What shipped (RMS0300) fires only on a **near-miss of a name that does resolve**, at edit distance 1, never on absence. The bullet as written is the check the positive-resolver rule forbids.
- Sec.8:313 — "Wrong-section placement (command's `def.section` vs enclosing section — warning)". Sec.10:400 explicitly forbids this: "must be driven by a **measured per-command list**, not by `CommandDef.section`", because the naive form warned 53 times, 52 of them on working maps.

Rewrite Sec.8's bullets to what shipped and leave the reasoning in Sec.10, or move the rules up. Either is fine; the present split is not.

### S3. The positive-resolver rule is stated only for the RMS03xx block, and the syntactic pass is where it was violated

Sec.10:392 states it as one of "three scoping rules govern the block". It is not a property of that block — CLAUDE.md carries it as a project-wide hard rule, and BUG-005 is the record of what happened when it was not carried back: RMS0200 asserted "the engine will silently ignore it" on 858 corpus sites, with the absence of a name from our own `language.json` as its entire evidence.

`parser-design.md` governs the pass where that happened and never states the rule at all. It belongs in Sec.1 beside goal #5, worded to bind both passes, with the RMS03xx text in Sec.10 reduced to a back-reference. CLAUDE.md's own framing — "a rule established in one pass is not established in the passes that predate it" — is the argument for hoisting it.

### S4. Sec.12's corpus gate is not the gate that runs

Sec.12:455 reads as universal: "`test-maps/*.rms` must parse with **zero error-severity diagnostics** … Non-negotiable CI gates". What runs is a **triaged allowlist of 11 files** (`corpus.test.ts:41-53`); the other 41 get tier 1 only (no-throw, coverage, span fidelity). The allowlist is the right design — it enforces the per-map triage protocol Sec.12 itself demands — but the spec should say so, because as written it claims a gate over 41 untriaged files that no test applies.

Three further gate facts the spec does not record and should:

- `.rms2` files are deliberately excluded from every corpus gate, with a stated reason (`corpus.test.ts:55-59`). They still carry diagnostics that `known-issues.md` quotes (`local/lombardia.rms2:166-168`).
- `validate()` has two corpus gates of its own — no-throw over every file, zero-error over the allowlist (`corpus.test.ts:119-139`). Sec.12 predates `validate()` and mentions neither.
- A total-diagnostic-volume cap is deliberately **not** asserted, because half the corpus is gitignored. Worth pinning, since it is the obvious thing a later session would add.

### S5. Sec.4's AST sketches disagree with the shipped types, and the code says so in writing

Every node in Sec.4 shows `Token` objects (`name: Token`, `header: Token`, `open: Token`, `close?: Token`, `keyword`, `condition`, `endif`, `start`, `end`, `hash`). Everything shipped uses **token indices**, and `types.ts:63-71` documents the deviation and its justification: indices are what the Sec.12 ownership property and the 3.3 patch engine need, and Sec.3 already said "AST nodes reference tokens by index".

Also missing from Sec.3/Sec.4: `BlockNode` and `SectionNode` carry `kind` discriminants; every node extends a `NodeBase` with `firstToken`/`lastToken`/`span`; `Diagnostic` has gained `suggestion?: string` (`types.ts:37-43`), consumed by the Breakdown raw-card quick-fix. A spec that implementation sessions are told not to deviate from should not be the one document that disagrees with the types.

### S6. Sec.9's benchmark rule was replaced, and the benchmark file was renamed

Sec.9:327 specifies "threshold set **10× the observed local time**". Shipped is a **relative per-token cost** — price one token on a 20 KB slice parsed 20 times, then require the full file's per-token cost to stay within 8× (`corpus.test.ts:141-177`) — because the absolute form went red twice on code that does not touch the hot loop. The rationale matches Sec.9's own stated intent ("to catch complexity regressions, not to measure"), so this is a spec that lost a race with its own reasoning.

Separately, Sec.1:14 and Sec.9 both name `Vanguard_v1.2.rms`; the file is `AK_Vanguard_v1.2.rms` (366,303 bytes, so the "366 KB" is right). `corpus.test.ts:52` records that the stale name silently dropped the file from a gate — the identical failure mode rev 5 caught for the BCC2 filename in Sec.12.

### S7. Seven cross-references point at sections that do not exist

`Sec.6.5` six times over five lines (84, 211 twice, 267, 268, 301) and `Sec.6.2` once (366). Sec.6 has no subsections. The intended referents are Sec.13 (reference-data and schema action items) and Sec.6's rule 2 (unverified-def severity capping) respectively. Two of those sites send a reader off to find an action item.

### S8. The verify checklist has never been connected to the instrument, and one item's status is now misleading

Nineteen open items, four of them tagged TOP PRIORITY or promoted. Since 2026-08-01 the project has had a working in-game measurement loop — 44 `RMSTEST_*.rms` scripts, four batches, roughly seventy generations, a scenario probe with four reading modes, and a documented run sheet. Every question `preview-design.md` Sec.15 asked has been closed by it. Exactly one parser item has ever been run: **#11**, `RMSTEST_19_undefine.rms`, which closed cleanly in two runs and is the model for the rest.

At least eleven open items are the same shape as #11 — one degenerate map, one read: #6, #7, #9, #10, #12, #13, #15, #16, #17, #19, #20, #24. Two have unusual leverage:

- **#7 (aliasing)** is the stated blocker for BUG-005 piece 2, which is 581 of the 858 RMS0200 warnings — 68% of the tool's largest diagnostic source, deferred explicitly pending this one answer.
- **#8** has a binary observable needing no instrument at all (`Continental.rms`, play with Infinite Resources, look for cliffs), and a DE-official specimen.

**And #6's status is now muddier than before.** Moving BCC2 to `test-maps/broken/` reads like a resolution. It is not one: the README's claim ("the diagnostic is right: the brace really is glued") answers whether the *glue* is real, which was never in question. What decides RMS0101's error severity is whether DE **generates** a file that reaches EOF at brace depth 1, and that is unmeasured. Sec.11:427 and Sec.12:455 should say so explicitly, or the item will be quietly treated as closed.

Recommend a batch 5 in `tools/scenario-probe/rmstest/README.md` covering the parser items, ordered #6, #7, #8, #24, #13/#17 (the two lexer-regex pins), and that Sec.11 gain a column naming the RMSTEST that will answer each item, the way the preview spec's Sec.15 does.

### S9. Sec.13's action items are half-done and not marked, and one of the unfinished halves has a live consequence

| Item | Real status |
|---|---|
| 1 (`verified:false` cleanup) | Substantially open: **56 of 94 attributes** and **13 of 41 commands** are still unverified, so Sec.6 rule 2 caps most of the attribute vocabulary's diagnostics at info. |
| 2 (remove `#ifdef` family; flag `#undefine`/`#include`) | **Done** in data — six directives, exactly the four functional ones plus two flagged `nonFunctional`. Still listed as an open action. |
| 4 (`repeatable`) | Done, but with **six** attributes, not the five item 4 lists. Sec.8:314 says six and names them. The two sections disagree. |
| 4 (`optional`/`variadic`) | **Done and consumed** (`parser.ts:914,926`), gated by four assertions in `parser.test.ts` per BUG-003. Still listed as open. |
| 4 (`mutexWith` consumed) | Done — see S10. |
| 4 (float-capable numeric type) | **Not done.** No `float` flag in `language.schema.json`; the argument-type enum is unchanged. |
| 4 (`arguments[]` on `controlKeywords`) | **Not done.** All seven entries carry no arguments. |
| 6 (`land_conformity` notes) | Done. |

The live consequence is the last unfinished pair. Because `controlKeywords` has no `arguments[]`, Sec.5.1's "pinned exception" paragraph is still the only definition of `percent_chance`'s operand — and the guide's documented `0-99` range for it therefore cannot be enforced at all, which is half of B3. Because there is no float flag, "float acceptance is per-attribute reference data" (Sec.2.2, verify #14) has nowhere to land, and the shipped behaviour is the blanket rule instead: floats satisfy every numeric slot silently. That blanket rule is defensible for v1 and matches Sec.2.2's "no diagnostic for float-into-integer" — but the spec should say that is the v1 rule, rather than describing per-attribute data that nothing can hold.

### S10. Sec.8's `mutexWith` parenthetical is stale, and the shipped check's dominant output is the case the spec's own verify list disbelieves

Sec.8:319 says the data is "already live in language.json: `place_on_forest_zone`/`avoid_forest_zone`". The data now has 19 entries covering 10 pairs, and RMS0307 measures **62 corpus warnings**:

| pair | count | sourcing |
|---|---:|---|
| `set_scale_by_groups` / `set_scale_by_size` | 50 | guide-declared; Sec.11 item 21 records **194 co-occurrences in official scripts** and calls the check "almost certainly a false-positive source" |
| `land_percent` / `number_of_tiles` | 12 | guide:733/750, explicitly "Mutually exclusive with:" — sound |

So the spec currently specifies a warning-severity check whose main output it does not believe, and says nothing about the split. Two things follow. First, Sec.8 should record that mutex pairs are not equally evidenced and gate the check per pair (a `mutexVerified` flag, or simply demoting the unverified pair to info) rather than trusting the whole table. Second, item 21's own framing needs rewording under the rule that closed BUG-003: "far past the point where 'every one of these is a bug' is the likely reading" is a frequency argument, and frequency is exactly what `showType` proved worthless. The question to put to the engine is not how often the two appear together but **what an author could have observed** if one silently won — which is a one-map RMSTEST (`set_scale_by_size` and `set_scale_by_groups` in one block, at two player counts, read with `--patches`).

---

## Minor

**M1. The document's identity is two phases behind its content.** The header still reads "Phase 2.1, rev 5" and "Implementation follows in 2.2 (lexer) and 2.3 (parser)". Both shipped, as did 2.4/2.5 and all of Phase 3. Five in-place amendments have landed since (RMS0217, the RMS03xx block, RMS0312, the RMS0304 2026-08-04 answer, Sec.13 item 5's withdrawal, Sec.11 item 11's engine verification), each correctly logged as an amendment but none reflected in the header or in an appendix. Revs 2–5 each got a changelog appendix; these did not. Recommend a rev 6 header plus Appendix E listing them, so the next reviewer can tell rev-5 text from post-rev-5 text without dating each paragraph.

**M2. Three corpus vintages are live and the header claims there is one.** The header states "all corpus statistics in this spec describe the 12-file snapshot verified by REVISION_5". Sec.6:289 quotes 52 files, Sec.8:310 and Sec.10:390 quote 57 maps, Sec.1:13 quotes 11 maps, Sec.6:271 quotes "8 of 11". All are defensible individually — 52 `.rms` and 57 counting `.rms2` are both real sets — but the blanket disclaimer contradicts three of the doc's own sections. One line defining the three sets (12-file snapshot / 52 `.rms` / 57 incl. `.rms2`) and a tag on each statistic would fix it permanently.

**M3. The glued-operator lint has an undocumented exception.** `parser.ts:1113` excludes `-` from the glued-operator character class, so `(A-1)` draws nothing while `(A+1)` draws RMS0210 (verified by probe). The exclusion is necessary — a negative literal such as `-5` would otherwise flag itself — but Sec.2.2:82 states the lint without qualification. Pin either the exception or the intended discrimination between a glued minus and a negative operand.

**M4. The unglued-operand lint double-fires.** `( 5 + 1 )` produces RMS0210 **twice**, same message, same span (`parser.ts:1098` for the bare `(`, `parser.ts:1101` for the bare `)`). The spec's one-diagnostic-per-problem convention (Sec.5.1's unknown runs, Sec.5.3's "one-diagnostic promise") implies one.

**M5. Sec.14's file layout is out of date.** It omits `src/parser/language.ts` and `src/parser/resourceTotals.ts`, both shipped; it names `__tests__/parse.bench.ts`, which does not exist (the benchmark is a `describe` inside `corpus.test.ts`); and it does not mention `rms0200.measure.test.ts` / `rms0201.measure.test.ts`, which `known-issues.md` treats as the instruments of record for two bugs. `test-maps/broken/` is correctly recorded.

**M6. `validate()`'s signature lost its third parameter.** Sec.8:305 specifies `validate(result, refDb, opts?)`; shipped is two-parameter, with the reason written at the bottom of `validate.ts` (its only documented member, `resolvedIncludes`, is out of scope for v1 and an inert parameter is worse than an absent one). Fold that sentence into Sec.8.

**M7. Sec.10's did-you-mean amendment describes behaviour that has since changed.** The four non-functional engine strings are now real `language.json` entries carrying `nonFunctional` + `replacedBy`, so `min_distance` resolves as a known attribute and reports RMS0310 rather than reaching the containment path the amendment was written for; and `didYouMean` now excludes non-functional names from the suggestion pool entirely, with the reasoning in a code comment (`parser.ts:236-242`: "a did-you-mean must always point at something that works"). The prefix half of containment still earns its keep, but its worked example no longer describes what happens. Related: RMS0310's table row reads "Directive carries `nonFunctional`" while four **attributes** now carry it.

**M8. `ParseOptions.aliasTable` cannot express the case that motivates it, and only `known-issues.md` records that.** BUG-005 piece 2 (2026-08-05): `L` aliases a *command*, not a token kind, so `ReadonlyMap<string, TokenKind>` is not a drop-in for the tier-2 fix — and that fix is 581 of 858 RMS0200 warnings. Sec.2.1:66 and Sec.3:104 still present the option as the upgrade hook with no caveat. Also unverified, per the same entry: that `create_land`'s token ID is 32 at all, whose only source is a map author's comment.

**M9. The `predefinedLabels` wiring in `isDefinedSymbol` has no corpus case to validate it against.** Sec.6:285 pins that engine-provided names must count as defined once the data lands. It landed 2026-07-31 and the wiring is still a TODO (`parser.ts:1046-1053`). Worth recording in the spec that the corpus contains **no** instance that would change — RMS0202's 61+45 are fully accounted for by BUG-002's triage — so this cannot be validated by re-measuring, and needs a constructed test under the project's own "a check that has only ever passed proves nothing" rule.

**M10. Sec.8's duplicate-attribute and mutex checks are direct-items-only, and the reason exists only as a code comment.** `validate.ts:797-807`: not descending into `if`/`start_random` branches inside a block is the whole correctness argument, because branches are exclusive at runtime and counting across them would false-warn on the most ordinary conditional in RMS. Sec.8 says "same block/section" and section-level mutex is not implemented. Pin the argument in the spec; it is the kind of reasoning that gets "fixed" by a later session.

**M11. Sec.5.3's forward scan identifies constructs by hardcoded strings.** `parser.ts:1249-1253` tests `tok.text === "if" || "start_random" || "endif" || "end_random"` rather than consulting `controlKeywords[]`, a small goal-#4 exception. Defensible — the scan needs structural semantics, not just names — but undocumented as a decision.

**M12. RMS0104's message makes the same unevidenced claim Sec.11 item 24 already flags for RMS0106.** Shipped text: "This `}` has no matching `{` — it's ignored." (`diagnostics.ts:240`), alongside four RMS0106 variants with the identical "it's ignored" clause (`parser.ts:496,516,558,591`). Item 24 names RMS0106 and RMS0215; it should name RMS0104 too, since it is one sentence, one missing observation, and one test would settle all three.

**M13. Sec.11 item 22's framing is right and should be acted on with the other range work.** RMS0203 measures **49 corpus warnings**, and item 22 already names three documented ranges that official scripts exceed (`land_percent 1024`, `min_length_of_cliff` 1–2, `land_position 100 100`), correctly concluding "widen the data rather than the check" — the same shape as the `base_elevation 0` transcription error that false-warned 461 times. No change needed to the item; it just needs scheduling alongside S9's data work.

---

## Suggested order

1. **B1**, **B3** — small code changes against pinned or guide-sourced rules, both with reproductions above.
2. **B2** — reword first (free, and required regardless), then decide severity or condition.
3. **S1**, **S2**, **S3** — the three that can cause a future session to build the wrong thing. S1 is the most dangerous: it names a schema change that was already reverted.
4. **S8** plus a batch 5 run sheet. Item #7 alone unblocks 68% of the tool's largest diagnostic source, and #6 has been TOP PRIORITY across three revisions without ever being scheduled.
5. **S4**, **S5**, **S6**, **S9**, **S10** — spec-catches-up-to-code edits, mechanical once decided.
6. **S7**, **M1**, **M2** — the housekeeping that makes the next review cheaper.
