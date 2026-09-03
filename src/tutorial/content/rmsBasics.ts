// tutorial-design.md Sec.9. Tutorial A, "Your first random map". Builds
// Golden Hill from an empty file, one step at a time, in the Breakdown
// editor. The finished script is src/tutorial/__tests__/fixtures/goldenHill.rms.
// Every completion check here is asserted against it in rmsBasics.test.ts.
//
import type { TutorialDefinition } from "../types";
import {
  hasCommand,
  hasCommandWhere,
  hasCommandWithAttributeWhere,
  hasObjectWith,
  hasObjectWithAttributeWhere,
  isEmptyScript,
} from "../scriptChecks";
import { appendObjectBlocks } from "../autoFill";


export const RMS_DISCORD_URL: string = "https://discord.gg/BDvG8s5Hwt";

export const rmsBasicsTutorial: TutorialDefinition = {
  id: "rms-basics",
  kind: "rms",
  title: "Your first random map",
  blurb: "Build a small map called Golden Hill from scratch, in about ten minutes.",
  steps: [
    {
      id: "start-new-file",
      title: "Start a new script",
      anchor: { kind: "help", id: "titleBar.file" },
      // The File button sits at the far left of the title bar, so the
      // default beside-the-anchor placement lands the callout right on top
      // of where the File dropdown opens below it (TitleBar.module.css's
      // `.dropdown` is `left:0`, `min-width:170px` but content-driven wider
      // in practice. "Save As…" plus its hotkey hint is the widest row, and
      // there's no single CSS literal to cite the way CommandPicker's
      // fixed-width panel has, so this is a generous estimate rather than a
      // measured number).
      calloutNudge: { x: 300 },
      navigate: { tab: "breakdown" },
      body: [
        "We'll build this from nothing, so start a fresh file. Open the File menu, choose New, then Save As and call it something like golden_hill.",
        "This map will feature player lands and a hill in the middle with gold on it.",
        "Age of RMS needs the file on disk before the Breakdown editor will show it. If you have a map open already, it is safe to save it first. This will not touch it.",
      ],
      completion: {
        kind: "check",
        test: (ctx) => ctx.hasFile && isEmptyScript(ctx.parseResult),
      },
      hint: "Waiting on a new, saved, empty script. Use File ▸ New, then File ▸ Save As.",
      bypass: { label: "Carry on with my own map" },
    },
    {
      id: "order-of-a-map",
      title: "The order of a map",
      anchor: { kind: "region", id: "breakdown.sectionTabs" },
      navigate: { tab: "breakdown" },
      body: [
        "A random map script runs top to bottom, and these seven numbered tabs are that order: 0. Header, 1. Player Setup, 2. Land, 3. Elevation, 4. Cliff, 5. Terrain, 6. Terrain Connection, 7. Objects.",
        "The game finishes each stage before starting the next, which is why you place land before you place gold on it.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "random-or-direct",
      title: "Random or direct placement",
      anchor: { kind: "help", id: "breakdown.tab.playerSetup" },
      extraAnchors: [
        { kind: "help", id: "breakdown.addCommand" },
        { kind: "region", id: "breakdown.main" },
      ],
      // The callout would otherwise land right where pressing + Add command
      // opens CommandPicker's dropdown (CommandPicker.module.css's `.panel`
      // is `width: 22rem` = 352px at the default 16px root, growing straight
      // down from the button at the left edge of the card area). Nudged
      // clear of that by the panel's own width plus a gap, and widened a
      // touch since there's now room for it.
      calloutNudge: { x: 368 },
      calloutMaxWidthPx: 380,
      navigate: { section: "PLAYER_SETUP" },
      body: [
        "There are two ways to decide where players start. ",
        "1. random_placement lets the generator scatter the player lands for you. This is what most maps use. ",
        "2. direct_placement hands you the controls instead. You position every land yourself with land_position, which is more power and a lot more work.",
        "We'll use random placement. Press + Add command and pick random_placement.",
      ],
      completion: {
        kind: "check",
        test: (ctx) => hasCommand(ctx.parseResult, "PLAYER_SETUP", "random_placement"),
      },
    },
    {
      id: "player-lands",
      title: "Give the players some land",
      anchor: { kind: "help", id: "breakdown.addCommand" },
      extraAnchors: [{ kind: "region", id: "breakdown.main" }],
      // Same reasoning as "random-or-direct": the Add command button spans
      // the full width of the card area, so CommandPicker's dropdown opens
      // right where the default below-the-button placement would put the
      // callout too. Same nudge (352px panel width + gap) and width.
      calloutNudge: { x: 368 },
      calloutMaxWidthPx: 380,
      navigate: { section: "LAND_GENERATION" },
      body: [
        "Add the create_player_lands command. It makes one land per player, all identical, which is the easy way to keep a map fair. Commands have attributes to change what they do (after creating the command, click the + to open the attribute list). In this case, three attributes is enough: ",
        "1. terrain_type GRASS for what the land is made of ",
        "2. land_percent 20 for how much of the map the lands take between them, and ",
        "3. circle_radius 35 for how far out from the centre they sit.",
        "circle_radius is a great way to start experimenting with mapmaking. It is the ring everybody starts on, so it decides how far apart players are, and nudging it is the quickest way to change how a map plays.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_player_lands",
            "terrain_type",
            (args) => args[0]?.toUpperCase() === "GRASS",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_player_lands",
            "land_percent",
            (args) => args[0] === "20",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_player_lands",
            "circle_radius",
            (args) => args[0] === "35",
          ),
      },
    },
    {
      id: "hill-in-the-middle",
      title: "A hill in the middle",
      // Same anchor/extraAnchors/nudge as "player-lands" (not a lookalike
      // config, but literally the same element), so the callout lands in
      // exactly the same on-screen spot for both steps: this one is still
      // "add a command in LAND_GENERATION", and jumping the tutorial window
      // to a different position for what reads as a continuation of the
      // same action would be its own source of confusion.
      anchor: { kind: "help", id: "breakdown.addCommand" },
      extraAnchors: [{ kind: "region", id: "breakdown.main" }],
      calloutNudge: { x: 368 },
      calloutMaxWidthPx: 380,
      navigate: { section: "LAND_GENERATION" },
      body: [
        "Now let's create the centre hill. Add a create_land command. We will use 5 attributes this time, the two new ones to raise the elevation and to give it an ID. Note: create_land will only add one land instead of one per player. ",
        "Make the create_land have terrain_type DIRT with land_percent 8, land_position 50 50 to pin it to the map's centre, base_elevation 3 to raise it, and land_id 10 so we can find it again when we put the gold on it.",
        "Expect a warning to appear at the bottom of the window. A raised land needs the elevation section to be present, and we add that next. But first...",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_land",
            "terrain_type",
            (args) => args[0]?.toUpperCase() === "DIRT",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_land",
            "land_percent",
            (args) => args[0] === "8",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_land",
            "land_position",
            (args) => args[0] === "50" && args[1] === "50",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_land",
            "base_elevation",
            (args) => args[0] === "3",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "LAND_GENERATION",
            "create_land",
            "land_id",
            (args) => args[0] === "10",
          ),
      },
    },
    {
      id: "watch-it-appear",
      title: "Watch it appear",
      anchor: { kind: "region", id: "sidePanel.preview" },
      body: [
        "The preview regenerates as you edit. Your player lands and the centre hill should be there now. It is an approximation, not the exact same as the game engine. The notes drawer lists everything it could not model exactly.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "hills",
      title: "Hills",
      anchor: { kind: "help", id: "breakdown.tab.elevationGeneration" },
      extraAnchors: [{ kind: "region", id: "breakdown.cardList" }],
      navigate: { section: "ELEVATION_GENERATION" },
      body: [
        "create_elevation raises clumps of ground, and its argument is the height to build up to. Let's add some elevation around the map. Add create_elevation 4 with base_terrain GRASS (only grass gets raised), number_of_clumps 10 and number_of_tiles 600.",
        "The warning from the last step should clear as soon as this section exists. The section will exist once a command is created.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommandWhere(ctx.parseResult, "ELEVATION_GENERATION", "create_elevation", (args) => args[0] === "4") &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "ELEVATION_GENERATION",
            "create_elevation",
            "base_terrain",
            (args) => args[0]?.toUpperCase() === "GRASS",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "ELEVATION_GENERATION",
            "create_elevation",
            "number_of_clumps",
            (args) => args[0] === "10",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "ELEVATION_GENERATION",
            "create_elevation",
            "number_of_tiles",
            (args) => args[0] === "600",
          ),
      },
    },
    {
      id: "cliffs",
      title: "Cliffs",
      anchor: { kind: "help", id: "breakdown.tab.cliffGeneration" },
      extraAnchors: [{ kind: "region", id: "breakdown.cardList" }],
      navigate: { section: "CLIFF_GENERATION" },
      body: [
        "Cliffs are the odd section out: no block, just a handful of standalone settings. Add min_number_of_cliffs 3 and max_number_of_cliffs 6, then min_length_of_cliff 4 and max_length_of_cliff 8.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommandWhere(ctx.parseResult, "CLIFF_GENERATION", "min_number_of_cliffs", (args) => args[0] === "3") &&
          hasCommandWhere(ctx.parseResult, "CLIFF_GENERATION", "max_number_of_cliffs", (args) => args[0] === "6") &&
          hasCommandWhere(ctx.parseResult, "CLIFF_GENERATION", "min_length_of_cliff", (args) => args[0] === "4") &&
          hasCommandWhere(ctx.parseResult, "CLIFF_GENERATION", "max_length_of_cliff", (args) => args[0] === "8"),
      },
    },
    {
      id: "trees",
      title: "Trees",
      anchor: { kind: "help", id: "breakdown.tab.terrainGeneration" },
      extraAnchors: [{ kind: "region", id: "breakdown.cardList" }],
      navigate: { section: "TERRAIN_GENERATION" },
      body: [
        "Let's talk about create_terrain commands. create_terrain FOREST paints forest over what is already there. The attribute \"base_terrain\" then names the terrain for the forest to be painted on (in this case, let's make it GRASS), land_percent 10 is the total coverage, number_of_clumps 20 is how many groups (10/20 = 0.5 land percent per group), and set_avoid_player_start_areas 8 keeps it off everybody's town centre by 8 tiles.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommandWhere(
            ctx.parseResult,
            "TERRAIN_GENERATION",
            "create_terrain",
            (args) => args[0]?.toUpperCase() === "FOREST",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "TERRAIN_GENERATION",
            "create_terrain",
            "base_terrain",
            (args) => args[0]?.toUpperCase() === "GRASS",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "TERRAIN_GENERATION",
            "create_terrain",
            "land_percent",
            (args) => args[0] === "10",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "TERRAIN_GENERATION",
            "create_terrain",
            "number_of_clumps",
            (args) => args[0] === "20",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "TERRAIN_GENERATION",
            "create_terrain",
            "set_avoid_player_start_areas",
            (args) => args[0] === "8",
          ),
      },
    },
    {
      id: "road-to-hill",
      title: "A road to the hill",
      anchor: { kind: "help", id: "breakdown.tab.connectionGeneration" },
      extraAnchors: [{ kind: "region", id: "breakdown.cardList" }],
      navigate: { section: "CONNECTION_GENERATION" },
      body: [
        "create_connect_to_nonplayer_land walks a path from every player to every neutral land, paving as it goes. Two lines of paving is all we need: replace_terrain GRASS ROAD and replace_terrain DIRT ROAD, so the road shows up on the grass and again where it climbs the dirt hill.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasCommand(ctx.parseResult, "CONNECTION_GENERATION", "create_connect_to_nonplayer_land") &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "CONNECTION_GENERATION",
            "create_connect_to_nonplayer_land",
            "replace_terrain",
            (args) => args[0]?.toUpperCase() === "GRASS" && args[1]?.toUpperCase() === "ROAD",
          ) &&
          hasCommandWithAttributeWhere(
            ctx.parseResult,
            "CONNECTION_GENERATION",
            "create_connect_to_nonplayer_land",
            "replace_terrain",
            (args) => args[0]?.toUpperCase() === "DIRT" && args[1]?.toUpperCase() === "ROAD",
          ),
      },
    },
    {
      id: "starting-units",
      title: "Starting units",
      anchor: { kind: "help", id: "breakdown.tab.objectsGeneration" },
      extraAnchors: [{ kind: "region", id: "breakdown.cardList" }],
      navigate: { section: "OBJECTS_GENERATION" },
      body: [
        "Three create_object commands: TOWN_CENTER (max_distance_to_players 0), VILLAGER with number_of_objects 3 (min-max 7-9), and SCOUT (min-max 7-9). Each needs set_place_for_every_player, plus min_distance_to_players / max_distance_to_players to say how far from the centre of the player land they spawn.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasObjectWith(ctx.parseResult, "TOWN_CENTER", "set_place_for_every_player") &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "TOWN_CENTER",
            "max_distance_to_players",
            (args) => args[0] === "0",
          ) &&
          hasObjectWith(ctx.parseResult, "VILLAGER", "set_place_for_every_player") &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "VILLAGER",
            "number_of_objects",
            (args) => args[0] === "3",
          ) &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "VILLAGER",
            "min_distance_to_players",
            (args) => args[0] === "7",
          ) &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "VILLAGER",
            "max_distance_to_players",
            (args) => args[0] === "9",
          ) &&
          hasObjectWith(ctx.parseResult, "SCOUT", "set_place_for_every_player") &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "SCOUT",
            "min_distance_to_players",
            (args) => args[0] === "7",
          ) &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "SCOUT",
            "max_distance_to_players",
            (args) => args[0] === "9",
          ),
      },
    },
    {
      id: "gold-on-the-hill",
      title: "Gold on the hill",
      anchor: { kind: "region", id: "breakdown.cardList" },
      // Moved right by the same distance as the LAND_GENERATION steps
      // (player-lands/hill-in-the-middle). This step's own Add command
      // press opens the identical CommandPicker dropdown at the same
      // left-edge-of-the-card-area position.
      calloutNudge: { x: 368 },
      calloutMaxWidthPx: 380,
      navigate: { section: "OBJECTS_GENERATION" },
      body: [
        "This is the bit the map is named after. Add create_object GOLD with number_of_objects 8, number_of_groups 4, set_gaia_object_only, and place_on_specific_land_id 10, the id you gave the hill in step 4.",
        "There is more than one way to place gold on that hill: place_on_specific_land_id targets the land itself, terrain_to_place_on DIRT targets the terrain the hill is made of, and find_closest_to_map_center just works inward until it finds room. Which one is right depends on what you want to stay true every time the map regenerates.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "GOLD",
            "place_on_specific_land_id",
            (args) => args[0] === "10",
          ) &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "GOLD",
            "number_of_objects",
            (args) => args[0] === "8",
          ) &&
          hasObjectWithAttributeWhere(
            ctx.parseResult,
            "GOLD",
            "number_of_groups",
            (args) => args[0] === "4",
          ) &&
          hasObjectWith(ctx.parseResult, "GOLD", "set_gaia_object_only"),
      },
    },
    {
      id: "everyone-elses-resources",
      title: "Everyone else's resources",
      anchor: { kind: "region", id: "breakdown.cardList" },
      // Same rightward move as "gold-on-the-hill" and the LAND_GENERATION
      // steps. This step's own Add command press opens the same
      // CommandPicker dropdown in the same spot.
      calloutNudge: { x: 368 },
      calloutMaxWidthPx: 380,
      navigate: { section: "OBJECTS_GENERATION" },
      body: [
        "Now let's add the per-player gaia objects: FORAGE_BUSH, a GOLD group, STONE, and OAKTREE stragglers. All take set_place_for_every_player, so one command covers all eight players.",
        "All also need set_gaia_object_only. Without it the objects belong to the player rather than to Gaia, but the engine won't place a player-owned gold mine.",
      ],
      completion: {
        kind: "check",
        test: (ctx) =>
          hasObjectWith(ctx.parseResult, "FORAGE_BUSH", "set_gaia_object_only") &&
          hasObjectWith(ctx.parseResult, "STONE", "set_gaia_object_only"),
      },
      autoFill: {
        label: "Add them for me",
        buildEdit: (ctx) =>
          ctx.parseResult &&
          appendObjectBlocks(ctx.parseResult, "OBJECTS_GENERATION", [
            {
              name: "FORAGE_BUSH",
              attributes: [
                "number_of_objects 6",
                "set_tight_grouping",
                "set_place_for_every_player",
                "set_gaia_object_only",
                "min_distance_to_players 8",
                "max_distance_to_players 12",
              ],
            },
            {
              name: "GOLD",
              attributes: [
                "number_of_objects 5",
                "set_tight_grouping",
                "set_place_for_every_player",
                "set_gaia_object_only",
                "min_distance_to_players 12",
                "max_distance_to_players 16",
              ],
            },
            {
              name: "STONE",
              attributes: [
                "number_of_objects 4",
                "set_tight_grouping",
                "set_place_for_every_player",
                "set_gaia_object_only",
                "min_distance_to_players 12",
                "max_distance_to_players 16",
              ],
            },
            {
              name: "OAKTREE",
              attributes: [
                "number_of_objects 2",
                "set_place_for_every_player",
                "set_gaia_object_only",
                "min_distance_to_players 4",
                "max_distance_to_players 6",
              ],
            },
          ]),
      },
    },
    {
      id: "this-is-what-it-really-is",
      title: "This is what it really is",
      anchor: { kind: "help", id: "tabBar.code" },
      extraAnchors: [{ kind: "region", id: "code.editor" }],
      navigate: { tab: "code" },
      body: [
        "Everything you just clicked is text, and the text is the file. Breakdown is a simplified view. Every edit you made became a small change here, with your comments and layout untouched.",
        "If you already write RMS by hand, this tab is where you will live.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "looking-things-up",
      title: "Looking things up",
      anchor: { kind: "region", id: "sidePanel.reference" },
      navigate: { tab: "code" },
      body: [
        "Terrains, objects, commands and the attributes each command takes. The Preview Obj. List tab is the useful one when something did not appear. It lists every object your script asks for beside how many the last generation actually placed.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "resources-at-a-glance",
      title: "Resources at a glance",
      anchor: { kind: "region", id: "statusBar.resources" },
      moveAsideCorner: "top-right",
      body: [
        "Totals for the whole map, split into what players start with and what is neutral. They update as you edit, and are useful for ensuring that players have good starting resources.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "player-count-and-map-size",
      title: "Player count and map size",
      anchor: { kind: "help", id: "statusBar.generationSettings" },
      moveAsideCorner: "top-right",
      body: [
        "The cog sets the player count, map size and team layout that the preview and those totals are calculated for. They belong to the script you are writing rather than to the app, which is why they live here and not in Settings.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "you-made-a-map",
      title: "You made a map",
      body: [
        "That is a complete, playable script. Save it into your game's random map folder and it will appear in the map list.",
        "Come and say hello in the RMS Discord! We are very friendly. Bring your map ideas, people will tell you what to try next.",
      ],
      completion: { kind: "manual" },
    },
  ],
};
