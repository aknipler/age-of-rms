# Probe runs to do (19 maps), written 2026-10-10

Lobby as before: Tiny (120), 2 players. Tell Claude the players' teams (assumed none). Save each map from the editor as
`RMSTEST_<script>_<seed>` in the scenario folder, then run, from `tests/`:

    $env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_probes.py 2>$null

| Script | Seeds | Tests |
|---|---|---|
| p1-multi | 1000, 1001 | item 1: four lands growing together, two pairs close enough to collide |
| p2-border | 1000, 1001 | item 2: borders and border_fuzziness (default 20, and 5) |
| p3a-clump | 1000, 1001 | item 3: clumping_factor 0, 25, 2, 12 |
| p3b-avoid | 1000, 1001 | item 3: other_zone_avoidance_distance 4 between zones, 0 control |
| p4-players | 1000, 1001 | item 4: create_player_lands for 2 players, random placement, plus a random neutral land |
| p5a-rnd | 1000, 1001 | item 5: rnd() in definitions, inline, and inside an unselected branch |
| p5b-assign-rand | 1000, 1001 | item 5: assign_to AT_TEAM -10 0 2 (random) with direct_placement |
| p5b-assign-ord | 1000, 1001 | item 5: same, ordered (-1): should draw nothing |
| p6-range-s1000 | 1000 and 1001 | item 6: weights on the roll boundary (1001 is the control: no `<=`/`<` difference expected) |
| p6-range-s1001 | 1001 | item 6 |

Scripts are in the game's random-map-scripts folder. Predictions: `probe-predictions.md` (written before any run).
If DE refuses a script (unknown command, parse error), say which; that is a result too.
