# Tie-break probe: prediction written before any DE run (2026-10-09)

AoE2RMSIDE's frontier is a sorted list where a new entry goes in BEFORE equal-cost entries, so equal
costs pop last-in first-out. The initial ring is inserted left, top, right, bottom, all at cost 0, so
the pop order is bottom (x, y+1), right (x+1, y), top (x, y-1), left (x-1, y). Positions: 20% of 120 = 24,
25% = 30, 45% = 54, 70% = 84, 60% = 72, so the base tiles are (24,30), (54,30), (84,30), (24,72).

| Land | Tiles wanted | Predicted tiles |
|---|---|---|
| DESERT | 2 | (24,30) (24,31) |
| SNOW | 3 | (54,30) (54,31) (55,30) |
| FOREST | 4 | (84,30) (84,31) (85,30) (84,29) |
| DIRT | 5 | (24,72) (24,73) (25,72) (24,71) (23,72): a plus |

Draws should not matter at this size: the ring costs 0 and always pops before any random-cost entry.
If the shapes differ, or change with the seed, the model is wrong somewhere.
