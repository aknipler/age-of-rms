# Round CF predictions (written 2026-10-28, before any DE run)

Main reading: the models with round CO's after-the-run rules as defaults. A variant marked SAME MAP cannot be told apart on that map. NOT MODELLED lists attributes the model does not cover; those maps are predicted up to the first descriptor that uses one, and `compare_cf.py` measures the rest against the guide's claims.

## k1-overlap_1002_n2
- main: terrains 0:13563 5:48 6:9 14:760 32:18 35:2; terrain objects 772; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889} (c2a93fbe39e0)
- +undo-entry: differs (terrains 0:13563 5:50 6:9 14:760 32:18; terrain objects 772; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889})
- +live-all: differs (terrains 0:13563 5:22 6:9 14:760 32:18 35:28; terrain objects 772; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889})

## k1-overlap_1003_n2
- main: terrains 0:13563 5:48 6:9 14:760 32:18 35:2; terrain objects 760; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889} (67449460a032)
- +undo-entry: differs (terrains 0:13563 5:50 6:9 14:760 32:18; terrain objects 760; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889})
- +live-all: differs (terrains 0:13563 5:22 6:9 14:760 32:18 35:28; terrain objects 760; units none; draws {'land': 60, 'elevation': 60, 'cliffs': 60, 'terrain': 61, 'connections': 1190, 'objects_entry': 41889, 'objects': 41889})

## k2-nonplayer_1002_n3
- main: terrains 0:13405 6:97 14:3 24:452 32:19 40:424; terrain objects 803; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 5556, 'objects_entry': 45869, 'objects': 45869} (bb84139dec90)
- +undo-entry: differs (terrains 0:13411 6:100 14:5 24:433 32:27 40:424; terrain objects 800; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 5556, 'objects_entry': 45890, 'objects': 45890})
- +no-bug: differs (terrains 0:12891 5:921 6:58 14:1 24:86 32:19 40:424; terrain objects 727; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 9932, 'objects_entry': 48664, 'objects': 48664})

## k2-nonplayer_1003_n3
- main: terrains 0:13416 6:98 14:3 24:440 32:19 40:424; terrain objects 783; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 5464, 'objects_entry': 45811, 'objects': 45811} (53722dc3d6d3)
- +undo-entry: differs (terrains 0:13422 6:98 14:5 24:424 32:27 40:424; terrain objects 787; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 5464, 'objects_entry': 45829, 'objects': 45829})
- +no-bug: differs (terrains 0:12972 5:836 6:70 14:2 24:77 32:19 40:424; terrain objects 779; units none; draws {'land': 162, 'elevation': 162, 'cliffs': 162, 'terrain': 163, 'connections': 9652, 'objects_entry': 48639, 'objects': 48639})

## k3-coast_1002_n2
- main: terrains 0:11005 1:2691 2:449 6:255; terrain objects 680; units none; draws {'land': 24056, 'elevation': 24056, 'cliffs': 24056, 'terrain': 24057, 'connections': 24057, 'objects_entry': 57328, 'objects': 57328} (b3473e391fda)
- +beach-destroys: differs (terrains 0:11005 1:2691 2:449 6:255; terrain objects 676; units none; draws {'land': 24056, 'elevation': 24056, 'cliffs': 24056, 'terrain': 24057, 'connections': 24057, 'objects_entry': 57328, 'objects': 57328})

## k3-coast_1003_n2
- main: terrains 0:10922 1:2719 2:505 6:254; terrain objects 665; units none; draws {'land': 24101, 'elevation': 24101, 'cliffs': 24101, 'terrain': 24102, 'connections': 24102, 'objects_entry': 57123, 'objects': 57123} (8244a94dd4ba)
- +beach-destroys: differs (terrains 0:10922 1:2719 2:505 6:254; terrain objects 662; units none; draws {'land': 24101, 'elevation': 24101, 'cliffs': 24101, 'terrain': 24102, 'connections': 24102, 'objects_entry': 57123, 'objects': 57123})

## k4-forage_1002_n2
- main: terrains 0:14375 6:25; terrain objects 854; units p0/59:26 p0/65:12 p0/594:10 p0/833:8; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 78010} (8f63123ce642)
- +forage-fixed: differs (terrains 0:14375 6:25; terrain objects 854; units p0/59:26 p0/65:12 p0/594:10 p0/833:8; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 78010})

## k4-forage_1003_n2
- main: terrains 0:14375 6:25; terrain objects 845; units p0/59:26 p0/65:12 p0/594:10 p0/833:8; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 78010} (3665b650945d)
- +forage-fixed: differs (terrains 0:14375 6:25; terrain objects 845; units p0/59:26 p0/65:12 p0/594:10 p0/833:8; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 78010})

## k5-retire_1002_n2
- main: terrains 0:14351 6:25 27:24; terrain objects 854; units p0/66:40 p0/70:6 p0/102:24 p0/285:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71102} (2b1f36df86c1)
- +retire-keeps: differs (terrains 0:14351 6:25 27:24; terrain objects 857; units p0/66:40 p0/70:6 p0/102:24 p0/285:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71102})

## k5-retire_1003_n2
- main: terrains 0:14351 6:25 27:24; terrain objects 842; units p0/66:40 p0/70:6 p0/102:24 p0/285:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71102} (059b82c137d7)
- +retire-keeps: differs (terrains 0:14351 6:25 27:24; terrain objects 846; units p0/66:40 p0/70:6 p0/102:24 p0/285:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71102})

## k6-groups_1002_n2
- main: terrains 0:14375 6:25; terrain objects 850; units p0/48:3 p0/59:30 p0/65:35 p0/66:42 p0/102:28 p0/594:5 p0/833:7; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336} (6cf713da2f10)
- +atmost: differs (terrains 0:14375 6:25; terrain objects 850; units p0/48:8 p0/59:20 p0/65:18 p0/66:37 p0/102:33 p0/594:22 p0/833:12; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336})
- +cumulative: differs (terrains 0:14375 6:25; terrain objects 850; units p0/48:16 p0/59:11 p0/65:29 p0/66:43 p0/102:27 p0/594:11 p0/833:13; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336})

## k6-groups_1003_n2
- main: terrains 0:14375 6:25; terrain objects 838; units p0/48:5 p0/59:33 p0/65:36 p0/66:41 p0/102:29 p0/594:4 p0/833:2; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336} (c6e58c294b46)
- +atmost: differs (terrains 0:14375 6:25; terrain objects 839; units p0/48:11 p0/59:22 p0/65:19 p0/66:36 p0/102:34 p0/594:21 p0/833:7; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336})
- +cumulative: differs (terrains 0:14375 6:25; terrain objects 839; units p0/48:11 p0/59:15 p0/65:28 p0/66:35 p0/102:35 p0/594:12 p0/833:14; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71336})

## k7-owned_1002_n2
- main: terrains 0:12250 6:2150; terrain objects 722; units p1/48:2 p1/59:2 p1/65:2 p1/66:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/66:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15252, 'elevation': 15252, 'cliffs': 15252, 'terrain': 15253, 'connections': 15253, 'objects_entry': 54154, 'objects': 57466} (178832dbf2ce)
- +owned-stone: differs (terrains 0:12250 6:2150; terrain objects 722; units p1/48:2 p1/59:2 p1/65:2 p1/66:2 p1/102:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/66:2 p2/102:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15252, 'elevation': 15252, 'cliffs': 15252, 'terrain': 15253, 'connections': 15253, 'objects_entry': 54154, 'objects': 57466})
- +owned-mines: differs (terrains 0:12250 6:2150; terrain objects 722; units p1/48:2 p1/59:2 p1/65:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15252, 'elevation': 15252, 'cliffs': 15252, 'terrain': 15253, 'connections': 15253, 'objects_entry': 54154, 'objects': 57466})

## k7-owned_1003_n2
- main: terrains 0:12213 6:2187; terrain objects 771; units p1/48:2 p1/59:2 p1/65:2 p1/66:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/66:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15243, 'elevation': 15243, 'cliffs': 15243, 'terrain': 15244, 'connections': 15244, 'objects_entry': 54071, 'objects': 57277} (c2dee530c07b)
- +owned-stone: differs (terrains 0:12213 6:2187; terrain objects 771; units p1/48:2 p1/59:2 p1/65:2 p1/66:2 p1/102:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/66:2 p2/102:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15243, 'elevation': 15243, 'cliffs': 15243, 'terrain': 15244, 'connections': 15244, 'objects_entry': 54071, 'objects': 57277})
- +owned-mines: differs (terrains 0:12213 6:2187; terrain objects 771; units p1/48:2 p1/59:2 p1/65:2 p1/109:1 p1/285:1 p1/349:2 p1/594:2 p2/48:2 p2/59:2 p2/65:2 p2/109:1 p2/285:1 p2/349:2 p2/594:2; draws {'land': 15243, 'elevation': 15243, 'cliffs': 15243, 'terrain': 15244, 'connections': 15244, 'objects_entry': 54071, 'objects': 57277})

## k7-owned_1002_n2-brit
- main: terrains 0:12250 6:2150; terrain objects 722; units p1/109:1 p1/594:2 p2/109:1 p2/594:2; draws {'land': 15252, 'elevation': 15252, 'cliffs': 15252, 'terrain': 15253, 'connections': 15253, 'objects_entry': 54154, 'objects': 57466} (0ed3281187db)
- +owned-stone: SAME MAP
- +owned-mines: SAME MAP

## k8-civs_1002_n4-brit-azt-inca-gurj
- main: terrains 0:13487 6:913; terrain objects 816; units p0/65:12 p1/83:2 p1/109:1 p1/293:1 p1/448:1 p2/83:1 p2/109:1 p2/293:2 p2/448:1 p3/83:2 p3/109:1 p3/293:1 p3/448:1 p4/109:1 p4/293:3 p4/448:1; draws {'land': 3755, 'elevation': 3755, 'cliffs': 3755, 'terrain': 3756, 'connections': 3756, 'objects_entry': 45131, 'objects': 47759} (56f56703f550)
- +civ-replace: differs (terrains 0:13487 6:913; terrain objects 816; units p0/65:12 p1/83:2 p1/109:1 p1/293:1 p1/448:1 p2/83:1 p2/109:1 p2/293:2 p2/751:1 p3/83:2 p3/109:1 p3/293:1 p3/2550:1 p4/109:1 p4/293:3 p4/1755:1; draws {'land': 3755, 'elevation': 3755, 'cliffs': 3755, 'terrain': 3756, 'connections': 3756, 'objects_entry': 45131, 'objects': 47759})

## k9-fixed_1002_n2-brit
- main: terrains 1:11831 2:470 6:2099; terrain objects 15; units p0/53:12 p0/69:10 p0/345:3 p0/450:4 p0/457:6 p1/70:2 p1/79:1 p1/109:1 p1/234:1 p1/598:1 p1/600:1 p2/70:2 p2/79:1 p2/109:1 p2/234:1 p2/598:1 p2/600:1; draws {'land': 15192, 'elevation': 15192, 'cliffs': 15192, 'terrain': 15193, 'connections': 15193, 'objects_entry': 17293, 'objects': 53759} (5cbc31155ca8)
- +fixed-facet: differs (terrains 1:11831 2:470 6:2099; terrain objects 15; units p0/53:12 p0/69:10 p0/345:3 p0/450:4 p0/457:6 p1/70:2 p1/79:1 p1/109:1 p1/234:1 p1/598:1 p1/600:1 p2/70:2 p2/79:1 p2/109:1 p2/234:1 p2/598:1 p2/600:1; draws {'land': 15192, 'elevation': 15192, 'cliffs': 15192, 'terrain': 15193, 'connections': 15193, 'objects_entry': 17293, 'objects': 53759})

## k10a-samezones_1002_n2
- main: terrains 0:13276 6:49 14:13 24:1036 32:26; terrain objects 789; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 3570, 'objects_entry': 43448, 'objects': 43448} (6de7ce309d28)
- +by-zone: differs (terrains 0:14123 6:98 14:45 24:84 32:50; terrain objects 823; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 490, 'objects_entry': 42958, 'objects': 42958})

## k10a-samezones_1003_n2
- main: terrains 0:13204 6:52 14:9 24:1110 32:25; terrain objects 752; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 3394, 'objects_entry': 43059, 'objects': 43059} (e484f891d257)
- +by-zone: differs (terrains 0:14123 6:98 14:45 24:84 32:50; terrain objects 817; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 490, 'objects_entry': 42958, 'objects': 42958})

## k10b-alllands_1002_n2
- main: terrains 0:13276 6:49 14:13 24:1036 32:26; terrain objects 789; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 3570, 'objects_entry': 43448, 'objects': 43448} (6de7ce309d28)

## k10b-alllands_1003_n2
- main: terrains 0:13204 6:52 14:9 24:1110 32:25; terrain objects 752; units none; draws {'land': 152, 'elevation': 152, 'cliffs': 152, 'terrain': 153, 'connections': 3394, 'objects_entry': 43059, 'objects': 43059} (e484f891d257)

## ll1-twolands_1002_n2
- main: terrains 6:1106 14:13294; terrain objects 13; units p0/65:10 p0/66:15; NOT MODELLED: layer_to_place_on; draws {'land': 8545, 'elevation': 8546, 'cliffs': 8546, 'terrain': 12147, 'connections': 12147, 'objects_entry': 13254, 'objects': 27178} (2ee4b343eef0); NOT MODELLED: layer_to_place_on
- +land-layer: differs (terrains 5:123 6:984 14:13293; terrain objects 8; units p0/65:10 p0/66:15; NOT MODELLED: layer_to_place_on; draws {'land': 8545, 'elevation': 11370, 'cliffs': 11370, 'terrain': 15227, 'connections': 15227, 'objects_entry': 16212, 'objects': 30136})

## ll1-twolands_1003_n2
- main: terrains 6:1108 14:13292; terrain objects 8; units p0/65:10 p0/66:15; NOT MODELLED: layer_to_place_on; draws {'land': 8504, 'elevation': 8505, 'cliffs': 8505, 'terrain': 12106, 'connections': 12106, 'objects_entry': 13215, 'objects': 27139} (46e23fed86c4); NOT MODELLED: layer_to_place_on
- +land-layer: differs (terrains 5:121 6:987 14:13292; terrain objects 14; units p0/65:10 p0/66:15; NOT MODELLED: layer_to_place_on; draws {'land': 8504, 'elevation': 10790, 'cliffs': 10790, 'terrain': 14647, 'connections': 14647, 'objects_entry': 15635, 'objects': 29559})

## ll2-before_1002_n2
- main: terrains 6:1106 14:13294; terrain objects 13; units none; draws {'land': 8545, 'elevation': 8546, 'cliffs': 8546, 'terrain': 12147, 'connections': 12147, 'objects_entry': 13254, 'objects': 13254} (09fe13c84a3a)
- +land-layer: differs (terrains 5:123 6:984 14:13293; terrain objects 8; units none; draws {'land': 8545, 'elevation': 11370, 'cliffs': 11370, 'terrain': 15227, 'connections': 15227, 'objects_entry': 16212, 'objects': 16212})

## ll3-maplayer_1002_n2
- main: terrains 6:1106 14:13294; terrain objects 13; units none; draws {'land': 8545, 'elevation': 8546, 'cliffs': 8546, 'terrain': 12147, 'connections': 12147, 'objects_entry': 13254, 'objects': 13254} (09fe13c84a3a)
- +land-layer: differs (terrains 5:123 6:984 14:13293; terrain objects 8; units none; draws {'land': 8545, 'elevation': 11370, 'cliffs': 11370, 'terrain': 15227, 'connections': 15227, 'objects_entry': 16212, 'objects': 16212})

## u1-actor_1002_n2-brit
- main: terrains 0:13840 6:540 27:20; terrain objects 804; units p0/48:20 p0/59:30 p0/65:30 p0/66:8 p0/102:30 p1/70:3 p1/109:1 p1/594:2 p2/70:3 p2/109:1 p2/594:2; NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area, override_actor_radius_if_required; draws {'land': 2710, 'elevation': 2710, 'cliffs': 2710, 'terrain': 2711, 'connections': 2711, 'objects_entry': 44832, 'objects': 93926} (b1841223efcc); NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area, override_actor_radius_if_required

## u1-actor_1003_n2-brit
- main: terrains 0:13834 6:542 27:24; terrain objects 781; units p0/48:20 p0/59:30 p0/65:30 p0/66:8 p0/102:30 p1/70:3 p1/109:1 p1/594:2 p2/70:3 p2/109:1 p2/594:2; NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area, override_actor_radius_if_required; draws {'land': 2720, 'elevation': 2720, 'cliffs': 2720, 'terrain': 2721, 'connections': 2721, 'objects_entry': 44838, 'objects': 93922} (8a03d97c52b8); NOT MODELLED: actor_area, actor_area_radius, actor_area_to_place_in, avoid_actor_area, avoid_all_actor_areas, create_actor_area, override_actor_radius_if_required

## u2-forestcliff_1002_n2
- main: terrains 0:12923 10:1477; terrain objects 2237; units p0/48:25 p0/59:30 p0/65:25 p0/66:25 p0/102:25 p0/349:10 p0/594:24; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone; draws {'land': 1, 'elevation': 1, 'cliffs': 3848, 'terrain': 10665, 'connections': 10665, 'objects_entry': 49435, 'objects': 98263} (be4379d6f1aa); NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone

## u2-forestcliff_1003_n2
- main: terrains 0:12936 10:1464; terrain objects 2153; units p0/48:25 p0/59:30 p0/65:25 p0/66:25 p0/102:25 p0/349:10 p0/594:24; NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone; draws {'land': 1, 'elevation': 1, 'cliffs': 3783, 'terrain': 10550, 'connections': 10550, 'objects_entry': 49359, 'objects': 98189} (963516989439); NOT MODELLED: avoid_cliff_zone, avoid_forest_zone, place_on_forest_zone

## u3-lands_1002_n2
- main: terrains 0:12880 5:241 6:367 14:703 32:209; terrain objects 766; units p0/48:8 p0/59:6 p0/65:4 p0/66:3 p0/102:3 p0/285:3 p1/594:4 p2/594:4; NOT MODELLED: generate_for_first_land_only, place_on_specific_land_id; draws {'land': 9843, 'elevation': 9843, 'cliffs': 9843, 'terrain': 9844, 'connections': 9844, 'objects_entry': 48852, 'objects': 84142} (f5a6ca25382f); NOT MODELLED: generate_for_first_land_only, place_on_specific_land_id

## u4-force_1002_n2
- main: terrains 0:14341 6:50 32:9; terrain objects 929; units p0/65:50 p0/66:2 p0/833:9; NOT MODELLED: force_placement; draws {'land': 68, 'elevation': 68, 'cliffs': 68, 'terrain': 69, 'connections': 69, 'objects_entry': 43143, 'objects': 57083} (ffa8b8d93be7); NOT MODELLED: force_placement

## u5-minconn_1002_n2
- main: terrains 0:13163 6:1237; terrain objects 786; units p0/66:24 p0/102:24; NOT MODELLED: min_connected_tiles; draws {'land': 1, 'elevation': 1, 'cliffs': 1, 'terrain': 6450, 'connections': 6450, 'objects_entry': 47177, 'objects': 61371} (6cdf934fc35f); NOT MODELLED: min_connected_tiles

## u5-minconn_1003_n2
- main: terrains 0:13172 6:1228; terrain objects 797; units p0/66:24 p0/102:24; NOT MODELLED: min_connected_tiles; draws {'land': 1, 'elevation': 1, 'cliffs': 1, 'terrain': 6501, 'connections': 6501, 'objects_entry': 47246, 'objects': 61452} (077af0a99384); NOT MODELLED: min_connected_tiles

## u6-walls_1002_n2-brit
- main: terrains 0:7742 6:6658; terrain objects 565; units p1/72:1 p1/109:1 p1/117:1 p2/72:1 p2/109:1 p2/117:1; NOT MODELLED: walls; draws {'land': 47768, 'elevation': 47768, 'cliffs': 47768, 'terrain': 47769, 'connections': 47769, 'objects_entry': 77654, 'objects': 79772} (9efa929c7b59); NOT MODELLED: walls

## u7-path_1002_n2-brit
- main: terrains 0:8125 6:1155 10:5120; terrain objects 5606; units p0/59:8 p0/66:8 p0/102:8 p1/109:1 p2/109:1; NOT MODELLED: require_path; draws {'land': 6982, 'elevation': 6982, 'cliffs': 6982, 'terrain': 26416, 'connections': 26416, 'objects_entry': 51947, 'objects': 56459} (b1804936b4a3); NOT MODELLED: require_path

## u7-path_1003_n2-brit
- main: terrains 0:8108 6:1167 10:5125; terrain objects 5611; units p0/59:8 p0/66:8 p0/102:8 p1/109:1 p2/109:1; NOT MODELLED: require_path; draws {'land': 6954, 'elevation': 6954, 'cliffs': 6954, 'terrain': 26339, 'connections': 26339, 'objects_entry': 51831, 'objects': 56211} (54f127f3f47f); NOT MODELLED: require_path

## u8-center_1002_n2-brit
- main: terrains 0:13860 6:540; terrain objects 808; units p0/59:6 p0/66:6 p0/102:8 p1/109:1 p2/109:1; draws {'land': 2710, 'elevation': 2710, 'cliffs': 2710, 'terrain': 2711, 'connections': 2711, 'objects_entry': 44832, 'objects': 86638} (f8dd325101cc)

## u9-layer_1002_n2
- main: terrains 0:409 14:13991; terrain objects 30; units p0/59:20 p0/65:10 p0/66:20 p0/102:20; NOT MODELLED: layer_to_place_on; draws {'land': 1, 'elevation': 1, 'cliffs': 1, 'terrain': 9094, 'connections': 9094, 'objects_entry': 10322, 'objects': 38170} (461bb1b85178); NOT MODELLED: layer_to_place_on

## u10-noop_1002_n2
- main: terrains 0:14363 6:25 27:12; terrain objects 856; units p0/65:5 p0/66:5 p0/70:3 p0/102:10; draws {'land': 32, 'elevation': 32, 'cliffs': 32, 'terrain': 33, 'connections': 33, 'objects_entry': 43184, 'objects': 71032} (336f57af73e1)
