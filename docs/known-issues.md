# Known issues — Age of RMS

Open bugs with diagnosis and prescribed fix. One `##` section per bug. Move an entry to `docs/build-log.md` (as part of the session entry that fixed it) once it's closed — don't leave stale "fixed" entries here.

Entry format: symptom → reproduction → root cause (with file:line) → prescribed fix → verification.

---

## BUG-012 — a word valued 69 inside a comment hides the rest of the file from the engine, and the parser cannot see it

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 7). **Area:** `src/parser/validate.ts` (not the lexer — see below), `src/parser/diagnostics.ts`, `docs/parser-design.md` Sec.2.1 and Sec.13 item 7. **Found:** 2026-08-11, `RMSTEST_56a/56b/57/60`.

**What landed, and the one deviation from the prescription.** The check is `checkCommentOpeningWords` in **`validate.ts`, not `lexer.ts`**: resolving a word to a value needs the game constants and the script own `#const` table, and `parseRms(source, lang)` has neither — the lexer would have had to grow a reference-data parameter to answer a question the semantic pass already has everything for. The code number stays RMS0111 (the RMS01xx range describes what the diagnostic is about, not which file emits it). The lexer already tokenizes comment interiors and only marks them `isTrivia`, so nothing needed re-scanning.

**Only the FIRST hit in a file is reported**, since everything below it is inside the engine own nested comment and the message claim is that everything below is gone. Five tests including both negative cases (the bare literal `69`, and the same word as real code), plus the script-level `#const NAME 69` route. Three mutants red: the check disabled, the trivia guard dropped (fires on real code), and this entry own prescribed one — resolving only object-category constants, which turns the `ATTR_PROJECTILE_ARC` case red and is the reading this project held for most of a day. **The corpus is clean of it**, so the new error changes no gate.

**Symptom.** The engine resolves words inside comments through its shared token table. `/*` is token 69, so a word whose constant value is 69 **opens a nested comment**; comments nest, so the author's closing `*/` shuts only the inner one and **everything after it is invisible to the engine**. The map still generates — as a blank default — and nothing reports an error.

**Reproduction.** `/* SHORE_FISH */` followed by any script. Measured four ways: empty comment → script runs; `SHORE_FISH` → blank; bare literal `69` → runs (literals are lexed as numbers, never resolved); `ATTR_PROJECTILE_ARC` → blank (so it is the value, not the namespace).

**Scope.** `random_map.def` defines exactly two constants at 69: `SHORE_FISH` (line 263) and `ATTR_PROJECTILE_ARC` (line 1117). Plus any script-level `#const NAME 69`, which the parser already tracks. The file is loose in the install at `resources/_common/drs/gamedata_x2/random_map.def`.

**Prescribed fix.** While scanning a comment, resolve each word against game constants and the script's own `#const` table; if one resolves to 69, emit **RMS0111** at that token, severity **error**.

**The message is part of the fix, because this failure is invisible in game and the user has no other way to learn about it.** It must say what happened, where the damage starts, and what to do. Something in this shape:

> `SHORE_FISH` inside a comment. The engine reads this word as `/*`, so the comment never ends — **everything below this line is invisible to the game** and the map will generate blank. Rename it, split it (`SHORE _FISH`), or move this comment below your script.

Requirements on the wording, each of which a shorter message would fail: it names **the token**, since the comment may be long; it says **the rest of the file is gone**, which is the consequence and the reason for error severity; it says **the map still generates**, because otherwise the author looks for a crash that never comes; and it gives a **fix that works**, since "rename the constant" is impossible when the word is describing the constant it names.

**RESOLVED 2026-08-12 — MODEL IT AND DIAGNOSE IT** (reversing the previous day's call). The lexer treats a word resolving to 69 inside a comment exactly as it treats `/*`: depth increments, the remainder becomes trivia, and the AST matches what the engine sees. RMS0111 fires at the offending token, error severity.

**The corpus decided it.** Two tracked maps already contain this and both are the same idiom — a commented-out `create_object SHORE_FISH { … }` block, which is simply what an author writes when disabling a command. `Chaotic_Straitv0.99.rms` loses 563 of its 1110 lines; `test-maps/broken/BCC2-Rekawa.rms` loses 1060 of 1993. **Diagnosing without modelling leaves the preview drawing a map neither the engine nor the author will ever see, on real files, today.**

The earlier argument against modelling — that the author loses their outline — was overstated and should not be revived. Source fidelity is preserved and the parser never re-prints, so the Code tab shows every line exactly as written; only Breakdown thins to fewer cards, which is the correct depiction of a file the engine has truncated.

**Implementation shape, because it is smaller than it sounds.** `markComments` (`src/parser/lexer.ts:128`) is already a single left-to-right pass with a nesting-depth counter. The change is: when `depth > 0` and a word resolves to 69, do what the `commentOpen` branch does — about four lines. **The names must not be hardcoded**: CLAUDE.md forbids RMS vocabulary in `src/` and the lexer is deliberately a pure splitter, so add `commentOpenAliases?: ReadonlySet<string>` to `LexOptions` and let the caller supply it from reference data. The lexer receives a `Set<string>`, not a constants DB. Script-level `#const NAME 69` is the same pass: track `#const` triples at depth 0 and add them to the live set as encountered, which is causal in the order the engine reads them.

**The real work is re-baselining, not the edit.** Two tracked maps lose about half their tokens to trivia, so the corpus diagnostic counts move — the RMS0200 / RMS0201 / RMS0304 / RMS0315 measure tests and the corpus totals all need re-deriving. Neither map is in `ZERO_ERROR_ALLOWLIST`, so that gate is unaffected. Budget the re-derivation.

**And `unclosedComment` will now fire on both maps**, since depth never returns to zero. That is a true statement and should stay, but **RMS0111 must read first** — "unclosed comment" describes the symptom and names nothing the author can act on.

Two things follow and are part of the fix, not optional polish. The AST below the comment is deliberately **not** what the engine sees, so nothing downstream may read a clean parse there as evidence the script works — RMS0111 is the authority. And the preview will render a map the engine never would; acceptable only because the error is on screen, which is why the severity is error and not warning.

**Verification.** A lexer test per measured row above, including the two negative cases (`69` as a literal, and an empty comment) — those are what make the rule precise rather than superstitious. Assert the corpus effect directly on the two real maps: token counts before and after the offending line. Mutation-test by resolving only object-category constants and confirming the `ATTR_PROJECTILE_ARC` case goes red; that mutant encodes the reading this project held for most of a day.

**Why an error rather than a curiosity.** It cost a run in this repo — `RMSTEST_42` blanked and read as a failed experiment — and an author writing `/* place SHORE_FISH here */` in a working map loses everything below that line with no feedback from the game at all. This is precisely the class of silent failure the app exists to surface.

---

## BUG-011 — the default grouping mode is implemented as tight; measured, it is loose

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 5). **Area:** `src/preview/generator/objects.ts`, `docs/preview-design.md` Sec.6.6 and Sec.15 item 17(c). **Found:** 2026-08-11, `RMSTEST_46a/46b/46c`.

**What landed.** `isTightGrouping` now requires an explicit `set_tight_grouping`; an explicit `set_loose_grouping` still beats it. **Corpus delta, seed 7 on Normal: 13 of 32 maps change, every one of them downward, 159,732 → 141,281 placements (−11.6%)** — the two large movers are `OWWC1Tewaipounamu` 11,068 → 2,336 and `24hr_Mont Saint Michel` 9,899 → 1,946, both maps whose grouped commands had been filling straight through terrain their objects cannot occupy. New behavioural pair (a group confined to a one-column `terrain_to_place_on` patch, unstated versus tight), mutation-tested by restoring the tight default (2 red). **`force_placement`'s guide:2739 exclusion was deliberately left keyed on the `set_loose_grouping` ATTRIBUTE** rather than extended to an unstated-but-loose command, which is a second question nothing has measured.

**Symptom.** A `create_object` that sets `group_placement_radius` and states neither `set_tight_grouping` nor `set_loose_grouping` is treated as tight — anchor checked, fill unchecked. **498 of the corpus's 964 grouped commands declare neither mode**, so this governs the majority of grouped placements.

**Measurement.** One mode per file, three runs each, identical otherwise. Off-patch fraction against a `terrain_to_place_on` patch: tight **22–35%**, loose **0%**, unstated **0%**. The unstated command is checked per member.

**Prescribed fix.** Default to loose in `objects.ts`. Note the blast radius is larger than the line changed: under tight, a group's fill skips the habitat and spacing checks, so flipping the default makes hundreds of corpus commands place fewer objects in legal positions instead of more objects in illegal ones. Re-measure the corpus before and after and put the delta in the build log.

**Verification.** A test with a group restricted to a small patch and no mode stated, asserting every member lands on the patch; the existing tight test stays as the contrast. Mutation-test by restoring the tight default and confirming the new test goes red.

**Recorded and deliberately NOT fixed: the placement counts differ.** Explicit loose placed exactly 24 in all three runs; unstated placed 32, 32 and 40. Zero spill in both makes them identical on the rule this bug is about, but a consistent count difference means they are not the same code path. Do not tune to it — construct the run that separates a cap from a rejection rate if it starts to matter.

**Process note worth keeping with the bug.** The first version of this test put all three modes on one map, distinguished only by object id, and produced two contradictory readings across two sittings before being thrown away. A scenario records objects and positions, not which command placed them. **When a test's arms share a map, ask what in the export tells them apart** — the redesign cost two generations and removed the ambiguity entirely.

---

## BUG-010 — the beach pass edges the shallows/open-water boundary; measured, the engine does not

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 3). **Area:** `src/preview/generator/grid.ts` (`terrainDepth`/`waterDepthMask`), the beach pass in `terrains.ts`, `docs/preview-design.md` Sec.6.4 and Sec.15 item 29. **Found:** 2026-08-11, `RMSTEST_52`, two runs.

**What landed.** One line: the beach pass skips every tile that is not `DEPTH_LAND`, where it used to skip only open water. `terrainDepth`, `waterDepthMask`, `isHybrid` and the `beachTerrain` rows are all untouched, and the test that pins why they survive is the dry hybrid — land beside `DLC_MANGROVESHALLOW` still beaches, which an `isWater`-only test cannot express. Two `bands()` expectations inverted, mutation-tested by restoring the seaward skip (2 red). **Corpus re-measured at seed 7 on Normal: 6 of 32 maps change, beach 8984 → 7577** (`W4 - Immersion` 1752 → 1016, `TL Tres Leches` 1045 → 678, `AK_Hourglass` 568 → 380, `Chaotic_Strait` −71, `Three_Bays` −46, `AK_Six_Points` +1 through a downstream cascade). So the withdrawn half was producing about a sixth of all the sand on the corpus.

**Symptom.** The 2026-08-08 three-depth rule ("a tile takes its own beach where it borders anything strictly deeper than itself") produces sand on BOTH sides of a shallows shelf. The engine produces it only on the landward side.

**Measurement.** Land / shallows / open water in a known order. Beach tiles bordering **shallow and water**: **3** and **2**, against 336/312 bordering grass-and-water and 30/90 bordering grass-and-shallow. Two or three tiles at a triple junction is incidental, not a boundary.

**Prescribed fix.** Restore shallows to counting as water for the beach comparison — land against water is the rule — while keeping the part of the 2026-08-08 change that was right: the dry hybrids (`DLC_MANGROVESHALLOW` and the navigable ice family) must still take a beach against land, which is what the old `isWater`-only test missed and what motivated the depth model. The `isHybrid` flag and `beachTerrain` rows stay; only the seaward comparison goes.

**Verification.** `terrains.test.ts` already has a `bands()` cross-section covering both boundaries — invert the expectation on the seaward one. Re-measure the nine maps the 2026-08-08 change moved; S1 beach should stay at or above its pre-change value on all of them, which is the property that change was justified on.

**The lesson.** The far edge was argued from a `terrain_state` line about "thinner blending of shallows and beach terrain", read as evidence the two are adjacent by default. It evidently describes an author-supplied adjacency. **A guide sentence that a construct *can* be configured is not a statement that the engine does it unasked** — and the entry itself named the corpus map that could not distinguish the two readings, which was the signal to run this before shipping the rule rather than after.

---

## BUG-009 — the land-origin cross is applied in map coordinates; measured, it is relative to the borders

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 1). **Area:** `src/preview/generator/lands.ts` (neutral origin rejection sampling), `docs/preview-design.md` Sec.6.1 and Sec.15 item 26. **Found:** 2026-08-11, `RMSTEST_51`, nineteen generations.

**What landed.** `crossRegion`/`insideCross` compute the centre and both half-widths from the inclusive border rectangle; `neutralOrigin` and `sampleReservoir` share them, the second deliberately taking the BORDER box rather than the origin-neighbourhood box it samples from, or the region would follow the land instead of the borders. The unbordered case is preserved by construction and pinned by the pre-existing test, which computes the cross the old map-frame way on purpose. New bordered test asserts origins reach the box's middle and that at least one lands where the map frame forbids; mutation-tested by passing map coordinates, confirmed red, reverted.

**Symptom.** A `create_land` carrying borders has its origin drawn from an L-shaped sliver hugging the inner edges of its border box, so bordered islands crowd toward the middle of the map and never reach the outer corner. Visible on `AD4 - Pag - v1.2.rms` and reported as a rendering bug.

**Measurement.** One small non-growing land, `right_border 60 bottom_border 60` on a 200 map, origin read as the snow patch centroid. The absolute model forbids `x < 65.8 && y < 65.8`; **16 of 19 centroids are inside that forbidden region.** Against the box's own centre the same cross forbids about 43% of the box (its four corners) and **0 of 19 centroids fall there**, against ~8 expected if the scatter were merely uniform. So the cross exists and is measured against the allowed region.

**Prescribed fix.** Compute the cross's centre and reference length from the border-allowed rectangle rather than from the map. Where no borders are set the two coincide, so `RMSTEST_25`'s original unbordered measurement is preserved by construction — check that explicitly, since it is the regression this change most easily breaks.

**Verification.** A test with borders asserting origins reach all four quadrants of the box; a test without borders asserting the existing measured cross is unchanged. Mutation-test by reverting to map coordinates and confirming the first goes red.

**The lesson this one carries.** The symptom was correctly diagnosed on 2026-08-07 as two individually-correct rules composing into a wrong result, and the right response was recorded then: work out the intersection and write down the run that decides the open half, rather than softening a measured rule because its consequence looks odd. That run is this one, and the composition turned out to be the wrong half — the rule itself was mis-scoped.

---

## BUG-008 — a sub-3 `min_length_of_cliff` suppresses the whole section; measured, it is a per-draw yield

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 4). **Area:** `src/preview/generator/cliffs.ts`, `docs/preview-design.md` Sec.6.3 and Sec.15 item 17(b). **Found:** 2026-08-11, `RMSTEST_45a/45b/45c`.

**What landed.** The section-level early return is gone; each cliff's rolled length is dropped below 3, so `attempted` exceeds `placed` and the six official maps that write a sub-3 minimum with a workable maximum now render cliffs. The note splits in two — "no cliffs at all" only when the maximum is also below 3, "fewer than it asks for" otherwise. Tests are the measurement's own three arms at twenty cliffs, including the `min 2 / max 4` arm a section gate cannot produce; mutation-tested by deleting the per-draw drop (2 red). **No rate was fitted from 36-against-66, per this entry's own warning.**

**Symptom.** `cliffs.ts` emits zero cliffs plus a note whenever `min_length_of_cliff < 3`, following the guide. Six official maps write 1 or 2 with a maximum of 3 or more, so all six get no cliffs at all.

**Measurement.** Two runs per arm, twenty cliffs requested, everything else identical. `min 2 / max 2` → **0** cliff units. `min 3 / max 3` → **66**. `min 2 / max 4` → **36**. Suppression predicts 0 in the third arm; a clamp predicts arms one and two matching. Neither holds.

**Prescribed fix.** Roll each cliff's length in `[min, max]` and drop the rolls below 3, rather than gating the section. The current behaviour stays correct where `max < 3` (every roll dies) but must reach that outcome through the roll, not through a section gate — the distinction is exactly what the third arm measures.

**Do NOT fit a constant from these numbers.** Cliff UNITS are not cliff COUNT: a longer cliff carries more units, so 36-against-66 conflates yield with length. If a rate is wanted, re-read with `--clusters` and count components.

---

## BUG-007 — a frameless `ignore_terrain_restrictions` empties the whole command; measured, it does nothing at all

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 2). **Area:** `src/preview/generator/objects.ts` (the whole-command gate), `src/parser/validate.ts` (RMS0315), `docs/preview-design.md` Sec.6.6. **Found:** 2026-08-11, `RMSTEST_42`, four runs.

**What landed.** The gate is gone: `ignoreTerrainInert` now only suppresses the flag's own effect and emits a drawer note, so the command runs with the restrictions it would have had anyway. RMS0315's consequence clause moved from "places nothing at all" to "this line does nothing" (the wording lives in `language.json`'s `requiresNote`, so no code changed), and both `language.ts`'s doc comment and the census file's header were corrected — the census re-derives the count on every run and reports **56 sites across 12 maps**, so the build log's 47-command figure is withdrawn rather than left to age. Two mutants, both red: the frameless flag still lifting restrictions, and the whole-command gate restored.

**Symptom.** A `create_object` carrying `ignore_terrain_restrictions` with no `set_place_for_every_player` and no `place_on_specific_land_id` is treated as placing **nothing**, and RMS0315 warns that the command is dead. It affects **47 commands across 11 corpus maps**.

**Measurement.** Three commands on one half-land half-water map, differing only in the flag and in the object's own restriction. Flagged salmon 30, unflagged control salmon 30, flagged olive trees 30. Result, identical across four runs: **60 salmon, all 60 in water; 30 olive trees on grass.** So the flagged commands placed in full (the command is not voided) and the flagged fish kept its own water restriction (the flag did not bypass anything). **The attribute is inert without a frame. The command is untouched.**

**Root cause.** The gate was inferred from `AK_Namatjira.rms` placing zero shore fish, and that map cannot discriminate: its command also names a shallow, which a shore-habitat fish cannot occupy, so the inert reading predicts zero there too. A map that produces zero is consistent with every model that produces zero. The corpus counter-argument was already written into `RMSTEST_42`'s header before the run — `find_closest` carries the identical `Requires:` line and appears 71 times frameless in working maps — and was not weighed against the gate.

**Prescribed fix.**
1. `objects.ts`: delete the whole-command gate. A frameless flag becomes a no-op plus the existing `SimulationNote`, which is what Sec.6.6's frame list already prescribes for every other member of that family.
2. RMS0315: re-scope from "this command places nothing" to "this attribute does nothing here", and drop the severity accordingly.
3. `src/parser/__tests__/rms0315.measure.test.ts` re-derives the corpus count; the 47-command figure in the build log becomes wrong and should be struck rather than left to age.
4. Add the discriminating test to `objects.test.ts`: a flagged command on an object whose own habitat excludes the target terrain must place its full count on legal ground.

**Verification.** Mutation-test the new no-op: re-enable the gate and confirm the new test goes red. The old behaviour had a test asserting it, so this is a case where a green suite asserted the defect.

**The durable lesson, and it is about the document rather than the engine.** Sec.6.6 listed this flag among the frameless-inert attributes and, forty lines later, said the bypass applies anyway. The implementation picked a third reading neither sentence contained. **When a spec states a rule twice, check the two statements agree before implementing either** — and when an attribute's behaviour is inferred from one shipped map, name what else would produce the same observation.

---

## BUG-006 — RMS0101's error severity is now unsupported: DE generates a file with an unclosed `{` at EOF

**Status:** **FIXED 2026-08-12** (CREATION_PLAN 4.8b item 8). **Area:** `src/parser/diagnostics.ts` (RMS0101), `docs/parser-design.md` Sec.10 and Sec.13 item 6. **Found:** 2026-08-11, by loading the map.

**What landed.** Severity error → warning, with the measurement written beside it in the meta table. **The allowlist arithmetic this entry warned about turned out not to bind**: `ZERO_ERROR_ALLOWLIST` is an opt-in list of eleven named files and `BCC2-Rekawa.rms` is not on it (it lives in `test-maps/broken/`), so no gate was counting on this file to contribute an error, and the corpus suite is unchanged at 129 green. `lexer.test.ts` still reads the file for offset exactness, as the entry requires. `parser.test.ts` now asserts the severity in BOTH directions — the check had only ever fired at error, so a downgrade nothing pins can drift back — and the mutant restoring `error` turns it red.

**Symptom.** RMS0101 fires at **error** severity when the token stream reaches EOF at brace depth 1. Sec.1 goal 5 reserves error for constructs "we are confident the engine rejects or mangles", and the rejection half is now refuted.

**Reproduction.** `test-maps/broken/BCC2-Rekawa.rms`, the live specimen. Its glued `}8050` at line 891 is one unknown token rather than a closing brace, so the file really does end at depth 1. Parse it and read the severity.

**Root cause.** The severity was assigned on an assumption that was recorded as an open question and carried across three revisions as TOP PRIORITY without ever being scheduled. It was settled by loading the map in DE: **it generates, with no visible problem.**

**Prescribed fix.** RMS0101 error → warning, in `diagnostics.ts` and in Sec.10's code table. `lexer.test.ts`'s offset-exactness gate reads this file and must keep doing so; check whether any corpus gate asserts RMS0101's severity before changing it, since the zero-error allowlist's arithmetic changes if this file stops contributing an error.

**Verification.** Mutation-test it: the check has only ever fired at error, so confirm the new severity is actually asserted somewhere and that the assertion goes red when reverted.

**The residual, and do not lose it in the fix.** "Generates" refutes *rejects*. It does not refute *mangles* — an unclosed block swallows what follows as attributes, so BCC2's tail may be silently inert in a map that still looks correct, which is exactly the shape of CLAUDE.md's "a shipped map is not a specification" rule. Warning is the right severity under either reading, but the note attached to the code must say "the engine does not reject this", not "this is harmless". **The run that would settle the second half:** put a distinguishable object command after the glued brace and count.

---

## BUG-005 — RMS0200 asserts engine behaviour from absence in our own data

**Status: CLOSED 2026-08-13.** Piece 1 (wording) was done 2026-08-02, piece 3 DROPPED 2026-08-05, and **piece 2 shipped 2026-08-13**: corpus RMS0200 **858 → 277**, all 21 true positives unchanged, and the two RMS0201 sites parked here from BUG-003 closed with it (**22 → 20**). **Area:** `src/parser/parser.ts` (`parseNamedOrRun`, `aliasedCommand`, `stopSetAt`), `reference/data/language.json` (`CommandDef.tokenId`, `ArgumentDef.acceptsKnownName`), `docs/parser-design.md` Sec.2.1 item 4. **Found:** 2026-07-31 parser audit. **Instrument:** `src/parser/__tests__/rms0200.measure.test.ts` re-derives every number in this entry; run it rather than quoting them.

**What shipped, and the fork that was decided.** The id lives as an optional `tokenId` on `CommandDef` in `language.json`, not in the specced `reference/data/token-aliases.json`. It is a spec deviation, escalated rather than improvised, and parser-design Sec.2.1 and CREATION_PLAN A.2 carry the amendment. The reasoning is that `game-constants.json` already stores this same engine integer as `constId` **on the constant row** — `validate.ts` reads it that way for RMS0111's id 69 — so the id is an attribute of the thing it names, and a join table for one row would have cost a file, a schema, a loader and a join while splitting one flat namespace across two shapes. `CommandDef` also already carried `sectionLocked`, an optional engine-*measured* field with the same cite-the-run discipline. `validate:reference` now rejects a duplicate `tokenId` and a `tokenId` with no `notes` naming its run; both halves were mutation-tested.

**The measurement that priced the rest of this entry, and it contradicts what the entry said was the bigger question.** `rms0200.measure.test.ts` now also reports the **unknown commands that OPEN A BLOCK**, which is the only construct the merge model can act on. Before the fix: **581, every one of them `L`**. After: **0**. Swept across the whole 292-file DE install the same population is `L` in `24hr_Petra.rms` (384) plus `AL`/`AX` in our own two RMSTEST scripts, and nothing else. So the merge question governs no shipped map once the alias resolves. See the correction below before scheduling `RMSTEST_63`.

**Symptom (as originally found, 2026-07-31 — the no-suggestion half is now fixed).** An unrecognised name drew `Unknown command "X" — the engine will silently ignore it.` The second clause is a claim about what the engine does, and its entire evidence was that the name is missing from `language.json`. **Today that wording survives only on the did-you-mean branch** (272 of 858 corpus hits), deliberately and after review — see piece 1. The 586 with no suggestion now report the observation only.

That was the exact thing CLAUDE.md's two hard rules forbid. **Reference data is a positive resolver, never a negative authority** was established by the `validate()` session and applied throughout `validate.ts`; RMS0200 predated it and had never been revisited, so the rule held in the semantic pass and was violated in the syntactic one — **that half is now closed.** ~~RMS0202's `unresolvedConstantInNumericSlot` has the same shape … it is the remaining instance of the same defect.~~ **WITHDRAWN 2026-08-05. It is not the same defect, and the message stays as written.** The two rest on different evidence. RMS0200's old wording was indefensible because its evidence was absence from `language.json`, a reference file we control and know to be incomplete. RMS0202's evidence is absence from **the author's own file**, which we read completely, and it only fires when that file has no includes (`diagnostics.ts:374` already softens the include case to info). Reporting a scan of a closed set is a positive observation, not a negative authority. Do not "fix" this.

**Measurement (all 52 corpus files, 2026-07-31).** RMS0200 fires **858** times — the single largest diagnostic source in the tool, ahead of everything `validate()` emits combined (273). Composition:

| Count | Text | Verdict |
|---:|---|---|
| 581 | `L` | Sec.2.1 token-ID aliasing. `24hr_Petra` and `24hr_Holler` write `#const L 32 /* Defining Land Creation Command */` then use `L { … }` as a command. Spec-sanctioned v1 limitation, not a defect — but the map works and we warn 581 times. |
| 256 | `avoidance_distance` | ~~**False.** See BUG-004.~~ **Corrected 2026-08-01 — not demonstrably false; treat as UNDETERMINED.** BUG-004 was closed as not-a-bug (`parser-design.md` Sec.13 item 5, write-up in the build log): all 320 install-wide uses are one copy-pasted template and every one passes a constant defined as `0`, which no shipped script can distinguish from a token the engine discards. Note the awkward implication for piece 1 below — the clause "the engine will silently ignore it" is plausibly **accurate** on the check's single largest input. |
| 21 | `enable_balanced_elavation`, `number`, `clumping`, `relics`, … | **True positives**, and good ones — real typos and mangled lines in real maps. |

So roughly 2.5% of the volume is the signal the check exists for. **That 2.5% is itself now suspect** — it counted the 256 `avoidance_distance` warnings as false, and closing BUG-004 makes them undetermined. If they are correct warnings the figure is nearer 32%. The number is left as measured rather than silently re-derived, because the point below is that the ratio was never the right thing to reason from.

**That ratio does not generalise, and the fix below should not lean on it. Re-measured over the 276-file DE install, 2026-08-01:** 952 RMS0200 warnings, of which **~59% are true positives** — `set_loose grouping` written with a space 457 times across three Battle Royale maps (none of which contains a single correct `set_loose_grouping`), `set_scale_by_group` singular 96 times in `includes/water_blending.inc` (which uses the correct plural 47 times in the same file), plus ten single-site typos including `acoid_actor_area` ×5 in `includes/capture_relic.inc`. The 2.5% figure was a property of *that* corpus — expert community maps where the noise is `L`-aliasing and the one missing attribute — not of the check. Piece 1 of the fix (drop the behavioural claim, keep confident wording where a did-you-mean fires) is right either way and is what found all 563: every one of them carries a suggestion. Piece 3 (soften to info when the file has any `#include_drs`) would have **buried the `capture_relic.inc` and `water_blending.inc` findings**, since include-heavy files are exactly where the shared-template typos live. Reconsider it.

**Prescribed fix (needs a decision, do not improvise).** Three separable pieces:

1. ~~**Wording, unconditional.**~~ **DONE 2026-08-02.** The no-suggestion branch now reads `Age of RMS doesn't recognise the <context> "X".` and makes no claim about the engine; the did-you-mean branch keeps the confident wording. `src/parser/diagnostics.ts:unknownName`, plus two assertions in `parser.test.ts` that pin the split — **mutation-tested**: reinstating the old string turns the no-suggestion assertion red with a readable message, so the check has been seen to fail on the defect it exists to catch. Re-measured over all 52 files with `src/parser/__tests__/rms0200.measure.test.ts`, which reproduces this entry's 858 exactly and is kept as the repeatable instrument.

   | | count | effect |
   |---|---:|---|
   | with did-you-mean | 272 | keeps the behavioural claim |
   | without | **586** | now reports the observation only |

   **The measurement found something the fix's own rationale did not survive, and it should be settled before piece 2 or 3.** Piece 1 justified keeping the confident wording on the grounds that a did-you-mean is "positive evidence of a typo". Over the corpus that branch is **256/272 `avoidance_distance`** — the one name BUG-004 closed as *not* a typo and explicitly undetermined, matched by *suffix* against `other_zone_avoidance_distance` rather than by edit distance. So the retained behavioural claim is now concentrated almost entirely on the single case we decided we cannot judge, which is close to the inverse of what the rationale describes. The 581 `L` warnings, where the claim was least defensible, are correctly softened. **DECIDED 2026-08-02: leave it as it is.** Two follow-ups were offered (restrict the confident wording to edit-distance matches only; or drop the behavioural clause from both branches) and both are declined. The reasoning is that a suffix match to `other_zone_avoidance_distance` is *useful output* whatever `avoidance_distance` turns out to be — **naming a plausible alternative beats saying nothing** — and the cost of being wrong here is a suggestion the author ignores, not a broken map. Do not reopen this without a new observation; the ratio alone is not one. Note it is the *third* time `avoidance_distance` has distorted a conclusion in this file, and the standing lesson is to treat any argument leaning on it as suspect by default — but "suspect" means check it, not suppress it.
2. **The `L` case. DECIDED 2026-08-05: do nothing until the token-ID table lands. Deferred, not rejected.** — **RE-SCOPED 2026-08-12, and the deferral rested on a premise nobody had counted. This needs ONE id, not the sheet.**

   The 2026-08-05 decision reads as "tier 2 requires `token-aliases.json`, which requires the equivalencies sheet, which is JS-rendered", and that chain has held the bug for a week. Measured instead of assumed: **all 581 warnings are one idiom in two files**, `#const L 32` in `24hr_Petra.rms:6` and `24hr_Holler.rms:248`, and a sweep of every `#const NAME <number>` in the corpus finds **no second word used as a command**. So the population tier 2 exists to serve is a single alias. Import the sheet for CREATION_PLAN A.2's general case; do not wait on it here.

   **VERIFIED 2026-08-12: 32 IS `create_land`. The author's comment was right and the row can be written.** Two independent observations, and the first run pointed the other way, so read all three.

   | run | arms, in order | result |
   |---|---|---|
   | `RMSTEST_61` | `create_land`→DIRT, `AL`(32)→SNOW, `AX`(33)→DESERT | DIRT 6063, DESERT 6233, **no SNOW** |
   | `RMSTEST_62` | `create_land`→DIRT, `AX`(33)→SNOW, `AL`(32)→DESERT | SNOW 6043, DESERT 6191, **no DIRT** |
   | `24hr_Petra.rms` in the DE editor | its own 8 `L` blocks, no other land command | **lands generate** |

   61 alone reads as "`create_land` is 33 and 32 is inert", which would have made the 581 warnings true positives. **62 refutes it** — there 32 made a land — and Petra settles it from outside the instrument entirely: that map contains no `create_land` and no `create_player_lands`, so the lands it produces in game can only come from `L`.

   **Both histograms are then explained by one model, which is a second finding.** 32 is `create_land`, 33 is not a command, and **an unrecognised word's block MERGES into the command before it**, later value winning on a repeated attribute. In 61 that folds `AX`'s DESERT onto the SNOW land; in 62 it folds `AX`'s SNOW onto the DIRT land. Each run made exactly two lands of ~15%, and the model names which terrain vanishes in each. The rival explanation is a buried origin (Sec.15 item 30, already measured on this engine), which also loses one land but does not predict *which*. `RMSTEST_63_unknownblockmerge.rms` is written to separate them.

   **CORRECTED 2026-08-13: this was called "a bigger one" on a population that does not exist, and the 457 lines it named cannot be affected.** The claim was that the merge would reach "every unrecognised command in a real script, including the 457 misspelled `set_loose grouping` lines in DE's own Battle Royale maps". Read one: `BR_FallofRome.rms:3624` has `set_loose grouping` **inside** a `create_object { … }` block, with no braces of its own. It is a misspelled *attribute*, already sitting in the command it would supposedly merge into, and the merge model only acts on a word that OPENS A BLOCK. Measured rather than argued: `rms0200.measure.test.ts` now counts unknown commands carrying a block, and after the resolver the corpus figure is **0**; a sweep of all 292 install files finds only `L` in Petra and our own `AL`/`AX`. Exactly the instrument error piece 3's own correction records — the mechanism sounded right and nobody checked which construct the lines were.

   **`RMSTEST_63` is still worth one generation, for a reason the corpus cannot show, and it blocks nothing.** This is an authoring tool for beginners, and a beginner writing `create_lands {` is precisely the block-opening typo that 52 expert-written maps contain none of. If the merge holds, RMS0200 on a block-opening unknown command should say the block is being folded into the command above rather than merely that the name is unrecognised. **Two changes to the run before it goes** (its read-off cannot currently separate the models it names, which is the fault that already cost 61 and 62 a run each): pin both origins with `land_position` at opposite corners so a buried origin is impossible by construction, and read the surviving land's POSITION as well as its terrain — under the merge model it sits at `AX`'s position, not `create_land`'s, which is a second, orthogonal read-off from the same generation.

   **The code half is smaller than this entry implies, and the AST is why.** `CommandNode.name` is a token INDEX and `def` is the resolved `CommandDef`, so an aliased command keeps the author's `L` token for source fidelity while carrying `create_land`'s def — Breakdown renders a real editable card and RMS0200 never fires, with no re-printing and no parallel model. The work is the type (below) plus one lookup at `parser.ts:665`, where `commandsByName.get(nameTok.text)` currently decides. The type problem stands as written: `aliasTable` is implemented today as a post-lex `kind` overwrite (`parser.ts:117`), which cannot express "this word is that command".

   **DECIDED 2026-08-13: shape A. The id lives on `CommandDef`.** The table below is kept as the record of what was weighed. The argument that settled it is not in the table: `constId` in `game-constants.json` is already this same engine integer stored as a field on the row it identifies, which makes A the shape this repo has chosen once already, and `sectionLocked` shows `CommandDef` already carrying optional engine-measured fields under a cite-the-run discipline. B's one real advantage — the sheet drops in whole — is insurance against a file that has never fetched, and if it ever does it is a *source* for `tokenId` rather than a reason to move it. The spec amendment landed in the same pass, in parser-design Sec.2.1 item 4 and CREATION_PLAN A.2.

   | | shape | for | against |
   |---|---|---|---|
   | A | `tokenId` on `CommandDef` in `language.json` | The id sits with the command it describes; no new file, loader or join; `validate:reference` gets uniqueness checking almost free; "vocabulary is data-driven" already points at `language.json` | Deviates from the spec, so `parser-design.md` Sec.2.1 and `CREATION_PLAN.md` A.2 must be amended in the same pass, and CLAUDE.md's first hard rule says a spec deviation is escalated, not improvised |
   | B | `reference/data/token-aliases.json`, id → command name | Exactly what Sec.2.1 and A.2 prescribe; no spec change; the equivalencies sheet drops in as a whole file when it arrives | A schema, a loader and a join for **one row**, and the join duplicates a relationship `language.json` could express directly |

   Whichever wins, the verified content today is one row, `create_land = 32`, and **the id is the only new data** — the `L`-to-`create_land` step falls out of the symbol table the parser already builds. Note also that resolving the alias is independent of the merge question `RMSTEST_63` settles: the resolver fixes 581 warnings either way, while the merge decides whether the preview is drawing the wrong map for *unrecognised* commands, which is a separate piece of work.

   The idiom: `24hr_Petra.rms:6` writes `#const L 32 /* Defining Land Creation Command */` and then uses `L { … }` 384 times; `24hr_Holler.rms` does the same 197 times. Per Sec.2.1 the engine resolves every word to an internal token ID and constants share that ID space with commands, so `#const L 32` makes `L` indistinguishable from `create_land`. Measured 2026-08-05: 376 + 8 in Petra plus 197 in Holler = **all 581**, and every one is both a `#const` this file defines *and* followed by `{` (the 8 bare-line uses have `{` as their next non-trivia token). The proposed gate had 100% coverage of its population.

   **Two tiers were on the table and the second supersedes the first, so only the second gets built.**

   | | Rule | Result |
   |---|---|---|
   | Tier 1 | `isDefinedSymbol()` **and** next token is `{` → info | 581 warnings → info; we still cannot say *which* command `L` is |
   | Tier 2 | import `token-aliases.json` (⚠ verify #7), resolve `32` → `create_land` | 581 → **zero**, and Breakdown renders a real `create_land` card with editable attributes instead of an unknown-command card |

   Tier 1 buys a severity change and no information. Tier 2 makes the maps actually work in the editor. Building tier 1 first means writing a message, a spec amendment and a test that tier 2 deletes.

   **BUILT 2026-08-13 as tier 2, and the row's "import `token-aliases.json`" is what changed** — the resolve step is as described and the storage is `CommandDef.tokenId` (see the decision above). 581 → **zero**, and `L { … }` now renders as a real `create_land` card. `ParseOptions.aliasTable` was never touched: it is `ReadonlyMap<string, TokenKind>`, it could not have expressed a word aliasing a command, and it turned out not to be on the path at all — the resolution needs the script's own symbol table, which the parser already builds, plus one index over the data. The option keeps its original *structural* scope (`MILL` closing a block), which no tracked map uses.

   **Three narrowings in the shipped resolver, each deliberate and each pinned by a test:** `#const` only and never `#define`; first definition wins and a definition BELOW a use cannot reach back, matching the engine's single pass; and plain decimal integer values only, so an expression falls back to RMS0200 rather than being evaluated on rules nobody has measured. A `#const` aliased to another command's NAME (`#const MY_LAND create_land`) is also not resolved — zero corpus sites.
3. ~~**Severity.** Consider info when the file has any `#include_drs`.~~ **DROPPED 2026-08-05.** It would soften **60% of the DE install** (167 of 276 files carry an `#include_drs`) and bury the true positives it was meant to protect.

   **Correcting this entry's own refutation, which named the wrong files.** It previously said piece 3 "would have buried the `capture_relic.inc` and `water_blending.inc` findings". Measured: both `.inc` files contain **zero** `#include_drs`, so the rule would never have touched them. What it *would* have buried is the **457 `set_loose grouping` hits**, since all three Battle Royale maps do carry one. Conclusion unchanged and stronger (81% of the true positives lost, not the ~18% implied); reasoning was an instrument error of exactly the family this file keeps cataloguing — the mechanism sounded right and nobody checked which files carried the flag.

   **Also settled: resolving include files would not rescue it.** The obvious objection is that once we can read includes, the softening becomes unnecessary rather than harmful. True but irrelevant here — the 457 hits are a misspelled **attribute name**, and nothing in any of the 276 files defines `set_loose` or `grouping` (checked; the BR maps include exactly one file each). A fully-resolving include reader still emits all 457. Include resolution is now tracked as a future feature in `CREATION_PLAN.md`'s additional-features section; it improves RMS0202's blind spot, not this one.

**Verification.** `npx vitest run src/parser/__tests__/rms0200.measure.test.ts` re-measures RMS0200 by code and by text over all 52 files and prints the with/without-suggestion split; the 21 true positives must survive unchanged. It is a scratch reporter, not a gate — it asserts only that the split is exhaustive — so **it is excluded from `npm test`'s floor deliberately** (`scripts/check-test-floor.mjs` sits at 17/442 against a live 24/507 so deleting this harness cannot turn the suite red).

**Piece 2's type problem is now recorded in the spec too** (2026-08-05, rev 6): `parser-design.md` Sec.2.1 previously presented `ParseOptions.aliasTable` as the upgrade hook with no caveat, so the fact that `ReadonlyMap<string, TokenKind>` cannot express a word aliasing a *command* lived only in this file. Both mentions now carry it, along with the 581/858 figure.

## BUG-003 — False RMS0201 on attributes that are legal with no argument

**Status: CLOSED 2026-08-05 at a regression baseline of 32, RE-BASELINED TO 22 on 2026-08-12** when row 10 below was settled in game and `showType` became `optional: true` (CREATION_PLAN 4.8b item 6), **and TO 20 on 2026-08-13** when BUG-005 piece 2 closed the two sites this triage parked there. Corpus RMS0201 went **69 → 35 → 32 → 22 → 20**. All 35 remaining warnings were triaged individually **against the guide**; **20 are true positives**, 10 are **UNDETERMINED and deliberately still warn**, and 2 are a *different* defect (Sec.6 stop set meeting Sec.2.1 aliasing), parked on the BUG-005 piece 2 decision rather than fixed here. Only 3 turned out to be genuine false positives, and all three were in our own fixture. **Area:** `reference/data/language.json` (data, not code) — though in the end no `language.json` change survived. **Instrument:** `src/parser/__tests__/rms0201.measure.test.ts` re-derives every number below — run it rather than quoting them.

**The baseline is 20, not 0. (Was 22 until 2026-08-13.)** A change that takes corpus RMS0201 below 20 without a written verdict per site has started suppressing real map bugs, which is exactly the failure mode this entry and BUG-002 both walked into from the other direction. It has moved twice, both times on a written verdict and never on a count: 32 → 22 when a run in the game settled a site the triage had deliberately left warning, and **22 → 20 on 2026-08-13** when BUG-005 piece 2 closed the two `#const` sites row 3 of the triage below had already parked there — `24hr_Battle Lines 1.0.rms:93`'s `#const restricted_terrain_distance max_distance_to_other_zones` is correct RMS under Sec.2.1's aliasing, and Sec.6's stop set was reporting the author's own line twice.

**Read this before touching the data: the first attempt at closing this bug got it wrong, and the way it got it wrong is the whole lesson.** `ai_info_map_type.showType` was marked `optional: true` on 2026-08-05 and reverted the same day. The evidence was 52 three-argument uses across 52 distinct DE-official files with 20+ distinct map types — genuinely independent, not a copy-paste artefact, and it still did not survive. **Official DE maps contain bugged lines; the engine passes them silently, the affected code never takes effect, and nobody finds out.** guide:475 lists `showType` **not functional on DE**, so writing it and omitting it are indistinguishable in game, and no shipped script could ever have revealed which form is correct. A frequency count only counts when a wrong answer could have been *observed*. Both halves are now CLAUDE.md Hard rules.

### Triage of all 35 (2026-08-05)

| Count | Name | Site | Verdict |
|---:|---|---|---|
| 10 | `ai_info_map_type` | 10 maps, 8 of them DE-official | **SETTLED 2026-08-11 — the argument IS omissible. Arity is THREE.** `RMSTEST_54a` put the three-token form immediately before `<LAND_GENERATION>`, so a fourth-argument engine would swallow the section header and leave the map blank; `54b` is the same file without the line. **Both came back fully snow**, so the header survived and nothing was eaten. **APPLIED 2026-08-12**: `showType` carries `optional: true`, the warning is gone on all 10 maps, and the corpus census re-measures at **22** (`.rms`) plus 3 (`.rms2`). `parser.test.ts`'s pin was inverted from "still warns" to "is legal" with the measurement written into it. **Note this reaches the same conclusion the 2026-08-05 attempt did, by evidence that attempt could not have had** — the rule that killed it (no shipped script could distinguish the two forms, because the argument is non-functional in play) is exactly why an in-game *token-consumption* test was needed rather than another headcount. The Hard rules stand; the data changes. |
| 2 | `create_terrain` | `sample.rms:50,56` | **OUR OWN FIXTURE WAS WRONG — FIXED.** guide:1437's signature is `create_terrain TerrainType { Attributes }`; the fixture also used `terrain_type` (a land-generation attribute absent from the terrain-generation list) where `base_terrain` belongs. |
| 1 | `create_elevation` | `sample.rms:41` | **OUR OWN FIXTURE WAS WRONG — FIXED.** guide:1174's signature is `create_elevation MaxHeight { Attributes }`. Note the fix stands on the fixture being a no-op demo, not on a claim that the bare form is illegal — `MaxHeight` carries `(default: 0 - not elevated)` and is untested either way. |
| 15 | `#const` | `24hr_Mont Saint Michel.rms:93-107` | **TRUE POSITIVE, keep.** `#const SIZE` carries no value: the line reads `#const SIZE<tab>#const MAPSIZE 80`. One copy-pasted pattern repeated 15 times, so it is *one* observation. |
| 3 | `number_of_clumps` | `TC2 - Comeer v1.4.rms:193-195` | **TRUE POSITIVE, keep.** `number_of_clumps beach_terrain ICYSHORE 4056` — the clump count was dropped in a paste. Lines 191-192 of the same file are well-formed. |
| 1 | `number_of_objects` | `TL Cape of Storms.rms:1539` | **TRUE POSITIVE, keep.** Value omitted inside the `elseif LUDIKRIS_MAP` branch, which is why it shipped. |
| 1 | `terrain_cost` | `TL Grand Bara.rms:1617` | **TRUE POSITIVE, keep.** `terrain_cost 10` is missing its **leading** `TerrainType`, which guide:1925's signature makes required and gives no default at all. (718/718 install uses pass two arguments — corroboration only; the verdict rests on the guide.) |
| 2 | `#const` + `max_distance_to_other_zones` | `24hr_Battle Lines 1.0.rms:93` | **FALSE POSITIVE, different cause — FIXED 2026-08-13 under BUG-005 piece 2.** See below. |

**The last row is the one to read.** Under a `/* parameter renames */` comment the author writes `#const restricted_terrain_distance max_distance_to_other_zones`, aliasing one name to another by token ID. That is the **same Sec.2.1 idiom as BUG-005's `L`**, and it fires here for a third reason again: `max_distance_to_other_zones` is a known attribute, so it is in the Sec.6 stop set, so `#const`'s value consumption terminates before reaching it — then the orphaned attribute parses on its own and draws the second (info) diagnostic. `optional` cannot fix it, and patching the stop set is a Sec.6 change. **It moves to BUG-005 piece 2's decision — same principle, different code path.** The shared principle is that a `#const` may alias *any* name, so a known name in an unexpected position may be an alias rather than a mistake. The implementations diverge: `L` is an unknown word at statement position followed by `{` (RMS0200, Sec.5.4), while this is a known attribute name landing in `#const`'s value slot and terminating consumption (RMS0201, Sec.6 stop set). Ruling on the principle governs both; the two fixes are still separate edits.

**FIXED 2026-08-13, in the same pass that ruled on the principle, and the fix is narrower than "patch the stop set".** A new optional `ArgumentDef.acceptsKnownName` drops the known-name half of Sec.6's stop set for the one slot that declares it, which today is `#const`'s value and nothing else. The structural half never yields — a valueless `#const` still stops at the next brace, section header, directive or control keyword, or it would swallow the header after it and take the rest of the file. **Deliberately not derived from `type: "otherConstant"`**, even though every alias target has that type: 15 other slots share it, and on `effect_amount.attribute` or `assign_to.target` a known name really is a mangled line that must still stop. Three tests pin it in both directions, and a mutant that lets `acceptsKnownName` reach the structural half turns the "cannot eat the file" test red.

**Two general results worth keeping.**

1. **Omissibility comes from a guide sentence, never from a `default:` notation, and never from a headcount of shipped maps.** All five arguments correctly flagged on 2026-07-31 carry explicit prose ("**No argument**, or a value of 0 imposes no further restrictions", guide:2719). `showType` carries only `(default: 0)`, and the attempt to promote that to omissibility using 52 shipped uses is the mistake described above. `terrain_cost`'s `Cost` also carries a default and is not omissible. **A `default:` with no sentence beside it means UNDETERMINED — which means leave the data alone and write down why, not go looking for a count.**
2. **`test-maps/sample.rms` was invalid RMS and sat in `ZERO_ERROR_ALLOWLIST` the whole time**, because that gate checks zero *errors* and RMS0201 is a warning. A hand-written Phase 1.4 highlighting fixture had never been read by the parser it predates. Worth a glance at any other Phase-1-era fixture.

**Adjacent gap found while triaging, not filed as a bug yet:** the parser does not check that an attribute belongs to its enclosing command. `terrain_type` inside a `create_terrain` block drew nothing, though the guide's terrain-generation attribute list has no such entry. Same family as the RMS0304 section-lock check, and it needs the same treatment (measured per-command data, not a blanket rule). **RMS0304 shipped 2026-08-10 built exactly that way, so there is now a worked precedent to copy**: an optional flag on the def, set only where an in-game run measured it, silence everywhere it is unset, and a measure test that keeps the rejected blanket-rule count visible next to the shipped one.

**Two corrections to this entry's original framing, both worth keeping because they were instrument errors, not analysis errors.**

1. **It is not mainly about *trailing* arguments.** The dominant cause is single-argument attributes that are legal written bare, where the guide says so explicitly: guide:1693 "Defaults to 13, if you specify the argument but omit the distance" (`set_avoid_player_start_areas`), guide:2565 and guide:2581 "Defaults to 1 if you specify…" (`avoid_forest_zone`, `avoid_cliff_zone`), guide:2719 "**No argument**, or a value of 0 imposes no further restrictions" (`require_path`), guide:2312/2315 where presence alone forces objects onto the land (`avoid_other_land_zones`). The first candidate scan required `len(arguments) >= 2` on the theory that only a trailing argument can be omitted, which excluded every single-argument attribute — i.e. all five of the real cases. **When a sweep returns suspiciously few candidates, check the filter before believing the result.**
2. **"Has a `default` → is optional" is not safe, and the data proves it.** `terrain_state` declares defaults on *all four* arguments, so a mechanical rule would mark the **first** argument of a four-argument command optional. Guide:608 ("just set the first three numbers to 0 if you use this command") means those defaults describe values, not omissibility. `guard_state` is the same shape. Neither appears in any of the 215 scripts checked (33 corpus + 182 official), so both were left alone.

**The `#const` bucket's original guess was right, and it was two different things.** The 2026-07-31 note read "almost certainly not optionality — more likely the Sec.6 stop set terminating consumption early. Investigate before touching data." Both halves held: all 16 are the stop set, and they split 15 true positives (Mont Saint Michel's valueless `#const SIZE`) against 1 false positive (Battle Lines' token-ID alias). Nothing in that bucket was ever an `optional` question, and sweeping it would have silenced 15 real map bugs.

**The headline count was 27 and is 35** — a third instrument error in the same family as the two below, and the same one the build log caught in the corpus gates. The original sweep walked only the 33 tracked maps, so every diagnostic in the 19 gitignored DE-official scripts under `test-maps/local/` was invisible; `ai_info_map_type` alone goes 2 → 10 once they are counted. Nothing regressed, the instrument was reading half the corpus. **Any RMS-count claim in this file must state which half of the corpus it was taken over.**

**Symptom.** `circle_radius 33` draws `RMS0201 "circle_radius" expects 2 arguments but only 1 was found.` The single-argument form is legal and complete: guide:847 documents the second argument as `Variance - number (default: 0)`.

**Reproduction.** Parse any script containing `create_player_lands { circle_radius 33 }`. Live on the tracked corpus — three maps write a bare single-argument `circle_radius`: `24hr_Mont Saint Michel.rms`, `AD4 - Ra.rms`, `TL Grand Bara.rms`. Four of the six RMSTEST maps trip it.

**Root cause.** Not a parser defect. `Parser.consumeArgs` already honours the flag — `src/parser/parser.ts:860` reads `if (!argDef.optional)` before reporting, so an argument marked optional is skipped silently. The flag is simply never set in the data: `language.json`'s `circle_radius.arguments[1]` (`variance`) carries `"default": 0` but no `"optional": true`. This is the still-open `optional`/`variadic` schema item from parser-design Sec.13 item 4.

**Prescribed fix, as executed.** Data only, no parser change and no schema change.

1. ~~Confirm `reference/schemas/language.schema.json`'s `$defs/argument` permits `optional`.~~ **It already did** (`language.schema.json:133`). The type side (`ArgumentDef.optional` in `src/parser/language.ts`) and the parser side (`src/parser/parser.ts:860`) were both already in place. This step was a no-op from the day it was written.
2. ~~Sweep `language.json` for every argument that carries a documented `default` in a *trailing* position.~~ **Do not sweep.** See result 1 above: a documented default did not predict omissibility in either direction. Every flag set here was set per-name against the guide *and* against install usage.
3. `npm run validate:reference`, then re-measure. Both done; suite green at 19 files / 446 tests.

**Verification.** `npx vitest run src/parser/__tests__/rms0201.measure.test.ts` prints every RMS0201 with file, line, name and source line, split by `.rms` (the 52 the corpus quotes) and `.rms2` (5 more, excluded from `corpus.test.ts` by design — they carry 3 further true positives in `local/lombardia.rms2:166-168`, three valueless `#const`s). Like the RMS0200 harness it is a reporter, not a gate, and is excluded from the test floor deliberately.

The real gate is five assertions in `parser.test.ts` ("RMS0201 optional-argument triage"), pinned in **both** directions: `require_path` proves the `optional` mechanism still works on a case the guide states outright, `terrain_cost` and `create_terrain` prove a missing required argument still warns, and `ai_info_map_type`'s three-argument form is pinned **as a warning** with a comment recording that it is undetermined and must only ever be changed from a game measurement, never from a recount of shipped maps.

The mechanism itself was **mutation-tested** while the `showType` flag was briefly in place — removing it turned the legal-omission assertion red with a readable message while the counter-tests stayed green, so the check has been seen to fail on the defect it exists to catch. The flag was then reverted, so what the suite pins today is the undetermined state.

**Watch the regex when filtering corpus output** — the first attempt at this measurement used `RMSTEST_[0-9]_[a-z]+\.rms` and silently dropped every diagnostic from `RMSTEST_2_circle0.rms`, because `circle0` contains a digit. That produced a phantom "the parser is silent on `circle_radius 0`" finding which does not exist.

~~**Related, and NOT a bug:** `circle_radius 0` … decide whether to widen the declared min to 0 or to special-case the sentinel.~~ **RESOLVED 2026-08-04, before this entry closed.** `radiusPercent` was widened to `min: -50` after RMSTEST_27 measured negative values as a third distinct behaviour, so RMS0203 no longer fires on `circle_radius 0` and the decision this paragraph asked for has been made. Kept struck rather than deleted because the paragraph was still being quoted as open on 2026-08-05.

---

## BUG-002 — CLOSED 2026-08-02. Both remaining "false" RMS0202 causes were true positives

**Status:** closed, not-a-bug, both halves. **Found:** while fixing the `#const`-in-numeric-slot report (parser-design Sec.6 amendment — that fix is done and is *not* what this entry was about). **Area:** `reference/data/language.json`, `src/parser/parser.ts`.

After the Sec.6 amendment the 52-file corpus emitted **238 RMS0202 warnings + 75 info**. A third cause — `#const X ANOTHER_CONSTANT` aliasing, fixed by retyping `#const`'s `value` slot `integer` → `otherConstant` — brought that to **61 warnings + 45 info**, confined to just 3 files (see build-log, "RMS0202 false-warning campaign", for that fix and its evidence). Two causes were filed below as what remained.

**Both have since been closed as correct warnings.** (b)'s 35 are unexpanded preprocessor variables in maps that ship broken at those lines; (a)'s 26 are one author's accidentally deleted `#const`. **RMS0202's remaining corpus output is 61 warnings and, as far as anything here shows, all of them are right.** No parser change, no data change, no new argument type.

**The pattern across both, and it is the third instance in one session.** Each half was filed as a false positive on evidence that was really one observation wearing a plural — 35 occurrences that are 3 copy-pasted template sites, 26 occurrences of a single name in a single file. Both then attracted a *mechanism* (DE templating syntax; Sec.2.1 token-ID aliasing) plausible enough to survive review, because a mechanism that explains the data feels like evidence for it. Neither had ever been checked for independence, and neither needed the game to refute — one needed a look at the file headers, the other needed asking the author. Same family as `avoidance_distance`'s 320 uses.

### (a) Undefined words used deliberately as opaque identifiers — CLOSED 2026-08-02, evidence withdrawn

**Not a bug. The 26 warnings are true positives, and the premise was one author's accident.**

The original claim: `AK_Vanguard_v1.2.rms` uses `actor_area ACT_AREA_TEAM_RES_TERRAIN` 26 times, never defines it, has no includes, and ships and works — so per Sec.2.1 both sides of the pair resolve to the same token ID and the name is a deliberate self-documenting handle. That reading required `integer` to be splitting two concepts, and an `identifier` argument type was designed, approved and half-built on it.

**AK_Vanguard's author recalls no such idiom — they recall being confused that something did not work, and probably deleting the `#const` by accident. The file corroborates that and refutes the idiom reading.**

- Lines 35-37 are a contiguous, blank-line-delimited block of exactly **three** `ACT_AREA_*` constants. The file uses **four** names from that scheme. `ACT_AREA_TEAM_RES_TERRAIN` is the one missing from the block it plainly belonged in.
- Every other actor-area identifier in the map is either a `#const` or a bare number — `ACT_AREA_MIDDLE_MED` 6756, `ACT_AREA_MIDDLE_LARGE` 6757, `ACT_AREA_NOBUILD_AROUND_TEAM_RES` 42, `ACT_AREA_AVOID_TEAM_RES_AREA_MED` 77 (defined at line 1258, eight lines above its use), plus 41, 39, 9000, 9056, 1500, 1510, 6103, 6200. One name out of twelve is undefined.
- Line 1434 carries a **commented-out** `avoid_actor_area` line, so that exact region was being hand-edited when the loss happened.
- "It works" was never observed, only inferred from the map having shipped. The author's memory of a workaround is direct evidence against it.

**The two other candidate files cannot rescue the item.** `Rage Forest 2026.rms` (`house3`, `straggler2`) and `Pa_Site_v1.1.rms` (`GOLD_*_PLACEMENT_ID`) both carry `#include_drs`, so those names may simply be defined in packed includes we cannot read. Neither is scoreable either way, and RMS0202 is already softened for include-bearing files.

**Prescribed fix: none.** The `identifier` type was reverted from `language.ts`, `language.schema.json`, `formatStyle.ts` and `validate.ts` the same day. `create_actor_area`'s data fix was kept, because guide:1982 sources it independently of any of this.

**What survives, and is worth keeping:** the sweep found that identifier-likeness would be per-**argument**, not per-command — `create_actor_area X Y Identifier Radius` has three magnitudes and one handle. If this ever reopens on real evidence, that is the shape, and the four slots are `create_actor_area` arg 2 plus `actor_area`/`actor_area_to_place_in`/`avoid_actor_area` arg 0. What would count as real evidence: a bare-word actor-area identifier in a map with **no includes**, from an author who did not lose a `#const`.

### (b) `$`-prefixed names — CLOSED 2026-08-02, and the answer inverts the entry

**Not-a-bug, and not in the direction this entry assumed: these 35 warnings are TRUE POSITIVES.**

`$` is not RMS syntax and never was. It is the substitution sigil of an external preprocessor the authors build their scripts with, and every site below is one where the substitution never happened before the file shipped. The lexer is whitespace-delimited, so `$heightLow` arrives as an ordinary `word`; per Sec.2.1 the engine resolves it to some token ID and the numeric slot receives a meaningless magnitude. The files are broken at these lines. RMS0202 is doing exactly its job.

**The original evidence was an independence failure** — the same shape as `avoidance_distance`'s 320 uses, and the checks that would have caught it are the ones CLAUDE.md already mandates.

- **35 occurrences are 3 sites.** `height_limits $heightLow $heightHigh` ×8 and `set_avoid_player_start_areas $SpawnAvoidance` ×9 in Acclivity; `number_of_objects $infinite` ×10 in TL Team Acropolis. Each is one block repeated per player or per distance band. Three observations, not thirty-five.
- **"Official *and* community" is one ecosystem, not two independent ones.** Acropolis's header reads "modifed by Zetnus" — the author of the guide this project transcribes — and Acclivity is by Chrazini. Both open with the same `#define THEME_AUTUMN` / `#define COLLAPSE` template vocabulary. Co-occurrence across the two says the authors share a toolchain, which is precisely what a preprocessor artefact predicts and not what engine support predicts.
- **Acclivity's header carries a second version stamp its own versioning does not explain**: `Version: 2.6` on one line, `BSV: 9.1.1` two lines below it. A file recording the version of the thing that built it is a build artefact.
- **The names are not RMS house style.** `heightLow`, `SpawnAvoidance`, `infinite` are camelCase where RMS constants are SCREAMING_SNAKE, and `$infinite` is a symbolic stand-in for a *number* — something RMS has no way to express, and a preprocessor has every reason to.

**Prescribed fix: none.** No parser change, no data change, no new argument type. The message already states what is observed and asserts no cause (`"$infinite" doesn't look like a valid integer for "number_of_objects"`).

**Rejected: a dedicated "unexpanded template variable" diagnostic.** Three sites in two files from one toolchain is too thin to earn a code, and the message would assert something about an authoring pipeline seen only indirectly. Revisit if `$` appears in a map from an unrelated ecosystem.

### Verification

`npm test` (parser suites), plus re-measure the corpus RMS0202 counts before/after — a scratch script parsing every `test-maps/**/*.rms` and bucketing by code and severity is the quickest instrument. **Current baseline: 61 warnings + 45 info across 52 files**, being 26 from (a) in AK_Vanguard and 35 from (b) in Acclivity + TL Team Acropolis. Zero from any other file.

**The target is 61, not 0.** Both causes are closed as correct warnings, so this is no longer a number to drive down — it is a **regression baseline**. All 61 must survive: 35 in Acclivity + TL Team Acropolis (unexpanded preprocessor variables) and 26 in AK_Vanguard (a deleted `#const`). A change that takes corpus RMS0202 below 61 has started suppressing real findings, which is the failure mode this entry spent three rounds walking toward.

**Re-derived 2026-08-05: still 61 + 45. The spec had not caught up, and that was the live risk.** `parser-design.md` Sec.6 went on describing both causes as "noise", calling (a) "evidence that `integer` wrongly conflates a magnitude with an identifier" and (b) "supported syntax we don't yet model" — i.e. it still named the `identifier` schema change that was designed on the withdrawn reading and reverted the same day. In a document headed "do not deviate from this spec", a stale paragraph that names work to do is worse than one that merely describes the past. Rewritten in rev 6, with the 61 recorded there as a floor.
