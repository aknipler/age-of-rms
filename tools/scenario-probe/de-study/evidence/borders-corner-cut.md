# Borders and the corner cut (2026-10-15)

Question: when a land grows out to the map edge, does the corner cut ("chamfer") still happen? Is that why some maps use negative borders?

## Short answer

Partly yes. **Only the left and right borders make the cut, and they make it by pulling in the top and bottom.**

- **If the land has a left or right border inset from the map edge,** the top and bottom corners on that side are cut. This happens **even when the top or bottom is the map edge**. A negative `top_border`/`bottom_border` moves the cut off the map, so your reading of negative borders is right for top and bottom.
- **If the left or right border is 0 or negative,** there is no cut on that side at all, at any edge. A negative left/right border does nothing for the cut that 0 doesn't already do.
- **Top and bottom borders never make a cut by themselves.** Top/bottom inset with left/right at 0 gives a plain band with square corners.

## The rule (write-up 6.8, in our words)

`L, R, T, B` are the border tiles (write-up 8.1). The border chance of a cell is `fuzziness × (horizontal excess + vertical excess)`. The cut comes from the vertical part: near the left or right border, the top and bottom lines move inward by `s` tiles.

- `s` is largest at the side border itself and drops by 1 per tile moving inward, which makes a 45° cut.
- Its largest value, the **cut size**, is `m = min(side inset, ⌊(R − L)/4⌋, ⌊(B − T)/3⌋)`, where the side inset is `L` on the left and `W − R` on the right.
- So the cut is as big as the side's own inset in tiles, capped at a quarter of the box's width and a third of its height. A side at the map edge has inset 0, so `m = 0` and there is no cut. A negative side border also gives no cut.
- The top line is `T` plus the shift, wherever `T` is. With `T = 0` the shifted line is inside the map and the cut shows. With `T ≤ −m` the shifted line never reaches row 0 and no cut shows. This holds for any fuzziness, because the chance is 0 when the excess is 0 or less.
- Left and right are separate. One land can have a 4-tile cut on the left and a 2-tile cut on the right.

## Evidence from DE

`RMSTEST_16` (age-of-rms `tools/scenario-probe`, two saved maps, Tiny): borders left 3, right 2, top 6, bottom 9, `border_fuzziness 100`, `land_percent 100`. At fuzziness 100 every chance is either 0 or 100 or more, so the land's outline doesn't depend on the seed and can be checked directly against the rule (script in the scratchpad, `rmstest16.py`).

- Border tiles: `L 4, R 118, T 7, B 109`.
- **Both maps match the rule's outline exactly:** no grass outside it, and inside it only the two 7×7 desert player bases (plus one interior tile in one map, away from every edge).
- The rows show which borders set the cut size:

| row | DE grass x | rule |
|---|---|---|
| 7 (top line) | 8..116 | 8..116 |
| 8 | 7..117 | 7..117 |
| 9 | 6..118 | 6..118 |
| 10 | 5..118 | 5..118 |
| 11 onwards | 4..118 | 4..118 |

  The left cut is 4 tiles, the left inset. The right cut is 2 tiles, the right inset. The top and bottom insets (7 and 11) play no part. The bottom mirrors this exactly.

What these maps don't show: a cut against the map edge itself. No saved DE map has a land with a side border inset and its top or bottom at 0 or below. `p2-border` used inset borders on all sides and small lands, and `e2-corner-4000` had no borders. **Case A below was later confirmed by `RMSTEST_75` (see the last section); the others are predictions.**

## Predicted shapes, Tiny (120), fuzziness 100

`#` allowed, `.` refused. The top-left corner, columns 0–29:

```
A  left 10 right 10 top 0 bottom 0       B  same, top -10 bottom -10
   (L 12, T 0: cut m = 12)                  (T -12: cut pushed off)
y0  ........................######       y0  ............##################
y1  .......................#######       y1  ............##################
y6  ..................############       y6  ............##################
y11 .............#################       y11 ............##################
y12 ............##################       y12 ............##################
```

| case | borders (L, R, T, B) | corners |
|---|---|---|
| A | 10, 10, 0, 0 | all four cut by 12 tiles, against the map's top and bottom edges |
| B | 10, 10, −10, −10 | no cut: a straight band from the top edge to the bottom edge |
| C | 0, 0, 10, 10 | no cut: a full-width band |
| D | 0, 10, 10, 10 | right corners cut by 12, left corners square |
| E | −10, −10, 10, 10 | same as C |
| F | 10, 0, 0, 0, fuzziness 20 | left corners cut at the map edge, with the usual soft edge (chance 20 per tile past the line, so 4 tiles of ragged fringe) |

**How negative is enough.** The top or bottom needs to be at least `m` tiles past the edge. With both sides inset by the same `p`%, `m` is `p`% of the width until the quarter cap takes over. So `top_border −p` is exactly enough, which is case B. `m` never exceeds a fifth of the map width, so −20 always removes the cut and values like −45 are more than needed. They don't hurt the cut itself; see the next section.

## Side effects of negative borders (derived from the write-up, untested)

- **Player lands:** the placement rectangle (write-up 4.3) starts from the full map and only shrinks. A negative border can't widen it, so it acts like 0 there.
- **Lands without `land_position`** (write-up 5): the origin is drawn inside `L + base … R − base`. A negative border widens that range past the map, so the origin could fall off the map. Only one axis may be outside its middle band, so this happens, but not often. What growth does then is untested.
- **Fuzziness on the outside:** the horizontal excess can't be positive with `L ≤ 0`, so a negative side border never refuses a cell.

## Why you might see no cut at the map edge

- The land's left/right borders are 0, or they're negative, so the cut size is 0. A land that fills the map's width has square corners at the top and bottom edges.
- The cut is pushed off the top or bottom by a negative top/bottom border.
- A top/bottom border meets the left or right *map edge*. The cut belongs to the side borders, so a land inset only at the top has square corners where it meets the map's left and right edges.
- At low fuzziness, the soft edge hides a small cut.

## Proposed DE check (not run)

Cases A, B and D as three one-land scripts, using the RMSTEST_16 recipe: DESERT base, a GRASS `create_land`, `land_position 50 50`, `base_size 1`, `land_percent 100`, `border_fuzziness 100`, no player lands, Tiny. The outline doesn't depend on the seed, so one map each is enough. **Control:** A against B. They differ only in the top and bottom 12 rows (a cut against the edge in A, none in B), so anything else that differs points to a mistake in the setup. If A shows square corners at the map edge, the rule's `min(…, side inset)` term is right but the top line is clamped to the map somewhere we haven't modelled.

The preview (age-of-rms rev 9, `borderChance`) uses the same rule. The tutorial step written today read these shapes off the preview, not off DE.

## RMSTEST_75: the cut against the map edge, and beaches (2026-10-15)

Script `RMSTEST_75_borders_and_beaches_discrepancy.rms` as generated: WATER base, one DIRT land with `land_percent 100`, left 33, bottom 33, top 0 (the saved `.rms` says 1; it was edited after the map was made), right 0, fuzziness 100, no `land_position`, `behavior_version 1`, Tiny. Rule: `L 40, R 120, T 0, B 80`, cut 20 tiles on the left.

- **The land matches the rule tile for tile, and this is the first DE map with a cut against the map edge.** Row 0 starts at x 60 and the cut runs 20 rows down to x 40, as predicted in case A above. The preview's land matches too: 8340 water in both.
- **The discrepancy is the beach, 40 tiles.** DE writes BEACH on every land tile with water in any of its **8** neighbours, diagonals included: 180 of 180 here, and 432 of 432 on both `RMSTEST_15` maps. The preview's `applyAutomaticBeach` looks only at the 4 side neighbours. It gets 140 here (420 on `RMSTEST_15`), missing exactly one tile per row on each 45° coast. On a diagonal coast DE's beach is 2 tiles thick and the preview's is 1. Straight coasts are identical.
- Off the map counts as not water: the land along row 0 and column 119 gets no beach.
- **Shallows use the same 8 neighbours.** Both saved `RMSTEST_52` maps (grass, a SHALLOW shelf and open water, border fuzziness 0, so the coasts are ragged): DE beach = land with water or shallows in any of its 8 neighbours, 721 of 721 and 862 of 862, no misses and no extras. 28 and 65 of those beach tiles touch shallows only diagonally, so the diagonal rule is exercised on that boundary too. With 4 neighbours the rule falls short by 183 and 231. Shallow tiles never become beach, even next to open water.
- Not checked: `beach_terrain` on `create_terrain`.
