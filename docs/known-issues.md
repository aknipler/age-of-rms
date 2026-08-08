# Known issues — Age of RMS

Open bugs with diagnosis and prescribed fix. One `##` section per bug. Move an entry to `docs/build-log.md` (as part of the session entry that fixed it) once it's closed — don't leave stale "fixed" entries here.

Entry format: symptom → reproduction → root cause (with file:line) → prescribed fix → verification.

---

## BUG-005 — RMS0200 asserts engine behaviour from absence in our own data

**Status:** open — **piece 1 (wording) is DONE and decided; pieces 2 and 3 remain**, and both are spec/severity calls rather than wording. **Area:** `src/parser/diagnostics.ts:315` (`unknownName`), `docs/parser-design.md` Sec.10. **Found:** 2026-07-31 parser audit. **Instrument:** `src/parser/__tests__/rms0200.measure.test.ts` re-derives every number in this entry; run it rather than quoting them.

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
2. **The `L` case. DECIDED 2026-08-05: do nothing until the token-ID table lands. Deferred, not rejected.**

   The idiom: `24hr_Petra.rms:6` writes `#const L 32 /* Defining Land Creation Command */` and then uses `L { … }` 384 times; `24hr_Holler.rms` does the same 197 times. Per Sec.2.1 the engine resolves every word to an internal token ID and constants share that ID space with commands, so `#const L 32` makes `L` indistinguishable from `create_land`. Measured 2026-08-05: 376 + 8 in Petra plus 197 in Holler = **all 581**, and every one is both a `#const` this file defines *and* followed by `{` (the 8 bare-line uses have `{` as their next non-trivia token). The proposed gate had 100% coverage of its population.

   **Two tiers were on the table and the second supersedes the first, so only the second gets built.**

   | | Rule | Result |
   |---|---|---|
   | Tier 1 | `isDefinedSymbol()` **and** next token is `{` → info | 581 warnings → info; we still cannot say *which* command `L` is |
   | Tier 2 | import `token-aliases.json` (⚠ verify #7), resolve `32` → `create_land` | 581 → **zero**, and Breakdown renders a real `create_land` card with editable attributes instead of an unknown-command card |

   Tier 1 buys a severity change and no information. Tier 2 makes the maps actually work in the editor. Building tier 1 first means writing a message, a spec amendment and a test that tier 2 deletes. **The 581 warnings stay as they are until `token-aliases.json` is imported.**

   Note `ParseOptions.aliasTable` as currently specced is `ReadonlyMap<string, TokenKind>`, which covers a word aliasing a *structural* token (`MILL` closing a block). `L` aliases a **command**, so the tier-2 work needs the type to cover both shapes — it is not a drop-in. Also unverified: that `create_land`'s token ID is in fact 32. The only source for that today is the map author's own comment.
3. ~~**Severity.** Consider info when the file has any `#include_drs`.~~ **DROPPED 2026-08-05.** It would soften **60% of the DE install** (167 of 276 files carry an `#include_drs`) and bury the true positives it was meant to protect.

   **Correcting this entry's own refutation, which named the wrong files.** It previously said piece 3 "would have buried the `capture_relic.inc` and `water_blending.inc` findings". Measured: both `.inc` files contain **zero** `#include_drs`, so the rule would never have touched them. What it *would* have buried is the **457 `set_loose grouping` hits**, since all three Battle Royale maps do carry one. Conclusion unchanged and stronger (81% of the true positives lost, not the ~18% implied); reasoning was an instrument error of exactly the family this file keeps cataloguing — the mechanism sounded right and nobody checked which files carried the flag.

   **Also settled: resolving include files would not rescue it.** The obvious objection is that once we can read includes, the softening becomes unnecessary rather than harmful. True but irrelevant here — the 457 hits are a misspelled **attribute name**, and nothing in any of the 276 files defines `set_loose` or `grouping` (checked; the BR maps include exactly one file each). A fully-resolving include reader still emits all 457. Include resolution is now tracked as a future feature in `CREATION_PLAN.md`'s additional-features section; it improves RMS0202's blind spot, not this one.

**Verification.** `npx vitest run src/parser/__tests__/rms0200.measure.test.ts` re-measures RMS0200 by code and by text over all 52 files and prints the with/without-suggestion split; the 21 true positives must survive unchanged. It is a scratch reporter, not a gate — it asserts only that the split is exhaustive — so **it is excluded from `npm test`'s floor deliberately** (`scripts/check-test-floor.mjs` sits at 17/442 against a live 24/507 so deleting this harness cannot turn the suite red).

**Piece 2's type problem is now recorded in the spec too** (2026-08-05, rev 6): `parser-design.md` Sec.2.1 previously presented `ParseOptions.aliasTable` as the upgrade hook with no caveat, so the fact that `ReadonlyMap<string, TokenKind>` cannot express a word aliasing a *command* lived only in this file. Both mentions now carry it, along with the 581/858 figure.

## BUG-003 — False RMS0201 on attributes that are legal with no argument

**Status: CLOSED 2026-08-05 at a regression baseline of 32**, the same shape BUG-002 closed in. Corpus RMS0201 went **69 → 35 → 32**. All 35 remaining warnings were triaged individually **against the guide**; **20 are true positives**, 10 are **UNDETERMINED and deliberately still warn**, and 2 are a *different* defect (Sec.6 stop set meeting Sec.2.1 aliasing), parked on the BUG-005 piece 2 decision rather than fixed here. Only 3 turned out to be genuine false positives, and all three were in our own fixture. **Area:** `reference/data/language.json` (data, not code) — though in the end no `language.json` change survived. **Instrument:** `src/parser/__tests__/rms0201.measure.test.ts` re-derives every number below — run it rather than quoting them.

**The baseline is 32, not 0.** A change that takes corpus RMS0201 below 32 without a written verdict per site has started suppressing real map bugs, which is exactly the failure mode this entry and BUG-002 both walked into from the other direction.

**Read this before touching the data: the first attempt at closing this bug got it wrong, and the way it got it wrong is the whole lesson.** `ai_info_map_type.showType` was marked `optional: true` on 2026-08-05 and reverted the same day. The evidence was 52 three-argument uses across 52 distinct DE-official files with 20+ distinct map types — genuinely independent, not a copy-paste artefact, and it still did not survive. **Official DE maps contain bugged lines; the engine passes them silently, the affected code never takes effect, and nobody finds out.** guide:475 lists `showType` **not functional on DE**, so writing it and omitting it are indistinguishable in game, and no shipped script could ever have revealed which form is correct. A frequency count only counts when a wrong answer could have been *observed*. Both halves are now CLAUDE.md Hard rules.

### Triage of all 35 (2026-08-05)

| Count | Name | Site | Verdict |
|---:|---|---|---|
| 10 | `ai_info_map_type` | 10 maps, 8 of them DE-official | **UNDETERMINED — still warns, deliberately.** Trailing `showType`. The guide gives `default: 0` but never says it may be omitted, unlike the five attributes fixed on 2026-07-31 which each carry explicit prose. Settle it with an RMSTEST that puts a distinguishable token after a three-argument call and checks whether the engine eats it. **Do not re-derive this from shipped maps.** |
| 2 | `create_terrain` | `sample.rms:50,56` | **OUR OWN FIXTURE WAS WRONG — FIXED.** guide:1437's signature is `create_terrain TerrainType { Attributes }`; the fixture also used `terrain_type` (a land-generation attribute absent from the terrain-generation list) where `base_terrain` belongs. |
| 1 | `create_elevation` | `sample.rms:41` | **OUR OWN FIXTURE WAS WRONG — FIXED.** guide:1174's signature is `create_elevation MaxHeight { Attributes }`. Note the fix stands on the fixture being a no-op demo, not on a claim that the bare form is illegal — `MaxHeight` carries `(default: 0 - not elevated)` and is untested either way. |
| 15 | `#const` | `24hr_Mont Saint Michel.rms:93-107` | **TRUE POSITIVE, keep.** `#const SIZE` carries no value: the line reads `#const SIZE<tab>#const MAPSIZE 80`. One copy-pasted pattern repeated 15 times, so it is *one* observation. |
| 3 | `number_of_clumps` | `TC2 - Comeer v1.4.rms:193-195` | **TRUE POSITIVE, keep.** `number_of_clumps beach_terrain ICYSHORE 4056` — the clump count was dropped in a paste. Lines 191-192 of the same file are well-formed. |
| 1 | `number_of_objects` | `TL Cape of Storms.rms:1539` | **TRUE POSITIVE, keep.** Value omitted inside the `elseif LUDIKRIS_MAP` branch, which is why it shipped. |
| 1 | `terrain_cost` | `TL Grand Bara.rms:1617` | **TRUE POSITIVE, keep.** `terrain_cost 10` is missing its **leading** `TerrainType`, which guide:1925's signature makes required and gives no default at all. (718/718 install uses pass two arguments — corroboration only; the verdict rests on the guide.) |
| 2 | `#const` + `max_distance_to_other_zones` | `24hr_Battle Lines 1.0.rms:93` | **FALSE POSITIVE, different cause — NOT fixed here.** See below. |

**The last row is the one to read.** Under a `/* parameter renames */` comment the author writes `#const restricted_terrain_distance max_distance_to_other_zones`, aliasing one name to another by token ID. That is the **same Sec.2.1 idiom as BUG-005's `L`**, and it fires here for a third reason again: `max_distance_to_other_zones` is a known attribute, so it is in the Sec.6 stop set, so `#const`'s value consumption terminates before reaching it — then the orphaned attribute parses on its own and draws the second (info) diagnostic. `optional` cannot fix it, and patching the stop set is a Sec.6 change. **It moves to BUG-005 piece 2's decision — same principle, different code path.** The shared principle is that a `#const` may alias *any* name, so a known name in an unexpected position may be an alias rather than a mistake. The implementations diverge: `L` is an unknown word at statement position followed by `{` (RMS0200, Sec.5.4), while this is a known attribute name landing in `#const`'s value slot and terminating consumption (RMS0201, Sec.6 stop set). Ruling on the principle governs both; the two fixes are still separate edits.

**Two general results worth keeping.**

1. **Omissibility comes from a guide sentence, never from a `default:` notation, and never from a headcount of shipped maps.** All five arguments correctly flagged on 2026-07-31 carry explicit prose ("**No argument**, or a value of 0 imposes no further restrictions", guide:2719). `showType` carries only `(default: 0)`, and the attempt to promote that to omissibility using 52 shipped uses is the mistake described above. `terrain_cost`'s `Cost` also carries a default and is not omissible. **A `default:` with no sentence beside it means UNDETERMINED — which means leave the data alone and write down why, not go looking for a count.**
2. **`test-maps/sample.rms` was invalid RMS and sat in `ZERO_ERROR_ALLOWLIST` the whole time**, because that gate checks zero *errors* and RMS0201 is a warning. A hand-written Phase 1.4 highlighting fixture had never been read by the parser it predates. Worth a glance at any other Phase-1-era fixture.

**Adjacent gap found while triaging, not filed as a bug yet:** the parser does not check that an attribute belongs to its enclosing command. `terrain_type` inside a `create_terrain` block drew nothing, though the guide's terrain-generation attribute list has no such entry. Same family as the unbuilt RMS0304 section-lock check, and it needs the same treatment (measured per-command data, not a blanket rule).

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
