# Round CO predictions (written before any DE run)

Main reading: AoE2RMSIDE at 210d977 (connection_model, appearance_model, object_model). A variant marked SAME MAP cannot be told apart on that map. NOT MODELLED lists object attributes the model does not cover: those maps test only what comes before them.

## cn1-path_1000_n2
- main: terrains 6:9 14:14100 24:291; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 914, 'objects_entry': 924, 'objects': 924} (68bf0840da54)
- +dijkstra4: differs (terrains 6:10 14:14004 24:386; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 1298, 'objects_entry': 1309, 'objects': 1309})
- +paint-target: differs (terrains 14:14100 24:300; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 926, 'objects_entry': 927, 'objects': 927})

## cn1-path_1001_n2
- main: terrains 6:9 14:14100 24:291; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 914, 'objects_entry': 924, 'objects': 924} (68bf0840da54)
- +dijkstra4: differs (terrains 6:10 14:14004 24:386; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 1298, 'objects_entry': 1309, 'objects': 1309})
- +paint-target: differs (terrains 14:14100 24:300; terrain objects 0; units none; draws {'land': 48, 'elevation': 48, 'cliffs': 48, 'terrain': 49, 'connections': 926, 'objects_entry': 927, 'objects': 927})

## cn2-size_1000_n2
- main: terrains 0:1362 6:3 14:11688 24:665 35:682; terrain objects 80; units none; draws {'land': 16461, 'elevation': 16461, 'cliffs': 16461, 'terrain': 16462, 'connections': 17231, 'objects_entry': 21321, 'objects': 21321} (049ec709a60d)
- +disc: differs (terrains 0:1447 6:7 14:11807 24:542 35:597; terrain objects 77; units none; draws {'land': 16461, 'elevation': 16461, 'cliffs': 16461, 'terrain': 16462, 'connections': 16655, 'objects_entry': 21004, 'objects': 21004})
- +one-draw: differs (terrains 0:1325 6:3 14:11589 24:764 35:719; terrain objects 77; units none; draws {'land': 16461, 'elevation': 16461, 'cliffs': 16461, 'terrain': 16462, 'connections': 16655, 'objects_entry': 20634, 'objects': 20634})

## cn2-size_1001_n2
- main: terrains 0:1405 6:3 14:11637 24:697 35:658; terrain objects 78; units none; draws {'land': 16474, 'elevation': 16474, 'cliffs': 16474, 'terrain': 16475, 'connections': 17244, 'objects_entry': 21463, 'objects': 21463} (92cb2b21eb85)
- +disc: differs (terrains 0:1481 6:7 14:11811 24:519 35:582; terrain objects 79; units none; draws {'land': 16474, 'elevation': 16474, 'cliffs': 16474, 'terrain': 16475, 'connections': 16668, 'objects_entry': 21119, 'objects': 21119})
- +one-draw: differs (terrains 0:1323 6:3 14:11584 24:750 35:740; terrain objects 70; units none; draws {'land': 16474, 'elevation': 16474, 'cliffs': 16474, 'terrain': 16475, 'connections': 16668, 'objects_entry': 20641, 'objects': 20641})

## cn3a-sizedecl_1000_n2
- main: terrains 0:14043 6:3 24:354; terrain objects 835; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 42507, 'objects': 42507} (df472d6ee0e7)
- +novar-nodraw: differs (terrains 0:14043 6:3 24:354; terrain objects 850; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 38, 'objects_entry': 42171, 'objects': 42171})

## cn3b-sizeomit_1000_n2
- main: terrains 0:14043 6:3 24:354; terrain objects 835; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 42507, 'objects': 42507} (df472d6ee0e7)
- +default-var: differs (terrains 0:14159 6:11 24:230; terrain objects 854; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 42863, 'objects': 42863})

## cn4-cost_1000_n2
- main: terrains 6:30 10:713 14:13510 24:75 35:72; terrain objects 714; units none; draws {'land': 5952, 'elevation': 5952, 'cliffs': 5952, 'terrain': 5953, 'connections': 6578, 'objects_entry': 6609, 'objects': 6609} (6aabb4d12d79)
- +dijkstra4: differs (terrains 6:30 10:713 14:13501 24:54 35:102; terrain objects 713; units none; draws {'land': 5952, 'elevation': 5952, 'cliffs': 5952, 'terrain': 5953, 'connections': 6778, 'objects_entry': 6809, 'objects': 6809})
- +corner-cut: differs (terrains 6:30 10:713 14:13512 24:73 35:72; terrain objects 714; units none; draws {'land': 5952, 'elevation': 5952, 'cliffs': 5952, 'terrain': 5953, 'connections': 6578, 'objects_entry': 6609, 'objects': 6609})

## cn4-cost_1001_n2
- main: terrains 6:30 10:707 14:13508 24:83 35:72; terrain objects 707; units none; draws {'land': 5996, 'elevation': 5996, 'cliffs': 5996, 'terrain': 5997, 'connections': 6622, 'objects_entry': 6653, 'objects': 6653} (ca9f1c7d17ff)
- +dijkstra4: differs (terrains 6:30 10:707 14:13432 24:129 35:102; terrain objects 707; units none; draws {'land': 5996, 'elevation': 5996, 'cliffs': 5996, 'terrain': 5997, 'connections': 6926, 'objects_entry': 6957, 'objects': 6957})
- +corner-cut: differs (terrains 6:30 10:707 14:13508 24:83 35:72; terrain objects 707; units none; draws {'land': 5996, 'elevation': 5996, 'cliffs': 5996, 'terrain': 5997, 'connections': 6622, 'objects_entry': 6653, 'objects': 6653})

## cn5a-blockfirst_1000_n2
- main: terrains 0:14052 6:9 24:339; terrain objects 861; units none; draws {'land': 38, 'elevation': 38, 'cliffs': 38, 'terrain': 39, 'connections': 880, 'objects_entry': 43046, 'objects': 43046} (902c0e226af7)
- +both: differs (terrains 0:14300 6:15 14:1 24:84; terrain objects 871; units none; draws {'land': 38, 'elevation': 38, 'cliffs': 38, 'terrain': 39, 'connections': 376, 'objects_entry': 43292, 'objects': 43292})
- +open: SAME MAP

## cn5b-blocklast_1000_n2
- main: terrains 0:14299 6:15 14:2 24:84; terrain objects 861; units none; draws {'land': 45, 'elevation': 45, 'cliffs': 45, 'terrain': 46, 'connections': 383, 'objects_entry': 43296, 'objects': 43296} (ad66b5c5e8fb)
- +both: SAME MAP
- +open: differs (terrains 0:14173 6:3 14:2 24:222; terrain objects 859; units none; draws {'land': 45, 'elevation': 45, 'cliffs': 45, 'terrain': 46, 'connections': 887, 'objects_entry': 43410, 'objects': 43410})

## cn6a-cascade_1000_n2
- main: terrains 0:13687 5:42 6:11 14:638 32:22; terrain objects 825; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 902, 'objects_entry': 41975, 'objects': 41975} (37a27dbca670)
- +frozen: differs (terrains 0:13687 5:42 6:11 14:660; terrain objects 825; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 902, 'objects_entry': 41975, 'objects': 41975})
- +live-all: differs (terrains 0:13687 5:40 6:11 14:605 32:22 35:35; terrain objects 828; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1034, 'objects_entry': 42107, 'objects': 42107})

## cn6a-cascade_1001_n2
- main: terrains 0:13687 5:42 6:11 14:638 32:22; terrain objects 831; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 902, 'objects_entry': 41975, 'objects': 41975} (ccdefb12e439)
- +frozen: differs (terrains 0:13687 5:42 6:11 14:660; terrain objects 831; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 902, 'objects_entry': 41975, 'objects': 41975})
- +live-all: differs (terrains 0:13687 5:40 6:11 14:605 32:22 35:35; terrain objects 831; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1034, 'objects_entry': 42107, 'objects': 42107})

## cn6b-accumulate_1000_n2
- main: terrains 0:13687 5:40 6:11 14:605 32:22 35:35; terrain objects 828; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1034, 'objects_entry': 42107, 'objects': 42107} (f2734518eca1)
- +per-command: differs (terrains 0:13687 5:40 6:11 14:627 35:35; terrain objects 828; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1034, 'objects_entry': 42107, 'objects': 42107})
- +isolated: differs (terrains 0:13687 5:42 6:11 14:638 32:22; terrain objects 825; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 902, 'objects_entry': 41975, 'objects': 41975})

## cn7a-teams_1000_n4t1122
- main: terrains 0:14057 6:182 24:161; terrain objects 876; units none; draws {'land': 125, 'elevation': 125, 'cliffs': 125, 'terrain': 126, 'connections': 771, 'objects_entry': 43125, 'objects': 43125} (de34fbf6f3ed)
- +teamless-one-team: differs (terrains 0:13669 6:127 24:604; terrain objects 795; units none; draws {'land': 125, 'elevation': 125, 'cliffs': 125, 'terrain': 126, 'connections': 2059, 'objects_entry': 43194, 'objects': 43194})

## cn7a-teams_1000_n4
- main: terrains 0:14204 6:196; terrain objects 858; units none; draws {'land': 125, 'elevation': 125, 'cliffs': 125, 'terrain': 126, 'connections': 127, 'objects_entry': 42936, 'objects': 42936} (895bad0b4976)
- +teamless-one-team: differs (terrains 0:13671 6:136 24:593; terrain objects 828; units none; draws {'land': 125, 'elevation': 125, 'cliffs': 125, 'terrain': 126, 'connections': 2155, 'objects_entry': 43305, 'objects': 43305})

## cn7b-samezones_1000_n2
- main: terrains 0:13464 6:52 14:17 24:861 32:6; terrain objects 825; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 2218, 'objects_entry': 42663, 'objects': 42663} (a7d6b744e64c)
- +by-zone: differs (terrains 0:14160 6:98 14:45 24:72 32:25; terrain objects 842; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 422, 'objects_entry': 43001, 'objects': 43001})

## cn7b-samezones_1001_n2
- main: terrains 0:13563 6:49 14:19 24:752 32:17; terrain objects 825; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 2406, 'objects_entry': 43145, 'objects': 43145} (b8645a950e35)
- +by-zone: differs (terrains 0:14160 6:98 14:45 24:72 32:25; terrain objects 859; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 422, 'objects_entry': 43001, 'objects': 43001})

## cn7c-zones_1000_n2
- main: terrains 0:13995 6:82 14:34 24:60 32:23 35:206; terrain objects 815; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 1118, 'objects_entry': 43186, 'objects': 43186} (f8eb128f721f)
- +cross-only: differs (terrains 0:14062 6:82 14:44 24:60 32:23 35:129; terrain objects 810; units none; draws {'land': 132, 'elevation': 132, 'cliffs': 132, 'terrain': 133, 'connections': 830, 'objects_entry': 43099, 'objects': 43099})

## cn7d-nonplayer_1000_n2
- main: terrains 0:14018 6:84 14:13 24:225 32:18 40:42; terrain objects 835; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 1670, 'objects_entry': 43809, 'objects': 43809} (2c39a54b7187)
- +blocks-all: differs (terrains 0:14018 6:84 14:13 24:266 32:19; terrain objects 841; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 1502, 'objects_entry': 43641, 'objects': 43641})
- +no-bug: differs (terrains 0:13878 5:319 6:66 14:9 24:68 32:18 40:42; terrain objects 851; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 3386, 'objects_entry': 45087, 'objects': 45087})

## cn7d-nonplayer_1001_n2
- main: terrains 0:13989 6:84 14:8 24:257 32:20 40:42; terrain objects 816; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 1514, 'objects_entry': 43566, 'objects': 43566} (84dad2388533)
- +blocks-all: differs (terrains 0:13989 6:84 14:8 24:298 32:21; terrain objects 823; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 1346, 'objects_entry': 43398, 'objects': 43398})
- +no-bug: differs (terrains 0:13728 5:509 6:57 14:5 24:44 32:15 40:42; terrain objects 823; units none; draws {'land': 112, 'elevation': 112, 'cliffs': 112, 'terrain': 113, 'connections': 3082, 'objects_entry': 44324, 'objects': 44324})

## cn7e-teamsnonplayer_1000_n4t1122
- main: terrains 0:13952 6:174 14:17 24:72 35:185; terrain objects 808; units none; draws {'land': 145, 'elevation': 145, 'cliffs': 145, 'terrain': 146, 'connections': 1179, 'objects_entry': 43210, 'objects': 43210} (3e1bd183dae0)
- +no-bug: differs (terrains 0:13887 6:171 14:17 24:160 35:165; terrain objects 844; units none; draws {'land': 145, 'elevation': 145, 'cliffs': 145, 'terrain': 146, 'connections': 1531, 'objects_entry': 43364, 'objects': 43364})

## cn8a-dig_1000_n2
- main: terrains 0:13635 1:519 2:240 6:6; terrain objects 804; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41286, 'objects': 41286} (aaa9633a41ab)
- +nobeach: differs (terrains 0:13863 1:519 6:18; terrain objects 835; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41982, 'objects': 41982})
- +beach4: differs (terrains 0:13690 1:519 2:181 6:10; terrain objects 809; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41455, 'objects': 41455})

## cn8a-dig_1001_n2
- main: terrains 0:13635 1:519 2:240 6:6; terrain objects 787; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41286, 'objects': 41286} (0d26630c5597)
- +nobeach: differs (terrains 0:13863 1:519 6:18; terrain objects 812; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41982, 'objects': 41982})
- +beach4: differs (terrains 0:13690 1:519 2:181 6:10; terrain objects 817; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 37, 'connections': 374, 'objects_entry': 41455, 'objects': 41455})

## cn8b-ford_1000_n2
- main: terrains 0:11522 1:2386 2:359 4:115 6:18; terrain objects 716; units none; draws {'land': 20159, 'elevation': 20159, 'cliffs': 20159, 'terrain': 20160, 'connections': 20573, 'objects_entry': 55158, 'objects': 55158} (a37fefde397d)

## cn8c-beachterrain_1000_n2
- main: terrains 0:12258 1:1567 6:15 24:3 51:557; terrain objects 708; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 35491, 'connections': 35828, 'objects_entry': 72618, 'objects': 72618} (dcd431991486)
- +no-shoreline-pass: SAME MAP
- +guide-breaks: differs (terrains 0:12258 1:1567 2:557 6:15 24:3; terrain objects 708; units none; draws {'land': 36, 'elevation': 36, 'cliffs': 36, 'terrain': 35491, 'connections': 35828, 'objects_entry': 72618, 'objects': 72618})

## cn9-burn_1000_n2
- main: terrains 0:14375 6:25; terrain objects 853; units none; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 34, 'objects_entry': 43185, 'objects': 43185} (7511d6738cb2)
- +noburn: differs (terrains 0:14375 6:25; terrain objects 866; units none; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 43184})

## ob1-scatter_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64070} (da691cb78430)
- +window-full: differs (terrains 0:14375 6:25; terrain objects 866; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64784})
- +uniform: differs (terrains 0:14375 6:25; terrain objects 866; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 43245})

## ob1-scatter_1001_n2
- main: terrains 0:14375 6:25; terrain objects 880; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64070} (a4afd25742a4)
- +window-full: differs (terrains 0:14375 6:25; terrain objects 880; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64784})
- +uniform: differs (terrains 0:14375 6:25; terrain objects 880; units p0/65:20 p0/66:1 p0/102:40; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 43246})

## ob2a-noshuffle_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 50146} (0aaaf6514d8d)
- +scan-order: differs (terrains 0:14375 6:25; terrain objects 866; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 43184})

## ob2a-noshuffle_1001_n2
- main: terrains 0:14375 6:25; terrain objects 880; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 50146} (302680a8f721)
- +scan-order: differs (terrains 0:14375 6:25; terrain objects 880; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 43184})

## ob2b-shuffle_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 50146} (0aaaf6514d8d)
- +flag-adds-shuffle: differs (terrains 0:14375 6:25; terrain objects 866; units p0/66:30; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 57108})

## ob3-player_1000_n2-brit
- main: terrains 0:14158 6:242; terrain objects 863; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 92860} (e349f245f9b4)
- +ties-unshuffled: differs (terrains 0:14158 6:242; terrain objects 863; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 72088})
- +square-band: differs (terrains 0:14158 6:242; terrain objects 863; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 92860})

## ob3-player_1001_n2-brit
- main: terrains 0:14158 6:242; terrain objects 846; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 92927} (c187a9354730)
- +ties-unshuffled: differs (terrains 0:14158 6:242; terrain objects 846; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 72198})
- +square-band: differs (terrains 0:14158 6:242; terrain objects 846; units p0/48:2 p0/59:2 p0/65:2 p0/66:6 p0/102:6 p1/109:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/109:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 104, 'elevation': 104, 'cliffs': 104, 'terrain': 105, 'connections': 105, 'objects_entry': 42822, 'objects': 92927})

## ob4-grouping_1000_n2
- main: terrains 0:13155 6:1236 32:9; terrain objects 796; units p0/59:18 p0/65:20 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47222, 'objects': 75248} (e649ebe1be16)
- +tight-default: differs (terrains 0:13155 6:1236 32:9; terrain objects 796; units p0/59:18 p0/65:15 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47222, 'objects': 75266})
- +tight-anchor-only: differs (terrains 0:13155 6:1236 32:9; terrain objects 796; units p0/59:18 p0/65:21 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47222, 'objects': 75264})

## ob4-grouping_1001_n2
- main: terrains 0:13149 6:1242 32:9; terrain objects 792; units p0/59:18 p0/65:19 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47210, 'objects': 75234} (7cd4f1b73a30)
- +tight-default: differs (terrains 0:13149 6:1242 32:9; terrain objects 792; units p0/59:18 p0/65:12 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47210, 'objects': 75245})
- +tight-anchor-only: differs (terrains 0:13149 6:1242 32:9; terrain objects 792; units p0/59:18 p0/65:19 p0/66:18 p0/102:18; draws {'land': 18, 'elevation': 18, 'cliffs': 18, 'terrain': 6520, 'connections': 6520, 'objects_entry': 47210, 'objects': 75253})

## ob5-zones_1000_n2
- main: terrains 0:11860 1:904 2:192 10:1444; terrain objects 2156; units p0/48:10 p0/59:20 p0/65:20 p0/66:25 p0/102:15 p0/594:10; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone; draws {'land': 6962, 'elevation': 6962, 'cliffs': 10081, 'terrain': 16814, 'connections': 16814, 'objects_entry': 52395, 'objects': 92007} (df60666d5d2a)

## ob5-zones_1001_n2
- main: terrains 0:11841 1:905 2:198 10:1456; terrain objects 2154; units p0/48:10 p0/59:20 p0/65:20 p0/66:25 p0/102:15 p0/594:10; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone; draws {'land': 7039, 'elevation': 7039, 'cliffs': 10204, 'terrain': 16986, 'connections': 16986, 'objects_entry': 52510, 'objects': 92122} (7b740431087c)

## ob6-objgroups_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/48:13 p0/59:23 p0/65:29 p0/66:38 p0/102:2 p0/594:11 p0/833:4; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313} (f5a25336db2b)
- +weight-ge-roll: differs (terrains 0:14375 6:25; terrain objects 866; units p0/48:6 p0/59:24 p0/65:34 p0/66:4 p0/102:36 p0/594:6 p0/833:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313})
- +cumulative: differs (terrains 0:14375 6:25; terrain objects 866; units p0/48:13 p0/59:15 p0/65:19 p0/66:3 p0/102:37 p0/594:21 p0/833:12; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313})

## ob6-objgroups_1001_n2
- main: terrains 0:14375 6:25; terrain objects 880; units p0/48:6 p0/59:29 p0/65:29 p0/66:38 p0/102:2 p0/594:11 p0/833:5; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313} (7a2bc42e6a64)
- +weight-ge-roll: differs (terrains 0:14375 6:25; terrain objects 880; units p0/48:2 p0/59:29 p0/65:25 p0/66:5 p0/102:35 p0/594:15 p0/833:9; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313})
- +cumulative: differs (terrains 0:14375 6:25; terrain objects 880; units p0/48:20 p0/59:12 p0/65:23 p0/66:3 p0/102:37 p0/594:17 p0/833:8; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64313})

## ob7-actor_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/48:4 p0/59:40 p0/65:30 p0/66:10 p0/102:3; NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 77994} (52409706a405)

## ob7-actor_1001_n2
- main: terrains 0:14375 6:25; terrain objects 880; units p0/48:4 p0/59:40 p0/65:30 p0/66:10 p0/102:3; NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 77994} (005c8a68d732)

## ob8-lands_1000_n2
- main: terrains 0:13164 6:516 14:720; terrain objects 822; units p0/48:8 p0/59:12 p0/65:3 p0/66:3 p0/102:5; NOT MODELLED: generate_for_first_land_only, place_on_specific_land_id; draws {'land': 8383, 'elevation': 8383, 'cliffs': 8383, 'terrain': 8384, 'connections': 8384, 'objects_entry': 48393, 'objects': 97127} (931746211bcb)

## ob8-lands_1001_n2
- main: terrains 0:13212 6:494 14:694; terrain objects 817; units p0/48:8 p0/59:12 p0/65:3 p0/66:3 p0/102:5; NOT MODELLED: generate_for_first_land_only, place_on_specific_land_id; draws {'land': 8379, 'elevation': 8379, 'cliffs': 8379, 'terrain': 8380, 'connections': 8380, 'objects_entry': 48511, 'objects': 97245} (72618b654989)

## ob9-starts_1000_n2-brit
- main: terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/83:1 p1/109:1 p1/293:2 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:3 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85324} (27140e44f2d3)
- +noexpand: differs (terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/109:1 p1/293:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:1 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85312})
- +relic-ignores-players: differs (terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/83:1 p1/109:1 p1/293:2 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:3 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85324})

## ob9-starts_1001_n2-brit
- main: terrains 0:7706 6:6694; terrain objects 514; units p0/285:5 p1/70:2 p1/83:2 p1/109:1 p1/293:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/83:1 p2/109:1 p2/293:2 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47521, 'elevation': 47521, 'cliffs': 47521, 'terrain': 47522, 'connections': 47522, 'objects_entry': 77335, 'objects': 85489} (58c612566cf5)
- +noexpand: differs (terrains 0:7706 6:6694; terrain objects 514; units p0/285:5 p1/70:2 p1/109:1 p1/293:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/83:1 p2/109:1 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47521, 'elevation': 47521, 'cliffs': 47521, 'terrain': 47522, 'connections': 47522, 'objects_entry': 77335, 'objects': 85477})
- +relic-ignores-players: differs (terrains 0:7706 6:6694; terrain objects 514; units p0/285:5 p1/70:2 p1/83:2 p1/109:1 p1/293:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/83:1 p2/109:1 p2/293:2 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; draws {'land': 47521, 'elevation': 47521, 'cliffs': 47521, 'terrain': 47522, 'connections': 47522, 'objects_entry': 77335, 'objects': 85489})

## ob9-starts_1000_n2-brit-azt
- main: terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/83:1 p1/109:1 p1/293:2 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:3 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/751:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85324} (545d60af6090)
- +noexpand: differs (terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/109:1 p1/293:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/751:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85312})
- +relic-ignores-players: differs (terrains 0:7695 6:6705; terrain objects 533; units p0/285:5 p1/70:2 p1/83:1 p1/109:1 p1/293:2 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/70:2 p2/109:1 p2/293:3 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/751:1 p2/890:1 p2/1649:1; draws {'land': 47378, 'elevation': 47378, 'cliffs': 47378, 'terrain': 47379, 'connections': 47379, 'objects_entry': 77170, 'objects': 85324})

## ob10-misc_1000_n2
- main: terrains 0:13464 6:927 32:9; terrain objects 831; units p0/59:8 p0/65:15 p0/66:18 p0/102:18 p0/594:9; NOT MODELLED: force_placement, min_connected_tiles; draws {'land': 24, 'elevation': 24, 'cliffs': 24, 'terrain': 5794, 'connections': 5794, 'objects_entry': 47114, 'objects': 75022} (39797d4b75b7)

## ob10-misc_1001_n2
- main: terrains 0:13460 6:931 32:9; terrain objects 843; units p0/59:8 p0/65:15 p0/66:18 p0/102:18 p0/594:9; NOT MODELLED: force_placement, min_connected_tiles; draws {'land': 24, 'elevation': 24, 'cliffs': 24, 'terrain': 5769, 'connections': 5769, 'objects_entry': 47081, 'objects': 74987} (154b001aec98)

## ob11-scaling_1000_n2
- main: terrains 0:14375 6:25; terrain objects 866; units p0/65:4 p0/66:8 p0/102:6; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64118} (1ccc8ada2e2e)
- +first: differs (terrains 0:14375 6:25; terrain objects 866; units p0/65:2 p0/66:8 p0/102:6; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64118})

## ob11-scaling_1000_n4
- main: terrains 0:14375 6:25; terrain objects 866; units p0/65:8 p0/66:8 p0/102:12; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64118} (050ce84308c1)
- +first: differs (terrains 0:14375 6:25; terrain objects 866; units p0/65:2 p0/66:8 p0/102:12; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 64118})

## ob11-scaling_1000_n2_size-200
- main: terrains 0:39975 6:25; terrain objects 2315; units p0/65:4 p0/66:24 p0/102:6; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 119984, 'objects': 178934} (c51374e83580)
- +first: differs (terrains 0:39975 6:25; terrain objects 2315; units p0/65:8 p0/66:24 p0/102:6; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 119984, 'objects': 178934})

## ob12-habitat_1000_n2
- main: terrains 1:12844 2:323 6:1233; terrain objects 15; units p0/53:20 p0/66:12 p0/69:15 p0/456:10 p1/102:1 p2/102:1; draws {'land': 10110, 'elevation': 10110, 'cliffs': 10110, 'terrain': 10111, 'connections': 10111, 'objects_entry': 11345, 'objects': 40583} (6da434814f8c)

## ob12-habitat_1001_n2
- main: terrains 1:12836 2:304 6:1260; terrain objects 16; units p0/53:20 p0/66:12 p0/69:15 p0/456:10 p1/102:1 p2/102:1; draws {'land': 10109, 'elevation': 10109, 'cliffs': 10109, 'terrain': 10110, 'connections': 10110, 'objects_entry': 11371, 'objects': 39229} (961e6ba71c77)

## ob13-walls_1000_n2-brit
- main: terrains 0:7703 6:6697; terrain objects 537; units p1/72:1 p1/109:1 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/72:1 p2/109:1 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1; NOT MODELLED: walls; draws {'land': 47303, 'elevation': 47303, 'cliffs': 47303, 'terrain': 47304, 'connections': 47304, 'objects_entry': 77111, 'objects': 78009} (6966a89023cd)

## xr1-real_1000_n4t1122-brit_size-200
- main: terrains 0:18932 1:1737 2:278 4:44 5:15 6:13680 9:48 10:4808 11:458; terrain objects 6134; units p0/48:8 p0/53:6 p0/59:24 p0/65:16 p0/66:76 p0/102:20 p0/285:5 p0/349:12 p1/83:3 p1/109:1 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/83:1 p2/109:1 p2/293:2 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1 p3/83:1 p3/109:1 p3/293:2 p3/448:1 p3/594:4 p3/618:1 p3/619:1 p3/620:1 p3/890:1 p3/1649:1 p4/83:2 p4/109:1 p4/293:1 p4/448:1 p4/594:4 p4/618:1 p4/619:1 p4/620:1 p4/890:1 p4/1649:1; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone; draws {'land': 110761, 'elevation': 110762, 'cliffs': 110762, 'terrain': 135972, 'connections': 140201, 'objects_entry': 210966, 'objects': 285065} (4b71a7d307ab)

## xr1-real_1001_n4t1122-brit_size-200
- main: terrains 0:18975 1:1769 2:334 4:35 6:13708 9:35 10:4844 11:300; terrain objects 6138; units p0/48:8 p0/53:6 p0/59:24 p0/65:16 p0/66:76 p0/102:20 p0/285:5 p0/349:12 p1/109:1 p1/293:3 p1/448:1 p1/594:4 p1/618:1 p1/619:1 p1/620:1 p1/890:1 p1/1649:1 p2/83:1 p2/109:1 p2/293:2 p2/448:1 p2/594:4 p2/618:1 p2/619:1 p2/620:1 p2/890:1 p2/1649:1 p3/83:1 p3/109:1 p3/293:2 p3/448:1 p3/594:4 p3/618:1 p3/619:1 p3/620:1 p3/890:1 p3/1649:1 p4/83:1 p4/109:1 p4/293:2 p4/448:1 p4/594:4 p4/618:1 p4/619:1 p4/620:1 p4/890:1 p4/1649:1; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone; draws {'land': 111234, 'elevation': 111235, 'cliffs': 111235, 'terrain': 136580, 'connections': 139933, 'objects_entry': 210777, 'objects': 285871} (29bfaff60c17)
