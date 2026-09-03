/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: reference/schemas/game-constants.schema.json
 * Regenerate: npm run generate:types   (drift is a CI failure: `npm run check:generated-types`)
 *
 * The published shape of reference/data/game-constants.json, as an Advanced
 * Tool receives it in `ToolContext.referenceData.gameConstants`. It is
 * generated so that it cannot lag the schema: a hand-written copy compiles
 * happily on the day the schema gains a field, which is the one property this
 * type exists to have (tools-api-design.md Sec.2).
 *
 * Consequences worth knowing before consuming it, all of them the schema's own:
 *  - `rmsConstant` is NULLABLE and on most rows it IS null — 2137 of 3011 rows
 *    are roster objects with no RMS name.
 *  - `category` is a union READ OUT OF THE SCHEMA, never transcribed; it has
 *    gained a member twice.
 *  - only rmsConstant/descriptiveName/category/verified are required. Every
 *    other field is optional, and absent means "never measured", which is not
 *    the same claim as a false or a null.
 *  - expect fields no consumer has heard of and do NOT prune them: `isTree`
 *    exists with no data row yet, and `isCorpse` is written only when true.
 */

export interface PublishedGameConstant {
  /**
   * The internal DE numeric ID for this terrain/object. Null until confirmed. Do not guess this value. It must come from the game's data files or a trusted community dump, not general knowledge.
   */
  constId?: number | null;
  /**
   * Provenance of constId. 'extracted' = read from the game's own random_map.def by tools/extract-constants; 'patch-notes' = taken from a dated official patch note. Consumed by the parser's RMS0204/RMS0205 message gating (parser-design Sec.6), which only uses resolved-ID wording when provenance is trusted. Absent means unknown provenance - do not backfill by hand.
   */
  idSource?: "extracted" | "patch-notes";
  /**
   * The exact identifier used in RMS scripts, e.g. GRASS, GOLD. NULL for the terrains that have no callable constant at all — of the 131 DE terrains only 78 are named, and a script reaches the rest by writing the bare id (terrain_type 26) or defining its own #const. Null therefore means 'this terrain exists and can be placed, just not by name', which is different information from an absent entry, and every name lookup must simply fail to match it rather than treat it as a wildcard.
   */
  rmsConstant: string | null;
  /**
   * Human-readable name for the reference table UI, e.g. "Grass 1", "Gold Mine".
   */
  descriptiveName: string;
  /**
   * Free-text note for the reference table's Description column, transcribed from the community reference spreadsheets in reference-docs/ — Zetnus's 'AoE2 Terrains' Comments column for terrain rows (all 131 covered), and 'Definitive Constants List''s per-sheet Comments/Description columns for object rows ('DE only' preferred when it disagrees with 'Animals'/'Resources', since it is consistently the more complete of the two; 668 of 2670 object rows covered — the rest are gaia roster entries, mostly carcasses and blood decals, the community table never annotates). Like isWater/isForest/beachTerrain above, this is a one-time transcription rather than something tools/extract-constants derives from a local install, so the script only has to carry it through (CONSTANT_KEY_ORDER). Null means the community table has no comment for this constant, not that there is nothing to say — same positive-resolver caveat as the rest of this file.
   */
  description?: string | null;
  /**
   * objectClass rows are genie unit classes, which an RMS author can target directly (effect_amount SET_ATTRIBUTE TREE_CLASS ...). They live in this array rather than a separate one because a class IS an RMS constant, so every consumer that resolves a written name against constants[] picks them up unchanged. The fourteen categories from mapType through magicNumber are the families tools/extract-constants reads from random_map.def and includes/constants.inc but does NOT (and must not) join against empires2_x2_p1.dat: mapType (ai_info_map_type's argument, e.g. ARABIA, ARENA), civilization (set_gaia_civilization's argument; carries both random_map.def's American CIVILIZATION_* spelling and constants.inc's British CIVILISATION_* spelling as separate rows, since both are independently writable identifiers), waterDefinition (water_definition's argument, WD_*), colorCorrection (color_correction's argument, CC_*; random_map.def's own section header calls this family 'SEASON TYPES'), cliffType (cliff_type's argument, CT_*), assignTarget (assign_to's argument, AT_*), terrainAlias (a second, legacy naming scheme for terrain ids read from constants.inc's TERRAIN_CONSTANTS/PLACEHOLDER_TERRAINS sections — e.g. GRASS_A, DIRT_A — distinct from the dat-verified terrain rows above), objectAlias (the same for unit/building/decoration ids, from constants.inc's REGULAR_UNITS/SPECIAL_UNITS/ANIMAL_OBJCETS/REGULAR_BUILDINGS/SPECIAL_BUILDINGS/AESTHETIC_OBJECTS/RESOURCE_CONSTANTS/UTILITY_CONSTANTS sections), effectAction (random_map.def's own 'Effect Constants' section — the value for effect_amount/effect_percent's first argument, e.g. SET_ATTRIBUTE, GAIA_MODIFY_TECH), effectFlag (random_map.def's 'Effect Type Constants' section — ATTR_DISABLE/ATTR_ENABLE/etc., a value written into effect_amount's third argument for specific effectAction values such as ENABLE_OBJECT; the shared ATTR_ prefix is the file's own naming convention and does not make these attribute rows), modifyTechAttribute (random_map.def's 'ModifyTech Constants' section — the third-argument value when effectAction is MODIFY_TECH/GAIA_MODIFY_TECH), playerDataAttribute (random_map.def's 'PlayerData Constants' section — the third-argument value when effectAction is SET_PLAYER_DATA/GAIA_SET_PLAYER_DATA), resourceAmountType (random_map.def's 'ResourceAmount Constants' section, AMOUNT_* — the third-argument value for several effectAction values, most directly SET_TECH_COST/ADD_TECH_COST), and magicNumber (random_map.def's own 'Magic Number Constants' section — currently just RANDOM_OBJECT; the file gives this family no further documentation, so nothing beyond the name and id is claimed here). The hard constraint on all fourteen: their numeric ids are NOT unique across families or against terrain/object ids (id 61 is simultaneously a dolphin, DLC_JUNGLEROAD and ATTR_CHARGE_EVENT; RICE_FARM is independently defined twice inside constants.inc itself, once as a terrain id and once as an object id), so a row in one of these fourteen categories is a name -> id pair sourced from the game's own definitions and nothing more — never a claim about what kind of engine record that id resolves to.
   */
  category:
    | "terrain"
    | "object"
    | "objectClass"
    | "attribute"
    | "mapType"
    | "civilization"
    | "waterDefinition"
    | "colorCorrection"
    | "cliffType"
    | "assignTarget"
    | "terrainAlias"
    | "objectAlias"
    | "effectAction"
    | "effectFlag"
    | "modifyTechAttribute"
    | "playerDataAttribute"
    | "resourceAmountType"
    | "magicNumber";
  /**
   * DE texture filename shown in the reference table (e.g. g_grs). Null until confirmed.
   */
  deTextureFile?: string | null;
  /**
   * Terrain entries only. True when the terrain is water for placement purposes: the community DE table lists it as buildable only by water buildings, or as passable only by ships. Discharges preview-design Sec.12 item 6, which recorded the dat's own is_water as an undecoded bitfield and named a /WATER/ name heuristic as the interim fallback. The heuristic cannot see the 53 unnamed terrains at all and misreads named ones in both directions (YELLOW_SHALLOW_WATER is water and matches; DLC_MANGROVESHALLOW is walkable, buildable land and does not). Absent means unknown, and the name heuristic still applies.
   */
  isWater?: boolean;
  /**
   * Terrain entries only. True for the tree-bearing terrains, taken from the community DE table's own descriptive name (every one of the 24 is named "Forest, ..."). Feeds the forest-zone mask that place_on_forest_zone reads. The /FOREST|JUNGLE|BAMBOO/ name heuristic it replaces missed every unnamed forest, including "Forest, Oak Bush" and "Forest, Bush". Note underbrush terrains are deliberately NOT forest: they are the ground a forest is drawn on, not the treeline. Absent means unknown, and the name heuristic still applies.
   */
  isForest?: boolean;
  /**
   * Terrain entries only. The units the engine spawns automatically the instant this terrain paints a tile, no create_object involved — the dat's own terrain_unit_id/terrain_unit_density slots (tools/extract-constants --terrain-units), first-hit-wins down the slot list for a multi-slot terrain (P(slot i) = density_i * product of (1 - density_j) for j < i). Only slots whose unit carries a nonzero resourceAmounts.wood are written; cosmetic (0-wood) slots are dropped at extraction time, which is also why a terrain can be isForest: true and still carry no wood-bearing slot here (it would not, in practice, since the 24 isForest rows are exactly the 24 rows this field is nonempty on). Absent means 'not known', not 'no trees' — read together with isForest: true, absence is read as one implicit slot at density 1.0 and the spawned unit's default 100 wood (Ash's stated foundational default: 100 wood per tree, 100% density, true for 15 of the 24 rows outright). A script can suppress a slot at runtime via effect_amount (GAIA_)SET_ATTRIBUTE <unit> ATTR_TERRAIN_ID <n> retargeting the unit off this terrain — see terrainRestrictions at the top level, which resolves what restriction n excludes.
   */
  autoTreeUnits?: {
    /**
     * The spawned unit's constId (an object row's own constId, category: object). NOT the unit's rmsConstant: two of the wood-bearing spawn units in this table (constId 302 'Bush A' and constId 1350 'Tree Reeds') carry rmsConstant: null, the same 'exists, just not callable by name' case the terrain rows themselves already document — so the id is the only field guaranteed to resolve for every slot, and it is also what the suppression scan compares a resolved script target against (objectEntry(...).constId), never a name.
     */
    objectId: number;
    /**
     * Normalised 0-1 (the dat's terrain_unit_density is per-mille, calibrated against three prose figures already in description and confirmed to fit all three exactly: DLC_BAOBABFOREST 25% -> 250, DLC_ACACIAFOREST 50% -> 500, DLC_MANGROVEFOREST 80% -> 800).
     */
    density: number;
  }[];
  /**
   * Terrain entries only. True for the shallows — terrain that BOTH land units and ships can cross, so it is neither land nor open water but sits between them. Taken from the community DE table's own 'Unit Pathing' column, which reads 'all' on exactly 24 rows; the nine beach terrains and the five rice farms are removed, leaving these ten: 4 SHALLOW, 26 Ice Navigable, 54 DLC_MANGROVESHALLOW, 55 DLC_MANGROVEFOREST, 59 DLC_NEWSHALLOW, 90 Forest Reeds (Shallows), 93 and 94 Moddable Walkable Shallows, 111 MUDDY_SHALLOW, 115 YELLOW_SHALLOW. A beach terrain is removed because it is what this rule PRODUCES rather than a thing it edges, and a rice farm because 'both can path it' describes farmland without making it wet. It is ORTHOGONAL to isWater and does not restate it: isWater still answers the placement question every other stage asks (a shallow is water you cannot build a house on), while isHybrid answers the depth question only the automatic-beach rule asks, and the two disagree in both directions — SHALLOW is water and hybrid, DLC_MANGROVESHALLOW is hybrid and not water. The two forests in the set (55, 90) are a flagged judgment call: both are named as growing out of a shallow rather than out of dry ground, so they are edged as shallows. There is no name heuristic for absence, unlike isWater and isForest: YELLOW_SHALLOW is hybrid and YELLOW_SHALLOW_WATER is open water, so no pattern separates them, and every one of the 131 rows carries this field explicitly. Absent therefore means a terrain the table has never covered, and such a terrain is treated as not hybrid, which leaves it behaving exactly as it did before the field existed.
   */
  isHybrid?: boolean;
  /**
   * Terrain entries only. True for the beach terrains themselves — the sand a coastline is made of, as opposed to the ground on either side of it. Taken from the community DE table's 'Building Allowed' column, whose value 'walls only' selects exactly nine rows and nothing else: 2 BEACH, 37 ICYSHORE, 51 DLC_BEACH2, 52 DLC_BEACH3, 53 DLC_BEACH4, 91 DLC_REEDSBEACH, 107 DLC_WETBEACH, 108 DLC_GRAVELBEACH, 109 DLC_WETROCKBEACH. The same nine are the rows whose own beachTerrain is null, since a beach does not grow a beach, but that is a consequence rather than the derivation — this field is read where the question is 'is this tile sand', not 'what sand would this tile grow'. Read by the 'shore' habitat, which means open water touching a beach. Absent means a terrain the table has never covered and is treated as not beach.
   */
  isBeach?: boolean;
  /**
   * Terrain entries only. The terrain id the engine automatically writes onto a tile of THIS terrain when it borders anything deeper than itself, or null when this terrain never grows a beach. Not an RMS command — it is engine behaviour that runs whether or not a script asks for it, and create_terrain's own beach_terrain attribute overrides it for that command's tiles (guide:1483, whose stated default of BEACH is this field). Derived from the community DE table (Zetnus, 'AoE2 Terrains', reference-docs/) by four of its own columns: the beach terrains themselves (Building Allowed 'walls only', or a Descriptive Name starting 'Beach') are null, since a beach does not grow a beach and the guide's beach_terrain DLC_BEACH2 example would otherwise be a no-op; the four terrains whose Comments read 'no beaches' (15, 27, 28, 36) are null; open water is null; snowy and icy terrains take 37 (ICYSHORE, whose row reads 'created when snowy terrains border water'); everything else takes 2 (BEACH, 'automatically placed when land terrains border water'). THE SHALLOWS ARE NOT WATER FOR THIS FIELD. All ten isHybrid rows carry a beach, because a shallow borders open water on its far side and the boundary is edged there too — the seven that had null (4, 59, 90, 93, 94, 111, 115) had it only because the first derivation pass read their isWater flag and stopped. ONE EXTRAPOLATION, flagged: only ids 32/33/34 carry the explicit 'icy beach when bordering water' annotation, and the other thirteen snow/ice terrains are matched on the table's own Descriptive Name and Comments text against that ICYSHORE row's phrase 'snowy terrains'. Absent means unknown and the generator falls back to BEACH for anything that is not open water, which is what 88 of the 131 rows say anyway.
   */
  beachTerrain?: number | null;
  /**
   * Terrain fill colour for the preview's GAME mode (the default), as [r, g, b] 0-255. The mean colour of the terrain's own texture, averaged over the opaque texels of resources/_common/terrain/textures/<deTextureFile>.dds by tools/extract-constants. Distinguishes every terrain that has its own texture, including snow; terrains sharing a texture file (FOREST/LEAVES both g_for, DESERT/PALM_DESERT both g_pal) necessarily share a colour, which is what minimapColor separates. Terrain entries only; absent means the extraction could not read the texture, and the renderer falls back to a hash colour rather than guessing.
   *
   * @minItems 3
   * @maxItems 3
   */
  previewColor?: [number, number, number];
  /**
   * Terrain fill colour for the preview's MINIMAP mode, as [r, g, b] 0-255. The dat's own Terrain.colors[0] decoded through resources/_common/palettes/original.pal (that field holds palette indices, not RGB). KNOWN COARSENESS, measured 2026-08-05: across the 131 enabled terrain records this field takes only 12 distinct values — it is a legacy colour class, so every snow variant carries grass's green and minimap mode genuinely draws snow as grass. That is the data reported faithfully, not a bug, and it is why previewColor is the default. It does separate terrains previewColor cannot (FOREST dark green vs LEAVES grass green). Terrain entries only; absent means the palette or dat could not be read.
   *
   * @minItems 3
   * @maxItems 3
   */
  minimapColor?: [number, number, number];
  /**
   * Object entries only. The dat's own Unit.terrain_restriction — the index of the row in DatFile.terrain_restrictions that decides which terrains this object may stand on. It is a KEY INTO THE GAME'S OWN TABLE and resolves to nothing outside an install: as of 2026-08-12 this id is USUALLY ALL THERE IS, because 4.10 stripped the expanded allowedTerrains from roster rows as a pure function of it (1.33 MB), and reference/ carries no expansion table to re-derive it from. 2666 rows carry the id, 31 carry allowedTerrains beside it. The id is what makes two objects sharing a restriction visibly the same claim rather than two coincidentally equal lists (every ordinary fish is restriction 19, most land objects are restriction 7). Written by tools/extract-constants --terrain-table. Absent means the object was never read out of a dat, which is different from an object the engine leaves unrestricted (that is restriction 0, written explicitly).
   */
  terrainRestrictionId?: number;
  /**
   * Object entries only. The terrain ids this object's restriction row permits, expanded from that row's passable_buildable_dmg_multiplier (131 floats, > 0 meaning permitted). This is the engine's real answer to 'where may this object stand', and habitat is a five-value approximation of it — the two are kept side by side deliberately, so the cost of the vocabulary can be measured rather than argued: restriction 8 (GOLD/STONE/FORAGE) permits 83 terrains while the 'land' class covers 110, so 27 terrains the engine refuses are terrain the preview still uses. PRESENT ON 31 OBJECT ROWS ONLY, NOT ON THE ROSTER — 4.10 stripped it from roster rows on 2026-08-12 as a derivable 1.33 MB, so absence here means 'expand terrainRestrictionId yourself', NOT 'unrestricted' and NOT 'never read out of a dat'. The 31 survivors are the 4.7-era hand-set family (GOLD, STONE, FORAGE, DEER, BOAR, SHEEP, WOLF, RELIC, the fish, TRANSPORT_SHIP, TOWN_CENTER), which is disproportionately what scripts place. NOTHING READS THIS FIELD TODAY. It exists so that whoever retires the coarse classes does it on evidence, and so the Generation Consistency Checker can answer terrain questions exactly rather than approximately — that tool's design (docs/consistency-checker-design.md Sec.2, Sec.9) reads it per row and widens automatically if a 32x131 restriction table is ever added. An empty array would mean a row permitting nothing, which no shipped row does.
   */
  allowedTerrains?: number[];
  /**
   * Object entries only. The dat's Unit.placement_side_terrain, a two-slot 'must sit BESIDE one of these terrains' requirement. -1 in a slot means no requirement, so [-1, -1] is the ordinary case and is written EXPLICITLY rather than omitted — absence has to keep meaning 'never extracted', because a silently missing requirement and a measured absence of one are different claims. Exactly three families in the object namespace carry a real value and all carry [2, 35] (Beach or Ice): SHORE_FISH, DLC_BOXTURTLE and DOCK. This field plus a water-shaped allowedTerrains IS the preview's 'shore' habitat rather than an approximation of it. The DOCK family carries the same pair over an amphibious-shaped row, which no habitat class can express; --terrain-table reports that case instead of widening the class to fit.
   *
   * @minItems 2
   * @maxItems 2
   */
  placementSideTerrain?: [number, number];
  /**
   * Object entries only. Where this object may be placed, the preview's coarse stand-in for the engine's terrain table (a per-object terrain-restriction id indexing a per-restriction row of allowed terrains). 'water' means OPEN WATER ONLY and 'amphibious' adds the shallows and the beaches — the dat's own split, where restriction 19 (every ordinary fish) permits 15 terrains with no shallow and no beach while restrictions 13/3/15 (great fish, OYSTERS, TRANSPORT_SHIP) permit 38 including both. A fish cannot stand on a shallow; maps that appear to place one there use guide:2211's placeholder bypass, where an unrestricted main object carries terrain_to_place_on and the fish rides in as second_object. 'shore' means OPEN WATER TOUCHING A BEACH — a water tile, not a beach tile and not a shallow, orthogonally adjacent to one of the nine isBeach terrains. Both of the objects that use it stand there: SHORE_FISH and DLC_BOXTURTLE are one family, which guide:4991 states outright by glossing MELKARYBA as "small fish, ie. shore fish or box turtles". It was previously read as the waterline within one tile on either side, which put both of them on the sand as often as in the water. 'amphibious' is guide:4717's own word for the OYSTERS class. Absent means unknown, and the generator falls back to 'land': the reference data knows a couple of dozen objects of several hundred, so an 'unrestricted' fallback put trees in open water on real maps — and note the 'land' fallback has its own cost, which is why the ocean-fish rows below exist at all. Note a script can rewrite the real table at runtime with effect_amount SET_ATTRIBUTE <object> ATTR_TERRAIN_ID <n>, which this field cannot express and the preview does not model.
   */
  habitat?: "land" | "water" | "amphibious" | "shore" | "any";
  /**
   * Object entries only, written only when true. Some other unit in the roster dies or bleeds into this one, per the dat's own dead_unit_id/blood_unit_id links, so it is a carcass or a blood decal rather than something an author places. The reference table's Objects tab hides these unless asked, which is the only reason the field exists: 336 of the 2642 gaia units are death variants, and a roster listing that offers them alongside DEER is a list nobody can read. It is a LINK, not a label — Unit.type cannot express this, since 329 of the 336 share type 30 with DEER, SHEEP and WOLF, and a name pattern on the '_D' suffix would be a claim about every name nobody has looked at. Only written on rows with no rmsConstant, because five referenced units carry one — FORAGE (59) among them — and a bush scripts place on purpose is not a corpse. Absent means 'not one', and the link under-reaches by about 44 units, which is the safe direction: a row wrongly visible is a row in a list, a row wrongly hidden is a unit an author cannot find.
   */
  isCorpse?: boolean;
  /**
   * Object entries only. True for trees and bushes. Cosmetic: the preview draws them in the wood colour instead of the near-white unknown-object colour, which otherwise buries forest terrain under white dots. The generator falls back to a name pattern when this is absent.
   */
  isTree?: boolean;
  /**
   * Per-object resource yield, as the UNMODIFIED base/default value from the game's data files (what a plain create_object of this type gets before any in-script resource_delta / effect-percent-style modifier). Only meaningful for category: object resource nodes. Used by the status-bar totals — src/parser/resourceTotals.ts does not currently model script-level modifiers to this base value.
   */
  resourceAmounts?: {
    food?: number;
    wood?: number;
    gold?: number;
    stone?: number;
  };
  /**
   * Object rows: the unit's raw resource-storage slots straight off empires2_x2_p1.dat, slot 0 first, empty slots (type -1) omitted. This is the MEASUREMENT that resourceAmounts is a four-resource reading of, and it is kept because effect_amount SET_ATTRIBUTE <target> ATTR_STORAGE_VALUE <n> writes SLOT 0 whatever that slot holds — wood for a tree, population for a house, decay time for a corpse — so whether such a line changes a map's resource totals depends on the slot's type, which resourceAmounts has already discarded. Measured slot-0 types across the roster: 0 food, 1 wood, 2 stone, 3 gold, 4 population, 12 decay time, 17 fish food, plus four small unread ones.
   */
  resourceStorages?: {
    /**
     * The genie resource-type index. Not a label read from the dat — a fixed engine convention, verified per run by the sanity-check table the script prints.
     */
    type: number;
    /**
     * The slot's base value. Zero is a real value, not an empty slot, and is exactly what a script writes to switch a resource off.
     */
    amount: number;
    /**
     * Which of the four the slot's type resolves to, resolved at extraction so no consumer carries a second copy of the engine's resource convention. ABSENT means the slot is not a player-gatherable resource (population, decay time, or one of the unread types), which is what a caller checks before assuming an effect_amount ATTR_STORAGE_VALUE line moved a resource total.
     */
    resource?: "food" | "wood" | "stone" | "gold";
  }[];
  /**
   * attribute rows only: this effect_amount attribute writes that index of the target unit's resourceStorages. Present so a consumer can ask the data which attribute changes what an object yields instead of hardcoding the RMS name. Only ATTR_STORAGE_VALUE (slot 0) carries it, because only that one is established.
   */
  writesStorageSlot?: number;
  /**
   * The genie unit class. On an object row it says which class that object belongs to; on an objectClass row it is that row's own class. constId is always this plus 900, the offset an RMS author writes and the one the engine uses to tell a class target from a unit target. The offset is re-verified against random_map.def on every extraction run and a disagreement aborts the run.
   */
  classId?: number;
  /**
   * objectClass rows only: every unit id in this class, ascending, over the WHOLE gaia roster rather than only the objects that have their own row here. That is the point of the field — the question it answers is whether an object the script places belongs to a class the script named, and an object with no row of its own is exactly the case that gets asked about.
   */
  memberIds?: number[];
  /**
   * False means this entry (or some field on it — see notes) hasn't been checked against the game's actual data files yet. Treat unverified numeric fields (constId, resourceAmounts) as placeholders, not facts.
   */
  verified: boolean;
  /**
   * Free text: what's unverified and why, sourcing, ambiguities.
   */
  notes?: string;
}

/**
 * The array as `ToolContext.referenceData.gameConstants` carries it. Readonly
 * because the context is read-only in both transports — over the wire it is a
 * structured-clone copy, and a main-thread built-in holds the live object.
 */
export type PublishedGameConstants = readonly PublishedGameConstant[];
