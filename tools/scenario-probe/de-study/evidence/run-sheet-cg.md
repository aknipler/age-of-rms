# Round CG run sheet: corpus maps, confirmations, the parser (65 + 2 maps, set up 2026-10-28)

**Status: ready to run.** Scripts come from `probe_cg.py` (`python probe_cg.py write` writes them; `python probe_cg.py runs`
prints the 65 file names in this sheet's order).

**Predictions are not written yet, by choice.** The editor session saves the maps while the models are finished. The
predictions are then written from the finished models and frozen (`cg_predictions.pkl` and `cg-predictions.md`,
timestamped) **before any saved CG map is read**. Nobody opens or parses a CG map until then. The editor session
only saves files and must not inspect their contents.

## Setup (as in rounds CO and CF)

1. Copy these 23 scripts from `tests\` into
   `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`. Nothing else in the
   game folder is touched:
   - the 15 corpus copies `cg-x-*.rms`;
   - `c1-randomciv`, `c2-gaiabuild`, `c3-randorder`, `c4-deadrnd`, `c5-deadrandom`, `c6-math`, `c7-labels`,
     `c8-comments` (`.rms`).

   Part U reuses `u1`-`u7`, `u9` and `ob5`, `ob7`, `ob8`, `ob10`, `ob13`, which should already be there from rounds CO
   and CF. Copy them from `tests\` if not.
2. Scenario editor, **Map size Tiny**, **Team Positions ticked**, **every unused slot allied with nobody**, Seed Map
   ticked with the seed typed in.
3. **Lobbies:**
   - `n2-brit`: 2 players, no teams, both Britons;
   - `n2`: 2 players, no teams, civilizations left at **RANDOM** (c1 depends on this).

   Set civilizations in the Players tab **before** generating.
4. Save as `RMSTEST_<script>_<seed>_<lobby>`, for example `RMSTEST_cg-x-caverns_1004_n2-brit`.
5. If a script fails to generate (an error box, or the map stays blank), save nothing for it and note it in the
   list at the end. That is a result too.

The two corpus scripts that include files (`cg-x-bazi`, `cg-x-rageforest`) use DE's own
`drs\gamedata_x2\includes\*.inc`, which are already in the game folder.

Priority if time is short: Part X (both seeds), then K and P, then U.

## Part X: corpus maps (30 maps)

Each corpus script at seeds 1004 and 1005, lobby `n2-brit`:

| Script | Corpus file (age-of-rms `test-maps\`) |
|---|---|
| cg-x-heart | 24hr_A Heart Map |
| cg-x-battlelines | 24hr_Battle Lines 1.0 |
| cg-x-bazi | 24hr_Bazi is God |
| cg-x-blindvalley | 24hr_Blind Valley |
| cg-x-caverns | 24hr_Caverns |
| cg-x-pag | AD4 - Pag - v1.2 |
| cg-x-ra | AD4 - Ra |
| cg-x-namatjira | AK_Namatjira |
| cg-x-bullseyes | Bulls_Eyes |
| cg-x-comeer | Comeer v1.5 |
| cg-x-menindee | Menindee_AUS_v2.3 |
| cg-x-rageforest | Rage Forest 2026 |
| cg-x-venn | Venn |
| cg-x-immersion | W4 - Immersion |
| cg-x-rekawa | BCC2-Rekawa (`test-maps\broken\`) |

**Rekawa:** age-of-rms filed it under `broken\` for a brace glued to a number (`}8050`), but the copy there has no
glued brace any more (checked 2026-10-28: every `{` and `}` in the file stands apart). So only one version is run.
If the original with the glued brace turns up, add it as `cg-x-rekawa-glued`.

## Part K: the two rules found after round CF (4 maps)

| Script | Lobby, seeds | Rule (main reading) | Control |
|---|---|---|---|
| c1-randomciv | **n2 (RANDOM civs)**; 1004, 1005 | per-player GOLD, DEER, STONE, FORAGE and BOAR without `set_gaia_object_only` are not placed (their draws are spent); TURKEY and SHEEP are, player-owned; the gaia GOLD and the frameless DEER are | `+random-civ-gaia` |
| c2-gaiabuild | n2-brit; 1004, 1005 | gaia BARRACKS, MARKET, MONASTERY, MILL and CASTLE paint no foundation; the players' TC, BARRACKS and MILL do | `+gaia-foundation` |

## Part P: the parser (10 maps)

| Script | Lobby, seeds | Question | Readings |
|---|---|---|---|
| c3-randorder | n2; 1004, 1005, 1006 | a `start_random` block with `rnd()` in both branches: is the roll drawn before the branches' `rnd()` (AoE2RMSIDE) or after (our land write-up)? Which land exists shows the roll; the positions show the rest | roll first / rnd first |
| c4-deadrnd | n2; 1004, 1005 | `rnd()` on a command line and in a `#const`, inside a dead `if` branch | drawn (AoE2RMSIDE) / not drawn |
| c5-deadrandom | n2; 1004, 1005 | a `start_random` block inside a dead `if` branch | not rolled (AoE2RMSIDE) / rolled |
| c6-math | n2; 1004 | `(10 + 20 * 2)`, `(7 / 2 * 10)`, `(100 / 3)`, `base_size (5 / 2)`, a `#const` holding `(A * 2)` with A = 2.5 | left to right, floats, rounded half up where an integer is needed (the guide) / with precedence / truncated |
| c7-labels | n2; 1004 | which lobby labels the editor defines: 28 labels, one 3 × 3 land each, DESERT if defined and SNOW if not. Includes a lower-case `tiny_map` and a `#define lower_define` tested as `LOWER_DEFINE` (case) | observation |
| c8-comments | n2; 1004 | a land after a comment on the same line, after a nested comment, a comment inside a command, a land inside a multi-line comment, a land before a trailing comment | observation (the guide: all but FOREST exist) |

## Part U: fresh seeds for the measured attributes (21 maps)

At seeds 1004 and 1005: `u1-actor` (n2-brit), `u2-forestcliff` (n2), `u3-lands` (n2), `u4-force` (n2),
`u5-minconn` (n2), `u6-walls` (n2-brit), `u7-path` (n2-brit), `u9-layer` (n2).

At seed 1004 only: `ob5-zones` (n2), `ob7-actor` (n2), `ob8-lands` (n2), `ob10-misc` (n2), `ob13-walls` (n2-brit).

These attributes get modelled from AoE2RMSIDE (restated) while the maps are saved, and checked against both these
fresh seeds and the round CO/CF maps.

## File names (65)

From `python probe_cg.py runs`, in order: Part X (30), Part K (4), Part P (10), Part U (21).

```
RMSTEST_cg-x-heart_1004_n2-brit
RMSTEST_cg-x-heart_1005_n2-brit
RMSTEST_cg-x-battlelines_1004_n2-brit
RMSTEST_cg-x-battlelines_1005_n2-brit
RMSTEST_cg-x-bazi_1004_n2-brit
RMSTEST_cg-x-bazi_1005_n2-brit
RMSTEST_cg-x-blindvalley_1004_n2-brit
RMSTEST_cg-x-blindvalley_1005_n2-brit
RMSTEST_cg-x-caverns_1004_n2-brit
RMSTEST_cg-x-caverns_1005_n2-brit
RMSTEST_cg-x-pag_1004_n2-brit
RMSTEST_cg-x-pag_1005_n2-brit
RMSTEST_cg-x-ra_1004_n2-brit
RMSTEST_cg-x-ra_1005_n2-brit
RMSTEST_cg-x-namatjira_1004_n2-brit
RMSTEST_cg-x-namatjira_1005_n2-brit
RMSTEST_cg-x-bullseyes_1004_n2-brit
RMSTEST_cg-x-bullseyes_1005_n2-brit
RMSTEST_cg-x-comeer_1004_n2-brit
RMSTEST_cg-x-comeer_1005_n2-brit
RMSTEST_cg-x-menindee_1004_n2-brit
RMSTEST_cg-x-menindee_1005_n2-brit
RMSTEST_cg-x-rageforest_1004_n2-brit
RMSTEST_cg-x-rageforest_1005_n2-brit
RMSTEST_cg-x-venn_1004_n2-brit
RMSTEST_cg-x-venn_1005_n2-brit
RMSTEST_cg-x-immersion_1004_n2-brit
RMSTEST_cg-x-immersion_1005_n2-brit
RMSTEST_cg-x-rekawa_1004_n2-brit
RMSTEST_cg-x-rekawa_1005_n2-brit
RMSTEST_c1-randomciv_1004_n2
RMSTEST_c1-randomciv_1005_n2
RMSTEST_c2-gaiabuild_1004_n2-brit
RMSTEST_c2-gaiabuild_1005_n2-brit
RMSTEST_c3-randorder_1004_n2
RMSTEST_c3-randorder_1005_n2
RMSTEST_c3-randorder_1006_n2
RMSTEST_c4-deadrnd_1004_n2
RMSTEST_c4-deadrnd_1005_n2
RMSTEST_c5-deadrandom_1004_n2
RMSTEST_c5-deadrandom_1005_n2
RMSTEST_c6-math_1004_n2
RMSTEST_c7-labels_1004_n2
RMSTEST_c8-comments_1004_n2
RMSTEST_u1-actor_1004_n2-brit
RMSTEST_u1-actor_1005_n2-brit
RMSTEST_u2-forestcliff_1004_n2
RMSTEST_u2-forestcliff_1005_n2
RMSTEST_u3-lands_1004_n2
RMSTEST_u3-lands_1005_n2
RMSTEST_u4-force_1004_n2
RMSTEST_u4-force_1005_n2
RMSTEST_u5-minconn_1004_n2
RMSTEST_u5-minconn_1005_n2
RMSTEST_u6-walls_1004_n2-brit
RMSTEST_u6-walls_1005_n2-brit
RMSTEST_u7-path_1004_n2-brit
RMSTEST_u7-path_1005_n2-brit
RMSTEST_u9-layer_1004_n2
RMSTEST_u9-layer_1005_n2
RMSTEST_ob5-zones_1004_n2
RMSTEST_ob7-actor_1004_n2
RMSTEST_ob8-lands_1004_n2
RMSTEST_ob10-misc_1004_n2
RMSTEST_ob13-walls_1004_n2-brit
```

## Added after hand-over: c9 (2 maps, run last)

`c9-foundation`, lobby `n2-brit`, seeds 1004 and 1005: copy `c9-foundation.rms` like the others. Player and gaia
buildings on GRASS, a terrain their foundation can take. It decides whether any scripted building paints its
foundation in the saved map (none does on any map so far; round CF's "only gaia buildings skip it" fails u1).
Save as `RMSTEST_c9-foundation_1004_n2-brit` and `RMSTEST_c9-foundation_1005_n2-brit`.

## Failures and notes from the run

Run 2026-10-28, 20:05 to 20:38 (editor part), all 67 maps saved (65 plus the two c9 maps). No map was opened or read.
No script failed to generate. Every script label was checked against a crop of the dropdown after selection.

- The n2-brit lobby (both players Britons) was run first, then n2 (both players on Random), then c9 in n2-brit again
  after the editor was restarted for the new script. Diplomacy was left as the editor's default for 2 players (Player 2
  enemy of 1); no unused slot is allied with anyone.
- **cg-x-bazi**: the first two attempts failed to save. Bazi's generation takes longer than the 2.5 s the driver waited,
  so the menu click was lost. Rerun with a 25 s wait; saved at 54 s and 55 s. Both files are 82500 bytes, the same size
  at two seeds, which no other pair shows. Not read, but worth knowing when they are first opened.
- **ob8-lands_1004_n2**: the first save (after four focus failures) was 2751 bytes and its label crop showed the wrong
  screen. It was deleted and redone (11416 bytes, label correct). The four maps that failed on "could not focus the
  game" (u9-layer 1004 and 1005, ob5-zones, ob7-actor) were rerun and saved normally.
- The game exited once between sessions and was relaunched through Steam; scripts and the editor setup were redone.
- Save As slowed as the scenario folder grew (about 520 maps): 25 to 40 s per map overall, longer on the load of the
  list.
- The editor's script list is cached at editor start, so the 15 `cg-x-*` and `c1`-`c8` scripts needed one editor
  restart before they appeared, and c9 another.
- The probe's `runs` list now prints 67 names, not 65, because c9 was added to `probe_cg.py` after the sheet was set up.

