# Review: tools-api-design.md — the rev 9 round

**What this file is.** The critique round that produces **rev 9** of `age-of-rms/docs/tools-api-design.md`. The doc is at rev 8, folded in earlier on **2026-08-13**; this round ran the same day, hours later — the shortest gap in the series, which shapes what there was to find. Every repo claim below was re-derived from the working tree on 2026-08-13 (evening), with file:line. The appendix carries the probes. Where this note and the source disagree, re-check the source.

**Verdict.** **No blocking finding.** Every count rev 8 carries reproduces to the unit: `game-constants.json` 3011 entries / 2137 null `rmsConstant` / 501 `isCorpse` / 170 `resourceAmounts` (168 verified) / four-member `category` enum / 26 schema properties; `language.json` 40/41 commands and 40/94 attributes verified, `tokenId` still exactly `create_land = 32`, zero variadic argument defs; the alias census 581 = 384 + 197, corroborated here by an independent method (a direct count of `L`-opened lines in the two maps returns exactly 384 and 197); the nine-file context list unchanged with no tenth arrival; the `.gitignore` analysis exact down to the whitelist line that names `BCC2-Rekawa.rms` at the wrong path; `git ls-files test-maps` returns exactly the 12 files CLAUDE.md promises a clone. The parser, types and language citations are all current (`parser.ts:793/:1049/:1222/:1260/:1129/:1596`, `types.ts:174/:179/:180/:194/:195/:201/:202/:295`, `language.ts:189/:223/:227/:241/:244/:257-261` — every one resolves).

What the round found instead, in descending order: the newly published alias algorithm is **not quite the parser's algorithm** (S1); a bug fix that landed *after* rev 8 shipped **coupled two PROTOCOL.md rules that do not mention each other** (S2); rev 8 **folded its own round's corrections selectively** (S3); and three citations went stale **within hours** of publication, via parallel sessions (M1). The doc's elapsed-time thesis now has a same-day data point, and it splits exactly along the line the doc predicts: everything anchored to a symbol, a data file or a generated artefact held; every raw file:line into a file another session touched did not.

---

## Part 1 — Blocking

None. The calibration this series has used for blocking is a live, corpus-measurable breakage in the contract's path (rev 6's uncompilable flagship line, rev 7's silently-`undefined` `def`, rev 8's 581 unrecoverable nodes). Nothing found this round is live: S1 and S2 are both silent divergences in the "your map is fine" direction, but on scripts the corpus does not contain — the same latent-but-expressible class as the variadic caveat, and they get the same treatment: state the clause before PROTOCOL.md is stubbed, and extend the fixtures so the divergence has a gate.

---

## Part 2 — Standard

### S1. The published alias algorithm diverges from `Parser.aliasedCommand` in two expressible cases, and Sec.9 item 11's prescribed fixtures catch neither

Sec.4.2 publishes the algorithm PROTOCOL.md will carry verbatim:

> a word that resolves as neither command nor attribute may still be a command — scan the symbols preceding it for a `#const` of that name whose value is a plain decimal literal, and look that number up against `CommandDef.tokenId`. Single-pass, first-definition-wins

The parser does something adjacent but not identical, and its own comment says so (`parser.ts:676-681`): the alias is **the fallback of the command-by-name lookup specifically** — `commandsByName.get(name) ?? this.aliasedCommand(name)` (`parser.ts:681`) — computed independently of the attribute lookup (`:675`), with Sec.4's context order (block → attribute first; statement → command first) applied *afterwards* (`:682-683`). Two divergences follow.

**(a) The precondition is wrong for a word that is an attribute name.** Under the doc's recipe, a word that resolves as an attribute is ineligible for aliasing ("neither command nor attribute"). Under the parser, the alias participates wherever the command lookup does — so at **statement level**, a word that is an attribute name *and* `#const`-aliased to a command id resolves as **the aliased command** (statement context prefers `asCommand`, and the alias is inside `asCommand`), while a recipe-following external tool reads it as an attribute in the wrong context. In block context the two agree (the attribute wins in both). One case, expressible today with any attribute name: `#const grouping 32` then `grouping { … }` at statement level is a `create_land` to the host and RMS0207 noise to the recipe.

**(b) The scan stops at the first symbol bearing the name, whatever it is — it does not skip to a matching `#const`.** `aliasedCommand` (`parser.ts:1129-1139`) returns `undefined` the moment the first same-named symbol is not a `#const` with a bare-decimal value: a preceding `#define L` **blocks** the alias outright, as does a `#const L` with no value or a non-decimal one. The doc's phrasing — "scan the symbols preceding it *for* a `#const` of that name" — reads as skip-until-match, so a recipe-follower finding `#define L` above `#const L 32` above `L {` aliases the command the host refuses to. "First-definition-wins" gestures at this and does not say the winning first definition can be a *non-const* that kills the alias.

**A half-clause on "preceding", while editing the same sentence.** The parser's `this.symbols` is incremental, so "preceding" is free in-process; the wire's `parseResult.symbols` is the *complete* table. An external tool must filter by `symbol.nameToken` against the command's own name-token index before taking the first match — derivable, since `SymbolInfo` carries `nameToken` (`types.ts:266-277`), but one more thing "scan the symbols preceding it" leaves to be guessed.

**Liveness: zero corpus instances of either divergence.** All 581 aliased nodes are plain `L`, which is not an attribute name, and no corpus map carries a `#define` shadowing a `#const` alias (probe 4). Latent like the variadic clause, and worth stating for the identical reason: the recipe is the normative text an external author transcribes, and both divergences are silent AST disagreements between host and tool.

**Fix.** Restate the algorithm as the parser's actual rule — *the alias is the fallback of the command-by-name lookup; context rules apply after it; take the first preceding symbol bearing the name, and alias only if that symbol is a `#const` whose value is a bare decimal* — and add both cases to Sec.9's fixtures: a statement-level attribute-name alias, and a `#define`-shadowed `#const`. Item 11 as prescribed runs "a hand-built alias fixture and a real parse", and neither contains either case, so today the divergences would ride straight through the one test built to catch recipe drift.

### S2. BUG-013's fix coupled the `override_map_size` rule to the alias rule, and neither of the two PROTOCOL.md rules mentions the other

BUG-013 closed on 2026-08-13, **after rev 8 folded** — `instantiate.ts:280` now computes `const name = node.def?.name ?? tokenText(node.name)`, and `:322` tests `LAND_COMMAND_NAMES.has(name)` against that def-resolved name. Consequence: an aliased `L { … }` now **terminates the override window** in the host, because it *is* a `create_land` to every rule keyed on command identity.

Sec.2's external rule ("take the last occurrence appearing before the first land command, clamp to `[36, 480]`, ignore any later one") and Sec.8's PROTOCOL.md list state the override rule and the alias rule independently. An external tool implementing the override rule by name — which is what the sentence says — reads `#const L 32` + `L {}` + `override_map_size 300` as an override *before* the first land command and honours it; the host ignores it. Wrong grid, silent, in the exact "computes against the wrong dimension and fails quietly" direction Sec.2's own N2 finding was written about. Sec.4.1's residual paragraph inherits the same clause: its cheap host-side scan for "an `override_map_size` before the first land command" must also identify land commands post-alias (free in-process, since the host holds `def`).

**Liveness: latent.** `override_map_size` appears in 5 corpus maps, the alias in 2, and the intersection is empty (probe 4). One clause closes it: *a land command is identified after applying the alias resolution above* — in Sec.2's external rule and in Sec.8's PROTOCOL.md contents line that names the override rule.

**Worth recording on the other side of the ledger:** BUG-013's fix is the strongest corroboration yet *for* the doc's position. Rev 8's review cited the preview generator's by-name resolution as evidence that "resolve by name" is what a competent implementer writes unprompted; the fix inverted that — the app's own consumer now derives identity from `def` first, which is precisely the reconstruction Sec.9 item 11 asserts is possible. The doc's def-identity stance now has an in-repo precedent rather than only an argument.

### S3. Rev 8 folded its own round's corrections selectively, and the unfolded halves are now the doc's stalest lines

Two instances, both from rev 8's own review:

- **`ui-help.json` is 108 entries; the doc says 101, "re-measured 2026-08-10" (Sec.5).** Rev 8's M2 reported 101 → 108 the same day the fold happened. The doc took M2's `resourceAmounts` 170 into Sec.10.1 and left Sec.5's 101 standing. The parts that matter survive — still exactly two tools-adjacent ids, still 16 `preview.*`, so the eight-against-sixteen bar is untouched — but the number is now wrong *and* wears a date that suggests it was checked.
- **`useDocument.ts` citations, half-taken.** Rev 8's M1 re-resolved the module-level model `:22 → :79` and `setValue` `:162 → :224`; the doc's Sec.5 document-replace paragraph still carries `:22` and `:162`, while the same finding's other corrections (`applyTextEdit :309`, the undo listener `:337-353`) were taken and are correct.

The defect is minor-grade; the process point is not. **A partial fold converts a consistent dated snapshot into a mixed one** — after it, the paragraph's date no longer tells a reader which of its numbers were refreshed, which is worse than a uniformly stale paragraph whose date honestly scopes it. When folding a round, take a finding's corrections as a unit or record the refusal the way Sec.10.1's "deliberate non-change" paragraph does; rev 8 demonstrably knows how, since it did exactly that for the readiness counts.

---

## Part 3 — Minor

- **M1. Same-day citation drift, all from parallel sessions, all in files the doc cites by raw line.** `App.tsx:70/:76` → the providers are now at **`:102`/`:108`** (a bug-report button landed above them today), and the sentence "mounted a line apart" is no longer true in the letter either — `PreviewCutProvider` mounts *between* them (`:103`), so the confusable neighbours are three, which if anything strengthens the paragraph's warning and deserves the updated wording. `instantiate.ts:288-302` (override_map_size) → **`:299-313`**, and the `typeof` list `:290/:324/:437` → **`:301/:335/:448`** (`:168`/`:182` hold) — BUG-013's one-line edit shifted everything below it. `usePreviewResult.ts:22-30` → the cited comment now sits at `:18-33` (`WATCHDOG_MS` at `:34`). None changes a conclusion; all are the doc's own cite-by-symbol advice collecting its evidence.
- **M2. 581 against 582.** Sec.1 says "the 582-key drop … The entire difference is the two alias maps: 581 command nodes". Rev 8's own probe attributed 384 + 197 **+ 1**, with one key unaccounted. Either write "581 of the 582" or carry the stray key; "the entire difference" over-claims by exactly the unit the probe could not place.
- **M3. "38-fold" is cited to sections that never state it.** Sec.1 ("re-expands the other 38-fold (Sec.4, Sec.4.2)") and Sec.4.2's closing paragraph ("The 38× blow-up") both point at text whose numbers are 40×/50×/35×/25× source ratios and 41–49% def shares. The figure is derivable (≈5.8 MB of def re-expansion on the worst map against the ~150 KB of defs `language.json` actually carries) but nothing in the doc derives it. One parenthesis, or re-point the citation at the derivation.
- **M4. The "FOUR unrelated families" sentence has a new candidate member as of today.** `useDocument.ts:61` now persists the Open dialog's last-used folder (`LAST_SCRIPT_FOLDER_KEY`, `src/settings/scriptFolder.ts`, landed 2026-08-13) into the same store file. Whether that is a fifth family or the app family growing is arguable — it re-exports `APP_SETTINGS_STORE_FILE` from `nameDisplay.ts`, so a reasonable reading files it under app display — but the sentence is a *count*, in the section whose whole argument is that the consent string must not over-claim, and the doc's own rule for counts is to date them hard or drop them. "Four as of 2026-08-10" survives as written only because it is dated; consider the list-shape ("help, generation, layout, display, and whatever lands next") that cannot decay.
- **M5. `AdvancedToolsSettings.tsx:7` still reads "The Advanced Tools pane itself hasn't been built yet, so it has nothing to configure."** Verified unchanged; fourth consecutive round recording it (rev 6 M5, rev 7, rev 8 M7). The 5.1 obligation stands.

---

## What is right and should survive rev 9

- **Every data count reproduces exactly** — the full set in the verdict above, re-derived from the files rather than from rev 8's review. Three rounds ago this section reported which counts moved; this round none did, which is the first time in the series and is what a same-day round *should* find. It is also the strongest argument yet that the counts belong in Sec.10.1's reporter rather than in prose: the reporter would have produced this paragraph for free.
- **The whole alias fold is faithful to the code it describes**, S1's two edge cases aside: `commandsByTokenId` at `language.ts:241` built `:257-261`, `aliasedCommand` at `parser.ts:1129`, attributes and directives genuinely name-only (`:675`, `:420`, `:1312`), the bare-decimal `/^\d+$/` gate real, `SymbolInfo` carrying everything the wire recipe needs. The `0x20`-does-not-alias clause and the do-not-hardcode-32 clause both check out against the source.
- **The `.gitignore` finding is exact in every particular**: `test-maps/*` at `:44`, eight whitelist patterns at `:45-52`, the `BCC2-Rekawa.rms` line naming the top-level path while the file sits in `broken/`, and a 12-file clone corpus confirmed by `git ls-files` rather than by reading the patterns.
- **The context-file diff instruction works as corrected.** `find src -name "*Context.tsx"` returns the recorded nine, no arrivals since rev 8. A diff that returns empty is the boring reading, printed because the one time it was not boring it found the seed chip.
- **`applyTextEdit` is still single-edit at `useDocument.ts:309`**, `truncateAst.ts` is still 273 lines (it was touched today and did not grow), `PreviewResultContext.tsx:79` still holds the `truncateAst` call, `tsconfig.json:23` and `eslint.config.js:36-38` are as described, and the build log carries both halves of the rev-8 round (`:6054`, `:6099`), so the changelog-lives-elsewhere claim is real.

---

## Process note

**The elapsed-time thesis now has a same-day measurement, and it decomposes cleanly.** Rev 8 was folded in the morning of 2026-08-13; by evening, three of its raw file:line citations were stale (`App.tsx`, `instantiate.ts`, `usePreviewResult.ts`) and one of its rules had acquired an unstated coupling (S2) — all via parallel sessions landing a bug-report button, BUG-013's fix, and the script-folder work in the intervening hours. Meanwhile **every claim anchored to a symbol name, a data file, or a generated artefact survived untouched.** The decay constant for a raw line number in an actively-edited file is now measurable in hours; the decay constant for the other kind has not been observed to be finite yet. That is the doc's own Sec.10.2 instruction — cite by symbol, prefer the resolver — stated as a measurement instead of advice, and it is the reason this round's findings are clauses and fixtures rather than corrections.

**One structural suggestion, carried from the shape of S1 and S2 together.** Both findings are couplings between rules that are individually correct — the alias algorithm and the context order; the alias algorithm and the override window. The doc's standing checks diff *modules* against the doc's claims; nothing diffs the doc's own **rules against each other** when the code that implements one changes. The cheap version is already in Sec.9: item 11's fixture set is where rule-interactions become executable, so when a PROTOCOL.md rule gains a clause, add the fixture that exercises it against the other rules that share its inputs. S1(a), S1(b) and S2 are three such fixtures, each under ten lines of RMS.

---

## Appendix — how the numbers were obtained

All run 2026-08-13 (evening) against the working tree at `age-of-rms/`, on this mount's 32 `test-maps/*.rms`. Nothing in the tree was modified.

1. **Data counts.** `game-constants.json`, `language.json`, `ui-help.json` and `game-constants.schema.json` read directly in Node — entries by category, null `rmsConstant`, `isCorpse`, `resourceAmounts` (and verified subset), terrain verification, command/attribute verification, `tokenId` inventory, variadic and `acceptsKnownName` argument sweeps, ui-help totals and id filters, schema property/required/enum reads.
2. **Alias corroboration.** `grep -cE "^\s*L\b"` over the two maps → 384 (Petra) and 197 (Holler), matching the doc's parse-derived census by a method that shares none of its code.
3. **Citation resolution.** `grep -n` for every symbol the doc cites in `parser.ts`, `types.ts`, `language.ts`, `lineIndex.ts`, `validate.ts`, `useDocument.ts`, `useParsedDocument.ts`, `usePreviewResult.ts`, `instantiate.ts`, `objects.ts`, `mapDimensions.ts`, `index.ts`, `generationSettingsConstants.ts`, generator `types.ts`, `App.tsx`, `AdvancedToolsSettings.tsx`, `PreviewResultContext.tsx`, plus `tsconfig.json`/`eslint.config.js`/`.gitignore` reads and `wc -l` on `truncateAst.ts`.
4. **Corpus interactions.** `grep -l override_map_size test-maps/*.rms` → 5 maps, none of them Petra or Holler; no corpus map carries a `#define` shadowing a `#const` alias; the aliased population is `L` only (rev 8's census, corroborated by probe 2).
5. **Parallel-session activity.** `find src … -newermt 2026-08-13` → 29 files under `src/` modified today, including the four whose edits produced M1 and S2.
6. **Clone corpus.** `git ls-files test-maps` → 12 files exactly.
