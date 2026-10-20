# DE's land stage, measured (write-up for the preview revision, 2026-10-13)

What Age of Empires II DE does from the seed to the end of `<LAND_GENERATION>`, in our own words, at the level of detail needed to reproduce its maps tile for tile. It is written for the age-of-rms preview spec (`docs/preview-design.md`), whose Sec.1 still lists seed parity as a non-goal. Section 10 lists where this overturns that spec. No code from any other project is reproduced here; Section 12 says where the first leads came from.

## Scope and confidence

- **Build:** DE 101.103.54800.0.
- **Instrument:** maps generated in the scenario editor (Seed Map, the seed typed in, Team Positions ticked unless stated), saved, and read back tile by tile with AoE2ScenarioParser. One skirmish (seed 370167422, 5 players) gave the same map as the editor and the model.
- **Map size: Tiny (120 × 120) only.** The rules are written for any size, but no other size has been tested.
- **Stages: `<PLAYER_SETUP>` and `<LAND_GENERATION>` only,** plus one villager per player as a marker for the player positions. Nothing after the land stage (elevation, cliffs, terrain, connections, objects) has been tested.
- **Result:** 146 saved maps from 34 probe scripts, 1 to 8 players.
  - 135 match DE tile for tile as saved.
  - 6 more match once the alliances left in the editor's saved diplomacy are read (Section 4.8).
  - The last 5 have alliance tables that no lobby can produce.
- **Independent check:** a second implementation written from this text alone (`tests/writeup_check.py`) reproduces DE on exactly the same maps.
- **Status tags:** each rule ends with what tested it. *Untested* means the rule comes from reading other work (Section 12) or from the arithmetic of a tested rule, and no DE map exercises it.

Notation: `W` and `H` are the map width and height in tiles. `⌊a/b⌋` is integer division. "Round" means round half away from zero. "Single precision" means the arithmetic is done in 32-bit floats. Tile `(x, y)` is the scenario file's coordinate (x first; confirmed with `land_position 21 3` landing at x 24–26, y 3–5).

## 1. The random number generator

One generator drives the whole stage, from the script's first `rnd()` to the last growth step. There are no per-command or per-stage substreams. Every draw described below comes off this single stream, in the order given.

**Algorithm.** WELL512 exactly as Chris Lomont published it ("Random Number Generation", 2008). It keeps 16 state words of 32 bits and an index that starts at 0. The output of each step is the word written last. Checked against our model on 206 seeds × 300 outputs with zero differences (2026-10-13).

**Seeding a generator from a 32-bit value `s`.** It fills the 16 words with two sequences run side by side:

- `x` starts as `s` with its four bytes reversed, XOR `0xAAC29377`. Each step is a 32-bit xorshift: `x ^= x << 17`, then `x ^= x >> 13`, then `x ^= x << 5`.
- `h` starts as `s`. Each step applies Robert Jenkins' 32-bit integer hash: the six-line version with the constants `0x7ed55d16`, `0xc761c23c`, `0x165667b1`, `0xd3a2646c`, `0xfd7046c5`, `0xb55a4f09`. Checked identical on 2000 random inputs.
- Word `k` (k = 0..15) is `x XOR h` after step `k + 1`.

**The chain.** Generator 1 is seeded with the game seed; a negative seed is taken as its 32-bit two's complement. Generator 2 is seeded with generator 1's first output. **The map script uses generator 2, whose first output has already gone into the chain** (it would seed generator 3). So the script's first draw is generator 2's second output.

*Tested 2026-10-09:* four seeds (1000, 123456789, 242424, −1411066173), 25 `start_random` blocks each, 100 of 100 branch choices. The search covered generators 1–4, 0–2999 skipped draws, 1–4 draws per block and 9 range rules; only this combination fits.

**From a 32-bit draw to a range.** Three forms, each used by specific steps:

- **`bounded(n)`** = `(n × raw) >> 32`, which gives 0..n−1 by multiplying and shifting, with no rejection. Everything uses this unless stated otherwise.
- **`index(n)`**, used only by the slot shuffle: `raw % n`, except that a raw value at or above `n × ⌊(2³² − 1)/n⌋` is thrown away and redrawn. No redraw happens when `n` is a power of two. For the other `n` up to 8 it affects at most 4 of the 2³² values.
- **`low15(m)`** = `(raw & 0x7FFF) % m`, used only by the three team-order draws.

## 2. Order of the draws

1. **Parse time**, in textual order through the whole script (Section 3).
2. **Player setup** (Section 4): the slot shuffle, the team-order draws (Team Positions on), the perimeter start, one perimeter offset per player land, then one edge offset per player land.
3. **Origins of every land still without one** (Section 5), in script order.
4. **One draw that does nothing we can see** ("the burned draw"). It sits between the origins and growth on every map tested, and its purpose is unknown.
5. **Growth** (Section 6).
6. **Leftover fill** (Section 7).
7. *Untested:* the stages after `<LAND_GENERATION>` presumably continue on the same stream.

## 3. Parse time

All of these happen before any player-setup draw, wherever they sit in the file.

- **`start_random` takes one draw per block:** `roll = bounded(100)`, 0..99. The first branch whose running total of `percent_chance` values is **at least** the roll is taken. So the first branch wins for `w₁ + 1` of the 100 values and each later branch for exactly its own weight. A block whose weights add up to 99 or 100 always takes a branch. *Tested:* 2026-10-10, 40 blocks with weights set on the roll boundary at two seeds (`p6-range`); "at least" fits all 40 and "more than" fails. Also the four-seed check of Section 1. *Untested:* blocks whose weights add up to less than the roll (no branch taken), empty blocks, nested blocks, totals over 100.
- **`rnd(a, b)` = `a + bounded(b − a + 1)`.**
- **`#const NAME rnd(a, b)` draws once, where it is defined.** Every use of `NAME` reads that one value.
- **Every `rnd()` in every branch of a `start_random` block is drawn before the block's roll,** in textual order, including branches that are then not taken.
- **`assign_to` in random mode (`0`) takes one draw; ordered mode (`−1`) takes none.** *Untested:* which player the draw picks.
- **`set_zone_randomly` takes one draw per land:** zone = `bounded(players) − 8`, so −8 to players − 9.

*Tested 2026-10-10:* `p5a-rnd` (a `#const rnd`, `rnd` inside `land_position`, `rnd` in a branch not taken; seeds 1000 and 1001), `p5b-assign-rand` and `p5b-assign-ord`, and `b3-zonerand` (2 and 4 players).

## 4. Player setup

Player setup runs before any neutral land is placed. Its draws are spent even when the script creates no player lands. *Untested:* a script with no land commands at all, where Team Positions on may skip the whole step.

**Player lands** are the lands from `create_player_lands`, one per player in the game, plus every `create_land` assigned to a player in the game. Lands assigned to players not in the game are not created.

### 4.1 Slot shuffle (7 draws)

`order = [1, 2, …, 8]`. For `k` = 1 to 7: `j = index(k + 1)`, then swap `order[k]` and `order[j]`. All 8 slots take part, including slots not in the game.

### 4.2 Team order (only with Team Positions on)

1. `d1 = low15(100)`; call the game *descending* if `d1 < 50`.
2. With more than one player: `d2 = low15(100)`. If `d2 < 50`, `d3` gives the **selected player** = `(d3 & 0x7FFF) % (players + 1)`, a player number where 0 means nobody. If `d2 ≥ 50`, nobody is selected and `d3` is not drawn.
3. A **team** is a lobby team with at least two players in the game; an un-teamed player stands alone. For each team, take the positions in `order` that hold its members and write the members back into those positions sorted by player number:
   - **ascending** when d1 ≥ 50 and the team holds the selected player, or d1 < 50 and it does not;
   - **descending** otherwise.

   With nobody selected, every team takes the not-selected direction.

**With Team Positions off** (the editor checkbox unticked) there are no `d1`/`d2`/`d3` draws and no reordering, and the perimeter pass (4.4) treats every player as alone.

*Tested 2026-10-10 to 13:*

- 4 players (layouts 1122, 1212, 1221, 14 seeds) and 8 players (three layouts, 7 seeds);
- 6 players with teams of 2 and 3, interleaved teams, and partial teams; 7 players with three pairs and a single;
- 1 to 8 players with no teams;
- Team Positions off: 2 maps.

*Not established:* how the lobby's settings map onto the editor's checkbox. The skirmish showed "Fixed Positions: Yes" and matched the ticked case. The unticked case has been seen only in the editor.

### 4.3 The rectangle

Players are placed on the perimeter of a rectangle, not a circle. From the player lands, with `L, R, T, B` the land's border tiles (8.1) and `base` its `base_size`:

- `aw` = the smallest `R − L − 2·base` over the player lands, starting from `W`. `ah` is the same with `T`, `B`, starting from `H`.
- `minx` = the largest `L + base`, starting from 0. `miny` = the largest `T + base`.
- `sx = ⌊6·aw/10⌋`, `sy = ⌊6·ah/10⌋`, `tw = ⌊2·aw/10⌋` (from `aw` for both axes), `half = ⌊tw/2⌋`.
- Perimeter length `P = 2·(sx + sy)`. With `circle_radius`, `P` comes from 4.6 instead.

Example: Tiny, no borders, base 3 gives `aw = 114`, `sx = sy = 68`, `tw = 22`, `half = 11`, `P = 272`.

### 4.4 The perimeter pass (`random_placement`, the default)

- `count` = the number of player lands (at least 1), `step = ⌊P/count⌋`, `jit = ⌊step/count⌋`.
- `current = bounded(P)`.
- Go through `order` (after 4.2) as the *outer* player. For each outer player, go through `order` again as the *inner* player. Take every inner player that is the outer player or on its team, has not been placed yet, and owns at least one land. For each of that player's lands, in land order:
  - `p = bounded(jit) + current − ⌊jit/2⌋`;
  - if `p < 0`, add `P`; if `p > P`, subtract `P`;
  - that land's perimeter value is `p`;
  - `current += step`; if `current ≥ P`, subtract `P`.

  Then mark the inner player as placed.
- The effect is that teams sit together, in the order their first member appears in `order`, with members in `order`'s order. Slots not in the game cost nothing.

**Coordinates.** These come after every perimeter value is known. For each player land in land order, one draw `j = bounded(tw) − half`. With `b1 = sx`, `b2 = sx + sy` and `b3 = 2·sx + sy`:

| perimeter value | x | y |
|---|---|---|
| `p < b1` (low-y edge) | `minx + tw + p` | `miny + half + j` |
| `p < b2` (high-x edge) | `minx + sx + tw + half + j` | `miny + tw + (p − sx)` |
| `p < b3` (high-y edge) | `minx + tw + sx + (b2 − p)` | `miny + sy + tw + half + j` |
| otherwise (low-x edge) | `minx + half + j` | `miny + tw + sy + (b3 − p)` |

So the players travel round a rectangle whose sides lie `half` inside the available box. Along each side they use a stretch of `sx` (60% of the box), keeping `tw` clear of the corners, and each is pushed off its side by up to `±tw/2`. In the example the sides lie at 14 and 104, each stretch runs from 25 to 93, and the push is up to ±11. A land that never received a perimeter value keeps 0 and sits at the start of the low-y side, `x = minx + tw` (see 4.8).

*Tested:* every `random_placement` map (`p4-players` with 2 to 8 players; 63 `p4o-players` maps whose villagers give each player's position; `a5-assign`; the 11-draw prelude series).

### 4.5 `grouped_by_team`

- **Groups:** each team (4.2) is a group and each un-teamed player a group of one. With `G` groups, `step = ⌊P/G⌋` and `current = bounded(P)`. There are no per-land perimeter draws.
- **Placing a group:** go through `order`. At each player in the game not yet placed, its group's members (in `order`'s order) are placed together:
  - `span` = the sum of `2·base + 5` over the members that own a land, minus 5;
  - `cursor = current − span/2`, the division truncated toward zero;
  - for each member: if it is not the first, `cursor = (cursor + 5 + base) mod P`; the land's perimeter value is `cursor`; then `cursor = (cursor + base) mod P`;
  - after the group, `current = (current + step) mod P`.
- **"mod" keeps the sign of the left operand,** as C's `%` does, so a negative cursor stays negative.
- **Consecutive teammates are `base_a + 5 + base_b` apart** along the perimeter, which is 11 for base 3.
- **Coordinates** as in 4.4, with one edge draw per player land.

*Tested:* `a3-grouped`: 4 players with no teams, 4 players 1122 at seeds 1000 and 1001, 8 players 11223344. *Untested:* a member with no land, a group that does not fit the perimeter, several `create_player_lands`.

### 4.6 `circle_radius R V`

- `r` = round(`W × R / 100`) in single precision. `P` = truncate(`r × 2π`) in single precision.
- The same perimeter pass (4.4 or 4.5) runs on this `P`.
- **Coordinates:** for each player land, with `c = ⌊W/2⌋`:
  - `angle = (2π / P) × p`;
  - `x = truncate(cos(angle) × r + c)`, `y = truncate(sin(angle) × r + c)`, all in single precision;
  - if `V > 0`: `x += bounded(2V) − V`, then `y += bounded(2V) − V`;
  - clamp `x` and `y` to `[base, W − base]`.

  There is no rectangle edge draw, and nothing is drawn when `V = 0`. The ring is centred on the map, and the border-derived `minx`/`miny` do not apply.

*Tested:* `a6-circle` (R 35, V 0, 2 and 4 players) and `a6b-circlev` (R 30, V 5, seeds 1000 and 1001). Our model takes cos/sin in single precision and matched. *Untested:* `circle_radius` with teams, and whether DE's cos/sin could differ in the last bit.

### 4.7 `direct_placement`

- **Draws:** the shuffle, the team step (with Team Positions on), one more draw, then one per player land. No coordinate draws.
- **Positions:** each player land goes to its `land_position` (8.2). A player land without a `land_position` gets a random origin like a neutral land (Section 5).

*Tested:* `a4-direct` (2 and 3 players, with and without `land_position`, a land for a missing player removed), `p5b`. *Untested:* with Team Positions off.

### 4.8 Not for the engine: alliances with unused slots (editor only)

In a lobby, teams come from team numbers, and slots not in the game have no team. In the editor, DE builds teams from the scenario's **alliance table across all 8 slots, unused ones included.** Test maps saved after earlier lobby setups still carried alliances between players in the game and unused slots (for example 5–6, or 5–8 and 6–7), so these maps went wrong. There are two effects. They are reproduced on 8 of the 12 maps with such alliances, and the model then matches 59 of 63 villager maps (2026-10-13):

- **Players can vanish.** A team's member list includes its unused slots, while only the positions of players in the game are rewritten. The selected team's list is reversed. The first `k` entries are written (`k` = number of positions), filling positions from the last when d1 ≥ 50. When the list is longer than the positions, some players are never written back, are never placed, and keep perimeter value 0. With no unused members this is exactly 4.2.
- **Players get dragged.** In the perimeter pass, an unused slot pulls its allies to its own place in `order`.

Alliance tables that are not all-to-all (5–6, 5–8 and 6–7 together) are not reproduced (5 maps). A lobby cannot create either situation. **For editor tests:** before saving, make sure unused slots are allied with nobody.

### 4.9 Player land size and zone

- **`number_of_tiles N`** on `create_player_lands`: `N` per player.
- **`land_percent P` below 100:** each player land targets round(`W·H·P / (players × 100)`), in single precision.
- **`land_percent P` of 100 or more:** each player land targets the whole map, `W·H`, not divided. *Tested:* 4, 60, 97, 99 and 100 (2026-10-10/11). A joint budget shared between the lands was ruled out at 60, 97 and 99.
- **Zone:** player `k`'s lands are in zone `k − 10`.

## 5. Origins of the remaining lands

For each land in script order that has no position yet (neutral lands, and assigned lands under `direct_placement` without `land_position`):

1. Its own box: `L, R, T, B` from its borders (8.1); `aw = max(0, R − L − 2·base)`, `ah = max(0, B − T − 2·base)`.
2. Middle bands: x in `[⌊aw/3⌋, aw − ⌊aw/3⌋]` and y in `[⌊ah/3⌋, ah − ⌊ah/3⌋]`. With `generate_mode 1` the bands are the whole range.
3. Draw `cx = bounded(aw)`, then `cy = bounded(ah)`. If `cx` is outside its band **and** `cy` is outside its band (a corner), draw both again. This is not counted as a retry.
4. The candidate is `(L + base + cx, T + base + cy)`.
5. It conflicts with any other land that already has a position (player lands, lands with `land_position`, earlier origins) when `|dx| < d` **and** `|dy| < d`. Here `d` = `min_placement_distance` if set; otherwise the larger of the two lands' `other_zone_avoidance_distance`, plus both `base_size`s.
6. On a conflict, draw again. After 990 conflicts the land goes to the map centre, `(⌊W/2⌋, ⌊H/2⌋)`.

*Tested:* `land-probe` (positions exact at 4 seeds, 2026-10-09) and `d1-neutral` (conflicts, `generate_mode`, `min_placement_distance`; 2026-10-10).

## 6. Growth

### 6.1 Tile state and zones

Each tile holds one byte: `0xFE` = free, `0xFF` = dead (refused by a border roll), anything else = a zone. A land's zone byte is `(zone + 10) & 0xFF`, so `create_land`'s default zone −10 becomes 0 and player `k` becomes `k`.

*Derived, untested:* zone −12 becomes `0xFE`, so such a land's tiles look free to every land, which fits the guide's "belongs to no zone"; zone −11 becomes `0xFF`, dead.

### 6.2 Stamps, seeds and counters (in script order)

- **Stamp:** the square `[x − h, x + h] × [y − h, y + h]`, clipped to the map, gets the land's zone and terrain. Later stamps overwrite earlier ones.
  - `h = base_size`, or the conformity radius (6.6) when `land_conformity` is 100 or more.
  - With `set_circular_base`, only cells with `dx² + dy² ≤ h²` are written.
- **Tile count** `n_tiles` = the number of cells in the clipped square, even for a circular stamp.
- **Counters:** these say how many tiles a land has towards its target.
  - **`behavior_version` 1 or above:** the land's counter starts at `n_tiles`.
  - **`behavior_version` 0 (the default):** every counter starts at 0. Then, if the land's zone byte `z` is not greater than the land's own 0-based index `i` in the land list, **the counter of land number `z` is set to `n_tiles`**. This comes from the original 1.0c code. With default zones (`z = 0`), each default-zone land overwrites land 0's counter. In most scripts the effect is that a land grows its full target beyond its stamp.
- **Seeds:** the cells just outside the clipped square go into the land's queue at cost 0, in this order: the left column top to bottom, the row above left to right, the right column top to bottom, the row below left to right. A side lying on the map edge is skipped. **A circular stamp seeds exactly like a square one** (the sides of its bounding square).

*Tested:* `land4-grow` (13, 20 and 26 tiles predicted before the run, 2026-10-10), the tie-break probe, `a7-behavior` (version 1), `b1-circular` and `c3-conf100`.

### 6.3 Queues

- Each land has a queue of cells ordered by cost, lowest first. A new entry goes **before** existing entries of equal cost, so among equal costs the most recently added comes out first.
- A cell is in at most one queue. Adding it anywhere removes it from wherever it was, including another land's queue.

### 6.4 Rounds

Lands take turns in script order. In each round, every land that is below its target, has `land_conformity` below 100 and has a non-empty queue pops one cell. Growth ends after a round in which nothing was popped.

### 6.5 One pop

For land A popping cell `(x, y)`:

1. **Count and verdict, no draw.** On the state as it is now, count `n` and decide the avoidance verdict (6.7). The verdict is "refuse" if the cell is not free, **or if `n = 0`** (no cell of A's zone in the 5 × 5 square around it), or if avoidance refuses it.
2. **Border roll, always drawn:** `r = bounded(100)`. If A's `land_conformity` is 0 or less and A's border chance (6.8) exceeds `r`, mark the cell dead (even if another land holds it) and stop.
3. **Conformity roll** for the cell (6.6). If it fails, stop; the cell is not marked.
4. If the verdict is "refuse", stop. The cell stays as it is.
5. **Claim:** write A's zone and terrain; A's counter goes up by 1.
6. **Neighbours,** in the order left (`x − 1`), right, up (`y − 1`), down:
   - first a conformity roll for the neighbour (6.6), drawn whatever the neighbour is; skip it if the roll fails;
   - skip it if it is off the map or not free;
   - otherwise add it to A's queue at cost `bounded(100) − clumping_factor × n + 250`, where `n` is the count from step 1, taken before the claim. `clumping_factor` defaults to 8.

So every claimed cell costs 2 draws, plus 4 neighbour conformity draws, plus up to 4 cost draws. **The conformity draws are spent even when the script never mentions `land_conformity`.**

The `n = 0` refusal never fires for a cell pushed by a claim, since the claimed cell is next to it. It matters for seeds that do not touch the land's own zone. These are the corner seeds of a circular stamp, since the bounding square's sides lie mostly away from the circle. They are also the free seeds of a stamp that a later stamp in another zone covered, which is how a buried land is lost (the spec's RMSTEST_53). *Tested:* `b1-circular` (2026-10-10). The independent check of this write-up (`tests/writeup_check.py`) failed on exactly these maps until the rule was added.

*Tested:* every map. The growth-specific probes were `p1-multi` (four lands, colliding pairs), `p3a-clump` (`clumping_factor` 0, 2, 12, 25), `p3b-avoid` and the size ladder (1000 to 14400 tiles).

### 6.6 Conformity (`land_conformity c`, default 0)

- **A conformity roll** draws `d = bounded(100)`. If `d > c` the cell passes. Otherwise it passes only if it lies within the conformity radius `ρ` of the land's origin: `|dx| ≤ ρ` and `|dy| ≤ ρ` within the map, or `dx² + dy² ≤ ρ²` for a circular base.
- So with `c = 0` a cell beyond `ρ` still fails 1% of the time, and with negative `c` every roll passes. The draw is made either way.
- **The radius `ρ`:** let `t` be the land's target. If `t = 0`, `ρ = ⌊base/2⌋`. Otherwise `a` = truncate(`√t`), or `√(t/π)` for a circular base, in single precision, and `ρ = ⌊median(t, a, base) / 2⌋`.
- **`c` of 100 or more:** the stamp uses `ρ` as its half-size, and the land does not grow.

*Tested:* `c1-conf` (20, 50, 80, 99, −50), `c2-conf-circ`, `c3-conf100`, and the size ladder up to 14400 tiles.

### 6.7 The clumping count and zone avoidance (`other_zone_avoidance_distance a`, default 0)

- **Count `n`:** the cells in the 5 × 5 square centred on `(x, y)` that hold A's zone, whichever land holds them. Cells off the map count 0.
- **Avoidance:** refuse if a cell holding another zone (not free, not dead) lies within `|dx| ≤ a` and `|dy| ≤ a` of `(x, y)`. The two top-row corners of that square are trimmed:
  - Let `o = max(truncate(a × 0.66666…), 2)`. The factor is the double with bits `0x3FE55553EF6B5D46`, just under 2/3, so at `a` = 6, 9, … it gives one less than exact 2/3.
  - Rows with `dy < −o` only count cells with `|dx| ≤ o + a − |dy|`.
  - For example, at `a = 4` (`o = 2`): `dy = −4` counts `|dx| ≤ 2`, `dy = −3` counts `|dx| ≤ 3`, and every other row counts `|dx| ≤ 4`.
- **Only the growing land's own `a` counts.** With `a = 0` only the cell itself is checked, so there is no effect.

*Tested:* `a` = 0 and 4 (`p3b-avoid`, `b3-zonerand`). *Untested:* other distances, and so the trimming and the factor's effect at `a ≥ 6`.

### 6.8 The border chance (`border_fuzziness f`, default 20)

`L, R, T, B` are the land's border tiles (8.1).

- If `f = 0`, the chance is 0.
- Horizontal excess: `hx = max(0, L − x, x − R)`.
- Corner adjustment: `q = ⌊(R − L)/4⌋` and `e = max(min(q, W − R) + (x − R), min(q, L) + (L − x))`. If `e > 0`, `s = min(e, ⌊(B − T)/3⌋)`; otherwise `s = 0`.
- Vertical excess: `vy = max(0, T − y + s, y − B + s)`.
- **Chance** = `f × (hx + vy)`; a chance of 100 or more becomes 101, which always refuses.

Near a left or right border that is inset from the map edge, the top and bottom borders move inward, which rounds off the box's corners. The chance is only used when `land_conformity` is 0 or less, but the roll is drawn regardless (6.5).

*Derived, untested:* a negative `f` makes the chance negative, so it never refuses.

*Tested:* `p2-border` (`f` 20 and 5, seeds 1000 and 1001) and the corner land `e2-corner-4000`. The corner term: age-of-rms `RMSTEST_16` (borders 3/2/6/9, `f` 100, two maps) matches the outline exactly, with cuts of 4 and 2 tiles that follow the left and right insets. A cut against the map edge (left inset, top 0): `RMSTEST_75`, exact. See `notes/borders-corner-cut.md`.

## 7. Leftover fill

After growth, each land in script order empties its queue. For each cell taken out:

1. A conformity roll (6.6), one draw.
2. If the roll passes and either (x is not on the left or right map edge and both horizontal neighbours hold the land's zone) or (y is not on the top or bottom map edge and both vertical neighbours do), the cell gets the land's **terrain**. Its zone and the land's counter do not change, and the cell's own state is not checked.

The neighbour checks read the zones as growth left them, so one fill never enables another.

## 8. Shared details

### 8.1 Border tiles

`left_border p` → `L` = round(`W × p / 100`); `right_border p` → `R` = round(`W − W × p / 100`); `T` and `B` likewise with `H`. The product and quotient are single precision. With no borders, `L = T = 0`, `R = W` and `B = H`; note `W`, not `W − 1`.

### 8.2 `land_position`

`x` = round(`W × px / 100`) and `y` = round(`H × py / 100`), single precision.

### 8.3 The land list

Lands are listed in script order. `create_player_lands` expands in place to one land per player in the game, in player order.

### 8.4 Targets

- `number_of_tiles N` gives `N`.
- `land_percent P` on `create_land` gives round(`W·H·min(P, 100) / 100`).
- For `create_player_lands`, see 4.9.
- *Untested:* the target when neither attribute is given (the guide says `land_percent 100`).

## 9. Painting and cleanup

- **Painting:** stamps, claims and leftover fills write terrain as they happen. Later writes win.
- **Thin-shape cleanup against `base_terrain`:** this is the genie-rms `cleanTerrain` routine that preview-design rev 8 already ports (rule 10), both passes, including pass 1's diagonal patterns exactly as transcribed there. Sweeps repeat until nothing changes. Our model uses the same logic and matches DE on every map, which confirms pass 1 (the spec's Sec.15 item 46).
- **DE also runs the same cleanup with WATER as the reference terrain.** A non-water cell with water on both sides (or in the pass-1 diagonal patterns) becomes water, and that includes cells of the base terrain. In 1.0c this is the last step of the *terrain* stage, after `create_terrain`. On our land-only scripts the two places give the same result. **DE does the same (measured 2026-10-19, round EC2 `wc1`):** the WATER pass runs at the end of the terrain stage, after the cliff stage, so cliffs see the uncleaned coast. The order there is in `de-elevation-cliffs.md` 5.7.
- **Restored tiles spend draws (2026-10-19, round EC2 `gr1`).** Each tile the cleanup against the base terrain turns back into the base terrain spends that terrain's decoration draws at once: 3 for GRASS, none for DESERT (`de-elevation-cliffs.md` 3.0 and the table in 5.4). Painting a land spends none. Land-only maps cannot show these draws, because nothing is drawn after them.
- **Heights:** a land's `base_elevation` is written on its stamp, its claims and every leftover cell whose roll passes (`de-elevation-cliffs.md` 3.0).

*Tested 2026-10-10:* 16 maps with water lands (`c1`, `c2`, `c4-water`), including a diagonal case; the desert twins (`c4-desert`) show the extra pass is specific to water.

## 10. What this changes in preview-design rev 8

- **Sec.1, Sec.8 — seed parity is now within reach.** It needs the single shared generator of Section 1 and the exact draw order. Per-command mulberry32 substreams cannot match DE.
- **Sec.3 rule 3 — `start_random`:** the roll is 0..99 and the first branch whose running total is at least the roll is taken. The first branch gains one value, and totals of 99 or 100 always take a branch. The spec's "1–100, 100 is never chosen" is wrong.
- **Sec.3 rule 5 — `rnd()`:** drawn at parse time in textual order, including in branches not taken, not at the point of use.
- **Sec.6.1 player lands — a rectangle, not a circle (4.3, 4.4).** The spec's measured ring (RMSTEST_24: 50.4 tiles from the centre, sd 7.1, gaps 45° ± 7°) is this rectangle seen through averages. Our model, 8 players over 300 seeds, gives 48.9 tiles, sd 7.0, and gaps of 45° ± 6.4°.
- **`grouped_by_team`:** groups sit `P/G` apart, as the spec measured. Teammates are `base_a + 5 + base_b` apart along the perimeter, 11 for base 3. That is the spec's measured 10–12 tiles and settles its open "3.5–4 × base_size".
- **`circle_radius`:** the exact algorithm is in 4.6, including the variance draws and the clamp.
- **Neutral origins:** the exact algorithm is in Section 5. The cross is the middle third of the land's own box. On Tiny that is 19 or 20 tiles either side of the centre (depending on `base_size`), which is the spec's measured wall at 20.5 (RMSTEST_25). Conflicts are square with `max(avoidance) + both bases`. There are 990 conflict retries, then the map centre. This replaces K = 100 [tune].
- **`land_percent` on player lands:** divided equally below 100, the whole map each at 100 or more.
- **Rule 3 — circular stamps:** they seed like square ones.
- **Rule 4 — counters:** under version 0, the zone-indexed counter quirk of 6.2. Under version 1, the clipped square is counted, also for circular stamps. The spec's "counter starts at the stamp's count; version 0 target = declared + count" does not match.
- **Rule 6 — checks and draws:**
  - the order is border roll, conformity roll, then occupancy and avoidance;
  - conformity rolls are drawn on every pop and for every neighbour, with or without `land_conformity`;
  - the border chance has the corner term of 6.8 and applies only when `land_conformity ≤ 0`;
  - a border-refused cell becomes dead even if another land holds it, as in 1.0c. The spec's 6b chose otherwise; our model matched DE this way, but no map is known to exercise the case;
  - the avoidance square uses the full `±a` rows, with trimmed top corners (6.7). This matched DE at `a = 4`, which bears on Sec.15 item 47.
- **Rule 7:** cells off the map count 0. This confirms the spec's choice (Sec.15 item 43).
- **Rule 8 — leftover fill:** one conformity draw per cell; the terrain changes, ownership does not.
- **Rule 10 — cleanup:** pass 1 is confirmed; add the water pass (Section 9).
- **`land_conformity` is simulable:** it is deterministic and matched DE at 20, 50, 80, 99, −50 and 100. It no longer needs to be a SimulationNote.
- **Sec.9 item 12 — `TEAM_POSITIONS`/`FIXED_POSITIONS`:** for parity the generator needs this lobby setting as an input, because it changes the draws (Section 4.2).

## 11. Not tested

- **Scale and stages:** map sizes other than Tiny. Elevation and cliffs are covered by `de-elevation-cliffs.md`; the terrain, connection and object stages are untested.
- **Setup:** the selection rule of random `assign_to`; several `create_player_lands`; `grouped_by_team` with a member without a land, or groups that do not fit; `circle_radius` with teams; `direct_placement` with Team Positions off; a script with no land commands.
- **Zones and growth attributes:** zones −11 and −12; `set_zone_by_team`; avoidance distances other than 0 and 4; negative `border_fuzziness`; `behavior_version` 2.
- **Other attributes:** `override_map_size`; the default size when no size is given.
- **`start_random`:** blocks that take no branch, empty or nested blocks, totals over 100.
- **The burned draw:** its purpose. If it belongs to a feature our scripts never use, other scripts could spend more draws there.
- **Editor-only:** alliance tables that are not all-to-all (4.8).

## 12. Sources and credit

- **Our tests:** the study's test folder. Its probe scripts, run sheets, predictions and results log are kept beside this file, in `../probes` and here. Its Python tools are not (see ../README.md).
  - `results.md` is the results log.
  - `land_model.py` is our own Python model of everything above.
  - `writeup_check.py` re-implements this document from its text and compares it with the saved DE maps.
  - `inactive_allies.py` covers 4.8, and `well_check.py` covers Section 1.
- **AoE2RMSIDE** (github.com/aoe2control/AoE2RMSIDE, Apache 2.0) gave the first leads for the generator, the setup sequence and the growth loop. We read it, restated it, and tested every rule against DE. Four of its rules disagree with DE:
  1. the selected player uses `% (players + 1)`;
  2. `land_percent 100` on player lands is not divided;
  3. the water cleanup;
  4. With Team Positions off, DE still uses the 7-draw shuffle and the per-land perimeter offsets, and does not group teams. Their "random" route uses a rejection-sampled order with no perimeter offsets, and their "team together" route groups teams.

  Everything else we tested agreed with it.
- **genie-rms** (github.com/genie-js/genie-rms, GPL-3.0, Renée Kooi) gave the structure of the 1.0c land generator and its cleanup routine. Comparing it with the above shows which of DE's rules are inherited (the counter quirk, the seed order, the cleanup patterns, the water pass) and which changed.
- **Public algorithms:** WELL512 (Chris Lomont, 2008), Robert Jenkins' 32-bit integer hash, and a 32-bit xorshift.
