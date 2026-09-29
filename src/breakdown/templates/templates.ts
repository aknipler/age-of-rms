// Object Templates, docs/object-templates-brief.md. Pure: option types ->
// RMS text, no React, no parser/patch imports beyond nothing at all (this
// module doesn't even need formatStyle; the patch engine's insertText case
// in computeEdit.ts is what reindents the text this module produces).
//
// Every template's text uses "\n" as its own line separator and a leading
// tab per line as a placeholder indent level (one tab = one level inside a
// create_object block). computeEdit.ts's insertText case (formatStyle's
// reindentBlock) translates that to the target file's own detected
// indent unit and eol before insertion, so a block built here stays
// self-contained and independently parseable/testable, the same
// canonical text regardless of which file it eventually lands in.
//
// caretOffset is measured against this SAME untranslated text and always
// points at the start of a top-level (no leading tab) line, the block's
// first real create_object command, right after the header comment. That
// invariant is what keeps the caret exact after reindenting (see
// reindentBlock's own doc comment in formatStyle.ts).

export type TemplateId =
  | "standardPlayerObjects"
  | "standardPlayerResources"
  | "standardWaterResources"
  | "playerForestsObjects"
  | "playerForestsTerrain";

/** The Breakdown tabs that offer Add template, each with its own list. */
export type TemplateSection = "OBJECTS_GENERATION" | "TERRAIN_GENERATION";

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  section: TemplateSection;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "standardPlayerObjects",
    label: "Standard player objects",
    section: "OBJECTS_GENERATION",
  },
  {
    id: "standardPlayerResources",
    label: "Standard player resources",
    section: "OBJECTS_GENERATION",
  },
  {
    id: "standardWaterResources",
    label: "Standard water resources",
    section: "OBJECTS_GENERATION",
  },
  {
    id: "playerForestsObjects",
    label: "Player forests",
    section: "OBJECTS_GENERATION",
  },
  {
    id: "playerForestsTerrain",
    label: "Player forests",
    section: "TERRAIN_GENERATION",
  },
];

export function templatesFor(section: string): TemplateMeta[] {
  return TEMPLATES.filter((t) => t.section === section);
}

export interface RenderedTemplate {
  text: string;
  caretOffset: number;
  /**
   * Lines the block depends on that belong in PLAYER_SETUP rather than at
   * the insert point, same tab-per-level convention as `text`. Becomes the
   * insertText intent's `setupText`. Only the object player forests
   * template sets it.
   */
  setupText?: string;
}

/** A bare identifier, the only shape terrain_to_place_on's value can legally take. */
export function isValidIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

// ---- T1: Standard Player Objects --------------------------------------

export interface T1Options {
  quickStart: boolean;
  /** Only read while quickStart is true; ignored otherwise. */
  advanced: boolean;
  /** Trimmed identifier, or "" to leave every command at its default terrain. */
  terrainToPlaceOn: string;
}

export const T1_DEFAULTS: T1Options = {
  quickStart: false,
  advanced: false,
  terrainToPlaceOn: "",
};

// ---- T2: Standard Player Resources -------------------------------------

// DLC_-prefixed names are the confirmed corpus/reference-data spelling for
// these animals (game-constants.json's rmsConstant field and, e.g.,
// "13_Rings_v1.2.rms"'s own create_object DLC_GOAT/DLC_ZEBRA/DLC_ELEPHANT
// uses); the plain guide-style name doesn't exist as a real RMS constant
// for these five.
export type WildlifeHerdable =
  "SHEEP" | "TURKEY" | "DLC_GOAT" | "DLC_LLAMA" | "DLC_COW";
export type WildlifeHuntable =
  "DEER" | "DLC_ZEBRA" | "DLC_OSTRICH" | "DLC_IBEX";
export type WildlifeLurable =
  "BOAR" | "DLC_ELEPHANT" | "DLC_RHINO" | "JAVELINA";
// FRUIT_BUSH only exists in the corpus as a map's own #const alias for
// DLC_ORANGEBUSH (id 1059); DLC_ORANGEBUSH is the real constant, used
// directly and unaliased across the corpus ("24hr_Arrakeen.rms",
// "AD4 - Pag - v1.2.rms"). PINEAPPLE_BUSH (id 2650) and PAPAYA_TREE (id
// 2599) are each their own object row in game-constants.json, same
// 125-food/land-habitat shape as the other two, absent from the tracked
// corpus but a positive resolver hit is what the vocabulary rule asks for.
export type BerryType =
  "FORAGE_BUSH" | "DLC_ORANGEBUSH" | "PINEAPPLE_BUSH" | "PAPAYA_TREE";

export const HERDABLE_OPTIONS: { value: WildlifeHerdable; label: string }[] = [
  { value: "SHEEP", label: "Sheep" },
  { value: "TURKEY", label: "Turkey" },
  { value: "DLC_GOAT", label: "Goat" },
  { value: "DLC_LLAMA", label: "Llama" },
  { value: "DLC_COW", label: "Cow" },
];
export const HUNTABLE_OPTIONS: { value: WildlifeHuntable; label: string }[] = [
  { value: "DEER", label: "Deer" },
  { value: "DLC_ZEBRA", label: "Zebra" },
  { value: "DLC_OSTRICH", label: "Ostrich" },
  { value: "DLC_IBEX", label: "Ibex" },
];
export const LURABLE_OPTIONS: { value: WildlifeLurable; label: string }[] = [
  { value: "BOAR", label: "Boar" },
  { value: "DLC_ELEPHANT", label: "Elephant" },
  { value: "DLC_RHINO", label: "Rhinoceros" },
  { value: "JAVELINA", label: "Javelina" },
];
export const BERRY_OPTIONS: { value: BerryType; label: string }[] = [
  { value: "FORAGE_BUSH", label: "Forage bush" },
  { value: "DLC_ORANGEBUSH", label: "Fruit bush" },
  { value: "PINEAPPLE_BUSH", label: "Pineapple bush" },
  { value: "PAPAYA_TREE", label: "Papaya tree" },
];

export interface T2Options {
  seasonal: boolean;
  berryType: BerryType;
  herdable: WildlifeHerdable;
  huntable: WildlifeHuntable;
  lurable: WildlifeLurable;
  terrainToPlaceOn: string;
}

export const T2_DEFAULTS: T2Options = {
  seasonal: false,
  berryType: "FORAGE_BUSH",
  herdable: "SHEEP",
  huntable: "DEER",
  lurable: "BOAR",
  terrainToPlaceOn: "",
};

// ---- T3: Standard Water Resources ---------------------------------------

export interface T3Options {
  oysters: boolean;
  whales: boolean;
}

export const T3_DEFAULTS: T3Options = { oysters: false, whales: false };

// ---- shared block builder -----------------------------------------------

interface Attr {
  name: string;
  value?: string | number;
}

function block(name: string, attrs: Attr[], label?: string): string {
  const lines = attrs.map((a) =>
    a.value === undefined ? `\t${a.name}` : `\t${a.name} ${a.value}`,
  );
  const head = label
    ? `create_object ${name} /* ${label} */`
    : `create_object ${name}`;
  return `${head}\n{\n${lines.join("\n")}\n}`;
}

function withTerrain(attrs: Attr[], terrain: string): Attr[] {
  return terrain
    ? [...attrs, { name: "terrain_to_place_on", value: terrain }]
    : attrs;
}

// ---- T1 renderer ----------------------------------------------------------

// Base per docs/object-templates-brief.md Sec.2 T1. The quick-start variant
// keeps TOWN_CENTER and SCOUT and swaps the plain 3-villager block for the
// QS_Three_Bays_v1.1.rms-style start: one "eating" sheep the six villagers
// gather on via actor_area/actor_area_to_place_in, three more on the
// nearest forest zone (a straggler tree, place_on_forest_zone), and two
// starting houses. This is the canonical/readable shape, not a copy of
// that map's own ONGRID_PLACEHOLDER machinery — the advanced variant below
// is that copy, for the case where a copy-paste result matters more than a
// beginner being able to read it.
function renderSimpleQuickStart(terrain: string): string[] {
  const sheepComment =
    "/* Eating sheep: the six villagers below gather on it right away */";
  const sheep = block(
    "SHEEP",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "min_distance_to_players", value: 4 },
        { name: "max_distance_to_players", value: 5 },
        { name: "actor_area", value: 1 },
        { name: "actor_area_radius", value: 1 },
      ],
      terrain,
    ),
  );
  const villagersOnSheep = block(
    "VILLAGER",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 6 },
        { name: "actor_area_to_place_in", value: 1 },
        { name: "min_distance_to_players", value: 4 },
        { name: "max_distance_to_players", value: 5 },
      ],
      terrain,
    ),
  );
  const villagersOnTree = block(
    "VILLAGER",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 3 },
        { name: "place_on_forest_zone" },
        { name: "min_distance_to_players", value: 6 },
        { name: "max_distance_to_players", value: 8 },
      ],
      terrain,
    ),
  );
  const houses = block(
    "HOUSE",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 2 },
        { name: "min_distance_to_players", value: 3 },
        { name: "max_distance_to_players", value: 5 },
      ],
      terrain,
    ),
  );
  return [
    sheepComment,
    sheep,
    "",
    villagersOnSheep,
    "",
    villagersOnTree,
    "",
    houses,
  ];
}

// The advanced variant: the exact tile-reservation technique
// "Venn.rms" (~lines 1098-1304) and "Bulls_Eyes.rms" (~lines 741-831) both
// use, so a copy-paste result places the sheep and all nine villagers in
// fixed, non-overlapping spots instead of leaving the engine to sort
// distance-4-to-5 candidates out on its own. PH_NEUTRAL_OFF placeholders at
// actor areas 5100/5101/5103/5104 claim the tiles at exactly distance 1 and
// 2 from the player before anything else is placed, so the sheep (area 20)
// and the six PH_PLAYER_OFF villagers (area 2, gendered by start_random
// between LAZY_MALE/LAZY_FEMALE like the corpus does) land on tiles nothing
// else already claimed. The actor-area ids are copied from those two maps
// unchanged, since this is meant to be pasted in and trusted rather than
// re-derived.
function renderAdvancedQuickStart(terrain: string): string[] {
  const nearPositioner = block(
    "PH_NEUTRAL_OFF",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "number_of_objects", value: 5 },
        { name: "min_distance_to_players", value: 1 },
        { name: "max_distance_to_players", value: 1 },
        { name: "find_closest" },
        { name: "actor_area", value: 5100 },
        { name: "actor_area_radius", value: 0 },
      ],
      terrain,
    ),
    "Near positioner: claims 5 of the 8 tiles at distance 1",
  );
  const villagerAvoider = block(
    "PH_NEUTRAL_OFF",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "min_distance_to_players", value: 1 },
        { name: "max_distance_to_players", value: 1 },
        { name: "find_closest" },
        { name: "actor_area", value: 5101 },
        { name: "actor_area_radius", value: 0 },
        { name: "avoid_actor_area", value: 5100 },
      ],
      terrain,
    ),
    "Villager avoider: claims one of the remaining distance-1 tiles",
  );
  const farPositioner = block(
    "PH_NEUTRAL_OFF",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "number_of_objects", value: 5 },
        { name: "min_distance_to_players", value: 2 },
        { name: "max_distance_to_players", value: 2 },
        { name: "temp_min_distance_group_placement", value: 1 },
        { name: "find_closest" },
        { name: "actor_area", value: 5103 },
        { name: "actor_area_radius", value: 1 },
      ],
      terrain,
    ),
    "Far positioner: claims 5 of the tiles at distance 2",
  );
  const blockingSeventh = block(
    "PH_NEUTRAL_OFF",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "min_distance_to_players", value: 2 },
        { name: "max_distance_to_players", value: 2 },
        { name: "find_closest" },
        { name: "actor_area", value: 5104 },
        { name: "actor_area_radius", value: 0 },
        { name: "avoid_actor_area", value: 5103 },
      ],
      terrain,
    ),
    "Blocking seventh villager: claims one remaining distance-2 tile",
  );
  const reserveComment =
    "/* Reserve the tiles at exactly distance 1 and 2 from the player, so the sheep and the six starting villagers below land in fixed, non-overlapping spots */";

  const sheepComment =
    "/* Eating sheep: the six villagers below gather on it right away */";
  const sheep = block(
    "PH_NEUTRAL_OFF",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "second_object", value: "HERDABLE_A" },
        { name: "set_gaia_object_only" },
        { name: "min_distance_to_players", value: 1 },
        { name: "max_distance_to_players", value: 1 },
        { name: "actor_area_radius", value: 1 },
        { name: "avoid_actor_area", value: 5100 },
        { name: "find_closest" },
        { name: "actor_area", value: 20 },
      ],
      terrain,
    ),
  );

  const villagerAttrs: Attr[] = [
    { name: "start_random" },
    { name: "percent_chance", value: 50 },
    { name: "second_object", value: "LAZY_MALE" },
    { name: "percent_chance", value: 50 },
    { name: "second_object", value: "LAZY_FEMALE" },
    { name: "end_random" },
    { name: "set_place_for_every_player" },
    { name: "min_distance_to_players", value: 1 },
    { name: "find_closest" },
    { name: "actor_area_to_place_in", value: 20 },
    { name: "actor_area", value: 2 },
    { name: "actor_area_radius", value: 0 },
    { name: "avoid_actor_area", value: 2 },
    { name: "avoid_actor_area", value: 5101 },
    { name: "avoid_actor_area", value: 5104 },
  ];
  const villagersComment =
    "/* Six villagers, each independently male or female, gathered on the sheep above */";
  const villagersOnSheep = Array.from({ length: 6 }, () =>
    block("PH_PLAYER_OFF", withTerrain(villagerAttrs, terrain)),
  ).join("\n");

  const stragglerTree = block(
    "THEMED_TREE1",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "find_closest" },
        { name: "actor_area", value: 11 },
        { name: "actor_area_radius", value: 1 },
        { name: "min_distance_to_players", value: 5 },
        { name: "max_distance_to_players", value: 8 },
      ],
      terrain,
    ),
    "Straggler tree: the three villagers below head there",
  );
  const villagersOnTree = block(
    "VILLAGER",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 3 },
        { name: "actor_area_to_place_in", value: 11 },
        { name: "place_on_forest_zone" },
        { name: "min_distance_to_players", value: 6 },
        { name: "max_distance_to_players", value: 8 },
      ],
      terrain,
    ),
  );
  const houses = block(
    "HOUSE",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 2 },
        { name: "find_closest" },
        { name: "max_distance_to_other_zones", value: 4 },
        { name: "avoid_forest_zone", value: 2 },
        { name: "min_distance_to_players", value: 8 },
        { name: "max_distance_to_players", value: 10 },
        { name: "min_distance_group_placement", value: 3 },
      ],
      terrain,
    ),
  );

  return [
    reserveComment,
    nearPositioner,
    "",
    villagerAvoider,
    "",
    farPositioner,
    "",
    blockingSeventh,
    "",
    sheepComment,
    sheep,
    "",
    villagersComment,
    villagersOnSheep,
    "",
    stragglerTree,
    "",
    villagersOnTree,
    "",
    houses,
  ];
}

export function renderStandardPlayerObjects(
  options: T1Options,
): RenderedTemplate {
  const { quickStart, advanced, terrainToPlaceOn: terrain } = options;
  const header = quickStart
    ? "/* Standard player objects (quick-start) */"
    : "/* Standard player objects */";

  const townCenter = block(
    "TOWN_CENTER",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "max_distance_to_players", value: 0 },
        { name: "min_distance_to_players", value: 0 },
      ],
      terrain,
    ),
  );
  const scout = block(
    "SCOUT",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "min_distance_to_players", value: 7 },
        { name: "max_distance_to_players", value: 9 },
      ],
      terrain,
    ),
  );

  // The header comment is always the block's first line, so the offset
  // right after it (plus the newline that follows) is always the start of
  // TOWN_CENTER's own line, a top-level line with no leading tab.
  const caretOffset = header.length + 1;

  if (!quickStart) {
    const villagers = block(
      "VILLAGER",
      withTerrain(
        [
          { name: "set_place_for_every_player" },
          { name: "number_of_objects", value: 3 },
          { name: "min_distance_to_players", value: 6 },
          { name: "max_distance_to_players", value: 6 },
        ],
        terrain,
      ),
    );
    const text = [header, townCenter, "", villagers, "", scout].join("\n");
    return { text, caretOffset };
  }

  const middle = advanced
    ? renderAdvancedQuickStart(terrain)
    : renderSimpleQuickStart(terrain);
  const text = [header, townCenter, "", ...middle, "", scout].join("\n");
  return { text, caretOffset };
}

// ---- T2 renderer ----------------------------------------------------------

function berryName(o: T2Options): string {
  return o.seasonal ? "BERRIES" : o.berryType;
}
// A distinct close-herdable name (guide/corpus convention: HERDABLE_A),
// see docs/object-templates-brief.md's Sec.2 T2 seasonal note.
function closeHerdName(o: T2Options): string {
  return o.seasonal ? "HERDABLE_A" : o.herdable;
}
function farHerdName(o: T2Options): string {
  return o.seasonal ? "HERDABLE" : o.herdable;
}
function huntName(o: T2Options): string {
  return o.seasonal ? "HUNTABLE" : o.huntable;
}
function lureName(o: T2Options): string {
  return o.seasonal ? "LURABLE" : o.lurable;
}

// Base numbers per docs/object-templates-brief.md Sec.2 T2, cross-checked
// against "TC2 - Comeer v1.4.rms" (Large/Small gold and stone blocks,
// same comment convention) and "AD4 - Pag - v1.2.rms" (close/far sheep).
export function renderStandardPlayerResources(
  options: T2Options,
): RenderedTemplate {
  const terrain = options.terrainToPlaceOn;

  const berries = block(
    berryName(options),
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 6 },
        { name: "set_tight_grouping" },
        { name: "min_distance_to_players", value: 10 },
        { name: "max_distance_to_players", value: 12 },
        { name: "min_distance_group_placement", value: 6 },
      ],
      terrain,
    ),
  );
  const largeGold = block(
    "GOLD",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 7 },
        { name: "set_tight_grouping" },
        { name: "min_distance_to_players", value: 12 },
        { name: "max_distance_to_players", value: 16 },
      ],
      terrain,
    ),
  );
  const largeStone = block(
    "STONE",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 5 },
        { name: "set_tight_grouping" },
        { name: "min_distance_to_players", value: 14 },
        { name: "max_distance_to_players", value: 18 },
      ],
      terrain,
    ),
  );
  const smallGold = block(
    "GOLD",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 4 },
        { name: "set_tight_grouping" },
        { name: "min_distance_to_players", value: 18 },
        { name: "max_distance_to_players", value: 26 },
      ],
      terrain,
    ),
  );
  const smallStone = block(
    "STONE",
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 4 },
        { name: "set_tight_grouping" },
        { name: "min_distance_to_players", value: 20 },
        { name: "max_distance_to_players", value: 26 },
      ],
      terrain,
    ),
  );
  const sheepClose = block(
    closeHerdName(options),
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 4 },
        { name: "number_of_groups", value: 1 },
        { name: "min_distance_to_players", value: 7 },
        { name: "max_distance_to_players", value: 9 },
      ],
      terrain,
    ),
  );
  const sheepFar = block(
    farHerdName(options),
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 2 },
        { name: "number_of_groups", value: 2 },
        { name: "min_distance_to_players", value: 14 },
        { name: "max_distance_to_players", value: 30 },
      ],
      terrain,
    ),
  );
  const deer = block(
    huntName(options),
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 4 },
        { name: "number_of_groups", value: 1 },
        { name: "set_loose_grouping" },
        { name: "min_distance_to_players", value: 14 },
        { name: "max_distance_to_players", value: 30 },
      ],
      terrain,
    ),
  );
  const boar = block(
    lureName(options),
    withTerrain(
      [
        { name: "set_place_for_every_player" },
        { name: "number_of_objects", value: 2 },
        { name: "number_of_groups", value: 2 },
        { name: "min_distance_to_players", value: 16 },
        { name: "max_distance_to_players", value: 22 },
      ],
      terrain,
    ),
  );

  const header = options.seasonal
    ? "/* Standard player resources (seasonal) */"
    : "/* Standard player resources */";
  // #include_drs is a directive, legal anywhere a command is (not only the
  // preamble); it splices in place, so it sits right above the block that
  // needs its HERDABLE/HUNTABLE/LURABLE/BERRIES consts.
  const lead = options.seasonal
    ? ["#include_drs F_seasons.inc", "", header]
    : [header];
  const caretOffset = lead.join("\n").length + 1;

  const text = [
    ...lead,
    berries,
    "",
    "/* Large gold */",
    largeGold,
    "",
    "/* Large stone */",
    largeStone,
    "",
    "/* Small gold */",
    smallGold,
    "",
    "/* Small stone */",
    smallStone,
    "",
    "/* Sheep */",
    sheepClose,
    "",
    sheepFar,
    "",
    "/* Deer */",
    deer,
    "",
    "/* Boar */",
    boar,
  ].join("\n");
  return { text, caretOffset };
}

// ---- T3 renderer ----------------------------------------------------------

// Base per docs/object-templates-brief.md Sec.2 T3, revised against
// "AK_Hourglass_v2.0.rms" lines ~1648-1690 ("Water Res" / "Tuna everywhere"),
// the maximal-placement idiom this session confirmed across the corpus
// (`number_of_groups 4056`, e.g. "Venn.rms":960-962, "AK_Vanguard_v1.2.rms":
// 1206-1234 — a deliberately oversized group count the engine clamps to
// whatever the map actually fits, so it reads as "as many as there's room
// for" rather than a real target). Standard water res is gaia and spread
// across the whole map, not per player, so none of these four blocks
// carries set_place_for_every_player. TUNA (not FISH_PERCH, the brief's own
// guess) is the corpus's actual common deep fish. No terrain_to_place_on on
// any water block: fish, oysters and whales only ever spawn on water in the
// engine, so naming a water terrain adds nothing and would exclude the
// other water depths.
export function renderStandardWaterResources(
  options: T3Options,
): RenderedTemplate {
  const header = "/* Standard water resources */";
  const shoreFish = block("SHORE_FISH", [
    { name: "number_of_groups", value: 4056 },
    { name: "set_scaling_to_map_size" },
    { name: "temp_min_distance_group_placement", value: 6 },
    { name: "set_gaia_object_only" },
  ]);
  const deepFish = block("TUNA", [
    { name: "number_of_groups", value: 4056 },
    { name: "set_scaling_to_map_size" },
    { name: "temp_min_distance_group_placement", value: 8 },
    // Keeps tuna off water right at a shoreline, tighter than the deep
    // water it's meant to fill.
    { name: "max_distance_to_other_zones", value: 4 },
    { name: "set_gaia_object_only" },
  ]);

  const caretOffset = header.length + 1;
  const parts = [header, shoreFish, "", deepFish];

  if (options.oysters) {
    const oysters = block("OYSTERS", [
      { name: "number_of_groups", value: 4056 },
      { name: "set_scaling_to_map_size" },
      // Wider than tuna's 8: an oyster bed is a bigger prize and shouldn't
      // crowd its neighbors as tightly as a single tuna spawn does.
      { name: "temp_min_distance_group_placement", value: 12 },
      { name: "set_gaia_object_only" },
    ]);
    parts.push("", oysters);
  }

  if (options.whales) {
    // WHALE resolves as a built-in, game-constants.json carries it as an
    // objectAlias row for id 2625 (the guide's changelog lists the object
    // by id only, which is what made an earlier cut think no name existed;
    // the object row's own rmsConstant is null, the alias row is where the
    // name lives). A whale is a 2x2 gold pickup that lives in deep water.
    const whaleComment = "/* Whales, a 2x2 gold pickup in deep water */";
    const whale = block("WHALE", [
      { name: "number_of_groups", value: 4056 },
      { name: "set_scaling_to_map_size" },
      // Widest spacing of the four: whales are the biggest, rarest prize.
      { name: "temp_min_distance_group_placement", value: 16 },
      { name: "set_gaia_object_only" },
    ]);
    parts.push("", whaleComment, whale);
  }

  return { text: parts.join("\n"), caretOffset };
}

// ---- Player forests, shared -----------------------------------------------

/**
 * The slice of a game-constants.json row the option lists read. Structural
 * so the dialog can pass Breakdown's own typed view straight in; that view
 * does not declare isForest or classId, but the rows carry them at runtime
 * and an optional field that is absent just reads as undefined.
 */
export interface TemplateConstant {
  rmsConstant?: string | null;
  category?: string | null;
  descriptiveName?: string | null;
  isForest?: boolean;
  classId?: number;
}

export interface NamedOption {
  value: string;
  label: string;
}

// Built from reference data rather than typed out here, so a forest terrain
// or tree the data gains later shows up without touching this file. Rows
// with no rmsConstant are left out, an option list offers names only.
export function forestTerrainOptions(
  constants: readonly TemplateConstant[],
): NamedOption[] {
  return namedOptions(
    constants.filter((c) => c.category === "terrain" && c.isForest === true),
  );
}

// classId 15 is the dat's tree class. It includes felled trees, which are
// real placeable objects, so they stay in the list.
export function treeOptions(
  constants: readonly TemplateConstant[],
): NamedOption[] {
  return namedOptions(
    constants.filter((c) => c.category === "object" && c.classId === 15),
  );
}

function namedOptions(rows: readonly TemplateConstant[]): NamedOption[] {
  const seen = new Set<string>();
  const out: NamedOption[] = [];
  for (const row of rows) {
    const name = row.rmsConstant;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      value: name,
      label: row.descriptiveName ? `${row.descriptiveName} (${name})` : name,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function isWholeNumber(s: string): boolean {
  return /^\d+$/.test(s);
}

function isPositiveWholeNumber(s: string): boolean {
  return isWholeNumber(s) && Number(s) > 0;
}

/**
 * A name or a bare id, the two forms a terrain or object argument takes.
 * A name can be a built-in or the script's own #const, which is what the
 * Custom… entries in the forest dropdowns are for.
 */
export function isNameOrId(s: string): boolean {
  return isValidIdentifier(s) || isWholeNumber(s);
}

function repeat(line: string, times: number): string[] {
  return Array.from({ length: times }, () => line);
}

// ---- T4: Player forests (objects) ------------------------------------------

/** The #const name the setup lines define and the create_object places. */
export const FOREST_MAKER_CONST = "MAKE_FOREST_TERRAIN";

// Numeric fields are held as the text the user typed, not as numbers, so a
// half-typed value ("1" on the way to "17") round-trips through the input
// untouched and the problems list below decides whether Insert is allowed.
// Parsing to a number on every keystroke would turn "" into 0 and fight the
// user's cursor.
export interface T4Options {
  standInId: string;
  forestTerrain: string;
  tree: string;
  forestsPerPlayer: string;
  treesPerForest: string;
  minDistance: string;
  maxDistance: string;
  terrainToPlaceOn: string;
}

// 1639 is the id every corpus map using this idiom picked (BCC2-Rekawa,
// Chaotic Strait, Vanguard, all one author), a "Monument resources enabler"
// in the dat. The distances and counts match the terrain template's
// defaults, which come from AK_Vanguard_v1.2.rms.
export const T4_DEFAULTS: T4Options = {
  standInId: "1639",
  forestTerrain: "FOREST",
  tree: "OAKTREE",
  forestsPerPlayer: "3",
  treesPerForest: "20",
  minDistance: "13",
  maxDistance: "17",
  terrainToPlaceOn: "",
};

export interface T4Context {
  /**
   * The script already defines MAKE_FOREST_TERRAIN, from an earlier insert
   * of this template or by hand. Its PLAYER_SETUP lines are left alone and
   * only the create_object goes in, since a second `#const` of the same
   * name is ignored by the engine (first definition wins) and would only
   * mislead.
   */
  setupPresent: boolean;
}

/** Why Insert is unavailable, one plain sentence per problem, empty when it is fine. */
export function playerForestsObjectsProblems(
  o: T4Options,
  context: T4Context,
): string[] {
  const problems: string[] = [];
  if (!context.setupPresent && !isWholeNumber(o.standInId))
    problems.push("The stand-in object id has to be a whole number.");
  if (!context.setupPresent && !isNameOrId(o.forestTerrain))
    problems.push("The forest terrain has to be a single name or id.");
  if (!isNameOrId(o.tree))
    problems.push("The tree has to be a single name or id.");
  if (!isPositiveWholeNumber(o.forestsPerPlayer))
    problems.push("Forests per player has to be a whole number above 0.");
  if (!isPositiveWholeNumber(o.treesPerForest))
    problems.push("Trees per forest has to be a whole number above 0.");
  if (!isWholeNumber(o.minDistance) || !isWholeNumber(o.maxDistance))
    problems.push("Both distances have to be whole numbers.");
  else if (Number(o.minDistance) > Number(o.maxDistance))
    problems.push("The minimum distance can't be larger than the maximum.");
  if (o.terrainToPlaceOn !== "" && !isValidIdentifier(o.terrainToPlaceOn))
    problems.push("Terrain to place on has to be a single name.");
  return problems;
}

// The idiom from BCC2-Rekawa.rms (lines 63-101, 1058) and
// Chaotic_Straitv0.99.rms (41-94, 786). A spare object is reshaped before
// generation so that wherever it is placed, the tile under it becomes forest
// terrain, and a real tree is shown on top with second_object. The reason
// to prefer it over plain tree objects is what is left after the tree is
// chopped. Forest terrain stays forest, so a building can't then sit on
// ground that was never meant to be buildable.
//
// effect_amount with 0.5 rather than the corpus's `effect_percent ... 50`.
// language.json marks effect_percent deprecated in favour of effect_amount
// (validate() reports RMS0310 on it), and effect_percent's own definition is
// the value divided by 100, so the two say the same thing.
export function renderPlayerForestsObjects(
  o: T4Options,
  context: T4Context,
): RenderedTemplate {
  const header = "/* Player forests */";
  const maker = FOREST_MAKER_CONST;
  const forest = block(
    maker,
    withTerrain(
      [
        { name: "second_object", value: o.tree },
        { name: "set_place_for_every_player" },
        { name: "set_gaia_object_only" },
        { name: "set_gaia_unconvertible" },
        { name: "number_of_objects", value: o.treesPerForest },
        { name: "number_of_groups", value: o.forestsPerPlayer },
        // Tight packs each forest into a solid block. set_loose_grouping
        // with group_placement_radius scatters it into a grove instead,
        // which is what BCC2-Rekawa does.
        { name: "set_tight_grouping" },
        { name: "set_circular_placement" },
        { name: "min_distance_to_players", value: o.minDistance },
        { name: "max_distance_to_players", value: o.maxDistance },
        // Keeps a player's forests apart from each other.
        { name: "temp_min_distance_group_placement", value: 9 },
      ],
      o.terrainToPlaceOn,
    ),
    "each one turns its tile into forest, see PLAYER_SETUP",
  );
  const text = [header, forest].join("\n");
  const caretOffset = header.length + 1;
  if (context.setupPresent) return { text, caretOffset };

  const setupText = [
    `/* Player forests. Every ${maker} placed turns its tile into forest terrain */`,
    `#const ${maker} ${o.standInId}`,
    "/* Remove the stand-in at game start. The tree placed with it through second_object stays */",
    `effect_amount SET_ATTRIBUTE ${maker} ATTR_HITPOINTS 0`,
    "/* Shrink it to a single tile */",
    `effect_amount SET_ATTRIBUTE ${maker} ATTR_RADIUS_1 0.5`,
    `effect_amount SET_ATTRIBUTE ${maker} ATTR_RADIUS_2 0.5`,
    "/* Paint forest terrain under it */",
    `effect_amount SET_ATTRIBUTE ${maker} ATTR_FOUNDATION_TERRAIN ${o.forestTerrain}`,
  ].join("\n");
  return { text, caretOffset, setupText };
}

// ---- T5: Player forests (terrain) -------------------------------------------

export interface T5Options {
  /** The terrain create_player_lands paints, imported from the script and overridable. */
  playerLand: string;
  forestTerrain: string;
  forestTiles: string;
  forestClumps: string;
  minDistance: string;
  maxDistance: string;
}

// From AK_Vanguard_v1.2.rms's PL_TOTAL_FOREST_TILES, PL_FOREST_CLUMPS,
// PL_FOREST_MIN_DIST and PL_FOREST_MAX_DIST. playerLand starts empty, the
// dialog fills it from the script.
export const T5_DEFAULTS: T5Options = {
  playerLand: "",
  forestTerrain: "FOREST",
  forestTiles: "60",
  forestClumps: "3",
  minDistance: "13",
  maxDistance: "17",
};

export function playerForestsTerrainProblems(o: T5Options): string[] {
  const problems: string[] = [];
  if (o.playerLand === "")
    problems.push(
      "Enter the player land terrain. No create_player_lands with a terrain_type was found to take it from.",
    );
  else if (!isNameOrId(o.playerLand))
    problems.push("The player land terrain has to be a single name or id.");
  if (!isNameOrId(o.forestTerrain))
    problems.push("The forest terrain has to be a single name or id.");
  if (!isPositiveWholeNumber(o.forestTiles))
    problems.push("Forest tiles has to be a whole number above 0.");
  if (!isPositiveWholeNumber(o.forestClumps))
    problems.push("Forest clumps has to be a whole number above 0.");
  if (!isWholeNumber(o.minDistance) || !isWholeNumber(o.maxDistance))
    problems.push("Both distances have to be whole numbers.");
  else if (Number(o.minDistance) >= Number(o.maxDistance))
    problems.push(
      "The minimum distance has to be smaller than the maximum, or there is no room for a forest.",
    );
  return problems;
}

/** Eight players plus the two spares AK_Vanguard_v1.2.rms keeps. */
export const T5_ROUNDS = 10;

// AK_Vanguard_v1.2.rms lines 957-1105, reduced to its moving parts, with the
// forest painted straight into the final forest terrain rather than into a
// marker terrain that tree objects fill later.
//
// The trick is `number_of_clumps 1` with `land_percent 100`. One clump grows
// through connected tiles of its base terrain only, so it claims exactly one
// player's land when the lands don't touch. The forest goes into that
// claimed land, and what is left is set aside so the next round can only
// find a different player. Setting aside the land past the maximum distance
// first is what keeps the forest within range, and it also splits apart
// player lands that touch further out.
//
// Two scratch terrains rather than Vanguard's three. Land past the maximum
// distance and land a round has finished with only need to be "not player
// land" until the end, so they share one terrain and one restore pass.
// Terrain 84 is Namatjira's REPLACE_A and 68 is Vanguard's TEMP_TERRAIN,
// the two ids the corpus has actually run through create_terrain.
//
// The repeated fills are deliberate. A single land_percent 100 fill can leave
// tiles behind, so the corpus issues the same command several times. The
// counts follow AK_Namatjira.rms (ten for the set-aside pass, six elsewhere).
export function renderPlayerForestsTerrain(o: T5Options): RenderedTemplate {
  const header = "/* Player forests */";
  const intro =
    "/* Each round claims one player's land, grows that player's forest in it and sets the rest aside, so the next round finds another player. A round with no player land left does nothing. Player lands that touch within the maximum distance share one round and one forest */";
  const consts = [
    `#const PLAYER_FOREST_LAND ${o.playerLand}`,
    `#const PLAYER_FOREST_TILES ${o.forestTiles}`,
    `#const PLAYER_FOREST_CLUMPS ${o.forestClumps}`,
    `#const PLAYER_FOREST_MIN_DISTANCE ${o.minDistance}`,
    `#const PLAYER_FOREST_MAX_DISTANCE ${o.maxDistance}`,
    "/* Scratch terrains, change these if the script already uses terrain 84 or 68 */",
    "#const PLAYER_FOREST_SCRATCH 84",
    "#const PLAYER_FOREST_SET_ASIDE 68",
  ];

  const setAside = repeat(
    "create_terrain PLAYER_FOREST_SET_ASIDE { base_terrain PLAYER_FOREST_LAND land_percent 100 number_of_clumps 9999 set_avoid_player_start_areas PLAYER_FOREST_MAX_DISTANCE }",
    10,
  );

  const rounds: string[] = [];
  for (let i = 1; i <= T5_ROUNDS; i++) {
    rounds.push(
      "",
      i <= 8 ? `/* Round ${i} */` : `/* Spare round ${i - 8} */`,
      "create_terrain PLAYER_FOREST_SCRATCH { base_terrain PLAYER_FOREST_LAND land_percent 100 number_of_clumps 1 }",
      `create_terrain ${o.forestTerrain} { base_terrain PLAYER_FOREST_SCRATCH number_of_tiles PLAYER_FOREST_TILES number_of_clumps PLAYER_FOREST_CLUMPS set_avoid_player_start_areas PLAYER_FOREST_MIN_DISTANCE }`,
      ...repeat(
        "create_terrain PLAYER_FOREST_SET_ASIDE { base_terrain PLAYER_FOREST_SCRATCH land_percent 100 number_of_clumps 9999 }",
        6,
      ),
    );
  }

  const restore = repeat(
    "create_terrain PLAYER_FOREST_LAND { base_terrain PLAYER_FOREST_SET_ASIDE land_percent 100 number_of_clumps 9999 }",
    6,
  );

  const lead = [header, intro];
  // The caret lands on the first #const, the block's first real item.
  const caretOffset = lead.join("\n").length + 1;
  const text = [
    ...lead,
    ...consts,
    "",
    "/* Set aside player land past the maximum distance */",
    ...setAside,
    ...rounds,
    "",
    "/* Turn everything set aside back into player land */",
    ...restore,
  ].join("\n");
  return { text, caretOffset };
}
