# Round CF run sheet: confirmations and the unmodelled attributes (39 maps, set up 2026-10-28)

**Status (2026-10-28): run, all 39 maps saved and compared (`cf_run.txt`; summary in `results.md`).** Scripts and file names come from
`probe_cf.py` (`python probe_cf.py write` writes the 24 `.rms` files, `cf_predictions.pkl` and `cf-predictions.md`;
`python probe_cf.py runs` prints the 39 file names). `compare_cf.py` compares and measures.

Three jobs:
1. **Part K: confirm round CO's after-the-run rules** on new layouts and new seeds (1002, 1003). The models now use
   them as defaults, and every map is predicted with the old rule as a control.
2. **Part L: the owner's question about `base_layer` on `create_land`.** Round GP found it ignored on one layout
   (ge1). The owner's understanding is that it lets `<ELEVATION_GENERATION>` tell two lands of the same terrain apart.
   The guide lists `base_layer` only for the whole map, `create_elevation` and `create_terrain`, not for `create_land`.
3. **Part U: every object attribute the models do not cover**, one family per script, laid out so the guide's claim
   can be measured from the saved map. `compare_cf.py` prints each measurement next to the claim, which was written
   before the run. Descriptors the models do cover come first in each script, so they are still predicted.

## Setup

1. Copy the 24 scripts listed at the end from `tests\` into
   `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (or let Claude do
   it). Nothing else in the game folder is touched.
2. As before: scenario editor, **Team Positions ticked**, every unused slot allied with nobody, Seed Map ticked
   with the seed typed in. Map size Tiny.
3. **Lobbies:** `n2` = 2 players, no teams, civilizations left at RANDOM; `n3` = 3 players, no teams;
   `n2-brit` = 2 players, both Britons; `n4-brit-azt-inca-gurj` = 4 players, no teams, player 1 Britons, 2 Aztecs,
   3 Incas, 4 Gurjaras. Set civilizations in the Players tab **before** generating.
4. Save as `RMSTEST_<script>_<seed>_<lobby>`, for example `RMSTEST_k7-owned_1002_n2-brit`.

Priority if time is short: K (k1, k2, k4, k6 first), then L, then U.

## Part K: confirmations (21 maps)

| # | Script | Lobby, seeds | Rule (main reading) | Controls |
|---|---|---|---|---|
| 1-2 | k1-overlap | n2; 1002, 1003 | a command's undo restores the value from before a tile's last paint, so the second command sees DESERT/SNOW where the first command's two paths overlapped | `+undo-entry` (old isolation), `+live-all` |
| 3-4 | k2-nonplayer | n3; 1002, 1003 | the same undo with `to_nonplayer_land` and 3 players (its copies overwrite the next 3 commands; the last command reads the doubly painted road) | `+undo-entry`, `+no-bug` |
| 5-6 | k3-coast | n2; 1002, 1003 | the end-of-terrain beach pass keeps the land cleanup's grass decorations on tiles it turns to BEACH | `+beach-destroys` |
| 7-8 | k4-forage | n2; 1002, 1003 | FORAGE draws a facet over 4 from stream 6; the animals after it get their angles from the same stream | `+forage-fixed` |
| 9-10 | k5-retire | n2; 1002, 1003 | decorations under GOLD, STONE, RELIC and gaia HOUSEs are deleted from the map | `+retire-keeps` (status 7) |
| 11-12 | k6-groups | n2; 1002, 1003 | group entries kept when weight ≥ roll; includes a 100/0 group | `+atmost`, `+cumulative` |
| 13-14 | k7-owned | n2; 1002, 1003 | per-player STONE, GOLD, FORAGE, DEER, BOAR, OAKTREE, RELIC, SHEEP without `set_gaia_object_only`: a player-owned stone mine is placed (draws spent) but not created; the rest exist and are player-owned | `+owned-stone` (created), `+owned-mines` (gold dropped too) |
| 15 | k7-owned | n2-brit; 1002 | the same with Britons: the model takes these resources as unavailable to the civilization, places none and spends draws only on the search (both controls give this map) | — |
| 16 | k8-civs | n4-brit-azt-inca-gurj; 1002 | the editor saves SCOUT as Scout Cavalry (448) for every civilization; the replacement roll is still spent | `+civ-replace` (751 Aztecs, 2550 Incas, 1755 Gurjaras) |
| 17 | k9-fixed | n2-brit; 1002 | positions of TC, HOUSE, GUARD_TOWER, OUTPOST, WATCH_TOWER, FLAG_A, RUINS, FISH, SHORE_FISH, GREAT_FISH_MARLIN, FISH_TUNA. **Their stored frames are not predicted**: this map records what the file stores for each | `+fixed-facet` (the content pack's 7) |
| 18-21 | k10a-samezones, k10b-alllands | n2; 1002, 1003 | twin scripts, `create_connect_same_land_zones` and `create_connect_all_lands`, lands in zones 1, 1, 2 and default: the two DE maps should be identical (the guide and AoE2RMSIDE) | k10a `+by-zone` (the preview) |

MILL, LUMBER_CAMP, MINING_CAMP, MARKET and MONASTERY were left out of k9: the content pack has no placement data for
them, so the model cannot place them.

## Part L: `base_layer` on `create_land` (4 maps)

Two DIRT lands on DESERT, at 30 50 (zone 1) and 70 50 (zone 2). Only the first has `base_layer SNOW`. Then
`create_elevation 2 { base_terrain DIRT base_layer SNOW }` and `create_terrain LEAVES { base_layer SNOW }` (a
layer-only pass).

| # | Script | Seeds | What it shows | Readings |
|---|---|---|---|---|
| 22-23 | ll1-twolands | 1002, 1003 | the attribute after `terrain_type`. Also `create_object GOLD { layer_to_place_on SNOW }` (measured) | ignored: no hills, no LEAVES, no layer (main) / `+land-layer`: hills and LEAVES on the first land only, its tiles carry SNOW |
| 24 | ll2-before | 1002 | the attribute written before `terrain_type` (the map-level `base_layer` is dropped when written before `base_terrain`, ly2) | the same two |
| 25 | ll3-maplayer | 1002 | with a map `base_layer DIRT3` as well (maybe land layers only work on a layered map) | the same two |

The saved layers answer it directly. If the first land shows hills or LEAVES, or carries layer SNOW, the owner's
reading holds on that layout.

## Part U: the unmodelled attributes (14 maps; measured)

| # | Script | Lobby, seeds | Attributes | Measured (guide's claim) |
|---|---|---|---|---|
| 26-27 | u1-actor | n2-brit; 1002, 1003 | `create_actor_area` ×2, `actor_area` + `actor_area_radius` on per-player TCs, `actor_area_to_place_in` (with `override_actor_radius_if_required` on HOUSEs), `actor_area` with the default radius on SHEEP, `avoid_actor_area`, `avoid_all_actor_areas` | distances from area centres and from the TCs and sheep |
| 28-29 | u2-forestcliff | n2; 1002, 1003 | `avoid_forest_zone` 3 and default, `place_on_forest_zone`, `avoid_cliff_zone` 3 and default, a grouped `avoid_forest_zone` | distance from every object to the nearest tree and cliff piece |
| 30 | u3-lands | n2; 1002 | `land_id` (two lands with 7, one with 8), `place_on_specific_land_id` with and without a distance, with `avoid_other_land_zones`, `generate_for_first_land_only` on land ids and on two `create_player_lands`, id −11 | objects per land and their distance from its origin |
| 31 | u4-force | n2; 1002 | `force_placement` on a 3×3 land, per player within 2, and on GOLD; a TURKEY control without it | count placed and distinct tiles |
| 32-33 | u5-minconn | n2; 1002, 1003 | `min_connected_tiles 40` on DIRT clumps of about 30 tiles, with a STONE control | clump size under each group; centroid (the guide's top-left bias) |
| 34 | u6-walls | n2-brit; 1002 | PALISADE_WALL at 12-13, STONE_WALL at 20-21 | pieces' distance from the TC (round CO's ob13 shows a square ring at exactly the minimum, 14) |
| 35-36 | u7-path | n2-brit; 1002, 1003 | `require_path 1` and default among forests that wall players in, with a FORAGE control | path length over straight distance from the TC, or unreachable |
| 37 | u8-center | n2-brit; 1002 | `find_closest_to_map_center` single, loose and tight. **Modelled**, so predicted | — |
| 38 | u9-layer | n2; 1002 | `layer_to_place_on` with `terrain_mask` 1 and 2, with and without `terrain_to_place_on` | terrain and layer under each object |
| 39 | u10-noop | n2; 1002 | `resource_delta`, `set_gaia_unconvertible`, `set_building_capturable`. **Predicted as no-ops**: if the map is identical, they change nothing in the saved map | — |

Left out: `match_player_civ` (Star Wars Galactic Battlegrounds only, says the guide) and `make_indestructible`
(the guide says it crashes the editor's test map).

### Already measured on round CO's observation maps (2026-10-28, no new maps)

`compare_cf.py` measures ob5, ob7, ob8, ob10 and ob13 the same way:
- **Forest and cliff zones (ob5):** `avoid_forest_zone 4` gives at least 5 tiles from any tree, the default at
  least 2, `place_on_forest_zone` exactly 1 (always next to a tree, never on one), `avoid_cliff_zone 3` at least 4,
  the default at least 2. All as the guide says, read as "more than N".
- **Actor areas (ob7):** every GOLD within 6 of one of the two areas sharing id 1. FORAGE avoiding both stays 8 or
  more from the first area's centre.
- **Specific lands (ob8):** 3 GOLD per id-7 land within 6. With `generate_for_first_land_only` and no distance,
  the 3 DEER can be anywhere: 51 to 58 tiles from the origin.
- **`min_connected_tiles 30` (ob10):** every DIRT clump there was 36 to 39 tiles, so the attribute had nothing to
  refuse. The groups' centroids are near the top edge (y 14 and 5), which fits the guide's top-left bias.
- **`force_placement` (ob10):** 15 SHEEP asked for on a 3×3 SNOW land; **9 placed, one per tile.** No stacking
  there.
- **Walls (ob13):** each palisade is a square ring at Chebyshev distance exactly 14 (the band was 14-16), 67 and 92
  pieces.

## Compare

From `tests\`:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_cf.py 2>$null
```

Scripts to copy (24): `k1-overlap`, `k2-nonplayer`, `k3-coast`, `k4-forage`, `k5-retire`, `k6-groups`,
`k7-owned`, `k8-civs`, `k9-fixed`, `k10a-samezones`, `k10b-alllands`, `ll1-twolands`, `ll2-before`,
`ll3-maplayer`, `u1-actor`, `u2-forestcliff`, `u3-lands`, `u4-force`, `u5-minconn`, `u6-walls`, `u7-path`,
`u8-center`, `u9-layer`, `u10-noop` (all `.rms` in `tests\`).
