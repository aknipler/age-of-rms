# Run sheet: 5- and 6-player team layouts (19 maps), 2026-10-11

Goal: find what triggers the two remaining mismatches: teammates standing very close together in some 6-player three-pair lobbies, and the unteamed players swapping in 5-player lobbies with one pair. Different team layouts and more seeds show which layouts and which draws are involved.

Tiny map, Team Positions ON. Script `p4o-players` (already in the game folder). Save as `RMSTEST_p4o-players_<seed>_<lobby>`. Only who is teamed with whom matters; 0 in a lobby code means no team.

When done, run from `tests/` and paste the output:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe seq_report.py 'n6t111222|n6t121212|n6t112200|n6t110000|n6t112233|n5t11222|n5t11220|n5t11000|n7t1122330' 2>$null | Select-String '^p4o'
```

| # | Seed | Lobby | Lobby meaning | What it tests |
|---|---|---|---|---|
| 1 | 1000 | n6t111222 | 6 players: 1+2+3 teamed, 4+5+6 teamed | teams of three instead of pairs |
| 2 | 1001 | n6t111222 | 6 players: 1+2+3 teamed, 4+5+6 teamed | teams of three instead of pairs |
| 3 | 1002 | n6t111222 | 6 players: 1+2+3 teamed, 4+5+6 teamed | teams of three instead of pairs |
| 4 | 1000 | n6t121212 | 6 players: 1+3+5 teamed, 2+4+6 teamed | same, with interleaved slots |
| 5 | 1002 | n6t121212 | 6 players: 1+3+5 teamed, 2+4+6 teamed | same, with interleaved slots |
| 6 | 1000 | n6t112200 | 6 players: 1+2 and 3+4 teamed; 5 and 6 on no team | does the clustering need all six players on teams? |
| 7 | 1002 | n6t112200 | 6 players: 1+2 and 3+4 teamed; 5 and 6 on no team | does the clustering need all six players on teams? |
| 8 | 1000 | n6t110000 | 6 players: only 1+2 teamed; 3 to 6 on no team | a single pair with many singles |
| 9 | 1004 | n6t112233 | 6 players: 1+2, 3+4, 5+6 teamed (more seeds) | how often does the clustering happen, and with which draws? |
| 10 | 1005 | n6t112233 | 6 players: 1+2, 3+4, 5+6 teamed (more seeds) | how often does the clustering happen, and with which draws? |
| 11 | 1006 | n6t112233 | 6 players: 1+2, 3+4, 5+6 teamed (more seeds) | how often does the clustering happen, and with which draws? |
| 12 | 1007 | n6t112233 | 6 players: 1+2, 3+4, 5+6 teamed (more seeds) | how often does the clustering happen, and with which draws? |
| 13 | 1000 | n5t11222 | 5 players: 1+2 teamed, 3+4+5 teamed | does a team of three change the 5-player swap? |
| 14 | 1001 | n5t11222 | 5 players: 1+2 teamed, 3+4+5 teamed | does a team of three change the 5-player swap? |
| 15 | 1000 | n5t11220 | 5 players: 1+2 and 3+4 teamed; 5 on no team | two pairs and a single |
| 16 | 1001 | n5t11220 | 5 players: 1+2 and 3+4 teamed; 5 on no team | two pairs and a single |
| 17 | 1002 | n5t11000 | 5 players: only 1+2 teamed (more seeds) | more seeds of the 5-player swap |
| 18 | 1003 | n5t11000 | 5 players: only 1+2 teamed (more seeds) | more seeds of the 5-player swap |
| 19 | 1000 | n7t1122330 | 7 players: 1+2, 3+4, 5+6 teamed; 7 on no team | three pairs and a single, 7 players |

Maps already done for these lobbies (no need to redo): n6t112233 at seeds 1000 to 1003, n5t11000 at seeds 1000 and 1001.
