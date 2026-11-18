# DE's terrain stage, measured (write-up for the preview revision, 2026-10-27)

What Age of Empires II DE does in `<TERRAIN_GENERATION>`, in our own words, at the level of detail needed to reproduce its maps tile for tile. It continues `de-land-stage.md` (the generator, the draw notation, the land stage) and `de-elevation-cliffs.md` (elevation, cliffs, the list rules of its Section 2, and the end of the terrain stage in its 5.7). It is written for the age-of-rms preview spec (`docs/preview-design.md` rev 10, Sec.6.4). Section 9 lists where it overturns that spec. No code from any other project is reproduced here; Section 12 says where the first leads came from.

**Revision 2026-10-28 (round GP, Part T and Part X).** 17 more maps, every reading predicted beforehand, all matching the primary reading. They settle: **no beach pass before the first `create_terrain`** (1, 9), flat-only WATER with spacing 0 (4), `base_terrain` with `base_layer` and `terrain_mask 1` with `base_layer` (2), both spacing attributes on one pass and a negative `clumping_factor` (4, 6), a later pass clearing a beach mark (6), `number_of_tiles 0` (2), 9999 clumps (2), and a real-shaped script with 4 players at 200 and 220 (three passes). Section 12 is rewritten. Round CO (2026-10-28) added `beach_terrain` with connections (7).

Round ET also closed most of what the elevation and cliff write-up left open. Those results are summarised in Section 10 and folded into `de-elevation-cliffs.md` (its Section 11).

## Scope and confidence

- **Build:** DE 101.103.54800.0.
- **Instrument:** as before. Maps generated in the scenario editor (Seed Map, the seed typed in, Tiny, 2 players, no teams, Team Positions ticked), saved, and read back with AoE2ScenarioParser: every tile's elevation, terrain and layer, and every cliff object's type, position and facing.
- **Result:** round GP, 17 of 17 terrain-stage maps match (at 120, 200, 220 and 252). Round ET, **44 of 44 maps match tile for tile**, 18 of them on the terrain stage (9 scripts `t1`-`t9`, seeds 1000 and 1001, `tests/probe_et.py`). Every map was predicted before the run (`tests/et-predictions.md`). Together with rounds EC and EC2, 95 of 95 maps past the land stage match.
- **Controls:** every open reading was predicted both ways, and every deliberately wrong control fails its maps, with one planned exception (Section 11). One control was added after the run: a beach pass after each `create_terrain` fails both t7 maps (Section 7).
- **Independent check:** a second implementation written from this text alone (`tests/writeup_check_et.py`) reproduces the 18 terrain maps.
- **Status tags:** as in the earlier write-ups. *Untested* means the rule comes from reading other work, and no DE map exercises it.

Notation as before: `draw(n)` is one bounded draw `⌊n · raw / 2³²⌋` from the shared stream. Tile `(x, y)` is the scenario file's coordinate, and its index is `y · W + x`. "Left" is x − 1, "right" x + 1, "up" y − 1, "down" y + 1. W and H are the map's width and height.

## 1. Where the stage sits, and what it sees

1. The land stage, the elevation stage and the cliff stage, as in the other write-ups.
2. **The terrain stage:** one burned draw, then every `create_terrain` in script order, each one a separate pass (Sections 2 to 6).
3. **The end of the terrain stage** (Section 7): cliff lines restored, the WATER cleanup, beaches.

What a pass sees is the map as the stages before it left it, plus the passes before it:
- **Cliff lines are terrain 16.** They count as "other terrain" for spacing, and a pass with `base_terrain 16` can paint them (Section 7 says what happens to that).
- **Water is not cleaned yet.** The WATER cleanup runs only at the end of the stage.
- **There are no beaches.** No beach pass runs at the end of the land stage (rev 10 already has this from `lh1`) or after a `create_terrain` (Section 7). **Nor just before the first `create_terrain`** (2026-10-28, `gt1-beachfirst`, seeds 1000 and 1001): `create_terrain DIRT { base_terrain BEACH }` beside a WATER band and a BEACH land takes only the BEACH land, never the coast. A pass there would beach 127 and 87 coast tiles that DIRT then takes; both maps refuse it. So the `base_terrain BEACH` idiom finds beach only where a land or an earlier pass painted BEACH.
- **Layers** from the land stage (`base_layer` in `<LAND_GENERATION>`) and from earlier masked passes.
- **Heights** after elevation and smoothing.

*Tested:* t9 (forest keeps its spacing from the cliff lines; DIRT painted on them), t7 (water created and then bordered by a later pass). *Tested (2026-10-27, round CO Part 0):* the burned draw is spent when the script has no `<TERRAIN_GENERATION>` section too. 22 saved maps with grass decorations and no terrain section match object for object; one draw less shifts every decoration.

## 2. One pass: settings

**Amount of tiles** (the target):
- `number_of_tiles N`, default **W** (the map's side: 120 on Tiny).
- A negative N means a percentage: `number_of_tiles −5` is 5 % of the map.
- `land_percent P` means ⌊P · W · H / 100⌋ tiles. Zero or negative gives 0.
- `set_scale_by_size`: a tile count given as a number (not a percentage), when above 0, becomes ⌊N · W · H / 10000⌋.
- `set_scale_by_groups`: the same for the tiles, and the clump count is scaled the same way.
- If both scale lines appear, the later one counts.

**Clumps:** `number_of_clumps`, default 1, capped at 999 (tested 2026-10-28, `gt7-many`: 9999 clumps at 252; uncapped fails by 5,688 tiles).

**`number_of_tiles 0`** still paints the seeds: each clump that finds a seed paints it, and growth stops at once (tested 2026-10-28, `gt6-zero`, seeds 1000 and 1001; a pass that paints nothing fails both).

**The base test** decides which tiles the pass may take. It has a terrain part and a layer part:
- The terrain part applies when `base_terrain B` is given, or when neither `base_terrain` nor `base_layer` is. In that case B is GRASS.
- The layer part applies when `base_layer L` is given, or with `terrain_mask 1`. Without `base_layer`, L is "no layer".
- A tile passes when every part that applies holds: its terrain is B, and its layer is L.

So `base_layer` alone tests only the layer, and with both lines a tile needs both.

**What painting writes** depends on `terrain_mask` (T is the pass's terrain):

| `terrain_mask` | the tile's terrain becomes | its layer becomes | the pass's **target** (terrain, layer) |
|---|---|---|---|
| 0 (default) | T | none | (T, none) |
| 1 | unchanged | T | (B, T) |
| 2 | T | its old terrain | (T, B) |

The target is what a painted tile holds. Section 4 counts it, and the drain in Section 6 matches it. With `terrain_mask 1` the tile keeps its terrain, so later passes still match it by `base_terrain`. With `terrain_mask 2` the old terrain moves under as a layer.

*Tested:* the default W (t2: the guide's 122 fails); negative N as a percentage (t3: reading it as 0 fails); `land_percent` and both scale lines (t3: 200 → 288 tiles and 3 → 4 clumps by groups, 300 → 432 by size); the default base GRASS (t1); `base_layer` alone (t8); both masks with their saved layers (t8: the swapped meanings fail). *Tested 2026-10-28 (`gt3-both`, seeds 1000 and 1001):* `base_terrain` and `base_layer` on one pass need both (the either-one reading fails by 11,774 and 11,771 tiles), and `terrain_mask 1` together with `base_layer`. *Untested:* a mask without `base_terrain`; scaling together with a percentage.

## 3. One pass: the main list and the shuffle

Lists behave as in `de-elevation-cliffs.md` Section 2 (insert by priority goes before the first entry whose number is at least its own). Each pass starts with fresh lists, so the elevation stage's stale-link quirk does not arise.

1. Every tile goes into the **main list** in index order.
2. **Shuffle:** ⌊W · H / 8⌋ times, x = draw(W − 1), then y = draw(H − 1), and tile (x, y) moves to the front of the main list. The last row and the last column are never picked.

The shuffle costs 2 · ⌊W · H / 8⌋ draws (3,600 on Tiny), and it is spent even when the pass has 0 clumps. With 0 clumps nothing else happens.

*Tested:* t1 (picking from all of W, draw(W), fails both maps).

## 4. Eligibility

Every test in Sections 5 and 6 asks for a tile's **eligibility** m. m = 0 means refused.

1. **Height:** m = 0 if the tile's height is outside `height_limits` (inclusive; no limit by default).
2. **Spacing square:** with `spacing_to_other_terrain_types s` > 0, every tile within s in both x and y (a square, clipped to the map) is checked. m = 0 if any of them:
   - has a terrain that is neither B nor the target terrain (when the terrain part of the base test applies);
   - has a layer that is neither L nor the target layer (when the layer part applies);
   - is sloped, on a flat-only pass.
3. **Specific terrains:** when the terrain part of the base test applies, for each `spacing_to_specific_terrain T d` (several may be given; terrain ids of 200 and above are ignored): m = 0 if terrain T is within d in both x and y.
4. Otherwise m = 1 + the number of tiles in the 5 × 5 square around the tile (clipped) that hold the target terrain **and** the target layer.

**Flat-only** comes from `set_flat_terrain_only`, and every pass of WATER (terrain 1) is flat-only without it. A tile is **sloped** when one of its 8 neighbours is exactly one level higher. A neighbour off the map counts as the tile's own height. So a hilltop is flat, and so is a tile next to a two-level step. Flat-only is checked **only inside the spacing square**, so with spacing 0 it does nothing.

*Tested:* `height_limits 1 2` and flat-only with spacing 1 (t6); WATER flat-only by itself (t7: without it both maps fail); the spacing square against two lands (t4) and against cliff lines (t9); two specific terrains on one pass (t4). *Tested 2026-10-28:* flat-only with spacing 0 does nothing (`gt2-flatwater`: `create_terrain WATER` over hills; refusing sloped tiles fails both seeds by 3,325 and 2,111 tiles), which is what most WATER passes in real scripts have. `spacing_to_other_terrain_types` and `spacing_to_specific_terrain` on one pass **both apply**, as two independent conditions (`gt4-spacings`; keeping either one alone fails both seeds).

## 5. Seeds

**Avoidance** (`set_avoid_player_start_areas d`; bare or 0 means 13). Each tile gets a penalty from the player lands' origins. For each origin, take ⌊√(dx² + dy²)⌋ (root in single precision) and add 20 · max(d − that, 0). Cap the sum at 101. Without the attribute every penalty is 0. This is the elevation stage's weight (`de-elevation-cliffs.md` 3.2) with d in place of 13.

**Seed square:** r = max(2 · ⌊√(tiles / clumps)⌋, 2), with the root in single precision and "tiles" the pass's target. This is four times the elevation stage's square.

For each clump in turn:
1. Pop the main list until a tile passes the base test, has m > 0 and, with avoidance, has penalty exactly 0. Refused tiles are gone for this pass.
2. If the main list runs empty, this clump gets no seed and neither does any later one.
3. Otherwise take every tile within r (square, clipped) out of whatever list it is in, the main list or an earlier clump's list.
4. Paint the seed (Section 6).
5. Insert its neighbours (left, up, right, down; only those on the map) into the clump's own list at priority 0. They are not tested here; that waits until they are popped.

Seeds spend no draws.

*Tested:* t1 (the elevation stage's smaller square fails at seed 1001; at 1000 the map is the same either way, as predicted); passes where fewer clumps found a seed than were asked for: t4 (9 to 13 of 20), t5 (9 to 12), t6 (6 to 34 of 200), t7 (56 of 300), t9 (48 of 999).

## 6. Growth and drain

**Growth** runs in rounds over the clumps that got a seed, in clump order. The painted count includes the seeds.

For each clump's turn:
1. If the painted count has reached the target, the pass's growth ends.
2. Pop the clump's list. If it is empty, skip to the next clump.
3. With avoidance: t = draw(100), and the tile is refused if its penalty is above t.
4. Compute m. The tile is refused if m = 0 or it fails the base test.
5. Otherwise paint it.
6. Then take each neighbour in the order left, right, up, down, if it is on the map and passes the base test. Insert it into this clump's list at priority **250 − f · m + p + draw(100)**, where f is `clumping_factor` (default 20), and m and p are the painted tile's eligibility and penalty.
7. Count the tile.

A refused tile still counts as a pop. Growth also ends after a round in which every clump's list was empty.

**Drain.** Then each clump's list, in clump order, is popped until empty. A popped tile that has a left and a right neighbour on the map, both holding the target terrain and target layer, is painted as well. There are no tests and no draws. So a pass usually paints a little more than its target: t1 paints 613 to 620 tiles for a target of 600.

**Painting** writes terrain and layer as in Section 2's table and **spends no decoration draws**. It also marks the tile with the pass's `beach_terrain`, or clears the mark if the pass has none (Section 7 uses the mark).

*Tested:* clumping factors 0, 20 and 40 (t1, t2); avoidance at 13 and 25 (t5); the drain on every map; painting DIRT without its decoration draw (t2: with it both maps fail). *Tested 2026-10-28:* a negative `clumping_factor` goes straight into the formula, so it favours tiles with few painted neighbours (`gt4-spacings`); a later pass without `beach_terrain` clears the mark of the tiles it repaints, which then get plain BEACH (`gt5-beachmark`; keeping the mark fails both seeds by 42 and 29 tiles).

## 7. End of the terrain stage

`de-elevation-cliffs.md` 5.7 describes the three steps, and round ET confirms them with `create_terrain` in the picture:

1. **Every tile a cliff line went through gets its earlier terrain back, whatever the terrain stage painted there.** t9 paints DIRT on the lines (`base_terrain 16`, 461 and 488 tiles), and every one of them is DESERT again in DE's map. The guide's "terrain 16 can be replaced during `<TERRAIN_GENERATION>`" holds while the stage runs but is undone at its end. Reading it as "only tiles still terrain 16 are restored" fails both t9 maps.
2. **The WATER cleanup** runs over everything, including water a `create_terrain WATER` painted (t7).
3. **Beaches.** The 8-neighbour beach rule of 5.7. A beached tile whose mark (Section 6) names a `beach_terrain` gets that terrain instead of BEACH or ICYSHORE. In t7, a DIRT pass with `beach_terrain DLC_BEACH2` around new water leaves 564 and 569 tiles of terrain 51. Ignoring the attribute fails both maps.

**There is no beach pass after each `create_terrain`.** In t7, a pass after the WATER command would beach the DESERT shore before the DIRT pass runs. The DIRT pass (`base_terrain DESERT`) could then not take it, and the end would leave plain BEACH there. That reading changes 562 and 571 tiles. DE matches the model with no pass between commands (checked 2026-10-27 after the run, `tests/results.md`).

*Untested:* `beach_terrain` with a `<CONNECTION_GENERATION>` section (the guide says it stops working); a `beach_terrain` naming water.

## 8. Draw count summary (for checking an implementation)

**Terrain stage:** 1, plus per pass:
- 2 · ⌊W · H / 8⌋ for the shuffle;
- with avoidance, 1 per growth pop;
- 1 per neighbour inserted during growth.

Seeds, refusals without avoidance, the drain and painting cost nothing. On t1 (one FOREST pass of 600 tiles, no avoidance) the stage spends 4,991 draws at seed 1000: 1 + 3,600 + 1,390 inserts.

## 9. What this changes in preview-design (rev 10 Sec.6.4)

**Sec.6.4 Terrains: replace the statistical model with Sections 2 to 6.** They are exact. Specific changes:
- **Budget:** the default is W, the map's side (120 on Tiny), not 122 · dim/120. Growth stops at the target, and the drain adds a few tiles (t1: 13 to 20 on 600). That explains the measured counts just above W (RMSTEST_14's 120.5).
- **Clumping:** the circularity table and the continuous-weight model go. The shape comes from the priority 250 − f · m + p + draw(100) (Section 6), plus the drain.
- **Seeds:** first eligible tiles of a shuffled list, each clearing a square of 2 · ⌊√(tiles / clumps)⌋ around itself. Clumps that find no seed are dropped, and so are all clumps after the first that finds none.
- **Eligible tiles:** the base test (Section 2) agrees with rev 10's conjunction reading of `base_terrain` + `base_layer` (Sec.15 item 27), now tested (gt3). The default base terrain is GRASS.
- **Spacing:** a square, not a distance transform. It is checked per tile against both terrain and layer. Cliff lines count because they are terrain 16 during the stage (tested t9), so the "pinned approximation" is the real rule.
- **Flat-only:** WATER is flat-only by itself, and flat-only acts only inside the spacing square ("only when spacing ≥ 1", as the guide says). "Sloped" means a neighbour exactly one higher.
- **Avoidance:** "≥ d from player origins with mild variance" becomes the penalty of Section 5. Seeds need penalty 0. A growth tile is refused when its penalty beats a draw(100).
- **`terrain_mask`:** rev 10's two meanings are confirmed, saved layers included (t8).
- **Beaches, the largest change:**
  - **The per-command beach pass goes.** DE beaches once, at the end of the terrain stage (Section 7). The pass after S5 is a separate question (RMSTEST_70) and is untouched.
  - **The pass rev 10 keeps before S4's first command goes too** (Sec.15 item 58; gt1, 2026-10-28). DE has none: `create_terrain X { base_terrain BEACH }` finds no beach to take unless an earlier pass or land painted BEACH. The 67 corpus uses of that idiom are affected.
  - **`beach_terrain`** marks the tiles the pass paints, and the end-of-stage rule reads the mark (t7). It is not a pass of its own.
- **Terrain 16 (item 58's other half):** passes see it and can paint it, but every line tile is restored at the end (t9).
- **Uncleaned water (item 58):** passes see the water as the land stage left it, and the WATER cleanup runs after all of them (t7).
- **No decoration draws for painting** (t2).

**Sec.8 (seeded RNG):** the terrain stage continues the same stream after the cliffs. Its draws are complete on every map tested. Connections and objects would be the first stages to show the draws of an absent `<TERRAIN_GENERATION>` section.

**Sec.15 item 42** (both spacing attributes on one pass): settled. Both apply, as independent conditions (gt4, 2026-10-28).

## 10. Round ET Part B: elevation and cliffs (summary)

All 26 maps matched the primary reading. Details are in `de-elevation-cliffs.md` Section 11, and the rules are folded into its Sections 3, 5 and 8.
- **Heights to 10** (e1): the smoothing's lowering branch.
- **Negative `create_elevation −2`** (e2) removes the last two layers.
- **An empty `<ELEVATION_GENERATION>` header** (e3) burns its draw and smooths once.
- **Raised coast tiles** that the late WATER cleanup turns to water keep their height (e4).
- **Coasts:** cliffs beside SHALLOW, ICE and SNOW next to water (e5), and the default `min_terrain_distance` against real water (wc2), both match.
- **`cliff_type` 2, 3 and 4** (ct3-ct5): base objects 1858, 2178 and 2069.
- **Restore draws per base terrain** (gr2-gr5): DIRT 1, GRASS2 15, GRASS3 6 (weight-0 entries are free), FOREST 0. Painting a GRASS land spends none (pg1).
- **`base_layer` before `base_terrain`** (ly2): the layer is dropped.
- **No `base_terrain` line at all** (ly3): the base is GRASS and every unpainted tile carries a GRASS layer, so hills without `base_layer` find nowhere to grow on the base.
- **Scaling at size 200** (sc1): multiplies by 4.

## 11. Round ET: what each terrain map decided

Every reading was predicted before the run. Each pair differed on at least one seed.

| Script | Question | Answer | Rejected reading's result |
|---|---|---|---|
| t1-forest | shuffle bound; seed square | draw(W − 1); 2 · √(tiles/clumps) | draw(W) fails both; the half square fails at 1001 (same map at 1000, as the run sheet said) |
| t2-shape | default tiles; decoration draws for painting | W = 120; none | 122 fails; DIRT's draw fails |
| t3-amounts | negative `number_of_tiles`; scaling | a percentage; both scale lines | 0 fails |
| t4-spacing | spacing square, two specific terrains | one reading, matches | — |
| t5-avoid | avoidance at 13 and 25 | one reading, matches | — |
| t6-height | `height_limits`, flat-only with spacing | one reading, matches | — |
| t7-water | WATER flat-only by itself; `beach_terrain` | yes; used | not flat fails; ignored fails; a beach pass after each command fails by 562 and 571 tiles (control added 2026-10-27) |
| t8-mask | `terrain_mask` 1 and 2; `base_layer` alone | the guide's meanings, layers included | swapped fails |
| t9-cliffs | does a pass on terrain 16 survive? | no: every line tile is restored | "only tiles still 16" fails |

**Surprises worth knowing when writing scripts:**
- **`create_terrain` on cliff lines is wasted.** It paints them while the stage runs, and the end of the stage puts every line tile back.
- **WATER is flat-only only with spacing.** With the default spacing 0 the rule checks nothing, so a plain `create_terrain WATER` ignores slopes (tested gt2).
- **A pass can drop clumps.** When the seed search runs out of tiles (spacing, height limits, avoidance), that clump and every later one vanish, and the rest of the pass grows only from the seeds it found. Its tile target still applies, so the clumps that remain grow larger.
- **Beaches come last.** No beach exists while `create_terrain` runs, not even before the first command (gt1), so passes can take shore tiles, `base_terrain BEACH` finds only painted BEACH, and `beach_terrain` applies to whatever the pass painted that ends up on the coast.
- **Without a `base_terrain` line in `<LAND_GENERATION>`** the unpainted map carries a GRASS layer (ly3). That matters wherever a test reads the layer: `base_layer`, masks, and the count of target tiles (Section 4).

## 12. Not tested

After round GP (2026-10-28), roughly in order of how likely a real script is to hit them:
- **Terrain stage leftovers:** a mask without `base_terrain`; scaling together with a percentage.
- **From the elevation and cliff write-up:** the marker-16 water repair (no layout fires it), decorations at weight 1000 that are randomized.

`beach_terrain` with `<CONNECTION_GENERATION>` was tested in round CO (2026-10-28, `cn8c`): the connections' own shoreline pass leaves the custom beach alone, so the guide's warning that connections break `beach_terrain` does not hold on our build.

## 13. Sources and credit

- **Our tests:** `RMS/de-disassembly/tests/` (archived in `age-of-rms/tools/scenario-probe/de-study/`).
  - `terrain_model.py`, chained by `stage_model.py`, is our own Python model of everything above.
  - `probe_et.py` holds the probe scripts. `run-sheet-et.md` and `et-predictions.md` were written before the run. `compare_ec.py` compares all three rounds.
  - `results.md` (2026-10-19, 2026-10-26, 2026-10-27) holds every result and control.
- **AoE2RMSIDE** (github.com/aoe2control/AoE2RMSIDE, Apache 2.0) gave the first reading of the terrain algorithm. The study restated it and tested it on the 18 terrain maps of round ET and the maps of round GP, with predictions written first, including two points where the scripting guide is wrong: the default amount (W, not 122), and cliff lines restored even where the stage painted them.
- **The scripting guide** gave the attributes and their documented defaults. Where it disagrees with DE, the disagreement is named in the section concerned.
