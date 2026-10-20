# Round 4 runs (42 maps), written 2026-10-10
Tiny map. Set the lobby as the code says, generate the script at the seed, save as `RMSTEST_<script>_<seed>_<lobby>`.
Lobby code: `n4` = 4 players, no teams. `t1122` = teams per player slot (0 = no team), e.g. `n4t1122` = players 1,2 on team 1 and 3,4 on team 2. `r` = Team Positions set to random instead of fixed (if your lobby has that option).
Compare: `$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_probes2.py 2>$null | Select-String '^(\S+ +seed|    )'`
| # | Script | Seed | Lobby | Tests |
|---|---|---|---|---|
| 1 | p4-players | 1000 | n3 | create_player_lands, random placement, more players / teams / random team positions |
| 2 | p4-players | 1001 | n3 | create_player_lands, random placement, more players / teams / random team positions |
| 3 | p4-players | 1000 | n4 | create_player_lands, random placement, more players / teams / random team positions |
| 4 | p4-players | 1000 | n8 | create_player_lands, random placement, more players / teams / random team positions |
| 5 | p4-players | 1000 | n4t1122 | create_player_lands, random placement, more players / teams / random team positions |
| 6 | p4-players | 1001 | n4t1122 | create_player_lands, random placement, more players / teams / random team positions |
| 7 | p4-players | 1000 | n4t1212 | create_player_lands, random placement, more players / teams / random team positions |
| 8 | p4-players | 1000 | n8t11223344 | create_player_lands, random placement, more players / teams / random team positions |
| 9 | p4-players | 1000 | n5t11022 | create_player_lands, random placement, more players / teams / random team positions |
| 10 | p4-players | 1000 | n4r | create_player_lands, random placement, more players / teams / random team positions |
| 11 | a3-grouped | 1000 | n4t1122 | grouped_by_team placement |
| 12 | a3-grouped | 1001 | n4t1122 | grouped_by_team placement |
| 13 | a3-grouped | 1000 | n4 | grouped_by_team placement |
| 14 | a3-grouped | 1000 | n8t11223344 | grouped_by_team placement |
| 15 | a4-direct | 1000 | n2 | direct_placement, assign_to_player with and without land_position |
| 16 | a4-direct | 1000 | n3 | direct_placement, assign_to_player with and without land_position |
| 17 | a4-direct | 1001 | n3 | direct_placement, assign_to_player with and without land_position |
| 18 | a5-assign | 1000 | n2 | assign_to_player lands under random placement; lands for absent players |
| 19 | a5-assign | 1000 | n4 | assign_to_player lands under random placement; lands for absent players |
| 20 | a5-assign | 1001 | n4 | assign_to_player lands under random placement; lands for absent players |
| 21 | a6-circle | 1000 | n2 | circle_radius 35, variance 0 |
| 22 | a6-circle | 1000 | n4 | circle_radius 35, variance 0 |
| 23 | a6b-circlev | 1000 | n4 | circle_radius 30, variance 5 |
| 24 | a6b-circlev | 1001 | n4 | circle_radius 30, variance 5 |
| 25 | a7-behavior | 1000 | n2 | behavior_version 1 (land sizes include the base) |
| 26 | a7-behavior | 1001 | n2 | behavior_version 1 (land sizes include the base) |
| 27 | b1-circular | 1000 | n2 | set_circular_base: pure circle, growth, bigger circles |
| 28 | b1-circular | 1001 | n2 | set_circular_base: pure circle, growth, bigger circles |
| 29 | b2-percent | 1000 | n2 | land_percent on create_land and create_player_lands |
| 30 | b2-percent | 1001 | n2 | land_percent on create_land and create_player_lands |
| 31 | b2b-percent100 | 1000 | n2 | land_percent 100 (fills the map; slow in the model) |
| 32 | b3-zonerand | 1000 | n2 | set_zone_randomly with avoidance |
| 33 | b3-zonerand | 1001 | n2 | set_zone_randomly with avoidance |
| 34 | b3-zonerand | 1000 | n4 | set_zone_randomly with avoidance |
| 35 | c1-conf | 1000 | n2 | land_conformity 20, 50, 80, 99, -50 |
| 36 | c1-conf | 1001 | n2 | land_conformity 20, 50, 80, 99, -50 |
| 37 | c2-conf-circ | 1000 | n2 | same with set_circular_base |
| 38 | c2-conf-circ | 1001 | n2 | same with set_circular_base |
| 39 | c3-conf100 | 1000 | n2 | land_conformity 100 (base override), square and circular |
| 40 | c3-conf100 | 1001 | n2 | land_conformity 100 (base override), square and circular |
| 41 | d1-neutral | 1000 | n2 | neutral random positions: conflicts, generate_mode, min_placement_distance |
| 42 | d1-neutral | 1001 | n2 | neutral random positions: conflicts, generate_mode, min_placement_distance |
