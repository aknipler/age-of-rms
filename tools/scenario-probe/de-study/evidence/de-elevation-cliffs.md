# DE's elevation and cliff stages, measured (write-up for the preview revision, 2026-10-17, rev 2026-10-19)

What Age of Empires II DE does in `<ELEVATION_GENERATION>` and `<CLIFF_GENERATION>`, in our own words, at the level of detail needed to reproduce its maps tile for tile. It continues `de-land-stage.md` (read that first for the generator, the draw notation and the land stage) and is written for the age-of-rms preview spec (`docs/preview-design.md`, Sec.6.2 and 6.3). Section 7 lists where it overturns that spec. No code from any other project is reproduced here; Section 9 says where the first leads came from.

**Revision 2026-10-19 (round EC2).** 18 more maps, each with every open reading predicted beforehand. Each map matched exactly one reading. New or now-tested rules:
- restored base tiles spend decoration draws in the land stage (3.0);
- land `base_elevation` and `LAND_GENERATION base_layer` (3.0);
- no smoothing without an elevation section (3.5);
- the scaling attributes (3.1);
- `cliff_type` 1 and 5 (5.1);
- cliffs next to water, with the water repair around a line (5.2, 5.4);
- the end of the terrain stage: earlier terrain back, then the water fill, then beaches (5.7).

Section 10 lists the surprises.

## Scope and confidence

- **Build:** DE 101.103.54800.0.
- **Instrument:** as for the land stage. Maps were generated in the scenario editor (Seed Map, the seed typed in, 2 players, no teams, Team Positions ticked), saved, and read back with AoE2ScenarioParser. Each saved map gives every tile's elevation, terrain and layer and every cliff object's type, position and facing.
- **Result:** **51 of 51 maps match tile for tile**, from 22 probe scripts:
  - round EC (`tests/probe_ec.py`): 33 maps from 13 scripts. 29 are on Tiny (120), 2 at 168 and 2 at 200. 26 were predicted before the maps were made. The owner saved the other 7 (extra seeds and sizes) unprompted, and we predicted those afterwards. They are just as good as tests, since the model was not changed for them;
  - round EC2 (`tests/probe_ec2.py`): 18 maps from 9 scripts, all on Tiny, all predicted before the run (`tests/ec2-predictions.md`).
- **Controls:** in round EC2 every rejected reading fails its maps (Section 10). The size of the failures shows that the maps could tell the readings apart.
- **Independent check:** a second implementation written from this text alone (`tests/writeup_check_ec.py`) reproduces all 51 maps.
- **Statistical checks:** the 235 age-of-rms calibration exports store no seed, so they cannot be compared tile for tile. On every single-layer script, their tile counts, hill counts and centroids agree with the model, Tiny to Ludicrous (`tests/results.md`, 2026-10-17).
- **Status tags:** as in the land write-up. *Untested* means the rule comes from reading other work, and no DE map exercises it.

Notation as in the land write-up. `draw(n)` is one bounded draw `⌊n · raw / 2³²⌋` from the shared stream, and `raw` is one raw 32-bit output. "The stream" is the one the land stage used. Elevation and cliffs continue it without a break. Tile `(x, y)` is the scenario file's coordinate.

## 1. Order of the draws

1. Everything in the land write-up, ending with the leftover fill and the cleanup against the base terrain. The cleanup's tiles restored to the base terrain spend draws (3.0). The cleanup against WATER does **not** run here (5.7).
2. **`<ELEVATION_GENERATION>`**, if the section is present: one burned draw, then every layer in script order (Section 3).
3. **`<CLIFF_GENERATION>`**, if the section is present, even as a bare header: one burned draw, then the cliffs (Section 5).
4. Then the terrain stage. At its end (5.7), three steps in order:
   - every tile a cliff line went through gets its earlier terrain back;
   - the cleanup against WATER runs;
   - the beach rule runs.

*Tested:* every probe. A bare cliff header makes cliffs with the defaults (cl5, 5 maps). The place of the WATER cleanup was tested on wc1. *Untested:* whether an empty `<ELEVATION_GENERATION>` header also burns its draw.

## 2. Lists

Both stages keep tiles (or 3×3 cells) in **lists**, and the draws depend on list order, so the list behaviour is part of the rule.

- **Shape.** A list is a chain of entries with a first entry. Each entry knows its predecessor and its successor. The first entry's predecessor is the list itself.
- **An entry is in at most one list.** Putting it into a list first takes it out of wherever it is.
- **Taking an entry out:** its predecessor and successor are linked to each other. If its predecessor is a list, that list's first entry becomes the successor.
- **Insert at front:** the entry becomes the list's first entry.
- **Insert by priority:** each entry carries a number. The new entry goes before the first entry whose number is **at least** its own, so it lands before equals.
- **Pop:** take out and return the first entry.

**Emptying, the elevation stage's quirk.** The elevation stage never empties a list properly. It only makes the list forget its first entry, and the old entries keep their links.

- **The main list** (3.2) is emptied this way at the start of each layer. Its old first entry still believes it heads the main list. So if the new layer's candidate scan reaches that tile, taking it out sets the main list's first entry to the tile's old successor. Everything the scan had inserted so far is dropped, and the rest of the old list comes back.
- **A clump list** (3.4), at the end of each layer, also has its first entry's link to the list cleared. Taking that tile out later only re-links its old neighbours.
- **In general**, taking out any stale entry splices its old neighbours together, wherever they now are.

*Tested:* `el7-stack` (the same `create_elevation 4` three times, 4 seeds) and `el6-two` depend on this. With clean lists, all four el7 maps fail by more than 5,000 tiles. The cliff stage empties its lists properly (*tested* on the cliff probes, though no probe could tell the difference).

**Shuffle (both stages).** Make 100 empty bucket lists, then do two passes:

1. Pop entries from the main list one at a time. Each gets `draw(100)` = b and is inserted at the front of bucket b.
2. Then for g = 0, 4, 8, …, 96, two merges. First buckets g and g+1: take the first entry of g, then of g+1, then of g again, and so on, skipping a bucket once it is empty, until both are empty. Each entry taken goes to the front of the main list. Then the same for buckets g+2 and g+3.

So a shuffle costs two draws per entry.

## 3. Elevation

### 3.0 What the land stage hands over

The elevation stage starts from three things the land stage leaves on every tile: terrain, height and layer. The land stage also leaves the stream at a position that depends on its cleanup.

**Heights (`base_elevation e` on a land, default 0).** The land writes its height e in three places:
- on every tile of its stamp (de-land-stage 6.2);
- on every tile it claims during growth;
- in the leftover fill (de-land-stage 7), on every cell whose conformity roll passes, **whether or not the cell then gets the land's terrain**.

Later writes win. A land whose terrain is water-like (placement class & 0x47, see 5.2) writes 0 whatever its `base_elevation`. The cleanup changes terrain only, so a tile it restores to the base terrain keeps the height it had.

So a raised land is wider in height than in terrain. It has a rim of base-terrain tiles at the land's height:
- leftover cells that did not get the terrain;
- cleanup-restored tiles.

On lh2 the rim is 215 to 221 tiles around a 300-tile and a 250-tile land. About 85% of it is leftover cells.

*Tested:* lh1 and lh2: SNOW at 3, DIRT at 6, and WATER at 4, which stays at 0 (4 maps). *Untested:* a non-water land painted over a raised one; heights above 8.

**Layer (`base_layer T` in `<LAND_GENERATION>`).** Every tile that no land paints carries layer T, and every tile a land paints (stamp, claim or leftover fill that took the terrain) has no layer. The saved scenario records the layer per tile, and DE's saved layers match this tile for tile. Section 3.3's test "its land layer matches the base layer" then splits the map:
- `create_elevation` with `base_layer T` finds only the unpainted tiles;
- `create_elevation` without `base_layer` finds only tiles some land painted.

This holds even when a land has the base terrain itself. On ly1, a `create_elevation` on DESERT without `base_layer` grew only on the DESERT land, never on the DESERT base around it.

*Tested:* ly1 (2 maps). *Untested:* `base_layer` on `create_land`; whether a tile the cleanup restores gets the layer back. The model leaves it without one, and ly1 matches, but we did not check whether ly1 has such a tile.

**Decoration draws in the land cleanup.** Each time the land stage's cleanup against the base terrain (de-land-stage 9) turns a tile back into the base terrain, that terrain's decorations spend draws at once, per the table in 5.4. A GRASS base spends 3 per restored tile; DESERT and other terrains without decorations spend none. The draws fall in the cleanup's own scan order. They shift the start of the elevation and cliff stages, so a single vanished sliver changes every hill and cliff on the map.

Painting a land does **not** spend decoration draws, only the restore does. co1 paints a 6,000-tile DIRT land, and DIRT's decoration costs 1 draw per tile (5.4). The map matches with no draws for the painting. Up to 6,000 extra draws would have moved every cliff, but no control with painting draws was run.

*Tested:* gr1. Four 4-tile DESERT lands vanish on a GRASS base: 19 restored tiles, 57 draws. Without the draws, both maps differ in about 1,000 elevation tiles and in every cliff object. The no-draw painting is tested on DIRT lands (co1, lh1, ly1). *Untested:* painting a GRASS land, though nothing suggests it differs; restores on other decorated base terrains.

### 3.1 Commands become layers

- **Layers.** `create_elevation H` becomes H layers, numbered k = 1..H. Layer k has height min(k, 16) and grows only on tiles whose elevation is exactly k−1.
- **Order.** Layers run in order, command after command, in script order.
- **Attributes apply to every layer of their command**, with these values:

| Attribute | Value |
|---|---|
| `number_of_tiles` | default W, the map width (so 120 on Tiny) |
| `number_of_clumps` | default 1, at most 999 |
| `base_terrain` | default GRASS |
| `base_layer` | default none |
| `enable_balanced_elevation` | inside the block |
| `spacing s` | layers 2..H only, and only if s > 0. Layer 1 always uses 2; other layers default to 1 |
| `set_scale_by_size` | number_of_tiles × W·H / 10000 (integer), at most W·H |
| `set_scale_by_groups` | number_of_clumps × W·H / 10000 (integer; not capped at 999 again) |

The scaling applies to the final values once the block has been read, so its place in the block should not matter. If both scale keys are given, the later one wins. Our probes put the scale key last and never gave both, so both points are *untested*.

- **Things that do nothing.** Commands at section level, outside a block, do nothing. RMSTEST_22b puts `enable_balanced_elevation` there, and the spec found it has no effect.
- **Negative H** removes the last |H| layers created so far (*untested*).

*Tested:* el1 to el7 (heights 1 to 4; 1, 2, 3, 4, 8 and 10 clumps; spacing 3; two and three commands; balanced). Scaling was tested on sc1 (2 maps): on Tiny, 300 tiles become 432, and 3 clumps become 4 (3 × 1.44, truncated). `base_terrain` and `base_layer` are covered with the land attributes in 3.0 (ly1).

### 3.2 Per section: the avoidance weight

Before the first layer, every tile gets a weight from the origins of the **player** lands (distinct origins). For each origin, let d = ⌊√(dx² + dy²)⌋, with the root taken in single precision. If 13 − d > 0, add 20 · (13 − d). The tile's weight is the sum, capped at 101.

A tile whose weight is not 0 is never a candidate and never a seed (3.3). During growth it is also refused at random, and once refused its weight becomes 101 for the rest of the section (3.4).

*Tested:* el5 (2 player lands, 2 seeds).

### 3.3 One layer: candidates and seeds

1. **Candidates.** Scan rows y = 0..H−1 and, within each row, x = 0..W−1. A tile qualifies if:
   - its terrain is the layer's base terrain;
   - its elevation is k−1;
   - its land layer matches the base layer (none = none);
   - its weight is 0.

   Each qualifying tile is inserted at the **front** of the main list.
2. **Shuffle** the main list (Section 2).
3. **Seeds.** Let r = max(⌊⌊√(tiles / clumps)⌋ / 2⌋, 2), with the root taken in single precision, and clumps taken as at least 1 here. Then pop tiles from the main list until every clump has a seed or the list is empty. A popped tile is skipped if:
   - its weight is not 0; or
   - the square of radius s around it (clipped to the map) holds any tile that is not base terrain, not the base layer, or lower than k−1. Here s is the layer's spacing, in its low 8 bits.

   Otherwise the tile becomes clump c's seed (c counts from 0):
   - **Unlink a square (only if the layer is not balanced).** Every tile from x−r to x+r and from y−r to **min(x + r, H−1)**, clipped to the map, is taken out of whatever list it is in. If the bottom bound is below y−r, nothing is taken out.
   - **The seed is raised to k.**
   - **Its neighbours join clump c's list.** Of the left, upper, right and lower neighbours, those on the map are inserted with number 0, in that order. Each lands before the previous one, so the list starts lower, right, upper, left.
   - The seed counts as one placed tile.

   **The quirk.** The square's bottom edge depends on x, not y. A seed with y − x > 2r takes nothing out, while a seed on the other side of the diagonal takes out a full square. Over many seeds, the main list keeps its candidates on the y > x side and loses them on the other. This is the "south bias" of the preview spec (Sec.6.2), and with the edge at y + r it disappears. *Tested:* el2 fails both maps with the edge at y + r. The spec's density table and its Tiny and 200 means are reproduced without fitting.

### 3.4 One layer: growth

Rounds: in each round, go through the clumps in order. Stop as soon as the placed count reaches number_of_tiles, or after a round in which no clump had anything to pop. For one clump:

1. Pop its list. If it is empty, go to the next clump.
2. **Avoidance:** a = `draw(100)`. If the tile's weight is greater than a, set the weight to 101 and skip the tile.
3. **Spacing:** skip the tile if the square of radius s (the full value) around it fails the test of 3.3.
4. **Count:** n = the number of tiles already at height k in the 5×5 square around the tile, clipped. If n = 0, skip the tile.
5. Skip the tile if its elevation is not k−1.
6. **Accept:** raise the tile to k; placed += 1.
7. **Neighbours,** in the order left, right, upper, lower. Each one on the map whose elevation is k−1 gets p = `draw(100)` and is inserted into this clump's list with number p + 250 − 15n.

At the end of the layer, the clump lists are emptied in the quirky way (Section 2), and the whole map is smoothed (3.5).

*Tested:* el1 to el7. The model also reproduces the spec's measured overshoot (126 tiles for a budget of 120; about 3,080 tiles, 6.1 per clump, for 500 clumps of 4) without any extra rule. Which step causes it was not traced.

### 3.5 Smoothing (no draws)

Smoothing runs on the whole map after every layer, and once when a present section has no layers (*untested* for that case). **With no `<ELEVATION_GENERATION>` section it never runs.** Land heights then stay as painted, with cliff-like steps (0 to 6 between neighbouring tiles on lh2). Nothing later in the generator smooths them. *Tested:* lh2 (2 maps). The smoothed reading fails both maps by about 950 tiles.

Smoothing is also what shapes a raised land when an elevation section is present. The land's tiles are not the layer's base terrain, so no layer grows on them. But after every layer the slope pass raises the tiles around the plateau into a ramp, one level per tile, which reaches down to the base. Below 8 nothing is lowered, so the plateau keeps its full height (lh1, 2 maps). Every pass scans rows y, then x, and changes tiles in place, so later tiles see earlier changes. "Higher" means higher than the current tile h. Neighbours off the map count as not higher.

1. **Pinch pass,** repeated until a pass changes nothing. A tile is pinched when both its upper and lower neighbours are higher, or both its left and right neighbours are.
   - If h < 8: h becomes h + 1.
   - Otherwise every higher tile among its 8 neighbours is lowered to h.
2. **Topology pass,** once. This is land cleanup pass 1 (de-land-stage Section 9; the genie-rms diagonal patterns), with "is higher" in place of "is base terrain". When a pattern fires, the tile changes as in the pinch pass.
3. **Slope pass,** once. If h = 8, skip the tile. Otherwise let h' = h + 1 if h < 8, else h − 1. If any tile in the clipped 3×3 square is above h' (when h < 8), or below h' (when h > 8), the tile becomes h'.

Repeat steps 1-3 until neither the topology pass nor the slope pass changed anything. In the end, neighbouring tiles differ by at most one level.

*Tested:* every elevation map. The behaviour at 8 and above is *untested*: no probe went above 4, and RMSTEST_32 and 50 reach 7.

## 4. What the elevation stage does not do

- It does not read terrain written later. It runs on the land stage's terrain, before `<TERRAIN_GENERATION>`.
- It never lowers a tile it did not raise, except through the smoothing at 8 and above.
- It does not add heights. A layer only raises tiles that sit at exactly k−1, so `create_elevation 7` caps at 7 even when repeated (the spec's Sec.6.2 correction stands).

## 5. Cliffs

### 5.1 Settings

| Attribute | Default | Read as |
|---|---|---|
| `min_number_of_cliffs` / `max_number_of_cliffs` | 3 / 9 | count = min + `draw(max − min)`, so max is exclusive |
| `min_length_of_cliff` / `max_length_of_cliff` | 5 / 9 | per cliff, length = min + `draw(max − min)`, max exclusive |
| `cliff_curliness` | 36 | percent |
| `min_distance_cliffs` | 2 | in 3×3 cells |
| `min_terrain_distance` | 2 | in 3×3 cells, around water-like cells |
| `cliff_type` | 0 | object style: the base object id below |

- **The last value written wins.** The section is a flat list of attributes.
- **Arithmetic.** Differences use 32-bit wraparound, so min > max asks for a huge count, which the game cannot do.
- **`cliff_type` changes only the objects.** Each style is 9 consecutive object ids from a base, and the shape table's slot (5.5) is added to it. Offsets, facings and draws are the same for every style, so the same seed gives the same cliffs in a different look.

| `cliff_type` | Constant | Base object | Status |
|---|---|---|---|
| 0 | CT_GRANITE (default) | 264 | tested |
| 1 | CT_DESERT | 1849 | tested (ct1) |
| 2 | CT_SNOW | 1858 | untested |
| 3 | CT_MARBLE | 2178 | untested |
| 4 | CT_LIMESTONE | 2069 | untested |
| 5 | CT_TERRACE | 2651 | tested (ct2) |

*Tested:* the defaults (cl5, 5 maps at 3 sizes), and the attributes in cl1, cl2 and cl6. Types 1 and 5 were tested on ct1 and ct2, 4 maps with every object identical; types 2 to 4 are *untested*.

### 5.2 Cells and candidates

- **Cells.** The map is cut into ⌊W/3⌋ × ⌊H/3⌋ cells of 3×3 tiles; cell (cx, cy) covers tiles 3cx..3cx+2.
- **Candidates.** Scan cells by rows. A cell is a candidate when no tile in it is water-like and all nine tiles have the same elevation e. Its **value** is then e + 1, and it is inserted at the **front** of the main list.
  - **Water-like** means the terrain's placement class has a bit of 0x4F set. The placement class is the dat's terrain field that genieutils calls `is_water`. It is a bitfield: 0x0F water kinds, 0x10 shore (beach), 0x20 land, 0x40 ice, 0x80 frozen. For example, GRASS, DESERT and DIRT are 0x20; SNOW is 0xA0; ICE is 0x60; WATER is 0x04; SHALLOW is 0x08; beach is 0x10. (Corrected 2026-10-19: an earlier revision called 0x40 "shallows-type", but SHALLOW is 0x08 and the bit is ICE's.)
  - A cell with a water-like tile is a **blocked** cell.
- **Clearing.** A cleared cell gets value 0 and leaves the main list.
  1. Clear the square of radius `min_terrain_distance` around every blocked cell (a negative radius clears nothing).
  2. Clear the square of radius **7** around the cell of **every land's origin** (⌊x/3⌋, ⌊y/3⌋). This includes neutral lands and lands with `number_of_tiles 0`, not only player lands.
  3. **Isolated cells:** using a copy of the values from before this step, clear every candidate with no candidate among its 4 neighbours.
- **Shuffle** the main list (Section 2).
- **Count:** count = min + `draw(max − min)`.

- **What counts as water here** is the terrain as the land stage left it, **before** the WATER cleanup, which runs only at the end of the terrain stage (5.7). A land tile with water on both sides is still land when the cells are scanned.

*Tested:* cl1 to cl6. In cl6, a neutral land at the map centre stays clear; if only player lands were cleared, seed 1001 would have a cliff 1.5 tiles from it. Water was tested on wc1 (2 maps): a WATER band across the map, with `min_terrain_distance 0`, so cliffs may stand in the cells next to blocked ones. A positive `min_terrain_distance` against real water is *untested*.

### 5.3 One cliff: the walk

For each of the `count` cliffs:

1. **Length:** L = min + `draw(max − min)`. If L < 3, this cliff spends nothing more. This is why lengths below 3 give no cliff (the spec's "per-cliff yield", RMSTEST_45).
2. **Start:** pop the main list until a cell with value ≠ 0 comes up, then set its value to 0. If the list runs out, there is no cliff and no further draws.
3. **Target value:** the elevation of the start cell's top-left tile, plus 1. The walk stays on cells at the start's elevation.
4. **Heading:** d = `draw(4)`, where 0 = up (−y), 1 = right (+x), 2 = down (+y), 3 = left (−x).
5. **Steps:** repeat L times.
   - c = `draw(100)`. If c < ⌊curliness / 2⌋, d = (d + 3) mod 4. Otherwise, if c < curliness, d = (d + 1) mod 4.
   - **Try directions** in this order: d, then f1(d), then f2(d), then, on the walk's **first** step only, f3(d):

     | d | f1 | f2 | f3 |
     |---|---|---|---|
     | 0 | 1 | 2 | 1 |
     | 1 | 2 | 0 | 2 |
     | 2 | 3 | 1 | 0 |
     | 3 | 1 | 2 | 1 |

     These are not clean rotations, and the table is reproduced as measured. The heading d itself does not change when a fallback is used.
   - **Move** to the first neighbouring cell on the grid whose value equals the target. Set its value to 0 and add it to the path. If no direction works, the walk ends early.
6. Reverse the path (it is painted from the end back to the start), paint it (5.4 and 5.5), then clear the square of radius `min_distance_cliffs` around every cell on it.

*Tested:* cl1 to cl6, curliness 10 to 100 (cl2: 100).

### 5.4 Painting the line

Take the reversed path node by node, k = 0, 1, …. Node k's segment runs from node k−1 to node k (node 0 runs from itself). In tiles, the segment goes from (3·cx + 1, 3·cy + 1) of the first node to the same point of the second: one tile for k = 0, otherwise 4 tiles in a straight line.

1. **Line tiles.** For each line tile in order:
   - The first time any cliff touches a tile, its terrain is put on record.
   - Unless its terrain is 70, its current terrain's **decorations** spend draws. Per decoration entry:

     | Entry | Weight 0 | Weight 1000 | Any other weight |
     |---|---|---|---|
     | Randomized | 0 draws | 2 draws | 3 draws |
     | Centered | 0 draws | 0 draws | 1 draw |

     The decoration entries are the dat's per-terrain `terrain_unit_id`, `terrain_unit_density` (the weight, per thousand) and `terrain_unit_centering` (centered or randomized). GRASS has one randomized entry at weight 60, so 3 draws per tile. DIRT has one centered entry at weight 10, so 1 draw. DESERT, SNOW and water have none.
2. **Water repair with marker 70** in the segment's box (below).
3. **Terrain 16.** The segment's tiles become terrain 16, and they lose their layer.
4. **Water repair with marker 16** in the same box.
5. **Pieces.** For k ≥ 1, join a piece from node k−1 to node k (5.5).

**Water repair.** The box starts as the segment's tile rectangle grown by 3 on each side. Water here means placement class & 0x0F ≠ 0.

1. **Bridge sweeps.**
   - Before each sweep the box grows by 1 on each side (clipped to the map), so the first sweep reaches 4 tiles out.
   - A sweep is two passes over the box, rows then columns: first the straight pattern, then the diagonal ones. They are the patterns of the WATER cleanup (de-land-stage 9), read on the 8 neighbours.
   - For each tile that is not water and whose water neighbours match the pass's pattern, every water neighbour becomes the marker and loses its layer. The neighbours are taken in the order NW, N, NE, E, SE, S, SW, W. The marker's decoration draws are spent per tile, but 70 and 16 have none. The tile counts as one change.
   - The sweeps stop after a sweep with no changes. They also stop the fifth time a sweep's change count equals the previous sweep's count. These five need not come in a row.
2. **Shore pass**, once, over the final box, in place (later tiles see earlier changes). A tile changes, and loses its layer, when one of these holds:
   - it is ice-type (0x40) with shore water among its 8 neighbours;
   - it is beach (0x10) with a frozen (0x80) neighbour;
   - it is neither water nor beach, and it has shore water among its 8 neighbours.

   The tile becomes terrain 37 if its class has 0x40, 0x80 or 0x10 set, and beach (2) otherwise. Shore water is water (class & 0x0F) that is not ice-type (0x40) and not terrain 15. SHALLOW (0x08) is shore water.
3. **The changes stay.** Tiles the repair changes are not put on record, so 5.7 does not undo them.

A water tile bridged with marker 70 usually becomes beach in the same repair's shore pass. One that is not beached stays terrain 70, which no script names, in the finished map. In wc1 seed 1000, 14 water tiles were bridged and 13 of them were beached. The 14th is a terrain-70 tile in DE's saved map, exactly where the model puts it.

*Tested:* cl4 (the GRASS decoration draws; a map at DESERT would not have shown them). DIRT's centered draw was tested on co1: with 0 draws for DIRT, both maps lose all but 16 to 19 of about 175 cliff objects. The water repair was tested on wc1 (2 maps). What actually fired there:
- the shore pass on land: 59 to 86 tiles;
- bridging with marker 70: 14 tiles, at seed 1000 only.

Never exercised: bridging with marker 16 (the second repair never changed anything), the frozen and ice cases, and the five-repeat stop.

### 5.5 Pieces

- **Legs.** Each cell holds at most one piece. A piece has four legs, [+x, +y, −x, −y], each 0, +1 or −1.
- **Shapes.** Each leg combination has an entry in the shape table below (20 shapes). An entry gives:
  - an object slot (added to the style's base object; 264 for type 0);
  - an offset inside the cell, in 1/256 tile (1.5 tiles for straight pieces; 1.0 or 2.0 on one axis for corners);
  - for 4 shapes, a second look.
- **Position.** The object stands at (3cx + offset_x/256, 3cy + offset_y/256), in tile units, matching the scenario's unit coordinates directly.

The table, as measured. Every row occurs in our DE maps (11 to 153 times), and the object, position and facing of all 1,126 cliff objects agree, both looks included. Facing is the saved object's animation frame. The second look keeps the object and offset and changes only the facing.

| Legs [+x, +y, −x, −y] | Object (base +) | Offset x, y (tiles) | Facing | Second look (odd raw) |
|---|---|---|---|---|
| -1 0 -1 0 | 2 | 1.5, 1.5 | 11 | facing 10 |
| -1 0 0 -1 | 7 | 2.0, 1.0 | 13 | none |
| -1 0 0 0 | 2 | 1.5, 1.5 | 20 | none |
| -1 +1 0 0 | 5 | 1.5, 2.0 | 0 | none |
| 0 -1 -1 0 | 7 | 1.0, 2.0 | 9 | none |
| 0 -1 0 -1 | 1 | 1.5, 1.5 | 8 | facing 7 |
| 0 -1 0 0 | 1 | 1.5, 1.5 | 22 | none |
| 0 0 -1 0 | 2 | 1.5, 1.5 | 21 | none |
| 0 0 -1 +1 | 5 | 1.5, 1.0 | 14 | none |
| 0 0 0 -1 | 1 | 1.5, 1.5 | 23 | none |
| 0 0 0 +1 | 0 | 1.5, 1.5 | 19 | none |
| 0 0 +1 -1 | 3 | 1.0, 1.5 | 6 | none |
| 0 0 +1 0 | 0 | 1.5, 1.5 | 17 | none |
| 0 +1 0 0 | 0 | 1.5, 1.5 | 18 | none |
| 0 +1 0 +1 | 0 | 1.5, 1.5 | 1 | facing 2 |
| 0 +1 +1 0 | 0 | 1.5, 1.5 | 15 | none |
| +1 -1 0 0 | 3 | 2.0, 1.5 | 12 | none |
| +1 0 0 0 | 0 | 1.5, 1.5 | 16 | none |
| +1 0 0 +1 | 0 | 1.5, 1.5 | 3 | none |
| +1 0 +1 0 | 0 | 1.5, 1.5 | 4 | facing 5 |

**Join from cell A to cell B** (B is a 4-neighbour of A; let i be the leg pointing from A to B):

1. A's legs are those of A's current piece, if any, which is removed; otherwise all 0.
2. If this is not the path's first join, then for every side j other than the leg the walk came in by:
   - set A's leg j to 0;
   - if the cell on side j has a piece, rebuild it with its leg toward A set to 0.
3. Set A's leg i to +1. If the table has no such shape, use −1.
4. **Build** A's piece with these legs. Then build B's piece with only the opposite leg set, to the same value. The next join's incoming leg is that opposite leg.

**Build:** all legs 0 means no piece. Otherwise look up the shape. If it has a second look, take one `raw`: an odd value picks the second look, an even one the first. Rebuilds in step 2 happen in side order before A and B are built, and they draw too.

*Tested:* every object of every cliff map (cl1 to cl6, ct1, ct2, wc1, co1), by type, position and facing, in both `compare_ec.py` and the write-up check. The look affects only the facing, but it is still a draw, and the later draws depend on it.

### 5.6 What cliffs do not do

- **No elevation change.** Cliffs never change elevation.
- **Cells already used.** Cells under an earlier cliff, or near one (`min_distance_cliffs`), have value 0. A walk cannot enter them, and they cannot be a start.

### 5.7 End of the terrain stage

Three steps, in this order.

1. **Cliff lines restored.** Every tile on record (5.4) gets back the terrain it had when a cliff first touched it. That is its own earlier terrain, not the map's base terrain: a line across a DIRT land leaves DIRT. A finished map therefore has **no terrain 16**, which is what the age-of-rms exports showed (RMSTEST_31: 143-180 cliff objects, no terrain 16). The layer is not restored (*untested*: no probe had a layer under a cliff).
2. **The WATER cleanup** (de-land-stage 9) runs here, not at the end of the land stage. The reference is terrain 1 exactly. A tile that is not WATER, with WATER on both sides or in the diagonal patterns, becomes WATER and loses its layer. Each sweep is a straight pass over the whole map, then a diagonal pass. Sweeps repeat until one changes nothing.
3. **Beaches.** On a copy taken after step 2, every tile that is not shore water, and is land (class & 0x1F = 0) or ice-type (0x40), with shore water among its 8 neighbours, becomes beach (2), or 37 if its class has 0x40 or 0x80 set. This is the 8-neighbour beach rule age-of-rms adopted on 2026-10-15 (RMSTEST_75), now with its place in the order.

*Tested:*
- Step 1 on co1 (2 maps). With the base terrain instead, 247 and 125 tiles come out DESERT where DE has DIRT. With the owning land's terrain instead (a land's terrain where its zone is, else the base), 6 and 1 tiles differ: leftover and cleanup tiles show it is the tile's own earlier terrain. The scripting guide says terrain 16 "turns into the map's base_terrain". That holds for lines on the base terrain, the usual case, and fails for lines across another land. The guide's other claim, that 16 "can be replaced during <TERRAIN_GENERATION>", is untested, and AoE2RMSIDE contradicts it: it restores every recorded tile, whatever the terrain stage painted there. Round ET's `t9-cliffs` tests it.
- Step 2's place on wc1 seed 1000. With the cleanup at the end of the land stage, the cliff stage's repair sees a different coast, and 20 tiles differ, the terrain-70 tile among them. Seed 1001 cannot tell the two places apart.
- Step 3 on wc1 and on the 14 earlier water maps.

*Untested:* anything `<TERRAIN_GENERATION>` does with terrain 16 or with the not-yet-cleaned water in between (spacing, `base_terrain` matches). Also untested: the height of a tile the WATER cleanup turns to water after the elevation stage raised it. No probe had hills next to water.

## 6. Draw count summary (for checking an implementation)

**Land stage, extra to the land write-up:** the base terrain's decoration draws (5.4 table) per tile the cleanup restores to the base terrain: 3 for GRASS, 0 for DESERT (3.0). Painting spends none.

**Elevation:** 1, plus per layer:
- 2 × candidates;
- 1 per pop during growth;
- 1 per neighbour inserted during growth.

Seeding costs no draws.

**Cliffs:** 1 + 2 × candidate cells + 1 (count), plus per cliff:
- 1 for the length;
- if a start is found: 1 for the heading, 1 per step attempted (a step that finds no direction still drew), one `raw` per build of a two-look shape, and the decoration draws of the line tiles (terrain 70 spends none; the repair's markers 70 and 16 have no decorations).

`cliff_type` changes no draw.

## 7. What this changes in preview-design (rev 9 Sec.6.2, 6.3)

**Sec.6.1 / land stage (rev 2026-10-19):**
- **Restore draws.** Each tile the base-terrain cleanup restores spends the base terrain's decoration draws (3.0). The land-stage gate (`landStageDeMaps.test.ts`) cannot see this, because nothing is drawn after the land stage on those maps. It matters as soon as a GRASS-based script has an elevation or cliff section.
- **`base_elevation`.** A land writes its height on its stamp, its claims and every leftover cell whose roll passes, terrain or not, so plateaus carry a base-terrain rim. Water-like lands stay at 0.
- **`base_layer`.** It marks every unpainted tile and no painted one, and it splits where `create_elevation` can grow (3.0).

**Sec.6.4 (WATER cleanup):** rev 9's choice, the end of the terrain stage, is now measured (wc1). It runs after the cliff lines are restored and before the beach rule. Cliffs and elevation see the uncleaned coast.

**Sec.6.2 Elevation: replace the statistical model with Section 3.** It is exact, and it reproduces the spec's measurements without fitting:
- the diagonal bias and its density table (caused by the unlink square, 3.3);
- the overshoot and the 6-tile floor per clump;
- the side-length default (`number_of_tiles` = W);
- the seven-layer histogram of RMSTEST_32.

The spec's measured drop in bias with player lands was not re-checked.

`seedRatio`, `A`, `RMAX`, the knee and the overshoot allowance can all go. Specific changes:
- **Avoidance:** "≥9 tiles from player-land origins" becomes the weight of 3.2. Up to 13 tiles out, a tile is excluded from seeds and refused at random during growth.
- **Heights:** layers 1..H, each grown on the tiles left at the height below, with smoothing after each. This replaces "per-clump rolled height h ∈ [1, MaxHeight], rings by distance from the clump edge". There is no per-clump height roll: a single-clump command with H = 3 grows three layers, each seeded anew on the one before.
- **`spacing`:** affects layers 2+ only; layer 1 always uses 2.
- **`enable_balanced_elevation`:** turns off the unlink square. That is all it does.
- **Scaling:** `set_scale_by_size` and `set_scale_by_groups` multiply by W·H/10000 and truncate (tested).
- **No section, no smoothing:** without `<ELEVATION_GENERATION>`, land heights stay as painted, steps included (3.5).

**Sec.6.3 Cliffs: replace the coarse simulation with Section 5.**
- **Count:** default max is 9, not 8, and it is exclusive. Length is also max-exclusive (the spec says inclusive).
- **Pieces:** a cliff of length L has L + 1 pieces when the walk is not cut short; the spec's "≈ 3·(len+1) tiles" counts line tiles.
- **Clearance:** no cell of a cliff, start or later, lies within 7 cells of **any land's** origin. The clearing zeroed those cells, and the walk only enters cells with the target value. The spec says 22 tiles from every land origin, which is close (7 cells is 21 to 23 tiles).
- **Slopes:** "not on sloped tiles" becomes "a whole 3×3 cell at one elevation, and the walk stays at that elevation".
- **Terrain 16:** cliffs do paint terrain 16, but only until the end of the terrain stage (5.7). Sec.9's "not simulated" is right for the finished map.
- **Restore:** line tiles get their own earlier terrain back, not the base terrain (5.7, tested).
- **Distances:** `min_distance_cliffs` and `min_terrain_distance` are in cells.
- **Header:** a bare `<CLIFF_GENERATION>` header makes default cliffs (confirmed).
- **Styles:** `cliff_type` picks the base object id (5.1).
- **Water:** the repair around each segment (5.4) beaches coast near a line and can leave terrain 70 in the finished map.

**Sec.8 (seeded RNG):** the elevation and cliff stages use the same single stream, continuing after the land stage. With the restore draws of 3.0, the land stage's draws are complete on every map tested.

## 8. Not tested

After round EC2 these are left, roughly in order of how likely a real map is to hit them:

- **Water and hills:** a raised tile that the late WATER cleanup turns to water (what height it keeps); hills or cliffs beside SHALLOW, ICE or frozen terrain (round ET `e5-coast`); a positive `min_terrain_distance` against real water.
- **The second water repair** (marker 16) never fired. If it fires, its tiles are not on record, so a finished map **would keep terrain 16** there. That is a prediction worth a probe.
- **Land attributes:** `base_layer` on `create_land`; a non-water land over a raised one; the layer of a tile restored by the cleanup or under a cliff line.
- **Decoration draws:** restores on decorated base terrains other than GRASS; entries at weight 1000 (2 draws randomized, 0 centered; FOREST and several others have one). Painting a GRASS land.
- **Elevation settings:** negative `create_elevation`; heights of 8 and above (the lowering branch of the smoothing; RMSTEST_32 and 50 reach 7); an empty `<ELEVATION_GENERATION>` header; spacing of 256 or more (only its low 8 bits are used in 3.3); more than 999 clumps; scaling at sizes other than Tiny (sc1 at 200 was optional and not saved).
- **Cliff settings:** `cliff_type` 2, 3 and 4; min > max.
- **Sizes:** only 120, 168 and 200 tested.
- **The terrain stage:** anything `create_terrain` does with terrain 16 or with uncleaned water before the end of the stage.

## 9. Sources and credit

- **Our tests:** the study's test folder. Its probe scripts, run sheets, predictions and results log are kept beside this file, in `../probes` and here. Its Python tools are not (see ../README.md).
  - `elevation_model.py`, `cliff_model.py` and `stage_model.py` are our own Python model of everything above.
  - `probe_ec.py` and `probe_ec2.py` hold the probe scripts; `compare_ec.py` (both rounds) and `compare_ec_sizes.py` do the comparisons.
  - `results.md` (2026-10-17 and 2026-10-19) holds every result and control.
- **Game data:** terrain placement classes and decorations are read from `empires2_x2_p1.dat` (the fields named above), which age-of-rms's `tools/extract-constants` already parses. The cliff piece table is engine logic, measured by our maps (5.5).
- **AoE2RMSIDE** (github.com/aoe2control/AoE2RMSIDE, Apache 2.0, `crates/rms-engine/src/exact_elevation.rs`, `exact_cliff.rs`, `exact_cliff_piece.rs`, read at commit 210d977) gave the algorithms and the data tables. We read it, restated it, and tested it against DE. Every tested rule agreed, including the two engine quirks it reproduces on purpose (stale list links; the unlink square's bottom edge). In round EC2 its reading won every time: the restore draws, raw plateaus, the WATER cleanup at the end of the terrain stage, and cliff lines restored to their earlier terrain. For the last one the scripting guide says "base terrain", which is wrong for lines across a non-base land (5.7).
- **The age-of-rms calibration runs** (RMSTEST_10 to 50) gave the statistical checks, and the observation that finished maps carry no terrain 16.

## 10. Round EC2: what each map decided (2026-10-19)

Every reading was predicted before the run. Each map matched exactly one reading (`tests/compare_ec.py`), and the rejected reading's misfit shows how sharply the map could tell them apart.

| Script | Question | Answer | Rejected reading's misfit |
|---|---|---|---|
| gr1-restore | do restored GRASS tiles spend decoration draws? | yes, 3 each (3.0) | ~1,000 elevation tiles, every cliff object |
| lh1-heights | land `base_elevation` with hills around | one reading, matches | — |
| lh2-alone | are plateaus smoothed without an elevation section? | no (3.5) | ~950 tiles |
| ly1-layer | `base_layer` matching, saved layers | one reading, matches | — |
| sc1-scale | scaling attributes | one reading, matches | — |
| ct1 / ct2 | `cliff_type` 1 and 5 | base objects 1849 and 2651 (5.1) | — |
| wc1-water | where the WATER cleanup runs | end of the terrain stage (5.7) | 20 tiles at seed 1000; 1001 cannot tell |
| co1-overland | what a cliff line gets back | its earlier terrain (DIRT) | 247 and 125 tiles |

Plus one control nobody had planned: co1's lines cross DIRT, whose centered decoration costs 1 draw per line tile. With 0 draws, both co1 maps lose almost every cliff object (5.4).

**Surprises worth knowing when writing scripts:**
- **A vanished sliver changes the whole map.** Tiles the land cleanup gives back to a GRASS base spend 3 draws each, so a tiny land that disappears still moves every hill and cliff. The same script on a DESERT base does not have this.
- **Raised lands have a rim.** A land's `base_elevation` reaches leftover cells that never get its terrain, so a SNOW plateau stands on a ring of raised base terrain. Water lands ignore `base_elevation`.
- **`base_elevation` alone makes sheer steps.** Without an elevation section nothing smooths them (0 to 6 between neighbours). Any elevation section, even one hill elsewhere, smooths after every layer and ramps every plateau down to the base.
- **`base_layer` in `<LAND_GENERATION>` quietly splits the map for elevation.** A `create_elevation` without the same `base_layer` can no longer grow on the base area, only on painted lands.
- **The coast is cleaned last.** Hills and cliffs are placed against the uncleaned coast, and the water fill runs only at the very end. A cliff near water can leave a lone terrain-70 tile in the finished map, a terrain no script asked for.
- **`cliff_type` is purely cosmetic.** The same seed gives the same cliffs in another style.
