# Review: preview-design.md rev 6

Independent critique of `docs/preview-design.md` (approximate map preview, Phase 4.1, rev 6). Checked against the working tree and `reference-docs/definitive-rms-guide-2026-07-16.txt` on 2026-08-05. Every claim below carries the file:line or the command that produced it. Where this note and the source disagree, re-check the source first.

**Verdict:** rev 6 does what its own preamble claims — the measured sections are a different class of document from the argued ones, and the corrections it folded in (the cross's reference length, the ring's radius, `border_fuzziness`, the elevation axis, the grouping-scope rule) are all sound. The sourcing layer is in better shape than rev 5's: I resolved 43 guide citations and found **one** off by a line, and every repo file:line citation I checked was exact.

The problems are of two kinds, and neither is in the new measurements.

First, **the doc has outgrown its own edit discipline**. Four separate places still carry a rule the same document withdrew elsewhere — Sec.5's snapshot toggle, Sec.6.1's growth frontier, Sec.13's rounding fixture, Sec.13's elevation statistic. Rev 6's preamble anticipates exactly this failure ("if the body and any appendix disagree, the body wins") but the conflicts here are body-against-body, where that rule gives no answer.

Second, **two claims about engine behaviour are contradicted by scripts already in the repo**, and both were recorded in a neighbouring document without anyone carrying them back. That is CLAUDE.md's own "a rule established in one pass is not established in the passes that predate it", applied to this doc.

Four blocking, six significant, twelve minor.

---

## What I verified and what holds

Confirmations first, since the doc's culture treats a passing orthogonal check as worth printing.

- **Sec.3.1's label derivation is correct, exhaustively.** I reimplemented the canonicalisation and label list exactly as Sec.3.1 and `src/generationSettings/teamModel.ts` define them, then enumerated **all 488,275 reachable lobbies** at 2–8 players. Every one of the 68 distinct labels emitted exists in `predefinedLabels`; nothing is missing. The 29 `teamSize` names emitted are **exactly** the 29 in the data, in both directions. Sec.13's test case (5) will pass as specified. (One consequence of the same run is a finding — see S1.)
- **`teamModel.ts` matches the spec, including the step the spec words as a sort.** Sec.3.1 step 3 says "order the surviving groups by their lowest player number"; the code relies on `Map` insertion order and asserts in a comment that this *is* lobby order. It is, because the map is built by ascending player index, so a key's insertion point is its lowest member. Verified against the doc's own worked example: `-,3,3,-,1,1,2,-` → `0,1,1,0,2,2,0,0`.
- **Sec.4's area-ratio argument is stronger than it claims.** The doc disposes of guide:3429's ratio column by showing three rows are `area/10000` rounded to one decimal. All **fourteen** rows are: 0.64→0.6, 1.44→1.4, 2.0736→2.1, 2.8224→2.8, 4.0, 4.84→4.8, 5.76→5.8, 6.3504→6.4, 7.6176→7.6, 9.0, 10.24→10.2, 12.96→13.0, 16.0, 23.04→23.0. Since the argument's form is a set-match, say "all fourteen".
- **Sec.4's map-size table matches `predefinedLabels` row for row**, including the legacy/modern offset and Giant's absent legacy name. 21 `mapSize` entries, 7 carrying a `MAP_SIZES` value.
- **The two `language.json` prerequisites are genuinely landed, both halves.** `PredefinedLabel` and a ten-member `PredefinedLabelCategory` union are declared at `src/parser/language.ts:103-142`, matching the data's ten categories exactly. All five `repeatable` flags are present. Rev 5's B1 is closed.
- **Repo citations resolve exactly:** `src/parser/types.ts:78` (Span derived from token offsets), `src/useParsedDocument.ts:95` (the discard-by-id line, quoted verbatim), `src/editor/parserWorker.ts:7-8` (the two JSON imports), `reference/data/ui-help.json:268` (and its copy does still end "Preview logic arrives in Phase 4"), `src/parser/parser.ts` honouring `ArgumentDef.optional`.
- **`circle_radius.radiusPercent` is `min: -50`**, as Sec.6.1's 2026-08-04 note says, with the RMSTEST_27 numbers written into the data's own `notes`.
- **Sec.6.3's cliff-range asymmetry is the guide's, not a slip.** guide:1351 gives cliff *count* as min-inclusive/max-exclusive and guide:1364 gives cliff *length* as inclusive both ends. The doc transcribes both correctly.

---

## Blocking

### B1. Sec.6.3's zero-cliffs rule is refuted by three scripts in this repo, two of them DE-official

Sec.6.3 pins, normatively:

> **`min_length_of_cliff` below 3 produces no cliffs at all** (guide:1366, "minimum must be at least 3 for cliffs to appear") — model it as zero cliffs plus a note, not as a clamp

The citation is exact. The rule is not survivable. A comment-aware scan of the corpus (non-nesting `/* */`, RMS-style) finds three **live** sub-3 declarations:

| file | line | value |
|---|---|---|
| `test-maps/local/Fortress.rms` | 748 | `min_length_of_cliff 2` (max 4, 5–10 cliffs, unconditional block) |
| `test-maps/local/lombardia.rms2` | 355 | `min_length_of_cliff 2` |
| `test-maps/QS_Three_Bays_v1.1.rms` | 465 | `min_length_of_cliff 2` (max 4) |

`Fortress.rms` is a shipped official map whose entire identity is cliff-walled player bases, and its `<CLIFF_GENERATION>` block is live and unconditional. Under Sec.6.3 the preview renders Fortress with **no cliffs at all** and emits a note asserting so. That is the "confidently wrong" failure goal 1 exists to forbid, produced by the spec on purpose.

(Two further hits, `test-maps/Chaotic_Straitv0.99.rms:378` and `test-maps/local/Ghost_Lake.rms:545`, are inside commented-out blocks and do not count. I checked, because miscounting these would have inflated the finding.)

This was already known one document over. `docs/parser-design.md:438` item 22 and `de-official-map-issues.md:290` both record `min_length_of_cliff` at 1 or 2 across **six** DE-official maps — `Fortress.rms:748`, `Mediterranean.rms:266`, `Cliffbound.rms:2348`, `Sandrift.rms:2361`, `Shrubland.rms:2384`, `lombardia.rms2:355` — and file it as "documented ranges that shipped scripts exceed". Nobody carried it here, which is the exact shape of the CLAUDE.md rule about a pass not establishing a rule for the passes that predate it.

The reading that fits both the guide and Fortress: lengths draw from `[min, max]` inclusive (guide:1364) and a *drawn length* below 3 yields nothing, so `min 2 / max 4` gives roughly a two-thirds yield rather than zero. That is still "not a clamp", which is the part the doc got right.

**Second-order:** `language.json` declares `min_length_of_cliff.min: 3`, so `RMS0203` fires on all three live corpus uses today. This is the same defect class as `base_elevation 0` (461 corpus false-warnings) and `circle_radius 0`, both already promoted to CLAUDE.md hard rules. It has not been filed in `known-issues.md`.

**Fix.** Demote the rule to `[verify]`, add it to Sec.15, and until it is measured model sub-3 as a per-draw yield rather than a section-wide zero. Widen the data's `min` the way `circle_radius` and `base_elevation` were widened. One RMSTEST settles it: `min 2 max 2` against `min 3 max 3`, count cliff tiles.

### B2. Goal 5's determinism guarantee has no enforcement anywhere, and this spec is the only place that can mandate it

Sec.8 is the load-bearing section for the doc's most repeated claim (goal 5, byte-for-byte across JS engines):

> No `Math.random()` anywhere in `src/preview/generator/` (**lint-enforced if practical**).
> **No `Math.sin`, `Math.cos`, `Math.pow`, `Math.sqrt`, `Math.hypot`, `**`, or `Math.log` either — same lint rule, same reason.**

`eslint.config.js` is 28 lines. It has no `no-restricted-properties`, no `no-restricted-globals`, no `no-restricted-syntax`, no `no-restricted-imports`. `.github/workflows/ci.yml` runs lint → typecheck → test → validate:reference and contains no grep step. So "same lint rule" refers to a rule that does not exist, and "CI-greppable" (Sec.14) to a grep nobody runs.

The same gap covers the purity boundary: CLAUDE.md's hard rule that `src/parser/**` and `src/breakdown/patch/**` must not import React/Monaco/Tauri is also unenforced, and Sec.2 adds `src/preview/generator/**` as a third such area.

"Lint-enforced if practical" is the weakest phrasing in a document that elsewhere quantifies everything, and it is guarding the claim that makes the re-roll button meaningful and 5.2's Monte Carlo reproducible. CLAUDE.md: *a check that has only ever passed proves nothing, mutation-test it against the defect it exists to catch.* Here there is no check to mutate.

**Fix.** Make it normative and specific, and land it in the same commit as `rng.ts`, not "in 4.3": `no-restricted-properties` on the eight `Math` members plus `no-restricted-syntax` for the `**` operator, scoped to `src/preview/generator/**`; `no-restricted-imports` for `react`, `monaco-editor` and `@tauri-apps/*` scoped to all three pure areas. Mutation-test both (add `Math.sqrt` to a generator file, confirm `npm run lint` exits non-zero, restore) and say so in Sec.13, since Sec.13 is what gates merges.

### B3. Sec.5 still carries the snapshot model it withdrew, and the withdrawal orphaned the snapshots

Three problems, all downstream of the 2026-08-01 Current/Final decision.

**The withdrawn model survives as the section's closing sentence.** Line 178:

> The generator always runs all stages (reports and totals need S6); **the toggle only selects which snapshot the renderer draws.**

That is precisely the model the DECIDED block nine lines above deletes ("Both candidates assumed Current selects a *stage snapshot*; it does not"). Under a do-not-deviate banner an implementer reading the section end to end is handed both, with no rule to choose — the preamble's body-beats-appendix tiebreak does not apply to a body-against-body conflict.

**Line 173 contradicts line 174 in its own formula.** "Current is `generatePreview(parse of source[0..line], …)`" is text truncation; the very next consequence is "**Truncation must happen on the AST, not the text**". Write it as `generatePreview(truncateAst(parse, pinnedLine), …)`.

**Nothing reads S1–S5 any more.** Current is a fresh run whose *final* grid is drawn; Final is S6. I can find no consumer of the elevation-stage or cliff-stage grid in Sec.2's consumer list, Sec.5, Sec.10 or Sec.13. Yet snapshots remain the API's only cost knob (`collectSnapshots`), the only large allocation in Sec.11, an 8 MB budget in Sec.5 (arithmetic checks: 6 B × 480² × 6 ≈ 8.3 MB), a copy of four typed arrays per stage boundary, and a `StageSnapshot[]` field on `PreviewResult`.

That may be deliberate — a stage scrubber is a plausible 4.2 feature and the field is cheap to keep — but the doc no longer says why it exists, and 4.2 is building its hardcoded fixture against exactly this type list (Sec.10, Sec.14).

**Fix.** Delete line 178. Correct line 173's expression. Then either name the snapshot consumer in Sec.2 or cut snapshots to S6 and reclaim the budget; either way state the decision, because "the field exists and nothing reads it" is what an implementer will otherwise infer is an oversight.

### B4. Sec.6.1's bucket-0 repair is inert against its own frontier definition

Item 16 (2026-08-04) is the cheap outcome the doc wanted, and its measurement is convincing. The repair as written does not take.

Lines 227–241 add the mechanism:

> below ~20 that bucket carries non-zero weight — the land may place a tile **detached from itself**, seeding a new component… what changes is that **bucket index 0 exists**

The normative growth paragraph, thirty lines later, is unedited:

> Per turn, a land samples from its **frontier (empty candidates 4-adjacent to owned tiles)** by weight. The frontier is held in integer weight buckets — bucket index is a function of **`neighborsOwned ∈ [1,4]`**

A candidate 4-adjacent to an owned tile has `neighborsOwned ≥ 1` by construction. Bucket 0 is unreachable from that candidate set, so an implementer following the normative paragraph produces the pre-item-16 model and the `cf −20` fragmentation never appears.

The missing piece is not the weight, it is **where a detached candidate comes from**. The whole unowned map? A radius around the mass? A reservoir seeded per land? That choice determines the fragment count and the piece-size distribution item 16 measured (6–10 pieces at `cf −20`, comparable sizes), and the doc marks the weight `[tune]` while leaving the candidate source unstated — which is the wrong thing to leave open, since the weight is fittable and the source is not.

It also collides with Sec.11. The frontier is specified as append-only `Int32Array` buckets with `Uint8Array` membership and an O(1) draw, and the 40 ms budget is built on that. A bucket whose candidate set is "every unowned tile" is a scan, not that structure.

**Fix.** State the candidate source for bucket 0 and cost it against Sec.11. The form that preserves both the measurement and the data structure: with probability `w(cf)` a land's turn draws from a small per-land detached-seed reservoir (itself sampled once at land start) instead of the frontier, and the new tile's neighbours enter the normal buckets. Then delete `∈ [1,4]` from the growth paragraph.

Related bookkeeping: Sec.15 item 13's text still reads as a live refutation ("Sec.6.1's growth model is refuted… **Folded into Sec.6.1 as a blocking warning on the growth paragraph**") and item 3's residual still demands a test item 16 has run. There is no blocking warning in Sec.6.1 now. Both were superseded by item 16 the same day and neither was updated. CLAUDE.md's status table repeats item 13's superseded conclusion as current.

---

## Significant

### S1. Sec.3.1's headline reachability argument fails on the sibling category, and the doc never ran the check

Sec.3.1 spends a paragraph — and Sec.15 item 4 repeats it, and CLAUDE.md promotes it to a hard rule — on the claim that the `teamSize` enumeration is exactly the reachable set:

> the claim rests on the *match between a predicted set and the observed set*, not on any single name's absence… absence of exactly the sixteen a rule predicts, and no others, is a measurement.

For `teamSize` this holds, and my exhaustive run confirms it in both directions. Applied to the category next door, it does not.

Of the 40 `playerInTeam` labels in `predefinedLabels`, **only 34 are reachable**. Canonical teams are numbered by lowest player number (Sec.3.1 step 3), so player *k*'s canonical team is at most *k*, which makes these six unreachable in every one of the 488,275 lobbies:

`PLAYER1_TEAM2`, `PLAYER1_TEAM3`, `PLAYER1_TEAM4`, `PLAYER2_TEAM3`, `PLAYER2_TEAM4`, `PLAYER3_TEAM4`

All six are present in the data and all six are `verified: true`. So the sibling enumeration is the complete 8×5 grid, including six names Sec.3.1's own rules forbid.

Two readings, and they cost differently:

1. The guide transcribes the full grid for `playerInTeam` and a pruned list for `teamSize`. Then the `teamSize` match is a fact about the guide author's pruning, not about the engine, and Sec.3.1's proof is weaker than stated. The ≥2 rule still stands — it is written in prose at guide:1004 and guide:3115 — but the set-match stops being independent evidence for it.
2. Canonical numbering is not strictly "by lowest player number". Then `PLAYER1_TEAM2` is reachable, and Sec.3.1 step 3 and `teamModel.ts` are both wrong.

CLAUDE.md: *add the orthogonal reading you expect to be boring; when it is not, it is the result.* This is that reading, on the very argument the rule was written from, and it is settleable from the guide's Conditionals section without an instrument.

**Fix.** Run the same reachability check on `playerInTeam` in Sec.3.1 and state which reading holds. Separately, strengthen Sec.13 test (5): it currently asserts "every emitted label is present in `predefinedLabels`", which is one-directional and passes cleanly here. Assert **set equality per category** and it would have surfaced this.

### S2. `assign_to` is cited as the source of the teams vocabulary and is never modelled

Sec.3.1 sources "0 means un-teamed" from `assign_to`'s own argument documentation. That entry (guide:996-1006) carries a good deal more that the spec now has the machinery to use:

- `AT_TEAM` domain is `(-10, -4, -3, -2, -1, 0, 1, 2, 3, 4)`, lobby order.
- **Negative values target a player *not* on the specified team** (guide:1002).
- `-10` gives the land to any player (guide:1003).
- A `Mode` argument, `-1` or `0`, where `0` is random selection and "only matters for AT_TEAM" (guide:1005-1006).

Sec.6.1 mentions the command once, in a trailing clause: "`land_id`, `assign_to_player`/`assign_to` recorded on the land record for S6 (lands assigned to non-playing players are **not created**)". Nothing says which player a team-assigned land belongs to, what negative targeting selects, what `-10` does, or what `Mode` changes.

S6 needs the answer: `set_place_for_every_player` iterates "player lands **or lands assigned to players**" (guide:2263), so a mis-modelled `assign_to` changes object placement, not just a label on a land record. And before the teams control landed there was a reason to skip this; now there is not.

**Fix.** Give `assign_to` its own bullet in Sec.6.1 covering the three targets, negatives, `-10` and `Mode` — or state explicitly that only `AT_PLAYER` is modelled and the rest emits `notSimulated`, which is a legitimate v1 answer but has to be written down.

### S3. Sec.13 carries three rules the body withdrew

The test plan is what gates merges, so stale rules here ship.

- **Line 716 asserts the withdrawn rounding rule.** "(Sec.4: exact `400 × 144²/10000 = 829.44`, **round half up**)". Sec.4 line 122 withdrew round-half-up in capitals — "Revisions 3 through 6 of this doc all said 'round half up'; that was never verified and is now known wrong" — and pinned `Math.floor`. The asserted *number* survives because 829.44's fraction is below .5, which is exactly the reason Sec.4 gives for the original measurement being unable to distinguish the two rules. So this fixture cannot distinguish them either, and its parenthetical teaches the wrong one. Add the `number_of_objects 500` → 1036 case, which does distinguish.
- **Line 720's elevation statistic is stale in both axis and effect size.** "elevation **south-bias** measurably present without `enable_balanced_elevation` and reduced with it." Sec.6.2 withdrew the axis (it is the `y − x` diagonal; the whole point of the `mean x` control) and withdrew the effect: balanced against unbalanced measured 12.86 → 12.27, a 5% reduction, on a seed bias of 1.31:1. N=50 at fixed seeds cannot resolve that. As written the test either fails or gets tuned until it passes, which is worse.
- **Line 722 says `test-maps/broken/` does not exist.** It does — `test-maps/broken/BCC2-Rekawa.rms` and a `README.md`, created 2026-08-05 per CLAUDE.md. The doc's own instruction, "fold it in if and when it is created", is now due, and the corpus arithmetic (32 maps × 3 seeds × 4 counts ≈ 384) needs the extra file.

### S4. Sec.11's two budgets disagree by about 3× on the same configuration

- Line 671: 200×200, no snapshots, **≤ 40 ms**.
- Line 672: 1000 runs at 120×120, reports-only, **~5 ms/run**, and this is the number CREATION_PLAN 5.2's "seconds, not minutes" is quoted against.

Reports-only *is* `collectSnapshots: false` (Sec.7: "Reports are unconditional — there is no `collectReports` option"), so these describe the same work at two sizes. `120²/200² = 0.36`, so the 40 ms target scales to ~14.4 ms and the batch target is roughly three times tighter. Everything Sec.11 specifies is per-tile or per-candidate — typed-array passes, distance transforms, BFS masks, frontier draws — so area is the right first-order scaling.

This matters because the two numbers gate different things: 5.2's feasibility argument rests on the 5 ms figure, and Sec.11's own merge gate ("4.3 should report the measured number rather than assert the target") is written against the 40 ms one. If both stand, 4.3 will hit one and miss the other and have no rule for which to believe.

**Related, and uncosted:** Sec.10 rejects putting `refDb` in the message because it would "structured-clone ~111 KB of JSON on every keystroke burst", then puts the entire `ParseResult` in `PreviewRequest` on exactly the same schedule. For a corpus map the AST is comparable in size or larger, and it is already being cloned once by the parser worker. The argument against `refDb` is right (the data never changes); the ParseResult cost is real and unmentioned in a section that quantifies worker boot and module init.

### S5. Two `FailureBucket` members have no emitter — the merge gate failing in the direction Sec.7 didn't check

Sec.7 makes union completeness a merge gate and checks it one way: "a bucket a stage emits but the union omits is a test that can never be written". The other direction has the same consequence, because Sec.13 requires **one unit test per bucket**.

`borderBlocked` and `zoneAvoidanceBlocked` appear exactly twice each in the document: in the union, and in the disjointness paragraph that defines them as *single-placement* buckets. No stage in Sec.6 emits either.

- S1 land growth rejects on border and on `other_zone_avoidance_distance` (lines 267–280), and its terminal report is `growthShortfall` with `data.blocker ∈ {border, zone, space}` — which line 501 explicitly says is a *different* bucket domain.
- S1 neutral-land origin sampling rejects on borders and `min_placement_distance`, and its terminal report is `originFallbackCenter`.
- S6 objects carry `min_distance_to_map_edge` and `avoid_other_land_zones`, neither of which is routed to these names.

So two of the twenty buckets have an unwritable test. `pathBlocked` is a lesser case of the same thing — it appears only in the union, and Sec.6.6's `require_path` bullet describes the BFS without naming the bucket, so it is inferable but unstated.

**Fix.** Either name the emitter — the natural home is S1's origin-rejection path, reported per rejected candidate rather than only on exhaustion — or delete them and let `growthShortfall`'s `blocker` field carry it.

### S6. Sec.6.2's density amplification is not implementable as written, and it targets the wrong stage

The normative form draws seeds at 1.3:1 on the diagonal, then:

> apply the amplification as an explicit post-hoc weighting on **seed selection** fitted to the table, and mark it `[tune]`

Three things are missing and one is a category error.

Missing: no blend between the proportional regime (`≈ 585 × clumps/mapArea` above ~250 clumps) and the flat regime below it; no upper clamp, so a dense script on a small map computes an unbounded ratio; and no statement of what happens between the table's five points.

The category error is larger. **The table is a tile-ratio measurement.** Sec.6.2's own resolution, and the method note Sec.15 item 11 calls "worth more than the result", is *measure the stage you intend to model* — the whole six-sitting cost of item 11 was reading grown tiles and inferring a seeding rule. Instructing 4.3 to fit a **seed** weight to a **tile** ratio re-introduces exactly that convolution one layer down: our generator has its own growth and its own merging, so a seed weight of 7:1 at 500 clumps will not produce a tile ratio of 7.01 in our renderer, and nothing says whether the fit is supposed to land on the seed weight or on the observed output.

**Fix.** Say which quantity the fit targets and how it is checked. The self-consistent version: the amplification is fitted so that the *generator's own* tile ratio reproduces the five table rows, which makes the table an acceptance test rather than a parameter table. Give the functional form with its low-density blend and its clamp, and put the five-row reproduction in Sec.13's statistical block — replacing the stale south-bias test in S3.

---

## Minor

**M1. One misattributed line number.** Sec.3.1 cites `(guide:1002, "0 is for un-teamed players")`. Line 1002 is "negative values target a player NOT on the specified team"; the quoted sentence is **guide:1001**. Repeated in Sec.10's `PreviewSettings.teams` doc comment and in `src/generationSettings/generationSettingsConstants.ts:82`. Every other citation I resolved was exact: 135, 167, 356, 843, 844, 847, 849, 856, 885, 886, 887, 927, 1000, 1004, 1038, 1056, 1071, 1259, 1325, 1326, 1351, 1363, 1365, 1366, 1616, 1646, 1648, 1963, 1994, 2102, 2121, 2263, 2354, 2614, 2694, 2697, 2738, 2857, 3007, 3010, 3115, 3121, 3151, 3429, 3432, 3437.

**M2. Sec.6.4's `cf` table mis-summarises the guide line it cites.** The third row reads `above ~15 | outside the guide's stated useful range`. guide:1648 gives the moderate range as **5–25**, so 15–25 is inside it. The measured saturation at ~15 is the finding and it stands; the column is headed "Guide:1648" and should not carry a boundary the guide does not state.

**M3. Line 243's lead-in contradicts the table beneath it.** "Regimes follow guide:927 exactly, **which is *not* monotonic**" survives from the four-row table. guide:927's non-monotonicity *was* the 40+ directional regime, which lines 250–261 delete as measured not to exist; the replacement is two rows and an explicitly continuous ramp. Delete the clause.

**M4. Sec.12 item 9 is already done.** It requests a `notes` rewrite on the 29 `teamSize` labels and quotes the old "transcribed here as written… check it in game before adding it" text as current. All 29 entries now carry the derived-and-verified wording with the 45-candidate check written in. Strike it like items 1 and 2. (Item 4 is still live and correctly described — `terrain_size` really does declare `terrain`/`width`/`spacing` with the "Width/spacing of a terrain band" description.)

**M5. Corpus denominators have drifted, and three claims are now false.** Measured over `test-maps/*.rms` (32 files) today:

| doc claim | measured |
|---|---|
| `set_gaia_object_only` "32 of the 33 corpus files" (Sec.6.6) | 31 of 32 |
| `set_loose_grouping` "26 of 32 corpus maps" (Sec.6.6) | 25 of 32 |
| `avoid_actor_area` "used in all 32 corpus maps" (Sec.12 item 2) | **31 of 32** |
| `clumping_factor 100` "18 corpus uses" (Sec.6.1) | 17 tracked, 18 including `local/` |
| "2 of the 12 connection-using corpus maps omit `terrain_size`" (Sec.6.5) | 2 of 12 ✓ |
| "Three corpus maps write a bare `circle_radius`" (Sec.6.1) | 3 ✓ |

Cause: `BCC2-Rekawa.rms` moved to `test-maps/broken/` on 2026-08-05 and carried all four attributes. "All 32" is now literally false. Separately the doc uses three different denominators — 32, 33, and 52-with-`local/` for the `cf 100` count — without saying which. State the denominator once at the top, the way `parser-design.md:3` does.

**M6. Sec.3.6's "Verify item #18" is unsatisfiable.** It reads "implement whatever the in-game test showed, and leave a code comment pointing at it". The item lives in `docs/parser-design.md:438`, not Sec.15 where a reader will look, and it is **still open** — phrased there as a question, with no answer in the build log. Under a do-not-deviate banner that instruction has no referent. Either pin a default (truncation toward zero for all operand signs, matching the rest of the bullet) or add it to Sec.15 with the RMSTEST that settles it.

**M7. The one live `[verify]` is untracked.** Sec.6.6's "Tight is the default when grouping is active and neither mode is stated **[verify]**" (line 396) describes its own one-map test, but Sec.15's header now reads "CLOSED as of 2026-08-05 except item 5". It decides which branch of every rule in the section runs for any grouped command naming neither mode. Add it as item 17 so it is not lost behind a CLOSED banner.

**M8. Goal 4 promises cancellation; Sec.10 removes it.** Goal 4: "inside a web worker, debounced on code change, **with cancellation**". Sec.10: "**Cancellation: there isn't any in v1, and that is the right call.**" Sec.11 line 672 repeats "cancellable" for the batch path. Sec.10's reasoning is sound and should win; edit goal 4 to say "superseded stale requests discarded by id" and fix Sec.11's adjective.

**M9. Sec.6.1's negative-`circle_radius` branch is measured but not specified.** It gives mean 27.6% of `dim` and CV 0.44, then says "model it as a scattered draw, not a ring, and mark the parameters `[tune]`" without naming a distribution. `language.json`'s own note agrees ("Not yet modelled precisely"), so the data is honest and the spec is the gap. One sentence turns it into something 4.3 can write — note that a uniform radius on `[0, 0.55·dim]` gives mean ≈ 27.5% but CV ≈ 0.58, so a shape with a mode is needed to reach 0.44.

**M10. Sec.4's `mapSize → dim` lookup key is not unique.** The stated resolution is `category === "mapSize" && entry.mapSize === name → dimensions`. Every selectable size matches **two** entries, legacy and modern (`Tiny` matches `TINY_MAP` and `MAPSIZE_TINY`). They agree, and `validate:reference` asserts they keep agreeing, so a `find` is safe — but say "either entry; `validate:reference` asserts they agree", or the next reader files the duplicate as a data bug.

**M11. Out-of-range values that shipped maps actually use have no stated behaviour.** `de-official-map-issues.md:290` records `land_percent 1024` (`Crownwood.rms:173`) and `128` (`fortified_clearing.rms`, ×4) against a documented 0–100, and `land_position 100 100` at three sites in `Michi.rms` against a documented 0–99. Sec.6.1 computes `land_percent` → `P/100 · dim²` with no clamp, so 1024 targets ten times the map and every such land runs to frontier exhaustion and reports `growthShortfall` — probably the honest answer, but it should be written down rather than discovered. Sec.4's `round(X/100 · dim)` at `X = 100` yields `dim`, which is off-grid for `x ∈ [0, dim)`; state the clamp.

**M12. `TeamNumber` is redeclared in Sec.10.** Sec.10 imports `MapSize` "from generationSettingsConstants.ts", then declares `type TeamNumber = 0 | 1 | 2 | 3 | 4` inline — but `TeamNumber` is already exported from that same file (`generationSettingsConstants.ts:89`), with the cap's rationale in a comment beside it. This is the duplication Sec.10 forbids two paragraphs later for `Span` ("Duplicating the type is what let the comment drift, so don't"). Import both from one place.

While editing that: `generationSettingsConstants.ts` and `teamModel.ts` are both plain modules with no React/Tauri import, so `src/preview/generator/` can import them without breaking Sec.2's purity rule — but this is a new boundary crossing (`GenerationSettingsContext.tsx` next door is *not* importable), and it should be stated in Sec.2 rather than left for the lint rule of B2 to discover.

---

## Cheapest next actions, in order

1. **One RMSTEST for B1** — `min_length_of_cliff 2 max_length_of_cliff 2` against `3`/`3`, count cliff tiles. It is the only finding here that makes the preview lie about a shipped official map, and it is a single map on the existing instrument.
2. **The lint rule for B2**, landed with `rng.ts` and mutation-tested. It is twenty lines of config and it is the difference between goal 5 being a guarantee and a hope.
3. **The Sec.5 and Sec.6.1 stale-sentence edits (B3, B4)** — pure text, no new information required, and both are actively misleading under the do-not-deviate banner.
4. **The `playerInTeam` reachability check (S1)** — no instrument, guide only, and it either strengthens or corrects a rule that has been promoted to CLAUDE.md.
5. **Sec.13's three stale rules (S3)** before any test is written against them.

Everything else is text hygiene and can ride along with the next edit pass.
