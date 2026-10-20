# Growth probe predictions, written BEFORE any DE run (2026-10-09)

Script: land4-grow.rms (one DESERT land, base_size 0, number_of_tiles 25, land_position 50 50 = tile (60,60), 2 players, no header blocks). Prediction from growth_port.py: growth draws start at prelude + 1 burned draw = draw 12 for seeds 1000, 1001, 1002; land sizes follow the 'version 0' rule (land 0 starts at 1 tile). Tiles are (x,y); '#' = desert.

seed 1000 growth start draw 12 tiles 13
x 63..67, y 58..60
#####
#####
..###
[(63, 58), (63, 59), (64, 58), (64, 59), (65, 58), (65, 59), (65, 60), (66, 58), (66, 59), (66, 60), (67, 58), (67, 59), (67, 60)]

seed 1001 growth start draw 12 tiles 20
x 59..62, y 60..65
###.
####
####
####
.###
..##
[(59, 60), (59, 61), (59, 62), (59, 63), (60, 60), (60, 61), (60, 62), (60, 63), (60, 64), (61, 60), (61, 61), (61, 62), (61, 63), (61, 64), (61, 65), (62, 61), (62, 62), (62, 63), (62, 64), (62, 65)]

seed 1002 growth start draw 12 tiles 26
x 57..64, y 60..64
..###...
########
########
...####.
....###.
[(57, 61), (57, 62), (58, 61), (58, 62), (59, 60), (59, 61), (59, 62), (60, 60), (60, 61), (60, 62), (60, 63), (61, 60), (61, 61), (61, 62), (61, 63), (61, 64), (62, 61), (62, 62), (62, 63), (62, 64), (63, 61), (63, 62), (63, 63), (63, 64), (64, 61), (64, 62)]

