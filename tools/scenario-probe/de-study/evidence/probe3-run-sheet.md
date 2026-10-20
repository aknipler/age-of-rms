# Round 5 run sheet (29 maps), written 2026-10-10

Tiny map. Set the lobby, generate the script at the seed, save as `RMSTEST_<script>_<seed>_<lobby>` (for example `RMSTEST_p4o-players_1000_n4t1122`). Only who is teamed with whom matters, not team numbers.

Compare (from `tests/`):

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_probes2.py 2>$null | Select-String '^(\S+ +seed|    )'
```

| # | Script | Seed | Lobby | Lobby meaning | What it tests |
|---|---|---|---|---|---|
| 1 | p4o-players | 1000 | n4 | 4 players, no teams, team positions as before | players with one villager each (team order: which player stands where) |
| 2 | p4o-players | 1000 | n4t1122 | 4 players: 1+2 teamed, 3+4 teamed | players with one villager each (team order: which player stands where) |
| 3 | p4o-players | 1000 | n4t1212 | 4 players: 1+3 teamed, 2+4 teamed | players with one villager each (team order: which player stands where) |
| 4 | p4o-players | 1000 | n4t1221 | 4 players: 1+4 teamed, 2+3 teamed | players with one villager each (team order: which player stands where) |
| 5 | p4o-players | 1000 | n8t11223344 | 8 players: 1+2, 3+4, 5+6, 7+8 teamed | players with one villager each (team order: which player stands where) |
| 6 | p4o-players | 1000 | n5t11000 | 5 players: only 1+2 teamed | players with one villager each (team order: which player stands where) |
| 7 | p4o-players | 1000 | n4r | 4 players, no teams, TEAM POSITIONS OFF | players with one villager each (team order: which player stands where) |
| 8 | p4o-players | 1000 | n4t1122r | 4 players: 1+2, 3+4 teamed, TEAM POSITIONS OFF | players with one villager each (team order: which player stands where) |
| 9 | p4o-players | 1001 | n4t1122 | 4 players: 1+2 teamed, 3+4 teamed | players with one villager each (team order: which player stands where) |
| 10 | e1-large-1000 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 1000 tiles |
| 11 | e1-large-2000 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 2000 tiles |
| 12 | e1-large-4000 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 4000 tiles |
| 13 | e1-large-7200 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 7200 tiles |
| 14 | e1-large-14400 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 14400 tiles (the whole map) |
| 15 | e1-large-2000 | 1001 | n2 | 2 players, no teams (as in earlier rounds) | one land, 2000 tiles |
| 16 | e1-large-7200 | 1001 | n2 | 2 players, no teams (as in earlier rounds) | one land, 7200 tiles |
| 17 | e2-corner-4000 | 1000 | n2 | 2 players, no teams (as in earlier rounds) | one land, 4000 tiles, near a corner (map-edge effects) |
| 18 | c4-water | 1001 | n2 | 2 players, no teams (as in earlier rounds) | five circular conformity lands, all WATER (notch test) |
| 19 | c4-water | 1002 | n2 | 2 players, no teams (as in earlier rounds) | five circular conformity lands, all WATER (notch test) |
| 20 | c4-desert | 1001 | n2 | 2 players, no teams (as in earlier rounds) | same layout, all DESERT (twin of c4-water) |
| 21 | c4-desert | 1002 | n2 | 2 players, no teams (as in earlier rounds) | same layout, all DESERT (twin of c4-water) |
| 22 | c2-conf-circ | 1002 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the circular conformity map (notch frequency) |
| 23 | c2-conf-circ | 1003 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the circular conformity map (notch frequency) |
| 24 | c2-conf-circ | 1004 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the circular conformity map (notch frequency) |
| 25 | c2-conf-circ | 1005 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the circular conformity map (notch frequency) |
| 26 | c1-conf | 1002 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the square conformity map |
| 27 | c1-conf | 1003 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the square conformity map |
| 28 | c1-conf | 1004 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the square conformity map |
| 29 | c1-conf | 1005 | n2 | 2 players, no teams (as in earlier rounds) | more seeds of the square conformity map |

The new scripts are already in the game's random-map-scripts folder: p4o-players, e1-large-1000/2000/4000/7200/14400, e2-corner-4000, c4-water, c4-desert. c1-conf and c2-conf-circ were there already.
