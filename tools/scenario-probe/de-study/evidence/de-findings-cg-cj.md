# DE's map generator up to the connections: findings from rounds CG to CJ (write-up for the preview, 2026-11-01)

What Age of Empires II DE does that the four earlier write-ups (`de-land-stage.md`, `de-elevation-cliffs.md`,
`de-terrain-stage.md`, `de-connections-objects.md`, all of 2026-10-28) do not yet say, for **whole real scripts**:
the parser, the lands, the elevation and cliff stages, the terrain stage and the connections. In our own words, for
the age-of-rms preview. **Objects (scripted objects and the terrain's own decorations) are left out on purpose**;
they get their own write-up later. Where this document and an earlier write-up disagree, this one is newer and wins
(Section 9 lists the corrections).

## Scope and confidence

- **Build:** DE 101.103.54800.0. Maps generated in the scenario editor (Seed Map, Tiny unless a script overrides it,
  2 players, Team Positions ticked), saved, and read back tile by tile with AoE2ScenarioParser.
- **New evidence:**
  - round CG: 15 real scripts from the corpus at 2 seeds, plus 37 maps on the parser and attributes;
  - round CG's clean re-run: 40 maps made again, one fresh editor each;
  - rounds CH, CI and CJ: 18, 29 and 16 maps, predictions frozen before each run.
- **Result:** **terrain, elevation and layer are exact on all 178 saved maps of rounds CG to CJ**, including all 30
  corpus maps:
  - the 15 corpus scripts: Heart, Battle Lines, Blind Valley, Caverns, Pag, Ra, Namatjira, Bulls_Eyes, Comeer,
    Menindee, Rage Forest, Venn, Immersion, Rekawa and Bazi, each at 2 seeds;
  - the slices of Bulls_Eyes, Rage Forest, Bazi and Ra (each script cut after a stage), and the cuts inside Bazi's
    terrain stage.
- **No regressions:** every earlier round still matches as before, in terrain and in objects (CH 18 of 18, CO 56 of
  61, CF and GP as before, Part 0 95 of 95).
- **Status tags** (as in the earlier write-ups):
  - *Confirmed* means a map predicted before it was made matched this rule and failed the control.
  - *Found after* means the rule was found on maps it now explains, and no blind map has tested it yet.

## 1. Making test maps: the editor carries state between maps

This matters for anyone checking the preview against DE, not for the preview itself.

- **Effect lines persist** from one generated map to the next until the editor is left for the main menu (the
  owner's finding, 2026-10-30). In round CG, Blind Valley's `GAIA_SET_ATTRIBUTE PALMTREE ATTR_TERRAIN_ID 13` still
  held when Namatjira was generated three scripts later, and Namatjira saved with no trees at all.
- **Something else persists too.** u2-forestcliff at seeds 1002 and 1003, generated after scripts with no effects,
  differed on 2,600 to 2,900 tiles from the same seeds generated in a fresh editor. The fresh maps match the model
  completely. What carried over is unknown.
- **So every test map is generated from a fresh editor** (main menu, Editors, Create Scenario). A fresh editor
  starts with Team Positions ticked, 2 players and RANDOM civilizations.
- **The editor's lobby labels** (round CG c7, Tiny, 2 players, no teams, editor defaults):
  - defined: FIXED_POSITIONS, TEAM_POSITIONS, DE_AVAILABLE, DE_GAME_AGE2, DARK_AGE_START, DEFAULT_RESOURCES,
    TINY_MAP, MAPSIZE_TINY, 2_PLAYER_GAME, 0_TEAM_GAME, PLAYER1_TEAM0, AI_PLAYERS;
  - not defined: RANDOM_MAP, TURBO_RANDOM_MAP, LOW_RESOURCES, MEDIUM_RESOURCES, HIGH_RESOURCES, MAPSIZE_MINI,
    1_TEAM_GAME, TEAM0_SIZE2, FULL_TECH_TREE, INFINITE_RESOURCES, REGICIDE, DEATH_MATCH, UP_AVAILABLE,
    UP_EXTENSION.
  - Labels are case-sensitive (`tiny_map` is not TINY_MAP); so are `#define` names.
  - These are the editor's defaults. A real lobby may define others: RANDOM_MAP for a random-map game, the resource
    labels for its setting, and the team labels for its teams. The preview should define the labels of the lobby it
    models, and use this list only for checks against editor maps.

## 2. The parser (whole scripts)

The land write-up's Section 3 gives the parse-time draws. These are the rest of the rules a whole script needs.
Everything here runs before `<LAND_GENERATION>` starts and spends its draws on the one shared stream, in textual
order.

1. **Sections.** Commands before the first section header belong to `<PLAYER_SETUP>`. *Confirmed by real scripts:*
   Caverns and Heart put `override_map_size` there; DE's maps are 144 and 151 tiles, and both match.
2. **Comments.** A token that is exactly `/*` opens a comment and a token that is exactly `*/` closes one. Comments
   nest. *Confirmed* (c8).
3. **`if` / `elseif` / `else` / `endif`.**
   - `if L` and `elseif L` test whether L is a defined label (lobby label, `#define` or `#const` name).
   - **A bare `elseif`, followed directly by something that is not a label (Rage Forest has `elseif` then
     `#const`), acts as `else`.** *Confirmed* (CJ n1; reading the next token as its label fails). Rage Forest's
     pond position depends on it, and with it Rage Forest is exact at both seeds (9,141 and 8,777 tiles before).
   - **Inside a dead branch, `rnd()` still draws**: on command lines and in `#const`. *Confirmed* (c4).
   - **A `start_random` block inside a dead branch is not rolled.** *Confirmed* (c5).
4. **`start_random`.**
   - **The roll is drawn first, then the branches are read in order:** the chosen one live, the others dead, whose
     `rnd()` still draw.
   - **The first branch whose running total of `percent_chance` reaches the roll is taken.**
   - *Confirmed* (c3). This corrects the land write-up, which put the branches' `rnd()` before the roll (Section 9).
5. **`#const`.**
   - **`#const NAME rnd(a,b)` draws once, where it is defined**; every use reads that value. Drawing again at
     every use made Bulls_Eyes much worse.
   - **The first definition of a name wins.** This is AoE2RMSIDE's rule. Replacing with the last changed nothing on
     the corpus, because the repeats there sit in exclusive branches, so it is not decided.
   - `#const` draws even when it redefines nothing.
6. **`rnd(a, b)`** = `a + draw(b − a + 1)`, drawn where it is read.
   - **A constant's name used as a bound reads as 0, and the draw is still spent.** So
     `rnd(-NAME, NAME)` is `rnd(0, 0)`: always 0, one draw. *Confirmed* (CJ n1; reading the constant's value fails).
   - Bulls_Eyes tilts its side lands by `rnd(-VARIANCE_AUX_LAND_DEGREES, VARIANCE_AUX_LAND_DEGREES)`. Of all 125 tilt
     values, only all-zero reproduces DE, and with it Bulls_Eyes is exact at both seeds (1,659 and 1,878 tiles
     before). Spending no draw fails, and so does reading only the `-NAME` bound as 0.
   - **Literal negative bounds work normally:** Bulls_Eyes' `rnd(-10000,10000)` and `rnd(-180,180)`, and Rage
     Forest's `rnd(-10,10)`, are in maps that now match.
7. **Math in parentheses**, `(a op b op c ...)`:
   - **left to right, no precedence** (*confirmed*, c6);
   - each step in 32-bit floats;
   - **`/` is float division** (*confirmed*, CH P);
   - **`%` works on the operands truncated to integers, and the result takes the sign of the left operand** (C-style:
     `0 - 7 % 3` is `(0 - 7) % 3 = -1`). *Confirmed* (CH P; a float modulo and a floored modulo both fail).
   - modulo by 0 gives 0, and division by 0 gives 0 (the guide).
   - Where a command needs an integer, the value is rounded half away from zero (*confirmed*, c6).
8. **Fractions are kept where the command reads a fraction.**
   - **`land_position` percents keep their fraction** (30.3, 50.45 and 70.8; rounding or truncating fails, CH P).
   - **So does `land_percent`** (Bulls_Eyes' 0.9; truncated or rounded is worse).
9. **Undefined names.** A terrain name that is not defined reads as 0. *Found after*, together with AoE2RMSIDE's
   fallback: Bazi's PLACEHOLDER_TERRAIN_A and _B are never defined, so its long placeholder sequences paint 0 over
   0, spending their draws, and Bazi matches.

## 3. Player setup and lands

1. **A `create_land` with no `terrain_type` uses terrain 0** (the content's default terrain), **not the map's
   `base_terrain`**.
   - *Found after* on Bazi, whose two player lands have no `terrain_type`. With the base terrain (41) on their
     origin tiles, the clump growth of the whole terrain stage drifted (terrains 19 and 21 swapped on about 1,400
     tiles, layers on about 4,000).
   - With terrain 0 the land slice, all six terrain-stage cuts and both full maps match. AoE2RMSIDE does the same.
2. **A land assigned to a player who is not in the game is not created** (as before; Section 4 of the land
   write-up).
3. **Several `create_land` commands assigned to the same player each take their own place on the ring**, as extra
   players.
   - **`circle_radius` on such a `create_land` applies as on `create_player_lands`.** *Found after:* Immersion (3
     lands for player 1, 2 for player 2) and Blind Valley place them as 5 players on the circle. Both match at both
     seeds; the model had put them elsewhere before.
4. **`base_layer` on `create_land` is ignored** (round GP, already in the elevation write-up's revision note;
   round CF on three layouts).
5. **A land whose origin search fails** (990 conflicts) goes to the map centre (land write-up, Section 5).
   - Caverns has six of them, and its terrain matches.
   - What those lands do with land-local objects is for the objects write-up.

## 4. Elevation and cliffs

No rule changed. Every corpus map with elevation now matches, among them:
- Bulls_Eyes: `base_elevation` 8, 9 and 10 on many lands, and an elevation command with more clumps than tiles under
  both scale attributes;
- Rage Forest: three variants in one script;
- Bazi's cliffs.

The elevation drifts seen before were the parser (Section 2.6) and the untyped land (3.1), not the elevation model.

## 5. The terrain stage: composites and layers

1. **Composite terrains.** The content pack's `compositeTerrainRules` (33, 34, 36, 38, 39, 43, 44, 61, 62, 103) each
   name a primary and a secondary terrain; for example, 62 is 77 over 60, and 34 is 0 over 32.
   - **In the saved map, a tile painted with a composite (as its terrain or as its layer) holds the primary terrain,
     with the secondary as its layer.** This is applied at the end of the terrain stage, before its beach pass, so a
     resolved 77 can then become BEACH. *Confirmed* (CH C: keeping the composite fails by 867 tiles at both seeds),
     and seen on Ra, Comeer and Rekawa.
   - **Every later step that reads terrain still sees the composite as painted:**
     - **the connections** (5.3 below);
     - **the decoration tables, and the objects:** for the objects write-up; noted here because a preview that
       resolves composites early gets all three wrong.
   - The saved file's resolved values matter only for what is displayed and for the beach pass.
   - A working description that fits every map: keep two values per tile, the painted one, which later stages read,
     and the resolved one, which is shown and used by the beach pass.
   - A tile a connection repaints takes the connection's terrain and is no longer a composite.
2. **Layers at the end** (all *found after* on corpus maps, with the old behaviour failing them):
   - **A beach tile has no layer** (Rekawa, Comeer, Menindee). This is applied after the connections. Shallows keep
     theirs (Menindee's SHALLOW under layer 96). A layer equal to its tile's terrain also stays (Ra's 40, Caverns'
     118).
   - **`terrain_mask 2` painting a tile's own terrain again leaves its layer as it was** (Pag's DIRT under DIRT).
   - **A tile a connection paints loses its layer**, also where the connection's undo gives its terrain back (Pag's
     DLC_NEWSHALLOW from `replace_terrain` under WATER layers).
3. **Connections see composite terrains as painted.**
   - `replace_terrain` and `terrain_cost` given for a composite id apply to tiles painted with that composite, even
     though the saved map shows them resolved.
   - *Confirmed* (CJ k1: reading the resolved terrain fails by 127 and 139 tiles).
   - Ra's `replace_terrain TERR_UNDERBRUSH CENTER_NONBUILDABLE_TERRAIN`, where TERR_UNDERBRUSH is 62, turns those
     tiles into 40; with it Ra 1004 matches (256 tiles before).

## 6. What this changes in the preview (preview-design rev 10)

In order of how many real scripts it touches:

1. **The parser (Section 2):** the bare `elseif`, a name in `rnd()` bounds, `%` and `/`, fractional
   positions and percents, the `start_random` order (roll first), dead branches, commands before the first header.
   Most real scripts use some of these.
2. **Composite terrains (5.1, 5.3):** resolve them only for display and the beach pass; the connections (and later
   the objects and decorations) read the painted composite.
3. **A land with no `terrain_type` gets terrain 0 (3.1).**
4. **Layers at the end of the terrain stage and after the connections (5.2).**
5. **Several assigned lands per player and `circle_radius` on them (3.3).**
6. **Lobby labels (1):** define the labels of the lobby being modelled. For editor-made reference maps, use the
   list in Section 1.
7. **For the DE gate:** reference maps must come from a fresh editor (1). The 28 October Namatjira and u2 files
   are not valid references; the clean ones are in the scenario folder, the old ones in
   `scenario\carryover-2026-10-28\` and `scenario\cf-session-2026-10-28\`.

## 7. Evidence

| Rule | Maps | Status |
|---|---|---|
| bare `elseif` = `else` | Rage Forest (2 + 6 slices), CJ n1 (2) | confirmed |
| name in `rnd()` = 0, draw spent | Bulls_Eyes (2 + 6 slices), CJ n1 (2) | confirmed |
| `%` truncated, float `/`, fractional positions | CH P (2, six controls fail) | confirmed |
| `start_random` roll first; dead branches | c3, c4, c5 | confirmed |
| math left to right, rounding | c6 | confirmed |
| comments nest | c8 | confirmed |
| commands before the first header | Caverns, Heart (4) | found after |
| editor labels | c7 | measured |
| untyped land = terrain 0 | Bazi (2 + 6 slices + 6 cuts) | found after |
| assigned lands as players, `circle_radius` | Immersion, Blind Valley (4) | found after |
| composite resolution at the end | CH C (2), Ra, Comeer, Rekawa | confirmed |
| connections read composites as painted | CJ k1 (2), Ra 1004 | confirmed |
| beach tiles lose their layer | Rekawa, Comeer, Menindee | found after |
| `terrain_mask 2` on the own terrain keeps the layer | Pag | found after |
| connection-painted tiles lose their layer | Pag | found after |
| editor carries state between maps | Namatjira, Immersion, Menindee, u2 (old against fresh) | measured |

Tools: `tests/terrain_all.py` checks terrain, elevation and layer on every saved CG to CJ map; `tests/rms_front.py`
(the parser) and `tests/stage_model.py` carry each rule as a `VAR` default with its control.

## 8. Not tested

Attributes of these sections that no probe and no corpus script uses (checked against AoE2RMSIDE's list of 153 script
words, 2026-11-01):
- **Player setup:** `nomad_resources`, `force_nomad_treaty`, `set_gaia_civilization`, `guard_state`,
  `terrain_state`, `weather_type`. Only in corpus scripts, so passed through but not isolated: `ai_info_map_type`
  and `water_definition`.
- **Lands:** `set_zone_by_team`. Only in corpus scripts: `enable_waves`.
- **Terrain:** `color_correction` only in corpus scripts. It changes the colour, not the tiles.

Untested combinations and settings, from the earlier write-ups and still open:
- **Setup:** `grouped_by_team` with a member without a land, or groups that do not fit; `direct_placement` with
  Team Positions off; nested `start_random`; zones −11 and −12; negative `border_fuzziness`; real lobby teams beyond
  the editor (the stale-alliance tables of the land write-up, 4.8).
- **Sizes:** the corpus was run at Tiny only. Players are tested at 120 to 220; scripts without players up to 252.
- **Terrain:** a mask without `base_terrain`; scaling together with a percentage; the marker-16 water repair (no
  layout fires it); a randomized decoration entry at weight 1000.
- **Elevation and cliffs:** spacing of 256 or more; cliff min > max.
- **Parser:** a repeated `#const` whose second definition is live (Section 2.5); `#include_drs` of a missing file
  (AoE2RMSIDE reads it as nothing).
- **Connections:** connection commands and attributes no saved map uses; a repaint with the same terrain (invisible
  in a finished map).

## 9. Corrections to the earlier write-ups

- **`de-land-stage.md` Section 3:** "Every `rnd()` in every branch of a `start_random` block is drawn before the
  block's roll." Round CG c3 found the opposite: the roll is drawn first, then the branches' `rnd()` in order
  (Section 2.4).
- **`de-land-stage.md`:** a `create_land` without `terrain_type` gets terrain 0, not the base terrain (Section 3.1).
- **`de-terrain-stage.md` and `de-connections-objects.md`:** composites and layer rules as in Section 5.

## 10. Sources and credit

- **Our tests:** `RMS/de-disassembly/tests/`: `results.md` (2026-10-29 to 2026-11-01), the run sheets for CG,
  CG-clean, CH, CI and CJ, and the frozen predictions `*_predictions.pkl`.
- **The owner:** the editor's carry-over of effects, and the `place_on_specific_land_id` rule (for the objects
  write-up).
- **AoE2RMSIDE** (commit 210d977), read through summaries and cached engine files, not copied: its parser rules
  (Section 2) and its default land terrain. Where it disagrees with DE (a name inside `rnd()`, among others), DE's
  maps decided.
