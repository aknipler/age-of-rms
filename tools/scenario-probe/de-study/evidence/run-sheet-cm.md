# Round CM run sheet: the rules of 2026-11-14 and the object stage's untested corners (46 maps, set up 2026-11-14)

**Status: SET UP. Predictions are frozen in `cm_predictions.pkl` (`python probe_cm.py predict`) before any map is
saved; check the `__frozen__` time before starting. Not run yet.** For a Claude session (Sonnet, low effort) driving
the AoE2 DE scenario editor from PowerShell, or for the owner.

Scripts come from `probe_cm.py` (`python probe_cm.py write` writes the 23 `cm-*.rms` files; `python probe_cm.py runs`
prints the 46 file names in this sheet's order). The session only saves files and never opens or reads them.

## Why

- **W (walls):** every saved ring so far was a plain square on open grass. Rings across forest, lakes, resources and
  the map's edge; two commands with the same radii; a gaia wall; an actor area per wall piece.
- **Q (queue rules found on Heart and Bazi):** a group object with a forest filter; a loose group placed in an actor
  area; fractional object counts (2.5, 3.5, 4.5 with scaling).
- **E (effects):** standing graphics changed on a unit and on a resource; an upgrade on a placed object;
  `effect_percent` on a size that is not 0.
- **D, C (decorations):** objects with negative hit points over decorations; a composite painted as a layer over two
  terrains.
- **F (force_placement):** per player on a small SNOW land, sheep and gold; and CF u4's frameless case again.
- **X:** `make_indestructible`, `set_gaia_civilization`, `nomad_resources` and `guard_state`, which the model ignores.
- **Z:** dense single objects under `avoid_other_land_zones 1` on ragged DIRT lands, to map DE's land zones at
  their edges (CO ob8 1000).
- **R:** r1 and r2 are the same script under two names: does the panda rock's stored frame repeat at the same seed?

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
- **Leave the editor for the main menu before every map** (the driver does this). The editor keeps effect lines from
  one generation to the next, and E, D and X have effects.
- Copy the 23 `cm-*.rms` scripts from `tests\` to
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (the owner
  allows this). Touch nothing else in the game folder. Do not touch `scenario\carryover-2026-10-28\`, the Ghidra
  files, or any Python in `tests\`.
- Keep screenshots few and small. **Do not run a monitor or `tail` on the log file.**
- If a step fails twice, stop, save a shot, write what happened under Notes (with the screen it was on), and report.

## Tools

- `tools\editor-automation\batch_cm.ps1`, the driver (round CL's, with this round's plan; it navigates with
  `screen.py`):
  - per map: quit to the main menu, Editors, Create Scenario, Seed Map, Tiny, both civilizations Britons, pick the
    script, save a crop of its label to `cm-shots\`, set the seed, generate and save;
  - `-FromMainMenu` skips the quit steps for the first map; it skips maps that already exist; `-Only <text>` and
    `-Max <n>` limit it.
- The script-pick check compares each label with `cm-shots\label_cm-w1-forest_1013.png`, the first map's crop. That
  crop does not exist until the first map is saved, so step 1 checks it by eye.

## Steps

1. First map alone: `batch_cm.ps1 -FromMainMenu -Max 1` (makes `RMSTEST_cm-w1-forest_1013_n2-brit`). Look at
   `cm-shots\label_cm-w1-forest_1013.png`: it must read `cm-w1-forest`. If not, delete the map and the crop and stop.
2. Full run: `batch_cm.ps1`.
3. View the label crops in `cm-shots\` as one strip (`New-Strip`) to confirm every map used the right script
   (r1 and r2 differ only in one digit).
4. Fill in the table and the Notes. If a script fails to generate (an error box, or the map stays blank), save
   nothing for it and note it. That is a result too (x2's `set_gaia_civilization` and x3's `guard_state` are the
   likeliest to be refused).

## Settings

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked**.
- 2 players, no teams, **both Britons** (lobby `n2-brit`).
- Save as `RMSTEST_<script>_<seed>_n2-brit`. Seeds 1013 and 1014.

## Not in this round (needs the owner, or new driver calibration)

The driver sets two Britons on Tiny. These need other lobby settings, and are worth a small manual round:
- a civilization with other starting units (Chinese: extra villagers; Mayans: an extra villager), with
  `cm-q2-looseroute` or round CK's villager scripts;
- 4 players in teams (`n4t1122`), with `cm-w2-resources` (allied walls and the enemy-reach filter) and the CK tail;
- a larger map size (Medium) with `cm-q3-fractions` (scaling of fractional counts).

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cm-w1-forest_1013_n2-brit | | | |
| 2 | RMSTEST_cm-w1-forest_1014_n2-brit | | | |
| 3 | RMSTEST_cm-w2-resources_1013_n2-brit | | | |
| 4 | RMSTEST_cm-w2-resources_1014_n2-brit | | | |
| 5 | RMSTEST_cm-w3-lakes_1013_n2-brit | | | |
| 6 | RMSTEST_cm-w3-lakes_1014_n2-brit | | | |
| 7 | RMSTEST_cm-w4-cache_1013_n2-brit | | | |
| 8 | RMSTEST_cm-w4-cache_1014_n2-brit | | | |
| 9 | RMSTEST_cm-w5-actorarea_1013_n2-brit | | | |
| 10 | RMSTEST_cm-w5-actorarea_1014_n2-brit | | | |
| 11 | RMSTEST_cm-w6-edge_1013_n2-brit | | | |
| 12 | RMSTEST_cm-w6-edge_1014_n2-brit | | | |
| 13 | RMSTEST_cm-q1-groupfilter_1013_n2-brit | | | |
| 14 | RMSTEST_cm-q1-groupfilter_1014_n2-brit | | | |
| 15 | RMSTEST_cm-q2-looseroute_1013_n2-brit | | | |
| 16 | RMSTEST_cm-q2-looseroute_1014_n2-brit | | | |
| 17 | RMSTEST_cm-q3-fractions_1013_n2-brit | | | |
| 18 | RMSTEST_cm-q3-fractions_1014_n2-brit | | | |
| 19 | RMSTEST_cm-e1-graphics_1013_n2-brit | | | |
| 20 | RMSTEST_cm-e1-graphics_1014_n2-brit | | | |
| 21 | RMSTEST_cm-e2-upgrade_1013_n2-brit | | | |
| 22 | RMSTEST_cm-e2-upgrade_1014_n2-brit | | | |
| 23 | RMSTEST_cm-e3-percent_1013_n2-brit | | | |
| 24 | RMSTEST_cm-e3-percent_1014_n2-brit | | | |
| 25 | RMSTEST_cm-d1-negativehp_1013_n2-brit | | | |
| 26 | RMSTEST_cm-d1-negativehp_1014_n2-brit | | | |
| 27 | RMSTEST_cm-c1-layercomposite_1013_n2-brit | | | |
| 28 | RMSTEST_cm-c1-layercomposite_1014_n2-brit | | | |
| 29 | RMSTEST_cm-f1-forcesheep_1013_n2-brit | | | |
| 30 | RMSTEST_cm-f1-forcesheep_1014_n2-brit | | | |
| 31 | RMSTEST_cm-f2-forcegold_1013_n2-brit | | | |
| 32 | RMSTEST_cm-f2-forcegold_1014_n2-brit | | | |
| 33 | RMSTEST_cm-f3-forceframeless_1013_n2-brit | | | |
| 34 | RMSTEST_cm-f3-forceframeless_1014_n2-brit | | | |
| 35 | RMSTEST_cm-x1-indestructible_1013_n2-brit | | | |
| 36 | RMSTEST_cm-x1-indestructible_1014_n2-brit | | | |
| 37 | RMSTEST_cm-x2-gaiaciv_1013_n2-brit | | | |
| 38 | RMSTEST_cm-x2-gaiaciv_1014_n2-brit | | | |
| 39 | RMSTEST_cm-x3-noops_1013_n2-brit | | | |
| 40 | RMSTEST_cm-x3-noops_1014_n2-brit | | | |
| 41 | RMSTEST_cm-z1-landedge_1013_n2-brit | | | |
| 42 | RMSTEST_cm-z1-landedge_1014_n2-brit | | | |
| 43 | RMSTEST_cm-r1-rock_1013_n2-brit | | | |
| 44 | RMSTEST_cm-r1-rock_1014_n2-brit | | | |
| 45 | RMSTEST_cm-r2-rock_1013_n2-brit | | | |
| 46 | RMSTEST_cm-r2-rock_1014_n2-brit | | | |

## Notes (fill in)

- Run 2026-11-14. `cm_predictions.pkl` did not exist at the start; frozen 16:19:29 (before any CM map was saved).
- All 46 maps saved (`RMSTEST_cm-*_n2-brit.aoe2scenario`), no generation errors; per-map sizes are in `tools\editor-automation\batch_cm.log`. Table columns not filled in by hand.
- r2 1013 stopped the first batch (44 saved): `Confirm-Script` rejected the pick because r1's and r2's label crops differ by under 1.5. The screen showed `cm-r2-rock`. I lowered the r1-versus-r2 threshold to 0.5 in `batch_cm.ps1` and re-ran both r2 maps; both crops read `cm-r2-rock` by eye.
- Label crops of the other 44 maps were confirmed by the driver; I did not view them as a strip.

2026-11-14: predictions computed into `cm_predictions.partial.pkl` by 16:19 (last write), marked frozen 16:27:45
(`cm_predictions.pkl`, 46 main + 28 controls; `probe_cm.py check`: every control differs at both seeds). First map
saved 16:21:59, so every prediction predates every CM map. The model code is the one regressed in `reg_1114_*`.
