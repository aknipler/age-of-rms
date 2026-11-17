# Round CK run sheet: the object stage (30 maps, set up 2026-11-08)

**Status: SET UP; predictions frozen in `ck_predictions.pkl` before any map is saved. Not run yet.** For a Claude
session (Sonnet, low effort) driving the AoE2 DE scenario editor from PowerShell. The game is open at the main menu.

Scripts come from `probe_ck.py` (`python probe_ck.py write` writes them; `python probe_ck.py runs` prints the 30 file
names in this sheet's order). The session only saves files and never opens or reads them.

## Why

The corpus maps gave five object rules since 2026-11-01. Each has a control here, and every control predicts a
different map (`probe_ck.py check`):
- **A:** group picks are never replaced.
- **B:** villagers in an actor area take its draws, and forest-zone candidates re-resolve the object.
- **D:** `second_object` may name a group.
- **E:** an object that cannot be built on deletes the markers at its spot.

The rest measure what the corpus cannot separate:
- **F:** Comeer's huts, which DE never placed.
- **G:** the extra stream-6 draws of a town-centre marker at HP 0.
- **H:** Heart's villagers with the town centre off the land origin.
- **P:** `require_path`.
- **L:** decorations on repainted and masked tiles.

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
- **Leave the editor for the main menu before every map, including the second seed of the same script.** The editor
  keeps effect lines from one generation to the next (G1 and G2 have one).
- The 15 `ck-*.rms` scripts are already in
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Touch nothing else in
  the game folder. Do not touch `scenario\carryover-2026-10-28\`, the Ghidra files, or any Python in `tests\`.
- Keep screenshots few and small.
- **Do not run a monitor or `tail` on the log file.** A tail once locked `batch_cj.log` and the driver exited at
  once.
- If a step fails twice, stop, save a shot, write what happened under Notes, and report.

## Tools

- `tools\editor-automation\batch_ck.ps1`, the driver for this run (the same as round CJ's, with this round's plan):
  - per map: quit to the main menu, Editors, Create Scenario, Seed Map, Tiny, both civilizations Britons, pick the
    script, save a crop of its label to `ck-shots\`, set the seed, generate and save;
  - `-FromMainMenu` skips the quit steps for the first map;
  - it skips maps that already exist; `-Only <text>` and `-Max <n>` limit it.
- Round CJ's notes (`run-sheet-cj.md`) describe what to expect. A Steam overlay once left the game on the More
  Content screen: close it, return to the main menu, rerun.

## Steps

1. Dry run: `batch_ck.ps1 -FromMainMenu -Max 1` (makes `RMSTEST_ck-a1-groupreplace_1009_n2-brit`). Check the label
   crop.
2. Full run: `batch_ck.ps1`.
3. View the label crops in `ck-shots\` as one strip (`New-Strip`) to confirm every map used the right script.
4. Fill in the table and the Notes. If a script fails to generate (an error box, or the map stays blank), save
   nothing for it and note it. That is a result too.

## Settings

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked** (a fresh editor has it).
- 2 players, no teams, **both Britons** (lobby `n2-brit`).
- Save as `RMSTEST_<script>_<seed>_n2-brit`.
- Seeds 1009 and 1010 for every script.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_ck-a1-groupreplace_1009_n2-brit | 17:54 | 11299 | |
| 2 | RMSTEST_ck-a1-groupreplace_1010_n2-brit | 17:56 | 11127 | |
| 3 | RMSTEST_ck-b1-villroute_1009_n2-brit | 17:57 | 71153 | |
| 4 | RMSTEST_ck-b1-villroute_1010_n2-brit | 17:59 | 71147 | |
| 5 | RMSTEST_ck-d1-secondgroup_1009_n2-brit | 18:00 | 11161 | |
| 6 | RMSTEST_ck-d1-secondgroup_1010_n2-brit | 18:02 | 10960 | |
| 7 | RMSTEST_ck-e1-builderdelete_1009_n2-brit | 18:03 | 11335 | |
| 8 | RMSTEST_ck-e1-builderdelete_1010_n2-brit | 18:05 | 11167 | |
| 9 | RMSTEST_ck-f1-huts-grass_1009_n2-brit | 18:07 | 11273 | |
| 10 | RMSTEST_ck-f1-huts-grass_1010_n2-brit | 18:08 | 11075 | |
| 11 | RMSTEST_ck-f2-huts-snow_1009_n2-brit | 18:10 | 1950 | |
| 12 | RMSTEST_ck-f2-huts-snow_1010_n2-brit | 18:11 | 1956 | |
| 13 | RMSTEST_ck-g1-tcsite_1009_n2-brit | 18:13 | 11399 | |
| 14 | RMSTEST_ck-g1-tcsite_1010_n2-brit | 18:15 | 11192 | |
| 15 | RMSTEST_ck-g2-tcsite-alone_1009_n2-brit | 18:16 | 11396 | |
| 16 | RMSTEST_ck-g2-tcsite-alone_1010_n2-brit | 18:18 | 11192 | |
| 17 | RMSTEST_ck-g3-tcsite-fullhp_1009_n2-brit | 18:19 | 11405 | |
| 18 | RMSTEST_ck-g3-tcsite-fullhp_1010_n2-brit | 18:21 | 11199 | |
| 19 | RMSTEST_ck-g4-tc-onplaceholder_1009_n2-brit | 18:23 | 11333 | |
| 20 | RMSTEST_ck-g4-tc-onplaceholder_1010_n2-brit | 18:24 | 11124 | |
| 21 | RMSTEST_ck-h1-ringoff_1009_n2-brit | 18:26 | 11315 | |
| 22 | RMSTEST_ck-h1-ringoff_1010_n2-brit | 18:28 | 11110 | |
| 23 | RMSTEST_ck-p1-requirepath_1009_n2-brit | 18:29 | 9948 | |
| 24 | RMSTEST_ck-p1-requirepath_1010_n2-brit | 20:02 | 10438 |  |
| 25 | RMSTEST_ck-l1-repaint_1009_n2-brit | 19:50 | 12436 |  |
| 26 | RMSTEST_ck-l1-repaint_1010_n2-brit | 19:52 | 12052 |  |
| 27 | RMSTEST_ck-l2-mask1_1009_n2-brit | 19:53 | 12019 |  |
| 28 | RMSTEST_ck-l2-mask1_1010_n2-brit | 19:55 | 11974 |  |
| 29 | RMSTEST_ck-l3-mask2_1009_n2-brit | 19:57 | 11130 |  |
| 30 | RMSTEST_ck-l3-mask2_1010_n2-brit | 19:58 | 10643 |  |

## Notes (fill in)

- 2026-11-08, run by a Sonnet subagent. The game was on the Editors screen at the start; Escape returned to the main menu.
- First dry run: the label crop read "Forest, Autumn" (wrong script; map was 101,456 bytes). Deleted that file and reran: label then correct (ck-a1-groupreplace), 11,299 bytes. Cause not found; possibly the script list scroll on the first pass after Escape.
- Maps 1-23 saved. Maps 24-30 not saved: the driver failed 3 times at p1-requirepath_1010 with "Save As screen did not load" (line 155). `ck-shots\fail.png` (copy `fail-p1-1010.png`) shows the Steam overlay (a Steam Community guide page over "More Content") on top of the game. Closed it (Shift+Tab), clicked Back to the main menu, reran with -FromMainMenu: same failure. Stopped per the sheet. Steam overlay is the likely cause; try disabling it or closing Steam web pages, then rerun `batch_ck.ps1` (it skips existing maps).
- Label strip `ck-shots\strip.png` (24 label crops) confirmed every saved map used the right script. Sizes: most 11 KB; b1-villroute 71 KB; f2-huts-snow about 2 KB; p1-requirepath 9.9 KB.
- 2026-11-08 evening, second attempt (Sonnet subagent), 0 of 7 saved. Started in the editor: `batch_ck.ps1` failed at map 24 (p1-requirepath_1010) with "Save As screen did not load" (line 155) after ~2.5 min. The Steam overlay (same Community guide page) sat over the More Content screen. Closed the overlay by clicking the X "Back to Game" (Shift+Tab did not close it), clicked Back to the main menu (a shot confirmed it), reran with -FromMainMenu: the same failure, same overlay over More Content (shots `ck-shots\fail.png`, `now2.png`). Stopped per the sheet. The label crop `label_ck-p1-requirepath_1010.png` was written (19:13) so the script was chosen before the failure; the screen just before the failure was not caught. The game is left on More Content with the overlay open. Maps 24-30 still missing; the strip was not extended (no new crops to add).
- 2026-11-08 20:02, third attempt (Sonnet subagent): all 7 saved. The first l1-1009 try failed (file not written, game on a Small-map editor screen), a rerun saved it. p1-requirepath_1010 saved after 119 s generation wait (90 s driver wait). Strip `ck-shots\strip2.png`: labels for l1, l2, l3 and p1 all correct. All 30 maps saved.

