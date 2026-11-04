# Round GP run sheet: the gaps left after round ET (46 maps, 2026-10-27)

**Status (2026-10-28): run. 46 of 46 maps match one predicted reading** (44 the primary one, ge1's two the `+ignored` variant: `base_layer` on `create_land` is ignored). Details in `results.md` 2026-10-28; the write-ups are updated.

Predictions were written before any DE run: `gp-predictions.md` (summary) and `gp_predictions.pkl` (full grids), from
`stage_model.py` with the readings added for this round. Where a rule is open, every reading is predicted, and the
comparison prints one line per reading. One of them should be IDENTICAL. The gaps come from the "Not tested" lists of
`notes/de-land-stage.md` (11), `notes/de-elevation-cliffs.md` (8) and `notes/de-terrain-stage.md` (12), picked for
how likely a real script is to hit them.

## Setup

1. Copy the 23 scripts below from `tests\` into `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (or let Claude do it). Nothing else in the game folder is touched.
2. Scenario editor, **Team Positions ticked**, every unused slot allied with nobody, Seed Map ticked with the seed
   typed in. The lobby is in the file name: `n2` = 2 players, no teams; `n4` = 4 players, no teams;
   `n4t1122` = 4 players, players 1+2 on team 1 and 3+4 on team 2.
3. Map size is Tiny unless the file name says `_size-<n>` (200 Normal, 220 Large, 252 Giant).
4. Save as `RMSTEST_<script>_<seed>_<lobby>[_size-<n>]`, for example `RMSTEST_gx1-real_1000_n4t1122_size-220`.

## Part X: every stage on a real-shaped map (4 maps; the priority)

| # | File | What it tests |
|---|---|---|
| 1-2 | `gx1-real_1000_n4_size-200`, `gx1-real_1001_n4_size-200` | player lands by `land_percent` with fuzziness, clumping and avoidance 7; a central lake; a neutral land at a random position; hills scaled by groups; default cliffs; forests avoiding players; grass patches. Never tested with players at a size other than Tiny |
| 3-4 | `gx1-real_1000_n4t1122_size-220`, `gx1-real_1001_n4t1122_size-220` | the same at Large with two teams |

## Part L: land (10 maps, Tiny)

| # | Script | Lobby, seeds | What it tests | Readings |
|---|---|---|---|---|
| 5-6 | gl1-circle | n4t1122; 1000, 1001 | `circle_radius 40 0` with teams | one |
| 7-8 | gl2-avoid | n2; 1000, 1001 | `other_zone_avoidance_distance` 6, 9 and 12 (the trimmed corners and the just-under-2/3 factor) | one; *control* `+exact23` (same map at 1001; differs at 1000) |
| 9-10 | gl3-default | n2; 1000, 1001 | `create_land` with no amount | `land_percent 100` (the guide) / `+zero` |
| 11-12 | gl4-random | n2; 1000, 1001 | `start_random` with no branch taken (weight 1), an empty block, weights over 100 | as modelled / `+empty-free` (an empty block draws nothing) / `+last-branch` |
| 13-14 | gl5-behavior2 | n2; 1000, 1001 | `behavior_version 2` | like 1 (the model) / `+v0` |

## Part E: elevation (7 maps)

| # | Script | Seeds, size | What it tests | Readings |
|---|---|---|---|---|
| 15-16 | ge1-landlayer | 1000, 1001 | `base_layer` on `create_land`; hills with the same `base_layer` | the land's tiles carry it / `+ignored`. The saved layers answer it directly |
| 17-18 | ge2-overlap | 1000, 1001 | a lower land's stamp over a raised land's stamp | one |
| 19 | ge3-many | 1000, Giant 252 | `create_elevation` with `number_of_clumps 9999` | capped at 999 / `+nocap` |
| 20-21 | ge4-bothscale | 1000, 1001 | `set_scale_by_groups` and `set_scale_by_size` in one block | the later wins / `+first` / `+both` |

## Part T: terrain (13 maps)

| # | Script | Seeds, size | What it tests | Readings |
|---|---|---|---|---|
| 22-23 | gt1-beachfirst | 1000, 1001 | `create_terrain DIRT { base_terrain BEACH }` with a WATER band and a BEACH land: is there a beach pass before the first `create_terrain`? | no (AoE2RMSIDE) / `+prebeach` |
| 24-25 | gt2-flatwater | 1000, 1001 | `create_terrain WATER` on hills with the default spacing 0 | flat-only checks nothing / `+flat-self` |
| 26-27 | gt3-both | 1000, 1001 | `base_terrain` with `base_layer` on one pass (preview Sec.15 item 27); `terrain_mask 1` with `base_layer` | both must hold / `+either` |
| 28-29 | gt4-spacings | 1000, 1001 | both spacing attributes on one pass (Sec.15 item 42); negative `clumping_factor` | both apply / `+other-only` / `+specific-only` |
| 30-31 | gt5-beachmark | 1000, 1001 | a pass without `beach_terrain` repaints coast tiles of a pass with it | the mark is cleared / `+sticky` |
| 32-33 | gt6-zero | 1000, 1001 | `number_of_tiles 0` | the seeds are painted / `+zero-none` |
| 34 | gt7-many | 1000, Giant 252 | `create_terrain` with `number_of_clumps 9999` | capped at 999 / `+nocap` |

## Part M: two `create_player_lands`, `assign_to`'s pick, `override_map_size` (12 maps, added 2026-10-27)

The readings come from AoE2RMSIDE's setup and land code (commit 210d977), restated in `probe_gp.py`.

| # | File | What it tests | Readings |
|---|---|---|---|
| 35-38 | `gm1-twoplayer_1000_n2`, `_1001_n2`, `_1000_n4t1122`, `_1001_n4t1122` | two `create_player_lands` commands (DIRT, then SNOW). Every land gets its own place on the perimeter: a player's lands come one after another, and the step is split over all lands | own places (AoE2RMSIDE) / `+shared` (a player's two lands at one origin) |
| 39-40 | `gm2-assignall_1000_n4`, `_1001_n4` | four lands at the corners, each `assign_to AT_TEAM -10 0 0` (any player). Each pick is one parse-time draw over the players not yet picked, in slot order | as modelled / `+reuse` (picked players can be picked again) |
| 41-42 | `gm3-assignteam_1000_n4t1122`, `_1001_n4t1122` | the same with `AT_TEAM 1` on the top two lands and `AT_TEAM 2` on the bottom two | as modelled / `+reuse` |
| 43-44 | `go1-override144_1000_n2`, `_1001_n2` | `override_map_size 144` saved from a **Tiny** lobby: every stage should run at 144 | one |
| 45 | `go2-override100_1000_n2` | `override_map_size 100` from a Tiny lobby: a size no lobby offers | one |
| 46 | `go3-small_1000_n2_size-144` | go1's script **without** the override line, saved at **Small** (144). DE's map should be identical to `go1-override144_1000_n2` | one |

- **Saving the assign maps:** the owner of each land is read from the villager placed 3 tiles from every player's land, so keep the `<OBJECTS_GENERATION>` section as written. `compare_gp.py` prints the owners it reads.
- **Saving the override maps:** start from a Tiny lobby. The saved map should come out at 144 (or 100). If it stays at 120, the editor ignores the override, and the comparison says so.

Scripts to copy (17 + 6 for Part M: `gm1-twoplayer`, `gm2-assignall`, `gm3-assignteam`, `go1-override144`,
`go2-override100`, `go3-small`): `gx1-real`, `gl1-circle`, `gl2-avoid`, `gl3-default`, `gl4-random`, `gl5-behavior2`,
`ge1-landlayer`, `ge2-overlap`, `ge3-many`, `ge4-bothscale`, `gt1-beachfirst`, `gt2-flatwater`, `gt3-both`,
`gt4-spacings`, `gt5-beachmark`, `gt6-zero`, `gt7-many` (all `.rms` in `tests\`).

## Not covered by this round, and why

- **Needs a reading we do not have:** `set_zone_by_team`, zones −11 and −12,
  `beach_terrain` with `<CONNECTION_GENERATION>`. Our model
  has no rule for these, so a probe would only show what DE does, not test a prediction. They can still be run as
  plain observations later.
- **No layout found:** the marker-16 water repair around cliff lines.
- **Settled elsewhere (round CO Part 0, 2026-10-27):** the terrain stage's burned draw without a
  `<TERRAIN_GENERATION>` section is spent. 22 saved maps with grass decorations and no terrain section match
  `appearance_model` object for object, and one draw less shifts them all.
- **Rare in real scripts:** negative `border_fuzziness`, elevation spacing of 256 or more, cliffs with min > max,
  `direct_placement` with Team Positions off, alliance tables that are not all-to-all (editor only).

## Compare

From `tests\`:

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_gp.py 2>$null
```
