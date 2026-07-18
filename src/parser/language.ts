// Typed view of reference/data/language.json plus fast lookup indices.
// Per docs/parser-design.md goal #4, ALL command/attribute/directive/
// control-keyword/section knowledge flows through this module — the parser
// hardcodes nothing (with one pinned exception: control-keyword operand
// arity, §5.1, until `arguments[]` lands on controlKeywords entries in the
// data — see spec §13).

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
  optional?: boolean; // schema action item (spec §13) — honored if present
  variadic?: boolean; // schema action item — honored if present
  // Advisory range, distinct from min: a value below cautionBelow is still
  // valid RMS (no min violation), but is worth flagging live — e.g. a
  // negative border value that can crash the game if it pushes the land
  // origin off-map. RMS0217, added post-spec (2.4 bug-fix session) — see
  // docs/parser-design.md §10.
  cautionBelow?: number;
  cautionMessage?: string; // required alongside cautionBelow; user-facing text
}

export interface CommandDef {
  name: string;
  section: string;
  kind: "standalone" | "block";
  description?: string;
  arguments?: ArgumentDef[];
  attributes?: string[]; // name refs into LanguageData.attributes
  verified: boolean;
  notes?: string;
}

export interface AttributeDef {
  name: string;
  description?: string;
  arguments?: ArgumentDef[];
  verified: boolean;
  mutexWith?: string[]; // consumed by validate() (spec §8), not the parser
  repeatable?: boolean; // cumulative attributes — see spec §8
  maxRepeats?: number;
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

export interface LanguageData {
  sections: string[];
  commands: CommandDef[];
  attributes: AttributeDef[];
  directives: DirectiveDef[];
  controlKeywords: ControlKeywordDef[];
  predefinedLabels?: string[]; // schema action item (spec §7/§13) — absent today
}

/** Precomputed lookup maps. Build once per LanguageData, share freely. */
export interface LanguageIndex {
  data: LanguageData;
  sections: ReadonlySet<string>;
  commandsByName: ReadonlyMap<string, CommandDef>;
  attributesByName: ReadonlyMap<string, AttributeDef>;
  directivesByName: ReadonlyMap<string, DirectiveDef>;
  controlKeywords: ReadonlySet<string>;
  /** Union of command + attribute names — the "known name" stop set (spec §6). */
  knownNames: ReadonlySet<string>;
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
  return {
    data,
    sections: new Set(data.sections),
    commandsByName,
    attributesByName,
    directivesByName,
    controlKeywords,
    knownNames,
  };
}
