# Round CI run sheet: where the open corpus maps part from DE, and three object rules (29 maps, set up 2026-10-31)

**Status: RUN and COMPARED 2026-10-31 (frozen 9 of 29 identical; see results.md).** For a Claude session (Sonnet) driving the AoE2 DE scenario editor from PowerShell. The game
is open at the main menu.

Scripts come from `probe_ci.py` (`python probe_ci.py write` writes them; `python probe_ci.py runs` prints the 29 file
names in this sheet's order). **Predictions are frozen before any map is saved** (`ci_predictions.pkl`); the session
only saves files and never opens or reads them.

## Why

After round CG's clean re-run, these maps still differ:
- **Land drift:** Bulls_Eyes and Rage Forest place lands from `#const` sine/cosine math. Terrain differs on 1,659 and
  9,141 tiles, elevation on 319 and 4,326. The lands' own terrain matches; forest clumps and heights don't.
- **Bazi:** terrains 19/21 swapped on about 1,400 tiles, elevation on 747 at 1004.
- **Ra 1004:** 167 tiles where the model has 77 over 60 and DE has 40.

Part S cuts each of these scripts after a stage, so the first slice that differs shows the stage where the model and
DE part. Parts F, R and P test three object rules found on the clean maps:
- **F, failed lands:** a land whose origin search runs out of tries takes no `place_on_specific_land_id` objects
  (Caverns).
- **R, missing facing data:** objects with no facing data in the content pack get a random facet over their graphic's
  4 angles. This fixed most of Caverns' and Blind Valley's facings.
- **P, own land:** `place_on_specific_land_id` stays on its land's zone (Namatjira's forest palms).

Part M measures Rekawa's terrain makers (a fill of resized, foundation-painting placeholders), where DE holds 785 more
than the model.

## Rules for the session

- **Do not open, parse or inspect the saved maps.** Check only that each file exists and has a plausible size.
- **Leave the editor for the main menu before every map, including the second seed of the same script.** The editor
  keeps effect lines from one generation to the next, and Bazi and Rage Forest have effects.
- The 16 `ci-*.rms` scripts are already in
  `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Touch nothing else in
  the game folder. Do not touch `scenario\carryover-2026-10-28\`, the Ghidra files, or any Python in `tests\`.
- Keep screenshots few and small. Check state with pixel averages (`Get-Avg`) once a shot has shown what to expect.
- If a step fails twice, stop, save a shot, write what happened under Notes, and report.

## Tools

- `tools\editor-automation\batch_ci.ps1`, the driver for this run:
  - per map: quit to the main menu, Editors, Create Scenario, Seed Map, Tiny, both civilizations Britons, pick the
    script, save a crop of its label to `ci-shots\`, set the seed, generate and save;
  - `-FromMainMenu` skips the quit steps for the first map; the game starts at the main menu;
  - it skips maps that already exist, so it can be rerun after a failure; `-Only <text>` and `-Max <n>` limit it;
  - its coordinates and waits were calibrated by the clean re-run's session on 2026-10-30.
- `tools\editor-automation\lib.ps1`: the helpers.
- The memory file `editor-automation-quirks.md` and `run-sheet-cgclean.md`'s notes describe the quirks:
  - a fresh editor already has Team Positions ticked, 2 players and RANDOM civilizations;
  - the quit and reset clicks need the long waits the driver has.

## Steps

1. Dry run: `batch_ci.ps1 -FromMainMenu -Max 1` (makes `RMSTEST_ci-sl-bullseyes_1004_n2-brit`). Before it generates,
   check with one small shot each:
   - the Map tab: Seed Map ticked, Tiny, Team Positions ticked, `ci-sl-bullseyes` in the label, seed 1004;
   - the Players tab: 2 players, both Britons.

   If something is off, fix the driver, delete only that new file, and repeat.
2. Full run: `batch_ci.ps1` (without `-FromMainMenu`, since the game is now in the editor).
3. After the run, view the label crops in `ci-shots\` as one strip (`New-Strip`) to confirm every map used the right
   script.
4. Fill in the table and the Notes below. If a script fails to generate (an error box, or the map stays blank), save
   nothing for it and note it. That is a result too.

## Settings

- Map size **Tiny**, **Seed Map** ticked with the seed typed in, **Team Positions ticked**.
- 2 players, no teams, **both Britons** (lobby `n2-brit`).
- Save as `RMSTEST_<script>_<seed>_n2-brit`.
- Seeds: the slices use 1004 and 1005, the seeds of the corpus maps they come from; Ra uses 1004 only. Parts F, R,
  P and M use 1007 and 1008.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_ci-sl-bullseyes_1004_n2-brit | | | |
| 2 | RMSTEST_ci-sl-bullseyes_1005_n2-brit | | | |
| 3 | RMSTEST_ci-se-bullseyes_1004_n2-brit | | | |
| 4 | RMSTEST_ci-se-bullseyes_1005_n2-brit | | | |
| 5 | RMSTEST_ci-st-bullseyes_1004_n2-brit | | | |
| 6 | RMSTEST_ci-st-bullseyes_1005_n2-brit | | | |
| 7 | RMSTEST_ci-sl-rageforest_1004_n2-brit | | | |
| 8 | RMSTEST_ci-sl-rageforest_1005_n2-brit | | | |
| 9 | RMSTEST_ci-se-rageforest_1004_n2-brit | | | |
| 10 | RMSTEST_ci-se-rageforest_1005_n2-brit | | | |
| 11 | RMSTEST_ci-st-rageforest_1004_n2-brit | | | |
| 12 | RMSTEST_ci-st-rageforest_1005_n2-brit | | | |
| 13 | RMSTEST_ci-sl-bazi_1004_n2-brit | | | slow |
| 14 | RMSTEST_ci-sl-bazi_1005_n2-brit | | | slow |
| 15 | RMSTEST_ci-se-bazi_1004_n2-brit | | | slow |
| 16 | RMSTEST_ci-se-bazi_1005_n2-brit | | | slow |
| 17 | RMSTEST_ci-st-bazi_1004_n2-brit | | | slow |
| 18 | RMSTEST_ci-st-bazi_1005_n2-brit | | | slow |
| 19 | RMSTEST_ci-sl-ra_1004_n2-brit | | | |
| 20 | RMSTEST_ci-se-ra_1004_n2-brit | | | |
| 21 | RMSTEST_ci-st-ra_1004_n2-brit | | | |
| 22 | RMSTEST_ci-f1-failedlands_1007_n2-brit | | | |
| 23 | RMSTEST_ci-f1-failedlands_1008_n2-brit | | | |
| 24 | RMSTEST_ci-r1-noprofile_1007_n2-brit | | | |
| 25 | RMSTEST_ci-r1-noprofile_1008_n2-brit | | | |
| 26 | RMSTEST_ci-p1-ownland_1007_n2-brit | | | |
| 27 | RMSTEST_ci-p1-ownland_1008_n2-brit | | | |
| 28 | RMSTEST_ci-m1-maketerrain_1007_n2-brit | | | |
| 29 | RMSTEST_ci-m1-maketerrain_1008_n2-brit | | | |

## Notes (fill in)

**Run 2026-10-31 (Sonnet session), all 29 maps saved**, none opened or read. Sizes and times are in `tools/editor-automation/batch_ci.log`
(smallest: p1-ownland 1,988-1,995 bytes; largest: st-ra 84,720; Bazi 50-56 kB; slow scripts took 37-54 s to save).
- First attempt failed: the Create Scenario click landed too early and the editor stayed on the Load Scenario screen, so nothing
  was saved. I returned to the main menu by hand and reran; the retry worked with no driver change.
- The driver has no pause before generating, so the Map/Players tab checks of step 1 were not made by screenshot. The label
  crop of map 1 and the strip of all 29 crops (`ci-shots\strip.png`) show the right script for every map, in order.
