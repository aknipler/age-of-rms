# Review: tools-api-design.md — the rev 8 round

**What this file is.** The critique round that produces **rev 8** of `age-of-rms/docs/tools-api-design.md`. The doc is at rev 7 (2026-08-11, spec only, no code, `tools-api/` and `src/tools/` still do not exist). It sits beside the rev-4, rev-5 and rev-7 review files, which rev 7 moved into this directory.

Every repo claim below was re-derived from the working tree on **2026-08-13**, with file:line. The appendix carries the probes. Where this note and the source disagree, re-check the source.

**Verdict.** Rev 7 landed all four of its own blocking/standard fixes in the places it said it would, and the parser amendment it escalated is in `src/parser/types.ts` with `unknown` def slots and a `.test-d.ts` gate, exactly as described. Sec.4.2's headline measurement survives a re-measurement in shape and in ratio: stripping all four `def` sites still removes **41.7%** of the worst map's payload (13.97 MB → 8.14 MB), against the doc's 41%.

Two things happened in the two days after rev 7 shipped, and both are in the contract's path.

**BUG-005 piece 2 landed 2026-08-13 and made a command's `def` depend on the script's own symbol table.** `#const L 32` now resolves `L {` to `create_land`'s `CommandDef` through a new `LanguageIndex.commandsByTokenId`. The wire strips `def`, and Sec.4.2 tells an external tool to recover it "by name — one index lookup". For 581 command nodes across two corpus maps that lookup returns nothing, and the tool sees an unknown command where the host sees a land. Silent, in the "your map is fine" direction. That is B1 and it is blocking.

**CREATION_PLAN 4.10 landed 2026-08-12 and multiplied `game-constants.json` by eight** — 372 entries to **3011**, 1.33 MB on disk, 1.25 MB stringified. `read-reference` sends it in full, so the outbound `run` message carries a **1.37 MB constant term** that Sec.4.2's payload analysis does not model, and two of Sec.2's field-level notes now describe a different artefact.

Five standard findings, eight minor. One of the standard ones is that **rev 7's own new standing instruction does not work as written**: `src/*Context.tsx` finds three of this repo's nine context files, and the seed chip — one of the four cases the instruction claims — is not among them.

---

## Part 1 — Blocking

### B1. A `#const`-aliased command's `def` cannot be re-derived by name, and 581 corpus nodes take that path

Sec.4.2 item 3 strips `def` from the wire and gives the recovery recipe:

> An external tool resolves a `CommandNode`, `AttributeNode` or `DirectiveNode` def by name — one index lookup.

That was true on 2026-08-11. It stopped being true on 2026-08-13. BUG-005 piece 2 added an optional `tokenId` to `CommandDef` in `language.json` (one entry today, `create_land = 32`), a reverse index `LanguageIndex.commandsByTokenId` (`src/parser/language.ts:241`, built at `:257-261`), and a resolver `Parser.aliasedCommand` (`src/parser/parser.ts:1129-1139`) that runs for a word resolving as neither command nor attribute: it scans `this.symbols` for a `#const NAME <decimal>` and returns the command holding that token id.

So `def` is no longer a function of the node's name and the vocabulary. It is a function of the name, the vocabulary **and the script's own preceding `#const` directives**, single-pass, first-definition-wins.

Measured 2026-08-13 (appendix, probe 2), over the 32 `test-maps/*.rms` on this mount, counting command nodes that carry a `def` whose token text is not in `language.json`'s command list:

| map | aliased command nodes | alias |
|---|---|---|
| `24hr_Petra.rms` | 384 | `L` |
| `24hr_Holler.rms` | 197 | `L` |
| all others | 0 | — |
| **total** | **581** | |

581 is the same number `rms0200.measure.test.ts` reports for the block-opener population before the fix, so this is the same set from the other side.

**What breaks, and in which direction.** An external checker holding the wire form does `commandsByName.get("L")` → `undefined`, and every one of Petra's 384 lands is an unknown command to it. CREATION_PLAN 5.2's own named static checks are the ones that suffer: `land_percent` over-allocation sums a percentage across `create_land` blocks, and on Petra it sums nothing and reports a clean map. Failure is silent and in the direction of "your map is fine" — the failure shape rev 6's B1 and rev 7's B1 were both fixed to remove, arriving this time through the recovery recipe rather than through the type.

**It is recoverable, which is why the fix is cheap.** Everything the algorithm needs is already on the wire: `parseResult.symbols` (each `SymbolInfo` carries `directiveKind`, `nameToken`, `valueToken`), `parseResult.tokens`, and `CommandDef.tokenId` inside `referenceData.language`. Nothing new has to cross the boundary.

**Fix, four parts.**

1. Sec.4.2's recipe gains the alias clause, and PROTOCOL.md carries the algorithm, since an external author cannot read `parser.ts`: *a word that resolves as neither command nor attribute may still be a command — scan the symbols preceding it for a `#const` of that name whose value is a plain decimal literal, and look that number up against `CommandDef.tokenId`. Single-pass: a `#const` below a use does not reach back.* This is the third rule of the same class as "build your own `LanguageIndex`" and "resolve `override_map_size` yourself", and it belongs in the same list in Sec.8's PROTOCOL.md contents block.
2. **State the capability consequence.** Sec.4.2 already says a tool needing defs declares `read-reference`. For the alias path that is not optional and not about defs: without `referenceData.language` a tool cannot see `tokenId` at all, so `read-ast` alone is not sufficient to know what a command *is*. Say it.
3. **Sec.9 item 1(a)'s fixture gains an aliased command** — `#const L 32` plus an `L { land_percent 20 }` block — and asserts the wire form still lets a consumer reach `create_land`. That fixture is also the mutation target: delete the alias clause from the decode helper and it goes red. Do not aim it at 1(b): the two maps that carry the construct are `24hr_Petra.rms` and `24hr_Holler.rms`, and **neither is on `.gitignore`'s whitelist** (see S4), so a corpus-scale assertion is green-by-absence on a clone. This is rev 7's S2 defect recurring on new data.
4. **Say that the recipe is versioned by data.** `commandsByTokenId` is "empty but for the ids a run has measured, which today is one" (`language.ts:238-240`). A tool that hardcodes `32 → create_land` will be wrong the next time an RMSTEST run measures an id, and a tool that reads `tokenId` out of the language data it was handed will not be.

**Corroboration that this is not a hypothetical consumer mistake — the app's own downstream consumer already makes it.** `instantiate.ts:269` computes `const name = tokenText(node.name)` and `:311` tests `LAND_COMMAND_NAMES.has(name)`; `lands.ts:732` and `:738` match `cmd.name === "create_player_lands"` / `"create_land"`. `node.def` is carried through onto `InstantiatedCommand` (`instantiate.ts:315`) and never consulted for identity. So the preview generator resolves commands exactly the way Sec.4.2 tells external tools to, and Petra's 384 lands are invisible to it. That is a preview bug rather than a tools-api one and is out of scope here — it is flagged separately — but it is the strongest available evidence that "resolve by name" is what a competent implementer will write, unprompted, today.

---

## Part 2 — Standard

### S1. `read-reference` is now a 1.37 MB constant term the outbound analysis does not model, and two of Sec.2's notes describe an artefact that no longer exists

CREATION_PLAN 4.10 landed 2026-08-12. Re-derived 2026-08-13 (probe 1):

| | doc (2026-08-11) | now |
|---|---|---|
| `game-constants.json` entries | 372 | **3011** |
| by category | — | terrain 131, object **2672**, objectClass 56, attribute 152 |
| `rmsConstant: null` | 85 | **2137** |
| `verified: true` | — | 2891 |
| rows with `resourceAmounts` | 23 | **170** (168 verified) |
| schema properties | 24 | **26** |
| stringified size | not stated | **1.25 MB** (`language.json` adds 0.115 MB) |

Three consequences, and the first is the one that changes a number in the spec.

**(a) Sec.4.2 rule 2 bounds the outbound `run` message "by the payload, not by a constant" and then models only `JSON.stringify(parseResult)`.** `ToolContext.referenceData` is a second term, it is the same 1.37 MB on every run, and the flagship tool declares `read-reference`. Worst case is now ≈ **9.5 MB** (8.14 MB `def`-stripped Vanguard + 1.37 MB reference data), still comfortably under the 32 MB cap, so nothing breaks — but the section that carefully measures one term and omits the other invites the next reader to re-derive the cap from the wrong quantity. One sentence and one addend.

**(b) Sec.2's `rmsConstant` bullet is now wrong in kind, not only in count.** "85 rows are null (the DE terrains with no callable constant)" is 2137 rows, and the nulls are overwhelmingly roster objects that have no RMS name at all. The bullet's argument survives and gets stronger — a hand-written `rmsConstant: string` now crashes a name-based consumer on **71%** of the file rather than a fifth — but the parenthetical explanation is false, and it is the part a reader uses to decide whether the claim applies to them.

**(c) The `read-reference` capability's own justification should be re-read against the new file.** Sec.2 grants "language.json + game-constants.json in full" because the checker's static layer needs "per-object resource amounts, all commands". The file now also carries 501 `isCorpse` rows (blood decals and carcasses, which the reference table itself hides behind a toggle) and 2137 rows no script can name. Not a defect — full-file delivery is still the simplest correct answer and scoping it would be a new capability — but the doc should say the number out loud, because "in full" changed meaning by 8× and the sentence did not.

### S2. Sec.10.1's `resourceTotals` bullet is false, and the readiness picture has flipped in the direction the doc does not expect

Sec.10.1's fourth bullet:

> `src/parser/resourceTotals.ts` does not model script-level resource modifiers at all (CLAUDE.md tracked debt) … This one is a code gap, not a data count, and the reporter cannot see it.

`effect_amount <effect> <target> ATTR_STORAGE_VALUE <n>` has been modelled since **2026-08-11** (`src/parser/resourceTotals.ts:224` onward, conditional overrides widening the reported range, unconditional ones replacing the base). CLAUDE.md's own tracked-debt entry records it as built *and* as inert, because at the time no `effect_amount` target hit one of the 16 rows carrying a yield.

4.10 ended the inertness. Measured 2026-08-13 by running the real `computeResourceTotals` over each corpus map twice, once as written and once with every `effect_amount` line blanked (probe 4): **27 of 32 maps contain `effect_amount`, and 5 of those 27 now have different resource totals because of it.** The swings are not marginal:

| map | wood, overrides applied | wood, overrides removed |
|---|---|---|
| `24hr_Holler.rms` | 4,100 | 1,169,100 |
| `24hr_Petra.rms` | 5,592,000 | 2,796,000 |
| `AK_Namatjira.rms` | 1,909,000 | 954,500 |

So the bullet is wrong twice over: the code gap closed, and then the data gap that made the closure invisible closed too. Both halves matter to 5.2, because a resource-based static finding is now sensitive to a path that produced identical numbers a week ago. Rewrite the bullet as what is *still* open — `GAIA_SET_ATTRIBUTE` vs `SET_ATTRIBUTE` ownership, `GAIA_UPGRADE_UNIT`, and path correlation, all named in `resourceTotals.ts`'s own header — and note that the reporter still cannot see any of it.

This is also the cleanest available illustration of Sec.10.2's own thesis, so it is worth one line there: **the warnings decay upward as well as downward.** Every decay this document has tracked so far made a claim too optimistic; this one left a capability under-sold for two days.

### S3. Rev 7's new standing instruction finds three of nine contexts, and would have missed the seed chip

Sec.10.2 closes with the mechanical check rev 7 added, on the strength of a claimed four-for-four hit rate:

> list `src/*Context.tsx` and diff `src/preview/generator/` against the modules this document names.

The glob is root-level only. Run today it returns three files: `ParsedDocumentContext.tsx`, `PreviewCutContext.tsx`, `PreviewResultContext.tsx`. The repo has **nine** (probe 5):

```
src/ParsedDocumentContext.tsx              src/breakdown/BreakdownContext.tsx
src/PreviewCutContext.tsx                  src/components/preview/PreviewViewContext.tsx
src/PreviewResultContext.tsx               src/components/sidepanel/SidePanelLayoutContext.tsx
src/settings/AppSettingsContext.tsx        src/generationSettings/GenerationSettingsContext.tsx
                                           src/help/HelpSettingsContext.tsx
```

Of the four cases the instruction is calibrated against, the glob catches one. **The seed chip lives in `src/components/preview/PreviewViewContext.tsx`**, not at the root — and the seed is the case Sec.2 spends a paragraph deciding. `teams` arrived through `src/generationSettings/`, and `mapSize.tiles` through a pure module. So the four-for-four claim is not reproducible as written, and a rev-8 reader running the check literally would come away reassured.

**Fix.** `find src -name "*Context.tsx"` — nine files today, cheap to eyeball, and it is the version that actually has the hit rate the paragraph claims. Worth adding the second half rev 7 got right and under-specified: the check is a diff, so rev 8 should record *the list as of this revision* so the next round can see what is new rather than re-reading nine files. As of 2026-08-13 the nine above are the whole set, and `AppSettingsContext.tsx` (the name-display setting, `src/settings/nameDisplay.ts`) is the one that arrived since rev 7.

### S4. "the 32 tracked `test-maps/*.rms`" is not what tracked means in this repo, and one prescribed gate depends on the difference

The doc says "tracked" 14 times, always meaning the 32 maps on this mount. CLAUDE.md's repo map is explicit that this is not the tracked corpus:

> **10 tracked .rms + sample.rms + broken/BCC2-Rekawa.rms — 12 files, NOT the 32 on a maintainer's disk.**

`.gitignore:44-52` ignores `test-maps/*` and whitelists `sample.rms`, `13_Rings_v1.2.rms`, `AK_*.rms`, `AD4 - Ra.rms`, `BCC2-Rekawa.rms`, `Chaotic_Straitv0.99.rms`, `Menindee_AUS_v2.3.rms` and `TC2 - Comeer v1.4.rms`. So of the four maps in Sec.4.2's payload table, `AK_Vanguard_v1.2.rms`, `13_Rings_v1.2.rms` and `AK_Namatjira.rms` survive a clone and `24hr_A Heart Map.rms` does not; of B1's two alias maps, neither does.

The measurements are fine — they are illustrations of shape, and the doc says so. What is not fine is the one place a prescribed test lands in that gap. Rev 7's S2 fix says:

> take a tracked map, append lines using `inf`, `-inf`, an `rnd` with an infinite bound and a 400-digit literal, and park it in `test-maps/broken/`, which exists for exactly this deliberately-degenerate, not-corpus-gated tier.

`test-maps/broken/` is inside `test-maps/*`. Git does not descend into an excluded directory, so a negation for a file underneath it cannot re-include it — a new fixture dropped there is invisible to a clone unless `.gitignore` gains a line for the directory, and the sentinel encoder's only mutation gate goes back to being green-by-absence, which is precisely the defect rev 7's S2 was written to remove. `BCC2-Rekawa.rms` being in there today does not prove otherwise; it predates the rule or was force-added.

**Fix.** Say "the 32 `test-maps/*.rms` on a maintainer's disk" where a measurement is being reported, keep "tracked" for what CLAUDE.md means by it, and add one clause to the S2 prescription: **whitelist the fixture in `.gitignore` in the same commit that creates it**, the same way "new dependency ⇒ say `npm install` in the same breath" works. Same for B1's alias fixture, which is why both should be hand-built fixtures under Sec.9 item 1(a) rather than corpus assertions.

### S5. Tool prose that points at a second location has no rule, and the repo landed one on 2026-08-13

A hard rule went into CLAUDE.md two days after rev 7:

> **A diagnostic that points at a SECOND place in the file names a LINE. Spans stay character offsets.**

It was reported from the installed release: seven RMS03xx/RMS0103 messages shipped saying "already set at offset 86970", which names a position no editor displays. The fix is `lineNumberOfOffset` (`src/parser/lineIndex.ts:46`), now called from `parser.ts:153` and `validate.ts:281`.

`ToolOutput` is a message vocabulary aimed at exactly this failure. `severity.text`, `text` and `table.rows` are prose a person reads; `severity.span` and `codeRef.span` are offsets a machine consumes. The contract pins the machine half carefully and says nothing about the prose half, so the first checker that writes "conflicts with the create_object at offset 41003" reproduces the shipped defect inside a spec that had the answer in a neighbouring file.

**Fix, two sentences.** In Sec.2, beside the `codeRef`/`span` decision: *spans are offsets, always; any location named in a block's TEXT is a 1-based line number.* In Sec.8's PROTOCOL.md list: an external tool converts with `parseResult.lineOffsets`, which is on the wire and deliberately not parameterized (`src/parser/types.ts:295`); a built-in imports `lineNumberOfOffset`. Then Sec.9 item 9's `scriptStats` exemplar is the natural place to demonstrate it, since it is the one tool whose output is nothing but prose about locations.

---

## Part 3 — Minor

- **M1. Every `src/parser/parser.ts` citation in the doc is stale, and so are the four `types.ts` `def` sites the rev-7 fix names.** BUG-005 piece 2 rewrote parser.ts on 2026-08-13, and the parser amendment itself moved the node types. Re-resolved: `def: undefined` on the unknown-command path `771 → 793`; `def: argDef` `1017 → 1049`, `1142 → 1222`, `1180 → 1260`; `parseRndValue` `1511-1514 → 1596`. The `def` slots are now `ArgNode` **:174**, `CommandNode` **:180**, `AttributeNode` **:195**, `DirectiveNode` **:202** (doc: 89/95/110/117) — those four were invalidated by rev 7's own amendment landing, so they were wrong the day rev 7 shipped. Also `useDocument.ts`: the module-level model `22 → 79`, `getAlternativeVersionId` `52 → 109`, `setValue` `162 → 224`, `applyTextEdit` `244 → 309` (still single-edit, so the finding stands), the window-level undo listener `255-267 → 337-353`. `buildLanguageIndex` `202 → 244`, `LanguageIndex` `191 → 227`, `PredefinedLabel` `153 → 189`, `predefinedLabels?` `187 → 223`. `ObjectConstant` `217-227 → 220-230`. ESLint purity globs `35-39 → 36-38`. **`truncateAst.ts:287` now points past the end of a 273-line file**, which is the citation B2 rests on.
- **M2. Numbers for Sec.10.1's reporter to absorb, re-derived 2026-08-13.** Terrain rows unverified **116 of 131** (holds, fifth consecutive re-measurement). `language.json` commands **40/41** and attributes **40/94** — both hold exactly, so rev 7's correction stuck. FISH and SHORE_FISH are still `verified: false`, so that soft spot is real. `resourceAmounts` 23 → **170**. `ui-help.json` 101 → **108** entries, still **16** `preview.*` and still exactly two tools-adjacent ids (`tabBar.advancedTools`, `settings.tab.advancedTools`), so Sec.5's eight-against-sixteen bar is unchanged. Schema `required` is still exactly the four named, and `isTree` still has no data row. This is the third round in a row where the *shape* claims hold and the counts move, which is the argument for building the reporter rather than a fourth refresh.
- **M3. Sec.1's `undefined`-key measurement moved from 4,599 to 4,017, and the delta is B1.** Per-map, `AK_Vanguard_v1.2.rms` is still **2,304** and `13_Rings_v1.2.rms` still **763** — both reproduce to the unit. The whole 582-key drop is the two alias maps: Petra measures 103 today and carries 384 alias nodes, Holler measures 2 and carries 197, and 384 + 197 + 1 accounts for the difference — 581 command nodes stopped writing `def: undefined` on the unknown-command path when the alias resolver started resolving them. Zero `undefined` array elements, still, across all 32 maps. The rule is untouched; the number wants re-stating with its cause, since "the corpus disproves the rule" is the sentence it is load-bearing for.
- **M4. `CommandNode.name` is a token index, not a string.** `name: number` (`types.ts:179`), same for `AttributeNode.name` (`:194`), and `DirectiveNode` has no `name` at all — it carries `hash: number` whose token text is the directive name (`:201`). Sec.4.2's "resolve … by name — one index lookup" is one dereference short as published, and PROTOCOL.md is where an external author will look for it. One clause: the text is `tokens[node.name].text`.
- **M5. The doc got denser, not sparser, against rev 7's own accepted process note.** Rev 7's round measured 86 of 354 non-empty lines carrying a "rev N" back-reference; today it is **108 of 404** (27%, from 24%), across ~15,100 words. The preamble cites preview-design rev 7's reasoning for moving changelogs out and the body is still organised as a running diff. 5.1 is an implementation session and the next reader is reading for what to build. The distinction rev 7 drew is the right one and still un-applied: keep *how a number was reached* (the deadline arithmetic, the measured tables, the `def?: never` trap, why `rebaseEdit` is not for tool edits), move *what a previous revision believed* to the build log, which already carries the rev-3 through rev-7 changelogs.
- **M6. B2's fix does not name the file it is about.** Sec.2 and Sec.4.3 pin the context builder to `ParsedDocumentContext` and cite `truncateAst.ts` and `PreviewResultContext.tsx:79` (which reproduces exactly — the `truncateAst` call is on line 79). Neither mentions `src/PreviewCutContext.tsx`, which is where the cut offset and the pin actually live and the thing a `read-preview-view` escalation would have to read. One parenthetical.
- **M7. `AdvancedToolsSettings.tsx` still reads "The Advanced Tools pane itself hasn't been built yet, so it has nothing to configure"** (`src/components/settings/AdvancedToolsSettings.tsx:7`, verified). Rev 6's M5 and rev 7 both flag it; recording that it is still true so the 5.1 session inherits an obligation rather than a claim.
- **M8. Two verifications worth recording because they could have decayed and did not.** `override_map_size` is still at `instantiate.ts:288-302` with the `[36, 480]` clamp and the before-first-land rule (`LAND_COMMAND_NAMES` at `:63`), so PROTOCOL.md's rule is current. Zero argument defs in `language.json` are variadic, so the `ArgNode` positional caveat is still latent rather than live — but note `language.json` gained `CommandDef.tokenId` and `ArgumentDef.acceptsKnownName` (one use each) on 2026-08-13, which is the shape of change that would make it live.

---

## What is right and should survive rev 8

- **The 41% `def` figure reproduces, and so does the whole payload table's shape.** Re-measured 2026-08-13: `AK_Vanguard_v1.2.rms` 13.97 MB / 8.14 MB stripped (**−41.7%**), `24hr_A Heart Map.rms` 10.27 / 5.13, `13_Rings_v1.2.rms` 6.24 / 3.41, `AK_Namatjira.rms` 4.68 / 2.51; corpus total 89.53 MB / 45.54 MB; **25 of 32 over 1 MB and 2 over 8 MB**, both unchanged. Absolute sizes rose 6–15% since 2026-08-10 (the vocabulary grew), the ratios did not. Rev 7's B1 half-one is fully discharged: all four `def` sites are named in the rule and in the parser.
- **The parser amendment landed exactly as the doc describes it.** `src/parser/types.ts:139-152` carries `DefSlots`/`NoDefs`, fifteen types take `<N = number, D extends NoDefs = DefSlots>`, `ArgValue` names both numeric positions including the `rnd` bounds (`:166-170`), `lineOffsets` is explicitly not parameterized (`:295`), and the header records both rejected mechanisms with the reason each fails. `src/parser/__tests__/wireTypes.test-d.ts` exists and declares its own local sentinel, as the doc says it does. The boundary the doc claims to have held — the parser owns the parameters, tools-api owns the sentinel — is held in the file.
- **Sec.9 item 2's friction note is still live and still correct.** `PreviewReferenceData` is unchanged at `index.ts:70-73`, `generatePreview`'s signature is unchanged at `index.ts:232` (the one line citation in this doc that survived two days of parser churn), `PreviewSettings` is unchanged at `types.ts:37`, and `ObjectConstant.resourceAmounts` is still `Readonly<Record<string, number>>` (`objects.ts:225`), so the index-signature collision the note predicts will happen exactly where it says.
- **The `undefined` split holds on new data.** Zero `undefined` array elements across all 32 maps, on a corpus that has been reparsed by a rewritten parser since the rule was written. The asymmetric matcher choice needs no revisiting.
- **`host-error`, `rowSpans` length validation, `tools.params`, the registration-time default check and the M6 silence-not-liveness sentence are all in the body**, each in the section rev 7 pointed at rather than in a changelog. That is the part of rev 7's round that most improves the doc for an implementer.

---

## Out of scope, flagged rather than folded in

**The preview generator is blind to `#const`-aliased commands.** `instantiate.ts:269` resolves command identity by token text and `lands.ts:732`/`:738` match `"create_player_lands"`/`"create_land"` as strings, while `InstantiatedCommand` carries the resolved `def` and never consults it (`instantiate.ts:315`). The parser resolves `L` to `create_land` as of 2026-08-13; the generator does not, so `24hr_Petra.rms`'s 384 land commands and `24hr_Holler.rms`'s 197 produce no lands in the preview. It is the CLAUDE.md rule that predicts it — *a rule established in one pass is not established in the passes that predate it; when a session lands a rule, grep for the older code the rule now governs* — and Petra is the map whose land-less source settled BUG-005 in the first place. It belongs in `docs/known-issues.md` and a preview session, not in this document. It is in this file only because it is the strongest evidence for B1: the app's own consumer wrote the recipe Sec.4.2 publishes, and it is wrong.

---

## Process note

Two of this round's five standard findings, and the blocking one, are things that landed **after** rev 7 was written, in the two days between revisions. That is now the dominant failure mode of this series and it is worth stating plainly in Sec.10.2: **this document's error rate is a function of elapsed time since the last round, not of the care taken in the last round.** Rev 7 was careful, re-derived everything, and its measurements still reproduce; it was overtaken anyway.

Which is an argument for the thing Sec.10.2 already says and the doc keeps not doing all the way: prefer the generated artefact, the resolver and the compile error to the written number. The three findings above split cleanly on that line. B1 could not have been caught by any test this document prescribes, because nothing in the contract asserts that a def is recoverable from the wire form — a round-trip test that reconstructs `def` from `SerializedParseResult` and compares it to the in-process one would have gone red on the day the alias landed, and it is the same shape as Sec.9 item 2's "prefer the compile error to the rule". S1 is a number in a spec that a reporter would have carried. S2 is a claim about code that a reporter cannot see and a reader has to check.

So the one structural recommendation for rev 8, beyond the findings: **Sec.9 gains an item that reconstructs every stripped `def` from the wire form and asserts it equals the in-process one, over both a hand-built alias fixture and a real parse.** That is the missing gate for the whole `def`-stripping decision, which is currently enforced by prose in two documents and by nothing executable.

---

## Appendix — how the numbers were obtained

All run 2026-08-13 against the working tree at `age-of-rms/`, on this mount's 32 `test-maps/*.rms`. Probes 2, 3 and 4 use an `esbuild` bundle of the repo's own `src/parser/`, run in Node; every scratch file is outside the repo and nothing in the tree was modified.

1. **Data counts.** `reference/data/game-constants.json`, `language.json` and `ui-help.json` read directly in Node. Note two shapes that return `undefined` to a naive read: the constants live under a single `constants` key, and `ui-help.json` is `{ entries: [{ id, text }] }` rather than a map. The schema's `required`, `properties` and the `category` enum live behind `$defs.constant`.
2. **The alias census.** `parseRms` bundled from `src/`; for each map, every `CommandNode` carrying a `def` whose `tokens[node.name].text` is absent from `language.json`'s command list. Petra 384, Holler 197, every other map 0. Cross-checked against a synthetic `#const L 32` + `L { land_percent 20 }`, which yields one such node resolving to `create_land`.
3. **Payload sizes and the `def` split.** `JSON.stringify(parseRms(src, languageData))` per map, measured unmodified and with a replacer dropping every `def` key. The undefined-key scan walks the same result object counting keys whose value is `undefined` and array elements that are `undefined`, with a visited set so shared `def` objects are counted once.
4. **The `effect_amount` effect on resource totals.** The real `computeResourceTotals(script, tokens, { constants }, 8)` run twice per map: once on the source as written, once on the same source with every line containing `effect_amount` blanked. 27 maps contain the construct, 5 produce different totals. Blanking whole lines is coarser than the parser's own conditional handling, so treat 5 as a floor.
5. **Context files.** `find src -name "*Context.tsx"`, against `src/*Context.tsx` for the comparison.
6. **The corpus `inf` census, re-run.** `grep -rniE "\binf\b" test-maps/*.rms` → 0, `grep -rEoh "[0-9]{20,}"` → 0, and no `rnd(` with a 15+ digit bound. Rev 7's S2 finding holds unchanged: the sentinel mutant still cannot go red against a corpus half.
