// tutorial-design.md Sec.9.2. The Code track of Tutorial A. The same Golden
// Hill map as the Breakdown track, typed into the Code tab instead of built
// from cards. `withCodeTrack` (editorTracks.ts) joins each step here to the
// Breakdown step it mirrors and gives it that step's check and autoFill.
//
// The copy fades its scaffolding. The first three steps show the exact text
// to type. From the hill on, a step says what to write in words and keeps
// the text behind an "Answer" spoiler, so a learner tries first and is never
// stuck.

import { CODE_EDITOR_ANCHOR, type CodeTwin } from "../editorTracks";

const editor = CODE_EDITOR_ANCHOR;

export const RMS_BASICS_CODE_TWINS: readonly CodeTwin[] = [
  {
    twinOf: "order-of-a-map",
    id: "order-of-a-map-code",
    title: "The order of a map",
    anchor: { kind: "help", id: "tabBar.code" },
    extraAnchors: [editor],
    navigate: { tab: "code" },
    body: [
      "A random map script runs top to bottom in sections. A section starts with its name in angle brackets, called a header, and runs until the next header. These are the headers in the order they go.",
      {
        kind: "code",
        text: "<PLAYER_SETUP>\n<LAND_GENERATION>\n<ELEVATION_GENERATION>\n<CLIFF_GENERATION>\n<TERRAIN_GENERATION>\n<CONNECTION_GENERATION>\n<OBJECTS_GENERATION>",
      },
      "The game finishes each stage before starting the next, which is why you place land before you place gold on it.",
      "Hover over any word you type to see what it does. An underline means the script has a problem there, and hovering over it says what.",
    ],
  },
  {
    twinOf: "random-or-direct",
    id: "random-or-direct-code",
    title: "Random or direct placement",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "There are two ways to decide where players start.",
      "1. random_placement lets the generator scatter the player lands for you. This is what most maps use.",
      "2. direct_placement hands you the controls instead. You position every land yourself with land_position, which is more power and a lot more work.",
      "We'll use random placement. Click in the editor and type the header, then the command on the line under it.",
      { kind: "code", text: "<PLAYER_SETUP>\nrandom_placement" },
    ],
  },
  {
    twinOf: "player-lands",
    id: "player-lands-code",
    title: "Give the players some land",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "On a new line, start the next section with <LAND_GENERATION>. Its first command is create_player_lands. It makes one land per player, all identical, which is the easy way to keep a map fair.",
      "Commands take attributes that change what they do. The attributes go between curly braces after the command, one on each line. The indent is only there to make it easier to read. Type this.",
      {
        kind: "code",
        text: "<LAND_GENERATION>\ncreate_player_lands {\n  terrain_type GRASS\n  land_percent 20\n  circle_radius 35\n}",
      },
      "terrain_type is what the land is made of. land_percent is how much of the map the lands take between them. circle_radius is how far out from the centre they sit.",
      "circle_radius is a great way to start experimenting with mapmaking. It is the ring everybody starts on, so it decides how far apart players are, and nudging it is the quickest way to change how a map plays.",
    ],
  },
  {
    twinOf: "hill-in-the-middle",
    id: "hill-in-the-middle-code",
    title: "A hill in the middle",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Now the centre hill. Below the player lands, add a create_land block. It is written the same way as create_player_lands, but it makes one land instead of one per player.",
      "Try writing it yourself. Give it terrain_type DIRT and land_percent 8, then land_position 50 50 to pin it to the map's centre, base_elevation 3 to raise it, and land_id 10 so we can find it again when we put the gold on it.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "create_land {\n  terrain_type DIRT\n  land_percent 8\n  land_position 50 50\n  base_elevation 3\n  land_id 10\n}",
      },
      "Expect a red underline under base_elevation. Hover over it to read why. A raised land needs the elevation section, and we add that next. But first...",
    ],
  },
  {
    twinOf: "hills",
    id: "hills-code",
    title: "Hills",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Start the next section with <ELEVATION_GENERATION>. Keep an eye on the red underline from the last step while you type the header.",
      "create_elevation raises clumps of ground. The number after it is the height to build up to, and it goes on the same line as the command, before the brace.",
      "Add create_elevation 4 with base_terrain GRASS (only grass gets raised), number_of_clumps 10 and number_of_tiles 600.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "<ELEVATION_GENERATION>\ncreate_elevation 4 {\n  base_terrain GRASS\n  number_of_clumps 10\n  number_of_tiles 600\n}",
      },
    ],
  },
  {
    twinOf: "cliffs",
    id: "cliffs-code",
    title: "Cliffs",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Cliffs are the odd section out. There are no blocks and so no curly braces. Each setting is a command on its own line under the <CLIFF_GENERATION> header.",
      "Add min_number_of_cliffs 3 and max_number_of_cliffs 6, then min_length_of_cliff 4 and max_length_of_cliff 8.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "<CLIFF_GENERATION>\nmin_number_of_cliffs 3\nmax_number_of_cliffs 6\nmin_length_of_cliff 4\nmax_length_of_cliff 8",
      },
    ],
  },
  {
    twinOf: "trees",
    id: "trees-code",
    title: "Trees",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Next comes <TERRAIN_GENERATION>. create_terrain FOREST paints forest over what is already there.",
      "Inside its block, base_terrain GRASS names the terrain the forest is painted on. land_percent 10 is the total coverage, and number_of_clumps 20 is how many groups (10/20 = 0.5 land percent per group). set_avoid_player_start_areas 8 keeps the forest 8 tiles away from everybody's town centre.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "<TERRAIN_GENERATION>\ncreate_terrain FOREST {\n  base_terrain GRASS\n  land_percent 10\n  number_of_clumps 20\n  set_avoid_player_start_areas 8\n}",
      },
    ],
  },
  {
    twinOf: "road-to-hill",
    id: "road-to-hill-code",
    title: "A road to the hill",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Under <CONNECTION_GENERATION>, create_connect_to_nonplayer_land walks a path from every player to every neutral land, paving as it goes.",
      "Two lines of paving is all we need, and one block can hold the same attribute twice. Add replace_terrain GRASS ROAD and replace_terrain DIRT ROAD, so the road shows up on the grass and again where it climbs the dirt hill.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "<CONNECTION_GENERATION>\ncreate_connect_to_nonplayer_land {\n  replace_terrain GRASS ROAD\n  replace_terrain DIRT ROAD\n}",
      },
    ],
  },
  {
    twinOf: "starting-units",
    id: "starting-units-code",
    title: "Starting units",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "The last section is <OBJECTS_GENERATION>. Each create_object block places one kind of object, and the object's name goes after the command.",
      "Add three of them. TOWN_CENTER with max_distance_to_players 0, VILLAGER with number_of_objects 3, and SCOUT. Each needs set_place_for_every_player, which places them for every player. Give the villagers and the scout min_distance_to_players 7 and max_distance_to_players 9 to say how far from the middle of the player land they spawn.",
      "set_place_for_every_player is a flag. It takes no number, so it is the attribute name alone on its line.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "<OBJECTS_GENERATION>\ncreate_object TOWN_CENTER {\n  set_place_for_every_player\n  max_distance_to_players 0\n}\n\ncreate_object VILLAGER {\n  set_place_for_every_player\n  number_of_objects 3\n  min_distance_to_players 7\n  max_distance_to_players 9\n}\n\ncreate_object SCOUT {\n  set_place_for_every_player\n  min_distance_to_players 7\n  max_distance_to_players 9\n}",
      },
    ],
  },
  {
    twinOf: "gold-on-the-hill",
    id: "gold-on-the-hill-code",
    title: "Gold on the hill",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "This is the bit the map is named after. Add create_object GOLD with number_of_objects 8, number_of_groups 4, set_gaia_object_only, and place_on_specific_land_id 10, the id you gave the hill earlier.",
      {
        kind: "spoiler",
        label: "Answer",
        code: true,
        text: "create_object GOLD {\n  number_of_objects 8\n  number_of_groups 4\n  set_gaia_object_only\n  place_on_specific_land_id 10\n}",
      },
      "There is more than one way to place gold on that hill. place_on_specific_land_id targets the land itself, terrain_to_place_on DIRT targets the terrain the hill is made of, and find_closest_to_map_center works inward until it finds room. Which one is right depends on what you want to stay true every time the map regenerates.",
    ],
  },
  {
    twinOf: "everyone-elses-resources",
    id: "everyone-elses-resources-code",
    title: "Everyone else's resources",
    anchor: editor,
    navigate: { tab: "code" },
    body: [
      "Now the resources each player gets nearby, which are FORAGE_BUSH, a GOLD group, STONE and a few OAKTREE stragglers. All take set_place_for_every_player, so one block covers all eight players.",
      "All also need set_gaia_object_only. Without it the objects belong to the player rather than to Gaia, and the engine won't place a player-owned gold mine.",
      "Here is the first one. The other three follow the same pattern with their own numbers.",
      {
        kind: "code",
        text: "create_object FORAGE_BUSH {\n  number_of_objects 6\n  set_tight_grouping\n  set_place_for_every_player\n  set_gaia_object_only\n  min_distance_to_players 8\n  max_distance_to_players 12\n}",
      },
      {
        kind: "spoiler",
        label: "The other three",
        code: true,
        text: "create_object GOLD {\n  number_of_objects 5\n  set_tight_grouping\n  set_place_for_every_player\n  set_gaia_object_only\n  min_distance_to_players 12\n  max_distance_to_players 16\n}\n\ncreate_object STONE {\n  number_of_objects 4\n  set_tight_grouping\n  set_place_for_every_player\n  set_gaia_object_only\n  min_distance_to_players 12\n  max_distance_to_players 16\n}\n\ncreate_object OAKTREE {\n  number_of_objects 2\n  set_place_for_every_player\n  set_gaia_object_only\n  min_distance_to_players 4\n  max_distance_to_players 6\n}",
      },
    ],
  },
  {
    twinOf: "this-is-what-it-really-is",
    id: "the-same-map-as-cards",
    title: "The same map as cards",
    anchor: { kind: "help", id: "tabBar.breakdown" },
    extraAnchors: [{ kind: "region", id: "breakdown.main" }],
    navigate: { tab: "breakdown", section: "OBJECTS_GENERATION" },
    body: [
      "Breakdown is another view of the text you typed. Each section header is one of the numbered tabs along the top, and each block is a card.",
      "Editing a card makes a small change to your text and leaves the rest of it as you wrote it. Some authors type in Code and come here to look over a long block, or to add an attribute from the list when they cannot remember its name.",
    ],
  },
];
