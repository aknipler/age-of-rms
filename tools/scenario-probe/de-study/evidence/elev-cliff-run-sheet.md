# Round EC run sheet: elevation and cliffs (26 maps), 2026-10-17

Goal: check, tile for tile, our restatement of DE's `<ELEVATION_GENERATION>` and `<CLIFF_GENERATION>` stages
(`elevation_model.py`, `cliff_model.py`, chained after the confirmed land model by `stage_model.py`). The
predictions were written before any DE run: `ec-predictions.md` (summary) and `ec_predictions.pkl` (full grids).

## Setup

1. Copy the 13 scripts into the game's script folder (done by Claude 2026-10-17):

```powershell
Copy-Item el*.rms, cl*.rms "C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\"
```

   (Run from `tests\`. `el*` and `cl*` match only this round's 13 files.)
2. Scenario editor, Tiny map, **2 players, no teams, Team Positions ticked**, unused slots allied with nobody,
   Seed Map ticked with the seed typed in, as in every earlier round.
3. Save as `RMSTEST_<script>_<seed>_n2`, for example `RMSTEST_el1-one_1000_n2`.

## Maps

| # | Script | Seeds | What it tests |
|---|---|---|---|
| 1-2 | el1-one | 1000, 1001 | one hill (400 tiles): the burned draw, the 2-pass shuffle, seeding, growth draws, smoothing |
| 3-4 | el2-clumps | 1000, 1001 | 8 clumps: the square each seed unlinks, round-robin growth |
| 5-6 | el3-layers | 1000, 1001 | `create_elevation 4`, 3 clumps: layers 2-4 grow on the layer below; leftovers from one layer's lists |
| 7-8 | el4-spacing | 1000, 1001 | `spacing 3` (applies to layers 2 and 3 only, per AoE2RMSIDE) |
| 9-10 | el5-players | 1000, 1001 | 2 player lands: hills avoid player origins (one draw per pop against a distance weight) |
| 11-12 | el6-two | 1000, 1001 | two `create_elevation` commands, the first balanced; the second's layer 2 may sit on the first's hills |
| 13-14 | el7-stack | 1000, 1001 | the same `create_elevation 4` three times: leftover list links from one command decide where the next one grows (with clean lists the heights step down evenly; with AoE2RMSIDE's leftovers they pile up) |
| 15-16 | cl1-default | 1000, 1001 | cliffs on flat desert, 5 to 8 of them, default lengths |
| 17-18 | cl2-curly | 1000, 1001 | curliness 100, lengths 8-11, `min_distance_cliffs 1`, 10 to 13 cliffs |
| 19-20 | cl3-elev | 1000, 1001 | el3's hills, then cliffs: only on uniform 3x3 cells, staying at one elevation |
| 21-22 | cl4-grass | 1000, 1001 | GRASS base: grass decorations on the tiles a cliff crosses spend 3 draws each |
| 23-24 | cl5-header | 1000, 1001 | `<CLIFF_GENERATION>` with no commands: default cliffs (the guide, and the age-of-rms runs of 2026-08-01, say a bare header makes cliffs), tile for tile |
| 25-26 | cl6-players | 1000, 1001 | 2 player lands and a neutral land at the centre (50, 50), 25 to 29 cliffs: cliffs keep about 21 tiles (7 cells) clear of every land's origin. If DE clears only player lands, seed 1001 puts a cliff 1.5 tiles from the centre land; the comparison prints a second line for that reading |

Predicted, in brief (full list in `ec-predictions.md`): el1 seed 1000 has 419 tiles at height 1; el3 seed 1000
has 426/46/26/27 tiles at heights 1-4; cl1 seed 1000 has 50 cliff pieces along 136 line tiles.

## Compare

From `tests\`, then paste the output:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_ec.py 2>$null
```

A map is IDENTICAL when all 14400 elevations and terrains and every cliff object (type and position) agree.
The cliff lines are painted terrain 16 during generation and restored at the end, so no terrain 16 is expected. For cl5 and cl6 it prints two lines, one per reading (bare header; all lands or player lands only); one of them should be IDENTICAL.

Save all 26 even if early ones differ: the pattern of which scripts differ tells which step to look at (el1
covers the start of the stage, so a difference there points at the draws before the first hill; the cl scripts
without elevation test cliffs independently of the elevation model).
