# Seed-probe results

## 2026-10-08: DE build 101.103.54800.0, editor, Tiny (120), scenario format 1.59

Read from the saved scenarios with `read_probe.py`, using AoE2ScenarioParser 0.9.4 in `../.venv`. Format 1.59 needs 0.9.4; 0.8.3 stops at 1.58.

Checks: the dirt marker is at x 24–26, y 3–5, which matches (21%, 3%) of 120 as written, so no axis swap. Each terrain count is exactly 49 × the number of its letters. Terrain 2 is beach that DE adds around water; it never replaces water.

| Seed | DE (land 1 first, rows of 5) | genie-rms 1.0c prediction |
|---|---|---|
| 1000 | WWSSS FFWSW DDSFF DWDWW FSFFW | WWFDW WWSWD SWSFF SSWFD WDFFW |
| 123456789 | WDSDW SDDWW DSSSS WFFDD SWSSD | DFDFS DSSDD SWFSS SWDWS SSFSF |
| 242424 | DDSSS SDSSS WSSDF DFDWW DSWDD | |
| -1411066173 | WWWFS WWWDD WWFWW FFSWS WSWDS | |

(The unnamed `RMSTEST_seed-probe.aoe2scenario` is a duplicate of one of these, per the owner.)

Seeding directly doesn't reproduce DE. The full-state search results are below.

### Full-state search (`lcg_search.py`): no match for any seed under any of the 8 rules

The control passed (genie-rms seed 1000 recovers 1000). For all four DE maps, no MSVC-`rand` state reproduces the 25 choices under 1.0c, mod, mod1 or div32k, with either `<=` or `<`.

**Ruled out:** DE's parser taking its `start_random` values from *consecutive* outputs of the MSVC `rand` LCG with any of these range rules, whatever the seed transform and however many draws come before the first block.

**Still open:** a different generator (DE contains a Mersenne Twister and a 64-bit LCG); a different range or branch rule; or more than one draw per block (a second parse pass, or a hidden extra draw).

### Direct-seed tests (`direct_seed.py`): no match

Generators seeded with the editor seed (also seed−1 and seed+1): MSVC `rand`, `mt19937`, `mt19937_64`, the exe's 64-bit LCG (×6364136223846793005, +1, >>33), `minstd_rand0`, `minstd_rand`, and the Numerical Recipes LCG (full output and >>16).

Each was tried with 8 range rules (mod 100, mod 100 + 1, mod 101, multiply-and-shift ×100 / ×101 / +1, which covers MSVC `uniform_int_distribution` v1 (≈ mod) and v2 (Lemire multiply-and-shift); floor(u·100/max); float·100), both comparisons, 0–60 skipped draws, 1–3 draws per block, and which draw of the group is used. That's 140,544 hypotheses, and each must hold for all 4 maps at once.

- Control: on genie-rms's predictions it finds MSVC `rand`, seeded directly, k=0, s=1 (4 equivalent range rules).
- DE: **no full match**. The best partial score is 44/100, which is about the chance maximum for 140k tries (mean 25, sd ≈ 4.3).

### Full-state MSVC `rand` search with 2 and 3 draws per block (seed 1000): no match

The control was rerun first and passed. A real match would have to appear for seed 1000, and none did under any of the 8 rules.

## Conclusion so far (2026-10-08)

DE's script parser doesn't use 1.0c's generator in any arrangement tested. None of the generators known to be in the exe, seeded directly, reproduces it either. What's left is open-ended (a seed hash, an unknown generator, a different branch rule), so black-box guessing has reached diminishing returns.

## 2026-10-09: AoE2RMSIDE's generator reproduces all four maps

`well_check.py` re-states, in our own Python, the generator described in `crates/rms-semantics/src/target_rng.rs` of github.com/aoe2control/AoE2RMSIDE: a WELL512-style generator (16 u32 words, backwards-stepping index, shifts 16/15/11/10, a mask `0xFED22169` in the output step), seeded by xorshift32 XOR a hash-style mixer. The game seed goes through a chain: stream 1 is seeded from the seed, stream 2 from stream 1's first output, and so on. The random-map parser uses stream 2, after its first output has been used for the chain. A draw becomes a range by multiply-and-shift, `(upper * raw) >> 32`.

Result: **all 4 maps (seeds 1000, 123456789, 242424, -1411066173, 100 branch choices in all) are reproduced exactly** with stream ordinal 2, one draw per `start_random` block, and no skipped draws. The search covered ordinals 1–4, 0–2999 skipped draws, 1–4 draws per block and 9 range rules. Negative seeds work as the two's-complement u32. No other combination matched. Chance agreement on 200 bits is out of the question.

Not pinned down by this data: the exact range (`bounded(99)+1`, `(100)` and `(101)` all fit), because the probe only tests 25% bucket boundaries. A probe with an odd percentage (for example `percent_chance 37`) would pin the boundary.

Still unconfirmed: the order and number of draws in the land stage (the AoE2RMSIDE code tags land draws as `land-assignment-selection` and `land-zone-randomization`). The author's claim of 91–100% map matches on this build is consistent with this result.

## 2026-10-09: land probe (K header blocks, then 5 neutral lands without land_position)

Files: `RMSTEST_land-probe-k{0..3}_{1000,1001}` plus two K=0 runs at seeds -256560192 and -912785945, saved from the editor, read with `read_land_probe.py`, located in the draw list with `land_search.py` / `land_locate.py`.

**Confirmed (10 files, 10 of 10 numbers each, 4 seeds):** land positions come from the same stream (ordinal 2), two consecutive draws per land (x then y), `bounded(116)` plus base_size 2 (116 = 120 - 2*2), no retries seen, lands in script order. `create_land` without `land_position` places across the whole map, as the owner expected. (Bound 115/117/118 with other offsets also fit some numbers; only 116+2 fits all 10.)

**Not as predicted:** the first land position is not at draw 0 but at draw **11** (0-based, after the stream-2 fan-out draw) with an empty header, for all four K=0 seeds. So 11 draws are spent after the header blocks and before the first position. AoE2RMSIDE's model does not account for this. (Their code tags no 11 draws; it starts the land stage at the parser state.)

**Shift by K:** start index by file: seed 1000 K0..K3 = 11, 12, 12, 14; seed 1001 = 11, 11, 12, 14. Expected 11+K = 11, 12, 13, 14. **Re-saved 2026-10-09 (16:13-16:14) and re-read: identical maps to before, so the saves were not mislabelled and the shift is not simply +1 per block.** Start index by seed and K (0..3): seed 1000 = 11, 12, 12, 14; seed 1001 = 11, 11, 12, 14. Rolls of the header blocks (bounded(100), draws 0, 1, 2): seed 1000 = 4, 23, 73; seed 1001 = 75, 90, 89. Compared with 11+K, seed 1000 is one draw short at K=2, seed 1001 one short at K=1 and K=2, both exact at K=0 and K=3. So the draws spent before the first land position are not a fixed 11 plus K. Leading hypothesis (not tested): part of the prelude has a data-dependent length, for example a draw that happens only when an earlier value passes some test, as in a retry or placement loop in the player setup. K=3 and K=0 would then be coincidences of the particular values. Round 2 (norp, L2, L3, noav) is the next discriminator.

Round 2 (`make_land_probe2.py`) asks what the 11 draws are: lands L2/L3 (does it scale with land count?), `noav` (without other_zone_avoidance_distance), `norp` (without random_placement).

### Round 2 (seed 1000, K=0, 2 players): the 11 does not depend on the lands or on the PLAYER_SETUP lines

`land2-L2`, `L3`, `noav`, `norp` all place their lands at exactly the K=0 coordinates (W(52,84) D(102,114) S(60,9) F(42,2) m(14,104), as many of them as the script has). So the first land position is at draw 11 whatever the number of lands (2, 3, 5), with or without `other_zone_avoidance_distance`, and with or without the `<PLAYER_SETUP> random_placement` lines. Not the lands, then. `norp` is not a clean "no player setup" test: the lobby still has 2 players and placement is probably random by default.

Candidate: the players. DE places players before neutral lands in 1.0c, and placement is usually a rejection loop, which would make the draw count depend on the stream values (consistent with the K=1, K=2 shortfalls). Test: player-count sweep with `land-probe-k0`, seed 1000.

### Player-count sweep (seed 1000, K=0) and the explanation of the 11 (2026-10-09)

Start index of the first land position: 1 player = **9**, 2, 3, 4, 5, 8 players = **11**. So it does not scale with players; it drops by two only when there is a single player.

`prelude_check.py` restates the setup sequence found in AoE2RMSIDE's `lib.rs` (`shuffled_lobby_slots` + `preprocess_fixed_lobby_slots` + one more draw): a shuffle of 8 lobby slots (7 draws, `raw % n`), one draw, a second draw only with more than one player, a third draw only if `(second & 0x7fff) % 100 < 50`, and one final draw. That gives 9 draws for one player, and 10 or 11 for more, where 11 happens when the data-dependent test passes. **It reproduces the measured start index in all 15 cases** (4 seeds at K=0; seeds 1000 and 1001 at K=0..3, including the one-short cases at K=1 and K=2; seed 1000 with 1, 3, 4, 5, 8 players). One caveat: the shape (7+1+1+1) was picked after seeing 9/10/11, so the fit to 9, 10 and 11 is partly post hoc; the K=1, K=2 shortfalls and the 1-player value then came out right without further adjustment.

So the draws before the first land position are the **player-position setup**, which runs before the neutral lands even when the script creates no player lands, and its length depends on a draw value. Earlier guesses ("lands", "random_placement line") were wrong. Which exact branch of their setup code the lobby triggers (Direct / fixed-positions) is not pinned down; the sequence is the same either way for this probe.

## 2026-10-09: tie-break probe (`land3-tiebreak.rms`, base_size 0, N = 2, 3, 4, 5, explicit positions)

Prediction (written first, `land3-predictions.md`): plus shapes growing bottom, right, top, left. **Wrong.**

| Seed | DESERT (N=2) | SNOW (N=3) | FOREST (N=4) | DIRT (N=5, base (24,72)) |
|---|---|---|---|---|
| 1000 | nothing | nothing | nothing | (23,71) (23,72) (24,71) (24,72): a 2x2 block |
| 10001 | nothing | nothing | nothing | (24,72) (24,73) (25,72) (25,73): a 2x2 block |

Two facts: (1) the 2-, 3- and 4-tile lands leave no trace, and the 5-tile land is a 2x2 block (4 tiles), so very thin shapes are removed afterwards. That matches AoE2RMSIDE's base-terrain cleanup (a non-base tile with base terrain on both sides, left and right or above and below, is turned back to base terrain, repeatedly). (2) The 2x2 block differs between seeds, and includes a diagonal tile that is not a neighbour of the base, so growth is NOT "ring first, in fixed order" and it depends on draws already at N=5. My assumption that the cost-0 ring always pops before random-cost entries is therefore at least incomplete. Needs a faithful port of the growth loop (cost function, border and conformity draws) to explain it.

## Guide on land_conformity (reference-docs/definitive-rms-guide-2026-07-16.txt, lines 936-947)

DE only; -1..100; 0 = same as absent; negative = same as each other; **100 overrides base_size** (unless set_circular_base); "intended as a more potent version of clumping_factor"; buggy, advised to avoid. It "appears to take the tile count of the land, apply some math and set a new radius". This agrees with AoE2RMSIDE's `cleanup_radius` (radius from the tile count) and its use of that radius as the base when conformity >= 100. It says nothing about draws.

## 2026-10-09: port check of the growth loop against the tie-break shapes (`growth_port.py`)

Our restatement of AoE2RMSIDE's land growth (ring at cost 0, round-robin pops, border and conformity draws, priority draws, leftover cleanup, thin-shape removal) was run on the four-land tie-break script for every growth start draw 0..59, in two variants of the starting land sizes. Observed: seed 1000 gives only the 2x2 DIRT block (23-24, 71-72); the other file (named `10001`) gives only the 2x2 block (24-25, 72-73). Nothing at all for the other three lands.

- **Variant "version 0" sizes** (only land 0 starts at its base tile count, later lands start at 0, so they grow N tiles instead of N-1): matches both files, at draw 12 for seed 1000 and at draws 11 and 12 for seed 10001. Draw 12 = the 11 setup draws + 1 burned draw, which is what the model predicts. The file is seed 10001, not 1001 (1001 never matches).
- **Variant "version 1" sizes** (every land starts at its base tile count): **never matches** in 120 tries.
- Weakness: the target shapes are small, so 15 of 60 start draws match by chance for seed 1000. The match at draw 12 for both seeds is therefore only encouraging, not conclusive (about 1 in 16 by luck). The sizes variant is the stronger result.

Next, a larger shape as a real test: `land4-grow.rms` (one DESERT land, 25 tiles wanted). Predictions for seeds 1000, 1001, 1002 are in `land4-predictions.md`, written before any DE run: 13, 20 and 26 tiles.

### Growth probe result (`land4-grow.rms`, seeds 1000, 1001, 1002, saved 2026-10-10)

**All three predicted shapes were reproduced tile for tile** (13, 20 and 26 desert tiles; `growth_compare.py` reports identical sets). The predictions were written first (`land4-predictions.md`). So, for a single land with an explicit position, base_size 0 and 25 tiles wanted, AoE2RMSIDE's model of the growth loop matches DE: the burned draw (growth starts at setup draws + 1), the border draw and conformity draw per popped candidate, the conformity draw per neighbour, the priority draw per new neighbour (cost = priority - 8*cost + 250), the insert-before-equal queue rule, the leftover-frontier cleanup, and the thin-shape removal. Chance of this by luck is negligible.

Not yet covered: several growing lands at once (interleaving, shared zones), `land_percent`, borders and `border_fuzziness` near edges, circular bases, conformity (set aside by the owner), `clumping_factor` other than 8, `other_zone_avoidance_distance` other than 0, and the stages after land (elevation, cliffs, terrain, connections, objects).

## 2026-10-10: round 3, items 1 to 6 (19 maps, `compare_probes.py`)

**All 19 maps are identical to the predictions** (written first in `probe-predictions.md`, from `land_model.py`, which had been regression-tested on every earlier DE shape).

| Item | Script | Seeds | Result |
|---|---|---|---|
| 1 | p1-multi (4 growing lands, two colliding pairs) | 1000, 1001 | identical, every tile |
| 2 | p2-border (borders, border_fuzziness 20 and 5) | 1000, 1001 | identical |
| 3 | p3a-clump (clumping_factor 0, 25, 2, 12) | 1000, 1001 | identical |
| 3 | p3b-avoid (zones, other_zone_avoidance_distance 4 and 0) | 1000, 1001 | identical |
| 4 | p4-players (create_player_lands, 2 players, random placement, neutral land) | 1000, 1001 | identical (lobby teams assumed none) |
| 5 | p5a-rnd (rnd() in a #const, inline, inside an unselected branch) | 1000, 1001 | identical to hypothesis H1 |
| 5 | p5b-assign-rand / -ord (assign_to AT_TEAM -10, random and ordered) | 1000, 1001 | identical: random takes 1 parse draw, ordered takes none |
| 6 | p6-range-s1000, s1001 (40 blocks with weights on the roll) | 1000, 1001 | `<=` matches all 40; `<` fails; the control run (script 1000 at seed 1001) matches both, as predicted |

What this confirms in DE: several lands growing together (interleaving, shared zone, round-robin pops); border chance and rejection; clumping; zones and avoidance; player-land placement geometry and its draws (perimeter, jitter, per-player coordinate); neutral random positions after player lands including the middle-third rule; `#const rnd()` draws once at definition, every `rnd()` in all lines of a `start_random` block is evaluated (a draw each) before the block's roll, `rnd(a,b)` = `a + bounded(b-a+1)`; random `assign_to` = 1 draw, ordered = none; **a branch is taken when the roll (0..99, `bounded(100)`) is `<=` the cumulative weight**, so a branch with weight w is chosen for w+1 of the 100 roll values.

## 2026-10-10: round 4 (42 maps: players, teams, placement, circles, percent, zones, conformity, neutral positions)

`compare_probes2.py` and `regress_all.py` (all cached maps): **33 of the 42 round 4 maps are identical to the model, tile for tile.**

Identical: p4-players at 3, 4 and 8 players with no teams (and n4t1122 at seed 1000); a3-grouped with no teams and n4t1122 at seed 1000; a4-direct (direct_placement, assign_to_player with and without land_position, absent player removed); a5-assign (assign_to_player under random placement, lands for absent players); a6-circle and a6b-circlev (circle_radius 0 and 5 variance, seeds 1000 and 1001, 4 players); a7-behavior (behavior_version 1); b1-circular (set_circular_base); b2-percent (land_percent on create_land and create_player_lands); b3-zonerand (set_zone_randomly, 2 and 4 players); c1-conf (conformity 20, 50, 80, 99, -50); c2-conf-circ seed 1000; c3-conf100; d1-neutral (neutral random positions with conflicts, generate_mode, min_placement_distance). (Two scripts were saved as a7-behaviour and c2-conf-circle; the tools alias them.)

**Different (9 maps), by cause:**
1. **Team order in fixed-position lobbies (6 maps):** p4-players n4t1212 (seed 1000), n5t11022, n8t11223344, n4t1122 at seed 1001, and a3-grouped n8t11223344 and n4t1122 at seed 1001. The model's draw count is right in all of them (the neutral land is at the model's place), but the order of players within teams is not. Per-team ascending/descending flags that reproduce the maps (teams numbered by lowest slot): seed 1000 n4t1122 (asc, desc), n4t1212 (asc, desc), n8t11223344 (desc, asc, desc, desc); seed 1001 n4t1122 (desc, asc). In each, exactly one team is ascending and the rest descending; the model picks the wrong team in the failing ones. n5t11022 matches under no pairing and direction combination, so it has another difference (draw count). Variants tried (selected player = slot or slot+1, inverted direction) did not fix them. Next: `probe3-run-list.md` (single-pair maps at two seeds).
2. **Random team positions (n4r):** no offset of the setup draws reproduces it. Unknown which lobby setting was used; treat as unresolved.
3. **land_percent 100 on create_player_lands (b2b):** DE paints 14399 of 14400 tiles; the model leaves 473 tiles in pockets, because with a 14400-tile target the model's conformity radius (60) rejects tiles on a 1% draw. Any radius from 84 up leaves 0 to 7 tiles unmatched plus one tile (101, 1) that DE leaves unpainted and the model paints, so the radius for huge targets is not what the model says, and there is a second small difference.
4. **c2-conf-circ seed 1001:** two water tiles (76, 82) and (76, 83), a one-tile-wide notch, are painted by DE and not by the model. A variant where tiles painted in the leftover pass count as land for later tiles was tried and broke 25 other maps, so it is not that.

## 2026-10-10: round 5 (28 maps: objects test, size ladder, water, more seeds) and what it fixed

`compare_probes2.py`, `decode_seq.py`, `regress_all.py` (85 cached maps). **Now 74 identical, 11 different; all 11 are team-positions-ON maps with teams.**

**Fixes found (each confirmed against DE, nothing else regressed):**
1. **land_percent 100 is not divided between lands.** Two player lands with `land_percent 100` each get the whole map (14400) as target, not 7200. With that, the b2b map is identical (14399 of 14400 tiles). The earlier "conformity radius" idea was wrong. The single-land size ladder (1000, 2000, 4000, 7200, 14400 tiles; seeds 1000 and 1001; plus a 4000-tile land near a corner) is identical, so the conformity radius formula holds for big lands too.
2. **Water gets the same thin-shape cleanup as the base terrain, with water as the base.** A non-water tile with water on both sides, or in the diagonal patterns of the thin-shape rule, becomes water. All 16 water maps (c1, c2, c4-water and the others) are now identical, including the diagonal case. Desert twins (c4-desert) were already identical, so it is water-specific.
3. **Team positions OFF** (the lobby setting): the 7-draw slot shuffle runs, the team-order step (the three conditional draws) is skipped, teams do not group players, and the perimeter pass keeps its jitter. n4r and n4t1122r are identical. (My earlier "rejection" path for random positions was wrong.) It also shows that the three conditional draws are the Team Positions feature.
4. **The objects probe works:** `p4o-players` (a villager per player) lets us read which slot stands where. `decode_seq.py` decodes DE's slot order along the perimeter.

**Still open: the order of players inside teams when Team Positions is ON.** Decoded DE sequences (members listed in perimeter order):
- seed 1000, 4 players: teams 1122 -> [1,2 | 4,3]; 1212 -> [1,3 | 4,2]; 1221 -> [1,4 | 3,2]. Seed 1001, 1122 -> [3,4 | 2,1].
- seed 1000, 8 players, 1+2 3+4 5+6 7+8 -> [8,7 | 2,1 | 6,5 | 3,4]. Seed 1000, 5 players with 1+2 teamed -> [2,1 | 5,3,4] (the three unteamed players also change order).
- In all four 4-player maps the team that appears first in the shuffled order is ascending and the second descending; in the 8-player map three teams are descending and the last-appearing one is ascending. The draws feeding the step are d1 (direction), d2 and d3 (a selected player), which do not explain it in AoE2RMSIDE's reading. See `probe4-run-sheet.md` (23 maps) and `team_rule.py`.

## 2026-10-11: round 6 (team order, 8 and 6 players, land_percent budget; 39 maps)

**Team order solved for fully-teamed lobbies (Team Positions ON).** The selected player is `slot = (d3 & 0x7fff) % (players + 1)`, a player number 0..n where 0 selects nobody. AoE2RMSIDE's code uses `% players` as a 0-based index; that is the only change needed. With it, every 4-player (14 seeds, layouts 1122, 1212, 1221) and 8-player (7 seeds, layouts 1+2/3+4/5+6/7+8, 1+3/2+4..., 1+4/2+3...) team map is identical, and so is 6 players at seed 1003. The rest of the step was already right: d1 below 50 means the selected team descends and the others ascend, and the reverse for d1 of 50 or more; when d2 is 50 or more nobody is selected and all teams go one way (d1 below 50: all ascending, otherwise all descending), which six maps confirmed.

**land_percent for player lands: per-land share confirmed, joint budget rejected.** At 60 (2 and 4 players), 97 and 99 (two seeds) the per-land model is identical to DE and the joint-budget model is not (8838 vs 8845, 13765 vs 14145, 13972 vs 14379, 14327 vs 14371 tiles). So 100 is a true exception: each land targets the whole map.

**Still open:** (a) lobbies with some players on no team (5 players with one pair: 3 maps): the players with no team come out in a different order, an adjacent swap among them, and the selected player was one of them in both cases; (b) 6-player lobbies at seeds 1000 to 1002 (not 1003): villager positions for two slots do not fit the model's perimeter values, one looks like a position that is not wrapped; not yet explained. Not tested: 5, 6 or 7 players with no teams at all, which would show whether this is about player counts or about teams. One saved map has a mistyped lobby code (n8t121213434) and is ignored.

## 2026-10-11: round 7 (player counts without teams, partial teams; 11 maps, `seq_report.py`)

All 11 agree with the model on the order of players along the perimeter (`seq_report.py`: model and decoded DE order identical, villager fits within 3.5 tiles): 5, 6 and 7 players with no teams (seeds 1000 and 1001; 6 players also at 1002), and 4 players with only one pair teamed (1+2, or 3+4), at seeds 1000 and 1001. So the remaining mismatches are not about player counts, not about unteamed players in general (4 players with a pair and two singles is fine), and not about the selected player being unteamed.

Still different, 6 maps: 5 players with 1+2 teamed (seeds 1000 and 1001, plus the older t11022 map): the three unteamed players come out with one adjacent swap; 6 players with three pairs at seeds 1000, 1001, 1002 (not 1003). In the 6-player maps the decoded villager positions do not fit the model's perimeter values at all for two or three players; at seed 1002 three players (slots 4, 5 and 6, including the teammates 5 and 6) stand within about 6 tiles of each other near the top-left corner, which the spacing of the perimeter pass cannot produce. Unexplained; they look like a different placement for some team layouts.

Totals: 119 of 125 maps now agree with the model.

## 2026-10-13: round 8 (5-, 6- and 7-player team layouts, 19 maps) and a check of the saved teams

`seq_report.py`: SAME for 6 players with teams of three (1+2+3/4+5+6, three seeds), interleaved teams (1+3+5/2+4+6, three seeds), 1+2 and 3+4 with two singles (three seeds), one pair with four singles, 7 players with three pairs and a single, 5 players with two pairs and a single (seed 1001), and 6 players with three pairs at seeds 1003 to 1007. DIFFERENT: 6 players with three pairs at seeds 1000 to 1002 (not later seeds), 5 players with one pair (all four seeds), 5 players with two pairs and a single (seed 1000), 5 players with 1+2 and 3+4+5 (both seeds).

**The scenarios do contain the teams** (as ally stances in each player's diplomacy list; the list is 0-based, entry j-1 is the stance towards player j; `diplo.py`). All 68 p4o maps have exactly the allied groups their file name says (one file was mistyped as n8t121213434 and its saved teams are the intended 1+3, 2+4, 5+7, 6+8). So the lobby was set as labelled and the mismatches are not lobby slips.

`team_search.py` (which partition of the players into teams would make the model's player positions fit the saved villagers): for 5 players with 1+2 teamed, seed 1000, the fitting structure is 1+2 and 3+5; for seed 1001, 1+2+5; the 5-player map with 1+2 and 3+4 teamed (seed 1000) also fits only with 1+2 and 3+5. For the 6-player maps at seeds 1000 to 1002 no structure fits. Clues only: the unteamed players seem to behave as if grouped in these cases. The remaining 6 to 10 maps stay unexplained.

## 2026-10-13: first skirmish check (owner's screenshots)

The owner started a skirmish with the p4o-players script (Tiny, 5 players, Fixed Positions: Yes) and read the seed from Game Settings (Seed: 370167422; DE shows it there). Loading the same seed in the scenario editor (Seed Map, Team Positions ticked) gave the same map by eye: same snow and desert patches, same minimap with five coloured player dots. The model for this seed (5 players, with or without a 1+2 team: same prediction) puts the players at, in minimap fractions (u across, v down): blue (0.61, 0.70), red (0.76, 0.46), green (0.29, 0.71), yellow (0.53, 0.24), cyan (0.27, 0.43); read off the skirmish minimap by eye: blue (0.61, 0.71), red (0.76, 0.48), green (0.31, 0.73), yellow (0.54, 0.25), cyan (0.29, 0.45). All five agree within the eye-reading error, and the snow patch is where the model puts it (next to blue). So for this seed skirmish, editor and model agree. "Fixed Positions: Yes" in the skirmish is the editor's Team Positions option. The lobby teams of that skirmish are not known, and this seed does not separate the model from the editor either way (both team layouts give the same prediction), so it does not test the open 5- and 6-player cases.

Correction to the skirmish note above (2026-10-13, from the owner): the skirmish's lobby was p1 and p2 teamed, the other three players unteamed, i.e. the n5t11000 layout that fails in the editor at seeds 1000 to 1003. At seed 370167422 DE (skirmish and editor) matches the model. What differs from the failing seeds is that the selected player (d3 % (players+1)) is in the pair: draws for 370167422 are d1=33, d2=24, selected slot 1, shuffled order [2,1,3,5,4]; in the failing n5t11000 seeds the selected slot is an unteamed player (1000: 4, 1001: 4, 1002: 5, 1003: 5). This is the main clue for the open 5-player case.

## 2026-10-13: the open maps are stale alliances with unused slots (`inactive_allies.py`)

**Cause.** Every disagreeing map allies a player in the game with an unused slot (6, 7 or 8) in its saved diplomacy, left over from earlier lobby setups: 1000 n5t11000 (5-6), 1001 n5t11000 (5-6, 5-8), 1002 and 1003 n5t11000 (5-6), n5t11220 (5-6), n5t11222 (5-6), n6t112233 at 1000 to 1003 (5-8, 6-7), and `p4-players_1000_n5t11022` (saved as 1-2, 3-4, 4-5, 5-6, 7-8, not as its name says). `diplo.py` checked only the players in the game; it now also lists these. Both stance tables in the file (`per_player_diplomacy`, `player_data_3.diplomacy_for_interaction`) agree. No map without such an alliance disagrees.

**Lost players.** The maps whose villagers did not fit are exact when some players are never visited by the perimeter pass: they keep perimeter 0 (land centre x = 25, near the top-left corner; that is the seed 1002 cluster), and the jitter draws shrink accordingly. Every p4o map has a unique fit within 3.5 tiles (runner-ups 4.3 or more). Fitted DE orders: 1000 n5t11000 2,1,5,3,4; 1001 n5t11000 3,5,2,1,4; 1002 n5t11000 3,4,2,1 (5 lost); 1003 n5t11000 1,2,3,4 (5 lost); 1000 n6t112233 2,1,6,4,3 (5 lost); 1001 n6t112233 4,3,5,1,2 (6 lost); 1002 n6t112233 4,3,2,1 (5 and 6 lost); 1000 n5t11222 2,1,3,4 (5 lost); 1001 n5t11222 3,5,2,1 (4 lost).

**Rule found (restated, `land_model.preprocess_fixed_slots`, used when `VAR["slot_teams"]` is set from the saved diplomacy).** Teams are groups of slots linked by alliances over all 8 slots. In the team order step each team's list holds every member, unused slots included, but only the positions of players in the game are rewritten: the selected team's list is reversed, the first len(positions) entries are written, filling the positions from the last one when d1 >= 50. In the perimeter pass unused slots group with their allies, so an unused ally places its partner at the unused slot's place in the shuffle. With no unused members this is the lobby rule exactly; with them the selected team keeps its highest slots and the others their lowest, and a player can drop out.

**Result (whole land stage, tile for tile, plus the fitted order):** 59 of 63 p4o maps with 8-slot teams, 53 with lobby teams. Not explained: 1000/1001 n5t11222, 1000/1001 n6t112233 and `p4-players_1000_n5t11022`, all with alliance groups that are not cliques (no lobby can make one). A brute force over all 4140 partitions of the slots finds none that reproduces three of them under this rule. `regress_all.py` with the default settings is unchanged (108 identical, the same 6 different).

Search trail (scratchpad, not kept): ordered-subset fits of the villagers; enumeration of order arrays that reproduce each map; variant searches over team derivations (components, lowest/highest ally, scan orders), position and roster scopes, write rules and perimeter grouping (pairwise or by team). The truncating write was the only family that fitted the simple cases.

**Consequence.** The lobby rule in the model stands for real games. For editor tests, the unused slots must be allied with nobody before saving (or the model must be given the 8-slot teams). Two control maps are listed in `HANDOFF-open-cases.md` (Resolution).

## 2026-10-13: write-up `notes/de-land-stage.md`, checked by a second implementation

The land stage is written up in our own words for the preview revision (`notes/de-land-stage.md`). Two things came out of writing it:

- **The generator is two public algorithms.** Our restated generator is exactly WELL512 as published by Chris Lomont (2008), and the seed mixer is exactly Robert Jenkins' 32-bit integer hash: zero differences over 206 seeds × 300 outputs and 2000 hash inputs.
- **An independent check found one rule missing from the text.** `writeup_check.py` implements the write-up from its text alone (not from `land_model.py`) and compares with the saved DE maps. Its first run failed on the two `b1-circular` maps. The text had left out that a popped cell is refused when its 5×5 square holds no cell of the land's own zone (`n = 0`). That only happens for seeds that do not touch the land, such as the corner seeds of a circular stamp. The model had the rule all along; only the text was missing it. With the rule added, the second implementation matches DE on exactly the same maps as the model:
  - 108 of the 114 cached maps with lobby teams (the 6 others have stale alliances);
  - 59 of the 63 villager maps with their saved alliances (the 4 others have chained alliances).

Over all 146 saved maps from 34 probe scripts: 135 match as saved, 6 more match once the saved alliances are read, and 5 have chained alliances.

## 2026-10-17: round EC set up (elevation and cliffs), no DE maps yet

Elevation and cliffs are restated from AoE2RMSIDE (Apache 2.0, `crates/rms-engine/src/exact_elevation.rs`, `exact_cliff.rs`, `exact_cliff_piece.rs`, commit 210d977, read 2026-10-17) in `elevation_model.py` and `cliff_model.py`, chained after the land model by `stage_model.py`. Both stages continue stream 2 after the land stage; each burns one draw when its section is present. The piece table and terrain classes they need are in `de_tables.json` (DE 54800 data as AoE2RMSIDE projects it).

No saved map had elevation or cliffs at a known seed (the RMSTEST_63-75 extracts are flat and cliff-free), so 11 probe scripts were written (`probe_ec.py`, `el1`-`el6`, `cl1`-`cl5`), with predictions for seeds 1000 and 1001 written first (`ec-predictions.md`, `ec_predictions.pkl`). Run sheet: `elev-cliff-run-sheet.md`; comparison: `compare_ec.py` (all 14400 elevations, terrain-16 tiles, cliff objects by type and position).

Points in AoE2RMSIDE that the probes test and that look like deliberate copies of engine quirks: the unlink square around an elevation seed has its bottom edge at min(max_x, h-1) (`elevation_model.VAR["unlink_bug"]`); elevation lists are emptied by dropping their heads, so leftover nodes stay linked into the next layer; `spacing` skips layer 1 (which uses 2); the cliff walk's fallback directions are not a clean rotation. Water next to a cliff (bridging and shore repair) is not modelled; `cliff_model` refuses such maps.

Two checks without DE: every predicted map has neighbouring tiles at most one level apart, and `el1` (400 tiles asked) comes out at 419 and 409 tiles after smoothing, an overshoot of the size the preview spec measured on real DE maps (Sec.6.2).

### The elevation model reproduces the preview spec's unexplained hill bias (2026-10-17)

The age-of-rms calibration runs (preview-design Sec.6.2, `docs/elevation-bias-study.md`) found that DE's hills lean toward high y and low x and could not explain why ("mechanism unknown", five hypotheses rejected). `elevation_model.py` was not fitted to any of that; run on the same scripts (flat GRASS, `create_elevation 1 { number_of_tiles 2000 number_of_clumps 500 }`, three seeds each, stream position arbitrary):

| | DE (age-of-rms runs) | model |
|---|---|---|
| Tiny, elevated tiles | ~3080 (RMSTEST_22a) | 3029, 3096, 3071 |
| Tiny, mean x / mean y (fraction of 120) | 0.336, 0.350 / 0.634, 0.633 (22a, 22b) | 0.317-0.333 / 0.616-0.632 |
| 200 map, elevated tiles | 2433, 2479, 2535 (RMSTEST_35) | 2458, 2452, 2483 |
| 200 map, tiles y > x : y < x | 7.16 : 1 | 7.11, 7.31, 7.39 : 1 |
| default `create_elevation 1` on Tiny, tiles | 126, 128 (RMSTEST_14) | 123-132, mean 126 (20 seeds) |
| 200 map, 6 tiles per clump, y > x : y < x at 50 / 100 / 250 / 500 / 1000 clumps | 1.45 / 1.88 / 3.74 / 7.01 / 14.88 (spec Sec.6.2 table) | 1.3, 1.25 / 1.92, 2.07 / 3.33, 3.58 / 6.9, 7.18 / 14.85, 14.19 (2 seeds) |

Control: with `VAR["unlink_bug"] = False` (the square a new hill unlinks gets its bottom edge at min(y + r, h - 1) instead of min(x + r, h - 1)) the bias vanishes (mean x 0.48-0.50, mean y 0.48-0.50). So the lean is that one clipped square. Its rows run from y - r to min(x + r, h - 1), so a seed with y - x > 2r unlinks nothing at all, while a seed on the other side of the diagonal unlinks a full square. As seeds are taken, the shuffled list loses its candidates on the y < x side and keeps those on the y > x side, so later seeds land there. More clumps means more seeds taken, which is why the spec's ratio grows with clump density. This is statistical agreement, not a tile-for-tile test; round EC is the tile test.

### The age-of-rms calibration exports as data (2026-10-17)

`age-of-rms/tools/scenario-probe/generated-tests/` holds 235 exports of the RMSTEST calibration scripts (`../rmstest/`), many with elevation and cliffs. **They cannot be compared tile for tile: the seed is not stored in a scenario file** (checked: no parser field, and no 4-byte value tracks the seed between `p1-multi_1000` and `_1001`; the 1000 at header offset 25 is a constant in every file). A search over seeds is not practical (the elevation and cliff draws start about 30,000 draws in). They serve as statistical checks.

- **Cliffs restore their terrain.** The RMSTEST_31 exports (33-56 cliff objects) have no terrain 16. AoE2RMSIDE agrees: the cliff line tiles keep their old terrain on record and the terrain stage, which always runs, puts it back. `cliff_model.restore_deferred` now does this, and `compare_ec.py` compares the whole terrain grid. (Fixed before any round-EC map was saved.)
- **RMSTEST_45a/b/c** (200 map, GRASS, 20 cliffs, curliness 10, min_distance_cliffs 4). DE, read from the exports: 45a (length 2) 0 and 0 objects; 45b (length 3) 80 objects in 20 chains of 4; 45c (lengths 2-4) 36, 40, 40 objects in chains of 4. Model: 0; 80 in every run; 40-60, mean 44 (lengths are min + bounded(max - min), so 2 or 3, each 4 objects when 3). The build log's "66" for 45b is a misreading; the export has 80. Piece offsets in DE are the table's (1.5, 1.5) for straight pieces and 1.0/2.0 for corners. One weak hint: DE's 45b has 6 corner pieces, the model averages 2.9 (0-5 over 30 runs; P >= 6 about 8%). `cl2-curly` (curliness 100) will test turning directly.
- **RMSTEST_22b** puts `enable_balanced_elevation` at section level, outside the `create_elevation` block. AoE2RMSIDE ignores commands at that level, which fits the spec's finding that it "does approximately nothing" there.
- **Elevation, every single-layer calibration script** (`$TEMP`-side script, model at the export's map size, 3 seeds; DE seeds unknown). Elevated tiles / separate hills (4-connected) / mean x / mean y agree throughout, for example: RMSTEST_39 (200, 100 clumps, 600 tiles) DE 610-630 tiles in 89-97 hills, model 616-651 in 90-94; RMSTEST_40c (50 clumps, 5000 tiles) DE 5220-5275 in 34-38 hills, model 5231-5263 in 31-36; RMSTEST_41c (1000 clumps) DE 7988-8125 in 167-185 hills, mean x 0.34, y 0.64, model 8006-8304 in 149-181, x 0.33-0.35, y 0.63-0.64; RMSTEST_35 on Ludicrous (480) DE 2056-2080 in 469-477 hills, model 2061 in 469; RMSTEST_13 (25 tiles) DE 26, 26, 27, 26, model 25-26. Not matching: two of three RMSTEST_10 exports (851, 853 tiles against 428 and the model's 425-442), which look like an older version of that script (the generated-tests README warns about mid-sitting edits).
- **Seven layers, RMSTEST_32** (200, 60 clumps, 2000 tiles scaled by size, player lands not modelled): DE 1:3149-3656 2:1883-2006 3:1303-1503 ... 7:121-336, model 1:3091-3341 2:2006-2094 3:1330-1529 ... 7:174-423.
- **Six stacked commands, RMSTEST_50** (DIRT + SNOW halves, the model fed DE's own terrain from each export): DE 12,415 and 8,616 elevated tiles. Model with AoE2RMSIDE's leftover links: 12,389-18,123, half the runs at 12,389-12,441, one of which (1:3511 2:2164 3:1498 4:947 5:775 6:682 7:2864) is very close to DE's first export (1:3532 2:2550 3:1436 4:1135 5:735 6:553 7:2474). Model with clean lists (`VAR["stale_links"] = False`): 19,587-19,798 every time, with 6,700-8,300 at height 7 (DE 2,474 and 338). So the leftover links look real, but the model's other mode (one height swelling to 7,000-12,500 tiles) and DE's 8,616 are unexplained (two DE samples only, the second possibly an older script). Added probe `el7-stack` (three identical `create_elevation 4` on Tiny) to test this tile for tile; it separates the two list behaviours clearly.
- **Cliffs near lands (added on the owner's question).** The model keeps cliffs 7 cells (about 21 tiles) from the origin of every land, neutral lands included (AoE2RMSIDE clears around all land descriptors). Until now only the corner land at (1, 1) exercised this. New probe `cl6-players`: 2 player lands, a neutral land at (50, 50), 25-29 cliffs of length 4-6. Nearest predicted piece to each origin: seed 1000 p1 32.5, p2 22.5, centre 25.5 tiles; seed 1001 22.5, 30.5, 25.5. If only player lands were kept clear, the centre land would have cliffs at 7.5 (seed 1000) and 1.5 (seed 1001) tiles. Both readings are in `ec_predictions.pkl` (`cl6-players+playersonly`).

## 2026-10-17: round EC run: elevation and cliffs match DE tile for tile (33 of 33 maps)

The owner saved all 26 maps of the run sheet plus 7 extras (`el7-stack` at seeds 1002 and 1003; `cl5-header` 1002 on Tiny; `cl1-default` 1001 and `cl5-header` 1002 at sizes 168 and 200): 29 maps on Tiny, 2 at 168, 2 at 200. `compare_ec.py` (Tiny) and `compare_ec_sizes.py` (other sizes; predictions made at comparison time with `land_model.SIZE` set to the map size) check every tile's elevation and terrain and every cliff object's type and position.

**Result: every map is IDENTICAL under the expected reading**:
- el1-el6 (2 seeds each); el7-stack (4 seeds, 2 of them predicted only after the run);
- cl1-cl4 (2 seeds each); cl1-default at 168 and 200;
- cl5-header at 3 seeds on Tiny and at 168 and 200;
- cl6-players (2 seeds).

The predictions for the 26 planned maps were written before the run (`ec-predictions.md`, `ec_predictions.pkl`). Readings settled:
- **A bare `<CLIFF_GENERATION>` header makes default cliffs** (cl5, 5 maps; the "no cliffs" reading differs on every one). `probe_ec.predict` now defaults to this.
- **Cliffs keep clear of every land's origin, neutral lands included** (cl6; the player-lands-only reading shares 7-15 of about 150 pieces).
- **Unit position = tile position**, no axis swap: cliff objects sit at 3 x cell + the table offset.
- **The land model also holds at sizes 168 and 200** (the chained model is exact there: player setup, neutral lands, then the stages after).

Controls (`elevation_model.VAR`), on the DE maps:
- `stale_links = False` (every layer starts with clean lists) fails el7-stack at all 4 seeds (5,137-5,846 tiles differ), el3-layers 1001 (47) and el6-two 1000 (714).
- `unlink_bug = False` (the unlink square clipped at y + r) fails el2-clumps 1000 (1,017) and 1001 (814).

So both engine quirks are real. They are also what explained the preview spec's diagonal hill bias. el3-layers 1000, el5-players 1000 and el6-two 1001 do not depend on one quirk or the other: a quirk only matters when its situation arises.

Covered by these maps: the burned draw per section; the two-pass bucket shuffle; seed spacing and the unlink square; round-robin growth with avoidance draws and priority draws; smoothing; layers and the `spacing` rule (layers 2+ only); player-origin avoidance (el5); two and three stacked commands; `enable_balanced_elevation` inside a block (el6); cliff cells and eligibility; the count and length draws (max exclusive); the walk with curl draws and fallbacks; piece choice with look draws; clearing around paths and land origins; uniform-elevation cells (cl3); grass decoration draws on line tiles (cl4); restoring the line terrain.

Not covered: water or shore near cliffs (bridging and shore repair, `min_terrain_distance` against water); land `base_elevation` and `base_layer`; `set_scale_by_size`/`groups` (statistically fine on RMSTEST_10 and 32); negative `create_elevation`; `cliff_type` other than 0; sizes other than 120/168/200 in the chained model; an empty `<ELEVATION_GENERATION>` header (assumed to burn one draw, as AoE2RMSIDE has it).

### Write-up and second implementation (2026-10-17)

`notes/de-elevation-cliffs.md` writes both stages up in our own words for the preview revision. `writeup_check_ec.py` implements it from its text alone, not from `elevation_model.py` or `cliff_model.py` (the land stage comes from `land_model`, checked earlier by `writeup_check.py`). It reproduces DE on **all 33 round-EC maps** (29 Tiny, 2 at 168, 2 at 200). (Correction: earlier entries today said 36 maps; there are 33.)

## 2026-10-17: data sources, facings, beaches, and round EC2 set up

- **The terrain tables come straight from the game's dat** (`empires2_x2_p1.dat`, read-only, genieutils under Python 3.14 as in age-of-rms's `tools/extract-constants`). AoE2RMSIDE's "placement class" is the dat's `Terrain.is_water` field (equal for all 200 terrains). That is the "undecoded bitfield" age-of-rms's extractor mentions: bits 0x0F water-like, 0x10 shore (beach), 0x20 land, 0x40, 0x80 frozen (snow). The decoration lists are `terrain_unit_id` / `terrain_unit_density` / `terrain_unit_centering` (equal for all 200). The cliff styles are dat objects 264, 1849, 1858, 2178, 2069, 2651 (+0..8), class 34.
- **The cliff piece table is measured by our own maps.** All 20 joint shapes occur in the 33 round-EC maps (11 to 153 times each). Every one of the 1,126 cliff objects has the predicted type, position and facing (`initial_animation_frame` = the table's facet; the four two-look shapes show both looks). The table is engine logic, not dat data. `compare_ec.py` now checks facings and tile layers.
- **The end of the terrain stage, confirmed on the older water maps.** `cliff_model.finalize_terrain` beaches every shore candidate with shore water among its 8 neighbours (ice beach 37 next to frozen terrain). With it, all 14 earlier land maps with water (c1-conf 1000-1005, c2-conf-circ 1002-1005, c4-water 1001-1002, d1-neutral 1000-1001) match DE on every tile, beaches included (44 to 144 beach tiles each). Before, these were compared without beaches.
- **Model changes.**
  - `land_model.grow` tracks each land's `base_elevation` (stamp, growth, and every leftover tile that passes its conformity draw), and which tiles a land painted (they lose the base layer).
  - It spends the base terrain's decoration draws for every tile the cleanup restores to it.
  - A land of the base terrain counts as base in the cleanup.
  - `cliff_model` has the water repair around cliff lines (bridging to terrain 70, then 16; then shore painting in the box).
  - `stage_model` threads heights, layers and the readings still open.
  - `regress_all.py` is unchanged (108 identical, the same 6 different). `FRESH=1 compare_ec.py` still gives all 33 round-EC maps IDENTICAL, now with facings and layers.
- **Round EC2** (`probe_ec2.py`, run sheet `elev-cliff-run-sheet-2.md`, predictions `ec2-predictions.md` / `ec2_predictions.pkl`, written before any run). 9 scripts, 18 maps:
  - restored-GRASS draws;
  - land `base_elevation` with and without an elevation section;
  - LAND_GENERATION `base_layer`;
  - both scaling attributes;
  - cliff types CT_DESERT and CT_TERRACE;
  - water next to cliffs (also decides whether the water fill runs at the end of the land or the terrain stage);
  - cliffs crossing a non-base land (earlier terrain back, or the base terrain as the guide says).

  Every open reading is predicted both ways, and every pair differs on at least one seed.

## 2026-10-19: round EC2 run: 18 of 18 maps match one predicted reading (51 of 51 overall)

The owner saved all 18 maps of `elev-cliff-run-sheet-2.md` (Tiny, seeds 1000 and 1001; the optional `sc1` at 200 was not saved). `compare_ec.py` against `ec2_predictions.pkl`, written 2026-10-17 before the run:

| Script | Reading that matched | Rejected reading |
|---|---|---|
| gr1-restore | restored GRASS tiles spend 3 decoration draws each (19 tiles, 57 draws) | `+nodraws`: 967 and 1,044 elevation tiles and every cliff object differ |
| lh1-heights | the single reading (base_elevation 3 and 6; WATER land at 0) | — |
| lh2-alone | plateaus left raw without an elevation section | `+smoothed`: 933 and 978 tiles |
| ly1-layer | the single reading, saved tile layers included | — |
| sc1-scale | the single reading (300 → 432 tiles, 3 → 4 clumps) | — |
| ct1-desert, ct2-terrace | the single reading (base objects 1849, 2651) | — |
| wc1-water | `+fill-at-terrain`: the WATER cleanup runs at the end of the terrain stage | land-stage fill: 20 tiles at seed 1000 (incl. a terrain-70 tile DE has); seed 1001 same map either way |
| co1-overland | cliff lines get their earlier terrain (DIRT) back | `+tobase`: 247 and 125 tiles |

Every AoE2RMSIDE reading won. The scripting guide says cliff lines turn into the map's base terrain; that is wrong for lines across a non-base land (co1), right for lines on the base terrain. Checked 2026-10-19 (later the same day): restoring to the owning land's terrain instead also fails co1 (6 and 1 tiles), so it is the tile's own earlier terrain.

**Controls and side findings (run after the maps, `$TEMP` scratch scripts, not kept):**
- co1: DIRT's centered decoration (weight 10) costs 1 draw per cliff-line tile. With 0 draws both maps keep only 16 and 19 of ~175 cliff objects. That was the first test of a centered entry. Painting the 6,000-tile DIRT land spends no draws.
- wc1 water repair, as it fired in the matching model: the shore pass beached 64 (seed 1000) and 86 (1001) land tiles. Marker-70 bridging fired at seed 1000 only: 14 water tiles, 13 of them beached in the same repair, and the 14th is the terrain-70 tile in DE's map. The marker-16 repair never changed a tile.
- lh2: base-terrain tiles at the plateau heights. Seed 1000: 182 never painted (leftover cells whose roll passed but got no terrain) plus 39 painted and then restored by the cleanup. Seed 1001: 187 plus 28. Both kinds keep the land's height.
- ly1: DE's saved layers: SNOW on every unpainted tile, none on painted ones (DESERT land and DIRT land).

**Model:** `stage_model.run_all` now defaults to `water_fill_at="terrain"` (the other readings' defaults were already the winners); `probe_ec2.py` gained a `+fill-at-land` control. `FRESH=1 compare_ec.py`: all 51 maps identical with the defaults.

**Write-up:** `notes/de-elevation-cliffs.md` revised (new 3.0, 5.4 water repair, 5.7 order, Section 10 round summary). `notes/de-land-stage.md` Section 9 now records the WATER cleanup's measured place and the restore draws. `writeup_check_ec.py` extended from the revised text (layers, scaling, styles, water repair, end of the terrain stage, facings): **51 of 51 identical**, elevation, terrain, layer and cliff objects with facings.

## 2026-10-19: round ET set up (first terrain round + elevation/cliff leftovers), no DE maps yet

- **New model:** `terrain_model.py`, our restatement of AoE2RMSIDE's `exact_terrain.rs` (commit 210d977), chained by `stage_model.run_all(terrain=...)` after the cliffs and before the end of the terrain stage. `beach_terrain` reaches the beach rule through a per-tile zone. `FRESH=1 compare_ec.py` still gives 51 of 51 identical with it in the chain (the terrain stage's burned draw changes nothing visible).
- **Probes:** `probe_et.py` (25 scripts, 44 maps, `run-sheet-et.md`); predictions `et-predictions.md` / `et_predictions.pkl`, written before any run. `compare_ec.py` reads all three rounds.
- **Readings and controls added:**
  - `terrain_model`: `default_tiles`, `water_flat`, `negative_tiles`, `mask_swapped`, `beach_ignored`, `paint_decor`, `shuffle_bound_full`, `seed_square_half`;
  - `stage_model`: `cliff_restore="if16"` (and `"zone"`), `fill_zero`, `decor`, `paint_draws`, `elev_mode`;
  - `land_model`: `VAR["paint_draws"]`, plus land zones in `LAST_LAND`.
- **Settled from existing maps on the way:** cliff lines are restored to the tile's own earlier terrain, not the owning land's terrain. That reading fails co1 by 6 and 1 tiles.
- **Found while designing:**
  - Hills never reach the coast: layer 1's spacing square keeps 3 tiles from water and each layer adds one, so smoothing cannot raise a coastal tile. The late-fill height probe (`e4-hillwater`) therefore uses raised lands.
  - No layout tried makes the marker-16 cliff repair fire (wc band, fuzzy band, two lakes, 9 and 16 ponds, the coast probe).
  - The placement-class bit 0x40 is ICE's (ICE 0x60), not shallows (SHALLOW is 0x08). Write-up corrected.
