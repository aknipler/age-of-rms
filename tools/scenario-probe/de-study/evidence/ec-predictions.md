# Round EC predictions (written 2026-10-17, before any DE run)

From `stage_model.py` (land_model + elevation_model + cliff_model, our restatement of AoE2RMSIDE).
Full grids are in `ec_predictions.pkl`; `compare_ec.py` compares tile for tile.

- `el1-one` seed 1000: heights 1:419; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 30091, 'cliffs': 30091} (digest 839bec48176e)
- `el1-one` seed 1001: heights 1:409; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 30038, 'cliffs': 30038} (digest 67a994eab595)
- `el2-clumps` seed 1000: heights 1:839; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 31436, 'cliffs': 31436} (digest ac4a21050b2a)
- `el2-clumps` seed 1001: heights 1:853; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 31441, 'cliffs': 31441} (digest ed48d042c4eb)
- `el3-layers` seed 1000: heights 1:426, 2:46, 3:26, 4:27; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 32416, 'cliffs': 32416} (digest ad66f31ad8ba)
- `el3-layers` seed 1001: heights 1:180, 2:147, 3:167, 4:32; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 34666, 'cliffs': 34666} (digest 2c889af08d21)
- `el4-spacing` seed 1000: heights 1:796, 2:123, 3:10; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 34319, 'cliffs': 34319} (digest 9dcaa76b144a)
- `el4-spacing` seed 1001: heights 1:332, 2:256, 3:337; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 37593, 'cliffs': 37593} (digest 4ae6c60ee931)
- `el5-players` seed 1000: heights 1:868, 2:699; cliff-line tiles 0; cliff pieces 0; draws {'land': 792, 'elevation': 38079, 'cliffs': 38079} (digest 1656e57d47e8)
- `el5-players` seed 1001: heights 1:728, 2:833; cliff-line tiles 0; cliff pieces 0; draws {'land': 771, 'elevation': 38469, 'cliffs': 38469} (digest 0942426cc0f2)
- `el6-two` seed 1000: heights 1:483, 2:341, 3:105; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 52768, 'cliffs': 52768} (digest dfd650f15846)
- `el6-two` seed 1001: heights 1:549, 2:216, 3:178; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 51980, 'cliffs': 51980} (digest a9ab2e33d93f)
- `el7-stack` seed 1000: heights 1:964, 2:717, 3:556, 4:2396; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 93269, 'cliffs': 93269} (digest 109b53c2c3b0)
- `el7-stack` seed 1001: heights 1:2317, 2:591, 3:316, 4:1447; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 92426, 'cliffs': 92426} (digest a4ca1984242c)
- `cl1-default` seed 1000: heights ; cliff-line tiles 136; cliff pieces 50; draws {'land': 18, 'elevation': 18, 'cliffs': 3172} (digest 6d6410eb04fb)
- `cl1-default` seed 1001: heights ; cliff-line tiles 148; cliff pieces 54; draws {'land': 18, 'elevation': 18, 'cliffs': 3176} (digest 46c9eee86a40)
- `cl2-curly` seed 1000: heights ; cliff-line tiles 327; cliff pieces 117; draws {'land': 18, 'elevation': 18, 'cliffs': 3235} (digest f0d1718e98ce)
- `cl2-curly` seed 1001: heights ; cliff-line tiles 336; cliff pieces 120; draws {'land': 18, 'elevation': 18, 'cliffs': 3248} (digest f95697e54d63)
- `cl3-elev` seed 1000: heights 1:426, 2:46, 3:26, 4:27; cliff-line tiles 129; cliff pieces 47; draws {'land': 18, 'elevation': 32416, 'cliffs': 35455} (digest d1c8b766b617)
- `cl3-elev` seed 1001: heights 1:180, 2:147, 3:167, 4:32; cliff-line tiles 123; cliff pieces 45; draws {'land': 18, 'elevation': 34666, 'cliffs': 37674} (digest 06d8a674ac90)
- `cl4-grass` seed 1000: heights ; cliff-line tiles 142; cliff pieces 52; draws {'land': 18, 'elevation': 18, 'cliffs': 3603} (digest aa8b47967ee6)
- `cl4-grass` seed 1001: heights ; cliff-line tiles 133; cliff pieces 49; draws {'land': 18, 'elevation': 18, 'cliffs': 3571} (digest 71feb7de9526)
- `cl5-header` seed 1000: heights ; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 18, 'cliffs': 18} (digest ddcd72235518)
  - if the bare header gives default cliffs: heights ; cliff-line tiles 111; cliff pieces 41; draws {'land': 18, 'elevation': 18, 'cliffs': 3156}
- `cl5-header` seed 1001: heights ; cliff-line tiles 0; cliff pieces 0; draws {'land': 18, 'elevation': 18, 'cliffs': 18} (digest ddcd72235518)
  - if the bare header gives default cliffs: heights ; cliff-line tiles 148; cliff pieces 54; draws {'land': 18, 'elevation': 18, 'cliffs': 3176}
- `cl6-players` seed 1000: heights ; cliff-line tiles 397; cliff pieces 148; draws {'land': 586, 'elevation': 586, 'cliffs': 2850} (digest a70d9e1161c4)
  - if cliffs keep clear of player lands only (not the centre land): heights ; cliff-line tiles 379; cliff pieces 143; draws {'land': 586, 'elevation': 586, 'cliffs': 3267}
- `cl6-players` seed 1001: heights ; cliff-line tiles 449; cliff pieces 169; draws {'land': 596, 'elevation': 596, 'cliffs': 2859} (digest 71bccdfcb643)
  - if cliffs keep clear of player lands only (not the centre land): heights ; cliff-line tiles 449; cliff pieces 169; draws {'land': 596, 'elevation': 596, 'cliffs': 3280}
