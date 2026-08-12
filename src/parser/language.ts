// Typed view of reference/data/language.json plus fast lookup indices.
// Per docs/parser-design.md goal #4, ALL command/attribute/directive/
// control-keyword/section knowledge flows through this module — the parser
// hardcodes nothing (with one pinned exception: control-keyword operand
// arity, Sec.5.1, until `arguments[]` lands on controlKeywords entries in the
// data — see spec Sec.13).

export type ArgumentType =
  | "integer"
  | "percent"
  | "flag"
  | "string"
  | "terrainConstant"
  | "objectConstant"
  | "otherConstant";

export const NUMERIC_ARGUMENT_TYPES: ReadonlySet<ArgumentType> = new Set(["integer", "percent", "flag"]);

export interface ArgumentDef {
  name: string;
  type: ArgumentType;
  min?: number;
  max?: number;
  default?: number | string;
  description?: string;
  optional?: boolean; // schema action item (spec Sec.13) — honored if present
  variadic?: boolean; // schema action item — honored if present
  // Advisory range, distinct from min: a value below cautionBelow is still
  // valid RMS (no min violation), but is worth flagging live — e.g. a
  // negative border value that can crash the game if it pushes the land
  // origin off-map. RMS0217, added post-spec (2.4 bug-fix session) — see
  // docs/parser-design.md Sec.10.
  cautionBelow?: number;
  cautionMessage?: string; // required alongside cautionBelow; user-facing text
  /**
   * Suppresses the known-name half of Sec.6's stop set for THIS slot only.
   *
   * The stop set exists so a command missing its arguments cannot swallow the
   * next command as one, which is what keeps a single typo from eating the rest
   * of the file. It is right everywhere except where a known name is the whole
   * point: `#const`'s value slot, where Sec.2.1 says a script may alias any
   * name, so `#const restricted_terrain_distance max_distance_to_other_zones`
   * is correct RMS and stopping on it reported the author's own line twice.
   *
   * Deliberately a flag rather than a rule derived from `type`, even though
   * every alias target is an `otherConstant`: 15 other slots share that type,
   * and on `effect_amount.attribute` or `assign_to.target` a known name really
   * is a mangled line that must still stop. The narrow exception is the safe
   * one, since this stop set is the parser's main error-recovery lever.
   */
  acceptsKnownName?: boolean;
}

export interface CommandDef {
  name: string;
  /**
   * Where the GUIDE DOCUMENTS this command. Deliberately NOT "where the engine
   * accepts it" — see `sectionLocked`, which is that fact and is a different
   * field for a reason.
   */
  section: string;
  /**
   * True only where the engine has been MEASURED to discard the command
   * outside `section`. Read by validate()'s RMS0304 and by nothing else;
   * absent means unknown, and unknown reports nothing.
   *
   * The two fields look redundant and are not. Enforcing `section` as though
   * it were this flag warned 53 times on the corpus, 52 of them `effect_amount`
   * used outside <PLAYER_SETUP> by shipped, working maps — so at least one
   * command is provably not locked the way its `section` implies, and a
   * blanket rule rebuilds the false-positive class BUG-002 and BUG-005 cost
   * three rounds of work.
   */
  sectionLocked?: boolean;
  /**
   * The engine's own internal token id for this name, set only where a run has
   * measured it. Sec.2.1: the engine resolves every word to one integer and
   * constants share that space with commands, so a script's `#const L 32` makes
   * `L` indistinguishable from whichever command holds 32. Read by the parser's
   * alias resolution and by nothing else; absent means unknown, and unknown
   * resolves nothing.
   *
   * Same species as `sectionLocked` above — an engine fact on a type whose
   * other fields are mostly documentation facts — and the sibling of `constId`
   * in game-constants.json, which records the same integer space for constants.
   * The id space is flat and it collides across categories: 69 is at once
   * SHORE_FISH, ATTR_PROJECTILE_ARC and the engine's own `/*` (validate.ts's
   * COMMENT_OPEN_ID, RMS0111).
   */
  tokenId?: number;
  kind: "standalone" | "block";
  description?: string;
  arguments?: ArgumentDef[];
  attributes?: string[]; // name refs into LanguageData.attributes
  verified: boolean;
  // Set when a patch superseded this command but the engine still accepts it.
  // The string is user-facing replacement guidance, rendered verbatim by
  // validate()'s RMS0309 — so the deprecation list lives in the data, not in
  // a name check inside validate.ts (CLAUDE.md: vocabulary is data-driven).
  deprecated?: string;
  notes?: string;
}

export interface AttributeDef {
  name: string;
  description?: string;
  arguments?: ArgumentDef[];
  verified: boolean;
  mutexWith?: string[]; // consumed by validate() (spec Sec.8), not the parser
  // What the guide says HAPPENS when a mutexWith pair co-occurs, where it says
  // so. RMS0307 appends it. Absent for most pairs because the guide only
  // declares the exclusion for them, and the generic message claims no more.
  mutexNote?: string;
  // Attribute names, at least one of which must be in the SAME block for this
  // attribute to do anything. A guide "Requires:" line, and the failure is
  // silent — the attribute is simply inert, and the command runs on without
  // it (MEASURED, RMSTEST_42; an earlier reading had the command placing
  // nothing at all, which was inferred from a map that could not tell the two
  // apart). Drives RMS0315. Same bar as requiresSection: the guide must state
  // the requirement AND the consequence must be known, which for the only
  // entry today means measured in game.
  requiresOneOf?: string[];
  // What unmet looks like to the author. RMS0315 appends it. Sibling of
  // mutexNote, and data rather than code for the same reason.
  requiresNote?: string;
  repeatable?: boolean; // cumulative attributes — see spec Sec.8
  maxRepeats?: number;
  // A sections[] name that must appear somewhere in the script for this
  // attribute to have any effect. Drives validate()'s RMS0311 — the one
  // error-severity semantic check — so only engine-verified cases belong
  // here. `base_elevation` -> `ELEVATION_GENERATION` is the only one today.
  requiresSection?: string;
  // True for names the DE exe carries as strings with nothing behind them —
  // the guide's Non-Functional Syntax appendix. Same meaning as the flag on
  // DirectiveDef, and the reason it now exists on attributes too: without an
  // entry these names drew a bare "unknown attribute", which is both wrong
  // (the engine does know the word) and useless (it names no alternative).
  nonFunctional?: boolean;
  // The working attribute this dead string corresponds to, rendered into
  // RMS0310's message. Separate from CommandDef.deprecated, which means
  // something different: a deprecated command still WORKS and the guidance is
  // about style. These never worked at all.
  replacedBy?: string;
  notes?: string;
}

export interface DirectiveDef {
  name: string; // full token text, e.g. "#const"
  description?: string;
  arguments?: ArgumentDef[];
  verified: boolean;
  nonFunctional?: boolean; // schema action item — #undefine/#include are engine ghosts
  notes?: string;
}

export interface ControlKeywordDef {
  name: string;
  description?: string;
  arguments?: ArgumentDef[]; // schema action item — absent today, see pinned exception
  verified: boolean;
  notes?: string;
}

// Mirrors the `category` enum in reference/schemas/language.schema.json's
// $defs/predefinedLabel. The schema is authoritative — it is what CI validates
// the data against. Mirrored as a union rather than typed `string` so the
// preview generator's category switch (docs/preview-design.md Sec.3.1) gets
// exhaustiveness checking: add a category to the data and the schema, and the
// compiler points at every switch that hasn't handled it yet.
export type PredefinedLabelCategory =
  | "gameMode"
  | "mapSize"
  | "startingResources"
  | "startingAge"
  | "lobbySetting"
  | "playerCount"
  | "teamCount"
  | "teamSize"
  | "playerInTeam"
  | "gameVersion";

/**
 * A condition label the engine defines itself — usable as the ConditionLabel of
 * if/elseif with no #define. Two consumers, one array: validate()'s
 * unknown-constant check treats these as defined, and the preview generator
 * builds its branch-selection environment by deciding which of these are true
 * for the current generation settings. Do not duplicate the list in code.
 */
export interface PredefinedLabel {
  name: string; // may lead with a digit — 4_PLAYER_GAME, 2_TEAM_GAME are real
  category: PredefinedLabelCategory;
  description: string;
  verified: boolean;
  // mapSize labels only. `dimensions` is the side length in tiles; `mapSize` is
  // the matching MAP_SIZES value, absent for sizes no setting can select (the
  // MORE_MAP_SIZES tier, reachable only by launch option or override_map_size).
  // Both are stored rather than derived because the legacy and modern names are
  // offset by one size — LARGE_MAP and MAPSIZE_NORMAL are both 200×200, so a
  // consumer inferring dimensions from the name gets it wrong on every
  // size-aware map (docs/preview-design.md Sec.4).
  //
  // `mapSize` stays a plain string rather than importing MapSize from
  // src/generationSettings/: this module is the parser's, and the parser does
  // not depend on app-layer modules (parser-design goal #4). Consumers that
  // already own MapSize can narrow it themselves.
  dimensions?: number;
  mapSize?: string;
  notes?: string;
}

export interface LanguageData {
  sections: string[];
  commands: CommandDef[];
  attributes: AttributeDef[];
  directives: DirectiveDef[];
  controlKeywords: ControlKeywordDef[];
  // Optional even though the schema marks it *required*, deliberately: nothing
  // checks this shape at runtime (parserWorker.ts reaches LanguageData through
  // a double cast, which asserts rather than verifies), and preview-design
  // Sec.3.1 mandates a `refDb.predefinedLabels ?? []` guard as the backstop
  // that stops a data regression from silently evaluating every conditional as
  // undefined. Typing it non-optional would make that mandated guard dead code.
  predefinedLabels?: PredefinedLabel[];
}

/** Precomputed lookup maps. Build once per LanguageData, share freely. */
export interface LanguageIndex {
  data: LanguageData;
  sections: ReadonlySet<string>;
  commandsByName: ReadonlyMap<string, CommandDef>;
  attributesByName: ReadonlyMap<string, AttributeDef>;
  directivesByName: ReadonlyMap<string, DirectiveDef>;
  controlKeywords: ReadonlySet<string>;
  /** Union of command + attribute names — the "known name" stop set (spec Sec.6). */
  knownNames: ReadonlySet<string>;
  /**
   * Reverse index over `CommandDef.tokenId`, for resolving a script's own
   * `#const NAME <id>` back to the command that id names (Sec.2.1). Empty but
   * for the ids a run has measured, which today is one.
   */
  commandsByTokenId: ReadonlyMap<number, CommandDef>;
}

export function buildLanguageIndex(data: LanguageData): LanguageIndex {
  const commandsByName = new Map<string, CommandDef>();
  for (const c of data.commands) commandsByName.set(c.name, c);
  const attributesByName = new Map<string, AttributeDef>();
  for (const a of data.attributes) attributesByName.set(a.name, a);
  const directivesByName = new Map<string, DirectiveDef>();
  for (const d of data.directives) directivesByName.set(d.name, d);
  const controlKeywords = new Set<string>(data.controlKeywords.map((k) => k.name));
  const knownNames = new Set<string>([...commandsByName.keys(), ...attributesByName.keys()]);
  // First writer wins, so a duplicate id cannot silently change which command a
  // map renders as depending on array order. `validate:reference` rejects the
  // duplicate outright; this is the belt to that braces, since the index is
  // also built from data the app loads at runtime.
  const commandsByTokenId = new Map<number, CommandDef>();
  for (const c of data.commands) {
    if (typeof c.tokenId === "number" && !commandsByTokenId.has(c.tokenId)) {
      commandsByTokenId.set(c.tokenId, c);
    }
  }
  return {
    data,
    sections: new Set(data.sections),
    commandsByName,
    attributesByName,
    directivesByName,
    controlKeywords,
    knownNames,
    commandsByTokenId,
  };
}
