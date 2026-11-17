# Round CP run sheet: objects placed through an actor area, and Venn's KING (12 maps, set up 2026-11-15)

**Status: RUN 2026-11-15 22:47-23:06 (Claude, `batch_cp.ps1`, first label checked by eye). 12 of 12 identical under
the frozen main reading** (`compare_cp.py`, `cp_run.txt`). Predictions were frozen at 22:28:17, before any map was saved. Same procedure as rounds CM and CN: a fresh editor before every map (main menu first), Tiny, two Britons, Seed
Map with the seed typed in.

Scripts: `python probe_cp.py write` writes the six `cp-*.rms` files into `tests\`. Copy them to
`C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`.

## Why

In Venn every object from the KING (cmd 113) on differs from DE. The KING is placed with `actor_area_to_place_in` over
an area that ONGRID_PLACEHOLDER 1613 registers around the town centre once per land frame (each Venn player has a TC
land and a one-tile land). DE's KING tile passes every check in the model but ranks 26th-42nd in the model's route
order, and AoE2RMSIDE routes exactly as the model does (`results.md`, 2026-11-15). These scripts take that set-up
apart. Each has the players' DIRT lands (base 9) on GRASS, a TC with actor area 2800 (radius 0), ONGRID in 2800 with
area 2812 (radius 12), then the object under test, then GOLD and DEER (to see whether later commands follow).

| Script | What changes | If DE differs from the model here, then |
|---|---|---|
| p1 king | KING through area 2812 (the plain case) | the route rule is wrong even in the simplest case |
| p2 sheep | SHEEP instead of the KING | with p1: right here and wrong in p1 means a KING rule |
| p3 outpost | OUTPOST (a building) instead | with p1/p2: a rule for moving units |
| p4 kingtwice | ONGRID twice: the area registered twice on one tile | doubled weights are handled differently |
| p5 kingtwoland | each player also has a one-tile land (Venn's layout) | the second frame (control `+area-ctx-land`: records per land) |
| p6 kingqueue | no actor area: KING on DIRT within 6-12 | the plain queue for the KING |

p1, p2 and p3 put the object on the same tiles in the model, so only the object type differs between them.

**Predicted (main reading, frozen):** routed object at P1 (36.5, 64.5) and P2 (97.5, 64.5) in p1, p2 and p3 at seed
1016; p4 P1 (37.5, 64.5), P2 (84.5, 55.5); p5 P1 (37.5, 65.5), P2 (94.5, 53.5) (control: (37.5, 64.5), (97.5, 63.5));
p6 P1 (33.5, 67.5), P2 (90.5, 66.5). Seed 1017's are in the pickle.

## Steps

1. Copy the six scripts to the game's `random-map-scripts` folder.
2. With the game at the main menu: `tools\editor-automation\batch_cp.ps1 -FromMainMenu -Max 1`, then check by eye that
   `tools\editor-automation\cp-shots\label_cp-p1-king_1016.png` reads `cp-p1-king`.
3. `batch_cp.ps1` for the other 11 (it skips maps already saved).
4. Compare: `python compare_cp.py` (prints each map, then DE's and the model's routed tiles side by side).

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cp-p1-king_1016_n2-brit | | | |
| 2 | RMSTEST_cp-p1-king_1017_n2-brit | | | |
| 3 | RMSTEST_cp-p2-sheep_1016_n2-brit | | | |
| 4 | RMSTEST_cp-p2-sheep_1017_n2-brit | | | |
| 5 | RMSTEST_cp-p3-outpost_1016_n2-brit | | | |
| 6 | RMSTEST_cp-p3-outpost_1017_n2-brit | | | |
| 7 | RMSTEST_cp-p4-kingtwice_1016_n2-brit | | | |
| 8 | RMSTEST_cp-p4-kingtwice_1017_n2-brit | | | |
| 9 | RMSTEST_cp-p5-kingtwoland_1016_n2-brit | | | |
| 10 | RMSTEST_cp-p5-kingtwoland_1017_n2-brit | | | |
| 11 | RMSTEST_cp-p6-kingqueue_1016_n2-brit | | | |
| 12 | RMSTEST_cp-p6-kingqueue_1017_n2-brit | | | |

## Notes (fill in)


## Result (2026-11-15)

- **12 of 12 identical**, every object, under the frozen main reading; the control `+area-ctx-land` differs on both
  p5 maps. KING, SHEEP and OUTPOST route alike (p1-p3), a doubled registration routes as the model has it (p4), Venn's
  second land per player too (p5), and the KING's plain queue (p6).
- So the route rule is right, and Venn's KING is not explained by any of the six things these scripts isolate.
- Follow-up the same evening: Venn regenerated now in a fresh editor (`batch_vennregen.ps1`, saved as
  `RMSTEST_cg-x-venn-regen_*`) is object for object the same as the 30 October files (8,484 and 8,530 objects, KINGs
  included), and our `cg-x-venn.rms` is byte-identical to the game's copy, so the Venn maps are not stale. Changing
  which tiles count as available for the KING's route (all, occupied, model plus occupied) places no KING right.
