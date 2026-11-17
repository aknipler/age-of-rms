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

## 2026-11-01, object analysis started (`obj_analysis.py`, `obj_tilt.py`, `obj_report.txt`, `obj_detail.txt`)

- `obj_analysis.py cache|report|detail` gives each corpus/slice map's first diverging command (OBJ_PKL picks the cache;
  `obj_analysis.pkl` is the baseline, `obj_analysis_new.pkl` the one with the rule below).
- `obj_tilt.py <stem> <cmd> [T]`: reruns the object stage with the stream moved by -T..T draws just before the
  command. A peak at t != 0 means an earlier command spent the wrong number of draws; no peak means the command's rule is wrong.
- Herdable owners (gaia/player counts) agree on every corpus map except Ra 1004 (4 owned predicted, 3 saved).
- **New default `builder_deletes "scripted"`** (control "off"). An object that cannot be built on deletes the scripted
  can-be-built-on objects at its own position or within the two collision sizes, as it already did decorations.
  Evidence: Bulls_Eyes 1004/1005. Every hidden 346 that a later 647 or a sheep stands on is missing in DE, and every
  other 346 and every 647 matches. Bulls_Eyes' first divergence moves from cmd 25 to cmd 60 on both seeds.
  NOT yet regressed on other rounds.
- Bulls_Eyes cmd 60 (3 VILLAGER, actor_area_to_place_in 11 radius 1 around a straggler tree, place_on_forest_zone):
  no tilt peak (t -6..6), so the rule is wrong, not the stream. DE leaves the decoration 1365 on a tile the model
  puts a villager on.
- Heart 1004 cmd 31 (VILLAGER at min = max distance 6, every player): no tilt peak (t -6..6; best 2/6 at t -1), so
  it is the rule, not the stream. Round CH's H slice matched Heart's villagers, so whatever is different must come
  from the full map, e.g. earlier objects on the ring tiles. (20 min per tilt run on Heart.)
- **New default `filter_resolve "draw"`** (control "none"). With a forest or cliff zone filter, every actor-area
  candidate re-resolves the object it tests. That spends the group roll and the replacement roll (VILLAGER -> female),
  as AoE2RMSIDE does (restated). Bulls_Eyes 1005: every object through cmd 69 now matches (only 4 STONE unexplained);
  1004 now first parts at cmd 61 HOUSE (3 of 4). Applies to actor-area routes only; the queue path is not changed.
- Regression (2026-11-02): CH 18/18 and CO 56/61 with builder_deletes; CF (both rules) every modelled map identical.
  u4-force, u6 walls and u7 require_path differ, as before. CH/CO not yet rerun with filter_resolve.
- 2026-11-02, age-of-rms's 14 `known` whole-script maps explained in `notes/amendment-2026-11-02-drain-includes.md`
  (copied to de-study/evidence). Menindee: the drain writes the whole target, so under terrain_mask 1 a drained tile
  gets the base terrain (11 tiles, all with the target on both sides). Bazi (12): `#include_drs` files.

## 2026-11-08, object analysis continued

- Regression with `builder_deletes` and `filter_resolve`: CH 18/18, CO 56/61 (unchanged). `obj_analysis_fr.pkl` is
  being refilled with both rules for every corpus map and slice (`obj_cache_fr.log`).
- **Comeer HUT_VARS (open).** DE saves no African hut at either seed. The group has seven huts of weight 14-15, one
  per player, find_closest, min 8. The huts' restriction 4 allows the SNOW under the model's spots. Reading
  `group_empty "none"` (a roll no entry reaches places nothing): fixes 1004, but at 1005 the model still places
  1083 where the roll kept every entry, and DE placed none there either. So it is a control, not the default. The
  cause is unknown; a probe would need huts singly and as a group, player-owned and gaia, on SNOW and GRASS.
- **Second-object fish (FISH 53 on Pag and Namatjira) are downstream.** Each fish stands on its carrier (1546 on
  Pag, 647 on Namatjira), and the carriers come from commands that already differ.
- **Heart's GAIA_UPGRADE_UNIT is not the decoration cause.** DE's saved maps hold no UNDERBUSH_PLANT_6 (1366), so
  the upgrade does not show in the editor's file. Heart's decorations differ through the terrain stage, like Bazi's
  and Rekawa's: 81 of 629 at DE's position, with saved decorations near both starts that the model lacks.
- Heart's villagers (cmd 31, min = max 6): DE and the model both keep the ring around the land origin; the town
  centre stands one tile off it (find_closest). CH's slice had the town centre on the origin. Testing whether the
  candidate window centres elsewhere (`obj_variant.py ... window`).
- **Battle Lines cmd 5 (GROUP_IDLE_VILLAGER: 1810 male 50, 293 female 50; find_closest, 2 per player) lands on
  DE's tiles; only the type differs.** At 1004, player 2's first villager is 293 in DE and 1810 in the model. The
  model's rolls per player are: initial pick (plus 293's replacement roll), then per group a discarded pick, the
  pick placed, and the pick for invalidation. Player 1: 82 | 45 72 -> 1810 | 56 | 42 32 -> 1810 | 6. Player 2:
  17 (49) | 33 78 -> 1810 (DE 293) | 26 | 55 73 -> 1810 | 14. find_closest makes positions insensitive to the draw
  count, so cmd 6 (actor_area_to_place_in, random) shows the drift: both its villagers are off. Which picks DE
  makes, and which of them spend 293's replacement roll, is the question. Readings tried by hand (the discarded pick
  replaced too) are not conclusive. `obj_picks.py <stem> [cmd]` logs the rolls.
- **New default `group_initial "raw-none"`: an object picked from a group is never replaced** (no replacement roll).
  The male/female swap of VILLAGER and 293 applies only to an object a command names directly. Battle Lines then
  matches through cmd 6 at both seeds (first divergence cmd 7 GROUP_HERDABLE_A). Before, cmd 5 had one wrong type
  at 1004 and positions off at 1005. Tested on the way: "raw" (only the first pick unreplaced) fixed 1004 but not
  1005; "raw-all" (the first and the invalidation picks) was no better. Every group pick now goes through
  `pick_object`. The class-filter resolve (`filter_resolve`) still replaces, as AoE2RMSIDE does; untested for groups.
- Heart's villager window (`obj_variant.py ... window`, centre shifted -1..1): no shift helps (at most 1 of 6), so
  the window centre is not the cause.
- Regression with `group_initial "raw-none"` (and builder_deletes, filter_resolve): CH 18/18, CO 56/61, CF 45
  identical with the same three scripts differing as before (u4-force, u6 walls, u7 require_path). Unchanged.
- Full re-prediction with builder_deletes, filter_resolve and raw-none (`obj_analysis_v3.pkl`, `obj_report_v3.txt`):
  corpus objects at DE's position 263,841 -> 263,989 of 281,697 (Bulls_Eyes +172; Caverns 1005 -35, Bazi -1).
  Venn's first divergence is now cmd 49/45 (O278 with WALL second object, walls unmodelled), was cmd 5.
- **New default `expand_route "route"`:** a starting-villager command (VILLAGER, number_of_objects 1, expanded to
  the civ's count) with `actor_area_to_place_in` takes the area's weighted draws, one group per villager, instead of
  the plain queue. Caverns cmd 22 (in the town centre's area, avoid_forest_zone 2): 0/6 -> 6/6, and cmds 23-25 then
  exact (463, 1,313, 30). **Caverns 1004 and 1005: every script object at DE's position** (`obj_analysis_v4.pkl`);
  only facings differ.
- **Caverns' facings:** all 20 FORAGE facets of cmd 18 match with stream 6 moved 4 draws on, so DE spends 2 more
  draws per player in cmd 17. Cmd 17 is TC_PLACEHOLDER 1870 (a building the script sets to HP 0) with second_object
  TOWN_CENTER. The model spends 7 draws per player: 1870, 109, 618, 619 (+ its child 1649), 620, 890. Not HP 0 by
  itself: Bulls_Eyes' flags 851/1285 are HP 0 and placed, and its later facings match. Open: 1870's own draws (the
  content pack lists no attachments for it), or the TC arriving as a second object. Needs a probe.
- `obj_facets.py <stem> ...`: the first object whose random facet differs from DE's, the objects built just before
  it, and the stream-6 shift that best explains the next 40.
- Regression with `expand_route "route"`: CH 18/18, CO 56/61, CF unchanged (u4, u6, u7 differ as before).
- `obj_facets.py` fixed: random-angle objects store an angle in radians, now compared as such. Second run:
  Bulls_Eyes, Immersion and Pag first go wrong in facing where positions are already off; Blind Valley's GOLD is
  best at shift 0 (local); Venn's first is cmd 5's walls (unmodelled); Heart's first object (cmd 14 storks) is
  already off, so Heart's stream 6 is off before the object stage (its decorations); Ra 1005's GOLD (cmd 39) fits
  shift +5, 26 of 40.
- **New default `second_group "pick"` (control "drop"):** `second_object` may name an object group. DE then picks
  from the group by the group rule, unreplaced. Ra 1005 cmd 35 (`MAKE_FOREST_TERRAIN 1650 { second_object
  PATCHY_FOREST }`): DE saved a CENTER_FOREST_OBJS 414 on each of the four 1650s, and the model had dropped the
  attribute (the front end refused a name that is not an object). With the pick, Ra 1005's first divergence moves
  from cmd 39 to cmd 50 (JUNGLETREE, 8 of 13). Regression and the full corpus re-prediction (`obj_analysis_v6.pkl`,
  `obj_report_v6.txt`) are running.
- **All of today's rules together** (`obj_analysis_v6.pkl`, `obj_report_v6.txt`): regression unchanged (CH 18/18,
  CO 56/61, CF: u4, u6, u7 differ as before). Corpus objects at DE's position 263,841 -> 265,738 of 281,697;
  identical (facing too) 242,474 -> 243,041. Caverns 1004 and 1005 every object at DE's position; Ra 1004
  +163 (first divergence cmd 42 -> 57), Ra 1005 +30 (39 -> 50), Bulls_Eyes 1005 2,343 of 2,347.

## 2026-11-08, round CK set up (`probe_ck.py`, `run-sheet-ck.md`, driver `tools/editor-automation/batch_ck.ps1`)

- **Rekawa (before setting up):** `composite_stale "drop"` (rms_front; control "keep"). A composite tile that a
  later pass repainted is no longer the composite for the object stage. Rekawa 1004's 197 extra MAKE_DIRT3_TERRAIN
  all stood on tiles DE saved as BEACH: composite layers over 60, resolved, then beached. Its first divergence moves
  from cmd 2 to cmd 9 (OYSTERS). Not yet regressed.
- **AoE2RMSIDE consulted** (HEAD, via a fetch agent, behaviour summarised):
  - `require_path N`: a route from the anchor to the land origin must exist, at most N tiles longer than the
    straight line. Stored as N+1; no draws.
  - Walls: square bands between min and max distance, routed by least cost; gates on spans of 4 or more; 2 stream-6
    draws per wall tile, 3 per gate.
  - A building created with HP below 1 is a construction site: no foundation, no completion.
  - Appearances (decorations) are made in the object stage from the final terrain, which is not our model's
    structure (ours grows them during painting; confirmed on many maps).
  - Group picks pass through replacement there, against Battle Lines' evidence.
- **CK:** 15 scripts at seeds 1009/1010, Tiny, n2-brit, 30 maps.
  - Confirmations with controls (`check`: every control differs at both seeds): A group picks unreplaced,
    B villager route plus forest-zone re-resolve, D group as second object, E builder deletes.
  - Measurements: F Comeer's huts on GRASS and SNOW; G the town-centre marker's stream-6 draws (g1 Caverns' form,
    g2 marker alone at HP 0, g3 at full HP, g4 TC on a 647); H villagers at min = max 6 with the TC off the origin;
    P require_path 1 and 10 behind a lake; L decorations after a repaint (l1), mask 1 (l2), mask 2 (l3).
  - Predictions frozen 2026-11-08 17:36:43 (`ck_predictions.pkl`). Compare with `compare_ck.py`, then
    `obj_analysis.py` on "ck-" maps.
- Regression with composite_stale "drop": CH {'IDENTICAL': 18}, CO 56 identical, 5 different, CF unchanged (u4, u6, u7 differ as before).

## 2026-11-08, round CK compared (`compare_ck.py`, `ck_run.txt`; 23 of 30 saved, the last 7 being re-run)

- **Frozen main reading: 15 of 23 identical.**
  - Identical: B (villager route and forest re-resolve, both controls differ), F1 and F2 (huts on GRASS and on SNOW,
    placed exactly as the model, directly, as gaia and as the HUT_VARS group), G1-G3 (the town-centre marker at
    HP 0, alone, at full HP: the model is right), H1 (villagers at min = max 6 with the town centre off the origin:
    right), P1 1009 (require_path refused nothing at this seed).
  - Different: A, D, E, G4.
- **New rule, `numeric_object "reject"` (rms_front; control "accept"): DE takes no bare number as the object of
  `create_object` or `add_object`.** My CK scripts wrote 293, 346, 647 and 1613 as numbers. With the rule, all
  eight differing maps are identical, so **all 23 saved CK maps match**:
  - an `add_object` with a number is ignored (A: the group keeps only VILLAGER, and DE saved only males, every one
    on the model's tile);
  - a `create_object` with a number loses its command word, and its attribute block joins the previous
    `create_object`, later values winning (E: the town centre became gaia, 5 objects, find_closest at min = max 3,
    and DE saved 3 gaia town centres per player there and no player town centre; D: min 12 on top of max 0 placed
    nothing);
  - with no earlier `create_object` the block is dropped (G4).
  No earlier probe or corpus script writes a bare number there, so older rounds are unaffected.
- **What this means for the confirmations:**
  - A still confirms `group_initial "raw-none"`. Its one-entry group of VILLAGER (which has a replacement rule)
    places only males, with no replacement roll; the "replaced" control differs.
  - D (second_object group), E (builder deletes) and G4 tested nothing of what they were for. A round CK2 should
    repeat them with constants.
- **What it means for the open causes:**
  - Comeer's huts are not the terrain, and not the hut. The model places them right on GRASS and SNOW alike, so the
    cause is in Comeer's own hut command (`max_distance_to_other_zones 4`, `avoid_forest_zone 2`,
    `avoid_actor_area 1113`, `min_distance_group_placement 2`) or the map around it.
  - Caverns' +2 stream-6 draws per player are not from TC_PLACEHOLDER 1870 at HP 0 with second_object TOWN_CENTER:
    G1-G3 match. Caverns' command adds `place_on_forest_zone`, `min_distance_group_placement 4` and Caverns'
    effects.
  - Heart's villagers are not about the town centre standing off the origin: H1 matches.
- **The last 7 CK maps** (saved 19:50-20:02 after the driver's generation wait for p1 rose to 90 s; p1 at 1010 takes
  about 2 minutes to generate, and the earlier Save As failures were clicks made while it was still generating):
  - **L1 repaint, L2 terrain_mask 1, L3 terrain_mask 2: identical at both seeds** (decorations included). Simple
    repaints and masks do not cause Heart's, Rekawa's and Bazi's decoration drift; something more specific does.
  - **P1 1010 differs by one STONE** (`require_path 1`): the model (ignoring require_path) puts it at
    (88.5, 69.5); DE at (77.5, 71.5), so DE refused the first spot behind the lake from player 1's origin
    (73, 100). One later GOLD follows from it. P1 1009: no refusal.
- **Round CK totals:** 29 of 30 identical with `numeric_object "reject"`; the 30th needs `require_path`.

## 2026-11-08, require_path (`object_model.path_ok`, `path_eval.py`; data: CK p1 1009/1010, CF u7 1002-1005)

- **AoE2RMSIDE (behaviour restated):** a search from the anchor's tile centre to the player's land-origin tile.
  4-connected, with corner shortcuts, the length being the sum of straight segments. Only terrain blocks (zero cost
  for the path reference object's restriction); whether placed objects block was not confirmed. Accepted when a
  route exists, and for N > 0 when trunc(route) <= trunc(straight) + N. No draws.
- **Implemented as readings** (`require_path "on"`): `path_diag` "theta" (any-angle) / "sqrt2" / "one",
  `path_objects` "ignore" / "block", `path_slack` 0 / 1, `path_origin_free` 3.
- **None beats ignoring require_path** (2 of 6 identical; the best readings also 2 of 6, on other maps):
  - p1 1009: DE refused nothing, though several of the STONEs it kept (`require_path 1`) need routes 2.5 to 8
    tiles longer than the straight line round the lake (e.g. (95,41) to (73,100)... (107,45): 33.6 against 31.1).
  - p1 1010: DE refused a STONE at (88,69) for the origin (73,100) with open land straight between them: no water,
    no objects. So DE's refusal is not a detour test as restated.
- **Default back to "off"** (attribute reported unmodelled, as before). Open: what DE's require_path measures.
  A probe should use open land, then single barriers of known shape, with N = 0, 1, 5, 20, and objects placed one at
  a time (find_closest) so each refusal is visible.

## 2026-11-08, Venn's wall chain (`venn_eval.py`; data: Venn 1004)

- **How the script builds walls:** each player has its town-centre land and a one-tile gravel land on its inner wall
  line (`assign_to_player`), so every per-player command runs twice per player.
  - A placeholder next to the gravel land opens actor area 9033 (r 14).
  - A 22-placeholder group (find_closest in 9033) starts the chain.
  - 44 single PLACEHOLDER_WALL commands (each in area 9034 r 1, `max_distance_to_players 29`) crawl along the gravel.
  - 5 commands of 80 back walls (area 9035) follow.
  - 14 gaia walls are placed at the end (`place_on_specific_land_id 5`, find_closest).
  - Every wall is a `second_object WALL`, which deletes its 278 placeholder (builder_deletes; DE keeps only 2 278s).
- **Model now:** a wall on all 458 gravel tiles, as DE, but 472 walls, because the 14 gaia walls stack on players'
  walls in the middle of the inner lines. DE puts them on free gravel where the circles cross; 393 of 458 have the
  right owner.
- **Readings tried:**
  - `area_ctx "land"` (actor-area records per land, not per player): 402 walls, 358 right. Refuted.
  - `occupied_tiles "taken"` (an obstructing object makes its tile unavailable): refuted. Actor-area picks that land
    on unavailable tiles restore their weight and add one, as AoE2RMSIDE does, so on Venn the weights balloon past
    3 million draws. DE cannot be doing that.
  - `gaia_occupancy "all"`: the cause of the stacking is the obstruction exemption for a gaia occupancy object
    (278 has no height) against player-owned objects. With the exemption off, the gaia walls no longer stack:
    417 of 458 right, owners 218/215/14 against DE's 222/222/14. But 11 tiles get no wall: the inner-line ends
    (x 54, y 35-39; x 68, y 80-85) go to gaia, and the crossing tiles DE gives to gaia stay empty. All objects at
    DE's position 8,341 -> 8,340. Kept as a candidate, not the default. The race between the two frames' crawls,
    at the inner-line ends, still differs.
- **The RMS guide on require_path (owner, 2026-11-08):** a path to the origin of the object's associated land. Its
  purpose is to keep resources from being trapped in or behind forests, and walls and gates obstruct, so placed
  objects do block. 0 or no argument only excludes inaccessible spots; 1 asks for a "mostly direct" path; larger
  values allow less direct ones, and the "maximum effective value depends on how constricted the path is" (a
  budget-limited search?); for groups only the first object is checked.
  - Fits p1 1009 (routes up to 8 tiles longer than the straight line accepted at N = 1).
  - Does not explain p1 1010's refused (88,69): open grass straight to (73,100), the only nearby objects a GOLD 3
    tiles off the line and FORAGE. A probe with objects placed one at a time is needed.

## 2026-11-08, round CL set up (`probe_cl.py`, `run-sheet-cl.md`, driver `tools/editor-automation/batch_cl.ps1`)

28 maps: seeds 1011/1012, plus Comeer's variants at 1004. Every object is named by a constant.
- **A:** CK's spoiled probes with constants:
  - a1: group second object (control "drop");
  - a2: builder deletes (control "off");
  - a3: the town centre on a 647, measured.
- **B:** Comeer at 1004 with its hut command missing max_distance_to_other_zones 4 (b1), avoid_forest_zone 2 (b2),
  avoid_actor_area 1113 (b3) or min_distance_group_placement 2 (b4). Measured.
- **C:** the 1870 marker with second_object TOWN_CENTER near forest, plus place_on_forest_zone (c1),
  min_distance_group_placement 4 (c2) or both (c3); FORAGE's facets measure the draws.
- **R:** require_path:
  - r1 open grass (N 1, 5, bare);
  - r2-r5 GOLD on GRASS clearings in a FOREST base with DIRT paths between players, at N 0/1/5/20;
  - r6 behind a stone wall ring.

  Main reading: not modelled; controls "+theta-block" and "+theta-terrain".
- The driver waits 90-150 s for the R maps.

## 2026-11-09, round CL compared, first part (`compare_cl.py`, `cl_run.txt`; 14 of 28 saved, 3 of them with the wrong script)

- **Run:** the Sonnet session saved maps 1-14, then stopped on repeated "Save As screen did not load" (game on More
  Content). The label crops showed c1 1011, c1 1012 and c2 1011 were saved with the b4 script: the editor was still
  dimmed (label average 35,28,24 against about 175,144,119) when the script was picked. Those three maps are in
  `scenario\cl-wrong-script-2026-11-08\`. `batch_cl.ps1` now waits for a bright label before picking (Wait-EditorReady,
  90 s, one Esc recovery from More Content) and confirms the pick against the earlier crops (same script: difference 0;
  two scripts: 6 or more).
- **Frozen main reading: 5 of 11 identical** (a1 x2, a3 x2, c2 1012).
- **A1 confirms `second_group "pick"`** (main identical, `+drop` differs, both seeds).
- **A2 refutes `builder_deletes "scripted"`:** DE keeps every PH_NEUTRAL_OFF under the live PH_PLAYER_OFF and SHEEP
  (`+off` identical). In Bulls_Eyes the deleters are objects with hit points exactly 0 (the LAZY flags, effect-set, that
  647 brings as second objects; the pigs, GAIA_SET HP 0). New default **`builder_deletes "hp0"`** (`cd.hp == 0`;
  647's own data value -1 does not count): a2 identical at both seeds, Bulls_Eyes 1004/1005 unchanged (380 and 387
  objects, as saved; `off` gives 392).
- **A3** (647 with second_object TOWN_CENTER, constants): identical at both seeds.
- **B, Comeer's huts:** only b1 (no `max_distance_to_other_zones 4`) has huts, one per player, at the model's tiles
  (49,58) and (86,63). The players stand on 289-tile islands (restriction 4 components); with the filter the model
  sent the huts to (13,87) and (98,92), on other landmasses (765 and 754 tiles). New default **`other_zones_ref
  "player"`**: a player's object measures `max_distance_to_other_zones` against its player's origin zone, so it stays
  on that zone. b2 repredicted: no huts (as DE), script objects identical 8,178 -> 8,182. (`cl_huts.py` counts huts;
  `cl_post.py <stem> KEY=VALUE` repredicts one map with overrides.)
- **C:** c2 1012 identical; the rest not saved yet.
- **Regression with both new defaults** (`FRESH=1 MAIN_ONLY=1`; `reg_cl_ch.txt`, `reg_cl_co.txt`, `reg_cl_cf.txt`):
  CH 18/18, CO 56 identical / 5 different (as before), CF unchanged (u4, u6, u7 differ).
- **Left to save:** c1 x2, c2 1011, c3 x2, r1-r6 x2 (17 maps).

## 2026-11-09, round CL compared, second part (parts C and R; `cl_run_c.txt`, `cl_run_r.txt`)

- **Editor run:** the 17 missing maps were saved by `batch_cl.ps1`, which now uses `tools/editor-automation/screen.py`
  (recognises the game's screens from a coarse colour grid and clicks through them, checking each screen before the
  next click). A stale label crop (24hr_Petra saved as c1's) had blocked the script check; the check now also needs
  the label to start with "cl-", and two scripts count as different from a label difference of 1.5 (r3/r4: 2.26).
- **C (Caverns' +2 stream-6 draws per player):** frozen 4 of 6. Every FORAGE facing after the town centre matches on
  all six maps, so neither `place_on_forest_zone` nor `min_distance_group_placement 4` makes the draws; Caverns'
  effects are what is left. c1/c3 at 1011: both town centres one tile right of the model's. Cause: the zone check
  scanned x-pos..x+neg while its reach test allows neg to the left and pos to the right, so a tree 3 tiles left of a
  4x4 footprint was never seen. **New default `zone_scan "inside"`** (control `"box"`): C 6 of 6 identical.
- **R (require_path):** frozen 0 of 12 (the main reading had it off). Readings:
  - trees (objects) blocking, any-angle routes (`path_objects "block"`): r2, r4, r5 (N = 0, 5, 20) identical at both
    seeds; with terrain only none of them.
  - N = 1 is stricter: `path_slack -1` (route, truncated, at most the straight distance, truncated) makes r3 1011
    identical; r3 1012 has 2 GOLD on other tiles. Grid routes (diagonal 1.414) fit r3 1011 but are too strict
    elsewhere.
  - CK p1 1009 keeps STONEs (N = 1) whose only walkable route goes round its lake: **terrain does not block**
    (`path_terrain "ignore"`): p1 1009 identical, u7 1002/1003 identical (u7 1003 was different before).
  - Unexplained: on open grass DE refuses one N = 1 STONE per r1 map whose straight route is clear (r1 1011 (85,77)
    from (77,94); 1012 (11,15) from (43,24)), as in CK p1 1010. Tiles with nearly the same offset and distance are
    accepted, and nothing stands near the route or the origin, so it is not a route length.
  - r6 (walls) not modelled.
- **New defaults** (`object_model`): `require_path "on"`, `path_objects "block"`, `path_terrain "ignore"`,
  `path_slack -1`, `zone_scan "inside"`. Controls: `require_path "off"`, `path_objects "ignore"`, `path_terrain
  "block"`, `path_slack 0`, `zone_scan "box"`.
- **Regression** (`reg_cl2_*.txt`, before `path_terrain`): CH 19 identical, CO 61 lines as before, CF one better
  (u7 1003). Battle Lines and Rage Forest (both use require_path) unchanged under every reading.
- Open: the N = 1 open-ground refusals, u7 1004/1005, r3 1012, walls, Caverns' effects and its two facing draws.
- **N = 1 open-ground refusals, investigated (2026-11-09, `r_table.py`, `r_rows.txt`, `r_fit.py`, `path_sweep.py`):**
  7 refused of 89 N = 1 tiles on r1, u7 and CK p1 (all with a clear straight route; u7 1004 also accepts a tile with
  a 1.27-tile detour). Not separated by: the route's clearance from any object (decorations included), decorations
  blocking their tile (`path_decor "tile"`), the town centre blocking its square with the open area round the origin
  at 0-2 (`path_buildings "block"`, `path_origin_free`), or any sub-tile offset of route and straight ends with
  floor/ceil/round (best 6 errors of 89, accept-all 7). Pattern: every refused tile lies north of its origin (dy < 0),
  six of seven north-east, and exactly opposite offsets get opposite answers ((12,-9) refused, (-12,9) accepted).

## 2026-11-10, require_path solved: AoE2RMSIDE's route search, restated (`path_search.py`, `path_search "hier"`)

- **Data (owner's experiments on `test.rms`, all n2-brit, seeds 1011-1015):** one STONE command with 650 groups,
  `require_path 1`, `find_closest` (`cl-r1-path-open-edited-stone-only-find-closest`), and three controls: no
  require_path (`-nopath`, 1300 stones, no gaps), `require_path 0` (`-path0`, ~432, no gaps), no town centre
  (`-notc`), plus 650 one-stone commands (`-650cmds`, nearly the same gaps as one command) and the owner's
  `find_closest_to_map_edge` version (`cl-r1-path-open-edited` 1011). So the gaps in the ring come from N = 1's
  length test, not from the town centre or from the command structure. Run by `tools/editor-automation/batch_seeds.ps1`
  (seed change only; test.rms has no effects, so no fresh editor needed).
- **The search (behaviour, restated from AoE2RMSIDE 7525df0 `exact_path.rs` and its search module):** the walkable
  grid (here: every tile, minus the collision box of each object whose pathing action is 1, 2, 10, 11 or 13, outline for
  11; trees and STONE block, town centre and decorations do not) is kept as a 4-level quadtree (cells of 1, 2, 4, 8
  tiles). A best-first search runs over cells from the candidate's tile centre to the origin's tile centre, 4-connected
  with shortcuts at orthogonal turns, ties broken by its own bucket queue; the route is then rebuilt through the
  portals between cells, and its length is the sum of the straight segments (f32). Status 2 (stopped near a goal it
  cannot reach) and 3 (no route) refuse. N = 0 needs only a route; for N >= 1, trunc(length) <= trunc(straight) + N.
  The route bends where the cell grid makes it bend, so on open ground its length exceeds the straight line by an
  amount that depends on direction and position: that is the north/north-east pattern of the "open-ground refusals"
  (2026-11-09), and why exactly opposite offsets got opposite answers.
- **Results:** all 20 stone maps identical, stone for stone (find_closest 164/193/189/157/171; path0
  432/397/432/432/432; notc 164/172/171/152/165; 650cmds 170/193/171/169/171), the edge version 1011 (1300) too
  (`hier_stone_maps2.txt`, `hier_edge_1011.txt`).
- **Two more rules from the route maps** (`hier_sweep.py`; r1-r5 at 1011/1012, CK p1 1009/1010, u7 1002-1005):
  - terrain does not block DE's route even here (water blocking loses five CK p1 1009 stones whose route goes round
    the lake): 13 -> 14 of 16. AoE2RMSIDE takes terrain costs from a reference object named in a bindings file that is
    not in the repository, so its side cannot be checked;
  - **the route check comes after the group-distance squares are removed** (AoE2RMSIDE's order: a refused tile still
    knocks out its `min_distance_group_placement` / `temp_min_distance_group_placement` neighbours; `path_order
    "after"`): r3 1012 identical (the model had accepted a GOLD with route 30.99 against a limit of 31): 15 of 16.
  - clearance: the villager's collision half-extent (0.2) is best; 0.6 gives 13, 1.0 gives 11.
- **CK p1 1010 is not a route question:** its one difference is player 2's first GOLD of a command with no
  require_path, which DE refuses on (46,59), a three-tile grass island inside the lake (beach round it). The
  2026-11-08 note ("one later GOLD follows from" the STONE) was wrong: the GOLD command comes first. Open; perhaps
  player objects stay in the area joined to the player's land.
- **New defaults:** `path_search "hier"`, `path_order "after"`, `path_clearance -1` (villager). Controls:
  `path_search "theta"`, `path_order "before"`. `path_slack` is not used by "hier" (its rule is built in).
- **Regression** (`reg_hier_*.txt`): CH 19 identical and CO 61 as before, map for map; CF 60 (+2: u7 1004 and 1005).
  Old route maps: 10 of 16 under the old any-angle reading, 15 of 16 now. Battle Lines and Rage Forest (1004/1005)
  give the same output under both searches (`reg_hier_cg_*.txt`); their differences lie elsewhere.
- Speed: one route search per untried candidate per grid state (`_hier_memo`); a map with one big command takes
  seconds, 650 one-stone commands take 30-70 minutes (the grid changes after every command).
- Open: CK p1 1010's island GOLD, r6 walls.

## 2026-11-10, player objects stay in their centre's zone (`player_zone "same"`)

- **CK p1 1010's GOLD** (the one route-map difference left above): DE refuses (46,59), a grass tile on a small lake
  island (33 land tiles), for player 2's first GOLD (no require_path), and takes a later candidate instead.
- **Rule (behaviour, restated from AoE2RMSIDE 7525df0, `exact_object.rs` candidate loop and `exact_zone.rs`):** for
  an object placed for a player (not `ignore_terrain_restrictions`), each candidate popped from the queue is first
  checked against the zone of the player's centre; a mismatch drops it with no draws. Zones: 4-neighbour patches of
  tiles that the object's restriction all allows or all refuses, with the centre's own terrain and layer terrain
  counted as allowed. Labels are given to every patch in tile order, modulo 512, and the centre's label is compared
  on its low 8 bits. The zones are worked out once per allowed set and not refreshed when objects repaint terrain.
- **Results** (`zone_fresh.py`, fresh predictions): CK and CL 52 of 52 identical (51 without the rule: p1 1010);
  route maps 16 of 16 (`hier_sweep.py`). Regression `reg_zone_compare_{ch,co,cf}_same.txt`: CH, CO, CF map for map
  as before.
- **New default** `player_zone "same"` (control `"off"`). Not run yet: the CG-CJ corpus objects (water maps such as
  Immersion would show it most).

## 2026-11-14, walls (`wall_model.py`, `compare_walls.py`)

- **What DE saved** (u6 1002, read before modelling): a per-player wall at min 12 / max 13 is a square ring on the
  inner line (Chebyshev 12) whose four corner tiles stay empty. Each side is a run of 23 tiles with a 4-tile gate in
  the middle (offsets span//2-2 .. span//2+1 from the run's start), so 19 pieces per side, 76 in all. The gate is one
  object (palisade 789 horizontal / 793 vertical, stone 64 / 88); its flanks are its own children, which the file
  omits. Pieces store facet 2 at a run's ends, 0 on horizontal runs, 1 on vertical runs. A ring that reaches the
  map's edge runs to the edge row and has no side there (the stone ring at 20, 3 gates).
- **Rule (behaviour, restated from AoE2RMSIDE 7525df0, `exact_object.rs` wall path cache and ring placement; full
  description at the top of `wall_model.py`):** a per-player command whose object is of the wall class takes no
  candidate tiles. The queue and the first pick are spent as for any command. Then, once per pair of radii, four
  bands per player (left, right, top, bottom, players in slot order, centred on the town centre's tile) are crossed
  by a best-first search whose step costs favour walkable tiles on the inner line and avoid tiles already taken.
  Tiles are kept only where the owner's centre reaches them through side steps over land without crossing its own
  wall (this drops the corners) and where its enemies reach them from outside. The kept tiles are cut into
  straight runs; runs over unwalkable tiles are not built; runs of span 4 or more get a gate. Every piece spends its
  creation draws (2 for a wall, 1 for the gate and 1 for each flank). Gaia commands build the routes but place nothing.
- **Results, fresh predictions:** all 7 saved wall maps identical (u6 1002/1004/1005, ob13 1000/1004, CL r6
  1011/1012; r6 places GOLD and STONE with require_path behind a stone ring, plus DEER, GOLD and FORAGE afterwards,
  so it also checks the draws and the walls as route blockers). Control `walls "off"` (walls as ordinary objects,
  the model before): all 7 differ.
- **New default** `walls "ring"` (control `"off"`). `path_ok_hier`'s walkable grid moved into `Stage.walk_grid`
  (same grid). Regression: see below.
- **Not tested** (every saved ring is a plain square on open grass): bends around trees, water, cliffs or resources;
  diagonal runs and their gates; walls of allied players (the enemy-reach filter); two wall commands sharing
  radii after the town centres moved (the cache is reused); unwalkable gaps in a ring; wall groups; walls with
  `actor_area`. A confirming round would put rings across forest edges, lakes and gold, with teams.
- **Regression after walls:** CH 18 of 18 fresh (same as `reg_zone_compare_ch_same.txt`), CL route maps r1-r6 12 of
  12 fresh. No other saved script has a per-player wall-class command (Blind Valley's is commented out; Venn's
  walls come from a class-11 placeholder), so the wall branch changes no other map.

## 2026-11-14, Caverns' two extra draws: an effect's standing graphic

- **Cause:** Caverns sets `ATTR_STANDING_GRAPHIC 12800` on TC_PLACEHOLDER 1870 (beside HP 0). Graphic 12800 has 4
  angles flagged random facet and random angle; 1870's own graphic 12801 has 1. Round CK g1-g3 used the marker
  without that effect, which is why they matched.
- **Rule:** an object's creation draws follow its current standing graphic. For buildings (constructor 80) the content
  pack's creationRng follows from the graphic for 469 of 471 (the 2 others have a 0-angle graphic and differ only in a
  stored fixed facet): several angles flagged random angle give a random angle, plus a random facet when the graphic
  is flagged random facet too; otherwise fixed facet 7; the combat seed always. So the 1870 spends facet + angle +
  seed, 3 draws instead of 1: the +2 per player. The file's frame field holds 0 (as for every fixed-facet building),
  and its rotation field holds the drawn facet: 3, 5, 1, 1 on the four 1870s, exactly the model's draws (corrected
  later the same day: our reader takes the frame for 1870, because the base object draws no angle).
- **Results:** `obj_facets.py`: every random facet at DE's positions matches on Caverns 1004 and 1005. **Caverns
  1004 and 1005 are identical, every object** (14,141 and 13,808; the first corpus maps fully exact). Control
  `graphic_effect "off"`: identical 12,406 and 12,111, first wrong facing at cmd 18 as before.
- **New default** `graphic_effect "derive"` (object_model; attribute 71 added to `appearance_model.EFFECT_ATTRS`).
  Other scripts with standing-graphic effects (Comeer, Ra, Rage Forest, Rekawa on terrain makers; DLC_ZEBRA;
  predators) keep their draws under the rule, so no other map changes. Untested: the rule for non-building
  constructors (types 10/20 use `graphic_creation_rng`, 70 and others are left as they are).

## 2026-11-14, effects in general, Heart's decorations, Rekawa's terrain makers, Bazi's zones

- **One rule for creation draws** (object_model `derived_creation_rng`): facet count = the standing graphic's angle
  count; a random facet when the graphic has several angles and is flagged random facet and random angle; a random
  angle when it has several angles and is flagged random angle, for constructors 30, 60, 70, 80; a combat seed for
  constructors 70 and 80. It gives the content pack's draws for all 2,502 objects that have both a graphic and a
  creationRng (no exception), so an effect that changes a standing graphic (attribute 71) changes the draws by it.
- **What the file stores** (reader check over 78 corpus maps): the rotation field holds the facet set at creation
  (7 for fixed-facet objects, the drawn facet otherwise); the frame field equals it for objects that draw, and holds
  0 or 5 for fixed-facet buildings (k9). Units with a random angle (constructor 70) store radians; buildings with one
  store the 8-direction facet (walls, the 1870s). The model stored radians for random-angle buildings; no saved map
  had one besides walls (which the wall model sets), now fixed (`construct`: constructor 80 stores the facet).
- **Effects, the standing reading:** an effect changes the object's definition before generation, and everything
  generation derives from that definition is derived from the changed one: collision (3, 4), terrain restriction
  (53), hit points (0: status, builder deletes), standing graphic (71: creation draws). Attributes generation does not
  read change nothing (u10). Effects persist in the editor between generations (carry-over). Still not modelled, and
  not expected to matter in a saved scenario: foundation terrain (34; terrain makers act when a game starts, and
  Heart's terrain is exact without it), dead unit, storage value, occlusion.
- **Upgrades** (`rms_front` `upgrade_effect "creation"`, control "off"): GAIA_UPGRADE_UNIT / UPGRADE_UNIT A B leaves
  A's id in the file but creates A with B's creation draws. Heart upgrades UNDERBUSH_PLANT_2 1352 (9 facets) to 1366
  (8): DE's 1352 facets are 1366's. With it every Heart decoration at a predicted position has DE's facet.
- **Heart's decorations** (`stage_model` `composite_layer_decor "under"`, control "source"): DLC_JUNGLELEAVES 62 is a
  composite (77 over 60) with no decoration table. Heart paints it with terrain_mask 1 over GRASS_FLOWERS_2 123, so
  the tile has 123 under a 62 layer and resolves to 77 over 60. DE decorates such a tile from 123 (3 draws, 1358
  only); the model used 62's empty table and its raster scan fell 3 tiles behind DE's at the first three such tiles.
  A composite painted as the terrain itself keeps its own table (Ra 1004). Heart 1004 decorations identical 80 -> 622
  of 629, 1005 22 -> 581 of 593; script objects identical 15,488 -> 17,065 and 13,893 -> 17,084. Heart's first wrong
  script command is now cmd 43 BUN_BUNS (hares with second_object MAPLE_LEAVES); the few decorations left differ
  where its objects stand.
- **Rekawa's terrain makers** (`object_model` `retire_obstructing "obstructing"`, control "any"): its 3,881
  MAKE_DIRT3_TERRAIN 1640 (base size 0, made 0.5 by `effect_percent ... 50`, obstruction "none") stand at DE's
  positions, and DE keeps 247 decorations on their tiles; the model deleted 278. Reading: an object with no
  obstruction deletes no decorations. Rekawa 1004 decorations at DE's positions 1,577 -> 1,627, script objects at
  DE's positions 5,158 -> 5,353 (1005: 5,230 -> 5,386). Refuted on the way: `effect_percent` scaling the current
  value (`percent_set "scale"`): size 0 lets the makers pile up, 13,968 script objects against DE's 6,427.
  Rekawa's decorations are still out of step in the object-stage scan (positions differ on 1640 tiles as often on
  both sides). Note: Rekawa places 1358/1359 itself (zero-size, at tile corners), and compare_co counts them with
  the decorations.
- **Bazi** (`object_model` `other_zones_gaia "object"`, control "off"): AoE2RMSIDE measures
  max_distance_to_other_zones on the zones of the command's object's restriction with or without a player; the model
  skipped the check for commands without one. +2 objects on each seed; not the cause of Bazi's first wrong command
  (cmd 59 at 1004, cmd 43 at 1005: its huntables). Bazi's decorations are already within 8 of DE's.
- **Not yet regressed:** `composite_layer_decor`, `upgrade_effect`, `other_zones_gaia`, `retire_obstructing` on
  rounds CH, CO, CF and the other corpus maps.
- **Draw-offset tests (`obj_tilt.py`):** Heart 1004 cmd 43 BUN_BUNS, shifts -12..12, best 15 of 144 (7 at 0); Bazi
  1004 cmd 59 HUNTABLE_SMALL_B, shifts -20..20, best 13 of 102 (7 at 0). No peak in either, so both commands' own
  rules are wrong, not the draws before them. Both are loose groups of 6 small huntables (Heart's without a grouping
  keyword, Bazi's with set_loose_grouping and group_placement_radius 2): the loose-group rule for moving units is
  the next suspect.
- **CO ob8 1000 (the one CO map left):** one FORAGE of player 1 (`avoid_other_land_zones 1`): DE refuses (115,73),
  which the model takes as its 4th forage; the rest of the queue is the same, so DE's 5th lands on (107,75). At that
  command the model accepts (115,73) on every check. Its four-point test at distance 2 reads (117,73), which the model
  has in player 1's zone as a one-tile spur between no-land tiles (117,72) and (117,74) at the land's ragged edge,
  where several DIRT tiles carry no land zone. Readings tried and refuted (`land_zone_scan`, default stays "cross",
  as AoE2RMSIDE): "eight" (diagonals too) and "square" (the whole square) break seeds 1001 and 1004 and make 1000
  worse. Most likely the land stage's zone map differs from DE's at that edge tile; the terrain matches, and the zone
  map is not stored in the file, so it has never been checked directly. A probe would map DE's zones at land edges
  with dense single objects under `avoid_other_land_zones 1`.

## 2026-11-14, Heart and Bazi solved; regression of the day's rules

- **Heart's hares (cmd 43) and Bazi's huntables** (`object_model` `filter_queue "resolve"`, control "fixed"): with a
  class filter (avoid_forest_zone etc.) and an object that has to be resolved (a group, or an object with a
  replacement rule), every tile that is available and inside the geometry resolves the object (group roll, plus a
  replacement roll where one applies) before the filter is tested. This happens while the candidates are collected,
  at every pick of the queue shuffle (a pick that passes moves to the front, or joins the queue if it was not a
  candidate), and in a loose group's local queue (whose tiles are also tested against the class filter and the
  actor areas). Restated from AoE2RMSIDE (collect_candidates, the shuffle predicate, local_group_queue). Heart 1004
  script objects identical 17,065 -> 17,449.
- **Heart cmd 48** (`loose_route "area"`, control "local"): a loose group on the actor-area route (MAPLE_LEAVES,
  actor_area_to_place_in 2) draws its members from the whole area record, as its anchors, not from a local queue
  round the anchor (AoE2RMSIDE). Heart 1004: every decoration identical, all 17,507 script objects at DE's
  positions.
- **Bazi 1004's last 4 draws** (`desc_round "half-up"`, control "even"): birds.inc asks for number_of_objects
  (BIRD_COUNT * 1.5) = 4.5 with set_scaling_to_map_size; DE made 7 = 5 * 1.44, the model 5 = 4 * 1.44 (Python's
  round() rounds half to even). Integer attributes now round half away from zero. **Bazi 1004 identical, every tile,
  decoration and object.**
- **`retire_obstructing` corrected to "hp"**: town centres (obstruction "none") delete decorations in DE (Heart
  1005, Bazi), so "obstructing" is refuted. Reading: an object with negative hit points (the terrain makers 1639 -2,
  1640 and 1641 -1) deletes no decorations. Rekawa unchanged from the obstruction reading.
- **Left on the four maps:** Heart's PANDA_ROCK 2082 is saved with frame 1385 (1004) and 737 (1005), from no stream
  the model tracks (every later facet matches); Bazi 1005 has one decoration DE deletes 0.207 tiles from a villager
  of half-size 0.2 (just outside the model's overlap test); the town centres' facings are left open by the comparison.
- **Regression (fresh, `regress_1114.sh`, files `reg_1114_*`):** CH 18/18 (unchanged); CO 60/61 (was 56: both
  ob13 wall maps, ob5 1001 and xr1 1000 now identical; ob8 1000 left, see above); CF 52/55 (was 49; u4-force left at
  all three seeds); CK + CL 52/52; walls 7/7. Corpus (30 maps, `obj_analysis_v8.pkl`, `corpus_totals.py` against
  the 1 November cache): terrain exact on all 30; script objects identical 109,632 -> 123,558 and at DE's positions
  128,766 -> 136,548 of about 143,000; decorations identical 77,381 -> 78,414. Battle Lines, Blind Valley, Bazi and
  Heart are exact but for open facings and the rock; Rekawa, Venn, Namatjira, Ra and Comeer keep real differences.
- **Round CM set up** (`probe_cm.py`, `run-sheet-cm.md`, driver `tools/editor-automation/batch_cm.ps1`, 46 maps,
  seeds 1013/1014): walls in new layouts, the queue rules, effects, decorations under negative-HP objects, layer
  composites, force_placement, the ignored commands, land-zone edges, the rock's frame.

## 2026-11-14, round CM compared (`compare_cm.py`, `cm_run.txt`; predictions written by 16:19, frozen 16:27:45)

- **Frozen main reading 28 of 46 identical**; every control differs from its main reading. As predicted: w4-w6
  (wall routes reused, a gaia wall, actor areas per piece, rings leaving the map), q1-q3 (`filter_queue`,
  `loose_route`, `desc_round` confirmed on new layouts), e2 (upgrade), e3 (`effect_percent` sets value/100, not a
  scale), c1 (`composite_layer_decor "under"`), f3 (frameless force_placement does nothing), x1 (`make_indestructible`),
  x2 (`set_gaia_civilization CIVILIZATION_AZTECS` changes nothing for gaia VILLAGER and SCOUT here), x3
  (`nomad_resources`, `guard_state`).
- **Fixed after the run (defaults, controls kept):**
  - d1: DE deletes the decorations under the 1640 terrain makers and under STONE at HP -1; its control ("any")
    is identical at both seeds. `retire_obstructing` back to "any" ("hp" and "obstructing" refuted). Rekawa's "247
    decorations kept on 1640 tiles" were Rekawa's own zero-size 1358/1359 script objects (all at tile corners),
    created after the makers.
  - e1: GOLD given graphic 12800 draws its facet over the graphic's 4 angles, not the pack's 7
    (`effect_creation_rng` now also compares the facet count). DEER given the one-angle 12801: positions and draws
    right.
  - w1/w2 at 1014: a run's end piece is a post (facet 2) only when the tile beyond it along the run holds none of the
    player's wall; a horizontal run starting next to a diagonal run's end piece starts with facet 0
    (`wall_model` `wall_end_facet "open"`, control "always" = AoE2RMSIDE). Refuted on the way: cutting runs by
    direction passes (`wall_runs "passes"`: right pieces, wrong order, older maps broken) and starting a new run at a
    walkability change (`wall_split "same-direction"`: moved a gate).
  - w3: DE's rings run straight on the inner line across lakes, unbuilt on the water. The wall routes' walkable grid
    ignores terrain (as require_path's: objects block, terrain does not) and pieces on terrain a wall cannot stand on
    are not built (`wall_terrain "ignore"`, control "block" = AoE2RMSIDE). With these, every wall map is identical:
    u6 x3, ob13 x2, CL r6 x2, CM w1-w6 x2 (19 maps).
- **Open after the run:**
  - f1/f2 (force_placement per player): counts right (60 sheep, 72 gold); the normal phase matches; the forced
    objects visit the anchors newest first as in the model, but DE's corner offsets (0 or 1 in x and y) match no
    simple reading of the main stream (low bit, high bit, bounded(2); 2-5 draws per object; up to 3,000 draws on) or
    of stream 6. A 9-of-9 fit at 1013 (3 draws per object, 379 on) failed at 1014. Either DE visits the anchors in
    another order, or the offsets come from elsewhere.
  - z1 (TURKEYs under avoid_other_land_zones 1): every TURKEY DE placed is at a model position, in the model's order
    with DE's refusals removed (23 at 1013, 42 at 1014). The refusals are spread through the land; three at 1013 have
    their tile and every check point vouched for by accepted tiles, so no fixed zone map explains them. Not tied to
    the town centre, earlier turkeys at the check points, later objects, decorations, terrain or distance from the
    player. ob8 1000's refusal is probably the same rule.
  - r1/r2: the panda rock's stored frame repeats exactly at the same seed (460, 406, 301, 1339, 950, 550 at 1013), so
    it is deterministic; its source is not found (the model spends no stream-6 draw on it, and every later facet
    matches).
- **Second regression (`regress_1114b.sh`, `reg_1114b_*`), after the CM fixes:** CH 18/18, CO 60/61 (ob8 1000), CF
  52/55 (u4), CK + CL 52/52, walls 7/7, corpus unchanged (`obj_analysis_v9.pkl`: script objects identical 123,558,
  at position 136,548, terrain exact on 30). **CM fresh: 36 of 46** (`reg_1114b_cm.txt`); left: f1, f2, z1, r1, r2
  at both seeds.

## 2026-11-14 (evening), the CM questions against AoE2RMSIDE (7525df0)

- **force_placement (f1/f2, CF u4):** AoE2RMSIDE's forced phase is the model's (anchors newest first; x and y from the
  low bits of two stream-2 draws, drawn before any check; from pass 10 a first draw picks the tile centre when it is
  divisible by 5), but it checks obstruction in every pass. That refuses too much (94 objects against DE's 112). What
  fits DE: a start 378 draws later (9 passes x 21 anchors x 2 draws) with the centre-or-corner draw, all 36 forced
  positions on four maps at two seeds. So passes 1-9 check obstruction and here refuse every anchor (every tile
  already holds a sheep or the town centre); from pass 10 nothing is checked and objects stack. New default
  `force_obstruction "early"` (controls "never", the model before, and "always", AoE2RMSIDE): **f1, f2, f3 identical
  at both seeds, and CF u4-force identical at all three seeds** (open since round CF); ob10 unchanged.
- **avoid_other_land_zones refusals (z1, CO ob8 1000):** AoE2RMSIDE's `land_zone_rejection_removal`: a tile refused by
  avoid_other_land_zones that lies more than the zone distance from the player's centre (and within the command's
  min/max distance) takes out of the queue the tile one zone-distance step from it toward the centre on each axis
  (an axis level with the centre steps negative). The removed tile is never tested, which is why DE skipped tiles
  that pass every check. New default `land_zone_removal "toward"` (control "off"): **z1 identical at both seeds, and
  CO ob8 1000 identical** (CO now 61 of 61 under fresh predictions, pending the regression).
- **PANDA_ROCK's stored frame:** AoE2RMSIDE has no stored-frame logic (it models generation state, not the scenario
  file), and its content pack has the same three fields for graphic 12860 as ours (no frame count). Placing the six
  rocks spends no draw on stream 2 or stream 6 (the queue is built once and popping it draws nothing), yet every rock
  gets its own frame; no stream 1-15 gives six consecutive draws that scale to the frames (6,000 offsets, 15-bit and
  32-bit scaling, modulo). Round CN (`probe_cn.py`, `run-sheet-cn.md`, `batch_cn.ps1`, `compare_cn.py`, 7 maps,
  frozen 20:01:08) separates instance id from position and seed.
- **Third regression (`regress_1114c.sh`, `reg_1114c_*`):** CH 18/18, **CO 61/61, CF 55/55**, CK + CL 52/52, walls 7/7,
  **CM 42/46** (only r1 and r2, the rock frames, differ), corpus unchanged (`obj_analysis_v10.pkl`, 123,558 script
  objects identical, terrain exact on 30).

## 2026-11-15, round CN run and compared (`compare_cn.py`, `cn_run.txt`; frozen 2026-11-14 20:01:08)

- 7 maps, positions all as predicted (the frozen frame field was 0, so every rock "differed" in frame only).
- **PANDA_ROCK's stored frame: the k-th rock created gets the k-th value of a per-seed sequence.** In reference-id
  order n1, n2, n3 and CM r1/r2 give the same values at a seed (1013: 1339, 406, 301, 950, 550, 460; 1014: 1159,
  725, 1195, 470, 427, 61; 1015 n3: 272, 891, 800, 497, 534, 1318), whatever the tiles, the instance ids (n1 vs n2,
  +12) or the objects and decorations made before. (The run notes' "n1 order vs n3 order" was a misreading.)
- **Source not found:** `rock_search.py`, `rock_search2.py` (streams 1-32 of the seed's chain, offsets to 4,000,
  strides 1-5, multiply-shift at any scale, modulo N 1,386-69,999; two planted sequences found as a control);
  mt19937, the exe's 64-bit LCG, Numerical Recipes' LCG and MSVC rand seeded with the map seed: no hit.
- **Closed:** `object_model` `unknown_frame "open"` (control "zero"): the rock's frame is a file field the model leaves
  open, as for fixed facets; it is cosmetic, so the preview does not need it.
- **New rule (n3 1015):** a placed object also deletes a decoration already retired (status 7) by the object stage's
  decoration pass: `retire_dying "delete"` (control "skip" keeps a DLC fern 1358 under a rock).
- Fresh: rock maps 11 of 11 (`rock_fresh.py`; controls 10 and 0). **Regression (`regress_1115.sh`, `reg_1115_*`):
  CH 18/18, CO 61/61, CF unchanged, CK + CL 52/52, walls 7/7, CM 46/46 (`cm_fresh.py`; was 42), corpus unchanged
  (`obj_analysis_v11.pkl`: script objects identical 123,558, at position 136,548 of 143,084, terrain exact on 30).**
  Every probe round is now complete; what is left is in the corpus (Rekawa, Venn, Namatjira, Ra, Comeer objects).

## 2026-11-15 (later), Venn's walls (corpus; `obj_analysis_v14.pkl`, `regress_1115c.sh`, `reg_1115c_*`)

- **Placeholders:** 450 of 452 PLACEHOLDER_WALL 278 (HP 0, can be built on) are missing under the WALLs they bring as
  second objects. `builder_deletes "hp0-either"` (default; control "hp0"): a non-build-on object deletes a scripted
  build-on object under it when either of the two has HP 0. CL a2's surviving PH_NEUTRAL_OFF 346 have HP 1, so it
  holds; it restores what the old "scripted" reading did for Venn before CL a2 narrowed it.
- **Wall shapes:** walls placed outside `create_player_walls` keep their creation draws (angle + combat seed), but
  the file stores a joint shape from the piece's final neighbours of the same owner: N and S -> 1, else E and W -> 0,
  else NE and SW -> 4, else SE and NW -> 3, else the post 2. One shape per neighbour pattern, 38 patterns, both seeds.
  `wall_joints "neighbours"` (control "angle"), only for class-27 objects that draw a random angle (the terrain
  makers 1639-1641 are class 27 too and store 0: CM d1 broke without that limit); ring pieces keep wall_model's shape.
- **Gaia walls:** `gaia_occupancy "all"` (candidate since 2026-11-08) is now the default: with the placeholders
  deleted, the 14 gaia walls go to the lens tips as in DE and every wall and second object is identical
  (472 of 472 at both seeds). The 11 empty crossing tiles of 11-08 are gone.
- Venn script objects identical 165 -> 600 (1004), 177 -> 606 (1005); corpus 123,558 -> 124,422, at position
  136,548 -> 136,576. Regression: CH 18/18, CO 61/61, CF unchanged, CK + CL 52/52, walls 7/7, CM 46/46, rock maps
  11/11. `obj_facets.py` now skips wall pieces (their stored shape is not their draw).
- Counting note: `corpus_totals.py` counts an open facing (None, e.g. Rekawa's 3,881 terrain makers 1640, which
  store 0) as not identical, so its "identical" understates maps with fixed-facet objects; "at position" is unaffected.
- Venn left: HOUSE (cmd 112) and KING (113) positions, FORAGE facings (115), 25 type-66 and 18 type-102 objects no
  prediction explains, one decoration each at (60,15) and (68,24).

## 2026-11-15 (evening), the rest of Venn: stuck on actor-area route picks (no default changed)

- **Where Venn now parts from DE:** 1004 cmd 112 HOUSE (one of four), then cmd 113 KING at both seeds; every later
  command (WATCH_TOWER, FORAGE, GOLD, STONE, ... 114-129, ~65 objects a map, the "unexplained" 66/102/59/65 types)
  follows. All three of HOUSE (area 2814), KING (2812) and WATCH_TOWER (2820) are `actor_area_to_place_in` routes
  over areas made by the ONGRID_PLACEHOLDER 1613 commands (two per player, one per land frame, both on the TC tile:
  positions match DE, 32 per player). The script defines REGICIDE itself (line 10), so the KING command is real.
- **HOUSE 1004:** a three-way tie at Chebyshev 8 from the player's origin (85,59): (85,51), (77,59), (85,67). DE takes
  the top and the left, the model the bottom and the left. Stream shifts of -3/-4 at cmd 112 fix it (`obj_tilt.py`),
  which points at the shuffle's draws, not the tie rule.
- **KING (both seeds):** DE's tile passes every check in the model (terrain 41, forest zone, min 6 / max 12 Chebyshev
  from the land origin, area 2812) but ranks 26th-42nd of ~70 valid candidates in the model's route order.
  Refuted, each on both seeds:
  - a stream-2 shift at cmd 113 of -20..+20 (`obj_tilt.py`), and a brute-force search of -3,000..+3,000 for the
    route's start (scratch `king5.py`): offsets that place each player's KING exist at chance density, with one
    common offset per seed (-1978, -2531), which differs between seeds;
  - the four frame orders (land 2 first, per player, both);
  - the plain shuffled queue instead of the route (for KING, and KING + tower);
  - skipping the command (draws not spent): worse;
  - `area_ctx "land"` (records per land): whole map worse on both seeds (6537 -> 6382, 6503 -> 6343);
  - a repeat registration at the same spot adds no weight: whole map worse; limited to the ONGRID areas 2804-2839, no
    change for HOUSE/KING/tower;
  - `route_order "oldest"`: no KING.
- **Stream 6 is not the problem:** the first wrong facing is cmd 115's FORAGE, half of them right at shift 0; the
  forage objects are created in another order (stream 2 picks), not drawn wrong.
- **Next:** a probe round for routed picks, since the saved Venn maps cannot separate the readings: a KING (and a plain
  object) with `actor_area_to_place_in` over an area registered once vs twice at one spot, with one and with two
  land frames per player, at several seeds. New tool: `obj_whole.py` (one cached map predicted under each value of a
  VAR, totals as corpus_totals counts them).
- **AoE2RMSIDE on the KING (7525df0, read 2026-11-15):** nothing specific. "Regicide" occurs only as a game mode and
  lobby label (`lib.rs`, `lobby_labels.rs`); object 434 has no single-request count (so not the
  `place_expanded_single_request` path); the actor-area route (`collect_actor_area_candidates`: iterations = the
  record's total weight, weighted draws, unavailable tiles restored, newest valid pick first), the per-draw test
  (`actor_area_queue_candidate_matches`: max distance from the land centre with >=, avoided areas, map edge, class
  filter), record registration and lookup (per land context = the frame's player slot, a land-less record found
  from anywhere) and the frame order (`descriptor_dispatch_placements`) all match our restatement. Its automatic
  technologies spawn units at buildings on stream 7, not the main stream. So AoE2RMSIDE predicts the KING where the
  model does; the probe round stays the way forward.

## 2026-11-15 (late), round CP run and compared (`probe_cp.py`, `run-sheet-cp.md`, `compare_cp.py`, `cp_run.txt`)

- **12 of 12 identical** under the predictions frozen at 22:28:17 (seeds 1016/1017): KING, SHEEP and OUTPOST through
  an ONGRID-made actor area (same tiles, so no KING- or unit-specific rule), the area registered twice on one tile,
  Venn's second one-tile land per player (control `+area-ctx-land` differs on both), and the KING by the plain queue.
  The model's actor-area route is confirmed in each set-up Venn combines.
- **Venn's maps are genuine:** regenerated in a fresh editor (`tools/editor-automation/batch_vennregen.ps1`,
  `RMSTEST_cg-x-venn-regen_1004/1005`), they equal the 30 October files object for object; the script copy is
  byte-identical to the game's and unchanged since 28 October. REGICIDE is `#define`d unconditionally at line 10.
- **Also refuted for Venn's KING:** the KING's route with every tile available, with every occupied tile unavailable,
  and with the model's availability plus occupied tiles (none places a KING at DE's tile); the tiles the model ranks
  ahead of DE's do not differ from it in distance to trees or to other objects or in terrain.
- **Next for Venn:** bisect Venn itself: cut the script right after the KING (everything before kept), then drop
  earlier blocks in halves, a fresh editor per map, until a cut makes the model's KING match DE's. The model is exact
  through cmd 112, so only the KING has to be compared.

## 2026-11-16 (night), round CQ: bisecting Venn's object section (`probe_cq.py`, `compare_cq.py`, `cq_run.txt`, `cq2_run.txt`)

Cuts of `cg-x-venn.rms` (land/elevation/terrain/connection sections whole, objects cut, the KING block last), seeds
1004/1005, a fresh editor per map, predictions frozen before each pass (23:55:33, 00:18:35, 02:08:44).
- Pass 1: v0 (everything to the KING) DE's KING = the full Venn's (control holds), model wrong; v1 (no trees A, no
  walls B) wrong; **v2 (only TC, ONGRID 2812, KING) identical**.
- Pass 2: **v3 (no H = THEMED_TREE1, VILLAGER, HOUSE) identical; v5 (no C, D) and v6 (no D) identical; v4 (only D and
  H) wrong**, the HOUSE itself already off at both seeds (a four-way tie at distance 8 from the origin; DE takes other
  members). So it takes the HOUSE routed through area 2814 (made by the ONGRID block D) to throw the KING off.
- Refuted on v0/v4 (no KING right at either seed): other tie orders after a route under find_closest (route order
  reversed, raster, raster reversed); stream shifts at the KING of +-1250, +-1682, +-2500, +-3364 (the HOUSE route's
  draws per frame, and its two second-land frames); the HOUSE's invalidation off, radius + 1, moved by +-1, or around
  the 2x2 footprint (no effect at all on the KING); a route's weight growth shared with the land's other records.
- Pass 3 (frozen 02:08:44, not saved yet: the screen locked at 02:10): v7 HOUSE without THEMED_TREE1/VILLAGER, v8 v7
  with only areas 2812 and 2814, v9 v7 without the HOUSE's find_closest, v10 v7 with number_of_objects 1, v11 v7 with
  the KING before the HOUSE. Driver `tools/editor-automation/batch_cq3.ps1`; compare with `CQ_PASS=3 compare_cq.py`.
- Pass 3 run 2026-11-16 11:05-11:25 (fresh editor per map; `cq3_run.txt` is the frozen-time stub): **all 10 identical**
  under the predictions frozen at 02:08:44. v7 (v4 without THEMED_TREE1 and VILLAGER) is right, HOUSE and KING, so the
  HOUSE's own route is fine; one of the two commands before it moves it.
- Pass 4 (`CUTS4`, `cq4_predictions.pkl` frozen 12:07:15, driver `batch_cq4.ps1`): v12 the tree without the villagers,
  v13 v4 with the villagers' `place_on_forest_zone` dropped, v14 the villagers through ONGRID area 2806 with no tree.
  **6 of 6 identical.** So it takes the villagers' forest-zone filter.

## 2026-11-16, Venn solved: two rules (`object_model` defaults, controls kept)

- **`route_resolve "late"`** (control "after"). With a class filter (forest/cliff zone), an actor-area route
  re-resolves the object it tests (`filter_resolve`, which spends the VILLAGER's male/female roll). DE spends that roll
  only on a draw that has already passed the distance (from the land centre), avoided-area and map-edge tests, right
  before the class filter; the model, as AoE2RMSIDE, spent it on every draw right after the weight is used. Venn's
  straggler VILLAGER command also runs in each player's second one-tile land frame, where its 9 draws over area 11 all
  fail `max_distance_to_players 10`: 9 rolls each in the model, none in DE, so the HOUSE route started 18 draws late
  (the per-frame HOUSE scan's only both-seeds hit was -18). Found by tracing the frames (scratch `venn_vil.py`).
  v4: HOUSE and KING right at both seeds; whole Venn 6537 -> 6612 of 6615 (1004), 6503 -> 6571 of 6574 (1005).
- **`member_layer "check"`** (control "off"). Loose-group members must stand on `layer_to_place_on` too (the model
  tested only the anchor). Venn's HUNTABLE pairs (LAYER_AUX, 2 groups of 2): the last 3 deer per map and one
  decoration a wrong deer deleted. **With both: Venn 1004 and 1005 identical, every object** (terrain was already
  exact).
- Refuted on the way (v4): a second route per house (`route_regroup`), a symmetric forest-zone reach for the 2x2
  house, the tree's/villagers' tiles (radius 0/1) marked taken, `avoid_actor_area 1113` read as the tree's area 11,
  a class-filter refusal keeping the tile's weight. The HOUSE tie orders were never the cause: DE's picks follow from
  its draws.
- Tools: `cq_fresh.py` (every CQ and CP map predicted afresh), `regress_1116.sh` (outputs `reg_1116_*`, corpus cache
  `obj_analysis_v15.pkl`).

## 2026-11-16 (afternoon), Comeer and Namatjira solved (five rules; rounds CR and CS)

New defaults, each with the old rule kept as the control:
- **`other_zones_ref "player-allowed"`** (`object_model`; control "player", CL part B). A player's object with
  `max_distance_to_other_zones` is compared with its player's origin zone only when its restriction allows the
  origin's tile; otherwise with the tile's own zone. Comeer's TRANSPORT_SHIPs (water restriction, land origin, label
  0) were refused everywhere; DE places one per player. Both ships then on DE's tiles; Comeer's huts unchanged.
- **`area_fallback "landless"`** (`object_model` `record_for`; control "off"). A command in a land frame that finds no
  actor-area record of its own context uses the record made outside any land. Comeer cmd 36 (SHORE_FISH per player,
  `actor_area_to_place_in 7011`, whose areas gaia placeholders made after the per-player commands had left the land
  context on a non-player land): DE placed all 36 fish, the model none. u1's GOLD (a gaia command) is not affected.
- **`unknown_object "merge"`** (`rms_front`; control "skip"). `create_object` with a name DE does not know (Comeer's
  `BIRD_A`, `BIRD_B`) works as a bare number does (round CK): its block joins the previous `create_object`. Comeer's
  60-80 SNOW_PINE_TREE took the birds' `number_of_objects rnd(3,5)` and `set_scaling_to_map_size`: 4 scaled to Tiny
  = 5 pines, DE's exact first 5 of the model's queue at both seeds. Round CS (`probe_cs.py`, passes 1-4,
  `compare_cr.py cs`, `cs*_run.txt`): a cut after the pines (birds gone, so another map: 78 pines, identical), the
  terrain makers removed (still 5), the bird commands replaced by `#const` lines with the same draws (78, identical),
  the comment removed (5), BIRD_B without scaling (5: BIRD_A's scaling stays), braces on their own line (5).
- **`specific_land_area "anywhere"`** (`object_model`; control "connected", the owner's rule of 2026-10-31). Round CR
  (`probe_cr.py`, `cr_run.txt`; Namatjira cut after cmd 22, one attribute of cmd 22 dropped per variant): DE places
  `set_scaling_to_map_size`'s 10 riverbank GOLD groups of land id 2 all over the map, across water; "connected" left
  room for 7. The forest palms "connected" was fitted to stay 132 of 132 under today's other rules. AoE2RMSIDE has no
  such limit either (its land id only picks the frame).
- **`zone_own "group"`** (`object_model` `class_filter_ok`; control "count", "command" worse). A group member's forest
  or cliff zone ignores the trees its own group has just placed. Namatjira cmd 43 (PALMTREE, loose groups of 3,
  `avoid_forest_zone 2`): DE put members next to the group's first palm, which the model refused.
- **Comeer 1004/1005 and Namatjira 1004/1005 identical, every script object** (8710, 8405, 1096, 1167; `obj_whole.py`
  with the current defaults). Refused on the way: per-object routes, symmetric forest reach, an up-right-down-left
  order for tight neighbours (fits 5 groups by chance, breaks the player sheep), other-zones tests on tight and loose
  members, skipping the empty RELIC shuffles.
- Tools: `cs_fresh.py` (CS and CR afresh), `regress_1116b.sh` (outputs `reg_1116b_*`, corpus `obj_analysis_v16.pkl`).
  `obj_whole.py` takes further fixed VARs in `OBJ_VARS` (JSON).

## 2026-11-16 (evening), Caverns and Pag

- **Caverns was already exact** by the measure used for Venn, Comeer and Namatjira. Its "50 missing decorations" are
  the GRASS_PATCH_SMALL (1358) script objects, all on DE's tiles: obj_analysis and corpus_totals file DE's under
  decorations because the type is also a decoration type (bookkeeping only). The 9/12 left were open facings.
- **`fixed_frame "type"`** (`object_model` `place_one`; control "open"). A fixed-facet object's stored frame is fixed
  per constructor type: 5 for type 30 (fish 53, 61, 69, 457, 458, 1141: 1,117 objects over every cached map) and 0 for
  types 70 and 80 (houses, town centres, 1640/1641, ...: 9,330 objects); others (1285) stay open. Cosmetic.
- **`objects_see_layers "before-cleanup"`** (`stage_model`; control "after-cleanup"). The object stage sees the layers
  from before the beach-layer cleanup (`layer_cleanup`); only the saved map shows the cleanup. Pag cmd 16 (5 RELIC,
  `layer_to_place_on BEACH_BUILDABLE`): 3 of DE's relics stand on beach tiles that carried layer 80 before the
  cleanup and none in the file; all 5 then match at both seeds. Also fixed in `rms_front`: the composite-layer view
  was rebuilt from the cleaned layers, which hid any earlier choice of view.
- **Pag 1004/1005 identical, every script object** (534, 508; `obj_whole.py`).
- **`area_fallback` limited to commands dispatched to land frames** (per player or per land id): regression (b) showed
  CF u1 broken at all four seeds (its GOLD, a gaia command in a stale player context, found the land-less record);
  u1 and u3 identical again, Comeer's shore fish (a per-player command) unaffected.
- Regression (c) in three parallel streams (`reg_1116c_A.sh`, `_B.sh`, `_C.sh`; outputs `reg_1116c_*`, corpus
  `obj_analysis_v17.pkl`).
- **Regression (c), every rule of the day:** CQ 30/30, CP 12/12, CS 16/16, CR 14/14, CH 18/18, CO 61/61, CF same map
  for map as 2026-11-15 (u1, u3 identical), CK+CL 52/52, walls 7/7, CM 46/46, rock 11/11. Corpus (`corpus_totals.py`,
  strict: open facings count as different): script objects identical 124,422 -> 136,985 of 143,084, at DE's position
  136,576 -> 139,102; no map lost any. Exact on script objects now also Ra 1004/1005 and Rage Forest 1005 (the
  unknown-name rule: their BIRD_A/B blocks), besides Venn, Comeer, Namatjira, Pag, Caverns. Left: Rekawa (970 and 974
  off position), Menindee (20, 28), Immersion (8 facings at 1004), Bulls_Eyes/Heart (open facings only).

## 2026-11-16 (night), Rekawa, Menindee and Immersion solved: every tile, object, decoration and frame at both seeds

Four new defaults, each with the old rule as its control (scratch tools `rk_cache.py`, `rk_report.py`, `rk_strict.py`,
`rk_dec.py`, `rk_tab.py`, `rk_destroy.py`, `flag_search.py`, `flag_check.py`, `flag_before.py`, `rk_rockchk.py`):
- **`stage_model` `composite_decor_stale "drop"`** (control "keep"; applied in `appearance_model.run`). A composite tile
  that a later pass repainted (the end-of-stage beach pass) grows the decorations of what is there, not the
  composite's: what `composite_stale` already did for objects. Rekawa's terrain slice (`cj-r1-rekawa`) 1004: the first
  difference was a GRASS_GREEN on BEACH at (70,17), BEACH having no decoration table; decorations identical
  102 -> 965 of 969.
- **`stage_model` `composite_destroys "terrain"`** (control "all"; "none" also spares composite terrains, not
  separated by any map). Resolving a composite *layer* at the end of the terrain stage (62 painted with terrain_mask
  over GRASS -> 77 over 60) destroys no objects: DE keeps the land stage's GRASS decorations there (retired at the
  object stage). Rekawa's slice 969 of 969 at 1004, 993 of 993 at 1005.
- **`object_model` `zone_own_second True`** (control False). A group's own second objects count as its own for
  `zone_own "group"`. Menindee cmd 144 (ONGRID placeholders in loose pairs, `second_object ITALIAN_PINETREE`,
  `avoid_forest_zone 3`): DE puts the second member 1-3 tiles from the first, the model kept it 4-5 tiles away, off
  the first member's own pine. Menindee 1004 and 1005 identical, every object.
- **`object_model` `anim_frames "stream3"`** (control "off": no stream-3 draws, frames open). **The stored start frame
  of animated objects comes from stream 3 of the seed's chain**: every object of constructor type 20 or above whose
  standing graphic is flagged random facet spends two stream-3 draws when created, and the frame is
  `F * (second & 0x7fff) // 0x7fff`. Found by searching streams 1-40 for Immersion 1004's 8 FE flag (1285) frames:
  stream 3, every second draw, F = 91, from draw 5. Then checked, not fitted:
  - the flags of Venn and Bulls_Eyes at 1004 and 1005 (start draws 21 and 29, the same at both seeds);
  - **PANDA_ROCK 2082 (open since round CN)**: stream 3, every second draw from draw 1, F = 1450, at 1013, 1014 and
    1015, and Heart 1004/1005's rock (draw 1); every CN rock frame is now predicted (`rk_rockchk.py`);
  - who spends the draws before the first flag: units whose graphic has the flag (turkey 833 x2 on Immersion; 1245 x8
    and scout 448 x2 on Venn; 1245 x8, sheep 594 x4 and 448 x2 on Bulls_Eyes = 2, 10, 14 = the start draws / 2);
    Heart's 95 units of type 1028 (graphic flagged random angle only) spend none; trees (constructor 10) none; the
    ES flag 851 (no flag) none.
  Frame counts are not in the content pack: `ANIM_FRAMES` has the two measured (graphic 10539: 91, 12860: 1450);
  other graphics keep their frame open (units store a rotation instead).
- **Result:** Rekawa 1004/1005 (9,444 and 9,484 saved objects and decorations), Menindee 1004/1005 (3,899, 3,886)
  and Immersion 1004/1005 (1,741, 1,740): **strictly identical, every object, decoration and frame, nothing open;
  terrain, elevation and layer identical.** Rock maps 11 of 11 with the frames compared.
- **Regression (d/e) with all four rules** (`reg_1116d_*.sh`, `reg_1116e_*.sh`; outputs `reg_1116d_*`, `reg_1116e_*`;
  corpus `obj_analysis_v18.pkl`; strict per-map counts `rk_corpus.py`): CH 18/18, CO 61/61, CF same map for map, CK+CL
  52/52, walls 7/7, CM 46/46, rocks 11/11 (frames now compared), CQ/CP 42/42, CS/CR all identical. **Corpus: 27 of 30
  maps exact in everything** (every tile, layer, object, decoration and stored frame; nothing open); strictly
  identical objects and decorations 228,682 -> 236,830 of 236,851. Exact for the first time: Rekawa, Menindee,
  Immersion, Heart, Bulls_Eyes, Venn (frames) at both seeds.
- **Left (3 maps, 21 + 4 + 1 objects):** Rage Forest 1004 keeps 4 retired forest trees (411, status 7) that DE
  deleted, each under a 1543 placeholder standing exactly on it; Rage Forest 1005: the same for 2 retired 413, and one
  SNOWPINETREE (cmd 101) the model puts at (77.5,53.5) (terrain 32 under layer 3, three 1543 stacked there in DE's
  file) that DE refused, so the command's later facings run one object behind (20 objects); Bazi 1005: the known
  borderline decoration (0.207 tiles from a villager).

## 2026-11-17, Rage Forest and Bazi solved: every corpus map exact

Four new `object_model` defaults, each with the old rule as its control (scratch tools `rf_near.py`, `rf_retired.py`,
`rf_pines*.py`, `rf_trace*.py`, `rf_block.py`, `rf_ids.py`, `rf_raw.py`, `rf_gaps.py`, `bz_margin.py`, `bz_vil.py`,
`bz_corner.py`, `dz_try.py`, `dz_band.py`, `dz_close.py`, `dz_rclass.py`):
- **`retire_any True`** (control False). A placed object deletes a *retired* decoration (status 7) under it even when
  the decoration cannot be built on. Rage Forest: every retired forest tree with a 1543 placeholder on it is missing
  from DE's map (4 at 1004, 2 at 1005), every retired tree nothing stands on is kept (9 and 6); no other corpus map
  has a retired decoration of a kind that cannot be built on under a placed object.
- **`decor_scope "gaia"`** (control "owner"). A decoration's definition is read with the gaia effects whoever owns the
  object it is tested against. Bazi's `constants.inc` sets GRASS_SINGLE_GREEN's (1358) ATTR_RADIUS_1/2 to 1% with
  GAIA_SET_ATTRIBUTE; the model read the decoration in player 2's scope (radius 0) when player 2's villager was
  placed, so the 1358 at 0.207 tiles (inside 0.2 + 0.01) survived. Not a corner, villager or mover rule: round DZ
  part B (below) keeps such decorations at 0.207 in maps without the effect.
- **`blocking_obstructs True`** (control False). A land- or cliff-stage object left alive on a tile that a later stage
  repainted (the "blocking" objects of the object stage's start) obstructs placement as any decoration does. The model
  skipped every decoration whose tile terrain differed from its source. Round DZ r1: DE refuses all 37 (1004) and 13
  (1005) pines the model put on such trees; touching ones (orthogonal or diagonal) are placed.
- **`blocking_zone True`** (control False). Such objects also count for forest and cliff zones. Rage Forest 1005
  cmd 101 (STRAGGLER = SNOWPINETREE, `avoid_forest_zone 2`, `max_distance_to_other_zones 7`; not the 100-pine block
  of the 1v1 branch I first read): DE refuses (77,53), one tile from a SNOWPINETREE that the land stage grew on SNOW_FOREST (21)
  and that stayed alive when its tile was later painted UNDERBRUSH_SNOW (72) (in the model, painting with
  `create_terrain` destroys no objects; only the end-of-stage passes and the connections do). The probe placed a
  pine on the same tile (no forest-zone test there), so the tile itself is fine.
- **Result:** Rage Forest 1004 (13,711 objects) and 1005 (13,295) and Bazi 1005 (10,675): strictly identical, every
  tile, elevation, layer, object, decoration and stored frame.

**Round DZ** (`probe_dz.py`, driver `tools/editor-automation/batch_dz.ps1`, `compare_dz.py`; 14 maps saved by Claude
through the editor, a fresh editor for each; predictions frozen 2026-11-17 09:51:58 before any map was read):
- Part B (GRASS2, 2500 objects a command): b1 corner villagers (1909 + second_object VILLAGER), b2 villagers at
  tile centres, b3 corner sheep, b4 corner gold (gaia), seeds 1018/1019: **8 of 8 identical as frozen**, with about
  50 decorations each just outside the model's overlap test (one at 0.207 from a corner villager, the Bazi geometry,
  kept). So DE's test is the model's, and Bazi's deletion needed the radius effect.
- Part R (Rage Forest's script with every object command removed, then 2000 SNOWPINETREE, GOLD or SHEEP, seeds
  1004/1005): frozen 0 of 6 (the 2000 objects run into the blocking trees). With the four rules: **6 of 6 identical**, so **round DZ 14 of 14**.

**Regression** (`reg_1117_A.sh`, `_B.sh`, `_C.sh`; outputs `reg_1117_*`, corpus `obj_analysis_v19.pkl`):
CQ/CP 42/42, CS 16/16, CR 14/14, CH 18/18, CO 61/61, CF the same map for map as 2026-11-16 (66 identical lines), CK+CL 52/52, walls 7/7, CM 46/46, rocks 11/11, DZ 14/14. **Corpus (`rk_corpus.py obj_analysis_v19.pkl`): all 30 maps exact in everything, 236,851 of 236,851** objects, decorations and stored frames strictly identical; terrain and layer identical on all 30. Nothing in the corpus is open any more.
- **Retired terrain objects as obstacles: undecided.** `dz_retired_obs.py` (retired objects skipped in the overlap
  check) gives the same maps as the default on DZ r1 1004/1005, r2 1004, r3 1004 and Rage Forest 1004
  (`dz_retired_obs.txt`), probably because a retired tree shares its tile with the live tree drawn there.
- **Write-up:** `notes/de-objects-cg-dz.md` (every object-stage finding of rounds CG to DZ, and the disagreements with
  AoE2RMSIDE).

## 2026-11-17 (later), the objects write-up re-implemented from its text

- `writeup_check_obj.py`: the object stage written from `notes/de-objects-cg-dz.md` and `de-connections-objects.md`
  Sections 5-8 (Stage and Desc swapped into the pipeline; streams, terrain objects, parser and effects reused).
  `writeup_diag_obj.py <stem>` compares it with the model object by object; `writeup_check_probes.py` with DE's
  saved probe maps. Outputs `wdiag/*.txt`, `wcheck_probes.txt`, `wcheck_cp.txt`.
- **Result: all 30 corpus maps identical to the model (so to DE), and 65 probe maps identical to DE** (CM walls,
  force, zones, effects; CL routes and walls; CK; CP; DZ).
- **Text gaps found and fixed in the write-up:** (1) an animated object with an unknown frame count keeps its fixed
  frame (box turtle 1141, Pag); (2) `set_place_for_every_player` only reaches player lands with no `land_id`
  attribute (Immersion); (3) the stored fixed facet is the pack's, not derived (647 has no graphic; constructor-20
  objects with a random facet carry one); (4) the zone filter always filters the list, resolution only when needed;
  (5) the wall search's start tiles, "land", the keep rule, per-piece resolution; (6) **closest-first orders drop the
  origin tile itself when there is no `min_distance_to_players`** (the minimum defaults to -1, squared to 1;
  Heart's and Venn's town centres, Rage Forest's RELICs, CP); (7) the last-resort placement builds the object alone
  (no second object, min square only, one resolution: Venn's surviving PLACEHOLDER_WALL); (8) the exact fit, slope,
  overlap and `min_connected_tiles` rules (new Section 18), and the data list (Section 19).
- `notes/aoe2rmside-discrepancies.md`: a report on every disagreement with AoE2RMSIDE, written as future tests for
  its author.
