# Land probe: predictions written BEFORE any DE run (2026-10-09)

Model: AoE2RMSIDE's draw order, restated in land_predict.py. Map Tiny (120). Centres (x,y) of the 5x5 squares, lands in script order W D S F m(dirt).

```
1000 K=0 W(7,28) D(86,79) S(73,90) F(112,16) m(82,26) 
1000 K=1 W(28,86) D(79,73) S(90,112) F(16,82) m(26,55) 
1000 K=2 W(86,79) D(73,90) S(112,16) F(82,26) m(55,52) 
1000 K=3 W(79,73) D(90,112) S(16,82) F(26,55) m(52,84) 
242424 K=0 W(60,38) D(65,81) S(61,76) F(37,81) m(79,77) 
242424 K=1 W(38,65) D(81,61) S(76,37) F(81,79) m(77,25) 
242424 K=2 W(65,81) D(61,76) S(37,81) F(79,77) m(25,83) 
242424 K=3 W(81,61) D(76,37) S(81,79) F(77,25) m(83,80) OVERLAP
```

Seed 1000 is the clean one (no overlaps for K=0..3); 242424 K=3 overlaps. Run seed 1000 at K=0,1,2,3 first. Read with: ..\.venv\Scripts\python.exe read_land_probe.py FILE
A shift of K should move the list by K places: K=1 gives the K=0 coordinates slid by one number (x becomes the old y), K=2 drops the first land.
