# DE's connection and object stages, measured (write-up for the preview revision, 2026-10-28)

What Age of Empires II DE does in `<CONNECTION_GENERATION>` and `<OBJECTS_GENERATION>`, and what happens to the terrain's own objects (trees, decorations) from the land stage to the end, in our own words. It continues `de-land-stage.md` (the generator, the draw notation, the land stage), `de-elevation-cliffs.md` (its Section 2 on lists, 5.4 on decoration draws, 5.7 on the end of the terrain stage) and `de-terrain-stage.md`. It is written for the age-of-rms preview spec (`docs/preview-design.md` rev 10, Sec.6.5 and 6.6). Section 10 lists where it overturns that spec. No code from any other project is reproduced here; Section 12 says where the first leads came from.

**Status, more than in the earlier write-ups, is uneven.** The connection stage is exact on every map tested. The object stage is exact for the attributes in Sections 5 to 8. Several attributes common in real scripts are only measured (Section 9), and two rules found after round CF have not yet been tested on fresh maps (marked *found after the run*).

## Scope and confidence

- **Build:** DE 101.103.54800.0.
- **Instrument:** as before. Maps generated in the scenario editor (Seed Map, the seed typed in, Tiny unless stated, Team Positions ticked, unused slots allied with nobody), saved, and read back with AoE2ScenarioParser: every tile's terrain, elevation and layer, and every object's type, owner, position (to 1/256 tile), facing and status, in the file's order.
- **Rounds:** CO (2026-10-28, 56 maps: 26 connection maps, 28 object maps, 2 real-shaped maps at size 200), its Part 0 (161 maps from earlier rounds re-read for their terrain objects and villagers), and CF (2026-10-28, 39 maps: confirmations on new layouts and seeds 1002 and 1003, plus measurements). Predictions were written before each run (`tests/co-predictions.md`, `tests/cf-predictions.md`).
- **Result:**
  - Connections: **26 of 26 CO maps** and every CF connection map match tile for tile, once one rule found after round CO is applied (3.3). Round CF confirmed that rule on new layouts.
  - Terrain objects: **95 of 95** maps from rounds EC, EC2 and ET match object for object (Part 0a); 55 of the 66 land-round maps with villagers match (the other 11 are the stale-alliance land maps of `de-land-stage.md`, wrong before any object is placed).
  - Scripted objects: **every map whose attributes are all covered matches, object for object, facing included: 45 of 45 in round CO, 26 of 26 in round CF.** That needed six rules found after round CO (all confirmed in round CF) and two found after round CF (not yet confirmed).
  - 24 maps use attributes we have only measured (Section 9).
- **Controls:** every reading was predicted both ways where sources disagreed, and every deliberately wrong control fails its maps, except where the run sheet said beforehand that a map could not tell two readings apart.
- **Status tags:** as before. *Found after the run* means the rule was found by looking at a map it then explains, and no map predicted beforehand has tested it. *Untested* means no DE map exercises the rule.
- **No second implementation from this text yet.** The other three write-ups were each re-implemented from their text alone (`writeup_check*.py`). This one has not been, and that is planned for the next round.

Notation as before: `draw(n)` is one bounded draw `⌊n · raw / 2³²⌋` from the shared stream, `raw` one unreduced 32-bit output. Tile `(x, y)` is the scenario file's coordinate, index `y · W + x`. "Left" is x − 1, "up" y − 1. Distances are Chebyshev (the larger of |dx| and |dy|) unless stated.

## 1. Where the stages sit, and the second stream

1. Land, elevation, cliffs, the terrain stage and its end (cliff lines restored, WATER cleanup, beaches), as in the other write-ups.
2. **Connections** (Sections 2 and 3), only if the script has a `<CONNECTION_GENERATION>` section.
3. **Object stage:** one burned draw, then the terrain's own objects for the whole map (4.4), then every `create_object` in script order (Sections 5 to 8), then building foundations (8.4).

**Two streams.** Everything that decides *where* (paths, rectangles, candidate shuffles, decoration rolls, group rolls) comes from the shared stream of `de-land-stage.md` Section 1. **Facings and a few other per-object values come from a second stream: generator 6 of the same seeding chain** (generator k + 1 is seeded with generator k's first output; like generator 2, generator 6 is used from its second output). We call it stream 6. It advances once per random value an object is built with (8.1), wherever in the stages that happens, and never otherwise.

*Tested:* every facing in every matched map. On Part 0a's two control maps, facings from the shared stream leave only 11 and 0 terrain objects as they are in DE.

## 2. Connections: the commands and their endpoints

### 2.1 The section

The section costs **one burned draw** at its start, even when it holds no command (cn9: an empty header on GRASS; without the draw, every decoration of the object stage moves). With no section header, no draw.

### 2.2 One command's table

Each `create_connect_*` command has a table with an entry per terrain: **cost 1, size 1, variance 0, no replacement** by default. In script order:
- `default_terrain_replacement T` sets every terrain's replacement to T;
- `replace_terrain A B` sets A's replacement;
- `terrain_cost A c` sets A's cost (a decimal is kept: cn4 crosses a FOREST wall at cost 2.5);
- `terrain_size A s v` sets A's size and variance.

So a `default_terrain_replacement` after a `replace_terrain` overwrites it, and one before it does not.

*Tested:* cn3a and cn3b. `terrain_size GRASS 1 0` written out and left out give the same map (the default is size 1, variance 0). The guide's hidden-variance reading ("default 1 1") fails, so RMSTEST_70's fragmented road is explained elsewhere (most likely by 3.3).

### 2.3 Endpoints

An endpoint is a **land's origin tile**. A command's endpoints are, in land order:

| Command | Endpoints |
|---|---|
| `create_connect_all_players_land` | every player land |
| `create_connect_all_lands` | every land |
| `create_connect_same_land_zones` | **every land, exactly as `all_lands`** |
| `create_connect_land_zones A B` | the lands in zone A, then the lands in zone B (zones as the script writes them: player k's land is k − 10, a `create_land` without `zone` is −10) |
| `create_connect_teams_lands` | one command per team (below) |
| `create_connect_to_nonplayer_land` | per player, a copy (below) |

Then **every pair i < j of the endpoints**, in that order ((1,2), (1,3), …, (2,3), …), gets a path from i to j. That includes pairs within zone A in `land_zones` (cn7c: the "A-to-B only" control fails).

**Teams.** Teams are numbered in slot order. A player without a team is a team of one. The command keeps team 1's player lands; each further team gets a copy of the command, added **at the end of the command list**, in team order. A team of one has no pairs, so a lobby without teams connects nothing (cn7a, n4: the "everyone on one team" control fails), but its copies still count as commands for 3.3.

**`to_nonplayer_land` and its bug.** Walk the lands in order with a count p of player lands seen so far (start at 0):
- a non-player land is added to the command and to every copy made so far;
- a player land: first p + 1 empty commands (cost 0 everywhere, no endpoints) are added at the end of the list, then a copy of the command, holding the non-player lands seen so far plus this player's land, is **written over the command p + 1 places after it**, and p goes up by one.

So with k players the next k commands of the script are overwritten by the copies and never run; later ones survive (cn7d: `all_players_land` and `all_lands` vanish, `land_zones 1 −10` survives, and two neutral lands connect to each other). This is the guide's "blocks the commands after it" seen exactly. The guide's "blocks every later command" fails cn7d, and so does a version without the bug. After `teams_lands`, whose team copies sit at the end of the list, it overwrites those copies, so only team 1's roads survive (cn7e, the guide's second bug).

*Tested:* cn1 (pair order), cn7a-e, k2 (3 players, new layout), k10a/k10b (`same_land_zones` and `all_lands` give identical maps on two seeds; the preview's grouping by zone fails by about 950 tiles), cn7b.

## 3. Connections: paths and painting

### 3.1 The path search

A **best-first search** over 8 neighbours. It is not shortest-path: a tile is queued once, when first reached, and never improved.

- **Closed tiles:** a tile whose cost is 0 or less is never entered. A diagonal step also needs **both side tiles open** (no corner cutting; cn4's control with corner cutting fails).
- **Ends:** if the target's cost is 0 or less the pair fails at once. The start's own cost is never looked at. So **a cost-0 land origin blocks paths arriving at it but not paths leaving it** (cn5a and cn5b; the preview's "both directions" and "neither" each fail one of them).
- **The loop.** Start at the start tile with cumulative cost 0. For the current tile, compute d = √(dx² + dy²) to the target (single precision); if it is 0, the path is found. Otherwise look at the neighbours in the order **down, up, left, up-left, down-left, right, up-right, down-right**:
  - the target: the path is found through it, at once;
  - a tile already seen, or off the map: skipped;
  - a closed tile: marked and skipped; a diagonal with a closed side tile: skipped, not marked;
  - otherwise it is queued with cumulative cost = current cost + its terrain cost × (1.36 for a diagonal step, else 1), and priority = cumulative cost + h. **h is built from d, the current tile's distance, not the neighbour's:** for a straight step, d − 1 if the step moves toward the target on its axis, else d + 1. For a diagonal step, first ±1 for the x part, then ±0.41 for the y part on the two left diagonals and ±0.4 on the two right ones (− when the step moves toward the target on that axis).
  - Then pop the lowest priority; **ties go to the one queued last.** An empty queue means no path.

*Tested:* cn1 (three dots, size 0: the bare paths), cn4 (detours around cost 0, a decimal cost crossing), on two seeds each; an optimal 4-neighbour search (the preview's) fails both. Every connection map since.

### 3.2 Painting one path

The path's tiles are taken from the target back towards the start. **For each one, the tile before it on the path is a centre**, so the centres run from the tile next to the target back to the start: the start is painted and the target is not (cn1; painting the target too fails).

For each centre in that order:
1. Read the size s and variance v of the terrain under the centre **now**.
2. Four draws: left, top, right, bottom, each `draw(2v)` (spent at v = 0 too; cn3a's "no draw at variance 0" fails).
3. The rectangle from x − (s − v + left) to x + (s − v + right) and from y − (s − v + top) to y + (s − v + bottom), clipped to the map, joins this path's set.

Then **every tile of the set takes its terrain's replacement** (if it has one). Sizes are read before the path paints, so within one path they come from the terrain before it; **later paths of the same command see this path's paint** (cn6a; a version frozen at the command's start fails).

*Tested:* cn2 (sizes 2 1 and 3 3: the rectangle; the guide's disc and a one-draw square fail), cn3, cn8b (the usual ford idiom, cost 3, size 2 1).

### 3.3 Between commands: the undo

When the list holds **more than one command** (after 2.3's copies) and the script has no `accumulate_connections`:
- Commands run in list order, each on the map the previous one left.
- When a command ends, **every tile it painted gets back the terrain it had just before this command's last paint of it.** A tile painted once by the command gets its pre-command value back. A tile painted twice keeps the first paint's result.
- When all commands are done, the map returns to the stage's starting terrain, and then **every tile any command painted takes the last terrain painted on it**, in command order.

So commands do not see each other's roads, except where a command painted a tile twice: that leftover is visible to every later command's search, sizes and replacements. That is how cn6a's second command finds DESERT where the first command's paths overlapped, and how cn7d's last command reads ROAD's default size on a road painted twice.

With `accumulate_connections`, or a single command, everything is live: each command sees every earlier paint (cn6b).

*Found after round CO's run* (`connection_model` reading `undo-last`), **confirmed in round CF** (k1 and k2, new layouts, seeds 1002 and 1003; the old "each command from the stage's start" and "everything live" both fail). Two other readings were tried on the CO maps and rejected: sizes and replacements from the live map (fixes cn6a, breaks cn4, cn7d, cn7e and xr1), and replacements alone from the live map (breaks xr1).

### 3.4 End of the connection stage

1. **The WATER cleanup** of `de-elevation-cliffs.md` 5.7 step 2, again, over the whole map.
2. **The beach rule** of 5.7 step 3, again: 8 neighbours, on a copy taken after step 1. It paints only plain land and ice-type tiles, so a custom beach from `beach_terrain` (DLC_BEACH2) is left alone (cn8c; the guide says connections break `beach_terrain`, and that reading fails).

Terrain objects on changed tiles are handled as in 4.3.

*Tested:* cn8a (a 5-wide connection painting WATER: no pass and a 4-neighbour pass both fail), cn8c, k3.

## 4. The terrain's own objects

Each terrain has a table of objects in the game data (the dat's `terrain_unit_id`, `terrain_unit_density` per thousand, `terrain_unit_centering`): trees for forests, decorations for the rest.

### 4.1 Drawing one tile's table

`de-elevation-cliffs.md` 5.4 gives the draws. Per entry, in table order:
- **randomized:** weight 0 draws nothing. Otherwise two raws, x and y; at weight 1000 the entry is accepted, else a third raw r and it is accepted when `⌊1000 · r / 2³²⌋ < weight`;
- **centred:** weight 0 or 1000 draws nothing (1000 accepted); otherwise one raw, accepted by the same test.

An accepted entry makes an object if it fits:
- **Position:** randomized at (tile + x / 2³², tile + y / 2³²) in single precision, clamped to the tile; centred at the tile's centre.
- **Fit:** the object's placement square must lie on the map, and its terrain restriction must accept every tile under it (a terrain "refuses" when its traversal cost for that restriction is 0.05 or less). An object with a collision size must also not overlap the objects listed for that pass (below).
- **Facing:** see 8.1. Every object made in the land and cliff stages spends one stream-6 draw.

### 4.2 Where tables are drawn

- **Land stage:** each tile the land cleanup restores to the base terrain (`de-elevation-cliffs.md` 3.0). It must fit on the land stage's terrain and not overlap earlier land-stage objects that have a footprint. Painting a land draws nothing.
- **Cliff stage:** each tile a cliff line refreshes. The objects on it that belong to the old terrain's table, or that the new terrain refuses, are destroyed, then the current terrain's table is drawn. It must not overlap nearby objects or the cliff pieces.
- **Object stage:** every tile (4.4).
- `create_terrain`, connections and the end-of-stage steps draw nothing.

### 4.3 When a tile changes without a redraw

At the end of the terrain stage (cliff lines restored, WATER cleanup, beaches) and in the connection stage, a changed tile **loses the objects that belong to its old terrain's table and those whose restriction refuses the new terrain**. One exception: **a tile turned into a beach keeps its objects unless the beach refuses them** (cn8b; *found after round CO's run*, **confirmed in round CF**, k3 on two seeds: grass decorations stay on tiles that become BEACH). *Untested:* whether ICYSHORE behaves the same.

### 4.4 The object stage's pass

After the stage's burned draw, every tile in index order (row by row):
1. **Retire** the objects on it, made in earlier stages, that belong to the tile's current terrain's table. They get status 7: **they stay in the saved map**, dying, and block nothing.
2. **Draw the table** (4.1). A new object must not overlap the cliff pieces, objects made in this pass, or earlier objects that were not retired (those whose tile changed terrain since they were made). Its facing draws follow 8.1.

So a terrain's table is drawn twice where the land or cliff stage drew it, and the first set is kept as status 7.

*Tested:* Part 0a, 95 of 95 maps, every object by type, position, facing and status, in the file's order. The burned draw: without it only 29 and 1 terrain objects of the two control maps stay where DE has them. A FOREST base restores trees with stream-6 draws but spends no shared-stream draw (gr5-forest).

## 5. Scripted objects: order, counts, owner

### 5.1 Order and dispatch

`create_object` commands run in script order. A command with `set_place_for_every_player` runs once **per player land, in land order** (a land of a `create_player_lands`), each time with that land's origin as its **frame**. Without it, the command runs once with no frame.

A `create_actor_area` places nothing. *Untested* beyond that: what it records (Section 9).

### 5.2 How many groups

Let n = `number_of_objects` (default 1), g = `number_of_groups`, v = `group_variance` (default 0).
- **`number_of_groups` sets loose grouping** unless `set_tight_grouping` or `set_loose_grouping` says otherwise (ob4; "unstated means tight" fails). Without grouping, **n > 1 means n separate single-object groups**.
- Groups requested: g with grouping, n without. With `number_of_objects 0` and no grouping, nothing.
- **`set_scaling_to_map_size`:** groups × W · H / 10000, rounded down, at least 1. **`set_scaling_to_player_number`:** × the number of players. **With both, the later line counts** (ob11 at 2 and 4 players and at size 200; the first-wins control fails).
- Members per group: n, or with v > 0, n − v + `draw(2v)`, drawn when the group is placed; at least 1.
- **Starting villagers:** a framed command for one VILLAGER becomes the civilization's starting-villager count (3) of single objects (ob9; "one villager" fails).

*Tested:* ob4, ob9, ob11; every object map.

### 5.3 Owner, availability and replacements

- **Owner:** the frame's player, or gaia with `set_gaia_object_only` or without a frame.
- **Availability:** an object goes to a player only if that player's civilization has it. **Gaia resources (STONE, GOLD, FORAGE, DEER, BOAR, trees, RELIC) belong to no civilization**, so a framed command for one of them without `set_gaia_object_only` places nothing. It still spends its candidate shuffle (6.1) and its first resolution (7.4), then stops. SHEEP and TURKEY are available, and are placed as player-owned. **This holds with a RANDOM civilization too:** DE has chosen a real one by the time the map is generated (k7 at RANDOM on two seeds, and with Britons; ob12). *Found after round CF's run*: the predictions treated RANDOM as gaia and placed 24 to 32 objects where DE placed only the 6 sheep. The rule then reproduces both k7 maps, the sheep's angles included.
- **Replacement rolls.** Some objects have a replacement rule in the data: VILLAGER (male → female at a roll of 50 or less), SCOUT (the civilization's scout), a few buildings behind technology gates (never met at the start; no roll), and the TOWN_CENTER rule behind a civilization attribute (no roll when the civilization lacks it). Every time the object is resolved under such a rule, **one `draw(100)`** is spent. The saved map keeps **Scout Cavalry for every civilization**: the roll is spent, but the civilization's own scout (Eagle Scout for the Aztecs, for example) is not what the editor saves (ob9 Aztecs; k8 with Aztecs, Incas and Gurjaras; applying it fails). 7.4 says how many resolutions each placement makes.

### 5.4 Object groups (`create_object_group`)

Each time a group's member is picked: one `draw(100)`, the roll R. **Keep the entries whose weight is at least R**; pick entry `R mod (number kept)` among them; if none is kept, the first entry.

*Found after round CO's run* (ob6; the "weight at most R" reading puts only 36 and 37 of 120 objects in place), **confirmed in round CF** (k6 on two seeds, including a 100/0 group; plain cumulative weights fail). A 50/50 group keeps both entries when R ≤ 50 and picks by R's parity, and falls back to the first entry when R > 50: about 75/25, which is what community measurement found after Update 185872.

## 6. Scripted objects: candidates

### 6.1 The candidate list and its shuffle

1. **The window:** the whole map less `min_distance_to_map_edge` on each side. With a frame and `max_distance_to_players m`, the square of half-size m around the origin, inside that. With `set_circular_placement` as well, only tiles within m by Euclidean distance.
2. **The list:** every window tile not yet made unavailable (6.4), row by row.
3. **The shuffle, always:** with x_range = width − 2 and y_range = height − 2 of the window (both must be above 1, and the map at least 3 × 3), ⌊x_range · y_range / 4⌋ times: x = left + draw(x_range), then y = top + draw(y_range). If (x, y) is in the list it moves to the front (one already moved moves again). **The window's last two rows and last two columns are never picked** (ob1: reaching them fails).

**`enable_tile_shuffling` does not turn the shuffle on.** It is always on (ob2a and ob2b give the same map; the guide's and the preview's "first entries in scan order" fails). The flag only matters for `find_closest` ties (6.2).

*Tested:* ob1 (frameless scatter: picks reaching the whole window fail, and so does one uniform draw per object), ob2a/ob2b, ob3; every object map.

### 6.2 Closest-first orders

With a frame, `find_closest`, `find_closest_to_map_center` or `find_closest_to_map_edge` reorders the shuffled list:
- `find_closest`: by squared distance from the origin (by ⌊√⌋ distance under `set_circular_placement`), nearest first;
- `..._to_map_center`: by distance from the map's centre tile (W/2, W/2), squared or rooted as above; a value of 1 reverses it (farthest first);
- `..._to_map_edge`: by distance to the nearest edge; 1 reverses it.

Tiles closer than `min_distance_to_players` are dropped first. The list is sorted farthest first, ties in their shuffled order; **with `enable_tile_shuffling`, each run of ties is then shuffled again** (forward Fisher-Yates: for k = 1, 2, …, swap entry k with entry `raw mod (k + 1)`, the raw redrawn when it falls past the last whole multiple of k + 1). Finally the whole list is reversed, so the nearest come first and **ties come in reverse order**.

*Tested:* ob3 (DEER with the flag: leaving ties unshuffled fails; FORAGE without it; BOAR to the edge), u8 (`find_closest_to_map_center` single, loose and tight; predicted, identical).

### 6.3 Taking candidates

Groups take candidates from the front of the list. A candidate is refused if it fails any test below; a refused candidate is gone for this command.

**The command's tests:**
- `terrain_to_place_on T`: the tile is T.
- **Terrain restriction, framed commands only:** the object's restriction must accept the tile's terrain, or the tile has the same terrain as the frame's origin tile. Skipped with `ignore_terrain_restrictions`, with `max_distance_to_players 0`, and with `max_distance_to_other_zones`. Frameless commands rely on the object's own check below, so a frameless `ignore_terrain_restrictions` does nothing (as RMSTEST_42 found; ob12's SALMON).
- **`min_distance_to_players d`:** at least d from every player land's origin (square, or Euclidean under `set_circular_placement`), frameless too. `min_distance_to_map_edge` again.
- **`max_distance_to_players m`:** only with a frame (frameless it does nothing).
- `avoid_other_land_zones [d]` (with a frame): the tile is in the frame land's zone; with d, so are the tiles d + 1 away in the four straight directions.
- `max_distance_to_other_zones d`, framed commands only in our model: *untested* (ob5 and xr1 use it alongside unmodelled attributes). The tile and the eight points d away (⌊10d/14⌋ on the diagonals, clamped to the map) must lie in the same 4-connected area of terrain the object accepts.

**The object's own checks** (from the game data; these also apply to every member of a tight group, 7.2):
- the placement square lies on the map and the object's restriction accepts every tile under it (`ignore_terrain_restrictions` with a frame lifts this);
- centre and side terrain lists, for objects that have them (shore fish, for example);
- the slope rule of the object (flat only, or gentle slopes);
- **no overlap:** its placement rectangle against the collision rectangles of objects already placed (cliff pieces and earlier scripted objects included), and of terrain objects still on the terrain they were made for. Objects that can be built on (decorations) never block. Moving units have exemptions for units of the same owner or gaia.

*Tested:* every object map; ob12 (islands: per-player GOLD stays on its island without any reachability test), ob3 (circular band; ignoring `set_circular_placement` fails), ob9 (frameless RELIC at `min_distance_to_players 40`; ignoring it frameless fails). The slope rules and side terrains are exercised only where the probes needed them.

**A framed last resort:** when a framed, ungrouped candidate fails only the object's own checks and the list is then empty, the object is placed there anyway (farms excepted). *Untested on purpose.*

### 6.4 Spacing between placements

After each group is placed at anchor (x, y):
- the anchor, and with `min_distance_group_placement r` or `temp_min_distance_group_placement r` every tile within r, leave this command's list;
- with `min_distance_group_placement r`, every tile within r whose terrain the object accepts becomes **unavailable to every later command** too. Resolving the object for this check is one more resolution (7.4).

*Tested:* ob9 (`temp_...`), ob10 (`min_distance_group_placement 6` with `second_object`), ob5 (alongside unmodelled attributes).

## 7. Scripted objects: placing a group

### 7.1 Single objects

A group of one object at its anchor.

### 7.2 Tight groups

Members: 5.2. A **queue of tiles with scores**, starting with the anchor at score 0, inside the square of `group_placement_radius` (default 3) around the anchor. Repeatedly, until the member count is reached or the queue is empty:
1. Take the lowest score (the queue keeps scores in order; a new entry goes before the first entry whose score is at least its own, as the lists of `de-elevation-cliffs.md` Section 2).
2. Skip it if it fails `avoid_other_land_zones`. Otherwise place the member there and mark the tile unavailable (to later commands too).
3. For its neighbours left, right, up, down inside the square: **if the object's own checks pass there** (6.3), take it out of the command's list, give it the score `raw & 0x7FFF`, and (re)insert it.

So a tight group checks every member against the object's terrain restriction, slope and overlaps as it grows, **but not against the command's tests** (`terrain_to_place_on`, distances). That is why the preview's tests saw tight groups spill off a DIRT patch onto grass. The anchor-only reading fails ob4.

### 7.3 Loose groups

1. A local window: the square of `group_placement_radius` around the anchor, inside `min_distance_to_map_edge`; with `set_circular_placement`, the disc of that radius.
2. Its available tiles row by row, then a shuffle like 6.1's on that window (only tiles that are available can move to the front).
3. The member object is resolved, and the member count drawn (5.2). The window's tiles leave the command's list.
4. Members take tiles in order. A tile is skipped if it fails `terrain_to_place_on` or the object's own checks.

*Tested:* ob4 (tight, loose and unstated, with `group_variance 3`), k6 (groups of a group), u8 (loose and tight near the centre), xr1 (a real start).

### 7.4 How many draws a placement costs

Draws come from rolls whose count depends on the object: a group roll (5.4) only for an object group; a replacement roll (5.3) only for an object with a rule (VILLAGER, SCOUT among those our probes use). For an object without either, resolving costs nothing, and only the shuffles, group-size draws and tight scores spend draws.

A **resolution** of a command's object is: for an object group, a group roll and then the picked entry's replacement roll (if that entry has a rule); for a plain object, its replacement roll (if it has a rule). The resolutions are tested only on VILLAGER (both sexes: 66 land maps and ob9), SCOUT (ob9, k8) and groups (ob6, k6), so an implementation should follow them exactly:
- per command, after the shuffle and the closest-first order: one resolution; a plain object then a second;
- at the start of a tight group: one resolution (the object its members are checked as); a plain object then a second;
- at the start of a loose group: a group roll for a group, two resolutions for a plain object; then the member-count draw;
- per member: one resolution; with a frame and no grouping, a group spends one extra group roll first and a plain object one extra resolution;
- `second_object`: one resolution of the second object;
- after each group: one more, for the spacing check (6.4);
- starting villagers: two at the start, then per villager two before placing it and one after.

## 8. Scripted objects: building an object

### 8.1 Position and facing

- **Position:** the tile, plus a half tile on each axis whose collision size is odd, in 1/256 tile, kept at least the object's half-size (plus its edge margin) from the map's edges. Moving units are then kept a further 0.01 inside.
- **Facing, from stream 6 (1),** in this order, one draw `s` per flag the object's data sets:
  - random facet: facet = min(⌊facets · (s & 0x7FFF) / 0x7FFF⌋, facets − 1);
  - random angle: sector = ⌊facets · (s & 0x7FFF) / 0x7FFF⌋, angle = sector · 2π / facets. **The file stores this angle** (Part 0c; the facet derived from it is shifted by π/4);
  - random combat seed: one draw, no visible effect.
- **FORAGE draws a random facet over 4 facets** from stream 6, although the data gives it one facet and no draw. *Found after round CO's run* (ob3, ob4: every later facing on stream 6 shifted; 3, 5 and 8 facets fail), **confirmed in round CF** (k4, two seeds).
- `set_facet f` overrides the facet after the draws (ob10).

### 8.2 Parts and second objects

- A town centre builds its parts (the data's attachments). **The saved map leaves them out.**
- `second_object X` places X at the first object's exact position, resolved like any object (ob10).

### 8.3 Decorations under a new object

When an object with a collision size is built, **every terrain object that can be built on and lies within both collision half-sizes of it (within 4 tiles) is deleted** from the map. They are not kept at status 7. *Found after round CO's run*, **confirmed in round CF** (k5 on two seeds, under GOLD, STONE, RELIC and gaia HOUSEs; keeping them at status 7 fails).

### 8.4 Foundations

After the last command, each building with a foundation in the data paints its footprint (less the data's omitted cells) with the foundation terrain, where the terrain is one the data lists as compatible. **Only player-owned buildings do: a gaia building paints nothing.** *Found after round CF's run* (k5: 6 gaia HOUSEs, 24 tiles; u10: 3 HOUSEs, 12 tiles; nothing else differed). Player TCs and HOUSEs paint (every CO map with a TC, k9).

### 8.5 What the scenario file stores

These are file details, not generator rules, but a comparison has to know them:
- child objects (the town centre's parts) are absent;
- objects with a fixed facet in the data (7 for all of these) store a different frame: TOWN_CENTER, HOUSE, WATCH_TOWER, GUARD_TOWER, OUTPOST and RUINS store 0; FISH, SHORE_FISH, GREAT_FISH_MARLIN, FISH_TUNA and SALMON store 5 (k9, ob12);
- random-angle units store the angle (8.1); terrain objects retired at the object stage keep status 7 (4.4).

## 9. Measured but not modelled (rounds CO and CF)

These attributes are in Part U of round CF and in round CO's observation maps. Each measurement says what the attribute does. None says how many draws it spends or in what order it checks, so **none of these is ready to implement exactly**. Distances are Chebyshev between tiles.

| Attribute | Measured | Guide | Maps |
|---|---|---|---|
| `avoid_forest_zone d` | every object more than d from every tree (bare: more than 1) | agrees | ob5, u2 |
| `place_on_forest_zone` | every object exactly 1 from a tree, never on one | agrees | ob5, u2 |
| `avoid_cliff_zone d` | more than d from every cliff piece (bare: more than 1) | agrees | ob5, u2 |
| a grouped `avoid_forest_zone` | every member kept clear | — | u2 |
| `create_actor_area` + `actor_area_to_place_in` | ob7: every GOLD within 6 of one of two areas sharing an id; **u1: placed 0 on both seeds** (unexplained) | "within the area" | ob7, u1 |
| `actor_area` + `actor_area_radius` on placed objects; `avoid_actor_area`; `avoid_all_actor_areas` | avoiders stay outside (STONE at least 15 from an area of radius 12; FORAGE at least 15 from the TCs' radius-14 areas; DEER outside all); HOUSEs with `actor_area_to_place_in` within 12-13 of their TC | agrees | ob7, u1 |
| `place_on_specific_land_id id` with a distance | per land with that id, around its origin | agrees | ob8, u3 |
| `place_on_specific_land_id id` without a distance | **all objects on the first land with that id** (6 on one, 0 on the other) | "3 on each" | u3 |
| `generate_for_first_land_only` | one land only, also for a per-player command (2 BOAR in all, not per player) | "first land" | ob8, u3 |
| `place_on_specific_land_id −11` | anywhere | agrees | u3 |
| `force_placement` | DEER per player within 2: 80 on 54 tiles (stacking). SHEEP on a 3 × 3 land: 9 of 15, one per tile (ob10); **0 placed where TURKEY held every tile** (u4); forced GOLD 0 placed | "stacks" | ob10, u4 |
| `min_connected_tiles n` | groups only on clumps of at least n (61-62 tiles at n = 40); a map with no such clump places none; groups near the top edge | agrees (top-left bias) | ob10, u5 |
| walls | **an exact square ring at the minimum distance** (palisade at 12-13: 76 pieces at 12; stone at 20-21: at 20; ob13 at 14) | "a ring between min and max" | ob13, u6 |
| `require_path` | 1002 identical to the model without it, 1003 moves 2 of 26 objects | "reachable" | u7 |
| `layer_to_place_on` | on the layer (u9: GOLD on SNOW layer, STONE with `terrain_to_place_on` on both); **none when no tile carries the layer** (ll1) | agrees | u9, ll1 |
| `resource_delta`, `set_gaia_unconvertible`, `set_building_capturable` | **change nothing in the saved map** (u10 identical once 8.4 is applied) | — | u10 |

## 10. What this changes in preview-design (rev 10 Sec.6.5, 6.6)

**Sec.6.5 Connections: replace the pathfinding and painting with Sections 2 and 3.** They are exact. Specifically:
- **Search:** the multi-goal Dijkstra goes. DE runs one best-first search per pair over 8 neighbours with the heuristic of 3.1. Its paths are not shortest, so batching per source land is no longer equivalent. The component pre-check stays valid as a shortcut for unreachable pairs.
- **Painted shape:** a rectangle per path tile with four `draw(2v)` side reaches, not a disc with one roll. The start is painted, the target not. The default `terrain_size` is 1 0 (item 39 closed: no hidden variance).
- **Cost-0 origins (BUG-029):** blocks arriving only, not both directions.
- **Accumulation (item 22):** within a command everything is live (later paths read earlier paths' sizes and replacements), so "a tile's value is a pure function of the snapshot" no longer holds. Between commands, the undo of 3.3. RMSTEST_43's single command is consistent with this: with one command there is nothing to isolate.
- **`same_land_zones` = `all_lands`.** The 2026-08-06 correction to group by zone is reversed (k10, cn7b).
- **`to_nonplayer_land`:** it overwrites the next k commands (k players), not all later ones (cn7d, cn7e, k2).
- **Teams:** agrees (no teams, no connections), now measured (cn7a).
- **After the stage:** the WATER cleanup and the 8-neighbour beach rule run again; `beach_terrain`'s custom beach survives (cn8c).

**Sec.6.6 Objects:**
- **Group weights:** `groupMemberProbabilities` goes. One roll R; keep entries with weight ≥ R; pick R mod kept (5.4).
- **Selection:** candidates are always shuffled, with the 6.1 shuffle (not uniform), and `enable_tile_shuffling` matters only for `find_closest` ties. The note about the attribute's absence goes.
- **Tight groups:** members are checked against the object's own terrain restriction, slope and overlaps as the group grows, and not against the command's tests (7.2). This keeps the preview's measurements (Test 8's spill onto grass) and corrects "the fill is checked against nothing".
- **Unstated grouping is loose:** confirmed (ob4). Without grouping, `number_of_objects` n is n single groups.
- **Gaia-only gate:** confirmed and wider. It holds for every gaia resource, at RANDOM civilizations too, and the command still spends draws (5.3). Sheep and turkeys are placed player-owned.
- **Scaling:** the later key wins (ob11), as the spec has it.
- **Frames:** a frame without a distance confines nothing (agrees). `max_distance_to_players` is inert frameless, and `min_distance_to_players` applies frameless (agrees, ob9).
- **`place_on_specific_land_id`** without a distance puts everything on the first land with the id, not some on each (u3, measured). `generate_for_first_land_only` uses one land even per player.
- **Walls:** a square ring at exactly the minimum distance (measured; Sec.9 still excludes walls).
- **`force_placement`:** stacking confirmed for units, but a forced command placed nothing where another object held every tile (measured; unresolved).
- **New, not in the spec:** the facings and stream 6 (8.1); villager expansion and the male/female roll (5.2, 5.3); decorations deleted under objects (8.3); gaia buildings without foundations (8.4); the terrain's own objects and their status-7 copies (Section 4).

**Sec.8 (seeded RNG):** both stages continue the shared stream, with one burned draw each (the connection stage's only with its section). Facings need the second stream (Section 1).

## 11. Not tested

- **The two rules found after round CF** (5.3 RANDOM civilizations, 8.4 gaia foundations) need fresh maps: a RANDOM lobby with player-owned resources on a new layout, and a gaia building other than HOUSE.
- **Everything in Section 9**, which needs a modelled reading predicted before a round. Open questions: u1's GOLD placed 0, u4's forced SHEEP and GOLD placed 0, and how `require_path` spends draws. `compare_cf.py`'s path measurement printed nothing and needs fixing first.
- `max_distance_to_other_zones` on its own; the framed last resort (6.3); slope rules on hills; side terrains other than fish.
- ICYSHORE keeping objects like BEACH (4.3); replacement rules behind technology gates.
- Sizes other than Tiny, except xr1 and ob11 at 200.

## 12. Sources and credit

- **Our tests:** `RMS/de-disassembly/tests/` (archived in `age-of-rms/tools/scenario-probe/de-study/`).
  - `connection_model.py`, `appearance_model.py` and `object_model.py`, chained after the land, elevation, cliff and terrain models, are our own Python models of everything above. Their docstrings list every reading and control.
  - `probe_co.py` and `probe_cf.py` hold the probe scripts. `run-sheet-co.md`, `run-sheet-cf.md`, `co-predictions.md` and `cf-predictions.md` were written before the runs. `compare_co.py`, `compare_cf.py`, `compare_part0.py` and `compare_part0c.py` compare; `diag_co.py` breaks differences down by object type.
  - `results.md` (2026-10-27 and 2026-10-28) holds every result and control. Outputs: `cmp_co.txt`, `cmp_co_posthoc.txt`, `cmp_co_fresh.txt`, `cf_run.txt`, `cf_run_fresh.txt`.
- **AoE2RMSIDE** (github.com/aoe2control/AoE2RMSIDE, Apache 2.0) gave the first reading of the connection and object algorithms, and the study read object data from its content pack (age-of-rms reads the same fields from the dat). The study restated them and tested them on the 95 maps of rounds CO and CF, with predictions written first, and the maps settled the undo between commands, beaches keeping objects, FORAGE's facets, deleted decorations, group weights, the scout, RANDOM civilizations and gaia foundations (each in its section).
- **The scripting guide** gave the attributes and their documented defaults. Where it disagrees with DE (`terrain_size`'s default variance, `to_nonplayer_land` blocking everything, `beach_terrain` breaking with connections, `enable_tile_shuffling`, `place_on_specific_land_id` without a distance), the section concerned names it.
