# Round CG clean re-run: 40 maps, one fresh editor per map (set up 2026-10-30)

**Status: RUN 2026-10-30, all 40 maps saved; COMPARED 2026-10-30 (frozen 3 of 40 identical; see results.md).** For a Claude session (Sonnet) driving the AoE2 DE scenario editor from PowerShell. The owner
starts the game and alt-tabs to it once; everything else is scripted.

## Why

The scenario editor keeps `effect_amount` / `effect_percent` lines from one generated map to the next, until it is
left for the main menu (owner's finding, 2026-10-30). Round CG generated its corpus maps one after another in one
editor, so every map after the first was made with the earlier scripts' effects still set. Example: Blind Valley's
`GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 13` left Namatjira with no trees at all. Modelling the carry-over
reproduces Namatjira's saved object count exactly, so the cause is settled. The 40 affected files were moved to
`scenario\carryover-2026-10-28\` and are not touched again. This run makes clean copies under the old names.

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
  The predictions are frozen separately (`tests\cgclean.py predict`, `cgclean_predictions.pkl`), and `cg_guard.py`
  keeps every compare script blind to these 40 names until then. Opening them in the editor, or reading them with
  Python, breaks the round.
- **Leave the editor for the main menu before every map, including the second seed of the same script.** A script's
  own `effect_percent` lines could otherwise be applied twice.
- Touch nothing in the game folder except what the editor writes. The scripts are already in
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (checked 2026-10-30:
  all 21 present and identical to `tests\`). Do not touch the Ghidra files (`aoe2de.gpr`, `aoe2de.rep`,
  `aoe2de.lock*`) or `scenario\carryover-2026-10-28\`.
- Keep screenshots few and small (the owner's preference): check state with pixel averages (`Get-Avg`) where one
  shot has shown what to expect.

## Tools

- `tools\editor-automation\lib.ps1`: focus, click, wheel, keys, `Save-Shot`, `Get-Avg`, script selection by mouse
  (`Select-ScriptRow (Get-FromEnd <script>)`), `Set-Seed`, `Save-CurrentMap <name> [genWait ms]`.
- `tools\editor-automation\batch_cgclean.ps1`: the driver for this run. Per map it calls `Reset-Editor` (Menu, Quit
  to Main Menu, Yes, Editors, Create Scenario), `Set-Lobby` (Seed Map, Tiny, Team Positions, 2 players, civilizations),
  selects the script, saves a crop of the script label to `cgclean-shots\`, sets the seed, generates and saves. It
  skips maps that already exist, so it can be rerun after a failure. `-Only <text>` limits it to matching names,
  `-Max <n>` to n maps.
- The quirks found in earlier runs are in the memory file `editor-automation-quirks.md` and in the comments of
  `lib.ps1`. The two that matter most:
  - the script list is read when the editor opens, so use the mouse-wheel row method, not type-ahead;
  - Save As loads from the cloud (8 s or more, 25 to 40 s once the folder is large).

## Steps

1. **Calibrate** the coordinates marked `CALIBRATE` in `batch_cgclean.ps1`'s `$CAL` table. Use one `Save-Shot` per
   screen, at scale 0.5 or so, and remember coordinates are in full client pixels (1920 x 991):
   - "Quit to Main Menu" in the menu that `Menu` (1842,18) opens;
   - the Yes button of its confirmation;
   - "Editors" on the main menu;
   - "Create Scenario" on the Editors screen;
   - the Map tab's "Team Positions" tick box (about 807,852);
   - the RANDOM entry in the civilization list.

   Also confirm what a fresh editor starts with: Blank Map at Small. Check whether Team Positions starts unticked,
   because the driver clicks it once. Check the starting number of players and the starting civilization too, then
   adjust `Set-Lobby` so it ends in the right state whatever the start.
2. **Dry run:** `batch_cgclean.ps1 -Max 1` (it makes `RMSTEST_cg-x-heart_1005_n2-brit`). Before Generate, check with
   one shot each:
   - the Map tab: Seed Map ticked, Tiny, Team Positions ticked, `cg-x-heart` in the label, seed 1005;
   - the Players tab: 2 players, both Britons.

   If anything is off, fix the driver, delete only that one new file, and repeat.
3. **Full run:** `batch_cgclean.ps1`. On the first `n2` map (`u2-forestcliff_1004`), check once that both
   civilizations are RANDOM. After the run, look at the label crops in `cgclean-shots\` as one strip
   (`New-Strip`), so every map is seen to have used the right script.
4. Fill in the table below (time, bytes, note) and write any failures or quirks under "Notes". If a script fails to
   generate (an error box, or the map stays blank), save nothing for it and note it. That is a result too.

Order: Heart 1005 first, then the corpus scripts in round CG's order, then the `n2-brit` U maps, then the `n2` maps.
That order is the driver's `$plan`, and `python cgclean.py runs` prints the same list.

## Settings (as round CG)

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked**.
- 2 players, no teams. A fresh editor has everyone Enemy, so no unused slot is allied with anyone.
- Lobby **`n2-brit`**: both players Britons. Lobby **`n2`**: both civilizations left at **RANDOM**.
- Save as `RMSTEST_<script>_<seed>_<lobby>`.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cg-x-heart_1005_n2-brit | 2026-10-30 16:27:55 | 116144 |
| 2 | RMSTEST_cg-x-battlelines_1004_n2-brit | 2026-10-30 16:34:12 | 47905 |
| 3 | RMSTEST_cg-x-battlelines_1005_n2-brit | 2026-10-30 16:35:47 | 48136 |
| 4 | RMSTEST_cg-x-blindvalley_1004_n2-brit | 2026-10-30 16:37:20 | 31771 |
| 5 | RMSTEST_cg-x-blindvalley_1005_n2-brit | 2026-10-30 16:39:04 | 31042 |
| 6 | RMSTEST_cg-x-caverns_1004_n2-brit | 2026-10-30 16:40:37 | 121471 |
| 7 | RMSTEST_cg-x-caverns_1005_n2-brit | 2026-10-30 16:42:09 | 119833 |
| 8 | RMSTEST_cg-x-pag_1004_n2-brit | 2026-10-30 16:43:40 | 19358 |
| 9 | RMSTEST_cg-x-pag_1005_n2-brit | 2026-10-30 16:45:13 | 17748 |
| 10 | RMSTEST_cg-x-ra_1004_n2-brit | 2026-10-30 16:46:54 | 106534 |
| 11 | RMSTEST_cg-x-ra_1005_n2-brit | 2026-10-30 16:48:33 | 93557 |
| 12 | RMSTEST_cg-x-namatjira_1004_n2-brit | 2026-10-30 16:50:08 | 26814 |
| 13 | RMSTEST_cg-x-namatjira_1005_n2-brit | 2026-10-30 16:51:44 | 26585 |
| 14 | RMSTEST_cg-x-bullseyes_1004_n2-brit | 2026-10-30 16:53:17 | 25568 |
| 15 | RMSTEST_cg-x-bullseyes_1005_n2-brit | 2026-10-30 16:54:49 | 25186 |
| 16 | RMSTEST_cg-x-comeer_1004_n2-brit | 2026-10-30 16:56:23 | 58965 |
| 17 | RMSTEST_cg-x-comeer_1005_n2-brit | 2026-10-30 16:57:59 | 57659 |
| 18 | RMSTEST_cg-x-menindee_1004_n2-brit | 2026-10-30 16:59:36 | 39299 |
| 19 | RMSTEST_cg-x-menindee_1005_n2-brit | 2026-10-30 17:01:15 | 39824 |
| 20 | RMSTEST_cg-x-rageforest_1004_n2-brit | 2026-10-30 17:02:56 | 99055 |
| 21 | RMSTEST_cg-x-rageforest_1005_n2-brit | 2026-10-30 17:04:36 | 93288 |
| 22 | RMSTEST_cg-x-venn_1004_n2-brit | 2026-10-30 17:06:15 | 62328 |
| 23 | RMSTEST_cg-x-venn_1005_n2-brit | 2026-10-30 17:07:55 | 62681 |
| 24 | RMSTEST_cg-x-immersion_1004_n2-brit | 2026-10-30 17:09:28 | 19994 |
| 25 | RMSTEST_cg-x-immersion_1005_n2-brit | 2026-10-30 17:11:00 | 19940 |
| 26 | RMSTEST_cg-x-rekawa_1004_n2-brit | 2026-10-30 17:12:44 | 74064 |
| 27 | RMSTEST_cg-x-rekawa_1005_n2-brit | 2026-10-30 17:14:28 | 74025 |
| 28 | RMSTEST_cg-x-bazi_1004_n2-brit | 2026-10-30 17:16:26 | 81952 | slow: about 25 s to generate |
| 29 | RMSTEST_cg-x-bazi_1005_n2-brit | 2026-10-30 17:18:24 | 82512 | slow |
| 30 | RMSTEST_u6-walls_1004_n2-brit | 2026-10-30 17:19:57 | 10778 |
| 31 | RMSTEST_u6-walls_1005_n2-brit | 2026-10-30 17:21:31 | 10889 |
| 32 | RMSTEST_u7-path_1004_n2-brit | 2026-10-30 17:23:04 | 45945 |
| 33 | RMSTEST_u7-path_1005_n2-brit | 2026-10-30 17:24:36 | 46597 |
| 34 | RMSTEST_ob13-walls_1004_n2-brit | 2026-10-30 17:26:07 | 9524 |
| 35 | RMSTEST_u2-forestcliff_1004_n2 | 2026-10-30 17:27:27 | 24787 | civilizations RANDOM |
| 36 | RMSTEST_u2-forestcliff_1005_n2 | 2026-10-30 17:28:48 | 25032 |
| 37 | RMSTEST_u4-force_1004_n2 | 2026-10-30 17:30:08 | 12779 |
| 38 | RMSTEST_u4-force_1005_n2 | 2026-10-30 17:31:27 | 12140 |
| 39 | RMSTEST_ob5-zones_1004_n2 | 2026-10-30 17:32:47 | 22953 |
| 40 | RMSTEST_c7-labels_1004_n2 | 2026-10-30 17:34:08 | 11557 |

## Notes (fill in)

- Run 2026-10-30 16:27 to 17:34 by Claude (Sonnet). All 40 saved, none opened or parsed; label crops (`tools\editor-automation\cgclean-shots\`) viewed as one strip: every map used the intended script, in plan order. Civilizations checked after the last n2 map: both players RANDOM.
- Calibrated: Quit to Main Menu (960,375), Yes (812,563), Editors (416,764), Create Scenario (1204,850).
- A fresh editor already has Team Positions ticked, 2 players and RANDOM civilizations. The sheet's assumption (click Team Positions, set players) was wrong; the driver no longer does either. Dry run map 1 checked by shot: Seed Map, Tiny, Team Positions ticked, cg-x-heart, seed 1005, 2 players, both Britons.
- First attempt failed at map 2: the reset clicks ran too fast, the game landed on More Content and the Steam overlay opened. Nothing was saved for it. Waits lengthened (12 s after Yes, 9 s after Editors, 14 s after Create Scenario); no further failures. Also fixed a PowerShell array-flattening bug in `$plan`.
- Per map about 95 s; Bazi generated in about 52 s total save time.
- Heart 1004 was not in this run (its original file was already clean).
