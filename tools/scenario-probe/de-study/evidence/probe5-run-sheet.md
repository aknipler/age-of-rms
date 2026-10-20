# Round 7 run sheet: is land_percent for player lands a joint budget? (5 maps), written 2026-10-10

Question: when one player land is boxed in and cannot reach its share, does the other keep growing until the
joint land_percent is met (a shared budget), or does each land stop at its own share, with 100 as a special case?
At 4 percent nobody is boxed in, so it cannot tell. Predicted combined desert area (seed 1000, 2 players):

| Script | Per-land share (current model) | Joint budget |
|---|---|---|
| b2c-percent60 | 8838 | 8845 |
| b2c-percent97 | 13765 | 14145 |
| b2c-percent99 | 13972 | 14379 |

(At 100 the model with the whole map as the target matches DE exactly; that is consistent with a joint budget, and with an exception at 100.)

Save as `RMSTEST_<script>_<seed>_<lobby>`. Lobby n2 = 2 players, no teams, as before.

| # | Script | Seed | Lobby |
|---|---|---|---|
| 1 | b2c-percent99 | 1000 | n2 |
| 2 | b2c-percent99 | 1001 | n2 |
| 3 | b2c-percent97 | 1000 | n2 |
| 4 | b2c-percent60 | 1000 | n2 |
| 5 | b2c-percent60 | 1000 | n4 |

Compare: `$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_probes2.py 2>$null | Select-String '^(\S+ +seed|    )'`
(the comparison uses the per-land model, so a joint budget will show DIFFERENT with a larger observed area).
