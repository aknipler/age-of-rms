# DE's object stage: findings from rounds CG to DZ (write-up for the preview, 2026-11-17)

What Age of Empires II DE does in `<OBJECTS_GENERATION>`, and with the terrain's own objects, that
`de-connections-objects.md` (2026-10-28) does not yet say or says differently. In our own words, for the age-of-rms
preview. It completes `de-findings-cg-cj.md` (2026-11-01), which left objects out.

**Precedence.** Where this document and `de-connections-objects.md` disagree, this one is newer and wins. Section 14
lists every sentence of the older write-up that this one replaces. Everything in the older write-up that Section 14
does not list still holds.

## Scope and confidence

- **Build:** DE 101.103.54800.0. Maps made in the scenario editor (Seed Map, the seed typed in, Tiny unless a script
  overrides it, 2 players, Britons unless stated, Team Positions ticked), **each from a fresh editor** (main menu,
  Editors, Create Scenario; see `de-findings-cg-cj.md` Section 1), saved, and read back with AoE2ScenarioParser:
  every tile's terrain, elevation and layer, and every object's type, owner, position (to 1/256 tile), rotation,
  frame and status.
- **Evidence:** the 30 corpus maps (15 real scripts at seeds 1004 and 1005) and the probe rounds CH, CI, CJ, CK, CL,
  CM, CN, CP, CQ, CR, CS and DZ (about 260 maps). Every probe round's predictions were frozen before its first map
  was read.
- **Result, 2026-11-17: every one of the 30 corpus maps is exact in everything**: every tile's terrain, elevation and
  layer, and every object, decoration and stored frame (236,851 of 236,851). Every probe round matches in full: CH
  18/18, CO 61/61, CF (all modelled maps), CK + CL 52/52, CM 46/46, CN and the rock maps 11/11, CP 12/12, CQ 30/30,
  CR 14/14, CS 16/16, DZ 14/14, the 7 wall maps of rounds CF and CO, and the 20 maps of the owner's route tests.
- **Status tags.** Each rule carries one:
  - *Confirmed*: a map predicted before it was made matched the rule, and the deliberately wrong control failed it.
  - *Found after*: the rule was found on the maps it explains. Every saved map agrees with it, but no map predicted
    beforehand has tested it.
  - *Agrees with every map*: every saved map agrees with the rule, and no map isolates it.
  - *Measured*: what DE does in one set-up, without a general rule.
- **Re-implemented from this text** (2026-11-17, `tests/writeup_check_obj.py`): the object stage written again from
  this document and `de-connections-objects.md` Sections 5 to 8 only, plugged into the study's earlier stages. It
  reproduces **all 30 corpus maps object for object** (every object, decoration, position, facing, frame and
  status) and **65 probe maps** (rounds CK, CL, CM, CP and DZ: walls, `force_placement`, `require_path`, actor
  areas, zones). The check found eight places where the text was missing a rule or could be misread; all are fixed
  here: the frame of animated fixed-facet objects (2.3), which player lands get per-player objects (5.1), the
  stored fixed facet (2.1), the zone filter with objects needing no resolution (6.1), the wall search and keep rules
  (8), the origin tile in closest-first orders (6.6), the last-resort placement (6.2 step 4), and the exact checks of
  Section 18. One limit: its author had read the study's model before, so it checks that the text is complete and
  right, not that a stranger would write it the same way.
- **What is not covered:** Section 15.

**Notation** as in the earlier write-ups:
- `draw(n)` is one bounded draw `⌊n · raw / 2³²⌋` from the shared stream (generator 2 of the seed's chain);
  `raw` is one unreduced 32-bit output.
- Tile `(x, y)` is the scenario file's coordinate. "Left" is x − 1, "up" is y − 1.
- **Chebyshev distance** is the larger of |dx| and |dy|. Distances are Chebyshev unless stated.
- An object's **collision half-size** (h_x, h_y) and **placement half-size** (p_x, p_y) are the content pack's
  `collisionHalf…` and `placementHalf…` values, after effects (Section 1).
- A **terrain object** (also: decoration) is an object the terrain's own table makes (`de-connections-objects.md`
  Section 4): trees on forests, plants, rocks. A **scripted object** is one a `create_object` makes.
- A **frame** is the land a command runs for (`de-connections-objects.md` 5.1). A framed command has one; a
  frameless command has none.

## 1. Object data and effects

1. **Effects change the object data before anything is generated**, wherever their lines stand in the script (any
   section). *Confirmed* (CH E: applying only those in `<PLAYER_SETUP>` fails by 722 terrain objects per seed).
2. **Who an effect reaches:**
   - `GAIA_SET_ATTRIBUTE`: gaia's objects only.
   - `SET_ATTRIBUTE`: the players' objects **and gaia's**. *Found after* (Ra), held on the clean re-run.
   - `GAIA_UPGRADE_UNIT A B` (gaia) and `UPGRADE_UNIT A B` (players): see 2.4.
   - A target of 900 + c (below 1000) reaches every object of class c.
3. **`effect_percent` sets the value to (number / 100). It does not scale the current value.** *Confirmed* (CM e3).
   `effect_amount` sets the number itself.
4. **The attributes generation reads**, and so the only ones whose effects change a map:
   - 0, hit points (the status, 2.3; deleting markers, Section 9);
   - 3 and 4, the collision half-sizes (position 2.5, overlaps, deletions under objects);
   - 53, the terrain restriction;
   - 71, the standing graphic (creation draws, 2.1).

   *Measured* (CF u10, CM x1-x3): `resource_delta`, `set_gaia_unconvertible`, `set_building_capturable`,
   `make_indestructible`, `nomad_resources`, `guard_state` and `set_gaia_civilization` change nothing in the saved map.
   *Untested:* `MUL_ATTRIBUTE` and `ADD_ATTRIBUTE` on these five attributes.
5. **A terrain object is a gaia object: its data always carries gaia's effects, also when it is tested against an
   object of a player.** *Found after* (Bazi 1005, 2026-11-17): Bazi's `constants.inc` gives GRASS_SINGLE_GREEN (1358)
   a collision half-size of 0.01 (`effect_percent GAIA_SET_ATTRIBUTE … ATTR_RADIUS_1 1`). A player-2 villager
   (half-size 0.2) built 0.207 tiles from one deletes it, because 0.207 < 0.2 + 0.01 (Section 9). Read with player 2's
   effects, the grass patch has size 0 and survives. Round DZ part B (8 maps, no effect, about 50 grass patches each
   just outside 0.2 of a villager, one of them at 0.207 from a villager at a tile corner, as in Bazi) keeps every one
   of them, so the deletion test itself is unchanged and the effect is what deleted Bazi's.

## 2. Building one object: draws and what the file stores

### 2.1 Creation draws: the content pack's, or derived from the standing graphic

An object's creation draws on stream 6 (`de-connections-objects.md` 8.1) are given by its `creationRng` in the content
pack: `facetCount`, and the flags `randomFacet`, `randomAngle`, `randomCombatSeed`, and `fixedFacet` (present or not).
The draws are spent in the order random facet, random angle, combat seed, one stream-6 raw each (formulas in
`de-connections-objects.md` 8.1). `fixedFacet` spends nothing; it only decides what the file stores (2.3).

**The derived rule.** From the object's constructor type c (`constructorType`) and a standing graphic G with n angles
(`angleCount`) and its two flags:
- `facetCount` = n;
- `randomFacet` when n > 1 and G is flagged both "random facet" and "random angle";
- `randomAngle` when n > 1, G is flagged "random angle", and c is 30, 60, 70 or 80;
- `randomCombatSeed` when c is 70 or 80;
- `fixedFacet` (7) when no angle is drawn and c is 30, 60, 70 or 80.

For all 2,502 objects with both a graphic and a `creationRng`, the derived rule gives exactly the pack's three draw
flags and facet count. **It does not always give the pack's `fixedFacet`** (an object without a standing graphic,
such as 647, has none; constructor-20 objects that draw a random facet also carry one), so use the pack's
`creationRng` as it is, and the derived rule only in these cases:
- **an object with a graphic but no `creationRng`** (26 objects, all constructor type 10 with a 4-angle graphic
  flagged random facet and random angle, among them FORAGE and ROCK_PILLAR): a random facet over the graphic's
  angles, nothing else (no fixed facet). *Confirmed* (CI R). This replaces the older write-up's special rule for
  FORAGE;
- **an object whose standing graphic an effect has changed** (attribute 71): derive from the new graphic and the
  object's own constructor type. If the derived draw flags and facet count equal the pack's, keep the pack's
  `creationRng` (its `fixedFacet` included); otherwise use the derived one, `fixedFacet` included. *Found after* on
  Caverns, whose TC_PLACEHOLDER 1870 gets graphic 12800 (4 angles, both flags): it then draws facet, angle and seed,
  3 draws instead of 1. Round CM e1 (GOLD given 12800) showed that the facet is drawn over the new graphic's 4
  angles, not GOLD's own 7;
- **an upgraded object** (2.4) takes its target's `creationRng` (or the derived rule for the target, as above).

### 2.2 Animation start frames come from a third stream

**Stream 3** is generator 3 of the seed's chain, used exactly as streams 2 and 6 are (`de-land-stage.md` Section 1:
generator k + 1 is seeded with generator k's first output, and the stream is read from its second output). It
starts fresh for every map and nothing else uses it.

- **Every object of constructor type 20 or higher whose standing graphic is flagged "random facet" spends two
  stream-3 raws when it is built**, after its stream-6 draws. Let s be the second of the two. Its stored **start
  frame** is `⌊F · (s & 0x7FFF) / 0x7FFF⌋`, at most F − 1, where F is the graphic's frame count.
- Objects that spend them: flags (1285, 851 does not: its graphic has no flag), PANDA_ROCK (2082), and units whose
  graphic has the flag (sheep 594, turkey 833, scout 448, 1245 and others). Objects that do not: trees (constructor
  10), units whose graphic is flagged random angle only (1028).
- **Frame counts are not in the content pack.** Measured: graphic 10539 (flag 1285) F = 91; graphic 12860
  (PANDA_ROCK) F = 1450. Other objects' frames stay unknown, but **their two draws must still be spent**, or every
  later frame moves.
- *Found after* on Immersion's 8 flags, then checked, not fitted, on Venn's and Bulls_Eyes' flags at both seeds, on
  every panda rock of round CN at three seeds and on Heart's.
- The frame is cosmetic: it changes no position, facing or later draw on any other stream.

### 2.3 What the scenario file stores (replaces `de-connections-objects.md` 8.5)

These are file details, not generator rules, but a comparison has to know them.
- **Child objects** (a town centre's parts, a gate's flanks) are not in the file.
- **Rotation and frame fields:**
  - an object that draws a random facet: the drawn facet, in both fields (an animated object, 2.2, holds its start
    frame in the frame field instead);
  - a unit (constructor 70) with a random angle: the angle in radians in the rotation field;
  - a building (constructor 80) with a random angle (walls, an 1870 with graphic 12800): a facet in the rotation
    field, not radians, and 0 in the frame field;
  - an animated object (2.2) whose frame count is known: its start frame in the frame field, in place of the
    values below; with an unknown frame count the frame field follows the other rules (its two stream-3 raws are
    spent all the same);
  - **a fixed-facet object's frame field holds a value fixed by its constructor type: 5 for type 30** (the fishes 53,
    61, 69, 457, 458, 1141) **and 0 for types 70 and 80** (houses, town centres, the terrain makers 1640/1641, …). For
    other types (flag 1285 among them) the value is not known. *Found after* (1,117 and 9,330 objects on every cached
    map).
- **Wall pieces placed by ordinary `create_object` commands** (not by a wall ring, Section 8) store a joint shape from
  their final neighbours of the same owner: a neighbour above and below gives 1; else left and right 0; else
  up-right and down-left 4; else down-right and up-left 3; else 2 (a post). Their creation draws are spent as usual
  (angle and combat seed). *Found after* (Venn: 38 neighbour patterns, both seeds). This applies only to wall-class
  objects that draw a random angle; the terrain makers 1639-1641 are of the wall class too and store 0.
- **Status:** 2 for a live object; 7 for a retired terrain object (Section 9); **0 for an object whose hit points are
  0 or less, if it is a building and hidden in the editor** (the dat's `hide_in_editor`: 1639-1641, 278, Ra's 1650).
  Other buildings at 0 hit points keep status 2 (a gaia HOUSE set to 0, Caverns' 1870). *Found after* (CH E), held
  on the clean re-run.
- An upgraded object keeps its own id (2.4).

### 2.4 Upgrades

`GAIA_UPGRADE_UNIT A B` (or `UPGRADE_UNIT A B` for players): **A is built with A's id, but with B's creation draws**
(B's graphic and constructor in 2.1). *Found after* (Heart: UNDERBUSH_PLANT_2 1352 saved as 1352 with the facets of
1366's 8 angles), *confirmed* (CM e2). Nothing else of B is used.

### 2.5 Position of a new object (replaces the first item of `de-connections-objects.md` 8.1)

- On each axis, **the tile corner when the collision half-size is a whole number (0 included), the tile centre when
  it has a fraction**, kept at least the half-size (plus the object's edge margin) from the map's edges. Moving units
  are then kept a further 0.01 inside (as before).
- So objects of size 0 (grass patches, ferns, the off-grid placeholders) stand at the **corner**. *Found after* on the
  clean re-run of round CG (Ra 1004: 787 at the corner against 42 in the effect-carrying file; Caverns 1004: 2,759).
  Round CG's "zero-size objects stand at the centre, and the second of two at one spot deletes the first" came from
  effects the editor had carried over, and is withdrawn.
- **`set_facet 0` keeps the random facet** drawn for the object; `set_facet f` with f ≥ 1 gives facet f. Either way
  the draws are spent. *Found after* (CH F).
- **A command with `max_distance_to_players 0` whose object has size 0** (no footprint, no obstruction, no
  foundation) places, for each frame, **one group only, whatever the count asked for**, directly on the frame's
  origin, if the command's tests (6.2, step 2, with the maximum distance 0 met) pass there; no candidate list is built
  and no shuffle drawn. A frameless such command places nothing.
  *Agrees with every map*; used by corpus scripts that match.

### 2.6 Numbers in a command

- **An integer attribute given a fraction is rounded half away from zero** (`number_of_objects (4 * 1.5)` is 6 for
  6.0, and 4.5 gives 5). *Found after* (Bazi's birds), *confirmed* (CM q3).
- **`set_scale_by_groups` inside `create_object` is ignored.** *Confirmed* (CH S at 200 × 200: the unscaled counts).

## 3. The parser, for objects

1. **A bare number is not an object.** `create_object 293 { … }` and `add_object 293 50`:
   - `add_object` with a number is ignored;
   - `create_object` with a number is not a command: its attribute block joins the previous `create_object`, whose
     attributes it adds to, later values winning; with no earlier `create_object` the block is dropped.
   *Found after* (CK, 8 maps that all matched once this was applied).
2. **A name DE does not know works as a bare number.** `create_object BIRD_A { number_of_objects rnd(3,5)
   set_scaling_to_map_size }`, where BIRD_A is no object or group, gives its attributes to the previous
   `create_object`. *Found after* on Comeer (its 60-80 SNOW_PINE_TREE took the birds' count and scaling and became 5),
   *confirmed* by round CS (cuts and variants, each frozen beforehand). Any `rnd()` inside the block still draws.
3. **`second_object` may name an object group.** The second object is then picked from the group by the group rule
   (`de-connections-objects.md` 5.4), and the pick is not replaced (4.1). *Found after* (Ra's PATCHY_FOREST),
   *confirmed* (CL a1).

## 4. Resolving objects (replaces the rolls of `de-connections-objects.md` 5.3 and 7.4 where they differ)

1. **An object picked from a group is never replaced.** The group roll is spent; no replacement roll follows, and
   the picked object is used as it is. So a group of VILLAGER (male) and 293 (female) places what the roll picks,
   and a group containing VILLAGER never turns it female. Only an object that a command names directly takes its
   replacement roll (VILLAGER → female at a roll of 50 or less; SCOUT; and so on). *Found after* (Battle Lines),
   *confirmed* (CK A). This holds for every group pick: the command's first pick, member picks, second objects, the
   pick after each group (6.2 step 9), and the forced phase.
   **One exception:** the resolutions made for a forest or cliff zone filter (5.4 step 2.4, 6.1) pass the picked
   object through its replacement rule, as for a gaia owner (one more `draw(100)` when the picked entry has a rule).
   This matches every map, but no map has a group with such an entry under a zone filter,
   so for groups it is *untested*.
2. The other resolution counts of `de-connections-objects.md` 7.4 stand, with the additions of 5.3, 6.1 and 7.

## 5. Dispatch: frames, land contexts and actor areas

### 5.1 Which lands a command runs for

- `set_place_for_every_player`: once per player land, in land order, **counting only player lands that have no
  `land_id` attribute** (the lands of `create_player_lands`, and `create_land` with `assign_to_player` or `assign_to`
  but no `land_id`). A player land with a `land_id` attribute, even `land_id 1`, gets no frame from
  `set_place_for_every_player`. *Found after* (Immersion: player 1 has three lands, two of them with `land_id 1`;
  DE places each per-player object once per player).
- A land with `land_id n` is a frame for `place_on_specific_land_id n`; a land without the attribute is not, whatever
  its default id (*untested* for default player lands and n = 1).
- **`place_on_specific_land_id n`** (n ≥ 0): once for each land with that land id, in land order, with that land as
  its frame. **No limit on where the objects go** comes from the land: not its zone, not a distance, not tiles
  connected to its origin. *Confirmed* (CI P, CJ L, CR: Namatjira's riverbank GOLD of land 2 goes all over the map,
  across water). A negative id (the guide's −11) places as a frameless command (CF u3).
- **`generate_for_first_land_only`:** going through the lands in order, the dispatch stops at the first land whose
  player was already served; for a `set_gaia_object_only` command every land counts as the same player, so it stops
  after the first land. *Agrees with every map*; it reproduces CF u3 (2 BOAR in all for a gaia per-player command, not 2 per
  player).
- **A land whose origin search failed** (it sits at the map's centre, `de-land-stage.md` Section 5) still gets its
  frame. With `avoid_other_land_zones` (6.2 step 3) it finds no candidates, because no tile carries its zone. *Found after*
  (Caverns' six failed GRASS_RAINFOREST lands), *confirmed* that DE does place on failed lands without that attribute
  (CI F).

### 5.2 The land context

Actor-area records (5.3) belong to a **land context**:
- a framed command runs each frame in the context of that frame's **player slot** (per player, not per land: a
  player's second land shares the context of its first);
- a frame of a land with no player has the context "no land";
- **after a framed command, the context stays at the last land the dispatch reached** (the last land in land order,
  or the land where `generate_for_first_land_only` stopped);
- **a frameless command runs in whatever context the previous framed command left**, and so does its land centre
  (5.4). Before any framed command the context is "no land".

*Found after* (CF u1: a frameless GOLD after a per-player command finds no record made without a land; Venn: records
per land instead of per player fail).

### 5.3 Actor areas: records

- Every `create_actor_area x y id r` is recorded **before any object is placed**, in context "no land".
- A command with `actor_area id` (and `actor_area_radius r`, default 1) records an area **at the tile of each object
  it places** (every member of a group, every wall piece; a gate records at its run's start tile), in the current
  context. A per-player command marks the area with its player's slot; other commands mark it with no player.
- **A record is kept per (id, context).** It holds a list of tiles, each with a **weight**, and the total weight.
  Recording an area at (x, y) adds 1 to the weight of every tile in the square x ± r, y ± r (clipped to the map),
  appending tiles not yet in the list at its end.
- **Every area of an id takes the radius of the first area recorded with that id in that context.**
- **Lookup:** a command looks up the record of its id in its current context. **If there is none, and the command was
  dispatched to land frames (per player or per land id), it uses the record of that id made in context "no land".**
  A frameless command never falls back. *Found after* (Comeer's per-player SHORE_FISH in areas that gaia placeholders
  made; CF u1 for the frameless case).

### 5.4 Placing through an area: `actor_area_to_place_in id`

When id ≠ 0, or id = 0 and a record of id 0 is found, the command's candidates come from a **weighted walk** over
the record (5.3), not from the window of `de-connections-objects.md` 6.1. **If no record is found, the command
places nothing** (and spends no draw on a walk). The walk:

1. Iterations: the larger of the record's total weight and the number of groups requested.
2. Each iteration, while the remaining weight is above 0:
   1. r = `draw(remaining)`; the picked tile is the first in the record's list whose running weight exceeds r.
   2. Count a **restore** for that tile.
   3. If the tile is unavailable (`de-connections-objects.md` 6.4), go to the next iteration. Its weight is not
      reduced.
   4. Otherwise reduce its weight and the remaining weight by 1, then test, in this order:
      - with `max_distance_to_players m` (m > 0) and a land centre known: the tile must be **strictly closer** than m
        to the land centre on both axes (|dx| < m and |dy| < m);
      - it lies in no avoided actor area (6.2 step 2's area rule);
      - it keeps `min_distance_to_map_edge`;
      - **only now**, if the command has a forest or cliff zone filter and its object must be resolved (a group, or
        an object with a replacement rule): one resolution (the group roll, or the replacement roll), and the
        resolved object is the one the filter tests;
      - the forest or cliff zone filter (6.4).
      A tile that passes is remembered with this iteration's number.
3. At the end, every tile's weight becomes its reduced weight plus its restores. So an available tile that was drawn
   keeps its weight, and **an unavailable tile drawn k times gains k**.
4. The candidates are the remembered tiles, **the most recently passing first**. Then `find_closest` and the other
   orders of `de-connections-objects.md` 6.2 apply, and groups take them as in 6.2 below. Every test of 6.2 applies
   again except step 2.1 (the circle) and step 2.7 (the maximum distance).

*Confirmed* (CP, 12 maps: KING, SHEEP and OUTPOST through such areas, areas recorded
twice on one tile, two land frames per player). The resolution in step 2.4 comes after the distance, area and edge
tests, not right after the weight is used: *found after* on Venn (round CQ's cuts), where a second one-tile land per
player made the earlier order spend 9 rolls per frame that DE does not.

- **A starting-villager command** (one VILLAGER expanded to the civilization's count, `de-connections-objects.md`
  5.2) **with `actor_area_to_place_in` places one group per villager through the walk.** *Found after* (Caverns),
  *confirmed* (CK B).
- **A loose group of such a command draws its members from a fresh walk over the whole record**, not from a local
  window round its anchor. *Found after* (Heart's MAPLE_LEAVES), *confirmed* (CM q2).

## 6. Candidates (additions and corrections to `de-connections-objects.md` Section 6)

### 6.1 Building the candidate list with a zone filter

With a forest or cliff zone filter (6.4), **the candidate list only holds tiles that pass the filter.** Each tile that
is available and inside the window (and inside its circle under `set_circular_placement`) is tested, row by row:
1. if the command's object must be resolved (a group, or an object with a replacement rule): one resolution (4.1,
   exception), and the resolved object is the one tested next; otherwise the object tested is the command's object
   (a group's first entry);
2. the actor-area rule (6.2 step 2.2);
3. the filter (6.4), with that object.
The resolution of step 1 is spent even where steps 2 or 3 then fail.

**The shuffle** (`de-connections-objects.md` 6.1 step 3) then works as usual, except that with an object that must
be resolved **every picked tile is tested again by steps 1 to 3** (another resolution each time), whether or not it
is in the list: a pick that passes moves to the front, and joins the list if it was not in it; a pick that fails
stays where it is. With an object that needs no resolution, a pick moves to the front only if it is in the list, as
without a filter.

A loose group's local window (`de-connections-objects.md` 7.3) is collected and shuffled the same way: per tile,
availability, the circle (under `set_circular_placement`), then steps 1 to 3 (the actor-area rule is tested there
with or without a filter; the resolution only with a filter and an object that needs one); every shuffle pick is
tested again in the same way.

*Found after* (Heart's hares, Bazi's huntables), *confirmed* (CM q1).

### 6.2 Taking a candidate: the full order of tests

For each group, the front candidate is taken off the list and tested in this order. A tile that fails a test is gone
for this command unless stated.

1. **The player's zone** (framed commands, unless `ignore_terrain_restrictions`; the restriction is that of the
   object the command resolved first). Partition the map into 4-connected patches of tiles that the object's restriction
   all accepts or all refuses, **counting the terrain (and the layer terrain) of the frame's origin tile as
   accepted**. Number the patches in tile order (row by row) from 0, **wrapping at 512**. The tile is refused unless
   its number equals the low 8 bits of the origin's number. The partition is computed once per accepted set and not
   refreshed when objects change terrain. *Found after* (CK p1 1010: a GOLD refused on a
   lake island).
2. **The command's tests**, in order:
   1. with a frame and `set_circular_placement` and `max_distance_to_players m`: Euclidean distance from the origin at
      most m (not tested on a walk, 5.4);
   2. actor areas: with `actor_area_to_place_in id`, the tile lies in an area of that id (inside its square
      x ± r, y ± r, borders included, r being the record's radius, 5.3; for a framed command an area of its own
      player or of no player); and it lies in no area named by `avoid_actor_area` (or in none at all with
      `avoid_all_actor_areas`), of any player. Only areas recorded before this frame of the command began count;
   3. `terrain_to_place_on`;
   4. `layer_to_place_on L`: the tile's layer is L, **as it was before the beach-layer cleanup** (6.5);
   5. framed commands only: the object's restriction accepts the tile's terrain, or the tile's terrain equals the
      frame origin tile's terrain or the origin tile's layer terrain (`de-connections-objects.md` 6.3, with the
      layer added). Skipped with `ignore_terrain_restrictions`, with `max_distance_to_players 0`, and with
      `max_distance_to_other_zones` unless the command places through an actor area;
   6. `min_distance_to_map_edge` and `min_distance_to_players` (as before);
   7. `max_distance_to_players` (as before; not on a walk);
   8. `max_distance_to_other_zones` (6.3).
3. **`avoid_other_land_zones [d]`** (framed): the tile's land zone must equal **the frame land's own zone number**
   (the zone the land was given, not the zone found at its origin tile; so a failed land finds nothing), and with d
   so must the four tiles d + 1 away left, right, up and down (positions clamped to the map). **A tile (x, y) refused
   here also removes another tile from the list**, when all of these hold, with (ox, oy) the frame's origin and
   s = (ox − x)² + (oy − y)²: d > 0; s > d²; s ≥ (`min_distance_to_players`)²; and, if the command has
   `max_distance_to_players m`, s ≤ m² (these are Euclidean even without `set_circular_placement`). The removed tile
   is (x + d, …) if ox > x, else (x − d, …); and (…, y + d) if oy > y, else (…, y − d). It is removed if it is on the
   map and still in the list, and is then never tested. *Found after* (CM z1 at two seeds, CO ob8 1000).
4. **The object's own checks** (the fit, slope and overlap of Section 18) for the object the command resolved first.
   **Last resort** (`de-connections-objects.md` 6.3, exact): when the tile fails only these checks, the command is
   framed, has no grouping keyword and no `force_placement`, its first object is not a farm (class 49), and the list
   is now empty, the object is placed on the tile anyway, **alone**: remove from the list the tiles within
   `min_distance_group_placement` only (not `temp_…`), resolve the object once (4.1), build it, record its actor
   area, then step 9. No second object, no group, no route check. *Found after* (Venn: a PLACEHOLDER_WALL with
   `second_object WALL` placed this way on a tile already holding a wall gets no WALL of its own, and survives in
   DE's file at status 0, which it would not if its WALL had been built on it; two such placements per map, both
   seeds). Only this command family shows it; *untested* for other objects and second objects.
5. With `min_connected_tiles`: the clump rule of 18.6 (*agrees with every map*, not separately tested).
6. **Remove from the list every tile within `min_distance_group_placement` and within
   `temp_min_distance_group_placement` of the tile** (Chebyshev squares).
7. **`require_path`** (Section 7). **It comes after step 6**, so a refused tile has already knocked out its
   neighbours. *Found after* (CL r3 1012).
8. Place the group (Sections 4 and 10, and `de-connections-objects.md` Section 7).
9. One more resolution, and with `min_distance_group_placement r`, the tiles within r that this object's
   restriction accepts become unavailable to later commands (as before).

### 6.3 `max_distance_to_other_zones d`

- Zones: the 4-connected patches of tiles that a restriction accepts (refused tiles are zone 0). Numbers are compared
  on their low 8 bits.
- The restriction is the **resolved object's** for a framed command, and **the command's object's** (a group's first
  entry) for a frameless one: frameless commands are tested too. *Found after* (Bazi's huntables).
- **For a framed command whose restriction accepts the frame's origin tile, the tile must be in the origin's zone.**
  If the restriction refuses the origin tile (a ship on a land start), the tile's own zone is used. *Found after*
  (Comeer: huts kept on the player's island, CL part B; ships placed on open water).
- Then the tile and the eight points d away (⌊10d/14⌋ on the diagonals), positions clamped to the map, must all have
  the zone used above.

### 6.4 Forest and cliff zones (`avoid_forest_zone`, `place_on_forest_zone`, `avoid_cliff_zone`)

Each attribute adds (class, r) to the command's list: the forest class or the cliff class, with r = the number given,
at least 1 (bare: 1). **The kind of test (require or avoid) is the last such attribute's, for all entries.**

For a candidate (x, y) and the object being tested (its collision half-size h on the x axis; w = ⌊h⌋; f = 1 when h
has a fraction, else 0):
- near = r + w; far = max(r, w) + w · f.
- An object of the class at tile (a, b) **is in the zone** when (a ≤ x and x − a ≤ near, or a > x and a − x ≤ far)
  **and** (b ≤ y and y − b ≤ near, or b > y and b − y ≤ far). So the zone is a rectangle reaching `near` tiles left
  and up and `far` tiles right and down; it is not a circle, also under `set_circular_placement`. Both axes use the
  x half-size h.
- Example: a 4 × 4 town centre (h = 2, w = 2, f = 0) with `avoid_forest_zone 2`: near = 4, far = 2.
- Objects that count:
  - **every terrain object of the class that is alive and not retired** (Section 9), at its tile, whatever its tile's
    terrain now; *found after* (Rage Forest 1005, 2026-11-17: a land-stage tree on a tile later painted
    UNDERBRUSH_SNOW refuses a pine one tile from it);
  - every scripted object of the class already built (and, for the cliff class, every cliff piece), at its tile,
    except, for a group's members, **the objects of
    the same group and their second objects**. *Found after* (Namatjira's palm groups; Menindee's placeholder pairs
    with `second_object ITALIAN_PINETREE`).
- `place_on_forest_zone`: the tile passes when an object is in the zone. The avoid forms: when none is.
- **Who is tested:** the anchor; **every member of a loose group** (with the same geometry, no circle); tight-group
  members are not tested. *Found after* (Ra's bushes).

The *measured* rows of `de-connections-objects.md` Section 9 ("every object more than d from every tree") are this
rule seen from outside.

### 6.5 What terrain and layers the object stage sees

- **A tile painted with a composite terrain is seen as that composite**, as terrain or as layer, as long as the
  saved tile still holds what the composite resolves to (`de-findings-cg-cj.md` 5.1). A composite tile that a later
  pass repainted (the beach pass, a connection) is seen as what is there. *Found after* (CH C, Rekawa), the layer case
  *confirmed* (CJ K2).
- **Layers are seen as they were before the beach-layer cleanup** (`de-findings-cg-cj.md` 5.2: beach tiles lose their
  layer). *Found after* (Pag: RELICs with `layer_to_place_on BEACH_BUILDABLE` on tiles saved as BEACH with no layer).

### 6.6 Closest-first orders never take the origin itself (adds to `de-connections-objects.md` 6.2)

`de-connections-objects.md` 6.2 says "tiles closer than `min_distance_to_players` are dropped first". Exactly: let
m be the command's `min_distance_to_players`, **or −1 when it has none**, and s the squared distance of the tile from
the frame's origin (for all three orders, `find_closest_to_map_center` and `..._edge` included).
- With `set_circular_placement`, and not for `find_closest_to_map_edge`: the tile is dropped when ⌊√s⌋ (f32) < m. With
  m = −1 nothing is dropped.
- Otherwise: the tile is dropped when s < m². **With m = −1 that is s < 1: the origin tile itself is dropped**, so a
  `find_closest` town centre never stands on its land's origin; it takes one of the four tiles next to it.

*Found after* (Heart 1004 and 1005, Venn, Rage Forest's RELICs and round CP: every town centre and closest-first
object there matches only with the origin dropped; the text without this rule put them on the origin).

## 7. `require_path [N]`

Tested only for framed commands, on the group's anchor. No draws.

- **Walkable grid:** every tile, **whatever its terrain**, minus the tiles under each object whose pathing action is
  1, 2, 10, 11 or 13 (its collision box; its outline box for action 11). The objects are: every scripted object built
  so far (cliff pieces included), and every terrain object that is alive, not retired, and still on the terrain it
  was made for. Trees and mines block; town centres, decorations on the ground and other objects without such an
  action do not. The grid changes after every object built. (Whether a terrain object on a repainted tile blocks a
  route, as it obstructs placement (9), no map has tested.)
- **Route:** from the candidate's tile centre to the frame origin's tile centre, for a walker of clearance 0.2 (the
  villager's half-size), by the game's hierarchical search: the map is a quadtree of blocks of 1, 2, 4 and 8 tiles;
  the search runs best-first over the largest blocks whose walkable parts are connected, and the route is then laid
  through the crossing points between blocks. Its length is the sum of the straight pieces. **On open ground this is
  longer than the straight line by an amount that depends on direction and position**, which is why some tiles with a
  clear straight line are refused at N = 1.
- **Refused** when the search ends without reaching the origin (stopped short of it, or no route).
- **Accepted:** N = 0 (or no number): a route exists. N ≥ 1: ⌊route length⌋ ≤ ⌊straight distance⌋ + N, where the
  straight distance is the Euclidean distance between the two tiles (√(dx² + dy²) in 32-bit floats) and ⌊ ⌋
  truncates.

*Found after* (rounds CK and CL, the owner's 20 stone maps of 164 to 1,300
stones each, every stone identical, and round CL's wall map r6). **Terrain does not block**: a lake does not stop a route
(CK p1 1009).

The block search, its tie order and the crossing-point construction are too long to restate here exactly. Our
restatement is the study's `path_search.py` (our own code, not game code), kept with the study's offline files. A port should follow it line for line, because the
ties decide which tiles are refused. Its entry point is `allows(hierarchy, 0.2, N + 1, candidate tile, origin tile)`
with `Hierarchy(W, H, walkable)` built from the grid above.

## 8. Walls (`create_object` of a wall-class object, per player)

A per-player command whose object is of the wall class takes no candidate tiles. Its list, shuffle and first
resolution are spent as for any command. Then:

1. **Routes, once per pair (min, max)** of `min_distance_to_players` and `max_distance_to_players` (max defaults to
   min). A later wall command with the same pair reuses them, even if things have moved.
   - For each player land in slot order, the centre is the player's town centre tile (109, else 444), else the land
     origin.
   - Four bands per player, in the order left, right, top, bottom. With centre (X, Y): left band x from X − max to
     X − min, y from Y − max to Y + max; right band x from X + min to X + max, same y; top band x from X − max to
     X + max, y from Y − max to Y − min; bottom band same x, y from Y + min to Y + max. Each is clipped to the map
     (a band wholly off the map is skipped).
   - Left and right bands are crossed from their top row to their bottom row, top and bottom bands from their left
     column to their right column, by a best-first search on 8-neighbour steps that stays inside the band. The search
     starts at one tile: the left band's top-right tile, the top band's bottom-left tile, and the top-left tile of the
     right and bottom bands. Each tile enters the search once (the first time it is reached; it is never
     re-costed). The search stops when it takes a tile on the far line from the queue; that tile and its chain of
     predecessors back to the start get the player's bit.
   - Step costs: 2000 onto a tile a band already took; 600 onto terrains 26, 35, 37, 127; 10 on the map's edge rows
     and columns; on a walkable tile with a walkable side neighbour 100 (300 on terrains 4, 26, 54, 55, 59, 63-67, 90,
     93, 94, 111, 115), plus 10 for a diagonal step; otherwise 300 next to a resource (classes 8, 32, 63, on the tile
     or a side neighbour), else 10 plus the distance from the band's outer edge. Steps along the starting line cost
     nothing; the step onto the far line costs −100. The priority adds the remaining distance to the far line; among
     equal priorities the newest node goes first.
   - **The walkable grid here ignores terrain** (as Section 7's): objects block, water does not. *Found after* (CM
     w3).
2. **Keep.** "Land" here is a tile whose terrain the villager's (83) restriction accepts (18.1). A *flood* from a
   centre goes by side steps (left, right, up, down) over land; a tile where it must stop is reached but not crossed.
   Player P keeps its route bit on a tile only if (a) the flood from P's centre, stopping at tiles with P's bit,
   reaches it, and (b) for some enemy E of P (any other player not on P's team), the flood from E's centre, stopping
   at tiles holding the bit of any of E's enemies, reaches it. This drops the corners and the routes' ends outside
   the ring.
3. **Runs.** A tile's *walkability* here is: walkable, with at least one walkable side neighbour. Scan the map
   column by column (x outer, y inner). Each tile not yet used by a run, for each player bit it holds (lowest slot
   first), starts a run:
   - its direction is the first of right, down-right, down, up-right whose next tile holds **exactly** this
     player's bit and has the start tile's walkability (none: a one-tile run);
   - the run then steps in that direction **while** the next tile holds this player's bit (other players' bits may
     be there too) and has the start tile's walkability, marking each tile used.
   A run whose walkability is "not walkable" (trees, water) is not built.
4. **Pieces:** a run of span n (its length in tiles minus 1) of 4 or more gets one gate (the gate object for the wall
   and the run's direction: `data/wall_gates.json` in the archive). The gate stands at offset n//2 along the run (for an
   up-right run: at the start's x + n//2 and the start's y − 1) and covers the offsets n//2 − 2 to n//2 + 1; its two
   flanks are its children. Every other tile of the run gets a wall piece.
   **Pieces on a tile whose terrain the wall's restriction does not accept (18.1) are not built** (*found after*, CM
   w3). For each piece built, the command's object is resolved (4.1), then the piece is built and spends its
   creation draws (2 for a wall piece). The gate is resolved under its own replacement rule (if any) and spends its
   draws (1, and 1 for each flank). Pieces are built run by run, the gate of a run before its other pieces, the
   pieces in order along the run.
5. **Stored shapes:** 0 on horizontal runs, 1 vertical, 4 up-right, 3 down-right; **a run's end piece is a post (2)
   only when the next tile along the run holds none of this player's wall**. *Found after* (CM w1/w2).
6. A gaia wall command builds the routes but places nothing.

The ring is *confirmed* (CM w4-w6, frozen beforehand); the three marked rules found after
round CM. 19 wall maps identical. *Untested:* bends round trees, gold or cliffs; walls of allied players (the enemy
filter); reused routes after centres moved; wall groups.

## 9. Deleting objects under a new one (replaces `de-connections-objects.md` 8.3 and the "block nothing" of 4.4)

When a scripted object with collision half-size (h_x, h_y) not both 0 is built at (X, Y), **every terrain object
within 4 tiles whose position (x, y) satisfies |x − X| < e_x + h_x and |y − Y| < e_y + h_y** (e = the terrain
object's own collision half-size, with gaia's effects: Section 1, item 5) **is deleted from the map**, if:
- it can be built on (a decoration), whatever its status; or
- **it is retired (status 7), whatever its kind**: a retired tree under a new object is deleted too. *Found after*
  (Rage Forest 1004 and 1005, 2026-11-17: all 6 retired forest trees with a 1543 placeholder on them are missing, all
  15 with nothing on them are kept; CN n3 for a retired fern).

Live trees and other terrain objects that cannot be built on are not deleted. Objects with negative hit points (the
terrain makers) delete like any other (*confirmed*, CM d1). An object of size 0 deletes nothing this way.

**Scripted objects under a new object:** a scripted object that can be built on (a marker, a placeholder) is deleted
when a new object that cannot be built on is built at its exact position or within the two collision half-sizes,
**and the new object or the marker has hit points exactly 0**. *Found after* (Bulls_Eyes' flags and pigs, Venn's
PLACEHOLDER_WALL 278 under the WALLs they carry), the hit-points condition *confirmed* (CL a2: live objects at HP 1 on
HP-1 markers delete nothing).

**Terrain objects that obstruct.** A scripted object's overlap check (18.5) tests, besides
built objects, **every live terrain object, including those whose tile was repainted after they were made** (a
land-stage tree under a later `create_terrain`). *Found after* (round DZ r1-r3: on Rage Forest's terrain, DE refuses
every pine, gold and sheep the model put on such a tree, 37 and 13 pines at the two seeds; touching ones are placed).
**Whether a *retired* terrain object (status 7) obstructs a scripted object is not decided.** Our model lets it; a
variant in which it does not gives the same maps on every map tried (DZ r1 at both seeds, r2, r3, Rage Forest 1004),
probably because a retired tree shares its tile with the live tree the object stage drew there, which blocks
anyway. (For the decoration pass of `de-connections-objects.md` 4.4, retired objects block nothing, as before.)

## 10. Groups and their members

- **Loose-group members must stand on `layer_to_place_on`** too, not only the anchor. *Found after* (Venn's deer).
- **Loose-group members keep the forest and cliff zones** (6.4).
- **`force_placement`** (framed commands; a frameless one does nothing, CM f3). After the normal placement, if
  groups are still missing and at least one candidate passed the object's own checks (6.2 step 4), those accepted
  anchors are visited again, **newest first**, pass after pass (up to 999 passes). For each anchor:
  1. if every requested group is placed, stop;
  2. pick a position, spending raws of the shared stream: from pass 10 on, one raw r first, and if r mod 5 = 0 the
     position is the tile's centre (x + 0.5, y + 0.5); otherwise (and always in passes 1 to 9) two raws a and b, and
     the position is the tile corner (x + (a & 1), y + (b & 1));
  3. test the object (the command's first resolved object) there: its terrain and slope checks, and **the overlap
     check only in passes 1 to 9**;
  4. if it passes, resolve the object (4.1), build it and its second object, and count one group.
  The raws of step 2 are spent whether or not step 3 passes. *Found after* (CM f1/f2 at two seeds: every forced
  position; CF u4 at three seeds).

## 11. Terrain objects (additions to `de-connections-objects.md` Section 4)

- **Which table a tile draws** at the object stage's pass (4.4):
  - a tile painted with a composite terrain draws the composite's table (`de-findings-cg-cj.md` 5.1);
  - **a tile whose layer was painted with a composite draws the table of the terrain under the layer** (Heart:
    DLC_JUNGLELEAVES 62 masked over GRASS_FLOWERS_2 123 draws 123's). *Found after*, *confirmed* (CM c1);
  - **a composite tile that a later pass repainted draws the table of what is there** (Rekawa: a beach). *Found
    after*.
- **Resolving a composite layer at the end of the terrain stage destroys no terrain objects**; the objects are then
  retired by the object stage's pass as usual. *Found after* (Rekawa's terrain slice, 969 of 969).
- **Painting with `create_terrain` destroys no terrain objects** (`de-connections-objects.md` 4.3 lists the only
  passes that do). Those
  objects stay alive into the object stage, are not retired (their tile's table no longer lists them), obstruct (9)
  and count for zones (6.4).

## 12. Foundations (replaces `de-connections-objects.md` 8.4)

**In the saved map, buildings with the ordinary foundation (terrain 27) paint nothing**, for gaia and players alike.
*Found after* (k5, u10, u1), *confirmed* (CG c2 and c9). The older write-up's "player TCs and HOUSEs paint" rested on
maps where the ground was DIRT, which that foundation never paints. **Farms and pastures** (class 49) have their own
field terrain (FARM 7, rice farm 63, pastures 117); no saved map has one, and the model keeps them painting
(*untested*).

## 13. (Removed)

The comparison with AoE2RMSIDE that stood here is kept with the study's offline notes, not in this repo.

## 14. What this replaces in `de-connections-objects.md`

| Older text | Now |
|---|---|
| 4.4: retired objects "block nothing" | still true for the decoration pass; for scripted objects undecided (9) |
| 5.3: replacement rolls per resolution | group picks are never replaced (4.1) |
| 6.3: `max_distance_to_other_zones`, "framed commands only in our model, untested" | 6.3 |
| 6.3: overlap with "terrain objects still on the terrain they were made for" | every live terrain object (9) |
| 7.4: resolution counts | plus 5.4, 6.1; group picks unreplaced |
| 8.1: position "plus a half tile on each axis whose collision size is odd" | the same rule, stated as a fraction of the half-size (2.5) |
| 8.1: FORAGE's 4 facets as a special case | the general rule for objects without `creationRng` (2.1) |
| 8.1: `set_facet f` overrides the facet | f ≥ 1 does; 0 keeps the random facet (2.5) |
| 8.3: decorations under a new object | 9 (retired objects of any kind, gaia effects) |
| 8.4: player-owned buildings paint their foundation | ordinary buildings paint nothing (12) |
| 8.5: what the file stores | 2.3 |
| Section 9 (measured, not modelled) | now modelled: forest and cliff zones (6.4), actor areas (5.3, 5.4), `place_on_specific_land_id` (5.1), `generate_for_first_land_only` (5.1), `force_placement` (10), walls (8), `require_path` (7), `layer_to_place_on` (6.2, 10). Still not isolated by any map: `min_connected_tiles` |

## 15. Not tested

- **Frame counts** of animated graphics other than 10539 and 12860 (2.2). The draws are known; only the stored
  frames are not.
- **Fixed frames** of constructor types other than 30, 70 and 80 (2.3), flag 1285 among them.
- **Effects:** `MUL_ATTRIBUTE` / `ADD_ATTRIBUTE` on attributes 0, 3, 4, 53 and 71; `UPGRADE_UNIT` for players (only
  the gaia form was seen).
- **Farms and pastures** painting their field terrain (12).
- **Walls:** see Section 8.
- **`min_connected_tiles`**, and `require_path` on frameless commands and groups (only the anchor is tested here).
- **Lobbies:** every map here has 2 players at Tiny with Britons (corpus) or the editor's defaults. Other
  civilizations, 3 to 8 players and larger maps are untested for objects (the land write-up covers lands at those
  sizes).
- **Carry-over in the editor** (`de-findings-cg-cj.md` Section 1) also changed objects. References for the preview's
  DE gate must come from a fresh editor.

## 16. What this changes in the preview (preview-design rev 10, Sec.6.6)

In order of how much a typical real script needs it:
1. Effects: apply every effect line, in any section, with the scopes and attributes of Section 1, before generation;
   terrain objects always with gaia's.
2. Creation draws from the graphic and constructor (2.1), the stream-3 draws (2.2), and positions (2.5). Without
   them, every later facing on stream 6 moves.
3. Group picks unreplaced (4.1), and the resolutions of 5.4 and 6.1 where they happen.
4. Actor areas: records, contexts and the weighted walk (Section 5).
5. The order of tests for a candidate (6.2), the zones of 6.3 and 6.4, and the views of 6.5.
6. Deletions and obstruction (Section 9) and the terrain-object rules of Section 11.
7. `require_path` (7), walls (8), `force_placement` (10), foundations (12).
8. For the DE gate only: what the file stores (2.3).

## 17. Sources and credit

- **Our tests:** `RMS/de-disassembly/tests/results.md` (2026-10-29 to 2026-11-17), the probe scripts and run sheets
  of rounds CH to DZ, the frozen predictions (`*_predictions.pkl`), and the model (`object_model.py`,
  `wall_model.py`, `path_search.py`, `stage_model.py`, `rms_front.py`), where each rule is a default with its
  control. All are archived in age-of-rms `tools/scenario-probe/de-study/` except the Python tools.
- **The owner:** the editor's carry-over of effects; the route tests on `test.rms` (Section 7); the reading of
  `place_on_specific_land_id` that round CR later refuted (5.1).
- **AoE2RMSIDE** (github.com/aoe2control/AoE2RMSIDE, Apache 2.0) gave the first reading of the actor-area walk, the zone filters
  and their resolutions, the player's zone, the land-zone removal, the route search, the wall ring, creation draws
  from the graphic and the corner rule. The study tested them on the 30 corpus maps and every probe map of rounds CH
  to DZ, with predictions frozen first, and found the rest of this write-up itself, among them the saved file's
  frames, facets and wall joints, retired-object deletion, gaia effects on decorations, composite decorations and the
  editor's carry-over.
- **Game data:** the content pack (`de_content_54800.json`) for object data, graphics and replacement rules; the dat
  for `hide_in_editor`.

## 18. Appendix: the object's own checks, exact

`de-connections-objects.md` 6.3 describes these checks in outline. This appendix states them exactly; every DE map
tested agrees with it. Field names are the content pack's (`de_content_54800.json`); "after effects" applies where
Section 1 says so. All arithmetic marked f32 is in 32-bit floats.

### 18.1 Two meanings of a restriction

A terrain restriction is used in two ways, and they are not the same test:
- **accepts terrain t**: t is in the restriction's `allowedTerrainIds` and not in its `blockedTerrainIds`. Used for
  zones (6.2 step 1, 6.3), the framed terrain rule (6.2 step 2.5), and the tiles made unavailable after a group
  (6.2 step 9).
- **refuses terrain t**: the restriction's traversal cost for t (`traversalCostF32Bits`, f32) is 0.05 or less. Used
  for the fit below (18.2), and for terrain objects (`de-connections-objects.md` 4.1).

### 18.2 The fit at a tile

For object O at tile (x, y): its centre c = (x + o_x, y + o_y), with o = 0.5 on an axis whose collision half-size has
a fraction, else 0 (2.5). Its placement rectangle runs from l = c − p to u = c + p − 0.001 (f32 on each axis, p the
placement half-size). It covers the tiles ⌊l_x⌋..⌊u_x⌋ by ⌊l_y⌋..⌊u_y⌋.
1. **On the map:** l ≥ 0 and u < W (and H). Otherwise it fails.
2. **Centre terrains** (`placementCenterTerrainIds`, if the object has any): the terrain of the tile ⌊c⌋ must
   *match* the list (18.4) with the class bits 0x04 and 0x08.
3. **Side terrains** (`placementSideTerrainIds`, if any): take the rectangle of tiles, or only the tile ⌊c⌋ when the
   object also has centre terrains. At least one tile of the row just above it, the column just right of it, the row
   just below it or the column just left of it (on the map) must match the list with the class bits 0x40 and 0x10.
4. **Restriction:** unless `ignore_terrain_restrictions` applies (a framed command with it), no tile of the rectangle
   may hold a terrain the object's restriction refuses (18.1).
5. **Slope** (18.3).
6. **Overlap** (18.5).

### 18.3 Slope

The object's `placementRules.slopeMode` (for an object with per-civilization rules, the first variant's): 0 allows
any ground. Otherwise take the rectangle of 18.2; it fails if off the map. With h(x, y) the tile heights:
- mode 1: every tile of the rectangle has shape 0 or 5 to 8;
- mode 2: every tile has shape 0;
- mode 3: every tile in the rectangle's first column or last row has a height within 1 of h at (first column, last
  row).

The **shape** of a tile with height z, from its neighbours (a neighbour off the map counts as height z; N is (x, y − 1),
E is (x + 1, y), and so on), with "up" meaning height z + 1 and "down" z − 1, is the first that applies:
1. N and E up: 14. W and S up: 13. N and W up: 16. E and S up: 15.
2. N up: 6. E up: 8. W up: 5. S up: 7.
3. NE up: 2 if W and S are down, else 10. SW up: 1 if N and E are down, else 9. NW up: 3 if E and S are down, else
   11. SE up: 4 if N and W are down, else 12.
4. Otherwise 0.

### 18.4 Matching a terrain list

Terrain t matches a list with class bits (b1, b2) when t is in the list, or some terrain s of the list shares bit b1
with t, or shares bit b2 with t. "Shares bit b" means both terrains' placement classes (`placementClass`) have bit b.

### 18.5 Overlap

The new object N (centre c, placement half-size p) is tested against every built object E: scripted objects, their
children, cliff pieces, and the terrain objects named in Section 9 (a terrain object is tested at its tile plus o, as
in 18.2, using its own collision half-size, not its exact position).

N takes part in two ways:
- **collision**: N's `placementCollision` is not "none", N's `pathing.verticalExtent` is absent or above 0, and p_x
  or p_y is above 0;
- **occupancy**: N's `placementRules.family` is "occupancy".
If neither, N passes. Otherwise N fails at the first E for which all of these hold:
1. E cannot be built on (`canBeBuiltOn` false), and both of E's collision half-sizes e are above 0;
2. |E_x − c_x| < p_x + e_x and |E_y − c_y| < p_y + e_y;
3. either
   - N has collision, E's `placementCollision` is not "none", and E's vertical extent is absent or above 0 (or N is
     a tree, class 15, and E a farm, class 49); or
   - N has occupancy, and E has height (its vertical extent is absent or above 0, or its `positionFamily` is
     "building", or its first resource slot is of type 0, 1, 2, 3, 15, 16 or 17 with a quantity above 0), and E is
     not exempt. E is exempt when it is a moving unit (`occupancyUsesMovementSpeed` true and a movement speed above
     0) and either N's `pathing.action` is 0 or 12, or E's owner is gaia or N's owner.
   Owners do not matter otherwise: a gaia object is checked against players' objects too.

### 18.6 `min_connected_tiles n` (grouped commands, n > 1)

A pool of candidate tiles grouped into numbered clumps, empty at the start of the command. When a candidate (x, y)
has passed every test up to 6.2 step 4:
1. Find the clumps that have a pool tile next to (x, y) (left, right, up or down). With none: open a new clump (the
   next number) with (x, y) alone in it, and refuse the candidate.
2. Otherwise merge those clumps into the lowest-numbered one. Let k be 1 plus the number of pool tiles in it. If
   k < n: add (x, y) to the clump and refuse the candidate.
3. Otherwise choose i = 0 with `find_closest`, else i = `draw(k)`. The group's anchor is the clump's i-th pool tile in
   the order tiles entered the pool (that tile leaves the pool), or (x, y) itself when i = k − 1.
After the group is placed, every pool tile within `group_placement_radius` (Chebyshev) of the anchor leaves the pool.

### 18.7 Commands that place nothing still draw

A command whose group count is 0 still builds and shuffles its candidate list and spends its first resolutions
(`de-connections-objects.md` 7.4) before it stops. So does a command whose list ends up empty.

## 19. Appendix: the object data the stage reads

Every name below is a field of the content pack the study used (`de_content_54800.json`, AoE2RMSIDE's reviewed
bundle for build 101.103.54800, Apache 2.0). Most fields come from the game's `empires2_x2_p1.dat`; an implementation
may read them from the dat itself (age-of-rms's `tools/extract-constants` already reads some) as long as it gives
the same values.

- **Per object** (`objects[]`): `id`, `classId`, `constructorType`, `standingGraphicId`, `creationRng` (`facetCount`,
  `randomFacet`, `randomAngle`, `randomCombatSeed`, `fixedFacet`), `placementGeometry` (the four half-sizes:
  `placementHalfWidth/Height`, `collisionHalfWidth/Height`, f32 bit patterns), `footprintWidth256`,
  `footprintHeight256`, `placementRules` or `placementRuleVariants[0].rules` (`family`, `slopeMode`),
  `placementCollision`, `obstruction`, `canBeBuiltOn`, `hitPoints`, `restrictionId`, `positionFamily`,
  `movementSpeedF32Bits`, `occupancyUsesMovementSpeed`, `edgeMargin256`, `pathing` (`action`,
  `verticalExtentF32Bits`, `outlineHalfWidth/HeightF32Bits`), `resourceSlots[0]` (`resourceType`,
  `quantityF32Bits`), `foundation` (`terrainId`, `omittedCells`), `constructionAttachments` (`objectId`,
  `xOffsetF32Bits`, `yOffsetF32Bits`), `availableCivilizations`, `singleRequestCount`,
  `placementCenterTerrainIds`, `placementSideTerrainIds`.
- **Graphics** (`graphics[]`): `id`, `angleCount`, `randomFacet`, `randomAngle`.
- **Replacement rules** (`objectReplacementRules[]`, 8 rules): `sourceObjectId`, `replacementObjectId`,
  `replacementAttributeId`, `requiredAttributeId`, `technologyGate`, `maximumRollInclusive`. And
  `civilizationAttributeValues[]` for `requiredAttributeId`.
- **Restrictions** (`restrictions[]`): `allowedTerrainIds`, `blockedTerrainIds`, `traversalCostF32Bits`.
- **Terrains** (`terrains[]`): `placementClass` (the dat's `Terrain.is_water` bitfield).
- **Foundations** (`foundationTerrainRules[0]`): `compatibleSourceTerrainIds`.
- **Constants:** the forest-zone class 15 and the cliff-zone class 34; the classes wall 27, farm 49, tree 15; the gate
  objects per wall and direction (`data/wall_gates.json` in the archive).
- **From the dat, not in the pack:** `hide_in_editor` (status 0 rule, 2.3): the ids are in the archive's
  `data/de_hidden_in_editor.json`.
- **Measured, not in any data:** the frame counts of 2.2 (graphic 10539: 91; graphic 12860: 1450).
