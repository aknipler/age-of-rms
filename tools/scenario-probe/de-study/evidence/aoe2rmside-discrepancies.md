# Where AoE2RMSIDE and Age of Empires II DE disagree: a report for AoE2RMSIDE's author (draft, 2026-11-17)

**Purpose.** We are building a map preview (age-of-rms) that reproduces DE's random-map generator tile for tile.
AoE2RMSIDE (github.com/aoe2control/AoE2RMSIDE) gave us most of the algorithms, and we checked them against DE by
generating maps in DE's scenario editor and reading every tile and object back. Where DE and AoE2RMSIDE part, this
report says how, with the maps that show it and a recipe for a test script. We plan to send the author those test
scripts with the saved maps, so each item is written to become one test.

**Status of this draft.** Our reading of AoE2RMSIDE comes from two snapshots: the engine sources at commit 210d977
(read 2026-10-17 to 10-31) and summaries of commit 7525df0 (2026-11-08 to 11-15). Some items may already be fixed in
the current AoE2RMSIDE. **Before sending, re-check each item's "AoE2RMSIDE" column against the current repository**,
and drop the items that no longer differ. The column "Our reading" says how sure we are of what AoE2RMSIDE does.

## How the tests are made (to send with the scripts)

- **DE build:** 101.103.54800. Every rule here was measured on that build only.
- **Map making:** the scenario editor, *Map* tab: Seed Map ticked, the seed typed in, map size Tiny (120 × 120)
  unless the script overrides it, the script picked from the list, Generate, then saved. *Players* tab: 2 players,
  both Britons unless stated, Team Positions ticked (the editor's default). Unused player slots allied with nobody.
- **A fresh editor for every map** (main menu, Editors, Create Scenario). The editor keeps effect lines, and at least
  one other piece of state, from one generated map to the next until it is left for the main menu; maps made one
  after another in one editor session are not valid references.
- **Reading a map:** AoE2ScenarioParser (Python): every tile's terrain, elevation and layer; every object's type,
  owner, position (in 1/256 tile), rotation, frame and status, in reference-id order.
- **The comparison:** a test passes when every tile and every object of the saved map equals the prediction. Where
  only part of the map is at stake, the item says what to compare.
- **The lobby name in our file names:** `RMSTEST_<script>_<seed>_<lobby>`; `n2-brit` is 2 players, no teams, both
  Britons; `n4t1122` is 4 players in teams 1, 1, 2, 2; an `r` at the end means Team Positions unticked.
- **Where the files are:** age-of-rms `tools/scenario-probe/de-study/` (`probes/` holds the scripts, `scenarios/`
  the saved maps, `evidence/` the write-ups and `results.md`). Item numbers below refer to our write-ups:
  `de-land-stage.md` (L), `de-elevation-cliffs.md` (E), `de-findings-cg-cj.md` (P), `de-connections-objects.md`
  (C), `de-objects-cg-dz.md` (O).

## The discrepancies

Each item: **AoE2RMSIDE** (what it does as we read it) / **DE** (what DE's maps show) / **Evidence** / **Test**.
"Our reading" is *code* (we read the source), *summary* (we read a description of the source), or *inferred* (from
its behaviour as we restated it).

### Player setup and lands

**1. The selected player in the team-order step.** (L 4.2)
- AoE2RMSIDE: `(d3 & 0x7FFF) % players`, used as a 0-based player index. Our reading: code (210d977).
- DE: `(d3 & 0x7FFF) % (players + 1)`, a player number where 0 selects nobody.
- Evidence: every 4-player (14 seeds; layouts 1122, 1212, 1221) and 8-player (7 seeds) team map of the land rounds,
  `p4o-players` and `p4-players` with villagers marking each player's start.
- Test: `p4o-players` (player lands plus one villager per player), 4 players in teams 1122, seeds 1000 to 1013. Compare
  which player stands where. With `% players`, about half the seeds put the teams in the wrong order.

**2. `land_percent 100` on player lands is not divided.** (L, `land_percent`)
- AoE2RMSIDE: the player lands share the percentage (each targets W·H·P/100 divided among them, as for P < 100).
  Our reading: inferred.
- DE: a share per land below 100; at 100 or more, each player land targets the whole map (W·H tiles).
- Evidence: `b2b-percent100` (two player lands at 100: DE paints 14,399 of 14,400 tiles), the single-land size
  ladder, and the 60/97/99 maps that confirm the per-land share below 100.
- Test: `b2b-percent100` at 2 seeds; compare the painted tiles.

**3. Team Positions unticked.** (L 4.2)
- AoE2RMSIDE: its "random" route draws a rejection-sampled player order with no perimeter offsets; its "team
  together" route groups teams. Our reading: code (210d977).
- DE: the 7-draw slot shuffle still runs, the three team-order draws are skipped, teams are not grouped, and the
  perimeter pass keeps its per-land offsets.
- Evidence: `n4r` and `n4t1122r` (identical maps: teams do not group), 2 maps.
- Test: `p4o-players` with Team Positions unticked, 4 players with and without teams, several seeds.

**4. The WATER cleanup. Probably no longer a discrepancy.** (L 9, E 5.7)
- Our land write-up (2026-10-13) listed it as a disagreement. Round EC2 (2026-10-19) then found AoE2RMSIDE's
  placement right: the cleanup with WATER as the reference terrain runs at the end of the terrain stage, after the
  cliffs. Re-check before sending; send only if the current AoE2RMSIDE lacks the pass.
- Test if needed: `wc1-water` at seeds 1000 and 1001.

**5. `base_layer` on `create_land` is ignored.** (E 3.0, P 3.4)
- AoE2RMSIDE: the land's tiles take the layer. Our reading: code (210d977).
- DE: no layer at all; a later `create_elevation` with that `base_layer` grows nothing.
- Evidence: `ge1-landlayer` at 1000 and 1001 (about 400 raised tiles under AoE2RMSIDE's reading), and round CF on
  three more layouts.
- Test: `ge1-landlayer`; compare layers and elevation.

### Parser

**6. A constant's name as an `rnd()` bound reads as 0, and the draw is still spent.** (P 2.6)
- AoE2RMSIDE: reads the constant's value. Our reading: summary.
- DE: `rnd(-NAME, NAME)` is `rnd(0, 0)`: always 0, one draw. Literal negative bounds work normally.
- Evidence: `cj-n1-parser` (2 seeds; reading the value fails by 273 and 280 tiles); Bulls_Eyes (a corpus script whose
  side lands use such bounds) exact only with this rule.
- Test: `cj-n1-parser`.

### Connections and terrain objects

**7. The undo between connection commands.** (C 3.3)
- AoE2RMSIDE: each command's painting is isolated from the next. Our reading: inferred.
- DE: the isolation is an undo that gives each painted tile back the terrain it had before the command's *last*
  paint of it; a tile painted twice in one command keeps the first paint's result for later commands.
- Evidence: `cn6a-cascade` (2 tiles at both seeds), `cn7d-nonplayer` (7 and 103 tiles); all 26 connection maps of
  round CO and both `xr1` maps identical only with it.
- Test: `cn6a-cascade` and `cn7d-nonplayer` at 2 seeds each.

**8. A tile turned into a beach keeps its terrain objects.** (C 4.3)
- AoE2RMSIDE: the end-of-stage beach pass removes the objects of the old terrain. Our reading: inferred.
- DE: they stay, unless the beach's restriction refuses them.
- Evidence: `cn8b-ford` (5 grass decorations on tiles that became BEACH), `k3-coast` at 2 seeds.
- Test: `k3-coast`; compare decorations on beach tiles.

**9. Terrain objects under a new object are deleted, not kept at status 7.** (C 8.3, O 9)
- AoE2RMSIDE: retires them (status 7, kept in the file). Our reading: inferred.
- DE: deleted from the map. Status 7 is right only for the terrain's own objects that the object stage's pass
  retires.
- Evidence: `k5-retire` at 2 seeds (under GOLD, STONE, RELIC and HOUSE); every object map of round CO.
- Test: `k5-retire`; count decorations under the placed objects.

### Objects

**10. Group weights: an entry is kept when its weight is at least the roll.** (C 5.4)
- AoE2RMSIDE: the profile we restated (for build 48987) keeps entries whose weight is at most the roll; it has the
  other rule as a second profile. Our reading: code (210d977). Possibly only a profile choice for this build.
- DE (54800): at least the roll; pick `roll mod kept`, or the first entry when none is kept.
- Evidence: `ob6-objgroups` (36 and 37 of 120 objects right under "at most"); round CF k6 at 2 seeds, with a 100/0
  group.
- Test: `ob6-objgroups`.

**11. Group picks are never replaced.** (O 4.1)
- AoE2RMSIDE: a pick from a group passes through the picked object's replacement rule (VILLAGER may turn female, with
  a `draw(100)`). Our reading: summary (7525df0).
- DE: the group roll only; the pick is used as it is, with no replacement roll. (The resolutions made for a forest or
  cliff zone filter are the one exception we know of, and agree with AoE2RMSIDE.)
- Evidence: Battle Lines (corpus; a 50/50 group of VILLAGER and its female form); `ck-a1-groupreplace` at 2 seeds
  (a one-entry group of VILLAGER: DE saves only males).
- Test: `ck-a1-groupreplace`, written with object constants (see item 21).

**12. `set_facet 0` keeps the random facet.** (O 2.5)
- AoE2RMSIDE: applies facet 0. Our reading: code (210d977).
- DE: facet 0 means "random": the drawn facet stays; 1 and above set the facet. The draws are spent either way.
- Evidence: `ch-f1-offgrid` at 2 seeds (MAPLE_LEAVES with `set_facet 0`).
- Test: `ch-f1-offgrid`; compare stored facets.

**13. The zone filter's resolution on an actor-area walk comes late.** (O 5.4)
- AoE2RMSIDE: on `actor_area_to_place_in` with a forest or cliff zone filter, resolves the object (spending its
  group and replacement rolls) right after each draw's weight is used. Our reading: summary (7525df0).
- DE: only for a draw that has already passed the distance, avoided-area and map-edge tests, just before the filter.
- Evidence: Venn (corpus): a straggler VILLAGER command with `place_on_forest_zone` also runs in each player's second,
  one-tile land, where all 9 draws fail the distance test. AoE2RMSIDE's order spends 9 rolls per frame that DE does
  not, and the next routed command (a HOUSE) starts 18 draws late. Round CQ's cuts `cq-v4-onlyDH`,
  `cq-v12-tree`, `cq-v13-vilnoforest`, `cq-v14-vilnotree` at 1004/1005 isolate it.
- Test: a VILLAGER with `actor_area_to_place_in` and `place_on_forest_zone`, set for every player, with a second
  one-tile land per player far from the area, followed by a HOUSE through another area; compare the HOUSE.

**14. A frameless command does not fall back to an area made with no land.** (O 5.3)
- AoE2RMSIDE: when no actor-area record exists in the current land context, the record made with no land is used,
  from any command. Our reading: summary (7525df0).
- DE: only a command dispatched to land frames (per player or per land id) falls back. A frameless command finds
  nothing and places nothing.
- Evidence: round CF `u1-actor` at 4 seeds (a frameless GOLD after a per-player command: DE places none); Comeer
  (corpus) for the framed fallback.
- Test: `u1-actor`.

**15. `force_placement` checks overlaps only in passes 1 to 9.** (O 10)
- AoE2RMSIDE: checks overlaps in every pass. Our reading: summary (7525df0).
- DE: passes 1 to 9 check overlaps; from pass 10 nothing is checked against other objects, and objects stack.
- Evidence: `cm-f1-forcesheep`, `cm-f2-forcegold` at 1013/1014 (every forced position), CF `u4-force` at 3 seeds.
  Under AoE2RMSIDE's rule 94 objects against DE's 112.
- Test: `cm-f1-forcesheep` (a 3 × 3 land whose every tile is taken before the forced phase).

**16. Walls: routes ignore terrain, pieces on unsuitable terrain are not built.** (O 8)
- AoE2RMSIDE: the wall routes' walkable grid follows terrain, so a ring dives into cheap unwalkable water. Our
  reading: summary (7525df0).
- DE: rings run straight along the inner line across lakes; pieces on water are simply not built.
- Evidence: `cm-w3-lakes` at 1013/1014.
- Test: `cm-w3-lakes`.

**17. Walls: a run's end piece is a post only where the wall stops.** (O 8)
- AoE2RMSIDE: every run's end piece is a post (shape 2). Our reading: summary (7525df0).
- DE: an end piece is a post only when the next tile along the run holds none of the player's wall; a run that meets
  another run of the same player keeps its own shape.
- Evidence: `cm-w1-forest`, `cm-w2-resources` at 1014.
- Test: `cm-w1-forest`; compare the stored wall shapes.

**18. `require_path`: terrain does not block the route.** (O 7)
- AoE2RMSIDE: terrain costs come from a reference object named in a bindings file that is not in the repository, so
  we could not check what it does. Our reading: summary (7525df0).
- DE: only objects block the route; water does not.
- Evidence: `ck-p1-requirepath` 1009 (STONEs kept whose only walkable route goes round a lake); the owner's 20 stone
  maps (`cl-r1-*`) and `cl-r2` to `cl-r5` are identical under this rule.
- Test: `ck-p1-requirepath`. Send only if AoE2RMSIDE's reference object treats water as blocking.

### Saved-file details (not generation)

AoE2RMSIDE models the generation, not the scenario file. These matter only to anyone comparing its output with
saved maps; they are worth a mention, not a test.

**19. Stored frames and wall shapes.** (O 2.2, 2.3)
- The start frame of animated objects (flags 1285, PANDA_ROCK 2082, and others) comes from **generator 3 of the
  seed's chain**, two raws per object, frame = `⌊F · (second & 0x7FFF) / 0x7FFF⌋`. AoE2RMSIDE has no stored frame.
  **The two draws are on their own stream**, so they move nothing else.
- Fixed-facet objects store a frame fixed by constructor type (5 for type 30, 0 for types 70 and 80).
- Wall pieces placed by ordinary `create_object` commands store a joint shape from their neighbours.
- Evidence: Immersion, Venn, Bulls_Eyes, Heart (corpus); round CN (`cn-n1` to `cn-n3`, 7 maps).

**20. Buildings at 0 hit points.** (O 2.3)
- AoE2RMSIDE: a building created below 1 HP is a construction site (status 0), with an exemption table we have not
  seen.
- DE's files: status 0 only for buildings hidden in the editor (1639-1641, 278, 1650); a gaia HOUSE set to 0 HP, or
  Caverns' TC_PLACEHOLDER, keeps status 2. Possibly AoE2RMSIDE's exemption table gives the same answer.
- Evidence: `ch-e1-effects` at 2 seeds; Caverns and Ra (corpus).

### Not tested against AoE2RMSIDE yet

These DE rules were found after we last had AoE2RMSIDE's sources at hand. Each may or may not be a discrepancy;
check before sending:
- **21. Bare numbers and unknown names as objects** (O 3.1, 3.2): `create_object 293 {…}` is not a command, and its
  block joins the previous `create_object`; `add_object 293 50` is ignored; an unknown name works the same way.
  Evidence: round CK (8 maps), Comeer and round CS.
- **22. Retired terrain objects of any kind are deleted under a new object** (O 9). Evidence: Rage Forest (corpus).
- **23. Terrain objects always carry gaia's effects**, also when tested against a player's object (O 1.5). Evidence:
  Bazi 1005 (corpus), round DZ part B (8 maps).
- **24. Terrain objects alive on a repainted tile obstruct placement and count for forest zones** (O 9, 6.4).
  Evidence: round DZ part R (`dz-r1-rfpines`, `dz-r2-rfgold`, `dz-r3-rfsheep`, 6 maps), Rage Forest 1005.
- **25. Markers are deleted only when the new object or the marker has exactly 0 hit points** (O 9). Evidence:
  `cl-a2` (CL round), Bulls_Eyes, Venn.
- **26. `max_distance_to_other_zones` measured against the player's origin zone** (O 6.3). Evidence: Comeer, CL
  part B.
- **27. Loose-group members exclude their own group's trees and second objects from forest zones** (O 6.4).
  Evidence: Namatjira, Menindee.
- **28. The object stage sees layers from before the beach-layer cleanup** (O 6.5). Evidence: Pag.
- **29. `set_place_for_every_player` skips player lands that have a `land_id` attribute** (O 5.1). Evidence:
  Immersion.

## Where we agree (for the cover note)

Everything else we tested agreed with AoE2RMSIDE, among it: the WELL512 generator and its seeding chain, the parse
order, land growth, elevation and both of its deliberate engine quirks, cliffs, the terrain stage, the connection
paths, the object candidate shuffle, the closest-first orders, tight and loose groups, the zero-size corner rule,
creation draws from the standing graphic, the actor-area walk, the zone-filter resolutions, the player's zone, the
land-zone removal, the `require_path` route search and the wall ring. That is far more than the list above, and
AoE2RMSIDE is the reason this work was possible.

## Before sending

1. Re-check every item against the current AoE2RMSIDE; drop what no longer differs; correct "Our reading".
2. For each item kept, regenerate its test maps in a fresh editor on the current DE build, and say which build.
3. Write each test as one script plus its seeds and lobby, the saved maps, and what to compare, as above.
4. Do not send anything from the game itself (no binaries, no data extracts beyond what AoE2RMSIDE already ships).
