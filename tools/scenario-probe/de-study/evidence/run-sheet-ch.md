# Round CH run sheet: what round CG left open (9 scripts, 18 maps, set up 2026-10-29)

**Status: COMPARED 2026-10-30 (frozen main 12 of 18; all 18 identical with four post-hoc rules, see results.md). EDITOR PART RUN 2026-10-30 (18 maps saved; no script failed to generate; script labels checked by crop). Predictions frozen 2026-10-29 21:59:12 (44: main and controls for all 18 maps).** Scripts come from `probe_ch.py` (`python probe_ch.py write`
writes them; `python probe_ch.py runs` prints the 18 file names in this sheet's order).

**Predictions first.** `python probe_ch.py predict` writes the main reading and every control for every map and
freezes them in `ch_predictions.pkl` (timestamped). `ch_guard.py` keeps the compare scripts blind to `ch-` maps and
seeds 1007/1008 until that file exists. The editor session only saves files and must not inspect their contents.

## Setup (as in round CG)

1. Copy the 9 scripts `ch-*.rms` from `tests\` into
   `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Nothing else in the
   game folder is touched.
2. Scenario editor, **Map size Tiny**, **Team Positions ticked**, **every unused slot allied with nobody**, Seed Map
   ticked with the seed typed in. (`ch-s1-scale` sets its own size with `override_map_size 200`.)
3. **Lobby `n2-brit`:** 2 players, no teams, both Britons. Set civilizations in the Players tab before generating.
4. Seeds **1007** and **1008** for every script.
5. Save as `RMSTEST_<script>_<seed>_n2-brit`, for example `RMSTEST_ch-g1-palms_1007_n2-brit`.
6. If a script fails to generate (an error box, or the map stays blank), save nothing for it and note it at the end.
   That is a result too.

Priority if time is short: G, C, P (the three that can move the corpus maps most), then F, E, H, S, Z.

## The parts

| Script | What it settles | Corpus maps it serves | Readings (main first) |
|---|---|---|---|
| `ch-f1-offgrid` | Where a zero-size object stands in its tile: MAPLE_LEAVES with and without `set_facet`, its siblings, ferns, a hidden-in-editor control | Heart (2030 at the corner) | centre unless hidden or `set_facet`; `+no-facet-rule`; `+all-corner` |
| `ch-g1-palms` | Whether PALM_DESERT grows palms: as a land, painted over a land, painted with `terrain_mask 1` over DESERT; JUNGLE and DLC_RAINFOREST as controls | Immersion, Namatjira (DE has no palms on 687 and 728 PALM_DESERT tiles) | the model grows them; read directly |
| `ch-g2-palmstore` | The same with Namatjira's `SET_ATTRIBUTE PALMTREE ATTR_STORAGE_VALUE 200` | Namatjira | as g1 |
| `ch-e1-effects` | ATTR_TERRAIN_ID effects under LAND_GENERATION (JUNGLETREE) and under OBJECTS_GENERATION (LUSH_BAMBOO_TREE), DLC_RAINFOREST unrestricted; a gaia HOUSE with HP 0 from `SET_ATTRIBUTE` | Blind Valley (fixed after the run by reading effects in every section), Ra (status 0) | effects in every section; `+player-setup-only` |
| `ch-c1-composite` | Which decorations a resolved composite tile grows (34 and 62 as lands, 62 painted over DESERT), seen through the GOLD and DEER placed after them | Comeer (about 1,100 objects per seed), Ra | the composite's own; `+decor-resolved`; `+no-composite` |
| `ch-s1-scale` | `set_scale_by_groups` on `create_object` at 200 x 200 (GOLD groups, a tight STONE group, DEER objects) | Comeer, Ra, Namatjira | ignored; `+groups`; `+both` |
| `ch-p1-math` | `%` and `/` on negatives and fractions, and fractional land_position percents, read from where 7 small lands stand | Bulls_Eyes, Rage Forest (land positions drift) | `%` on truncated integers, float `/`, the float position kept; `+mod-float`, `+mod-floor`, `+div-trunc`, `+div-floor`, `+pos-round`, `+pos-trunc` |
| `ch-h1-storks` | Stork angles placed plainly and in a radius-2 actor area; villagers at distance 6 from the town centre; the scout at 7-9 | Heart (every stork angle differs; villagers and scout misplaced) | main only (no reading reproduces Heart's storks yet) |
| `ch-z1-tightzone` | Ra's tight gold group (7, radius 1, circular, `avoid_forest_zone 3`) among forest blocks, and the same group without the zone | Ra (large gold 11 of 14) | main only (no control changes the prediction) |

## What is still open and is not in this round

- **Bazi:** terrains 19 and 21 swapped on about 730 tiles per seed (`OUTSIDE_TERRAIN 19`, `OUTSIDE_VARIATION 21`), and
  elevation on 747 tiles at seed 1004. Not yet diagnosed; needs a look at which command paints them first.
- **Ra 1004:** 167 tiles where the model has 77 over 60 and DE has 40, after the composite rule. Dropping a composite
  layer is refuted (Rekawa breaks), and the frozen model, which left 62 unresolved, had DE's 40 on these tiles.
- **Rekawa:** too few objects (5,459 against 6,339 script objects); **Caverns:** too many (13,174 against 11,888).
- **Namatjira:** STONE 22 against 73.

## Saved maps (fill in)

| File | Saved | Note |
|---|---|---|
| RMSTEST_ch-f1-offgrid_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-f1-offgrid_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-g1-palms_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-g1-palms_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-g2-palmstore_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-g2-palmstore_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-e1-effects_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-e1-effects_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-c1-composite_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-c1-composite_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-s1-scale_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-s1-scale_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-p1-math_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-p1-math_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-h1-storks_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-h1-storks_1008_n2-brit | 2026-10-30 | |
| RMSTEST_ch-z1-tightzone_1007_n2-brit | 2026-10-30 | |
| RMSTEST_ch-z1-tightzone_1008_n2-brit | 2026-10-30 | |

Notes 2026-10-30: editor restarted to Create Scenario so the list picked up the ch- scripts (they had not been copied into the game folder; copied now). Tiny, 2 players both Britons, no teams, Seed Map and Team Positions ticked, seeds 1007 and 1008. File sizes are all in the usual range (h1 2.1 KB and s1 1.7 KB, like the old sc1 maps). Predictions were not touched.

