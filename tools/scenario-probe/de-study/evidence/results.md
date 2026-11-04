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

## 2026-10-26: round ET run: 44 of 44 maps match the primary reading

All 44 maps were generated and saved by script (Claude drove the editor window; see `tools/editor-automation/`, log `batch-2026-10-26.log`), then compared with `compare_ec.py` (the size-200 map included).

- **Every primary reading is IDENTICAL**, tile for tile and cliff object for cliff object, for all 25 scripts: Part A (`t1`-`t9`, seeds 1000 and 1001) and Part B (`e1`-`e5`, `wc2`, `ct3`-`ct5`, `gr2`-`gr5`, `pg1`, `ly2`, `ly3`, `sc1-scale` at size 200).
- **Every deliberately wrong control is DIFFERENT**, except `t1-forest+square-half` at seed 1000, which the run sheet already said gives the same map there (it differs at 1001).
- **So AoE2RMSIDE's readings are confirmed** for: the default `number_of_tiles` (120, not 122); negative `number_of_tiles`; `set_scale_by_size/groups`; WATER flat-only; `beach_terrain` used; `terrain_mask` meaning (not swapped); every cliff-line tile restored at the end of the terrain stage (not "if terrain 16"); FOREST seed square (full, not half; draw bound W-1); negative `create_elevation` removes layers; empty `<ELEVATION_GENERATION>` burns a draw and smooths; raised coast tiles keep their height under the late fill; `base_layer` written before `base_terrain` is dropped; unpainted tiles carry a GRASS layer when there is no `base_terrain` line; restore draws per base terrain (DIRT 1, GRASS2 15, GRASS3 6 with weight-0 entries free, FOREST 0); painting GRASS spends no draws.
- Still not covered: the marker-16 water repair (no layout fires it), randomized decorations at weight 1000, and the leftovers listed in `run-sheet-et.md`.
- Tooling: `compare_ec_sizes.py` built 3-value cliff tuples and crashed once `compare_ec.py` expected 4 (facing frame); fixed.

## 2026-10-27: terrain write-up, one control added after the run

- **No beach pass after each `create_terrain`.** Control run after round ET (scratch script, not kept): `terrain_model` with the end-of-stage beach rule also run after every pass. t7-water (WATER pass, then a DIRT pass on DESERT with `beach_terrain DLC_BEACH2`) then differs from DE in 562 tiles (seed 1000) and 571 (seed 1001); without it both are IDENTICAL. Overturns preview-design rev 10 Sec.6.4's per-command beach step. A pass just before the first `create_terrain` is still untested (no Part A map has water before the terrain stage).
- **Write-up:** `notes/de-terrain-stage.md` (Sections 1-13). `de-elevation-cliffs.md` revised for Part B (new Section 11, Section 8 rewritten, the *Untested* notes updated).
- **Second implementation from the text:** `writeup_check_et.py` (create_terrain and the end of the stage written from `de-terrain-stage.md`; land, elevation and cliffs from `writeup_check_ec.py`): **18 of 18 terrain maps identical**, first run.

## 2026-10-27: round GP set up (the gaps after round ET), no DE maps yet

- **Probes:** `probe_gp.py` (17 scripts, 34 maps; Part M below adds 6 scripts and 12 maps, `run-sheet-gp.md`); predictions `gp-predictions.md` / `gp_predictions.pkl`, written before any run. `compare_gp.py` compares them (lobby codes and sizes in the file name).
- **What it covers**, picked from the three write-ups' "Not tested" lists for how often real scripts hit them:
  - Part X: one real-shaped script (player lands by percent with fuzziness and avoidance 7, a lake, a randomly placed neutral land, scaled hills, default cliffs, three terrain passes) at 200 with 4 players and at 220 with teams 1122. The first test of players at a size other than Tiny.
  - Part L: `circle_radius` with teams; `other_zone_avoidance_distance` 6, 9, 12; `create_land` with no amount; `start_random` with no branch, an empty block and weights over 100; `behavior_version 2`.
  - Part E: `base_layer` on `create_land`; overlapping raised stamps; `create_elevation` with 9999 clumps (at 252); both scale keys in one block.
  - Part T: a beach pass before the first `create_terrain` (the `base_terrain BEACH` idiom); flat-only WATER at spacing 0; `base_terrain` + `base_layer` (preview item 27); both spacing attributes (item 42) and a negative `clumping_factor`; a later pass over `beach_terrain` tiles; `number_of_tiles 0`; `create_terrain` with 9999 clumps (at 252).
- **Readings added** (all off by default): `terrain_model` `clump_cap`, `zero_none`, `base_either`, `flat_self`, `beach_sticky`; `stage_model` `land_layers`, `beach_before_terrain`; in `probe_gp.predict`: an exact 2/3 avoidance factor, the elevation clump cap, the `start_random` readings.
- Every reading's map differs from the main one at both seeds, except `gl2-avoid+exact23` at seed 1001 (same map; it differs at 1000).
- **Left out:** rules our model has no reading for (`set_zone_by_team`, zones −11/−12, several `create_player_lands`, random `assign_to`'s pick, `override_map_size`, `beach_terrain` with connections), the marker-16 repair (no layout), the terrain stage's burned draw without a section (not observable yet), and rare settings. See the run sheet.
- **Part M added the same day (12 more maps, 46 in all):** two `create_player_lands` commands (`gm1`), which player `assign_to AT_TEAM` picks (`gm2`, `gm3`; owners read from villagers), `override_map_size` 144 and 100 from a Tiny lobby (`go1`, `go2`), and go1's script without the override saved at Small (`go3`, should equal go1 at 1000). Readings restated from AoE2RMSIDE's `lib.rs` / `exact_land.rs` (210d977), read 2026-10-27: each player land gets its own perimeter place and jitter draw; one parse-time draw per random `assign_to`, bounded by the slot-sorted candidates not yet picked; the override is a square size for every stage. `land_model` now keeps one position per player land (`BY_LAND`; `VAR["share_player_pos"]` is the old behaviour, kept as gm1's control).

## 2026-10-27: round CO models, Part 0 run (no new DE maps), predictions written

- **Models** (restated from AoE2RMSIDE at 210d977; data from its content pack for our build, `de_content_54800.json`): `appearance_model.py` (the terrain's own objects through every stage), `connection_model.py`, `object_model.py` (main paths; it reports what it does not cover). `land_model` and `cliff_model` gained a hook (`APPEAR_HOOK`) so their appearance draws make real objects; with no hook attached they behave as before.
- **Part 0a/0b, `compare_part0.py`: 95 of 95 saved EC/EC2/ET maps identical**, every terrain object by type, position (1e-4 tile), facet and status, in the file's creation order. 40 of the 95 hold terrain objects; 22 of those have no `<TERRAIN_GENERATION>` section, so **the terrain stage burns its draw without the section** (settles round GP's "not observable" item). Controls on t1-forest 1000 and gr1-restore 1001: `+noburn` 29 and 1 identical, `+aux-on-primary` 11 and 0.
- **Part 0c, `compare_part0c.py`: 55 of 66 p4o maps identical** (terrain objects and the 3 villagers per player: type 83/293, owner, position, angle). These are all the maps whose land stage matches; the 11 others are the stale-alliance land maps. One file (`n8t121213434`) has an unparseable lobby code.
- **Learned on the way** (each as AoE2RMSIDE has it):
  - restored land-cleanup tiles make real objects with a stream-6 draw each, also on a FOREST base, which spends no main-stream draw (gr5-forest failed until this was modelled);
  - objects retired at the object stage stay in the saved file with status 7;
  - the file stores a random-angle unit's angle (sector × 2π/16), not the facet (sector shifted by π/4).
- **Predictions:** `probe_co.py write` → `co_predictions.pkl`, `co-predictions.md`: 56 maps, main reading plus 69 variant predictions, 66 of which give a different map (the 3 that do not: cn5a `+open`, cn5b `+both`, cn8c `+no-shoreline-pass`, all expected). Changes made so the probes can tell their readings apart: cn5's blocked land moved to the corner (`land_position 0 0`; in mid-map the land cleanup deletes a one-tile land); ob9's relics at `min_distance_to_players 40` (at 25 they landed far enough by chance); controls added: cn6b `+isolated`, cn8c `+guide-breaks`. The `+frozen` control now also freezes the replacement table, as the preview means it. NOT MODELLED: actor areas (ob7), class filters (ob5, xr1 from its fourth descriptor), specific lands (ob8), `force_placement` and `min_connected_tiles` (ob10), walls (ob13).

## 2026-10-28: round GP run: 46 of 46 maps match one predicted reading

`compare_gp.py` (output kept as `cmp_gp.txt`). All 46 maps of `run-sheet-gp.md` are saved (Claude drove the editor for most of them; `tools/editor-automation/`).

- **44 maps match the primary reading** tile for tile (terrain, elevation, layer; owners from villagers on gm2/gm3). **The other 2 (`ge1-landlayer` 1000, 1001) match their variant `+ignored`.** Every control differs, except `gl2-avoid+exact23` at 1001, which was predicted to give the same map.
- **Part X:** `gx1-real` at 200 with 4 players and at 220 with teams 1122, both seeds: identical. This is the first test of players at sizes other than Tiny, through land, elevation (scaled by groups), default cliffs and three terrain passes.
- **Part L:** `circle_radius` with teams (gl1) as modelled. Avoidance 6, 9 and 12 with the trimmed rows and the just-under-2/3 factor (gl2; exact 2/3 fails 1000 by 1,214 tiles). A land with no amount is `land_percent 100` (gl3; zero fails by ~14,000). `start_random`: no branch taken, the empty block spends its draw, weights over 100 are a running total (gl4; both controls fail both seeds). `behavior_version 2` is like 1 (gl5; v0 fails by 105 and 122).
- **Part E:** **`base_layer` on `create_land` is ignored** (ge1: the saved layers are empty, no hills grow; AoE2RMSIDE's reading, the land's tiles carry it, fails by ~400 raised tiles). Overlapping stamps: later writes win (ge2). 9999 elevation clumps capped at 999 (ge3). Both scale keys: the later wins (ge4; first-wins and both fail).
- **Part T:** **no beach pass before the first `create_terrain`** (gt1; with one, 127 and 87 tiles differ). Flat-only does nothing at spacing 0 (gt2; fails by 3,325 and 2,111). `base_terrain` + `base_layer` both must hold (gt3; either fails by ~11,770). Both spacing attributes apply (gt4). A later pass clears the beach mark (gt5). `number_of_tiles 0` paints the seeds (gt6). 9999 terrain clumps capped at 999 (gt7; uncapped fails by 5,688).
- **Part M:** two `create_player_lands`: every land its own perimeter place (gm1, 4 maps; `+shared` fails by 860 to 1,650 tiles). Random `assign_to` picks: one draw over the slot-sorted candidates not yet picked (gm2, gm3; `+reuse` fails all 4). `override_map_size` 144 and 100 from a Tiny lobby (go1, go2), and go1's script at Small without the line equals go1 (go3).
- **Write-ups updated** (2026-10-28): `de-land-stage.md` (revision note, Sections 3, 4.4, 4.6, 4.9, 6.2, 6.7, 8.4, new 8.5, 11), `de-elevation-cliffs.md` (3.0, 3.1, 8, 9), `de-terrain-stage.md` (1, 2, 4, 6, 9, 11, 12). The `writeup_check*.py` second implementations were not rerun on the GP maps.

## 2026-10-28: round CO run: 23 of 56 as predicted; six rules found after the run explain all but the unmodelled maps

`compare_co.py` (output kept as `cmp_co.txt`, run by the owner 2026-10-28). Breakdown by object type: `diag_co.py`. All 56 maps of `run-sheet-co.md` are saved.

**First, a bug in our predictions:** `probe_co.model_inputs` passed `create_elevation`'s `base_terrain` as an id where the elevation model compares names, so xr1 was predicted flat (6,860 terrain and 1,269 elevation tiles off). Fixed in `probe_co.py`, and the two xr1 entries in `co_predictions.pkl` are re-predicted (the old file is not kept). No other CO script has an elevation section. With the fix, **xr1's terrain and elevation are identical at both seeds**: 4 players in teams at 200, a lake, hills, forest, team roads through forest and SHALLOW fords across the lake.

**As predicted (main reading): 23 identical, 33 different.**
- **Connections, 21 of 26 identical:** cn1 (best-first path, 8 directions, start painted, target not), cn2 (rectangles with 4 side draws; the disc and one-draw readings fail), cn3a/cn3b (default `terrain_size` 1 0; variance 0 still draws), cn4 (cost 0 detours, a float cost crosses, no corner cutting), cn5a/cn5b (**a cost-0 origin blocks arriving only**; the preview's BUG-029 "both" fails), cn6b (`accumulate_connections`: all live), cn7a (teams; no teams connects nothing), cn7b (**`same_land_zones` = `all_lands`**; the preview's by-zone fails), cn7c, cn7e, cn8a (**beaches after the connections, 8 neighbours**), cn8c (the shoreline pass leaves `beach_terrain`'s DLC_BEACH2 alone; the guide's "breaks" fails), cn9 (the section burns a draw). All controls fail.
- **Connections, 5 different:** cn6a (2 tiles at both seeds), cn7d (7 and 103 tiles), cn8b (5 extra decorations in DE).
- **Objects, 2 of 28 identical** (ob2a 1000, ob2b 1000). On most of the rest every object is at its predicted position, and the differences are facings, file details or one object type (below). Controls that fail on positions: ob1 `+window-full` and `+uniform`, ob2a `+scan-order` and ob2b `+flag-adds-shuffle` (so **the candidates are always shuffled**), ob3 `+ties-unshuffled` and `+square-band`, ob4 `+tight-default` and `+tight-anchor-only` (the preview's tight-checks-the-anchor reading), ob9 `+noexpand` and `+relic-ignores-players`, ob11 `+first` (**the later scaling key wins**).
- **NOT MODELLED, saved as observations:** ob5, ob7, ob8, ob10, ob13 (9 maps), and xr1's objects from its fourth descriptor.

**Six rules found after the run** (`posthoc_co.py` applies all six; output `cmp_co_posthoc.txt`). None was predicted, so each needs fresh maps before it counts as tested:
1. **Connections: a command's undo restores the value from before a tile's last paint** (`connection_model` reading `undo-last`). Commands are isolated as before, but the isolation is an undo: each painted tile gets back the terrain it had before the command's *last* paint of it. A tile painted twice in one command therefore keeps the first paint's result for later commands (their searches, sizes and replacements). That explains cn6a (the second command finds the first command's DESERT on the 2 tiles where the first command's two paths overlap) and cn7d (to_nonplayer's copies paint the same road twice; the last command then reads ROAD's default size 1 and covers the whole road band). **With it, all 26 connection maps and both xr1 maps are identical in terrain.** Two other readings were tried and rejected: `paint-live` (sizes and replacements from the live map: fixes cn6a, breaks cn4, cn7d, cn7e and xr1) and `replace-live` (only replacements live: fixes cn6a, breaks xr1).
2. **The end-of-terrain-stage beach pass destroys no objects** (only a restriction that refuses the new terrain does). cn8b's 5 extra objects are land-cleanup grass decorations on tiles that became BEACH. With the fix cn8b is identical, and Part 0 stays at 95 of 95.
3. **FORAGE (59) draws a random facet over 4 facets from stream 6.** The content pack gives it 1 facet and no draw. The missing draw shifted every later stream-6 facing (the angles of DEER, BOAR, SHEEP and TURKEY after a FORAGE in ob3, ob4, ob6). With 4 facets, ob3 and ob4 become identical, angles included. 3, 5 and 8 facets fail.
4. **Decorations under a newly placed object are deleted**, not kept at status 7. (Status 7 stays right for Part 0's retirement by the terrain's own table.) This accounts for every "predicted only, status 7" object on ob1, ob2a, ob3, ob4, ob6, ob9, ob11 and ob12.
5. **Group weights: an entry is kept when its weight is at least the roll** (`+weight-ge-roll`, AoE2RMSIDE's other profile; the main reading, at most the roll, puts only 36 and 37 of 120 objects in the right place). ob6 is identical with it.
6. **The scenario file leaves out child objects** (the town centre's parts 618, 619, 620, 890, 1649), **and stores a different frame for fixed-facet objects**: 0 for TOWN_CENTER and HOUSE (predicted 7), 5 for FISH, SHORE_FISH and SALMON (predicted 7). The comparison drops the children and ignores those frames. This is about what the file stores, not about the generator.

**With all six: 42 of 56 identical.** Of the 14 left, 11 are NOT MODELLED maps (ob5, ob7, ob8, ob10, ob13, xr1 ×2; xr1's terrain objects all match at 1000). The other 3 differ by one object type each:
- ob12 (both seeds): **player-owned STONE without `set_gaia_object_only` is not created**, but its placement draws are spent (every later object matches). The run sheet expected "places nothing" from an in-game check; our model created it.
- ob9 `n2-brit-azt`: **the editor saves SCOUT as Scout Cavalry (448) for an Aztec player**, where the model gives Eagle Scout (751), at the same position and angle. The file's civilization for player 2 is Aztecs.

So on every modelled map, every object is in its DE position once rule 5 is applied, and after the six rules and these two observations every object matches.

**Still open in CO:** the 11 NOT MODELLED maps (actor areas, class filters, specific lands, `force_placement`, `min_connected_tiles`, walls); a confirming round for the six post-hoc rules (new seeds of cn6a/cn7d-type overlaps, a forage-then-deer script, a coast with restored grass); what the file stores for fixed facets in general.

## 2026-10-28: round CO's rules made model defaults; round CF set up (39 maps), no DE maps yet

- **Defaults:** the six after-the-run rules and the two single-object observations are now the models' defaults, with the old rule kept as a control reading each. `connection_model` `undo-entry`; `appearance_model` `beach-destroys`; `object_model` `atmost`, `forage-fixed`, `retire-keeps`, `owned-stone` (new `owned-mines`), `civ-replace`, `fixed-facet`. `probe_co.predict` leaves out child and dropped objects, and `compare_co` does not compare a facing predicted as None. **With fresh predictions all 45 modelled CO maps are identical** (`FRESH=1 compare_co.py`); Part 0 stays at 95 of 95 and 55 of 66. `co_predictions.pkl` keeps the predictions made before the run.
- **Round CF** (`run-sheet-cf.md`, `probe_cf.py`, predictions `cf_predictions.pkl` / `cf-predictions.md`, compare and measure `compare_cf.py`): Part K confirms the rules on new layouts and seeds 1002/1003 (every control differs except k7's two at `n2-brit`, where the model places no player-owned resource); Part L asks whether `base_layer` on `create_land` lets elevation or terrain tell two DIRT lands apart (the owner's reading, `+land-layer`); Part U lays out every unmodelled object attribute for measurement against the guide.
- **Already measured on CO's observation maps** (details in the run sheet): `avoid_forest_zone N` / `avoid_cliff_zone N` keep more than N tiles (Chebyshev) from trees / cliff pieces; `place_on_forest_zone` puts objects exactly next to a tree; `force_placement` placed 9 of 15 sheep on a 3×3 land, one per tile; palisade walls form a square ring at exactly the minimum distance; `min_connected_tiles` groups cluster near the top edge.
- **Plumbing:** `probe_co.model_inputs` now reads `base_layer` at the top of `<LAND_GENERATION>`, on `create_land` (keyed by the land's zone), and in `create_elevation`; `stage_model` accepts zone keys for `land_layers`; `predict` returns land origins and passes an appearance reading.

## 2026-10-28: round CF run (39 maps; full output in `cf_run.txt`)

Claude saved all 39 maps through the editor (Tiny, Team Positions, seeds 1002/1003; lobbies n2, n3, n2-brit, n4-brit-azt-inca-gurj). Predictions were written before the run.

**Part K (confirmations): 11 of 13 families as predicted, two refuted.**
- Main reading identical, every control differing, on both seeds: k1-overlap (undo keeps the value before a tile's last paint), k2-nonplayer, k3-coast (beaches keep grass decorations), k4-forage, k6-groups (weight >= roll), k8-civs (every civilization saves Scout Cavalry 448; the controls `civ-replace` differ). k9-fixed identical (its stored frames are measured, below).
- k10a same_land_zones and k10b all_lands: identical maps on both seeds, as the guide and AoE2RMSIDE say; `+by-zone` (the preview) differs by about 950 tiles.
- **k5-retire (refuted in part):** objects match the main reading exactly (decorations under GOLD, STONE, RELIC, gaia HOUSE are deleted, `retire-keeps` wrong), but terrain differs in exactly 24 tiles on both seeds (predicted 27, saved 0). 24 = 6 gaia HOUSEs x 4. u10-noop (3 gaia HOUSEs) differs in exactly 12 tiles the same way and in nothing else. **New rule (unconfirmed): a gaia HOUSE paints no foundation terrain** (player-owned HOUSEs do: k9 identical).
- **k7-owned (refuted):** at n2-brit all three readings match (the model places none). At n2 (random civs) the saved map holds only the 6 SHEEP (3 per player): **no player-owned STONE, GOLD, FORAGE, DEER, BOAR, OAKTREE or RELIC exists**, so neither `owned-stone` nor `owned-mines` is right (predicted 24-32 objects, saved 6). Open: whether draws are still spent (the objects after them are in the same places only for the first 2).

**Part L (`base_layer` on `create_land`): ignored, on all three layouts.** ll2 and ll3 identical to the main reading; ll1's terrain, elevation, layers and decorations are identical, and `+land-layer` fails by 123 tiles, 225 elevations and 426 layers. The owner's reading does not hold here. `create_object GOLD { layer_to_place_on SNOW }` placed 0 (no tile carries SNOW), so the 15 predicted GOLD are absent, which is the only ll1 difference.

**Part U (measured; objects of unmodelled attributes differ by design).**
- Guide holds: forest and cliff zones (`avoid_forest_zone 3` min 4 away, default min 2, `place_on_forest_zone` exactly 1, `avoid_cliff_zone 3` min 4-5, default min 2-3, grouped min 3-5), actor areas (STONE min 15 from a r12 area, FORAGE min 15-16 from the r14 TC areas, HOUSEs within 12-13 of their TC, DEER outside all areas), `generate_for_first_land_only` on land ids (STONE 3 on the first), land 8 + `avoid_other_land_zones` (6 on LEAVES), `max_distance_to_players 5` (4 + 4), id -11 (3 anywhere), `layer_to_place_on` (u9: 20 GOLD on terrain 14/layer 32, STONE and FORAGE on terrain 0/layer 14), `min_connected_tiles 40` (GOLD only on clumps of 61-62; seed 1003 had no clump >= 40 and placed none; the STONE control used clumps of 30), `resource_delta`, `set_gaia_unconvertible`, `set_building_capturable` change nothing (u10).
- **`actor_area_to_place_in 1` on GOLD placed 0** (u1, both seeds; the guide says every GOLD within 6). Unexplained (ob7 round CO placed them).
- **`place_on_specific_land_id 7` without a distance: 6 GOLD, all on the first id-7 land (up to 44 tiles from its origin), none on the second.** The guide says 3 on each.
- **BOAR per player + `generate_for_first_land_only`: 2 in total (one DIRT land) instead of 2 per player.**
- **`force_placement`:** DEER per player within 2: 80 placed on 54 tiles (stacking, as the guide says). SHEEP on the 3x3 land: 0 placed (ob10 placed 9 of 15, one per tile) and forced GOLD 0 placed: unresolved, perhaps a count above the free tiles places none. TURKEY control: 9 on 9 tiles.
- **Walls: the ring is at exactly the minimum, as an exact Chebyshev square:** PALISADE_WALL at 12-13 gives 76 pieces at Chebyshev 12 (both players); STONE_WALL at 20-21 gives 95 and 105 pieces at 20. (ob13: 14 and 14.)
- **`require_path`:** seed 1002 identical to the model without it; seed 1003 moves 2 of 26 objects. The path-length measurement printed nothing (`compare_cf.py` bug or no object qualified): to check.
- **Stored frames (k9):** TC, HOUSE 0; GUARD_TOWER, OUTPOST, WATCH_TOWER... (see the "facings stored" line in `cf_run.txt`): 53, 69, 450, 457 store frame 5; 70, 79, 109, 234, 345, 598 store 0.
- u2-forestcliff differs in about 2900 tiles on both seeds because the zone attributes change the draws (not modelled): measured distances only.

## 2026-10-28: round CF's findings folded into the models

- **Two new defaults in `object_model`**, each with the old rule kept as a control reading (`probe_cf.V`):
  - **A player at a RANDOM civilization gets only objects some real civilization has** (k7). The lobby's RANDOM is
    civ 0 in our lobby codes, and the model had read it as gaia, for which every gaia-only resource (STONE, GOLD,
    FORAGE, DEER, BOAR, OAKTREE, RELIC: available to civ 0 only in the content pack) is available. DE has picked a
    real civilization by generation time, so these player-owned resources are not placed, just as with a set
    civilization (k7 at `n2-brit` was already identical). Control `random-civ-gaia` (the old reading). The model's
    path for an unavailable object spends the candidate shuffle and places nothing; with it k7 at `n2` is identical
    on both seeds, the sheep's angles included, so that is what DE spends. This also explains round CO's ob12
    without the "placed but not created" stone rule: ob12 stays identical, and `owned-stone` / `owned-mines` now
    differ from the default only under `random-civ-gaia`.
  - **A gaia building paints no foundation terrain** (k5, u10: gaia HOUSE). Control `gaia-foundation`. Player-owned
    buildings still do (k9, every CO map with a TC).
- **Fresh predictions** (`FRESH=1`; outputs kept as `cmp_co_fresh.txt` and `cf_run_fresh.txt`): **every modelled map
  is identical, 45 of 45 in round CO and 26 of 26 in round CF**. The 13 CF maps that differ all use an attribute the
  model does not cover (ll1's only difference is `layer_to_place_on`). Every control differs on its map except
  k7's `owned-stone` and `owned-mines` (expected, above). The k10 twins stay identical to each other. Part 0
  is unchanged: 95 of 95 (`compare_part0.py`) and 55 of 66 (`compare_part0c.py`).
- **Not folded in (measured only, `cf_run.txt`)**: actor areas, forest and cliff zones, `place_on_specific_land_id`
  and `generate_for_first_land_only`, `force_placement`, `min_connected_tiles`, walls, `require_path`,
  `layer_to_place_on`. The measurements give the shape of each rule but not the order of draws, so they need
  a model reading predicted before a confirming round, as with every rule so far. `cf_predictions.pkl` keeps
  the predictions made before the run.

## 2026-10-28: round CG set up and run in the editor (67 maps); models extended; predictions frozen before reading

**The round** (`run-sheet-cg.md`, `probe_cg.py`): 15 corpus scripts from age-of-rms `test-maps` at Tiny, n2-brit, seeds
1004 and 1005 (`cg-x-*.rms`; Rekawa's glued brace is no longer in our copy, so one version); c1/c2 confirmations; c3-c8
parser questions; u/ob scripts at fresh seeds; c9 (foundations on GRASS) added after hand-over. **By the owner's
choice the editor session ran first and the models were built in parallel**, with the rule that no CG map is read
before its predictions are frozen. All 67 maps were saved; no script failed (notes at the end of the run sheet).

**Front end** (`rms_front.py`): the preprocessor (nested comments, `#include_drs` from the game's `drs/gamedata_x2`,
`#define`, `#const`, `if`/`elseif`/`else`/`endif`, `start_random`, `rnd`, math left to right in floats), the
parse-time draws in order (`assign_to`, `set_zone_randomly` inline), the section parser and a whole-map `predict`.
Parser rules restated from AoE2RMSIDE's `rms-semantics/src/parser.rs` through fetched summaries (no download).
**It reproduces all 62 CO/CF probe predictions exactly.** Readings for CG: `rnd-first`, `dead-silent`, `dead-roll`,
math with precedence, truncation, the guessed editor labels. Undefined names read as 0 (Caverns' `terrain_size
DLC_JUNGLEGRASSK`, DE's own `riparian.inc` with `RIPARIAN_CAA_A`); a missing include reads as nothing (Bazi includes
`defend_wonder.inc`, which the game lacks).

**Object model** (restated from the cached AoE2RMSIDE engine, `exact_object.rs` and submodules at 210d977): actor
areas (records per id and land context, the first area's radius, weighted candidate draws for
`actor_area_to_place_in`, avoidance), forest and cliff zones (classes 15 and 34 within the radius, one mode per
descriptor), land-id dispatch and `generate_for_first_land_only`, `layer_to_place_on`, `min_connected_tiles`
(connected candidate pool), `force_placement` (up to 999 passes over the accepted anchors). Not modelled: walls,
`require_path`. A tile index speeds up overlap and zone checks (same results).

**Rules found after the fact on old maps** (each a default with the old rule as a control; CG's fresh seeds test them):
- an actor-area record is found only in its own land context (u1: the GOLD after a per-player TC placed 0 in DE;
  AoE2RMSIDE also accepts context-free records, `area-ctx-loose`);
- a negative `place_on_specific_land_id` (the guide's -11) places with no land frame (u3's RELICs);
- **buildings with the ordinary foundation (terrain 27) paint nothing in the saved map** (k5, u10: gaia HOUSEs on
  GRASS; u1: player HOUSEs on GRASS). Round CF's "only gaia buildings skip it" fails u1, and k9's player HOUSEs stood
  on DIRT, which that foundation never paints, so they were no evidence. **Farms and pastures** have their own field
  terrain (FARM 7, rice farm 63, pastures 117) and no map has placed one: they keep painting (the owner's
  understanding), with `no-foundation` as the control. Blind Valley (FARMs) and c9 test this;
- forced objects are not checked against other objects (u4: DE stacked 80 DEER on 54 tiles). Counts now match;
  positions only 72 of 89, and no order of the corner draws makes them exact.

**Old CO/CF maps with the new models: 86 of 95 identical** (from 74). Newly identical: ob5 1000, ob7 (both), ob8 1001,
ob10 (both), u1 (both), u3, u5 (both), u9, ll1 (both), xr1 1001. Still different: walls (ob13, u6) and `require_path`
(u7 1003), not modelled; u2 at both seeds (no land commands at all, the land write-up's open case); u4; a few objects
on ob5 1001, ob8 1000 and xr1 1000.

**A leak before the freeze:** `compare_cf.py` matches saved maps by script name, and while checking u1 it also read
**u1-actor at 1004 and 1005** from round CG. Seen: every object identical to the model (the context rule was written
before), 13 and 15 foundation tiles different (the foundation rule was written after), DE's 0 GOLD. These two maps are
therefore not blind for the foundation rule. `cg_guard.py` now makes every compare script skip round CG's maps until
`cg_predictions.pkl` exists; `probe_cg.py predict` writes that file only when all 67 runs have a prediction (it works
in `cg_predictions.partial.pkl` and resumes after a crash).

## 2026-10-29: round CG compared with the frozen predictions

Predictions frozen 2026-10-29 06:55 (`cg_predictions.pkl`, all 67 runs) before any CG map was read (except the u1
leak above). Twelve runs had first failed on two crashes, fixed before the freeze without changing any other
prediction: 131 objects carry per-civilization placement rules (all civs but 55, and 55 alone; the model takes the
first), and Bulls_Eyes writes `rnd(-NAME,NAME)` (main reading: the constant's value; control `+rnd-names-invalid`:
no draw, 0). Outputs: `cg_run.txt` (stopped at Caverns on a size mismatch) and `cg_run2.txt` (the rest).

**Main reading, frozen: 26 of 67 maps identical** (15 of 24 in `cg_run.txt`, 11 of 43 in `cg_run2.txt`).
- **Parser questions, all as predicted:** c1 (RANDOM civ), c2 and c9 (no foundation for ordinary buildings), c3
  (a random block rolls first, then the branches' rnd in order), c4 (rnd in a dead `if` draws), c5 (a random block
  in a dead `if` is not rolled), c6 (math left to right, rounding half up), c8 (comments, nested comments too) are
  identical, and every control differs. Exception: c2 1005 `+player-foundation` is also identical (no player
  building on a paintable tile there).
- **c7, which lobby labels the editor defines** (n2, Tiny, editor defaults): defined: FIXED_POSITIONS,
  TEAM_POSITIONS, DE_AVAILABLE, DE_GAME_AGE2, DARK_AGE_START, DEFAULT_RESOURCES, TINY_MAP, MAPSIZE_TINY,
  2_PLAYER_GAME, 0_TEAM_GAME, PLAYER1_TEAM0, AI_PLAYERS. Not defined: RANDOM_MAP, TURBO_RANDOM_MAP, LOW_, MEDIUM_,
  HIGH_RESOURCES, MAPSIZE_MINI, 1_TEAM_GAME, TEAM0_SIZE2, FULL_TECH_TREE, INFINITE_RESOURCES, REGICIDE,
  DEATH_MATCH, UP_AVAILABLE, UP_EXTENSION, `tiny_map` (labels are case-sensitive), LOWER_DEFINE (a `#define` is
  case-sensitive too). The guessed set was wrong on RANDOM_MAP and LOW_RESOURCES.
- **Measured-attribute scripts:** u1, u3, u5, u9 (both seeds), ob7, ob8, ob10 identical: actor areas, land ids,
  first_land_only, min_connected_tiles and layer_to_place_on as restated hold on fresh seeds. Different: u2 (both;
  forest clumps placed elsewhere on a map with no lands; no stream shift of -6..+6 at the terrain stage fixes it),
  u4 (force_placement), ob5 (zones), and the walls and require_path maps (not modelled).
- **Corpus, 0 of 30 identical.** Terrain and elevation exact, only objects differ: Battle Lines (both),
  Namatjira (both), Venn (both), Ra 1005. Only the layer differs: Menindee, Pag (both). The rest differ in terrain.

**Rules found after the run** (each a default, with the old behaviour as a control; none is confirmed by a blind map
yet). Checked terrain, elevation and layer only with `diag_cg.py` (no object stage):
- **Commands before the first section header count as `<PLAYER_SETUP>`** (`rms_front.sections`). Caverns and Heart
  put `override_map_size` there; DE's maps are 144 and 151 tiles. Both are now exact in terrain, elevation and layer.
- **Composite terrains** (`stage_model` `VAR["composite"]`): the content pack's `compositeTerrainRules` (33, 34, 36,
  38, 39, 43, 44, 61, 62, 103) are resolved at the end of the terrain stage, before its beach pass. A tile whose
  terrain or layer is a composite source gets the primary terrain and the secondary terrain as its layer (62 -> 77
  over 60; 34 -> 0 over 32). Ra 1005, Comeer and Rekawa (where the 77 then becomes BEACH) are exact with it.
- **Beach tiles have no layer** (`VAR["layer_cleanup"]`, applied after the connections): Rekawa, Comeer, Menindee.
  Shallows keep theirs (Menindee's SHALLOW under layer 96), and so does a layer equal to its terrain (Ra's 40, Caverns'
  118), so a first "equal layer is removed" reading was dropped.
- **A tile a connection paints loses its layer**, also where the undo gives its terrain back (`connection_model`
  `layer=`; control `keep-layer`): Pag's DLC_NEWSHALLOW (from replace_terrain) under WATER layers.
- **`terrain_mask 2` painting a tile's own terrain again leaves its layer as it was** (`terrain_model`; control
  `mask2_same`): Pag's DIRT under DIRT.
- With these, exact in terrain, elevation and layer: Caverns 1004, Comeer, Heart, Menindee, Pag (both seeds each)
  and Rekawa 1004.

**Still open after the run:**
- Ra 1004: DE paints fewer jungle underbrush tiles (373 against 206 in the end), so more centre tiles become 40 and
  fewer become forest 17. At 1005 neither side paints any, and that map is exact.
- Immersion and Blind Valley give one player several lands (`assign_to_player` on more than one `create_land`); the
  town centres stand elsewhere, so the model places those lands wrongly (never tested before).
- Bulls_Eyes and Rage Forest: town centres exact, elevation not; the difference starts in the non-player lands or the
  elevation stage. Bulls_Eyes' main reading (`rnd` takes the constant's value) is much closer than the control.
- u2 (no lands at all): forests elsewhere; no shift of -6..+6 draws at the terrain stage helps.
- Bazi: forest variation clumps elsewhere at 1005 with exact elevation; the random-block boundary (`>` against `>=`)
  changes nothing.

**Regression with the new rules:** Part 0 95 of 95, Part 0c 55 of 66, GP 44 main plus ge1 under `ignored` (as
before); the old CO/CF seeds differ on the same maps as before (walls, require_path, u2, u4, ob5 1001, ob8 1000,
xr1 1000). Nothing that matched before broke.

**Fresh comparison with the new rules, objects included** (`FRESH=1 MAIN_ONLY=1`, `cg_run_fresh.txt`; the u-series
in `cg_run_fresh_u.txt` after fixing a crash in fresh mode, which had no stored lands for the measurements): **26 of
67 identical, the same 26 as frozen.** The rules fixed terrain, not whole maps: every corpus map still differs in
objects. Terrain, elevation and layer are now exact on 17 of 30 corpus maps (Battle Lines, Caverns, Comeer, Heart,
Menindee, Namatjira, Pag, Rekawa, Venn at both seeds, Ra 1005). What the object differences look like there:
- **Same object, same tile, other facing or frame** ("same owner+type+position" far above "identical"): Heart (17032
  against 12139 of about 17500 script objects), Pag, Venn, Ra 1005, Rekawa's terrain objects. The stream-6 draws are
  out of step, or some types have another number of facets than the model gives them.
- **Other tree types on forest tiles with a layer:** Menindee's tile (0,0) is terrain 13 over layer 100; the model
  plants 351 there, DE 1053. Namatjira's (0,0) is terrain 14 over layer 102; the model plants 351, DE nothing (2048
  predicted terrain objects against 435). Which of terrain and layer picks the tree is open.
- **Many more objects predicted than placed:** Caverns (14300 against 11888), Rekawa (11534 against 6339), Venn (1185
  against 687), Ra 1005 (1097 against 799, `set_scale_by_groups` not modelled).
Not exact yet, as before: Ra 1004, Immersion, Blind Valley, Bulls_Eyes, Rage Forest, Bazi, u2, u4, ob5, c7 (the
label guesses), walls and require_path.

## 2026-10-29 (later): round CG, object stage and the maps not exact in terrain

After the owner's notes (set_scale_by_groups; the `GAIA_SET_ATTRIBUTE ... ATTR_TERRAIN_ID` trick that keeps forests
from growing trees; several player lands per player act as extra players on the ring; the on-grid / off-grid
placeholders). New diagnostics: `diag_cg_obj.py` (object differences by type and by command, cached predictions),
`offset_probe.py` (per command: objects at DE's position or half a tile on), `miss_probe.py` (one command's misses and
what DE has nearby), `var_probe.py` (object_model VAR settings against one map), `shift_probe.py` (draw shifts before
one command), `obj_score.py` (per-map tile and object scores; `FROZEN=1` for the frozen predictions). Placed objects
now carry the index of the command that made them (`unit_cmds` in a prediction).

**Found, now defaults (each with the old behaviour as a control):**
- **Script effects are applied** (`rms_front.add_effect`, `appearance_model.EFFECTS`): `effect_amount` /
  `effect_percent` with SET_ATTRIBUTE or GAIA_SET_ATTRIBUTE, for the attributes placement reads: 53 ATTR_TERRAIN_ID
  (restriction), 3/4 ATTR_RADIUS_1/2 (collision half sizes), 0 ATTR_HITPOINTS. A class target is 900 + class (900 to
  999 only; 1639 was first misread as a class). **Menindee: `GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 3` makes
  the palm forest grow no trees** (restriction 3 refuses PALM_DESERT; the draws are still spent): 1053 predicted
  1761 against 1798, from 351 everywhere before. **SET_ATTRIBUTE reaches gaia objects too** (`set_attribute_gaia`,
  control: players only): Ra's `SET_ATTRIBUTE MAKE_FOREST_TERRAIN ATTR_HITPOINTS 0` leaves its gaia-placed 1650s
  with status 0, and Ra's radius 50% on 1639 makes the second MAKE_CENTER_HOLE_TERRAIN pass find every tile taken
  (246 placed once, as DE, not twice).
- **Saved status 0 for building-type objects at 0 or fewer hit points** (1639-1641, 278, 1650 after the effect);
  gold, stone and moving objects at 0 or -1 keep status 2 (647 does).
- **Zero-size objects stand at the tile centre** unless the dat hides them in the editor (`hide_in_editor`, exported
  from the dat with genieutils into `de_hidden_in_editor.json`, 1360 ids) or the command has `set_facet`. The
  hidden ones are the guide's off-grid placeholders (1902-1921), the dead units scripts use as off-grid placeholders
  (647, 346), PLANT_SHRUB_DRY, PLANT_UNDERBRUSH_RAINFOREST, FENCE_RUBBLE. PLANT_JUNGLE (centre) and
  PLANT_UNDERBRUSH_RAINFOREST (corner) differ in that flag only. On-grid placeholders (1543-1546) are centred by their
  0.5 collision size, as the model already did. **The set_facet part is a placeholder, not a finding**
  (`facet_corner`): it covers one command (Heart's MAPLE_LEAVES with set_facet 3, 9645 at the corner), but 2030 also
  stands at the corner in Heart without set_facet, its unit data equals DLC_FERN_PATCH's (which Ra centres), and the
  owner points out that set_facet only picks among the object's graphics and that Menindee uses it with centred
  objects. Round CH part F tests it.
- **An object deletes a can-be-built-on object at exactly its own position**, scripted ones included
  (`same_spot_deletes`; Ra 1005: a GRASS_PATCH on a fern's spot, DE keeps the grass).
- **Loose-group members keep clear of forest and cliff zones** (`member_zones`; Ra 1005 PLANT_BUSH_GREEN in groups
  of 2 with avoid_forest_zone 1). The same check on tight-group neighbours fixed one of Ra's golds but **broke xr1
  1001** (identical before), so it is off (`tight_zone_at`).
- **set_scale_by_groups inside create_object scales nothing at Tiny** (Ra 1005: 7 ferns on terrain 17 from rnd(4,7)
  = 7, not 10; 42 on 56 against 43). Kept as the default `scale_by_groups "ignored"`; the owner's understanding (a
  map-size multiplier) is the control `"groups"` / `"both"`. Only Tiny has been seen, so a multiplier that is 1 at
  Tiny is not ruled out.
- **circle_radius on a create_land with assign_to_player** puts the player lands on the circle
  (`assigned_circle`). With it Immersion and Blind Valley (3 + 2 lands, as 5 players on the ring) are exact in
  terrain, elevation and layer at both seeds. Lands with a land_id get no player objects (already so).
- Math: modulo by 0 gives 0 (the guide), not the left operand.

**Tried and dropped:** rounding or truncating fractional `land_position` values (Bulls_Eyes and Rage Forest compute
them with trigonometry in #const math; both readings made Bulls_Eyes worse, float kept); `land_percent` truncated or
rounded (Bulls_Eyes' 0.9); a circular zone distance for every circular command (breaks Ra's PLANT_BUSH_GREEN).

**Ra 1005 by command:** every command up to 38 now matches DE exactly but one fern (DE has a GRASS_PATCH from a later
command on its spot); the first divergence is the large gold (tight group of 7, 11 of 14).

**Still open:** Bulls_Eyes and Rage Forest (the land stage drifts: hills land elsewhere, forest clumps differ; both
use fractional land positions from math); Bazi (forest clumps); Ra 1004 (underbrush); Heart's villagers (male /
female pick and positions differ right after exact town centres); the tight-group gold; u2, u4, walls,
require_path.

**Regression (before the hide_in_editor and set_facet change):** Part 0 95 of 95; GP as before (ge1 main differs,
as before); CO and CF only the maps that differed before (walls, ob5, ob8 1000, xr1 1000, u2, u4, u6, u7).

## 2026-10-29 (evening): round CG's fresh comparison, two speed fixes, two rules, round CH set up

**The fresh run stalled twice, on speed, not on a loop.** Bazi records thousands of actor areas, and every candidate
tile was tested against each (`queue`); each command now paints the areas' squares once into a mask
(`object_model.actor_mask`; same answer as the per-tile test on 40 commands checked). Rekawa's
`actor_area_to_place_in` draws scanned the area's whole tile list per draw; a Fenwick tree finds the same tile
(`route_candidates`; 20,000 random cases agree). Bazi takes about 4 minutes and Rekawa 7½. Output: `cg_run_fresh2.txt`
(main reading, every map predicted from the current code).

**Result: still 26 of 67 identical** (the same maps). Objects on the 26 corpus maps scored both times: 126,071 at
DE's owner, type and position (105,009 in the frozen predictions) and 91,102 fully identical (88,811), of 165,484.
Caverns and Heart (4 maps) are left out of those totals because the frozen predictions had their map size wrong; now
Heart 1004 has 17,048 of 17,507 script objects at DE's position and Caverns 1004 11,133 of 11,888. Largest gains: Rekawa (+3,500 identical per seed), Blind
Valley (+1,300), Menindee 1004 (+1,170). Two losses against the frozen predictions, both from this morning's composite
rule, not from the object rules (switching each object rule off changes nothing; `rule_probe.py`).

**Found after the run, now defaults (each with the old behaviour as a control):**
- **Effects count in every section** (`rms_front` `effects_anywhere`; control False = PLAYER_SETUP only). Blind
  Valley's `GAIA_SET_ATTRIBUTE LUSH_BAMBOO_TREE / PALMTREE ATTR_TERRAIN_ID 13` sit under LAND_GENERATION inside
  `if ASIAN_MAP`; DE grows none of those trees. With the rule Blind Valley 1004's terrain objects are 739 of 739 at
  DE's position (705 extra before).
- **A resolved composite tile grows the decorations of the composite as painted** (`stage_model`
  `composite_decor "source"`; control `"resolved"`). The saved terrain is still resolved (34 -> 0 over 32). Comeer
  1004: 8,852 identical against 7,769 with decorations of the resolved terrain (frozen: 8,850 with the terrain wrong);
  Comeer 1005: 8,572 against 7,422 (frozen 8,561). Ra 1004/1005 and Rekawa 1004 do not change.

**Tried and refuted:** a composite as a tile's *layer* dropped instead of resolved (`composite_layer "drop"`: Rekawa
off by 790 and 836 tiles, Ra 1004 unchanged); a `#const` holding `rnd()` drawn again at every read (`const_rnd
"each"`: Bulls_Eyes 1659 -> 3732 tiles, Rage Forest worse); a repeated `#const` replacing the first
(`const_redefine "last"`: no change; the repeats sit in exclusive branches); actor-area candidates oldest first for
Heart's storks (`route_order`: no change).

**Diagnosed, not explained:**
- Immersion and Namatjira: DE has **no PALMTREE on any PALM_DESERT tile** (728 and 687 tiles; Namatjira's only
  effect on PALMTREE is its storage value, Immersion has none). The dat gives PALM_DESERT PALMTREE at density 1000
  and restriction 11 allows it. The model grows them (738 and 1,572 extra).
- Heart: every object up to command 20 stands where DE has it, but stork angles differ from the first stork; no
  stream-6 offset reproduces command 15's 12 angles (best 6 of 12; `facing_probe.py`).
- Ra 1004: 167 tiles where the model has 77 over 60 and DE has 40 (the composite rule moved this map from 206
  differing tiles to 256).

**Round CH set up** (`probe_ch.py`, `run-sheet-ch.md`, seeds 1007/1008, 18 maps): F off-grid (set_facet), G palms,
E effects in other sections, C composite decorations, S set_scale_by_groups at 200, P math in land positions (`%`
and `/` on negatives and fractions, fractional percents; new `rms_front` controls `mod` and `div`), H storks,
villagers and scout, Z Ra's tight gold. Every part with controls was checked so each control predicts differently;
Z's controls did not and were dropped. Predictions frozen 2026-10-29 21:59:12, before any CH map exists (`ch_predictions.pkl`, 44 entries).

New diagnostics: `rule_probe.py` (each object rule off in turn against one map), `composite_probe.py`,
`facing_probe.py` (the stream-6 offset that reproduces one command's facings); `diag_cg.py` readings `rnd-each`,
`const-last`.

**Regression with every rule above (FRESH):** Part 0 95 of 95; GP as before; CF as before; CO 55 of 61 (xr1 1001
identical again, as before the tight-member check).

## 2026-10-30: round CH compared with the frozen predictions; four rules

The owner saved all 18 maps (no script failed). `compare_ch.py` (new; `DETAIL=1` prints per-type differences) read
them against `ch_predictions.pkl`, frozen 2026-10-29 21:59:12. Output: `ch_run.txt`.

**Frozen main reading: 12 of 18 identical.** As predicted, with every control different:
- **P (math):** `%` on truncated integers, float `/`, fractional land_position percents kept as floats. All six
  controls differ (18 to 36 tiles). So Bulls_Eyes' and Rage Forest's land drift has another cause.
- **S (`set_scale_by_groups` on create_object at 200 x 200):** ignored. Both controls place 52 and 124 objects
  against DE's 13.
- **G (palms):** DE grows PALMTREE on PALM_DESERT as a land and painted over a land, and none on PALM_DESERT as a
  `terrain_mask 1` layer over DESERT, with and without Namatjira's storage effect, all as the model does. So
  Namatjira's bare PALM_DESERT (687 tiles, no layer, no palms in DE) is not explained by the terrain or that effect.
  Immersion's case is a terrain difference: DE's tiles there are 56 over 13 and 13 over 56, which the model does not
  reproduce.
- **H (storks, villagers at 6, scout at 7-9) and Z (tight gold with `avoid_forest_zone`):** identical, so Heart's
  and Ra's differences come from something before those commands, not from the commands themselves.

**Differing, now explained by post-hoc rules (defaults, each with the old behaviour as a control):**
- **C, composites: the object stage sees a resolved composite tile as the composite** (`stage_model`
  `composite_objects "source"`; control `"resolved"`). Three GOLD the model put on 34's tiles (saved as GRASS over
  32) are absent in DE; `terrain_to_place_on GRASS` refuses them. The `composite_decor` reading won against both
  controls (37 and 39 of 40 objects at position, against 0). With the rule both seeds are identical. Only
  terrain composites count: for a composite layer the tile's earlier terrain is not kept, so those tiles stay as
  saved.
- **F, `set_facet 0` gives a random facet** (`object_model` `facet_zero "random"`; control `"fixed"`). The random
  draw is spent either way, so later facings do not move. `set_facet 1`..`3` give that facet.
- **F, a map-level switch for zero-size objects** (`object_model` `centre_when`). On f1, which has no effect
  line and no player lands, every zero-size object stood at the tile corner (ferns, graves, MAPLE_LEAVES and its
  siblings, with and without `set_facet`). Two objects at the same exact position both stayed. Every CG corpus map
  centres them and deletes the earlier one at a shared position (Ra 1005), and every one of those maps has both
  effects and player lands. So these maps cannot tell which is the switch: `"effects"` (default, provisional),
  `"player_lands"` (the same on every map so far), `"always"` (the CG reading). The `set_facet` corner rule stays for
  centre-mode maps (Heart). With the switch both f1 maps are identical.
- **E, HP 0 from an effect: status 0 only for objects hidden in the editor** (`rms_front` `hp0_status "hidden"`;
  `"any"` is the CG reading). A gaia HOUSE set to 0 HP by `SET_ATTRIBUTE` is saved with status 2, like Caverns'
  player-owned 1870. Every building saved with status 0 (1639-1641, 278, Ra's 1650) is hidden. A "no footprint"
  reading is refuted by 278. The effects-in-every-section rule held: the PLAYER_SETUP-only control differs on 722
  terrain objects per seed.

**With the four rules, all 18 CH maps are identical (FRESH).** Regression: CO 55 of 61, CF, GP and Part 0 (95 of
95) all unchanged map for map. The CG main reading is still 26 of 67, with 134,670 corpus objects identical (from
133,914) and 190,623 at position (from 190,461). Gains: Comeer +286/+364, Ra 1004 +119. Small changes elsewhere:
Blind Valley 1005 -19, Blind Valley 1004 and Caverns +2. (`cg_run_fresh3.txt`.)

**Still open:** which map-level switch centres zero-size objects; Namatjira's palms (`behavior_version 1` is the
one setting Namatjira has and G lacks, untested); Bazi's 19/21 swap; Ra 1004's 167 tiles; Rekawa too few and
Caverns too many objects; Heart's storks, now known to depend on earlier draws.

**2026-10-30, follow-up (owner's question on S, and a look at the cached AoE2RMSIDE sources):**
- **S is not saturation.** Both s1 maps are 200 x 200 of DESERT (all 40,000 tiles) with nothing else on them, and DE
  placed exactly the unscaled counts: 3 GOLD, 2 groups of 3 STONE, 4 DEER. AoE2RMSIDE's `create_object` parser has
  no `set_scale_by_groups` (only `set_scaling_to_map_size` and `set_scaling_to_player_number`); the attribute
  belongs to `create_terrain`/`create_elevation`. So on objects it is ignored, not saturated.
- **Centre or corner:** AoE2RMSIDE puts an object at the tile centre when its runtime collision half-size has a
  fraction and at the corner when it is whole (0 included); only effects change the runtime size. That predicts
  f1 (corner) but not the corpus (centre), so it does not explain the switch either. It does suggest where to look:
  the runtime object data, which effect lines might rebuild. That fits the provisional "effects" reading.
- **HP 0:** AoE2RMSIDE saves a building whose HP is below 1 as a construction site (status 0) unless a data table
  of construction-site exemptions (by object, class and construction facts) says otherwise. That table is not in
  the cached sources. Our "hidden in the editor" rule is a stand-in for it. AoE2RMSIDE also lets `SET_ATTRIBUTE`
  hit points reach gaia, as the model does.
- **`set_facet`:** AoE2RMSIDE applies the given facet, 0 included. DE gives a random facet for 0 (part F), so this
  is a fifth disagreement with AoE2RMSIDE.
- **Palms:** nothing specific. AoE2RMSIDE grows decorations at the land stage and removes them where the
  end-of-stage pass repaints a tile. No hint for Namatjira.

**2026-10-30, correction: Namatjira's palms.** The owner saw palms on PALM_DESERT in Namatjira. The claim above
("DE grows no PALMTREE on PALM_DESERT", from round CG) was too narrow and probably wrong. Recheck: the two saved
files `RMSTEST_cg-x-namatjira_1004/1005_n2-brit` contain **no trees of any kind** (class 15: 0 and 0, against 1,621
and 1,732 predicted), not even from the script's own `create_object PALMTREE` commands ("Put Forests Back"). Every
other corpus map has hundreds to thousands, mostly close to the prediction. The count was taken on PALM_DESERT
tiles only, with no control for trees elsewhere in the map. The script was in place: `cg-x-namatjira.rms` was in the
game's folder from 2026-10-28 19:06 (maps saved 19:31) and is byte-identical to
`age-of-rms/test-maps/AK_Namatjira.rms`. The terrain matched tile for tile. The owner's new copy
`AK_Namatjira.rms` (2026-10-30) differs by one `/*` at line 4432, just before the "Put Forests Back" block. So
what is open is why these two saved maps have no trees, not a palm rule. Part G's result stands: palms grow on
PALM_DESERT.

## 2026-10-30: round CG's maps were generated with carried-over effects; clean re-run set up

**The owner's finding:** the scenario editor keeps `effect_amount`/`effect_percent` lines from one generation to the
next until it is left for the main menu. Round CG generated its corpus maps one after another in one editor, in
`probe_cg` X order (Heart first; save times 19:21 to 19:39, Bazi 20:07), so every map after Heart ran with every
earlier script's effects still set. Heart 1005 also followed Heart 1004 in the same editor.

**Confirmed on Namatjira** (`carry_effects.py`, which merges the earlier scripts' effects into the prediction as
`rms_front.CARRY`): Blind Valley's `GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 13`, three scripts earlier, stops
every gaia palm. With carry-over the model predicts exactly the saved object counts:

| Map | Without carry-over | With carry-over |
|---|---|---|
| Namatjira 1004 | 2,680 predicted, 404 identical | 1,165 predicted (1,165 saved), 1,117 identical |
| Namatjira 1005 | 2,926 predicted, 527 identical | 1,285 predicted (1,285 saved), 1,242 identical; the whole map identical |

Measured on the "+no-guessed-labels" reading, which was passed by mistake, on both sides:

| Map | Without carry-over | With carry-over |
|---|---|---|
| Immersion 1004 | 82 identical | 914 identical |
| Immersion 1005 | 93 identical | 919 identical |
| Menindee 1004 | 1,265 identical | 3,655 identical |
| Menindee 1005 | 217 identical | 3,628 identical |

Venn does not change, and 21 of the 28 corpus maps after Heart do not change at all. Carry-over changes no terrain,
elevation or layer on any map. "No palms on PALM_DESERT" (above) was this, not a palm rule.

**What this puts in doubt (to recheck on the clean maps):** rules found on maps generated after other scripts'
effects:
- zero-size objects at the tile centre and the deletion of the earlier of two at one spot (Ra 1005);
- HP 0 and status 0 (Ra's 1650);
- `SET_ATTRIBUTE` reaching gaia (Ra);
- the object differences on Venn, Rekawa, Caverns and Comeer.

The carry-over model is incomplete: it ignores `GAIA_UPGRADE_UNIT` (Heart, Rage Forest) and does not stack
`effect_percent` on carried values, so the old files are kept as a test of how carry-over works, not as evidence.

**Round CH** is not affected for its predictions. Only G2's PALMTREE storage value and E1's JUNGLETREE /
LUSH_BAMBOO_TREE / HOUSE effects could carry, and no later CH map uses those objects. But f1 ran after G2, so with
an effect set, and still put zero-size objects at the corner. So `object_model` `centre_when` now defaults to
`"player_lands"`; `"effects"` is kept as the control. No current prediction changes.

**Clean re-run set up:**
- **Moved:** 40 files to `scenario\carryover-2026-10-28\`:
  - the 28 corpus maps after Heart, and Heart 1005;
  - the CG maps saved after them in that session that still differ: c7, u2, u4, u6, u7, ob5, ob13.
  - The CG maps that came out identical stay; carry-over evidently did not touch them.
- **Run sheet** for a Sonnet session: `run-sheet-cgclean.md`, with driver `tools\editor-automation\batch_cgclean.ps1`
  (main menu before every map; coordinates of the menu path still to calibrate).
- **Predictions** frozen by `cgclean.py predict` (`cgclean_predictions.pkl`, current models, main reading, fresh
  editor). `cg_guard.blind` keeps all compare scripts off these 40 names until the freeze exists.
  `cgclean.py compare` reads them afterwards.

## 2026-10-30 (evening): the clean re-run compared

A Sonnet session regenerated the 40 maps, each in a fresh editor (`run-sheet-cgclean.md`; all saved, labels checked,
calibration and notes in the sheet). A fresh editor already has Team Positions ticked, 2 players and RANDOM
civilizations. Predictions were frozen at 16:19:25, before the first map was saved at 16:27.

**Frozen main reading: 3 of 40 identical**: u2-forestcliff 1004 and 1005, and ob5-zones. All three differed on the
old files, so carry-over alone had broken them. Terrain, elevation and layer differ on the same maps as before: Ra
1004 (256 tiles), Bulls_Eyes, Rage Forest, Bazi (1,386 tiles at 1004, against 1,468 on the old file), and c7 (36).

**What carry-over changed in DE's own output** (`cgclean_diff.py`, old file against clean file):
- Objects changed on 19 maps, terrain on 3 (Bazi 1004 and u2 at both seeds). So DE's carry-over does more than
  `carry_effects.py` models, which changes no terrain.
- Unchanged: Heart 1005 (so its `effect_percent` lines did not stack between seeds), Battle Lines, Blind Valley,
  Bulls_Eyes, Venn, u4, u6, u7, ob13, c7.
- Against the frozen predictions, the clean files score 147,516 identical and 196,406 at DE's position of 242,653
  saved objects. The old files scored 124,374 and 186,483 of 234,155.

**Refuted on the clean maps: zero-size objects at the tile centre.**
- In a fresh editor the corpus maps put them at the corner:
  - Ra 1004: 787 at the corner, 311 centred (old file: 42 and 729);
  - Ra 1005: 1,115 and 266;
  - Caverns 1004: 2,759 and 3.
- Round CG's centring, and Ra 1005's "the later object deletes the earlier one at one spot", came from carried
  effects. Which effect did it is not known: it was in Heart, Battle Lines or Blind Valley, the scripts that ran
  before Caverns.
- AoE2RMSIDE's rule (corner unless the collision half-size has a fraction) holds. `object_model`
  `VAR["centre_when"]` is now `"never"` by default; "player_lands", "effects" and "always" are the controls.
- Predicted again with corner placement: 150,786 identical (+3,270) and 202,109 at position (+5,703). Gains: Caverns
  1004 +1,573/+2,720, Caverns 1005 +1,293/+2,287, Ra 1005 +306/+456, Ra 1004 +46/+193, Menindee +23 and +26. Only
  loss: Heart 1005, -5 at position (its 144 centred MAPLE_LEAVES come from a loose group in an actor area;
  AoE2RMSIDE centres actor-radius relocations, not modelled).

**Confirmed on clean maps:** Ra's 1650 is still saved with status 0 and Caverns' 1870 with status 2 (`hp0_status
"hidden"`, and `SET_ATTRIBUTE` reaching gaia).

**Regression with corner placement:**
- Round CH: 18 of 18 identical.
- CO: 56 of 61. ob5-zones is now identical, on its clean map.
- CF: u2 at both seeds identical (clean maps).
- GP: unchanged.
- Part 0: 95 of 95.

**Still open, now on clean maps:**
- objects:
  - Rekawa: 9,444 saved, about 5,500 script objects predicted;
  - Bazi: 1,212 of 10,611 identical;
  - Rage Forest's land drift: 9,141 tiles;
  - Bulls_Eyes: 1,659 tiles;
  - Namatjira's palms (1,495 of 2,210; predicted on the wrong PALM_DESERT tiles);
  - Blind Valley's facings (3,619 at position, 1,415 identical);
- terrain: Ra 1004's 167 tiles, and Bazi's 19/21 swap.

## 2026-10-31: investigation of the open maps; three object rules; round CI set up

**Three new `object_model` defaults (each with the old behaviour as a control):**
- **`missing_creation_rng "graphic"`.**
  - Caverns' facings went wrong at command 3: ROCK_PILLAR 2008 has facets 0-3 at random in DE and 0 in the model.
    Every later random facing then shifted, through stream 6.
  - 26 objects in the content pack have a standing graphic but no `creationRng`. All are constructor type 10 with a
    4-angle graphic flagged random facet and random angle. Objects of that kind that do have one take a random facet
    over the graphic's angles (222 of 229), and FORAGE's measured 4 random facets is one of the 26 (its hand-made
    override now gives way to the general rule).
  - Caverns 1004 script objects identical 4,267 -> 12,307 of 14,141. Blind Valley 1004: all 739 decorations and
    2,872 of 2,920 script objects identical (about 1,400 overall before).
  - AoE2RMSIDE derives creation draws from the constructor type and the standing graphic (`for_constructor`), which
    fits.
- **`failed_lands "skip"`.**
  - Caverns has 10 neutral GRASS_RAINFOREST lands with `land_id 2`. 6 of them run out of origin tries and sit at the
    map centre (the terrain matches DE).
  - DE gives those 6 none of the FORAGE, GOLD and chickens of `place_on_specific_land_id 2`; the 4 placed lands match
    exactly (10 FORAGE each, and so on).
  - Caverns' object counts: 14,148 predicted against 14,141 saved (1004), 13,814 against 13,808 (1005).
  - This also squares round CF's "all on the first land of the id" (unchecked: its second land may have failed).
- **`specific_land_area`: found, then reverted to the old default `"anywhere"`.**
  - Namatjira's "Put Forests Back" (PALMTREE on DESERT, `place_on_specific_land_id 4`, 9320 tight groups): DE's 130
    palms all stand in the id-4 land's zone 13, plus 2 in zone 254 (no land); the model put 561 more in other lands'
    zones. Restricting the group anchor to the own zone or zone 254 raised Namatjira's objects at DE's position
    (1,730 -> 1,842 and 1,696 -> 1,777).
  - But it broke CF's u3-lands (identical before): DE put a GOLD of `place_on_specific_land_id 7` on a player's DIRT
    land.
  - What fits both is distance: u3's GOLD lies within 44 tiles of its land's origin; Namatjira's kept palms within 34,
    its refused ones 44.5 or more away. AoE2RMSIDE has no limit of either kind.
  - `"zone"` and `"own"` are kept as readings, and round CI part P separates them. A distance limit would show there
    as GOLD confined around the land, with none of the three readings.

**Land drift (Bulls_Eyes, Rage Forest): not the land positions.**
- The lands' own terrain matches; the differences are forest clumps (GRASS <-> FOREST), other terrains and heights.
  Rage Forest takes the same branches as DE (same terrain mix).
- Refuted as causes, tried on the terrain alone:
  - `rnd()` with a constant's name in its bounds read as invalid: worse, 3,578 tiles;
  - truncated or rounded land percents and positions: worse;
  - math with operator precedence: worse;
  - double-precision `#const` math: identical results.
- Bulls_Eyes' elevation differs on 319 tiles. Its suspects:
  - a `land_percent 0.9` land with `other_zone_avoidance_distance 4` sharing a zone with a `land_percent 100` fill
    land (`min_placement_distance 33`);
  - an elevation step with more clumps than tiles (99 tiles, 65 clumps, `set_scale_by_size`).
- Round CI part S finds the stage by slices.

**Not explained yet:** Rekawa predicts too few objects (about 5,500 script objects against 6,400 saved); its
prediction now takes over 30 minutes and was not finished for this write-up. Also Bazi's objects, Bazi's 19/21 swap and
Ra 1004's 167 tiles; Part S slices Bazi and Ra too.

**Round CI** (`probe_ci.py`, `run-sheet-ci.md`, driver `tools\editor-automation\batch_ci.ps1`, 29 maps):
- **S, slices.** A slice keeps every control-flow and preprocessor line (`if`, `start_random`, `#const`, `#define`,
  `#include_drs`), so the branches stay the same, and drops the commands of the later sections:
  - L = lands only, E = with elevation and cliffs, T = with terrain;
  - Bulls_Eyes, Rage Forest and Bazi at 1004 and 1005, Ra at 1004.
- **F:** failed lands (control `+keep`).
- **R:** objects without `creationRng` (control `+none`).
- **P:** own land (main `anywhere`, readings `+zone`, `+own`; a distance limit would show as none of them).
- **M:** Rekawa's terrain makers, main prediction only. Clean Rekawa has 3,881 MAKE_DIRT3_TERRAIN (1640) against the
  model's 3,096, and more 1639/1641. They come from fills (`number_of_objects 200000`) of objects with collision 0 in
  the data, resized by `effect_percent ... ATTR_RADIUS 50`, with a foundation terrain. M copies those effects onto a
  DESERT block filled twice, then GOLD on DIRT3. The model predicts 625, a second fill of 0, no DIRT3 painted (gaia
  foundations paint nothing) and no GOLD.

Every control was checked to predict a different map. Predictions frozen 2026-10-31 06:40:53 (37 entries), before
any CI map was saved; `compare_ci.py` reads the maps afterwards.

**Regression with the new defaults** (`failed_lands "skip"`, `missing_creation_rng "graphic"`, `specific_land_area
"anywhere"`):
- CH 18 of 18, CO 56 of 61, GP unchanged, Part 0 95 of 95; CF as before (u3 identical again).
- k4's "+forage-fixed" control now equals the main reading: FORAGE's facets come from the general rule.

## 2026-10-31 (later): round CI compared

A Sonnet session saved all 29 maps, one fresh editor each (`run-sheet-ci.md` notes, `batch_ci.log`). Predictions were
frozen 06:40:53, before the first save. Output: `ci_run.txt`. **Frozen main reading: 9 of 29 identical.**

**Rules:**
- **R confirmed** (`missing_creation_rng "graphic"`): both seeds identical. The control `+none` differs in 35 and 38
  DEER facets.
- **P: `specific_land_area "anywhere"` confirmed**: both seeds identical. `+zone` and `+own` are refuted, and no
  distance limit shows: GOLD with `place_on_specific_land_id 4` goes anywhere on an all-DESERT map. So Namatjira's
  palms are kept to the id-4 land's area by something else, open.
- **F: `failed_lands "skip"` refuted**: `+keep` is identical. DE places on failed lands. What Caverns showed is a
  different rule:
  - **`avoid_other_land_zones` compares with the land's own zone number, not the zone of the tile at its origin**
    (`object_model` `VAR["land_zone_ref"] "own"`; control `"origin"`).
  - A failed land has no tiles of its own zone, so its `avoid_other_land_zones` commands find no candidates. Every
    Caverns command whose objects DE left off those lands has the attribute; F's GOLD has not.
  - With it, F is identical at both seeds (it does not affect F), and Caverns 1004 is better than with `skip`: all
    decorations identical, script objects 12,334 identical (from 12,307).
- **M (Rekawa's terrain makers) identical at both seeds:** a plain fill of the resized 1640 is modelled right (625
  per fill of 625 tiles, nothing from a second fill, no foundation painted, so no GOLD on DIRT3). Rekawa's 785 extra
  come from something else in its commands (second objects, actor areas, edge distances).

**Slices: the stage where each map parts from DE:**
- **Ra 1004: L, E and T identical**, so its 167 tiles (77 over 60 against 40) come from the **connections**.
- **Bazi:** L and E differ on 2 tiles only (41 -> 0 at x 36-66, y 90-96); T brings the 19/21 swap (1,386 and 1,430
  tiles), so the swap is in the **terrain stage**.
- **Bulls_Eyes: already at L** (131 and 54 tiles), at the edges of its BOGLAND (101) aux lands against the GRASS fill;
  the totals are near equal (874 against 877). The aux lands are `land_percent 0`, circular, base 7, sharing a zone in
  threes; the fill land is `land_percent 100`, `min_placement_distance 33`, sharing its zone with the 0.9% land
  (`other_zone_avoidance_distance 4`). E adds the elevation differences (333, 339).
- **Rage Forest: already at L** (3,613 and 3,563 tiles: 10/24/25 swapped, 21/24/25 at 1005); E adds the elevation
  (4,326 and 3,945).

**Regression with `land_zone_ref "own"`, `failed_lands "keep"`, `specific_land_area "anywhere"`, `missing_creation_rng
"graphic"`:** CH 18 of 18, CO 56 of 61, GP unchanged, Part 0 95 of 95, CF unchanged except k4's `+forage-fixed`
control, which now equals the main reading.

**Next:**
- cut the Bulls_Eyes and Rage Forest L slices further, one land kind at a time;
- slice Bazi inside its terrain stage;
- look at Ra's connections;
- find which of Rekawa's attributes adds the terrain makers.

## 2026-10-31 (evening): insights from round CI's data; five rules; round CJ set up

All found by working from CI's slices and the clean CG maps; each is a default with the old behaviour as a control,
and round CJ confirms them on fresh layouts.

- **A constant's name inside `rnd()` reads as 0; the draw is still spent** (`rms_front` `rnd_names "zero"`;
  control `"value"`).
  - Bulls_Eyes' lands-only slice differed only in its BOGLAND aux lands: 6 of 12 sat one tile off the model's origin.
  - Only those lands use `VAR_A1..A3 = rnd(-VARIANCE_AUX_LAND_DEGREES,VARIANCE_AUX_LAND_DEGREES)`.
  - Searching all 125 tilt combinations found that only (0,0,0) reproduces both seeds, with the draws spent. Reading
    the name as invalid (no draw) and reading only `-NAME` as 0 are both refuted.
  - **Bulls_Eyes is now exact in terrain, elevation and layer at both seeds** (full map and all three slices; it
    differed on 1,659 and 1,878 tiles).
- **A bare `elseif` (followed directly by `#const`) acts as `else`** (`bare_elseif "else"`; control `"label"`, the
  model before, which took `#const` as the label).
  - Rage Forest's pond angle sits behind `if FLIP_POND1 ... elseif #const POND_T1 ...`. The model never defined
    POND_T1 when the pond wasn't flipped, so the pond moved and the land growth around it changed.
  - **Rage Forest is now exact in terrain, elevation and layer at both seeds** (it differed on 9,141 and 8,777
    tiles). A literal negative `rnd()` bound read as 0 is refuted.
- **Connections see composite terrains as painted** (`stage_model` `composite_connections "source"`; control
  `"resolved"`).
  - Ra's `replace_terrain TERR_UNDERBRUSH CENTER_NONBUILDABLE_TERRAIN`: TERR_UNDERBRUSH is composite 62, and the
    connection replaces it with 40 (and its `terrain_cost` applies). The model had resolved it to 77 over 60 first.
  - **Ra 1004 now exact in terrain, elevation and layer** (167 + 89 tiles before); its objects go from 5,796 to
    13,003 decorations and from 237 to 655 script objects identical.
- **The object stage sees a composite *layer*'s tile as painted** (`composite_object_layers "source"`).
  - Rekawa's MAKE_DIRT3_TERRAIN fills (`terrain_to_place_on LOWER_LAND_TERRAIN`, 60) took 785 tiles where 62 was a
    `terrain_mask` layer over 60, saved resolved as 77 over 60.
  - Rekawa 1004 script objects: 6,332 predicted against 6,427 saved (5,537 before), 4,998 identical (4,345).
  - Its decorations are still wrong (271 of 3,017 identical); CJ part R looks at them without objects.
- **`place_on_specific_land_id` keeping off lands with another explicit land_id** (`specific_land_area
  "other-ids"`) is a reading only, not the default. It fits Namatjira (the refused zones are `land_id 1` lands), u3
  (DE's one GOLD on another land was on a player land, no explicit id) and CI's P (no ids). CJ part L tests it.

**Bazi:** its blend layers (5, 122, 76 over BAZI_TERRAIN) and its 19/21 clumps land elsewhere with the right counts,
so the draw stream drifts somewhere in its long terrain stage. The commands that cover whole areas hide it. CJ part B
cuts the stage at six points, each followed by a marker clump.

**Round CJ** (`probe_cj.py`, `run-sheet-cj.md`, driver `tools\editor-automation\batch_cj.ps1`, `compare_cj.py`, 16
maps):
- **N:** both parser rules, with a land steered by each.
- **K:** a connection on composite 62, and a fill on a composite layer.
- **L:** other land ids.
- **B:** six Bazi cuts with a marker.
- **R:** Rekawa's terrain slice.

Every control was checked to predict a different map (the first K2 used GOLD, whose restriction refuses 62 either
way, and was redone with Rekawa's terrain maker on 60). Predictions frozen 2026-10-31 20:40:44, 26 entries, before
any CJ map was saved.

## 2026-10-31 (night): round CJ compared

The 16 maps were saved by a Sonnet subagent at low effort (a session could not be started over Remote Control),
one fresh editor each (`run-sheet-cj.md` notes). Predictions frozen 20:40:44, before the first save. Output
`cj_run.txt`. **Frozen main reading: 6 of 16 identical.**

- **N confirmed (both seeds identical):** a constant's name in `rnd()` reads as 0 with the draw spent
  (`+names-value` 273 and 280 tiles off); a bare `elseif` acts as `else` (`+elseif-label` 77 tiles off).
- **K1 confirmed (both identical):** the connection sees composite 62 as painted (`+resolved` 127 and 139 tiles
  off).
- **K2 confirmed for the fill:** with 62 as a layer over 60, the fill on 60 places 625 of 625 at DE's tiles,
  against 10 under `+resolved`. New: on those tiles DE grows PLANT_JUNGLE (1351/1352) decorations the model does
  not, and the 10 STONE after them shift. Decorations on composite-layer tiles are open.
- **L: `specific_land_area "anywhere"` confirmed (both identical), `"other-ids"` refuted.** So no land rule found in
  three tries (zone, distance, other ids) explains Namatjira's forest palms staying near their land; open.
- **B (Bazi cuts, cut 1004):** the marker clump barely placed (BASE_TERRAIN has few tiles), so it told nothing; the
  cuts themselves did:
  - **Main stream:** layers first differ at cut 23, on 5 EYE_BLEND (70) tiles of command 15 (a partial clump, 88
    tiles and 32 clumps, `terrain_mask 1`, with both `set_scale_by_size` and `set_scale_by_groups`), and on 198
    tiles at cut 32 after command 24 (the same kind). The first scaling attribute deciding is refuted (69 and 121
    tiles). Open.
  - **Stream 6:** decoration facings already differ at cut 14 (every decoration in place, 656 of 6,391 identical),
    not at cut 5 (6,374 of 6,376). So commands 6-14, which repaint whole areas (EYE_BLEND mask, BAZI over
    placeholder), change how DE spends facing draws on decorations; the model's repaint handling of decorations is
    the suspect.
  - 2 tiles at (36,90) and (66,96) differ from the land stage on (2 against 97).
- **R (Rekawa's terrain slice):** decorations differ without any object: 123 of 969 identical, about 630 at DE's
  position. Rekawa's decoration problem is in the terrain stage too (it has many `terrain_mask` layers).

**Regression** with all the night's rules: CH 18 of 18, CO 56 of 61, CF and GP unchanged, Part 0 95 of 95. The 40
clean CG maps are being re-predicted (`cgclean_run3.txt`).

**Open, in order of reach:**
- decorations on repainted and layered tiles (Bazi's facing drift, Rekawa's decorations, K2's jungle plants);
- partial clumps with `terrain_mask 1` and both scale attributes (Bazi);
- Namatjira's forest palms.

## 2026-10-31 (night): the owner's rule for `place_on_specific_land_id`

**The owner's rule:** a `place_on_specific_land_id` object stays on the tiles connected to its land's origin through
the origin's terrain class, so it does not cross, for example, water. The script's author says the same in a comment
(Namatjira line 4392: "only works if there is separation bw the player and the land_id").

- Restated: tiles reachable from the origin (4-neighbour) whose placement class shares a bit with the origin's
  (`object_model` `specific_land_area "connected"`, `class_area_mode "bits"`; controls `"anywhere"`, equal class,
  8-neighbour, land-with-beach, layerClass).
- **Namatjira's forest palms now match DE exactly:** 132 of 132 at 1004 and 96 of 96 at 1005, position and facing
  (693 and 824 placed before). The river (terrain 54, placement class 8) separates them from the land beyond.
- Namatjira's three GOLD commands with `place_on_specific_land_id 2` also fit: DE has 30 and 35 riverbank GOLD
  inside the id-2 land's area, where the model now places 40 and 53 (70 before).
- **Equal class is not enough:** u3 1005 has DE put a STONE of `place_on_specific_land_id 7` on SNOW (class 160 =
  128 + 32) from a DESERT origin (32). With the bit test u3 is identical at 1002, 1004 and 1005.
- Diagonal steps and beach joined to land change nothing on Namatjira. layerClass (land against water) equals
  "anywhere", because the river counts as land there.
- **Still identical:** CI's P and F and CJ's L (no water), and u3.
- Namatjira's totals: 1,646 and 1,680 objects identical (1,491 and 1,578 before).

## 2026-11-01: terrain status across all saved maps

`terrain_all.py` (new; terrain, elevation and layer only, current model) over every saved map of rounds CG, CH, CI
and CJ: **164 of 180 exact** after one fix found by it:
- **Lobby labels from c7** (`rms_front` `labels_c7`, default True): the editor does not define RANDOM_MAP,
  LOW_RESOURCES or TEAM0_SIZE2 and does define AI_PLAYERS (round CG's c7 measured this; the model still used the
  guesses). c7-labels is now exact; no other test script uses those labels.

Still differing:
- **Bazi, all 15 of its maps:** 2 land-stage tiles, then the terrain stage (19/21, about 1,400 tiles; layers about
  4,000).
- **u2-forestcliff at CF's seeds 1002/1003:** forest and grass swapped on 2,904 and 2,621 tiles. The script is exact
  at 1004/1005, regenerated in a fresh editor. The maps saved before it that session (k*, ll*) have no effects, so
  carry-over is not established; regenerating 1002/1003 in a fresh editor would separate session from model.

Older rounds (regression with every rule so far): every modelled map matches in terrain except u2 above. ge1's main
line is GP's refuted reading; its confirmed `+ignored` is identical.

## 2026-11-01: Bazi and u2 solved

**Bazi: a land without `terrain_type` takes terrain 0, not the map's base terrain.**
- `rms_front` `land_default_terrain "default"`; the control `"base"` is the model before.
- Bazi's two player lands are `create_land { land_percent 0 base_size 0 land_position 30 75 assign_to AT_TEAM -10 0
  0 }` with no `terrain_type`. The model painted their origin tiles (36,90) and (66,96) with BASE_TERRAIN (41); DE has
  0 there, which is the content pack's `defaultTerrainId` and what AoE2RMSIDE uses (`DescriptorTemplate` takes
  `default_terrain_id`).
- Those two tiles shifted the clump growth for the rest of the terrain stage. With the fix, **Bazi is exact in
  terrain, elevation and layer at both seeds**: the full maps, all CI slices and all CJ cuts. That was the whole of
  its 19/21 swap and its 4,000 layer tiles.
- Along the way: Bazi's PLACEHOLDER_TERRAIN_A/B are undefined names (read as 0, as AoE2RMSIDE does), so its long
  placeholder sequences paint 0 over 0 and only spend draws.

**u2-forestcliff at 1002/1003: the old files were spoiled by their editor session.**
- Regenerated in a fresh editor each by a low-effort Sonnet subagent (driver `tools\editor-automation\batch_u2.ps1`),
  against predictions frozen 2026-11-01 03:25:32. **Both maps are identical, terrain and objects.**
- The 28 October copies (round CF's session, saved right after k*/ll* scripts with no effects) differ from the
  fresh ones on 2,904 and 2,621 tiles; they are kept in `scenario\cf-session-2026-10-28\`.
- What the editor carried is unknown (not effects). No draw offset, nearby seed or the previous map's lands
  reproduces them. Every script after the first in a session can be affected, not only after effects, so
  **always start each map from a fresh editor** (the drivers already do).

**Terrain check after both fixes** (`terrain_all.py`, `terrain_all2.txt`): **178 of 178 CG-CJ maps exact in terrain,
elevation and layer.** Regression: CH 18 of 18, CO 56 of 61, GP unchanged, Part 0 95 of 95, and CF with u2 1002 and
1003 now identical (the fresh maps).
