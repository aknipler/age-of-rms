# Handoff: the two open cases (2026-10-13)

## Resolution (2026-10-13, later the same day)

**The open maps are an editor artefact, not a gap in the lobby rule.** Every map that disagrees has a *stale alliance*: the saved diplomacy allies a player in the game with an **unused slot** (6, 7 or 8). The pairs are left over from the 8-player lobbies (1+2/3+4/5+6/7+8 and 1+4/2+3/5+8/6+7). `diplo.py` compared only the players in the game, so it reported the teams as correct. Both stance tables in the file agree (`per_player_diplomacy` and `player_data_3.diplomacy_for_interaction`).

Evidence (`inactive_allies.py`, all 63 p4o maps with Team Positions on, whole land stage tile for tile plus the fitted placement order):
- Maps without an alliance to an unused slot: all match, with or without the change below.
- Maps with one: 12. The lobby-team model matches 2 of them, by coincidence.
- **A player can vanish from the order.** The six maps the old decode could not fit are exact once some players are never visited by the perimeter pass. Those players keep perimeter 0, which puts the land centre at x = 25 near the top-left corner: the "three villagers within 6 tiles" of seed 1002. The fit is unique in every map (worst 3.5 tiles; runner-ups are 4.3 or more).
- **What DE does with them (our restatement, `land_model.preprocess_fixed_slots`):** teams are groups of slots linked by alliances, unused slots included. Each team's list holds every member, but only the positions of players in the game are rewritten. The selected team's list is reversed, the first len(positions) entries are written, and the positions are filled from the last one when d1 >= 50. Unused slots also group in the perimeter pass, so an unused ally drags its partner to the unused slot's place in the shuffle. With no unused members this is exactly the lobby rule. With them, the selected team keeps its highest slot numbers and the others their lowest, so a player can drop out.
- With that (`VAR["slot_teams"]`), **59 of 63** maps match (lobby teams: 53). The 4 left (1000/1001 n5t11222, 1000/1001 n6t112233), and the old `p4-players_1000_n5t11022` (its saved diplomacy is 1-2, 3-4, 4-5, 5-6, 7-8, not 11022), have alliance groups that are not cliques (8-5-6-7; 3-4-5 plus 5-6). Under the rule above, no partition of the 8 slots into teams reproduces 1000 n5t11222, 1000 n6t112233 or 1001 n6t112233 (brute force over all 4140). Lead, not tested: 1000 and 1001 n6t112233 have the same alliance table but would need different groupings, so DE's grouping of a non-clique may depend on the shuffle order. Left unexplained on purpose: no lobby can produce these.
- `regress_all.py` is unchanged with the default (108 identical, the same 6 different as `regress_final.txt`).

**Control maps for the owner** (editor, Tiny, Team Positions ticked, script `p4o-players`):
1. *Clean a failing map:* rename the old `RMSTEST_p4o-players_1002_n5t11000.aoe2scenario` (for example to `...-stale.aoe2scenario`, which the tools ignore), then save seed 1002, 5 players, 1+2 allied, with every unused slot allied with nobody. Prediction (lobby rule, all five placed): land centres p1 (15,83), p2 (67,102), p3 (83,12), p4 (105,68), p5 (28,13); `inactive_allies.py 1002_n5t11000` shows no unused-slot allies and `lobby SAME`.
2. *Make a clean map fail on purpose:* seed 1002, 4 players, 1+2 allied, and unused slot 5 allied with both 1 and 2 (all three pairs). Save as `RMSTEST_p4o-players_1002_n4t1100`. Prediction (8-slot rule): player 1 is never placed (centre (25,13)), p2 (30,7), p3 (105,31), p4 (88,102); the lobby rule would give p1 (88,97), p2 (15,92), p3 (30,12), p4 (102,31). `inactive_allies.py 1002_n4t1100` should show `unused-slot allies 1-5 2-5` and `slots SAME`.

Everything below is the state before the resolution.

Written for the study's own sessions, whose notes were not kept (see ../README.md). Everything below is measured, not guessed, unless marked as a lead.

## The task

Our model (`land_model.py`) reproduces DE's map generation tile for tile on 119 of 125 scenario-editor maps. Six maps disagree. All six involve the **player-position step with Team Positions on** ("Fixed Positions: Yes" in a skirmish), in lobbies where some players have teams. Find the rule that makes them agree, without breaking the other 119 (`regress_all.py` must stay at 0 new differences).

The study's ground rules, which this archive records rather than follows: everything stays in this folder, nothing from AoE2RMSIDE's code goes into the age-of-rms repo (restate behaviour in our own words), the game files are never modified (adding probe maps to the game's `random-map-scripts` folder is allowed by the owner).

## How the player step works (confirmed)

`land_model.player_setup`: shuffle of 8 slots (7 draws, `O`); with Team Positions on, three conditional draws d1, d2, d3 (d1 below 50 = "descending" flag; d2 below 50 means a player is selected; selected slot = `d3 % (players+1)`, 0 = nobody); each team is reordered ascending or descending by slot among the positions its members hold in `O` (selected team and the others get opposite directions, see `preprocess_fixed`); then the perimeter pass: `current = bounded(circumference)`, then for each outer slot in `O`, every member of its team is placed in order of `O`, each at `bounded(jspan) + current - jspan/2`, `current += step`; then one coordinate jitter draw per land in slot order. Rules confirmed by 20+ four- and eight-player team maps, 6-player maps at 5 of 8 seeds, and all no-team lobbies at 3 to 8 players.

## Open case 1: 5 players, one pair teamed (p1+p2), others unteamed

Order of players along the perimeter (`seq_report.py`; DE = decoded from the saved villagers, all fit within 3.5 tiles):

| Seed | O (active slots) | d1 | d2 | selected | model | DE |
|---|---|---|---|---|---|---|
| 1000 | 1,3,2,5,4 | 87 | 30 | 4 (unteamed) | 2,1,3,5,4 | 2,1,5,3,4 |
| 1001 | 3,1,4,5,2 | 59 | 26 | 4 (unteamed) | 3,2,1,4,5 | 3,5,2,1,4 |
| 1002 | 5,3,4,2,1 | 94 | 0 | 5 (unteamed) | 5,3,4,2,1 | decode partial (fit 10.5) |
| 1003 | 5,1,3,2,4 | 4 | 49 | 5 (unteamed) | 5,1,2,3,4 | decode failed (fit 22.6) |
| 370167422 (skirmish, p1+p2 teamed) | 2,1,3,5,4 | 33 | 24 | **1 (in the pair)** | 2,1,3,5,4 | matches |

Clues:
- The only passing instance has the selected player inside the pair; all four failing ones have an unteamed selected player.
- But 4 players with one pair and an unteamed selected player match (`n4t1100` seed 1001: selected slot 3; `n4t0011` seed 1000: selected slot 1), and 6 players with one pair and nobody selected match (`n6t110000`).
- Also failing: 5 players with 1+2 and 3+4 teamed, seed 1000 (model 2,1,3,4,5, DE 2,1,5,3,4; seed 1001 matches); 5 players with 1+2 and 3+4+5 teamed, both seeds (decode partial).
- In seeds 1000 and 1001 the unteamed players move by an adjacent swap (1000: 3,5 -> 5,3; 1001: 4,5 -> 5,4); player 5 moves one place earlier in both.
- `team_search.py` (which grouping of players would fit the villagers): seed 1000 fits only teams {1,2} + {3,5} (also for the 1+2/3+4 layout); seed 1001 fits only {1,2,5}. The saved scenarios hold the true teams (`diplo.py`: all labelled correctly), so this is a behaviour clue, not a lobby slip.

## Open case 2: 6 players, three pairs (1+2, 3+4, 5+6), seeds 1000, 1001, 1002

Seeds 1003 to 1007 match, and so do other six-player layouts (1+2+3/4+5+6, 1+3+5/2+4+6, 1+2/3+4 plus singles, no teams) at seeds 1000 to 1002.

| Seed | O | d1 | d2 | selected | model | DE (decoded; None = no fit) |
|---|---|---|---|---|---|---|
| 1000 | 1,6,3,2,5,4 | 87 | 30 | 0 (nobody) | 2,1,6,5,4,3 | 2,1,6,5,3,None |
| 1001 | 3,1,6,4,5,2 | 59 | 26 | 1 | 4,3,1,2,6,5 | 4,3,6,1,2,None |
| 1002 | 5,6,3,4,2,1 | 94 | 0 | 6 | 5,6,4,3,2,1 | 6,3,2,1,None,None |

Clues: in these maps the villager positions of two or three players do not fit any (perimeter slot, jitter draw) combination of the model (`dbg21.py` style search, see `results.md`). At seed 1002 slots 4, 5 and 6 stand within about 6 tiles of each other near the top-left corner: villagers at (28.5, 9.5), (22.5, 12.5), (24.5, 10.5), while the perimeter spacing for 6 players is about 45 tiles. At seed 1000 slot 5 at (22.5, 19.5) fits no perimeter value (it would need a perimeter value around -3, or about 277 where the circumference is 272, unwrapped); slot 4 fits the right perimeter slot but with the jitter of another draw. Lead (unverified): AoE2RMSIDE has a second placement routine, `grouped_player_perimeters`, that puts teammates side by side; DE may use something like it for some layouts or draws.

## Tried and rejected

Selected player as slot or slot+1 with `% players`, as the player at index `sel` in `O`, in the 8-slot list, reversed lists, and many more (`rule_fit.py`; only `d3 % (players+1)` fits the 4- and 8-player maps, 20 of 20); inverted polarity; sorting the unteamed players as a group (ascending or descending); treating all unteamed players as one team; a joint land_percent budget; counting leftover-pass tiles as land; extra or missing draws before the perimeter pass (offset scans find none).

## Data and tools

- 125 saved maps: `C:\Users\assas\Games\Age of Empires 2 DE\76561198049909329\resources\_common\scenario\RMSTEST_p4o-players_<seed>_<lobby>.aoe2scenario` (p4o = one villager per player; lobby code `n<players>t<teams digit per player, 0 = none>`). `obs_cache.pkl` holds the terrain tiles of every map (rebuild with `obs_cache.py`).
- Commands (from this folder, `..\.venv\Scripts\python.exe`, `$env:PYTHONIOENCODING = "utf-8"`): `seq_report.py "<regex>"` (model vs DE order), `decode_seq.py`, `team_search.py <stem>...`, `diplo.py`, `regress_all.py ["<regex>"]` (the regression; the model takes a while for the biggest maps), `probe_defs2.py` (builders; RUNS lists show which lobbies were run).
- To get more data: save a new map in the editor (Seed Map, the seed, Team Positions ticked, script `p4o-players` from the game's random-map-scripts folder, teams as in the lobby code) named as above, then `obs_cache.py`. A skirmish can be checked by reading its seed in Game Settings and loading it in the editor; the skirmish and editor have agreed so far.
- AoE2RMSIDE's relevant code (Apache 2.0; read it, do not paste it): `crates/rms-engine/src/lib.rs` functions `native_random_player_positions`, `random_player_perimeters`, `grouped_player_perimeters`, `preprocess_fixed_lobby_slots`, `rectangular_player_coordinate`. A shallow clone from `git clone https://github.com/aoe2control/AoE2RMSIDE.git` into a new empty folder is enough.
