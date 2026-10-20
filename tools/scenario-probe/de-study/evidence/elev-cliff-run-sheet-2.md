# Round EC2 run sheet: what round EC left untested (18 maps, 2026-10-17)

Predictions were written before any DE run: `ec2-predictions.md` (summary) and `ec2_predictions.pkl` (full grids).
Where two readings are open, both are predicted; the comparison prints one line per reading, and one should be
IDENTICAL.

## Setup

1. The 9 scripts are already in the game's `random-map-scripts` folder (copied by Claude 2026-10-17).
2. As before: scenario editor, Tiny, **2 players, no teams, Team Positions ticked**, unused slots allied with
   nobody, Seed Map ticked with the seed typed in.
3. Save as `RMSTEST_<script>_<seed>_n2`. Other sizes as `RMSTEST_<script>_<seed>_n2_size-<n>`.

## Maps (seeds 1000 and 1001 each)

| # | Script | What it tests | Readings |
|---|---|---|---|
| 1-2 | gr1-restore | GRASS base; four 4-tile DESERT lands near the corners vanish in the land cleanup, then hills and cliffs | restored GRASS tiles spend 3 decoration draws each (AoE2RMSIDE) / `+nodraws` |
| 3-4 | lh1-heights | land `base_elevation`: SNOW at 3, DIRT at 6, WATER at 4 (water is reset to 0), then hills on the DESERT around them | one |
| 5-6 | lh2-alone | the same lands, no elevation section | plateaus left raw (AoE2RMSIDE) / `+smoothed` |
| 7-8 | ly1-layer | LAND_GENERATION `base_layer SNOW`; hills with `base_layer SNOW` grow outside the lands, hills without it only on the DESERT land | one (the saved tile layer is compared too) |
| 9-10 | sc1-scale | `set_scale_by_size` (300 tiles become 432 on Tiny) and `set_scale_by_groups` (3 clumps become 4) | one |
| 11-12 | ct1-desert | `cliff_type CT_DESERT`: objects 1849-1857 | one |
| 13-14 | ct2-terrace | `cliff_type CT_TERRACE`: objects 2651-2659 | one |
| 15-16 | wc1-water | a band of WATER across the map, cliffs allowed right next to it (`min_terrain_distance 0`) | water fill at the end of the land stage (our land model) / `+fill-at-terrain` (AoE2RMSIDE; leaves one water tile turned to terrain 70 at seed 1000; same map at 1001) |
| 17-18 | co1-overland | cliffs crossing a 6000-tile DIRT land | lines get DIRT back (AoE2RMSIDE) / `+tobase` (the guide: the map's base terrain) |

Optional: `sc1-scale` seed 1000 at size 200 (`_size-200`), where scaling multiplies by 4.

## Compare

From `tests\`:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_ec.py 2>$null
```

It now compares elevation, terrain and layer of every tile and every cliff object's type, position and facing, for
both rounds. `ONLY=gr1` (or any part of a file name) limits it to some maps.
