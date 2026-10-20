# Round 6 run sheet (23 maps), written 2026-10-10

Purpose: find the rule for the order of players inside teams (team positions ON). Script: `p4o-players` (already in the game folder). Save as `RMSTEST_p4o-players_<seed>_<lobby>`. Only who is teamed with whom matters.

Then run, from `tests/`: `$env:PYTHONIOENCODING="utf-8"; ..\.venv\Scripts\python.exe team_rule.py 2>$null | Select-String '^p4o'` and paste the output.

| # | Seed | Lobby | Teamed pairs / groups |
|---|---|---|---|
| 1 | 1002 | n4t1122 | 1+2, 3+4 |
| 2 | 1003 | n4t1122 | 1+2, 3+4 |
| 3 | 1004 | n4t1122 | 1+2, 3+4 |
| 4 | 1005 | n4t1122 | 1+2, 3+4 |
| 5 | 1006 | n4t1122 | 1+2, 3+4 |
| 6 | 1007 | n4t1122 | 1+2, 3+4 |
| 7 | 1008 | n4t1122 | 1+2, 3+4 |
| 8 | 1009 | n4t1122 | 1+2, 3+4 |
| 9 | 1010 | n4t1122 | 1+2, 3+4 |
| 10 | 1011 | n4t1122 | 1+2, 3+4 |
| 11 | 1012 | n4t1122 | 1+2, 3+4 |
| 12 | 1013 | n4t1122 | 1+2, 3+4 |
| 13 | 1001 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 14 | 1002 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 15 | 1003 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 16 | 1004 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 17 | 1005 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 18 | 1006 | n8t11223344 | 1+2, 3+4, 5+6, 7+8 |
| 19 | 1000 | n8t12123434 | 1+3, 2+4, 5+7, 6+8 |
| 20 | 1000 | n8t12213443 | 1+4, 2+3, 5+8, 6+7 |
| 21 | 1000 | n6t112233 | 1+2, 3+4, 5+6 |
| 22 | 1001 | n6t112233 | 1+2, 3+4, 5+6 |
| 23 | 1001 | n5t11000 | 1+2 only |
