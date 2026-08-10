# Review: preview-design.md rev 5

Independent critique of `docs/preview-design.md` (approximate map preview, Phase 4.1, rev 5). Every claim below was checked against the working tree and `reference-docs/definitive-rms-guide-2026-07-16.txt` on 2026-07-30, with file:line. Where this note and the source disagree, re-check the source first.

**Verdict:** the strongest of the four design specs in this repo, and close to implementable. The sourcing layer holds up under audit: I spot-checked roughly 45 guide citations, 7 repo file:line citations, 4 reference-data claims and 8 corpus statistics, and found exactly one misattributed line number. The determinism argument (goal 5), the failure-bucket contract (Sec.7), and the `set_gaia_object_only` rule (Sec.6.6) are all correct and well-argued. The gaps are not in what the doc claims, they are in what it leaves underdetermined: three of them will produce divergent implementations, one is a documented engine behaviour in the same "plausible-looking lie" class as rev 5's own headline fix, and one prerequisite the doc marks **LANDED** is not actually consumable from TypeScript yet.

Four blocking, five significant, a handful of polish.

---

## Blocking

### B1. `predefinedLabels` is landed as data but not as a type, and Sec.12 item 1 calls it the only thing blocking 4.3

Sec.3.1 has the generator switch on each label's `category`; Sec.12 item 1 marks the item **LANDED** and says it is "the one that actually blocks 4.3". The data is real and correct: 138 entries, `category` on all of them, `dimensions` plus a `mapSize` field on the 21 `mapSize` entries, schema-validated against `$defs/predefinedLabel` whose `category` enum matches the data exactly.

The TypeScript surface does not match. `src/parser/language.ts:82`:

```ts
predefinedLabels?: string[]; // schema action item (spec Sec.7/Sec.13) — absent today
```

Wrong element type and a stale comment. `refDb.predefinedLabels` is how the generator reaches this array (Sec.3.1 pins the `?? []` guard on exactly that expression), so `entry.category` does not compile against the declared type. Nothing catches it today because `parserWorker.ts:21` reaches `LanguageData` through a double cast.

The fix is mechanical, and the schema is the specification: add a `PredefinedLabel` interface (`name`, `category` as the 10-value union, `description`, `verified`, optional `dimensions`, `mapSize`, `notes`) and type the field against it. But it has to be *in* Sec.12 item 1, because that item currently reads as "done, nothing to do", and the next session will discover this at the first line of `instantiate.ts`. `docs/tools-api-design-rev4-review.md` B2 found the same defect from the Advanced Tools side; the two should point at one action item.

### B2. "Grouped" is never defined, and the whole Sec.6.6 scope table pivots on it

The grouping-scope table (Sec.6.6, the substantive correction rev 4 introduced and rev 5 kept) is entirely conditioned on "Scope when grouped". The doc never says what makes a `create_object` grouped, and the guide gives four activators, not one:

- `number_of_groups` (guide:2065, "default: individual objects - no groups") — the only one Sec.6.6 mentions, under **Counts**.
- `group_placement_radius` (guide:2100) — "Activates grouping behavior."
- `set_tight_grouping` (guide:2120) — "Activates grouping behavior."
- `set_loose_grouping` (guide:2137, mutually exclusive with tight).

Two consequences an implementer cannot resolve from the text:

1. Is `create_object GOLD { group_placement_radius 3 number_of_objects 5 }` grouped? The guide says yes. Sec.6.6 says grouping comes from `number_of_groups`, whose absence means "ungrouped". So the same command is grouped or not depending on which sentence you read, and that flips five rows of the scope table.
2. When grouping is active with neither `set_tight_grouping` nor `set_loose_grouping` stated, which is the default? It decides the actor-area row (the only row that uses the tight/loose heuristic at all), whether `force_placement` is disabled (guide:2739), and whether Selection takes the flood-fill path or the scatter path. 26 of 32 corpus maps state loose explicitly, so the default governs the remainder rather than nothing.

**Fix.** State the grouping predicate once, near the top of Sec.6.6, as a named derived flag: grouped if any of `number_of_groups`, `group_placement_radius`, `set_tight_grouping`, `set_loose_grouping` is present. Then pin the tight-vs-loose default (and mark it `[verify]` if the guide does not settle it, which as far as I can find it does not).

### B3. Building footprints change *whether objects appear*, in two places, and Sec.9 waves them off as cosmetic

Sec.9 item 11 excludes "`override_actor_radius_if_required` building-footprint mechanics (footprints are v1.x; all objects occupy one tile)". That framing is right for that one attribute and wrong for the assumption it licenses. Two other guide statements make the one-tile model a placement-outcome error, not a rendering approximation:

- guide:2121, under `set_tight_grouping`: "Objects that are larger than one tile and cannot overlap (most buildings), will not be placed when using tight grouping." Not "placed badly" — not placed.
- guide:2738, under `force_placement`: "Only works for objects that can overlap on the same tile (ie. units, but not buildings)."

So a script that tight-groups houses, or force-places buildings into a full area, renders in the preview as a tidy cluster of buildings the engine puts nowhere. That is structurally the same defect as the `set_gaia_object_only` hole rev 5 calls rev 4's largest gap, and it is the exact shape goal 1 forbids. Neither case appears in Sec.9's list, and there is no `FailureBucket` for it.

**Fix.** Cheap version, no footprint model required: the generator needs one bit per object — "can overlap" — which is derivable from Sec.12 item 8's `category` (buildings vs everything else) at reduced confidence, or is a natural companion flag to item 3's `playerOwnable`. Under tight grouping, a non-overlapping object places nothing plus a `notSimulated` note naming the reason; `force_placement` on a non-overlapping object degrades to ordinary placement plus a note. Add both to Sec.9's list.

### B4. Sec.7's attribution algorithm is pinned for S6 only, and Sec.11's caching contradicts itself on the same mechanism

Two problems in the machinery the merge gate depends on.

**Attribution order.** Sec.7: "Evaluate predicates as **successive set intersections in a fixed, documented order** — the order in Sec.6.6's candidate-filter list, top to bottom". That list exists only for objects. S1, S2 and S4 all emit buckets that require the same discipline: Sec.6.4's terrain eligibility has about seven constraints written as prose with no ordinal, and it can produce `terrainAbsent`, `spacingConflict`, `playerOriginAvoidance` or `growthShortfall`. Sec.6.1's land-growth rejection list has three. Because the doc makes bucket identity a merge gate ("Sec.13 requires one unit test per bucket") and 5.2 aggregates on it, an undocumented order for four of the six stages is the same defect the section is written to prevent, one stage over. Fix: state that each stage's attribution order is its own constraint list in the order written, and convert Sec.6.4's eligibility prose and Sec.6.1's rejection list into ordered lists so "the order written" is unambiguous.

**Caching.** Sec.11 item 2: "the *base* set per (reference frame, habitat class) is computed once per stage and **cached**, and per-command predicates filter that list **in place** (write-compact, one pass per predicate)". Write-compacting the cached array destroys it for every subsequent command using that frame. As written, an implementer who follows it literally ships a bug that appears only on the second `create_object` per player frame, which is most maps. The intended structure is presumably "copy the cached base into a per-command scratch `Int32Array`, then compact the scratch in place" — one `.set()` per command, both claims preserved. Say that.

---

## Significant

### S1. The grouping-scope override rests on a real ambiguity and has no verify slot

Sec.6.6's table overrides guide:2122 and guide:2143 for five attributes on a per-attribute-wins reading. The reading is defensible and I would keep it, but the doc oversells how settled it is. guide:2122 does not merely gesture at "most constraints" — it names `avoid_forest_zone`, `min_distance_to_map_edge`, `min_distance_group_placement` and `avoid_actor_area` explicitly as center-only under tight grouping, and the table answers three of those four differently. The doc's "Left alone deliberately" note says both items were "re-checked", but re-reading the same two lines cannot settle which of two consistent readings the engine implements.

Corpus reach makes this the highest-value open question in the doc: `avoid_forest_zone` 32/32 maps, `min_distance_to_players` 30, `set_loose_grouping` 26. Meanwhile Sec.15 item 7 spends three verify slots on rounding questions worth a tile or two. One in-game test settles it (tight-grouped berries with `avoid_forest_zone 6` beside a forest: do edge members land inside the forest or not). Add it to item 7's session; it is the cheapest high-impact item on the list.

### S2. Sec.4 argues against the worked example but never confronts the instruction

Sec.4 spends a paragraph banning the "Area ratio" column, citing guide:3432 as the tie-breaker and disposing of guide:1259's `400 × 2.1 = 840`. The position is correct — the ratios are literally area/10000 rounded to one decimal place (2.0736 → 2.1, 4.84 → 4.8, 6.3504 → 6.4), and 829.44 is the exact value. But the strongest counter-text is not the worked example, it is guide:3429, which the doc never quotes:

> "Multiply your chosen number by the area ratio listed for a given map size to determine how many tiles/clumps/objects will be generated."

That is an instruction to do the banned thing, in the same paragraph that supplies the doc's own supporting sentence ("Scaling uses map area, not side length"). An implementer who greps the guide finds 3429 before 3432. Quote it and dispose of it explicitly.

Related, and a two-word fix: Sec.4's own table reproduces the ratio column three lines above the paragraph banning it, unmarked. Label the column "display only, never compute with this".

### S3. Citation slip in Sec.3.3, in the one section that ran a precision pass

Sec.3.3 line 47 attaches `(guide:3006)` to "**The 100th percent is never chosen**". Line 3006 is "If the total percentages add up to less than 99%…"; the 100th-percent sentence is at 3010, tacked onto the `percent_chance 0` bug bullet — which the very next paragraph states correctly. Separately, the model's "truncated at 99" rule has no citation at all; its source is guide:3007 ("If the total exceeds 99%, only the first 99% will have a chance of occurring"), which the doc never quotes despite it being the only line that grounds that clause.

This is the one citation error I found in about 45 checks, so the precision claim in the changelog is substantially earned. Fix it anyway: rev 5's "Precision" note makes verifiability the doc's stated basis of authority.

### S4. Two documented negative-value cases meet containers and validators that reject them

Both are the same shape as `circle_radius 0`, which Sec.6.1 handles well and explicitly.

- **`base_elevation` negative.** guide:957: "Negative values maximally elevate a land (not recommended due to rendering issues)." Sec.4 declares `elevation: Uint8Array`, and Sec.6.1's rule is just "set `elevation = H` on the land's tiles". `H = -1` wraps to 255, and the renderer's brightness shading (Sec.2) draws garbage. State the clamp: negative → maximum height.
- **`circle_radius 0` versus the reference data.** Sec.6.1 makes `circle_radius 0` load-bearing (disables circular positioning; treating 0 as a radius "stacks every player on the map center… a guaranteed `originFallbackCenter` storm"). `language.json`'s `circle_radius.radiusPercent` declares `min: 1`, matching guide:842's stated 1–50 range and contradicting guide:844's "0 will disable circle_radius". So `validate()`, when it ships, will flag a documented, load-bearing value as out of range on the three corpus maps' bare form and on any map using the disable idiom. This belongs in Sec.12 beside item 4's `terrain_size` argument-name correction — same class of data defect, caught the same way.

### S5. The rev-N narration the header removes from the appendices is still throughout the body

The header's rationale is right and worth acting on fully: "under a do-not-deviate banner, historical self-litigation competes with the spec for an implementer's attention". Moving Appendices A/B/C to the build log fixed the appendix half. The body half is untouched: 40 lines across the normative sections carry 44 references to what rev 3 or rev 4 got wrong, several running to three sentences (Sec.6.1's `border_fuzziness` bullet, Sec.6.4's terrain table preamble, Sec.7's attribution paragraph, Sec.10's cancellation discussion).

Some of it is load-bearing — "do NOT implement standard precedence out of habit" earns its space, and so does the reason `circle_radius 0` must not be treated as a radius. Most is not: an implementer reading Sec.6.4 does not need to know that rev 4 corrected the land table and left the terrain twin pointing at it. Suggested rule for rev 6: keep the *trap* ("weight rises monotonically forever, which draws a circle where the engine draws a peninsula"), drop the *attribution* ("rev 3's single monotonic formula claimed to match the guide and did not"). The reasoning is already preserved in the build log, which is where the header says it belongs. That should recover a fifth of the body without losing a decision.

---

## Minor

- **`create_object_group`'s % bug is the one uncited engine claim in Sec.6.6**, and it is wrong on the detail: the doc says "bugged/inverted", guide:2025 says "The % currently doesn't work; all objects in the group are equally likely regardless of what number you specify". Ignored, not inverted. The model (uniform) is right either way. Add the line number.
- **`collectReports: false` has no defined behaviour.** `PreviewResult.reports` is non-optional while `snapshots?` is optional, and the field is annotated "true always in practice". Either specify `reports: []` when false, or drop the knob. An always-true boolean under a do-not-deviate banner invites a guess.
- **`set_zone_by_team`'s zone values are left to derivation.** guide:1056 gives the formula (TeamNumber − 9, team 1 → −8), which under Sec.3.1's solo-team premise yields playerNumber − 9, one higher than the player-land default of playerNumber − 10. Sec.6.1 says only "gives each player a distinct zone". Given the care Sec.6.1 spends pinning −9 versus −10 for the default case, with a post-mortem attached, stating this one costs a clause. Also unmodelled: guide:1055's `set_zone_by_team` on a `create_land` assigns it to *player 1's* team zone, which is a clean `validate()` hook for a "not recommended" idiom.
- **`max_distance_to_other_zones` misses the road carve-out.** guide:2530: "Does not apply to road terrains, even though resources cannot be placed on them." Sec.6.6 models it as "min distance from habitat-restricted terrain" with no exemption, while Sec.12 item 6 already requests `isRoad` for the neighbouring separation quirk. One clause.
- **Two free `validate()` hooks the doc could hand over while it is in the neighbourhood:** `create_actor_area` crashes the game if the map generates no lands (guide:1996), and `min_length_of_cliff < 3` producing no cliffs is already flagged in Sec.6.3 but not listed with the other `validate()` candidates.
- **`docs/build-log.md`'s archived rev-4 changelog carries three citations the rev-5 sweep missed**: `min_distance_to_map_edge` (2599), `avoid_forest_zone` (2570), `avoid_cliff_zone` (2585), where the text sits at 2598, 2569 and 2584. Worth noting that all three are one *high*, while the rev-5 changelog describes rev 4's numbers as "systematically 1–3 low". The pass re-grepped the spec but not the material it archived.
- **`age-of-rms/CLAUDE.md`'s status table is stale against this doc**: it records 4.1 as "at rev 4" and says Sec.12 items 1–2 "should land before 4.3", both of which the doc marks LANDED, and its own Tracked debt section already records `predefinedLabels` as done. CLAUDE.md's closing rule makes the table part of the session that changed state.
- **The `MAP_SIZE_TILES` cross-doc conflict is already adjudicated but not yet applied.** `docs/tools-api-design-rev4-review.md` B1 resolved it in this doc's favour (`predefinedLabels[].dimensions` is the source). The stale instruction still stands at `tools-api-design.md:64-72` and `build-log.md:172` ("create MAP_SIZE_TILES from the guide table, wiring preview-design Sec.4's future consumer to it"), and `tools-api-design.md`'s stated reason for rejecting Sec.4's table ("lists 6 sizes, omits Giant") describes rev 4, not the current 7-row table. Nothing for this doc to decide; whoever applies that review should sweep both sites. Adding a one-line pointer in Sec.4 naming `predefinedLabels[].dimensions` as the runtime source would stop it recurring.

---

## What is right, and worth not losing in a rev 6

Stated because a critique that only lists defects invites a rewrite of things that took four rounds to get right.

- **The sourcing layer is real.** Every one of these resolved to the quoted text: 135, 167, 769, 799–805, 843–856, 885–887, 903–905, 925–927, 949–959, 1038, 1050–1056, 1068–1074, 1093–1094, 1111–1120, 1146, 1169–1172, 1228, 1257–1274, 1301–1302, 1324, 1351, 1363–1366, 1603, 1616, 1646–1648, 1689–1697, 1954–1965, 1991–1996, 2013–2025, 2065, 2079–2103, 2116–2143, 2262–2263, 2354–2355, 2431–2433, 2523–2533, 2569, 2584, 2598, 2614, 2635, 2652, 2694–2697, 2733–2739, 2780, 2857, 3010, 3432, 3437.
- **Repo citations are exact, including the ones easiest to get wrong**: `Span` at `src/parser/types.ts:27`, its derivation comment at `:78` verbatim, `parserWorker.ts:7-8` (the two JSON imports), `useParsedDocument.ts:95` (the stale-response guard, quoted correctly), `ui-help.json:268`, `PLAN.md:54`, and `MAP_SIZES` ordering Giant before Huge.
- **Corpus statistics are accurate, all of them.** `set_gaia_object_only` 32 of 33 (absent only from `24hr_Bazi is God.rms`); `avoid_actor_area` 32; `avoid_forest_zone` 32; `min_distance_to_players` 30; `set_loose_grouping` 26; `border_fuzziness` 19; `create_connect_*` in 12 maps with exactly 2 omitting `terrain_size` (`AK_Six_Points_v1.4.rms`, `sample.rms`); 3 maps with a bare single-argument `circle_radius`, including the 38 and 19 the doc names.
- **Reference-data claims check out**: 138 `predefinedLabels`, `repeatable` on exactly the five named attributes, `terrain_size` declared `terrain`/`width`/`spacing` against the guide's `TerrainType`/`Radius`/`Variance`, `game-constants.json` at 31 entries with every `verified: false` and every `deTextureFile` null.
- **The determinism argument survives scrutiny.** Banning the transcendentals is the right call, and the substitutes are all exact: the fixed-point sine table, integer clumping buckets, squared-distance comparisons, and `len² · 100` against `straight² · 169` for the 1.3× path ratio. The float paths that remain are IEEE-754 `+ − × /`, which *is* bit-specified, so `dim²/10000 = 829.44` is safe. One dependency worth recording as confirmed rather than assumed: floats reach the generator unmodified, because parser-design Sec.6 rule 1 accepts floats into `integer`/`percent` slots with no diagnostic and no coercion. Sec.4's "carry both as floats" is implementable today.
- **Sec.4's arithmetic is right**: 400 × 144²/10000 = 829.44, and the guide's ratio column is that value rounded. Sec.5's snapshot budget is right too: 6 B × 480² × 6 ≈ 8.3 MB.
- **The cancellation reversal is the correct call and the reasoning is sound.** Discard-by-id matching the existing parser precedent, plus a watchdog for the pathological tail, beats terminate-and-respawn for exactly the reason given.
- **`set_gaia_object_only`, the actor-area multimap, the asymmetric border rounding, the separate terrain clumping table, and the `enable_tile_shuffling` inversion** are all correct against the guide and all consequential. Rev 5 earned its number.

---

## Process note

Three of the four blocking items are the same failure mode, and it is not carelessness: the doc is scrupulous about everything it *states* and silent on things it treats as obvious. "Grouped" (B2), "which order do predicates run in outside S6" (B4), "can this object share a tile" (B3) all read as settled while being underdetermined. A useful check for rev 6, cheaper than another full critique: for each derived flag or ordering the spec conditions behaviour on, grep the doc for where that flag is *defined*. `grouped`, `habitat class`, `reference frame`, `attribution order`, `can overlap`. Two of those five have definitions.

B1 is a different lesson and a repeat of one the build log already recorded twice: a prerequisite marked done in one representation is not done in the others. `predefinedLabels` landed as JSON and as schema, and its TypeScript type still says `string[] // absent today`. Same shape as the `verified: true` flag set before the `.dat` half had run, recorded in Phase 4.0's notes.

---

## Suggested rev 6 edit list

Ordered by cost to fix, cheapest first. None of these need a session of their own; all of them fit in one editing pass. Items marked **[done]** are applied to the spec.

1. **[done]** Sec.3.3: `(guide:3006)` → `(guide:3010)`; add guide:3007 for the truncate-at-99 rule.
2. **[done]** Sec.6.6: add the line number for `create_object_group`'s % bug (guide:2025) and correct "inverted" to "ignored". Uniform selection turns out to *be* the engine's behaviour, not an approximation of it, which is now stated.
3. **[done]** Sec.4: mark the "Area ratio" column display-only; quote and dispose of guide:3429.
4. **[done]** Sec.6.1: state the negative `base_elevation` clamp.
5. **[done]** Sec.6.1 (not 6.6 — that is where the attribute lives): the `set_zone_by_team` zone formula (guide:1056) plus guide:1055's `create_land` footgun. Sec.6.6: the `max_distance_to_other_zones` road exemption (guide:2530).
6. **[done]** Sec.10: `collectReports` deleted rather than specified — reports are goal 2, cheap, and had no caller wanting them off. Contract pinned at the end of Sec.7.
7. **[done]** B1 fixed rather than deferred: `PredefinedLabel` / `PredefinedLabelCategory` added to `src/parser/language.ts` from the schema's `$defs/predefinedLabel`, field kept optional so Sec.3.1's `?? []` guard stays live, stale TODO at `parser.ts:992` rewritten as work-outstanding rather than blocked. Recorded in Sec.12 item 1 and in parser-design Sec.13 item 3. Gates green: typecheck clean, lint 0 errors, 277/277 tests, `validate:reference` passing.
8. Sec.12: add `circle_radius`'s `min: 1` versus `circle_radius 0` as a data item (S4).
9. Sec.15 item 7: add the grouping-scope in-game test as a fourth sub-item (S1).
10. Sec.6.6: define the grouping predicate and pin the tight-versus-loose default (B2).
11. Sec.7 and Sec.11: state the per-stage attribution order, and the per-command scratch copy (B4).
12. Sec.6.6 and Sec.9: add the can-overlap rule for tight grouping and `force_placement` (B3).
13. Sec.4: one-line pointer to `predefinedLabels[].dimensions` as the runtime source for `dim`.
14. Body-wide: strip rev-N attribution, keep the traps (S5).

Outside the doc: update `age-of-rms/CLAUDE.md`'s status table to rev 5 with both prerequisites landed, and fix the three archived citations in `docs/build-log.md`.
