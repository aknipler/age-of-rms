# Round CO run sheet: connections and objects (56 maps + every saved map, set up 2026-10-27)

The first round past the terrain stage. It runs alongside round GP (`run-sheet-gp.md`, the gaps in land, elevation,
cliffs and terrain) and shares nothing with it except the setup. Scripts and file names come from `probe_co.py`
(`python probe_co.py write` writes the `.rms` files; `python probe_co.py runs` prints the 56 file names).

**Status (2026-10-28): run, all 56 maps saved.** 23 of 56 as predicted; with six rules found after the run (`posthoc_co.py`), 42 of 56, and every modelled map up to two single-object observations. Details in `results.md` 2026-10-28. Before the run: models written, Part 0 run, predictions written, no new DE map saved yet.. The
method is as in rounds EC and ET: the predictions (`co_predictions.pkl`, summary `co-predictions.md`) were written
before any DE run, every reading is predicted, and `probe_co.py check` shows which variants a map can tell apart.

1. **Models** (our own restatements of AoE2RMSIDE at commit 210d977, Apache 2.0):
   - `appearance_model.py`: the terrain's own objects (trees, decorations) through every stage: made by the land
     cleanup, refreshed along cliff lines, destroyed by the end-of-terrain changes and the connections' WATER fill,
     and redrawn at the object stage. **Tested by Part 0 (results below).**
   - `connection_model.py`: the six commands, the best-first path search, the rectangle painting, isolation and
     `accumulate_connections`, the WATER fill and the shoreline pass.
   - `object_model.py`: the main object paths (see its docstring for what is and is not covered). It reports every
     attribute it does not model; a prediction that lists one is marked NOT MODELLED (below).
2. **Data:** AoE2RMSIDE's content pack for our build (`tests/de_content_54800.json`, its
   `aoe2de-101.103.54800-content-pack.json`, derived from the game's dat): objects (sizes, restriction, class,
   creation profile, child objects, foundations), restrictions, replacement rules, terrain appearance tables and the
   RMS constants. It replaces the extract-constants step planned here.
3. **Predictions:** `python probe_co.py check [regex]` predicts and marks variants that give the same map;
   `python probe_co.py write` also writes the scripts, `co_predictions.pkl` and `co-predictions.md`. The script
   text is parsed to drive the models, so the predictions cannot drift from the scripts.
4. **`compare_co.py`:** terrain and elevation tile for tile, and every unit in the file (owner, type, x and y to 1/256
   tile, facing, status), by group (cliff pieces, terrain objects, script objects), plus the script objects' creation
   order. Facing: the facet, or for a unit with a random angle the angle in radians, which is what the file stores
   (the facet is that angle's sector shifted by π/4).

**NOT MODELLED** (these maps are predicted only up to the first descriptor that uses one): actor areas (`ob7`), object
class filters `avoid_forest_zone` / `avoid_cliff_zone` / `place_on_forest_zone` (`ob5`, `xr1`),
`place_on_specific_land_id` and `generate_for_first_land_only` (`ob8`), `force_placement` and `min_connected_tiles`
(`ob10`), walls (`ob13`). Save these maps anyway: they are observations to model against later.

## What the probes decide

Where the readings come from: AoE2RMSIDE (our main lead; every reading of it tested so far has held), the scripting
guide, and preview-design rev 10 Sec.6.5 and 6.6 (the preview's current rules; some of them were measured in game
with the RMSTEST_* runs, but never tile for tile). In our words, AoE2RMSIDE's reading is:

- **Connections.**
  - The stage spends one burned draw if the `<CONNECTION_GENERATION>` header is there.
  - Each command lists land origins in land order and tries every pair (i, j), i < j, from i to j.
  - The path search is best-first over 8 neighbours. A step costs the terrain cost × 1, or × 1.36 diagonally. The
    estimate is the straight-line distance, nudged by ±1 per axis and by ±0.41/±0.40 on diagonals. A diagonal is
    refused when either side tile is impassable.
  - A target on cost ≤ 0 fails. **The start's own cost is never checked.**
  - Painting puts a **rectangle**, not a disc, around every path tile from the start to the one before the target.
    Each of its four sides is size − variance + draw(2·variance) (so 4 draws per tile, even at variance 0), and the
    size is read from the terrain under that tile. The rectangle is painted through the replacement table.
  - Without `accumulate_connections`, every command starts again from the terrain at stage entry, the last command
    to paint a tile wins, and **within one command later paths see earlier ones**. With it, everything is live.
  - `same_land_zones` is `all_lands`. `create_connect_land_zones` takes the lands of zone 1, then those of zone 2,
    and connects all pairs. Teams: an unteamed player is a team of one.
  - `to_nonplayer_land` builds one extra command per player land and writes them over the *next* commands in the
    script. That is the guide's "blocks future connections", but only as far as it overwrites.
  - After all commands: the WATER cleanup again, then coast tiles get their terrain's shoreline terrain (8
    neighbours).
- **Objects.**
  - The stage spends one burned draw.
  - Then come the terrain's own objects, tile by tile, row by row: forest trees, grass decorations and so on. A
    randomized entry costs 2 draws (x, y) plus a roll unless its weight is 0 or 1000. A centered entry costs a roll
    unless its weight is 0 or 1000. Each accepted object takes its facing from a **second stream** (stream 6).
  - Then each `create_object` in order, once per player land when it has a frame.
  - Candidates are collected in row order inside a window: the map less `min_distance_to_map_edge`, or the square
    of `max_distance_to_players` around the origin.
  - Then the candidates are **always** shuffled: (w−1)(h−1)/4 random picks, 2 draws each, each moving the picked tile
    to the front. A pick never lands in the window's last two columns or rows.
  - `enable_tile_shuffling` only shuffles ties under `find_closest`.
  - Groups: 1 draw (0..99) per object, keeping the entries with weight ≤ the roll ("at most roll") and taking the
    roll mod their count, or the first entry if none is kept. `group_variance` costs 1 draw.
  - Facing: 1 draw each for random facet, random angle and combat seed, where the object's profile has them.
  - A per-player VILLAGER with count 1 becomes the civilization's starting villagers.
  - `max_distance_to_players 0` with a frame places at the origin directly.

| Question | AoE2RMSIDE | Guide | Preview rev 10 | Probes |
|---|---|---|---|---|
| Path shape | best-first, 8 directions, diagonal 1.36 | "straight if costs equal" | multi-goal Dijkstra | cn1, cn4 |
| Painted shape | rectangle, 4 side draws | radius ± variance | disc, one variance roll | cn2, cn3 |
| Cost-0 land origin | blocks arriving only | "not generated at all" | both directions (BUG-029, unmeasured) | cn5a, cn5b |
| Accumulation | live within a command; commands isolated | "based on terrain prior to connection generation" | frozen per stage (per command with the flag), measured by RMSTEST_43 | cn6a, cn6b |
| `same_land_zones` | = `all_lands` | = `all_lands` | grouped by zone | cn7b |
| `to_nonplayer_land` bug | overwrites the next commands | blocks all later commands | blocks all later commands | cn7d, cn7e |
| Beaches after connections | yes, 8 neighbours | `beach_terrain` breaks | not modelled | cn8a, cn8c |
| `enable_tile_shuffling` absent | still shuffled | "uses the first entry" | deterministic | ob2a, ob2b |
| Group weights | weight ≤ roll | "% works as an inverse" | `groupMemberProbabilities` (largest weight shared) | ob6 |
| Grouping default | `number_of_groups` alone makes groups loose; `number_of_objects` > 1 alone places that many single objects | not stated | loose, measured by RMSTEST_46 | ob4 |

age-of-rms's unrun RMSTEST_75a/b, 76 and 77a/b ask the same questions as cn5, cn1 and cn3. Run these instead: they
have seeds and predictions.

## Setup

1. Copy the 33 scripts listed at the end from `tests\` into
   `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\` (or let Claude do
   it). Nothing else in the game folder is touched.
2. As before: scenario editor, **Team Positions ticked**, every unused slot allied with nobody, Seed Map ticked
   with the seed typed in. Lobby codes: `n2` = 2 players, no teams; `n4` = 4 players, no teams; `n4t1122` =
   players 1+2 and 3+4 teamed.
3. **Civilizations** (new this round): the saved maps so far all say RANDOM, and player-owned objects can depend on
   the civilization (scout or eagle, replacement rolls). `-brit` means every player is set to Britons in the
   Players tab *before* generating. `-brit-azt` means player 1 Britons, player 2 Aztecs. Lobbies without the
   suffix place only gaia objects or none, so leave the civilizations alone.
4. Map size is Tiny unless the file name says `_size-<n>`.
5. Save as `RMSTEST_<script>_<seed>_<lobby>[_size-<n>]`, for example `RMSTEST_ob9-starts_1000_n2-brit`.

Priority if time is short: Part 0 (no runs), then `cn9`, `cn1`, `cn2`, `ob1`, `ob2a`, `ob2b` (the entry points
every other probe stands on), then the rest of C and O in order, and Part X last.

## Part 0: what the saved maps already show (no new maps)

Every saved map holds the object stage's output, even without an `<OBJECTS_GENERATION>` section. `t1-forest_1000`
has 620 trees (unit 411) on its 620 FOREST tiles and 818 decorations (unit 1358) at fractional positions, with
frames 0 to 7. `gr5-forest_1000` has 14,072 trees at tile centres. The 67 `p4o-players` maps also hold the villagers
of a per-player VILLAGER request: one asked for, three placed, units 83 and 293.

| # | Maps | What it tests | Readings |
|---|---|---|---|
| 0a | the 95 maps of rounds EC, EC2 and ET (`compare_part0.py`) | the stage's burned draw; per tile, row by row, the appearance table's draws; collisions between appearance objects; facings from stream 6 | AoE2RMSIDE / *controls* `+noburn`, `+aux-on-primary` (facings from the main stream) |
| 0b | the same maps: most have no `<TERRAIN_GENERATION>` | the terrain stage's burned draw without the section, which round GP lists as "not observable yet" | burned / `+noburn-terrain` (shifts every draw by one, as `+noburn` does) |
| 0c | the 66 `p4o-players` maps (`compare_part0c.py`) | a per-player request at min = max = 3: the window, the shuffle, the villager expansion (1 → 3) and the male/female choice | AoE2RMSIDE / `+noexpand` |

**Results (2026-10-27):**

- **0a and 0b: 95 of 95 maps identical.** Every terrain object (type, x and y to 1e-4 tile, facet, status) and the
  file's own creation order. 55 of the 95 have no terrain objects at all (their base terrains have no table), so
  the informative ones are the 40 with objects: forests, grass decorations, cliffs through grass. **22 of those 40
  have no `<TERRAIN_GENERATION>` section, so the terrain stage burns its draw without the section** (one draw less
  shifts every decoration, as the `+noburn` control shows). The controls fail on every map with objects
  (see `results.md`).
- **0c: 55 of 66 maps identical**: terrain, terrain objects, and every villager's type (83 or 293), owner, position
  and angle. These are all the maps whose land stage matches. The other 11 are the stale-alliance land maps (see
  Current position in CLAUDE.md), and one file name (`n8t121213434`) has a lobby code that does not parse.
- **Found on the way, all as AoE2RMSIDE has it:**
  - the land cleanup's restored tiles make real objects, with a stream-6 draw each, including on a FOREST base,
    which spends no main-stream draw;
  - an object the object stage retires (one on a tile whose table contains it) stays in the saved map with status 7
    (dying), and the file keeps it first in creation order;
  - (AoE2RMSIDE only, not yet seen in a DE map) a constructed object retires the decorations under its collision
    box the same way;
  - the scenario file stores a random-angle unit's angle (sector × 2π/16), not its facet. The facet is that sector
    shifted by π/4.

## Part C: connections (26 maps)

Every connection map compares terrain tile for tile. The maps on a GRASS base also count draws, because the grass
decorations placed after the connections shift if the connections spent a different number of draws.

| # | Script | Lobby, seeds | What it tests | Readings |
|---|---|---|---|---|
| 1-2 | cn1-path | n2; 1000, 1001 | three DIRT dots on DESERT, `all_lands`, size 0: the bare path of each pair, the pair order, which ends are painted. Nothing here is random (both seeds predict the same map), so seed 1001 is optional | AoE2RMSIDE / *controls* `+dijkstra4` (optimal 4-neighbour paths), `+paint-target` |
| 3-4 | cn2-size | n2; 1000, 1001 | `terrain_size DESERT 2 1` and `GRASS 3 3` across a GRASS band: the shape of the painted area and its draws | rectangle with 4 side draws (AoE2RMSIDE) / `+disc` (the guide) / `+one-draw` (one draw per tile, square) |
| 5 | cn3a-sizedecl | n2; 1000 | `terrain_size GRASS 1 0` written out | AoE2RMSIDE (same map as cn3b) / *control* `+novar-nodraw` (variance 0 draws nothing; the decorations move) |
| 6 | cn3b-sizeomit | n2; 1000 | the same with no `terrain_size`: is the default 1 0, and does it hide variance (RMSTEST_70's fragments)? | same map as cn3a / `+default-var` |
| 7-8 | cn4-cost | n2; 1000, 1001 | a FOREST wall: cost 0 makes the path go round it (and tests corner cutting); cost 2.5 (a float) makes it cross. Also the zone argument +10 | AoE2RMSIDE / *controls* `+dijkstra4`, `+corner-cut` |
| 9 | cn5a-blockfirst | n2; 1000 | a one-tile DESERT land at cost 0 in the map's corner (`land_position 0 0`), created first, so every pair starts from it | only arriving is blocked (AoE2RMSIDE): its roads exist / `+both` (preview: no roads). `+open` gives the same map here |
| 10 | cn5b-blocklast | n2; 1000 | the same land created last, so every pair ends at it | no roads to it (AoE2RMSIDE; `+both` gives the same map) / `+open` (roads reach it). With cn5a this separates all three |
| 11-12 | cn6a-cascade | n2; 1000, 1001 | two commands. The first paints GRASS→DESERT and DESERT→SNOW on three paths that overlap near one land; the second has cost 0.2 on DESERT/SNOW | live within a command, isolated across (AoE2RMSIDE: SNOW where the first command's paths overlap, a straight second path) / `+frozen` (preview: no SNOW) / `+live-all` (the second path follows the first road) |
| 13 | cn6b-accumulate | n2; 1000 | the same with `accumulate_connections`: the second path follows the first command's road and turns it to ICE | AoE2RMSIDE / `+per-command` (preview: each command frozen at its start) / *control* `+isolated` (the flag ignored) |
| 14 | cn7a-teams | n4t1122; 1000 | `create_connect_teams_lands` with two teams | one |
| 15 | cn7a-teams | n4; 1000 | the same with no teams: nothing is connected | one / *control* `+teamless-one-team` |
| 16-17 | cn7b-samezones | n2; 1000, 1001 | `same_land_zones` with 2 players, 2 default-zone lands and a zone-1 land | `= all_lands` (AoE2RMSIDE, guide) / `+by-zone` (preview) |
| 18 | cn7c-zones | n2; 1000 | `land_zones -9 1` (player 1 to a zone-1 land) and `-10 -8` (two neutral lands and player 2) | all pairs (AoE2RMSIDE) / *control* `+cross-only` |
| 19-20 | cn7d-nonplayer | n2; 1000, 1001 | `to_nonplayer_land`, then `all_players_land`, `all_lands` and `land_zones 1 -10`, a neutral land before the player lands and one after | overwrite (AoE2RMSIDE: the first two later commands vanish, the fourth survives, and the two neutral lands connect to each other) / `+blocks-all` (guide) / `+no-bug` |
| 21 | cn7e-teamsnonplayer | n4t1122; 1000 | `teams_lands` then `to_nonplayer_land` (the guide's second bug: team roads survive only for player 1) | AoE2RMSIDE / `+no-bug` |
| 22-23 | cn8a-dig | n2; 1000, 1001 | a connection that paints GRASS→WATER, 5 wide | beaches after the stage, 8 neighbours (AoE2RMSIDE) / `+nobeach` / `+beach4` |
| 24 | cn8b-ford | n2; 1000 | WATER→SHALLOW and BEACH→SHALLOW across a lake band, cost 3, size 2 1 (the usual ford idiom) | one |
| 25 | cn8c-beachterrain | n2; 1000 | round ET's `beach_terrain DLC_BEACH2` map plus a connection (the guide: `beach_terrain` breaks with connections) | AoE2RMSIDE (the pass leaves DLC_BEACH2 alone; `+no-shoreline-pass` gives the same map here) / `+guide-breaks` (the pass repaints the custom beach as BEACH) |
| 26 | cn9-burn | n2; 1000 | an empty `<CONNECTION_GENERATION>` header on GRASS: only the decorations can show it | burned (AoE2RMSIDE) / `+noburn` |

cn5's land sits in the corner because the land cleanup removes a one-tile land anywhere else: it has base terrain
on both sides, and with no DESERT tile left every reading gives the same map (`check` showed this with the land at
50 85). In the corner the off-map neighbours do not count as base, so the tile survives, and the tiles around it stay
passable. If the saved map shows no DESERT tile at (0, 0), the cleanup differs from our model there; note it and the
probe says nothing.

## Part O: objects (28 maps)

Objects compare by type, owner, position, rotation and frame, in creation order, plus the terrain (objects can
paint foundations). Every map also carries the terrain's own objects from Part 0.

| # | Script | Lobby, seeds | What it tests | Readings |
|---|---|---|---|---|
| 27-28 | ob1-scatter | n2; 1000, 1001 | frameless GOLD ×1, STONE ×40, DEER ×20 on GRASS: the candidate list and its shuffle, and the order objects take tiles in | AoE2RMSIDE / *controls* `+window-full` (picks reach the last two rows and columns), `+uniform` (1 draw per object) |
| 29-30 | ob2a-noshuffle | n2; 1000, 1001 | GOLD ×30 without `enable_tile_shuffling` | still shuffled (AoE2RMSIDE; same map as ob2b) / `+scan-order` (guide and preview: the first entries) |
| 31 | ob2b-shuffle | n2; 1000 | the same with the flag | same map as ob2a / `+flag-adds-shuffle` |
| 32-33 | ob3-player | n2-brit; 1000, 1001 | per-player TOWN_CENTER at distance 0; STONE in a square band 8-10; GOLD in a circular band; FORAGE `find_closest`; DEER `find_closest` + `enable_tile_shuffling`; BOAR `find_closest_to_map_edge`; player-owned SHEEP | AoE2RMSIDE / *controls* `+ties-unshuffled` (DEER), `+square-band` (GOLD) |
| 34-35 | ob4-grouping | n2; 1000, 1001 | 3 groups of 6 on small DIRT clumps (`terrain_to_place_on DIRT`), tight, loose and unstated; DEER with `group_variance 3` | AoE2RMSIDE (tight members are checked as the group grows) / `+tight-default` (unstated = tight; the preview measured loose) / `+tight-anchor-only` (the preview measured that tight checks only the anchor: its tests 1, 8, 9 and 18) |
| 36-37 | ob5-zones | n2; 1000, 1001 | a lake, cliffs, forest: `avoid_forest_zone 4` and bare, `place_on_forest_zone`, `avoid_cliff_zone 3` and bare, `min_distance_to_map_edge`, `max_distance_to_other_zones 5`, `min_distance_group_placement`, `temp_min_distance_group_placement` | NOT MODELLED (class filters): land, cliffs, forest and the terrain objects are predicted; the script objects are not (GOLD, the first, already uses a filter). Save as an observation |
| 38-39 | ob6-objgroups | n2; 1000, 1001 | 40 each of a 10/90 group, a 50/50 group and a 30/30/40 group | weight ≤ roll (AoE2RMSIDE, build 48987) / `+weight-ge-roll` (its other profile) / `+cumulative` (plain weights). 10/90 separates the first two: about 95 % vs 15 % first entry |
| 40-41 | ob7-actor | n2; 1000, 1001 | two `create_actor_area` with one id; `actor_area_to_place_in`; `actor_area` with and without a radius (default 1); `avoid_actor_area` twice; `avoid_all_actor_areas` | NOT MODELLED (actor areas). Save as an observation |
| 42-43 | ob8-lands | n2; 1000, 1001 | two lands with `land_id 7`: `place_on_specific_land_id` (with distance, with `avoid_other_land_zones`, with `generate_for_first_land_only`); per player with `avoid_other_land_zones`; per player with no distance band | NOT MODELLED (specific lands): land and terrain are predicted, objects are not. Save as an observation |
| 44-45 | ob9-starts | n2-brit; 1000, 1001 | a standard start: TC, VILLAGER (count 1), SCOUT, 2 HOUSEs, SHEEP, frameless RELICs with `min_distance_to_players 40` (raised from 25, where the relics landed far enough by chance and the control gave the same map) and `temp_min_distance_group_placement` | AoE2RMSIDE / `+noexpand` / `+relic-ignores-players` (preview says min distance applies frameless) |
| 46 | ob9-starts | n2-brit-azt; 1000 | the same with player 2 Aztecs: SCOUT becomes an eagle; any replacement roll moves later draws | AoE2RMSIDE |
| 47-48 | ob10-misc | n2; 1000, 1001 | `second_object`; `set_facet 2`; `min_connected_tiles 30` on DIRT clumps (the guide says it is biased to the top left); `force_placement` of 15 sheep on a 3×3 SNOW land | partly NOT MODELLED (`min_connected_tiles`, `force_placement`): GOLD with `second_object` and FORAGE with `set_facet` are predicted, the rest is an observation |
| 49 | ob11-scaling | n2; 1000 | `set_scaling_to_map_size`, `set_scaling_to_player_number`, both in one block | the later wins (guide) / `+first` |
| 50 | ob11-scaling | n4; 1000 | the same with 4 players | the same readings |
| 51 | ob11-scaling | n2; 1000; size 200 | the same at size 200 | the same readings |
| 52-53 | ob12-habitat | n2; 1000, 1001 | islands on WATER: per-player GOLD with `set_gaia_object_only` (stays on its island) and STONE without it (places nothing, confirmed in game); FISH; SHORE_FISH on WATER; frameless SALMON with `ignore_terrain_restrictions` (inert, RMSTEST_42) | AoE2RMSIDE (the island separation comes from the restriction check against the player's own tile) |
| 54 | ob13-walls | n2-brit; 1000 | a PALISADE_WALL ring at 14-16 (the wall router and its stream-6 draws) | NOT MODELLED (walls): the TC is predicted, the wall is an observation. Low priority |

## Part X: every stage on a real-shaped map (2 maps)

| # | File | What it tests |
|---|---|---|
| 55-56 | `xr1-real_1000_n4t1122-brit_size-200`, `xr1-real_1001_n4t1122-brit_size-200` | player lands, a central lake, scaled hills, forest, team roads through forest and players' roads across the lake as SHALLOW, a full start (TC, villagers, scout, tight gold, stone, berries, sheep, loose boar, deer, relics, straggler trees, fish). Never run with players at Normal size |

Scripts to copy (33): `cn1-path`, `cn2-size`, `cn3a-sizedecl`, `cn3b-sizeomit`, `cn4-cost`, `cn5a-blockfirst`,
`cn5b-blocklast`, `cn6a-cascade`, `cn6b-accumulate`, `cn7a-teams`, `cn7b-samezones`, `cn7c-zones`,
`cn7d-nonplayer`, `cn7e-teamsnonplayer`, `cn8a-dig`, `cn8b-ford`, `cn8c-beachterrain`, `cn9-burn`, `ob1-scatter`,
`ob2a-noshuffle`, `ob2b-shuffle`, `ob3-player`, `ob4-grouping`, `ob5-zones`, `ob6-objgroups`, `ob7-actor`,
`ob8-lands`, `ob9-starts`, `ob10-misc`, `ob11-scaling`, `ob12-habitat`, `ob13-walls`, `xr1-real` (all `.rms` in
`tests\`).

## Not covered by this round, and why

- **Not in AoE2RMSIDE's object reader, so no reading to test:** `find_closest_to_map_center`, `match_player_civ`.
  They can be run later as plain observations.
- **Needs a layout of its own:** `require_path` (needs a frame and obstacles; AoE2RMSIDE keeps the no-route result
  as a profile setting, so expect two readings); `layer_to_place_on`; `override_actor_radius_if_required`.
- **Probably not observable:** `resource_delta` (the saved scenario may not store resource amounts; check while
  writing `compare_co.py`), `set_gaia_unconvertible`, `set_building_capturable`, `make_indestructible`.
- **Large and rare:** stone walls and gates, farms, buildings that paint foundations, later starting ages, game
  modes (regicide, King of the Hill), nomad starts.
- **Connections:** origins off the map (the game crashes), `terrain_size` larger than the map (only slow),
  `to_nonplayer_land` with more than 2 players beyond cn7e, connections to lands with `land_id`.

## Compare

From `tests\`. Round CO maps against `co_predictions.pkl` (main reading, then each variant):

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_co.py 2>$null
```

Part 0 again (the saved EC/EC2/ET maps; `READING=noburn` or `READING=aux-on-primary` for the controls):

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_part0.py 2>$null
```

Part 0c (the p4o maps):

```powershell
$env:PYTHONIOENCODING = "utf-8"; ..\.venv\Scripts\python.exe compare_part0c.py 2>$null
```

Part X's `xr1-real` and every map on a NOT MODELLED list will report differences in their script objects; read
those as observations. `xr1-real`'s GOLD (with `avoid_forest_zone`) is its fourth object descriptor, so its TC,
villagers and scouts are predicted and the rest is not.
