# The DE study archive

The evidence behind `docs/preview-design.md` rev 9 and rev 10, and behind the revisions still to come. Between
2026-10-09 and 2026-10-28 black-box tests were run on Age of Empires II DE's map generator. Each probe script was
generated in the scenario editor at a typed seed, the map was saved, and every tile and object was read back and
compared with a prediction written before the run. That found the game's random number generator, the order of its
draws, and the rules of the land, elevation, cliff and terrain stages, tile for tile, and most of the connection and
object stages. The study lived in a folder outside this repo, which is expected to be deleted, so its probes and its
saved maps are kept here, with the six stage write-ups in `evidence/`. The run sheets, predictions, results log and
small data files left the repo on 2026-11-18 to keep it light and are kept with the study, so the run sheet and
results names below are theirs. The preview's DE gates (`src/preview/__tests__/de*Maps.test.ts`) hold the
preview to the land maps and the maps of rounds EC and EC2.

All of it is DE build 101.103.54800.

## What is here

| Folder       | Holds                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| `probes/`    | The 342 probe scripts, as DE ran them (the `cg-x-*` ones are the corpus copies round CG ran). |
| `scenarios/` | 772 maps DE generated from them and the editor saved.                                         |
| `evidence/`  | The six stage write-ups.                                                                      |

The write-ups are `evidence/de-land-stage.md`, `de-elevation-cliffs.md`, `de-terrain-stage.md`,
`de-connections-objects.md`, `de-findings-cg-cj.md` and `de-objects-cg-dz.md`. They state each rule with the maps that tested it and what was left untested.
`results.md` is the run-by-run log, including the readings each map rejected and by how much. The connections-and-objects
write-up is the newest: it has not yet been re-implemented from its text the way the other three were, and its
Section 9 lists object attributes that are only measured.

## The rounds

| Round                                                                                | Run sheet, predictions                                     | Maps | Result                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Land (rounds 3 to 8, 2026-10-09 to 13)                                               | `RUN-SHEET.md`, `probe*-run-*.md`, `probe*-predictions.md` | 146  | 135 as saved, 6 more once stale alliances are read, 5 with alliance tables no lobby makes                                                                                             |
| EC, EC2: elevation and cliffs (2026-10-17, 19)                                       | `elev-cliff-run-sheet*.md`, `ec*-predictions.md`           | 51   | 51 match                                                                                                                                                                              |
| ET: terrain, plus elevation and cliff leftovers (2026-10-26)                         | `run-sheet-et.md`, `et-predictions.md`                     | 44   | 44 match the primary reading                                                                                                                                                          |
| GP: the gaps in land, elevation, cliffs and terrain (2026-10-28)                     | `run-sheet-gp.md`, `gp-predictions.md`                     | 46   | 46 match one predicted reading (44 the primary one)                                                                                                                                   |
| CO: connections and objects (2026-10-28)                                             | `run-sheet-co.md`, `co-predictions.md`                     | 56   | 23 as predicted; 42 with six rules found after the run, which still need confirming maps; 11 use attributes never modelled                                                            |
| CF: CO's rules confirmed, unmodelled attributes measured (2026-10-28)                | `run-sheet-cf.md`, `cf-predictions.md`                     | 39   | CO's rules hold on new layouts and seeds; two refuted and replaced (below); with them all 26 modelled maps match, and CO's 45 modelled maps still do; 13 use attributes measured only |
| CG: 15 real corpus scripts, the parser, measured attributes (2026-10-28/29)          | `run-sheet-cg.md`                                          | 67   | terrain exact on every corpus map after later rules; the 28 Oct corpus maps were spoiled by editor carry-over and remade (CG-clean)                                                   |
| CG-clean: the corpus maps again, one fresh editor each (2026-10-30)                  | `run-sheet-cgclean.md`                                     | 40   | terrain, elevation and layer exact on all                                                                                                                                             |
| CH: off-grid objects, palms, effects, composites, scaling, math (2026-10-30)         | `run-sheet-ch.md`                                          | 18   | 12 as predicted; all 18 with four rules found after                                                                                                                                   |
| CI: slices of the open corpus maps, three object rules (2026-10-31)                  | `run-sheet-ci.md`                                          | 29   | 9 as predicted; the slices located each map's first differing stage                                                                                                                   |
| CJ: the rules found from CI's data (2026-10-31)                                      | `run-sheet-cj.md`                                          | 16   | 6 as predicted; every parser, composite and connection rule confirmed                                                                                                                 |
| CK, CL: groups, placeholders, huts, require_path, walls behind rings (2026-11-08/09) | `run-sheet-ck.md`, `run-sheet-cl.md`                       | 58   | all match once found rules were applied (bare numbers in `create_object` are not objects; route search; zone scan)                                                                    |
| CM: walls, queue rules, effects, force_placement, land-zone edges (2026-11-14)       | `run-sheet-cm.md`                                          | 46   | 28 as predicted; 46 with the rules found after                                                                                                                                        |
| CN: the panda rock's stored frame (2026-11-14/15)                                    | `run-sheet-cn.md`                                          | 7    | positions as predicted; the frame later found on its own stream                                                                                                                       |
| CP, CQ, CR, CS: Venn, Namatjira and Comeer cut down (2026-11-15/16)                  | `run-sheet-cp.md`; `results.md`                            | 72   | all match                                                                                                                                                                             |
| DZ: Bazi's and Rage Forest's last objects (2026-11-17)                               | `results.md`                                               | 14   | 8 as predicted; all 14 with four rules found after                                                                                                                                    |

## Building the object stage (2026-11-17)

**The object stage is solved and written up, and preview-design rev 12 (2026-11-17) took it up** (`src/preview/generator/deObjects.ts` and the files it names, gated by `deObjectMaps.test.ts` on the maps below). `tools/extract-constants --object-data` now writes the object data from the dat. All 30 corpus maps (15 real
scripts at two seeds) are reproduced by the study's model in every tile, object, decoration and stored frame, and
every probe round matches. Read, in this order:

1. `de-connections-objects.md` (2026-10-28): the connection stage, and the object stage's base (terrain
   objects, candidates, groups, facings).
2. `de-findings-cg-cj.md` (2026-11-01): composites and layers, which the object stage reads.
3. **`de-objects-cg-dz.md` (2026-11-17): everything found since, and where it overrides item 1** (its
   Section 14 lists each replaced sentence). Its Section 16 orders the work for the preview, Section 18 states the
   object's own checks exactly, Section 19 lists the object data the stage reads.

It has been re-implemented from its own text and reproduces all 30 corpus maps and 65 probe maps, so it can be
implemented as written.

**Object data: `tools/extract-constants --object-data`** reads the fields listed in Section 19 of the write-up
from `empires2_x2_p1.dat` into `reference/data/object-data.json`. Per object: placement and collision half-sizes, footprint,
placement rules and slope mode, collision and obstruction flags, hit points, restriction, position family, movement
speed, edge margin, pathing action and extents, first resource slot, foundation, construction attachments, available
civilizations, single-request count, centre and side terrain lists, standing graphic and creation draws. Per graphic:
angle count and the random-facet and random-angle flags. Also the replacement rules, the restrictions' allowed,
blocked and cost tables, and the terrains' placement classes. A field read differently shows first in the creation
draws and stored facets (write-up 2.1). The gate object per wall and run direction, which is not a dat field, is
`tools/extract-constants/wall_gates.json`.

**Reference maps for a DE object gate:** every `cg-x-*` map at seeds 1004/1005 (the corpus), and the probe maps of
rounds CH to DZ. Each must be compared object for object, including rotation, frame and status; the write-up's
Section 2.3 says what the file stores.

## What the preview has not taken up yet

**Preview-design rev 11 (2026-11-02) took up everything below except the objects.** The terrain stage, the
connections, the parser rules, composites, layers and the land rules of rounds GP to CJ are in the preview, and
`deWholeScriptMaps.test.ts` holds it to 342 of the archived maps, 328 of them matching (the spec's Sec.13 and Sec.15
items 60 to 63 say which do not and why). Still to take up: the object stage (`de-connections-objects.md` Sections 4
to 9) and the object findings of rounds CG to CJ, which are not written up yet. The rest of this section is the list as
it stood before rev 11.

**Rounds CG to CJ (2026-10-28 to 11-01): `de-findings-cg-cj.md`** has every finding for whole real
scripts up to the connections (parser, lands, elevation, cliffs, composites, layers, connections), with Section 6
listing what changes in the preview. Objects are not written up yet. Terrain, elevation and layer are exact on all
178 saved maps of those rounds (`terrain_all.py` in the study's `tests/`). **The scenario editor carries state from
one generated map to the next** (effect lines, and at least one other thing), so every reference map must come from a
fresh editor; the 28 October corpus maps that suffered from it are not archived here, and the u2-forestcliff maps at
1002/1003 here are the fresh ones (2026-11-01).

Rev 10 already carries the land, elevation and cliff write-ups. These later findings are not in the spec yet:

- **Terrain stage (round ET), `de-terrain-stage.md` Section 9:** the exact `create_terrain` algorithm replaces
  Sec.6.4's statistical model; the per-command beach pass goes; `beach_terrain` is a mark that the end-of-stage beach
  rule reads.
- **Round GP:**
  - there is **no beach pass before the first `create_terrain`** either (Sec.15 item 58), so `base_terrain BEACH`
    finds only BEACH that a land or an earlier pass painted;
  - `base_terrain` + `base_layer` on one pass need both (item 27), and both spacing attributes apply (item 42);
  - **`base_layer` on `create_land` is ignored**;
  - `number_of_clumps` is capped at 999 for elevation and terrain; with both scale keys the later one wins;
  - several `create_player_lands` give every land its own perimeter place; a random `assign_to` picks among the
    players not picked yet; `override_map_size` sets the size of every stage; a land with no amount is
    `land_percent 100`; `behavior_version 2` acts like 1.
- **Round CO** (`de-connections-objects.md` Section 10 has the full list), as predicted: best-first 8-direction
  paths, rectangles with four side draws, a cost-0 origin blocks arriving only, `same_land_zones` = `all_lands`,
  beaches after the connections over 8 neighbours, object candidates always shuffled, the later scaling key wins.
  Found after the run (and confirmed in round CF): a command's undo keeps a
  tile's value from before its last paint, group weights are kept when at least the roll, FORAGE has 4 random facets,
  beaches destroy no objects, decorations under a placed object are deleted, and the file leaves out child objects.
- **Round CF** confirmed those CO rules on new layouts and seeds, and found two more (not yet confirmed): a player at a RANDOM
  civilization is treated as the civilization DE picked, so player-owned resources (stone, gold, forage, deer, boar,
  trees, relics) are never placed for a player; and a gaia building paints no foundation terrain. `base_layer` on
  `create_land` is ignored on three more layouts. Measured but not modelled (`results.md`, round CF): walls form a
  square ring at exactly the minimum distance, `place_on_specific_land_id` without a distance places everything on
  the first land of that id, `generate_for_first_land_only` uses one land in all, forest and cliff zones keep more
  than N tiles away, and `force_placement` stacks objects on shared tiles.

## Reading a scenario's name

`RMSTEST_<script>_<seed>_<lobby>`, with `_size-<n>` added for a map larger than Tiny (120). The lobby code is the
player count, then the team of each player when there are teams, then `r` when the editor's Team Positions box was
unticked. `n2` is two players with no teams, `n4t1122` four players in teams 1, 1, 2 and 2, and `n4t1122r` the same
with Team Positions off. A `-brit` suffix means every player was set to Britons before generating, and `-brit-azt`
means player 1 Britons and player 2 Aztecs (round CO, where player objects depend on the civilization).

A few names differ from their script. `a7-behaviour` and `c2-conf-circle` are `a7-behavior.rms` and
`c2-conf-circ.rms`, `land4_<seed>` is `land4-grow.rms`, `land3-tiebreak-<seed>` is `land3-tiebreak.rms`, and
`land-probe-k0-2` is a second save of `land-probe-k0.rms`. The `go1-override144` and `go2-override100` maps were
saved from a Tiny lobby; the script's `override_map_size` makes them 144 and 100.

**Twelve `p4o-players` maps carry stale alliances.** They were saved while a player in the game was still allied
with an unused slot, which a real lobby never does and which moves players in the editor (the alliance trap in
`../README.md`). `../export_de_fixture.py check` lists them and refuses them.

## Checking a map against the preview

```bash
python ../export_de_fixture.py add scenarios/RMSTEST_cl1-default_1000_n2.aoe2scenario --script probes/cl1-default.rms --seed 1000 --fixture <scratch copy of the fixture>
```

Point `--fixture` at a scratch copy and run the gate's logic against it, or add the map to the real fixture when it
should become part of the gate. A script with `<OBJECTS_GENERATION>`, such as the villager markers of
`p4o-players`, needs `--force`. The objects do not change the terrain the gate compares.

Rounds ET and GP have elevation and cliff maps that can go straight through the gate. Their terrain-stage maps
(`t1` to `t9`, `pg1`, `gt*`, `gx1`) test a stage the preview only approximates (Sec.6.4), so they belong in the gate
once Sec.6.4 is revised. The CO maps also test connections and objects, which the gate does not compare yet.

## What was not kept

The study's Python tools are not here. The evidence names them (`land_model.py`, `stage_model.py`,
`connection_model.py`, `object_model.py`, `writeup_check.py`, `compare_ec.py` and others), so read those names as
history. They were the study's own model of the game, which the preview has since replaced and which the DE gates
check. The prediction pickles, the caches, and the study's notes on disassembling the game's executable were not kept
either.
