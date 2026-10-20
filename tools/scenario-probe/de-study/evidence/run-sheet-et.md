# Round ET run sheet: first terrain round + what elevation and cliffs left open (44 maps, 2026-10-19)

Predictions were written before any DE run: `et-predictions.md` (summary) and `et_predictions.pkl` (full grids),
from `stage_model.py` with the new `terrain_model.py` (our restatement of AoE2RMSIDE's create_terrain, never tested
against DE). Where two readings are open, both are predicted, and the comparison prints one line per reading. One of
them should be IDENTICAL. Readings marked *control* are deliberately wrong variants. They show that the map can tell
the rule apart.

## Setup

1. Copy the 25 scripts listed below from `tests\` into `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (or let Claude do it). Nothing else in the game folder is touched.
esources\_common
andom-map-scripts\` (or let Claude do it). Nothing else in the game folder is touched.
esources_common
andom-map-scripts` (or let Claude do it). Nothing else in the game folder is touched.
2. As before: scenario editor, Tiny, **2 players, no teams, Team Positions ticked**, unused slots allied with
   nobody, Seed Map ticked with the seed typed in.
3. Save as `RMSTEST_<script>_<seed>_n2`. The one larger map is `RMSTEST_sc1-scale_1000_n2_size-200` (size 200).

Part A is the priority. If time is short, save Part A first.

## Part A: the terrain stage (18 maps, seeds 1000 and 1001 each)

| # | Script | What it tests | Readings |
|---|---|---|---|
| 1-2 | t1-forest | one FOREST pass on the default base (GRASS, no `base_terrain` line): burned draw, W·H/8 shuffle with x, y = draw(W−1), seed square 2·√(tiles/clumps), growth, drain | one; *controls* `+bound-full` (draw(W)), `+square-half` (elevation's √/2 square; same map at 1000) |
| 3-4 | t2-shape | `clumping_factor` 0 and 40; the default `number_of_tiles` | W = 120 (AoE2RMSIDE) / `+122` (the guide's "122 tiles on a tiny map"); *control* `+paint-decor` (painting DIRT spends its decoration draw) |
| 5-6 | t3-amounts | `land_percent 10`; `number_of_tiles -5`; `set_scale_by_groups` (tiles and clumps); `set_scale_by_size` | negative = 5 % (AoE2RMSIDE) / `+neg-zero` |
| 7-8 | t4-spacing | `spacing_to_other_terrain_types 3` around a DIRT and a SNOW land; two `spacing_to_specific_terrain` | one |
| 9-10 | t5-avoid | `set_avoid_player_start_areas` bare (13) and 25, 2 player lands | one |
| 11-12 | t6-height | hills, then `height_limits 1 2`; `set_flat_terrain_only` with spacing 1 | one |
| 13-14 | t7-water | `create_terrain WATER` with spacing 1 on a hilly map; DIRT with `beach_terrain DLC_BEACH2` around it | WATER is flat-only by itself (AoE2RMSIDE) / `+noflat`; `beach_terrain` used / `+nobeachterrain` |
| 15-16 | t8-mask | `terrain_mask 1` (SNOW layered over DESERT) and `2` (DIRT with DESERT under it); `base_layer SNOW` alone; a pass on the masked DIRT | AoE2RMSIDE's mask meaning / `+mask-swapped`. Saved layers are compared too |
| 17-18 | t9-cliffs | FOREST with spacing 2 around cliff lines; then DIRT with `base_terrain CLIFFLINE` (#const 16) painted on the lines | every line tile restored at the end (AoE2RMSIDE) / `+if16` (the guide: terrain 16 "can be replaced") |

## Part B: elevation and cliffs, what rounds EC and EC2 left open (26 maps)

| # | Script | Seeds | What it tests | Readings |
|---|---|---|---|---|
| 19-20 | e1-high | 1000, 1001 | `create_elevation 10`: heights 8 to 10, the smoothing's lowering branch | one |
| 21-22 | e2-negative | 1000, 1001 | `create_elevation 5`, then `create_elevation -2` | removes the last 2 layers (AoE2RMSIDE) / `+ignored` |
| 23-24 | e3-empty | 1000, 1001 | an empty `<ELEVATION_GENERATION>` header, a raw SNOW plateau at 4, cliffs after | burned draw + one smoothing (AoE2RMSIDE) / `+ignored` / `+smooth-noburn` |
| 25-26 | e4-hillwater | 1000, 1001 | SNOW at 4 and DIRT at 2 bordering a WATER band; the late WATER cleanup turns some raised tiles to water | they keep their height (AoE2RMSIDE) / `+fill-zero` (13 and 30 tiles differ) |
| 27-28 | e5-coast | 1000, 1001 | cliffs (`min_terrain_distance 0`) beside SHALLOW, ICE and SNOW lands touching WATER | one |
| 29-30 | wc2-distance | 1000, 1001 | wc1's water band with the default `min_terrain_distance` (2) | one |
| 31 | ct3-snow | 1000 | `cliff_type CT_SNOW`: objects 1858-1866 | one |
| 32 | ct4-marble | 1000 | `cliff_type CT_MARBLE`: objects 2178-2186 | one |
| 33 | ct5-limestone | 1000 | `cliff_type CT_LIMESTONE`: objects 2069-2077 | one |
| 34 | gr2-dirt | 1000 | gr1's vanishing lands on a DIRT base: 1 restore draw per tile | one; *control* `+zero` |
| 35 | gr3-grass2 | 1000 | the same on GRASS2: 15 draws per tile (five entries) | one; *control* `+three` |
| 36 | gr4-grass3 | 1000 | the same on GRASS3: 6 draws (entries at weight 0 cost nothing) | one; *control* `+w0counts` (15) |
| 37 | gr5-forest | 1000 | the same on FOREST: 0 draws (centered at weight 1000) | one; *control* `+one` |
| 38-39 | pg1-grassland | 1000, 1001 | a 3000-tile GRASS land with cliffs across it: painting spends no draws | one; *control* `+paintdraws` (3 per tile) |
| 40-41 | ly2-order | 1000, 1001 | `base_layer SNOW` written **before** `base_terrain` | dropped (AoE2RMSIDE; the guide says it must come after) / `+layer` |
| 42-43 | ly3-nobase | 1000, 1001 | no `base_terrain` line at all; hills on GRASS without `base_layer` | unpainted tiles carry a GRASS layer, so no hills (AoE2RMSIDE) / `+nolayer` (hills on the base) |
| 44 | sc1-scale | 1000 | round EC2's script at size 200 (`_size-200`): scaling multiplies by 4 | one |

Scripts to copy (25): `t1-forest`, `t2-shape`, `t3-amounts`, `t4-spacing`, `t5-avoid`, `t6-height`, `t7-water`,
`t8-mask`, `t9-cliffs`, `e1-high`, `e2-negative`, `e3-empty`, `e4-hillwater`, `e5-coast`, `wc2-distance`,
`ct3-snow`, `ct4-marble`, `ct5-limestone`, `gr2-dirt`, `gr3-grass2`, `gr4-grass3`, `gr5-forest`, `pg1-grassland`,
`ly2-order`, `ly3-nobase` (all `.rms` in `tests\`). `sc1-scale.rms` is already in the game folder from round EC2.

## Not covered by this round

- **The second water repair around a cliff line** (marker 16). No layout we tried makes it fire (wc, fuzzy bands,
  two lakes, 9 and 16 ponds, the coast probe), so its prediction (a terrain-16 tile left in a finished map) stays
  untested.
- **Randomized decorations at weight 1000** (2 draws): no DE terrain has one.
- Terrain stage leftovers for a later round: `terrain_mask` with `base_layer` together, `clumping_factor` below 0,
  more than 999 clumps, sizes other than Tiny, and anything with `<CONNECTION_GENERATION>` (the guide says
  `beach_terrain` breaks with it).

## Compare

From `tests\`:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_ec.py 2>$null
```

It compares elevation, terrain and layer of every tile and every cliff object's type, position and facing, for all
three rounds. `ONLY=t1` (or any part of a file name) limits it to some maps.
