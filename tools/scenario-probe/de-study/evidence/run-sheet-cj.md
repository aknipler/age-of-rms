# Round CJ run sheet: confirming round CI's findings, and Bazi's terrain stage (16 maps, set up 2026-10-31)

**Status: RUN 2026-10-31, 16 maps saved; COMPARED (frozen 6 of 16 identical; see results.md).** For a Claude session (Sonnet) driving the AoE2 DE scenario editor from PowerShell. The game
is open at the main menu.

Scripts come from `probe_cj.py` (`python probe_cj.py write` writes them; `python probe_cj.py runs` prints the 16 file
names in this sheet's order). **Predictions are frozen before any map is saved** (`cj_predictions.pkl`). The session
only saves files and never opens or reads them.

## Why

Round CI's slices showed where each open map parts from DE, and the data then gave five rules:
- `rnd()` with a constant's name reads as 0 (Bulls_Eyes now exact in terrain, elevation and layer);
- a bare `elseif` acts as `else` (Rage Forest now exact);
- connections see composite terrains as painted (Ra 1004 now exact);
- objects see a composite layer's tile as painted (Rekawa: +785 objects);
- `place_on_specific_land_id` keeps off lands with another explicit `land_id` (a reading for Namatjira; not the
  model's default).

The parts:
- **N, K, L** confirm those rules on fresh layouts, each with the old behaviour as a control.
- **B** cuts Bazi's terrain stage after the 5th, 14th, 23rd, 32nd, 37th and 38th command, each with a small DESERT
  marker clump, to find where its draw stream drifts.
- **R** is Rekawa's terrain slice, to see its decorations without objects.

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
- **Leave the editor for the main menu before every map, including the second seed of the same script.** The editor
  keeps effect lines from one generation to the next.
- The 11 `cj-*.rms` scripts are already in
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Touch nothing else in
  the game folder. Do not touch `scenario\carryover-2026-10-28\`, the Ghidra files, or any Python in `tests\`.
- Keep screenshots few and small.
- If a step fails twice, stop, save a shot, write what happened under Notes, and report.

## Tools

- `tools\editor-automation\batch_cj.ps1`, the driver for this run (the same as round CI's, with this round's plan):
  - per map: quit to the main menu, Editors, Create Scenario, Seed Map, Tiny, both civilizations Britons, pick the
    script, save a crop of its label to `cj-shots\`, set the seed, generate and save;
  - `-FromMainMenu` skips the quit steps for the first map;
  - it skips maps that already exist; `-Only <text>` and `-Max <n>` limit it.
- Round CI's notes (`run-sheet-ci.md`) describe what to expect: the first Create Scenario click once landed too early,
  and a rerun from the main menu fixed it.

## Steps

1. Dry run: `batch_cj.ps1 -FromMainMenu -Max 1` (makes `RMSTEST_cj-n1-parser_1007_n2-brit`). Check the label crop.
2. Full run: `batch_cj.ps1`.
3. View the label crops in `cj-shots\` as one strip (`New-Strip`) to confirm every map used the right script.
4. Fill in the table and the Notes. If a script fails to generate (an error box, or the map stays blank), save
   nothing for it and note it. That is a result too.

## Settings

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked** (a fresh editor has it).
- 2 players, no teams, **both Britons** (lobby `n2-brit`).
- Save as `RMSTEST_<script>_<seed>_n2-brit`.
- Seeds: parts N, K and L use 1007 and 1008; the Bazi cuts use 1004; Rekawa's slice uses 1004 and 1005.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cj-n1-parser_1007_n2-brit | 2026-10-31 20:58:34 | 10997 | |
| 2 | RMSTEST_cj-n1-parser_1008_n2-brit | 2026-10-31 21:03:08 | 10912 | |
| 3 | RMSTEST_cj-k1-compconn_1007_n2-brit | 2026-10-31 21:04:45 | 10234 | |
| 4 | RMSTEST_cj-k1-compconn_1008_n2-brit | 2026-10-31 21:06:23 | 10712 | |
| 5 | RMSTEST_cj-k2-complayer_1007_n2-brit | 2026-10-31 21:08:00 | 14597 | |
| 6 | RMSTEST_cj-k2-complayer_1008_n2-brit | 2026-10-31 21:09:37 | 15162 | |
| 7 | RMSTEST_cj-l1-otherids_1007_n2-brit | 2026-10-31 21:11:14 | 1993 | |
| 8 | RMSTEST_cj-l1-otherids_1008_n2-brit | 2026-10-31 21:12:50 | 1997 | |
| 9 | RMSTEST_cj-b05-bazi_1004_n2-brit | 2026-10-31 21:14:42 | 45320 | slow |
| 10 | RMSTEST_cj-b14-bazi_1004_n2-brit | 2026-10-31 21:16:38 | 45717 | slow |
| 11 | RMSTEST_cj-b23-bazi_1004_n2-brit | 2026-10-31 21:18:36 | 46240 | slow |
| 12 | RMSTEST_cj-b32-bazi_1004_n2-brit | 2026-10-31 21:20:34 | 49980 | slow |
| 13 | RMSTEST_cj-b37-bazi_1004_n2-brit | 2026-10-31 21:22:39 | 51749 | slow |
| 14 | RMSTEST_cj-b38-bazi_1004_n2-brit | 2026-10-31 21:24:42 | 51756 | slow |
| 15 | RMSTEST_cj-r1-rekawa_1004_n2-brit | 2026-10-31 21:26:28 | 19108 | |
| 16 | RMSTEST_cj-r1-rekawa_1005_n2-brit | 2026-10-31 21:28:13 | 19389 | |

## Notes (fill in)


- All 16 saved. Label strip (cj-shots\strip.png) shows every map used the right script. Sizes plausible; l1-otherids is small (about 2 KB) in both seeds, the others 10-52 KB.
- Dry run first failed (Save As screen did not load): a Steam overlay had opened, and the game was left on the More Content screen. Closed the overlay, went back to the main menu, rerun saved map 1.
- The first two full-run attempts exited at once because batch_cj.log was locked by a tail monitor I had started on it (not a game problem). After killing it the full run went through, 1.5 min per map, Bazi cuts 46-59 s generation.
- Maps were not opened or inspected.

