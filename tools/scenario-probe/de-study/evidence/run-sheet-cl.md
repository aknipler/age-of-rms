# Round CL run sheet: what round CK left open (28 maps, set up 2026-11-08)

**Status: SET UP; predictions frozen in `cl_predictions.pkl` before any map is saved. Not run yet.** For a Claude
session (Sonnet, low effort) driving the AoE2 DE scenario editor from PowerShell.

Scripts come from `probe_cl.py` (`python probe_cl.py write` writes them; `python probe_cl.py runs` prints the 28 file
names in this sheet's order). The session only saves files and never opens or reads them.

## Why

- **A:** CK's three probes that a bare number spoiled, redone with constants:
  - a group as second object;
  - markers deleted under an object;
  - the town centre as a second object.
- **B:** Comeer's own script with its hut command missing one filter at a time, to find what stops DE placing huts.
- **C:** the town-centre marker with Caverns' extra attributes, to find its two extra facing draws.
- **R:** `require_path`, on open land, between forest clearings at N = 0, 1, 5 and 20, and behind a wall ring.

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
- **Leave the editor for the main menu before every map** (the driver does this). The editor keeps effect lines from
  one generation to the next (the C scripts have one).
- The 16 `cl-*.rms` scripts are already in
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Touch nothing else in
  the game folder. Do not touch `scenario\carryover-2026-10-28\`, the Ghidra files, or any Python in `tests\`.
- Keep screenshots few and small. **Do not run a monitor or `tail` on the log file.**
- If a step fails twice, stop, save a shot, write what happened under Notes (with the screen it was on), and report.

## Slow maps

The R maps generate slowly: `require_path` runs path searches (CK's p1 took about 2 minutes), and the forest maps grow
about 13,000 trees. The driver waits 90 to 150 seconds for them before Save As. If Save As still fails on one, the map
was most likely still generating. Wait, return to the main menu, and rerun that map alone with `-Only <name>`.

## Tools

- `tools\editor-automation\batch_cl.ps1`, the driver (as round CK's, with this round's plan and waits):
  - per map: quit to the main menu, Editors, Create Scenario, Seed Map, Tiny, both civilizations Britons, pick the
    script, save a crop of its label to `cl-shots\`, set the seed, generate and save;
  - `-FromMainMenu` skips the quit steps for the first map;
  - it skips maps that already exist; `-Only <text>` and `-Max <n>` limit it.

## Steps

1. Dry run: `batch_cl.ps1 -FromMainMenu -Max 1` (makes `RMSTEST_cl-a1-secondgroup_1011_n2-brit`). Check the label crop.
2. Full run: `batch_cl.ps1`.
3. View the label crops in `cl-shots\` as one strip (`New-Strip`) to confirm every map used the right script.
4. Fill in the table and the Notes. If a script fails to generate (an error box, or the map stays blank), save
   nothing for it and note it. That is a result too.

## Settings

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked**.
- 2 players, no teams, **both Britons** (lobby `n2-brit`).
- Save as `RMSTEST_<script>_<seed>_n2-brit`.
- Seeds 1011 and 1012, except the four B scripts (Comeer variants): seed 1004 only.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cl-a1-secondgroup_1011_n2-brit | saved | 12522 | |
| 2 | RMSTEST_cl-a1-secondgroup_1012_n2-brit | saved | 11922 | |
| 3 | RMSTEST_cl-a2-builderdelete_1011_n2-brit | saved | 12309 | |
| 4 | RMSTEST_cl-a2-builderdelete_1012_n2-brit | saved | 11676 | |
| 5 | RMSTEST_cl-a3-tconmarker_1011_n2-brit | saved | 12164 | |
| 6 | RMSTEST_cl-a3-tconmarker_1012_n2-brit | saved | 11531 | |
| 7 | RMSTEST_cl-b1-hut-nozones_1004_n2-brit | saved | 58999 | |
| 8 | RMSTEST_cl-b2-hut-noforest_1004_n2-brit | saved | 59026 | |
| 9 | RMSTEST_cl-b3-hut-noarea_1004_n2-brit | saved | 58976 | |
| 10 | RMSTEST_cl-b4-hut-nogroup_1004_n2-brit | saved | 58975 | |
| 11 | RMSTEST_cl-c1-tc-forestzone_1011_n2-brit | missing | | |
| 12 | RMSTEST_cl-c1-tc-forestzone_1012_n2-brit | missing | | |
| 13 | RMSTEST_cl-c2-tc-groupdist_1011_n2-brit | missing | | |
| 14 | RMSTEST_cl-c2-tc-groupdist_1012_n2-brit | saved | 19329 | |
| 15 | RMSTEST_cl-c3-tc-both_1011_n2-brit | missing | | |
| 16 | RMSTEST_cl-c3-tc-both_1012_n2-brit | missing | | |
| 17 | RMSTEST_cl-r1-path-open_1011_n2-brit | missing | | |
| 18 | RMSTEST_cl-r1-path-open_1012_n2-brit | missing | | |
| 19 | RMSTEST_cl-r2-path-forest-n0_1011_n2-brit | missing | | |
| 20 | RMSTEST_cl-r2-path-forest-n0_1012_n2-brit | missing | | |
| 21 | RMSTEST_cl-r3-path-forest-n1_1011_n2-brit | missing | | |
| 22 | RMSTEST_cl-r3-path-forest-n1_1012_n2-brit | missing | | |
| 23 | RMSTEST_cl-r4-path-forest-n5_1011_n2-brit | missing | | |
| 24 | RMSTEST_cl-r4-path-forest-n5_1012_n2-brit | missing | | |
| 25 | RMSTEST_cl-r5-path-forest-n20_1011_n2-brit | missing | | |
| 26 | RMSTEST_cl-r5-path-forest-n20_1012_n2-brit | missing | | |
| 27 | RMSTEST_cl-r6-path-walls_1011_n2-brit | missing | | |
| 28 | RMSTEST_cl-r6-path-walls_1012_n2-brit | missing | | |

## Notes (fill in)


2026-11-08 (Sonnet run): 14 of 28 saved (maps 1-14: a1-a3, b1-b4, c1, c2 both seeds; all 14 files exist, 11.5-59 KB). Maps 15-28 NOT saved: driver failed 'Save As screen did not load' (line 155) repeatedly, the screen showing the More Content (DLC) page, i.e. a click landed on More Content instead of Editors/Create Scenario, probably when the menu layout shifts. ESC returns to the main menu; failures recur every few maps, and cl-c3-tc-both_1011 failed twice in a row. Map table not filled per row. Label strip not built.
Note 2026-11-09: batch_cl.ps1 failed twice at 'Save As screen did not load' (line 155) on the first unsaved map (c1 1011); no new maps saved.
Note 2026-11-09 (second run): batch_cl.ps1 failed twice (12:31, 12:32) at 'script pick not confirmed: cl-c1-tc-forestzone' (line 69); no new maps saved; 11 of 28 exist (maps 1-10 and 14), 17 missing. screen.py state: editor.
