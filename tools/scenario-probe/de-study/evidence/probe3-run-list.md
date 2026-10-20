# Team-order probes (12 maps), written 2026-10-10

Purpose: find the rule DE uses to order the members of a team in fixed-position lobbies. In every failing team map the
model's draw count was right (the neutral land lands in the right place) but the order of the players inside one or
more teams was wrong. Script: p4-players (already in the game folder). Lobby: 4 players, ONE pair teamed, the other two
players on no team. Save as `RMSTEST_p4-players_<seed>_<lobby>` and run `compare_probes2.py` as before.

| Seed | Lobby codes (the pair that is teamed) |
|---|---|
| 1000 | n4t1100 (1+2), n4t0011 (3+4), n4t1010 (1+3), n4t0101 (2+4), n4t1001 (1+4), n4t0110 (2+3) |
| 1001 | the same six |

Only pairings matter, not team numbers.
